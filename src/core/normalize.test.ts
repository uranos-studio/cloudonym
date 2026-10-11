import { describe, it, expect } from 'vitest';
import { normalizeToken, canonicalEnv } from './normalize';

describe('normalizeToken', () => {
  it('TC-AWS-01 대문자 → 소문자, 경계 하이픈 제거', () => {
    expect(normalizeToken('Billing-Trade-PRD-', 'lower-digit-hyphen')).toEqual({ value: 'billing-trade-prd', changed: true });
  });
  it('TC-COM-01 연속 하이픈 → 하나', () => {
    expect(normalizeToken('billing--trade', 'lower-digit-hyphen').value).toBe('billing-trade');
  });
  it('TC-AZ-01 lower-digit 는 하이픈 · 언더스코어를 지운다', () => {
    expect(normalizeToken('st-web_prod', 'lower-digit')).toEqual({ value: 'stwebprod', changed: true });
  });
  it('공백 · 유니코드는 지우고, 빈 결과는 빈 문자열로 돌려준다', () => {
    expect(normalizeToken(' 매매 ', 'lower-digit-hyphen').value).toBe('');
    expect(normalizeToken('a b', 'lower-digit-hyphen').value).toBe('a-b');
  });
  it('바뀐 것이 없으면 changed:false', () => {
    expect(normalizeToken('trade', 'lower-digit-hyphen')).toEqual({ value: 'trade', changed: false });
  });
  it('alnum 계열은 대소문자를 유지한다', () => {
    expect(normalizeToken('Web-App', 'alnum-hyphen').value).toBe('Web-App');
  });
  it('밑줄 집합 — 공백 · 하이픈은 밑줄로, 겹친 밑줄은 하나로, 앞뒤 밑줄은 뗀다', () => {
    expect(normalizeToken('My-Shop  App', 'lower-digit-underscore')).toEqual({ value: 'my_shop_app', changed: true });
    expect(normalizeToken('_a__b-', 'lower-digit-underscore').value).toBe('a_b');
    expect(normalizeToken('shop', 'lower-digit-underscore')).toEqual({ value: 'shop', changed: false });
    expect(normalizeToken('a.b', 'lower-digit-underscore').value).toBe('ab');
  });
});

describe('canonicalEnv (TC-COM-02)', () => {
  it.each([['production', 'prod'], ['prd', 'prod'], ['live', 'prod'], ['real', 'prod'], ['PRD', 'prod'], ['prod', 'prod'], ['staging', 'stg'], ['sandbox', 'sbx']])('%s → %s (D48)', (i, o) => {
    expect(canonicalEnv(i)).toBe(o);
  });
  it('모르는 값 · 상속 프로퍼티는 undefined', () => {
    expect(canonicalEnv('qa')).toBeUndefined();
    expect(canonicalEnv('constructor')).toBeUndefined();
  });
});

