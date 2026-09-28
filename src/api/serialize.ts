// 코어(camelCase) → wire(snake_case) (D15). 이름 규칙 · 판정 로직은 여기 없다 — 필드 이름만 바꾼다
import type { LabelSet, NameResult, Provider } from '../core/types';

export interface WireRule { min_length: number; max_length: number; pattern: string; pattern_flags: string; allowed: string; doc_url: string; note?: string }
export interface WireName {
  name: string; valid: boolean; is_truncated: boolean; is_transformed: boolean; original: string;
  violations: string[]; reason: string; rule: WireRule;
}
export interface WireGenerate {
  success: true;
  data: Partial<Record<Provider, Record<string, WireName>>>;
  metadata: {
    generated_labels: Partial<Record<Provider, Record<string, string>>>;
    label_violations: Partial<Record<Provider, string[]>>;
    label_transformed: Partial<Record<Provider, string[]>>;
    transformed: string[];
  };
}
export interface WireValidate { valid: boolean; violations: string[]; suggested_name?: string }

/** provider 하나의 결과 — 라우터가 요청 providers 순서대로 만든다. data 와 metadata 셋의 provider 집합이 같아지는 자리다 */
export interface ProviderResult { provider: Provider; names: Record<string, NameResult>; labels: LabelSet }

export function toWireName(r: NameResult): WireName {
  const { minLength, maxLength, pattern, patternFlags, allowed, docUrl, note } = r.rule;
  return {
    name: r.name, valid: r.valid, is_truncated: r.isTruncated, is_transformed: r.isTransformed, original: r.original,
    violations: r.violations, reason: r.steps.join(' · '),
    rule: { min_length: minLength, max_length: maxLength, pattern, pattern_flags: patternFlags, allowed, doc_url: docUrl, ...(note !== undefined ? { note } : {}) },
  };
}

export function toWireGenerate(results: ProviderResult[], transformed: string[]): WireGenerate {
  const w: WireGenerate = { success: true, data: {}, metadata: { generated_labels: {}, label_violations: {}, label_transformed: {}, transformed } };
  for (const { provider, names, labels } of results) {
    w.data[provider] = Object.fromEntries(Object.entries(names).map(([type, r]) => [type, toWireName(r)]));
    w.metadata.generated_labels[provider] = labels.labels;
    w.metadata.label_violations[provider] = labels.violations;
    w.metadata.label_transformed[provider] = labels.transformed;
  }
  return w;
}

export function toWireValidate(r: { valid: boolean; violations: string[]; suggestedName?: string }): WireValidate {
  return { valid: r.valid, violations: r.violations, ...(r.suggestedName !== undefined ? { suggested_name: r.suggestedName } : {}) };
}
