// 화면의 선택 상태 (D40 · D42 · D52) — resourceType → { count, role, kind } Map 하나. 트리 행은 이것을 읽기만 한다.
// 바꿀 때마다 core validateSelection 으로 판정한다 — API · hash 디코더와 같은 함수라 세 호출자의 판정이 같다
import { DEFAULT_ROLE } from '../core/engine';
import { MAX_COUNT, MAX_ITEMS, MAX_NAMES, validateSelection, type SelectionItem } from '../core/selection';
import { inputKind, type TreeNode } from '../core/tree';
import type { Provider, ResourceRule } from '../core/types';

/** kind 는 고른 종류 값 이름(POSTGRES) — 고르지 않았거나 기본값을 고르면 없다(이름이 같으므로 hash 를 늘리지 않는다) */
export interface PickedEntry { count: number; role?: string; kind?: string }
export type Picked = ReadonlyMap<string, PickedEntry>;

/** 트리 순서(전위 — 노드의 규칙 → 자식 범위) — 범위 경로 → 규칙 표 순서 */
export function treeRules(tree: TreeNode): ResourceRule[] {
  return [...tree.rules, ...tree.children.flatMap(treeRules)];
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

export function fromItems(items: readonly SelectionItem[]): Picked {
  return new Map(items.map((i) => [i.rule.resourceType, entryOf(i)]));
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

/** 바뀐 선택을 core 로 판정한다 — 맞으면 그대로, 틀리면 undefined(화면은 이전 상태를 둔다). 빈 선택은 「선택 없음」으로 받는다 */
export function applyChange(provider: Provider, tree: TreeNode, next: Picked, rules?: readonly ResourceRule[]): Picked | undefined {
  if (next.size === 0) return next;
  const raw = toItems(tree, next).map(({ rule, ...e }) => ({ type: rule.resourceType, ...e }));
  // 트리에 없는 type(다른 provider 의 것 등)은 toItems 가 빼므로 여기서 수가 다르면 틀린 선택이다
  if (raw.length !== next.size) return undefined;
  return validateSelection(provider, raw, rules).ok ? next : undefined;
}

/** CSP 를 바꾸면 선택을 비운다 — 규칙 id 가 provider 에 묶여 있어 옮길 수 없다 */
export function clearForCloudSwitch(): Picked {
  return new Map();
}
