import { describe, it, expect } from 'vitest';
import { compose, tokenValues } from './compose';
import { getRule } from './constraints';

const ctx = { owner: 'infra', system: 'billing', purpose: 'trade', env: 'prod', region: 'ane3', zone: 'ane3a' } as const;

describe('tokenValues · compose', () => {
  it('GCP SA 원본 조립은 ① 예시와 같다 (37자)', () => {
    const rule = getRule('gcp', 'service_account')!;
    const name = compose(tokenValues(ctx, rule), rule.template, rule.separator);
    expect(name).toBe('infra-billing-trade-prod-ane3-sa-sync');
    expect(name.length).toBe(37);
  });
  it('Azure Storage 는 구분자 없이 st 앞', () => {
    const rule = getRule('azure', 'storage_account')!;
    expect(compose(tokenValues(ctx, rule), rule.template, rule.separator)).toBe('stbillingtradeprod');
  });
  it('tokenValues 는 template 에 없는 토큰을 담지 않는다', () => {
    const rule = getRule('azure', 'aks_nodepool_windows')!;   // template [slug, purpose]
    expect(Object.keys(tokenValues(ctx, rule)).sort()).toEqual(['purpose', 'slug']);
  });
  it('빈 토큰은 건너뛰어 -- 를 만들지 않는다', () => {
    expect(compose({ system: 'a', purpose: '', env: 'prod' }, ['system', 'purpose', 'env'], '-')).toBe('a-prod');
  });
});

describe('tokenValues — 존은 이름에 들지 않는다 (D50 revised)', () => {
  it('존 문맥(asia-northeast3-a)에서 compute_instance → …-ane3-gce-01 · disk → …-ane3-disk-01', () => {
    const vm = getRule('gcp', 'compute_instance')!;
    const disk = getRule('gcp', 'disk')!;
    expect(compose(tokenValues(ctx, vm), vm.template, vm.separator)).toBe('billing-trade-prod-ane3-gce-01');
    expect(compose(tokenValues(ctx, disk), disk.template, disk.separator)).toBe('billing-trade-prod-ane3-disk-01');
    const noZone = { ...ctx, zone: undefined };
    expect(compose(tokenValues(noZone, disk), disk.template, disk.separator)).toBe('billing-trade-prod-ane3-disk-01');
  });
  it('global 이면 지역 자리가 비어 있다 — 다른 지역 규칙과 같다', () => {
    const disk = getRule('gcp', 'disk')!;
    expect(compose(tokenValues({ ...ctx, region: 'global', zone: undefined }, disk), disk.template, disk.separator)).toBe('billing-trade-prod-disk-01');
  });
});

describe('tokenValues — 항목 입력 seq · role (D30\')', () => {
  it('extra 가 없으면 seq 01 · role sync — 지금 출력과 같다', () => {
    const vm = getRule('gcp', 'compute_instance')!;
    const sa = getRule('gcp', 'service_account')!;
    expect(tokenValues(ctx, vm).seq).toBe('01');
    expect(tokenValues(ctx, sa).role).toBe('sync');
    expect(tokenValues(ctx, vm, {})).toEqual(tokenValues(ctx, vm));
  });
  it("seq '07' 을 주면 …-gce-07", () => {
    const vm = getRule('gcp', 'compute_instance')!;
    expect(compose(tokenValues(ctx, vm, { seq: '07' }), vm.template, vm.separator)).toBe('billing-trade-prod-ane3-gce-07');
  });
  it("role 'db' 를 주면 …-sa-db", () => {
    const sa = getRule('gcp', 'service_account')!;
    expect(compose(tokenValues(ctx, sa, { role: 'db' }), sa.template, sa.separator)).toBe('infra-billing-trade-prod-ane3-sa-db');
  });
  it('template 에 없는 토큰은 extra 로 주어도 담지 않는다', () => {
    const rg = getRule('azure', 'resource_group')!;
    const v = tokenValues(ctx, rg, { seq: '05', role: 'db' });
    expect('seq' in v).toBe(false);
    expect('role' in v).toBe(false);
  });
});

describe('tokenValues — 종류 토큰 (D52)', () => {
  const sql = () => getRule('gcp', 'cloud_sql_instance')!;
  const name = (kind?: string) => compose(tokenValues(ctx, sql(), kind === undefined ? {} : { kind }), sql().template, sql().separator);

  it("kind 'POSTGRES' → 약어 바로 뒤에 pg — …-sql-pg-01", () => {
    expect(name('POSTGRES')).toBe('billing-trade-prod-ane3-sql-pg-01');
  });
  it('kind 가 없으면 지금 이름 그대로 — …-sql-01', () => {
    expect(name()).toBe('billing-trade-prod-ane3-sql-01');
  });
  it('CSP 기본값(MYSQL)을 명시해도 토큰이 붙지 않는다', () => {
    expect(name('MYSQL')).toBe('billing-trade-prod-ane3-sql-01');
  });
  it('행의 omitValues(EXTERNAL_MANAGED)는 토큰 없음 · 내부 묶음은 int', () => {
    const bs = getRule('gcp', 'backend_service')!;
    expect(compose(tokenValues(ctx, bs, { kind: 'EXTERNAL_MANAGED' }), bs.template, bs.separator)).toBe('billing-trade-prod-bs-01');
    expect(compose(tokenValues(ctx, bs, { kind: 'INTERNAL_MANAGED' }), bs.template, bs.separator)).toBe('billing-trade-prod-bs-int-01');
  });
  it('허용 밖 값 · 종류 표가 없는 규칙에 값을 주면 던진다', () => {
    expect(() => tokenValues(ctx, sql(), { kind: 'pg' })).toThrow(/pg/);
    expect(() => tokenValues(ctx, getRule('gcp', 'vpc_network')!, { kind: 'POSTGRES' })).toThrow(/vpc_network/);
  });
});

describe('tokenValues — 용도 토큰 tier · 프로젝트 수준 (D60 · D63)', () => {
  const seoul = { owner: 'platform', system: 'billing', purpose: 'shop', env: 'prod', region: 'ane3' } as const;
  const project = { owner: 'platform', system: 'billing', env: 'prod', region: 'ane3' } as const;
  const named = (c: Parameters<typeof tokenValues>[0], type: string, extra: Parameters<typeof tokenValues>[2] = {}) => {
    const r = getRule('gcp', type)!;
    return compose(tokenValues(c, r, extra), r.template, r.separator);
  };

  it("tier 'web' → 약어 뒤 · 순번 앞 — billing-shop-prod-ane3-gce-web-01", () => {
    expect(named(seoul, 'compute_instance', { tier: 'web' })).toBe('billing-shop-prod-ane3-gce-web-01');
  });
  it('tier 가 없으면 지금 이름 그대로 — …-gce-01', () => {
    expect(named(seoul, 'compute_instance')).toBe('billing-shop-prod-ane3-gce-01');
    expect(tokenValues(seoul, getRule('gcp', 'compute_instance')!).tier).toBe('');
  });
  it('tier 는 글자 그대로 들어간다(자리만 정한다)', () => {
    expect(named(seoul, 'compute_instance', { tier: 'bastion', seq: '03' })).toBe('billing-shop-prod-ane3-gce-bastion-03');
  });
  it("종류 + 용도 — 방화벽 kind 'EGRESS'(토큰 egr) + tier 'ssh' → 종류가 먼저", () => {
    expect(named(project, 'firewall_rule', { kind: 'EGRESS', tier: 'ssh', level: 'project' })).toBe('billing-prod-fw-egr-ssh-01');
    expect(named(seoul, 'cloud_sql_instance', { kind: 'POSTGRES', tier: 'rpt' })).toBe('billing-shop-prod-ane3-sql-pg-rpt-01');
  });
  it("level 'project' + 프로젝트 문맥 → purpose 자리가 없다 — billing-prod-vpc-01 · 프로젝트 ID platform-billing-prod", () => {
    expect(named(project, 'vpc_network', { level: 'project' })).toBe('billing-prod-vpc-01');
    expect(named(project, 'project_id', { level: 'project' })).toBe('platform-billing-prod');
    expect('purpose' in tokenValues(project, getRule('gcp', 'vpc_network')!, { level: 'project' })).toBe(false);
  });
  it('순번 없는 GCP 규칙은 약어 바로 뒤에 tier (D74) · 역할 규칙에는 tier 가 들어가지 않는다', () => {
    expect(named(seoul, 'storage_bucket', { tier: 'web' })).toBe('platform-billing-shop-prod-gcs-web');
    expect(named(seoul, 'storage_bucket')).toBe('platform-billing-shop-prod-gcs');
    expect('tier' in tokenValues(seoul, getRule('gcp', 'service_account')!, { tier: 'web' })).toBe(false);
  });
});
