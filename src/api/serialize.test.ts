import { describe, it, expect } from 'vitest';
import { toWireGenerate, toWireMessage, toWireName, toWireValidate } from './serialize';
import type { NameResult } from '../core/types';

const version = { engine: '0.1.0', rules: '2026-09-29.1' };
const base: NameResult = {
  ruleId: 'gcp.service_account', resourceType: 'service_account', displayName: 'Service Account',
  name: 'billing-trade-prd-sa-sync', valid: true, isTruncated: true, isTransformed: false,
  original: 'acmex-billing-trade-prd-kr-sa-sync', violations: [],
  steps: [{ code: 'step.token_dropped', field: 'region' }, { code: 'step.token_dropped', field: 'owner' }],
  rule: { minLength: 6, maxLength: 30, pattern: '^[a-z]$', patternFlags: 'u', allowed: 'lower-digit-hyphen', docUrl: 'https://example.invalid/doc', notes: [] },
};
const labels = { labels: { owner: 'acmex' }, violations: [], transformed: [] };

describe('toWireMessage (D25)', () => {
  it('code · field · params · message 순서 — field · params 가 없는 코드는 키도 없다', () => {
    expect(Object.keys(toWireMessage({ code: 'step.normalized', field: 'owner', params: { from: 'A', to: 'a' } }))).toEqual(['code', 'field', 'params', 'message']);
    expect(toWireMessage({ code: 'name.empty' })).toEqual({ code: 'name.empty', message: 'The name is empty' });
    expect(toWireMessage({ code: 'name.too_long', params: { actual: 34, max: 30 } }))
      .toEqual({ code: 'name.too_long', params: { actual: 34, max: 30 }, message: 'Name is 34 characters long; the maximum is 30' });
  });
});

describe('toWireName (D15 · D25)', () => {
  it('snake_case · steps 는 메시지 배열 · notes 는 항상 있다 · reason 은 없다', () => {
    expect(toWireName(base)).toEqual({
      name: 'billing-trade-prd-sa-sync', valid: true, is_truncated: true, is_transformed: false,
      original: 'acmex-billing-trade-prd-kr-sa-sync', violations: [],
      steps: [
        { code: 'step.token_dropped', field: 'region', message: "Dropped optional token 'region'" },
        { code: 'step.token_dropped', field: 'owner', message: "Dropped optional token 'owner'" },
      ],
      rule: { min_length: 6, max_length: 30, pattern: '^[a-z]$', pattern_flags: 'u', allowed: 'lower-digit-hyphen', doc_url: 'https://example.invalid/doc', notes: [] },
    });
  });
  it('notes 가 있으면 rule.notes 에 메시지로', () => {
    const w = toWireName({ ...base, steps: [], rule: { ...base.rule, notes: [{ code: 'note.s3_an_suffix' }] } });
    expect(w.steps).toEqual([]);
    expect(w.rule.notes).toEqual([{ code: 'note.s3_an_suffix', message: 'The -an suffix is reserved for account-regional namespace buckets' }]);
  });
});

describe('toWireGenerate', () => {
  it('version 을 싣고 · data 와 metadata 셋의 provider 집합이 같고 요청 순서를 지킨다', () => {
    const w = toWireGenerate([
      { provider: 'azure', names: { storage_account: base }, labels },
      { provider: 'gcp', names: { service_account: base }, labels: { ...labels, violations: [{ code: 'label.too_long', field: 'owner', params: { actual: 64, max: 63 } }] } },
    ], [{ code: 'context.normalized', field: 'env', params: { from: 'production', to: 'prd' } }], version);
    expect(w.success).toBe(true);
    expect(w.version).toEqual(version);
    expect(Object.keys(w)).toEqual(['success', 'version', 'data', 'metadata']);
    expect(Object.keys(w.data)).toEqual(['azure', 'gcp']);
    expect(Object.keys(w.metadata.generated_labels)).toEqual(['azure', 'gcp']);
    expect(Object.keys(w.metadata.label_violations)).toEqual(['azure', 'gcp']);
    expect(Object.keys(w.metadata.label_transformed)).toEqual(['azure', 'gcp']);
    expect(w.metadata.label_violations.gcp).toEqual([
      { code: 'label.too_long', field: 'owner', params: { actual: 64, max: 63 }, message: "Label 'owner' is 64 characters long; the maximum is 63" },
    ]);
    expect(w.metadata.transformed).toEqual([
      { code: 'context.normalized', field: 'env', params: { from: 'production', to: 'prd' }, message: "env 'production' normalised to 'prd'" },
    ]);
    expect(w.data.azure?.storage_account.is_truncated).toBe(true);
  });
});

describe('toWireValidate', () => {
  it('version · suggestedName → suggested_name · 없으면 키도 없다', () => {
    expect(toWireValidate({ valid: false, violations: [{ code: 'name.empty' }], suggestedName: 'y' }, version))
      .toEqual({ valid: false, version, violations: [{ code: 'name.empty', message: 'The name is empty' }], suggested_name: 'y' });
    expect(toWireValidate({ valid: true, violations: [] }, version)).toEqual({ valid: true, version, violations: [] });
  });
});
