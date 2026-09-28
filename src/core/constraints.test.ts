import { describe, it, expect } from 'vitest';
import { RULES, rulesFor, getRule, LABEL_LIMITS, AWS_TAG_VALUE_DOC_URL, WINDOWS_COMPUTER_NAME_DOC_URL } from './constraints';
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
  it('AWS 태그 값 문자 규칙의 docUrl 은 태그 한도와 같은 쪽의 #tag-conventions 다', () => {
    expect(AWS_TAG_VALUE_DOC_URL).toBe(LABEL_LIMITS.aws.docUrl);
    expect(AWS_TAG_VALUE_DOC_URL).toMatch(/^https:\/\/docs\.aws\.amazon\.com\/.*#tag-conventions$/);
  });
});

describe('공식 문서 대조로 고친 값 (Task 1-2)', () => {
  it('S3 금지 접미사에 -an 이 있다 (계정 지역 네임스페이스 전용)', () => {
    expect(RULES['aws.s3_bucket'].forbidden?.suffixes).toContain('-an');
  });
  it('AKS Linux 노드풀 예약 이름 aksmanagedap 을 막는다', () => {
    expect(RULES['azure.aks_nodepool_linux'].forbidden?.exact).toContain('aksmanagedap');
  });
  it('codex P1: Windows VM 의 숫자만 금지는 Windows ComputerName 문서가 근거이고 note 에 그 URL 이 실린다', () => {
    expect(WINDOWS_COMPUTER_NAME_DOC_URL).toMatch(/^https:\/\/learn\.microsoft\.com\/en-us\/windows-hardware\/.*computername$/);
    expect(RULES['azure.virtual_machine_windows'].note).toContain(WINDOWS_COMPUTER_NAME_DOC_URL);
    expect(RULES['azure.virtual_machine_windows'].pattern.test('12345')).toBe(false);
    expect(RULES['azure.virtual_machine'].note ?? '').not.toContain(WINDOWS_COMPUTER_NAME_DOC_URL);
  });
  it('리소스 그룹 pattern 은 십진 숫자(Nd)만 받는다', () => {
    const p = RULES['azure.resource_group'].pattern;
    expect(p.test('개발-1')).toBe(true);
    expect(p.test('rg-٣')).toBe(true); // U+0663 Nd
    expect(p.test('rg-²')).toBe(false); // U+00B2 No
    expect(p.test('rg-Ⅻ')).toBe(false); // U+216B Nl
  });
});
