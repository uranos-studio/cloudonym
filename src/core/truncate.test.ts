import { describe, it, expect } from 'vitest';
import { fit } from './truncate';
import { getRule } from './constraints';
import { tokenValues } from './compose';
import type { ResourceRule } from './types';

describe('fit — 3단계 축소', () => {
  it('TC-GCP-01 39자 SA → region·owner 를 떼고 28자', () => {
    const rule = getRule('gcp', 'service_account')!;
    const ctx = { owner: 'example', system: 'antigravity', purpose: 'sync', env: 'prd', region: 'kr' } as const;
    const r = fit(tokenValues(ctx, rule), rule);      // example-antigravity-sync-prd-kr-sa-sync = 39자
    expect(r).toMatchObject({ fits: true, truncated: true, name: 'antigravity-sync-prd-sa-sync', steps: [{ code: 'step.token_dropped', field: 'region' }, { code: 'step.token_dropped', field: 'owner' }] });
    expect(r.name.length).toBe(28);
  });
  it('① 예시: 34자 SA → region 만 떼면 31, owner 까지 떼면 25', () => {
    const rule = getRule('gcp', 'service_account')!;
    const ctx = { owner: 'infra', system: 'billing', purpose: 'trade', env: 'prd', region: 'kr' } as const;
    expect(fit(tokenValues(ctx, rule), rule).name).toBe('billing-trade-prd-sa-sync');
  });
  it('들어가면 손대지 않는다', () => {
    const rule = getRule('gcp', 'compute_instance')!;
    const ctx = { owner: 'sj', system: 'antigravity', purpose: 'sync', env: 'prd', region: 'kr' } as const;
    expect(fit(tokenValues(ctx, rule), rule)).toMatchObject({ truncated: false, fits: true, name: 'antigravity-sync-prd-kr-vm-01' });
  });
  it('TC-AZ-02 Windows 노드풀 6자: tokenValues 경로로 npprod', () => {
    const rule = getRule('azure', 'aks_nodepool_windows')!;   // template [slug, purpose] · max 6 · separator ''
    const ctx = { owner: 'x', system: 'y', purpose: 'production', env: 'prd', region: 'kr' } as const;
    const r = fit(tokenValues(ctx, rule), rule);              // 고정 = np(2) 만. seq·role 은 template 에 없다
    expect(r).toMatchObject({ fits: true, name: 'npprod', steps: [{ code: 'step.budget_shortened', params: { budget: 4 } }] });
  });
  it('env 는 보호 토큰 — Windows VM 15자에서도 prd 가 남는다 (D13)', () => {
    const rule = getRule('azure', 'virtual_machine_windows')!;
    const ctx = { owner: 'x', system: 'longsystem', purpose: 'longpurpose', env: 'prd', region: 'kr' } as const;
    const r = fit(tokenValues(ctx, rule), rule);   // region 생략 → 32자 → 고정 prd+vm+01=7 · 구분자 4 · B=⌊4/2⌋=2
    expect(r).toMatchObject({ fits: true, name: 'lo-lo-prd-vm-01' });
    expect(r.values.env).toBe('prd');
  });
  it('slice 가 토큰 끝에 남긴 하이픈을 지워 -- 를 만들지 않는다 (Key Vault 24자)', () => {
    const rule = getRule('azure', 'key_vault')!;   // template [slug, system, purpose, env] · optional []
    const r = fit({ slug: 'kv', system: 'abcdefg-hij', purpose: 'longpurpose', env: 'prd' }, rule);
    // 30자 → 고정 kv+prd=5 · 구분자 3 · B=⌊16/2⌋=8 → system 'abcdefg-'→'abcdefg' · purpose 'longpurp'
    expect(r).toMatchObject({ fits: true, name: 'kv-abcdefg-longpurp-prd' });
    expect(r.name).not.toMatch(/--/);
  });
  it('slice 뒤 토큰이 1글자가 되면 fits:false (D13 — Windows VM · system a-long)', () => {
    const rule = getRule('azure', 'virtual_machine_windows')!;
    const ctx = { owner: 'x', system: 'a-long', purpose: 'longpurpose', env: 'prd', region: 'kr' } as const;
    const r = fit(tokenValues(ctx, rule), rule);   // B=2 → system 'a-'→'a' (1글자) → 불변조건 위반
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
    expect(fit({ slug: 'kv', system: 'a-', purpose: 'bb', env: 'prd' }, rule).fits).toBe(false);   // kv-a--bb-prd
  });
  // 원장 판정 M1 — MIN_TOKEN 은 축소가 만든 토큰에만, 빈 선택 토큰은 가변 토큰으로 세지 않는다 (D13)
  it('정제로 비워진 선택 토큰(owner \'\')은 가변 토큰으로 세지 않는다 (SA)', () => {
    const rule = getRule('gcp', 'service_account')!;
    const r = fit({ owner: '', system: 'billing', purpose: 'trade', env: 'prd', region: 'kr', slug: 'sa', role: 'sync' }, rule);
    expect(r).toMatchObject({ fits: true, truncated: false, name: 'billing-trade-prd-kr-sa-sync' });
  });
  it('축소하지 않은 1글자 입력(system a)은 MIN_TOKEN 으로 막지 않는다 (GCP VM)', () => {
    const rule = getRule('gcp', 'compute_instance')!;
    const ctx = { owner: 'sj', system: 'a', purpose: 'sync', env: 'prd', region: 'kr' } as const;
    expect(fit(tokenValues(ctx, rule), rule)).toMatchObject({ fits: true, truncated: false, name: 'a-sync-prd-kr-vm-01' });
  });
});

describe('fit — 순번 자리수와 Windows VM 15자 (§5-2 실측 고정)', () => {
  const ctx = { owner: 'platform', system: 'billing', purpose: 'trade', env: 'prd', region: 'kr' } as const;
  it("seq '01' 은 들어간다 — bi-tr-prd-vm-01", () => {
    const rule = getRule('azure', 'virtual_machine_windows')!;
    expect(fit(tokenValues(ctx, rule, { seq: '01' }), rule)).toMatchObject({ fits: true, name: 'bi-tr-prd-vm-01' });
  });
  it("seq '099' 는 축소를 포기한다 — 세 자리면 가변 토큰 예산이 MIN_TOKEN 아래", () => {
    const rule = getRule('azure', 'virtual_machine_windows')!;
    expect(fit(tokenValues(ctx, rule, { seq: '099' }), rule).fits).toBe(false);
  });
});
