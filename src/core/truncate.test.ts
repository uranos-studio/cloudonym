import { describe, it, expect } from 'vitest';
import { fit } from './truncate';
import { RULES, getRule, rulesFor } from './constraints';
import { tokenValues } from './compose';
import { MAX_CONTEXT_CHARS, generate, generateItem } from './engine';
import { PROTECTED, type ResourceRule } from './types';

/** 시험용 규칙 — D77 전의 SA 꼴(owner · region 둘 다 생략 토큰, optional 은 공식에서 뒤인 region 이 먼저).
 *  실제 SA 는 owner · 지역이 없어 1단계 축소가 없다 — 1단계의 순서 · 빈 토큰 판정은 이 꼴로 본다 */
const twoOptional = (): ResourceRule => ({ ...getRule('gcp', 'service_account')!, id: 'test.two-optional', regionToken: 'region',
  template: ['owner', 'system', 'purpose', 'env', 'region', 'slug', 'role'], optional: ['region', 'owner'] });

describe('fit — 3단계 축소', () => {
  it('TC-GCP-01 SA 30자 축약 — system+purpose 가 길면 균등 예산으로 줄인다 (D77 뒤에는 뗄 생략 토큰이 없다)', () => {
    const rule = getRule('gcp', 'service_account')!;
    const ctx = { owner: 'example', system: 'antigravity', purpose: 'synchronize', env: 'prod', region: 'ane3' } as const;
    const r = fit(tokenValues(ctx, rule), rule);      // antigravity-synchronize-prod-sa-sync = 36자
    expect(r.fits).toBe(true);
    expect(r.truncated).toBe(true);
    expect(r.steps.map((s) => s.code)).not.toContain('step.token_dropped');
    expect(r.name.length).toBeLessThanOrEqual(30);
    expect(r.name).toMatch(/-prod-sa-sync$/);
  });
  it('생략 토큰 둘이면 optional 순서(region · owner)로 뗀다 — SA 의 옛 꼴 42자 → 29자', () => {
    const rule = twoOptional();
    const ctx = { owner: 'example', system: 'antigravity', purpose: 'sync', env: 'prod', region: 'ane3' } as const;
    const r = fit(tokenValues(ctx, rule), rule);      // example-antigravity-sync-prod-ane3-sa-sync = 42자
    expect(r).toMatchObject({ fits: true, truncated: true, name: 'antigravity-sync-prod-sa-sync', steps: [{ code: 'step.token_dropped', field: 'region' }, { code: 'step.token_dropped', field: 'owner' }] });
    expect(r.name.length).toBe(29);
  });
  it('① 예시: SA 는 owner · 지역 없이 26자 그대로 (D77)', () => {
    const rule = getRule('gcp', 'service_account')!;
    const ctx = { owner: 'infra', system: 'billing', purpose: 'trade', env: 'prod', region: 'ane3' } as const;
    expect(fit(tokenValues(ctx, rule), rule).name).toBe('billing-trade-prod-sa-sync');
  });
  it('들어가면 손대지 않는다', () => {
    const rule = getRule('gcp', 'compute_instance')!;
    const ctx = { owner: 'sj', system: 'antigravity', purpose: 'sync', env: 'prod', region: 'ane3', zone: 'ane3a' } as const;
    expect(fit(tokenValues(ctx, rule), rule)).toMatchObject({ truncated: false, fits: true, name: 'antigravity-sync-prod-ane3-gce-01' });
  });
  it('TC-AZ-02 Windows 노드풀 6자: tokenValues 경로로 npprod', () => {
    const rule = getRule('azure', 'aks_nodepool_windows')!;   // template [slug, purpose] · max 6 · separator ''
    const ctx = { owner: 'x', system: 'y', purpose: 'production', env: 'prod', region: 'krc' } as const;
    const r = fit(tokenValues(ctx, rule), rule);              // 고정 = np(2) 만. seq·role 은 template 에 없다
    expect(r).toMatchObject({ fits: true, name: 'npprod', steps: [{ code: 'step.budget_shortened', params: { budget: 4 } }] });
  });
  // 3자 env(dev) 로 본다 — prod(4자)면 예산이 1 이라 들어가지 않는다(아래 「env prod 는 Windows VM 15자에 들어가지 않는다」)
  it('env 는 보호 토큰 — Windows VM 15자에서도 dev 가 남는다 (D13)', () => {
    const rule = getRule('azure', 'virtual_machine_windows')!;
    const ctx = { owner: 'x', system: 'longsystem', purpose: 'longpurpose', env: 'dev', region: 'krc' } as const;
    const r = fit(tokenValues(ctx, rule), rule);   // region 생략 → 32자 → 고정 dev+vm+01=7 · 구분자 4 · B=⌊4/2⌋=2
    expect(r).toMatchObject({ fits: true, name: 'lo-lo-dev-vm-01' });
    expect(r.values.env).toBe('dev');
  });
  it('env prod 는 Windows VM 15자에 들어가지 않는다 — 보호 토큰이라 줄이지 않고 fits:false (D48)', () => {
    const rule = getRule('azure', 'virtual_machine_windows')!;
    const ctx = { owner: 'x', system: 'longsystem', purpose: 'longpurpose', env: 'prod', region: 'krc' } as const;
    const r = fit(tokenValues(ctx, rule), rule);   // 고정 prod+vm+01=8 · 구분자 4 · B=⌊3/2⌋=1 < MIN_TOKEN
    expect(r).toMatchObject({ fits: false, name: 'longsystem-longpurpose-prod-vm-01' });
    expect(r.values.env).toBe('prod');
  });
  it('slice 가 토큰 끝에 남긴 하이픈을 지워 -- 를 만들지 않는다 (Key Vault 24자)', () => {
    const rule = getRule('azure', 'key_vault')!;   // template [slug, system, purpose, env] · optional []
    const r = fit({ slug: 'kv', system: 'abcdef-ghij', purpose: 'longpurpose', env: 'prod' }, rule);
    // 31자 → 고정 kv+prod=6 · 구분자 3 · B=⌊15/2⌋=7 → system 'abcdef-'(7번째 글자가 하이픈)→'abcdef' · purpose 'longpur'
    expect(r.values.system).toBe('abcdef');
    expect(r).toMatchObject({ fits: true, name: 'kv-abcdef-longpur-prod' });
    expect(r.name).not.toMatch(/--/);
  });
  it('slice 뒤 토큰이 1글자가 되면 fits:false (D13 — Windows VM · system a-long)', () => {
    const rule = getRule('azure', 'virtual_machine_windows')!;
    const ctx = { owner: 'x', system: 'a-long', purpose: 'longpurpose', env: 'dev', region: 'krc' } as const;
    const r = fit(tokenValues(ctx, rule), rule);   // env dev 로 B=2 → system 'a-'→'a' (1글자) → 불변조건 위반
    expect(r.fits).toBe(false);
  });
  it('예산이 2 미만이면 자르지 않고 fits:false (한 글자 토큰 금지)', () => {
    const tiny: ResourceRule = { ...getRule('gcp', 'compute_instance')!, id: 'test.tiny', maxLength: 5, slug: 'abc', template: ['slug', 'system'], optional: [] };
    const r = fit({ slug: 'abc', system: 'xyz' }, tiny);     // abc-xyz 7자 · 고정 3 · 구분자 1 · B=1
    expect(r).toMatchObject({ fits: false, name: 'abc-xyz' });
    expect(r.steps).not.toContainEqual({ code: 'step.budget_shortened', params: { budget: 1 } });
  });
  it('불변조건: 정제 안 된 입력(a-)도 fits:false 로 잡는다', () => {
    const rule = getRule('azure', 'key_vault')!;
    expect(fit({ slug: 'kv', system: 'a-', purpose: 'bb', env: 'prod' }, rule).fits).toBe(false);   // kv-a--bb-prod
  });
  // MIN_TOKEN 은 축소가 만든 토큰에만, 빈 선택 토큰은 가변 토큰으로 세지 않는다 (D13)
  it('정제로 비워진 선택 토큰(owner \'\')은 가변 토큰으로 세지 않는다 (SA 의 옛 꼴)', () => {
    const rule = twoOptional();
    const r = fit({ owner: '', system: 'billing', purpose: 'trade', env: 'prod', region: 'kr', slug: 'sa', role: 'sync' }, rule);
    expect(r).toMatchObject({ fits: true, truncated: false, name: 'billing-trade-prod-kr-sa-sync' });
  });
  it('축소하지 않은 1글자 입력(system a)은 MIN_TOKEN 으로 막지 않는다 (GCP VM)', () => {
    const rule = getRule('gcp', 'compute_instance')!;
    const ctx = { owner: 'sj', system: 'a', purpose: 'sync', env: 'prod', region: 'ane3', zone: 'ane3a' } as const;
    expect(fit(tokenValues(ctx, rule), rule)).toMatchObject({ fits: true, truncated: false, name: 'a-sync-prod-ane3-gce-01' });
  });
});

describe('fit — 순번 자리수와 Windows VM 15자 (실측 고정)', () => {
  // 순번 자리수를 보려고 3자 env(dev) 로 둔다 — prod 는 seq 두 자리에서도 들어가지 않는다(아래 첫 시험)
  const ctx = { owner: 'platform', system: 'billing', purpose: 'trade', env: 'dev', region: 'krc' } as const;
  it("env prod 면 seq '01' 도 들어가지 않는다 — 고정 prod+vm+01 이 예산을 MIN_TOKEN 아래로 (D48)", () => {
    const rule = getRule('azure', 'virtual_machine_windows')!;
    expect(fit(tokenValues({ ...ctx, env: 'prod' }, rule, { seq: '01' }), rule)).toMatchObject({ fits: false, name: 'billing-trd-prod-vm-01' });
  });
  it("seq '01' 은 들어간다 — bi-tr-dev-vm-01", () => {
    const rule = getRule('azure', 'virtual_machine_windows')!;
    expect(fit(tokenValues(ctx, rule, { seq: '01' }), rule)).toMatchObject({ fits: true, name: 'bi-tr-dev-vm-01' });
  });
  it("seq '099' 는 축소를 포기한다 — 세 자리면 가변 토큰 예산이 MIN_TOKEN 아래", () => {
    const rule = getRule('azure', 'virtual_machine_windows')!;
    expect(fit(tokenValues(ctx, rule, { seq: '099' }), rule).fits).toBe(false);
  });
});

describe('지역 토큰과 축소 (D50 revised — D51 철회)', () => {
  const gcpRules = rulesFor('gcp');
  const ZONAL = ['compute_instance', 'disk', 'autoscaler', 'future_reservation', 'instance_group_manager', 'instance_group', 'instant_snapshot_group',
    'instant_snapshot', 'reservation', 'storage_pool', 'target_instance', 'zone_vm_extension_policy', 'node_group', 'network_endpoint_group'];
  it('템플릿에 region 이 있는 GCP 규칙은 전부 region 규칙이고 optional 에 region 이 있다 — 옛 존 규칙 14 도 같다', () => {
    const placed = gcpRules.filter((r) => r.template.includes('region'));
    expect(placed.filter((r) => r.regionToken !== 'region').map((r) => r.id)).toEqual([]);
    for (const r of placed) expect(r.optional, r.id).toContain('region');
    // 템플릿에 region 이 없으면 none 이고, 있으면 none 이 아니다
    for (const r of gcpRules) expect(r.regionToken === 'none', r.id).toBe(!r.template.includes('region'));
  });

  it('긴 입력이면 옛 존 규칙 14 도 축소 1단계가 region 을 뗀다 — 다른 지역 규칙과 같다', () => {
    const ctx = { owner: 'o', system: 's'.repeat(MAX_CONTEXT_CHARS), purpose: 'p'.repeat(MAX_CONTEXT_CHARS), env: 'prod' as const, region: 'ause1', zone: 'ause1a' };
    const out = generate(ctx, ['gcp']).gcp!;
    for (const t of ZONAL) {
      const r = out[t]!;
      expect(r.violations.map((v) => v.code), t).toEqual([]);
      expect(r.steps[0], t).toEqual({ code: 'step.token_dropped', field: 'region' });
      expect(r.name, t).not.toContain('ause1');
    }
  });

  it("PROTECTED 에 region 이 있어도 region 규칙의 1단계 결과는 같다 — region 이 먼저 떨어진다", () => {
    expect(PROTECTED).toContain('region');
    const rule = twoOptional();
    const ctx = { owner: 'example', system: 'antigravity', purpose: 'sync', env: 'prod' as const, region: 'ane3' };
    expect(fit(tokenValues(ctx, rule), rule)).toMatchObject({ fits: true, name: 'antigravity-sync-prod-sa-sync',
      steps: [{ code: 'step.token_dropped', field: 'region' }, { code: 'step.token_dropped', field: 'owner' }] });
  });

  it('regionToken 이 없는 규칙(AWS · Azure)은 템플릿에 region 이 있으면 region 규칙으로 돈다', () => {
    const rule = getRule('azure', 'virtual_machine')!;
    expect(rule.regionToken).toBeUndefined();
    expect(rule.template).toContain('region');
    const ctx = { owner: 'o', system: 'billing', purpose: 'trade', env: 'prod' as const, region: 'krc', zone: 'zz' };
    expect(tokenValues(ctx, rule).region).toBe('krc');
    expect(tokenValues({ ...ctx, region: 'global' }, rule).region).toBe('');
  });
});

describe('용도 토큰 tier 는 보호 토큰이다 (D60)', () => {
  const ctx = { owner: 'platform', system: 'billing', purpose: 'shop', env: 'prod', region: 'ane3' } as const;
  const vm = () => getRule('gcp', 'compute_instance')!;

  it('tier 16자 + 긴 입력 → 가변 토큰이 줄고 tier 는 글자 그대로', () => {
    const tier = 'abcdefghijklmnop';
    const r = fit(tokenValues({ ...ctx, system: 'paymentsettlementplatform', purpose: 'reconciliationworker' }, vm(), { tier }), vm());
    expect(r.fits).toBe(true);
    expect(r.values.tier).toBe(tier);
    expect(r.name.length).toBeLessThanOrEqual(63);
    expect(r.name.endsWith(`-gce-${tier}-01`)).toBe(true);
  });
  it('가변 토큰을 다 줄여도 안 들어가면 실패한다 — tier 를 자르지 않는다', () => {
    const tiny = { ...vm(), id: 'test.tier-tiny', maxLength: 30 };
    const r = fit(tokenValues({ ...ctx, purpose: 'reconciliation' }, tiny, { tier: 'abcdefghijklmnop' }), tiny);
    expect(r.fits).toBe(false);
    expect(r.values.tier).toBe('abcdefghijklmnop');
  });
  it('tier 는 PROTECTED 에 있고 어느 규칙의 optional 에도 없다', () => {
    expect(PROTECTED).toContain('tier');
    for (const r of Object.values(RULES)) expect(r.optional, r.id).not.toContain('tier');
  });
});

describe('밑줄 구분자 — 하이픈을 받지 않는 규칙 (D72)', () => {
  // 시험용 규칙 — SA 의 옛 꼴(…-sa-<role>)을 밑줄로 바꿨다. 실제 밑줄 규칙은 rule-cases · 기준선이 덮는다
  const sa = twoOptional();
  const rule: ResourceRule = { ...sa, separator: '_', allowed: 'lower-digit-underscore', pattern: /^[a-z][a-z0-9_]*$/, startsWithLetter: true, endsWithAlnum: false };
  it('토큰을 밑줄로 잇고 토큰 안 하이픈도 밑줄이 된다', () => {
    const r = generateItem({ owner: 'x', system: 'billing', purpose: 'my-shop', env: 'prod', region: 'global' }, rule);
    expect(r).toMatchObject({ name: 'x_billing_my_shop_prod_sa_sync', valid: true, isTransformed: true });
  });
  it('균등 예산으로 자른 토큰 끝에 밑줄이 남지 않고 겹친 밑줄도 없다', () => {
    const ctx = { owner: 'x', system: 'abcdefg_hij', purpose: 'klmnopq_rst', env: 'prod', region: 'ane3' } as const;
    const r = fit(tokenValues(ctx, rule), rule);    // 30자 — region 을 떼도 넘친다 → 예산 ⌊(30-4-2-4-4)/2⌋ = 8
    expect(r).toMatchObject({ fits: true, name: 'abcdefg_klmnopq_prod_sa_sync' });
    expect(r.name).not.toMatch(/__|^_|_$/);
  });
});
