import { describe, it, expect } from 'vitest';
import { app } from './index';
import { req, jsonPost, json } from './test-support';

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
  it('GET /v1/health → { ok: true }', async () => {
    const { res } = await req(app, '/v1/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
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
    expect(body.data.gcp.service_account).toEqual({
      name: 'billing-trade-prd-sa-sync', valid: true, is_truncated: true, is_transformed: false,
      original: 'acmex-billing-trade-prd-kr-sa-sync', violations: [], reason: 'region 생략 · owner 생략',
      rule: { min_length: 6, max_length: 30, pattern: '^[a-z][a-z0-9-]{4,28}[a-z0-9]$', pattern_flags: '', allowed: 'lower-digit-hyphen', doc_url: 'https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/create' },
    });
    expect(body.data.azure.storage_account).toMatchObject({ name: 'stbillingtradeprd', valid: true, is_transformed: true, reason: '하이픈 제거' });
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
    expect(body.metadata.transformed).toEqual(['env: production→prd', 'region: asia-northeast3→kr']);
    expect(body.data.gcp.service_account.name).toBe('billing-trade-prd-sa-sync');
  });
  it('잘못된 env → 400 { success:false, errors }', async () => {
    const { res } = await post({ context: { ...ctx, env: 'qa' } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, errors: ['env: qa 는 지원하지 않는다 (prd·stg·dev·sbx)'] });
  });
  it('본문이 JSON 이 아니면 400', async () => {
    const { res } = await req(app, '/v1/generate', { method: 'POST', body: 'not json' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, errors: ['본문이 JSON 이 아니다'] });
  });
  it('providers 가 빈 배열 · 배열 아님 · 모르는 값이면 400 + supported', async () => {
    const empty = await post({ context: ctx, providers: [] });
    expect(empty.res.status).toBe(400);
    expect(await empty.res.json()).toEqual({ success: false, errors: ['providers 가 비어 있다'], supported: ['aws', 'gcp', 'azure'] });
    const notArray = await post({ context: ctx, providers: 'gcp' });
    expect(notArray.res.status).toBe(400);
    const unknown = await post({ context: ctx, providers: ['gcp', 'oci'] });
    expect(unknown.res.status).toBe(400);
    expect(await unknown.res.json()).toMatchObject({ errors: ['지원하지 않는 provider: oci'], supported: ['aws', 'gcp', 'azure'] });
  });
  it('context 가 없거나 null 이면 400 (500 이 아니다)', async () => {
    expect((await post({})).res.status).toBe(400);
    expect((await post({ context: null })).res.status).toBe(400);
    expect((await post([])).res.status).toBe(400);
  });
});
