import { describe, it, expect } from 'vitest';
import { RULES, rulesFor, getRule, LABEL_LIMITS } from './constraints';
import { PROVIDERS } from './types';

describe('RULES 표 무결성', () => {
  it('모든 규칙에 docUrl(https) · 길이 순서 · id 형식이 있다', () => {
    for (const r of Object.values(RULES)) {
      expect(r.docUrl).toMatch(/^https:\/\//);
      expect(r.minLength).toBeGreaterThan(0);
      expect(r.maxLength).toBeGreaterThanOrEqual(r.minLength);
      expect(r.id).toBe(`${r.provider}.${r.resourceType}`);
      expect(r.template.length).toBeGreaterThan(0);
    }
  });
  it('optional 은 template 에 있는 토큰만, slug 가 있으면 template 에 slug 가 있다', () => {
    for (const r of Object.values(RULES)) {
      for (const t of r.optional) expect(r.template).toContain(t);
      if (r.slug) expect(r.template).toContain('slug');
      else expect(r.template).not.toContain('slug');
    }
  });
  it('구분자 없는 규칙의 allowed 는 lower-digit 다', () => {
    for (const r of Object.values(RULES)) if (r.separator === '') expect(r.allowed).toBe('lower-digit');
  });
  it('rulesFor 는 그 provider 의 규칙만, 각 CSP 6개 이상', () => {
    for (const p of PROVIDERS) {
      const rs = rulesFor(p);
      expect(rs.length).toBeGreaterThanOrEqual(6);
      for (const r of rs) expect(r.provider).toBe(p);
    }
  });
  it('세 CSP 모두 VM · VPC · Subnet · DB · 저장소 · 자격 여섯 부류를 덮는다 (D18)', () => {
    const want: Record<string, string[]> = {
      gcp: ['compute_instance', 'vpc_network', 'subnet', 'cloud_sql_instance', 'storage_bucket', 'service_account'],
      aws: ['ec2_instance', 'vpc', 'subnet', 'rds_instance', 's3_bucket', 'iam_role'],
      azure: ['virtual_machine', 'virtual_network', 'subnet', 'sql_server', 'storage_account', 'managed_identity'],
    };
    for (const p of PROVIDERS) for (const t of want[p]) expect(getRule(p, t), `${p}.${t}`).toBeDefined();
  });
  it('getRule 은 모르는 유형에 undefined', () => {
    expect(getRule('gcp', 'service_account')?.maxLength).toBe(30);
    expect(getRule('gcp', 'nope')).toBeUndefined();
    expect(getRule('gcp', 'constructor')).toBeUndefined();
  });
});

describe('LABEL_LIMITS', () => {
  it('세 CSP 모두 키 · 값 한도가 양수이고 docUrl 이 https 다', () => {
    for (const p of PROVIDERS) {
      const l = LABEL_LIMITS[p];
      expect(l.key).toBeGreaterThan(0);
      expect(l.value).toBeGreaterThan(0);
      expect(l.docUrl).toMatch(/^https:\/\//);
    }
  });
});
