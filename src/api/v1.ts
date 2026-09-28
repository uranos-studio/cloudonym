// /v1 하위 앱 — 엔진을 부르고 wire 로 바꾼다. 이름 규칙 · 축소 · 검증 로직은 여기 없다
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { every, except } from 'hono/combine';
import type { App } from './env';
import { generate, validateName } from '../core/engine';
import { labelsFor } from '../core/labels';
import { parseEventBody, parseGenerateBody, parseValidateBody } from './schemas';
import { toWireGenerate, toWireValidate, type ProviderResult } from './serialize';
import { logTelemetry } from './telemetry';
import { internalError } from './errors';
import { rateLimit } from './ratelimit';

/** 본문 상한 — 정상 본문은 1KB 안이다. 넘으면 파싱 전에 413 (최종 리뷰 I-1).
 *  content-length 가 있으면 헤더로, 없으면(chunked) 스트림을 읽다가 넘는 순간 onError — 어느 쪽이든 413 이다 */
export const MAX_BODY_BYTES = 16 * 1024;

export const v1 = new Hono<App>();
// every 로 한 번에 건다 — use 를 둘로 나누면 라우트 목록에 ALL /v1/* 가 둘 생긴다. cors 가 preflight 에 204 를 내면 제한 · bodyLimit 은 돌지 않는다.
// 순서: cors(429 에도 CORS 헤더가 실린다) → 요청 제한(본문을 읽기 전에 끊는다) → bodyLimit.
// /v1/events 는 화면 전용이라 CORS 를 걸지 않는다 — 다른 사이트가 응답을 읽을 이유가 없다 (보안 리뷰 M-2)
v1.use(
  '*',
  every(
    except('/v1/events', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'] })),
    rateLimit,
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ success: false, errors: ['본문이 16KB 를 넘는다'] }, 413) }),
  ),
);
// app.route() 가 등록 순간의 하위 앱 errorHandler 로 감싸므로 모듈 스코프에서 건다
v1.onError(internalError);
v1.get('/health', (c) => c.json({ ok: true }));

const NOT_JSON = { success: false, errors: ['본문이 JSON 이 아니다'] };

/** c.req.json() 은 content-type 을 보지 않고 본문을 파싱한다 — sendBeacon 의 text/plain 도 읽힌다. 실패만 잡는다 */
async function readJson(c: Context<App>): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await c.req.json() };
  } catch {
    return { ok: false };
  }
}

v1.post('/generate', async (c) => {
  const read = await readJson(c);
  if (!read.ok) return c.json(NOT_JSON, 400);
  const parsed = parseGenerateBody(read.body);
  if (!parsed.ok) return c.json(parsed.body, 400);
  const { context, providers, transformed } = parsed.value;
  const out = generate(context, providers);
  const results: ProviderResult[] = providers.map((p) => ({ provider: p, names: out[p] ?? {}, labels: labelsFor(context, p) }));
  c.executionCtx.waitUntil(logTelemetry(c, 'api_generate', { providers }));
  return c.json(toWireGenerate(results, transformed));
});

v1.post('/validate', async (c) => {
  const read = await readJson(c);
  if (!read.ok) return c.json(NOT_JSON, 400);
  const parsed = parseValidateBody(read.body);
  if (!parsed.ok) return c.json(parsed.body, 400);
  const { provider, resourceType, name } = parsed.value;
  const result = validateName(provider, resourceType, name);
  c.executionCtx.waitUntil(logTelemetry(c, 'api_validate', { provider, resource_type: resourceType, valid: result.valid }));
  return c.json(toWireValidate(result));
});

/** Sec-Fetch-Site 는 브라우저가 붙이고 페이지 스크립트가 바꿀 수 없다 (forbidden header). 화면의 sendBeacon 은 same-origin 이다 */
const EVENTS_FORBIDDEN = { success: false, errors: ['화면(같은 출처)에서 보낸 요청만 받는다'] };

// 화면 비콘 (D17) — 문맥값은 받지 않는다. 카운터만 올린다.
// 같은 출처가 아니면 403 — 다른 사이트에 심은 sendBeacon(cross-site) 과 헤더 없는 요청(curl 등)을 거른다. 화면이 유일한 정당한 발신자다 (보안 리뷰 M-2).
// curl 은 헤더를 꾸밀 수 있다 — 그쪽은 요청 제한(M-1)이 비용을 묶는다. Fetch Metadata 를 보내지 않는 옛 브라우저의 비콘은 버려진다(근사치 · D16)
v1.post('/events', async (c) => {
  if (c.req.header('sec-fetch-site') !== 'same-origin') return c.json(EVENTS_FORBIDDEN, 403);
  const read = await readJson(c);
  if (!read.ok) return c.json(NOT_JSON, 400);
  const parsed = parseEventBody(read.body);
  if (!parsed.ok) return c.json(parsed.body, 400);
  c.executionCtx.waitUntil(logTelemetry(c, parsed.value));
  return c.json({ ok: true });
});
