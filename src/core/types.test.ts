// 켜진 CSP (D45) — 켜진 목록은 PROVIDERS 의 부분집합이고 비어 있지 않으며 순서가 PROVIDERS 와 같다
import { describe, it, expect } from 'vitest';
import { ENABLED_PROVIDERS, PROTECTED, PROVIDERS, TIER_PATTERN } from './types';

describe('ENABLED_PROVIDERS (D45)', () => {
  it('비어 있지 않다', () => expect(ENABLED_PROVIDERS.length).toBeGreaterThan(0));
  it('PROVIDERS 의 부분집합 · 중복 없음 · PROVIDERS 순서', () => {
    for (const p of ENABLED_PROVIDERS) expect(PROVIDERS).toContain(p);
    expect(new Set(ENABLED_PROVIDERS).size).toBe(ENABLED_PROVIDERS.length);
    expect(PROVIDERS.filter((p) => ENABLED_PROVIDERS.includes(p))).toEqual([...ENABLED_PROVIDERS]);
  });
  it('0.1.0 은 GCP 하나 — PROVIDERS 는 셋 그대로', () => {
    expect(ENABLED_PROVIDERS).toEqual(['gcp']);
    expect(PROVIDERS).toEqual(['aws', 'gcp', 'azure']);
  });
});

describe('용도 토큰 tier (D60)', () => {
  it('TIER_PATTERN — 소문자 · 숫자 2~16자', () => {
    for (const ok of ['web', 'was', 'bastion', 'ab', 'a1', 'x'.repeat(16)]) expect(TIER_PATTERN.test(ok), ok).toBe(true);
    for (const bad of ['w', 'x'.repeat(17), 'Web', 'web-app', 'web_1', '']) expect(TIER_PATTERN.test(bad), bad).toBe(false);
  });
  it('PROTECTED 에 tier 가 있다', () => expect(PROTECTED).toContain('tier'));
});
