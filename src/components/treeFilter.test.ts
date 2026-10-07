// 트리 거르기 — 검색 · 분류 칩 · 「선택만 보기」. 걸러진 행의 조상만 남는다
import { describe, it, expect } from 'vitest';
import { categoryCounts, filterTree, isFiltering, matchesQuery, type ViewNode } from './treeFilter';
import { buildTree } from '../core/tree';
import { rulesFor } from '../core/constraints';

const azure = buildTree('azure');
const rule = (t: string) => rulesFor('azure').find((r) => r.resourceType === t)!;
const ids = (n: ViewNode | undefined): string[] => (n ? [...n.rules.map((r) => r.resourceType), ...n.children.flatMap(ids)] : []);
const scopes = (n: ViewNode | undefined): string[] => (n ? [n.scope.id, ...n.children.flatMap(scopes)] : []);
const none = { query: '', selectedOnly: false };

describe('matchesQuery — displayName · resourceType · slug · entity 소문자 부분 일치', () => {
  it.each([['virtual machine', true], ['VIRTUAL_MACHINE', true], ['vm', true], ['microsoft.compute', true], ['subnet', false]])('VM 규칙 · %s → %s', (q, hit) => {
    expect(matchesQuery(rule('virtual_machine'), q)).toBe(hit);
  });
});

describe('matchesQuery — catalog 의 aliases · 행 이름도 찾는다 (D54)', () => {
  const gcp = (t: string) => rulesFor('gcp').find((r) => r.resourceType === t)!;
  it.each([['google_compute_address', true], ['compute addresses', true], ['ip address', true], ['add', true], ['GOOGLE_COMPUTE_GLOBAL_ADDRESS', true]])('IP Address 규칙 · %s → %s', (q, hit) => {
    expect(matchesQuery(gcp('address'), q)).toBe(hit);
    // 같은 행의 다른 범위 규칙도 같은 검색어로 걸린다
    expect(matchesQuery(gcp('global_address'), q)).toBe(hit);
  });
  it('검사기 자체 — 규칙의 네 칸 어디에도 없는 별칭이라야 aliases 덕분이다 · 다른 행은 안 걸린다', () => {
    const r = gcp('address');
    for (const q of ['google_compute_address', 'compute addresses', 'ip address']) {
      expect([r.displayName, r.resourceType, r.slug, r.entity].some((s) => s.toLowerCase().includes(q)), q).toBe(false);
      expect(matchesQuery(gcp('compute_instance'), q), q).toBe(false);
    }
  });
  it('트리 거르기 — 별칭은 행 단위라 같은 행의 주소 두 규칙만 남는다', () => {
    expect(ids(filterTree(buildTree('gcp'), { ...none, query: 'google_compute_address' }, new Map())).sort()).toEqual(['address', 'global_address']);
    expect(ids(filterTree(buildTree('gcp'), { ...none, query: 'compute addresses' }, new Map())).sort()).toEqual(['address', 'global_address']);
  });
});

describe('filterTree', () => {
  it('거르지 않으면 트리 그대로 — 빈 범위도 남는다', () => {
    expect(isFiltering(none)).toBe(false);
    const v = filterTree(azure, none, new Map());
    expect(ids(v)).toHaveLength(rulesFor('azure').length);
    expect(v?.total).toBe(rulesFor('azure').length);
  });
  it('검색 — 맞는 행과 그 조상 범위만 남는다', () => {
    const v = filterTree(azure, { ...none, query: 'subnet' }, new Map());
    expect(ids(v)).toEqual(['subnet']);
    expect(scopes(v)).toEqual(['azure:global', 'azure:subscription', 'azure:resource_group', 'azure:virtual_network']);
  });
  it('결과 0 이면 undefined — 화면은 「표에 없으면 미지원」 한 줄', () => {
    expect(filterTree(azure, { ...none, query: 'zzz-none' }, new Map())).toBeUndefined();
  });
  it('분류 칩 — 그 분류만', () => {
    const got = ids(filterTree(azure, { ...none, category: 'networking' }, new Map()));
    expect(got).toContain('virtual_network');
    expect(got).toContain('subnet');
    expect(new Set(got)).toEqual(new Set(rulesFor('azure').filter((r) => r.category === 'networking').map((r) => r.resourceType)));
  });
  it('선택만 보기 — 체크한 행과 그 조상만 · 검색과 함께 걸린다', () => {
    const picked = new Map([['key_vault', { count: 1 }], ['subnet', { count: 2 }]]);
    expect(ids(filterTree(azure, { ...none, selectedOnly: true }, picked))).toEqual(['key_vault', 'subnet']);
    expect(ids(filterTree(azure, { query: 'vault', selectedOnly: true }, picked))).toEqual(['key_vault']);
  });
});

describe('categoryCounts — 분류별 규칙 수 · 분류 순서', () => {
  it('Azure — 합이 규칙 수 · 0 인 분류는 없다', () => {
    const c = categoryCounts(azure);
    expect([...c.values()].reduce((a, b) => a + b, 0)).toBe(rulesFor('azure').length);
    expect(c.get('networking')).toBe(rulesFor('azure').filter((r) => r.category === 'networking').length);
    expect([...c.values()].every((n) => n > 0)).toBe(true);
  });
});
