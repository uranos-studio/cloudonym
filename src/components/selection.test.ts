// 화면의 선택 상태 (D40 · D42) — Map 하나 · 트리 순서 · 판정은 core validateSelection 하나
import { describe, it, expect } from 'vitest';
import { applyChange, canAdd, canIncrease, clearForCloudSwitch, fromItems, setCount, setRole, toItems, toggle, totalNames, treeRules, type Picked } from './selection';
import { buildTree } from '../core/tree';
import { MAX_COUNT, MAX_ITEMS, MAX_NAMES } from '../core/selection';
import { rulesFor } from '../core/constraints';
import type { ResourceRule } from '../core/types';

const azure = buildTree('azure');
const rule = (t: string) => rulesFor('azure').find((r) => r.resourceType === t)!;

describe('treeRules · toItems — 순서는 트리 순서(범위 경로 → 규칙 표 순서)', () => {
  it('Azure 트리 순서 — Global 의 셋 → Subscription 의 RG → RG 안 → VNet 안 → Managed cluster 안', () => {
    // 규칙이 늘어도 깨지지 않게 — 처음 24종의 Azure 11개가 이 상대 순서로 나오는지만 본다
    const order = treeRules(azure).map((r) => r.resourceType);
    const anchors = [
      'storage_account', 'key_vault', 'sql_server', 'resource_group',
      'managed_identity', 'virtual_machine', 'virtual_machine_windows', 'virtual_network',
      'subnet', 'aks_nodepool_linux', 'aks_nodepool_windows',
    ];
    expect(order.filter((t) => anchors.includes(t))).toEqual(anchors);
    expect(treeRules(azure)).toHaveLength(rulesFor('azure').length);
  });
  it('고른 순서와 무관하게 트리 순서로 낸다 · 값은 그대로', () => {
    let m: Picked = new Map();
    m = toggle(m, rule('subnet'));
    m = toggle(m, rule('storage_account'));
    m = setCount(m, rule('subnet'), 3);
    expect(toItems(azure, m).map((i) => [i.rule.resourceType, i.count])).toEqual([['storage_account', 1], ['subnet', 3]]);
  });
  it('fromItems 는 toItems 의 역 — 해시에서 풀린 선택을 상태로', () => {
    const m = setRole(toggle(toggle(new Map(), rule('managed_identity')), rule('virtual_machine')), rule('managed_identity'), 'db');
    expect(toItems(azure, fromItems(toItems(azure, m)))).toEqual(toItems(azure, m));
  });
});

describe('toggle · setCount · setRole', () => {
  it('켜면 count 1 · role 규칙은 기본 역할 sync 를 담는다 · 다시 누르면 지운다', () => {
    const m = toggle(new Map(), rule('managed_identity'));
    expect(m.get('managed_identity')).toEqual({ count: 1, role: 'sync' });
    expect(toggle(m, rule('managed_identity')).size).toBe(0);
    expect(toggle(new Map(), rule('virtual_machine')).get('virtual_machine')).toEqual({ count: 1 });
  });
  it('입력은 상태를 바꾸지 않는다 (새 Map)', () => {
    const m: Picked = new Map();
    toggle(m, rule('virtual_machine'));
    expect(m.size).toBe(0);
  });
});

describe('applyChange — 판정은 core validateSelection (D40)', () => {
  it('seq 없는 규칙(none)은 개수 1 고정 — 2 는 받지 않는다(오너 결정)', () => {
    const m = toggle(new Map(), rule('resource_group'));
    expect(applyChange('azure', azure, setCount(m, rule('resource_group'), 2))).toBeUndefined();
    expect(canIncrease(m, rule('resource_group'))).toBe(false);
  });
  it('역할 꼴이 틀리면 받지 않는다 · 맞으면 받는다', () => {
    const m = toggle(new Map(), rule('managed_identity'));
    expect(applyChange('azure', azure, setRole(m, rule('managed_identity'), 'Sync'))).toBeUndefined();
    expect(applyChange('azure', azure, setRole(m, rule('managed_identity'), 'db'))?.get('managed_identity')).toEqual({ count: 1, role: 'db' });
  });
  it('빈 선택은 받는다(선택 없음) · 범위 밖 개수는 받지 않는다', () => {
    expect(applyChange('azure', azure, new Map())?.size).toBe(0);
    const m = toggle(new Map(), rule('virtual_machine'));
    expect(applyChange('azure', azure, setCount(m, rule('virtual_machine'), MAX_COUNT + 1))).toBeUndefined();
    expect(applyChange('azure', azure, setCount(m, rule('virtual_machine'), MAX_COUNT))).toBeDefined();
  });
});

describe('Σ 200 · 항목 200 에서 + 와 새 체크가 막힌다', () => {
  it('이름 200 — + 비활성 · 새 항목 비활성 · 199 면 둘 다 된다', () => {
    let m: Picked = new Map();
    for (const t of ['virtual_machine', 'virtual_machine_windows', 'subnet']) m = toggle(m, rule(t));
    m = setCount(setCount(setCount(m, rule('virtual_machine'), 99), rule('virtual_machine_windows'), 99), rule('subnet'), 2);
    expect(totalNames(m)).toBe(MAX_NAMES);
    expect(canIncrease(m, rule('subnet'))).toBe(false);
    expect(canAdd(m)).toBe(false);
    expect(applyChange('azure', azure, setCount(m, rule('subnet'), 3))).toBeUndefined();
    const less = setCount(m, rule('subnet'), 1);
    expect(totalNames(less)).toBe(MAX_NAMES - 1);
    expect(canIncrease(less, rule('subnet'))).toBe(true);
    expect(canAdd(less)).toBe(true);
    expect(canIncrease(less, rule('virtual_machine'))).toBe(false); // 99 가 한 항목의 끝
  });
  it('항목 200 — 시험 전용 규칙 201개로 새 체크가 막힌다', () => {
    const kv = rule('key_vault');
    const rules: ResourceRule[] = Array.from({ length: MAX_ITEMS + 1 }, (_, i) => ({ ...kv, id: `azure.fx_${i}`, resourceType: `fx_${i}` }));
    const tree = buildTree('azure', rules);
    let m: Picked = new Map();
    for (const r of rules.slice(0, MAX_ITEMS)) m = toggle(m, r);
    expect(canAdd(m)).toBe(false);
    expect(applyChange('azure', tree, toggle(m, rules[MAX_ITEMS]!), rules)).toBeUndefined();
    expect(applyChange('azure', tree, m, rules)?.size).toBe(MAX_ITEMS);
  });
});

describe('CSP 를 바꾸면 선택을 비운다 (규칙 id 가 provider 에 묶여 있다)', () => {
  it('clearForCloudSwitch 는 빈 Map', () => {
    expect(clearForCloudSwitch().size).toBe(0);
  });
});
