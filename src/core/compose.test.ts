import { describe, it, expect } from 'vitest';
import { compose, tokenValues } from './compose';
import { getRule } from './constraints';

const ctx = { owner: 'infra', system: 'billing', purpose: 'trade', env: 'prod', region: 'kr' } as const;

describe('tokenValues · compose', () => {
  it('GCP SA 원본 조립은 ① 예시와 같다 (35자)', () => {
    const rule = getRule('gcp', 'service_account')!;
    const name = compose(tokenValues(ctx, rule), rule.template, rule.separator);
    expect(name).toBe('infra-billing-trade-prod-kr-sa-sync');
    expect(name.length).toBe(35);
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
    expect(compose(tokenValues(ctx, vm, { seq: '07' }), vm.template, vm.separator)).toBe('billing-trade-prod-kr-gce-07');
  });
  it("role 'db' 를 주면 …-sa-db", () => {
    const sa = getRule('gcp', 'service_account')!;
    expect(compose(tokenValues(ctx, sa, { role: 'db' }), sa.template, sa.separator)).toBe('infra-billing-trade-prod-kr-sa-db');
  });
  it('template 에 없는 토큰은 extra 로 주어도 담지 않는다', () => {
    const rg = getRule('azure', 'resource_group')!;
    const v = tokenValues(ctx, rg, { seq: '05', role: 'db' });
    expect('seq' in v).toBe(false);
    expect('role' in v).toBe(false);
  });
});
