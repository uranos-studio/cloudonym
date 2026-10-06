// 화면의 선택 상태 (D40 · D42) — resourceType → { count, role } Map 하나. 트리 행은 이것을 읽기만 한다 (계획 §7-4).
// 바꿀 때마다 core validateSelection 으로 판정한다 — API · hash 디코더와 같은 함수라 세 호출자의 판정이 같다
import { DEFAULT_ROLE } from '../core/engine';
import { MAX_COUNT, MAX_ITEMS, MAX_NAMES, validateSelection, type SelectionItem } from '../core/selection';
import { inputKind, type TreeNode } from '../core/tree';
import type { Provider, ResourceRule } from '../core/types';

export interface PickedEntry { count: number; role?: string }
export type Picked = ReadonlyMap<string, PickedEntry>;

/** 트리 순서(전위 — 노드의 규칙 → 자식 범위) — 범위 경로 → 규칙 표 순서 (계획 §7-5) */
export function treeRules(tree: TreeNode): ResourceRule[] {
  return [...tree.rules, ...tree.children.flatMap(treeRules)];
}

/** 선택 → 엔진 입력. 순서는 트리 순서 — 고른 순서와 무관하다 */
export function toItems(tree: TreeNode, picked: Picked): SelectionItem[] {
  return treeRules(tree).flatMap((rule): SelectionItem[] => {
    const e = picked.get(rule.resourceType);
    if (!e) return [];
    return e.role === undefined ? [{ rule, count: e.count }] : [{ rule, count: e.count, role: e.role }];
  });
}

export function fromItems(items: readonly SelectionItem[]): Picked {
  return new Map(items.map((i) => [i.rule.resourceType, i.role === undefined ? { count: i.count } : { count: i.count, role: i.role }]));
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

/** 켜면 count 1(role 규칙은 기본 역할), 켜져 있으면 끈다. 입력을 바꾸지 않는다 */
export function toggle(picked: Picked, rule: ResourceRule): Picked {
  const next = new Map(picked);
  if (next.has(rule.resourceType)) next.delete(rule.resourceType);
  else next.set(rule.resourceType, inputKind(rule) === 'role' ? { count: 1, role: DEFAULT_ROLE } : { count: 1 });
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

/** 바뀐 선택을 core 로 판정한다 — 맞으면 그대로, 틀리면 undefined(화면은 이전 상태를 둔다). 빈 선택은 「선택 없음」으로 받는다 */
export function applyChange(provider: Provider, tree: TreeNode, next: Picked, rules?: readonly ResourceRule[]): Picked | undefined {
  if (next.size === 0) return next;
  const raw = toItems(tree, next).map((i) => (i.role === undefined ? { type: i.rule.resourceType, count: i.count } : { type: i.rule.resourceType, count: i.count, role: i.role }));
  // 트리에 없는 type(다른 provider 의 것 등)은 toItems 가 빼므로 여기서 수가 다르면 틀린 선택이다
  if (raw.length !== next.size) return undefined;
  return validateSelection(provider, raw, rules).ok ? next : undefined;
}

/** CSP 를 바꾸면 선택을 비운다 — 규칙 id 가 provider 에 묶여 있어 옮길 수 없다 (계획 §7-1) */
export function clearForCloudSwitch(): Picked {
  return new Map();
}
