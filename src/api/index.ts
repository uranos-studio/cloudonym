// Worker 엔트리 — root 앱. /llms.txt 와 /v1/* 는 Hono 가 받고(wrangler run_worker_first), 나머지는 Workers Static Assets(SPA)가 서빙한다
import { Hono } from 'hono';
import type { App } from './env';
import { v1 } from './v1';
import { RULES } from '../core/constraints';
import { buildLlmsText } from './llms';
import { logTelemetry } from './telemetry';

// 모듈 로드 때 한 번 만든다 — 요청마다 만들지 않는다
const LLMS_TEXT = buildLlmsText(Object.values(RULES));

export const app = new Hono<App>();

// Worker 라우트로 서빙한다 (D17) — 카운터와 Cache-Control 을 코드에서 건다
app.get('/llms.txt', (c) => {
  c.executionCtx.waitUntil(logTelemetry(c, 'llms_txt_accessed'));
  return c.text(LLMS_TEXT, 200, { 'Cache-Control': 'public, max-age=86400' });
});

app.route('/v1', v1);

export default app;
