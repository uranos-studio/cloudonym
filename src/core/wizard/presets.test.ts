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

  it('계획 §4-1 의 아홉 칩 + D73 의 열넷 — 서버형 넷 · db · object · 서비스 다섯 · 로드 밸런서 일곱 · 네트워크 다섯', () => {
    expect(PRESETS.map((p) => p.id)).toEqual([
      'web', 'was', 'bastion', 'file', 'db', 'object', 'run', 'sa', 'secret', 'gke', 'wip',
      'ip', 'bs', 'hc', 'url', 'cert', 'thps', 'fwd', 'vpc', 'subnet', 'firewall', 'router', 'nat',
    ]);
    expect(PRESETS.filter((p) => p.group === 'network').map((p) => p.ruleId)).toEqual(['gcp.vpc_network', 'gcp.subnet', 'gcp.firewall_rule', 'gcp.router', 'gcp.router_nat']);
    expect(PRESETS.filter((p) => p.group === 'lb').map((p) => p.ruleId)).toEqual([
      'gcp.global_address', 'gcp.backend_service', 'gcp.health_check', 'gcp.url_map', 'gcp.ssl_certificate', 'gcp.target_https_proxy', 'gcp.global_forwarding_rule',
    ]);
    expect(presetOf('firewall')?.tierChoices).toEqual(['ssh', 'web', 'icmp']);
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
    expect(PRESETS.filter((p) => p.level === 'project').map((p) => p.id)).toEqual(['vpc', 'subnet', 'firewall', 'router', 'nat']);
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
    const created = ['run', 'sa', 'secret', 'gke', 'wip', 'ip', 'bs', 'hc', 'url', 'cert', 'thps', 'fwd', 'router', 'nat'];
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
      run: 'billing-shop-prod-ane3-run-01', sa: 'billing-shop-prod-sa-sync', secret: 'billing-shop-prod-ane3-secret-01',
      gke: 'billing-shop-prod-ane3-gke-01', wip: 'billing-shop-prod-ane3-wip-01',
      ip: 'billing-shop-prod-ip-01', bs: 'billing-shop-prod-bs-01', hc: 'billing-shop-prod-hc-01', url: 'billing-shop-prod-url-01',
      cert: 'billing-shop-prod-cert-01', thps: 'billing-shop-prod-thps-01', fwd: 'billing-shop-prod-fwd-01',
      router: 'billing-prod-ane3-cr-01', nat: 'billing-prod-ane3-nat-01',
    });
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
});
