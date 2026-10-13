// 마법사 Custom 창 (D95) — 여러 개 고르기 · 체크 해제 · 개수 · 역할 · 종류 · 상한 · 중복 · 닫을 때 고를 줄
import { describe, it, expect } from 'vitest';
import { applyCustomChange, customBlock, customPicked, lastAddedPath, removeCustom, selectionAfterCustomRemove } from './wizardCustom';
import { addCustom, addPresetPick, CUSTOM_TREE, initialPlan, PROJECT_CUSTOM_TREE, PROJECT_NAME_RULE, togglePreset } from './wizardState';
import { setCount, setKind, setRole, toggle, treeRules, type Picked } from './selection';
import { MAX_PICKS_PER_SERVICE, validatePlan, type WizardPlan } from '../core/wizard/plan';
import type { ResourceRule } from '../core/types';

const rule = (id: string): ResourceRule => {
  const r = treeRules(CUSTOM_TREE).find((x) => x.id === id);
  if (!r) throw new Error(id);
  return r;
};
const VM = rule('gcp.compute_instance');
const SA = rule('gcp.service_account');
const BUCKET = rule('gcp.storage_bucket');
const SQL = rule('gcp.cloud_sql_instance');

/** 트리가 하듯 — 지금 계획에서 읽은 선택을 바꿔 넘긴다 */
const tick = (plan: WizardPlan, service: number | null, fn: (p: Picked) => Picked, tree = service === null ? PROJECT_CUSTOM_TREE : CUSTOM_TREE) =>
  applyCustomChange(plan, service, tree, fn(customPicked(plan, service, tree)));

describe('여러 개 고르기 — 체크하면 그 목록에 더하고 창은 열린 채 다음 행을 고른다', () => {
  it('둘을 차례로 체크하면 custom pick 둘 · 프리셋 pick 은 그대로', () => {
    const base = togglePreset(initialPlan(), 0, 'web');
    const a = tick(base, 0, (p) => toggle(p, VM));
    expect(a.added).toEqual(['gcp.compute_instance']);
    const b = tick(a.plan, 0, (p) => toggle(p, SA));
    expect(b.added).toEqual(['gcp.service_account']);
    const picks = b.plan.services[0]!.picks;
    expect(picks.map((p) => p.preset ?? p.ruleId)).toEqual(['web', 'gcp.compute_instance', 'gcp.service_account']);
    expect(picks[1]!.instances).toHaveLength(1);
    expect(picks[2]!.role).toBe('sync');
    expect(validatePlan(b.plan).ok).toBe(true);
  });
  it('이미 custom 으로 더한 규칙은 체크된 채 보인다 — 프리셋 pick 은 트리의 선택에 들지 않는다', () => {
    let p = togglePreset(initialPlan(), 0, 'web');
    p = addCustom(p, 0, { ruleId: VM.id, input: 'count', count: 3 });
    p = addCustom(p, 0, { ruleId: SA.id, input: 'role' });
    const picked = customPicked(p, 0, CUSTOM_TREE);
    expect([...picked]).toEqual([['compute_instance', { count: 3 }], ['service_account', { count: 1, role: 'sync' }]]);
  });
  it('트리에 없는 규칙의 custom pick(프로젝트 이름)은 창의 선택에 들지 않고 체크 해제로 지워지지도 않는다', () => {
    const p = addCustom({ ...initialPlan(), services: [] }, null, { ruleId: PROJECT_NAME_RULE, input: 'none' });
    expect(customPicked(p, null, PROJECT_CUSTOM_TREE).size).toBe(0);
    const c = tick(p, null, (x) => toggle(x, rule('gcp.vpc_network')));
    expect(c.plan.projectPicks.map((x) => x.ruleId)).toEqual([PROJECT_NAME_RULE, 'gcp.vpc_network']);
  });
});

describe('체크 해제 — 그 규칙의 custom pick 을 지운다. 프리셋 칩으로 더한 pick 은 건드리지 않는다', () => {
  it('custom VM 을 풀면 custom 만 지워지고 같은 규칙의 프리셋(web) pick 은 남는다', () => {
    let p = togglePreset(initialPlan(), 0, 'web');
    p = addCustom(p, 0, { ruleId: VM.id, input: 'count' });
    const c = tick(p, 0, (x) => toggle(x, VM));
    expect(c.removed).toEqual([1]);
    expect(c.plan.services[0]!.picks.map((x) => x.preset ?? x.ruleId)).toEqual(['web']);
  });
  it('같은 규칙의 custom pick 이 둘(Duplicate)이면 둘 다 지운다 — 체크 상자 하나가 그 규칙을 가리킨다', () => {
    let p = addCustom(initialPlan(), 0, { ruleId: BUCKET.id, input: 'none', tier: 'a' });
    p = togglePreset(p, 0, 'web');
    p = addCustom(p, 0, { ruleId: BUCKET.id, input: 'none', tier: 'b' });
    const r = removeCustom(p, 0, BUCKET.id);
    expect(r.removed).toEqual([0, 2]);
    expect(r.plan.services[0]!.picks.map((x) => x.preset)).toEqual(['web']);
  });
});

describe('개수 · 역할 · 종류 — 트리의 입력이 그 custom pick 에 옮겨진다', () => {
  it('+ 는 서버 줄을 끝에 더하고 - 는 끝 줄을 지운다', () => {
    const p = addCustom(initialPlan(), 0, { ruleId: VM.id, input: 'count' });
    const up = tick(p, 0, (x) => setCount(x, VM, 3));
    expect(up.plan.services[0]!.picks[0]!.instances!.map((s) => s.seq)).toEqual(['01', '02', '03']);
    const down = tick(up.plan, 0, (x) => setCount(x, VM, 2));
    expect(down.plan.services[0]!.picks[0]!.instances!.map((s) => s.seq)).toEqual(['01', '02']);
    expect(down.added).toEqual([]);
  });
  it('역할 · 종류를 바꾸면 pick 의 칸이 바뀐다', () => {
    let p = addCustom(initialPlan(), 0, { ruleId: SA.id, input: 'role' });
    p = addCustom(p, 0, { ruleId: SQL.id, input: 'count', kind: 'MYSQL' });
    p = tick(p, 0, (x) => setRole(x, SA, 'worker')).plan;
    p = tick(p, 0, (x) => setKind(x, SQL, 'POSTGRES')).plan;
    expect(p.services[0]!.picks[0]!.role).toBe('worker');
    expect(p.services[0]!.picks[1]!.kind).toBe('POSTGRES');
  });
});

describe('막힘 — 목록 상한(40) · 같은 이름(duplicate_pick)', () => {
  const fullService = (): WizardPlan => {
    let p = initialPlan();
    for (let i = 0; i < MAX_PICKS_PER_SERVICE; i++) p = addCustom(p, 0, { ruleId: BUCKET.id, input: 'none', tier: `t${String(i).padStart(2, '0')}` });
    return p;
  };
  it('서비스 목록이 40 이면 full · addCustom 도 더하지 않는다', () => {
    const p = fullService();
    expect(p.services[0]!.picks).toHaveLength(MAX_PICKS_PER_SERVICE);
    expect(customBlock(p, 0, VM, undefined)).toBe('full');
    expect(addCustom(p, 0, { ruleId: VM.id, input: 'count' })).toBe(p);
    expect(customBlock(p, null, rule('gcp.vpc_network'), undefined)).toBeUndefined();
  });
  it('같은 목록에 이름이 같아질 pick 이 있으면 duplicate — tier 가 다르거나 다른 목록이면 아니다', () => {
    const vpc = rule('gcp.vpc_network');
    const p = addPresetPick({ ...initialPlan(), services: [] }, null, 'vpc');
    expect(customBlock(p, null, vpc, undefined)).toBe('duplicate');
    expect(customBlock(togglePreset(initialPlan(), 0, 'web'), 0, VM, undefined)).toBeUndefined();
    expect(customBlock(initialPlan(), 0, VM, undefined)).toBeUndefined();
  });
});

describe('닫을 때 고를 줄 · 지운 뒤의 고른 줄', () => {
  it('더한 것 가운데 남은 마지막 pick — 모두 풀었으면 없다(선택을 바꾸지 않는다)', () => {
    const a = tick(initialPlan(), 0, (x) => toggle(x, VM));
    const b = tick(a.plan, 0, (x) => toggle(x, SA));
    const added = [...a.added, ...b.added];
    expect(lastAddedPath(b.plan, 0, added)).toBe('services[0].picks[1]');
    const c = tick(b.plan, 0, (x) => toggle(x, SA));
    expect(lastAddedPath(c.plan, 0, added)).toBe('services[0].picks[0]');
    const d = tick(c.plan, 0, (x) => toggle(x, VM));
    expect(lastAddedPath(d.plan, 0, added)).toBeUndefined();
    expect(lastAddedPath(initialPlan(), null, [])).toBeUndefined();
  });
  it('지운 pick 을 골랐으면 removePick · 뒤쪽 pick 은 당긴 자리 · 다른 목록은 그대로', () => {
    expect(selectionAfterCustomRemove('services[0].picks[1]', 0, [1])).toEqual({ type: 'removePick', path: 'services[0].picks[1]' });
    expect(selectionAfterCustomRemove('services[0].picks[3]', 0, [0, 2])).toEqual({ type: 'select', path: 'services[0].picks[1]' });
    expect(selectionAfterCustomRemove('services[0].picks[0]', 0, [2])).toEqual({ type: 'keep' });
    expect(selectionAfterCustomRemove('services[1].picks[3]', 0, [0])).toEqual({ type: 'keep' });
    expect(selectionAfterCustomRemove('projectPicks[2]', null, [0])).toEqual({ type: 'select', path: 'projectPicks[1]' });
    expect(selectionAfterCustomRemove('project', 0, [0])).toEqual({ type: 'keep' });
  });
});
