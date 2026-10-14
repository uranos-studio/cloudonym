import { describe, it, expect } from 'vitest';
import { app } from './index';
import { req, jsonPost } from './test-support';
import { MAX_BODY_BYTES } from './v1';
import { rulesFor } from '../core/constraints';
import { ENABLED_PROVIDERS } from '../core/types';

// HTTP 로 닿는 것은 켜진 CSP 뿐이다 (D45) — 켜는 CSP 가 늘면 이 시험이 그것도 돈다
// 400 오류 증폭 — 모르는 type 마다 지원 목록 전체를 싣지 않는다. 지원 목록은 응답 수준 supported 에 한 번만 (docs/decisions.md · 2026-10-06 응답 증폭)
const MAX_ERROR_RESPONSE_BYTES = 64 * 1024;

describe('POST /v1/names 400 오류 증폭', () => {
  for (const p of ENABLED_PROVIDERS) {
    it(`${p} · 모르는 type 200개 → supported 는 응답에 한 번만 · 응답 ${MAX_ERROR_RESPONSE_BYTES / 1024}KB 안`, async () => {
      const { res } = await req(app, '/v1/names', jsonPost({ provider: p, context: { owner: 'o', system: 's', purpose: 'p', env: 'prod', region: 'asia-northeast3-a' }, resources: Array.from({ length: 200 }, () => ({ type: 1 })) }));
      expect(res.status).toBe(400);
      const text = await res.text();
      expect(new TextEncoder().encode(text).length).toBeLessThan(MAX_ERROR_RESPONSE_BYTES);
      const body = JSON.parse(text);
      expect(body.errors).toHaveLength(200);
      expect(body.supported).toEqual(rulesFor(p).map((r) => r.resourceType));
      for (const e of body.errors) expect(e.params).toEqual({ index: e.params.index, value: '1' });
    });
  }
});

// 본문 상한이 32 KiB 로 오른 뒤(D100) — 본문을 상한까지 채운 최악 요청의 응답 크기. /v1/wizard 의 400 은 wizard-errors-cap.test.ts 에 있다
// (오류 수 상한 + 잘린 수 · D103 — 상한 전에는 32 KiB 본문이 틀린 slot 으로 8 MB, 틀린 preset 으로 1.2 MB 응답을 만들었다).
// 경로마다 오류 수가 가장 많은 최악 400 은 error-response-cap.test.ts 에 있다
describe('32 KiB 본문 — 경로마다 최악 응답', () => {
  const P = { owner: 'platform', system: 'billing', env: 'prod', region: 'ane3' };
  /** n 을 늘려 압축 본문이 상한 안인 가장 큰 요청 */
  function fit(mk: (n: number) => unknown): unknown {
    const size = (n: number) => new TextEncoder().encode(JSON.stringify(mk(n))).length;
    let lo = 1;
    let hi = 2;
    while (size(hi) <= MAX_BODY_BYTES) hi *= 2;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (size(m) <= MAX_BODY_BYTES) lo = m; else hi = m; }
    expect(size(lo)).toBeGreaterThan(MAX_BODY_BYTES * 0.9);
    return mk(lo);
  }
  const sizeOf = async (path: string, body: unknown) => {
    const { res } = await req(app, path, jsonPost(body));
    return { status: res.status, bytes: new TextEncoder().encode(await res.text()).length };
  };
  it(`/v1/names · /v1/generate · /v1/validate · /v1/events — 오류 응답 ${MAX_ERROR_RESPONSE_BYTES / 1024}KB 안`, async () => {
    const cases: [string, unknown][] = [
      ['/v1/names', fit((n) => ({ provider: 'gcp', context: { ...P, purpose: 'x' }, resources: Array.from({ length: n }, () => ({ type: 'nope' })) }))],
      ['/v1/generate', fit((n) => ({ context: { owner: '\u0001'.repeat(n), system: 'b', purpose: 'c', env: 'prod', region: 'x' } }))],
      ['/v1/validate', fit((n) => ({ provider: 'gcp', resourceType: 'storage_bucket', name: 'A_'.repeat(n) }))],
      ['/v1/events', fit((n) => ({ event: 'ui_generate', chip_rules: Array.from({ length: n }, () => 'gcp.nope') }))],
    ];
    for (const [path, body] of cases) {
      const r = await sizeOf(path, body);
      expect(r.status, path).toBeGreaterThanOrEqual(400);
      expect(r.bytes, path).toBeLessThan(MAX_ERROR_RESPONSE_BYTES);
    }
  });
  it('/v1/wizard 200 — 이름 181개 · 서비스 20 · 자유 입력 최악 계획의 응답이 /v1/names 의 상한(640KB) 안', async () => {
    const w = '\u0001'.repeat(64);
    const svc = (i: number) => ({ purpose: `${String(i).padStart(2, '0')}${'\u0001'.repeat(62)}`, picks: [{ preset: null, rule: 'gcp.compute_instance', tier: 'abcdefghijklmnop', instances: Array.from({ length: 3 }, (_, k) => ({ id: `a${k}`, seq: `0${k + 1}`, attach: { boot: true, ip: true } })) }] });
    const r = await sizeOf('/v1/wizard', { provider: 'gcp', project: { ...P, owner: w, system: w }, project_id_suffix: 'abcdefghijklmnop', services: Array.from({ length: 20 }, (_, i) => svc(i)) });
    expect(r.status).toBe(200);
    expect(r.bytes).toBeLessThan(640 * 1024);
  });
});
