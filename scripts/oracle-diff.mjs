// 호환 오라클(D70)의 허용 차분 줄을 뽑는다 — src/core/__fixtures__/wire-allowed-diff.json 을 손으로 적지 않으려고.
// old 는 오라클(wire-before-wizard.json)에서, new 는 지금 코드의 출력(wire-compat.test.ts 가 WIRE_COMPAT_DUMP 로 내보낸 스냅숏)에서 그대로 옮긴다.
// 허용하는 자리는 존 규칙 14종(D50 revised)의 항목뿐이다 — wire 항목 · HCL 줄 · 내보내기 JSON 항목, 그리고 항목이 아닌 자리 둘:
// 지역 정규화 기록(/metadata/transformed/<i> — to · message 가 존 코드에서 리전 코드로) · names 응답의 전체 판정(/data/gcp/valid — 항목 판정의 논리곱).
// 예외 ②(D65 · T4 · D72) — 더한 규칙(ADDED_TYPES)이 generate:*:gcp 응답에 항목 하나로 늘고(old null), names-400 표본의 /supported 목록에
// 그 규칙 이름이 끼어든다(옛 목록의 순서는 그대로).
// 예외 ③(D72) — 약어를 바꾼 규칙(RENAMED_TYPES)의 항목은 존 규칙과 같은 방식으로 이름 칸만 바뀔 수 있다.
// 그 밖의 자리가 하나라도 다르면 줄을 쓰지 않고 실패한다(exit 1) — 허용 차분으로 회귀를 덮지 않는다.
// 사용: node scripts/oracle-diff.mjs --write  (줄을 뽑아 wire-allowed-diff.json 을 다시 쓴다 — 오라클 fixture 는 건드리지 않는다)
//       node scripts/oracle-diff.mjs --check  (쓰지 않고, 뽑은 줄이 파일과 같은지만 본다)
//       인자가 없으면 요약만 보이고 아무것도 쓰지 않는다
import { readFileSync, writeFileSync, mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'src/core/__fixtures__');
const ORACLE = join(FIXTURES, 'wire-before-wizard.json');
const ALLOWED = join(FIXTURES, 'wire-allowed-diff.json');

/** 존 규칙 14종 — 오라클을 만든 catalog 에서 regionToken 이 zone 이던 규칙 (wire-compat.test.ts 의 ZONE_RULES 와 같다) */
export const ZONE_RULES = [
  'compute_instance', 'disk', 'autoscaler', 'future_reservation', 'instance_group_manager', 'instance_group', 'instant_snapshot_group',
  'instant_snapshot', 'reservation', 'storage_pool', 'target_instance', 'zone_vm_extension_policy', 'node_group', 'network_endpoint_group',
];
/** 예외 ②(D65 · D72) — 더한 규칙 (wire-compat.test.ts 의 T4_ADDED_TYPES 와 같다). D72 가 작은 스택 규칙 11개를 더했다 */
export const ADDED_TYPES = ['run_service', 'cloud_sql_database', 'cloud_sql_user', 'router_nat', 'pubsub_topic', 'pubsub_subscription', 'cloudbuild_trigger', 'dns_managed_zone',
  'scheduler_job', 'bigquery_dataset', 'redis_instance', 'tasks_queue'];
/** 예외 ③(D72) — 약어를 바꾼 규칙. 존 규칙처럼 항목 안의 이름 칸(ITEM_FIELDS)만 바뀔 수 있다 — Spanner database db → spdb */
export const RENAMED_TYPES = ['spanner_database'];
/** 항목 안의 이름 칸이 바뀌어도 되는 규칙 — 존 규칙 14종(D50 revised) · 약어를 바꾼 규칙(D72) */
const ZONAL = new Set([...ZONE_RULES, ...RENAMED_TYPES]);
/** 존 규칙 항목 안에서 바뀌어도 되는 칸 — 이름이 존 코드에서 리전 코드로 · zone_required 가 이름으로 바뀌며 따라 바뀌는 것 */
const ITEM_FIELDS = new Set(['name', 'valid', 'violations', 'steps', 'original', 'is_truncated', 'is_transformed', 'kind_token']);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (v) => JSON.parse(JSON.stringify(v));
const esc = (t) => String(t).replace(/~/g, '~0').replace(/\//g, '~1');

/** 표본의 존 규칙 항목 key — generate 는 resource type 자체, names 는 항목의 resource_type 으로 고른다(양쪽 합집합) */
function zonalKeys(sample, oracleBody, actualBody) {
  const keys = new Set();
  for (const body of [oracleBody, actualBody]) {
    if (sample.startsWith('generate:')) {
      const p = sample.split(':')[2];
      if (p !== 'gcp') continue;
      for (const k of Object.keys(body?.data?.gcp ?? {})) if (ZONAL.has(k)) keys.add(k);
    } else {
      for (const it of body?.data?.gcp?.items ?? []) if (ZONAL.has(it.resource_type)) keys.add(it.key);
    }
  }
  return [...keys];
}

/** wire 본문에서 그 항목을 꺼내고 지운다 — wire-compat.test.ts 의 wireItemSite 와 같은 자리 */
function wireItem(body, sample, key, cut) {
  if (sample.startsWith('generate:')) {
    const map = body?.data?.gcp;
    const v = map && key in map ? map[key] : undefined;
    if (cut && map) delete map[key];
    return v;
  }
  const items = body?.data?.gcp?.items;
  const i = items?.findIndex((x) => x.key === key) ?? -1;
  const v = i >= 0 ? items[i] : undefined;
  if (cut && i >= 0) items.splice(i, 1);
  return v;
}

function hclLine(text, key) {
  const ident = `gcp_${key}`;
  const hits = (text ?? '').split('\n').filter((l) => l.startsWith(`  ${ident} = `) || l.startsWith(`  # INVALID: ${ident} — `));
  if (hits.length > 1) throw new Error(`hcl: ${hits.length} lines for ${key}`);
  return hits[0];
}

function jsonItem(exp, key) {
  return [...(exp?.names ?? []), ...(exp?.invalid ?? [])].find((x) => x.key === key);
}

/** 두 값이 다른 자리의 JSON pointer 목록 — 잎까지 내려간다 */
function diffPointers(a, b, path = '') {
  if (same(a, b)) return [];
  const bothObj = a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b);
  if (!bothObj) return [path];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap((k) => diffPointers(a[k], b[k], `${path}/${esc(k)}`));
}

const atPointer = (root, path) => path.split('/').slice(1).reduce((cur, t) => (cur === undefined || cur === null ? undefined : cur[t.replace(/~1/g, '/').replace(/~0/g, '~')]), root);

/** 허용 차분 줄 — 오라클 · 지금 스냅숏에서. 존 규칙 밖의 차이는 problems 로 돌려준다 */
export function deriveRows(oracle, actual) {
  const rows = [];
  const problems = [];
  for (const ch of ['wire', 'hcl', 'json']) {
    if (!same(Object.keys(oracle[ch]).sort(), Object.keys(actual[ch]).sort())) problems.push(`${ch}: sample ids differ`);
  }
  for (const sample of Object.keys(oracle.wire)) {
    const o = clone(oracle.wire[sample]);
    const a = clone(actual.wire[sample]);
    // 예외 ② — generate gcp 응답에 더한 규칙의 항목이 는다. 오라클에 이미 있거나 지금 출력에 없으면 문제다
    if (/^generate:[^:]+:gcp$/.test(sample) && a.status === 200) {
      for (const key of ADDED_TYPES) {
        const ov = wireItem(o.body, sample, key, true);
        const av = wireItem(a.body, sample, key, true);
        if (ov !== undefined || av === undefined) { problems.push(`wire ${sample} ${key}: the added rule is not a new item`); continue; }
        rows.push({ sample, key, kind: 'wire', old: null, new: av });
      }
    }
    const keys = zonalKeys(sample, o.body, a.body);
    for (const key of keys) {
      const ov = wireItem(o.body, sample, key, true);
      const av = wireItem(a.body, sample, key, true);
      if (!same(ov, av)) {
        // 항목 안에서도 바뀌어도 되는 칸은 이름 · 판정 · 단계 · 축소 · 종류 토큰뿐이다 — rule(notes 포함) · scope 등은 그대로여야 한다
        const bad = diffPointers(ov, av).filter((ptr) => !ITEM_FIELDS.has(ptr.split('/')[1]));
        if (ov === undefined || av === undefined || bad.length > 0) problems.push(`wire ${sample} ${key}: changed outside the name fields — ${bad.join(' ') || 'item added or removed'}`);
        rows.push({ sample, key, kind: 'wire', old: ov ?? null, new: av ?? null });
      }
      if (sample in oracle.hcl) {
        const oh = hclLine(oracle.hcl[sample], key);
        const ah = hclLine(actual.hcl[sample], key);
        if (oh !== ah) rows.push({ sample, key, kind: 'hcl', old: oh ?? null, new: ah ?? null });
      }
      if (sample in oracle.json) {
        const oj = jsonItem(oracle.json[sample], key);
        const aj = jsonItem(actual.json[sample], key);
        if (!same(oj, aj)) rows.push({ sample, key, kind: 'json', old: oj ?? null, new: aj ?? null });
      }
    }
    // 항목을 도려낸 나머지 — 허용하는 자리 둘만 줄로 만들고, 그 밖은 문제로 센다
    const seen = new Set();
    for (const ptr of diffPointers(o.body, a.body)) {
      const normSample = /^generate:[^:]+:gcp$/.test(sample) || sample.startsWith('names:');
      const tr = normSample ? /^\/metadata\/transformed\/(\d+)(\/|$)/.exec(ptr) : null;
      const sup = sample.startsWith('names-400:') && /^\/supported(\/|$)/.test(ptr);
      const site = tr ? `/metadata/transformed/${tr[1]}` : ptr === '/data/gcp/valid' && sample.startsWith('names:') ? ptr : sup ? '/supported' : undefined;
      if (!site) { problems.push(`wire ${sample} ${ptr} differs outside the zonal rules`); continue; }
      if (seen.has(site)) continue;
      seen.add(site);
      const ov = atPointer(oracle.wire[sample].body, site);
      const av = atPointer(actual.wire[sample].body, site);
      const isRegionNorm = (v) => v?.code === 'context.normalized' && v?.field === 'region';
      if (tr && (!isRegionNorm(ov) || !isRegionNorm(av))) {
        problems.push(`wire ${sample} ${site} is not a region normalisation entry`);
        continue;
      }
      if (sup) {
        const kept = Array.isArray(av) ? av.filter((t) => !ADDED_TYPES.includes(t)) : null;
        const added = Array.isArray(av) ? av.filter((t) => ADDED_TYPES.includes(t)).sort() : null;
        if (!same(kept, ov) || !same(added, [...ADDED_TYPES].sort())) { problems.push(`wire ${sample} /supported is not the old list plus the added rules`); continue; }
      }
      rows.push({ sample, path: site, old: ov ?? null, new: av ?? null });
    }
    if (o.status !== a.status) problems.push(`wire ${sample} status ${o.status} -> ${a.status}`);
  }
  // HCL · JSON 은 존 규칙 줄 · 항목을 지운 나머지가 글자 그대로 같아야 한다
  for (const sample of Object.keys(oracle.hcl)) {
    const keys = zonalKeys(sample, oracle.wire[sample].body, actual.wire[sample].body);
    const strip = (text) => text.split('\n').filter((l) => !keys.some((k) => l.startsWith(`  gcp_${k} = `) || l.startsWith(`  # INVALID: gcp_${k} — `))).join('\n');
    if (strip(oracle.hcl[sample]) !== strip(actual.hcl[sample])) problems.push(`hcl ${sample} differs outside the zonal rules`);
    const dropJ = (exp) => { const e = clone(exp); e.names = e.names.filter((x) => !keys.includes(x.key)); e.invalid = e.invalid.filter((x) => !keys.includes(x.key)); return e; };
    if (!same(dropJ(oracle.json[sample]), dropJ(actual.json[sample]))) problems.push(`json ${sample} differs outside the zonal rules`);
  }
  return { rows, problems };
}

function snapshotNow() {
  const dir = mkdtempSync(join(tmpdir(), 'oracle-diff-'));
  const file = join(dir, 'actual.json');
  try {
    // 시험이 아직 실패해도(허용 차분이 낡았을 때) 스냅숏은 쓰인다 — 종료 코드는 보지 않는다
    try {
      execFileSync('npx', ['vitest', 'run', 'src/core/wire-compat.test.ts'], { cwd: ROOT, env: { ...process.env, WIRE_COMPAT_DUMP: file }, stdio: 'ignore' });
    } catch { /* 위 주석 */ }
    return JSON.parse(readFileSync(file, 'utf-8'));
  } finally {
    try { unlinkSync(file); } catch { /* 없으면 위에서 이미 던졌다 */ }
    rmdirSync(dir);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const oracle = JSON.parse(readFileSync(ORACLE, 'utf-8'));
  const actual = snapshotNow();
  const { rows, problems } = deriveRows(oracle, actual);
  if (problems.length > 0) {
    console.error(`differences outside the allowed sites (${problems.length}):\n${problems.join('\n')}`);
    process.exit(1);
  }
  const text = `${JSON.stringify(rows, null, 2)}\n`;
  const count = (f) => rows.filter(f).length;
  const summary = `rows ${rows.length} — wire ${count((r) => r.kind === 'wire')} · hcl ${count((r) => r.kind === 'hcl')} · json ${count((r) => r.kind === 'json')} · path ${count((r) => 'path' in r)}`;
  if (!process.argv.includes('--write')) {
    const matches = readFileSync(ALLOWED, 'utf-8') === text;
    console.log(`${summary} — ${matches ? 'matches' : 'DIFFERS from'} wire-allowed-diff.json${process.argv.includes('--check') ? '' : ' (nothing written; pass --write to write)'}`);
    process.exit(matches || !process.argv.includes('--check') ? 0 : 1);
  }
  writeFileSync(ALLOWED, text);
  console.log(`${summary} — written to src/core/__fixtures__/wire-allowed-diff.json`);
}
