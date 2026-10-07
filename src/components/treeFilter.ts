// 트리 거르기 — 검색 · 분류 칩 · 「API only」 칩 · 「선택만 보기」. 트리(core buildTree)를 읽기만 하고 걸러진 사본을 만든다.
// 거르는 단위는 화면 행(TreeRow)이다 — 합친 행은 규칙 하나만 맞아도 행째 남는다 (D53)
import type { TreeNode, TreeRow } from '../core/tree';
import type { Category } from '../core/types';
import type { ScopeDef } from '../core/scopes';
import type { Picked } from './selection';

/** 분류 칩 순서 — Category 유니언 순서 */
export const CATEGORIES: readonly Category[] = ['compute', 'networking', 'storage', 'database', 'identity', 'security', 'management', 'containers'];

/** apiOnly — 「API only」 칩(D54). 기본은 꺼져 있어 그 행들도 트리에 보인다(접지 않는다) */
export interface TreeFilter { query: string; category?: Category; selectedOnly: boolean; apiOnly?: boolean }
export interface ViewNode { scope: ScopeDef; rows: TreeRow[]; children: ViewNode[]; total: number }

export const isFiltering = (f: TreeFilter): boolean => f.query.trim() !== '' || f.category !== undefined || f.selectedOnly || f.apiOnly === true;

/** catalog 표지 「api-only」 — 콘솔 · gcloud 로 만들 수 없고 API · Terraform 으로만 만든다 */
export const isApiOnly = (row: TreeRow): boolean => row.catalog?.badges.includes('api-only') ?? false;

/** 행의 규칙 하나라도 고른 상태인가 */
export const isRowPicked = (row: TreeRow, picked: Picked): boolean => row.rules.some((r) => picked.has(r.resourceType));

/** 행 이름 · key 와 규칙마다 displayName · resourceType · slug · entity, catalog 행의 aliases(Terraform 타입 · gcloud 그룹 · 옛 약어)를 소문자 부분 일치로 */
export function matchesQuery(row: TreeRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  const fields = [row.displayName, row.key, ...row.rules.flatMap((r) => [r.displayName, r.resourceType, r.slug, r.entity]), ...(row.catalog?.aliases ?? [])];
  return fields.some((s) => s.toLowerCase().includes(q));
}

/** 걸러진 트리 — 거르는 중이면 행이 없는 범위를 뺀다(조상만 남는다). 아무 행도 없으면 undefined. 거르지 않으면 빈 범위도 그대로 */
export function filterTree(tree: TreeNode, f: TreeFilter, picked: Picked): ViewNode | undefined {
  const filtering = isFiltering(f);
  const keep = (r: TreeRow) => matchesQuery(r, f.query) && (f.category === undefined || r.category === f.category)
    && (!f.selectedOnly || isRowPicked(r, picked)) && (f.apiOnly !== true || isApiOnly(r));
  const walk = (n: TreeNode): ViewNode | undefined => {
    const rows = filtering ? n.rows.filter(keep) : n.rows;
    const children = n.children.map(walk).filter((c): c is ViewNode => c !== undefined);
    const total = rows.length + children.reduce((s, c) => s + c.total, 0);
    if (filtering && total === 0) return undefined;
    return { scope: n.scope, rows, children, total };
  };
  return walk(tree);
}

/** 분류별 행 수 — CATEGORIES 순서 · 0 인 분류는 빼서 칩을 만들지 않는다 */
export function categoryCounts(tree: TreeNode): Map<Category, number> {
  const counts = new Map<Category, number>();
  const walk = (n: TreeNode) => {
    for (const r of n.rows) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    n.children.forEach(walk);
  };
  walk(tree);
  return new Map(CATEGORIES.flatMap((c) => (counts.has(c) ? [[c, counts.get(c)!] as const] : [])));
}

/** 「API only」 표지 행 수 — 칩에 적는다. 0 이면 칩을 그리지 않는다 */
export function apiOnlyCount(tree: TreeNode): number {
  return tree.rows.filter(isApiOnly).length + tree.children.reduce((s, c) => s + apiOnlyCount(c), 0);
}
