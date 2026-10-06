// 코어(camelCase) → wire(snake_case) (D15 · D25). 이름 규칙 · 판정 로직은 여기 없다 — 필드 이름을 바꾸고 메시지 코드에 문장을 붙인다
import type { LabelSet, NameResult, Provider, ResourceRule, ScopeId } from '../core/types';
import type { ManyResult } from '../core/engine';
import { displayMessage, format, type Catalog, type Message, type MessageCode } from '../messages/catalog';
import { en } from '../messages/en';
import type { Version } from '../version';

/** 메시지 한 건 — code 는 기계가, message 는 사람이 읽는다. params 값은 표시용 문자열 · 숫자 · 문자열 배열 (D23) */
export interface WireMessage { code: MessageCode; field?: string; params?: Record<string, string | number | string[]>; message: string }

export interface WireRule { min_length: number; max_length: number; pattern: string; pattern_flags: string; allowed: string; doc_url: string; notes: WireMessage[] }
export interface WireName {
  name: string; valid: boolean; is_truncated: boolean; is_transformed: boolean; original: string;
  violations: WireMessage[]; steps: WireMessage[]; rule: WireRule;
}
export interface WireGenerate {
  success: true;
  version: Version;
  data: Partial<Record<Provider, Record<string, WireName>>>;
  metadata: {
    generated_labels: Partial<Record<Provider, Record<string, string>>>;
    label_violations: Partial<Record<Provider, WireMessage[]>>;
    label_transformed: Partial<Record<Provider, WireMessage[]>>;
    transformed: WireMessage[];
  };
}
/** /v1/names 항목 — WireName 앞에 키 · 유형 · 순번/역할 · 배치 범위 · 고유성 (D39 · codex #9) */
export interface WireNameItem extends WireName {
  key: string; resource_type: string; seq?: string; role?: string; scope: ScopeId; uniqueness: 'csp' | 'none';
}
export interface WireNamesProvider { valid: boolean; items: WireNameItem[]; conflicts: WireMessage[] }
export interface WireNames extends Omit<WireGenerate, 'data'> { data: Partial<Record<Provider, WireNamesProvider>> }
export interface WireValidate { valid: boolean; version: Version; violations: WireMessage[]; suggested_name?: string }

/** provider 하나의 결과 — 라우터가 요청 providers 순서대로 만든다. data 와 metadata 셋의 provider 집합이 같아지는 자리다 */
export interface ProviderResult { provider: Provider; names: Record<string, NameResult>; labels: LabelSet }

/** 키 순서는 code · field · params · message. field · params 가 없는 코드는 그 키도 없다 */
export function toWireMessage(raw: Message, catalog: Catalog = en): WireMessage {
  // params 의 사용자 값은 보이지 않는 문자를 \uXXXX 로 바꾼 뒤 싣는다 — message 도 같은 값으로 만든다 (리뷰 S2)
  const m = displayMessage(raw);
  return {
    code: m.code,
    ...('field' in m ? { field: m.field } : {}),
    ...('params' in m ? { params: { ...m.params } } : {}),
    message: format(m, catalog),
  };
}

const wire = (ms: readonly Message[], catalog: Catalog): WireMessage[] => ms.map((m) => toWireMessage(m, catalog));

export function toWireName(r: NameResult, catalog: Catalog = en): WireName {
  const { minLength, maxLength, pattern, patternFlags, allowed, docUrl, notes } = r.rule;
  return {
    name: r.name, valid: r.valid, is_truncated: r.isTruncated, is_transformed: r.isTransformed, original: r.original,
    violations: wire(r.violations, catalog), steps: wire(r.steps, catalog),
    rule: { min_length: minLength, max_length: maxLength, pattern, pattern_flags: patternFlags, allowed, doc_url: docUrl, notes: wire(notes, catalog) },
  };
}

export function toWireGenerate(results: ProviderResult[], transformed: readonly Message[], version: Version, catalog: Catalog = en): WireGenerate {
  const w: WireGenerate = {
    success: true, version: { ...version }, data: {},
    metadata: { generated_labels: {}, label_violations: {}, label_transformed: {}, transformed: wire(transformed, catalog) },
  };
  for (const { provider, names, labels } of results) {
    w.data[provider] = Object.fromEntries(Object.entries(names).map(([type, r]) => [type, toWireName(r, catalog)]));
    w.metadata.generated_labels[provider] = labels.labels;
    w.metadata.label_violations[provider] = wire(labels.violations, catalog);
    w.metadata.label_transformed[provider] = wire(labels.transformed, catalog);
  }
  return w;
}

export function toWireValidate(r: { valid: boolean; violations: readonly Message[]; suggestedName?: string }, version: Version, catalog: Catalog = en): WireValidate {
  return {
    valid: r.valid, version: { ...version }, violations: wire(r.violations, catalog),
    ...(r.suggestedName !== undefined ? { suggested_name: r.suggestedName } : {}),
  };
}

/** POST /v1/names — rules 는 라우터가 고른 선택의 규칙(시험 전용 규칙도 여기서 찾는다). 항목의 scope · uniqueness 는 그 규칙에서 */
export function toWireNames(result: ManyResult, rules: readonly ResourceRule[], labels: LabelSet, transformed: readonly Message[], version: Version, catalog: Catalog = en): WireNames {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const items = result.items.map((it): WireNameItem => {
    const rule = byId.get(it.ruleId);
    if (!rule) throw new Error(`no rule for item ${it.key}`);
    return {
      key: it.key, resource_type: it.resourceType,
      ...(it.seq !== undefined ? { seq: it.seq } : {}),
      ...(it.role !== undefined ? { role: it.role } : {}),
      scope: rule.scope, uniqueness: rule.uniqueness,
      ...toWireName(it, catalog),
    };
  });
  const p = result.provider;
  return {
    success: true, version: { ...version },
    data: { [p]: { valid: result.valid, items, conflicts: wire(result.conflicts, catalog) } },
    metadata: {
      generated_labels: { [p]: labels.labels },
      label_violations: { [p]: wire(labels.violations, catalog) },
      label_transformed: { [p]: wire(labels.transformed, catalog) },
      transformed: wire(transformed, catalog),
    },
  };
}
