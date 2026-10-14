import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { app } from './index';
import { req, jsonPost, json } from './test-support';
import { MAX_BODY_BYTES } from './v1';
import { clipEchoes, fail, MAX_WIZARD_ERRORS } from './errors';
import { parseWizardBody, wizardSentence } from './schemas';
import { toWireMessage } from './serialize';
import type { Message } from '../messages/catalog';

// /v1/wizard 400 응답 상한 (D103) — 오류는 앞에서부터 MAX_WIZARD_ERRORS 개까지 싣고, 더 있으면 request.errors_truncated 한 항목으로 shown · total 을 알린다.
// 상한이 없을 때 32 KiB 본문이 틀린 slot 으로 8 MB, 틀린 preset 으로 1.2 MB 응답을 만들었다
const MAX_ERROR_RESPONSE_BYTES = 64 * 1024;
const P = { owner: 'platform', system: 'billing', env: 'prod', region: 'ane3' };
const enc = (s: string) => new TextEncoder().encode(s).length;

/** n 을 늘려 압축 본문이 상한 안인 가장 큰 요청 */
function fit(mk: (n: number) => unknown): unknown {
  const size = (n: number) => enc(JSON.stringify(mk(n)));
  let lo = 1;
  let hi = 2;
  while (size(hi) <= MAX_BODY_BYTES) hi *= 2;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (size(m) <= MAX_BODY_BYTES) lo = m; else hi = m; }
  expect(size(lo)).toBeGreaterThan(MAX_BODY_BYTES * 0.9);
  return mk(lo);
}
const plan = (services: unknown[], extra: Record<string, unknown> = {}) => ({ provider: 'gcp', project: P, services, ...extra });
const gce = (instances: unknown[]) => ({ preset: null, rule: 'gcp.compute_instance', instances });
/** 오류 한 건이 가장 큰 값 — 되돌려 싣는 값은 MAX_ECHO_CHARS(40)자에서 잘린다(schemas 의 describe 가 80자로 만든 것을 fail() 이 다시 자른다). 잰 것 중 가장 큰 것은 UTF-8 3바이트 글자다 */
const WIDE = String.fromCodePoint(0xac00).repeat(1000);

/** 상한 없이 낼 오류 — 라우트가 하는 변환(wizardSentence)까지 */
function uncapped(body: unknown): { errors: ReturnType<typeof wizardSentence>[]; supported?: string[] } {
  const parsed = parseWizardBody(body);
  if (parsed.ok) throw new Error('400 이 아니다');
  return { errors: parsed.rejection.errors.map((m) => wizardSentence(toWireMessage(clipEchoes(m)))), ...(parsed.rejection.supported ? { supported: parsed.rejection.supported } : {}) };
}

const WORST: [string, (n: number) => unknown][] = [
  ['틀린 slot', (n) => plan([{ purpose: 'a', picks: [gce(Array.from({ length: n }, () => 1))] }])],
  ['틀린 attach', (n) => plan([{ purpose: 'a', picks: [gce(Array.from({ length: n }, (_, k) => ({ id: `a${k}`, seq: '01', attach: { z: 1 } })))] }])],
  ['틀린 preset', (n) => plan([{ purpose: 'a', picks: Array.from({ length: n }, () => ({ preset: 'x' })) }])],
  ['틀린 preset · 가장 긴 값', (n) => plan([{ purpose: 'a', picks: Array.from({ length: n }, () => ({ preset: WIDE.slice(0, 80) })) }])],
  ['틀린 slot id · 가장 긴 값', (n) => plan([{ purpose: 'a', picks: [gce(Array.from({ length: n }, () => ({ id: WIDE.slice(0, 80), seq: WIDE.slice(0, 80) })))] }])],
  ['섞임 · 모르는 rule(supported 가 붙는다)', (n) => plan([
    { purpose: 'a', picks: Array.from({ length: n }, (_, k) => (k % 3 === 0 ? { preset: 'x' } : k % 3 === 1 ? { preset: null, rule: WIDE.slice(0, 80) } : gce([1, { id: 'a', seq: '01', attach: 1 }]))) },
  ], { project_picks: [{ preset: 'y' }] })],
];

describe(`POST /v1/wizard 400 — 오류 ${MAX_WIZARD_ERRORS}개 상한 + 잘린 수 (D103)`, () => {
  for (const [label, mk] of WORST) {
    it(`32 KiB · ${label} → 응답 ${MAX_ERROR_RESPONSE_BYTES / 1024}KB 안 · 앞 ${MAX_WIZARD_ERRORS}개 그대로 · total = 실제 오류 수`, async () => {
      const body = fit(mk);
      const full = uncapped(body);
      expect(full.errors.length).toBeGreaterThan(MAX_WIZARD_ERRORS);
      const { res } = await req(app, '/v1/wizard', jsonPost(body));
      expect(res.status).toBe(400);
      const text = await res.text();
      expect(enc(text)).toBeLessThan(MAX_ERROR_RESPONSE_BYTES);
      const got = JSON.parse(text);
      expect(got.errors).toHaveLength(MAX_WIZARD_ERRORS + 1);
      expect(got.errors.slice(0, MAX_WIZARD_ERRORS)).toEqual(full.errors.slice(0, MAX_WIZARD_ERRORS));
      expect(got.errors.at(-1)).toEqual({
        code: 'request.errors_truncated', params: { shown: MAX_WIZARD_ERRORS, total: full.errors.length },
        message: `Showing the first ${MAX_WIZARD_ERRORS} of ${full.errors.length} errors; fix these and send the request again to see the rest`,
      });
      expect(got.supported).toEqual(full.supported);
    });
  }

  for (const n of [1, MAX_WIZARD_ERRORS]) {
    it(`오류 ${n}개(상한 이하) → 응답이 바이트까지 상한 없을 때와 같다`, async () => {
      // 서비스 하나에 pick 40개까지라 25개씩 나눈다 — 그래야 오류가 모르는 preset 하나씩이다
      const body = plan(Array.from({ length: Math.ceil(n / 25) }, (_, i) => ({ purpose: `s${i}`, picks: Array.from({ length: Math.min(25, n - i * 25) }, () => ({ preset: 'x' })) })));
      const full = uncapped(body);
      expect(full.errors).toHaveLength(n);
      const { res } = await req(app, '/v1/wizard', jsonPost(body));
      expect(await res.text()).toBe(JSON.stringify({ success: false, errors: full.errors, ...(full.supported ? { supported: full.supported } : {}) }));
    });
  }
});

describe('fail() — maxErrors 는 고른 경로에만', () => {
  const run = async (count: number, maxErrors?: number) => {
    const a = new Hono();
    const msgs: Message[] = Array.from({ length: count }, () => ({ code: 'request.body_not_json' }));
    a.get('/', (c) => fail(c, 400, msgs, maxErrors === undefined ? {} : { maxErrors }));
    return json(await a.request('/'));
  };
  it('maxErrors 가 없으면 몇 개든 그대로', async () => {
    expect((await run(500)).errors).toHaveLength(500);
  });
  it('경계 — 상한과 같으면 그대로 · 하나 넘으면 상한 + 잘림 항목', async () => {
    expect((await run(3, 3)).errors).toHaveLength(3);
    const over = (await run(4, 3)).errors;
    expect(over).toHaveLength(4);
    expect(over[3]).toMatchObject({ code: 'request.errors_truncated', params: { shown: 3, total: 4 } });
  });
});

// /v1/generate 는 오류 50개 상한 · /v1/validate · /v1/events 는 오류가 많아야 셋 — error-response-cap.test.ts 가 경로마다 최악 응답을 잰다
describe('/v1/names 는 잘리지 않는다 (D103)', () => {
  it('/v1/names · 모르는 type 200개 → 오류 200개 그대로', async () => {
    const { res } = await req(app, '/v1/names', jsonPost({ provider: 'gcp', context: { owner: 'o', system: 's', purpose: 'p', env: 'prod', region: 'asia-northeast3-a' }, resources: Array.from({ length: 200 }, () => ({ type: 1 })) }));
    const body = await json(res);
    expect(body.errors).toHaveLength(200);
    expect(body.errors.some((e: { code: string }) => e.code === 'request.errors_truncated')).toBe(false);
  });
});
