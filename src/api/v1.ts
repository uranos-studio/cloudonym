// /v1 하위 앱 — 엔진을 부르고 wire 로 바꾼다. 이름 규칙 · 축소 · 검증 로직은 여기 없다
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { every } from 'hono/combine';
import type { App } from './env';
import { generate, validateName } from '../core/engine';
import { labelsFor } from '../core/labels';
import { parseEventBody, parseGenerateBody, parseValidateBody } from './schemas';
import { toWireGenerate, toWireValidate, type ProviderResult } from './serialize';
import { logTelemetry } from './telemetry';
import { internalError } from './errors';

/** 본문 상한 — 정상 본문은 1KB 안이다. 넘으면 파싱 전에 413 (최종 리뷰 I-1).
 *  content-length 가 있으면 헤더로, 없으면(chunked) 스트림을 읽다가 넘는 순간 onError — 어느 쪽이든 413 이다 */
export const MAX_BODY_BYTES = 16 * 1024;

export const v1 = new Hono<App>();
// every 로 한 번에 건다 — use 를 둘로 나누면 라우트 목록에 ALL /v1/* 가 둘 생긴다. cors 가 preflight 에 204 를 내면 bodyLimit 은 돌지 않는다
v1.use(
  '*',
  every(
    cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'] }),
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

// 화면 비콘 (D17) — 문맥값은 받지 않는다. 카운터만 올린다
v1.post('/events', async (c) => {
  const read = await readJson(c);
  if (!read.ok) return c.json(NOT_JSON, 400);
  const parsed = parseEventBody(read.body);
  if (!parsed.ok) return c.json(parsed.body, 400);
  c.executionCtx.waitUntil(logTelemetry(c, parsed.value));
  return c.json({ ok: true });
});
