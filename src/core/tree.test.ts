// 리소스 트리 (D37) — 트리는 SCOPES + RULES 에서 파생한다
import { describe, it, expect } from 'vitest';
import { buildTree, inputKind, rowRules, scopeChoices, scopePath, treeRows, type TreeNode } from './tree';
import { RULES, rulesFor } from './constraints';
import { PROVIDERS } from './types';

function walk(n: TreeNode): TreeNode[] {
  return [n, ...n.children.flatMap(walk)];
}
const nodeRules = (n: TreeNode) => n.rows.flatMap((row) => row.rules);

describe('buildTree', () => {
  it('규칙 수 = rulesFor — 어느 규칙도 빠지거나 두 번 나오지 않는다', () => {
    for (const p of PROVIDERS) {
      const ids = walk(buildTree(p)).flatMap((n) => nodeRules(n).map((r) => r.id));
      expect(ids.length, p).toBe(rulesFor(p).length);
      expect(new Set(ids)).toEqual(new Set(rulesFor(p).map((r) => r.id)));
    }
  });

  it('뿌리는 가장 넓은 유일 범위 · 노드의 규칙은 그 범위에 놓인 것뿐이다', () => {
    expect(buildTree('azure').scope.id).toBe('azure:global');
    expect(buildTree('gcp').scope.id).toBe('gcp:namespace');
    expect(buildTree('aws').scope.id).toBe('aws:partition');
    // 규칙 하나인 행은 그 규칙의 범위 노드에 놓인다 (합친 행은 아래 「행」 절)
    for (const p of PROVIDERS) for (const n of walk(buildTree(p))) for (const row of n.rows) if (row.rules.length === 1) expect(row.rules[0]!.scope, row.key).toBe(n.scope.id);
  });

  it('범위이면서 규칙인 노드 — RG 규칙은 Subscription 노드에, RG 범위는 그 자식으로', () => {
    const sub = walk(buildTree('azure')).find((n) => n.scope.id === 'azure:subscription')!;
    expect(nodeRules(sub)[0]!.id).toBe('azure.resource_group');
    expect(nodeRules(sub).every((r) => r.scope === 'azure:subscription')).toBe(true);
    expect(sub.children.map((c) => c.scope.id)).toEqual(['azure:resource_group', 'azure:region']);
    expect(sub.children[0]!.scope.ruleId).toBe('azure.resource_group');
  });
});

describe('inputKind', () => {
  it('template 에 seq → count · role → role · 둘 다 없음 → none', () => {
    expect(inputKind(RULES['gcp.compute_instance']!)).toBe('count');
    expect(inputKind(RULES['gcp.service_account']!)).toBe('role');
    expect(inputKind(RULES['azure.resource_group']!)).toBe('none');
    const kinds = new Set(Object.values(RULES).map(inputKind));
    expect(kinds).toEqual(new Set(['count', 'role', 'none']));
  });

  it('count 인 규칙만 template 에 seq 가 있다', () => {
    for (const r of Object.values(RULES)) expect(inputKind(r) === 'count', r.id).toBe(r.template.includes('seq'));
  });
});

describe('scopePath', () => {
  it('뿌리 → 그 범위 · 깊이 ≤ 5 (들인 Azure 부모 리소스 범위가 두 단계 — 2026-10-06 실측 최대 5)', () => {
    for (const r of Object.values(RULES)) {
      const path = scopePath(r);
      expect(path.length, r.id).toBeGreaterThanOrEqual(1);
      expect(path.length, r.id).toBeLessThanOrEqual(5);
      expect(path[0]!.parent, r.id).toBeUndefined();
      expect(path.at(-1)!.id, r.id).toBe(r.scope);
    }
  });

  it('Azure subnet = global › subscription › resource_group › virtual_network', () => {
    expect(scopePath(RULES['azure.subnet']!).map((s) => s.id)).toEqual(['azure:global', 'azure:subscription', 'azure:resource_group', 'azure:virtual_network']);
  });
});

describe('buildTree — rules 인자 (화면 fixture 진입점)', () => {
  it('넘긴 규칙으로 트리를 만든다 · 다른 provider 규칙은 거른다 · 생략하면 rulesFor 와 같다', () => {
    const vm = rulesFor('azure').find((r) => r.resourceType === 'virtual_machine')!;
    const extra = { ...vm, id: 'azure.fx_extra', resourceType: 'fx_extra' };
    const aws = rulesFor('aws')[0]!;
    const ids = walk(buildTree('azure', [vm, extra, aws])).flatMap((n) => nodeRules(n).map((r) => r.id));
    expect(ids).toEqual(['azure.virtual_machine', 'azure.fx_extra']);
    expect(walk(buildTree('azure', rulesFor('azure')))).toEqual(walk(buildTree('azure')));
  });
});

describe('buildTree — 행 (D53)', () => {
  const rows = (p: Parameters<typeof buildTree>[0]) => walk(buildTree(p)).flatMap((n) => n.rows.map((row) => ({ row, node: n.scope.id })));

  it('GCP 행 = catalog 131 · 합친 행 21 은 모두 gcp:project 에 놓인다', () => {
    const all = rows('gcp');
    expect(all).toHaveLength(131);
    expect(all.map((x) => x.row.key)).toEqual([...new Set(all.map((x) => x.row.key))]);
    const merged = all.filter((x) => x.row.rules.length >= 2);
    expect(merged).toHaveLength(21);
    for (const x of merged) expect(x.node, x.row.key).toBe('gcp:project');
    // 합친 행이 아닌 것은 규칙 범위 그대로 — 모든 행이 gcp:project 로 몰리지 않았다
    expect(new Set(all.filter((x) => x.row.rules.length === 1).map((x) => x.node)).size).toBeGreaterThan(3);
  });

  it('AWS · Azure 는 규칙 = 행 — 행 수가 규칙 수와 같고 행 key 는 규칙 id · AWS 는 catalog 행이 붙는다', () => {
    for (const p of ['aws', 'azure'] as const) {
      const all = rows(p);
      expect(all, p).toHaveLength(rulesFor(p).length);
      for (const x of all) {
        expect(x.row.rules).toHaveLength(1);
        expect(x.row.key).toBe(x.row.rules[0]!.id);
        if (p === 'aws') expect(x.row.catalog?.key).toBe(x.row.key);
        else expect(x.row.catalog).toBeUndefined();
      }
    }
  });

  it('행의 규칙은 catalog 규칙 순서 · 표시 이름 · 분류는 catalog 행의 것', () => {
    const ip = rows('gcp').find((x) => x.row.key === 'gcp.address')!.row;
    expect(ip.rules.map((r) => r.id)).toEqual(['gcp.address', 'gcp.global_address']);
    expect(ip.displayName).toBe('IP Address');
    expect(ip.category).toBe(ip.catalog!.category);
    const neg = rows('gcp').find((x) => x.row.key === 'gcp.network_endpoint_group')!.row;
    expect(neg.rules.map((r) => r.scope)).toEqual(['gcp:project_zone', 'gcp:project_global', 'gcp:project_region']);
  });

  it('rowRules — 범위 id 로 규칙 하나 · 없는 범위는 빈 배열 · 범위 없이 전부', () => {
    const ip = rows('gcp').find((x) => x.row.key === 'gcp.address')!.row;
    expect(rowRules(ip, 'gcp:project_global').map((r) => r.id)).toEqual(['gcp.global_address']);
    expect(rowRules(ip, 'gcp:project_region').map((r) => r.id)).toEqual(['gcp.address']);
    expect(rowRules(ip, 'gcp:project_zone')).toEqual([]);
    expect(rowRules(ip)).toBe(ip.rules);
  });

  it('scopeChoices — 합친 행만 · 범위 표시 이름(Region · Global · Zone)', () => {
    const all = rows('gcp');
    const ip = all.find((x) => x.row.key === 'gcp.address')!.row;
    expect(scopeChoices(ip)).toEqual([{ scope: 'gcp:project_region', label: 'Region' }, { scope: 'gcp:project_global', label: 'Global' }]);
    expect(all.filter((x) => scopeChoices(x.row).length >= 2)).toHaveLength(21);
    const vm = all.find((x) => x.row.key === 'gcp.compute_instance')!.row;
    expect(scopeChoices(vm)).toEqual([]);
  });

  it('treeRows — 넘긴 규칙만 묶는다(catalog 의 형제 규칙을 끌어오지 않는다) · catalog 밖 규칙은 규칙 하나가 행', () => {
    const g = rulesFor('gcp');
    const global = g.find((r) => r.id === 'gcp.global_address')!;
    const extra = { ...global, id: 'gcp.fx_extra', resourceType: 'fx_extra' };
    const out = treeRows([global, extra]);
    expect(out.map((r) => [r.key, r.rules.map((x) => x.id)])).toEqual([['gcp.address', ['gcp.global_address']], ['gcp.fx_extra', ['gcp.fx_extra']]]);
  });
});
