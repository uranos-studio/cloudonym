// 기준선 입력 행렬 — 문구 이관(엔진이 문장 대신 코드를 내는 변경) 전후에 같은 입력이 같은 이름 · 판정 · 제안 · 라벨을 내는지 대어 보는 표본.
// 시험 파일이 아니다 — 기준선 시험(baseline.test.ts)과 규칙 지문(revision.test.ts)이 같이 쓴다.
// 문구는 기록하지 않는다(문구는 바뀐다) — 위반 · 단계는 개수만 담는다.
import { RULES, getRule } from './constraints';
import { generate, parseContext, validateName } from './engine';
import { labelsFor } from './labels';
import { PROVIDERS, type Provider, type RawContext } from './types';

/** 한글 사용자 입력 표본 — 소스의 문자열 리터럴에 한글을 두지 않으려고(시스템 문구 한글 0 검사 대상이다) 코드 포인트로 쓴다 */
const HANGUL_OWNER = String.fromCodePoint(0xac1c, 0xbc1c);
const HANGUL_SYSTEM = String.fromCodePoint(0xb9e4, 0xb9e4); // 정제하면 빈 값이 된다

const BASE = { owner: 'platform', system: 'billing', purpose: 'trade', env: 'prd', region: 'kr' };

/** 생성 입력 — parseContext 를 거쳐 generate · labelsFor 로 간다 */
export const BASELINE_CONTEXTS: readonly { id: string; raw: RawContext }[] = [
  { id: 'base', raw: BASE },
  { id: 'hangul-owner', raw: { ...BASE, owner: HANGUL_OWNER } },
  { id: 'space-quote-combining-owner', raw: { ...BASE, owner: ' Team "A" café ' } },
  { id: 'alias-env-region', raw: { ...BASE, env: 'production', region: 'koreacentral' } },
  { id: 'reserved-windows', raw: { ...BASE, system: 'windows' } },
  { id: 'reserved-google', raw: { ...BASE, system: 'google' } },
  { id: 'reserved-azure', raw: { ...BASE, system: 'azure' } },
  { id: 'empty-after-normalize', raw: { ...BASE, system: HANGUL_SYSTEM } },
  { id: 'long-values', raw: { owner: 'platformengineering', system: 'paymentsettlement', purpose: 'reconciliation', env: 'dev', region: 'global' } },
  // 축소 실패 — Windows VM(15자)에서 예산 2 로 자르면 'a-' 가 한 글자가 된다 (name.cannot_fit)
  { id: 'shrink-fail', raw: { ...BASE, system: 'a-long', purpose: 'longpurpose' } },
  { id: 'digit-first-system', raw: { ...BASE, system: '3tier' } },
  { id: 'label-gcp-65', raw: { ...BASE, owner: 'o'.repeat(65) } },
  { id: 'label-aws-257', raw: { ...BASE, owner: 'o'.repeat(257) } },
  { id: 'label-aws-invalid-char', raw: { ...BASE, owner: 'team#1' } },
  { id: 'label-gcp-transform', raw: { ...BASE, owner: 'Ac.Mex' } },
  { id: 'parse-env-qa', raw: { ...BASE, env: 'qa' } },
  { id: 'parse-region-mars', raw: { ...BASE, region: 'mars' } },
  { id: 'parse-owner-empty', raw: { ...BASE, owner: '   ' } },
  { id: 'parse-owner-number', raw: { ...BASE, owner: 123 } },
  { id: 'parse-missing-all', raw: {} },
];

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

/** 엔진 쪽 기준선 — 이름 · 판정 · 제안 · 라벨. 문구 대신 개수를 담는다 */
export function coreBaseline() {
  const contexts = BASELINE_CONTEXTS.map(({ id, raw }) => {
    const parsed = parseContext(raw);
    if (!parsed.ok) return { id, parse: { ok: false, errors: parsed.errors.length } };
    const names: Record<string, Record<string, unknown>> = {};
    const out = generate(parsed.context);
    for (const p of PROVIDERS) {
      names[p] = {};
      for (const [type, r] of Object.entries(out[p] ?? {})) {
        names[p][type] = {
          name: r.name, valid: r.valid, isTruncated: r.isTruncated, isTransformed: r.isTransformed, original: r.original,
          violations: r.violations.length, steps: r.steps.length,
        };
      }
    }
    const labels: Record<string, unknown> = {};
    for (const p of PROVIDERS) {
      const set = labelsFor(parsed.context, p);
      labels[p] = { labels: set.labels, violations: set.violations.length, transformed: set.transformed.length };
    }
    return {
      id,
      parse: { ok: true, context: parsed.context, transformed: parsed.transformed.length },
      names, labels,
    };
  });
  const validate = baselineValidateCases().map((c) => {
    const v = validateName(c.provider, c.resourceType, c.name);
    return {
      ...c, known: getRule(c.provider, c.resourceType) !== undefined,
      valid: v.valid, violations: v.violations.length, suggestedName: v.suggestedName ?? null,
    };
  });
  return { contexts, validate };
}
