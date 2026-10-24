// ui_visit 의 cloud (D130) — 마법사 경로(/aws · /gcp)에서 연 첫 방문이 어느 클라우드였는가. 화면 값을 믿지 않고 켜진 CSP(ENABLED_PROVIDERS) 안일 때만 싣는다
import { describe, it, expect, vi } from 'vitest';
import { app } from './index';
import { req, beaconPost, fakeKv } from './test-support';
import { META_KEYS, KV_TTL_SECONDS, visitCloud } from './telemetry';

const env = (kv: KVNamespace) => ({ CLOUDONYM_KV: kv, AXIOM_API_KEY: 'k', AXIOM_DATASET: 'ds' });

describe('visitCloud — 켜진 CSP id 만 받는다', () => {
  it('aws · gcp 는 그대로 · 꺼진 azure · 모르는 글자 · 문자열 아님은 undefined', () => {
    expect(visitCloud('aws')).toBe('aws');
    expect(visitCloud('gcp')).toBe('gcp');
    for (const bad of ['azure', 'AWS', '', 'aws ', 'constructor', 1, null, undefined, ['aws']]) expect(visitCloud(bad), String(bad)).toBeUndefined();
  });
  it('허용 표 — ui_visit 에만 cloud', () => {
    expect(META_KEYS.ui_visit).toEqual(['src', 'cloud']);
    for (const [event, keys] of Object.entries(META_KEYS)) if (event !== 'ui_visit') expect(keys, event).not.toContain('cloud');
  });
});

describe('POST /v1/events — ui_visit 의 cloud (D130)', () => {
  const post = async (body: Record<string, unknown>) => {
    const { kv, store, puts } = fakeKv();
    const bodies: string[] = [];
    vi.stubGlobal('fetch', (_u: string, init: { body: string }) => { bodies.push(init.body); return Promise.resolve(new Response('{}')); });
    try {
      const { res, promises } = await req(app, '/v1/events', beaconPost(body), env(kv));
      await Promise.all(promises);
      return { status: res.status, keys: [...store.keys()].sort(), puts, row: JSON.parse(bodies[0]!)[0] as Record<string, unknown> };
    } finally {
      vi.unstubAllGlobals();
    }
  };
  it("cloud:'aws' → 200 · Axiom 한 건에 cloud · KV 에 stats:ui_visit:<일자> 와 stats:ui_visit:cloud:aws:<일자> 둘 · 같은 TTL", async () => {
    const r = await post({ event: 'ui_visit', cloud: 'aws' });
    expect(r.status).toBe(200);
    expect(r.keys).toHaveLength(2);
    expect(r.keys[0]).toMatch(/^stats:ui_visit:\d{4}-\d{2}-\d{2}$/);
    expect(r.keys[1]).toMatch(/^stats:ui_visit:cloud:aws:\d{4}-\d{2}-\d{2}$/);
    for (const p of r.puts) expect(p.options).toEqual({ expirationTtl: KV_TTL_SECONDS });
    expect(r.row).toMatchObject({ event: 'ui_visit', cloud: 'aws' });
  });
  it('src 와 cloud 가 같이 오면 카운터 셋', async () => {
    const r = await post({ event: 'ui_visit', cloud: 'gcp', src: 'parking' });
    expect(r.keys).toHaveLength(3);
    expect(r.keys.some((k) => /^stats:ui_visit:cloud:gcp:\d{4}-\d{2}-\d{2}$/.test(k))).toBe(true);
    expect(r.keys.some((k) => /^stats:ui_visit:src:parking:\d{4}-\d{2}-\d{2}$/.test(k))).toBe(true);
    expect(r.row).toMatchObject({ cloud: 'gcp', src: 'parking' });
  });
  it("cloud:'azure' · 모르는 값은 버린다 — 200 · Axiom 행에 cloud 없음 · KV 키는 이벤트 하나", async () => {
    for (const cloud of ['azure', 'AWS', 'x', 42, ['aws'], '']) {
      const r = await post({ event: 'ui_visit', cloud });
      expect(r.status, String(cloud)).toBe(200);
      expect(r.keys, String(cloud)).toHaveLength(1);
      expect('cloud' in r.row, String(cloud)).toBe(false);
    }
  });
  it('cloud 가 없으면(소개 페이지) 예전과 같다 · ui_generate 의 cloud 는 싣지 않는다', async () => {
    const r = await post({ event: 'ui_visit' });
    expect(r.keys).toHaveLength(1);
    expect('cloud' in r.row).toBe(false);
    const g = await post({ event: 'ui_generate', cloud: 'aws' });
    expect(g.keys).toHaveLength(1);
    expect('cloud' in g.row).toBe(false);
  });
});
