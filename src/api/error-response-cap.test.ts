import { describe, it, expect } from 'vitest';
import { app } from './index';
import { req, jsonPost } from './test-support';
import { MAX_BODY_BYTES } from './v1';
import { MAX_GENERATE_ERRORS } from './errors';
import { parseGenerateBody } from './schemas';
import { toWireMessage } from './serialize';
import { rulesFor } from '../core/constraints';
import { MAX_ITEMS } from '../core/selection';

// POST 경로마다 32 KiB 본문으로 만들 수 있는 최악 400 의 응답 크기 (D103). /v1/wizard 는 wizard-errors-cap.test.ts 가 본다.
// 오류 한 건이 가장 커지는 값은 되돌려 싣는 80자가 UTF-8 3바이트 글자일 때(/v1/generate 605 B · /v1/names 658 B),
// 본문 한 바이트당 오류가 가장 많은 값은 `0`(2 B) · `{}` · 따옴표 40개를 담은 배열(describe 가 JSON 으로 80자를 만든다)이다
const MAX_ERROR_RESPONSE_BYTES = 64 * 1024;
const enc = (s: string) => new TextEncoder().encode(s).length;
const C = { owner: 'o', system: 's', purpose: 'p', env: 'prod', region: 'asia-northeast3-a' };
const WIDE = String.fromCodePoint(0xac00).repeat(80);
/** 값 자리에 넣으면 되돌려 싣는 값이 `["\"\"…` 80자가 된다 — 본문 약 90 B 로 오류 한 건 약 450 B */
const NESTED_QUOTES = ['"'.repeat(40)];

/** n 을 늘려 본문이 상한 안인 가장 큰 요청. mk 가 n 에 따라 더 커지지 않으면(항목 수 상한) 그대로 돌려준다 */
function fit(mk: (n: number) => unknown): unknown {
  const size = (n: number) => enc(JSON.stringify(mk(n)));
  let lo = 1;
  let hi = 2;
  while (size(hi) <= MAX_BODY_BYTES) {
    if (size(hi * 2) === size(hi)) return mk(hi);
    hi *= 2;
  }
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (size(m) <= MAX_BODY_BYTES) lo = m; else hi = m; }
  return mk(lo);
}
const post = async (path: string, body: unknown) => {
  // /v1/events 는 같은 출처만 받는다 — 400 까지 닿게 머리글을 단다
  const { res } = await req(app, path, { ...jsonPost(body), headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' } });
  const text = await res.text();
  return { status: res.status, bytes: enc(text), body: JSON.parse(text) as { errors: { code: string; params?: Record<string, unknown> }[]; supported?: string[] } };
};

describe(`POST /v1/generate 400 — 오류 ${MAX_GENERATE_ERRORS}개 상한 + 잘린 수 (D103)`, () => {
  const providers = (v: unknown) => (n: number) => ({ context: C, providers: Array.from({ length: n }, () => v) });
  const WORST: [string, (n: number) => unknown][] = [
    ['모르는 provider `0` (오류 수 최다)', providers(0)],
    ['모르는 provider `{}`', providers({})],
    ['꺼진 provider azure', providers('azure')],
    ['모르는 provider · 한글 80자', providers(WIDE)],
    ['모르는 provider · 따옴표 80자', providers('"'.repeat(80))],
    ['모르는 provider · 따옴표를 담은 배열', providers(NESTED_QUOTES)],
  ];
  for (const [label, mk] of WORST) {
    it(`32 KiB · ${label} → 응답 ${MAX_ERROR_RESPONSE_BYTES / 1024}KB 안 · 앞 ${MAX_GENERATE_ERRORS}개 그대로 · total = 실제 오류 수`, async () => {
      const body = fit(mk);
      const parsed = parseGenerateBody(body);
      if (parsed.ok) throw new Error('400 이 아니다');
      const full = parsed.rejection.errors.map((m) => toWireMessage(m));
      expect(full.length).toBeGreaterThan(MAX_GENERATE_ERRORS);
      const r = await post('/v1/generate', body);
      expect(r.status).toBe(400);
      expect(r.bytes).toBeLessThan(MAX_ERROR_RESPONSE_BYTES);
      expect(r.body.errors).toHaveLength(MAX_GENERATE_ERRORS + 1);
      expect(r.body.errors.slice(0, MAX_GENERATE_ERRORS)).toEqual(full.slice(0, MAX_GENERATE_ERRORS));
      expect(r.body.errors.at(-1)).toMatchObject({ code: 'request.errors_truncated', params: { shown: MAX_GENERATE_ERRORS, total: full.length } });
      expect(r.body.supported).toEqual(parsed.rejection.supported);
    });
  }
  it('문맥 오류 최다(다섯 칸 모두 상한 초과) → 그대로 · 응답이 작다', async () => {
    const r = await post('/v1/generate', fit((n) => ({ context: { owner: 'a'.repeat(n), system: 'a'.repeat(n), purpose: 'a'.repeat(n), env: 'a'.repeat(n), region: 'a'.repeat(n) } })));
    expect(r.status).toBe(400);
    expect(r.body.errors).toHaveLength(5);
    expect(r.bytes).toBeLessThan(MAX_ERROR_RESPONSE_BYTES);
  });
  for (const n of [1, MAX_GENERATE_ERRORS]) {
    it(`오류 ${n}개(상한 이하) → 응답이 바이트까지 상한 없을 때와 같다`, async () => {
      const body = { context: C, providers: Array.from({ length: n }, () => 'nope') };
      const parsed = parseGenerateBody(body);
      if (parsed.ok) throw new Error('400 이 아니다');
      const { res } = await req(app, '/v1/generate', jsonPost(body));
      expect(await res.text()).toBe(JSON.stringify({ success: false, errors: parsed.rejection.errors.map((m) => toWireMessage(m)), supported: parsed.rejection.supported }));
    });
  }
  it('같은 켜진 provider 의 반복은 오류가 아니다 — 배열 길이로 막지 않는 까닭', async () => {
    const { res } = await req(app, '/v1/generate', jsonPost({ context: C, providers: ['gcp', 'gcp', 'gcp', 'gcp'] }));
    expect(res.status).toBe(200);
  });
});

// /v1/names 는 자르지 않는다 — 항목 200개(MAX_ITEMS)마다 오류가 나는 요청이 정상 범위이고 그 응답을 바꾸지 않는다.
// 그런데 그 200건이 값을 80자씩 되돌려 실으면 64 KB 를 넘는다(따옴표를 담은 배열 200건 98,989 B · 섞은 최악 약 111 KB) —
// 64 KB 안에 넣으려면 상한이 약 90 이어야 해서 200건 응답을 자른다. 그래서 이 경로의 시험 상한은 잰 최악 위의 128 KiB 다 (docs/decisions.md D103)
const NAMES_ERROR_RESPONSE_CEILING = 128 * 1024;
describe('POST /v1/names 400 — 자르지 않는다 · 잰 최악이 상한 안 (D103)', () => {
  const types = rulesFor('gcp');
  const kindTypes = types.filter((t) => t.kinds).map((t) => t.resourceType);
  const resources = (mk: (i: number) => unknown, n = MAX_ITEMS) => ({ provider: 'gcp', context: C, resources: Array.from({ length: n }, (_, i) => mk(i)) });
  const WORST: [string, unknown][] = [
    ['모르는 type 200개 · 따옴표를 담은 배열', resources(() => ({ type: NESTED_QUOTES }))],
    ['모르는 type · 한글 80자(본문이 허락하는 만큼)', fit((n) => resources(() => ({ type: WIDE }), Math.min(n, MAX_ITEMS)))],
    ['모르는 type 200개 · 한글 80자와 따옴표 배열을 섞음', resources((i) => ({ type: i < 80 ? WIDE : NESTED_QUOTES }))],
    ['종류 있는 규칙마다 오류 셋(count · role · kind) + 모르는 type', resources((i) => (i < kindTypes.length ? { type: kindTypes[i], count: 0, role: NESTED_QUOTES, kind: NESTED_QUOTES } : { type: NESTED_QUOTES }))],
    ['규칙 136개마다 오류 셋 + 모르는 type 64개', { provider: 'gcp', context: C, resources: [...types.map((t) => ({ type: t.resourceType, count: 0, role: 'a', kind: 'a' })), ...Array.from({ length: MAX_ITEMS - types.length }, () => ({ type: 'x' }))] }],
  ];
  for (const [label, body] of WORST) {
    it(`${label} → 잘리지 않고 응답 ${NAMES_ERROR_RESPONSE_CEILING / 1024}KB 안`, async () => {
      expect(enc(JSON.stringify(body))).toBeLessThanOrEqual(MAX_BODY_BYTES);
      const r = await post('/v1/names', body);
      expect(r.status).toBe(400);
      expect(r.body.errors.some((e) => e.code === 'request.errors_truncated')).toBe(false);
      expect(r.bytes).toBeLessThan(NAMES_ERROR_RESPONSE_CEILING);
    });
  }
});

describe(`POST /v1/validate · /v1/events 400 — 오류가 많아야 셋이라 상한 없이 ${MAX_ERROR_RESPONSE_BYTES / 1024}KB 안 (D103)`, () => {
  const WORST: [string, string, unknown][] = [
    ['/v1/validate', '세 칸 모두 1024자 초과', fit((n) => ({ provider: 'a'.repeat(n), resource_type: 'a'.repeat(n), name: 'a'.repeat(n) }))],
    ['/v1/validate', '모르는 resource_type · 한글 80자(supported 가 붙는다)', { provider: 'gcp', resource_type: WIDE, name: 'x' }],
    ['/v1/validate', '모르는 provider · 따옴표 80자', { provider: '"'.repeat(80), resource_type: 'x', name: 'x' }],
    ['/v1/events', '모르는 event · 한글 80자', { event: WIDE }],
    ['/v1/events', '모르는 복사 target · 한글 80자', { event: 'ui_copy', target: WIDE }],
    ['/v1/events', 'event 1024자 초과', fit((n) => ({ event: 'a'.repeat(n) }))],
  ];
  for (const [path, label, body] of WORST) {
    it(`${path} · ${label}`, async () => {
      const r = await post(path, body);
      expect(r.status).toBe(400);
      expect(r.body.errors.length).toBeLessThanOrEqual(3);
      expect(r.bytes).toBeLessThan(MAX_ERROR_RESPONSE_BYTES);
    });
  }
});
