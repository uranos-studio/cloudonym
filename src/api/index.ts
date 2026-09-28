// Worker 엔트리 — root 앱. /v1/* 는 Hono 가 받고(wrangler run_worker_first), 나머지는 Workers Static Assets(SPA)가 서빙한다
import { Hono } from 'hono';
import type { App } from './env';
import { v1 } from './v1';

export const app = new Hono<App>();
app.route('/v1', v1);

export default app;
