// 카드 화면 상태 (D93) — 더하기 · 되읽기 · 미완성 · 가족 · 상한 · 지우기(공용 방화벽은 남는다)
import { describe, it, expect } from 'vitest';
import { addBundle, cardBlocked, cardIn, cardsIn, fillBlocked, fillMissing, optionBlocked, optionOn, partBlocked, partsToAdd, removeBundle, serviceLayout, setOption, setPart } from './wizardBundles';
import { addPresetPick, addService, DEFAULT_PROJECT, findPreset, renameService, startPlan, togglePreset } from './wizardState';
import { cardRow, parentRow, parseRow, rowExists, rowTitle, selectionAfter, visibleRows } from './wizardSelection';
import { decodeWizardState, encodeWizardState } from './urlState';
import { MAX_PICKS_PER_SERVICE, expandPlan, validatePlan, type WizardPlan } from '../core/wizard/plan';
import { generateProject } from '../core/engine';
import { bundleById } from '../core/wizard/bundles';
import { RULES_REVISION } from '../core/revision';

const ids = (plan: WizardPlan, s: number) => cardsIn(plan, s).map((m) => [m.bundle.id, m.complete]);
const presets = (plan: WizardPlan, s: number | null) => (s === null ? plan.projectPicks : plan.services[s]!.picks).map((p) => (p.tier ? `${p.preset}:${p.tier}` : p.preset));

describe('카드 더하기 (D93)', () => {
  it('website — 서비스 부품 12 + 기본 선택 db · 네트워크에 방화벽 web · lbhc 와 psa · 되읽으면 완성 · 이름이 전부 PASS', () => {
    const p = addBundle(startPlan(DEFAULT_PROJECT), 0, 'website');
    expect(presets(p, 0)).toEqual(['web', 'ig', 'hc', 'bs', 'ip', 'url', 'cert', 'thps', 'fwd', 'urlredir', 'thp', 'fwdredir', 'db']);
    expect(presets(p, null)).toEqual(['vpc', 'subnet', 'router', 'nat', 'firewall:web', 'firewall:lbhc', 'psa']);
    expect(ids(p, 0)).toEqual([['website', true]]);
    expect(validatePlan(p)).toEqual({ ok: true });
    const items = generateProject(expandPlan(p), 'gcp').items;
    expect(items.length).toBe(1 + 7 + 13);
    expect(items.every((i) => i.valid)).toBe(true);
  });

  it('카드로 더한 pick 은 칩으로 하나씩 켠 pick 과 같다 — hash · 이름이 바이트까지 같다 · 링크로 다시 열어도 같은 카드', () => {
    const viaCard = addBundle(startPlan(DEFAULT_PROJECT), 0, 'website', { db: false });
    let viaChips = startPlan(DEFAULT_PROJECT);
    for (const id of ['web', 'ig', 'hc', 'bs', 'ip', 'url', 'cert', 'thps', 'fwd', 'urlredir', 'thp', 'fwdredir']) viaChips = togglePreset(viaChips, 0, id);
    for (const t of ['web', 'lbhc']) viaChips = togglePreset(viaChips, null, 'firewall', t);
    expect(viaCard).toEqual(viaChips);
    const hash = encodeWizardState(viaCard, RULES_REVISION, [])!;
    expect(hash).toBe(encodeWizardState(viaChips, RULES_REVISION, []));
    const reopened = decodeWizardState(`#state=${hash}`)!.plan!;
    expect(ids(reopened, 0)).toEqual([['website', true]]);
  });

  it('serverless-web · static-site · vm-app — 각각 완성 · 헬스 체크 없음 · 방화벽 없음', () => {
    const run = addBundle(startPlan(DEFAULT_PROJECT), 0, 'serverless-web');
    expect(presets(run, 0)).toEqual(['run', 'neg', 'bs', 'ip', 'url', 'cert', 'thps', 'fwd', 'urlredir', 'thp', 'fwdredir']);
    expect(ids(run, 0)).toEqual([['serverless-web', true]]);
    const st = addBundle(startPlan(DEFAULT_PROJECT), 0, 'static-site');
    expect(presets(st, 0)).toEqual(['object', 'bb', 'ip', 'url', 'cert', 'thps', 'fwd', 'urlredir', 'thp', 'fwdredir']);
    expect(ids(st, 0)).toEqual([['static-site', true]]);
    const vm = addBundle(startPlan(DEFAULT_PROJECT), 0, 'vm-app');
    expect(presets(vm, 0)).toEqual(['web', 'was', 'db', 'bastion']);
    expect(presets(vm, null)).toEqual(['vpc', 'subnet', 'router', 'nat', 'firewall:ssh', 'firewall:icmp', 'firewall:iap', 'psa']);
    expect(ids(vm, 0)).toEqual([['vm-app', true]]);
    for (const p of [run, st, vm]) expect(validatePlan(p)).toEqual({ ok: true });
  });

  it('https-lb — 서비스에 있는 백엔드로 고른다: web 이면 VM 백엔드(→ website 로 되읽힌다) · run 이면 NEG · 없으면 앞쪽만 더하고 「백엔드 없음」', () => {
    const web = addBundle(togglePreset(startPlan(DEFAULT_PROJECT), 0, 'web'), 0, 'https-lb');
    expect(ids(web, 0)).toEqual([['website', true]]);
    const run = addBundle(togglePreset(startPlan(DEFAULT_PROJECT), 0, 'run'), 0, 'https-lb');
    expect(ids(run, 0)).toEqual([['serverless-web', true]]);
    const none = addBundle(startPlan(DEFAULT_PROJECT), 0, 'https-lb');
    expect(presets(none, 0)).toEqual(['ip', 'url', 'cert', 'thps', 'fwd', 'urlredir', 'thp', 'fwdredir']);
    const m = cardsIn(none, 0);
    expect(m.map((x) => [x.bundle.id, x.complete, x.noBackend])).toEqual([['https-lb', false, true]]);
    // 나중에 web 을 켜면 그 백엔드의 부품이 빠진 website 로 보인다 — 빠진 것은 인스턴스 그룹 · 헬스 체크 · backend service · 방화벽 둘
    const later = togglePreset(none, 0, 'web');
    expect(cardsIn(later, 0).map((x) => [x.bundle.id, x.missing.map((p) => (p.tier ? `${p.preset}:${p.tier}` : p.preset))])).toEqual([['website', ['ig', 'hc', 'bs', 'firewall:web', 'firewall:lbhc']]]);
    // 빠진 부품 더하기 — 같은 카드라 가족 검사에 걸리지 않는다
    expect(ids(addBundle(later, 0, 'website'), 0)).toEqual([['website', true]]);
  });
});

describe('되읽기 · 미완성 (D93)', () => {
  it('부품을 빼면 미완성 — 빠진 부품 목록 · 다시 켜면 완성', () => {
    const p = addBundle(startPlan(DEFAULT_PROJECT), 0, 'website');
    const noHc = setPart(p, 0, { preset: 'hc' }, false);
    expect(cardIn(noHc, 0, 'website')).toMatchObject({ complete: false, missing: [{ preset: 'hc' }] });
    expect(validatePlan(noHc)).toEqual({ ok: true }); // 엔진은 카드를 모른다 — 이름은 그대로 나온다
    expect(cardIn(setPart(noHc, 0, { preset: 'hc' }, true), 0, 'website')?.complete).toBe(true);
    // 네트워크의 lbhc 를 지워도 미완성 (D91 — 헬스 체크 대역을 받지 못하면 LB 가 응답하지 않는다)
    const noLbhc = togglePreset(p, null, 'firewall', 'lbhc');
    expect(cardIn(noLbhc, 0, 'website')).toMatchObject({ complete: false, missing: [{ preset: 'firewall', tier: 'lbhc' }] });
  });

  it('백엔드 부품 하나를 빼도 같은 LB 카드가 미완성으로 남는다 — website 에서 web · serverless-web 에서 run · static-site 에서 object · 선택은 카드 줄에 남는다', () => {
    const missingOf = (plan: WizardPlan) => cardsIn(plan, 0).map((m) => [m.bundle.id, m.complete, m.noBackend, m.missing.map((x) => x.preset)]);
    const site = addBundle(startPlan(DEFAULT_PROJECT), 0, 'website', { db: false });
    const noWeb = setPart(site, 0, { preset: 'web' }, false);
    expect(missingOf(noWeb)).toEqual([['website', false, false, ['web']]]);
    expect(selectionAfter({ type: 'keep' }, cardRow(0, 'website'), site, noWeb)).toBe(cardRow(0, 'website'));
    expect(ids(setPart(noWeb, 0, { preset: 'web' }, true), 0)).toEqual([['website', true]]);
    const run = addBundle(startPlan(DEFAULT_PROJECT), 0, 'serverless-web');
    expect(missingOf(setPart(run, 0, { preset: 'run' }, false))).toEqual([['serverless-web', false, false, ['run']]]);
    const st = addBundle(startPlan(DEFAULT_PROJECT), 0, 'static-site');
    expect(missingOf(setPart(st, 0, { preset: 'object' }, false))).toEqual([['static-site', false, false, ['object']]]);
  });

  it('칩 사용자의 흔한 조합은 카드 줄을 띄우지 않는다 — web · db · was 하나씩 · 주소 · 인증서만 · 앞쪽 하나라도 있으면 LB 카드', () => {
    let p = startPlan(DEFAULT_PROJECT);
    for (const id of ['web', 'db', 'ip', 'cert']) p = togglePreset(p, 0, id);
    expect(cardsIn(p, 0)).toEqual([]);
    expect(ids(togglePreset(p, 0, 'url'), 0)).toEqual([['website', false]]);
    const vm = togglePreset(togglePreset(togglePreset(startPlan(DEFAULT_PROJECT), 0, 'web'), 0, 'was'), 0, 'db');
    expect(cardsIn(vm, 0).map((m) => [m.bundle.id, m.complete, m.missing.length])).toEqual([['vm-app', false, 4]]);
  });

  it('다른 카드가 차지한 pick 이 든 카드는 보이지 않는다 — website + 선택 was · db 에 vm-app 이 뜨지 않아, 그 Remove 가 Website 의 선택을 지우지 않는다', () => {
    const p = addBundle(startPlan(DEFAULT_PROJECT), 0, 'website', { db: true, was: true });
    expect(cardsIn(p, 0).map((m) => [m.bundle.id, m.complete])).toEqual([['website', true]]);
    const { owned, loose } = serviceLayout(p, 0);
    expect(owned.get(0)).toBe('website');
    expect(loose).toEqual([12, 13]); // db · was — 선택 부품은 카드 밖 줄
    expect(removeBundle(p, 0, 'vm-app')).toEqual(p); // 보이지 않는 카드는 지울 것이 없다
    expect(optionOn(p, 0, bundleById('website')!.options[0]!.parts)).toBe(true);
    // vm-app 을 먼저 더하고 website 를 더해도 web 은 website(LB 카드)가 차지한다 — vm-app 의 나머지는 카드 밖 줄
    const both = addBundle(addBundle(startPlan(DEFAULT_PROJECT), 0, 'vm-app'), 0, 'website', { db: false });
    expect(ids(both, 0)).toEqual([['website', true]]);
    // 갤러리 — 더해도 vm-app 으로 되읽히지 않으니 단추가 꺼진다(부품만 흩어 놓지 않는다)
    expect(cardBlocked(p, 0, 'vm-app', {})).toBe('overlap');
    expect(addBundle(p, 0, 'vm-app')).toBe(p);
  });
});

describe('가족 · 상한 · 지우기 · 선택 (D93)', () => {
  it('한 서비스에 LB 카드는 하나 — 다른 LB 카드는 family · 서비스를 하나 더 만들면 둘째 LB · 방화벽은 다시 더하지 않는다', () => {
    let p = addBundle(startPlan(DEFAULT_PROJECT), 0, 'website', { db: false });
    expect(cardBlocked(p, 0, 'serverless-web', {})).toBe('family');
    expect(cardBlocked(p, 0, 'website', {})).toBe('present');
    expect(addBundle(p, 0, 'serverless-web')).toBe(p);
    p = renameService(addService(p), 1, 'blog');
    const before = p.projectPicks.length;
    p = addBundle(p, 1, 'website', { db: false });
    expect(p.projectPicks.length).toBe(before);
    expect(ids(p, 1)).toEqual([['website', true]]);
    expect(validatePlan(p)).toEqual({ ok: true });
  });

  it('백엔드 없는 https-lb 는 다른 LB 카드를 막지 않는다 — 안내(백엔드를 더하라)대로 website · serverless-web · static-site 가 백엔드를 채운다', () => {
    const none = addBundle(startPlan(DEFAULT_PROJECT), 0, 'https-lb');
    for (const id of ['website', 'serverless-web', 'static-site']) expect(cardBlocked(none, 0, id, {})).toBeUndefined();
    const w = addBundle(none, 0, 'website', { db: false });
    expect(ids(w, 0)).toEqual([['website', true]]);
    expect(validatePlan(w)).toEqual({ ok: true });
    expect(ids(addBundle(none, 0, 'serverless-web'), 0)).toEqual([['serverless-web', true]]);
    expect(ids(addBundle(none, 0, 'static-site'), 0)).toEqual([['static-site', true]]);
    // 백엔드가 있는 LB 카드는 그대로 막는다
    expect(cardBlocked(w, 0, 'static-site', {})).toBe('family');
  });

  it('Custom 으로 더한 같은 규칙과 이름이 겹치면 duplicate — 더하지 않는다(카드는 완성인데 계획이 wizard.duplicate_pick 이 되지 않게)', () => {
    const custom = { preset: null, ruleId: 'gcp.global_address', instances: [{ id: '1', seq: '01' }] };
    const svc: WizardPlan = { ...startPlan(DEFAULT_PROJECT), services: [{ ...startPlan(DEFAULT_PROJECT).services[0]!, picks: [custom] }] };
    expect(cardBlocked(svc, 0, 'website', { db: false })).toBe('duplicate');
    expect(addBundle(svc, 0, 'website', { db: false })).toBe(svc);
    // 프로젝트 공용 자리도 — Shared extras 의 custom 방화벽 규칙 tier web
    const fw = { preset: null, ruleId: 'gcp.firewall_rule', tier: 'web', instances: [{ id: '1', seq: '01' }] };
    const prj: WizardPlan = { ...startPlan(DEFAULT_PROJECT), projectPicks: [...startPlan(DEFAULT_PROJECT).projectPicks, fw] };
    expect(validatePlan(prj)).toEqual({ ok: true });
    expect(cardBlocked(prj, 0, 'website', { db: false })).toBe('duplicate');
    // 겹치지 않으면 그대로 더한다
    expect(cardBlocked(startPlan(DEFAULT_PROJECT), 0, 'website', { db: false })).toBeUndefined();
  });

  it('상한 — 더하면 40 을 넘는 카드는 full 이고 모델을 그대로 돌려준다(일부만 더하지 않는다)', () => {
    let p = startPlan(DEFAULT_PROJECT);
    for (let k = 0; k < MAX_PICKS_PER_SERVICE - 5; k++) p = { ...p, services: [{ ...p.services[0]!, picks: [...p.services[0]!.picks, { preset: null, ruleId: 'gcp.pubsub_topic', tier: `t${k}`, instances: [{ id: '1', seq: '01' }] }] }] };
    expect(partsToAdd(p, 0, 'website', {}).length).toBeGreaterThan(5);
    expect(cardBlocked(p, 0, 'website', {})).toBe('full');
    expect(addBundle(p, 0, 'website')).toBe(p);
  });

  it('카드를 지우면 그 카드의 서비스 부품만 — 선택(db)과 네트워크(방화벽 · psa)는 남는다', () => {
    const p = addBundle(startPlan(DEFAULT_PROJECT), 0, 'website');
    const r = removeBundle(p, 0, 'website');
    expect(presets(r, 0)).toEqual(['db']);
    expect(presets(r, null)).toEqual(presets(p, null));
    expect(cardsIn(r, 0)).toEqual([]);
  });

  it('점검표 · 선택도 상한을 넘기지 않는다 — 공용 40 에서 Bastion 을 켜도 방화벽만 빠진 채 들어가지 않고, 서비스 40 에서 부품을 켜도 41 이 되지 않는다', () => {
    const filler = (k: number) => ({ preset: null, ruleId: 'gcp.pubsub_topic', tier: `t${k}`, instances: [{ id: '1', seq: '01' }] });
    const base = addBundle(startPlan(DEFAULT_PROJECT), 0, 'website', { db: false });
    const prjFull: WizardPlan = { ...base, projectPicks: [...base.projectPicks, ...Array.from({ length: MAX_PICKS_PER_SERVICE - base.projectPicks.length }, (_, k) => filler(k))] };
    const bastion = bundleById('website')!.options.find((o) => o.id === 'bastion')!.parts;
    expect(optionBlocked(prjFull, 0, bastion)).toBe('full');
    expect(setOption(prjFull, 0, bastion, true)).toBe(prjFull);
    // 서비스 40 — hc 를 뗀 자리에 다른 pick 을 채우면 hc 를 다시 켤 수 없다
    const noHc = setPart(base, 0, { preset: 'hc' }, false);
    const svcFull: WizardPlan = { ...noHc, services: [{ ...noHc.services[0]!, picks: [...noHc.services[0]!.picks, ...Array.from({ length: MAX_PICKS_PER_SERVICE - noHc.services[0]!.picks.length }, (_, k) => filler(k))] }] };
    expect(partBlocked(svcFull, 0, { preset: 'hc' })).toBe('full');
    expect(setPart(svcFull, 0, { preset: 'hc' }, true)).toBe(svcFull);
    expect(optionBlocked(svcFull, 0, bundleById('website')!.options.find((o) => o.id === 'was')!.parts)).toBe('full');
    // 자리가 있으면 막지 않는다 · 켜진 선택을 끄는 것은 막지 않는다
    expect(partBlocked(noHc, 0, { preset: 'hc' })).toBeUndefined();
    expect(optionBlocked(setOption(base, 0, bastion, true), 0, bastion)).toBeUndefined();
  });

  it('「Add missing parts」는 빠진 필수 부품만 — 끄는 판정과 동작이 같은 선택(전부 끔)을 쓴다', () => {
    const filler = (k: number) => ({ preset: null, ruleId: 'gcp.pubsub_topic', tier: `t${k}`, instances: [{ id: '1', seq: '01' }] });
    const noHc = setPart(addBundle(startPlan(DEFAULT_PROJECT), 0, 'website', { db: false }), 0, { preset: 'hc' }, false);
    // 39 — hc 하나는 들어가지만 기본 선택(db)까지면 넘는다
    const p: WizardPlan = { ...noHc, services: [{ ...noHc.services[0]!, picks: [...noHc.services[0]!.picks, ...Array.from({ length: MAX_PICKS_PER_SERVICE - 1 - noHc.services[0]!.picks.length }, (_, k) => filler(k))] }] };
    expect(cardBlocked(p, 0, 'website', {})).toBe('full');
    expect(fillBlocked(p, 0, 'website')).toBeUndefined();
    const filled = fillMissing(p, 0, 'website');
    expect(cardIn(filled, 0, 'website')?.complete).toBe(true);
    expect(filled.services[0]!.picks.length).toBe(MAX_PICKS_PER_SERVICE);
  });

  it('카드는 공용 부품을 지우지 않는다 — 점검표의 네트워크 부품 끄기는 아무것도 바꾸지 않아 다른 서비스의 카드가 미완성이 되지 않는다', () => {
    let p = addBundle(startPlan(DEFAULT_PROJECT), 0, 'website', { db: false });
    p = addBundle(renameService(addService(p), 1, 'blog'), 1, 'website', { db: false });
    expect(setPart(p, 0, { preset: 'firewall', tier: 'lbhc' }, false)).toBe(p);
    expect(ids(p, 1)).toEqual([['website', true]]);
    // 빠졌으면 켜는 것은 된다(빠진 부품 채우기)
    const noLbhc = togglePreset(p, null, 'firewall', 'lbhc');
    expect(ids(setPart(noLbhc, 0, { preset: 'firewall', tier: 'lbhc' }, true), 1)).toEqual([['website', true]]);
  });

  it('선택 켜고 끄기 — 켜면 공용 부품까지, 끄면 서비스 부품만', () => {
    const p = addBundle(startPlan(DEFAULT_PROJECT), 0, 'website', { db: false });
    const parts = bundleById('website')!.options.find((o) => o.id === 'bastion')!.parts;
    expect(optionOn(p, 0, parts)).toBe(false);
    const on = setOption(p, 0, parts, true);
    expect(optionOn(on, 0, parts)).toBe(true);
    expect(findPreset(on, null, 'firewall', 'ssh')).toBeGreaterThanOrEqual(0);
    const off = setOption(on, 0, parts, false);
    expect(findPreset(off, 0, 'bastion')).toBe(-1);
    expect(findPreset(off, null, 'firewall', 'iap')).toBeGreaterThanOrEqual(0);
  });
});

describe('카드 줄 (D93)', () => {
  it('경로 · 있는지 · 부모 · 제목 · 보이는 줄(카드는 닫히면 줄 하나, 열면 부품 줄)', () => {
    const p = addPresetPick(addBundle(startPlan(DEFAULT_PROJECT), 0, 'website'), 0, 'secret');
    const row = cardRow(0, 'website');
    expect(row).toBe('services[0].card.website');
    expect(parseRow(row)).toEqual({ kind: 'card', service: 0, card: 'website' });
    expect(rowExists(p, row)).toBe(true);
    expect(rowExists(p, cardRow(0, 'static-site'))).toBe(false);
    expect(parentRow(p, row)).toBe('services[0]');
    expect(parentRow(p, 'services[0].picks[0]')).toBe(row);
    expect(parentRow(p, 'services[0].picks[12]')).toBe('services[0]'); // db — 선택 부품은 카드 밖
    expect(rowTitle(p, row)).toBe('Website');
    const closed = visibleRows(p, () => true, () => false, false);
    expect(closed).toEqual(['project', 'network', 'services[0]', row, 'services[0].picks[12]', 'services[0].picks[13]', 'extras']);
    const open = visibleRows(p, () => true, () => true, false);
    expect(open.slice(3, 16)).toEqual([row, ...Array.from({ length: 12 }, (_, j) => `services[0].picks[${j}]`)]);
  });
});

// D93 독립 리뷰 2차 — 두 카드에 함께 드는 부품(bs)은 카드를 정하지 않는다 · 백엔드 카드가 후보면 https-lb 와 견주지 않는다
describe('LB 카드 후보 — 공유 부품과 부품 여럿 빼기', () => {
  it('칩만 web · bs · ip · url · cert · thps · fwd — Website 로 읽고 Serverless web 이 아니다', () => {
    const p = ['web', 'bs', 'ip', 'url', 'cert', 'thps', 'fwd'].reduce((q, id) => togglePreset(q, 0, id), startPlan(DEFAULT_PROJECT));
    expect(ids(p, 0)).toEqual([['website', false]]);
  });
  it('website 에서 ig · hc 를 빼고 공용 lbhc 를 꺼도 Website 미완성이다', () => {
    let p = addBundle(startPlan(DEFAULT_PROJECT), 0, 'website', { db: false });
    p = setPart(p, 0, { preset: 'ig' }, false);
    p = setPart(p, 0, { preset: 'hc' }, false);
    p = togglePreset(p, null, 'firewall', 'lbhc');
    expect(ids(p, 0)).toEqual([['website', false]]);
    expect(cardIn(p, 0, 'serverless-web')).toBeUndefined();
  });
  it('website 에서 web · ig 둘을 빼도 카드가 https-lb 로 바뀌지 않는다', () => {
    let p = addBundle(startPlan(DEFAULT_PROJECT), 0, 'website', { db: false });
    p = setPart(p, 0, { preset: 'web' }, false);
    p = setPart(p, 0, { preset: 'ig' }, false);
    expect(ids(p, 0)).toEqual([['website', false]]);
  });
  it('serverless-web 에서 run · neg 둘을 빼면 남은 백엔드 부품이 없어 https-lb(백엔드 없음)다', () => {
    let p = addBundle(startPlan(DEFAULT_PROJECT), 0, 'serverless-web');
    p = setPart(p, 0, { preset: 'run' }, false);
    p = setPart(p, 0, { preset: 'neg' }, false);
    const m = cardsIn(p, 0);
    expect(m.map((x) => x.bundle.id)).toEqual(['https-lb']);
    expect(m[0]!.noBackend).toBe(true);
  });
});

describe('D114 의 카드 다섯 — 화면에서 더하기 · 되읽기 · 지우기', () => {
  const NEW = ['data-warehouse', 'gke', 'event-pipeline', 'ci-cd', 'batch-job'] as const;

  it('첫 화면에 카드 하나(선택 전부)를 더하면 그 카드 하나로 완성되어 되읽히고 · 이름이 전부 PASS · 링크로 다시 열어도 같다 · 지우면 서비스가 빈다', () => {
    for (const id of NEW) {
      const all = Object.fromEntries(bundleById(id)!.options.map((o) => [o.id, true]));
      const start = startPlan(DEFAULT_PROJECT);
      expect(cardBlocked(start, 0, id, all), id).toBeUndefined();
      const p = addBundle(start, 0, id, all);
      expect(ids(p, 0), id).toEqual([[id, true]]);
      // GKE 의 네트워크(vpc · subnet)는 첫 화면에 이미 있다 — 다시 더하지 않는다
      expect(presets(p, null), id).toEqual(['vpc', 'subnet', 'router', 'nat']);
      expect(validatePlan(p), id).toEqual({ ok: true });
      expect(generateProject(expandPlan(p), 'gcp').items.every((i) => i.valid), id).toBe(true);
      for (const o of bundleById(id)!.options) expect(optionOn(p, 0, o.parts), `${id} ${o.id}`).toBe(true);
      const back = decodeWizardState(`#state=${encodeWizardState(p, RULES_REVISION, [])!}`)!.plan!;
      expect(back.services, id).toEqual(p.services);
      expect(ids(back, 0), id).toEqual([[id, true]]);
      const removed = removeBundle(p, 0, id);
      expect(presets(removed, 0).filter((x) => !bundleById(id)!.options.some((o) => o.parts.some((q) => q.preset === x))), id).toEqual([]);
      expect(cardsIn(removed, 0), id).toEqual([]);
    }
  });

  it('네트워크를 비운 계획에 GKE 를 더하면 vpc · subnet 을 프로젝트 공용 자리에 더한다', () => {
    const p = addBundle(startPlan(DEFAULT_PROJECT), 0, 'gke');
    const empty = { ...p, projectPicks: [], services: [{ purpose: 'shop', picks: [] }] };
    expect(presets(addBundle(empty, 0, 'gke'), null)).toEqual(['vpc', 'subnet']);
    expect(ids(addBundle(empty, 0, 'gke'), 0)).toEqual([['gke', true]]);
  });

  it('부품(서비스 계정)을 함께 쓰는 카드는 한 서비스에 하나 — 둘째는 overlap 으로 막히고, 다른 서비스에는 더할 수 있다', () => {
    const p = addBundle(startPlan(DEFAULT_PROJECT), 0, 'gke');
    expect(cardBlocked(p, 0, 'ci-cd', {})).toBe('overlap');
    expect(addBundle(p, 0, 'ci-cd')).toBe(p);
    const two = addService(p);
    expect(cardBlocked(two, 1, 'ci-cd', {})).toBeUndefined();
    expect(ids(addBundle(two, 1, 'ci-cd'), 1)).toEqual([['ci-cd', true]]);
  });
});
