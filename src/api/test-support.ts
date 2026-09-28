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

/** 응답이 끝난 뒤에도 아직 pending 인가 — waitUntil 이 응답을 막지 않았다는 증거 */
export function isPending(p: Promise<unknown>): Promise<boolean> {
  return Promise.race([p.then(() => false, () => false), Promise.resolve(true)]);
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
