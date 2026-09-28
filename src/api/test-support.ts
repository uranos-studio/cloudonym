// 시험 전용 도우미 — 소스(index.ts · v1.ts · telemetry.ts)는 이 파일을 import 하지 않는다
import type { Hono } from 'hono';
import type { App, Bindings } from './env';

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
