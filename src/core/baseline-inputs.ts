// 기준선 입력 행렬 — 문구 이관(엔진이 문장 대신 코드를 내는 변경) 전후에 같은 입력이 같은 이름 · 판정 · 제안 · 라벨을 내는지 대어 보는 표본.
// 시험 파일이 아니다 — 기준선 시험(baseline.test.ts)과 규칙 지문(revision.test.ts)이 같이 쓴다.
// 문구는 기록하지 않는다(문구는 바뀐다) — 위반 · 단계는 개수만 담는다.
import { RULES, getRule } from './constraints';
import { generate, generateMany, parseContext, validateName, type ManyResult } from './engine';
import { CONFLICT_CONTEXT, CONFLICT_SELECTION } from './__fixtures__/conflict';
import { labelsFor } from './labels';
import { PROVIDERS, type Provider, type RawContext } from './types';

/** 한글 사용자 입력 표본 — 소스의 문자열 리터럴에 한글을 두지 않으려고(시스템 문구 한글 0 검사 대상이다) 코드 포인트로 쓴다 */
const HANGUL_OWNER = String.fromCodePoint(0xac1c, 0xbc1c);
const HANGUL_SYSTEM = String.fromCodePoint(0xb9e4, 0xb9e4); // 정제하면 빈 값이 된다

/** 기본 지역 — 지역은 CSP 마다 다른 표로 푼다 (D49). 서울 리전 이름 */
const BASE_REGION: Readonly<Record<Provider, string>> = { gcp: 'asia-northeast3', aws: 'ap-northeast-2', azure: 'koreacentral' };
/** region 이 없는 기본 문맥 — 표본이 region 을 주지 않으면 BASE_REGION(또는 표본의 region 표)을 provider 마다 넣는다 */
const BASE = { owner: 'platform', system: 'billing', purpose: 'trade', env: 'prod' };

/** 생성 입력 표본 하나 — raw 에 region 이 있으면 모든 CSP 에 그 값, 없으면 region 표(없으면 BASE_REGION)의 그 CSP 값.
 *  providers 가 있으면 그 CSP 에서만 돈다(존은 GCP 에만 있다) */
export interface BaselineContext { id: string; raw: RawContext; region?: Readonly<Record<Provider, string>>; providers?: readonly Provider[] }

/** 생성 입력 — provider 마다 parseContext 를 거쳐 generate · labelsFor 로 간다 */
export const BASELINE_CONTEXTS: readonly BaselineContext[] = [
  { id: 'base', raw: BASE },
  { id: 'hangul-owner', raw: { ...BASE, owner: HANGUL_OWNER } },
  { id: 'space-quote-combining-owner', raw: { ...BASE, owner: ' Team "A" café ' } },
  // 별칭 env · 대소문자가 섞인 리전 이름 — 둘 다 바꾼 기록이 남는다
  { id: 'alias-env-region', raw: { ...BASE, env: 'production' }, region: { gcp: 'Asia-Northeast3', aws: 'AP-NORTHEAST-2', azure: 'KoreaCentral' } },
  { id: 'reserved-windows', raw: { ...BASE, system: 'windows' } },
  { id: 'reserved-google', raw: { ...BASE, system: 'google' } },
  { id: 'reserved-azure', raw: { ...BASE, system: 'azure' } },
  { id: 'empty-after-normalize', raw: { ...BASE, system: HANGUL_SYSTEM } },
  { id: 'long-values', raw: { owner: 'platformengineering', system: 'paymentsettlement', purpose: 'reconciliation', env: 'dev', region: 'global' } },
  // 축소 실패 — Windows VM(15자)에서 env prod(4자)면 예산이 1 이라 들어가지 않는다 (name.cannot_fit · D48). 3자 env 였을 때는 예산 2 로 'a-' 가 한 글자가 되어 실패했다
  { id: 'shrink-fail', raw: { ...BASE, system: 'a-long', purpose: 'longpurpose' } },
  { id: 'digit-first-system', raw: { ...BASE, system: '3tier' } },
  { id: 'label-gcp-65', raw: { ...BASE, owner: 'o'.repeat(65) } },
  { id: 'label-aws-257', raw: { ...BASE, owner: 'o'.repeat(257) } },
  { id: 'label-aws-invalid-char', raw: { ...BASE, owner: 'team#1' } },
  { id: 'label-gcp-transform', raw: { ...BASE, owner: 'In.Fra' } },
  { id: 'parse-env-qa', raw: { ...BASE, env: 'qa' } },
  { id: 'parse-region-mars', raw: { ...BASE, region: 'mars' } },
  // 옛 나라 값은 받지 않는다 — supported 는 그 CSP 의 한국 리전 이름 (D49)
  { id: 'region-country-kr', raw: { ...BASE, region: 'kr' } },
  // 존 이름 — 리전 코드로 풀린다. 존 규칙도 리전 코드다 (D50 revised)
  { id: 'region-zone', raw: { ...BASE, region: 'asia-northeast3-a' }, providers: ['gcp'] },
  { id: 'parse-owner-empty', raw: { ...BASE, owner: '   ' } },
  { id: 'parse-owner-number', raw: { ...BASE, owner: 123 } },
  { id: 'parse-missing-all', raw: {} },
];

/** 표본이 도는 CSP */
export const baselineProviders = (c: BaselineContext): readonly Provider[] => c.providers ?? PROVIDERS;

/** 표본의 그 CSP 원시 입력 */
export function baselineRaw(c: BaselineContext, p: Provider): RawContext {
  // 빈 문맥(parse-missing-all)은 다섯 필드가 모두 빠진 표본이라 region 도 넣지 않는다
  if ('region' in c.raw || Object.keys(c.raw).length === 0) return c.raw;
  return { ...c.raw, region: (c.region ?? BASE_REGION)[p] };
}

export interface ValidateCase { provider: Provider; resourceType: string; name: string }

/** 검증 입력 — 규칙마다 길이 경계 · 금지 목록 · 구조 위반 · 정제 제안 · 뗀 제안. 규칙 표에서 만들어지므로 규칙이 늘면 표본도 는다 */
export function baselineValidateCases(): ValidateCase[] {
  const cases: ValidateCase[] = [];
  for (const id of Object.keys(RULES).sort()) {
    const r = RULES[id]!;
    const add = (name: string) => cases.push({ provider: r.provider, resourceType: r.resourceType, name });
    for (const n of [r.minLength - 1, r.minLength, r.maxLength, r.maxLength + 1]) if (n >= 0) add('a'.repeat(n));
    const f = r.forbidden;
    for (const p of f?.prefixes ?? []) add(`${p}abc`);
    for (const s of f?.suffixes ?? []) add(`abc${s}`);
    for (const c of f?.contains ?? []) add(`ab${c}cd`);
    for (const e of f?.exact ?? []) add(e);
    for (const w of f?.words ?? []) { add(`app-${w}`); add(`${w}123`); add(`${w}app`); }
    add('192.168.0.1');
    add('ab--cd');
    add('1abc');
    add('abc-');
    add('ABC');
    add('St-Payments-Prd');
    add('st_payments.prd');
    // 길이 초과인 하이픈 이름 — 앞 토큰을 떼 제안이 나오는지 (engine.validateName ⑵)
    add(Array.from({ length: Math.ceil((r.maxLength + 8) / 4) }, (_, i) => `tk${i % 10}`).join('-'));
  }
  cases.push({ provider: 'gcp', resourceType: 'no_such_type', name: 'abc' });
  return cases;
}

/** 여러 개 생성 입력 (D30' · D41 · D52) — 개수 · 역할 · 같은 부류 다른 이름(Linux+Windows VM) · 충돌 fixture · 종류.
 *  문맥은 base 하나(BASELINE_CONTEXTS 는 바꾸지 않는다) — 충돌 fixture 만 자기 문맥을 쓴다 */
export function baselineMany(): { id: string; result: ManyResult }[] {
  const base = (p: Provider) => {
    const parsed = parseContext({ ...BASE, region: BASE_REGION[p] }, p);
    if (!parsed.ok) throw new Error('base context must parse');
    return parsed.context;
  };
  const r = (p: Provider, t: string) => getRule(p, t)!;
  return [
    { id: 'azure-vm2-subnet2-linux-windows-role', result: generateMany(base('azure'), 'azure', [
      { rule: r('azure', 'virtual_machine'), count: 2 }, { rule: r('azure', 'subnet'), count: 2 },
      { rule: r('azure', 'virtual_machine_windows'), count: 1 }, { rule: r('azure', 'managed_identity'), count: 1, role: 'db' },
    ]) },
    { id: 'gcp-vm2-sa-db', result: generateMany(base('gcp'), 'gcp', [
      { rule: r('gcp', 'compute_instance'), count: 2 }, { rule: r('gcp', 'service_account'), count: 1, role: 'db' },
    ]) },
    { id: 'aws-ec2-2-role-db', result: generateMany(base('aws'), 'aws', [
      { rule: r('aws', 'ec2_instance'), count: 2 }, { rule: r('aws', 'iam_role'), count: 1, role: 'db' },
    ]) },
    { id: 'conflict-fixture', result: generateMany(CONFLICT_CONTEXT, 'azure', CONFLICT_SELECTION) },
    // 종류 (D52) — 토큰이 붙는 값 · 기본값 · omitValues · 필수 종류(리소스 정책) · 범위별 기본값(지역 NEG SERVERLESS)
    { id: 'gcp-kinds', result: generateMany(base('gcp'), 'gcp', [
      { rule: r('gcp', 'cloud_sql_instance'), count: 2, kind: 'POSTGRES' }, { rule: r('gcp', 'resource_policy'), count: 1, kind: 'snapshot-schedule' },
      { rule: r('gcp', 'backend_service'), count: 1, kind: 'EXTERNAL_MANAGED' }, { rule: r('gcp', 'region_backend_service'), count: 1, kind: 'INTERNAL_MANAGED' },
      { rule: r('gcp', 'region_network_endpoint_group'), count: 1, kind: 'SERVERLESS' }, { rule: r('gcp', 'subnet'), count: 1, kind: 'REGIONAL_MANAGED_PROXY' },
      { rule: r('gcp', 'health_check'), count: 1, kind: 'grpc-with-tls' }, { rule: r('gcp', 'firewall_rule'), count: 1, kind: 'INGRESS' },
    ]) },
  ];
}

/** 표본 × CSP — 지역을 CSP 마다 풀므로 파싱 · 생성도 CSP 마다 한다 */
function eachContext() {
  return BASELINE_CONTEXTS.flatMap((c) => baselineProviders(c).map((p) => ({ id: c.id, provider: p, parsed: parseContext(baselineRaw(c, p), p) })));
}

/** 엔진 쪽 기준선 — 이름 · 판정 · 제안 · 라벨. 문구 대신 개수를 담는다 */
export function coreBaseline() {
  const contexts = eachContext().map(({ id, provider: p, parsed }) => {
    if (!parsed.ok) return { id, provider: p, parse: { ok: false, errors: parsed.errors.length } };
    const names: Record<string, unknown> = {};
    for (const [type, r] of Object.entries(generate(parsed.context, [p])[p] ?? {})) {
      names[type] = {
        name: r.name, valid: r.valid, isTruncated: r.isTruncated, isTransformed: r.isTransformed, original: r.original,
        violations: r.violations.length, steps: r.steps.length,
      };
    }
    const set = labelsFor(parsed.context, p);
    return {
      id, provider: p,
      parse: { ok: true, context: parsed.context, transformed: parsed.transformed.length },
      names, labels: { labels: set.labels, violations: set.violations.length, transformed: set.transformed.length },
    };
  });
  const validate = baselineValidateCases().map((c) => {
    const v = validateName(c.provider, c.resourceType, c.name);
    return {
      ...c, known: getRule(c.provider, c.resourceType) !== undefined,
      valid: v.valid, violations: v.violations.length, suggestedName: v.suggestedName ?? null,
    };
  });
  const many = baselineMany().map(({ id, result }) => ({
    id, provider: result.provider, valid: result.valid, conflicts: result.conflicts.length,
    items: result.items.map((i) => ({ key: i.key, name: i.name, valid: i.valid, violations: i.violations.length, ...(i.kind === undefined ? {} : { kind: i.kind }), ...(i.kindToken === undefined ? {} : { kindToken: i.kindToken }) })),
  }));
  return { contexts, validate, many };
}

/** 규칙 지문(revision.test)용 — 기준선 입력의 위반 · 라벨 위반 · 파싱 오류를 개수가 아니라 코드 목록으로 담는다.
 *  같은 개수에서 다른 이유로 바뀌는 변경도 지문이 잡는다. 문장은 담지 않는다 (문장은 사전 몫이다) */
export function coreBaselineCodes() {
  const codes = (ms: readonly { code: string }[]) => ms.map((m) => m.code);
  const contexts = eachContext().map(({ id, provider: p, parsed }) => {
    if (!parsed.ok) return { id, provider: p, errors: codes(parsed.errors) };
    const names = Object.fromEntries(Object.entries(generate(parsed.context, [p])[p] ?? {}).map(([type, r]) => [type, codes(r.violations)]));
    return { id, provider: p, names, labels: codes(labelsFor(parsed.context, p).violations) };
  });
  const validate = baselineValidateCases().map((c) => codes(validateName(c.provider, c.resourceType, c.name).violations));
  const many = baselineMany().map(({ id, result }) => ({ id, items: result.items.map((i) => codes(i.violations)), conflicts: codes(result.conflicts) }));
  return { contexts, validate, many };
}
