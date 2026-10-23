// 카드 화면 상태 (D93) — 더하기 · 되읽기 · 미완성 · 가족 · 상한 · 지우기(공용 방화벽은 남는다)
import { describe, it, expect } from 'vitest';
import { addBundle, cardBlocked, cardIn, cardsIn, fillBlocked, fillMissing, optionBlocked, optionOn, partBlocked, partsToAdd, partUsers, removeBundle, serviceLayout, setOption, setPart, SHAREABLE_PARTS } from './wizardBundles';
import { addPresetPick, addService, DEFAULT_PROJECT, findPreset, renameService, startPlan, togglePreset } from './wizardState';
import { cardRow, parentRow, parseRow, rowExists, rowTitle, selectionAfter, visibleRows } from './wizardSelection';
import { decodeWizardState, encodeWizardState } from './urlState';
import { MAX_PICKS_PER_SERVICE, expandPlan, validatePlan, type WizardPlan } from '../core/wizard/plan';
import { generateProject } from '../core/engine';
import { BUNDLES, bundleById, partIsProject, partKey } from '../core/wizard/bundles';
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
    expect(presets(vm, 0)).toEqual(['intweb', 'intwas', 'db', 'bastion']); // D116 — 내부 전용 서버는 tier intweb · intwas
    expect(presets(vm, null)).toEqual(['vpc', 'subnet', 'router', 'nat', 'firewall:ssh', 'firewall:icmp', 'firewall:iap', 'firewall:internal', 'psa']);
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
    // web · was · db 칩은 Internal app 이 아니다(D116 — 그 카드의 서버는 intweb · intwas). 그 칩 셋으로는 카드가 뜨지 않는다
    const chips = togglePreset(togglePreset(togglePreset(startPlan(DEFAULT_PROJECT), 0, 'web'), 0, 'was'), 0, 'db');
    expect(cardsIn(chips, 0)).toEqual([]);
    const vm = togglePreset(togglePreset(togglePreset(startPlan(DEFAULT_PROJECT), 0, 'intweb'), 0, 'intwas'), 0, 'db');
    expect(cardsIn(vm, 0).map((m) => [m.bundle.id, m.complete, m.missing.length])).toEqual([['vm-app', false, 5]]);
  });

  it('Website 의 선택 was · db 는 Internal app 이 아니다 — vm-app 이 뜨지 않아 그 Remove 가 Website 의 선택을 지우지 않는다 · 두 카드는 한 서비스에 함께 둔다(D116)', () => {
    const p = addBundle(startPlan(DEFAULT_PROJECT), 0, 'website', { db: true, was: true });
    expect(cardsIn(p, 0).map((m) => [m.bundle.id, m.complete])).toEqual([['website', true]]);
    const { owned, loose } = serviceLayout(p, 0);
    expect(owned.get(0)).toBe('website');
    expect(loose).toEqual([12, 13]); // db · was — 선택 부품은 카드 밖 줄
    expect(removeBundle(p, 0, 'vm-app')).toEqual(p); // 보이지 않는 카드는 지울 것이 없다
    expect(optionOn(p, 0, bundleById('website')!.options[0]!.parts)).toBe(true);
    // D116 — vm-app 의 서버는 intweb · intwas 라 Website 의 web · was 와 다른 pick 이다. db 는 함께 쓴다(D115)
    const both = addBundle(p, 0, 'vm-app');
    expect(ids(both, 0)).toEqual([['website', true], ['vm-app', true]]);
    expect(presets(both, 0).filter((x) => x === 'db')).toEqual(['db']);
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

  it('서비스 계정을 함께 쓰는 카드도 한 서비스에 둘 수 있다 (D115) — 둘째 카드는 있는 서비스 계정을 다시 쓴다', () => {
    const p = addBundle(startPlan(DEFAULT_PROJECT), 0, 'gke');
    expect(cardBlocked(p, 0, 'ci-cd', {})).toBeUndefined();
    expect(partsToAdd(p, 0, 'ci-cd', {})).toEqual([{ preset: 'build' }]);
    expect(ids(addBundle(p, 0, 'ci-cd'), 0)).toEqual([['gke', true], ['ci-cd', true]]);
  });
});

describe('한 서비스에 카드 여럿 (D115 · D116) — 함께 쓰는 부품 · tier 로 가른 부품 · 막히는 까닭 · 지우기 · 되읽기', () => {
  // https-lb 는 백엔드를 서비스에서 고르는 카드라 아래 따로 본다
  const NINE = BUNDLES.map((b) => b.id).filter((id) => id !== 'https-lb');
  // 막히는 쌍은 로드 밸런서 둘뿐이다 — URL 맵 · 주소 · 인증서 · 프록시 · 전달 규칙이 서비스에 하나씩이고 URL 맵의 기본 백엔드가 하나다(D93). 둘째 LB 는 다른 서비스에 둔다
  const BLOCKED: Record<string, string> = {
    'website|serverless-web': 'family', 'website|static-site': 'family', 'serverless-web|static-site': 'family',
    // D127 — Website (autoscaling) 도 가족 lb
    'website|website-mig': 'family', 'serverless-web|website-mig': 'family', 'static-site|website-mig': 'family',
    // D125 결정 ③ — task-queue 의 API 서비스 선택(기본 켜짐)은 Serverless web 의 run 이다. run 은 함께 쓰지 않는다 — 선택을 끄면 함께 둔다(아래 새 카드 시험)
    'serverless-web|task-queue': 'overlap',
  };
  const key = (a: string, b: string) => (BUNDLES.findIndex((x) => x.id === a) < BUNDLES.findIndex((x) => x.id === b) ? `${a}|${b}` : `${b}|${a}`);
  const pairs = NINE.flatMap((a, i) => NINE.slice(i + 1).map((b) => [a, b] as const));
  const coexist = pairs.filter(([a, b]) => BLOCKED[key(a, b)] === undefined);
  const order = (xs: readonly string[]) => [...xs].sort((a, b) => BUNDLES.findIndex((x) => x.id === a) - BUNDLES.findIndex((x) => x.id === b));
  const start = () => startPlan(DEFAULT_PROJECT);
  const addAll = (xs: readonly string[]) => xs.reduce((p, id) => {
    expect(cardBlocked(p, 0, id, {}), `${xs.join('+')}: ${id}`).toBeUndefined();
    return addBundle(p, 0, id);
  }, start());

  it('쌍 쉰다섯(https-lb 제외) — 막히는 일곱(LB 둘 여섯 · Serverless web 과 API 선택을 켠 task-queue)과 함께 두는 마흔여덟', () => {
    expect(pairs.length).toBe(55);
    expect(coexist.length).toBe(48);
  });

  it.each(coexist)('%s + %s — 어느 순서로 더해도 둘 다 완성 · 이름 PASS · 링크로 다시 열어도 같다 · 하나를 지우면 다른 하나는 완성 그대로', (a, b) => {
    const want = order([a, b]).map((id) => [id, true]);
    for (const xs of [[a, b], [b, a]]) {
      const p = addAll(xs);
      expect(ids(p, 0)).toEqual(want);
      expect(validatePlan(p)).toEqual({ ok: true });
      expect(generateProject(expandPlan(p), 'gcp').items.every((i) => i.valid)).toBe(true);
      const back = decodeWizardState(`#state=${encodeWizardState(p, RULES_REVISION, [])!}`)!.plan!;
      expect(ids(back, 0)).toEqual(want);
      // 지우기 — 남은 카드의 부품(함께 쓰던 서비스 계정 · 저장소 포함)은 그대로
      for (const [gone, kept] of [[a, b], [b, a]] as const) {
        const r = removeBundle(p, 0, gone);
        expect(ids(r, 0), `remove ${gone}`).toEqual([[kept, true]]);
      }
      const none = removeBundle(removeBundle(p, 0, a), 0, b);
      expect(cardsIn(none, 0)).toEqual([]);
    }
  });

  it.each(Object.entries(BLOCKED))('%s 는 한 서비스에 둘 수 없다 (%s) — 어느 순서든 둘째가 막히고 계획은 그대로 · 다른 서비스에는 된다', (pair, why) => {
    const [a, b] = pair.split('|') as [string, string];
    for (const [first, second] of [[a, b], [b, a]] as const) {
      const p = addBundle(start(), 0, first);
      expect(cardBlocked(p, 0, second, {})).toBe(why);
      expect(addBundle(p, 0, second)).toBe(p);
      const two = addService(p);
      expect(cardBlocked(two, 1, second, {})).toBeUndefined();
      expect(ids(addBundle(two, 1, second), 1)).toEqual([[second, true]]);
    }
  });

  it('주인이 말한 둘 — Event pipeline + Batch job + CI/CD(서비스 계정 하나) · GKE + CI/CD(Artifact Registry 하나)', () => {
    const three = addAll(['event-pipeline', 'batch-job', 'ci-cd']);
    expect(ids(three, 0)).toEqual([['event-pipeline', true], ['ci-cd', true], ['batch-job', true]]);
    expect(presets(three, 0).filter((x) => x === 'sa')).toEqual(['sa']);
    const { claims, owned } = serviceLayout(three, 0);
    const sa = findPreset(three, 0, 'sa');
    expect(claims.get(sa)).toEqual(['event-pipeline', 'ci-cd', 'batch-job']);
    expect(owned.get(sa)).toBe('event-pipeline'); // 목록에는 표 순서로 첫 카드 아래 한 번
    // 카드 줄의 부품 수는 그 카드가 쓰는 부품 전부 — 목록 자식 줄은 첫 카드에만 있다
    expect(cardIn(three, 0, 'ci-cd')!.picks.length).toBe(3);
    const gk = addAll(['gke', 'ci-cd']);
    expect(ids(gk, 0)).toEqual([['gke', true], ['ci-cd', true]]);
    expect(presets(gk, 0)).toEqual(['gke', 'ar', 'sa', 'build']);
    expect(presets(removeBundle(gk, 0, 'gke'), 0)).toEqual(['ar', 'sa', 'build']);
    expect(presets(removeBundle(gk, 0, 'ci-cd'), 0)).toEqual(['gke', 'ar', 'sa']);
  });

  it('D114 의 다섯 + Website 를 한 서비스에 — 서비스 계정 하나 · 서른 개 안 · 전부 완성 · 하나씩 지워도 나머지는 완성', () => {
    const all = ['website', 'data-warehouse', 'gke', 'event-pipeline', 'ci-cd', 'batch-job'];
    const p = addAll(all);
    expect(ids(p, 0)).toEqual(all.map((id) => [id, true]));
    expect(presets(p, 0).filter((x) => x === 'sa').length).toBe(1);
    expect(validatePlan(p)).toEqual({ ok: true });
    expect(generateProject(expandPlan(p), 'gcp').items.every((i) => i.valid)).toBe(true);
    for (const gone of all) expect(ids(removeBundle(p, 0, gone), 0), gone).toEqual(all.filter((x) => x !== gone).map((id) => [id, true]));
  });

  it('칩으로 같은 부품을 켜도 같은 카드들로 되읽힌다 — 카드 표시는 hash 에 없다', () => {
    const viaCards = addAll(['gke', 'ci-cd', 'batch-job']);
    const viaChips = ['gke', 'ar', 'sa', 'build', 'runjob', 'cron'].reduce((q, id) => togglePreset(q, 0, id), start());
    expect(encodeWizardState(viaChips, RULES_REVISION, [])).toBe(encodeWizardState(viaCards, RULES_REVISION, []));
    expect(ids(viaChips, 0)).toEqual([['gke', true], ['ci-cd', true], ['batch-job', true]]);
  });

  it('카드마다 함께 쓰지 않는 서비스 부품이 하나 이상 — 목록에서 카드 줄 아래가 비지 않는다', () => {
    for (const b of BUNDLES) expect(b.parts.some((p) => !partIsProject(p) && !SHAREABLE_PARTS.has(partKey(p))), b.id).toBe(true);
  });

  it('함께 쓰는 부품은 점검표에서 끄지 않는다 — 다른 카드가 쓴다. 끌 수 있는 것은 그 카드 혼자 쓰는 부품', () => {
    const p = addAll(['gke', 'ci-cd']);
    expect(partUsers(p, 0, { preset: 'sa' }, 'gke')).toEqual(['ci-cd']);
    expect(partUsers(p, 0, { preset: 'gke' }, 'gke')).toEqual([]);
    expect(setPart(p, 0, { preset: 'sa' }, false, 'gke')).toBe(p);
    expect(setPart(p, 0, { preset: 'ar' }, false, 'ci-cd')).toBe(p);
    expect(ids(setPart(p, 0, { preset: 'build' }, false, 'ci-cd'), 0)).toEqual([['gke', true]]);
  });

  it('선택이 함께 쓰는 부품이면 끄기도 그 부품을 남긴다 — Serverless web 의 서비스 계정 · 시크릿 선택과 CI/CD', () => {
    const sw = bundleById('serverless-web')!;
    const opt = (id: string) => sw.options.find((o) => o.id === id)!.parts;
    const p = addBundle(addBundle(start(), 0, 'serverless-web', { sa: true, secret: true, db: true }), 0, 'ci-cd', { secret: true });
    expect(ids(p, 0)).toEqual([['serverless-web', true], ['ci-cd', true]]);
    expect(optionOn(p, 0, opt('sa'), 'serverless-web')).toBe(true);
    expect(setOption(p, 0, opt('sa'), false, 'serverless-web')).toBe(p);
    expect(setOption(p, 0, opt('secret'), false, 'serverless-web')).toBe(p);
    // CI/CD 를 지워도 Serverless web 의 켜진 선택이 쓰는 서비스 계정 · 시크릿은 남는다 — 지우는 것은 CI/CD 혼자 쓰는 저장소 · 트리거
    const noCi = removeBundle(p, 0, 'ci-cd');
    expect(presets(noCi, 0).filter((x) => x !== null && ['sa', 'secret', 'ar', 'build'].includes(x)).sort()).toEqual(['sa', 'secret']);
    expect(optionOn(noCi, 0, opt('sa'), 'serverless-web')).toBe(true);
    // 데이터베이스는 함께 쓴다 — Cloud SQL 인스턴스 하나가 데이터베이스 여럿 · 접속자 여럿을 받는다
    const withVm = addBundle(p, 0, 'vm-app');
    expect(ids(withVm, 0)).toEqual([['serverless-web', true], ['vm-app', true], ['ci-cd', true]]);
    expect(presets(withVm, 0).filter((x) => x === 'db')).toEqual(['db']);
  });

  it('같은 종류를 다른 일에 쓰는 부품은 tier 로 갈려 둘 다 있다 (D116) — 이름이 다르고 선택도 그대로 켜진다', () => {
    const namesOf = (p: WizardPlan) => generateProject(expandPlan(p), 'gcp').items.map((i) => i.name);
    // Data warehouse(예약 적재 켬) + Batch job — Cloud Scheduler 작업 둘(cron-ingest · cron)
    const dwb = addBundle(addBundle(start(), 0, 'data-warehouse', { schedule: true }), 0, 'batch-job');
    expect(ids(dwb, 0)).toEqual([['data-warehouse', true], ['batch-job', true]]);
    expect(optionOn(dwb, 0, bundleById('data-warehouse')!.options[0]!.parts, 'data-warehouse')).toBe(true);
    expect(namesOf(dwb)).toEqual(expect.arrayContaining(['billing-shop-prod-ane3-cron-ingest-01', 'billing-shop-prod-ane3-cron-01']));
    // Serverless web + Event pipeline — Cloud Run 둘(공개 run · push 대상 run-worker)
    const swe = addAll(['serverless-web', 'event-pipeline']);
    expect(namesOf(swe)).toEqual(expect.arrayContaining(['billing-shop-prod-ane3-run-01', 'billing-shop-prod-ane3-run-worker-01']));
    // Static site + Data warehouse + Internal app(Object storage 켬) — 버킷 셋(공개 · raw · appdata)
    const buckets = addBundle(addAll(['static-site', 'data-warehouse']), 0, 'vm-app', { object: true });
    expect(ids(buckets, 0)).toEqual([['static-site', true], ['vm-app', true], ['data-warehouse', true]]);
    expect(namesOf(buckets).filter((n) => n.includes('-gcs'))).toEqual(['platform-billing-shop-prod-ane3-gcs', 'platform-billing-shop-prod-ane3-gcs-raw', 'platform-billing-shop-prod-ane3-gcs-appdata']);
    // Website + Internal app — 서버 넷(web · intweb · intwas, 공개 쪽 was 는 선택) · bastion 하나를 함께 쓴다
    const wv = addBundle(addBundle(start(), 0, 'website', { was: true, bastion: true }), 0, 'vm-app');
    expect(ids(wv, 0)).toEqual([['website', true], ['vm-app', true]]);
    expect(presets(wv, 0).filter((x) => x === 'bastion')).toEqual(['bastion']);
    expect(namesOf(wv).filter((n) => n.includes('-gce-'))).toEqual(['billing-shop-prod-ane3-gce-web-01', 'billing-shop-prod-ane3-gce-was-01', 'billing-shop-prod-ane3-gce-bastion-01', 'billing-shop-prod-ane3-gce-intweb-01', 'billing-shop-prod-ane3-gce-intwas-01']);
    for (const p of [dwb, swe, buckets, wv]) expect(validatePlan(p)).toEqual({ ok: true });
  });

  it('카드 데이터 — LB 가족 밖에서는 함께 쓰지 않는 필수 서비스 부품이 두 카드에 겹치지 않고, 선택의 함께 쓰지 않는 부품이 다른 카드의 필수 부품이 아니다 (D116)', () => {
    const unshared = (ps: readonly { preset: string; tier?: string }[]) => ps.filter((p) => !partIsProject(p) && !SHAREABLE_PARTS.has(partKey(p))).map(partKey);
    for (const a of BUNDLES) for (const b of BUNDLES) {
      if (a.id === b.id || (a.family !== undefined && a.family === b.family)) continue;
      const req = new Set(unshared(b.parts));
      expect(unshared(a.parts).filter((k) => req.has(k)), `${a.id} · ${b.id}`).toEqual([]);
      // D125 결정 ③ — task-queue 의 API 서비스 선택만 예외(run · Serverless web 과 함께 두려면 선택을 끈다)
      const allowed = a.id === 'task-queue' && b.id === 'serverless-web' ? ['run'] : [];
      expect(unshared(a.options.flatMap((o) => o.parts)).filter((k) => req.has(k)), `${a.id} 선택 · ${b.id}`).toEqual(allowed);
    }
  });

  it('https-lb 와 아홉 — LB 셋과는 family(백엔드가 있으면) · 나머지 여섯과는 함께 보이고 백엔드가 없어 「무엇을 더하라」를 말한다', () => {
    const NON_LB = ['vm-app', 'data-warehouse', 'gke', 'event-pipeline', 'ci-cd', 'batch-job'];
    for (const other of NON_LB) {
      for (const xs of [[other, 'https-lb'], ['https-lb', other]]) {
        const p = addAll(xs);
        expect(cardsIn(p, 0).map((m) => [m.bundle.id, m.complete, m.noBackend]), xs.join('+')).toEqual(order(['https-lb', other]).map((id) => (id === 'https-lb' ? ['https-lb', false, true] : [id, true, false])));
        // 이 카드들의 부품(intweb · worker · raw …)은 공개 백엔드가 아니다 — https-lb 가 가져가지 않는다
        expect(partsToAdd(p, 0, 'https-lb', {}), xs.join('+')).toEqual([]);
        // 백엔드를 더하는 LB 카드(Website)를 더하면 https-lb 가 그 카드로 채워지고 다른 카드는 그대로다
        const filled = addBundle(p, 0, 'website', { db: false });
        expect(ids(filled, 0), xs.join('+')).toEqual(order(['website', other]).map((id) => [id, true]));
      }
    }
    for (const lb of ['website', 'serverless-web', 'static-site']) {
      expect(cardBlocked(addBundle(start(), 0, lb), 0, 'https-lb', {}), lb).toBe('family');
      // 백엔드 없는 https-lb 는 그 LB 카드가 채운다 — 둘이 아니라 하나다
      expect(ids(addBundle(addBundle(start(), 0, 'https-lb'), 0, lb), 0), lb).toEqual([[lb, true]]);
    }
  });

  it('예순여섯 쌍 — 쉰넷이 한 서비스에 함께 보이고 · 막히는 열둘은 LB 둘(열) 과 task-queue 의 API 서비스(run)가 겹치는 둘 (D125 결정 ③)', () => {
    const all = BUNDLES.map((b) => b.id);
    const lb = new Set(BUNDLES.filter((b) => b.family === 'lb').map((b) => b.id));
    const results = all.flatMap((a, i) => all.slice(i + 1).map((b) => {
      const p = addBundle(start(), 0, a);
      const why = cardBlocked(p, 0, b, {});
      return { pair: `${a}|${b}`, why, both: why === undefined && cardsIn(addBundle(p, 0, b), 0).length === 2 };
    }));
    expect(results.length).toBe(66);
    expect(results.filter((r) => r.both).length).toBe(54);
    const blocked = results.filter((r) => !r.both);
    expect(blocked.filter((r) => r.pair.split('|').every((id) => lb.has(id))).every((r) => r.why === 'family')).toBe(true);
    expect(blocked.filter((r) => !r.pair.split('|').every((id) => lb.has(id))).map((r) => `${r.pair}:${r.why}`)).toEqual(['serverless-web|task-queue:overlap', 'https-lb|task-queue:overlap']);
    expect(blocked.length).toBe(12);
  });

});

describe('새 카드 (D125 · D127)', () => {
  const start = () => startPlan(DEFAULT_PROJECT);
  it('task-queue — 기본 선택으로 완성 · 이름 전부 유효 · event-pipeline 과 한 서비스에(handler ≠ worker · sa 공유)', () => {
    const p = addBundle(start(), 0, 'task-queue');
    expect(presets(p, 0)).toEqual(['queue', 'handler', 'sa', 'run']);
    expect(ids(p, 0)).toEqual([['task-queue', true]]);
    expect(generateProject(expandPlan(p), 'gcp').items.every((i) => i.valid)).toBe(true);
    const both = addBundle(addBundle(start(), 0, 'event-pipeline'), 0, 'task-queue');
    expect(ids(both, 0)).toEqual([['event-pipeline', true], ['task-queue', true]]);
    expect(presets(both, 0).filter((x) => x === 'sa')).toEqual(['sa']);
  });

  it('serverless-web + task-queue — API 선택을 켜면 run 이 겹쳐 overlap · 끄면 함께 보인다 (결정 ③ — run 은 함께 쓰지 않는다)', () => {
    const sw = addBundle(start(), 0, 'serverless-web');
    expect(cardBlocked(sw, 0, 'task-queue', {})).toBe('overlap');
    const p = addBundle(sw, 0, 'task-queue', { api: false });
    expect(ids(p, 0)).toEqual([['serverless-web', true], ['task-queue', true]]);
  });

  it('website-mig — web + ig 는 website, tpl + mig 는 website-mig 로 되읽힌다 · 둘은 가족 lb 라 하나', () => {
    const w = addBundle(start(), 0, 'website', { db: false });
    const m = addBundle(start(), 0, 'website-mig');
    expect(ids(w, 0)).toEqual([['website', true]]);
    expect(ids(m, 0)).toEqual([['website-mig', true]]);
    expect(presets(m, 0)).toEqual(['mig', 'tpl', 'as', 'hc', 'bs', 'ip', 'url', 'cert', 'thps', 'fwd', 'urlredir', 'thp', 'fwdredir']);
    expect(cardBlocked(w, 0, 'website-mig', {})).toBe('family');
    expect(generateProject(expandPlan(m), 'gcp').items.every((i) => i.valid)).toBe(true);
  });

  it('https-lb + mig 칩 → 미완성 website-mig(빠진 것 tpl · as) · Add missing parts 뒤 완성', () => {
    const p = togglePreset(addBundle(start(), 0, 'https-lb'), 0, 'mig');
    const m = cardsIn(p, 0);
    expect(m.map((x) => [x.bundle.id, x.complete])).toEqual([['website-mig', false]]);
    expect(m[0]!.missing.map(partKey).sort()).toEqual(['as', 'bs', 'firewall:lbhc', 'firewall:web', 'hc', 'tpl']);
    expect(ids(fillMissing(p, 0, 'website-mig'), 0)).toEqual([['website-mig', true]]);
  });
});

describe('역할별 서비스 계정 (D126)', () => {
  const start = () => startPlan(DEFAULT_PROJECT);
  const roles = (id: string) => bundleById(id)!.options.find((o) => o.id === 'roles')!.parts;
  const namesOf = (p: WizardPlan) => generateProject(expandPlan(p), 'gcp').items.map((i) => i.name);
  it('partKey 는 role 을 담고 role 없는 sa 와 다르다', () => {
    expect(partKey({ preset: 'sa', role: 'build' })).toBe('sa@build');
    expect(partKey({ preset: 'sa' })).toBe('sa');
  });
  it('선택을 켜면 pick 에 role 이 실리고 이름 -sa-build 가 더해진다 · 끄면 그 계정만 빠진다', () => {
    const p = addBundle(start(), 0, 'ci-cd', { roles: true });
    expect(p.services[0]!.picks.filter((x) => x.preset === 'sa').map((x) => x.role)).toEqual([undefined, 'build']);
    expect(ids(p, 0)).toEqual([['ci-cd', true]]);
    expect(optionOn(p, 0, roles('ci-cd'), 'ci-cd')).toBe(true);
    expect(namesOf(p)).toEqual(expect.arrayContaining(['billing-shop-prod-sa-sync', 'billing-shop-prod-sa-build']));
    expect(validatePlan(p)).toEqual({ ok: true });
    const off = setOption(p, 0, roles('ci-cd'), false, 'ci-cd');
    expect(off.services[0]!.picks.filter((x) => x.preset === 'sa').map((x) => x.role)).toEqual([undefined]);
    // 꺼진 선택은 평범한 sa 를 자기 것으로 읽지 않는다
    expect(optionOn(addBundle(start(), 0, 'ci-cd'), 0, roles('ci-cd'), 'ci-cd')).toBe(false);
  });
  it('옛 계획(role 없는 sa)의 카드는 그대로 완성 · pick 순서를 뒤집어도([sa@build, sa]) Service account 는 sync 이고 끄면 sync 를 뗀다', () => {
    for (const id of ['ci-cd', 'batch-job', 'event-pipeline', 'data-warehouse', 'gke']) expect(ids(addBundle(start(), 0, id), 0), id).toEqual([[id, true]]);
    let p = addBundle(start(), 0, 'ci-cd', { roles: true });
    p = { ...p, services: [{ ...p.services[0]!, picks: [...p.services[0]!.picks].sort((a, b) => (a.role === 'build' ? -1 : b.role === 'build' ? 1 : 0)) }] };
    expect(p.services[0]!.picks[0]).toMatchObject({ preset: 'sa', role: 'build' });
    expect(findPreset(p, 0, 'sa')).toBe(p.services[0]!.picks.findIndex((x) => x.preset === 'sa' && x.role === undefined));
    expect(ids(p, 0)).toEqual([['ci-cd', true]]);
    const rest = setPart(p, 0, { preset: 'sa' }, false);
    expect(rest.services[0]!.picks.filter((x) => x.preset === 'sa').map((x) => x.role)).toEqual(['build']);
  });
  it('sa 에 사용자 역할(app)만 있는 옛 링크의 카드도 완성', () => {
    const p = addBundle(start(), 0, 'batch-job');
    const q = { ...p, services: [{ ...p.services[0]!, picks: p.services[0]!.picks.map((x) => (x.preset === 'sa' ? { ...x, role: 'app' } : x)) }] };
    expect(ids(q, 0)).toEqual([['batch-job', true]]);
  });
  it('두 카드가 같은 sa@cron 을 함께 쓴다 · 한 카드의 선택을 꺼도 다른 카드가 쓰면 남는다 (D115)', () => {
    const p = addBundle(addBundle(start(), 0, 'batch-job', { roles: true }), 0, 'data-warehouse', { roles: true });
    expect(ids(p, 0)).toEqual([['data-warehouse', true], ['batch-job', true]]);
    expect(p.services[0]!.picks.filter((x) => x.preset === 'sa' && x.role === 'cron')).toHaveLength(1);
    expect(SHAREABLE_PARTS.has('sa')).toBe(true);
    const off = setOption(p, 0, roles('batch-job'), false, 'batch-job');
    expect(off.services[0]!.picks.filter((x) => x.preset === 'sa' && x.role === 'cron')).toHaveLength(1);
  });
  it('긴 문맥에서도 역할 계정 이름은 줄거나 실패로 돌아온다 — 유효로 새지 않는다', () => {
    const p0: WizardPlan = { provider: 'gcp', project: { owner: 'platformengineering', system: 'paymentsettlement', env: 'prod', region: 'asia-northeast3' }, projectPicks: [], services: [{ purpose: 'reconciliation', picks: [] }] };
    const p = addBundle(addBundle(p0, 0, 'ci-cd', { roles: true }), 0, 'event-pipeline', { roles: true });
    for (const i of generateProject(expandPlan(p), 'gcp').items.filter((x) => x.resourceType === 'service_account')) {
      expect(!i.valid || (i.name.length >= 6 && i.name.length <= 30), i.name).toBe(true);
    }
  });
});


