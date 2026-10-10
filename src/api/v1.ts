// /v1 하위 앱 — 엔진을 부르고 wire 로 바꾼다. 이름 규칙 · 축소 · 검증 로직은 여기 없다
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { every, except } from 'hono/combine';
import type { App } from './env';
import { generate, generateMany, generateProject, validateName } from '../core/engine';
import { labelsFor } from '../core/labels';
import { parseEventBody, parseGenerateBody, parseNamesBody, parseValidateBody, parseWizardBody } from './schemas';
import { toWireGenerate, toWireNames, toWireValidate, toWireWizard, type ProviderResult } from './serialize';
import { logTelemetry } from './telemetry';
import { fail, internalError } from './errors';
import { VERSION } from '../version';
import { rateLimit } from './ratelimit';

/** 본문 상한 — 정상 본문은 1KB 안이다. 넘으면 파싱 전에 413.
 *  content-length 가 있으면 헤더로, 없으면(chunked) 스트림을 읽다가 넘는 순간 onError — 어느 쪽이든 413 이다 */
export const MAX_BODY_BYTES = 16 * 1024;

export const v1 = new Hono<App>();
// every 로 한 번에 건다 — use 를 둘로 나누면 라우트 목록에 ALL /v1/* 가 둘 생긴다. cors 가 preflight 에 204 를 내면 제한 · bodyLimit 은 돌지 않는다.
// 순서: cors(429 에도 CORS 헤더가 실린다) → 요청 제한(본문을 읽기 전에 끊는다) → bodyLimit.
// /v1/events 는 화면 전용이라 CORS 를 걸지 않는다 — 다른 사이트가 응답을 읽을 이유가 없다
v1.use(
  '*',
  every(
    except('/v1/events', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'] })),
    rateLimit,
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => fail(c, 413, [{ code: 'request.body_too_large', params: { max_bytes: MAX_BODY_BYTES } }]) }),
  ),
);
// app.route() 가 등록 순간의 하위 앱 errorHandler 로 감싸므로 모듈 스코프에서 건다
v1.onError(internalError);
v1.get('/health', (c) => c.json({ ok: true, version: VERSION }));

/** 본문이 JSON 이 아닐 때 — 세 라우트가 같이 쓴다 */
const notJson = (c: Context<App>) => fail(c, 400, [{ code: 'request.body_not_json' }]);

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
  if (!read.ok) return notJson(c);
  const parsed = parseGenerateBody(read.body);
  if (!parsed.ok) return fail(c, parsed.rejection.status, parsed.rejection.errors, { supported: parsed.rejection.supported });
  const { contexts, providers, transformed } = parsed.value;
  // provider 마다 그 CSP 로 푼 문맥으로 부른다 (D49)
  const results: ProviderResult[] = providers.map((p) => {
    const context = contexts[p]!;
    return { provider: p, names: generate(context, [p])[p] ?? {}, labels: labelsFor(context, p) };
  });
  c.executionCtx.waitUntil(logTelemetry(c, 'api_generate', { providers }));
  return c.json(toWireGenerate(results, transformed, VERSION));
});

// 고른 리소스와 개수만 (D39) — 한 요청 = 부모 범위의 한 인스턴스. 항목 FAIL · 충돌도 200 이고 valid:false 와 이유를 싣는다
v1.post('/names', async (c) => {
  const read = await readJson(c);
  if (!read.ok) return notJson(c);
  const parsed = parseNamesBody(read.body);
  if (!parsed.ok) return fail(c, parsed.rejection.status, parsed.rejection.errors, { supported: parsed.rejection.supported });
  const { provider, context, transformed, items } = parsed.value;
  const out = generateMany(context, provider, items);
  // 문맥값은 싣지 않는다 (D17)
  c.executionCtx.waitUntil(logTelemetry(c, 'api_names', { provider, resource_count: items.length, name_count: out.items.length, valid: out.valid }));
  return c.json(toWireNames(out, items.map((i) => i.rule), labelsFor(context, provider), transformed, VERSION));
});

// 마법사 (D66) — 프로젝트 한 번의 구성(프로젝트 공용 + 서비스마다)을 구조 키로. 항목 FAIL · 충돌도 200 이고 valid:false 와 이유를 싣는다.
// 다시 받는 길은 같은 요청에 응답의 version.rules 를 rules_version 으로 넣는 것이다(D27) — /v1/names 로 재현하지 않는다
v1.post('/wizard', async (c) => {
  const read = await readJson(c);
  if (!read.ok) return notJson(c);
  const parsed = parseWizardBody(read.body);
  if (!parsed.ok) return fail(c, parsed.rejection.status, parsed.rejection.errors, { supported: parsed.rejection.supported });
  const { provider, selection, transformed, labelContexts, pickCount } = parsed.value;
  const out = generateProject(selection, provider);
  const labels = labelContexts.map(({ namespace, context }) => ({ namespace, labels: labelsFor(context, provider) }));
  // 문맥값 · 서비스 이름은 싣지 않는다 (D17 · D56)
  c.executionCtx.waitUntil(logTelemetry(c, 'api_wizard', { provider, service_count: selection.services.length, resource_count: pickCount, name_count: out.items.length, valid: out.valid }));
  return c.json(toWireWizard(out, labels, transformed, VERSION));
});

v1.post('/validate', async (c) => {
  const read = await readJson(c);
  if (!read.ok) return notJson(c);
  const parsed = parseValidateBody(read.body);
  if (!parsed.ok) return fail(c, parsed.rejection.status, parsed.rejection.errors, { supported: parsed.rejection.supported });
  const { provider, resourceType, name } = parsed.value;
  const result = validateName(provider, resourceType, name);
  c.executionCtx.waitUntil(logTelemetry(c, 'api_validate', { provider, resource_type: resourceType, valid: result.valid }));
  return c.json(toWireValidate(result, VERSION));
});

// Sec-Fetch-Site 는 브라우저가 붙이고 페이지 스크립트가 바꿀 수 없다 (forbidden header). 화면의 sendBeacon 은 same-origin 이다
// 화면 비콘 (D17 · D56) — 문맥값은 받지 않는다. 카운터를 올리고, ui_copy 는 어느 버튼인가(target)만 싣는다.
// 같은 출처가 아니면 403 — 다른 사이트에 심은 sendBeacon(cross-site) 과 헤더 없는 요청(curl 등)을 거른다. 화면이 유일한 정당한 발신자다.
// curl 은 헤더를 꾸밀 수 있다 — 그쪽은 요청 제한이 비용을 묶는다. Fetch Metadata 를 보내지 않는 옛 브라우저의 비콘은 버려진다(근사치 · D16)
// 브라우저는 안전한 출처(HTTPS · localhost · 127.0.0.1)에서만 Sec-Fetch-* 를 붙인다 — 개발 서버를 HTTP 로 다른 호스트 이름에서 열면 비콘이 403 이다. 운영은 HTTPS 라 해당하지 않는다
v1.post('/events', async (c) => {
  if (c.req.header('sec-fetch-site') !== 'same-origin') return fail(c, 403, [{ code: 'request.same_origin_only' }]);
  const read = await readJson(c);
  if (!read.ok) return notJson(c);
  const parsed = parseEventBody(read.body);
  if (!parsed.ok) return fail(c, parsed.rejection.status, parsed.rejection.errors, { supported: parsed.rejection.supported });
  const { event, target } = parsed.value;
  c.executionCtx.waitUntil(logTelemetry(c, event, target ? { target } : {}));
  return c.json({ ok: true });
});
