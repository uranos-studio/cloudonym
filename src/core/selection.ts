// 선택 검증 (D40) — API(parseNamesBody) · 화면(스테퍼 · 복원) · 공유 hash 디코더가 이 함수 하나를 부른다.
// 화면은 API 를 거치지 않으므로(D17) 검사를 한 자리에 두어야 세 호출자의 판정이 같다
import { rulesFor } from './constraints';
import type { CoreMessage } from './messages';
import { inputKind } from './tree';
import type { Provider, ResourceRule } from './types';

export interface SelectionItem { rule: ResourceRule; count: number; role?: string }

/** 한 요청의 항목 수 · 이름 수(Σ count) · 항목 하나의 개수 상한. 200 은 화면 · 링크 길이의 상한이지 응답 크기 보장이 아니다 */
export const MAX_ITEMS = 200;
export const MAX_NAMES = 200;
export const MAX_COUNT = 99;
export const ROLE_PATTERN = /^[a-z0-9]{2,16}$/;

/** 사용자 값을 표시용 문자열로 — 문자열은 그대로, 나머지는 String(). String() 은 호출 불가능한 toString 을 가진 객체({"toString":1})에서 던지므로 그때는 typeof */
const shown = (v: unknown): string => {
  if (typeof v === 'string') return v;
  try {
    return String(v);
  } catch {
    return typeof v;
  }
};

/** 검사 순서: 배열 → 비어 있지 않음 → 항목 수 → 항목마다(객체 · type · 중복 · count · 입력 종류 · role 꼴) → Σ count. 오류는 index 순으로 모두 낸다.
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
    const { type, count, role } = entry as { type?: unknown; count?: unknown; role?: unknown };
    const rule = typeof type === 'string' ? rules.find((r) => r.resourceType === type) : undefined;
    if (!rule) { errors.push({ code: 'selection.unknown_type', params: { index, value: shown(type), supported: rules.map((r) => r.resourceType) } }); return; }
    if (seen.has(rule.resourceType)) { errors.push({ code: 'selection.duplicate_type', params: { index, value: rule.resourceType } }); return; }
    seen.add(rule.resourceType);

    const before = errors.length;
    const n = count === undefined ? 1 : count;
    const kind = inputKind(rule);
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_COUNT) {
      errors.push({ code: 'selection.count_out_of_range', params: { index, min: 1, max: MAX_COUNT } });
    } else if (n > 1 && kind !== 'count') {
      errors.push({ code: 'selection.count_not_supported', params: { index, type: rule.resourceType } });
    }
    if (role !== undefined) {
      if (kind !== 'role') errors.push({ code: 'selection.role_not_supported', params: { index, type: rule.resourceType } });
      else if (typeof role !== 'string' || !ROLE_PATTERN.test(role)) errors.push({ code: 'selection.invalid_role', params: { index, value: shown(role), pattern: ROLE_PATTERN.source } });
    }
    if (errors.length === before) items.push(role === undefined ? { rule, count: n as number } : { rule, count: n as number, role: role as string });
  });

  const total = items.reduce((s, i) => s + i.count, 0);
  if (total > MAX_NAMES) errors.push({ code: 'selection.too_many_names', params: { max: MAX_NAMES, actual: total } });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, items };
}
