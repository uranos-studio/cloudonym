import { describe, it, expect } from 'vitest';
import { decodeState, decodeWizardState, encodeState, encodeWizardState } from './urlState';
import { generateMany, generateProject } from '../core/engine';
import { expandPlan, type WizardPlan } from '../core/wizard/plan';
import { PRESETS } from '../core/wizard/presets';
import FIXTURE from './__fixtures__/wizard-hash-before-open.json';

// 공유 hash 고정 — 마법사 확장 작업 전 HEAD 에서 얼린 리터럴 hash(v4 마법사 · v3 트리)와 그 이름.
// 이 시험이 깨지면 이미 나간 링크가 다르게 열린다. fixture 를 다시 쓰지 않는다 — 다시 쓰는 환경변수도 두지 않는다
const REVISION = '2026-10-10.8';
interface Item { key: string; name: string; valid: boolean }
interface WizardCase { label: string; hash: string; plan: WizardPlan; items: Item[] }
interface TreeCase { label: string; hash: string; items: Item[] }
const F = FIXTURE as unknown as { rulesVersion: string; wizard: WizardCase[]; tree: TreeCase[] };
const NO_NOTICES = { dropped: 0, haOff: 0, serverlessOff: 0, trimmed: 0, discarded: false };
const pick = (i: Item): Item => ({ key: i.key, name: i.name, valid: i.valid });

describe('fixture 가 덮는 것', () => {
  const plans = F.wizard.map((w) => w.plan);
  const picks = plans.flatMap((p) => [...p.projectPicks, ...p.services.flatMap((s) => s.picks)]);
  it(`rulesVersion 은 ${REVISION} 이고 마법사 hash 6개 · 트리 hash 2개다`, () => {
    expect(F.rulesVersion).toBe(REVISION);
    expect(F.wizard).toHaveLength(6);
    expect(F.tree).toHaveLength(2);
  });
  it('프리셋 9개 전부 · firewall tier 셋', () => {
    expect(new Set(picks.map((p) => p.preset).filter((p) => p !== null))).toEqual(new Set(PRESETS.map((p) => p.id)));
    expect(new Set(picks.filter((p) => p.preset === 'firewall').map((p) => p.tier))).toEqual(new Set(['ssh', 'web', 'icmp']));
  });
  it('custom count · role · none · serverless gcf · run · HA · POSTGRES', () => {
    const custom = picks.filter((p) => p.preset === null);
    expect(custom.find((p) => p.ruleId === 'gcp.compute_instance')?.tier).toBeDefined();
    expect(custom.find((p) => p.ruleId === 'gcp.service_account')?.role).toBeDefined();
    expect(custom.map((p) => p.ruleId)).toEqual(expect.arrayContaining(['gcp.storage_bucket', 'gcp.iam_custom_role']));
    expect(new Set(picks.map((p) => p.serverless).filter(Boolean))).toEqual(new Set(['gcp.cloud_function', 'gcp.run_service']));
    expect(picks.some((p) => p.ha === true)).toBe(true);
    expect(picks.some((p) => p.kind === 'POSTGRES')).toBe(true);
  });
  it('attach boot · data · ip · ipi · VPC 슬롯 01 · 03 · 서비스 둘 이상', () => {
    const attach = picks.flatMap((p) => p.instances ?? []).map((s) => s.attach ?? {});
    expect(attach.some((a) => a.boot === true)).toBe(true);
    expect(attach.some((a) => (a.data ?? []).length > 0)).toBe(true);
    expect(attach.some((a) => a.ip === true)).toBe(true);
    expect(attach.some((a) => a.ipi === true)).toBe(true);
    const vpc = plans.flatMap((p) => p.projectPicks).find((p) => p.preset === 'vpc' && (p.instances ?? []).length === 2);
    expect(vpc?.instances?.map((s) => s.seq)).toEqual(['01', '03']);
    expect(Math.max(...plans.map((p) => p.services.length))).toBeGreaterThanOrEqual(2);
  });
});

describe.each(F.wizard)('마법사 v4 hash — $label', (c) => {
  const d = decodeWizardState(c.hash);
  it('같은 모델로 풀리고 고친 것이 없다 · rulesVersion 그대로', () => {
    expect(d).toBeDefined();
    expect(d!.plan).toEqual(c.plan);
    expect(d!.notices).toEqual(NO_NOTICES);
    expect(d!.rulesVersion).toBe(REVISION);
  });
  it('같은 이름 · 같은 valid', () => {
    expect(generateProject(expandPlan(d!.plan!), 'gcp').items.map(pick)).toEqual(c.items);
  });
  it('다시 인코딩하면 같은 문자열이다', () => {
    expect(`#state=${encodeWizardState(d!.plan!, REVISION)}`).toBe(c.hash);
  });
});

describe.each(F.tree)('트리 v3 hash — $label', (c) => {
  const d = decodeState(c.hash);
  it('버린 선택 없이 풀리고 rulesVersion 그대로', () => {
    expect(d?.provider).toBe('gcp');
    expect(d!.dropped).toBeUndefined();
    expect(d!.rulesVersion).toBe(REVISION);
  });
  it('같은 이름 · 같은 valid', () => {
    expect(generateMany(d!.context, 'gcp', d!.selection ?? []).items.map(pick)).toEqual(c.items);
  });
  it('다시 인코딩하면 같은 문자열이다', () => {
    expect(`#state=${encodeState(d!.context, REVISION, { provider: 'gcp', selection: d!.selection })}`).toBe(c.hash);
  });
});
