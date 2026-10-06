// 리소스 트리 (D37 · 계획 §4-2 · §4-5) — 트리는 SCOPES + RULES 에서 파생한다
import { describe, it, expect } from 'vitest';
import { buildTree, inputKind, scopePath, type TreeNode } from './tree';
import { RULES, rulesFor } from './constraints';
import { PROVIDERS } from './types';

function walk(n: TreeNode): TreeNode[] {
  return [n, ...n.children.flatMap(walk)];
}

describe('buildTree', () => {
  it('규칙 수 = rulesFor — 어느 규칙도 빠지거나 두 번 나오지 않는다', () => {
    for (const p of PROVIDERS) {
      const ids = walk(buildTree(p)).flatMap((n) => n.rules.map((r) => r.id));
      expect(ids.length, p).toBe(rulesFor(p).length);
      expect(new Set(ids)).toEqual(new Set(rulesFor(p).map((r) => r.id)));
    }
  });

  it('뿌리는 가장 넓은 유일 범위 · 노드의 규칙은 그 범위에 놓인 것뿐이다', () => {
    expect(buildTree('azure').scope.id).toBe('azure:global');
    expect(buildTree('gcp').scope.id).toBe('gcp:namespace');
    expect(buildTree('aws').scope.id).toBe('aws:partition');
    for (const p of PROVIDERS) for (const n of walk(buildTree(p))) for (const r of n.rules) expect(r.scope).toBe(n.scope.id);
  });

  it('범위이면서 규칙인 노드 — RG 규칙은 Subscription 노드에, RG 범위는 그 자식으로', () => {
    const sub = walk(buildTree('azure')).find((n) => n.scope.id === 'azure:subscription')!;
    expect(sub.rules.map((r) => r.id)).toEqual(['azure.resource_group']);
    expect(sub.children.map((c) => c.scope.id)).toEqual(['azure:resource_group']);
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
  it('뿌리 → 그 범위 · 깊이 ≤ 4', () => {
    for (const r of Object.values(RULES)) {
      const path = scopePath(r);
      expect(path.length, r.id).toBeGreaterThanOrEqual(1);
      expect(path.length, r.id).toBeLessThanOrEqual(4);
      expect(path[0]!.parent, r.id).toBeUndefined();
      expect(path.at(-1)!.id, r.id).toBe(r.scope);
    }
  });

  it('Azure subnet = global › subscription › resource_group › virtual_network', () => {
    expect(scopePath(RULES['azure.subnet']!).map((s) => s.id)).toEqual(['azure:global', 'azure:subscription', 'azure:resource_group', 'azure:virtual_network']);
  });
});

describe('buildTree — rules 인자 (계획 §7-4 · 화면 fixture 진입점)', () => {
  it('넘긴 규칙으로 트리를 만든다 · 다른 provider 규칙은 거른다 · 생략하면 rulesFor 와 같다', () => {
    const vm = rulesFor('azure').find((r) => r.resourceType === 'virtual_machine')!;
    const extra = { ...vm, id: 'azure.fx_extra', resourceType: 'fx_extra' };
    const aws = rulesFor('aws')[0]!;
    const ids = walk(buildTree('azure', [vm, extra, aws])).flatMap((n) => n.rules.map((r) => r.id));
    expect(ids).toEqual(['azure.virtual_machine', 'azure.fx_extra']);
    expect(walk(buildTree('azure', rulesFor('azure')))).toEqual(walk(buildTree('azure')));
  });
});
