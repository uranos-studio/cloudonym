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
import { MAX_CONTEXT_CHARS, parseContext } from '../core/engine';
import { SCOPE_MEANING, UNIQUENESS_MEANING } from './llms';
import { ENABLED_PROVIDERS } from '../core/types';
import { MAX_KIND_CHARS, catalogFor } from '../core/catalog';
import { UI_COPY_TARGETS } from './schemas';

/** region 예시를 넣어 볼 문맥 — 나머지 넷은 정본 값 */
const ctxExample = { owner: 'platform', system: 'billing', purpose: 'trade', env: 'prod' };

const SELECTION_CODES_IN_SAMPLES = MESSAGE_CODES.filter((c) => c.startsWith('selection.'));

// openapi.json 을 읽는 데 필요한 만큼만 타입을 둔다
interface Schema { type?: string; maxLength?: number; description?: string; properties?: Record<string, Schema>; required?: string[]; enum?: string[]; items?: Schema; additionalProperties?: Schema | boolean; $ref?: string }
interface Operation { requestBody: { content: Record<string, { example: unknown; schema: Schema }> }; responses: Record<string, unknown> }
interface PathItem { post?: Operation; get?: Operation; servers?: { url: string }[] }
interface Spec { openapi: string; info: { version: string; description: string }; servers: { url: string }[]; paths: Record<string, PathItem>; components: { schemas: Record<string, Schema> } }

const spec = JSON.parse(readFileSync(join(import.meta.dirname, '../../public/openapi.json'), 'utf-8')) as Spec;
const schemas = spec.components.schemas;
const exampleOf = (path: string): unknown => spec.paths[path]!.post!.requestBody.content['application/json']!.example;
const keys = (o: object): string[] => Object.keys(o).sort();
describe('public/openapi.json — 형식', () => {
  it('3.0.3 · servers 는 상대 /v1 · provider enum 셋 자리 모두 켜진 CSP 그대로(D45 · oci 없음) · env/region 은 enum 이 아닌 string', () => {
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.servers).toEqual([expect.objectContaining({ url: '/v1' })]);
    const ctx = schemas['GenerateRequest']!.properties!['context']!.properties!;
    expect(schemas['GenerateRequest']!.properties!['providers']!.items!.enum).toEqual([...ENABLED_PROVIDERS]);
    expect(schemas['NamesRequest']!.properties!['provider']!.enum).toEqual([...ENABLED_PROVIDERS]);
    expect(schemas['ValidateRequest']!.properties!['provider']!.enum).toEqual([...ENABLED_PROVIDERS]);
    expect(ctx['env']).toMatchObject({ type: 'string' });
    expect(ctx['env']!.enum).toBeUndefined();
    expect(ctx['region']!.enum).toBeUndefined();
    expect(JSON.stringify(spec)).not.toMatch(/cloudnaming|cloudonym\.(dev|io|ai|com)/);
  });
  it('region 설명 · 예시 — 옛 나라 값(kr)이 없고 존 입력을 말한다 · 예시는 켜진 CSP 에서 풀린다 (D49 · D50)', () => {
    for (const r of ['GenerateRequest', 'NamesRequest']) {
      const region = schemas[r]!.properties!['context']!.properties!['region']! as Schema & { example?: string };
      expect(region.description, r).not.toMatch(/\bkr\b/);
      expect(region.description, r).toMatch(/zone/i);
      expect(region.description, r).toContain('/llms.txt');
      for (const p of ENABLED_PROVIDERS) expect(parseContext({ ...ctxExample, region: region.example }, p).ok, `${r} ${p}`).toBe(true);
    }
    // 이름 예시에 옛 지역 토큰이 남지 않는다
    expect(JSON.stringify(spec)).not.toMatch(/-kr-/);
  });
  it('여섯 경로 — generate · names · validate 는 200 · 400 · 409 · 413 · 429 · 500, /events 는 403 도, /health 는 GET 200 · 500, /catalog.json 은 뿌리 서버의 GET 200 · 429 · 500 (D25 · D39 · D46)', () => {
    expect(keys(spec.paths)).toEqual(['/catalog.json', '/events', '/generate', '/health', '/names', '/validate']);
    // servers 가 /v1 이라 /catalog.json 은 경로 단위로 뿌리 서버를 덮어써야 /v1/catalog.json 으로 읽히지 않는다
    expect(spec.paths['/catalog.json']!.servers).toEqual([expect.objectContaining({ url: '/' })]);
    expect(keys(spec.paths['/catalog.json']!.get!.responses)).toEqual(['200', '429', '500']);
    for (const p of ['/events', '/generate', '/health', '/names', '/validate']) expect(spec.paths[p]!.servers, p).toBeUndefined();
    for (const p of ['/generate', '/names', '/validate']) expect(keys(spec.paths[p]!.post!.responses), p).toEqual(['200', '400', '409', '413', '429', '500']);
    expect(keys(spec.paths['/events']!.post!.responses)).toEqual(['200', '400', '403', '413', '429', '500']);
    expect(keys(spec.paths['/health']!.get!.responses)).toEqual(['200', '500']);
    for (const p of ['/events', '/generate', '/names', '/validate']) {
      const r429 = spec.paths[p]!.post!.responses['429'] as { headers?: Record<string, { schema: Schema }> };
      expect(r429.headers?.['Retry-After']?.schema.type, p).toBe('integer');
    }
  });
  it('문자열 입력 필드의 maxLength — 자유 입력 셋은 64 · 나머지는 1024', () => {
    for (const r of ['GenerateRequest', 'NamesRequest']) {
      const ctxProps = schemas[r]!.properties!['context']!.properties!;
      for (const f of ['owner', 'system', 'purpose']) expect(ctxProps[f]!.maxLength, `${r}.${f}`).toBe(MAX_CONTEXT_CHARS);
      for (const f of ['env', 'region']) expect(ctxProps[f]!.maxLength, `${r}.${f}`).toBe(1024);
    }
    for (const f of ['provider', 'resource_type', 'name']) expect(schemas['ValidateRequest']!.properties![f]!.maxLength, f).toBe(1024);
    expect(schemas['EventRequest']!.properties!['event']!.maxLength).toBe(1024);
    for (const r of ['GenerateRequest', 'ValidateRequest']) expect(schemas[r]!.properties!['rules_version']!.maxLength, r).toBe(1024);
  });
  it('info 설명은 켜진 CSP 만 연다고 말한다 · /llms.txt · /catalog.json 을 가리킨다 (D45 · D46)', () => {
    expect(spec.info.description).not.toMatch(/for AWS, GCP and Azure/);
    expect(spec.info.description).toContain('request.provider_not_enabled');
    expect(spec.info.description).toContain('/catalog.json');
    expect(spec.info.description).toContain('/llms.txt');
  });
  it('EventRequest.target — ui_copy 의 여섯 값 그대로 · 설명이 ui_copy 에만 필요하다고 말한다 (D56)', () => {
    const t = schemas['EventRequest']!.properties!['target']!;
    expect(t.enum).toEqual([...UI_COPY_TARGETS]);
    expect(t.description).toMatch(/ui_copy/);
    expect(schemas['EventRequest']!.required).toEqual(['event']);
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

describe('public/openapi.json — /names (D39)', () => {
  const item = () => schemas['NameItem']!.properties!;
  it('NamesRequest — resources 1~200 · count 1~99 · role pattern · provider enum · context 는 generate 와 같다', () => {
    const r = schemas['NamesRequest']! as Schema & { properties: Record<string, Schema & { minItems?: number; maxItems?: number }> };
    expect(r.required!.sort()).toEqual(['context', 'provider', 'resources']);
    expect(r.properties['provider']!.enum).toEqual([...ENABLED_PROVIDERS]);
    expect(r.properties['resources']).toMatchObject({ minItems: 1, maxItems: 200 });
    const it0 = r.properties['resources']!.items! as Schema & { properties: Record<string, Schema & { minimum?: number; maximum?: number; pattern?: string }> };
    expect(it0.properties['count']).toMatchObject({ type: 'integer', minimum: 1, maximum: 99 });
    expect(it0.properties['role']!.pattern).toBe('^[a-z0-9]{2,16}$');
    // kind 는 값 이름(대문자 · 소문자-하이픈 둘 다 있다)이라 pattern 을 두지 않고 길이만 건다 — 판정은 selection.unknown_kind (D52)
    expect(it0.properties['kind']).toMatchObject({ type: 'string', maxLength: 1024 });
    expect(it0.properties['kind']!.pattern).toBeUndefined();
    expect(r.properties['context']).toEqual(schemas['GenerateRequest']!.properties!['context']);
  });
  it('NameItem — scope enum 은 ScopeId 전부 · uniqueness enum 둘 · 설명은 llms.txt 와 같은 문장', () => {
    expect(item()['scope']!.enum!.sort()).toEqual(Object.keys(SCOPES).sort());
    expect(Object.keys(SCOPES).length).toBeGreaterThan(14); // 손 16 + 들인 Azure 부모 리소스 범위 — 수는 scopes.test 가 센다
    expect(item()['uniqueness']!.enum).toEqual(['csp', 'none']);
    expect(item()['kind']).toMatchObject({ type: 'string' });
    expect(item()['kind_token']).toMatchObject({ type: 'string', pattern: `^[a-z0-9]{1,${MAX_KIND_CHARS}}$` });
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

describe('계약 시험 — 실제 응답을 명세의 스키마로 검증한다 (ajv · D25)', () => {
  // OpenAPI 3.0 의 example 키워드 때문에 strict:false. 명세 전체를 한 스키마로 넣고 #/components/schemas/X 를 그 안에서 찾는다
  const ajv = new Ajv({ strict: false, allErrors: true });
  ajv.addSchema({ $id: 'openapi', components: spec.components }, 'openapi');
  const validatorFor = (name: string) => ajv.getSchema(`openapi#/components/schemas/${name}`)!;
  /** 경로 · 메서드 · 상태 코드의 응답 스키마 이름 — /llms.txt 는 명세 밖이라 ErrorResponse 로 본다 */
  function schemaNameOf(method: string, path: string, status: number): string {
    if (path === '/llms.txt') return 'ErrorResponse';
    const op = spec.paths[path.replace(/^\/v1\//, '/')]![method.toLowerCase() as 'get' | 'post']!;
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

  it('names 표본 — 정상 · 항목 FAIL · 꺼진 CSP · 충돌 · 종류 · 400 selection.* 14개 전부 · 409', () => {
    const ids = samples.map((x) => x.id);
    for (const id of ['names-ok', 'names-item-fail', '400-names-provider-not-enabled', 'names-conflict', 'names-kinds', '400-names-provider', '409-names-rules-version']) expect(ids, id).toContain(id);
    const codesSeen = new Set(samples.filter((x) => x.path === '/v1/names' && x.status === 400).flatMap((x) => (x.body.errors as { code: string }[]).map((e) => e.code)));
    expect(SELECTION_CODES_IN_SAMPLES).toHaveLength(14);
    for (const c of SELECTION_CODES_IN_SAMPLES) expect([...codesSeen], c).toContain(c);
    // uniqueness "none"(AWS Name 태그)은 꺼진 CSP 에만 있다 — 켜진 GCP 의 항목은 전부 csp (D45)
    const ok = samples.find((x) => x.id === 'names-ok')!.body.data.gcp.items as { uniqueness: string }[];
    expect(ok.length).toBeGreaterThan(0);
    for (const i of ok) expect(i.uniqueness).toBe('csp');
    expect(samples.find((x) => x.id === '400-names-provider-not-enabled')!.body.errors[0].code).toBe('request.provider_not_enabled');
    // 종류 — 토큰이 붙은 항목은 kind · kind_token 둘 다, 기본값 항목은 kind 만 (D52)
    const kinds = samples.find((x) => x.id === 'names-kinds')!.body.data.gcp.items as { name: string; kind?: string; kind_token?: string }[];
    expect(kinds.map((i) => [i.name, i.kind, i.kind_token])).toEqual([
      ['billing-trade-prod-ane3-sql-pg-01', 'POSTGRES', 'pg'], ['billing-trade-prod-ane3-sql-pg-02', 'POSTGRES', 'pg'],
      ['billing-trade-prod-ane3-rp-snap-01', 'snapshot-schedule', 'snap'], ['billing-trade-prod-bs-01', 'EXTERNAL_MANAGED', undefined],
    ]);
    const conflict = samples.find((x) => x.id === 'names-conflict')!.body.data.gcp;
    expect(conflict.valid).toBe(false);
    expect(conflict.conflicts).toHaveLength(1);
  });

  it('events 표본 — ui_copy 여섯 target 은 200 · target 이 없거나 모르는 값이면 400 · 요청 본문은 EventRequest 에 맞는다 (D56)', () => {
    for (const t of UI_COPY_TARGETS) {
      const x = samples.find((s) => s.id === `events-ui-copy-${t}`);
      expect(x?.status, t).toBe(200);
      expect(validatorFor('EventRequest')({ event: 'ui_copy', target: t }), t).toBe(true);
    }
    expect(samples.find((s) => s.id === '400-events-ui-copy-no-target')!.status).toBe(400);
    expect(samples.find((s) => s.id === '400-events-ui-copy-unknown-target')!.status).toBe(400);
    expect(validatorFor('EventRequest')({ event: 'ui_copy', target: 'clipboard' })).toBe(false);
  });

  it('catalog 표본 — 200 본문은 CatalogResponse 에 맞고 켜진 CSP 의 행 수 그대로 · 429 도 명세에 있다 (D46)', () => {
    const ok = samples.find((s) => s.id === 'catalog-json')!;
    expect(ok.status).toBe(200);
    expect(Object.keys(ok.body.providers)).toEqual([...ENABLED_PROVIDERS]);
    for (const p of ENABLED_PROVIDERS) expect(ok.body.providers[p].rows, p).toHaveLength(catalogFor(p).length);
    expect(samples.find((s) => s.id === '429-catalog-json')!.status).toBe(429);
    // 검사기 자체 — 꼴이 틀리면 거부한다
    expect(validatorFor('CatalogResponse')({ version: VERSION })).toBe(false);
    expect(validatorFor('CatalogResponse')({ version: VERSION, providers: { gcp: { meta: null, rows: [{}], regions: [] } } })).toBe(false);
  });

  it('kind 표본 전부 — 켜진 CSP 에서 종류가 있는 규칙마다 허용 값 전부를 /v1/names 에 넣으면 요청 · 응답이 명세에 맞고 토큰이 kind_token 꼴이다 (D52)', async () => {
    const reqV = validatorFor('NamesRequest');
    const resV = validatorFor('NamesResponse');
    let n = 0;
    for (const p of ENABLED_PROVIDERS) {
      for (const rule of rulesFor(p)) {
        for (const kind of rule.kinds?.allowed ?? []) {
          const body = { provider: p, context: { ...ctxExample, region: 'asia-northeast3-a' }, resources: [{ type: rule.resourceType, kind }] };
          expect(reqV(body), `${rule.resourceType} ${kind} 요청: ${ajv.errorsText(reqV.errors)}`).toBe(true);
          const res = await json((await req(app, '/v1/names', jsonPost(body))).res);
          expect(resV(res), `${rule.resourceType} ${kind} 응답: ${ajv.errorsText(resV.errors)}`).toBe(true);
          const item = res.data[p].items[0] as { kind?: string; kind_token?: string };
          expect(item.kind, `${rule.resourceType} ${kind}`).toBe(kind);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(20);
  });

  it('rules_version 다섯 경우 — null · 숫자 · 객체 · 1025자는 400, 빈 문자열은 409 (명세의 상태 코드)', () => {
    const status = (id: string) => samples.find((x) => x.id === id)!.status;
    expect(['400-rules-version-null', '400-rules-version-number', '400-rules-version-object', '400-rules-version-too-long'].map(status)).toEqual([400, 400, 400, 400]);
    expect(status('409-rules-version-empty')).toBe(409);
    for (const p of ['/generate', '/validate']) expect(keys(spec.paths[p]!.post!.responses), p).toEqual(expect.arrayContaining(['400', '409']));
  });

  it('example 요청은 200 이고 /generate example 은 켜진 CSP 규칙 수만큼', async () => {
    const body = await json((await req(app, '/v1/generate', jsonPost(exampleOf('/generate')))).res);
    expect(validatorFor('GenerateResponse')(body)).toBe(true);
    expect(Object.values(body.data as Record<string, object>).reduce((n, o) => n + Object.keys(o).length, 0)).toBe(ENABLED_PROVIDERS.reduce((n, p) => n + rulesFor(p).length, 0));
    const n = await json((await req(app, '/v1/names', jsonPost(exampleOf('/names')))).res);
    expect(validatorFor('NamesResponse')(n)).toBe(true);
    expect(n.data.gcp.valid).toBe(true);
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
