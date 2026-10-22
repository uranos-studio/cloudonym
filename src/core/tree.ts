// 리소스 트리 (D37 · D53) — SCOPES · RULES · catalog 에서 파생하는 순수 함수. 트리를 따로 적지 않는다.
// 노드에는 규칙이 아니라 화면 행(TreeRow)이 놓인다 — GCP · AWS 는 catalog 행(규칙이 여럿일 수 있다), 행이 없는 규칙(Azure · 시험 fixture)은 규칙 하나가 행 하나다.
// 자식을 고른다고 부모가 자동으로 체크되지 않는다
import { rulesFor } from './constraints';
import { SCOPES, type ScopeDef } from './scopes';
import { rowOf, type AnyCatalogRow } from './catalog';
import type { Category, Provider, ResourceRule, ScopeId } from './types';

/** 화면 행 — rules 는 catalog 규칙 순서(행이 없으면 규칙 하나). 둘 이상이면 행에서 범위를 골라 규칙 하나로 정한다 */
export interface TreeRow {
  key: string;             // catalog 행 key, 행이 없으면 규칙 id
  displayName: string;
  category: Category;
  rules: readonly ResourceRule[];
  catalog?: AnyCatalogRow;
}

export interface TreeNode {
  scope: ScopeDef;
  rows: TreeRow[];         // 이 범위에 놓인 행 — 첫 규칙의 규칙 표 순서
  children: TreeNode[];    // SCOPES 순서
}

/** 행이 놓이는 범위 — 규칙 하나면 그 범위, 여럿이면 범위들의 최소 공통 조상 */
function rowScope(rules: readonly ResourceRule[]): ScopeId {
  const paths = rules.map((r) => scopePathOf(r.scope).map((s) => s.id));
  let common: ScopeId | undefined;
  for (let i = 0; paths.every((p) => p[i] !== undefined && p[i] === paths[0]![i]); i++) common = paths[0]![i];
  if (common === undefined) throw new Error(`rules ${rules.map((r) => r.id).join(', ')} share no scope`);
  return common;
}

/** 넘긴 규칙을 행으로 묶는다 — catalog 행에 든 규칙은 그 행으로(넘긴 규칙만 · catalog 규칙 순서), 아니면 규칙 하나가 행 하나. 행 순서는 첫 규칙의 순서 */
export function treeRows(rules: readonly ResourceRule[]): TreeRow[] {
  const byKey = new Map<string, ResourceRule[]>();
  const rowFor = new Map<string, AnyCatalogRow | undefined>();
  for (const r of rules) {
    const row = rowOf(r.id);
    const key = row?.key ?? r.id;
    if (!byKey.has(key)) { byKey.set(key, []); rowFor.set(key, row); }
    byKey.get(key)!.push(r);
  }
  return [...byKey].map(([key, rs]) => {
    const row = rowFor.get(key);
    const order = row ? Object.keys(row.rules) : [];
    const sorted = row ? [...rs].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)) : rs;
    const first = sorted[0]!;
    return {
      key,
      displayName: row?.displayName ?? first.displayName,
      category: row?.category ?? first.category,
      rules: sorted,
      ...(row ? { catalog: row } : {}),
    };
  });
}

/** provider 의 트리 — 뿌리 하나. 범위이면서 규칙인 것(RG · VNet · VPC · project)은 규칙이 부모 범위 노드에, 범위가 그 자식으로 놓인다(scope.ruleId 로 잇는다).
 *  rules 는 기본이 규칙 표 — 화면의 시험 전용 fixture(500행 측정 · 충돌)가 다른 표를 넘긴다. 다른 provider 규칙은 거른다 */
export function buildTree(provider: Provider, rules: readonly ResourceRule[] = rulesFor(provider)): TreeNode {
  const scopes = Object.values(SCOPES).filter((s) => s.provider === provider);
  const roots = scopes.filter((s) => s.parent === undefined);
  if (roots.length !== 1) throw new Error(`scope graph for ${provider} must have exactly one root, found ${roots.length}`);
  const placed = treeRows(rules.filter((r) => r.provider === provider)).map((row) => ({ row, scope: rowScope(row.rules) }));
  const build = (s: ScopeDef): TreeNode => ({
    scope: s,
    rows: placed.filter((p) => p.scope === s.id).map((p) => p.row),
    children: scopes.filter((c) => c.parent === s.id).map(build),
  });
  return build(roots[0]!);
}

/** 행의 규칙 — scope(범위 id · 화면 범위 select 의 값)를 주면 그 범위의 규칙만(0 또는 1개), 주지 않으면 전부 */
export function rowRules(row: TreeRow, scope?: ScopeId): readonly ResourceRule[] {
  if (scope === undefined) return row.rules;
  return row.rules.filter((r) => r.scope === scope);
}

/** 행에서 고를 범위 — 규칙이 둘 이상인 행만. 값은 규칙의 범위 id, 이름은 그 범위의 표시 이름(Global · Region · Zone) */
export function scopeChoices(row: TreeRow): Array<{ scope: ScopeId; label: string }> {
  if (row.rules.length < 2) return [];
  return row.rules.map((r) => ({ scope: r.scope, label: SCOPES[r.scope]?.displayName ?? r.scope }));
}

/** 항목이 받는 입력 — template 에 seq 가 있으면 개수, role 이 있으면 역할, 둘 다 없으면 없음 */
export function inputKind(rule: ResourceRule): 'count' | 'role' | 'none' {
  if (rule.template.includes('seq')) return 'count';
  if (rule.template.includes('role')) return 'role';
  return 'none';
}

function scopePathOf(scopeId: ScopeId): ScopeDef[] {
  const path: ScopeDef[] = [];
  let cur: ScopeDef | undefined = SCOPES[scopeId];
  while (cur !== undefined) {
    path.unshift(cur);
    cur = cur.parent === undefined ? undefined : SCOPES[cur.parent];
  }
  return path;
}

/** 뿌리 → 규칙이 놓인 범위 */
export function scopePath(rule: ResourceRule): ScopeDef[] {
  return scopePathOf(rule.scope);
}

/** 뿌리 → 그 범위 (행이 놓인 노드의 조상을 펼칠 때) */
export function scopePathTo(scopeId: ScopeId): ScopeDef[] {
  return scopePathOf(scopeId);
}
