import { describe, it, expect } from 'vitest';
import { toWireGenerate, toWireName, toWireValidate } from './serialize';
import type { NameResult } from '../core/types';

const base: NameResult = {
  ruleId: 'gcp.service_account', resourceType: 'service_account', displayName: 'Service Account',
  name: 'billing-trade-prd-sa-sync', valid: true, isTruncated: true, isTransformed: false,
  original: 'acmex-billing-trade-prd-kr-sa-sync', violations: [], steps: ['region 생략', 'owner 생략'],
  rule: { minLength: 6, maxLength: 30, pattern: '^[a-z]$', patternFlags: 'u', allowed: 'lower-digit-hyphen', docUrl: 'https://example.invalid/doc' },
};
const labels = { labels: { owner: 'acmex' }, violations: [], transformed: [] };

describe('toWireName (D15)', () => {
  it('snake_case · reason 은 steps 를 「 · 」로 잇는다 · note 없으면 키도 없다', () => {
    expect(toWireName(base)).toEqual({
      name: 'billing-trade-prd-sa-sync', valid: true, is_truncated: true, is_transformed: false,
      original: 'acmex-billing-trade-prd-kr-sa-sync', violations: [], reason: 'region 생략 · owner 생략',
      rule: { min_length: 6, max_length: 30, pattern: '^[a-z]$', pattern_flags: 'u', allowed: 'lower-digit-hyphen', doc_url: 'https://example.invalid/doc' },
    });
  });
  it('note 가 있으면 rule.note 로 · steps 가 비면 reason 은 빈 문자열', () => {
    const w = toWireName({ ...base, steps: [], rule: { ...base.rule, note: '보수적 한도' } });
    expect(w.reason).toBe('');
    expect(w.rule.note).toBe('보수적 한도');
  });
});

describe('toWireGenerate', () => {
  it('data 와 metadata 셋의 provider 집합이 같고 요청 순서를 지킨다', () => {
    const w = toWireGenerate([
      { provider: 'azure', names: { storage_account: base }, labels },
      { provider: 'gcp', names: { service_account: base }, labels: { ...labels, violations: ['owner 값 64자 — 최대 63자'] } },
    ], ['env: production→prd']);
    expect(w.success).toBe(true);
    expect(Object.keys(w.data)).toEqual(['azure', 'gcp']);
    expect(Object.keys(w.metadata.generated_labels)).toEqual(['azure', 'gcp']);
    expect(Object.keys(w.metadata.label_violations)).toEqual(['azure', 'gcp']);
    expect(Object.keys(w.metadata.label_transformed)).toEqual(['azure', 'gcp']);
    expect(w.metadata.label_violations.gcp).toEqual(['owner 값 64자 — 최대 63자']);
    expect(w.metadata.transformed).toEqual(['env: production→prd']);
    expect(w.data.azure?.storage_account.is_truncated).toBe(true);
  });
});

describe('toWireValidate', () => {
  it('suggestedName → suggested_name · 없으면 키도 없다', () => {
    expect(toWireValidate({ valid: false, violations: ['x'], suggestedName: 'y' })).toEqual({ valid: false, violations: ['x'], suggested_name: 'y' });
    expect(toWireValidate({ valid: true, violations: [] })).toEqual({ valid: true, violations: [] });
  });
});
