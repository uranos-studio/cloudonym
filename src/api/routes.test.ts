import { describe, it, expect } from 'vitest';
import { app } from './index';
import { req, jsonPost, json, fakeKv, fakeLimiter } from './test-support';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENABLED_PROVIDERS } from '../core/types';
import { GCP_CATALOG, GCP_CATALOG_META } from '../core/rules/gcp-catalog';
import { REGIONS } from '../core/regions-data';
import { buildCatalogJson } from './catalog';
import { afterEach, vi } from 'vitest';
import { VERSION } from '../version';
import { rulesFor } from '../core/constraints';

const ctx = { owner: 'infra', system: 'billing', purpose: 'trade', env: 'prod', region: 'asia-northeast3-a' };
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
  it('① 예시 입력 → GCP SA 축약', async () => {
    const { res } = await post({ context: ctx, providers: ['gcp'] });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.success).toBe(true);
    expect(body.version).toEqual(VERSION);
    expect(body.data.gcp.service_account).toEqual({
      name: 'billing-trade-prod-sa-sync', valid: true, is_truncated: true, is_transformed: false,
      original: 'infra-billing-trade-prod-ane3-sa-sync', violations: [],
      steps: [
        { code: 'step.token_dropped', field: 'region', message: "Dropped optional token 'region'" },
        { code: 'step.token_dropped', field: 'owner', message: "Dropped optional token 'owner'" },
      ],
      rule: { min_length: 6, max_length: 30, pattern: '^[a-z][a-z0-9-]{4,28}[a-z0-9]$', pattern_flags: '', allowed: 'lower-digit-hyphen', doc_url: 'https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/create', notes: [] },
    });
    expect(body.metadata.generated_labels.gcp).toEqual({ owner: 'infra', system: 'billing', purpose: 'trade', environment: 'prod', managed_by: 'cloudonym' });
    // 존 이름은 이름에 들어가는 존 코드로 바뀌고 그 기록이 남는다 (D49)
    expect(body.metadata).toMatchObject({ label_violations: { gcp: [] }, label_transformed: { gcp: [] }, transformed: [
      { code: 'context.normalized', field: 'region', params: { from: 'asia-northeast3-a', to: 'ane3a' } },
    ] });
  });
  it('providers:["gcp"] 이면 data · metadata 셋 모두 gcp 키만', async () => {
    const body = await json((await post({ context: ctx, providers: ['gcp'] })).res);
    for (const part of [body.data, body.metadata.generated_labels, body.metadata.label_violations, body.metadata.label_transformed]) {
      expect(Object.keys(part)).toEqual(['gcp']);
    }
    expect(Object.keys(body.data.gcp)).toHaveLength(rulesFor('gcp').length);
  });
  it('providers 생략 → 켜진 것만(gcp) · 넷의 provider 집합이 같다 (D45)', async () => {
    const body = await json((await post({ context: ctx })).res);
    const keys = (o: object) => Object.keys(o).sort();
    expect(keys(body.data)).toEqual(['gcp']);
    expect(keys(body.metadata.generated_labels)).toEqual(keys(body.data));
    expect(keys(body.metadata.label_violations)).toEqual(keys(body.data));
    expect(keys(body.metadata.label_transformed)).toEqual(keys(body.data));
  });
  it('env · region 별칭은 통과하고 metadata.transformed 에 남는다 (TC-COM-02)', async () => {
    const body = await json((await post({ context: { ...ctx, env: 'production', region: 'asia-northeast3' }, providers: ['gcp'] })).res);
    expect(body.metadata.transformed).toEqual([
      { code: 'context.normalized', field: 'env', params: { from: 'production', to: 'prod' }, message: "env 'production' normalised to 'prod'" },
      { code: 'context.normalized', field: 'region', params: { from: 'asia-northeast3', to: 'ane3' }, message: "region 'asia-northeast3' normalised to 'ane3'" },
    ]);
    expect(body.data.gcp.service_account.name).toBe('billing-trade-prod-sa-sync');
  });
  it('잘못된 env → 400 { success:false, errors }', async () => {
    const { res } = await post({ context: { ...ctx, env: 'qa' } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, errors: [{ code: 'context.value_unsupported', field: 'env', params: { value: 'qa', supported: ['prod', 'stg', 'dev', 'sbx'] }, message: "env 'qa' is not supported (prod, stg, dev, sbx)" }] });
  });
  it('본문이 JSON 이 아니면 400', async () => {
    const { res } = await req(app, '/v1/generate', { method: 'POST', body: 'not json' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, errors: [{ code: 'request.body_not_json', message: 'Request body is not JSON' }] });
  });
  it('아는데 꺼진 provider → 400 request.provider_not_enabled · supported 는 켜진 것 (D45)', async () => {
    const { res } = await post({ context: ctx, providers: ['aws'] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, errors: [{ code: 'request.provider_not_enabled', field: 'providers[0]', params: { provider: 'aws' }, message: "Provider 'aws' is not available yet; 'supported' lists the providers you can use" }], supported: ['gcp'] });
  });
  it('providers 가 빈 배열 · 배열 아님 · 모르는 값이면 400 + supported', async () => {
    const empty = await post({ context: ctx, providers: [] });
    expect(empty.res.status).toBe(400);
    expect(await empty.res.json()).toEqual({ success: false, errors: [{ code: 'request.providers_empty', message: "'providers' is empty" }], supported: ['gcp'] });
    const notArray = await post({ context: ctx, providers: 'gcp' });
    expect(notArray.res.status).toBe(400);
    const unknown = await post({ context: ctx, providers: ['gcp', 'oci'] });
    expect(unknown.res.status).toBe(400);
    expect(await unknown.res.json()).toEqual({ success: false, errors: [{ code: 'request.value_unsupported', field: 'providers[1]', params: { value: 'oci' }, message: "Unsupported providers[1] 'oci'" }], supported: ['gcp'] });
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
    expect(body.errors[0].message).not.toContain('2026-09-15.1'); // 요청 값은 params 에만
  });
});

describe('없는 경로 · 메서드 — 공통 실패 꼴 404', () => {
  it.each([['GET', '/v1/generate'], ['GET', '/v1/nope'], ['POST', '/v1/nope'], ['DELETE', '/v1/validate']])('%s %s → 404 JSON request.not_found', async (method, path) => {
    const { res } = await req(app, path, { method });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ success: false, errors: [{ code: 'request.not_found', message: 'No such endpoint or method; see /openapi.json for the API' }] });
  });
});

describe('되돌려 싣는 사용자 값의 보이지 않는 문자', () => {
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

describe('POST /v1/names (D39)', () => {
  const base = { owner: 'platform', system: 'billing', purpose: 'trade', env: 'prod', region: 'asia-northeast3-a' };
  const names = (body: unknown, env = {}) => req(app, '/v1/names', jsonPost(body), env);
  afterEach(() => { vi.unstubAllGlobals(); });

  it('200 — 키 전부 · 선택 순서 → 순번 순서 · scope · uniqueness · data · metadata 는 provider 하나', async () => {
    const { res } = await names({ provider: 'gcp', context: base, resources: [{ type: 'compute_instance', count: 2 }, { type: 'storage_bucket' }, { type: 'service_account', role: 'db' }, { type: 'project_id' }] });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(Object.keys(body)).toEqual(['success', 'version', 'data', 'metadata']);
    expect(body.version).toEqual(VERSION);
    for (const part of [body.data, body.metadata.generated_labels, body.metadata.label_violations, body.metadata.label_transformed]) expect(Object.keys(part)).toEqual(['gcp']);
    const az = body.data.gcp;
    expect(Object.keys(az)).toEqual(['valid', 'items', 'conflicts']);
    expect(az.valid).toBe(true);
    expect(az.conflicts).toEqual([]);
    expect(az.items.map((i: { key: string; name: string }) => `${i.key}=${i.name}`)).toEqual([
      'compute_instance_01=billing-trade-prod-ane3a-gce-01', 'compute_instance_02=billing-trade-prod-ane3a-gce-02',
      'storage_bucket=platform-billing-trade-prod-gcs', 'service_account_db=billing-trade-prod-sa-db', 'project_id=platform-billing-trade-prod',
    ]);
    expect(Object.keys(az.items[0])).toEqual(['key', 'resource_type', 'seq', 'scope', 'uniqueness', 'name', 'valid', 'is_truncated', 'is_transformed', 'original', 'violations', 'steps', 'rule']);
    expect(az.items[0]).toMatchObject({ resource_type: 'compute_instance', seq: '01', scope: 'gcp:project', uniqueness: 'csp' });
    expect(az.items[2]).toMatchObject({ scope: 'gcp:namespace' });
    expect(az.items[2].seq).toBeUndefined();
    expect(az.items[3]).toMatchObject({ role: 'db', scope: 'gcp:project' });
    expect(az.items[4]).toMatchObject({ scope: 'gcp:namespace' });
    expect(body.metadata.generated_labels.gcp).toEqual({ owner: 'platform', system: 'billing', purpose: 'trade', environment: 'prod', managed_by: 'cloudonym' });
  });
  it('항목 하나가 FAIL 이면 200 · valid:false · 항목 전부와 이유', async () => {
    const { res } = await names({ provider: 'gcp', context: { ...base, owner: 'goog' }, resources: [{ type: 'storage_bucket' }, { type: 'compute_instance', count: 2 }] });
    expect(res.status).toBe(200);
    const az = (await json(res)).data.gcp;
    expect(az.valid).toBe(false);
    expect(az.items).toHaveLength(3);
    expect(az.items[0]).toMatchObject({ valid: false, violations: [expect.objectContaining({ code: 'name.forbidden_prefix' })] });
    expect(az.items[2].valid).toBe(true);
  });
  it('GCP 규칙은 전부 uniqueness "csp" — "none"(AWS Name 태그)은 꺼진 CSP 에만 있다 (D45)', async () => {
    const body = await json((await names({ provider: 'gcp', context: base, resources: [{ type: 'compute_instance' }, { type: 'storage_bucket' }] })).res);
    expect(body.data.gcp.items[0]).toMatchObject({ key: 'compute_instance_01', scope: 'gcp:project', uniqueness: 'csp' });
    expect(body.data.gcp.items[1]).toMatchObject({ key: 'storage_bucket', scope: 'gcp:namespace', uniqueness: 'csp' });
    expect(rulesFor('gcp').filter((r) => r.uniqueness === 'none')).toEqual([]);
  });
  it('실제 규칙 표의 VM + 디스크는 이름이 달라 충돌 0 — 충돌 검사가 공허하게 통과하는 것이 아님을 보이는 대조 (fixture 쪽은 names-conflict.test)', async () => {
    const g = (await json((await names({ provider: 'gcp', context: base, resources: [{ type: 'compute_instance' }, { type: 'disk' }] })).res)).data.gcp;
    expect(g.items.map((i: { name: string }) => i.name)).toEqual(['billing-trade-prod-ane3a-gce-01', 'billing-trade-prod-ane3a-disk-01']);
    expect(g.conflicts).toEqual([]);
  });
  it('storage_bucket 에 count 2 → 400 selection.count_not_supported', async () => {
    const { res } = await names({ provider: 'gcp', context: base, resources: [{ type: 'compute_instance', count: 2 }, { type: 'storage_bucket', count: 2 }] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, errors: [{ code: 'selection.count_not_supported', params: { index: 1, type: 'storage_bucket' }, message: "resources[1]: 'storage_bucket' has no sequence number, so count must be 1" }] });
  });
  it('아는데 꺼진 provider → 400 request.provider_not_enabled · supported 는 켜진 것 (D45)', async () => {
    const { res } = await names({ provider: 'azure', context: base, resources: [{ type: 'virtual_machine' }] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, errors: [{ code: 'request.provider_not_enabled', field: 'provider', params: { provider: 'azure' } }], supported: ['gcp'] });
  });
  it('모르는 provider → 400 + supported · rules_version 다르면 409', async () => {
    const bad = await names({ provider: 'oci', context: base, resources: [{ type: 'x' }] });
    expect(bad.res.status).toBe(400);
    expect(await bad.res.json()).toMatchObject({ success: false, errors: [{ code: 'request.value_unsupported', field: 'provider' }], supported: ['gcp'] });
    const pin = await names({ provider: 'gcp', context: base, resources: [{ type: 'project_id' }], rules_version: '2026-01-01.1' });
    expect(pin.res.status).toBe(409);
  });
  it('되돌려 싣는 type 은 80자로 자르고 보이지 않는 문자를 \\uXXXX 로 — params · message 둘 다', async () => {
    const rlo = String.fromCodePoint(0x202e);
    const body = await json((await names({ provider: 'gcp', context: base, resources: [{ type: `${'x'.repeat(100)}${rlo}` }, { type: `a${rlo}b` }] })).res);
    expect(body.errors[0].params.value).toBe(`${'x'.repeat(80)}…`);
    expect(body.errors[1].params.value).toBe('a\\u202Eb');
    expect(JSON.stringify(body)).not.toContain(rlo);
  });
  it('텔레메트리 api_names — { provider, resource_count, name_count, valid } · 문맥값은 싣지 않는다', async () => {
    const sent: string[] = [];
    vi.stubGlobal('fetch', (_url: string, init: { body: string }) => { sent.push(init.body); return Promise.resolve(new Response('{"ingested":1,"failed":0}')); });
    const { promises } = await names({ provider: 'gcp', context: base, resources: [{ type: 'compute_instance', count: 3 }, { type: 'project_id' }] }, { AXIOM_API_KEY: 'k', AXIOM_DATASET: 'ds' });
    await Promise.all(promises);
    expect(sent).toHaveLength(1);
    const [row] = JSON.parse(sent[0]!) as Record<string, unknown>[];
    expect(row).toMatchObject({ event: 'api_names', provider: 'gcp', resource_count: 2, name_count: 4, valid: true });
    expect(sent[0]).not.toContain('billing');
  });
});

describe('GET /catalog.json — Worker 라우트 (D46)', () => {
  it('200 · application/json · Cache-Control · CORS * · version · 켜진 CSP 의 행과 리전만 · 카운터 catalog_json_accessed', async () => {
    const { kv, store } = fakeKv();
    const { res, promises } = await req(app, '/catalog.json', undefined, { CLOUDONYM_KV: kv });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json;\s*charset=utf-8$/i);
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = await json(res);
    expect(body.version).toEqual(VERSION);
    expect(Object.keys(body.providers)).toEqual([...ENABLED_PROVIDERS]);
    expect(body.providers.gcp.rows).toEqual(JSON.parse(JSON.stringify(GCP_CATALOG)));
    expect(body.providers.gcp.rows).toHaveLength(100);
    expect(body.providers.gcp.regions).toEqual(JSON.parse(JSON.stringify(REGIONS.gcp)));
    expect(body.providers.gcp.meta).toEqual(JSON.parse(JSON.stringify(GCP_CATALOG_META)));
    expect(body.providers.aws).toBeUndefined();
    expect(body.providers.azure).toBeUndefined();
    expect(promises).toHaveLength(1);
    await promises[0];
    expect([...store.keys()][0]).toMatch(/^stats:catalog_json_accessed:/);
  });
  it('켜진 CSP 목록을 바꾸면 그 CSP 만 싣는다 — 빌더 직접', () => {
    const doc = JSON.parse(buildCatalogJson(['gcp', 'aws'], VERSION));
    expect(Object.keys(doc.providers)).toEqual(['gcp', 'aws']);
    // catalog 가 아직 없는 CSP 는 빈 행 · 리전 표는 싣는다
    expect(doc.providers.aws.rows).toEqual([]);
    expect(doc.providers.aws.regions).toHaveLength(REGIONS.aws.length);
    expect(Object.keys(JSON.parse(buildCatalogJson([], VERSION)).providers)).toEqual([]);
  });
  it('HEAD 는 세지 않는다 — 헤더는 GET 과 같다', async () => {
    const { kv, store } = fakeKv();
    const { limiter, keys } = fakeLimiter('deny');
    const { res, promises } = await req(app, '/catalog.json', { method: 'HEAD' }, { CLOUDONYM_KV: kv, API_LIMITER: limiter });
    const { res: getRes } = await req(app, '/catalog.json');
    expect(res.status).toBe(200);
    expect(promises).toHaveLength(0);
    expect(store.size).toBe(0);
    expect(keys).toEqual([]);
    expect(res.headers.get('content-type')).toBe(getRes.headers.get('content-type'));
    expect(res.headers.get('cache-control')).toBe(getRes.headers.get('cache-control'));
  });
  it('IP 당 요청 제한을 넘으면 429 · Retry-After · CORS · 카운터 없음', async () => {
    const { limiter, keys } = fakeLimiter('deny');
    const { res, promises } = await req(app, '/catalog.json', { headers: { 'cf-connecting-ip': '203.0.113.9' } }, { API_LIMITER: limiter });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect((await json(res)).errors[0].code).toBe('request.rate_limited');
    expect(promises).toHaveLength(0);
    expect(keys).toEqual(['203.0.113.9']);
  });
  it('wrangler.jsonc run_worker_first 에 /catalog.json 이 있다', () => {
    const cfg = readFileSync(join(import.meta.dirname, '../../wrangler.jsonc'), 'utf-8');
    expect(cfg).toMatch(/"run_worker_first"\s*:\s*\[[^\]]*"\/catalog\.json"/);
  });
});
