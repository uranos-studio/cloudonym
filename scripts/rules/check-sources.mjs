// 규칙 출처 감지 (D43) — 받아 둔 원문을 docs/rule-sources.lock.json 과 대어 보고
// 다른 출처를 나열한 뒤 exit 1 로 끝낸다. 고치지 않는다 — 사람이 행을 읽고 판정한다.
// 네트워크를 쓰지 않는다. 원문은 인자로 받는다(받는 일은 워크플로가 curl 로 한다).
//
// 사용:
//   node scripts/rules/check-sources.mjs --lock docs/rule-sources.lock.json \
//     --azure <resource-name-rules.md> --azure-html <게시 쪽 HTML> [--azure-commit <sha>] \
//     --gcp <compute v1 discovery.json> --gcp-kms <cloudkms v1 discovery.json> --aws <CloudformationSchema.zip 을 푼 폴더> [--write]
//   --write  지금 입력으로 lock 을 새로 쓴다(사람이 diff 를 읽고 커밋한다)
//
// 판정 — exit 1 은 sha256 · counts 가 다를 때만이다. sha256 은 쪽 전체가 아니라 우리가 쓰는 칸만
// 뽑아 정규화한 텍스트의 해시다(무관한 수정에 울지 않게). marker(Azure ms.date · GCP revision)와
// Azure 커밋은 알림으로만 낸다 — 쓰는 칸이 그대로인데 문서 버전만 바뀐 것으로는 사람이 판정할 거리가 없다.
// exit 2 는 인자 · 해석 오류다.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseAzureRules, h2IdsOf, AZURE_RULES_URL } from './intake-azure.mjs';
import { parseComputeDiscovery } from './intake-gcp-discovery.mjs';
import { placedInVpc } from './build-aws-rules.mjs';

/** 주요 서비스 18개 네임스페이스(지원 범위 결정 — docs/decisions.md) */
export const AWS_NAMESPACES = [
  'ApiGateway', 'ApiGatewayV2', 'DynamoDB', 'EC2', 'ECR', 'ECS', 'EFS', 'EKS', 'ElastiCache',
  'ElasticLoadBalancing', 'ElasticLoadBalancingV2', 'IAM', 'KMS', 'Lambda', 'Logs', 'RDS', 'S3', 'SecretsManager',
];

const URLS = {
  azure: 'https://raw.githubusercontent.com/MicrosoftDocs/azure-docs/main/articles/azure-resource-manager/management/resource-name-rules.md',
  gcp: 'https://www.googleapis.com/discovery/v1/apis/compute/v1/rest',
  gcpKms: 'https://www.googleapis.com/discovery/v1/apis/cloudkms/v1/rest',
  aws: 'https://schema.cloudformation.us-east-1.amazonaws.com/CloudformationSchema.zip',
};

const sha256 = (lines) => createHash('sha256').update(`${lines.join('\n')}\n`).digest('hex');
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** KST 시각 — toISOString()(UTC) 을 쓰지 않는다 */
export function kstNow(date = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+09:00`;
}

export function azureDigest(mdPath, htmlPath) {
  const h2Ids = htmlPath ? h2IdsOf(readFileSync(htmlPath, 'utf-8')) : undefined;
  const r = parseAzureRules(readFileSync(mdPath, 'utf-8'), { h2Ids });
  const { judgement: _j, ...counts } = r.counts;
  return {
    marker: { msDate: r.msDate },
    counts,
    hashOf: 'provider · entity · scope · length · valid characters 원문 다섯 칸(공백 정규화), 문서 순서',
    sha256: sha256(r.rows.map((x) => [x.providerHeading, x.entityRaw, x.scope, x.lengthRaw, x.validCharactersRaw].map(norm).join('\t'))),
  };
}

export function gcpDigest(jsonPath) {
  const r = parseComputeDiscovery(JSON.parse(readFileSync(jsonPath, 'utf-8')));
  const { uniqueSchemas: _u, uniqueFormalSchemas: _f, ...counts } = r.counts;
  return {
    marker: { revision: r.revision },
    counts,
    hashOf: 'insert 메서드마다 method · schema · name.pattern · name.readOnly, 정렬',
    sha256: sha256(r.all.map((x) => [x.method, x.schema, x.pattern, x.readOnly].map(norm).join('\t')).sort()),
  };
}

/** Cloud KMS — create 메서드의 …Id 인자 설명(들이기가 정규식 · 유일 범위를 읽는 문장) */
export function gcpKmsDigest(jsonPath) {
  const doc = JSON.parse(readFileSync(jsonPath, 'utf-8'));
  const lines = [];
  const walk = (resources) => {
    for (const res of Object.values(resources ?? {})) {
      const m = res.methods?.create;
      if (m) {
        for (const [param, p] of Object.entries(m.parameters ?? {})) {
          if (p.location === 'query' && param.endsWith('Id')) lines.push([m.id, param, p.description].map(norm).join('\t'));
        }
      }
      walk(res.resources);
    }
  };
  walk(doc.resources);
  return {
    marker: { revision: doc.revision ?? null },
    counts: { createIdParams: lines.length },
    hashOf: 'create 메서드마다 method · …Id 인자 이름 · 그 설명, 정렬',
    sha256: sha256(lines.sort()),
  };
}

export function awsDigest(dir) {
  const lines = [];
  let types = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const s = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
    const [vendor, ns] = String(s.typeName ?? '').split('::');
    if (vendor !== 'AWS' || !AWS_NAMESPACES.includes(ns)) continue;
    types += 1;
    lines.push(`${s.typeName}\t(type)\t${(s.createOnlyProperties ?? []).slice().sort().join(',')}`);
    lines.push(`${s.typeName}\t(placement)\t${placedInVpc(s) ? 'vpc' : '-'}`);
    for (const [prop, def] of Object.entries(s.properties ?? {})) {
      if (def.minLength === undefined && def.maxLength === undefined && def.pattern === undefined) continue;
      lines.push([s.typeName, prop, def.minLength, def.maxLength, def.pattern].map(norm).join('\t'));
    }
  }
  return {
    marker: null,
    counts: { types },
    hashOf: '18개 네임스페이스(typeName 으로 고른다) 타입마다 createOnlyProperties · 쓰기 가능한 VpcId/SubnetId 유무(Name 태그 자리), 최상위 속성 중 minLength · maxLength · pattern 이 있는 것의 세 값, 정렬',
    sha256: sha256(lines.sort()),
  };
}

export function buildLock(inputs, { azureCommit = null } = {}) {
  const at = kstNow();
  return {
    $comment: '규칙 출처 고정 (D43). scripts/rules/check-sources.mjs 가 대어 본다. 고칠 때는 --write 로 만들고 diff 를 읽는다',
    sources: {
      azure: {
        url: URLS.azure,
        publishedUrl: AZURE_RULES_URL,
        commit: azureCommit,
        fetchedAt: at,
        ...azureDigest(inputs.azure, inputs.azureHtml),
      },
      gcp: { url: URLS.gcp, fetchedAt: at, ...gcpDigest(inputs.gcp) },
      gcpKms: { url: URLS.gcpKms, fetchedAt: at, ...gcpKmsDigest(inputs.gcpKms) },
      aws: { url: URLS.aws, namespaces: AWS_NAMESPACES, fetchedAt: at, ...awsDigest(inputs.aws) },
    },
  };
}

function compare(lock, inputs, azureCommit) {
  const now = {
    azure: azureDigest(inputs.azure, inputs.azureHtml),
    gcp: gcpDigest(inputs.gcp),
    gcpKms: gcpKmsDigest(inputs.gcpKms),
    aws: awsDigest(inputs.aws),
  };
  const changed = [];
  const notices = [];
  for (const key of ['azure', 'gcp', 'gcpKms', 'aws']) {
    const was = lock.sources?.[key];
    if (!was) {
      changed.push(`${key}: lock 에 없다`);
      continue;
    }
    const cur = now[key];
    if (was.sha256 !== cur.sha256) changed.push(`${key}: sha256 ${was.sha256} → ${cur.sha256}`);
    for (const [k, v] of Object.entries(was.counts ?? {})) {
      if (cur.counts[k] !== v) changed.push(`${key}: counts.${k} ${v} → ${cur.counts[k]}`);
    }
    for (const [k, v] of Object.entries(cur.counts)) {
      if (!(k in (was.counts ?? {}))) changed.push(`${key}: counts.${k} 가 lock 에 없다 (지금 ${v})`);
    }
    if (JSON.stringify(was.marker) !== JSON.stringify(cur.marker)) {
      notices.push(`${key}: marker ${JSON.stringify(was.marker)} → ${JSON.stringify(cur.marker)}`);
    }
  }
  if (azureCommit && lock.sources?.azure?.commit !== azureCommit) {
    notices.push(`azure: commit ${lock.sources?.azure?.commit} → ${azureCommit}`);
  }
  return { changed, notices };
}

function main(argv) {
  const args = [...argv];
  const take = (flag) => {
    const i = args.indexOf(flag);
    return i < 0 ? null : args.splice(i, 2)[1];
  };
  const write = args.includes('--write');
  if (write) args.splice(args.indexOf('--write'), 1);
  const lockPath = take('--lock');
  const inputs = { azure: take('--azure'), azureHtml: take('--azure-html'), gcp: take('--gcp'), gcpKms: take('--gcp-kms'), aws: take('--aws') };
  const azureCommit = take('--azure-commit');
  // --azure-html 도 필수다 — 빠지면 앵커를 재지 못한 채 통과할 수 있다
  if (args.length > 0 || !lockPath || !inputs.azure || !inputs.azureHtml || !inputs.gcp || !inputs.gcpKms || !inputs.aws) {
    console.error('사용: node scripts/rules/check-sources.mjs --lock <json> --azure <md> --azure-html <html> [--azure-commit <sha>] --gcp <json> --gcp-kms <json> --aws <dir> [--write]');
    return 2;
  }
  if (write) {
    writeFileSync(lockPath, `${JSON.stringify(buildLock(inputs, { azureCommit }), null, 2)}\n`);
    console.log(`lock 을 썼다 — ${lockPath}`);
    return 0;
  }
  const { changed, notices } = compare(JSON.parse(readFileSync(lockPath, 'utf-8')), inputs, azureCommit);
  for (const n of notices) console.log(`알림 — ${n}`);
  if (changed.length > 0) {
    console.error('규칙 출처가 lock 과 다르다 — 행을 읽고 규칙을 판정한 뒤 --write 로 lock 을 고친다:');
    for (const c of changed) console.error(`  ${c}`);
    return 1;
  }
  console.log('규칙 출처가 lock 과 같다');
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error(`해석 오류 — ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }
}
