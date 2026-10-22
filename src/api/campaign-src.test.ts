// 캠페인 출처 src (D122) — 지도 사이트의 house_ad 링크로 온 방문 · 생성 · 복사를 그 출처로 센다. 서버는 화면 값을 믿지 않고 정규식으로 다시 거른다
import { describe, it, expect, vi } from 'vitest';
import { app } from './index';
import { req, beaconPost, fakeKv } from './test-support';
import { META_KEYS, CAMPAIGN_SRC_RE, campaignSrc, KV_TTL_SECONDS } from './telemetry';
import { CAMPAIGN_SRC_PATTERN } from '../components/campaign';

const env = (kv: KVNamespace) => ({ CLOUDONYM_KV: kv, AXIOM_API_KEY: 'k', AXIOM_DATASET: 'ds' });

describe('campaignSrc — /^[a-z0-9-]{1,32}$/ 만 받는다', () => {
  it('맞는 값 · 틀린 값', () => {
    for (const ok of ['parking', 'a', 'map-01', 'x'.repeat(32)]) expect(campaignSrc(ok), ok).toBe(ok);
    for (const bad of ['', 'Parking', 'x'.repeat(33), 'a_b', 'a b', 'a/b', '파킹', 1, null, undefined, ['parking']]) expect(campaignSrc(bad), String(bad)).toBeUndefined();
  });
  it('화면의 정규식과 서버의 정규식이 같다', () => {
    expect(CAMPAIGN_SRC_RE.source).toBe(CAMPAIGN_SRC_PATTERN.source);
    expect(CAMPAIGN_SRC_RE.source).toBe('^[a-z0-9-]{1,32}$');
  });
  it('허용 표 — 화면 이벤트 셋에 src 가 붙는다', () => {
    expect(META_KEYS.ui_visit).toContain('src');
    expect(META_KEYS.ui_generate).toContain('src');
    expect(META_KEYS.ui_copy).toContain('src');
    expect(META_KEYS.api_generate).not.toContain('src');
  });
});

describe('POST /v1/events — src (D122)', () => {
  const cases: Record<string, Record<string, unknown>> = {
    ui_visit: { event: 'ui_visit' },
    ui_generate: { event: 'ui_generate' },
    ui_copy: { event: 'ui_copy', target: 'terraform' },
  };
  for (const [event, body] of Object.entries(cases)) {
    it(`${event} + 맞는 src → Axiom 행에 src · KV 에 stats:${event}:src:parking:<일자> 도 같은 TTL 로`, async () => {
      const { kv, store, puts } = fakeKv();
      const bodies: string[] = [];
      vi.stubGlobal('fetch', (_u: string, init: { body: string }) => { bodies.push(init.body); return Promise.resolve(new Response('{}')); });
      try {
        const { res, promises } = await req(app, '/v1/events', beaconPost({ ...body, src: 'parking' }), env(kv));
        expect(res.status).toBe(200);
        await Promise.all(promises);
        const keys = [...store.keys()].sort();
        expect(keys).toHaveLength(2);
        expect(keys[0]).toMatch(new RegExp(`^stats:${event}:\\d{4}-\\d{2}-\\d{2}$`));
        expect(keys[1]).toMatch(new RegExp(`^stats:${event}:src:parking:\\d{4}-\\d{2}-\\d{2}$`));
        for (const p of puts) expect(p.options).toEqual({ expirationTtl: KV_TTL_SECONDS });
        expect(JSON.parse(bodies[0]!)[0]).toMatchObject({ event, src: 'parking' });
      } finally {
        vi.unstubAllGlobals();
      }
    });
  }
  it('틀린 src 는 버린다 — 200 · Axiom 행에 src 없음 · KV 키는 이벤트 하나뿐', async () => {
    for (const src of ['Parking', 'x'.repeat(33), '../x', 42, ['parking'], '']) {
      const { kv, store } = fakeKv();
      const bodies: string[] = [];
      vi.stubGlobal('fetch', (_u: string, init: { body: string }) => { bodies.push(init.body); return Promise.resolve(new Response('{}')); });
      try {
        const { res, promises } = await req(app, '/v1/events', beaconPost({ event: 'ui_visit', src }), env(kv));
        expect(res.status, String(src)).toBe(200);
        await Promise.all(promises);
        expect([...store.keys()], String(src)).toHaveLength(1);
        const row = JSON.parse(bodies[0]!)[0] as Record<string, unknown>;
        expect('src' in row, String(src)).toBe(false);
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });
  it('src 가 없으면 예전과 같다 — KV 키 하나 · src 칸 없음', async () => {
    const { kv, store } = fakeKv();
    const { promises } = await req(app, '/v1/events', beaconPost({ event: 'ui_generate' }), { CLOUDONYM_KV: kv });
    await Promise.all(promises);
    expect([...store.keys()]).toHaveLength(1);
  });
});
