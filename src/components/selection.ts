// 화면의 선택 상태 (D40 · D42 · D52 · D53) — resourceType → { count, role, kind } Map 하나. 트리 행은 이것을 읽기만 한다.
// 키는 규칙의 resourceType 이다 — 화면 행(catalog 행)은 규칙이 여럿일 수 있지만 행마다 키는 하나다(범위를 골라 규칙 하나로 정한다).
// 바꿀 때마다 core validateSelection 으로 판정한다 — API · hash 디코더와 같은 함수라 세 호출자의 판정이 같다
import { DEFAULT_ROLE } from '../core/engine';
import { MAX_COUNT, MAX_ITEMS, MAX_NAMES, validateSelection, type SelectionItem } from '../core/selection';
import { inputKind, rowRules, type TreeNode, type TreeRow } from '../core/tree';
import { regionTokenOf, rowOf } from '../core/catalog';
import type { Provider, ResourceRule, ScopeId } from '../core/types';

/** kind 는 고른 종류 값 이름(POSTGRES) — 고르지 않았거나 기본값을 고르면 없다(이름이 같으므로 hash 를 늘리지 않는다) */
export interface PickedEntry { count: number; role?: string; kind?: string }
export type Picked = ReadonlyMap<string, PickedEntry>;

/** 트리 순서(전위 — 노드의 행 → 자식 범위) — 범위 경로 → 행 순서 → 행 안의 catalog 규칙 순서 */
export function treeRules(tree: TreeNode): ResourceRule[] {
  return [...tree.rows.flatMap((row) => row.rules), ...tree.children.flatMap(treeRules)];
}

/** 선택 → 엔진 입력. 순서는 트리 순서 — 고른 순서와 무관하다 */
export function toItems(tree: TreeNode, picked: Picked): SelectionItem[] {
  return treeRules(tree).flatMap((rule): SelectionItem[] => {
    const e = picked.get(rule.resourceType);
    if (!e) return [];
    return [{ rule, ...entryOf(e) }];
  });
}

/** 없는 칸은 키째 뺀다 — 엔진 입력 · 상태 비교가 키 유무까지 본다 */
function entryOf(e: { count: number; role?: string; kind?: string }): PickedEntry {
  return { count: e.count, ...(e.role === undefined ? {} : { role: e.role }), ...(e.kind === undefined ? {} : { kind: e.kind }) };
}

/** 엔진 입력 → 상태. 기본값 종류(손으로 만든 링크의 「2:EXTERNAL」)는 담지 않는다 — 화면에서 고른 것과 같은 상태가 된다 */
export function fromItems(items: readonly SelectionItem[]): Picked {
  return new Map(items.map((i) => [i.rule.resourceType, entryOf({ ...i, kind: storedKind(i.rule, i.kind) })]));
}

export function totalNames(picked: Picked): number {
  let n = 0;
  for (const e of picked.values()) n += e.count;
  return n;
}

/** 새 항목을 더할 수 있는가 — 항목 수 · 이름 수 상한 (core 상수) */
export function canAdd(picked: Picked): boolean {
  return picked.size < MAX_ITEMS && totalNames(picked) < MAX_NAMES;
}

/** + 를 누를 수 있는가 — count 규칙 · 고른 항목 · 한 항목 99 · Σ 200 */
export function canIncrease(picked: Picked, rule: ResourceRule): boolean {
  const e = picked.get(rule.resourceType);
  return inputKind(rule) === 'count' && e !== undefined && e.count < MAX_COUNT && totalNames(picked) < MAX_NAMES;
}

/** 켜면 count 1(role 규칙은 기본 역할 · 행에서 고른 종류), 켜져 있으면 끈다. 입력을 바꾸지 않는다 */
export function toggle(picked: Picked, rule: ResourceRule, kind?: string): Picked {
  const next = new Map(picked);
  if (next.has(rule.resourceType)) next.delete(rule.resourceType);
  else next.set(rule.resourceType, entryOf({ count: 1, ...(inputKind(rule) === 'role' ? { role: DEFAULT_ROLE } : {}), kind: storedKind(rule, kind) }));
  return next;
}

export function setCount(picked: Picked, rule: ResourceRule, count: number): Picked {
  const e = picked.get(rule.resourceType);
  if (!e) return picked;
  return new Map(picked).set(rule.resourceType, { ...e, count });
}

export function setRole(picked: Picked, rule: ResourceRule, role: string): Picked {
  const e = picked.get(rule.resourceType);
  if (!e) return picked;
  return new Map(picked).set(rule.resourceType, { ...e, role });
}

/** 종류를 바꾼다 — 빈 칸 · 기본값이면 지운다 */
export function setKind(picked: Picked, rule: ResourceRule, kind: string | undefined): Picked {
  const e = picked.get(rule.resourceType);
  if (!e) return picked;
  return new Map(picked).set(rule.resourceType, entryOf({ count: e.count, role: e.role, kind: storedKind(rule, kind) }));
}

/** 종류 select 의 빈 칸 — 종류를 고르지 않은 상태를 무엇으로 보이나: 그 범위의 CSP 기본값 · 토큰 없음 · 아직 고르지 않음(필수) */
export type KindBlank = { type: 'default'; value: string } | { type: 'none' } | { type: 'choose' };
export interface KindChoices { blank: KindBlank; options: readonly string[] }

/** 행의 종류 select (D52 · 6-3) — 항목은 그 규칙(= 범위)의 allowed. 기본값은 빈 칸이 맡으므로 목록에서 뺀다. 종류 표가 없으면 undefined */
export function kindChoices(rule: ResourceRule): KindChoices | undefined {
  const k = rule.kinds;
  if (!k) return undefined;
  if (k.rule === 'required') return { blank: { type: 'choose' }, options: k.allowed };
  if (k.default !== null) return { blank: { type: 'default', value: k.default }, options: k.allowed.filter((v) => v !== k.default) };
  return { blank: { type: 'none' }, options: k.allowed };
}

/** 상태의 종류 → select 의 값. 없음 · 기본값은 빈 칸('') */
export function kindSelectValue(rule: ResourceRule, kind: string | undefined): string {
  return storedKind(rule, kind) ?? '';
}

/** 필수 종류인데 아직 고르지 않았는가 — 그동안 행을 체크할 수 없다 */
export function needsKind(rule: ResourceRule, kind: string | undefined): boolean {
  return rule.kinds?.rule === 'required' && storedKind(rule, kind) === undefined;
}

/** 상태에 담을 종류 — 빈 칸('') · 기본값은 담지 않는다 */
function storedKind(rule: ResourceRule, kind: string | undefined): string | undefined {
  return kind === undefined || kind === '' || kind === rule.kinds?.default ? undefined : kind;
}

/** 바뀐 선택을 core 로 판정한다 — 맞으면 그대로, 틀리면 undefined(화면은 이전 상태를 둔다). 빈 선택은 「선택 없음」으로 받는다.
 *  한 행의 키가 둘이면 받지 않는다 — 화면 · hash 는 행마다 규칙 하나다(D53. API 는 둘을 받는다) */
export function applyChange(provider: Provider, tree: TreeNode, next: Picked, rules?: readonly ResourceRule[]): Picked | undefined {
  if (next.size === 0) return next;
  const items = toItems(tree, next);
  // 트리에 없는 type(다른 provider 의 것 등)은 toItems 가 빼므로 여기서 수가 다르면 틀린 선택이다
  if (items.length !== next.size) return undefined;
  if (new Set(items.map((i) => rowKeyOf(i.rule))).size !== items.length) return undefined;
  const raw = items.map(({ rule, ...e }) => ({ type: rule.resourceType, ...e }));
  return validateSelection(provider, raw, rules).ok ? next : undefined;
}

/** 규칙이 속한 화면 행의 key — catalog 행이 없으면 규칙 id (core/tree 의 treeRows 와 같은 key) */
export const rowKeyOf = (rule: ResourceRule): string => rowOf(rule.id)?.key ?? rule.id;

/** 행에서 아직 체크하지 않았을 때 들고 있는 값 — 고른 범위 · 종류. 행이 걸러져 사라져도 남도록 트리가 행 key 로 든다 */
export interface RowDraft { scope?: ScopeId; kind?: string }
/** 행을 새로 체크할 수 없는 까닭 — 범위 미선택(D53) · 필수 종류 미선택(D52) · 존 없음(D50) · 상한 */
export type RowBlock = 'scope' | 'kind' | 'zone' | 'limit';

/** 존 규칙인가 — 지역 자리에 존 코드가 든다(catalog regionToken 'zone') */
export const isZonal = (rule: ResourceRule): boolean => regionTokenOf(rule) === 'zone';

/** 행의 규칙 중 선택에 든 것 — 행마다 하나뿐이다(applyChange · hash 디코더가 지킨다) */
export function pickedRule(row: TreeRow, picked: Picked): ResourceRule | undefined {
  return row.rules.find((r) => picked.has(r.resourceType));
}

/** 행이 지금 가리키는 규칙 — 고른 행은 그 규칙, 아니면 규칙이 하나면 그것 · 여럿이면 draft 의 범위 규칙(고르지 않았으면 없다) */
export function activeRule(row: TreeRow, picked: Picked, draft: RowDraft): ResourceRule | undefined {
  const p = pickedRule(row, picked);
  if (p) return p;
  if (row.rules.length === 1) return row.rules[0];
  return draft.scope === undefined ? undefined : rowRules(row, draft.scope)[0];
}

/** 행을 새로 체크할 수 없는 까닭 — 고른 행은 없다(끄기는 늘 된다). zoneMissing 은 문맥에 존이 없다는 뜻 */
export function rowBlock(row: TreeRow, picked: Picked, draft: RowDraft, zoneMissing: boolean): RowBlock | undefined {
  if (pickedRule(row, picked)) return undefined;
  const rule = activeRule(row, picked, draft);
  if (!rule) return 'scope';
  if (needsKind(rule, draft.kind)) return 'kind';
  if (zoneMissing && isZonal(rule)) return 'zone';
  if (!canAdd(picked)) return 'limit';
  return undefined;
}

export const canCheck = (row: TreeRow, picked: Picked, draft: RowDraft, zoneMissing: boolean): boolean => rowBlock(row, picked, draft, zoneMissing) === undefined;

/** 행의 체크 상자 — 고른 행은 끈다(늘 된다), 아니면 막힌 까닭이 없을 때만 draft 의 범위 · 종류로 켠다. 막히면 같은 Map 을 돌려준다 */
export function toggleRow(picked: Picked, row: TreeRow, draft: RowDraft, zoneMissing: boolean): Picked {
  const p = pickedRule(row, picked);
  if (p) return toggle(picked, p);
  if (rowBlock(row, picked, draft, zoneMissing) !== undefined) return picked;
  return toggle(picked, activeRule(row, picked, draft)!, draft.kind);
}

/** 종류를 새 규칙의 allowed 로 거른다 — 맞지 않으면 버리고 dropped. 기본값 · 빈 칸은 담지 않는다 */
export function refilterKind(rule: ResourceRule, kind: string | undefined): { kind: string | undefined; dropped: boolean } {
  if (kind === undefined) return { kind: undefined, dropped: false };
  if (!(rule.kinds?.allowed ?? []).includes(kind)) return { kind: undefined, dropped: true };
  return { kind: storedKind(rule, kind), dropped: false };
}

/** 고른 행의 범위를 바꾼다 (D53) — 옛 키를 지우고 새 키에 count · 역할을 옮기고 종류는 새 규칙의 allowed 로 거른다.
 *  고르지 않은 행 · 같은 범위면 그대로. 존이 없을 때 존 규칙으로 옮기는 것은 존 항목을 새로 만드는 일이라 막는다(undefined — D50) */
export function setRowScope(picked: Picked, row: TreeRow, scope: ScopeId, zoneMissing: boolean): { picked: Picked; kindDropped: boolean } | undefined {
  const from = pickedRule(row, picked);
  const to = rowRules(row, scope)[0];
  if (!from || !to || from === to) return { picked, kindDropped: false };
  if (zoneMissing && isZonal(to)) return undefined;
  const e = picked.get(from.resourceType)!;
  const { kind, dropped } = refilterKind(to, e.kind);
  const next = new Map(picked);
  next.delete(from.resourceType);
  next.set(to.resourceType, entryOf({ count: e.count, role: e.role, kind }));
  return { picked: next, kindDropped: dropped };
}

/** CSP 를 바꾸면 선택을 비운다 — 규칙 id 가 provider 에 묶여 있어 옮길 수 없다 */
export function clearForCloudSwitch(): Picked {
  return new Map();
}
