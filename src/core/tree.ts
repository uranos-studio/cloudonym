// 리소스 트리 (D37) — SCOPES 와 RULES 에서 파생하는 순수 함수. 트리를 따로 적지 않는다.
// 자식을 고른다고 부모가 자동으로 체크되지 않는다 — 그것은 묶음(유료)이다
import { rulesFor } from './constraints';
import { SCOPES, type ScopeDef } from './scopes';
import type { Provider, ResourceRule } from './types';

export interface TreeNode {
  scope: ScopeDef;
  rules: ResourceRule[];   // 이 범위에 놓인 규칙 — 규칙 표 순서
  children: TreeNode[];    // SCOPES 순서
}

/** provider 의 트리 — 뿌리 하나. 범위이면서 규칙인 것(RG · VNet · VPC · project)은 규칙이 부모 범위 노드에, 범위가 그 자식으로 놓인다(scope.ruleId 로 잇는다) */
export function buildTree(provider: Provider): TreeNode {
  const scopes = Object.values(SCOPES).filter((s) => s.provider === provider);
  const roots = scopes.filter((s) => s.parent === undefined);
  if (roots.length !== 1) throw new Error(`scope graph for ${provider} must have exactly one root, found ${roots.length}`);
  const rules = rulesFor(provider);
  const build = (s: ScopeDef): TreeNode => ({
    scope: s,
    rules: rules.filter((r) => r.scope === s.id),
    children: scopes.filter((c) => c.parent === s.id).map(build),
  });
  return build(roots[0]!);
}

/** 항목이 받는 입력 — template 에 seq 가 있으면 개수, role 이 있으면 역할, 둘 다 없으면 없음 */
export function inputKind(rule: ResourceRule): 'count' | 'role' | 'none' {
  if (rule.template.includes('seq')) return 'count';
  if (rule.template.includes('role')) return 'role';
  return 'none';
}

/** 뿌리 → 규칙이 놓인 범위 */
export function scopePath(rule: ResourceRule): ScopeDef[] {
  const path: ScopeDef[] = [];
  let cur: ScopeDef | undefined = SCOPES[rule.scope];
  while (cur !== undefined) {
    path.unshift(cur);
    cur = cur.parent === undefined ? undefined : SCOPES[cur.parent];
  }
  return path;
}
