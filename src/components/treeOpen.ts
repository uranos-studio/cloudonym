// 트리 펼침 상태 — 열린 범위 id 와 닫힌 분류 묶음 id. 화면은 이 꼴을 둘 둔다 — 거르지 않은 보기 · 걸러진 보기.
// 두 보기가 같은 함수를 쓰고 어느 쪽에 쓰는지만 다르다. 걸러진 보기는 필터가 바뀔 때마다 「전부 펼침」에서 다시 시작한다
import { scopePathTo, type TreeNode } from '../core/tree';
import type { Picked } from './selection';
import { isRowPicked } from './treeFilter';

export interface OpenState { scopes: ReadonlySet<string>; closedGroups: ReadonlySet<string> }

const allScopeIds = (n: TreeNode): string[] => [n.scope.id, ...n.children.flatMap(allScopeIds)];
/** 분류 묶음 id 전부 — 걸러진 트리는 묶음 판정이 달라질 수 있어 범위 × 분류 전부를 담는다(없는 id 는 쓰이지 않을 뿐이다) */
const allGroupIds = (n: TreeNode): string[] => [...new Set(n.rows.map((r) => groupId(n.scope.id, r.category)))].concat(n.children.flatMap(allGroupIds));

export const groupId = (scopeId: string, category: string): string => `${scopeId}/${category}`;

/** 처음 펼침 — 뿌리와 그 바로 아래 한 단계. 링크로 연 선택이 있으면 그 행이 놓인 노드의 조상 범위도 연다 — 고른 행이 접힌 채 숨지 않게.
 *  합친 행은 공통 조상(gcp:project)에 놓이므로 고른 규칙의 범위가 아니라 행의 노드를 연다 */
export function initialOpen(tree: TreeNode, picked: Picked): OpenState {
  const scopes = new Set<string>([tree.scope.id, ...tree.children.map((c) => c.scope.id)]);
  const walk = (n: TreeNode) => {
    if (n.rows.some((r) => isRowPicked(r, picked))) for (const s of scopePathTo(n.scope.id)) scopes.add(s.id);
    n.children.forEach(walk);
  };
  walk(tree);
  return { scopes, closedGroups: new Set() };
}

/** 모두 펼치기 — 걸러진 보기의 시작 상태이기도 하다 */
export const expandAll = (tree: TreeNode): OpenState => ({ scopes: new Set(allScopeIds(tree)), closedGroups: new Set() });

/** 모두 접기 — 뿌리만 열어 두고 분류 묶음은 전부 접는다 */
export const collapseAll = (tree: TreeNode): OpenState => ({ scopes: new Set([tree.scope.id]), closedGroups: new Set(allGroupIds(tree)) });

export const isScopeOpen = (s: OpenState, id: string): boolean => s.scopes.has(id);
export const isGroupOpen = (s: OpenState, id: string): boolean => !s.closedGroups.has(id);

/** 범위 하나를 열고 닫는다 — 이미 그 상태면 같은 객체를 돌려준다(<details> 의 toggle 은 React 가 open 을 바꿀 때도 오므로 되먹임이 멈춘다) */
export function setScopeOpen(s: OpenState, id: string, open: boolean): OpenState {
  if (s.scopes.has(id) === open) return s;
  const scopes = new Set(s.scopes);
  if (open) scopes.add(id); else scopes.delete(id);
  return { ...s, scopes };
}

/** 분류 묶음 하나를 열고 닫는다 — 같은 상태면 같은 객체 */
export function setGroupOpen(s: OpenState, id: string, open: boolean): OpenState {
  if (s.closedGroups.has(id) === !open) return s;
  const closedGroups = new Set(s.closedGroups);
  if (open) closedGroups.delete(id); else closedGroups.add(id);
  return { ...s, closedGroups };
}
