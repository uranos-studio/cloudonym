import { describe, it, expect } from 'vitest';
import {
  addCustom, addDisk, addService, addSlot, canAttach, DEFAULT_PROJECT, effectiveRuleId, errorsUnder, findPreset, hasGaps, initialPlan, nextSeq, nextSlotId,
  removeDisk, removePick, removeService, removeSlot, renameService, renumber, seqInvalid, setDiskSeq, setFlag, setHa, setServerless, setSlotSeq,
  showsHa, togglePreset, SERVICE_PRESETS, PROJECT_PRESETS, type PickRef,
} from './wizardState';
import { expandPlan, validatePlan, SLOT_ID_PATTERN, type WizardPlan } from '../core/wizard/plan';
import { generateProject } from '../core/engine';
import { DEFAULT_FORM } from './formContext';

const shop: PickRef = { service: 0, pick: 0 };
const names = (plan: WizardPlan) => generateProject(expandPlan(plan), 'gcp').items.map((i) => i.name);
const ok = (plan: WizardPlan) => expect(validatePlan(plan)).toEqual({ ok: true });

describe('첫 화면 — 예시 넷 · 서비스 하나 · 고른 것 없음', () => {
  it('문맥 예시는 트리 화면 예시와 같다(purpose 없음) · 칩을 켜기 전에는 이름이 없다(wizard.empty)', () => {
    const { purpose: _p, ...four } = DEFAULT_FORM;
    expect(DEFAULT_PROJECT).toEqual(four);
    const p = initialPlan();
    expect(p.services).toEqual([{ purpose: 'shop', picks: [] }]);
    const r = validatePlan(p);
    expect(r.ok ? [] : r.errors.map((e) => e.code)).toEqual(['wizard.empty']);
  });
  it('칩 데이터 — 서비스 칩 여섯(web · was · bastion · file · db · object) · 프로젝트 칩은 network 묶음', () => {
    expect(SERVICE_PRESETS.map((p) => p.id)).toEqual(['web', 'was', 'bastion', 'file', 'db', 'object']);
    expect(PROJECT_PRESETS.map((p) => p.id)).toEqual(['vpc', 'subnet', 'firewall']);
  });
});

describe('용도 칩 · 서버 줄 (D61)', () => {
  it('web 칩 → 서버 줄 하나(01) · 이름 하나 · 다시 누르면 꺼진다', () => {
    const p = togglePreset(initialPlan(), 0, 'web');
    expect(p.services[0]!.picks).toEqual([{ preset: 'web', instances: [{ id: '1', seq: '01' }] }]);
    ok(p);
    expect(names(p)).toEqual(['platform-billing-prod', 'billing-shop-prod-ane3-gce-web-01']);
    expect(togglePreset(p, 0, 'web').services[0]!.picks).toEqual([]);
  });
  it('file 칩의 새 서버 줄에는 data 01 이 보이게 들어간다 · object 는 줄이 없다', () => {
    const p = togglePreset(togglePreset(initialPlan(), 0, 'file'), 0, 'object');
    expect(p.services[0]!.picks).toEqual([{ preset: 'file', instances: [{ id: '1', seq: '01', attach: { data: ['01'] } }] }, { preset: 'object' }]);
    ok(p);
  });
  it('방화벽 tier 칩은 tier 마다 pick 하나', () => {
    let p = togglePreset(initialPlan(), null, 'firewall', 'ssh');
    p = togglePreset(p, null, 'firewall', 'web');
    expect(p.projectPicks.map((x) => x.tier)).toEqual(['ssh', 'web']);
    expect(findPreset(p, null, 'firewall', 'web')).toBe(1);
    p = togglePreset(p, null, 'firewall', 'ssh');
    expect(p.projectPicks.map((x) => x.tier)).toEqual(['web']);
  });
  it('HA 토글 → 서버 줄 둘 · 줄 하나 지우면 토글 꺼짐 · 남은 줄의 seq 그대로', () => {
    let p = togglePreset(initialPlan(), 0, 'web');
    p = setHa(p, shop, true);
    expect(p.services[0]!.picks[0]).toEqual({ preset: 'web', ha: true, instances: [{ id: '1', seq: '01' }, { id: '2', seq: '02' }] });
    ok(p);
    p = removeSlot(p, shop, 0);
    expect(p.services[0]!.picks[0]).toEqual({ preset: 'web', instances: [{ id: '2', seq: '02' }] });
    ok(p);
    expect(names(p)).toContain('billing-shop-prod-ane3-gce-web-02');
  });
  it('HA 를 끄면 서버 줄은 그대로 남는다', () => {
    const p = setHa(setHa(togglePreset(initialPlan(), 0, 'web'), shop, true), shop, false);
    expect(p.services[0]!.picks[0]!.instances).toHaveLength(2);
    expect(p.services[0]!.picks[0]!.ha).toBeUndefined();
  });
  it('db · bastion · object 에는 HA 가 없다 — showsHa false · setHa 는 아무것도 켜지 않는다', () => {
    for (const id of ['db', 'bastion', 'object', 'file']) {
      const p = togglePreset(initialPlan(), 0, id);
      expect(showsHa(p.services[0]!.picks[0]!), id).toBe(false);
      expect(setHa(p, shop, true).services[0]!.picks[0]!.ha, id).toBeUndefined();
    }
    expect(showsHa({ preset: 'web' })).toBe(true);
  });
  it('serverless select 셋(off · gcf · run) → 규칙 전환 · HA 토글 숨김 · 딸린 것 떼기', () => {
    let p = togglePreset(initialPlan(), 0, 'web');
    p = setFlag(setHa(p, shop, true), shop, 0, 'boot', true);
    p = setServerless(p, shop, 'gcp.cloud_function');
    const pick = p.services[0]!.picks[0]!;
    expect(pick.ha).toBeUndefined();
    expect(pick.instances!.every((s) => s.attach === undefined)).toBe(true);
    expect(showsHa(pick)).toBe(false);
    expect(effectiveRuleId(pick)).toBe('gcp.cloud_function');
    expect(canAttach(pick)).toBe(false);
    ok(p);
    expect(names(p)).toContain('billing-shop-prod-ane3-gcf-web-01');
    p = setServerless(p, shop, 'gcp.run_service');
    expect(names(p)).toContain('billing-shop-prod-ane3-run-web-01');
    p = setServerless(p, shop, null);
    expect(p.services[0]!.picks[0]!.serverless).toBeUndefined();
    expect(effectiveRuleId(p.services[0]!.picks[0]!)).toBe('gcp.compute_instance');
  });
  it('「+ server」는 다음 빈 번호 · 지운 번호는 당기지 않는다 · 슬롯 id 는 보존 · 새 id 는 겹치지 않는다', () => {
    let p = togglePreset(initialPlan(), 0, 'was');
    p = addSlot(addSlot(p, shop), shop); // 01 02 03
    p = removeSlot(p, shop, 1); // 01 03
    expect(p.services[0]!.picks[0]!.instances!.map((s) => [s.id, s.seq])).toEqual([['1', '01'], ['3', '03']]);
    p = addSlot(p, shop);
    expect(p.services[0]!.picks[0]!.instances!.map((s) => [s.id, s.seq])).toEqual([['1', '01'], ['3', '03'], ['2', '04']]);
    ok(p);
  });
  it('서버 줄별 attach — 서버 1 은 boot + data 1, 서버 2 는 boot 만 (서비스 둘 사례 · 중립 이름)', () => {
    let p = togglePreset(initialPlan(), 0, 'web');
    p = addSlot(p, shop);
    p = setFlag(setFlag(p, shop, 0, 'boot', true), shop, 1, 'boot', true);
    p = addDisk(p, shop, 0);
    expect(p.services[0]!.picks[0]!.instances).toEqual([
      { id: '1', seq: '01', attach: { boot: true, data: ['01'] } },
      { id: '2', seq: '02', attach: { boot: true } },
    ]);
    ok(p);
  });
  it('디스크 줄을 지우면 남은 디스크 순번 그대로 · 「+ disk」는 다음 빈 번호 · 다 지우면 data 키가 없다', () => {
    let p = togglePreset(initialPlan(), 0, 'web');
    p = addDisk(addDisk(addDisk(p, shop, 0), shop, 0), shop, 0); // 01 02 03
    p = removeDisk(p, shop, 0, 1); // 01 03
    expect(p.services[0]!.picks[0]!.instances![0]!.attach).toEqual({ data: ['01', '03'] });
    p = addDisk(p, shop, 0);
    expect(p.services[0]!.picks[0]!.instances![0]!.attach).toEqual({ data: ['01', '03', '04'] });
    p = removeDisk(removeDisk(removeDisk(p, shop, 0, 0), shop, 0, 0), shop, 0, 0);
    expect(p.services[0]!.picks[0]!.instances![0]).toEqual({ id: '1', seq: '01' });
  });
  it('서버 순번 · 디스크 순번 입력이 SEQ_PATTERN 밖이면 줄에 오류 — 그 줄의 path 로 온다', () => {
    let p = togglePreset(initialPlan(), 0, 'web');
    p = addDisk(addSlot(p, shop), shop, 1);
    p = setSlotSeq(p, shop, 0, 'ab');
    p = setDiskSeq(p, shop, 1, 0, '00');
    expect(seqInvalid('ab')).toBe(true);
    expect(seqInvalid('00')).toBe(true);
    expect(seqInvalid('07')).toBe(false);
    const r = validatePlan(p);
    const errs = r.ok ? [] : r.errors;
    expect(errorsUnder(errs, 'services[0].picks[0].instances[0]').map((e) => e.code)).toEqual(['wizard.invalid_seq']);
    expect(errorsUnder(errs, 'services[0].picks[0].instances[1]').map((e) => [e.code, e.path])).toEqual([['wizard.invalid_data_seq', 'services[0].picks[0].instances[1].attach.data[0]']]);
  });
  it('다시 매기기는 누를 때만 — 01 · 03 → 01 · 02 (id · 딸린 것 그대로)', () => {
    let p = togglePreset(initialPlan(), 0, 'web');
    p = setFlag(addSlot(addSlot(p, shop), shop), shop, 2, 'ip', true);
    p = removeSlot(p, shop, 1);
    expect(hasGaps(p.services[0]!.picks[0]!)).toBe(true);
    p = renumber(p, shop);
    expect(p.services[0]!.picks[0]!.instances).toEqual([{ id: '1', seq: '01' }, { id: '3', seq: '02', attach: { ip: true } }]);
    expect(hasGaps(p.services[0]!.picks[0]!)).toBe(false);
  });
  it('nextSeq · nextSlotId', () => {
    expect(nextSeq([])).toBe('01');
    expect(nextSeq(['01', '05'])).toBe('06');
    expect(nextSeq(['99', '01'])).toBe('02');
    expect(nextSeq(['ab'])).toBe('01');
    expect(nextSlotId(['1', '2'])).toBe('3');
    const many = Array.from({ length: 40 }, (_, i) => (i + 1).toString(36));
    expect(SLOT_ID_PATTERN.test(nextSlotId(many))).toBe(true);
  });
});

describe('서비스 · custom', () => {
  it('서비스 둘 · 서비스 지우기 · 이름 바꾸기', () => {
    let p = addService(initialPlan());
    p = renameService(p, 1, 'pay');
    p = togglePreset(togglePreset(p, 0, 'web'), 1, 'web');
    ok(p);
    expect(names(p)).toEqual(['platform-billing-prod', 'billing-shop-prod-ane3-gce-web-01', 'billing-pay-prod-ane3-gce-web-01']);
    p = removeService(p, 0);
    expect(p.services.map((s) => s.purpose)).toEqual(['pay']);
  });
  it('custom — count 규칙은 count 만큼 줄 · role 규칙은 역할 · custom tier db 는 예약어로 거부', () => {
    let p = addCustom(initialPlan(), 0, { ruleId: 'gcp.compute_instance', input: 'count', count: 2, tier: 'batch' });
    p = addCustom(p, 0, { ruleId: 'gcp.service_account', input: 'role', role: 'worker' });
    expect(p.services[0]!.picks).toEqual([
      { preset: null, ruleId: 'gcp.compute_instance', tier: 'batch', instances: [{ id: '1', seq: '01' }, { id: '2', seq: '02' }] },
      { preset: null, ruleId: 'gcp.service_account', role: 'worker' },
    ]);
    ok(p);
    const bad = addCustom(initialPlan(), 0, { ruleId: 'gcp.compute_instance', input: 'count', tier: 'db' });
    const r = validatePlan(bad);
    expect(r.ok ? [] : r.errors.map((e) => [e.code, e.path])).toEqual([['wizard.tier_reserved', 'services[0].picks[0]']]);
    expect(removePick(p, { service: 0, pick: 1 }).services[0]!.picks).toHaveLength(1);
  });
});
