import { describe, it, expect } from 'vitest';
import { PRESETS, PRESET_TIERS, presetOf } from './presets';
import { RULES } from '../constraints';
import { inputKind } from '../tree';
import { RESERVED_TIERS } from '../tier';
import { TIER_PATTERN } from '../types';
import { ATTACHMENTS } from './attachments';

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

  it('계획 §4-1 의 아홉 칩 — 서버형 넷 · db · object · 네트워크 셋', () => {
    expect(PRESETS.map((p) => p.id)).toEqual(['web', 'was', 'bastion', 'file', 'db', 'object', 'vpc', 'subnet', 'firewall']);
    expect(PRESETS.filter((p) => p.group === 'network').map((p) => p.ruleId)).toEqual(['gcp.vpc_network', 'gcp.subnet', 'gcp.firewall_rule']);
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
