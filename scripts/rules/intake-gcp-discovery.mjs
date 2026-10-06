// GCP Compute 디스커버리 변환기 (D43) — insert 메서드의 요청 스키마에 묶인 name 만 후보로 낸다.
// 개발 때만 돈다(번들 · CI 밖). constraints.ts 를 쓰지 않는다.
//
// 사용: node scripts/rules/intake-gcp-discovery.mjs <compute v1 discovery.json> [--out <json>]
//   원문: https://www.googleapis.com/discovery/v1/apis/compute/v1/rest (JSON 원문만 쓴다 — 마크다운
//   변환본은 정규식의 대괄호가 깨진다)
//
// 후보는 메서드마다 하나다(disks.insert 와 regionDisks.insert 는 같은 Disk 스키마라도 따로 센다).
//   - name 이 없거나 readOnly → excluded (사람이 짓는 이름이 아니다)
//   - pattern 이 RFC1035 → candidates (정형)
//   - pattern 이 없거나 · 깨졌거나 · RFC1035 가 아니면 → manual (손 확인)
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const RFC1035_PATTERN = '[a-z](?:[-a-z0-9]{0,61}[a-z0-9])?';
const REST_BASE = 'https://docs.cloud.google.com/compute/docs/reference/rest/v1';

function* insertMethods(resources, path = []) {
  for (const [name, res] of Object.entries(resources ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    const here = [...path, name];
    const m = res.methods?.insert;
    if (m) yield { resource: here.join('.'), method: m.id ?? `compute.${here.join('.')}.insert`, schema: m.request?.$ref ?? null };
    yield* insertMethods(res.resources, here);
  }
}

function classify(prop) {
  if (!prop) return { bucket: 'excluded', reason: 'no-name' };
  if (prop.readOnly) return { bucket: 'excluded', reason: 'readOnly' };
  if (prop.pattern === undefined) return { bucket: 'manual', reason: 'no-pattern' };
  try {
    new RegExp(prop.pattern);
  } catch {
    return { bucket: 'manual', reason: 'broken-pattern' };
  }
  const bare = prop.pattern.replace(/^\^/, '').replace(/\$$/, '');
  if (bare === RFC1035_PATTERN) return { bucket: 'candidates', reason: null };
  return { bucket: 'manual', reason: 'non-rfc1035-pattern' };
}

/** @param {any} doc compute v1 디스커버리 JSON */
export function parseComputeDiscovery(doc) {
  const out = { candidates: [], manual: [], excluded: [] };
  const all = [];
  for (const m of insertMethods(doc.resources)) {
    const prop = m.schema ? doc.schemas?.[m.schema]?.properties?.name : undefined;
    const { bucket, reason } = m.schema ? classify(prop) : { bucket: 'excluded', reason: 'no-request' };
    const row = {
      ...m,
      reason,
      pattern: prop?.pattern ?? null,
      readOnly: prop?.readOnly === true,
      length: bucket === 'candidates' ? { min: 1, max: 63 } : null,
      descriptionRaw: prop?.description ?? null,
      // REST 참조 쪽 앵커 — 쪽마다 열어 보지는 않았다(사람이 행을 들일 때 연다)
      docUrl: m.schema ? `${REST_BASE}/${m.resource.split('.').pop()}#${m.schema}.FIELDS.name` : null,
    };
    out[bucket].push(row);
    all.push(row);
  }
  const uniq = (rows) => new Set(rows.map((r) => r.schema)).size;
  return {
    source: `${doc.rootUrl ?? 'https://compute.googleapis.com/'}${doc.servicePath ?? ''}`,
    revision: doc.revision ?? null,
    counts: {
      insertMethods: all.length,
      formal: out.candidates.length,
      manual: out.manual.length,
      excluded: out.excluded.length,
      uniqueSchemas: uniq(all),
      uniqueFormalSchemas: uniq(out.candidates),
    },
    ...out,
    all,
  };
}

function main(argv) {
  const args = [...argv];
  const i = args.indexOf('--out');
  const out = i >= 0 ? args.splice(i, 2)[1] : null;
  if (args.length !== 1) {
    console.error('사용: node scripts/rules/intake-gcp-discovery.mjs <discovery.json> [--out <json>]');
    return 2;
  }
  const result = parseComputeDiscovery(JSON.parse(readFileSync(args[0], 'utf-8')));
  const { all: _all, ...printable } = result;
  const json = `${JSON.stringify(printable, null, 2)}\n`;
  if (out) writeFileSync(out, json);
  else process.stdout.write(json);
  console.error(`GCP revision ${result.revision} · ${JSON.stringify(result.counts)}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
