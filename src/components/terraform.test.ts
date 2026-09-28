import { describe, it, expect } from 'vitest';
import { hclString, toTerraformLocals } from './terraform';
import { generate } from '../core/engine';
import { labelsFor } from '../core/labels';
import type { GenerateOutput, LabelSet, NameResult, NamingContext } from '../core/types';

const ctx: NamingContext = { owner: 'acmex', system: 'billing', purpose: 'trade', env: 'prd', region: 'kr' };
const stub = (over: Partial<NameResult>): NameResult => ({
  ruleId: 'gcp.service_account', resourceType: 'service_account', displayName: 'Service Account', name: 'x', valid: true,
  isTruncated: false, isTransformed: false, original: 'x', violations: [], steps: [],
  rule: { minLength: 6, maxLength: 30, pattern: '^x$', patternFlags: '', allowed: 'lower-digit-hyphen', docUrl: 'https://example.invalid' },
  ...over,
});
const noLabels: LabelSet = { labels: {}, violations: [], transformed: [] };

describe('toTerraformLocals', () => {
  it('엔진 결과 전체 — locals { 로 시작하고 } 로 끝난다 · 유효한 이름은 provider_type = "…" 한 줄', () => {
    const out = generate(ctx);
    const labels = { aws: labelsFor(ctx, 'aws'), gcp: labelsFor(ctx, 'gcp'), azure: labelsFor(ctx, 'azure') };
    const hcl = toTerraformLocals(out, labels);
    expect(hcl.startsWith('locals {\n')).toBe(true);
    expect(hcl.endsWith('\n}\n')).toBe(true);
    expect(hcl).toContain('  gcp_service_account = "billing-trade-prd-sa-sync"\n');
    expect(hcl).toContain('  azure_storage_account = "stbillingtradeprd"\n');
    expect(hcl).toContain('  aws_tags = {\n');
    expect(hcl).toContain('  gcp_labels = {\n    owner = "acmex"\n');
    expect(hcl).not.toContain('INVALID');
    // provider 순서 = PROVIDERS (aws → gcp → azure)
    expect(hcl.indexOf('# aws')).toBeLessThan(hcl.indexOf('# gcp'));
    expect(hcl.indexOf('# gcp')).toBeLessThan(hcl.indexOf('# azure'));
  });
  it('valid:false 항목은 # INVALID: 주석으로만 나온다 — 값 줄이 없다', () => {
    const out: GenerateOutput = { gcp: { service_account: stub({ name: '', valid: false, violations: ['system 이 정제 뒤 비었다'] }), project_id: stub({ ruleId: 'gcp.project_id', resourceType: 'project_id', name: 'acmex-billing-trade-prd' }) } };
    const hcl = toTerraformLocals(out, { gcp: noLabels });
    expect(hcl).toContain('  # INVALID: gcp_service_account — system 이 정제 뒤 비었다\n');
    expect(hcl).not.toMatch(/^\s*gcp_service_account\s*=/m);
    expect(hcl).toContain('  gcp_project_id = "acmex-billing-trade-prd"\n');
  });
  it('라벨 한도 위반이 있으면 라벨 블록 대신 # INVALID: 주석', () => {
    const bad: LabelSet = { labels: { owner: 'x'.repeat(300) }, violations: ['owner 값 300자 — 최대 256자'], transformed: [] };
    const hcl = toTerraformLocals({ aws: { s3_bucket: stub({ ruleId: 'aws.s3_bucket', resourceType: 's3_bucket', name: 'b' }) } }, { aws: bad });
    expect(hcl).toContain('  # INVALID: aws_tags — owner 값 300자 — 최대 256자\n');
    expect(hcl).not.toContain('aws_tags = {');
  });
  it('요청에 없는 provider 는 나오지 않는다 · 빈 입력이면 locals {\\n}\\n', () => {
    expect(toTerraformLocals({}, {})).toBe('locals {\n}\n');
    const hcl = toTerraformLocals({ azure: { key_vault: stub({ ruleId: 'azure.key_vault', resourceType: 'key_vault', name: 'kv-a' }) } }, {});
    expect(hcl).not.toContain('aws');
    expect(hcl).not.toContain('gcp');
    expect(hcl).toContain('  azure_key_vault = "kv-a"\n');
  });
  it('라벨 값의 따옴표 · 역슬래시 · 보간은 이스케이프된다 (사용자 입력이 HCL 로 새지 않는다)', () => {
    const tricky: LabelSet = { labels: { owner: 'a"b\\c ${x} %{y}' }, violations: [], transformed: [] };
    const hcl = toTerraformLocals({ aws: {} }, { aws: tricky });
    expect(hcl).toContain('    owner = "a\\"b\\\\c $${x} %%{y}"\n');
  });
});

describe('hclString', () => {
  it.each([
    ['plain', '"plain"'],
    ['say "hi"', '"say \\"hi\\""'],
    ['back\\slash', '"back\\\\slash"'],
    ['line\nbreak', '"line\\nbreak"'],
    ['${interp}', '"$${interp}"'],
    ['%{directive}', '"%%{directive}"'],
  ])('%j → %s', (input, expected) => {
    expect(hclString(input)).toBe(expected);
  });
});
