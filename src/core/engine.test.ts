import { describe, it, expect } from 'vitest';
import { generate, validateName, parseContext } from './engine';
import { rulesFor } from './constraints';
const ctx = { owner: 'acmex', system: 'billing', purpose: 'trade', env: 'prd', region: 'kr' } as const;

describe('generate', () => {
  it('① 응답 예시: GCP SA 는 축약, Azure Storage 는 변환(하이픈 제거)', () => {
    const out = generate(ctx, ['gcp', 'azure']);
    expect(out.gcp?.service_account).toMatchObject({ name: 'billing-trade-prd-sa-sync', valid: true, isTruncated: true, original: 'acmex-billing-trade-prd-kr-sa-sync' });
    expect(out.azure?.storage_account).toMatchObject({ name: 'stbillingtradeprd', valid: true, isTransformed: true });
    expect(out.azure?.storage_account.steps).toContain('하이픈 제거');
    expect(out.aws).toBeUndefined();
  });
  it('providers 를 안 주면 셋 다', () => expect(Object.keys(generate(ctx)).sort()).toEqual(['aws', 'azure', 'gcp']));
  it('TC-AZ-01 하이픈 든 system 도 Storage Account 에서는 지워진다', () => {
    const out = generate({ ...ctx, system: 'billing-trade' }, ['azure']);
    expect(out.azure?.storage_account).toMatchObject({ name: 'stbillingtradetradeprd', isTransformed: true });
  });
  it('정제 뒤 빈 필수 토큰은 valid:false 이고 이름을 만들지 않는다 (Review Focus 1)', () => {
    const out = generate({ ...ctx, system: '매매' }, ['azure']);
    expect(out.azure?.storage_account).toMatchObject({ valid: false, name: '', violations: ['system 이 정제 뒤 비었다'] });
  });
  it('정제로는 못 고치는 위반(숫자 시작)은 valid:false + 이유 (Review Focus 2)', () => {
    const vm = generate({ ...ctx, system: '3tier' }, ['gcp']).gcp!.compute_instance;
    expect(vm).toMatchObject({ valid: false, name: '3tier-trade-prd-kr-vm-01', violations: ['첫 글자는 영문이어야 한다'] });
  });
  it('긴 owner 는 optional 생략으로 들어간다', () => {
    const p = generate({ ...ctx, owner: 'a'.repeat(40) }, ['gcp']).gcp!.project_id;   // owner 생략 → billing-trade-prd
    expect(p).toMatchObject({ valid: true, isTruncated: true, steps: ['owner 생략'] });
  });
  it('축소가 실패하면 valid:false + 이유', () => {
    const w = generate({ ...ctx, system: 'a-long', purpose: 'longpurpose' }, ['azure']).azure!.virtual_machine_windows;
    expect(w).toMatchObject({ valid: false, violations: ['축소로도 15자 안에 들어가지 않는다'] });
  });
  it('rule 메타데이터에 물리 규칙과 생성 규칙이 둘 다 있다 (D14)', () => {
    const s3 = generate(ctx, ['aws']).aws!.s3_bucket;
    expect(s3.rule).toMatchObject({ maxLength: 63, allowed: 'lower-digit-hyphen', pattern: '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$' });
  });
  // 원장 판정 M1 (Task 1-5 이월) — GCP 에서 owner 가 든 규칙은 전부 owner 가 optional 이다
  it('한글 owner 는 정제 뒤 비어도 optional 이라 GCP 규칙 전부 유효', () => {
    const out = generate({ ...ctx, owner: '홍길동' }, ['gcp']).gcp!;
    for (const r of rulesFor('gcp')) expect(out[r.resourceType], r.id).toMatchObject({ valid: true, violations: [] });
    expect(out.project_id).toMatchObject({ name: 'billing-trade-prd', isTransformed: true });
    expect(out.project_id.steps).toContain('owner: 홍길동→');
  });
  it('한 글자 system 은 축소 대상이 아니다 — GCP compute_instance 유효', () => {
    expect(generate({ ...ctx, system: 'a' }, ['gcp']).gcp!.compute_instance).toMatchObject({ name: 'a-trade-prd-kr-vm-01', valid: true });
  });
});

describe('parseContext', () => {
  it('빈 purpose 는 막는다', () => {
    expect(parseContext({ ...ctx, purpose: ' ' })).toMatchObject({ ok: false, errors: ['purpose: 비어 있다'] });
  });
  it('TC-COM-02 env 별칭은 변환 기록과 함께 통과', () => {
    expect(parseContext({ ...ctx, env: 'production' })).toMatchObject({ ok: true, context: { env: 'prd' }, transformed: ['env: production→prd'] });
  });
  it('모르는 env · 문자열 아닌 값', () => {
    expect(parseContext({ ...ctx, env: 'qa' })).toMatchObject({ ok: false, errors: ['env: qa 는 지원하지 않는다 (prd·stg·dev·sbx)'] });
    expect(parseContext({ ...ctx, owner: 3 })).toMatchObject({ ok: false });
  });
  it('모르는 region 문구와 필드 순서 (원장 판정 n8)', () => {
    expect(parseContext({ ...ctx, region: 'mars', owner: '' })).toEqual({ ok: false, errors: ['owner: 비어 있다', 'region: mars 는 지원하지 않는다 (kr·us·jp·eu·global)'] });
  });
});

describe('validateName', () => {
  it('이유와 제안을 준다 (앞 토큰부터 뗀다)', () => {
    expect(validateName('gcp', 'service_account', 'acmex-billing-trade-prd-kr-sa-sync')).toEqual({ valid: false, violations: ['길이 34자 — 최대 30자'], suggestedName: 'billing-trade-prd-kr-sa-sync' });
  });
  it('정제만으로 되면 그 값을 제안', () => {
    expect(validateName('azure', 'storage_account', 'st-web-prod')).toMatchObject({ valid: false, suggestedName: 'stwebprod' });
  });
  it('구분자 없는 규칙의 길이 초과는 제안하지 않는다', () => {
    expect(validateName('azure', 'storage_account', 'st' + 'a'.repeat(23)).suggestedName).toBeUndefined();
  });
  it('모르는 resource_type 은 violations 하나로 알린다 (Review Focus 5)', () => {
    expect(validateName('gcp', 'nope', 'x').violations[0]).toMatch(/^지원하는 유형: /);
  });
  it('유효한 이름은 제안 없이 valid:true', () => {
    expect(validateName('gcp', 'service_account', 'billing-trade-prd-sa-sync')).toEqual({ valid: true, violations: [] });
  });
  it('⑵ 는 정제한 값을 쪼갠다 (원장 판정 n7)', () => {
    // 대문자 · 밑줄이 섞인 긴 이름 — 정제 뒤 값에서 앞 토큰을 뗀다
    expect(validateName('gcp', 'service_account', 'AcMex-Billing-trade-prd-kr-sa_sync').suggestedName).toBe('billing-trade-prd-kr-sasync');
  });
});

describe('1단계 최종 리뷰 고침', () => {
  it('I-1: rule.patternFlags 를 함께 내보내 wire 쪽에서 같은 정규식을 다시 만들 수 있다', () => {
    const rg = generate(ctx, ['azure']).azure?.resource_group;
    expect(rg?.rule.patternFlags).toBe('u');
    const re = new RegExp(rg!.rule.pattern, rg!.rule.patternFlags);
    expect(re.test('개발-1')).toBe(true);
    expect(re.test(rg!.name)).toBe(true);
  });
  it('m-3: GCS 버킷은 연속 점(빈 구성요소)을 거부한다 · S3 도 거부한다', () => {
    expect(validateName('gcp', 'storage_bucket', 'a..b').valid).toBe(false);
    expect(validateName('gcp', 'storage_bucket', 'a.b').valid).toBe(true);
    expect(validateName('aws', 's3_bucket', 'a..b').valid).toBe(false);
  });
  it('m-2: 리소스 그룹은 보조 평면 글자(U+10000 이상)를 거부하고 BMP 글자는 받는다', () => {
    expect(validateName('azure', 'resource_group', 'rg-𝔸').valid).toBe(false);
    expect(validateName('azure', 'resource_group', '𝔸').valid).toBe(false);
    expect(validateName('azure', 'resource_group', '개발').valid).toBe(true);
    expect(validateName('azure', 'resource_group', 'rg-개발-1').valid).toBe(true);
  });
  it('m-1: Azure VM(Linux · Windows)은 이름 어디에서도 점을 거부한다 — 문서 모순이라 보수적으로', () => {
    for (const t of ['virtual_machine', 'virtual_machine_windows']) {
      expect(validateName('azure', t, 'a.b').valid, `${t} a.b`).toBe(false);
      expect(validateName('azure', t, 'vm-web-01').valid, `${t} vm-web-01`).toBe(true);
    }
  });
  it('codex P1: Windows VM 은 숫자로만 된 이름(12345)을 거부한다 — Linux VM 은 문서 근거가 없어 그대로 받는다', () => {
    expect(validateName('azure', 'virtual_machine_windows', '12345').valid).toBe(false);
    expect(validateName('azure', 'virtual_machine_windows', '1').valid).toBe(false);
    expect(validateName('azure', 'virtual_machine_windows', '123456789012345').valid).toBe(false);
    expect(validateName('azure', 'virtual_machine_windows', '1234a').valid).toBe(true);
    expect(validateName('azure', 'virtual_machine_windows', '12-34').valid).toBe(true);
    expect(validateName('azure', 'virtual_machine', '12345').valid).toBe(true);
  });
  it('codex P1: 숫자만 넣어도 generate 의 Windows VM 이름은 숫자만으로 되지 않는다 (slug vm 이 늘 든다)', () => {
    const w = generate({ owner: '1', system: '12', purpose: '34', env: 'prd', region: 'kr' }, ['azure']).azure!.virtual_machine_windows;
    expect(w.valid).toBe(true);
    expect(w.name).not.toMatch(/^\d+$/);
    expect(validateName('azure', 'virtual_machine_windows', w.name).valid).toBe(true);
  });
});
