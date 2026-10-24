// Worker 엔트리 — root 앱. /llms.txt · /catalog.json · /robots.txt · /sitemap.xml 과 /v1/* 는 Hono 가 받는다(wrangler run_worker_first).
// 정적 파일은 Workers Static Assets 가 서빙하고, 파일이 없는 경로와 뿌리 `/` 는 여기서 화면 HTML 로 답한다(경로마다 head · 모르는 경로는 404 — D106)
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { App } from './env';
import { v1 } from './v1';
import { CATALOG_JSON, LLMS_TEXT } from './static-bodies';
import { logTelemetry } from './telemetry';
import { fail, internalError } from './errors';
import { overLimit, tooManyRequests } from './ratelimit';
import { indexNowKeyPath, servePage, serveIndexNowKey, serveRobots, serveSitemap } from './site';

// 두 본문은 빌드 전에 만든 상수다(scripts/gen-static-bodies.mjs) — isolate 기동 때 규칙 표로 다시 만들지 않는다(CPU 조사 2026-10-24)

export const app = new Hono<App>();
app.onError(internalError);
// 없는 경로 · 메서드(GET /v1/generate · /v1/nope)도 text/plain 이 아니라 공통 실패 꼴로. Hono 는 하위 앱이 아니라 root 의 notFound 를 쓴다
app.notFound((c) => fail(c, 404, [{ code: 'request.not_found' }]));
/** Worker 가 직접 답하는 파일 경로 — 이 밖의 GET · HEAD(/v1 아래 제외)는 화면 경로다 */
const WORKER_FILES = new Set(['/llms.txt', '/catalog.json', '/robots.txt', '/sitemap.xml']);
// 화면 HTML (D106) — secureHeaders 보다 먼저 둔다. 그 미들웨어는 next() 뒤에 X-Frame-Options: SAMEORIGIN 등을 덮어쓴다 — 화면은 _headers 의 값(DENY …)을 단다(site.ts)
app.use('*', async (c, next) => {
  const m = c.req.method;
  const p = c.req.path;
  const assets = c.env?.ASSETS;
  if (!assets || (m !== 'GET' && m !== 'HEAD') || WORKER_FILES.has(p) || p === indexNowKeyPath(c.env?.INDEXNOW_KEY) || p === '/v1' || p.startsWith('/v1/')) return next();
  return servePage(c, assets);
});
// 모든 Worker 응답에 nosniff · X-Frame-Options 등. _headers 는 Worker 응답에 적용되지 않는다.
// 공개 CORS API 라 CORP 는 cross-origin — 기본값 same-origin 이면 다른 출처의 no-cors 읽기가 막힌다. CSP 는 JSON · text 응답이라 걸지 않는다(기본값도 없음).
// HSTS 는 내지 않는다 — 존 설정이 모든 응답에 건다(Always Use HTTPS · max-age 1년 · includeSubDomains). 여기서도 내면 헤더가 두 번 붙는다(_headers 와 같은 방침)
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

// catalog 공개 (D46) — /llms.txt 와 같은 꼴: 한 번 만든 본문 · 하루 캐시 · CORS * · GET 만 요청 제한과 카운터
app.get('/catalog.json', async (c) => {
  const cors = { 'Access-Control-Allow-Origin': '*' };
  if (c.req.method !== 'HEAD' && (await overLimit(c))) return tooManyRequests(c, cors);
  if (c.req.method !== 'HEAD') c.executionCtx.waitUntil(logTelemetry(c, 'catalog_json_accessed'));
  return c.body(CATALOG_JSON, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=86400', ...cors });
});

// 검색 엔진용 (D106) — 상수 본문이라 요청 제한 · 카운터를 걸지 않는다. 절대 URL 은 요청의 origin 으로 만든다
app.get('/robots.txt', serveRobots);
app.get('/sitemap.xml', serveSitemap);
// IndexNow 키 파일 (D120) — 경로가 vars 의 키로 정해진다. 정적 파일이 없는 경로라 run_worker_first 없이도 Worker 로 온다(not_found_handling none)
app.get('/:file', (c, next) => serveIndexNowKey(c) ?? next());

app.route('/v1', v1);

export default app;
