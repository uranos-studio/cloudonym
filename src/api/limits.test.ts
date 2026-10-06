import { describe, it, expect, vi } from 'vitest';
import { app } from './index';
import { req, jsonPost, beaconPost, json } from './test-support';

// 본문 · 필드 상한과 500 도 ErrorResponse 꼴
const ctx = { owner: 'infra', system: 'billing', purpose: 'trade', env: 'prd', region: 'kr' };

/** 본문 크기를 content-length 헤더로 알린다 — bodyLimit 의 헤더 분기. jsonPost 는 헤더가 없어 스트림 분기로 간다 */
function sizedPost(body: unknown): RequestInit {
  const text = JSON.stringify(body);
  return { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(new TextEncoder().encode(text).length) }, body: text };
}

describe('본문 16KB 상한 — 413 · ErrorResponse 꼴', () => {
  it('20KB 본문 (content-length 있음) → 413 { success:false, errors }', async () => {
    const { res } = await req(app, '/v1/generate', sizedPost({ context: { ...ctx, owner: 'a'.repeat(20 * 1024) } }));
    expect(res.status).toBe(413);
    expect(await json(res)).toEqual({ success: false, errors: [{ code: 'request.body_too_large', params: { max_bytes: 16384 }, message: 'Request body is larger than 16384 bytes' }] });
  });
  it('20KB 본문 (content-length 없음 · 스트림을 읽다가 넘음) → 역시 413 — 400 「JSON 아님」으로 나뉘지 않는다', async () => {
    const { res } = await req(app, '/v1/events', beaconPost({ event: 'ui_visit', pad: 'x'.repeat(20 * 1024) }));
    expect(res.status).toBe(413);
    expect(await json(res)).toEqual({ success: false, errors: [{ code: 'request.body_too_large', params: { max_bytes: 16384 }, message: 'Request body is larger than 16384 bytes' }] });
  });
  it('validate name 100KB → 413 이 빨리 나온다 (500 ms 안 · 전에는 제곱 루프로 9 초)', async () => {
    const t0 = performance.now();
    const { res } = await req(app, '/v1/validate', jsonPost({ provider: 'aws', resource_type: 'vpc', name: 'a-'.repeat(50_000) }));
    const ms = performance.now() - t0;
    expect(res.status).toBe(413);
    expect(ms).toBeLessThan(500);
  });
  it('preflight 는 bodyLimit 과 합쳐도 그대로 204', async () => {
    const { res } = await req(app, '/v1/validate', { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('필드 길이 상한(자유 입력 64 · 나머지 1024) — 본문 상한과 별개로 400', () => {
  it('validate name 1025자(본문 약 1.1KB) → 400 name: 1024자를 넘는다', async () => {
    const { res } = await req(app, '/v1/validate', jsonPost({ provider: 'aws', resource_type: 'vpc', name: 'a'.repeat(1025) }));
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ success: false, errors: [{ code: 'request.field_too_long', field: 'name', params: { max: 1024 }, message: "'name' is longer than 1024 characters" }] });
  });
  it('name 1024자 · 가운데 하이픈 → 400 아님 (200) 이고 빨리 끝난다', async () => {
    const t0 = performance.now();
    const { res } = await req(app, '/v1/validate', jsonPost({ provider: 'aws', resource_type: 'vpc', name: 'a-'.repeat(512) }));
    expect(res.status).toBe(200);
    expect(performance.now() - t0).toBeLessThan(500);
  });
  it('aws.vpc(최대 256자) 에 257자 → 200 + 길이 위반 (상한이 엔진의 판정을 가리지 않는다)', async () => {
    const { res } = await req(app, '/v1/validate', jsonPost({ provider: 'aws', resource_type: 'vpc', name: 'a'.repeat(257) }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.valid).toBe(false);
    expect(body.violations).toContainEqual({ code: 'name.too_long', params: { actual: 257, max: 256 }, message: 'Name is 257 characters long; the maximum is 256' });
  });
  it('generate context owner 65자 → 400 owner: 64자를 넘는다 · 딱 64자는 200', async () => {
    const { res } = await req(app, '/v1/generate', jsonPost({ context: { ...ctx, owner: 'a'.repeat(65) } }));
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ success: false, errors: [{ code: 'request.field_too_long', field: 'owner', params: { max: 64 }, message: "'owner' is longer than 64 characters" }] });
    expect((await req(app, '/v1/generate', jsonPost({ context: { ...ctx, owner: 'a'.repeat(64) } }))).res.status).toBe(200);
  });
  it('generate context system · purpose 65자 · env 1025자 → 오류 셋, 문맥 필드 순서', async () => {
    const { res } = await req(app, '/v1/generate', jsonPost({ context: { ...ctx, system: 's'.repeat(65), purpose: 'p'.repeat(65), env: 'e'.repeat(1025) } }));
    expect(res.status).toBe(400);
    expect((await json(res)).errors.map((e: { field: string; params: { max: number } }) => [e.field, e.params.max])).toEqual([['system', 64], ['purpose', 64], ['env', 1024]]);
  });
  it('긴 provider · resource_type · event 는 오류 문구에 값을 되돌려 주지 않는다', async () => {
    const long = 'z'.repeat(2000);
    const p = await json((await req(app, '/v1/validate', jsonPost({ provider: long, resource_type: 'vpc', name: 'x' }))).res);
    expect(p).toEqual({ success: false, errors: [{ code: 'request.field_too_long', field: 'provider', params: { max: 1024 }, message: "'provider' is longer than 1024 characters" }] });
    const r = await json((await req(app, '/v1/validate', jsonPost({ provider: 'aws', resource_type: long, name: 'x' }))).res);
    expect(r).toEqual({ success: false, errors: [{ code: 'request.field_too_long', field: 'resource_type', params: { max: 1024 }, message: "'resource_type' is longer than 1024 characters" }] });
    const e = await json((await req(app, '/v1/events', beaconPost({ event: long }))).res);
    expect(e).toEqual({ success: false, errors: [{ code: 'request.field_too_long', field: 'event', params: { max: 1024 }, message: "'event' is longer than 1024 characters" }] });
  });
});

describe('onError — 처리하지 못한 예외도 JSON 500 (안전망)', () => {
  // 운영 라우트를 더하지 않는다: ExecutionContext 없이 부르면 c.executionCtx 가 실제로 던진다
  it('v1 라우트에서 던지면 500 { success:false, errors:[내부 오류] } · console.error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await app.request('/v1/generate', jsonPost({ context: ctx }), {});
      expect(res.status).toBe(500);
      expect(res.headers.get('content-type')).toMatch(/^application\/json/);
      expect(await json(res)).toEqual({ success: false, errors: [{ code: 'server.internal_error', message: 'Internal error' }] });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
  it('root 라우트(/llms.txt)에서 던져도 같은 꼴', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await app.request('/llms.txt', undefined, {});
      expect(res.status).toBe(500);
      expect(await json(res)).toEqual({ success: false, errors: [{ code: 'server.internal_error', message: 'Internal error' }] });
    } finally {
      spy.mockRestore();
    }
  });
});
