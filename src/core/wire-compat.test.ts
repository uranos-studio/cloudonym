// 호환 오라클 (D70) — 마법사 작업 전(0f47054)의 wire 응답 · Terraform locals · 이름 JSON 내보내기를 동결한 fixture 와 대어 본다.
// 허용 차분은 __fixtures__/wire-allowed-diff.json 에 적힌 줄뿐이다(T1 · T4 만 고친다). 그 밖은 글자 그대로 같아야 한다.
// fixture 를 다시 쓰는 길(환경변수 · 갱신 스크립트)은 두지 않는다 — 오라클을 고치는 것은 회귀를 숨기는 것이다.
// WIRE_COMPAT_DUMP 는 지금 출력을 fixture 밖 경로에만 내보낸다(scripts/oracle-diff.mjs 가 허용 차분 줄을 뽑는 데 쓴다) — 오라클 파일은 쓰지 않는다.
//
// 표본 id 꼴 — `generate:<기준선 id>:<provider>` · `names:<이름>` · `names-400:unknown-type`
// 정규화는 셋뿐이다 — wire 본문의 version.rules 삭제 · 내보내기 JSON 의 version.rules 삭제 · Terraform 머리 주석의 `rules ` 뒤 글자 → `<rules>`
//
// 운영의 HTTP 는 gcp 만 받는다(D45 — ENABLED_PROVIDERS). 세 CSP 의 /v1/generate(규칙 667)를 같은 라우터로 받으려고 이 파일에서만
// ENABLED_PROVIDERS 를 세 CSP 로 바꾼다 — 라우터 · 문맥 상한 · 직렬화를 그대로 지난다. 이 값은 provider 판정과 그 supported 목록에만 쓰인다.
// 바꾼 값이 풀리면(모듈이 옮겨지는 등) aws · azure 표본이 400 이 되어 시험이 크게 실패한다 — 조용히 통과하지 않는다
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { app } from '../api/index';
import { req, jsonPost } from '../api/test-support';
import { parseNamesBody } from '../api/schemas';
import { selectionTerraform } from '../components/terraform';
import { toNamesExport } from '../components/namesExport';
import { en } from '../messages/en';
import { VERSION } from '../version';
import { BASELINE_CONTEXTS, baselineProviders, baselineRaw, type BaselineContext } from './baseline-inputs';
import { generateMany } from './engine';
import { labelsFor } from './labels';
import { rulesFor } from './constraints';
import { ENABLED_PROVIDERS, PROVIDERS } from './types';

vi.mock('./types', async (importOriginal) => {
  const m = await importOriginal<typeof import('./types')>();
  return { ...m, ENABLED_PROVIDERS: m.PROVIDERS };
});

const FIXTURE_DIR = join(import.meta.dirname, '__fixtures__');
/** 오라클을 만든 엔진 버전 — 동결 값이다. 지금 VERSION 을 읽지 않는다 */
const ORACLE_ENGINE = '0.1.0';

/** 동결된 옛 입력 id — 0f47054 의 BASELINE_CONTEXTS 22개. 뒤 Task 가 baseline-inputs.ts 에 표본을 더해도 오라클은 이 목록 그대로다 */
const LEGACY_BASELINE_IDS: readonly string[] = [
  'base', 'hangul-owner', 'space-quote-combining-owner', 'alias-env-region', 'reserved-windows', 'reserved-google', 'reserved-azure',
  'empty-after-normalize', 'long-values', 'shrink-fail', 'digit-first-system', 'label-gcp-65', 'label-aws-257', 'label-aws-invalid-char',
  'label-gcp-transform', 'parse-env-qa', 'parse-region-mars', 'region-country-kr', 'region-zone', 'parse-owner-empty', 'parse-owner-number',
  'parse-missing-all',
];

const BASE = { owner: 'platform', system: 'billing', purpose: 'trade', env: 'prod' };
const LONG = { owner: 'platformengineering', system: 'paymentsettlement', purpose: 'reconciliation', env: 'dev' };
const ZONE = 'asia-northeast3-a';
const REGION = 'asia-northeast3';
/** 존 규칙 14종 — 0f47054 의 catalog 에서 regionToken 이 zone 인 규칙. 실행 때 catalog 에서 고르지 않는다(T1 이 그 값을 바꾼다) */
const ZONE_RULES = [
  'compute_instance', 'disk', 'autoscaler', 'future_reservation', 'instance_group_manager', 'instance_group', 'instant_snapshot_group',
  'instant_snapshot', 'reservation', 'storage_pool', 'target_instance', 'zone_vm_extension_policy', 'node_group', 'network_endpoint_group',
] as const;
/** T4(D65)가 더한 규칙 — Cloud Run 서비스. 이 규칙의 항목 꼴 줄은 generate:*:gcp 표본의 wire 추가(old null)만 받는다 */
const T4_ADDED_TYPES: readonly string[] = ['run_service'];
/** T4(D65) — names-400 표본의 /supported 경로 줄을 받는다. 새 목록은 옛 목록에 T4_ADDED_TYPES 만 더한 것이어야 한다 */
const T4_SUPPORTED_PATH = true;
const zoneRuleItems = () => ZONE_RULES.map((type) => (type === 'network_endpoint_group' ? { type, kind: 'GCE_VM_IP' } : { type }));
const MIXED = [
  { type: 'compute_instance', count: 2 }, { type: 'disk', count: 2 }, { type: 'subnet', count: 2 }, { type: 'service_account', role: 'db' },
  { type: 'project_id' }, { type: 'storage_bucket' }, { type: 'firewall_rule' },
];
const SHRINK = [
  { type: 'service_account' }, { type: 'compute_instance', count: 2 }, { type: 'disk' }, { type: 'subnet' }, { type: 'storage_bucket' },
  { type: 'project_id' }, { type: 'cloud_sql_instance', kind: 'POSTGRES' },
];

/** /v1/names 표본 12 — 존 있음 · 존 없음 · 존 규칙 14종 · 긴 입력의 축소 경로 · 역할 · 종류 · 항목 FAIL · 정제 · 라벨 무효 */
const NAMES_SAMPLES: readonly { id: string; body: { provider: 'gcp'; context: Record<string, unknown>; resources: unknown[] } }[] = [
  { id: 'zone-mixed', body: { provider: 'gcp', context: { ...BASE, region: ZONE }, resources: MIXED } },
  { id: 'region-mixed', body: { provider: 'gcp', context: { ...BASE, region: REGION }, resources: MIXED } },
  { id: 'zone-rules-zone', body: { provider: 'gcp', context: { ...BASE, region: ZONE }, resources: zoneRuleItems() } },
  { id: 'zone-rules-region', body: { provider: 'gcp', context: { ...BASE, region: REGION }, resources: zoneRuleItems() } },
  { id: 'shrink-zone', body: { provider: 'gcp', context: { ...LONG, region: ZONE }, resources: SHRINK } },
  { id: 'shrink-region', body: { provider: 'gcp', context: { ...LONG, region: REGION }, resources: SHRINK } },
  { id: 'role', body: { provider: 'gcp', context: { ...BASE, region: ZONE }, resources: [{ type: 'service_account', role: 'web' }, { type: 'compute_instance' }] } },
  { id: 'kinds-region', body: { provider: 'gcp', context: { ...BASE, region: REGION }, resources: [
    { type: 'cloud_sql_instance', count: 2, kind: 'POSTGRES' }, { type: 'resource_policy', kind: 'snapshot-schedule' },
    { type: 'backend_service', kind: 'EXTERNAL_MANAGED' }, { type: 'region_backend_service', kind: 'INTERNAL_MANAGED' },
    { type: 'region_network_endpoint_group', kind: 'SERVERLESS' }, { type: 'subnet', kind: 'REGIONAL_MANAGED_PROXY' },
    { type: 'health_check', kind: 'grpc-with-tls' }, { type: 'firewall_rule', kind: 'INGRESS' },
  ] } },
  { id: 'kinds-zone', body: { provider: 'gcp', context: { ...BASE, region: ZONE }, resources: [
    { type: 'network_endpoint_group', count: 2, kind: 'GCE_VM_IP' }, { type: 'cloud_sql_instance', kind: 'MYSQL' },
    { type: 'firewall_rule', kind: 'EGRESS' }, { type: 'compute_instance', count: 3 },
  ] } },
  { id: 'reserved-goog', body: { provider: 'gcp', context: { ...BASE, owner: 'goog', region: ZONE }, resources: [
    { type: 'storage_bucket' }, { type: 'compute_instance', count: 2 }, { type: 'project_id' },
  ] } },
  { id: 'transform-alias', body: { provider: 'gcp', context: { ...BASE, owner: ' Team "A" café ', env: 'production', region: 'Asia-Northeast3-A' }, resources: [
    { type: 'compute_instance' }, { type: 'storage_bucket' }, { type: 'service_account' }, { type: 'project_id' },
  ] } },
  { id: 'label-invalid', body: { provider: 'gcp', context: { ...BASE, owner: 'o'.repeat(64), region: ZONE }, resources: [
    { type: 'compute_instance' }, { type: 'disk' }, { type: 'project_id' },
  ] } },
];
/** 음성 요청 — 모르는 type → 400 + supported(gcp 규칙 전부). T4 의 run_service 는 이 목록에 한 줄을 더한다(예외 ②) */
const NEGATIVE_NAMES = { provider: 'gcp', context: { ...BASE, region: REGION }, resources: [{ type: 'no_such_type' }] };

interface Snapshot { wire: Record<string, { status: number; body: any }>; hcl: Record<string, string>; json: Record<string, any> }
type ItemDiff = { sample: string; key: string; kind: 'wire' | 'hcl' | 'json'; old: unknown; new: unknown };
type PathDiff = { sample: string; path: string; old: unknown; new: unknown };
type AllowedDiff = ItemDiff | PathDiff;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const RULES_HEADER = /^(# Generated by Cloudonym — engine \S+ · rules )(\S+)$/m;

function normWire(r: { status: number; body: any }): { status: number; body: any } {
  const out = clone(r);
  if (out.body && typeof out.body === 'object' && out.body.version && typeof out.body.version === 'object') delete out.body.version.rules;
  return out;
}
const normHcl = (hcl: string): string => hcl.replace(RULES_HEADER, '$1<rules>');
function normJson(exp: unknown): any {
  const out = clone(exp) as any;
  delete out.version.rules;
  return out;
}

async function httpPost(path: string, body: unknown): Promise<{ status: number; body: any }> {
  const { res } = await req(app, path, jsonPost(body));
  return { status: res.status, body: JSON.parse(await res.text()) };
}

function legacyContexts(): BaselineContext[] {
  return LEGACY_BASELINE_IDS.map((id) => {
    const c = BASELINE_CONTEXTS.find((x) => x.id === id);
    if (!c) throw new Error(`legacy baseline id ${id} is gone from BASELINE_CONTEXTS`);
    return c;
  });
}

/** 지금 코드의 출력 — 정규화까지 */
async function buildSnapshot(): Promise<Snapshot> {
  const snap: Snapshot = { wire: {}, hcl: {}, json: {} };
  for (const c of legacyContexts()) {
    for (const p of baselineProviders(c)) {
      const raw = baselineRaw(c, p) as Record<string, unknown>;
      snap.wire[`generate:${c.id}:${p}`] = normWire(await httpPost('/v1/generate', { context: raw, providers: [p] }));
    }
  }
  for (const s of NAMES_SAMPLES) {
    const id = `names:${s.id}`;
    snap.wire[id] = normWire(await httpPost('/v1/names', s.body));
    // 화면(NamesPanel)과 같은 길 — Terraform 버튼 · 이름 JSON 버튼
    const parsed = parseNamesBody(clone(s.body));
    if (!parsed.ok) throw new Error(`names sample ${s.id} does not parse: ${JSON.stringify(parsed.rejection.errors)}`);
    const { context, items } = parsed.value;
    const many = generateMany(context, 'gcp', items);
    snap.hcl[id] = normHcl(selectionTerraform('gcp', many, labelsFor(context, 'gcp'), VERSION, en));
    snap.json[id] = normJson(JSON.parse(JSON.stringify(toNamesExport(many, context, VERSION, items), null, 2)));
  }
  snap.wire['names-400:unknown-type'] = normWire(await httpPost('/v1/names', NEGATIVE_NAMES));
  return snap;
}

// ---------- 검사기 — 허용 차분을 양쪽에서 도려낸 뒤 나머지가 같아야 한다 ----------

const isPathDiff = (d: AllowedDiff): d is PathDiff => 'path' in d;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const absent = (v: unknown) => v === null || v === undefined;

/** 허용 차분 파일의 문법 — 항목 꼴 { sample, key, kind, old, new } · 경로 꼴 { sample, path, old, new } */
function grammarProblems(diffs: unknown): string[] {
  if (!Array.isArray(diffs)) return ['allowed diff file is not an array'];
  return diffs.flatMap((d, i): string[] => {
    if (d === null || typeof d !== 'object' || Array.isArray(d)) return [`[${i}] is not an object`];
    const keys = Object.keys(d).sort().join(',');
    const o = d as Record<string, unknown>;
    if (typeof o.sample !== 'string') return [`[${i}] sample is not a string`];
    if (keys === 'new,old,path,sample') return typeof o.path === 'string' && o.path.startsWith('/') ? [] : [`[${i}] path is not a JSON pointer`];
    if (keys === 'key,kind,new,old,sample') {
      if (typeof o.key !== 'string' || o.key === '') return [`[${i}] key is not a string`];
      return o.kind === 'wire' || o.kind === 'hcl' || o.kind === 'json' ? [] : [`[${i}] kind is not wire | hcl | json`];
    }
    return [`[${i}] has keys ${keys} — expected sample,key,kind,old,new or sample,path,old,new`];
  });
}

function pointerTokens(path: string): string[] {
  return path.split('/').slice(1).map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'));
}
/** JSON pointer 자리의 부모와 마지막 토큰 — 중간이 없으면 undefined */
function pointerParent(root: any, path: string): { parent: any; last: string } | undefined {
  const toks = pointerTokens(path);
  let cur = root;
  for (const t of toks.slice(0, -1)) {
    if (cur === null || typeof cur !== 'object' || !(t in cur)) return undefined;
    cur = cur[t];
  }
  return cur !== null && typeof cur === 'object' ? { parent: cur, last: toks[toks.length - 1]! } : undefined;
}

/** 한 자리의 값 읽기 · 도려내기 — 표본의 그 채널(wire · hcl · json) 안에서 */
interface Site { get: () => unknown; cut: () => void }

function wireItemSite(snap: Snapshot, sample: string, key: string): Site {
  const body = snap.wire[sample]?.body;
  if (sample.startsWith('generate:')) {
    const p = sample.split(':')[2]!;
    const map = body?.data?.[p];
    return { get: () => (map && key in map ? map[key] : undefined), cut: () => { if (map) delete map[key]; } };
  }
  const items: any[] | undefined = body?.data?.gcp?.items;
  return {
    get: () => items?.find((x) => x.key === key),
    cut: () => { const i = items?.findIndex((x) => x.key === key) ?? -1; if (i >= 0) items!.splice(i, 1); },
  };
}

function hclLineIndex(lines: string[], key: string): number[] {
  const ident = `gcp_${key}`;
  return lines.flatMap((l, i) => (l.startsWith(`  ${ident} = `) || l.startsWith(`  # INVALID: ${ident} — `) ? [i] : []));
}
function hclItemSite(snap: Snapshot, sample: string, key: string): Site {
  return {
    get: () => {
      const text = snap.hcl[sample];
      if (text === undefined) return undefined;
      const lines = text.split('\n');
      const at = hclLineIndex(lines, key);
      return at.length === 1 ? lines[at[0]!] : at.length === 0 ? undefined : `<${at.length} lines>`;
    },
    cut: () => {
      const text = snap.hcl[sample];
      if (text === undefined) return;
      const lines = text.split('\n');
      for (const i of hclLineIndex(lines, key).reverse()) lines.splice(i, 1);
      snap.hcl[sample] = lines.join('\n');
    },
  };
}

function jsonItemSite(snap: Snapshot, sample: string, key: string): Site {
  const exp = snap.json[sample];
  const lists = (): any[][] => (exp ? [exp.names, exp.invalid] : []);
  return {
    get: () => lists().flatMap((l) => l.filter((x) => x.key === key)).at(0),
    cut: () => { for (const l of lists()) { const i = l.findIndex((x) => x.key === key); if (i >= 0) l.splice(i, 1); } },
  };
}

const SENTINEL = '<allowed-diff>';
function pathSite(snap: Snapshot, sample: string, path: string): Site {
  const loc = () => pointerParent(snap.wire[sample]?.body, path);
  return {
    get: () => { const l = loc(); return l && l.last in l.parent ? l.parent[l.last] : undefined; },
    cut: () => {
      const l = loc();
      if (!l || !(l.last in l.parent)) return;
      // 배열 자리는 지우면 뒤 번호가 당겨진다 — 표지 값으로 바꾼다. 객체 자리는 지운다(한쪽에만 있는 키 · T4 의 추가)
      if (Array.isArray(l.parent)) l.parent[Number(l.last)] = SENTINEL; else delete l.parent[l.last];
    },
  };
}

function siteOf(snap: Snapshot, d: AllowedDiff): Site {
  if (isPathDiff(d)) return pathSite(snap, d.sample, d.path);
  if (d.kind === 'wire') return wireItemSite(snap, d.sample, d.key);
  if (d.kind === 'hcl') return hclItemSite(snap, d.sample, d.key);
  return jsonItemSite(snap, d.sample, d.key);
}

const label = (d: AllowedDiff) => (isPathDiff(d) ? `${d.sample} ${d.path}` : `${d.sample} ${d.kind} ${d.key}`);

/** 오라클과 지금 출력의 차이 — 빈 배열이면 통과. 허용 차분은 ① 오라클 자리 = old ② 지금 자리 = new ③ old ≠ new 를 지켜야 하고, 도려낸 뒤 나머지는 글자 그대로 같아야 한다 */
function compareSnapshots(oracleIn: Snapshot, actualIn: Snapshot, diffs: AllowedDiff[]): string[] {
  const oracle = clone(oracleIn);
  const actual = clone(actualIn);
  const problems: string[] = [];
  for (const ch of ['wire', 'hcl', 'json'] as const) {
    const a = Object.keys(oracle[ch]).sort();
    const b = Object.keys(actual[ch]).sort();
    if (!same(a, b)) problems.push(`${ch}: sample ids differ — oracle ${a.length} · actual ${b.length}`);
  }
  for (const d of diffs) {
    const ch = isPathDiff(d) ? 'wire' : d.kind;
    if (!(d.sample in oracle[ch])) { problems.push(`allowed diff ${label(d)}: no such sample in the oracle`); continue; }
    const o = siteOf(oracle, d).get();
    const n = siteOf(actual, d).get();
    if (absent(d.old) ? o !== undefined : !same(o, d.old)) problems.push(`allowed diff ${label(d)}: oracle value is not "old"`);
    if (absent(d.new) ? n !== undefined : !same(n, d.new)) problems.push(`allowed diff ${label(d)}: actual value is not "new"`);
    if (same(d.old, d.new)) problems.push(`allowed diff ${label(d)}: old equals new — the entry allows nothing`);
  }
  for (const d of diffs) { siteOf(oracle, d).cut(); siteOf(actual, d).cut(); }
  for (const id of Object.keys(oracle.wire)) if (id in actual.wire && !same(oracle.wire[id], actual.wire[id])) problems.push(`wire ${id} differs`);
  for (const id of Object.keys(oracle.hcl)) if (id in actual.hcl && oracle.hcl[id] !== actual.hcl[id]) problems.push(`hcl ${id} differs`);
  for (const id of Object.keys(oracle.json)) if (id in actual.json && !same(oracle.json[id], actual.json[id])) problems.push(`json ${id} differs`);
  return problems;
}

/** 허용 차분의 범위 (D70 예외 ① · ②) — 항목 꼴 줄은 존 규칙 14종(또는 T4 의 추가 규칙)의 항목만,
 *  경로 꼴 줄은 지역 정규화 기록(generate:*:gcp · names:*) · names 의 전체 판정 /data/gcp/valid · (T4) /supported 만 */
function resourceTypeOf(snap: Snapshot, sample: string, key: string): string | undefined {
  const body = snap.wire[sample]?.body;
  if (sample.startsWith('generate:')) return body?.data?.[sample.split(':')[2]!]?.[key] === undefined ? undefined : key;
  return (body?.data?.gcp?.items as any[] | undefined)?.find((x) => x.key === key)?.resource_type;
}
function scopeProblems(diffs: AllowedDiff[], oracle: Snapshot, actual: Snapshot): string[] {
  const allowedTypes = new Set<string>([...ZONE_RULES, ...T4_ADDED_TYPES]);
  return diffs.flatMap((d): string[] => {
    if (isPathDiff(d)) {
      const normSample = /^generate:[^:]+:gcp$/.test(d.sample) || d.sample.startsWith('names:');
      if (/^\/metadata\/transformed\/\d+(\/params\/to|\/message)?$/.test(d.path) && normSample) return [];
      if (d.path === '/data/gcp/valid' && d.sample.startsWith('names:')) return [];
      if (T4_SUPPORTED_PATH && d.path === '/supported' && d.sample.startsWith('names-400:')) {
        // 예외 ② — 옛 목록의 순서를 지킨 채 추가 규칙만 끼어든다
        const ok = Array.isArray(d.old) && Array.isArray(d.new)
          && JSON.stringify((d.new as unknown[]).filter((t) => !T4_ADDED_TYPES.includes(t as string))) === JSON.stringify(d.old)
          && JSON.stringify((d.new as unknown[]).filter((t) => T4_ADDED_TYPES.includes(t as string)).sort()) === JSON.stringify([...T4_ADDED_TYPES].sort());
        return ok ? [] : [`path ${d.sample} ${d.path}: new is not old plus the added rules`];
      }
      return [`path ${d.sample} ${d.path} is outside the allowed sites`];
    }
    if (d.sample.startsWith('generate:') && !d.sample.endsWith(':gcp')) return [`${label(d)}: not a gcp sample`];
    // 오라클의 resource_type 으로 — 오라클에 없는 항목(추가)은 지금 출력에서 찾는다
    const type = resourceTypeOf(oracle, d.sample, d.key) ?? resourceTypeOf(actual, d.sample, d.key);
    if (type !== undefined && T4_ADDED_TYPES.includes(type)) {
      // 예외 ② — generate 응답에 항목 하나가 는다. 그 밖(names 표본 · HCL · JSON · 옛 값이 있는 줄)은 받지 않는다
      return /^generate:[^:]+:gcp$/.test(d.sample) && d.kind === 'wire' && d.old === null ? [] : [`${label(d)}: an added rule is allowed only as a new wire item of a generate gcp sample`];
    }
    return type !== undefined && allowedTypes.has(type) ? [] : [`${label(d)}: resource type ${type ?? '?'} is not one of the 14 zonal rules`];
  });
}

const readJson = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf-8'));

/** 지금 출력을 파일로 내보낸다 — scripts/oracle-diff.mjs 가 허용 차분 줄을 뽑을 때만 쓴다.
 *  OS 임시 폴더 아래만 받는다(실경로로 비교) — 저장소 안, 특히 오라클 fixture 에는 쓸 수 없다 */
function dumpActual(actual: Snapshot): void {
  const target = process.env.WIRE_COMPAT_DUMP;
  if (!target) return;
  const tmp = realpathSync(tmpdir());
  if (!realpathSync(dirname(target)).startsWith(tmp + sep)) throw new Error('WIRE_COMPAT_DUMP must be a file under the OS temp directory');
  writeFileSync(target, JSON.stringify(actual));
}

describe('호환 오라클 (D70) — 마법사 작업 전 출력과 같다', async () => {
  const oracle = readJson('wire-before-wizard.json') as Snapshot;
  const diffs = readJson('wire-allowed-diff.json');
  const actual = await buildSnapshot();
  dumpActual(actual);

  it('동결 목록 — fixture 의 기준선 id 집합 = LEGACY_BASELINE_IDS(22) · 그 id 가 모두 BASELINE_CONTEXTS 에 남아 있다', () => {
    expect(LEGACY_BASELINE_IDS).toHaveLength(22);
    const ids = new Set(Object.keys(oracle.wire).filter((k) => k.startsWith('generate:')).map((k) => k.split(':')[1]));
    expect([...ids].sort()).toEqual([...LEGACY_BASELINE_IDS].sort());
    const now = new Set(BASELINE_CONTEXTS.map((c) => c.id));
    expect(LEGACY_BASELINE_IDS.filter((id) => !now.has(id))).toEqual([]);
  });

  it('표본이 계약대로다 — generate 세 CSP 전 규칙 667 · names 12 · 음성 400 의 supported 121', () => {
    const base = ['gcp', 'aws', 'azure'].map((p) => Object.keys(oracle.wire[`generate:base:${p}`]!.body.data[p]).length);
    expect(base.reduce((s, n) => s + n, 0)).toBe(667);
    expect(Object.keys(oracle.wire).filter((k) => k.startsWith('names:'))).toHaveLength(12);
    expect(Object.keys(oracle.hcl)).toHaveLength(12);
    expect(Object.keys(oracle.json)).toHaveLength(12);
    for (const id of Object.keys(oracle.wire).filter((k) => k.startsWith('names:'))) expect(oracle.wire[id]!.status, id).toBe(200);
    const neg = oracle.wire['names-400:unknown-type']!;
    expect(neg.status).toBe(400);
    expect(neg.body.supported).toHaveLength(121);
  });

  it('표본이 덮는다 — 존 있음(ane3a) · 존 없음(name.zone_required · # INVALID · invalid[]) · 역할 · 종류 · 축소', () => {
    const items = (id: string): any[] => oracle.wire[`names:${id}`]!.body.data.gcp.items;
    expect(items('zone-mixed').find((i) => i.key === 'compute_instance_01').name).toContain('-ane3a-');
    expect(oracle.wire['names:zone-mixed']!.body.metadata.transformed.some((t: any) => t.params?.to === 'ane3a')).toBe(true);
    const zr = items('region-mixed').find((i) => i.key === 'compute_instance_01');
    expect(zr.valid).toBe(false);
    expect(zr.violations.map((v: any) => v.code)).toContain('name.zone_required');
    expect(oracle.hcl['names:region-mixed']).toContain('  # INVALID: gcp_compute_instance_01 — ');
    expect(oracle.json['names:region-mixed'].invalid.map((i: any) => i.key)).toContain('compute_instance_01');
    expect(items('role').some((i) => i.role === 'web')).toBe(true);
    expect(items('kinds-zone').some((i) => i.kind === 'GCE_VM_IP')).toBe(true);
    expect(items('shrink-region').some((i) => i.is_truncated)).toBe(true);
    expect(items('zone-rules-zone').map((i) => i.resource_type).sort()).toEqual([...ZONE_RULES].sort());
  });

  it('정규화가 실제로 걸렸다 — HCL 머리의 rules 자리만 <rules> · engine 은 그대로 · wire · JSON 에 version.rules 없음', () => {
    for (const [id, hcl] of Object.entries(oracle.hcl)) {
      expect(hcl.split('\n')[0], id).toBe(`# Generated by Cloudonym — engine ${ORACLE_ENGINE} · rules <rules>`);
    }
    for (const [id, r] of Object.entries(oracle.wire)) if (r.body.version) expect(Object.keys(r.body.version), id).toEqual(['engine']);
    for (const [id, j] of Object.entries(oracle.json)) expect(j.version, id).toEqual({ engine: ORACLE_ENGINE });
    expect(JSON.stringify(oracle)).not.toContain(VERSION.rules);
  });

  it('세 CSP 를 연 것은 이 파일뿐이다 — 운영 값은 gcp 하나', async () => {
    const real = await vi.importActual<typeof import('./types')>('./types');
    expect(real.ENABLED_PROVIDERS).toEqual(['gcp']);
    expect(ENABLED_PROVIDERS).toEqual(PROVIDERS);
  });

  it('음성 요청의 supported 는 gcp 규칙 표 순서 그대로다', () => {
    expect(actual.wire['names-400:unknown-type']!.body.supported).toEqual(rulesFor('gcp').map((r) => r.resourceType));
  });

  it('허용 차분 파일의 문법이 맞다', () => {
    expect(grammarProblems(diffs)).toEqual([]);
  });

  it('허용 차분의 범위 — 항목 꼴은 존 규칙 14종(오라클의 resource_type)의 항목만 · 경로 꼴은 지역 정규화 · names 의 /data/gcp/valid 만', () => {
    expect(scopeProblems(diffs as AllowedDiff[], oracle, actual)).toEqual([]);
  });

  it('예외 ② 의 줄은 정확히 15 — generate gcp 표본 14 의 run_service 항목 추가 · names-400 의 supported 한 줄', () => {
    const rows = diffs as AllowedDiff[];
    const t4 = rows.filter((d) => isPathDiff(d) ? d.path === '/supported' : T4_ADDED_TYPES.includes(d.key));
    const gcpGenerate = Object.keys(oracle.wire).filter((k) => /^generate:[^:]+:gcp$/.test(k) && oracle.wire[k]!.status === 200);
    expect(gcpGenerate).toHaveLength(14);
    expect(t4.filter((d) => !isPathDiff(d)).map((d) => d.sample).sort()).toEqual(gcpGenerate.sort());
    expect(t4.filter((d) => isPathDiff(d)).map((d) => d.sample)).toEqual(['names-400:unknown-type']);
    expect(t4).toHaveLength(15);
  });

  it('wire · HCL · JSON 셋 모두 — 허용 차분을 뺀 나머지가 오라클과 같다', () => {
    expect(compareSnapshots(oracle, actual, diffs as AllowedDiff[])).toEqual([]);
  });
});

describe('검사기 자체 — 잡아야 할 것을 잡는다', async () => {
  const oracle = readJson('wire-before-wizard.json') as Snapshot;
  const mutate = (f: (s: Snapshot) => void): Snapshot => { const s = clone(oracle); f(s); return s; };

  it('같으면 통과', () => {
    expect(compareSnapshots(oracle, clone(oracle), [])).toEqual([]);
  });
  it('wire 이름 한 글자 · HCL 한 글자 · JSON 한 글자 — 각각 실패', () => {
    const a = mutate((s) => { const it0 = s.wire['names:zone-mixed']!.body.data.gcp.items[0]; it0.name = `${it0.name}x`; });
    expect(compareSnapshots(oracle, a, [])).toEqual(['wire names:zone-mixed differs']);
    const b = mutate((s) => { s.hcl['names:role'] = s.hcl['names:role']!.replace('platform', 'platforn'); });
    expect(compareSnapshots(oracle, b, [])).toEqual(['hcl names:role differs']);
    const c = mutate((s) => { s.json['names:kinds-region'].names[0].name += 'x'; });
    expect(compareSnapshots(oracle, c, [])).toEqual(['json names:kinds-region differs']);
  });
  it('HCL 머리의 엔진 버전만 바뀌어도 실패 — rules 자리 밖은 정규화하지 않는다', () => {
    const a = mutate((s) => { s.hcl['names:zone-mixed'] = s.hcl['names:zone-mixed']!.replace(`engine ${ORACLE_ENGINE}`, 'engine 9.9.9'); });
    expect(compareSnapshots(oracle, a, [])).toEqual(['hcl names:zone-mixed differs']);
    expect(normHcl('# Generated by Cloudonym — engine 0.1.0 · rules 2099-01-01.1\nlocals {')).toBe('# Generated by Cloudonym — engine 0.1.0 · rules <rules>\nlocals {');
  });
  it('적힌 차분은 통과 · 적히지 않은 차분이 함께 있으면 실패 · 낡은 old 와 쓰이지 않는 줄도 실패', () => {
    const items = oracle.wire['names:zone-mixed']!.body.data.gcp.items;
    const oldItem = items.find((i: any) => i.key === 'compute_instance_01');
    const newItem = { ...oldItem, name: oldItem.name.replace('-ane3a-', '-ane3-') };
    const actual = mutate((s) => { const l = s.wire['names:zone-mixed']!.body.data.gcp.items; l[l.findIndex((i: any) => i.key === 'compute_instance_01')] = newItem; });
    const row: AllowedDiff = { sample: 'names:zone-mixed', key: 'compute_instance_01', kind: 'wire', old: oldItem, new: newItem };
    expect(compareSnapshots(oracle, actual, [row])).toEqual([]);
    const both = mutate((s) => {
      const l = s.wire['names:zone-mixed']!.body.data.gcp.items; l[l.findIndex((i: any) => i.key === 'compute_instance_01')] = newItem;
      l.find((i: any) => i.key === 'disk_01').name += 'x';
    });
    expect(compareSnapshots(oracle, both, [row])).toEqual(['wire names:zone-mixed differs']);
    expect(compareSnapshots(oracle, actual, [{ ...row, old: newItem }])).toEqual(['allowed diff names:zone-mixed wire compute_instance_01: oracle value is not "old"', 'allowed diff names:zone-mixed wire compute_instance_01: old equals new — the entry allows nothing']);
    expect(compareSnapshots(oracle, clone(oracle), [row])).toEqual(['allowed diff names:zone-mixed wire compute_instance_01: actual value is not "new"']);
  });
  it('경로 꼴 · 추가(old null) — T4 의 supported 한 줄과 generate 항목 하나가 이 꼴로 통과한다', () => {
    const sup: string[] = oracle.wire['names-400:unknown-type']!.body.supported;
    const added = { name: 'x', valid: true };
    const actual = mutate((s) => {
      s.wire['names-400:unknown-type']!.body.supported = [...sup, 'run_service'];
      s.wire['generate:base:gcp']!.body.data.gcp.run_service = added;
    });
    const rows: AllowedDiff[] = [
      { sample: 'names-400:unknown-type', path: '/supported', old: sup, new: [...sup, 'run_service'] },
      { sample: 'generate:base:gcp', key: 'run_service', kind: 'wire', old: null, new: added },
    ];
    expect(compareSnapshots(oracle, actual, rows)).toEqual([]);
    expect(compareSnapshots(oracle, actual, rows.slice(0, 1))).toEqual(['wire generate:base:gcp differs']);
  });
  it('HCL · JSON 항목 꼴 — 그 항목의 한 줄 · 그 항목 객체만 도려낸다', () => {
    const hcl = oracle.hcl['names:zone-mixed']!;
    const line = hcl.split('\n').find((l) => l.startsWith('  gcp_compute_instance_01 = '))!;
    const newLine = line.replace('-ane3a-', '-ane3-');
    const exp = oracle.json['names:zone-mixed'];
    const oldEntry = exp.names.find((n: any) => n.key === 'compute_instance_01');
    const newEntry = { ...oldEntry, name: oldEntry.name.replace('-ane3a-', '-ane3-') };
    const actual = mutate((s) => {
      s.hcl['names:zone-mixed'] = hcl.replace(line, newLine);
      s.json['names:zone-mixed'].names = exp.names.map((n: any) => (n.key === 'compute_instance_01' ? newEntry : n));
    });
    const rows: AllowedDiff[] = [
      { sample: 'names:zone-mixed', key: 'compute_instance_01', kind: 'hcl', old: line, new: newLine },
      { sample: 'names:zone-mixed', key: 'compute_instance_01', kind: 'json', old: oldEntry, new: newEntry },
    ];
    expect(compareSnapshots(oracle, actual, rows)).toEqual([]);
    expect(compareSnapshots(oracle, actual, rows.slice(1))).toEqual(['hcl names:zone-mixed differs']);
  });
  it('범위 검사기 — 존 규칙 밖 항목 · 허용 밖 경로 · 표본이 맞지 않는 경로를 잡는다', () => {
    const ok: AllowedDiff[] = [
      { sample: 'names:zone-mixed', key: 'compute_instance_01', kind: 'hcl', old: 'a', new: 'b' },
      { sample: 'generate:base:gcp', key: 'disk', kind: 'wire', old: 1, new: 2 },
      { sample: 'names:zone-mixed', path: '/metadata/transformed/0', old: 1, new: 2 },
      { sample: 'generate:region-zone:gcp', path: '/metadata/transformed/0/params/to', old: 1, new: 2 },
      { sample: 'names:region-mixed', path: '/data/gcp/valid', old: false, new: true },
      { sample: 'names-400:unknown-type', path: '/supported', old: ['a', 'b'], new: ['a', 'run_service', 'b'] },
      { sample: 'generate:base:gcp', key: 'run_service', kind: 'wire', old: null, new: { name: 'x' } },
    ];
    const actual = mutate((s) => { s.wire['generate:base:gcp']!.body.data.gcp.run_service = { name: 'x' }; });
    expect(scopeProblems(ok, oracle, actual)).toEqual([]);
    expect(scopeProblems([
      { sample: 'names:zone-mixed', key: 'subnet_01', kind: 'wire', old: 1, new: 2 },
      { sample: 'generate:base:gcp', key: 'subnet', kind: 'json', old: 1, new: 2 },
      { sample: 'generate:base:aws', key: 'disk', kind: 'wire', old: 1, new: 2 },
      { sample: 'generate:base:gcp', path: '/data/gcp/valid', old: 1, new: 2 },
      { sample: 'generate:base:aws', path: '/metadata/transformed/0', old: 1, new: 2 },
      { sample: 'names-400:unknown-type', path: '/supported', old: 1, new: 2 },
      { sample: 'names:zone-mixed', path: '/metadata/transformed/0/params/from', old: 1, new: 2 },
      // 예외 ② 의 범위 밖 — 다른 표본의 supported · 다른 글자가 끼어든 목록 · 순서가 바뀐 목록 · 추가 규칙의 HCL 줄 · 옛 값이 있는 줄 · 다른 CSP
      { sample: 'names:zone-mixed', path: '/supported', old: ['a'], new: ['a', 'run_service'] },
      { sample: 'names-400:unknown-type', path: '/supported', old: ['a'], new: ['a', 'run_service', 'x'] },
      { sample: 'names-400:unknown-type', path: '/supported', old: ['a', 'b'], new: ['b', 'a', 'run_service'] },
      { sample: 'generate:base:gcp', key: 'run_service', kind: 'hcl', old: null, new: 'x' },
      { sample: 'generate:base:gcp', key: 'run_service', kind: 'wire', old: { name: 'y' }, new: { name: 'x' } },
      { sample: 'generate:base:aws', key: 'run_service', kind: 'wire', old: null, new: { name: 'x' } },
    ], oracle, actual)).toHaveLength(13);
  });
  it('문법 검사기 — 두 꼴만 받는다', () => {
    expect(grammarProblems([])).toEqual([]);
    expect(grammarProblems({})).toEqual(['allowed diff file is not an array']);
    expect(grammarProblems([{ sample: 's', key: 'k', kind: 'yaml', old: 1, new: 2 }])).toEqual(['[0] kind is not wire | hcl | json']);
    expect(grammarProblems([{ sample: 's', path: 'supported', old: 1, new: 2 }])).toEqual(['[0] path is not a JSON pointer']);
    expect(grammarProblems([{ sample: 's', key: 'k', old: 1, new: 2 }])).toHaveLength(1);
  });
});
