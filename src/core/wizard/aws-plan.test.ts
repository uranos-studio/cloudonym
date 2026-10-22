// AWS 마법사 (0.2) — 같은 모델 · 같은 함수에 provider 'aws'. 프로젝트 ID 가 없는 CSP 라 암묵 항목이 없다
import { describe, it, expect } from 'vitest';
import { expandPlan, validatePlan, type Pick, type WizardPlan } from './plan';
import { generateProject } from '../engine';
import { AWS_CATALOG } from '../rules/aws-catalog';
import { RULES } from '../constraints';
import { presetsFor, presetOf, presetTiersFor } from './presets';
import { ATTACHMENTS } from './attachments';
import { reservedTiersFor } from '../tier';

const PROJECT = { owner: 'platform', system: 'billing', env: 'prod', region: 'ap-northeast-2' };
const SLUG = new Map(AWS_CATALOG.map((r) => [r.key, r.slug.value]));

const SAMPLE: WizardPlan = {
  provider: 'aws',
  project: PROJECT,
  projectPicks: [
    { preset: 'vpc', instances: [{ id: 'a', seq: '01' }] },
    { preset: 'subnet', instances: [{ id: 'b', seq: '01' }] },
    { preset: 'firewall', tier: 'ssh', instances: [{ id: 'c', seq: '01' }] },
  ],
  services: [
    { purpose: 'shop', picks: [
      { preset: 'web', ha: true, instances: [{ id: 'e', seq: '01', attach: { boot: true, data: ['01'], ip: true, ipi: true } }, { id: 'f', seq: '02' }] },
      { preset: 'db', instances: [{ id: 'g', seq: '01' }] },
      { preset: 'object' },
      { preset: 'sa', role: 'app' },
    ] },
  ],
};
const svc = (...picks: Pick[]): WizardPlan => ({ provider: 'aws', project: PROJECT, projectPicks: [], services: [{ purpose: 'shop', picks }] });

describe('AWS 프리셋 데이터', () => {
  it('모든 프리셋 · serverless · 딸린 것이 있는 AWS 규칙을 가리킨다', () => {
    const aws = presetsFor('aws');
    expect(aws.length).toBe(22);
    for (const p of aws) {
      expect(RULES[p.ruleId]?.provider, p.id).toBe('aws');
      for (const s of p.serverless?.ruleIds ?? []) expect(RULES[s]?.provider, s).toBe('aws');
    }
    for (const a of ATTACHMENTS.filter((r) => r.parent.startsWith('aws.'))) {
      expect(RULES[a.parent]).toBeDefined();
      expect(RULES[a.child]).toBeDefined();
    }
    expect(ATTACHMENTS.filter((r) => r.parent.startsWith('aws.')).map((r) => r.attach)).toEqual(['boot', 'data', 'ip', 'ipi']);
  });
  it('같은 id 라도 provider 마다 다른 규칙이다 — GCP 표는 그대로', () => {
    expect(presetOf('web')?.ruleId).toBe('gcp.compute_instance');
    expect(presetOf('web', 'aws')?.ruleId).toBe('aws.ec2_instance');
    expect(presetOf('router', 'aws')).toBeUndefined();
  });
  it('AWS 프리셋 tier 는 AWS 예약어(약어 · 리전 코드 · 환경 값)가 아니다', () => {
    const reserved = reservedTiersFor('aws');
    expect(presetTiersFor('aws').filter((t) => reserved.has(t))).toEqual([]);
  });
});

describe('AWS 표본 — validatePlan → expandPlan → generateProject', () => {
  it('검사를 지나고 이름이 전부 valid · 프로젝트 ID 항목이 없다', () => {
    expect(validatePlan(SAMPLE)).toEqual({ ok: true });
    const res = generateProject(expandPlan(SAMPLE), 'aws');
    expect(res.valid).toBe(true);
    expect(res.items.some((i) => i.resourceType === 'project_id')).toBe(false);
    expect(res.items[0]!.resourceType).toBe('vpc');
  });
  it('새 약어를 쓴다 — 이름에 catalog/aws.json 의 slug 가 든다', () => {
    const res = generateProject(expandPlan(SAMPLE), 'aws');
    for (const i of res.items) {
      if (i.attach !== undefined) continue;
      const slug = SLUG.get(i.ruleId);
      expect(slug, i.ruleId).toBeTruthy();
      expect(i.name.split('-'), `${i.ruleId} ${i.name}`).toContain(slug);
    }
    const web = res.items.find((i) => i.ruleId === 'aws.ec2_instance' && i.seq === '01')!;
    expect(web.name).toBe(`billing-shop-prod-apne2-${SLUG.get('aws.ec2_instance')}-web-01`);
    expect(res.items.filter((i) => i.parent === web.key).map((i) => [i.attach, i.ruleId, i.name])).toEqual([
      ['boot', 'aws.ebs_volume', `${web.name}-boot`],
      ['data', 'aws.ebs_volume', `${web.name}-data-01`],
      ['ip', 'aws.ec2_eip', `${web.name}-ip`],
      ['ipi', 'aws.ec2_network_interface', `${web.name}-ipi`],
    ]);
  });
  it('존을 주면 리전으로 풀리고 이름에 존 토큰이 없다', () => {
    const zoned = { ...SAMPLE, project: { ...PROJECT, region: 'ap-northeast-2a' } };
    expect(validatePlan(zoned)).toEqual({ ok: true });
    const a = generateProject(expandPlan(zoned), 'aws').items.map((i) => i.name);
    const b = generateProject(expandPlan(SAMPLE), 'aws').items.map((i) => i.name);
    expect(a).toEqual(b);
    expect(a.some((n) => /apne2a|ap-northeast-2a/.test(n))).toBe(false);
  });
  it('GCP 리전 · GCP 규칙은 AWS 계획에서 거부한다', () => {
    const gcpRegion = validatePlan({ ...SAMPLE, project: { ...PROJECT, region: 'asia-northeast3' } });
    expect(gcpRegion.ok).toBe(false);
    const gcpRule = validatePlan(svc({ preset: null, ruleId: 'gcp.storage_bucket' }));
    expect(!gcpRule.ok && gcpRule.errors[0]?.code).toBe('selection.unknown_type');
    const gcpPreset = validatePlan(svc({ preset: 'run' }));
    expect(!gcpPreset.ok && gcpPreset.errors[0]?.code).toBe('wizard.unknown_preset');
  });
  it('HA · serverless(Lambda) · custom 규칙', () => {
    expect(validatePlan(svc({ preset: 'web', ha: true, instances: [{ id: 'a', seq: '01' }] })).ok).toBe(false);
    const sv = svc({ preset: 'web', serverless: 'aws.lambda_function', instances: [{ id: 'a', seq: '01' }] });
    expect(validatePlan(sv)).toEqual({ ok: true });
    expect(generateProject(expandPlan(sv), 'aws').items[0]!.ruleId).toBe('aws.lambda_function');
    const custom = svc({ preset: null, ruleId: 'aws.dynamodb_table', instances: [{ id: 'a', seq: '01' }] });
    expect(validatePlan(custom)).toEqual({ ok: true });
  });
  it('프로젝트 ID 접미사는 AWS 에 없다 — wizard.project_id_suffix_not_supported', () => {
    const r = validatePlan({ ...SAMPLE, projectIdSuffix: 'team1' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors).toEqual([{ code: 'wizard.project_id_suffix_not_supported', params: { provider: 'aws' }, path: 'projectIdSuffix' }]);
  });
  it('프로젝트 칸은 파티션 · 계정 · 리전 · VPC 범위 — NAT · 인터넷 게이트웨이 · 라우트 테이블을 받는다', () => {
    const p: WizardPlan = { ...SAMPLE, projectPicks: [{ preset: 'nat', instances: [{ id: 'a', seq: '01' }] }, { preset: 'igw', instances: [{ id: 'b', seq: '01' }] }, { preset: 'rt', instances: [{ id: 'c', seq: '01' }] }] };
    expect(validatePlan(p)).toEqual({ ok: true });
  });
});
