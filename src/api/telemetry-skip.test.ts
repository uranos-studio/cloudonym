// 점검 요청 건너뛰기 (D99) — 실제 라우터로 부른다. 헤더는 계측만 바꾸고 요청 제한 · 응답에는 손대지 않는다
import { describe, it, expect } from 'vitest';
import { app } from './index';
import { TELEMETRY_SKIP_HEADER } from './telemetry';
import { beaconPost, fakeKv, fakeLimiter, jsonPost, req } from './test-support';
import type { Bindings } from './env';

const SECRET = 'route-skip-secret-abcdef';
const VALIDATE = { provider: 'gcp', resource_type: 'storage_bucket', name: 'payments-prod-bucket' };

/** jsonPost 에 헤더를 더한다 */
function post(body: unknown, headers: Record<string, string> = {}): RequestInit {
  const r = jsonPost(body);
  return { ...r, headers: { ...(r.headers as Record<string, string>), ...headers } };
}

async function call(path: string, init: RequestInit | undefined, env: Bindings): Promise<{ status: number; body: string; kvKeys: string[] }> {
  const { kv, store } = fakeKv();
  const { res, promises } = await req(app, path, init, { CLOUDONYM_KV: kv, ...env });
  const body = await res.text();
  await Promise.all(promises);
  return { status: res.status, body, kvKeys: [...store.keys()] };
}

describe('점검 헤더 — 라우터 단위', () => {
  it('POST /v1/validate · GET /llms.txt — 맞는 헤더는 세지 않고, 응답 상태 · 본문은 헤더 없는 요청과 같다', async () => {
    const env = { TELEMETRY_SKIP_TOKEN: SECRET };
    const plain = await call('/v1/validate', post(VALIDATE), env);
    const skipped = await call('/v1/validate', post(VALIDATE, { [TELEMETRY_SKIP_HEADER]: SECRET }), env);
    expect(plain.kvKeys).toEqual([expect.stringMatching(/^stats:api_validate:/)]);
    expect(skipped.kvKeys).toEqual([]);
    expect(skipped.status).toBe(200);
    expect(skipped.status).toBe(plain.status);
    expect(skipped.body).toBe(plain.body);

    const llmsPlain = await call('/llms.txt', undefined, env);
    const llmsSkipped = await call('/llms.txt', { headers: { [TELEMETRY_SKIP_HEADER]: SECRET } }, env);
    expect(llmsPlain.kvKeys).toEqual([expect.stringMatching(/^stats:llms_txt_accessed:/)]);
    expect(llmsSkipped.kvKeys).toEqual([]);
    expect(llmsSkipped.body).toBe(llmsPlain.body);
  });
  it('틀린 값 · 비밀 미설정이면 라우터에서도 센다', async () => {
    const wrong = await call('/v1/validate', post(VALIDATE, { [TELEMETRY_SKIP_HEADER]: `${SECRET}-x` }), { TELEMETRY_SKIP_TOKEN: SECRET });
    expect(wrong.kvKeys).toHaveLength(1);
    const unset = await call('/v1/validate', post(VALIDATE, { [TELEMETRY_SKIP_HEADER]: SECRET }), {});
    expect(unset.kvKeys).toHaveLength(1);
  });
  it('비밀 끝의 개행 · 공백은 떼고 비교한다 — 공백뿐인 비밀은 설정되지 않은 것으로 보고 센다', async () => {
    const newline = await call('/v1/validate', post(VALIDATE, { [TELEMETRY_SKIP_HEADER]: SECRET }), { TELEMETRY_SKIP_TOKEN: `${SECRET}\n` });
    expect(newline.kvKeys).toEqual([]);
    const blank = await call('/v1/validate', post(VALIDATE, { [TELEMETRY_SKIP_HEADER]: ' ' }), { TELEMETRY_SKIP_TOKEN: ' \n' });
    expect(blank.kvKeys).toHaveLength(1);
  });
  it('요청 제한은 헤더와 무관하다 — 맞는 헤더를 달아도 한도를 넘으면 429 · limiter 는 그 요청도 센다', async () => {
    const { limiter, keys } = fakeLimiter('deny');
    const denied = await call('/v1/validate', post(VALIDATE, { [TELEMETRY_SKIP_HEADER]: SECRET }), { TELEMETRY_SKIP_TOKEN: SECRET, API_LIMITER: limiter });
    expect(denied.status).toBe(429);
    expect(keys).toHaveLength(1);
  });
  it('POST /v1/events — 같은 규칙: 맞는 헤더면 세지 않는다 · 응답은 같다', async () => {
    const env = { TELEMETRY_SKIP_TOKEN: SECRET };
    const plain = await call('/v1/events', beaconPost({ event: 'ui_visit' }), env);
    const skipped = await call('/v1/events', beaconPost({ event: 'ui_visit' }, { [TELEMETRY_SKIP_HEADER]: SECRET }), env);
    expect(plain.kvKeys).toEqual([expect.stringMatching(/^stats:ui_visit:/)]);
    expect(skipped.kvKeys).toEqual([]);
    expect(skipped.status).toBe(plain.status);
    expect(skipped.body).toBe(plain.body);
  });
});
