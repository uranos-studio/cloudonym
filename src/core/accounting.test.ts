// 변경 회계 — 이름 체계를 바꾸는 0.1.0 작업 동안, 바뀐 출력 하나하나가 기대 차분 파일에 적힌 원인으로만 설명되는지 센다.
// 옛 출력(outputs-before-v0.1.0.json)은 2026-10-07 규칙 버전 2026-10-07.2 의 엔진이 낸 것이고 다시 쓰지 않는다.
// 옛 원시 입력(env 'prd' · region 'kr')은 새 엔진에서 받지 않게 되므로, 고정 이전 매핑(MIGRATION)을 적용한 입력을 새 엔진에 넣어 대어 본다.
// 판정 — ① 옛 출력과 다른데 기대 차분에 없다 ② 기대 차분에 있는데 기대 결과와 한 필드라도 다르다 ③ 기대 차분에 있는데 옛 출력과 같다(묵은 항목)
// ④ 키가 사라졌거나 새로 생겼는데 기대 차분에 없다 — 넷 다 실패다.
// 이 시험과 fixture 둘은 일회성이다 — 0.1.0 마감 검토가 끝나면 지운다
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getRule } from './constraints';
import { generate, generateMany, parseContext } from './engine';
import { CONFLICT_CONTEXT, CONFLICT_SELECTION } from './__fixtures__/conflict';
import { PROVIDERS, type NameResult, type Provider, type RawContext } from './types';
import type { SelectionItem } from './selection';

const BEFORE_FILE = join(import.meta.dirname, '__fixtures__', 'outputs-before-v0.1.0.json');
const DIFF_FILE = join(import.meta.dirname, '__fixtures__', 'expected-diff-v0.1.0.json');

/** 항목 하나의 출력 — 이름 · 판정 · 위반 코드(정렬) · 축소 여부 · 단계(code · field 순서 그대로) · 충돌 상대 키(정렬).
 *  단계의 params 는 담지 않는다 — 약어가 바뀌면 step.abbreviated 의 from/to 도 바뀌어 같은 원인을 두 번 세게 된다 */
interface Outcome {
  name: string; valid: boolean; codes: string[]; isTruncated: boolean;
  steps: { code: string; field?: string }[]; conflictKeys: string[];
}
type Outcomes = Record<string, Outcome>;

const CAUSES = ['slug', 'env', 'region', 'region-removed', 'kind', 'conflict', 'kind-required', 'zone-required', 'shrink'] as const;
type Cause = (typeof CAUSES)[number];
interface ExpectedEntry { causes: Cause[]; expected: Outcome | null }  // null = 그 키가 사라진다
interface Migration { env: Record<string, string>; region: Record<string, Partial<Record<Provider, string>> | string> }
interface DiffFile { migration: Migration; items: Record<string, ExpectedEntry> }

function outcomeOf(r: NameResult): Outcome {
  const conflictKeys = new Set<string>();
  for (const v of r.violations) if (v.code === 'name.conflict') for (const k of v.params.keys) conflictKeys.add(k);
  return {
    name: r.name, valid: r.valid, codes: r.violations.map((v) => v.code).sort(), isTruncated: r.isTruncated,
    steps: r.steps.map((s) => ('field' in s && s.field !== undefined ? { code: s.code, field: s.field } : { code: s.code })),
    conflictKeys: [...conflictKeys].sort(),
  };
}

const BASE: RawContext = { owner: 'platform', system: 'billing', purpose: 'trade', env: 'prd', region: 'kr' };

/** 여러 개 생성 표본 — baseline-inputs.ts 의 baselineMany 와 같은 선택이다. 그쪽은 안에서 옛 원시 입력을 파싱하므로 쓰지 않고 선택만 옮겨 둔다 */
const MANY_SAMPLES: readonly { id: string; provider: Provider; raw: RawContext; picks: () => SelectionItem[] }[] = [
  { id: 'azure-vm2-subnet2-linux-windows-role', provider: 'azure', raw: BASE, picks: () => [
    { rule: getRule('azure', 'virtual_machine')!, count: 2 }, { rule: getRule('azure', 'subnet')!, count: 2 },
    { rule: getRule('azure', 'virtual_machine_windows')!, count: 1 }, { rule: getRule('azure', 'managed_identity')!, count: 1, role: 'db' },
  ] },
  { id: 'gcp-vm2-sa-db', provider: 'gcp', raw: BASE, picks: () => [
    { rule: getRule('gcp', 'compute_instance')!, count: 2 }, { rule: getRule('gcp', 'service_account')!, count: 1, role: 'db' },
  ] },
  { id: 'aws-ec2-2-role-db', provider: 'aws', raw: BASE, picks: () => [
    { rule: getRule('aws', 'ec2_instance')!, count: 2 }, { rule: getRule('aws', 'iam_role')!, count: 1, role: 'db' },
  ] },
  { id: 'conflict-fixture', provider: 'azure', raw: { ...CONFLICT_CONTEXT }, picks: () => [...CONFLICT_SELECTION] },
];

/** 원시 입력 → 새 엔진의 문맥. 지역은 provider 의 표로 푼다 (D49) */
function parseFor(raw: RawContext, provider: Provider) {
  const parsed = parseContext(raw, provider);
  if (!parsed.ok) throw new Error(`이전한 입력이 파싱되지 않는다: ${JSON.stringify(parsed.errors)}`);
  return parsed.context;
}

/** 옛 원시 입력에 고정 이전 매핑을 적용한다 — 매핑에 없는 값은 그대로 */
function migrate(raw: RawContext, provider: Provider, m: Migration): RawContext {
  const env = typeof raw.env === 'string' ? (m.env[raw.env] ?? raw.env) : raw.env;
  let region = raw.region;
  if (typeof region === 'string' && region in m.region) {
    const to = m.region[region]!;
    region = typeof to === 'string' ? to : to[provider];
  }
  return { ...raw, env, region };
}

/** 세 CSP 전체 카탈로그(generate) + 여러 개 생성 표본(generateMany) 의 항목 출력. toRaw 가 원시 입력을 엔진에 넣을 꼴로 바꾼다 */
function collectOutcomes(toRaw: (raw: RawContext, p: Provider) => RawContext): Outcomes {
  const out: Outcomes = {};
  for (const p of PROVIDERS) {
    const byType = generate(parseFor(toRaw(BASE, p), p), [p])[p] ?? {};
    for (const [type, r] of Object.entries(byType)) out[`gen/${p}/${type}`] = outcomeOf(r);
  }
  for (const s of MANY_SAMPLES) {
    const res = generateMany(parseFor(toRaw(s.raw, s.provider), s.provider), s.provider, s.picks());
    for (const item of res.items) out[`many/${s.id}/${item.key}`] = outcomeOf(item);
  }
  return out;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** 차분 판정 — 문제마다 한 줄. 빈 배열이면 모든 차이가 기대 차분으로 설명된다 */
function accountDiff(before: Outcomes, after: Outcomes, items: Record<string, ExpectedEntry>): string[] {
  const problems: string[] = [];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after), ...Object.keys(items)])].sort();
  for (const k of keys) {
    const b = before[k] ?? null;
    const a = after[k] ?? null;
    const e = items[k];
    if (e === undefined) {
      if (!same(a, b)) problems.push(`${k}: 설명되지 않은 차이 — 옛 ${JSON.stringify(b)} · 새 ${JSON.stringify(a)}`);
      continue;
    }
    if (!Array.isArray(e.causes) || e.causes.length === 0 || e.causes.some((c) => !(CAUSES as readonly string[]).includes(c))) {
      problems.push(`${k}: 원인 배열이 비었거나 모르는 원인이 있다 — ${JSON.stringify(e.causes)}`);
    }
    if (same(e.expected, b)) problems.push(`${k}: 묵은 항목 — 기대 결과가 옛 출력과 같다`);
    if (!same(a, e.expected)) problems.push(`${k}: 기대 결과와 다르다 — 기대 ${JSON.stringify(e.expected)} · 새 ${JSON.stringify(a)}`);
  }
  return problems;
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf-8')) as T;
}

describe('변경 회계 — 0.1.0 이름 체계 변경', () => {
  // 옛 출력은 한 번만 쓴다 — 파일이 이미 있으면 다시 쓰지 않는다(기준선을 지워 차분을 없애는 길을 막는다)
  if (process.env.WRITE_ACCOUNTING_BEFORE_ONCE === '1' && !existsSync(BEFORE_FILE)) {
    const outcomes = collectOutcomes((raw) => raw);
    const lines = Object.keys(outcomes).sort().map((k) => `    ${JSON.stringify(k)}: ${JSON.stringify(outcomes[k])}`);
    writeFileSync(BEFORE_FILE, `{\n  "engineCommit": "a0600cb",\n  "rulesRevision": "2026-10-07.2",\n  "outcomes": {\n${lines.join(',\n')}\n  }\n}\n`);
  }
  const before = readJson<{ engineCommit: string; rulesRevision: string; outcomes: Outcomes }>(BEFORE_FILE);
  const diff = readJson<DiffFile>(DIFF_FILE);

  it('바뀐 항목은 모두 기대 차분 파일로 설명된다 (옛 출력 = 규칙 버전 2026-10-07.2 · 세 CSP 667 항목 + 여러 개 생성 표본)', () => {
    expect(before.rulesRevision).toBe('2026-10-07.2');
    expect(Object.keys(before.outcomes).filter((k) => k.startsWith('gen/'))).toHaveLength(667);
    expect(Object.keys(before.outcomes).filter((k) => k.startsWith('many/')).length).toBeGreaterThan(0);
    const after = collectOutcomes((raw, p) => migrate(raw, p, diff.migration));
    expect(accountDiff(before.outcomes, after, diff.items)).toEqual([]);
  });

  it('검사기 자체 시험 — 옛 출력 · 기대 차분을 한 군데씩 바꾸면 그 항목을 문제로 보고한다', () => {
    const b = before.outcomes;
    const k = 'gen/gcp/compute_instance';
    const o = b[k]!;
    const mutate = (patch: Partial<Outcome>): Outcomes => ({ ...b, [k]: { ...o, ...patch } });
    // 같은 것끼리는 문제 0
    expect(accountDiff(b, b, {})).toEqual([]);
    // ① 이름 한 글자 · valid 반전 · 코드 하나 더함 · 단계 하나 더함 · 충돌 키 하나 더함 — 각각 설명되지 않은 차이
    for (const after of [
      mutate({ name: `${o.name}x` }), mutate({ valid: !o.valid }), mutate({ codes: [...o.codes, 'name.conflict'] }),
      mutate({ steps: [...o.steps, { code: 'step.token_dropped', field: 'region' }] }), mutate({ conflictKeys: ['x'] }),
      mutate({ isTruncated: !o.isTruncated }),
    ]) {
      const problems = accountDiff(b, after, {});
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(`${k}: 설명되지 않은 차이`);
    }
    // ④ 키가 사라짐 · 새 키
    const { [k]: _gone, ...without } = b;
    expect(accountDiff(b, without, {})[0]).toContain(`${k}: 설명되지 않은 차이`);
    expect(accountDiff(b, { ...b, 'gen/gcp/new_rule': o }, {})[0]).toContain('gen/gcp/new_rule: 설명되지 않은 차이');
    // 기대 차분이 맞게 적혀 있으면 통과
    const renamed = mutate({ name: `${o.name}x` });
    expect(accountDiff(b, renamed, { [k]: { causes: ['slug'], expected: renamed[k]! } })).toEqual([]);
    // ② 기대 결과와 한 필드라도 다르면 실패
    expect(accountDiff(b, renamed, { [k]: { causes: ['slug'], expected: { ...renamed[k]!, valid: !o.valid } } })[0]).toContain('기대 결과와 다르다');
    // ③ 묵은 항목 — 실제로는 옛 출력과 같다
    expect(accountDiff(b, b, { [k]: { causes: ['slug'], expected: o } })[0]).toContain('묵은 항목');
    // 원인이 비었거나 모르는 원인
    expect(accountDiff(b, renamed, { [k]: { causes: [], expected: renamed[k]! } })[0]).toContain('원인 배열');
    expect(accountDiff(b, renamed, { [k]: { causes: ['typo' as Cause], expected: renamed[k]! } })[0]).toContain('원인 배열');
    // 사라지는 키는 expected null 로 적는다
    expect(accountDiff(b, without, { [k]: { causes: ['conflict'], expected: null } })).toEqual([]);
  });
});
