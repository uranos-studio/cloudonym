import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from './index';
import { RATE_LIMIT } from './ratelimit';
import { req, jsonPost, beaconPost, json, fakeKv, fakeLimiter } from './test-support';

const ctx = { owner: 'infra', system: 'billing', purpose: 'trade', env: 'prod', region: 'asia-northeast3-a' };
const TOO_MANY = { success: false, errors: [{ code: 'request.rate_limited', params: { retry_after: 60 }, message: 'Too many requests; retry after 60 seconds' }] };
const ip = (h: Record<string, string> = {}) => ({ 'cf-connecting-ip': '203.0.113.7', ...h });

describe('요청 제한 — Rate Limiting 바인딩 API_LIMITER, 클라이언트 IP 당', () => {
  it('기본값은 60 초에 60 건 — wrangler.jsonc 의 ratelimits 와 같다', () => {
    expect(RATE_LIMIT).toEqual({ limit: 60, period: 60 });
    const text = readFileSync(join(import.meta.dirname, '../../wrangler.jsonc'), 'utf-8');
    const m = /"ratelimits"\s*:\s*\[\s*\{\s*"name"\s*:\s*"API_LIMITER"\s*,\s*"namespace_id"\s*:\s*"(\d+)"\s*,\s*"simple"\s*:\s*\{\s*"limit"\s*:\s*(\d+)\s*,\s*"period"\s*:\s*(\d+)\s*\}/.exec(text);
    expect(m, 'wrangler.jsonc 에 API_LIMITER 가 없다').not.toBeNull();
    expect(Number(m![2])).toBe(RATE_LIMIT.limit);
    expect(Number(m![3])).toBe(RATE_LIMIT.period);
  });
  for (const [path, init] of [
    ['/v1/generate', { ...jsonPost({ context: ctx }), headers: ip({ 'content-type': 'application/json' }) }],
    ['/v1/validate', { ...jsonPost({ provider: 'gcp', resource_type: 'project_id', name: 'my-proj' }), headers: ip({ 'content-type': 'application/json' }) }],
    ['/v1/events', beaconPost({ event: 'ui_visit' }, ip())],
  ] as const) {
    it(`${path} 초과 → 429 · Retry-After 60 · ErrorResponse · 카운터를 올리지 않는다`, async () => {
      const { limiter, keys } = fakeLimiter('deny');
      const { kv, store } = fakeKv();
      const { res, promises } = await req(app, path, init, { API_LIMITER: limiter, CLOUDONYM_KV: kv });
      expect(res.status).toBe(429);
      expect(res.headers.get('Retry-After')).toBe('60');
      expect(await json(res)).toEqual(TOO_MANY);
      expect(keys).toEqual(['203.0.113.7']);
      expect(promises).toHaveLength(0);
      expect(store.size).toBe(0);
    });
  }
  it('429 에도 CORS 헤더가 실린다 — 브라우저 클라이언트가 이유를 읽는다', async () => {
    const { limiter } = fakeLimiter('deny');
    const { res } = await req(app, '/v1/generate', jsonPost({ context: ctx }), { API_LIMITER: limiter });
    expect(res.status).toBe(429);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
  it('한도 안 → 200 · IP 헤더가 없으면 key 는 unknown', async () => {
    const { limiter, keys } = fakeLimiter('ok');
    const { res } = await req(app, '/v1/generate', jsonPost({ context: ctx }), { API_LIMITER: limiter });
    expect(res.status).toBe(200);
    expect(keys).toEqual(['unknown']);
  });
  it('바인딩이 없으면(로컬 · 시험) 건너뛴다 · limit 이 던지면 막지 않고 통과시킨다(fail-open)', async () => {
    expect((await req(app, '/v1/generate', jsonPost({ context: ctx }))).res.status).toBe(200);
    const { limiter, keys } = fakeLimiter('throw');
    const { res } = await req(app, '/v1/generate', jsonPost({ context: ctx }), { API_LIMITER: limiter });
    expect(res.status).toBe(200);
    expect(keys).toHaveLength(1);
  });
  it('GET /v1/health · OPTIONS preflight 는 세지 않는다', async () => {
    const { limiter, keys } = fakeLimiter('deny');
    expect((await req(app, '/v1/health', undefined, { API_LIMITER: limiter })).res.status).toBe(200);
    expect((await req(app, '/v1/generate', { method: 'OPTIONS' }, { API_LIMITER: limiter })).res.status).toBe(204);
    expect(keys).toEqual([]);
  });
  it('GET /llms.txt 초과 → 429 · Retry-After · CORS · 카운터 없음. HEAD 는 세지 않는다', async () => {
    const { limiter, keys } = fakeLimiter('deny');
    const { res, promises } = await req(app, '/llms.txt', { headers: ip() }, { API_LIMITER: limiter });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await json(res)).toEqual(TOO_MANY);
    expect(promises).toHaveLength(0);
    expect(keys).toEqual(['203.0.113.7']);
    const head = await req(app, '/llms.txt', { method: 'HEAD' }, { API_LIMITER: limiter });
    expect(head.res.status).toBe(200);
    expect(keys).toHaveLength(1);
  });
});

describe('/v1/events 는 화면(같은 출처)만 받는다', () => {
  const FORBIDDEN = { success: false, errors: [{ code: 'request.same_origin_only', message: 'Only same-origin requests from the Cloudonym page are accepted' }] };
  for (const site of [undefined, 'cross-site', 'same-site', 'none']) {
    it(`Sec-Fetch-Site ${site ?? '없음(curl 등)'} → 403 · 카운터를 올리지 않는다`, async () => {
      const { kv, store } = fakeKv();
      const headers: Record<string, string> = { 'content-type': 'text/plain' };
      if (site) headers['sec-fetch-site'] = site;
      const { res, promises } = await req(app, '/v1/events', { method: 'POST', headers, body: '{"event":"ui_generate"}' }, { CLOUDONYM_KV: kv });
      expect(res.status).toBe(403);
      expect(await json(res)).toEqual(FORBIDDEN);
      expect(promises).toHaveLength(0);
      expect(store.size).toBe(0);
    });
  }
  it('same-origin → 200 이고 응답에 CORS 헤더가 없다', async () => {
    const { res } = await req(app, '/v1/events', beaconPost({ event: 'ui_visit' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
  it('OPTIONS /v1/events 에 CORS preflight 응답을 주지 않는다 · generate · validate · health 는 그대로 CORS', async () => {
    const pre = await req(app, '/v1/events', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
    expect(pre.res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(pre.res.status).not.toBe(204);
    for (const path of ['/v1/generate', '/v1/validate']) {
      const { res } = await req(app, path, { method: 'OPTIONS' });
      expect(res.status, path).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin'), path).toBe('*');
    }
    const health = await req(app, '/v1/health', { headers: { origin: 'https://other.example' } });
    expect(health.res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('Worker 응답 보안 헤더 — secureHeaders', () => {
  const hasSecure = (res: Response, label: string) => {
    expect(res.headers.get('X-Content-Type-Options'), label).toBe('nosniff');
    expect(res.headers.get('Cross-Origin-Resource-Policy'), label).toBe('cross-origin');
    expect(res.headers.get('X-Frame-Options'), label).toBe('SAMEORIGIN');
  };
  it('200 · 400 · 403 · 404 · 413 · 429 모두에 nosniff · CORP cross-origin', async () => {
    hasSecure((await req(app, '/v1/health')).res, 'health');
    hasSecure((await req(app, '/v1/generate', jsonPost({}))).res, '400');
    hasSecure((await req(app, '/v1/events', jsonPost({ event: 'ui_visit' }))).res, '403');
    hasSecure((await req(app, '/v1/nope')).res, '404');
    hasSecure((await req(app, '/v1/generate', jsonPost({ context: { ...ctx, owner: 'a'.repeat(40 * 1024) } }))).res, '413');
    hasSecure((await req(app, '/v1/generate', jsonPost({ context: ctx }), { API_LIMITER: fakeLimiter('deny').limiter })).res, '429');
  });
  it('500(onError) 에도 싣는다 · HSTS 는 Worker 가 내지 않는다(존 설정에서 한 곳으로 켠다)', async () => {
    // ExecutionContext 없이 부르면 c.executionCtx 가 던져 500 이 된다 — root onError(/llms.txt) 와 v1 onError(/v1/generate) 둘 다
    const root = await app.request('/llms.txt', undefined, {});
    const sub = await app.request('/v1/generate', jsonPost({ context: ctx }), {});
    for (const [label, res] of [['root', root], ['v1', sub]] as const) {
      expect(res.status, label).toBe(500);
      hasSecure(res, label);
      expect(res.headers.get('Strict-Transport-Security'), label).toBeNull();
    }
  });
  it('/llms.txt 는 보안 헤더와 함께 Cache-Control · CORS · text/plain 을 그대로 낸다', async () => {
    const { res } = await req(app, '/llms.txt');
    hasSecure(res, 'llms');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Content-Type')).toMatch(/^text\/plain/);
  });
  it('CORS preflight 는 204 · Allow-Methods 그대로', async () => {
    const { res } = await req(app, '/v1/generate', { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET,POST,OPTIONS');
  });
});

describe('정적 UI 보안 헤더 — public/_headers', () => {
  const text = readFileSync(join(import.meta.dirname, '../../public/_headers'), 'utf-8');
  /** 규칙 이름(/* 등) → 헤더 줄들 */
  const rules = new Map<string, string[]>();
  let current = '';
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;
    if (!line.startsWith(' ')) { current = line.trim(); rules.set(current, []); continue; }
    rules.get(current)!.push(line.trim());
  }
  const all = rules.get('/*') ?? [];
  const header = (name: string) => all.find((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`))?.slice(name.length + 1).trim();
  it('/* 에 CSP(self 만 · frame-ancestors none · object-src none) · nosniff · DENY · Referrer-Policy', () => {
    const csp = header('Content-Security-Policy') ?? '';
    for (const d of ["default-src 'self'", "script-src 'self'", "style-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"]) expect(csp, d).toContain(d);
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
    expect(header('X-Content-Type-Options')).toBe('nosniff');
    expect(header('X-Frame-Options')).toBe('DENY');
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });
  it('Permissions-Policy 가 클립보드 쓰기를 막지 않는다 — 복사 버튼이 화면 기능이다', () => {
    expect(header('Permissions-Policy')).not.toMatch(/clipboard/);
  });
  it('/openapi.json 의 CORS 는 그대로 · index.html 에 인라인 스크립트 · 스타일이 없다(CSP self 가 성립하는 전제)', () => {
    expect(rules.get('/openapi.json')).toEqual(['Access-Control-Allow-Origin: *']);
    const html = readFileSync(join(import.meta.dirname, '../../index.html'), 'utf-8');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).not.toMatch(/<style\b|\sstyle=/);
  });
});
