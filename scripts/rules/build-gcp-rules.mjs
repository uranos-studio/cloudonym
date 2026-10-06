// GCP 정형 행 → 규칙 데이터 생성기 (D43 · 계획 §8-2 ②). 개발 때만 돈다(번들 · CI 밖).
//
// 사용:
//   node scripts/rules/build-gcp-rules.mjs --measure <compute.json> <cloudkms.json> > anchors.json
//       REST 참조 쪽을 받아 앵커가 있는지 잰다(네트워크). 결과는 행마다 쓸 docUrl 이다
//   node scripts/rules/build-gcp-rules.mjs <compute.json> <cloudkms.json> --anchors anchors.json --existing existing.json
//       <compute.json>  = https://www.googleapis.com/discovery/v1/apis/compute/v1/rest (JSON 원문)
//       <cloudkms.json> = https://www.googleapis.com/discovery/v1/apis/cloudkms/v1/rest (JSON 원문)
//       --existing      = 손으로 쓴 GCP 규칙의 entity 목록 ["compute.instances", …] — 같은 entity 는 건너뛴다.
//                         rules/gcp.ts 의 손 규칙과 rules/gcp-manual.ts 의 손으로 넣은 규칙(D43)을 둘 다 넣는다
// 쓰는 파일:
//   src/core/rules/gcp-intake.ts                     — 범위 · 규칙 행
//   src/core/__fixtures__/gcp-intake.json            — 원문 행 스냅샷(전사 검사의 정답)
//   src/core/__fixtures__/rule-cases-gcp-intake.json — 행마다 통과 · 실패 예(원문 문장에서 짠 것)
//   docs/gcp-intake-held.md                          — 이번에 넣지 않은 행과 사유
//
// 원칙: compute 는 insert 요청 스키마의 name.pattern 이 RFC 1035 인 행만(intake-gcp-discovery.mjs 판정 그대로).
// 다른 API 는 create 메서드의 `…Id` 인자 설명 안의 정규식만 — 아래 문법(regexInDescription)을 통과해야 한다.
// 문법 밖이면 넣지 않는다(spanner 의 `a-z*[a-z0-9]` 처럼 컴파일은 되지만 대괄호가 깨진 꼴을 막는다).
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseComputeDiscovery, RFC1035_PATTERN } from './intake-gcp-discovery.mjs';

export const COMPUTE_DISCOVERY_URL = 'https://www.googleapis.com/discovery/v1/apis/compute/v1/rest';
export const KMS_DISCOVERY_URL = 'https://www.googleapis.com/discovery/v1/apis/cloudkms/v1/rest';
const COMPUTE_REST = 'https://docs.cloud.google.com/compute/docs/reference/rest/v1';
const KMS_REST = 'https://docs.cloud.google.com/kms/docs/reference/rest/v1';

/** 조사 대상(Cloud Asset Inventory 자산 유형)에 든 KMS 생성 메서드 — 이 밖의 create 는 보류한다 */
export const KMS_SURVEYED = {
  'cloudkms.projects.locations.keyRings.create': { resourceType: 'kms_key_ring', displayName: 'Cloud KMS Key Ring', entity: 'cloudkms.keyRings', slug: 'kr' },
  'cloudkms.projects.locations.keyRings.cryptoKeys.create': { resourceType: 'kms_crypto_key', displayName: 'Cloud KMS Crypto Key', entity: 'cloudkms.keyRings.cryptoKeys', slug: 'key' },
  'cloudkms.projects.locations.keyRings.importJobs.create': { resourceType: 'kms_import_job', displayName: 'Cloud KMS Import Job', entity: 'cloudkms.keyRings.importJobs', slug: 'ij' },
  'cloudkms.projects.locations.ekmConnections.create': { resourceType: 'kms_ekm_connection', displayName: 'Cloud KMS EKM Connection', entity: 'cloudkms.ekmConnections', slug: 'ekm' },
  // 조사 대상이지만 설명에 정규식이 없다(손 확인) — 보류로 떨어진다
  'cloudkms.projects.locations.keyHandles.create': { resourceType: 'kms_key_handle', displayName: 'Cloud KMS Key Handle', entity: 'cloudkms.keyHandles', slug: 'kh' },
};

// ── 설명 안 정규식 문법 ────────────────────────────────────────────
/** 대괄호 짝 — 이스케이프되지 않은 [ ] 만 센다 */
function bracketsBalanced(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '\\') { i += 1; continue; }
    if (s[i] === '[') { if (depth > 0) return false; depth += 1; }
    else if (s[i] === ']') { if (depth === 0) return false; depth -= 1; }
  }
  return depth === 0;
}

/**
 * 설명 문장 안 정규식 — 「regular expression `…`」 꼴의 백틱 안만 읽는다. 넷 다일 때만 정형:
 * ① 백틱 안에 있다 ② `[` 또는 `^` 로 시작한다 ③ 대괄호 짝이 맞는다 ④ 컴파일된다.
 * `a-z*[a-z0-9]`(spanner — 대괄호가 빠졌다) · `/a-z{2,62}/`(iam v3 — 백틱이 없다)는 떨어진다.
 */
export function regexInDescription(desc) {
  const m = /regular expression `([^`]+)`/.exec(desc ?? '');
  if (!m) return { ok: false, reason: 'no regular expression in the description' };
  const raw = m[1];
  if (!/^[[^]/.test(raw)) return { ok: false, raw, reason: `expression \`${raw}\` does not start with a character class — brackets look lost` };
  if (!bracketsBalanced(raw)) return { ok: false, raw, reason: `expression \`${raw}\` has unbalanced brackets` };
  try { new RegExp(raw); } catch { return { ok: false, raw, reason: `expression \`${raw}\` does not compile` }; }
  return { ok: true, raw };
}

/** 「unique within a location」 · 「unique within a KeyRing」 → 범위 id */
export function uniquenessScopeOf(desc) {
  const m = /unique within an? (location|KeyRing)\b/.exec(desc ?? '');
  if (!m) return null;
  return m[1] === 'location' ? 'gcp:project_location' : 'gcp:kms_key_ring';
}

/** insert.path → 범위. 프로젝트 바로 아래 global · regions/{region} · zones/{zone} 의 모음만 */
export function scopeOfPath(path) {
  const m = /^projects\/\{project\}\/(global|regions\/\{region\}|zones\/\{zone\})\/[A-Za-z]+$/.exec(path ?? '');
  if (!m) return null;
  return m[1] === 'global' ? 'gcp:project_global' : m[1].startsWith('regions') ? 'gcp:project_region' : 'gcp:project_zone';
}

// ── 이름 · 약어 · 분류 ────────────────────────────────────────────
const words = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean);
const snake = (s) => words(s).join('_').toLowerCase();
/** 약어 — Azure 들이기와 같은 규칙: 낱말이 둘 이상이면 머리글자, 하나면 앞 세 글자 */
export function slugOf(schema) {
  const w = words(schema).map((x) => x.toLowerCase());
  return w.length >= 2 ? w.map((x) => x[0]).join('') : w[0].slice(0, 3);
}
/** 모음 이름의 위치 접두(region · global · zone) — 스키마 이름에 이미 있으면 붙이지 않는다 */
function placePrefix(resource, schema) {
  for (const p of ['region', 'global', 'zone']) if (resource.startsWith(p) && !schema.toLowerCase().startsWith(p)) return p;
  return '';
}
const PLACE_LABEL = { region: 'regional', global: 'global', zone: 'zonal' };

const STORAGE = /^(Disk|Snapshot|InstantSnapshot|InstantSnapshotGroup|StoragePool)$/;
const COMPUTE = /^(Autoscaler|Commitment|FutureReservation|Image|Instance\w*|License|MachineImage|Reservation|ResourcePolicy|RolloutPlan|\w*VmExtensionPolicy)$/;
export const categoryOf = (schema) => (STORAGE.test(schema) ? 'storage' : COMPUTE.test(schema) ? 'compute' : 'networking');

// ── 통과 · 실패 예 — 원문 문장에서 짠다(정규식에서 뽑지 않는다) ──────
/** RFC1035 문장: "1-63 characters long … the first character must be a lowercase letter, and all following characters must be a dash,
 *  lowercase letter, or digit, except the last character, which cannot be a dash" */
export const RFC1035_CASES = {
  valid: ['a', 'a1', 'web-01', `a${'b'.repeat(61)}c`],
  invalid: ['1abc', '-abc', 'abc-', 'Abc', 'a_b', 'a.b', 'a'.repeat(64)],
};
/** KMS 문장: "match the regular expression `[a-zA-Z0-9_-]{1,63}`" */
export const KMS_CASES = {
  valid: ['a', 'Key_Ring-01', '9', 'k'.repeat(63)],
  invalid: ['key.ring', 'key ring', 'key/ring', 'k'.repeat(64)],
};

// ── 행 ───────────────────────────────────────────────────────────
function computeRows(doc) {
  const parsed = parseComputeDiscovery(doc);
  const byMethod = new Map();
  const walk = (resources) => {
    for (const res of Object.values(resources ?? {})) {
      const m = res.methods?.insert;
      if (m) byMethod.set(m.id, m);
      walk(res.resources);
    }
  };
  walk(doc.resources);
  const bucketOf = new Map();
  for (const b of ['candidates', 'manual', 'excluded']) for (const r of parsed[b]) bucketOf.set(r.method, { bucket: b, reason: r.reason });
  return parsed.all.map((r) => ({
    api: 'compute', method: r.method, resource: r.resource, schema: r.schema, path: byMethod.get(r.method)?.path ?? null,
    pattern: r.pattern, readOnly: r.readOnly, description: r.descriptionRaw, ...bucketOf.get(r.method),
  }));
}

function kmsRows(doc) {
  const out = [];
  const walk = (resources) => {
    for (const [, res] of Object.entries(resources ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      const m = res.methods?.create;
      if (m) {
        for (const [param, p] of Object.entries(m.parameters ?? {})) {
          if (p.location !== 'query' || !param.endsWith('Id')) continue;
          out.push({ api: 'cloudkms', method: m.id, param, path: m.flatPath ?? m.path, description: p.description ?? '' });
        }
      }
      walk(res.resources);
    }
  };
  walk(doc.resources);
  return out;
}

/** --measure 결과: 메서드 id → 쓸 docUrl (없으면 앵커가 없다) */
/** 손으로 원문을 다시 읽고도 넣지 않은 행 (D43) — 보류 사유를 이것으로 바꾼다. 넣은 행은 --existing 으로 건너뛴다 */
const FIREWALL_POLICY_NAME = 'reviewed by hand — unconfirmed (the organization policy shortName is RFC 1035, but no source states a rule for the network firewall policy name)';
export const HAND_REVIEWED = {
  'compute.firewallPolicies.insert': FIREWALL_POLICY_NAME,
  'compute.networkFirewallPolicies.insert': FIREWALL_POLICY_NAME,
  'compute.regionNetworkFirewallPolicies.insert': FIREWALL_POLICY_NAME,
  'cloudkms.projects.locations.keyHandles.create': 'reviewed by hand — not imported (optional ID; a UUID is used when it is empty, and no source states its characters or length)',
};

export function build({ compute, kms, anchors, existing }) {
  const existingSet = new Set(existing);
  const rules = [];
  const held = [];
  const used = new Set();
  const cRows = computeRows(compute);
  for (const row of cRows) {
    const entity = `compute.${row.resource}`;
    if (existingSet.has(entity)) { row.existing = true; continue; }
    if (row.bucket !== 'candidates') { held.push({ row, reason: row.bucket === 'manual' ? `manual: ${row.reason}` : `excluded: ${row.reason}` }); continue; }
    const scope = scopeOfPath(row.path);
    if (!scope) {
      held.push({ row, reason: row.path?.startsWith('projects/') ? 'nested under a parent resource — no scope node for the parent' : 'not under a project (organization-level path)' });
      continue;
    }
    const docUrl = anchors[row.method];
    if (!docUrl) { held.push({ row, reason: 'anchorMissing: no name field anchor on the REST reference pages' }); continue; }
    const prefix = placePrefix(row.resource, row.schema);
    const resourceType = [prefix, snake(row.schema)].filter(Boolean).join('_');
    if (used.has(resourceType)) throw new Error(`resourceType 이 겹친다: ${resourceType}`);
    used.add(resourceType);
    rules.push({
      id: `gcp.${resourceType}`, resourceType, entity, scope, method: row.method,
      displayName: `${words(row.schema).join(' ')}${prefix ? ` (${PLACE_LABEL[prefix]})` : ''}`,
      slug: slugOf(row.schema), category: categoryOf(row.schema), min: 1, max: 63, pattern: row.pattern, chars: 'rfc1035',
      docUrl, uniquenessDocUrl: COMPUTE_DISCOVERY_URL, cases: RFC1035_CASES,
    });
  }
  const kRows = kmsRows(kms);
  for (const row of kRows) {
    const meta = KMS_SURVEYED[row.method];
    if (!meta) { held.push({ row, reason: 'outside the surveyed asset types' }); continue; }
    const rx = regexInDescription(row.description);
    if (!rx.ok) { held.push({ row, reason: `manual: ${rx.reason}` }); continue; }
    const scope = uniquenessScopeOf(row.description);
    if (!scope) { held.push({ row, reason: 'no uniqueness sentence in the description' }); continue; }
    const len = /\{(\d+),(\d+)\}$/.exec(rx.raw);
    if (!len) { held.push({ row, reason: `length is not stated as {min,max} in \`${rx.raw}\`` }); continue; }
    rules.push({
      id: `gcp.${meta.resourceType}`, ...meta, scope, method: row.method, category: 'security',
      min: Number(len[1]), max: Number(len[2]), pattern: rx.raw, chars: 'kms',
      docUrl: anchors[row.method] ?? `${KMS_REST}/${row.method.replace(/^cloudkms\./, '').replace(/\.create$/, '')}/create#query-parameters`,
      cases: KMS_CASES,
    });
  }
  for (const h of held) if (HAND_REVIEWED[h.row.method]) h.reason = HAND_REVIEWED[h.row.method];
  const keyRing = rules.find((r) => r.method === 'cloudkms.projects.locations.keyRings.create');
  const scopes = [
    { id: 'gcp:project_location', parent: 'gcp:project', displayName: 'Location', docUrl: `${KMS_REST}/projects.locations.keyRings/create#query-parameters` },
    { id: 'gcp:kms_key_ring', parent: 'gcp:project_location', displayName: 'Key ring', ruleId: keyRing?.id, docUrl: `${KMS_REST}/projects.locations.keyRings.cryptoKeys/create#query-parameters` },
  ];
  return { rules, held, scopes, sourceRows: [...cRows, ...kRows] };
}

// ── 출력 ──────────────────────────────────────────────────────────
const js = (v) => JSON.stringify(v);

export function renderTs(result, meta) {
  const L = [];
  L.push('// 생성 파일 — 손으로 고치지 않는다. scripts/rules/build-gcp-rules.mjs 로 다시 만든다 (D43 · 계획 §8-2 ②).');
  L.push(`// 출처: Compute 디스커버리 revision ${meta.computeRevision} · Cloud KMS 디스커버리 revision ${meta.kmsRevision}.`);
  L.push('// pattern 은 원문 그대로(compute name.pattern · KMS 설명 문장 안 정규식)이고 rules/gcp.ts 가 ^(?:…)$ 로 감싼다.');
  L.push("import type { ResourceRule } from '../types';");
  L.push("import type { ScopeDef } from '../scopes';");
  L.push('');
  L.push(`export type GcpIntakeScopeId =\n${result.scopes.map((s) => `  | '${s.id}'`).join('\n')};`);
  L.push('');
  L.push('/** KMS 범위 — 생성 메서드 설명의 「unique within a location」 · 「unique within a KeyRing」 */');
  L.push('export const GCP_INTAKE_SCOPES: Record<GcpIntakeScopeId, ScopeDef> = {');
  for (const s of result.scopes) {
    const rid = s.ruleId ? `, ruleId: '${s.ruleId}'` : '';
    L.push(`  '${s.id}': { id: '${s.id}', provider: 'gcp', displayName: ${js(s.displayName)}, parent: '${s.parent}'${rid}, docUrl: '${s.docUrl}' },`);
  }
  L.push('};');
  L.push('');
  L.push('/** chars: rfc1035 = 소문자 · 숫자 · 하이픈(글자로 시작 · 하이픈으로 끝나지 않음) · kms = 영숫자 · 밑줄 · 하이픈 */');
  L.push("interface Row { id: string; displayName: string; entity: string; scope: ResourceRule['scope']; method: string; min: number; max: number; pattern: string; chars: 'rfc1035' | 'kms'; slug: string; category: ResourceRule['category']; docUrl: string; uniquenessDocUrl?: string }");
  L.push('');
  L.push('export const GCP_INTAKE_ROWS: Row[] = [');
  for (const r of result.rules) {
    const u = r.uniquenessDocUrl ? `, uniquenessDocUrl: '${r.uniquenessDocUrl}'` : '';
    L.push(`  { id: '${r.id}', displayName: ${js(r.displayName)}, entity: '${r.entity}', scope: '${r.scope}', method: '${r.method}', min: ${r.min}, max: ${r.max}, pattern: ${js(r.pattern)}, chars: '${r.chars}', slug: '${r.slug}', category: '${r.category}', docUrl: '${r.docUrl}'${u} },`);
  }
  L.push('];');
  return `${L.join('\n')}\n`;
}

export function renderHeld(result, meta) {
  const L = [];
  L.push('# GCP rules not imported yet');
  L.push('');
  L.push(`Sources: [Compute Engine discovery document](${COMPUTE_DISCOVERY_URL}) (revision \`${meta.computeRevision}\`) and [Cloud KMS discovery document](${KMS_DISCOVERY_URL}) (revision \`${meta.kmsRevision}\`). Generated by \`scripts/rules/build-gcp-rules.mjs\` — do not edit by hand.`);
  L.push('');
  L.push(`Imported: **${result.rules.length}** rows as rules (plus the rows already covered by hand-written rules). Held: **${result.held.length}** rows, listed below with the reason.`);
  L.push('');
  L.push('## How the imported rows were mapped');
  L.push('');
  L.push('- **Compute Engine** — one row per `insert` method whose request schema has a writable `name` with the RFC 1035 `pattern` (`[a-z](?:[-a-z0-9]{0,61}[a-z0-9])?`, 1–63 characters). The scope comes from the method path: `projects/{project}/global/…` → project global, `regions/{region}/…` → project region, `zones/{zone}/…` → project zone. `docUrl` is the REST reference anchor `<Schema>.FIELDS.name` on the collection page; when that page has no such anchor, the request-body anchor on its `insert` page (`body.request_body.FIELDS.name`). Both were checked on 2026-10-06.');
  L.push('- **Cloud KMS** — one row per `create` method of a surveyed asset type whose `…Id` parameter description says "match the regular expression `…`". The expression is accepted only if it is inside backticks, starts with a character class or `^`, has balanced brackets and compiles. The scope comes from the same sentence: "unique within a location" → a project location node, "unique within a KeyRing" → a key ring node.');
  L.push('- **Prefix (slug)** — the initials of the schema name when it has two or more words (`TargetHttpsProxy` → `thp`), otherwise its first three letters (`Router` → `rou`). Same rule as the Azure fallback.');
  L.push('');
  L.push('## Held rows');
  L.push('');
  L.push('| API | Method | Path | Reason |');
  L.push('|---|---|---|---|');
  const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  for (const { row, reason } of result.held) L.push(`| ${row.api} | ${cell(row.method)} | ${cell(row.path)} | ${cell(reason)} |`);
  L.push('');
  L.push('## Other surveyed APIs — not in this pass');
  L.push('');
  L.push('Cloud Storage, Cloud SQL, GKE, Artifact Registry, Cloud Run, Cloud Functions, IAM, Secret Manager, Firestore and Spanner state their ID rules in prose (or not at all) in their discovery documents, so none of their rows is formal. Rows whose rule could be read from the REST reference or product guide were added by hand (`src/core/rules/gcp-manual.ts`, one source quote per rule). These descriptions carry a regular expression whose brackets are broken and must not be imported as written — the hand-added rules use the REST reference text instead:');
  L.push('');
  L.push('| API | Field | Text in the discovery document |');
  L.push('|---|---|---|');
  for (const [api, field, text] of BROKEN_SOURCES) L.push(`| ${api} | ${field} | ${cell(text)} |`);
  return `${L.join('\n')}\n`;
}

/** 원문 정규식이 깨진 여섯 칸 — 조사 2026-10-06 (spanner v1 revision 20260909 · iam v3 revision 20260925) */
export const BROKEN_SOURCES = [
  ['spanner v1', 'CreateInstanceRequest.instanceId', 'Valid identifiers are of the form `a-z*[a-z0-9]`'],
  ['spanner v1', 'CreateInstancePartitionRequest.instancePartitionId', 'Valid identifiers are of the form `a-z*[a-z0-9]`'],
  ['spanner v1', 'CreateDatabaseRequest.createStatement', 'The database ID must conform to the regular expression `a-z*[a-z0-9]`'],
  ['iam v3', 'policyBindings.create policyBindingId', 'Pattern, /a-z{2,62}/.'],
  ['iam v3', 'principalAccessBoundaryPolicies.create principalAccessBoundaryPolicyId', 'Pattern, /a-z{2,62}/.'],
  ['iam v3', 'accessPolicies.create accessPolicyId', 'Pattern, /a-z{2,62}/.'],
];

async function measure(compute, kms) {
  const rows = computeRows(compute).filter((r) => r.bucket === 'candidates');
  const out = {};
  const has = async (url, anchor) => {
    const res = await fetch(url, { redirect: 'follow' });
    return res.status === 200 && (await res.text()).includes(`id="${anchor}"`);
  };
  for (const r of rows) {
    const page = `${COMPUTE_REST}/${r.resource}`;
    if (await has(page, `${r.schema}.FIELDS.name`)) out[r.method] = `${page}#${r.schema}.FIELDS.name`;
    else if (await has(`${page}/insert`, 'body.request_body.FIELDS.name')) out[r.method] = `${page}/insert#body.request_body.FIELDS.name`;
  }
  for (const r of kmsRows(kms)) {
    const page = `${KMS_REST}/${r.method.replace(/^cloudkms\./, '').replace(/\.create$/, '')}/create`;
    if (await has(page, 'query-parameters')) out[r.method] = `${page}#query-parameters`;
  }
  return out;
}

async function main(argv) {
  const args = [...argv];
  const take = (flag) => { const i = args.indexOf(flag); return i < 0 ? null : args.splice(i, 2)[1]; };
  const doMeasure = args.includes('--measure');
  if (doMeasure) args.splice(args.indexOf('--measure'), 1);
  const anchorsPath = take('--anchors');
  const existingPath = take('--existing');
  if (args.length !== 2) {
    console.error('사용: node scripts/rules/build-gcp-rules.mjs [--measure] <compute.json> <cloudkms.json> [--anchors anchors.json] [--existing existing.json]');
    return 2;
  }
  const compute = JSON.parse(readFileSync(args[0], 'utf-8'));
  const kms = JSON.parse(readFileSync(args[1], 'utf-8'));
  if (doMeasure) { process.stdout.write(`${JSON.stringify(await measure(compute, kms), null, 1)}\n`); return 0; }
  const anchors = anchorsPath ? JSON.parse(readFileSync(anchorsPath, 'utf-8')) : {};
  const existing = existingPath ? JSON.parse(readFileSync(existingPath, 'utf-8')) : [];
  const meta = { computeRevision: compute.revision, kmsRevision: kms.revision };
  const result = build({ compute, kms, anchors, existing });
  writeFileSync('src/core/rules/gcp-intake.ts', renderTs(result, meta));
  writeFileSync('docs/gcp-intake-held.md', renderHeld(result, meta));
  const snapshot = {
    sources: { compute: COMPUTE_DISCOVERY_URL, cloudkms: KMS_DISCOVERY_URL }, revisions: meta,
    license: 'Fields quoted from Google API discovery documents for transcription tests.',
    rows: result.sourceRows.map((r) => (r.api === 'compute'
      ? { api: r.api, method: r.method, resource: r.resource, schema: r.schema, path: r.path, pattern: r.pattern, readOnly: r.readOnly, description: r.description }
      : { api: r.api, method: r.method, param: r.param, path: r.path, description: r.description })),
  };
  writeFileSync('src/core/__fixtures__/gcp-intake.json', `${JSON.stringify(snapshot, null, 1)}\n`);
  writeFileSync('src/core/__fixtures__/rule-cases-gcp-intake.json', `${JSON.stringify(Object.fromEntries(result.rules.map((r) => [r.id, r.cases])), null, 1)}\n`);
  // openapi.json NameItem.scope enum 에 새 범위를 붙인다
  const api = JSON.parse(readFileSync('public/openapi.json', 'utf-8'));
  const scopeEnum = api.components.schemas.NameItem.properties.scope.enum;
  for (const s of result.scopes) if (!scopeEnum.includes(s.id)) scopeEnum.splice(scopeEnum.indexOf('gcp:project_zone') + 1 + result.scopes.indexOf(s), 0, s.id);
  writeFileSync('public/openapi.json', `${JSON.stringify(api, null, 2)}\n`);
  console.error(`규칙 ${result.rules.length} · 보류 ${result.held.length} · 원문 행 ${result.sourceRows.length} · 기존 ${result.sourceRows.filter((r) => r.existing).length}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main(process.argv.slice(2)));
export { RFC1035_PATTERN };
