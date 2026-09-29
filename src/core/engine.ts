// 엔진 공개 API — API(개발 2단계)와 화면(개발 3단계)은 이 셋만 부른다
import { PROVIDERS, type GenerateOutput, type NameResult, type NamingContext, type Provider, type RawContext, type ResourceRule, type Token } from './types';
import { getRule, rulesFor } from './constraints';
import { ENV_ALIASES, REGION_ALIASES, canonicalEnv, canonicalRegion, normalizeToken } from './normalize';
import { compose, tokenValues } from './compose';
import { fit } from './truncate';
import { checkName } from './validate';
import type { CoreMessage, ContextField } from './messages';

function generateOne(ctx: NamingContext, rule: ResourceRule): NameResult {
  const raw = tokenValues(ctx, rule);
  const steps: CoreMessage[] = [];
  let transformed = false;
  const values: Partial<Record<Token, string>> = {};
  for (const t of rule.template) {
    const before = raw[t] ?? '';
    const { value, changed } = normalizeToken(before, rule.allowed);
    values[t] = value;
    if (changed) { transformed = true; steps.push({ code: 'step.normalized', field: t, params: { from: before, to: value } }); }
  }
  // 구분자를 쓰지 않는 규칙은 토큰 사이 하이픈이 빠진다 (D15)
  if (rule.separator === '' && rule.template.length >= 2) { transformed = true; steps.push({ code: 'step.separator_removed' }); }

  const base = {
    ruleId: rule.id, resourceType: rule.resourceType, displayName: rule.displayName,
    original: compose(raw, rule.template, rule.separator),
    isTransformed: transformed,
    rule: { minLength: rule.minLength, maxLength: rule.maxLength, pattern: rule.pattern.source, patternFlags: rule.pattern.flags, allowed: rule.allowed, docUrl: rule.docUrl,
            notes: rule.notes ?? [] },
  };

  // Review Focus 1 — 필수 토큰이 정제 뒤 비면 compose 가 건너뛰어 엉뚱한 「유효」 이름이 나온다. 만들지 않는다
  const emptied = rule.template.filter((t) => !rule.optional.includes(t) && !values[t]);
  if (emptied.length > 0) {
    return { ...base, name: '', valid: false, isTruncated: false, violations: emptied.map((t): CoreMessage => ({ code: 'name.token_empty', field: t })), steps };
  }

  const f = fit(values, rule);
  steps.push(...f.steps);
  // 원장 판정 n6 — 축소 실패면 이유는 그 하나만 (checkName 을 부르지 않는다)
  const violations: CoreMessage[] = f.fits ? checkName(f.name, rule) : [{ code: 'name.cannot_fit', params: { max: rule.maxLength } }];
  return { ...base, name: f.name, valid: violations.length === 0, isTruncated: f.truncated, violations, steps };
}

export function generate(ctx: NamingContext, providers: Provider[] = [...PROVIDERS]): GenerateOutput {
  const out: GenerateOutput = {};
  for (const p of providers) {
    const byType: Record<string, NameResult> = {};
    for (const rule of rulesFor(p)) byType[rule.resourceType] = generateOne(ctx, rule);
    out[p] = byType;
  }
  return out;
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

  // ⑵ 길이 초과면 정제한 값을 쪼개 앞 토큰부터 뗀다 (원장 판정 n7).
  // 생성의 축소 1단계(template 순서대로 optional 을 뗀다)와 다른 까닭: 검증은 이름이 어떤 template 으로 만들어졌는지 모른다 (원장 판정 n11)
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

/** 지원하는 표준값 — 별칭 표의 값에서 뽑는다(순서는 표 순서: prd · stg · dev · sbx / kr · us · jp · eu · global) */
const ENV_VALUES = (): string[] => [...new Set(Object.values(ENV_ALIASES))];
const REGION_VALUES = (): string[] => [...new Set(Object.values(REGION_ALIASES))];

const FIELDS: readonly ContextField[] = ['owner', 'system', 'purpose', 'env', 'region'];

export function parseContext(raw: RawContext):
  { ok: true; context: NamingContext; transformed: CoreMessage[] } | { ok: false; errors: CoreMessage[] } {
  const errors: CoreMessage[] = [];
  const transformed: CoreMessage[] = [];
  const vals: Record<string, string> = {};
  // 원장 판정 n8 — 여러 필드가 틀리면 owner → system → purpose → env → region 순서로 알린다
  for (const f of FIELDS) {
    const v = raw[f];
    if (typeof v !== 'string') { errors.push({ code: 'context.not_string', field: f }); continue; }
    if (v.trim() === '') { errors.push({ code: 'context.empty', field: f }); continue; }
    if (f === 'env') {
      const c = canonicalEnv(v);
      if (!c) { errors.push({ code: 'context.value_unsupported', field: 'env', params: { value: v, supported: ENV_VALUES() } }); continue; }
      if (c !== v) transformed.push({ code: 'context.normalized', field: 'env', params: { from: v, to: c } });
      vals[f] = c;
    } else if (f === 'region') {
      const c = canonicalRegion(v);
      if (!c) { errors.push({ code: 'context.value_unsupported', field: 'region', params: { value: v, supported: REGION_VALUES() } }); continue; }
      if (c !== v) transformed.push({ code: 'context.normalized', field: 'region', params: { from: v, to: c } });
      vals[f] = c;
    } else {
      vals[f] = v.trim();
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, context: vals as unknown as NamingContext, transformed };
}
