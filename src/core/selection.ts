// 선택 검증 (D40) — API(parseNamesBody) · 화면(스테퍼 · 복원) · 공유 hash 디코더가 이 함수 하나를 부른다.
// 화면은 API 를 거치지 않으므로(D17) 검사를 한 자리에 두어야 세 호출자의 판정이 같다
import { rulesFor } from './constraints';
import type { CoreMessage } from './messages';
import { inputKind } from './tree';
import type { Provider, ResourceRule } from './types';

/** 슬롯 하나에 딸린 것 (D62) — 종류별 한 묶음. boot · ip · ipi 는 켜면 true, data 는 디스크 순번("01"…) 배열 */
export interface Attachments { boot?: true; data?: readonly string[]; ip?: true; ipi?: true }
/** 인스턴스 슬롯 (D61) — 순번은 슬롯의 값이다(셈이 아니다). 슬롯을 지워도 남은 순번은 그대로다 */
export interface InstanceSlot { seq: string; attach?: Attachments }

/** kind 는 종류 값 이름(POSTGRES) — 그 규칙의 kinds.allowed 안이다 (D52).
 *  tier · level · instances 는 마법사 모델만 채운다 (D60 · D63 · D61) — validateSelection 은 이 셋을 만들지 않고 /v1/names 의 입력도 그대로다.
 *  검사는 마법사 모델의 검사 함수가 한다 */
export interface SelectionItem {
  rule: ResourceRule; count: number; role?: string; kind?: string;
  tier?: string;
  /** 멀티 · 이중 리전 코드(D78) — 마법사 pick 만. 문맥의 지역 대신 이름에 든다 */
  location?: string;
  level?: 'project';
  instances?: readonly InstanceSlot[];
}

/** 한 요청의 항목 수 · 이름 수(Σ count) · 항목 하나의 개수 상한. 200 은 화면 · 링크 길이의 상한이지 응답 크기 보장이 아니다 */
export const MAX_ITEMS = 200;
export const MAX_NAMES = 200;
export const MAX_COUNT = 99;
export const ROLE_PATTERN = /^[a-z0-9]{2,16}$/;
/** 슬롯 순번 · 디스크 순번의 꼴 (D61 · D62) — 두 자리 01~99. 00 · 7 · 100 은 거부한다. 마법사 모델 검사 · hash 디코더 · 화면이 같은 상수를 쓴다 */
export const SEQ_PATTERN = /^(0[1-9]|[1-9][0-9])$/;

/** 사용자 값을 표시용 문자열로 — 문자열은 그대로, 나머지는 String(). String() 은 호출 불가능한 toString 을 가진 객체({"toString":1})에서 던지므로 그때는 typeof */
const shown = (v: unknown): string => {
  if (typeof v === 'string') return v;
  try {
    return String(v);
  } catch {
    return typeof v;
  }
};

/** 검사 순서: 배열 → 비어 있지 않음 → 항목 수 → 항목마다(객체 · type · 중복 · count · 입력 종류 · role 꼴 · 종류) → Σ count. 오류는 index 순으로 모두 낸다.
 *  종류(D52) — 종류 표 없는 규칙에 kind 면 kind_not_supported, 그 범위의 allowed 밖이면 unknown_kind, 필수 종류(리소스 정책)가 없으면 kind_required.
 *  rules 는 기본이 규칙 표 — 화면의 시험 전용 fixture 가 다른 표를 넘긴다. 다른 provider 규칙은 거른다 */
export function validateSelection(provider: Provider, raw: unknown, table: readonly ResourceRule[] = rulesFor(provider)):
  { ok: true; items: SelectionItem[] } | { ok: false; errors: CoreMessage[] } {
  if (!Array.isArray(raw)) return { ok: false, errors: [{ code: 'selection.not_array' }] };
  if (raw.length === 0) return { ok: false, errors: [{ code: 'selection.empty' }] };
  if (raw.length > MAX_ITEMS) return { ok: false, errors: [{ code: 'selection.too_many_items', params: { max: MAX_ITEMS } }] };

  const rules = table.filter((r) => r.provider === provider);
  const errors: CoreMessage[] = [];
  const items: SelectionItem[] = [];
  const seen = new Set<string>();
  raw.forEach((entry: unknown, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) { errors.push({ code: 'selection.item_not_object', params: { index } }); return; }
    const { type, count, role, kind } = entry as { type?: unknown; count?: unknown; role?: unknown; kind?: unknown };
    const rule = typeof type === 'string' ? rules.find((r) => r.resourceType === type) : undefined;
    if (!rule) { errors.push({ code: 'selection.unknown_type', params: { index, value: shown(type) } }); return; }
    if (seen.has(rule.resourceType)) { errors.push({ code: 'selection.duplicate_type', params: { index, value: rule.resourceType } }); return; }
    seen.add(rule.resourceType);

    const before = errors.length;
    const n = count === undefined ? 1 : count;
    const input = inputKind(rule);
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_COUNT) {
      errors.push({ code: 'selection.count_out_of_range', params: { index, min: 1, max: MAX_COUNT } });
    } else if (n > 1 && input !== 'count') {
      errors.push({ code: 'selection.count_not_supported', params: { index, type: rule.resourceType } });
    }
    if (role !== undefined) {
      if (input !== 'role') errors.push({ code: 'selection.role_not_supported', params: { index, type: rule.resourceType } });
      else if (typeof role !== 'string' || !ROLE_PATTERN.test(role)) errors.push({ code: 'selection.invalid_role', params: { index, value: shown(role), pattern: ROLE_PATTERN.source } });
    }
    const kinds = rule.kinds;
    if (kind !== undefined) {
      if (!kinds) errors.push({ code: 'selection.kind_not_supported', params: { index, type: rule.resourceType } });
      else if (typeof kind !== 'string' || !kinds.allowed.includes(kind)) {
        errors.push({ code: 'selection.unknown_kind', params: { index, type: rule.resourceType, value: shown(kind), supported: [...kinds.allowed] } });
      }
    } else if (kinds?.rule === 'required') {
      errors.push({ code: 'selection.kind_required', params: { index, type: rule.resourceType, supported: [...kinds.allowed] } });
    }
    if (errors.length === before) {
      items.push({ rule, count: n as number, ...(role === undefined ? {} : { role: role as string }), ...(kind === undefined ? {} : { kind: kind as string }) });
    }
  });

  const total = items.reduce((s, i) => s + i.count, 0);
  if (total > MAX_NAMES) errors.push({ code: 'selection.too_many_names', params: { max: MAX_NAMES, actual: total } });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, items };
}
