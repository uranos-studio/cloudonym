import { describe, it, expect } from 'vitest';
import { parseEventBody, parseGenerateBody, parseValidateBody } from './schemas';
import { RULES_REVISION } from '../core/revision';

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
    expect(parseGenerateBody('x')).toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.body_not_object' }] } });
    expect(parseGenerateBody({})).toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.context_not_object' }] } });
    expect(parseGenerateBody({ context: null })).toMatchObject({ ok: false });
  });
  it('providers 배열 아님 · 빈 배열 · 모르는 값 → supported 셋', () => {
    const supported = ['aws', 'gcp', 'azure'];
    expect(parseGenerateBody({ context: ctx, providers: 'gcp' })).toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.providers_not_array' }], supported } });
    expect(parseGenerateBody({ context: ctx, providers: [] })).toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.providers_empty' }], supported } });
    expect(parseGenerateBody({ context: ctx, providers: ['oci', 1] })).toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.value_unsupported', field: 'providers[0]', params: { value: 'oci' } }, { code: 'request.value_unsupported', field: 'providers[1]', params: { value: '1' } }], supported } });
  });
  it('parseContext 의 오류를 그대로 전달한다 (owner → region 순서)', () => {
    const r = parseGenerateBody({ context: { ...ctx, owner: '', region: 'mars' } });
    expect(r).toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'context.empty', field: 'owner' }, { code: 'context.value_unsupported', field: 'region', params: { value: 'mars', supported: ['kr', 'us', 'jp', 'eu', 'global'] } }] } });
  });
});

describe('parseValidateBody', () => {
  it('정상', () => {
    expect(parseValidateBody({ provider: 'gcp', resource_type: 'service_account', name: 'x' }))
      .toEqual({ ok: true, value: { provider: 'gcp', resourceType: 'service_account', name: 'x' } });
  });
  it('모르는 provider · resource_type · 문자열 아닌 name → 400 + supported (Review Focus 5)', () => {
    expect(parseValidateBody({ provider: 'oci', resource_type: 'x', name: 'x' }))
      .toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.value_unsupported', field: 'provider', params: { value: 'oci' } }], supported: ['aws', 'gcp', 'azure'] } });
    expect(parseValidateBody({ provider: 'aws', resource_type: 'nope', name: 'x' }))
      .toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.value_unsupported', field: 'resource_type', params: { value: 'nope' } }], supported: ['s3_bucket', 'iam_role', 'vpc', 'subnet', 'ec2_instance', 'rds_instance'] } });
    expect(parseValidateBody({ provider: 'aws', resource_type: 's3_bucket', name: 3 }))
      .toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.field_not_string', field: 'name' }] } });
  });
});

describe('parseEventBody', () => {
  it('셋만 받는다 — 그 외 400 + supported', () => {
    for (const e of ['ui_visit', 'ui_generate', 'ui_copy']) expect(parseEventBody({ event: e })).toEqual({ ok: true, value: e });
    expect(parseEventBody({ event: 'api_generate' }))
      .toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.value_unsupported', field: 'event', params: { value: 'api_generate' } }], supported: ['ui_visit', 'ui_generate', 'ui_copy'] } });
    expect(parseEventBody(null)).toMatchObject({ ok: false });
  });
});

describe('toString 이 호출 불가능한 객체 — 500 이 아니라 400 (최종 리뷰 I-2)', () => {
  const evil = { toString: 1 };
  it('provider · resource_type 자리 → ok:false', () => {
    const p = parseValidateBody({ provider: evil, resource_type: 'x', name: 'y' });
    expect(p).toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.value_unsupported', field: 'provider', params: { value: '{"toString":1}' } }], supported: ['aws', 'gcp', 'azure'] } });
    const r = parseValidateBody({ provider: 'aws', resource_type: evil, name: 'y' });
    expect(r).toMatchObject({ ok: false, rejection: { status: 400, errors: [{ code: 'request.value_unsupported', field: 'resource_type', params: { value: '{"toString":1}' } }] } });
  });
  it('providers 원소 자리 → ok:false', () => {
    expect(parseGenerateBody({ context: ctx, providers: ['gcp', evil] }))
      .toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.value_unsupported', field: 'providers[1]', params: { value: '{"toString":1}' } }], supported: ['aws', 'gcp', 'azure'] } });
  });
  it('event 자리 → ok:false', () => {
    expect(parseEventBody({ event: evil }))
      .toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.value_unsupported', field: 'event', params: { value: '{"toString":1}' } }], supported: ['ui_visit', 'ui_generate', 'ui_copy'] } });
  });
  it('오류 params 에 넣는 값은 80자까지 — 긴 배열 원소를 되돌려 주지 않는다', () => {
    const r = parseGenerateBody({ context: ctx, providers: ['x'.repeat(500)] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection.errors[0]).toEqual({ code: 'request.value_unsupported', field: 'providers[0]', params: { value: `${'x'.repeat(80)}…` } });
  });
});

describe('rules_version (D27 ⑴)', () => {
  const current = RULES_REVISION;
  it('없거나 undefined 면 통과 · 지금 버전과 같으면 통과', () => {
    expect(parseGenerateBody({ context: ctx }).ok).toBe(true);
    expect(parseGenerateBody({ context: ctx, rules_version: current }).ok).toBe(true);
    expect(parseValidateBody({ provider: 'gcp', resource_type: 'service_account', name: 'x', rules_version: current }).ok).toBe(true);
  });
  it('다르면 409 · 빈 문자열도 다르므로 409', () => {
    for (const v of ['2026-09-15.1', '']) {
      expect(parseGenerateBody({ context: ctx, rules_version: v }))
        .toEqual({ ok: false, rejection: { status: 409, errors: [{ code: 'request.rules_version_mismatch', params: { requested: v, current } }] } });
    }
    expect(parseValidateBody({ provider: 'gcp', resource_type: 'service_account', name: 'x', rules_version: 'old' })).toMatchObject({ ok: false, rejection: { status: 409 } });
  });
  it('requested 는 다른 사용자 값처럼 80자로 자르고 보이지 않는 문자를 바꾼다 (리뷰 S1 · S2)', () => {
    const r = parseGenerateBody({ context: ctx, rules_version: 'y'.repeat(1024) });
    expect(r).toEqual({ ok: false, rejection: { status: 409, errors: [{ code: 'request.rules_version_mismatch', params: { requested: `${'y'.repeat(80)}…`, current } }] } });
    const rlo = String.fromCodePoint(0x202e);
    expect(parseGenerateBody({ context: ctx, rules_version: `a${rlo}b` })).toMatchObject({ rejection: { errors: [{ params: { requested: 'a\\u202Eb' } }] } });
  });
  it('문자열이 아니면(null · 숫자 · 객체) 400 · 1024자 넘으면 400', () => {
    for (const v of [null, 1, { a: 1 }]) {
      expect(parseGenerateBody({ context: ctx, rules_version: v }))
        .toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.field_not_string', field: 'rules_version' }] } });
    }
    expect(parseGenerateBody({ context: ctx, rules_version: 'x'.repeat(1025) }))
      .toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.field_too_long', field: 'rules_version', params: { max: 1024 } }] } });
  });
});
