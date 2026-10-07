import { describe, it, expect } from 'vitest';
import { app } from './index';
import { req, jsonPost } from './test-support';
import { rulesFor } from '../core/constraints';
import { ENABLED_PROVIDERS } from '../core/types';

// HTTP 로 닿는 것은 켜진 CSP 뿐이다 (D45) — 켜는 CSP 가 늘면 이 시험이 그것도 돈다
// 400 오류 증폭 — 모르는 type 마다 지원 목록 전체를 싣지 않는다. 지원 목록은 응답 수준 supported 에 한 번만 (docs/decisions.md · 2026-10-06 응답 증폭)
const MAX_ERROR_RESPONSE_BYTES = 64 * 1024;

describe('POST /v1/names 400 오류 증폭', () => {
  for (const p of ENABLED_PROVIDERS) {
    it(`${p} · 모르는 type 200개 → supported 는 응답에 한 번만 · 응답 ${MAX_ERROR_RESPONSE_BYTES / 1024}KB 안`, async () => {
      const { res } = await req(app, '/v1/names', jsonPost({ provider: p, context: { owner: 'o', system: 's', purpose: 'p', env: 'prd', region: 'kr' }, resources: Array.from({ length: 200 }, () => ({ type: 1 })) }));
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
