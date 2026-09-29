import { describe, it, expect } from 'vitest';
import { app } from './index';
import { req, jsonPost, json } from './test-support';
import { VERSION } from '../version';

const ctx = { owner: 'acmex', system: 'billing', purpose: 'trade', env: 'prd', region: 'kr' };
const post = (body: unknown) => req(app, '/v1/generate', jsonPost(body));

describe('라우팅 재구성 — root 앱 + app.route(/v1, v1)', () => {
  it('/v1/health · POST /v1/generate 가 정확히 그 경로로 있고 /v1/v1 이 없다', () => {
    const paths = app.routes.map((r) => `${r.method} ${r.path}`);
    expect(paths).toContain('GET /v1/health');
    expect(paths).toContain('POST /v1/generate');
    expect(paths.filter((p) => p.includes('/v1/v1'))).toEqual([]);
  });
  it('OPTIONS /v1/generate → 204 + Access-Control-Allow-Origin: *', async () => {
    const { res } = await req(app, '/v1/generate', { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET,POST,OPTIONS');
  });
  it('GET /v1/health → { ok: true, version }', async () => {
    const { res } = await req(app, '/v1/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: VERSION });
  });
  it('GET /v1/generate 는 404 (POST 만)', async () => {
    const { res } = await req(app, '/v1/generate');
    expect(res.status).toBe(404);
  });
});

describe('POST /v1/generate (D15 wire)', () => {
  it('① 예시 입력 → GCP SA 축약 · Azure Storage 변환', async () => {
    const { res } = await post({ context: ctx, providers: ['gcp', 'azure'] });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.success).toBe(true);
    expect(body.version).toEqual(VERSION);
    expect(body.data.gcp.service_account).toEqual({
      name: 'billing-trade-prd-sa-sync', valid: true, is_truncated: true, is_transformed: false,
      original: 'acmex-billing-trade-prd-kr-sa-sync', violations: [],
      steps: [
        { code: 'step.token_dropped', field: 'region', message: "Dropped optional token 'region'" },
        { code: 'step.token_dropped', field: 'owner', message: "Dropped optional token 'owner'" },
      ],
      rule: { min_length: 6, max_length: 30, pattern: '^[a-z][a-z0-9-]{4,28}[a-z0-9]$', pattern_flags: '', allowed: 'lower-digit-hyphen', doc_url: 'https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/create', notes: [] },
    });
    expect(body.data.azure.storage_account).toMatchObject({ name: 'stbillingtradeprd', valid: true, is_transformed: true, steps: [{ code: 'step.separator_removed', message: 'Removed hyphens (this rule allows no separator)' }] });
    expect(body.data.azure.storage_account.rule.notes).toEqual([expect.objectContaining({ code: 'note.azure_reserved', params: { doc_url: expect.stringContaining('learn.microsoft.com') } })]);
    expect(body.metadata.generated_labels.gcp).toEqual({ owner: 'acmex', system: 'billing', purpose: 'trade', environment: 'prd', managed_by: 'cloudonym' });
    expect(body.metadata).toMatchObject({ label_violations: { gcp: [], azure: [] }, label_transformed: { gcp: [], azure: [] }, transformed: [] });
  });
  it('providers:["gcp"] 이면 data · metadata 셋 모두 gcp 키만', async () => {
    const body = await json((await post({ context: ctx, providers: ['gcp'] })).res);
    for (const part of [body.data, body.metadata.generated_labels, body.metadata.label_violations, body.metadata.label_transformed]) {
      expect(Object.keys(part)).toEqual(['gcp']);
    }
    expect(Object.keys(body.data.gcp)).toHaveLength(7);
  });
  it('providers 생략 → 셋 다 · 넷의 provider 집합이 같다', async () => {
    const body = await json((await post({ context: ctx })).res);
    const keys = (o: object) => Object.keys(o).sort();
    expect(keys(body.data)).toEqual(['aws', 'azure', 'gcp']);
    expect(keys(body.metadata.generated_labels)).toEqual(keys(body.data));
    expect(keys(body.metadata.label_violations)).toEqual(keys(body.data));
    expect(keys(body.metadata.label_transformed)).toEqual(keys(body.data));
  });
  it('env · region 별칭은 통과하고 metadata.transformed 에 남는다 (TC-COM-02)', async () => {
    const body = await json((await post({ context: { ...ctx, env: 'production', region: 'asia-northeast3' }, providers: ['gcp'] })).res);
    expect(body.metadata.transformed).toEqual([
      { code: 'context.normalized', field: 'env', params: { from: 'production', to: 'prd' }, message: "env 'production' normalised to 'prd'" },
      { code: 'context.normalized', field: 'region', params: { from: 'asia-northeast3', to: 'kr' }, message: "region 'asia-northeast3' normalised to 'kr'" },
    ]);
    expect(body.data.gcp.service_account.name).toBe('billing-trade-prd-sa-sync');
  });
  it('잘못된 env → 400 { success:false, errors }', async () => {
    const { res } = await post({ context: { ...ctx, env: 'qa' } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, errors: [{ code: 'context.value_unsupported', field: 'env', params: { value: 'qa', supported: ['prd', 'stg', 'dev', 'sbx'] }, message: "env 'qa' is not supported (prd, stg, dev, sbx)" }] });
  });
  it('본문이 JSON 이 아니면 400', async () => {
    const { res } = await req(app, '/v1/generate', { method: 'POST', body: 'not json' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, errors: [{ code: 'request.body_not_json', message: 'Request body is not JSON' }] });
  });
  it('providers 가 빈 배열 · 배열 아님 · 모르는 값이면 400 + supported', async () => {
    const empty = await post({ context: ctx, providers: [] });
    expect(empty.res.status).toBe(400);
    expect(await empty.res.json()).toEqual({ success: false, errors: [{ code: 'request.providers_empty', message: "'providers' is empty" }], supported: ['aws', 'gcp', 'azure'] });
    const notArray = await post({ context: ctx, providers: 'gcp' });
    expect(notArray.res.status).toBe(400);
    const unknown = await post({ context: ctx, providers: ['gcp', 'oci'] });
    expect(unknown.res.status).toBe(400);
    expect(await unknown.res.json()).toEqual({ success: false, errors: [{ code: 'request.value_unsupported', field: 'providers[1]', params: { value: 'oci' }, message: "Unsupported providers[1] 'oci'" }], supported: ['aws', 'gcp', 'azure'] });
  });
  it('context 가 없거나 null 이면 400 (500 이 아니다)', async () => {
    expect((await post({})).res.status).toBe(400);
    expect((await post({ context: null })).res.status).toBe(400);
    expect((await post([])).res.status).toBe(400);
  });
});

describe('rules_version 핀 (D27 ⑴)', () => {
  it('지금 버전이면 200 · 다르면 409 request.rules_version_mismatch', async () => {
    expect((await post({ context: ctx, rules_version: VERSION.rules })).res.status).toBe(200);
    const { res } = await post({ context: ctx, rules_version: '2026-09-15.1' });
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.success).toBe(false);
    expect(body.errors).toEqual([expect.objectContaining({ code: 'request.rules_version_mismatch', params: { requested: '2026-09-15.1', current: VERSION.rules } })]);
    expect(body.errors[0].message).toContain('pinned mode');
    expect(body.errors[0].message).not.toContain('2026-09-15.1'); // 요청 값은 params 에만 (리뷰 S1)
  });
});

describe('없는 경로 · 메서드 — 공통 실패 꼴 404 (리뷰 L1)', () => {
  it.each([['GET', '/v1/generate'], ['GET', '/v1/nope'], ['POST', '/v1/nope'], ['DELETE', '/v1/validate']])('%s %s → 404 JSON request.not_found', async (method, path) => {
    const { res } = await req(app, path, { method });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ success: false, errors: [{ code: 'request.not_found', message: 'No such endpoint or method; see /openapi.json for the API' }] });
  });
});

describe('되돌려 싣는 사용자 값의 보이지 않는 문자 (리뷰 S2)', () => {
  it('value_unsupported 의 params · message 에 \\uXXXX 로 나온다', async () => {
    const rlo = String.fromCodePoint(0x202e);
    const { res } = await post({ context: ctx, providers: [`aws${rlo}x`] });
    const body = await json(res);
    expect(body.errors[0]).toMatchObject({ code: 'request.value_unsupported', params: { value: 'aws\\u202Ex' } });
    expect(JSON.stringify(body)).not.toContain(rlo);
  });
  it('엔진 몫(context.value_unsupported)도 wire 에서 바뀐다', async () => {
    const { res } = await post({ context: { ...ctx, env: `q${String.fromCodePoint(0x2066)}a` } });
    const body = await json(res);
    expect(JSON.stringify(body)).toContain('\\\\u2066');
    expect(JSON.stringify(body)).not.toContain(String.fromCodePoint(0x2066));
  });
});
