// 엔진 공개 API — API 와 화면은 generate · validateName · parseContext · generateMany 넷을 부른다 (선택 검증은 selection.ts)
import { PROVIDERS, type GenerateOutput, type NameResult, type NamingContext, type Provider, type RawContext, type ResourceRule, type Token } from './types';
import { getRule, rulesFor } from './constraints';
import { ENV_VALUES, canonicalEnv, normalizeToken } from './normalize';
import { canonicalRegion, regionCandidates } from './regions';
import { compose, regionTokenOfRule, tokenValues, type ItemExtra } from './compose';
import { findConflicts } from './conflict';
import type { SelectionItem } from './selection';
import { inputKind } from './tree';
import { fit } from './truncate';
import { checkName } from './validate';
import type { CoreMessage, ContextField } from './messages';
import { clipForDisplay } from './display';

function generateOne(ctx: NamingContext, rule: ResourceRule, extra: ItemExtra = {}): NameResult {
  const raw = tokenValues(ctx, rule, extra);
  const steps: CoreMessage[] = [];
  let transformed = false;
  const values: Partial<Record<Token, string>> = {};
  for (const t of rule.template) {
    const before = raw[t] ?? '';
    const { value, changed } = normalizeToken(before, rule.allowed);
    values[t] = value;
    if (changed) { transformed = true; steps.push({ code: 'step.normalized', field: t, params: { from: clipForDisplay(before), to: clipForDisplay(value) } }); }
  }
  // 구분자를 쓰지 않는 규칙은 토큰 사이 하이픈이 빠진다 (D15)
  if (rule.separator === '' && rule.template.length >= 2) { transformed = true; steps.push({ code: 'step.separator_removed' }); }

  const base = {
    ruleId: rule.id, resourceType: rule.resourceType, displayName: rule.displayName,
    original: compose(raw, rule.template, rule.separator),
    isTransformed: transformed,
    rule: { minLength: rule.minLength, maxLength: rule.maxLength, pattern: rule.pattern.source, patternFlags: rule.pattern.flags, allowed: rule.allowed, docUrl: rule.docUrl,
            // 규칙 표의 notes 를 참조로 넘기지 않는다 — 호출자가 결과를 고쳐도 규칙 표가 바뀌지 않게
            notes: (rule.notes ?? []).map((m) => structuredClone(m)) },
  };

  // 존 규칙에 존이 없다 (D50) — generate · generateMany 둘 다 여기를 지난다. 빈 지역 자리를 token_empty 로 알리기 전에 본다
  if (regionTokenOfRule(rule) === 'zone' && !ctx.zone) {
    return { ...base, name: '', valid: false, isTruncated: false, violations: [{ code: 'name.zone_required', params: { region: ctx.region } }], steps };
  }

  // 필수 토큰이 정제 뒤 비면 compose 가 건너뛰어 엉뚱한 「유효」 이름이 나온다. 만들지 않는다
  const emptied = rule.template.filter((t) => !rule.optional.includes(t) && !values[t]);
  if (emptied.length > 0) {
    return { ...base, name: '', valid: false, isTruncated: false, violations: emptied.map((t): CoreMessage => ({ code: 'name.token_empty', field: t })), steps };
  }

  const f = fit(values, rule);
  steps.push(...f.steps);
  // 축소 실패면 이유는 그 하나만 (checkName 을 부르지 않는다)
  const violations: CoreMessage[] = f.fits ? checkName(f.name, rule) : [{ code: 'name.cannot_fit', params: { max: rule.maxLength } }];
  return { ...base, name: f.name, valid: violations.length === 0, isTruncated: f.truncated, violations, steps };
}

/** 같은 부류(entity)의 같은 이름을 찾아 그 항목마다 valid:false + name.conflict 를 단다 (D41 · D47). 요약(충돌마다 메시지 하나)을 돌려준다.
 *  generate · generateMany 가 같이 쓴다 — 항목 위반은 요약의 복사본이다 */
function markConflicts(items: readonly { key: string; rule: ResourceRule; result: NameResult }[]): CoreMessage[] {
  const conflicts = findConflicts(items);
  for (const c of conflicts) {
    if (c.code !== 'name.conflict') continue;
    for (const { key, result } of items) {
      if (!c.params.keys.includes(key)) continue;
      result.valid = false;
      result.violations.push(structuredClone(c));
    }
  }
  return conflicts;
}

/** 전체 카탈로그 — provider 마다 규칙 전부의 이름. 키는 resourceType 이고 충돌 검사도 그 키로 한다 */
export function generate(ctx: NamingContext, providers: Provider[] = [...PROVIDERS]): GenerateOutput {
  const out: GenerateOutput = {};
  for (const p of providers) {
    const items = rulesFor(p).map((rule) => ({ key: rule.resourceType, rule, result: generateOne(ctx, rule) }));
    markConflicts(items);
    out[p] = Object.fromEntries(items.map(({ key, result }) => [key, result]));
  }
  return out;
}

/** 항목 하나의 이름 — key 는 `${resourceType}_${seq}`(count 규칙) · `${resourceType}_${role}`(role 규칙, 생략이면 기본 역할) · resourceType(입력 없음) */
export interface NameItem extends NameResult { key: string; seq?: string; role?: string }
export interface ManyResult { provider: Provider; valid: boolean; items: NameItem[]; conflicts: CoreMessage[] }

/** 순번은 두 자리 고정 (D40) — 한 항목의 이름이 같은 자리수를 써서 축소 경로가 같다 */
const seqOf = (i: number): string => String(i).padStart(2, '0');
/** role 규칙에 역할을 주지 않았을 때의 역할 — 화면의 공유 hash 도 이 값을 문자열로 적는다 (D42) */
export const DEFAULT_ROLE = 'sync';

/** 고른 항목마다 이름을 만든다 (D30' · D41). 선택은 validateSelection 을 거친 것이라 여기서 다시 검사하지 않는다.
 *  항목 순서 = 선택 순서 → 순번 순서. 입력 없는 · role 규칙은 count 와 무관하게 하나.
 *  같은 부류(entity)의 같은 이름은 그 항목마다 valid:false + name.conflict 이고, conflicts 는 그 요약이다 — 전체 valid 는 항목 전부의 valid 다 */
export function generateMany(ctx: NamingContext, provider: Provider, selection: readonly SelectionItem[]): ManyResult {
  const items: { item: NameItem; rule: ResourceRule }[] = [];
  for (const { rule, count, role } of selection) {
    if (rule.provider !== provider) throw new Error(`rule ${rule.id} is not a ${provider} rule`);
    const kind = inputKind(rule);
    if (kind === 'count') {
      for (let i = 1; i <= count; i++) {
        const seq = seqOf(i);
        items.push({ rule, item: { ...generateOne(ctx, rule, { seq }), key: `${rule.resourceType}_${seq}`, seq } });
      }
    } else if (kind === 'role') {
      const r = role ?? DEFAULT_ROLE;
      items.push({ rule, item: { ...generateOne(ctx, rule, { role: r }), key: `${rule.resourceType}_${r}`, role: r } });
    } else {
      items.push({ rule, item: { ...generateOne(ctx, rule), key: rule.resourceType } });
    }
  }

  const conflicts = markConflicts(items.map(({ item, rule }) => ({ key: item.key, rule, result: item })));
  const out = items.map(({ item }) => item);
  return { provider, valid: out.every((i) => i.valid), items: out, conflicts };
}

export function validateName(provider: Provider, resourceType: string, name: string):
  { valid: boolean; violations: CoreMessage[]; suggestedName?: string } {
  const rule = getRule(provider, resourceType);
  if (!rule) return { valid: false, violations: [{ code: 'rule.unknown_resource_type', params: { provider, supported: rulesFor(provider).map((r) => r.resourceType) } }] };

  const violations = checkName(name, rule);
  if (violations.length === 0) return { valid: true, violations };

  // ⑴ 정제만으로 되는가
  const normalized = normalizeToken(name, rule.allowed).value;
  if (checkName(normalized, rule).length === 0) return { valid: false, violations, suggestedName: normalized };

  // ⑵ 길이 초과면 정제한 값을 쪼개 앞 토큰부터 뗀다.
  // 생성의 축소 1단계(template 순서대로 optional 을 뗀다)와 다른 까닭: 검증은 이름이 어떤 template 으로 만들어졌는지 모른다
  // ⑶ 구분자 없는 규칙은 토큰 경계를 모르므로 제안하지 않는다
  if (normalized.length > rule.maxLength && rule.separator === '-') {
    const parts = normalized.split('-');
    for (let i = 1; i < parts.length; i++) {
      const candidate = parts.slice(i).join('-');
      if (checkName(candidate, rule).length === 0) return { valid: false, violations, suggestedName: candidate };
    }
  }
  return { valid: false, violations };
}

/** env 표준값 — 화면의 env 고르기가 쓰는 공개 API (D48). 정본은 normalize.ts 의 별칭 표다 */
export { ENV_VALUES };
const FIELDS: readonly ContextField[] = ['owner', 'system', 'purpose', 'env', 'region'];

/** 자유 입력(owner · system · purpose) 하나의 길이 상한 — 이름 규칙이 아니라 전송 위생이다. API 와 화면 입력 · 공유 hash 가 이 값을 쓴다.
 *  가장 긴 이름 규칙이 256자라 필드 하나 64자면 모자라지 않고, 이름 200개 응답이 작은 요청으로 커지지 않는다 (docs/decisions.md · 2026-10-06).
 *  parseContext 는 길이를 보지 않는다 — 엔진을 직접 부르는 시험 · 기준선은 더 긴 값도 넣는다 */
export const MAX_CONTEXT_CHARS = 64;

/** 원시 문맥 → 엔진 문맥. region 은 provider 의 지역 표로 푼다 (D49) — 리전 이름 · 존 이름 · 코드 · global.
 *  받지 않는 지역이면 supported 에 후보(옛 나라 값이면 그 나라의 리전 이름, 아니면 그 CSP 리전 이름 전부) */
export function parseContext(raw: RawContext, provider: Provider):
  { ok: true; context: NamingContext; transformed: CoreMessage[] } | { ok: false; errors: CoreMessage[] } {
  const errors: CoreMessage[] = [];
  const transformed: CoreMessage[] = [];
  const vals: Record<string, string> = {};
  // 여러 필드가 틀리면 owner → system → purpose → env → region 순서로 알린다
  for (const f of FIELDS) {
    const v = raw[f];
    if (typeof v !== 'string') { errors.push({ code: 'context.not_string', field: f }); continue; }
    if (v.trim() === '') { errors.push({ code: 'context.empty', field: f }); continue; }
    if (f === 'env') {
      const c = canonicalEnv(v);
      if (!c) { errors.push({ code: 'context.value_unsupported', field: 'env', params: { value: clipForDisplay(v), supported: [...ENV_VALUES] } }); continue; }
      if (c !== v) transformed.push({ code: 'context.normalized', field: 'env', params: { from: clipForDisplay(v), to: c } });
      vals[f] = c;
    } else if (f === 'region') {
      const c = canonicalRegion(v, provider);
      if (!c) { errors.push({ code: 'context.value_unsupported', field: 'region', params: { value: clipForDisplay(v), supported: regionCandidates(v, provider) } }); continue; }
      // 이름에 들어가는 코드(존이면 존 코드)와 입력이 다르면 기록한다 — 리전 · 존 이름은 코드로 바뀐다
      const to = c.zone ?? c.region;
      if (to !== v) transformed.push({ code: 'context.normalized', field: 'region', params: { from: clipForDisplay(v), to } });
      vals[f] = c.region;
      if (c.zone) vals.zone = c.zone;
    } else {
      vals[f] = v.trim();
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, context: vals as unknown as NamingContext, transformed };
}
