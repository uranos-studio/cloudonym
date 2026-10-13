import { describe, it, expect } from 'vitest';
import {
  addCustom, addDisk, PROJECT_NAME_RULE, addService, addSlot, canAttach, DEFAULT_PROJECT, effectiveRuleId, errorsUnder, findPreset, hasGaps, initialPlan, nextSeq, nextSlotId,
  removeDisk, removePick, removeService, removeSlot, renameService, renumber, seqInvalid, setDiskSeq, setFlag, setHa, setServerless, setSlotSeq,
  showsHa, togglePreset, addPresetPick, SERVICE_PRESETS, PROJECT_PRESETS, CUSTOM_TREE, PROJECT_CUSTOM_TREE, duplicatePick, setPickField, singleSlot, tierEditable, projectPickIndexes, setProjectIdSuffix, removePresetPicks, firewallTierProblem, pickTitle, projectPreview, projectPicksFull, startPlan, type PickRef,
} from './wizardState';
import { treeRules } from './selection';
import { buildTree } from '../core/tree';
import { expandPlan, validatePlan, MAX_PICKS_PER_SERVICE, PROJECT_ID_RULE, PROJECT_SCOPES, SLOT_ID_PATTERN, type WizardPlan } from '../core/wizard/plan';
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
  it('칩 데이터 — 서비스 칩은 level service(로드 밸런서 묶음 포함) · 프로젝트 칩은 network 묶음 (D73)', () => {
    expect(SERVICE_PRESETS.map((p) => p.id)).toEqual(['web', 'was', 'bastion', 'file', 'db', 'object', 'run', 'sa', 'secret', 'gke', 'wip', 'ip', 'ig', 'bs', 'hc', 'url', 'cert', 'thps', 'fwd', 'urlredir', 'thp', 'fwdredir', 'neg', 'bb']);
    expect(PROJECT_PRESETS.map((p) => p.id)).toEqual(['vpc', 'subnet', 'firewall', 'router', 'nat', 'psa']);
  });
  it('첫 화면에 서비스 칩을 전부 켜도(로드 밸런서 열하나 포함 · pick 상한 안) 이름은 전부 유효하고 축소되는 이름이 없다 (D91)', () => {
    const plan = SERVICE_PRESETS.reduce((p, x) => togglePreset(p, 0, x.id), startPlan(DEFAULT_PROJECT));
    expect(plan.services[0]!.picks.length).toBe(SERVICE_PRESETS.length);
    expect(SERVICE_PRESETS.length).toBeGreaterThan(20);
    expect(SERVICE_PRESETS.length).toBeLessThanOrEqual(MAX_PICKS_PER_SERVICE);
    expect(validatePlan(plan)).toEqual({ ok: true });
    const items = generateProject(expandPlan(plan), 'gcp').items;
    expect(items.filter((i) => !i.valid).map((i) => i.key)).toEqual([]);
    const shortened = items.filter((i) => i.steps.some((m) => m.code === 'step.token_dropped' || m.code === 'step.budget_shortened'));
    expect(shortened.map((i) => i.name)).toEqual([]);
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
  it('슬롯은 규칙의 입력 종류로 — sa(role 규칙)는 줄이 없고 기본 역할 sync · secret · router · nat(count 규칙)은 줄 하나 (D73)', () => {
    let p = togglePreset(togglePreset(initialPlan(), 0, 'sa'), 0, 'secret');
    p = togglePreset(togglePreset(p, null, 'router'), null, 'nat');
    expect(p.services[0]!.picks).toEqual([{ preset: 'sa' }, { preset: 'secret', instances: [{ id: '1', seq: '01' }] }]);
    expect(p.projectPicks).toEqual([{ preset: 'router', instances: [{ id: '1', seq: '01' }] }, { preset: 'nat', instances: [{ id: '1', seq: '01' }] }]);
    ok(p);
    expect(names(p)).toEqual(['platform-billing-prod', 'billing-prod-ane3-cr-01', 'billing-prod-nat-01', 'billing-shop-prod-sa-sync', 'billing-shop-prod-secret-01']);
  });
  it('NAT 와 Router 는 따로 켜고 끈다 — nat 만 켜도 router 가 생기지 않고 router 를 꺼도 nat 은 남는다 (D73)', () => {
    const nat = togglePreset(initialPlan(), null, 'nat');
    expect(nat.projectPicks.map((p) => p.preset)).toEqual(['nat']);
    const both = togglePreset(nat, null, 'router');
    expect(togglePreset(both, null, 'router').projectPicks.map((p) => p.preset)).toEqual(['nat']);
  });
  it('addPresetPick (D86) — 켜고 끄지 않고 하나 더 · 종류를 바꾸면 이름이 셋 · 같은 그대로면 duplicate_pick', () => {
    let p = addPresetPick(addPresetPick(initialPlan(), null, 'subnet'), null, 'subnet');
    expect(p.projectPicks).toEqual([{ preset: 'subnet', instances: [{ id: '1', seq: '01' }] }, { preset: 'subnet', instances: [{ id: '1', seq: '01' }] }]);
    const r = validatePlan(p);
    expect(r.ok ? [] : r.errors.map((e) => e.code)).toEqual(['wizard.duplicate_pick']);
    p = { ...p, projectPicks: [{ ...p.projectPicks[0]!, tier: 'web' }, { ...p.projectPicks[1]!, tier: 'app' }] };
    p = addPresetPick(p, null, 'subnet');
    p = { ...p, projectPicks: p.projectPicks.map((x, i) => (i === 2 ? { ...x, kind: 'REGIONAL_MANAGED_PROXY' } : x)) };
    ok(p);
    expect(names(p)).toEqual(['platform-billing-prod', 'billing-prod-ane3-snet-web-01', 'billing-prod-ane3-snet-app-01', 'billing-prod-ane3-snet-proxy-01']);
  });
  it('addPresetPick — 모르는 프리셋이면 그대로 · 서비스 칸에도 더한다', () => {
    const base = initialPlan();
    expect(addPresetPick(base, null, 'nope')).toBe(base);
    expect(addPresetPick(addPresetPick(base, 0, 'object'), 0, 'object').services[0]!.picks).toEqual([{ preset: 'object' }, { preset: 'object' }]);
  });
  it('방화벽 — iap · lbhc 칩과 직접 친 tier 도 pick 하나씩 · 이름 (D87)', () => {
    let p = togglePreset(initialPlan(), null, 'firewall', 'iap');
    p = togglePreset(p, null, 'firewall', 'lbhc');
    p = togglePreset(p, null, 'firewall', 'smtp');
    ok(p);
    expect(names(p)).toEqual(['platform-billing-prod', 'billing-prod-fw-iap-01', 'billing-prod-fw-lbhc-01', 'billing-prod-fw-smtp-01']);
    expect(findPreset(p, null, 'firewall', 'smtp')).toBe(2);
  });
  it('psa 칩 (D88) — 종류를 싣지 않아도 INTERNAL(int) · tier psa · 전역이라 지역 토큰 없음 · count 규칙이라 줄 하나', () => {
    const p = togglePreset(initialPlan(), null, 'psa');
    expect(p.projectPicks).toEqual([{ preset: 'psa', instances: [{ id: '1', seq: '01' }] }]);
    ok(p);
    expect(names(p)).toEqual(['platform-billing-prod', 'billing-prod-ip-int-psa-01']);
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

describe('custom 모달의 트리 — 프로젝트 ID · 프로젝트 이름은 Project 칸이 만들어 고를 수 없다 (D95)', () => {
  it('gcp.project_id · gcp.project_name 만 빠지고 나머지 GCP 규칙은 다 있다', () => {
    const ids = treeRules(CUSTOM_TREE).map((r) => r.id);
    const all = treeRules(buildTree('gcp')).map((r) => r.id);
    expect(all).toContain('gcp.project_id');
    expect(all).toContain(PROJECT_NAME_RULE);
    expect(ids).not.toContain('gcp.project_id');
    expect(ids).not.toContain(PROJECT_NAME_RULE);
    expect(treeRules(PROJECT_CUSTOM_TREE).map((r) => r.id)).not.toContain(PROJECT_NAME_RULE);
    expect(ids).toContain('gcp.service_account');
    expect(new Set(ids)).toEqual(new Set(all.filter((id) => id !== 'gcp.project_id' && id !== PROJECT_NAME_RULE)));
  });
  it('엔진은 프로젝트 이름 custom pick 을 그대로 받는다 — 화면 트리에서만 뺐다', () => {
    const p = addCustom(initialPlan(), null, { ruleId: PROJECT_NAME_RULE, input: 'none' });
    expect(validatePlan(p).ok).toBe(true);
  });
  it('프로젝트 공용 칸의 트리는 PROJECT_SCOPES 규칙만 (프로젝트 ID 제외) · 어느 것을 골라도 level_not_supported 가 없다 (D74)', () => {
    const all = treeRules(buildTree('gcp'));
    const want = all.filter((r) => PROJECT_SCOPES.includes(r.scope) && r.id !== PROJECT_ID_RULE && r.id !== PROJECT_NAME_RULE).map((r) => r.id);
    const ids = treeRules(PROJECT_CUSTOM_TREE).map((r) => r.id);
    expect(want.length).toBeGreaterThan(5);
    expect(new Set(ids)).toEqual(new Set(want));
    expect(ids).toContain('gcp.vpc_network');
    expect(ids).not.toContain('gcp.cloud_sql_database');
    for (const r of treeRules(PROJECT_CUSTOM_TREE)) {
      const kind = r.kinds?.rule === 'required' ? r.kinds.allowed[0] : undefined;
      const p = addCustom({ ...initialPlan(), services: [] }, null, { ruleId: r.id, input: r.template.includes('seq') ? 'count' : r.template.includes('role') ? 'role' : 'none', ...(kind ? { kind } : {}) });
      const res = validatePlan(p);
      expect(res.ok ? [] : res.errors.map((e) => e.code), r.id).not.toContain('wizard.level_not_supported');
    }
  });
});

describe('같은 종류 둘 — Duplicate 는 tier 를 비운 복사본 (D74)', () => {
  it('버킷 둘: 복사 직후 duplicate_pick · uploads/backups 를 치면 통과하고 이름 둘', () => {
    let p = togglePreset(initialPlan(), 0, 'object');
    expect(tierEditable(p.services[0]!.picks[0]!)).toBe(true);
    p = duplicatePick(p, shop);
    expect(p.services[0]!.picks).toEqual([{ preset: 'object' }, { preset: 'object' }]);
    const r = validatePlan(p);
    expect(r.ok ? [] : r.errors.map((e) => [e.code, e.path])).toEqual([['wizard.duplicate_pick', 'services[0].picks[1]']]);
    p = setPickField(p, shop, 'tier', 'uploads');
    p = setPickField(p, { service: 0, pick: 1 }, 'tier', 'backups');
    ok(p);
    expect(names(p).slice(1)).toEqual(['platform-billing-shop-prod-ane3-gcs-uploads', 'platform-billing-shop-prod-ane3-gcs-backups']);
  });
  it('count 규칙의 복사본은 tier · HA 없이 새 서버 줄 01 하나 · 복사본은 원본 바로 뒤', () => {
    let p = togglePreset(initialPlan(), 0, 'db');
    p = setPickField(p, shop, 'tier', 'main');
    p = addSlot(p, shop);
    p = togglePreset(p, 0, 'object');
    p = duplicatePick(p, shop);
    expect(p.services[0]!.picks.map((x) => x.preset)).toEqual(['db', 'db', 'object']);
    expect(p.services[0]!.picks[1]).toEqual({ preset: 'db', instances: [{ id: '1', seq: '01' }] });
    p = setPickField(p, { service: 0, pick: 1 }, 'tier', 'replica');
    ok(p);
    // HA 를 켠 서버 두 대의 복사본은 HA 없이 줄 하나
    let w = setHa(togglePreset(initialPlan(), 0, 'web'), shop, true);
    expect(w.services[0]!.picks[0]!.ha).toBe(true);
    w = duplicatePick(w, shop);
    expect(w.services[0]!.picks[1]).toEqual({ preset: 'web', instances: [{ id: '1', seq: '01' }] });
  });
  it('원본에 tier 가 있으면 복사본(tier 없음)은 바로 통과한다 — 중복 오류는 tier 없는 같은 pick 이 이미 있을 때만', () => {
    let p = setPickField(togglePreset(initialPlan(), 0, 'object'), shop, 'tier', 'uploads');
    p = duplicatePick(p, shop);
    ok(p);
    expect(names(p).slice(1)).toEqual(['platform-billing-shop-prod-ane3-gcs-uploads', 'platform-billing-shop-prod-ane3-gcs']);
  });
  it('프리셋이 tier 를 정하면(web · 방화벽) · 역할 규칙 · tier 자리 없는 규칙은 tier 칸도 Duplicate 도 없다', () => {
    expect(tierEditable({ preset: 'web', instances: [] })).toBe(false);
    expect(tierEditable({ preset: 'firewall', tier: 'ssh', instances: [] })).toBe(false);
    expect(tierEditable({ preset: 'sa' })).toBe(false);
    expect(tierEditable({ preset: null, ruleId: 'gcp.cloud_sql_user' })).toBe(false);
    expect(tierEditable({ preset: null, ruleId: 'gcp.compute_instance', instances: [] })).toBe(true);
    expect(tierEditable({ preset: 'vpc', instances: [] })).toBe(true);
  });
});

describe('VPC 는 하나로 시작한다 (D75)', () => {
  it('VPC 칩은 줄 하나 · 더하기 · 다시 매기기를 숨긴다 · 줄이 둘이면(API 로 만든 계획) 보인다 · 다른 칩은 그대로', () => {
    let p = togglePreset(initialPlan(), null, 'vpc');
    const vpc = { service: null, pick: 0 };
    expect(p.projectPicks[0]!.instances).toHaveLength(1);
    expect(singleSlot(p.projectPicks[0]!)).toBe(true);
    // 번호만 바꾼 하나(03)도 하나다 — 다시 매기기 단추가 없어도 이름이 된다
    p = setSlotSeq(p, vpc, 0, '03');
    expect(singleSlot(p.projectPicks[0]!)).toBe(true);
    ok(p);
    // VPC 둘(01 · 03)인 계획 — 모델 그대로 풀리고 화면은 전부 보인다
    p = addSlot(p, vpc);
    expect(singleSlot(p.projectPicks[0]!)).toBe(false);
    ok(p);
    expect(singleSlot(togglePreset(initialPlan(), null, 'subnet').projectPicks[0]!)).toBe(false);
  });
});

describe('프로젝트 공용 칸의 두 자리 (D84) — ② 네트워크는 프리셋 pick, Shared extra resources 는 custom pick', () => {
  it('섞어 넣어도 자리 번호(path)는 모델 순서 그대로이고 두 칸이 겹치지 않는다', () => {
    let p = togglePreset(initialPlan(), null, 'vpc');
    p = addCustom(p, null, { ruleId: 'gcp.storage_bucket', input: 'none' });
    p = togglePreset(p, null, 'subnet');
    expect(projectPickIndexes(p, 'network')).toEqual([0, 2]);
    expect(projectPickIndexes(p, 'extras')).toEqual([1]);
    expect(projectPickIndexes(initialPlan(), 'network')).toEqual([]);
  });
});

describe('서브넷마다 종류와 tier (D86) — Add subnet · 칩 끄기 · 머리 이름', () => {
  it('Add subnet 둘째 pick 은 따로 kind · tier 를 갖고 이름이 셋 다 다르다 · 칩을 끄면 전부 뗀다', () => {
    let p = togglePreset(initialPlan(), null, 'subnet');
    p = addPresetPick(p, null, 'subnet');
    p = addPresetPick(p, null, 'subnet');
    p = setPickField(p, { service: null, pick: 1 }, 'kind', 'REGIONAL_MANAGED_PROXY');
    p = setPickField(p, { service: null, pick: 2 }, 'tier', 'web');
    ok(p);
    expect(names(p).slice(1)).toEqual(['billing-prod-ane3-snet-01', 'billing-prod-ane3-snet-proxy-01', 'billing-prod-ane3-snet-web-01']);
    expect(p.projectPicks.map(pickTitle).map((t) => t.title)).toEqual(['Subnet', 'Subnet · proxy', 'Subnet · web']);
    expect(removePresetPicks(p, null, 'subnet').projectPicks).toEqual([]);
  });
  it('고정 종류(psa)는 머리에 종류를 붙이지 않고 · 방화벽은 tier 칩 값 · custom 은 규칙 이름', () => {
    expect(pickTitle({ preset: 'psa' }).title).toBe('Private services access range');
    expect(pickTitle({ preset: 'firewall', tier: 'iap', instances: [] }).title).toBe('Firewall rule · iap');
    expect(pickTitle({ preset: null, ruleId: 'gcp.storage_bucket' })).toEqual({ title: 'Cloud Storage Bucket', custom: true });
  });
});

describe('방화벽 tier 직접 입력 (D87) — 사전 검사', () => {
  it('꼴 · 예약어 · 이미 있음을 막고, 통과한 tier 는 규칙 하나를 더해 이름이 된다', () => {
    let p = togglePreset(initialPlan(), null, 'firewall', 'ssh');
    expect(firewallTierProblem(p, 'A')).toBe('pattern');
    expect(firewallTierProblem(p, 'db')).toBe('reserved');
    expect(firewallTierProblem(p, 'ssh')).toBe('exists');
    expect(firewallTierProblem(p, 'app')).toBeUndefined();
    p = togglePreset(p, null, 'firewall', 'app');
    ok(p);
    expect(names(p).slice(1)).toEqual(['billing-prod-fw-ssh-01', 'billing-prod-fw-app-01']);
  });
});

describe('프로젝트 ID 접미사 (D85) — 빈 칸이면 키를 지운다', () => {
  it('값을 넣으면 ID 끝에 붙고 · 비우면 키가 없어 접미사 없는 모델과 같다', () => {
    const base = togglePreset(initialPlan(), null, 'vpc');
    const withX = setProjectIdSuffix(base, 'team1');
    ok(withX);
    expect(names(withX)[0]).toBe('platform-billing-prod-team1');
    const cleared = setProjectIdSuffix(withX, '');
    expect('projectIdSuffix' in cleared).toBe(false);
    expect(cleared).toEqual(base);
  });
});

describe('① 미리보기 (D85) — 프로젝트 이름은 ID 위 · ID 는 엔진의 첫 항목과 같다', () => {
  it('접미사 없으면 이름 = ID 글자 · 접미사는 ID 에만 붙는다', () => {
    const ctx = { owner: 'example', system: 'billing', env: 'prod' as const, region: 'ane3' };
    const a = projectPreview(ctx, undefined);
    expect([a.name?.name, a.name?.valid, a.id?.name]).toEqual(['example-billing-prod', true, 'example-billing-prod']);
    const b = projectPreview(ctx, 'team1');
    expect([b.name?.name, b.id?.name, b.id?.key]).toEqual(['example-billing-prod', 'example-billing-prod-team1', 'project/-/project_id/-/-/-']);
    const plan = setProjectIdSuffix(togglePreset(initialPlan({ ...ctx, region: 'asia-northeast3' }), null, 'vpc'), 'team1');
    expect(names(plan)[0]).toBe(b.id?.name);
  });
});

describe('3차 리뷰 고침 — 방화벽 사전 검사 · 프로젝트 pick 상한 · 틀린 접미사 미리보기', () => {
  const fwCustom = (tier: string) => ({ preset: null, ruleId: 'gcp.firewall_rule', tier, instances: [{ id: '1', seq: '01' }] });
  it('Shared extras 의 custom 방화벽(tier app)과 같은 tier 를 치면 exists — 엔진의 중복 키로 본다', () => {
    const p: WizardPlan = { ...initialPlan(), projectPicks: [fwCustom('app')] };
    ok(p);
    expect(firewallTierProblem(p, 'app')).toBe('exists');
    expect(firewallTierProblem(p, 'api')).toBeUndefined();
  });
  it('프로젝트 pick 이 상한(MAX_PICKS_PER_SERVICE)이면 더하는 함수는 모델을 그대로 두고 · 사전 검사는 full', () => {
    const p: WizardPlan = { ...initialPlan(), projectPicks: Array.from({ length: MAX_PICKS_PER_SERVICE }, (_, i) => fwCustom(`t${String(i).padStart(2, '0')}`)) };
    ok(p);
    expect(projectPicksFull(p)).toBe(true);
    expect(addPresetPick(p, null, 'subnet')).toBe(p);
    expect(togglePreset(p, null, 'vpc')).toBe(p);
    expect(addCustom(p, null, { ruleId: 'gcp.storage_bucket', input: 'none' })).toBe(p);
    expect(firewallTierProblem(p, 'app')).toBe('full');
    expect(projectPicksFull(initialPlan())).toBe(false);
  });
  it('틀린 접미사(db)면 ID 미리보기를 내지 않는다 — 접미사 없는 ID 로 속이지 않는다', () => {
    const ctx = { owner: 'example', system: 'billing', env: 'prod' as const, region: 'ane3' };
    expect(projectPreview(ctx, 'db').id).toBeUndefined();
    expect(projectPreview(ctx, 'db').name?.name).toBe('example-billing-prod');
    expect(projectPreview(ctx, '').id).toBeUndefined();
  });
});
