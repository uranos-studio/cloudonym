// 트리 거르기 — 검색 · 분류 칩 · 「선택만 보기」. 트리(core buildTree)를 읽기만 하고 걸러진 사본을 만든다
import type { TreeNode } from '../core/tree';
import type { Category, ResourceRule } from '../core/types';
import type { ScopeDef } from '../core/scopes';
import type { Picked } from './selection';

/** 분류 칩 순서 — Category 유니언 순서 */
export const CATEGORIES: readonly Category[] = ['compute', 'networking', 'storage', 'database', 'identity', 'security', 'management', 'containers'];

export interface TreeFilter { query: string; category?: Category; selectedOnly: boolean }
export interface ViewNode { scope: ScopeDef; rules: ResourceRule[]; children: ViewNode[]; total: number }

export const isFiltering = (f: TreeFilter): boolean => f.query.trim() !== '' || f.category !== undefined || f.selectedOnly;

/** displayName · resourceType · slug · entity 를 소문자 부분 일치로 */
export function matchesQuery(rule: ResourceRule, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return [rule.displayName, rule.resourceType, rule.slug, rule.entity].some((s) => s.toLowerCase().includes(q));
}

/** 걸러진 트리 — 거르는 중이면 행이 없는 범위를 뺀다(조상만 남는다). 아무 행도 없으면 undefined. 거르지 않으면 빈 범위도 그대로 */
export function filterTree(tree: TreeNode, f: TreeFilter, picked: Picked): ViewNode | undefined {
  const filtering = isFiltering(f);
  const keep = (r: ResourceRule) => matchesQuery(r, f.query) && (f.category === undefined || r.category === f.category) && (!f.selectedOnly || picked.has(r.resourceType));
  const walk = (n: TreeNode): ViewNode | undefined => {
    const rules = filtering ? n.rules.filter(keep) : n.rules;
    const children = n.children.map(walk).filter((c): c is ViewNode => c !== undefined);
    const total = rules.length + children.reduce((s, c) => s + c.total, 0);
    if (filtering && total === 0) return undefined;
    return { scope: n.scope, rules, children, total };
  };
  return walk(tree);
}

/** 분류별 규칙 수 — CATEGORIES 순서 · 0 인 분류는 빼서 칩을 만들지 않는다 */
export function categoryCounts(tree: TreeNode): Map<Category, number> {
  const counts = new Map<Category, number>();
  const walk = (n: TreeNode) => {
    for (const r of n.rules) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    n.children.forEach(walk);
  };
  walk(tree);
  return new Map(CATEGORIES.flatMap((c) => (counts.has(c) ? [[c, counts.get(c)!] as const] : [])));
}
