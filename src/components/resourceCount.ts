// 지원 리소스 수 — 켜진 CSP 마다 트리(ResourceTree)가 그리는 행의 수. 손으로 적은 숫자가 아니라 규칙 표 · catalog 에서 센다.
// 행 하나 = 화면에서 체크하는 리소스 하나(D53 — catalog 행은 규칙 여럿을 범위 select 로 묶는다). 그래서 규칙 수가 아니라 행 수다
import { buildTree, type TreeNode } from '../core/tree';
import { ENABLED_PROVIDERS, type Provider } from '../core/types';

/** provider 의 리소스 수 — 트리 행 수 */
export function resourceCount(provider: Provider): number {
  const rows = (n: TreeNode): number => n.rows.length + n.children.reduce((sum, c) => sum + rows(c), 0);
  return rows(buildTree(provider));
}

/** 켜진 CSP 의 리소스 수 — ENABLED_PROVIDERS 순서 */
export function enabledResourceCounts(): Array<{ provider: Provider; count: number }> {
  return ENABLED_PROVIDERS.map((provider) => ({ provider, count: resourceCount(provider) }));
}
