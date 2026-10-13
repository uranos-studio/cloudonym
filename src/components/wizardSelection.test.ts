import { describe, it, expect } from 'vitest';
import { addedRow, expandedAfterRemove, firstErrorRow, firstSelection, rowTitle, parentRow, selectAdded, parseRow, resolveSelection, rowErrorCount, rowExists, rowNames, selectionAfter, visibleRows } from './wizardSelection';
import { addCustom, addPresetPick, addService, clearNetwork, DEFAULT_PROJECT, duplicatePick, EMPTY_PROJECT, initialPlan, removePick, removeService, renameService, setPickField, startPlan, togglePreset, SERVICE_PRESETS, PROJECT_PRESETS } from './wizardState';
import { expandPlan, validatePlan, type WizardPlan } from '../core/wizard/plan';
import { generateProject, parseProjectContext } from '../core/engine';
import { decodeWizardState, encodeWizardState, HASH_KEY } from './urlState';
import { RULES_REVISION } from '../core/revision';
import { presetOf } from '../core/wizard/presets';

const result = (plan: WizardPlan) => generateProject(expandPlan(plan), 'gcp');
/** 서비스 shop · pay 와 네트워크 넷 · extras 하나 */
function sample(): WizardPlan {
  let p = startPlan(DEFAULT_PROJECT);
  p = togglePreset(p, 0, 'web');
  p = togglePreset(p, 0, 'db');
  p = togglePreset(p, 0, 'object');
  p = renameService(addService(p), 1, 'pay');
  p = togglePreset(p, 1, 'was');
  p = addCustom(p, null, { ruleId: 'gcp.pubsub_topic', input: 'count', count: 1 });
  return p;
}

describe('첫 화면 (D90 · D97) — startPlan · Clear network', () => {
  it('hash 가 없을 때의 계획 — 프로젝트 값은 비어 있다(D97) · 서비스 shop · 네트워크 넷(VPC · 서브넷 · Router · NAT, 각 01) · 이름 없음 · hash 없음 · 첫 선택 Project', () => {
    const p = startPlan();
    expect(p.project).toEqual(EMPTY_PROJECT);
    expect(p.services).toEqual([{ purpose: 'shop', picks: [] }]);
    expect(p.projectPicks.map((x) => x.preset)).toEqual(['vpc', 'subnet', 'router', 'nat']);
    expect(p.projectPicks.every((x) => x.instances?.length === 1 && x.instances[0]!.seq === '01')).toBe(true);
    expect(p.projectPicks.some((x) => x.kind !== undefined || x.tier !== undefined)).toBe(false);
    // 빈 프로젝트는 문맥이 풀리지 않는다 — 이름도 hash 도 공유 링크도 없다(Share 단추가 없으니 공유 경고도 없다)
    expect(parseProjectContext(p.project, 'gcp').ok).toBe(false);
    expect(encodeWizardState(p, RULES_REVISION)).toBeUndefined();
    expect(firstSelection(p)).toBe('project');
    // initialPlan 은 그대로 예시 값 · 네트워크 없음 — 링크에서 떨어진 경로(깨진 링크 · 버린 w)가 쓴다
    expect(initialPlan().project).toEqual(DEFAULT_PROJECT);
    expect(initialPlan().projectPicks).toEqual([]);
  });
  it('프로젝트 값을 채우면 네트워크 이름 다섯(ID + 넷) — 미리 채움(D90)은 그대로 · 첫 선택은 첫 서비스(갤러리)', () => {
    const p = { ...startPlan(), project: DEFAULT_PROJECT };
    expect(p).toEqual(startPlan(DEFAULT_PROJECT));
    expect(validatePlan(p)).toEqual({ ok: true });
    expect(result(p).items.map((i) => i.key)).toEqual([
      'project/-/project_id/-/-/-', 'project/-/vpc_network/-/-/01', 'project/-/subnet/-/-/01', 'project/-/router/-/-/01', 'project/-/router_nat/-/-/01',
    ]);
    expect(firstSelection(p)).toBe('services[0]');
  });
  it('링크로 연 계획은 그대로 — 프로젝트 값 · pick 이 링크대로 · 첫 선택은 첫 서비스', () => {
    const hash = encodeWizardState(startPlan(DEFAULT_PROJECT), RULES_REVISION)!;
    const d = decodeWizardState(`#${HASH_KEY}=${hash}`)!;
    // 지역은 코드로 실린다(asia-northeast3 → ane3) — 값은 그대로 비지 않는다
    expect({ ...d.plan!, project: { ...d.plan!.project, region: '' } }).toEqual({ ...startPlan(DEFAULT_PROJECT), project: { ...DEFAULT_PROJECT, region: '' } });
    expect(d.plan!.project.region).not.toBe('');
    expect(firstSelection(d.plan!)).toBe('services[0]');
    // 프로젝트 값이 틀린 계획은 Project 부터
    expect(firstSelection({ ...d.plan!, project: { ...DEFAULT_PROJECT, region: 'nowhere-1' } })).toBe('project');
  });
  it('Clear network 는 네트워크 pick 만 뗀다 — extras 는 남는다', () => {
    const p = clearNetwork(sample());
    expect(p.projectPicks.map((x) => x.preset ?? x.ruleId)).toEqual(['gcp.pubsub_topic']);
    expect(clearNetwork(startPlan(DEFAULT_PROJECT)).projectPicks).toEqual([]);
  });
});

describe('줄 경로 (D89)', () => {
  it('경로를 풀고 · 있는지 · 부모 줄', () => {
    const p = sample();
    expect(parseRow('services[1].picks[0]')).toEqual({ kind: 'pick', ref: { service: 1, pick: 0 } });
    expect(parseRow('projectPicks[4]')).toEqual({ kind: 'pick', ref: { service: null, pick: 4 } });
    expect(parseRow('services[2]')).toEqual({ kind: 'service', service: 2 });
    expect(parseRow('nope')).toBeUndefined();
    expect(rowExists(p, 'services[1].picks[0]')).toBe(true);
    expect(rowExists(p, 'services[1].picks[1]')).toBe(false);
    expect(rowExists(p, 'services[2]')).toBe(false);
    expect(parentRow(p, 'projectPicks[4]')).toBe('extras');
    expect(parentRow(p, 'projectPicks[1]')).toBe('network');
    expect(parentRow(p, 'services[0].picks[2]')).toBe('services[0]');
    expect(resolveSelection(initialPlan(), 'services[1]')).toBe('project');
  });
  it('보이는 줄의 순서 — 접힌 서비스의 pick 은 빠진다', () => {
    const p = sample();
    expect(visibleRows(p, (i) => i === 1)).toEqual([
      'project', 'network', 'projectPicks[0]', 'projectPicks[1]', 'projectPicks[2]', 'projectPicks[3]',
      'services[0]', 'services[1]', 'services[1].picks[0]', 'extras', 'projectPicks[4]',
    ]);
  });
});

describe('선택이 옮겨 가는 규칙 (§2)', () => {
  const p = sample();
  it('칩 토글은 선택을 옮기지 않는다 — 부모 줄이 그대로', () => {
    const after = togglePreset(p, 0, 'bastion');
    expect(selectionAfter({ type: 'keep' }, 'services[0]', p, after)).toBe('services[0]');
    expect(selectionAfter({ type: 'keep' }, 'network', p, clearNetwork(p))).toBe('network');
  });
  it('칩을 꺼서 선택 중인 pick 이 지워지면 부모 줄 — 같은 자리에 다른 pick 이 와도', () => {
    const after = togglePreset(p, 0, 'object');
    expect(selectionAfter({ type: 'keep' }, 'services[0].picks[2]', p, after)).toBe('services[0]');
    const after2 = togglePreset(p, 0, 'web');
    expect(selectionAfter({ type: 'keep' }, 'services[0].picks[1]', p, after2)).toBe('services[0]');
    // tier 를 치면 그 자리 그대로
    const typed = setPickField(p, { service: 0, pick: 2 }, 'tier', 'uploads');
    expect(selectionAfter({ type: 'keep' }, 'services[0].picks[2]', p, typed)).toBe('services[0].picks[2]');
  });
  it('단발 추가는 새 줄 — Duplicate 는 바로 뒤', () => {
    const dup = duplicatePick(p, { service: 0, pick: 2 });
    expect(selectionAfter({ type: 'select', path: 'services[0].picks[3]' }, 'services[0].picks[2]', p, dup)).toBe('services[0].picks[3]');
    const sub = addPresetPick(p, null, 'subnet');
    expect(selectionAfter({ type: 'select', path: `projectPicks[${sub.projectPicks.length - 1}]` }, 'network', p, sub)).toBe('projectPicks[5]');
    expect(selectionAfter({ type: 'select', path: 'services[2]' }, 'project', p, addService(p))).toBe('services[2]');
  });
  it('pick 삭제 — 다음 형제 · 없으면 이전 형제 · 없으면 부모 줄', () => {
    const rm = (path: string, ref: { service: number | null; pick: number }) => selectionAfter({ type: 'removePick', path }, path, p, removePick(p, ref));
    expect(rm('services[0].picks[0]', { service: 0, pick: 0 })).toBe('services[0].picks[0]');
    expect(rm('services[0].picks[2]', { service: 0, pick: 2 })).toBe('services[0].picks[1]');
    expect(rm('services[1].picks[0]', { service: 1, pick: 0 })).toBe('services[1]');
    // 네트워크 형제는 네트워크 pick 끼리 — extras 로 넘어가지 않는다
    expect(rm('projectPicks[3]', { service: null, pick: 3 })).toBe('projectPicks[2]');
    expect(rm('projectPicks[1]', { service: null, pick: 1 })).toBe('projectPicks[1]');
    expect(rm('projectPicks[4]', { service: null, pick: 4 })).toBe('extras');
  });
  it('서비스 삭제 — 다음 서비스 · 없으면 이전 서비스 · 없으면 project', () => {
    expect(selectionAfter({ type: 'removeService', service: 0 }, 'services[0]', p, removeService(p, 0))).toBe('services[0]');
    expect(selectionAfter({ type: 'removeService', service: 1 }, 'services[1]', p, removeService(p, 1))).toBe('services[0]');
    const one = removeService(p, 1);
    expect(selectionAfter({ type: 'removeService', service: 0 }, 'services[0]', one, removeService(one, 0))).toBe('project');
  });
  it('계획이 통째로 바뀌어 경로가 사라지면 project', () => {
    expect(selectionAfter({ type: 'keep' }, 'services[1].picks[0]', p, initialPlan())).toBe('project');
    expect(resolveSelection(initialPlan(), 'services[1].picks[0]')).toBe('project');
  });
});

describe('오류 배지 · 첫 선택', () => {
  it('오류가 없으면 project · 오류가 있으면 그 줄 · 머리 줄은 자식 오류를 합친다', () => {
    const p = sample();
    expect(firstErrorRow(p, [], [])).toBe('project');
    const bad = duplicatePick(p, { service: 0, pick: 2 });
    const check = validatePlan(bad);
    const errors = check.ok ? [] : check.errors;
    expect(errors.length).toBeGreaterThan(0);
    expect(firstErrorRow(bad, errors, [])).toBe('services[0].picks[3]');
    expect(rowErrorCount(bad, 'services[0]', errors, [])).toBe(rowErrorCount(bad, 'services[0].picks[3]', errors, []));
    expect(rowErrorCount(bad, 'services[1]', errors, [])).toBe(0);
    expect(firstErrorRow(bad, errors, [], 1)).toBe('project');
    // 서비스 문맥 오류(이름) — 서비스 줄
    expect(firstErrorRow(p, [], [[], [{ code: 'name.token_empty', field: 'purpose' }]])).toBe('services[1]');
  });
});

describe('줄 이름 rowNames — 항목 키 머리 접두 일치 (core 변경 없음)', () => {
  it('온전하지 않으면 없다', () => {
    expect(rowNames(sample(), { service: 0, pick: 0 }, undefined)).toBeUndefined();
  });
  it('첫 이름과 나머지 수(딸린 이름 포함) · env 하나의 결과에서', () => {
    const p = sample();
    const r = result(p);
    const web = rowNames(p, { service: 0, pick: 0 }, r);
    expect(web).toEqual({ first: r.items.find((i) => i.key === 'service/shop/compute_instance/-/web/01')!.name, rest: 0 });
    expect(rowNames(p, { service: null, pick: 4 }, r)?.first).toBe(r.items.find((i) => i.key.startsWith('project/-/pubsub_topic/'))!.name);
  });
  it('모든 프리셋 × 종류 · tier 변형 — 항목마다 정확히 한 pick 에 맞고 pick 마다 하나 이상', () => {
    // 서비스 칩 전부 · 네트워크 칩 전부(방화벽 tier 칩 · 서브넷 종류 셋) · 역할 둘 · 버킷 tier 둘 · custom 하나
    let p = startPlan(DEFAULT_PROJECT);
    for (const pr of SERVICE_PRESETS) p = togglePreset(p, 0, pr.id);
    p = renameService(addService(p), 1, 'pay');
    p = togglePreset(p, 1, 'sa');
    p = addPresetPick(p, 1, 'sa');
    p = setPickField(p, { service: 1, pick: 1 }, 'role', 'deploy');
    p = togglePreset(p, 1, 'object');
    p = setPickField(p, { service: 1, pick: 2 }, 'tier', 'uploads');
    p = addPresetPick(p, 1, 'object');
    p = setPickField(p, { service: 1, pick: 3 }, 'tier', 'backups');
    p = togglePreset(p, 1, 'web');
    p = setPickField(p, { service: 1, pick: 4 }, 'kind', undefined);
    p = { ...p, services: p.services.map((s, i) => (i === 1 ? { ...s, picks: [...s.picks, { preset: 'web', serverless: 'gcp.run_service', instances: [{ id: '1', seq: '02' }] }] } : s)) };
    for (const t of presetOf('firewall')!.tierChoices ?? []) p = togglePreset(p, null, 'firewall', t);
    p = togglePreset(p, null, 'psa');
    p = addPresetPick(p, null, 'subnet');
    p = setPickField(p, { service: null, pick: p.projectPicks.length - 1 }, 'kind', 'REGIONAL_MANAGED_PROXY');
    p = addPresetPick(p, null, 'subnet');
    p = setPickField(p, { service: null, pick: p.projectPicks.length - 1 }, 'kind', 'PRIVATE_SERVICE_CONNECT');
    p = setPickField(p, { service: null, pick: p.projectPicks.length - 1 }, 'tier', 'edge');
    p = addCustom(p, 0, { ruleId: 'gcp.compute_instance', input: 'count', count: 2, tier: 'batch' });
    expect(PROJECT_PRESETS.every((pr) => p.projectPicks.some((x) => x.preset === pr.id))).toBe(true);
    expect(validatePlan(p)).toEqual({ ok: true });
    const r = result(p);
    const refs = [
      ...p.projectPicks.map((_, k) => ({ service: null, pick: k })),
      ...p.services.flatMap((s, i) => s.picks.map((_, j) => ({ service: i, pick: j }))),
    ];
    let total = 0;
    for (const ref of refs) {
      const rn = rowNames(p, ref, r);
      expect(rn, JSON.stringify(ref)).toBeDefined();
      total += 1 + rn!.rest;
    }
    // 프로젝트 ID 하나만 어느 pick 에도 들지 않는다 — 합이 맞으면 항목이 두 pick 에 겹쳐 세이지 않았다
    expect(total).toBe(r.items.length - 1);
  });
});

describe('더한 줄 — selectAdded · addedRow', () => {
  const p = sample();
  it('묶음 끝에 더한 pick 을 고른다 · 상한이면 그대로', () => {
    const after = addCustom(p, 0, { ruleId: 'gcp.pubsub_topic', input: 'count', count: 1 });
    const op = selectAdded(0);
    expect(typeof op === 'function' ? op(p, after) : op).toEqual({ type: 'select', path: 'services[0].picks[3]' });
    expect(typeof op === 'function' ? op(p, p) : op).toEqual({ type: 'keep' });
  });
  it('칩으로 더한 줄 · 지우거나 서비스를 더하면 없다', () => {
    expect(addedRow(p, togglePreset(p, 1, 'db'))).toBe('services[1].picks[1]');
    expect(addedRow(p, togglePreset(p, null, 'psa'))).toBe('projectPicks[5]');
    expect(addedRow(p, togglePreset(p, 0, 'web'))).toBeUndefined();
    expect(addedRow(p, addService(p))).toBeUndefined();
  });
  it('가운데에 끼운 줄은 그 자리 — Duplicate 는 원본 바로 뒤에 끼운다(끝이 아니다)', () => {
    const dup = duplicatePick(p, { service: 0, pick: 0 });
    expect(addedRow(p, dup)).toBe('services[0].picks[1]');
    // 바꾸지 않은 pick 은 같은 객체 그대로다 — addedRow 가 끼운 자리를 찾는 근거
    expect(dup.services[0]!.picks[0]).toBe(p.services[0]!.picks[0]);
    expect(dup.services[0]!.picks[2]).toBe(p.services[0]!.picks[1]);
    const net = duplicatePick(p, { service: null, pick: 1 });
    expect(addedRow(p, net)).toBe('projectPicks[2]');
  });
});

describe('서비스를 지운 뒤의 펼침 상태 — 자리 번호를 당긴다', () => {
  it('지운 서비스의 펼침이 다음 서비스로 옮겨 붙지 않는다', () => {
    const t = new Map([[0, false], [1, true], [3, false]]);
    expect([...expandedAfterRemove(t, 1)]).toEqual([[0, false], [2, false]]);
    expect([...expandedAfterRemove(t, 0)]).toEqual([[0, true], [2, false]]);
    expect([...expandedAfterRemove(t, 5)]).toEqual([[0, false], [1, true], [3, false]]);
  });
});

describe('줄 제목 rowTitle — 폰 시트의 머리', () => {
  it('머리 줄 · 서비스 · pick', () => {
    const p = sample();
    expect(rowTitle(p, 'project')).toBe('Project');
    expect(rowTitle(p, 'network')).toBe('Network');
    expect(rowTitle(p, 'extras')).toBe('Shared extra resources');
    expect(rowTitle(p, 'services[0]')).toBe(p.services[0]!.purpose);
    expect(rowTitle(p, 'projectPicks[0]')).toBe('VPC network');
    expect(rowTitle(p, 'services[9]')).toBe('unnamed');
  });
});
