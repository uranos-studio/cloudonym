// 시험 전용 도우미 — 소스(index.ts · v1.ts · telemetry.ts)는 이 파일을 import 하지 않는다
import type { Hono } from 'hono';
import type { App, Bindings } from './env';
import { generateMany } from '../core/engine';
import { labelsFor } from '../core/labels';
import { CONFLICT_CONTEXT, CONFLICT_SELECTION } from '../core/__fixtures__/conflict';
import { toWireNames } from './serialize';
import { VERSION } from '../version';

/** Hono 의 ExecutionContext 타입은 props 를 요구한다 — 빼면 TS2345 */
export interface FakeCtx { waitUntil: (p: Promise<unknown>) => void; passThroughOnException: () => void; props: Record<string, never> }

export function fakeCtx(): { ctx: FakeCtx; promises: Promise<unknown>[] } {
  const promises: Promise<unknown>[] = [];
  return { ctx: { waitUntil: (p) => { promises.push(p); }, passThroughOnException: () => {}, props: {} }, promises };
}

type Requestable = Pick<Hono<App>, 'request'>;

/** app.request 를 env 와 ExecutionContext 와 함께 부른다 — env 를 빼면 c.env 가 undefined, ctx 를 빼면 c.executionCtx 가 throw 해 500 이 된다 */
export async function req(app: Requestable, path: string, init?: RequestInit, env: Bindings = {}): Promise<{ res: Response; promises: Promise<unknown>[] }> {
  const { ctx, promises } = fakeCtx();
  const res = await app.request(path, init, env, ctx);
  return { res, promises };
}

/** 응답 본문 — Workers 타입의 res.json() 은 Promise<unknown> 이라 시험이 자유롭게 들여다보도록 느슨하게 둔다 */
export type Loose = any;
export const json = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;

export function jsonPost(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

/** 응답이 끝난 뒤에도 아직 pending 인가 — waitUntil 이 응답을 막지 않았다는 증거.
 *  반대편을 Promise.resolve(true) 로 두면 이미 끝난 p 도 true 가 된다(p.then 의 파생 Promise 가 한 마이크로태스크 늦다 · challenge M-1).
 *  매크로태스크(setTimeout 0) 뒤에 true 를 내면 끝난 p 의 반응이 먼저 settle 한다. 자기 시험: test-support.test.ts */
export function isPending(p: Promise<unknown>): Promise<boolean> {
  return Promise.race([p.then(() => false, () => false), new Promise<boolean>((r) => setTimeout(() => r(true), 0))]);
}

/** 가짜 KV — mode: ok(정상) · throw(get 이 던진다) · hang(put 이 영원히 끝나지 않는다) */
export function fakeKv(mode: 'ok' | 'throw' | 'hang' = 'ok'): { kv: KVNamespace; store: Map<string, string> } {
  const store = new Map<string, string>();
  const kv = {
    get: (key: string): Promise<string | null> => (mode === 'throw' ? Promise.reject(new Error('kv get 실패')) : Promise.resolve(store.get(key) ?? null)),
    put: (key: string, value: string): Promise<void> => {
      if (mode === 'hang') return new Promise<void>(() => {});
      store.set(key, value);
      return Promise.resolve();
    },
  };
  return { kv: kv as unknown as KVNamespace, store };
}

/** 화면 비콘과 같은 요청 — 브라우저가 붙이는 Sec-Fetch-Site: same-origin 을 싣는다. /v1/events 는 이 헤더가 없으면 403 이다 (보안 리뷰 M-2) */
export function beaconPost(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8', 'sec-fetch-site': 'same-origin', ...headers }, body: JSON.stringify(body) };
}

/** 가짜 Rate Limiting 바인딩 — mode: ok(통과) · deny(초과) · throw(limit 이 던진다). 받은 key 를 모은다 */
export function fakeLimiter(mode: 'ok' | 'deny' | 'throw' = 'ok'): { limiter: RateLimit; keys: string[] } {
  const keys: string[] = [];
  const limiter = {
    limit: ({ key }: { key: string }): Promise<{ success: boolean }> => {
      keys.push(key);
      if (mode === 'throw') return Promise.reject(new Error('limiter 실패'));
      return Promise.resolve({ success: mode === 'ok' });
    },
  };
  return { limiter: limiter as unknown as RateLimit, keys };
}

/** 대표 응답 한 건 — 계약 시험(openapi.test)과 한글 0 시험(no-hangul.test)이 같은 표본을 쓴다 */
export interface Sample { id: string; method: 'GET' | 'POST'; path: string; status: number; body: Loose }

const SAMPLE_CTX = { owner: 'platform', system: 'billing', purpose: 'trade', env: 'prd', region: 'kr' };

/**
 * ASCII 입력만 쓰는 대표 요청 집합의 응답 — 정상 · 예약어 · 길이 초과 · 별칭 · 파싱 실패 · 모양 오류 · 16KB · 403 · 429(v1 · /llms.txt) ·
 * rules_version 409 · 400 · 500 · validate 무효/유효 · names(정상 · 항목 FAIL · Name 태그 · 충돌 · selection.* 400 · 409) · health. 입력이 ASCII 라 응답의 한글은 전부 시스템 문구다(면제가 필요 없다)
 */
export async function collectSamples(app: Requestable, rulesVersion: string): Promise<Sample[]> {
  const out: Sample[] = [];
  const add = async (id: string, method: 'GET' | 'POST', path: string, init?: RequestInit, env: Bindings = {}, withCtx = true) => {
    const res = withCtx ? (await req(app, path, init, env)).res : await app.request(path, init, env);
    const text = await res.text();
    out.push({ id, method, path, status: res.status, body: JSON.parse(text) as Loose });
  };
  const gen = (id: string, body: unknown) => add(id, 'POST', '/v1/generate', jsonPost(body));
  const val = (id: string, body: unknown) => add(id, 'POST', '/v1/validate', jsonPost(body));
  await gen('generate-ok', { context: SAMPLE_CTX });
  await gen('generate-reserved-windows', { context: { ...SAMPLE_CTX, system: 'windows' }, providers: ['azure'] });
  await gen('generate-long-values', { context: { owner: 'platformengineering', system: 'paymentsettlement', purpose: 'reconciliation', env: 'dev', region: 'global' } });
  await gen('generate-shrink-fail', { context: { ...SAMPLE_CTX, system: 'a-long', purpose: 'longpurpose' }, providers: ['azure'] });
  await gen('generate-label-limits', { context: { ...SAMPLE_CTX, owner: 'o'.repeat(257) } });
  await gen('generate-label-transform', { context: { ...SAMPLE_CTX, owner: 'In.Fra' }, providers: ['gcp'] });
  await gen('generate-aws-tag-chars', { context: { ...SAMPLE_CTX, owner: 'team#1' }, providers: ['aws'] });
  await gen('generate-env-alias', { context: { ...SAMPLE_CTX, env: 'production', region: 'koreacentral' } });
  await gen('generate-pinned-current', { context: SAMPLE_CTX, providers: ['gcp'], rules_version: rulesVersion });
  await gen('400-env-qa', { context: { ...SAMPLE_CTX, env: 'qa' } });
  await gen('400-context-empty-and-mars', { context: { ...SAMPLE_CTX, owner: '', region: 'mars' } });
  await gen('400-providers-oci-twice', { context: SAMPLE_CTX, providers: ['oci', 'gcp', 'oci'] });
  await gen('400-providers-empty', { context: SAMPLE_CTX, providers: [] });
  await gen('400-context-not-object', { context: null });
  await gen('400-body-not-object', [1, 2]);
  await gen('400-field-too-long', { context: { ...SAMPLE_CTX, owner: 'a'.repeat(1025) } });
  await add('400-not-json', 'POST', '/v1/generate', { method: 'POST', body: 'not json' });
  await add('413-body-too-large', 'POST', '/v1/generate', jsonPost({ context: { ...SAMPLE_CTX, owner: 'a'.repeat(20 * 1024) } }));
  await gen('409-rules-version', { context: SAMPLE_CTX, rules_version: '2026-01-01.1' });
  await gen('409-rules-version-empty', { context: SAMPLE_CTX, rules_version: '' });
  await gen('400-rules-version-null', { context: SAMPLE_CTX, rules_version: null });
  await gen('400-rules-version-number', { context: SAMPLE_CTX, rules_version: 20260929 });
  await gen('400-rules-version-object', { context: SAMPLE_CTX, rules_version: { v: 1 } });
  await gen('400-rules-version-too-long', { context: SAMPLE_CTX, rules_version: 'x'.repeat(1025) });
  const names = (id: string, body: unknown) => add(id, 'POST', '/v1/names', jsonPost(body));
  const pick = (resources: unknown, provider = 'azure') => ({ provider, context: SAMPLE_CTX, resources });
  await names('names-ok', pick([{ type: 'virtual_machine', count: 2 }, { type: 'subnet', count: 2 }, { type: 'managed_identity', role: 'db' }, { type: 'resource_group' }, { type: 'storage_account' }]));
  await names('names-item-fail', { provider: 'azure', context: { ...SAMPLE_CTX, system: 'a-long', purpose: 'longpurpose' }, resources: [{ type: 'virtual_machine_windows', count: 2 }, { type: 'resource_group' }] });
  await names('names-name-tag', pick([{ type: 'ec2_instance' }, { type: 'vpc' }, { type: 's3_bucket' }], 'aws'));
  await names('names-pinned-current', { ...pick([{ type: 'project_id' }], 'gcp'), rules_version: rulesVersion });
  // 충돌 fixture (D41) — 시험 전용 규칙은 HTTP 로 닿지 않으므로(규칙 표에 없다) 라우터와 같은 직렬화기로 직접 만든다. HTTP 쪽은 names-conflict.test
  out.push({ id: 'names-conflict', method: 'POST', path: '/v1/names', status: 200,
    body: JSON.parse(JSON.stringify(toWireNames(generateMany(CONFLICT_CONTEXT, 'azure', CONFLICT_SELECTION), CONFLICT_SELECTION.map((i) => i.rule), labelsFor(CONFLICT_CONTEXT, 'azure'), [], VERSION))) as Loose });
  await names('400-names-provider', { ...pick([{ type: 'vpc' }]), provider: 'oci' });
  await names('400-names-not-array', pick('virtual_machine'));
  await names('400-names-empty', pick([]));
  await names('400-names-too-many-items', pick(Array.from({ length: 201 }, () => ({ type: 'resource_group' }))));
  await names('400-names-item-shapes', pick([1, { type: 'nope' }, { type: 'resource_group' }, { type: 'resource_group' }, { type: 'virtual_machine', count: 0 }, { type: 'storage_account', count: 2 }, { type: 'virtual_machine_windows', role: 'db' }, { type: 'managed_identity', role: 'Sync' }]));
  await names('400-names-too-many-names', pick([{ type: 'virtual_machine', count: 99 }, { type: 'virtual_machine_windows', count: 99 }, { type: 'subnet', count: 3 }]));
  await names('400-names-context-and-selection', { provider: 'gcp', context: { ...SAMPLE_CTX, env: 'qa' }, resources: [{ type: 'service_account', count: 2 }] });
  await names('409-names-rules-version', { ...pick([{ type: 'resource_group' }]), rules_version: '2026-01-01.1' });
  await val('validate-invalid-too-long', { provider: 'gcp', resource_type: 'service_account', name: 'platform-billing-trade-prd-kr-sa-sync' });
  await val('validate-invalid-microsoft123', { provider: 'azure', resource_type: 'storage_account', name: 'microsoft123' });
  await val('validate-invalid-many', { provider: 'aws', resource_type: 's3_bucket', name: 'xn--192.168.0.1-s3alias' });
  await val('validate-valid', { provider: 'gcp', resource_type: 'project_id', name: 'billing-trade-prd' });
  await val('400-validate-unknown-type', { provider: 'gcp', resource_type: 'nope', name: 'x' });
  await val('400-validate-unknown-provider', { provider: 'oci', resource_type: 'x', name: 'y' });
  await val('400-validate-name-not-string', { provider: 'gcp', resource_type: 'project_id', name: 3 });
  await val('409-validate-rules-version', { provider: 'gcp', resource_type: 'project_id', name: 'x', rules_version: 'old' });
  await add('events-ok', 'POST', '/v1/events', beaconPost({ event: 'ui_visit' }));
  await add('400-events-unknown', 'POST', '/v1/events', beaconPost({ event: 'api_generate' }));
  await add('403-events-cross-site', 'POST', '/v1/events', beaconPost({ event: 'ui_visit' }, { 'sec-fetch-site': 'cross-site' }));
  await add('429-generate', 'POST', '/v1/generate', jsonPost({ context: SAMPLE_CTX }), { API_LIMITER: fakeLimiter('deny').limiter });
  await add('429-llms-txt', 'GET', '/llms.txt', undefined, { API_LIMITER: fakeLimiter('deny').limiter });
  // ExecutionContext 없이 부르면 c.executionCtx 가 실제로 던진다 — 운영 라우트를 더하지 않고 500 경로를 탄다
  await add('500-internal', 'POST', '/v1/generate', jsonPost({ context: SAMPLE_CTX }), {}, false);
  await add('health', 'GET', '/v1/health');
  return out;
}
