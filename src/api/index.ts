// Worker 엔트리 — root 앱. /llms.txt 와 /v1/* 는 Hono 가 받고(wrangler run_worker_first), 나머지는 Workers Static Assets(SPA)가 서빙한다
import { Hono } from 'hono';
import type { App } from './env';
import { v1 } from './v1';
import { RULES } from '../core/constraints';
import { buildLlmsText } from './llms';
import { logTelemetry } from './telemetry';
import { internalError } from './errors';

// 모듈 로드 때 한 번 만든다 — 요청마다 만들지 않는다
const LLMS_TEXT = buildLlmsText(Object.values(RULES));

export const app = new Hono<App>();
app.onError(internalError);

// Worker 라우트로 서빙한다 (D17) — 카운터와 Cache-Control 을 코드에서 건다
app.get('/llms.txt', (c) => {
  // Hono 는 HEAD 를 GET 핸들러로 보낸다 — HEAD(curl -I · 헬스 검사)는 읽은 것이 아니므로 세지 않는다. 헤더는 GET 과 같다
  if (c.req.method !== 'HEAD') c.executionCtx.waitUntil(logTelemetry(c, 'llms_txt_accessed'));
  // CORS 는 헤더로 직접 — 미들웨어를 붙이면 라우트 목록이 늘어난다. /openapi.json(_headers)과 짝 (최종 리뷰 M-1)
  return c.text(LLMS_TEXT, 200, { 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' });
});

app.route('/v1', v1);

export default app;
