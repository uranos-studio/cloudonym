import { describe, it, expect } from 'vitest';
import { app } from './index';
import { req, jsonPost, json } from './test-support';
import { afterEach, vi } from 'vitest';
import { VERSION } from '../version';

const ctx = { owner: 'infra', system: 'billing', purpose: 'trade', env: 'prd', region: 'kr' };
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
      original: 'infra-billing-trade-prd-kr-sa-sync', violations: [],
      steps: [
        { code: 'step.token_dropped', field: 'region', message: "Dropped optional token 'region'" },
        { code: 'step.token_dropped', field: 'owner', message: "Dropped optional token 'owner'" },
      ],
      rule: { min_length: 6, max_length: 30, pattern: '^[a-z][a-z0-9-]{4,28}[a-z0-9]$', pattern_flags: '', allowed: 'lower-digit-hyphen', doc_url: 'https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/create', notes: [] },
    });
    expect(body.data.azure.storage_account).toMatchObject({ name: 'stbillingtradeprd', valid: true, is_transformed: true, steps: [{ code: 'step.separator_removed', message: 'Removed hyphens (this rule allows no separator)' }] });
    expect(body.data.azure.storage_account.rule.notes).toEqual([expect.objectContaining({ code: 'note.azure_reserved', params: { doc_url: expect.stringContaining('learn.microsoft.com') } })]);
    expect(body.metadata.generated_labels.gcp).toEqual({ owner: 'infra', system: 'billing', purpose: 'trade', environment: 'prd', managed_by: 'cloudonym' });
    expect(body.metadata).toMatchObject({ label_violations: { gcp: [], azure: [] }, label_transformed: { gcp: [], azure: [] }, transformed: [] });
  });
  it('providers:["gcp"] 이면 data · metadata 셋 모두 gcp 키만', async () => {
    const body = await json((await post({ context: ctx, providers: ['gcp'] })).res);
    for (const part of [body.data, body.metadata.generated_labels, body.metadata.label_violations, body.metadata.label_transformed]) {
      expect(Object.keys(part)).toEqual(['gcp']);
    }
    expect(Object.keys(body.data.gcp)).toHaveLength(9);
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

describe('POST /v1/names (D39)', () => {
  const base = { owner: 'platform', system: 'billing', purpose: 'trade', env: 'prd', region: 'kr' };
  const names = (body: unknown, env = {}) => req(app, '/v1/names', jsonPost(body), env);
  afterEach(() => { vi.unstubAllGlobals(); });

  it('200 — 키 전부 · 선택 순서 → 순번 순서 · scope · uniqueness · data · metadata 는 provider 하나', async () => {
    const { res } = await names({ provider: 'azure', context: base, resources: [{ type: 'virtual_machine', count: 2 }, { type: 'storage_account' }, { type: 'managed_identity', role: 'db' }, { type: 'resource_group' }] });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(Object.keys(body)).toEqual(['success', 'version', 'data', 'metadata']);
    expect(body.version).toEqual(VERSION);
    for (const part of [body.data, body.metadata.generated_labels, body.metadata.label_violations, body.metadata.label_transformed]) expect(Object.keys(part)).toEqual(['azure']);
    const az = body.data.azure;
    expect(Object.keys(az)).toEqual(['valid', 'items', 'conflicts']);
    expect(az.valid).toBe(true);
    expect(az.conflicts).toEqual([]);
    expect(az.items.map((i: { key: string; name: string }) => `${i.key}=${i.name}`)).toEqual([
      'virtual_machine_01=billing-trade-prd-kr-vm-01', 'virtual_machine_02=billing-trade-prd-kr-vm-02',
      'storage_account=stbillingtradeprd', 'managed_identity_db=billing-trade-prd-id-db', 'resource_group=rg-billing-trade-prd',
    ]);
    expect(Object.keys(az.items[0])).toEqual(['key', 'resource_type', 'seq', 'scope', 'uniqueness', 'name', 'valid', 'is_truncated', 'is_transformed', 'original', 'violations', 'steps', 'rule']);
    expect(az.items[0]).toMatchObject({ resource_type: 'virtual_machine', seq: '01', scope: 'azure:resource_group', uniqueness: 'csp' });
    expect(az.items[2]).toMatchObject({ scope: 'azure:global' });
    expect(az.items[2].seq).toBeUndefined();
    expect(az.items[3]).toMatchObject({ role: 'db', scope: 'azure:resource_group' });
    expect(az.items[4]).toMatchObject({ scope: 'azure:subscription' });
    expect(body.metadata.generated_labels.azure).toEqual({ owner: 'platform', system: 'billing', purpose: 'trade', environment: 'prd', managed_by: 'cloudonym' });
  });
  it('항목 하나가 FAIL 이면 200 · valid:false · 항목 전부와 이유', async () => {
    const { res } = await names({ provider: 'azure', context: { ...base, system: 'a-long', purpose: 'longpurpose' }, resources: [{ type: 'virtual_machine_windows', count: 2 }, { type: 'resource_group' }] });
    expect(res.status).toBe(200);
    const az = (await json(res)).data.azure;
    expect(az.valid).toBe(false);
    expect(az.items).toHaveLength(3);
    expect(az.items.filter((i: { valid: boolean }) => !i.valid).length).toBeGreaterThan(0);
    expect(az.items[2].valid).toBe(true);
  });
  it('AWS Name 태그 항목은 uniqueness "none" · scope 는 배치 범위 aws:vpc', async () => {
    const body = await json((await names({ provider: 'aws', context: base, resources: [{ type: 'ec2_instance' }, { type: 's3_bucket' }] })).res);
    expect(body.data.aws.items[0]).toMatchObject({ key: 'ec2_instance_01', scope: 'aws:vpc', uniqueness: 'none' });
    expect(body.data.aws.items[1]).toMatchObject({ key: 's3_bucket', scope: 'aws:partition', uniqueness: 'csp' });
  });
  it('실제 규칙 표의 Linux VM + Windows VM 은 이름이 달라 충돌 0 — 충돌 검사가 공허하게 통과하는 것이 아님을 보이는 대조 (fixture 쪽은 names-conflict.test)', async () => {
    const az = (await json((await names({ provider: 'azure', context: base, resources: [{ type: 'virtual_machine' }, { type: 'virtual_machine_windows' }] })).res)).data.azure;
    expect(az.items.map((i: { name: string }) => i.name)).toEqual(['billing-trade-prd-kr-vm-01', 'bi-tr-prd-vm-01']);
    expect(az.conflicts).toEqual([]);
  });
  it('계획 §10 완료 기준 — storage_account 에 count 2 → 400 selection.count_not_supported', async () => {
    const { res } = await names({ provider: 'azure', context: base, resources: [{ type: 'virtual_machine', count: 2 }, { type: 'storage_account', count: 2 }] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, errors: [{ code: 'selection.count_not_supported', params: { index: 1, type: 'storage_account' }, message: "resources[1]: 'storage_account' has no sequence number, so count must be 1" }] });
  });
  it('모르는 provider → 400 + supported · rules_version 다르면 409', async () => {
    const bad = await names({ provider: 'oci', context: base, resources: [{ type: 'x' }] });
    expect(bad.res.status).toBe(400);
    expect(await bad.res.json()).toMatchObject({ success: false, errors: [{ code: 'request.value_unsupported', field: 'provider' }], supported: ['aws', 'gcp', 'azure'] });
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
    const { promises } = await names({ provider: 'azure', context: base, resources: [{ type: 'virtual_machine', count: 3 }, { type: 'resource_group' }] }, { AXIOM_API_KEY: 'k', AXIOM_DATASET: 'ds' });
    await Promise.all(promises);
    expect(sent).toHaveLength(1);
    const [row] = JSON.parse(sent[0]!) as Record<string, unknown>[];
    expect(row).toMatchObject({ event: 'api_names', provider: 'azure', resource_count: 2, name_count: 4, valid: true });
    expect(sent[0]).not.toContain('billing');
  });
});
