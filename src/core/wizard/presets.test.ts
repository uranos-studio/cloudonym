import { describe, it, expect } from 'vitest';
import { PRESETS, PRESET_TIERS, presetOf } from './presets';
import { RULES } from '../constraints';
import { inputKind } from '../tree';
import { RESERVED_TIERS } from '../tier';
import { TIER_PATTERN } from '../types';
import { ATTACHMENTS } from './attachments';
import { PROJECT_SCOPES, expandPlan, validatePlan, type Pick, type WizardPlan } from './plan';
import { generateProject } from '../engine';

describe('프리셋 데이터 (D64)', () => {
  it('모든 ruleId · serverless 규칙 id 가 규칙 표에 있다 · id 는 고유', () => {
    for (const p of PRESETS) {
      expect(RULES[p.ruleId], p.id).toBeDefined();
      for (const r of p.serverless?.ruleIds ?? []) expect(RULES[r], `${p.id} ${r}`).toBeDefined();
    }
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    expect(presetOf('web')?.ruleId).toBe('gcp.compute_instance');
    expect(presetOf('nope')).toBeUndefined();
  });

  it('계획 §4-1 의 아홉 칩 + D73 의 열넷 + D88 의 psa + D91 의 넷 + D93 의 둘 + D114 의 아홉 — 서버형 넷 · db · object · 서비스 열넷 · 로드 밸런서 열셋 · 네트워크 여섯', () => {
    expect(PRESETS.map((p) => p.id)).toEqual([
      'web', 'was', 'bastion', 'file', 'db', 'object', 'run', 'sa', 'secret', 'gke', 'wip',
      'bq', 'ar', 'topic', 'sub', 'dlq', 'build', 'cron', 'runjob', 'redis',
      'ip', 'ig', 'bs', 'hc', 'url', 'cert', 'thps', 'fwd', 'urlredir', 'thp', 'fwdredir', 'neg', 'bb', 'vpc', 'subnet', 'firewall', 'router', 'nat', 'psa',
    ]);
    expect(PRESETS.filter((p) => p.group === 'network').map((p) => p.ruleId)).toEqual(['gcp.vpc_network', 'gcp.subnet', 'gcp.firewall_rule', 'gcp.router', 'gcp.router_nat', 'gcp.global_address']);
    expect(PRESETS.filter((p) => p.group === 'lb').map((p) => p.ruleId)).toEqual([
      'gcp.global_address', 'gcp.instance_group', 'gcp.backend_service', 'gcp.health_check', 'gcp.url_map', 'gcp.ssl_certificate', 'gcp.target_https_proxy', 'gcp.global_forwarding_rule',
      'gcp.url_map', 'gcp.target_http_proxy', 'gcp.global_forwarding_rule', 'gcp.region_network_endpoint_group', 'gcp.backend_bucket',
    ]);
    expect(presetOf('firewall')?.tierChoices).toEqual(['ssh', 'web', 'icmp', 'iap', 'lbhc']);
    expect(presetOf('firewall')?.tier).toBe('ssh');
  });

  it('ha 가 있는 프리셋은 서버형(web · was)뿐이고 그 minInstances 는 2 · db · object · 네트워크 · bastion · file 은 null', () => {
    expect(PRESETS.filter((p) => p.ha !== null).map((p) => p.id)).toEqual(['web', 'was']);
    for (const p of PRESETS.filter((x) => x.ha !== null)) {
      expect(p.ha).toEqual({ minInstances: 2 });
      expect(p.ruleId).toBe('gcp.compute_instance');
    }
  });

  it('serverless 는 web · was 에만 — Cloud Functions · Cloud Run 둘', () => {
    expect(PRESETS.filter((p) => p.serverless !== null).map((p) => p.id)).toEqual(['web', 'was']);
    for (const p of PRESETS.filter((x) => x.serverless !== null)) expect(p.serverless?.ruleIds).toEqual(['gcp.cloud_function', 'gcp.run_service']);
  });

  it('defaultAttach 는 file 만 { data: [01] } · 그 부모는 호환표에 있다', () => {
    expect(PRESETS.filter((p) => p.defaultAttach !== undefined).map((p) => [p.id, p.defaultAttach])).toEqual([['file', { data: ['01'] }]]);
    expect(ATTACHMENTS.some((r) => r.parent === presetOf('file')?.ruleId && r.attach === 'data')).toBe(true);
  });

  it('프리셋 입력 종류가 규칙의 inputKind 와 맞다 — tier 를 가진 프리셋 · serverless 규칙은 count 규칙', () => {
    for (const p of PRESETS) {
      const rule = RULES[p.ruleId]!;
      if (p.tier !== null || p.tierChoices) expect(inputKind(rule), p.id).toBe('count');
      if (p.ha !== null) expect(inputKind(rule), p.id).toBe('count');
      for (const r of p.serverless?.ruleIds ?? []) expect(inputKind(RULES[r]!), r).toBe('count');
    }
    // object(버킷)는 입력 없는 규칙 — 슬롯을 받지 않는다
    expect(inputKind(RULES[presetOf('object')!.ruleId]!)).toBe('none');
  });

  it('level — 네트워크 묶음만 project 이고 그 규칙은 프로젝트 수준 범위 · 나머지(lb 묶음 포함)는 service (D73)', () => {
    expect(PRESETS.filter((p) => p.level === 'project').map((p) => p.id)).toEqual(['vpc', 'subnet', 'firewall', 'router', 'nat', 'psa']);
    for (const p of PRESETS) {
      expect(p.level === 'project', p.id).toBe(p.group === 'network');
      if (p.level === 'project') expect(PROJECT_SCOPES, p.id).toContain(RULES[p.ruleId]!.scope);
    }
  });

  it('프리셋 id 는 8자 이하 — hash 길이 상한식(MAX_PRESET_ID_CHARS)이 바뀌지 않는다', () => {
    expect(Math.max(...PRESETS.map((p) => p.id.length))).toBe(8);
  });

  it('D73 의 새 칩 — 각각 켜면 이름 하나(PASS) · 서비스 계정은 기본 역할 sync', () => {
    const PROJECT = { owner: 'platform', system: 'billing', env: 'prod', region: 'asia-northeast3' };
    const created = ['run', 'sa', 'secret', 'gke', 'wip', 'ar', 'topic', 'sub', 'dlq', 'build', 'cron', 'runjob', 'redis', 'ip', 'ig', 'bs', 'hc', 'url', 'cert', 'thps', 'fwd', 'urlredir', 'thp', 'fwdredir', 'neg', 'bb', 'router', 'nat'];
    const names: Record<string, string> = {};
    for (const id of created) {
      const p = presetOf(id)!;
      const pick: Pick = inputKind(RULES[p.ruleId]!) === 'count' ? { preset: id, instances: [{ id: '1', seq: '01' }] } : { preset: id };
      const plan: WizardPlan = p.level === 'project'
        ? { provider: 'gcp', project: PROJECT, projectPicks: [pick], services: [] }
        : { provider: 'gcp', project: PROJECT, projectPicks: [], services: [{ purpose: 'shop', picks: [pick] }] };
      expect(validatePlan(plan), id).toEqual({ ok: true });
      const items = generateProject(expandPlan(plan), 'gcp').items.slice(1);
      expect(items.length, id).toBe(1);
      expect(items[0]!.valid, id).toBe(true);
      names[id] = items[0]!.name;
    }
    expect(names).toEqual({
      run: 'billing-shop-prod-ane3-run-01', sa: 'billing-shop-prod-sa-sync', secret: 'billing-shop-prod-secret-01',
      gke: 'billing-shop-prod-ane3-gke-01', wip: 'billing-shop-prod-wip-01',
      ar: 'billing-shop-prod-ane3-ar-01', topic: 'billing-shop-prod-topic-01', sub: 'billing-shop-prod-sub-01', dlq: 'billing-shop-prod-topic-dlq-01',
      build: 'billing-shop-prod-ane3-trigger-01', cron: 'billing-shop-prod-ane3-cron-01', runjob: 'billing-shop-prod-ane3-crj-01', redis: 'billing-shop-prod-ane3-redis-01',
      ip: 'billing-shop-prod-ip-01', bs: 'billing-shop-prod-bs-01', hc: 'billing-shop-prod-hc-01', url: 'billing-shop-prod-url-01',
      cert: 'billing-shop-prod-cert-01', thps: 'billing-shop-prod-thps-01', fwd: 'billing-shop-prod-fwd-01',
      ig: 'billing-shop-prod-ane3-ig-01', urlredir: 'billing-shop-prod-url-redir-01', thp: 'billing-shop-prod-thp-01', fwdredir: 'billing-shop-prod-fwd-redir-01',
      neg: 'billing-shop-prod-ane3-neg-01', bb: 'billing-shop-prod-bb-01',
      router: 'billing-prod-ane3-cr-01', nat: 'billing-prod-nat-01',
    });
  });

  it('D114 — BigQuery 데이터셋 칩은 하이픈 없이 밑줄로 잇는다(데이터셋 이름에 - 를 쓸 수 없다) · 입력 없는 규칙', () => {
    const PROJECT = { owner: 'platform', system: 'billing', env: 'prod', region: 'asia-northeast3' };
    expect(inputKind(RULES[presetOf('bq')!.ruleId]!)).toBe('none');
    const plan: WizardPlan = { provider: 'gcp', project: PROJECT, projectPicks: [], services: [{ purpose: 'shop', picks: [{ preset: 'bq' }] }] };
    expect(validatePlan(plan)).toEqual({ ok: true });
    const [item] = generateProject(expandPlan(plan), 'gcp').items.slice(1);
    expect(item).toMatchObject({ name: 'billing_shop_prod_ane3_bq', valid: true });
    expect(item!.name).not.toContain('-');
    expect(presetOf('dlq')).toMatchObject({ ruleId: presetOf('topic')!.ruleId, tier: 'dlq' });
  });

  it('프리셋 tier 는 TIER_PATTERN 을 지나고 예약 목록과 겹침 0 — 데이터에서 센다', () => {
    expect(PRESET_TIERS.length).toBeGreaterThan(0);
    for (const t of PRESET_TIERS) {
      expect(TIER_PATTERN.test(t), t).toBe(true);
      expect(RESERVED_TIERS.has(t), t).toBe(false);
    }
    const fromData = new Set(PRESETS.flatMap((p) => [p.tier, ...(p.tierChoices ?? [])]).filter((t): t is string => t !== null));
    expect([...PRESET_TIERS].sort()).toEqual([...fromData].sort());
  });

  it('고정 종류(D88) — 종류 표가 있는 규칙의 허용 값이고 · pick 이 다른 종류를 주면 wizard.preset_kind_fixed · 같은 값이면 통과', () => {
    for (const p of PRESETS.filter((x) => x.kind !== undefined)) expect(RULES[p.ruleId]!.kinds?.allowed, p.id).toContain(p.kind);
    expect(PRESETS.filter((x) => x.kind !== undefined).map((x) => [x.id, x.kind])).toEqual([['psa', 'INTERNAL']]);
    const one = [{ id: 'a', seq: '01' }];
    const plan = (pick: Pick): WizardPlan => ({ provider: 'gcp', project: { owner: 'platform', system: 'billing', env: 'prod', region: 'ane3' }, projectPicks: [{ ...pick, instances: one }], services: [] });
    const r = validatePlan(plan({ preset: 'psa', kind: 'EXTERNAL' }));
    expect(r.ok ? [] : r.errors).toEqual([{ code: 'wizard.preset_kind_fixed', params: { index: 0, preset: 'psa', kind: 'INTERNAL' }, path: 'projectPicks[0]' }]);
    expect(validatePlan(plan({ preset: 'psa', kind: 'INTERNAL' }))).toEqual({ ok: true });
    expect(expandPlan(plan({ preset: 'psa' })).projectItems[0]).toMatchObject({ kind: 'INTERNAL', tier: 'psa', level: 'project' });
    expect(generateProject(expandPlan(plan({ preset: 'psa' })), 'gcp').items[1]).toMatchObject({ key: 'project/-/global_address/int/psa/01', name: 'billing-prod-ip-int-psa-01', kind: 'INTERNAL', kindToken: 'int' });
  });
  it('D91 — 전환용 url · fwd 는 같은 규칙의 url · fwd 와 tier(redir)로 갈려 한 서비스에 함께 들고 · 키 · 이름이 다르다 · 한 칩을 두 번 넣으면 중복', () => {
    const one = [{ id: 'a', seq: '01' }];
    const PROJECT = { owner: 'platform', system: 'billing', env: 'prod', region: 'ane3' };
    const plan = (ids: string[]): WizardPlan => ({ provider: 'gcp', project: PROJECT, projectPicks: [], services: [{ purpose: 'shop', picks: ids.map((id) => ({ preset: id, instances: one })) }] });
    const both = plan(['url', 'urlredir', 'fwd', 'fwdredir', 'thps', 'thp', 'ig']);
    expect(validatePlan(both)).toEqual({ ok: true });
    expect(generateProject(expandPlan(both), 'gcp').items.slice(1).map((i) => [i.key, i.name, i.valid])).toEqual([
      ['service/shop/url_map/-/-/01', 'billing-shop-prod-url-01', true],
      ['service/shop/url_map/-/redir/01', 'billing-shop-prod-url-redir-01', true],
      ['service/shop/global_forwarding_rule/-/-/01', 'billing-shop-prod-fwd-01', true],
      ['service/shop/global_forwarding_rule/-/redir/01', 'billing-shop-prod-fwd-redir-01', true],
      ['service/shop/target_https_proxy/-/-/01', 'billing-shop-prod-thps-01', true],
      ['service/shop/target_http_proxy/-/-/01', 'billing-shop-prod-thp-01', true],
      ['service/shop/instance_group/-/-/01', 'billing-shop-prod-ane3-ig-01', true],
    ]);
    for (const id of ['urlredir', 'fwdredir']) {
      const r = validatePlan(plan([id, id]));
      expect(r.ok, id).toBe(false);
      expect(r.ok ? [] : r.errors.map((e) => e.code), id).toContain('wizard.duplicate_pick');
    }
    expect(presetOf('urlredir')).toMatchObject({ ruleId: presetOf('url')!.ruleId, tier: 'redir' });
    expect(presetOf('fwdredir')).toMatchObject({ ruleId: presetOf('fwd')!.ruleId, tier: 'redir' });
    // 인스턴스 그룹은 존 범위 규칙 — 엔진 규칙 그대로 이름에 지역 토큰이 들어간다
    expect(RULES[presetOf('ig')!.ruleId]!.scope).toBe('gcp:project_zone');
  });
  it('psa 와 로드 밸런서의 전역 IP(ip)는 같은 규칙이지만 종류 · tier · 자리가 달라 함께 쓴다', () => {
    const r = validatePlan({ provider: 'gcp', project: { owner: 'platform', system: 'billing', env: 'prod', region: 'ane3' }, projectPicks: [{ preset: 'psa', instances: [{ id: 'a', seq: '01' }] }, { preset: null, ruleId: 'gcp.global_address', instances: [{ id: 'a', seq: '01' }] }], services: [{ purpose: 'shop', picks: [{ preset: 'ip', instances: [{ id: 'a', seq: '01' }] }] }] });
    expect(r).toEqual({ ok: true });
  });
});
