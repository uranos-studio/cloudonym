// Worker 엔트리 — root 앱. /llms.txt 와 /v1/* 는 Hono 가 받고(wrangler run_worker_first), 나머지는 Workers Static Assets(SPA)가 서빙한다
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { App } from './env';
import { v1 } from './v1';
import { RULES } from '../core/constraints';
import { buildLlmsText } from './llms';
import { VERSION } from '../version';
import { logTelemetry } from './telemetry';
import { fail, internalError } from './errors';
import { overLimit, tooManyRequests } from './ratelimit';

// 모듈 로드 때 한 번 만든다 — 요청마다 만들지 않는다
const LLMS_TEXT = buildLlmsText(Object.values(RULES), VERSION);

export const app = new Hono<App>();
app.onError(internalError);
// 없는 경로 · 메서드(GET /v1/generate · /v1/nope)도 text/plain 이 아니라 공통 실패 꼴로. Hono 는 하위 앱이 아니라 root 의 notFound 를 쓴다
app.notFound((c) => fail(c, 404, [{ code: 'request.not_found' }]));
// 모든 Worker 응답에 nosniff · X-Frame-Options 등. _headers 는 Worker 응답에 적용되지 않는다.
// 공개 CORS API 라 CORP 는 cross-origin — 기본값 same-origin 이면 다른 출처의 no-cors 읽기가 막힌다. CSP 는 JSON · text 응답이라 걸지 않는다(기본값도 없음).
// HSTS 는 내지 않는다 — 기본값 includeSubDomains 가 커스텀 도메인 전체를 묶는다. 커스텀 도메인을 붙일 때 존 설정에서 한 곳으로 켠다(_headers 와 같은 방침)
app.use('*', secureHeaders({ crossOriginResourcePolicy: 'cross-origin', strictTransportSecurity: false }));

// Worker 라우트로 서빙한다 (D17) — 카운터와 Cache-Control 을 코드에서 건다
app.get('/llms.txt', async (c) => {
  // CORS 는 헤더로 직접 — 미들웨어를 붙이면 라우트 목록이 늘어난다. /openapi.json(_headers)과 짝
  const cors = { 'Access-Control-Allow-Origin': '*' };
  // HEAD 는 세지 않는다(카운터와 같은 기준). GET 은 IP 당 요청 제한
  if (c.req.method !== 'HEAD' && (await overLimit(c))) return tooManyRequests(c, cors);
  // Hono 는 HEAD 를 GET 핸들러로 보낸다 — HEAD(curl -I · 헬스 검사)는 읽은 것이 아니므로 세지 않는다. 헤더는 GET 과 같다
  if (c.req.method !== 'HEAD') c.executionCtx.waitUntil(logTelemetry(c, 'llms_txt_accessed'));
  return c.text(LLMS_TEXT, 200, { 'Cache-Control': 'public, max-age=86400', ...cors });
});

app.route('/v1', v1);

export default app;
