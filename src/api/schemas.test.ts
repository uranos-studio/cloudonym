import { describe, it, expect } from 'vitest';
import { parseEventBody, parseGenerateBody, parseValidateBody } from './schemas';

const ctx = { owner: 'acmex', system: 'billing', purpose: 'trade', env: 'prd', region: 'kr' };

describe('parseGenerateBody', () => {
  it('정상 — providers 는 순서를 지키고 중복은 없앤다', () => {
    const r = parseGenerateBody({ context: ctx, providers: ['azure', 'gcp', 'azure'] });
    expect(r).toEqual({ ok: true, value: { context: ctx, transformed: [], providers: ['azure', 'gcp'] } });
  });
  it('providers 생략 → 셋 다', () => {
    const r = parseGenerateBody({ context: ctx });
    expect(r.ok && r.value.providers).toEqual(['aws', 'gcp', 'azure']);
  });
  it('객체가 아닌 본문 · context 없음 · context null → 400 본문', () => {
    expect(parseGenerateBody('x')).toEqual({ ok: false, body: { success: false, errors: ['본문은 JSON 객체여야 한다'] } });
    expect(parseGenerateBody({})).toEqual({ ok: false, body: { success: false, errors: ['context 는 객체여야 한다'] } });
    expect(parseGenerateBody({ context: null })).toMatchObject({ ok: false });
  });
  it('providers 배열 아님 · 빈 배열 · 모르는 값 → supported 셋', () => {
    const supported = ['aws', 'gcp', 'azure'];
    expect(parseGenerateBody({ context: ctx, providers: 'gcp' })).toEqual({ ok: false, body: { success: false, errors: ['providers 는 배열이어야 한다'], supported } });
    expect(parseGenerateBody({ context: ctx, providers: [] })).toEqual({ ok: false, body: { success: false, errors: ['providers 가 비어 있다'], supported } });
    expect(parseGenerateBody({ context: ctx, providers: ['oci', 1] })).toEqual({ ok: false, body: { success: false, errors: ['지원하지 않는 provider: oci, 1'], supported } });
  });
  it('parseContext 의 오류를 그대로 전달한다 (owner → region 순서)', () => {
    const r = parseGenerateBody({ context: { ...ctx, owner: '', region: 'mars' } });
    expect(r).toEqual({ ok: false, body: { success: false, errors: ['owner: 비어 있다', 'region: mars 는 지원하지 않는다 (kr·us·jp·eu·global)'] } });
  });
});

describe('parseValidateBody', () => {
  it('정상', () => {
    expect(parseValidateBody({ provider: 'gcp', resource_type: 'service_account', name: 'x' }))
      .toEqual({ ok: true, value: { provider: 'gcp', resourceType: 'service_account', name: 'x' } });
  });
  it('모르는 provider · resource_type · 문자열 아닌 name → 400 + supported (Review Focus 5)', () => {
    expect(parseValidateBody({ provider: 'oci', resource_type: 'x', name: 'x' }))
      .toEqual({ ok: false, body: { success: false, errors: ['지원하지 않는 provider: oci'], supported: ['aws', 'gcp', 'azure'] } });
    expect(parseValidateBody({ provider: 'aws', resource_type: 'nope', name: 'x' }))
      .toEqual({ ok: false, body: { success: false, errors: ['지원하지 않는 resource_type: nope'], supported: ['s3_bucket', 'iam_role', 'vpc', 'subnet', 'ec2_instance', 'rds_instance'] } });
    expect(parseValidateBody({ provider: 'aws', resource_type: 's3_bucket', name: 3 }))
      .toEqual({ ok: false, body: { success: false, errors: ['name 은 문자열이어야 한다'] } });
  });
});

describe('parseEventBody', () => {
  it('셋만 받는다 — 그 외 400 + supported', () => {
    for (const e of ['ui_visit', 'ui_generate', 'ui_copy']) expect(parseEventBody({ event: e })).toEqual({ ok: true, value: e });
    expect(parseEventBody({ event: 'api_generate' }))
      .toEqual({ ok: false, body: { success: false, errors: ['지원하지 않는 event: api_generate'], supported: ['ui_visit', 'ui_generate', 'ui_copy'] } });
    expect(parseEventBody(null)).toMatchObject({ ok: false });
  });
});
