import { describe, it, expect, vi } from 'vitest';
import { app } from './index';
import { req, jsonPost, beaconPost, fakeKv, isPending } from './test-support';

const ctx = { owner: 'infra', system: 'billing', purpose: 'trade', env: 'prod', region: 'asia-northeast3-a' };

describe('POST /v1/events (D17 비콘)', () => {
  it('ui_visit → 200 { ok:true } · waitUntil 1건 · KV 키 stats:ui_visit:<KST 일자>', async () => {
    const { kv, store } = fakeKv();
    const { res, promises } = await req(app, '/v1/events', beaconPost({ event: 'ui_visit' }), { CLOUDONYM_KV: kv });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(promises).toHaveLength(1);
    await promises[0];
    const keys = [...store.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^stats:ui_visit:\d{4}-\d{2}-\d{2}$/);
    expect(store.get(keys[0]!)).toBe('1');
  });
  it('모르는 event → 400 + supported · 카운터를 올리지 않는다', async () => {
    const { res, promises } = await req(app, '/v1/events', beaconPost({ event: 'api_generate' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, errors: [{ code: 'request.value_unsupported', field: 'event', params: { value: 'api_generate' }, message: "Unsupported event 'api_generate'" }], supported: ['ui_visit', 'ui_generate', 'ui_copy'] });
    expect(promises).toHaveLength(0);
  });
  it('본문이 JSON 이 아니면 400 · sendBeacon 의 text/plain 본문은 읽힌다', async () => {
    expect((await req(app, '/v1/events', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' }, body: 'x' })).res.status).toBe(400);
    const beacon = await req(app, '/v1/events', { method: 'POST', headers: { 'content-type': 'text/plain', 'sec-fetch-site': 'same-origin' }, body: '{"event":"ui_copy","target":"terraform"}' });
    expect(beacon.res.status).toBe(200);
  });
});

describe('POST /v1/events — ui_copy 의 target (D56)', () => {
  it('ui_copy + target → 200 · Axiom 한 건에 target 이 실린다 · KV 키 stats:ui_copy:<일자>', async () => {
    const { kv, store } = fakeKv();
    const bodies: string[] = [];
    vi.stubGlobal('fetch', (_url: string, init: { body: string }) => { bodies.push(init.body); return Promise.resolve(new Response('{"ingested":1,"failed":0}')); });
    try {
      const { res, promises } = await req(app, '/v1/events', beaconPost({ event: 'ui_copy', target: 'terraform' }), { CLOUDONYM_KV: kv, AXIOM_API_KEY: 'k', AXIOM_DATASET: 'ds' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      await Promise.all(promises);
      expect([...store.keys()][0]).toMatch(/^stats:ui_copy:\d{4}-\d{2}-\d{2}$/);
      expect(JSON.parse(bodies[0]!)[0]).toMatchObject({ event: 'ui_copy', target: 'terraform' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('target 이 없으면 400 · 모르는 target 이면 400 + supported 여섯 · 카운터를 올리지 않는다', async () => {
    const missing = await req(app, '/v1/events', beaconPost({ event: 'ui_copy' }));
    expect(missing.res.status).toBe(400);
    expect(missing.promises).toHaveLength(0);
    const unknown = await req(app, '/v1/events', beaconPost({ event: 'ui_copy', target: 'owner' }));
    expect(unknown.res.status).toBe(400);
    expect(await unknown.res.json()).toEqual({ success: false, errors: [{ code: 'request.value_unsupported', field: 'target', params: { value: 'owner' }, message: "Unsupported target 'owner'" }], supported: ['share-url', 'name', 'all-names', 'names-json', 'terraform', 'tags-json'] });
    expect(unknown.promises).toHaveLength(0);
  });
  it('ui_visit 에 target 을 주면 무시한다 — 200 · Axiom 한 건에 target 이 없다', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', (_url: string, init: { body: string }) => { bodies.push(init.body); return Promise.resolve(new Response('{}')); });
    try {
      const { res, promises } = await req(app, '/v1/events', beaconPost({ event: 'ui_visit', target: 'terraform', owner: 'example-team' }), { AXIOM_API_KEY: 'k', AXIOM_DATASET: 'ds' });
      expect(res.status).toBe(200);
      await Promise.all(promises);
      const row = JSON.parse(bodies[0]!)[0] as Record<string, unknown>;
      expect(row.event).toBe('ui_visit');
      expect('target' in row).toBe(false);
      expect(bodies[0]).not.toContain('example-team');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('waitUntil — 응답은 텔레메트리를 기다리지 않는다', () => {
  it('KV put 이 영원히 끝나지 않아도 응답은 돌아오고 그 Promise 는 pending 이다', async () => {
    const { kv } = fakeKv('hang');
    const { res, promises } = await req(app, '/v1/events', beaconPost({ event: 'ui_generate' }), { CLOUDONYM_KV: kv });
    expect(res.status).toBe(200);
    expect(promises).toHaveLength(1);
    expect(await isPending(promises[0]!)).toBe(true);
  });
  it('KV 가 throw 해도 응답은 200 이고 waitUntil 의 Promise 는 reject 하지 않는다', async () => {
    const { kv } = fakeKv('throw');
    const { res, promises } = await req(app, '/v1/generate', jsonPost({ context: ctx, providers: ['gcp'] }), { CLOUDONYM_KV: kv });
    expect(res.status).toBe(200);
    await expect(promises[0]).resolves.toBeUndefined();
  });
  it('generate · validate 도 waitUntil 1건 — api_generate · api_validate 키', async () => {
    const g = fakeKv();
    const gen = await req(app, '/v1/generate', jsonPost({ context: ctx }), { CLOUDONYM_KV: g.kv });
    await Promise.all(gen.promises);
    expect([...g.store.keys()][0]).toMatch(/^stats:api_generate:/);
    const v = fakeKv();
    const val = await req(app, '/v1/validate', jsonPost({ provider: 'gcp', resource_type: 'project_id', name: 'my-proj' }), { CLOUDONYM_KV: v.kv });
    await Promise.all(val.promises);
    expect([...v.store.keys()][0]).toMatch(/^stats:api_validate:/);
    expect(gen.promises).toHaveLength(1);
    expect(val.promises).toHaveLength(1);
  });
});
