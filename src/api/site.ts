// 검색 엔진용 응답 (D106) — /robots.txt · /sitemap.xml 과 화면 경로의 HTML(경로마다 head · 모르는 경로는 404).
// 절대 URL 은 늘 요청의 origin 으로 만든다 — 배포 도메인을 코드에 두지 않는다. 경로 표 · 문구는 화면과 같은 src/site 가 정본이다
import type { Context } from 'hono';
import type { App, Bindings } from './env';
import { PAGES, pathOf, routeOf, type Route } from '../site/pages';
import { pageText, SITE_NAME } from '../site/copy';
import { en } from '../messages/en';
// 정적 자산 보안 헤더의 정본 — Worker 가 만든 HTML 응답에는 _headers 가 붙지 않으므로 같은 줄을 읽어 직접 단다(두 곳에 적지 않는다)
import HEADERS_FILE from '../../public/_headers?raw';

/** _headers 의 한 규칙(`/*` 등) 아래 들여쓴 `이름: 값` 줄들. 주석 · 빈 줄은 건너뛴다 */
export function headersRule(text: string, rule: string): [string, string][] {
  const out: [string, string][] = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;
    if (!/^\s/.test(line)) { current = line.trim(); continue; }
    if (current !== rule) continue;
    const i = line.indexOf(':');
    if (i > 0) out.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
  }
  return out;
}

/** 화면 HTML 에 다는 보안 헤더 — 정적 index.html 과 같은 값(CSP · nosniff · DENY …) */
export const PAGE_HEADERS: readonly [string, string][] = headersRule(HEADERS_FILE, '/*');

/** Vite 개발 서버(npm run dev)에서 도는가 (D108) — `vite build` 는 MODE 를 'production' 으로, vitest 는 'test' 로 둔다. 운영 번들에서는 상수 false 다 */
const DEV_SERVER = import.meta.env.MODE === 'development';

/** 화면 HTML 에 실제로 다는 헤더 (D108) — 운영은 PAGE_HEADERS 그대로. 개발 서버만 CSP 를 뺀다:
 *  Vite 가 index.html 에 넣는 인라인 React preamble · HMR 클라이언트를 script-src 'self' 가 막아 화면이 그려지지 않는다. 나머지 헤더는 같다 */
export function pageHeaders(devServer: boolean): readonly [string, string][] {
  return devServer ? PAGE_HEADERS.filter(([k]) => k.toLowerCase() !== 'content-security-policy') : PAGE_HEADERS;
}

/** 하루 캐시 — /llms.txt 와 같다 */
const DAY_CACHE = 'public, max-age=86400';

/** 검색 엔진 소유 확인 값 (D120) — 전부 wrangler.jsonc vars 에서 온다. 비었거나 없으면 아무것도 내지 않는다(로컬 · 시험) */
export type SiteVerification = { naver?: string; daumLine?: string; indexNowKey?: string };

export function verificationOf(env: Bindings | undefined): SiteVerification {
  return { naver: env?.NAVER_SITE_VERIFICATION, daumLine: env?.DAUM_WEBMASTER_LINE, indexNowKey: env?.INDEXNOW_KEY };
}

/** IndexNow 키 꼴 — 8~128 자, 영숫자와 `-` (IndexNow 명세). 다른 꼴이면 키 파일을 내지 않는다 */
const INDEXNOW_KEY = /^[A-Za-z0-9-]{8,128}$/;

/** 키 파일 경로 `/<키>.txt` — 키가 없거나 꼴이 틀리면 undefined */
export function indexNowKeyPath(key: string | undefined): string | undefined {
  return key && INDEXNOW_KEY.test(key) ? `/${key}.txt` : undefined;
}

/** robots — 전부 허용(Daum 포함) · /v1/ 막기. Daum 웹마스터 확인 줄은 맨 끝 줄에 둔다 (D120) */
export function robotsText(origin: string, daumLine?: string): string {
  const lines = ['User-agent: *', 'Allow: /', 'Disallow: /v1/', '', `Sitemap: ${origin}/sitemap.xml`];
  // 줄바꿈이 섞인 값은 robots 를 여러 줄로 쪼개므로 싣지 않는다
  if (daumLine && !/[\r\n]/.test(daumLine)) lines.push('', daumLine);
  return [...lines, ''].join('\n');
}

/** <lastmod> 는 싣지 않는다 — 선택 항목이고, 날짜를 만들면 시각 규칙(KST)을 하나 더 지켜야 한다 */
export function sitemapXml(origin: string): string {
  const urls = PAGES.map((p) => `  <url><loc>${escapeHtml(origin + p.path)}</loc></url>`);
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, '</urlset>', ''].join('\n');
}

/** 공유 미리보기 그림 — 크기는 og-image.test 가 PNG 머리에서 읽어 대어 본다 */
export const OG_IMAGE = { path: '/og-image.png', width: 1200, height: 630 } as const;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** head 끝에 붙일 태그 — canonical · Open Graph · Twitter · (뿌리만) WebApplication JSON-LD. 모르는 경로는 noindex 하나 */
export function headTags(route: Route, origin: string, verify: SiteVerification = {}): string {
  const t = pageText(route);
  if (route === 'notFound') return '<meta name="robots" content="noindex">';
  const url = origin + pathOf(route);
  const tags = [
    // 네이버 서치어드바이저 소유 확인 (D120) — 뿌리 `/` 에만
    ...(route === 'app' && verify.naver ? [`<meta name="naver-site-verification" content="${escapeHtml(verify.naver)}">`] : []),
    `<link rel="canonical" href="${escapeHtml(url)}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:title" content="${escapeHtml(t.title)}">`,
    `<meta property="og:description" content="${escapeHtml(t.description)}">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    // 공유 미리보기 그림 — public/og-image.png(scripts/og-image.py 가 찍는다). 크롤러가 절대 URL 을 요구한다
    `<meta property="og:image" content="${escapeHtml(origin + OG_IMAGE.path)}">`,
    `<meta property="og:image:type" content="image/png">`,
    `<meta property="og:image:width" content="${OG_IMAGE.width}">`,
    `<meta property="og:image:height" content="${OG_IMAGE.height}">`,
    `<meta property="og:image:alt" content="${escapeHtml(en.ui.og_image_alt)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:image" content="${escapeHtml(origin + OG_IMAGE.path)}">`,
    `<meta name="twitter:image:alt" content="${escapeHtml(en.ui.og_image_alt)}">`,
  ];
  if (route === 'app') {
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: SITE_NAME,
      url: origin + '/',
      description: t.description,
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Any',
      browserRequirements: 'Requires JavaScript',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    };
    // 데이터 블록은 CSP script-src 에 걸리지 않는다(실행되지 않는다). `<` 를 이스케이프해 </script> 로 끊기지 않게 한다
    tags.push(`<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`);
  }
  return tags.join('\n    ');
}

/** #root 안의 요약 글 — 스크립트를 돌리지 않는 크롤러가 읽는다. React 의 createRoot().render 가 첫 그림에서 통째로 바꾼다.
 *  class="prerender" 는 화면 JS 가 뜨기 전 잠깐 보이는 동안 로딩 화면처럼 그리는 public/prerender.css 의 자리다 */
export function rootFallback(route: Route): string {
  const t = pageText(route);
  if (route === 'notFound') {
    return `<main class="prerender"><h1>${escapeHtml(t.heading)}</h1><p>${escapeHtml(en.ui.page_not_found_body)}</p><p><a href="/">${escapeHtml(pageText('app').title)}</a></p></main>`;
  }
  // AI 에이전트용 두 파일도 건다 — 스크립트 없이 읽는 쪽이 기계용 안내를 찾게
  const links = [...PAGES.map((p) => [p.path, pageText(p.route).heading]), ['/llms.txt', 'llms.txt'], ['/openapi.json', 'OpenAPI']];
  const nav = links.map(([href, text]) => `<a href="${href}">${escapeHtml(text ?? '')}</a>`).join(' · ');
  return `<main class="prerender"><h1>${escapeHtml(t.title)}</h1><p>${escapeHtml(t.description)}</p><nav>${nav}</nav></main>`;
}

/** 빌드한 index.html 에 경로의 head 와 요약 글을 넣는다. 자리(title · description · </head> · 빈 #root)가 없으면 그 부분만 건너뛴다 */
export function renderPage(html: string, route: Route, origin: string, verify: SiteVerification = {}): string {
  const t = pageText(route);
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(t.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${escapeHtml(t.description)}" />`)
    .replace('</head>', `    ${headTags(route, origin, verify)}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root">${rootFallback(route)}</div>`);
}

/** 화면 경로의 HTML — 정적 index.html 을 ASSETS 에서 받아 경로마다 고쳐 쓴다. 표에 없는 경로는 같은 본문에 404 와 noindex */
export async function servePage(c: Context<App>, assets: Fetcher): Promise<Response> {
  const url = new URL(c.req.url);
  const route = routeOf(url.pathname);
  // 요청 헤더를 넘기지 않는다 — If-None-Match 로 304(빈 본문)가 오면 고쳐 쓸 것이 없다
  const index = await assets.fetch(new Request(new URL('/', url.origin)));
  if (index.status !== 200) return index;
  const html = renderPage(await index.text(), route, url.origin, verificationOf(c.env));
  const headers = new Headers(index.headers);
  // 본문이 바뀌었다 — 길이 · ETag 는 정적 파일의 것이라 뗀다
  headers.delete('content-length');
  headers.delete('etag');
  headers.set('Content-Type', 'text/html; charset=utf-8');
  for (const [k, v] of pageHeaders(DEV_SERVER)) headers.set(k, v);
  return new Response(c.req.method === 'HEAD' ? null : html, { status: route === 'notFound' ? 404 : 200, headers });
}

export function serveRobots(c: Context<App>): Response {
  return c.text(robotsText(new URL(c.req.url).origin, c.env?.DAUM_WEBMASTER_LINE), 200, { 'Cache-Control': DAY_CACHE });
}

/** IndexNow 키 파일 (D120) — `/<INDEXNOW_KEY>.txt` 에 키 그대로. 다른 경로 · 키가 없으면 다음 처리기(화면 404)로 넘긴다 */
export function serveIndexNowKey(c: Context<App>): Response | undefined {
  const key = c.env?.INDEXNOW_KEY;
  if (indexNowKeyPath(key) !== c.req.path) return undefined;
  return c.text(key as string, 200, { 'Cache-Control': DAY_CACHE });
}

export function serveSitemap(c: Context<App>): Response {
  return c.body(sitemapXml(new URL(c.req.url).origin), 200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': DAY_CACHE });
}
