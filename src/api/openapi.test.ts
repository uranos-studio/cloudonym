import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from './index';
import { req, jsonPost, json } from './test-support';

// openapi.json 을 읽는 데 필요한 만큼만 타입을 둔다
interface Schema { type?: string; properties?: Record<string, Schema>; required?: string[]; enum?: string[]; items?: Schema; additionalProperties?: Schema; $ref?: string }
interface Operation { requestBody: { content: Record<string, { example: unknown; schema: Schema }> }; responses: Record<string, unknown> }
interface Spec { openapi: string; servers: { url: string }[]; paths: Record<string, { post: Operation }>; components: { schemas: Record<string, Schema> } }

const spec = JSON.parse(readFileSync(join(import.meta.dirname, '../../public/openapi.json'), 'utf-8')) as Spec;
const schemas = spec.components.schemas;
const props = (name: string): string[] => Object.keys(schemas[name]!.properties!).sort();
const required = (name: string): string[] => schemas[name]!.required ?? [];
const exampleOf = (path: string): unknown => spec.paths[path]!.post.requestBody.content['application/json']!.example;
const keys = (o: object): string[] => Object.keys(o).sort();
/** 응답 키 ⊆ properties 이고 required ⊆ 응답 키 */
function fits(o: object, name: string): void {
  const k = keys(o);
  expect(k.filter((x) => !props(name).includes(x)), `${name} 에 없는 키`).toEqual([]);
  expect(required(name).filter((x) => !k.includes(x)), `${name} 의 required 가 응답에 없다`).toEqual([]);
}

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
  it('세 경로가 있고 각각 200 · 400 응답을 정의한다', () => {
    expect(keys(spec.paths)).toEqual(['/events', '/generate', '/validate']);
    for (const p of keys(spec.paths)) expect(keys(spec.paths[p]!.post.responses), p).toEqual(['200', '400']);
  });
});

describe('계약 시험 — example 요청의 응답 키 집합이 스키마와 같다', () => {
  it('/generate', async () => {
    const { res } = await req(app, '/v1/generate', jsonPost(exampleOf('/generate')));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(keys(body)).toEqual(props('GenerateResponse'));
    expect(keys(body.metadata)).toEqual(props('GenerateMetadata'));
    let items = 0;
    for (const perProvider of Object.values(body.data as Record<string, Record<string, object>>)) {
      for (const item of Object.values(perProvider)) {
        fits(item, 'ResourceItem');
        fits((item as { rule: object }).rule, 'RuleInfo');
        items++;
      }
    }
    expect(items).toBe(18);   // gcp 7 + azure 11
  });
  it('/validate — 무효 예시에는 suggested_name 이 있고 유효 이름에는 없다', async () => {
    const body = await json((await req(app, '/v1/validate', jsonPost(exampleOf('/validate')))).res);
    fits(body, 'ValidateResponse');
    expect(keys(body)).toEqual(props('ValidateResponse'));
    const ok = await json((await req(app, '/v1/validate', jsonPost({ provider: 'gcp', resource_type: 'project_id', name: 'billing-trade-prd' }))).res);
    fits(ok, 'ValidateResponse');
    expect(keys(ok)).toEqual(required('ValidateResponse').sort());
  });
  it('/events', async () => {
    const body = await json((await req(app, '/v1/events', jsonPost(exampleOf('/events')))).res);
    expect(keys(body)).toEqual(props('EventResponse'));
  });
  it('400 응답은 ErrorResponse 에 맞는다 (supported 있는 것과 없는 것)', async () => {
    const noSupported = await json((await req(app, '/v1/generate', jsonPost({ context: { owner: 'a', system: 'b', purpose: 'c', env: 'qa', region: 'kr' } }))).res);
    fits(noSupported, 'ErrorResponse');
    expect(keys(noSupported)).toEqual(['errors', 'success']);
    const withSupported = await json((await req(app, '/v1/validate', jsonPost({ provider: 'oci', resource_type: 'x', name: 'y' }))).res);
    fits(withSupported, 'ErrorResponse');
    expect(keys(withSupported)).toEqual(props('ErrorResponse'));
  });
});
