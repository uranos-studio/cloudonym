// 코어(camelCase) → wire(snake_case) (D15 · D25). 이름 규칙 · 판정 로직은 여기 없다 — 필드 이름을 바꾸고 메시지 코드에 문장을 붙인다
import type { LabelSet, NameResult, Provider, ResourceRule, ScopeId } from '../core/types';
import type { ManyResult, ProjectResult } from '../core/engine';
import { RULES } from '../core/constraints';
import type { AttachKind } from '../core/wizard/attachments';
import { displayMessage, format, type Catalog, type Message, type MessageCode } from '../messages/catalog';
import { en } from '../messages/en';
import type { Version } from '../version';

/** 메시지 한 건 — code 는 기계가, message 는 사람이 읽는다. params 값은 표시용 문자열 · 숫자 · 문자열 배열 (D23) */
export interface WireMessage { code: MessageCode; field?: string; params?: Record<string, string | number | string[]>; message: string }

export interface WireRule { min_length: number; max_length: number; pattern: string; pattern_flags: string; allowed: string; doc_url: string; notes: WireMessage[] }
export interface WireName {
  name: string; valid: boolean; is_truncated: boolean; is_transformed: boolean; original: string;
  violations: WireMessage[]; warnings?: WireMessage[]; steps: WireMessage[]; rule: WireRule;
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
/** /v1/names 항목 — WireName 앞에 키 · 유형 · 순번/역할 · 종류 · 배치 범위 · 고유성 (D39 · D52).
 *  kind 는 고른 값 이름 · kind_token 은 이름에 넣은 토큰 — 기본값을 고르면 kind 만 있다 */
export interface WireNameItem extends WireName {
  key: string; resource_type: string; seq?: string; role?: string; kind?: string; kind_token?: string; scope: ScopeId; uniqueness: 'csp' | 'none';
}
export interface WireNamesProvider { valid: boolean; items: WireNameItem[]; conflicts: WireMessage[] }
export interface WireNames extends Omit<WireGenerate, 'data'> { data: Partial<Record<Provider, WireNamesProvider>> }
/** warnings 는 있을 때만 — 보낸 이름이 문서가 권고하지 않는 꼴. suggested_warnings 는 suggested_name 의 것. valid 를 바꾸지 않는다 (D112) */
export interface WireValidate { valid: boolean; version: Version; violations: WireMessage[]; warnings?: WireMessage[]; suggested_name?: string; suggested_warnings?: WireMessage[] }

/** provider 하나의 결과 — 라우터가 요청 providers 순서대로 만든다. data 와 metadata 셋의 provider 집합이 같아지는 자리다 */
export interface ProviderResult { provider: Provider; names: Record<string, NameResult>; labels: LabelSet }

/** 키 순서는 code · field · params · message. field · params 가 없는 코드는 그 키도 없다 */
export function toWireMessage(raw: Message, catalog: Catalog = en): WireMessage {
  // params 의 사용자 값은 보이지 않는 문자를 \uXXXX 로 바꾼 뒤 싣는다 — message 도 같은 값으로 만든다
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
    violations: wire(r.violations, catalog), ...(r.warnings !== undefined ? { warnings: wire(r.warnings, catalog) } : {}), steps: wire(r.steps, catalog),
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

export function toWireValidate(r: { valid: boolean; violations: readonly Message[]; warnings?: readonly Message[]; suggestedName?: string; suggestedWarnings?: readonly Message[] }, version: Version, catalog: Catalog = en): WireValidate {
  return {
    valid: r.valid, version: { ...version }, violations: wire(r.violations, catalog),
    ...(r.warnings !== undefined ? { warnings: wire(r.warnings, catalog) } : {}),
    ...(r.suggestedName !== undefined ? { suggested_name: r.suggestedName } : {}),
    ...(r.suggestedWarnings !== undefined ? { suggested_warnings: wire(r.suggestedWarnings, catalog) } : {}),
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
      ...(it.kind !== undefined ? { kind: it.kind } : {}),
      ...(it.kindToken !== undefined ? { kind_token: it.kindToken } : {}),
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

/** /v1/wizard 항목 (D66 · D69) — WireNameItem 에 이름공간 · 프로젝트 수준 · 용도 토큰 · 부모 키 · 접미 종류. key 는 구조 키다 */
export interface WireWizardItem extends WireNameItem { namespace: string; level?: 'project'; tier?: string; parent?: string; attach?: AttachKind }
export interface WireWizardProvider { valid: boolean; items: WireWizardItem[]; conflicts: WireMessage[] }
/** 라벨은 이름공간 → 라벨 맵. 라벨 위반 · 변환은 한 목록이고 field 는 `<이름공간>.<라벨 키>` 다 */
export interface WireWizard {
  success: true;
  version: Version;
  data: Partial<Record<Provider, WireWizardProvider>>;
  metadata: {
    generated_labels: Partial<Record<Provider, Record<string, Record<string, string>>>>;
    label_violations: Partial<Record<Provider, WireMessage[]>>;
    label_transformed: Partial<Record<Provider, WireMessage[]>>;
    transformed: WireMessage[];
  };
}

/** 라벨 기록의 field 를 `<이름공간>.<키>` 로. 서비스 이름공간은 purpose 만 싣는다 — 나머지 키는 프로젝트의 값과 같아 project 에 한 번 실린다 */
function labelMessages(sets: readonly { namespace: string; labels: LabelSet }[], pick: (l: LabelSet) => readonly Message[]): Message[] {
  return sets.flatMap(({ namespace, labels }) => pick(labels)
    .filter((m) => namespace === 'project' || ('field' in m && m.field === 'purpose'))
    .map((m) => ('field' in m ? { ...m, field: `${namespace}.${m.field}` } : m) as Message));
}

/** POST /v1/wizard — 항목의 scope · uniqueness 는 그 항목의 규칙(자식은 디스크 · 주소 규칙)에서 */
export function toWireWizard(result: ProjectResult, labels: readonly { namespace: string; labels: LabelSet }[], transformed: readonly Message[], version: Version, catalog: Catalog = en): WireWizard {
  const items = result.items.map((it): WireWizardItem => {
    const rule = RULES[it.ruleId];
    if (!rule) throw new Error(`no rule for item ${it.key}`);
    if (it.namespace === undefined) throw new Error(`no namespace for item ${it.key}`);
    return {
      key: it.key, namespace: it.namespace,
      ...(it.level !== undefined ? { level: it.level } : {}),
      ...(it.parent !== undefined ? { parent: it.parent } : {}),
      ...(it.attach !== undefined ? { attach: it.attach } : {}),
      resource_type: it.resourceType,
      ...(it.tier !== undefined ? { tier: it.tier } : {}),
      ...(it.seq !== undefined ? { seq: it.seq } : {}),
      ...(it.role !== undefined ? { role: it.role } : {}),
      ...(it.kind !== undefined ? { kind: it.kind } : {}),
      ...(it.kindToken !== undefined ? { kind_token: it.kindToken } : {}),
      scope: rule.scope, uniqueness: rule.uniqueness,
      ...toWireName(it, catalog),
    };
  });
  const p = result.provider;
  return {
    success: true, version: { ...version },
    data: { [p]: { valid: result.valid, items, conflicts: wire(result.conflicts, catalog) } },
    metadata: {
      generated_labels: { [p]: Object.fromEntries(labels.map((l) => [l.namespace, l.labels.labels])) },
      label_violations: { [p]: wire(labelMessages(labels, (l) => l.violations), catalog) },
      label_transformed: { [p]: wire(labelMessages(labels, (l) => l.transformed), catalog) },
      transformed: wire(transformed, catalog),
    },
  };
}
