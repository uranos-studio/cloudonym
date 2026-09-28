// /v1 하위 앱 — 엔진을 부르고 wire 로 바꾼다. 이름 규칙 · 축소 · 검증 로직은 여기 없다
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import type { App } from './env';
import { generate, validateName } from '../core/engine';
import { labelsFor } from '../core/labels';
import { parseEventBody, parseGenerateBody, parseValidateBody } from './schemas';
import { toWireGenerate, toWireValidate, type ProviderResult } from './serialize';
import { logTelemetry } from './telemetry';

export const v1 = new Hono<App>();
v1.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'] }));
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
