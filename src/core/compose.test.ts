import { describe, it, expect } from 'vitest';
import { compose, tokenValues } from './compose';
import { getRule } from './constraints';

const ctx = { owner: 'infra', system: 'billing', purpose: 'trade', env: 'prd', region: 'kr' } as const;

describe('tokenValues · compose', () => {
  it('GCP SA 원본 조립은 ① 예시와 같다 (34자)', () => {
    const rule = getRule('gcp', 'service_account')!;
    const name = compose(tokenValues(ctx, rule), rule.template, rule.separator);
    expect(name).toBe('infra-billing-trade-prd-kr-sa-sync');
    expect(name.length).toBe(34);
  });
  it('Azure Storage 는 구분자 없이 st 앞', () => {
    const rule = getRule('azure', 'storage_account')!;
    expect(compose(tokenValues(ctx, rule), rule.template, rule.separator)).toBe('stbillingtradeprd');
  });
  it('tokenValues 는 template 에 없는 토큰을 담지 않는다', () => {
    const rule = getRule('azure', 'aks_nodepool_windows')!;   // template [slug, purpose]
    expect(Object.keys(tokenValues(ctx, rule)).sort()).toEqual(['purpose', 'slug']);
  });
  it('빈 토큰은 건너뛰어 -- 를 만들지 않는다', () => {
    expect(compose({ system: 'a', purpose: '', env: 'prd' }, ['system', 'purpose', 'env'], '-')).toBe('a-prd');
  });
});
