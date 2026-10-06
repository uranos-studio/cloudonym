import { describe, it, expect, beforeAll, vi } from 'vitest';
import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from './index';
import { req, jsonPost, json, collectSamples, type Sample } from './test-support';
import { VERSION } from '../version';
import { en } from '../messages/en';
import { SCOPES } from '../core/scopes';
import { rulesFor } from '../core/constraints';
import { MESSAGE_CODES } from '../core/messages';
import { SCOPE_MEANING, UNIQUENESS_MEANING } from './llms';

const SELECTION_CODES_IN_SAMPLES = MESSAGE_CODES.filter((c) => c.startsWith('selection.'));

// openapi.json 을 읽는 데 필요한 만큼만 타입을 둔다
interface Schema { type?: string; maxLength?: number; description?: string; properties?: Record<string, Schema>; required?: string[]; enum?: string[]; items?: Schema; additionalProperties?: Schema | boolean; $ref?: string }
interface Operation { requestBody: { content: Record<string, { example: unknown; schema: Schema }> }; responses: Record<string, unknown> }
interface Spec { openapi: string; info: { version: string; description: string }; servers: { url: string }[]; paths: Record<string, { post?: Operation; get?: Operation }>; components: { schemas: Record<string, Schema> } }

const spec = JSON.parse(readFileSync(join(import.meta.dirname, '../../public/openapi.json'), 'utf-8')) as Spec;
const schemas = spec.components.schemas;
const exampleOf = (path: string): unknown => spec.paths[path]!.post!.requestBody.content['application/json']!.example;
const keys = (o: object): string[] => Object.keys(o).sort();
describe('public/openapi.json — 형식', () => {
  it('3.0.3 · servers 는 상대 /v1 · providers enum 셋(oci 없음 · D8) · env/region 은 enum 이 아닌 string', () => {
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.servers).toEqual([expect.objectContaining({ url: '/v1' })]);
    const ctx = schemas['GenerateRequest']!.properties!['context']!.properties!;
    expect(schemas['GenerateRequest']!.properties!['providers']!.items!.enum!.sort()).toEqual(['aws', 'azure', 'gcp']);
    expect(ctx['env']).toMatchObject({ type: 'string' });
    expect(ctx['env']!.enum).toBeUndefined();
    expect(ctx['region']!.enum).toBeUndefined();
    expect(JSON.stringify(spec)).not.toMatch(/cloudnaming|cloudonym\.(dev|io|ai|com)/);
  });
  it('다섯 경로 — generate · names · validate 는 200 · 400 · 409 · 413 · 429 · 500, /events 는 403 도, /health 는 GET 200 · 500 (D25 · D39)', () => {
    expect(keys(spec.paths)).toEqual(['/events', '/generate', '/health', '/names', '/validate']);
    for (const p of ['/generate', '/names', '/validate']) expect(keys(spec.paths[p]!.post!.responses), p).toEqual(['200', '400', '409', '413', '429', '500']);
    expect(keys(spec.paths['/events']!.post!.responses)).toEqual(['200', '400', '403', '413', '429', '500']);
    expect(keys(spec.paths['/health']!.get!.responses)).toEqual(['200', '500']);
    for (const p of ['/events', '/generate', '/names', '/validate']) {
      const r429 = spec.paths[p]!.post!.responses['429'] as { headers?: Record<string, { schema: Schema }> };
      expect(r429.headers?.['Retry-After']?.schema.type, p).toBe('integer');
    }
  });
  it('문자열 입력 필드에 maxLength 1024 (최종 리뷰 I-1)', () => {
    const ctxProps = schemas['GenerateRequest']!.properties!['context']!.properties!;
    for (const f of ['owner', 'system', 'purpose', 'env', 'region']) expect(ctxProps[f]!.maxLength, f).toBe(1024);
    for (const f of ['provider', 'resource_type', 'name']) expect(schemas['ValidateRequest']!.properties![f]!.maxLength, f).toBe(1024);
    expect(schemas['EventRequest']!.properties!['event']!.maxLength).toBe(1024);
    for (const r of ['GenerateRequest', 'ValidateRequest']) expect(schemas[r]!.properties!['rules_version']!.maxLength, r).toBe(1024);
  });
  it('info.version = package.json version (D26)', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '../../package.json'), 'utf-8')) as { version: string };
    expect(spec.info.version).toBe(pkg.version);
    expect(spec.info.version).toBe(VERSION.engine);
  });
  it('valid 설명 · info 설명에 PASS 의 뜻이 사전과 같은 문장으로 있다 (D28)', () => {
    expect(schemas['ResourceItem']!.properties!['valid']!.description).toBe(en.ui.pass_meaning);
    expect(schemas['ValidateResponse']!.properties!['valid']!.description).toBe(en.ui.pass_meaning);
    expect(spec.info.description).toContain(en.ui.pass_meaning);
    // README 도 같은 문장을 옮겨 적는다 — 네 곳(화면 · llms.txt · openapi.json · README)이 어긋나지 않게
    expect(readFileSync(join(import.meta.dirname, '../../README.md'), 'utf-8')).toContain(en.ui.pass_meaning);
  });
  it('명세 전체에 한글 0 · reason · note 없음 (steps · notes 로 바뀌었다)', () => {
    const raw = JSON.stringify(spec);
    expect(/\p{Script=Hangul}/u.test(raw)).toBe(false);
    expect(schemas['ResourceItem']!.properties!['reason']).toBeUndefined();
    expect(schemas['RuleInfo']!.properties!['note']).toBeUndefined();
  });
});

describe('public/openapi.json — /names (D39 · codex #9)', () => {
  const item = () => schemas['NameItem']!.properties!;
  it('NamesRequest — resources 1~200 · count 1~99 · role pattern · provider enum · context 는 generate 와 같다', () => {
    const r = schemas['NamesRequest']! as Schema & { properties: Record<string, Schema & { minItems?: number; maxItems?: number }> };
    expect(r.required!.sort()).toEqual(['context', 'provider', 'resources']);
    expect(r.properties['provider']!.enum!.sort()).toEqual(['aws', 'azure', 'gcp']);
    expect(r.properties['resources']).toMatchObject({ minItems: 1, maxItems: 200 });
    const it0 = r.properties['resources']!.items! as Schema & { properties: Record<string, Schema & { minimum?: number; maximum?: number; pattern?: string }> };
    expect(it0.properties['count']).toMatchObject({ type: 'integer', minimum: 1, maximum: 99 });
    expect(it0.properties['role']!.pattern).toBe('^[a-z0-9]{2,16}$');
    expect(r.properties['context']).toEqual(schemas['GenerateRequest']!.properties!['context']);
  });
  it('NameItem — scope enum 은 ScopeId 전부 · uniqueness enum 둘 · 설명은 llms.txt 와 같은 문장', () => {
    expect(item()['scope']!.enum!.sort()).toEqual(Object.keys(SCOPES).sort());
    expect(Object.keys(SCOPES).length).toBeGreaterThan(14); // 손 15 + 들인 Azure 부모 리소스 범위 — 수는 scopes.test 가 센다
    expect(item()['uniqueness']!.enum).toEqual(['csp', 'none']);
    expect(item()['scope']!.description).toBe(SCOPE_MEANING);
    expect(item()['uniqueness']!.description).toBe(UNIQUENESS_MEANING);
    // ResourceItem 의 키를 전부 가진다 — 같은 이름 결과에 키를 더한 것
    for (const k of Object.keys(schemas['ResourceItem']!.properties!)) expect(item()[k], k).toEqual(schemas['ResourceItem']!.properties![k]);
  });
  it('owner 예시는 정해 둔 중립 값만 쓴다', () => {
    const owners = [...JSON.stringify(spec).matchAll(/"owner":"([^"]*)"/g)].map((m) => m[1]);
    expect(owners.length).toBeGreaterThan(0);
    for (const o of owners) expect(['platform', 'infra']).toContain(o);
  });
});

describe('계약 시험 — 실제 응답을 명세의 스키마로 검증한다 (ajv · D25 · codex #8)', () => {
  // OpenAPI 3.0 의 example 키워드 때문에 strict:false. 명세 전체를 한 스키마로 넣고 #/components/schemas/X 를 그 안에서 찾는다
  const ajv = new Ajv({ strict: false, allErrors: true });
  ajv.addSchema({ $id: 'openapi', components: spec.components }, 'openapi');
  const validatorFor = (name: string) => ajv.getSchema(`openapi#/components/schemas/${name}`)!;
  /** 경로 · 메서드 · 상태 코드의 응답 스키마 이름 — /llms.txt 는 명세 밖이라 ErrorResponse 로 본다 */
  function schemaNameOf(method: string, path: string, status: number): string {
    if (path === '/llms.txt') return 'ErrorResponse';
    const op = spec.paths[path.replace(/^\/v1/, '')]![method.toLowerCase() as 'get' | 'post']!;
    const r = op.responses[String(status)] as { content?: Record<string, { schema: Schema }> } | undefined;
    expect(r, `${method} ${path} ${status} 가 명세에 없다`).toBeDefined();
    return r!.content!['application/json']!.schema.$ref!.split('/').pop()!;
  }
  let samples: Sample[] = [];
  beforeAll(async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try { samples = await collectSamples(app, VERSION.rules); } finally { spy.mockRestore(); }
  });

  it('검사기 자체 — 키를 더하거나 · params 값 타입이 틀리거나 · message 가 없으면 거부한다', () => {
    const ok = { valid: true, version: VERSION, violations: [] };
    expect(validatorFor('ValidateResponse')(ok)).toBe(true);
    expect(validatorFor('ValidateResponse')({ ...ok, reason: '' })).toBe(false);
    expect(validatorFor('ValidateResponse')({ ...ok, violations: ['x'] })).toBe(false);
    expect(validatorFor('ValidateResponse')({ ...ok, violations: [{ code: 'name.empty' }] })).toBe(false);
    expect(validatorFor('ValidateResponse')({ ...ok, violations: [{ code: 'name.too_long', params: { max: { n: 1 } }, message: 'x' }] })).toBe(false);
    expect(validatorFor('ErrorResponse')({ success: false, errors: [] })).toBe(false);
    expect(validatorFor('HealthResponse')({ ok: true })).toBe(false);
  });

  it('표본이 모든 상태 코드(200 · 400 · 403 · 409 · 413 · 429 · 500)를 덮는다', () => {
    expect([...new Set(samples.map((x) => x.status))].sort()).toEqual([200, 400, 403, 409, 413, 429, 500]);
  });

  it('모든 표본 응답이 그 상태 코드의 스키마에 맞는다', () => {
    const failures: string[] = [];
    for (const x of samples) {
      const v = validatorFor(schemaNameOf(x.method, x.path, x.status));
      if (!v(x.body)) failures.push(`${x.id} (${x.status}): ${ajv.errorsText(v.errors)}`);
    }
    expect(failures).toEqual([]);
  });

  it('names 표본 — 정상 · 항목 FAIL · Name 태그 · 충돌 · 400 selection.* 11개 전부 · 409', () => {
    const ids = samples.map((x) => x.id);
    for (const id of ['names-ok', 'names-item-fail', 'names-name-tag', 'names-conflict', '400-names-provider', '409-names-rules-version']) expect(ids, id).toContain(id);
    const codesSeen = new Set(samples.filter((x) => x.path === '/v1/names' && x.status === 400).flatMap((x) => (x.body.errors as { code: string }[]).map((e) => e.code)));
    expect(SELECTION_CODES_IN_SAMPLES).toHaveLength(11);
    for (const c of SELECTION_CODES_IN_SAMPLES) expect([...codesSeen], c).toContain(c);
    const tag = samples.find((x) => x.id === 'names-name-tag')!.body.data.aws.items[0];
    expect(tag).toMatchObject({ scope: 'aws:vpc', uniqueness: 'none' });
    const conflict = samples.find((x) => x.id === 'names-conflict')!.body.data.azure;
    expect(conflict.valid).toBe(false);
    expect(conflict.conflicts).toHaveLength(1);
  });

  it('rules_version 다섯 경우 — null · 숫자 · 객체 · 1025자는 400, 빈 문자열은 409 (명세의 상태 코드)', () => {
    const status = (id: string) => samples.find((x) => x.id === id)!.status;
    expect(['400-rules-version-null', '400-rules-version-number', '400-rules-version-object', '400-rules-version-too-long'].map(status)).toEqual([400, 400, 400, 400]);
    expect(status('409-rules-version-empty')).toBe(409);
    for (const p of ['/generate', '/validate']) expect(keys(spec.paths[p]!.post!.responses), p).toEqual(expect.arrayContaining(['400', '409']));
  });

  it('example 요청은 200 이고 /generate example 은 gcp · azure 규칙 수만큼', async () => {
    const body = await json((await req(app, '/v1/generate', jsonPost(exampleOf('/generate')))).res);
    expect(validatorFor('GenerateResponse')(body)).toBe(true);
    expect(Object.values(body.data as Record<string, object>).reduce((n, o) => n + Object.keys(o).length, 0)).toBe(rulesFor('gcp').length + rulesFor('azure').length);
    const n = await json((await req(app, '/v1/names', jsonPost(exampleOf('/names')))).res);
    expect(validatorFor('NamesResponse')(n)).toBe(true);
    expect(n.data.azure.valid).toBe(true);
    const v = await json((await req(app, '/v1/validate', jsonPost(exampleOf('/validate')))).res);
    expect(validatorFor('ValidateResponse')(v)).toBe(true);
    expect(v.suggested_name).toBeDefined();
  });
});

describe('public/_headers — 정적 /openapi.json 에 CORS (Workers Static Assets _headers)', () => {
  it('/openapi.json 규칙 아래 들여쓴 Access-Control-Allow-Origin: * 가 있다', () => {
    const raw = readFileSync(join(import.meta.dirname, '../../public/_headers'), 'utf-8');
    // 형식: URL 줄 다음에 들여쓴 「이름: 값」 줄 (https://developers.cloudflare.com/workers/static-assets/headers/)
    expect(raw).toMatch(/^\/openapi\.json\n[ \t]+Access-Control-Allow-Origin: \*$/m);
  });
});
