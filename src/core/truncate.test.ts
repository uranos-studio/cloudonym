import { describe, it, expect } from 'vitest';
import { fit } from './truncate';
import { getRule, rulesFor } from './constraints';
import { tokenValues } from './compose';
import { MAX_CONTEXT_CHARS, generate } from './engine';
import { PROTECTED, type ResourceRule } from './types';

describe('fit — 3단계 축소', () => {
  it('TC-GCP-01 42자 SA → region·owner 를 떼고 29자', () => {
    const rule = getRule('gcp', 'service_account')!;
    const ctx = { owner: 'example', system: 'antigravity', purpose: 'sync', env: 'prod', region: 'ane3' } as const;
    const r = fit(tokenValues(ctx, rule), rule);      // example-antigravity-sync-prod-ane3-sa-sync = 42자
    expect(r).toMatchObject({ fits: true, truncated: true, name: 'antigravity-sync-prod-sa-sync', steps: [{ code: 'step.token_dropped', field: 'region' }, { code: 'step.token_dropped', field: 'owner' }] });
    expect(r.name.length).toBe(29);
  });
  it('① 예시: 37자 SA → region 만 떼면 32, owner 까지 떼면 26', () => {
    const rule = getRule('gcp', 'service_account')!;
    const ctx = { owner: 'infra', system: 'billing', purpose: 'trade', env: 'prod', region: 'ane3' } as const;
    expect(fit(tokenValues(ctx, rule), rule).name).toBe('billing-trade-prod-sa-sync');
  });
  it('들어가면 손대지 않는다', () => {
    const rule = getRule('gcp', 'compute_instance')!;
    const ctx = { owner: 'sj', system: 'antigravity', purpose: 'sync', env: 'prod', region: 'ane3', zone: 'ane3a' } as const;
    expect(fit(tokenValues(ctx, rule), rule)).toMatchObject({ truncated: false, fits: true, name: 'antigravity-sync-prod-ane3a-gce-01' });
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
  it('정제로 비워진 선택 토큰(owner \'\')은 가변 토큰으로 세지 않는다 (SA)', () => {
    const rule = getRule('gcp', 'service_account')!;
    const r = fit({ owner: '', system: 'billing', purpose: 'trade', env: 'prod', region: 'kr', slug: 'sa', role: 'sync' }, rule);
    expect(r).toMatchObject({ fits: true, truncated: false, name: 'billing-trade-prod-kr-sa-sync' });
  });
  it('축소하지 않은 1글자 입력(system a)은 MIN_TOKEN 으로 막지 않는다 (GCP VM)', () => {
    const rule = getRule('gcp', 'compute_instance')!;
    const ctx = { owner: 'sj', system: 'a', purpose: 'sync', env: 'prod', region: 'ane3', zone: 'ane3a' } as const;
    expect(fit(tokenValues(ctx, rule), rule)).toMatchObject({ fits: true, truncated: false, name: 'a-sync-prod-ane3a-gce-01' });
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

describe('지역 토큰과 축소 (D51)', () => {
  const gcpRules = rulesFor('gcp');
  it('템플릿에 region 이 있는 GCP 규칙 — region 규칙은 optional 에 region 이 있고, 존 규칙 14 는 없다', () => {
    const placed = gcpRules.filter((r) => r.template.includes('region'));
    const zonal = placed.filter((r) => r.regionToken === 'zone');
    expect(zonal).toHaveLength(14);
    for (const r of zonal) expect(r.optional, r.id).not.toContain('region');
    for (const r of placed.filter((x) => x.regionToken === 'region')) expect(r.optional, r.id).toContain('region');
    // 템플릿에 region 이 없으면 none 이고, 있으면 none 이 아니다
    for (const r of gcpRules) expect(r.regionToken === 'none', r.id).toBe(!r.template.includes('region'));
  });

  it('긴 입력에서 존 ane3a · ane3b 의 VM 은 다른 이름이다 — 존 코드는 떼지도 자르지도 않는다', () => {
    const rule = getRule('gcp', 'compute_instance')!;
    const long = { owner: 'o', system: 's'.repeat(MAX_CONTEXT_CHARS), purpose: 'p'.repeat(MAX_CONTEXT_CHARS), env: 'prod' as const, region: 'ane3' };
    const a = fit(tokenValues({ ...long, zone: 'ane3a' }, rule), rule);
    const b = fit(tokenValues({ ...long, zone: 'ane3b' }, rule), rule);
    expect(a.fits && b.fits).toBe(true);
    expect(a.name).not.toBe(b.name);
    expect(a.name).toContain('-ane3a-');
    expect(b.name).toContain('-ane3b-');
  });

  it('MAX_CONTEXT_CHARS 64 둘을 넣어도 존 규칙 14 는 name.cannot_fit 없이 들어간다', () => {
    const ctx = { owner: 'o'.repeat(MAX_CONTEXT_CHARS), system: 's'.repeat(MAX_CONTEXT_CHARS), purpose: 'p'.repeat(MAX_CONTEXT_CHARS), env: 'prod' as const, region: 'ause1', zone: 'ause1a' };
    const out = generate(ctx, ['gcp']).gcp!;
    for (const r of gcpRules.filter((x) => x.regionToken === 'zone')) {
      expect(out[r.resourceType]!.violations.map((v) => v.code), r.id).toEqual([]);
      expect(out[r.resourceType]!.name, r.id).toContain('-ause1a-');
    }
  });

  it("PROTECTED 에 region 이 있어도 region 규칙의 1단계 결과는 같다 — region 이 먼저 떨어진다", () => {
    expect(PROTECTED).toContain('region');
    const rule = getRule('gcp', 'service_account')!;
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
