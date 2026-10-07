// 트리 펼침 상태 — 모두 펼치기 · 모두 접기 · 하나 열고 닫기. 거르지 않은 보기와 걸러진 보기가 같은 함수를 쓴다
import { describe, it, expect } from 'vitest';
import { collapseAll, expandAll, groupId, initialOpen, isGroupOpen, isScopeOpen, setGroupOpen, setScopeOpen } from './treeOpen';
import { buildTree, type TreeNode } from '../core/tree';

const gcp = buildTree('gcp');
const allScopes = (n: TreeNode): string[] => [n.scope.id, ...n.children.flatMap(allScopes)];

describe('treeOpen', () => {
  it('처음 — 뿌리와 바로 아래 한 단계만 열린다 · 고른 행의 조상은 연다', () => {
    const s = initialOpen(gcp, new Map());
    expect([...s.scopes].sort()).toEqual([gcp.scope.id, ...gcp.children.map((c) => c.scope.id)].sort());
    const deep = allScopes(gcp).filter((id) => !s.scopes.has(id));
    expect(deep.length).toBeGreaterThan(0); // 공허하지 않다 — 닫힌 범위가 있다
  });
  it('링크로 연 선택 — 합친 행(gcp:project 에 놓인다)의 조상만 연다 · 존 범위 행(instance group)은 Zone 범위까지 연다', () => {
    const merged = initialOpen(gcp, new Map([['global_address', { count: 1 }]]));
    expect(isScopeOpen(merged, 'gcp:project')).toBe(true);
    expect(isScopeOpen(merged, 'gcp:project_global')).toBe(false);
    const zonal = initialOpen(gcp, new Map([['instance_group', { count: 1 }]]));
    expect(isScopeOpen(zonal, 'gcp:project_zone')).toBe(true);
  });
  it('모두 펼치기 — 범위 전부 열림 · 묶음 전부 열림', () => {
    const s = expandAll(gcp);
    expect(allScopes(gcp).every((id) => isScopeOpen(s, id))).toBe(true);
    expect(isGroupOpen(s, groupId(gcp.scope.id, 'networking'))).toBe(true);
  });
  it('모두 접기 — 뿌리만 열림 · 묶음 전부 닫힘', () => {
    const s = collapseAll(gcp);
    expect([...s.scopes]).toEqual([gcp.scope.id]);
    for (const n of [gcp, ...gcp.children]) for (const r of n.rows) expect(isGroupOpen(s, groupId(n.scope.id, r.category))).toBe(false);
  });
  it('하나 열고 닫기 — 바뀌면 새 객체 · 같으면 같은 객체(toggle 되먹임이 멈춘다)', () => {
    const s = expandAll(gcp);
    const id = gcp.children[0]!.scope.id;
    const closed = setScopeOpen(s, id, false);
    expect(closed).not.toBe(s);
    expect(isScopeOpen(closed, id)).toBe(false);
    expect(isScopeOpen(s, id)).toBe(true); // 원본은 그대로
    expect(setScopeOpen(closed, id, false)).toBe(closed);
    const gid = groupId(gcp.scope.id, 'compute');
    const g = setGroupOpen(s, gid, false);
    expect(isGroupOpen(g, gid)).toBe(false);
    expect(setGroupOpen(g, gid, false)).toBe(g);
    expect(isGroupOpen(setGroupOpen(g, gid, true), gid)).toBe(true);
  });
});
