import { describe, it, expect } from 'vitest';
import { app } from './index';
import { MAX_ECHO_CHARS } from './errors';
import { req, jsonPost, json, fakeKv, fakeLimiter, WIZARD_WIRE_SAMPLE, ENABLED, DISABLED, type Loose } from './test-support';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENABLED_PROVIDERS } from '../core/types';
import { GCP_CATALOG, GCP_CATALOG_META } from '../core/rules/gcp-catalog';
import { AWS_CATALOG, AWS_CATALOG_META } from '../core/rules/aws-catalog';
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
  it('멀티 · 이중 리전 위치는 규칙 전부를 내는 /v1/generate 에서 400 context.location_unsupported (D78)', async () => {
    const { res } = await post({ context: { ...ctx, region: 'US' }, providers: ['gcp'] });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.errors).toEqual([{ code: 'context.location_unsupported', field: 'region', params: { value: 'US', supported: ['storage_bucket', 'bigquery_dataset', 'logging_bucket'] },
      message: "region 'US' is a multi-region or dual-region location; only storage_bucket, bigquery_dataset, logging_bucket take it — use a single region, or ask for those resource types only" }]);
  });
  it('① 예시 입력 → GCP SA 는 owner · 지역 없이 그대로 들어간다 (D77)', async () => {
    const { res } = await post({ context: ctx, providers: ['gcp'] });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.success).toBe(true);
    expect(body.version).toEqual(VERSION);
    expect(body.data.gcp.service_account).toEqual({
      name: 'billing-trade-prod-sa-sync', valid: true, is_truncated: false, is_transformed: false,
      original: 'billing-trade-prod-sa-sync', violations: [], steps: [],
      rule: { min_length: 6, max_length: 30, pattern: '^[a-z][a-z0-9-]{4,28}[a-z0-9]$', pattern_flags: '', allowed: 'lower-digit-hyphen', doc_url: 'https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/create', notes: [] },
    });
    expect(body.metadata.generated_labels.gcp).toEqual({ owner: 'infra', system: 'billing', purpose: 'trade', environment: 'prod', managed_by: 'cloudonym' });
    // 존 이름은 이름에 들어가는 리전 코드로 바뀌고 그 기록이 남는다 (D49 · D50 revised)
    expect(body.metadata).toMatchObject({ label_violations: { gcp: [] }, label_transformed: { gcp: [] }, transformed: [
      { code: 'context.normalized', field: 'region', params: { from: 'asia-northeast3-a', to: 'ane3' } },
    ] });
  });
  it('프로젝트 이름(D85) — 프로젝트 ID 와 같은 글자 · 4~30 · 따옴표 · 공백 · ! 를 받는 pattern · 다른 부류라 충돌이 아니다', async () => {
    const body = await json((await post({ context: ctx, providers: ['gcp'] })).res);
    expect(body.data.gcp.project_name).toMatchObject({
      name: 'infra-billing-trade-prod', valid: true, is_truncated: false, violations: [],
      rule: { min_length: 4, max_length: 30, pattern: "^[A-Za-z0-9' !-]{3,29}[A-Za-z0-9]$", doc_url: 'https://docs.cloud.google.com/resource-manager/docs/creating-managing-projects#identifiers' },
    });
    expect(body.data.gcp.project_name.name).toBe(body.data.gcp.project_id.name);
    expect(body.data.gcp.project_id.valid).toBe(true);
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
    const { res } = await post({ context: { ...ctx, env: 'preprod' }, providers: ['gcp'] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, errors: [{ code: 'context.value_unsupported', field: 'env', params: { value: 'preprod', supported: ['prod', 'stg', 'dev', 'sbx', 'qa', 'uat', 'test', 'perf', 'dr'] }, message: "env 'preprod' is not supported (prod, stg, dev, sbx, qa, uat, test, perf, dr)" }] });
  });
  it('본문이 JSON 이 아니면 400', async () => {
    const { res } = await req(app, '/v1/generate', { method: 'POST', body: 'not json' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, errors: [{ code: 'request.body_not_json', message: 'Request body is not JSON' }] });
  });
  it('아는데 꺼진 provider → 400 request.provider_not_enabled · supported 는 켜진 것 (D45)', async () => {
    const off = DISABLED[0]!;
    const { res } = await post({ context: ctx, providers: [off] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, errors: [{ code: 'request.provider_not_enabled', field: 'providers[0]', params: { provider: off }, message: `Provider '${off}' is not available yet; 'supported' lists the providers you can use` }], supported: ENABLED });
  });
  it('providers 가 빈 배열 · 배열 아님 · 모르는 값이면 400 + supported', async () => {
    const empty = await post({ context: ctx, providers: [] });
    expect(empty.res.status).toBe(400);
    expect(await empty.res.json()).toEqual({ success: false, errors: [{ code: 'request.providers_empty', message: "'providers' is empty" }], supported: ENABLED });
    const notArray = await post({ context: ctx, providers: 'gcp' });
    expect(notArray.res.status).toBe(400);
    const unknown = await post({ context: ctx, providers: ['gcp', 'oci'] });
    expect(unknown.res.status).toBe(400);
    expect(await unknown.res.json()).toEqual({ success: false, errors: [{ code: 'request.value_unsupported', field: 'providers[1]', params: { value: 'oci' }, message: "Unsupported providers[1] 'oci'" }], supported: ENABLED });
  });
  it('context 가 없거나 null 이면 400 (500 이 아니다)', async () => {
    expect((await post({})).res.status).toBe(400);
    expect((await post({ context: null })).res.status).toBe(400);
    expect((await post([])).res.status).toBe(400);
  });
});

describe('rules_version 핀 (D27 ⑴)', () => {
  it('지금 버전이면 200 · 다르면 409 request.rules_version_mismatch', async () => {
    expect((await post({ context: ctx, providers: ['gcp'], rules_version: VERSION.rules })).res.status).toBe(200);
    const { res } = await post({ context: ctx, providers: ['gcp'], rules_version: '2026-09-15.1' });
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

  it('멀티 · 이중 리전 위치 (D78) — 받는 리소스만 고르면 200, 하나라도 받지 않으면 400', async () => {
    const ok = await names({ provider: 'gcp', context: { ...base, region: 'EU' }, resources: [{ type: 'storage_bucket' }, { type: 'bigquery_dataset' }, { type: 'vpc_network' }] });
    expect(ok.res.status).toBe(200);
    const body = await json(ok.res);
    expect(body.data.gcp.items.map((i: Loose) => i.name)).toEqual(['platform-billing-trade-prod-eu-gcs', 'billing_trade_prod_eu_bq', 'billing-trade-prod-vpc-01']);
    expect(body.metadata.transformed).toEqual([{ code: 'context.normalized', field: 'region', params: { from: 'EU', to: 'eu' }, message: "region 'EU' normalised to 'eu'" }]);
    const bad = await names({ provider: 'gcp', context: { ...base, region: 'asia1' }, resources: [{ type: 'storage_bucket' }, { type: 'bigquery_dataset' }] });
    expect(bad.res.status).toBe(400);
    expect((await json(bad.res)).errors).toMatchObject([{ code: 'context.location_unsupported', field: 'region', params: { value: 'ASIA1', supported: ['storage_bucket'] } }]);
  });

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
      'compute_instance_01=billing-trade-prod-ane3-gce-01', 'compute_instance_02=billing-trade-prod-ane3-gce-02',
      'storage_bucket=platform-billing-trade-prod-ane3-gcs', 'service_account_db=billing-trade-prod-sa-db', 'project_id=platform-billing-trade-prod',
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
  it('GCP 규칙은 프로젝트 이름 하나 빼고 uniqueness "csp" — "none" 은 AWS Name 태그와 gcp.project_name(D85 · "Project names don\'t need to be unique.")', async () => {
    const body = await json((await names({ provider: 'gcp', context: base, resources: [{ type: 'compute_instance' }, { type: 'storage_bucket' }] })).res);
    expect(body.data.gcp.items[0]).toMatchObject({ key: 'compute_instance_01', scope: 'gcp:project', uniqueness: 'csp' });
    expect(body.data.gcp.items[1]).toMatchObject({ key: 'storage_bucket', scope: 'gcp:namespace', uniqueness: 'csp' });
    expect(rulesFor('gcp').filter((r) => r.uniqueness === 'none').map((r) => r.id)).toEqual(['gcp.project_name']);
  });
  it('실제 규칙 표의 VM + 디스크는 이름이 달라 충돌 0 — 충돌 검사가 공허하게 통과하는 것이 아님을 보이는 대조 (fixture 쪽은 names-conflict.test)', async () => {
    const g = (await json((await names({ provider: 'gcp', context: base, resources: [{ type: 'compute_instance' }, { type: 'disk' }] })).res)).data.gcp;
    expect(g.items.map((i: { name: string }) => i.name)).toEqual(['billing-trade-prod-ane3-gce-01', 'billing-trade-prod-ane3-disk-01']);
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
    expect(await res.json()).toMatchObject({ success: false, errors: [{ code: 'request.provider_not_enabled', field: 'provider', params: { provider: 'azure' } }], supported: ENABLED });
  });
  it('모르는 provider → 400 + supported · rules_version 다르면 409', async () => {
    const bad = await names({ provider: 'oci', context: base, resources: [{ type: 'x' }] });
    expect(bad.res.status).toBe(400);
    expect(await bad.res.json()).toMatchObject({ success: false, errors: [{ code: 'request.value_unsupported', field: 'provider' }], supported: ENABLED });
    const pin = await names({ provider: 'gcp', context: base, resources: [{ type: 'project_id' }], rules_version: '2026-01-01.1' });
    expect(pin.res.status).toBe(409);
  });
  it(`되돌려 싣는 type 은 ${MAX_ECHO_CHARS}자로 자르고 보이지 않는 문자를 \\uXXXX 로 — params · message 둘 다`, async () => {
    const rlo = String.fromCodePoint(0x202e);
    const body = await json((await names({ provider: 'gcp', context: base, resources: [{ type: `${'x'.repeat(100)}${rlo}` }, { type: `a${rlo}b` }] })).res);
    expect(body.errors[0].params.value).toBe(`${'x'.repeat(MAX_ECHO_CHARS)}…`);
    expect(body.errors[0].message).toContain(`'${'x'.repeat(MAX_ECHO_CHARS)}…'`);
    expect(body.errors[1].params.value).toBe('a\\u202Eb');
    expect(JSON.stringify(body)).not.toContain(rlo);
  });
  it('종류 (D52) — POSTGRES ×2 · 리소스 정책 snapshot-schedule → 200 · 약어 바로 뒤 토큰 · kind · kind_token 은 seq 뒤', async () => {
    const ctx = { ...base, system: 'payments', purpose: 'ledger', region: 'asia-northeast3' };
    const { res } = await names({ provider: 'gcp', context: ctx, resources: [{ type: 'cloud_sql_instance', count: 2, kind: 'POSTGRES' }, { type: 'resource_policy', kind: 'snapshot-schedule' }, { type: 'backend_service', kind: 'EXTERNAL_MANAGED' }] });
    expect(res.status).toBe(200);
    const g = (await json(res)).data.gcp;
    expect(g.valid).toBe(true);
    expect(g.items.map((i: { key: string; name: string; kind?: string; kind_token?: string }) => [i.key, i.name, i.kind, i.kind_token])).toEqual([
      ['cloud_sql_instance_01', 'payments-ledger-prod-ane3-sql-pg-01', 'POSTGRES', 'pg'],
      ['cloud_sql_instance_02', 'payments-ledger-prod-ane3-sql-pg-02', 'POSTGRES', 'pg'],
      ['resource_policy_01', 'payments-ledger-prod-ane3-rp-snap-01', 'snapshot-schedule', 'snap'],
      ['backend_service_01', 'payments-ledger-prod-bs-01', 'EXTERNAL_MANAGED', undefined],
    ]);
    expect(Object.keys(g.items[0]).slice(0, 5)).toEqual(['key', 'resource_type', 'seq', 'kind', 'kind_token']);
    expect('kind_token' in g.items[3]).toBe(false);
  });
  it('종류 (D52) — 토큰(pg)을 넣으면 400 selection.unknown_kind · 리소스 정책에 종류가 없으면 400 selection.kind_required · 종류 없는 규칙에 kind 는 kind_not_supported', async () => {
    const { res } = await names({ provider: 'gcp', context: base, resources: [{ type: 'cloud_sql_instance', count: 2, kind: 'pg' }, { type: 'resource_policy' }, { type: 'vpc_network', kind: 'PRIVATE' }] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, errors: [
      { code: 'selection.unknown_kind', params: { index: 0, type: 'cloud_sql_instance', value: 'pg', supported: ['MYSQL', 'POSTGRES', 'SQLSERVER'] }, message: "resources[0]: 'pg' is not a kind of 'cloud_sql_instance'; use one of MYSQL, POSTGRES, SQLSERVER" },
      { code: 'selection.kind_required', params: { index: 1, type: 'resource_policy', supported: ['snapshot-schedule', 'instance-schedule', 'group-placement', 'disk-consistency-group', 'workload-policy'] }, message: "resources[1]: 'resource_policy' needs a kind; use one of snapshot-schedule, instance-schedule, group-placement, disk-consistency-group, workload-policy" },
      { code: 'selection.kind_not_supported', params: { index: 2, type: 'vpc_network' }, message: "resources[2]: 'vpc_network' takes no kind" },
    ] });
  });
  it(`종류 (D52) — 되돌려 싣는 kind 는 ${MAX_ECHO_CHARS}자로 자르고 보이지 않는 문자를 \\uXXXX 로 · 비문자열은 JSON`, async () => {
    const rlo = String.fromCodePoint(0x202e);
    const body = await json((await names({ provider: 'gcp', context: base, resources: [{ type: 'cloud_sql_instance', kind: `${'x'.repeat(100)}${rlo}` }, { type: 'snapshot', kind: { a: 1 } }] })).res);
    expect(body.errors.map((e: { params: { value: string } }) => e.params.value)).toEqual([`${'x'.repeat(MAX_ECHO_CHARS)}…`, '{"a":1}']);
    expect(JSON.stringify(body)).not.toContain(rlo);
  });
  it('/v1/generate — 리소스 정책은 종류를 받을 길이 없어 늘 valid:false + name.kind_required (D52)', async () => {
    const { res } = await req(app, '/v1/generate', jsonPost({ context: { ...base, region: 'asia-northeast3' }, providers: ['gcp'] }));
    const rp = (await json(res)).data.gcp.resource_policy;
    expect(rp).toMatchObject({ name: 'billing-trade-prod-ane3-rp-01', valid: false });
    expect(rp.violations.map((v: { code: string }) => v.code)).toEqual(['name.kind_required']);
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
    // 규칙마다 더한 칸(D101 — input · tier · locations)을 떼면 catalog 행 그대로다. 더한 칸은 catalog-client.test 가 센다
    const bare = (rows: Loose[]) => rows.map((row: Loose) => ({ ...row, rules: Object.fromEntries(Object.entries(row.rules as Record<string, Loose>)
      .map(([id, { input: _i, tier: _t, locations: _l, ...spec }]) => [id, spec])) }));
    expect(bare(body.providers.gcp.rows)).toEqual(JSON.parse(JSON.stringify(GCP_CATALOG)));
    expect(body.providers.gcp.rows).toHaveLength(131);
    expect(body.providers.gcp.regions).toEqual(JSON.parse(JSON.stringify(REGIONS.gcp)));
    expect(body.providers.gcp.meta).toEqual(JSON.parse(JSON.stringify(GCP_CATALOG_META)));
    expect(bare(body.providers.aws.rows)).toEqual(JSON.parse(JSON.stringify(AWS_CATALOG)));
    expect(body.providers.aws.rows).toHaveLength(217);
    expect(body.providers.aws.regions).toEqual(JSON.parse(JSON.stringify(REGIONS.aws)));
    expect(body.providers.aws.meta).toEqual(JSON.parse(JSON.stringify(AWS_CATALOG_META)));
    expect(body.providers.azure).toBeUndefined();
    expect(promises).toHaveLength(1);
    await promises[0];
    expect([...store.keys()][0]).toMatch(/^stats:catalog_json_accessed:/);
  });
  it('켜진 CSP 목록을 바꾸면 그 CSP 만 싣는다 — 빌더 직접', () => {
    const doc = JSON.parse(buildCatalogJson(['gcp', 'aws'], VERSION));
    expect(Object.keys(doc.providers)).toEqual(['gcp', 'aws']);
    expect(doc.providers.aws.rows).toHaveLength(217);
    expect(doc.providers.aws.meta.provider).toBe('aws');
    expect(doc.providers.aws.regions).toHaveLength(REGIONS.aws.length);
    // catalog 가 아직 없는 CSP 는 빈 행 · 리전 표는 싣는다
    const azure = JSON.parse(buildCatalogJson(['azure'], VERSION)).providers.azure;
    expect(azure.rows).toEqual([]);
    expect(azure.meta).toBeNull();
    expect(azure.regions).toHaveLength(REGIONS.azure.length);
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

describe('POST /v1/wizard (D66)', () => {
  const W = WIZARD_WIRE_SAMPLE;
  const wizard = (body: unknown, env = {}) => req(app, '/v1/wizard', jsonPost(body), env);
  const itemsOf = async (body: unknown) => {
    const { res } = await wizard(body);
    expect(res.status).toBe(200);
    return (await json(res)).data.gcp as { valid: boolean; items: Loose[]; conflicts: Loose[] };
  };
  const vm = (purpose: string, attach?: object) => ({ purpose, picks: [{ preset: 'web', instances: [{ id: 'a', seq: '01', ...(attach ? { attach } : {}) }] }] });

  it('provider aws (0.2) — AWS 리전 · 존 입력 200 · 프로젝트 ID 없음 · 새 약어 · 존 토큰 없음 · 접미사 · GCP 리전은 AWS 후보로 400', async () => {
    const body = {
      provider: 'aws', project: { owner: 'platform', system: 'billing', env: 'prod', region: 'ap-northeast-2' },
      project_picks: [{ preset: 'vpc', instances: [{ id: 'a', seq: '01' }] }],
      services: [{ purpose: 'shop', picks: [{ preset: 'web', instances: [{ id: 'b', seq: '01', attach: { boot: true, ip: true } }] }, { preset: 'object' }] }],
    };
    const { res } = await wizard(body);
    expect(res.status).toBe(200);
    const d = (await json(res)).data.aws as { valid: boolean; items: Loose[] };
    expect(d.valid).toBe(true);
    expect(d.items.map((i) => i.name)).toEqual([
      'billing-prod-apne2-vpc-01',
      'billing-shop-prod-apne2-ec2-web-01', 'billing-shop-prod-apne2-ec2-web-01-boot', 'billing-shop-prod-apne2-ec2-web-01-ip',
      'platform-billing-shop-prod-s3',
    ]);
    const zoned = await wizard({ ...body, project: { ...body.project, region: 'ap-northeast-2a' } });
    expect(zoned.res.status).toBe(200);
    const z = await json(zoned.res);
    expect(z.data.aws.items.map((i: Loose) => i.name)).toEqual(d.items.map((i) => i.name));
    expect(z.metadata.transformed).toContainEqual(expect.objectContaining({ code: 'context.normalized', field: 'region', params: { from: 'ap-northeast-2a', to: 'apne2' } }));
    const suffix = await wizard({ ...body, project_id_suffix: 'team1' });
    expect(suffix.res.status).toBe(400);
    expect((await json(suffix.res)).errors).toMatchObject([{ code: 'wizard.project_id_suffix_not_supported', field: 'project_id_suffix', params: { provider: 'aws' } }]);
    const gcpRegion = await wizard({ ...body, project: { ...body.project, region: 'asia-northeast3' } });
    expect(gcpRegion.res.status).toBe(400);
    const e = (await json(gcpRegion.res)).errors[0];
    expect(e).toMatchObject({ code: 'context.value_unsupported', field: 'project.region' });
    expect(e.params.supported).toContain('ap-northeast-2');
  });
  it('project_id_suffix (D85) — 200 · 프로젝트 ID 끝에 · 키 고정 · 틀린 꼴 · 예약어 · 너무 긴 값은 400', async () => {
    const g = await itemsOf({ ...W, project_id_suffix: 'team1' });
    expect(g.items[0]).toMatchObject({ key: 'project/-/project_id/-/-/-', name: 'platform-billing-prod-team1', valid: true });
    const bad = await wizard({ ...W, project_id_suffix: 'Team-1' });
    expect(bad.res.status).toBe(400);
    expect((await json(bad.res)).errors).toMatchObject([{ code: 'wizard.invalid_project_id_suffix', field: 'project_id_suffix', params: { value: 'Team-1' }, message: "Project ID suffix 'Team-1' must match ^[a-z0-9]{2,16}$" }]);
    const reserved = await wizard({ ...W, project_id_suffix: 'prod' });
    expect((await json(reserved.res)).errors).toMatchObject([{ code: 'wizard.project_id_suffix_reserved', field: 'project_id_suffix', params: { value: 'prod' } }]);
    const long = await wizard({ ...W, project_id_suffix: 'a'.repeat(1025) });
    expect((await json(long.res)).errors).toMatchObject([{ code: 'request.field_too_long', field: 'project_id_suffix' }]);
  });
  it('종류만 다른 서브넷 둘(D86) — 200 · 키의 kind 칸이 다르다 · 토큰이 같은 둘은 400 wizard.duplicate_pick', async () => {
    const subnet = (kind?: string) => ({ preset: 'subnet', ...(kind === undefined ? {} : { kind }), instances: [{ id: 'a', seq: '01' }] });
    const g = await itemsOf({ ...W, project_picks: [subnet(), subnet('REGIONAL_MANAGED_PROXY')], services: [] });
    expect(g.items.map((i) => [i.key, i.name])).toEqual([
      ['project/-/project_id/-/-/-', 'platform-billing-prod'],
      ['project/-/subnet/-/-/01', 'billing-prod-ane3-snet-01'],
      ['project/-/subnet/proxy/-/01', 'billing-prod-ane3-snet-proxy-01'],
    ]);
    const dup = await wizard({ ...W, project_picks: [subnet('REGIONAL_MANAGED_PROXY'), subnet('GLOBAL_MANAGED_PROXY')], services: [] });
    expect(dup.res.status).toBe(400);
    expect((await json(dup.res)).errors).toMatchObject([{ code: 'wizard.duplicate_pick', field: 'project_picks[1]', params: { value: 'subnet/proxy' } }]);
  });
  it('pick 의 location (D78) — 버킷은 받고 VM 은 wizard.invalid_location · 프로젝트 지역의 멀티 리전은 context.location_unsupported', async () => {
    const project = { owner: 'platform', system: 'billing', env: 'prod', region: 'asia-northeast3' };
    const g = await itemsOf({ provider: 'gcp', project, services: [{ purpose: 'shop', picks: [{ preset: 'object', location: 'US' }] }] });
    expect(g.items.map((i) => i.name)).toEqual(['platform-billing-prod', 'platform-billing-shop-prod-us-gcs']);
    const bad = await wizard({ provider: 'gcp', project, services: [{ purpose: 'shop', picks: [{ preset: 'web', location: 'US', instances: [{ id: 'a', seq: '01' }] }] }] });
    expect(bad.res.status).toBe(400);
    expect((await json(bad.res)).errors).toMatchObject([{ code: 'wizard.invalid_location', field: 'services[0].picks[0]', params: { type: 'compute_instance', value: 'US', supported: [] } }]);
    const multi = await wizard({ provider: 'gcp', project: { ...project, region: 'EU' }, services: [{ purpose: 'shop', picks: [{ preset: 'object' }] }] });
    expect(multi.res.status).toBe(400);
    expect((await json(multi.res)).errors).toMatchObject([{ code: 'context.location_unsupported', field: 'project.region', params: { value: 'EU' } }]);
  });

  it('examples/terraform/wizard.json — docs/api.md 의 curl 요청과 같고 · 200 · 예시 README 가 적은 키와 이름이 나온다', async () => {
    const root = join(import.meta.dirname, '..', '..');
    const body = JSON.parse(readFileSync(join(root, 'examples', 'terraform', 'wizard.json'), 'utf-8')) as unknown;
    const curl = /POST https:\/\/<your-deployment>\/v1\/wizard[^\n]*\n\s*-d '([^']+)'/.exec(readFileSync(join(root, 'docs', 'api.md'), 'utf-8'));
    expect(curl, 'docs/api.md 의 /v1/wizard curl 예시').not.toBeNull();
    expect(body).toEqual(JSON.parse(curl![1]!));
    const g = await itemsOf(body);
    expect(g.valid).toBe(true);
    expect(g.items.find((i) => i.key === 'service/shop/compute_instance/-/web/01/data/01')?.name).toBe('billing-shop-prod-ane3-gce-web-01-data-01');
    expect(readFileSync(join(root, 'examples', 'terraform', 'README.md'), 'utf-8')).toContain('file("${path.module}/wizard.json")');
  });

  it('라우트 · CORS — POST /v1/wizard 가 있고 OPTIONS 는 204 + *', async () => {
    expect(app.routes.map((r) => `${r.method} ${r.path}`)).toContain('POST /v1/wizard');
    const { res } = await req(app, '/v1/wizard', { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect((await req(app, '/v1/wizard')).res.status).toBe(404);
  });

  it('표본 — 200 · 항목 14 · 순서 · 구조 키 · 이름 글자 그대로 · version · 라벨은 이름공간 맵 · project 라벨에 purpose 없음', async () => {
    const { res } = await wizard(W);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.success).toBe(true);
    expect(body.version).toEqual(VERSION);
    const g = body.data.gcp;
    expect(g.valid).toBe(true);
    expect(g.conflicts).toEqual([]);
    expect(g.items).toHaveLength(14);
    expect(g.items.map((i: Loose) => [i.key, i.name])).toEqual([
      ['project/-/project_id/-/-/-', expect.any(String)],
      ['project/-/vpc_network/-/-/01', expect.any(String)],
      ['project/-/subnet/-/-/01', expect.any(String)],
      ['project/-/firewall_rule/-/ssh/01', expect.any(String)],
      ['project/-/firewall_rule/-/web/01', expect.any(String)],
      ['service/shop/compute_instance/-/web/01', 'billing-shop-prod-ane3-gce-web-01'],
      ['service/shop/compute_instance/-/web/01/boot/-', 'billing-shop-prod-ane3-gce-web-01-boot'],
      ['service/shop/compute_instance/-/web/01/data/01', 'billing-shop-prod-ane3-gce-web-01-data-01'],
      ['service/shop/compute_instance/-/web/01/ip/-', 'billing-shop-prod-ane3-gce-web-01-ip'],
      ['service/shop/cloud_sql_instance/pg/-/01', expect.any(String)],
      ['service/pay/compute_instance/-/web/01', 'billing-pay-prod-ane3-gce-web-01'],
      ['service/pay/compute_instance/-/web/01/boot/-', 'billing-pay-prod-ane3-gce-web-01-boot'],
      ['service/pay/compute_instance/-/web/02', 'billing-pay-prod-ane3-gce-web-02'],
      ['service/pay/compute_instance/-/web/02/boot/-', 'billing-pay-prod-ane3-gce-web-02-boot'],
    ]);
    const first = g.items[0];
    expect(first).toMatchObject({ namespace: 'project', level: 'project', resource_type: 'project_id', valid: true, scope: expect.any(String), uniqueness: 'csp' });
    const boot = g.items[6];
    expect(boot).toMatchObject({ namespace: 'shop', parent: 'service/shop/compute_instance/-/web/01', attach: 'boot', resource_type: 'disk' });
    expect(boot.level).toBeUndefined();
    expect(g.items[7]).toMatchObject({ attach: 'data', seq: '01' });
    expect(g.items[5]).toMatchObject({ namespace: 'shop', tier: 'web', seq: '01' });
    expect(g.items[5].parent).toBeUndefined();
    expect(g.items[9]).toMatchObject({ kind: 'POSTGRES' });
    expect(Object.keys(body.metadata.generated_labels.gcp)).toEqual(['project', 'shop', 'pay']);
    expect(body.metadata.generated_labels.gcp.project).toEqual({ owner: 'platform', system: 'billing', environment: 'prod', managed_by: 'cloudonym' });
    expect(body.metadata.generated_labels.gcp.shop).toEqual({ owner: 'platform', system: 'billing', purpose: 'shop', environment: 'prod', managed_by: 'cloudonym' });
    expect(body.metadata.label_violations).toEqual({ gcp: [] });
    expect(body.metadata.label_transformed).toEqual({ gcp: [] });
    expect(body.metadata.transformed).toEqual([{ code: 'context.normalized', field: 'region', params: { from: 'asia-northeast3-a', to: 'ane3' }, message: expect.any(String) }]);
  });

  it('같은 요청에 응답의 version.rules 를 rules_version 으로 넣으면 같은 응답 (D27) · 다르면 409', async () => {
    const a = await json((await wizard(W)).res);
    const b = await json((await wizard({ ...W, rules_version: a.version.rules })).res);
    expect(b).toEqual(a);
    const { res } = await wizard({ ...W, rules_version: '2026-01-01.1' });
    expect(res.status).toBe(409);
    expect((await json(res)).errors[0].code).toBe('request.rules_version_mismatch');
  });

  it('자식 넘침은 200 · 그 자식만 valid:false (name.cannot_fit · name.parent_name)', async () => {
    const g = await itemsOf({ ...W, project_picks: [], services: [vm('p'.repeat(30), { boot: true })] });
    expect(g.items).toHaveLength(3);
    expect(g.items[1].valid).toBe(true);
    expect(g.items[2].valid).toBe(false);
    expect(g.items[2].violations.map((v: Loose) => v.code)).toEqual(['name.cannot_fit', 'name.parent_name']);
    expect(g.valid).toBe(false);
  });

  it('충돌 fixture — cloud_function + cloud_function_gen1 → 200 · 항목 셋 · 둘 다 name.conflict', async () => {
    const g = await itemsOf({ ...W, project_picks: [], services: [{ purpose: 'shop', picks: [
      { preset: null, rule: 'gcp.cloud_function', instances: [{ id: 'a', seq: '01' }] },
      { preset: null, rule: 'gcp.cloud_function_gen1', instances: [{ id: 'a', seq: '01' }] }] }] });
    expect(g.items).toHaveLength(3);
    expect(g.items[1].name).toBe(g.items[2].name);
    for (const i of [1, 2]) expect(g.items[i].violations.map((v: Loose) => v.code)).toContain('name.conflict');
    expect(g.conflicts).toHaveLength(1);
    expect(g.valid).toBe(false);
  });

  it('부모 FAIL fixture — 축소 뒤 같아지는 60자 purpose 둘 · boot 는 첫 서버에만 → 항목 넷 · 부모 둘 name.conflict · boot 는 name.parent_invalid 이름 빈 값', async () => {
    const g = await itemsOf({ ...W, project_picks: [], services: [vm(`${'a'.repeat(59)}b`, { boot: true }), vm(`${'a'.repeat(59)}c`)] });
    expect(g.items).toHaveLength(4);
    const [, p1, boot, p2] = g.items;
    expect(p1.name).toBe(p2.name);
    expect(p1.violations.map((v: Loose) => v.code)).toContain('name.conflict');
    expect(p2.violations.map((v: Loose) => v.code)).toContain('name.conflict');
    expect(boot).toMatchObject({ attach: 'boot', name: '', valid: false });
    expect(boot.violations.map((v: Loose) => v.code)).toEqual(['name.parent_invalid']);
  });

  it('프로젝트 ↔ 서비스 방화벽 — 둘 다 PASS · 충돌 0', async () => {
    const fw = { preset: 'firewall', tier: 'ssh', instances: [{ id: 'a', seq: '01' }] };
    const g = await itemsOf({ ...W, project_picks: [fw], services: [{ purpose: 'shop', picks: [fw] }] });
    expect(g.items).toHaveLength(3);
    expect(g.items.every((i: Loose) => i.valid)).toBe(true);
    expect(g.items[1].name).not.toBe(g.items[2].name);
    expect(g.conflicts).toEqual([]);
  });

  it('같은 슬롯에 boot · data 01 02 · ip · ipi → 자식 다섯 · 키가 모두 다르다', async () => {
    const g = await itemsOf({ ...W, project_picks: [], services: [vm('shop', { boot: true, data: ['01', '02'], ip: true, ipi: true })] });
    expect(g.items).toHaveLength(7);
    const children = g.items.filter((i: Loose) => i.parent !== undefined);
    expect(children.map((i: Loose) => i.attach)).toEqual(['boot', 'data', 'data', 'ip', 'ipi']);
    expect(new Set(children.map((i: Loose) => i.key)).size).toBe(5);
  });

  it('400 — HA 셋 · seq 넷 · data 순번 · field 는 wire 경로 · 문장에 -1 이 없다', async () => {
    const two = [{ id: 'a', seq: '01' }, { id: 'b', seq: '02' }];
    const bad = async (pick: unknown) => {
      const { res } = await wizard({ ...W, project_picks: [], services: [{ purpose: 'shop', picks: [pick] }] });
      expect(res.status).toBe(400);
      return (await json(res)).errors as Loose[];
    };
    for (const pick of [{ preset: 'web', serverless: 'gcp.cloud_function', ha: true, instances: two }, { preset: 'bastion', ha: true, instances: two }, { preset: null, rule: 'gcp.compute_instance', ha: true, instances: two }]) {
      expect((await bad(pick)).map((e) => [e.code, e.field])).toEqual([['wizard.ha_not_supported', 'services[0].picks[0]']]);
    }
    for (const seq of ['00', '7', '100', 'ab']) {
      expect((await bad({ preset: 'web', instances: [{ id: 'a', seq }] })).map((e) => [e.code, e.field]), seq).toEqual([['wizard.invalid_seq', 'services[0].picks[0].instances[0]']]);
    }
    expect((await bad({ preset: 'web', instances: [{ id: 'a', seq: '01', attach: { data: ['00'] } }] })).map((e) => [e.code, e.field]))
      .toEqual([['wizard.invalid_data_seq', 'services[0].picks[0].instances[0].attach.data[0]']]);
    const picks = Array.from({ length: 41 }, (_, i) => ({ preset: 'firewall', tier: `t${i}`, instances: [{ id: 'a', seq: '01' }] }));
    const { res } = await wizard({ ...W, project_picks: picks, services: [] });
    const tooMany = ((await json(res)).errors as Loose[]).find((e) => e.code === 'wizard.too_many_picks');
    expect(tooMany.field).toBe('project_picks');
    expect(tooMany.message).not.toContain('-1');
  });

  it('이름 총합 — 프로젝트 ID + VM 199 → 200 · + VM 200 → 400 wizard.too_many_names (field 없음)', async () => {
    const slots = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, seq: String(i + 1).padStart(2, '0') }));
    const plan = (last: number) => ({ ...W, project_picks: [], services: [{ purpose: 'shop', picks: [
      { preset: 'web', instances: slots(99) }, { preset: 'was', instances: slots(99) }, { preset: 'bastion', instances: slots(last) }] }] });
    const ok = await wizard(plan(1));
    expect(ok.res.status).toBe(200);
    expect((await json(ok.res)).data.gcp.items).toHaveLength(200);
    const over = await wizard(plan(2));
    expect(over.res.status).toBe(400);
    expect((await json(over.res)).errors).toEqual([{ code: 'wizard.too_many_names', params: { max: 200, actual: 201 }, message: expect.any(String) }]);
  });

  it('틀린 모양은 500 이 아니라 400 — services:x · picks:x · services:[null] · attach:x · instances:x', async () => {
    for (const body of [
      { ...W, services: 'x' }, { ...W, services: [{ purpose: 'shop', picks: 'x' }] }, { ...W, services: [null] },
      { ...W, services: [vm('shop', 'x' as unknown as object)] }, { ...W, services: [{ purpose: 'shop', picks: [{ preset: 'web', instances: 'x' }] }] },
      { ...W, project: [] }, [W], { ...W, project_picks: [{ preset: 'web', instances: [{ id: 'a', seq: '01', attach: { data: 'x' } }] }] },
    ]) {
      const { res } = await wizard(body);
      expect(res.status, JSON.stringify(body).slice(0, 100)).toBe(400);
    }
    const { res } = await req(app, '/v1/wizard', { method: 'POST', body: 'not json' });
    expect(res.status).toBe(400);
  });

  it('텔레메트리 api_wizard — provider · 서비스 수 · pick 수 · 이름 수 · valid 만 · 문맥값 · 서비스 이름 없음 · 응답을 기다리지 않는다', async () => {
    const { kv, store } = fakeKv();
    const axiom = vi.fn((_url: string, _init: { body: string }) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') }));
    vi.stubGlobal('fetch', axiom);
    try {
      const { res, promises } = await wizard(W, { CLOUDONYM_KV: kv, AXIOM_API_KEY: 'k', AXIOM_DATASET: 'd' });
      expect(res.status).toBe(200);
      expect(promises).toHaveLength(1);
      await promises[0];
      expect([...store.keys()][0]).toMatch(/^stats:api_wizard:/);
      const sent = JSON.parse(axiom.mock.calls[0]![1].body)[0];
      expect(sent).toMatchObject({ event: 'api_wizard', provider: 'gcp', service_count: 2, resource_count: 7, name_count: 14, valid: true });
      // D71 — 칩으로 고른 유효 규칙 · Custom 으로 고른 규칙 (정렬 · 중복 없음 · 프로젝트 ID 없음)
      expect(sent.chip_rules).toEqual(['gcp.cloud_sql_instance', 'gcp.compute_instance', 'gcp.firewall_rule', 'gcp.subnet', 'gcp.vpc_network']);
      expect(sent.custom_rules).toEqual([]);
      const raw = JSON.stringify(sent);
      for (const v of ['platform', 'billing', 'shop', 'pay', 'asia-northeast3']) expect(raw, v).not.toContain(v);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('/v1/names 는 그대로 — 마법사 필드를 보내도 옛 응답과 같다', () => {
  it('tier · instances · level · attach 를 실어도 같은 응답', async () => {
    const base = { provider: 'gcp', context: ctx, resources: [{ type: 'compute_instance', count: 2 }] };
    const extra = { ...base, resources: [{ type: 'compute_instance', count: 2, tier: 'web', level: 'project', instances: [{ seq: '05' }], attach: { boot: true } }] };
    const a = await json((await req(app, '/v1/names', jsonPost(base))).res);
    const b = await json((await req(app, '/v1/names', jsonPost(extra))).res);
    expect(b).toEqual(a);
    expect(a.data.gcp.items.map((i: Loose) => i.key)).toEqual(['compute_instance_01', 'compute_instance_02']);
  });
});

describe('POST /v1/wizard — 되돌려 싣는 값 · 문장 (고침 1)', () => {
  const W = WIZARD_WIRE_SAMPLE;
  const errs = async (body: unknown) => {
    const { res } = await req(app, '/v1/wizard', jsonPost(body));
    expect(res.status).toBe(400);
    return (await json(res)).errors as Loose[];
  };
  const one = (pick: unknown) => ({ ...W, project_picks: [], services: [{ purpose: 'shop', picks: [pick] }] });

  it('객체 · 배열 값은 /v1/names 처럼 JSON 으로 — rule · preset · slot id · kind (문장도 같은 값)', async () => {
    const [rule] = await errs(one({ preset: null, rule: { a: 1 } }));
    expect(rule).toMatchObject({ code: 'selection.unknown_type', field: 'services[0].picks[0]', params: { value: '{"a":1}' } });
    expect(rule.message).toContain(`'{"a":1}'`);
    expect(rule.message).not.toContain('[object Object]');
    const [preset] = await errs(one({ preset: { a: 1 } }));
    expect(preset).toMatchObject({ code: 'wizard.unknown_preset', params: { value: '{"a":1}' } });
    const ids = await errs(one({ preset: 'web', instances: [{ id: { x: 1 }, seq: '01' }] }));
    expect(ids.find((e) => e.code === 'wizard.invalid_slot_id')).toMatchObject({ field: 'services[0].picks[0].instances[0]', params: { value: '{"x":1}' } });
    // kind:null 은 「없음」이 아니다 — 프리셋 기본값(종류 없는 subnet · 고정 종류 psa)으로 덮지 않고 거부한다(/v1/names 와 같다)
    const nullKind = await errs({ ...W, services: [], project_picks: [{ preset: 'subnet', kind: null, instances: [{ id: 'a', seq: '01' }] }] });
    expect(nullKind.find((e) => e.code === 'selection.unknown_kind')).toMatchObject({ field: 'project_picks[0]', params: { value: 'null' } });
    const names = await req(app, '/v1/names', jsonPost({ provider: 'gcp', context: ctx, resources: [{ type: 'subnet', count: 1, kind: null }] }));
    expect(names.res.status).toBe(400);
    const kinds = await errs(one({ preset: 'db', kind: [1], instances: [{ id: 'a', seq: '01' }] }));
    expect(kinds.find((e) => e.code === 'selection.unknown_kind')).toMatchObject({ params: { value: '[1]' } });
    const seq = await errs(one({ preset: 'web', instances: [{ id: 'a', seq: 7, attach: { data: [{ d: 1 }] } }] }));
    expect(seq.find((e) => e.code === 'wizard.invalid_seq')!.params.value).toBe('7');
    expect(seq.find((e) => e.code === 'wizard.invalid_data_seq')!.params.value).toBe('{"d":1}');
    const long = await errs(one({ preset: 'x'.repeat(500) }));
    expect(long[0].params.value).toBe(`${'x'.repeat(MAX_ECHO_CHARS)}…`);
  });

  it('문장의 위치는 요청 본문의 이름 — field 와 같다 (resources[0] · picks[0] 아님)', async () => {
    const [a] = await errs(one({ preset: null, rule: 'gcp.nope' }));
    expect(a.message.startsWith('services[0].picks[0]: ')).toBe(true);
    const [b] = await errs({ ...W, services: [], project_picks: [{ preset: 'web', instances: [{ id: 'a', seq: '7' }] }] });
    expect(b.message.startsWith('project_picks[0].instances[0]: ')).toBe(true);
    for (const e of await errs({ ...W, services: [{ purpose: 'shop', picks: 'x' }] })) expect(e.message, e.code).not.toMatch(/resources/);
    for (const e of await errs({ ...W, services: 'x' })) expect(e.message, e.code).not.toMatch(/resources/);
  });

  it('services:[null] 은 오류 하나 — services[0] must be an object', async () => {
    const e = await errs({ ...W, services: [null] });
    expect(e.map((x) => [x.code, x.field])).toEqual([['selection.item_not_object', 'services[0]']]);
    expect(e[0].message).toBe('services[0] must be an object');
  });
});
