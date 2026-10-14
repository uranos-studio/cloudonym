// 검색 엔진용 응답 (D106) — /robots.txt · /sitemap.xml 과 화면 경로의 HTML(경로마다 head · 모르는 경로는 404).
// 절대 URL 은 늘 요청의 origin 으로 만든다 — 배포 도메인을 코드에 두지 않는다. 경로 표 · 문구는 화면과 같은 src/site 가 정본이다
import type { Context } from 'hono';
import type { App } from './env';
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

/** 하루 캐시 — /llms.txt 와 같다 */
const DAY_CACHE = 'public, max-age=86400';

export function robotsText(origin: string): string {
  return ['User-agent: *', 'Allow: /', 'Disallow: /v1/', '', `Sitemap: ${origin}/sitemap.xml`, ''].join('\n');
}

/** <lastmod> 는 싣지 않는다 — 선택 항목이고, 날짜를 만들면 시각 규칙(KST)을 하나 더 지켜야 한다 */
export function sitemapXml(origin: string): string {
  const urls = PAGES.map((p) => `  <url><loc>${escapeHtml(origin + p.path)}</loc></url>`);
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, '</urlset>', ''].join('\n');
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** head 끝에 붙일 태그 — canonical · Open Graph · Twitter · (뿌리만) WebApplication JSON-LD. 모르는 경로는 noindex 하나 */
export function headTags(route: Route, origin: string): string {
  const t = pageText(route);
  if (route === 'notFound') return '<meta name="robots" content="noindex">';
  const url = origin + pathOf(route);
  const tags = [
    `<link rel="canonical" href="${escapeHtml(url)}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:title" content="${escapeHtml(t.title)}">`,
    `<meta property="og:description" content="${escapeHtml(t.description)}">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    '<meta name="twitter:card" content="summary">',
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

/** #root 안의 요약 글 — 스크립트를 돌리지 않는 크롤러가 읽는다. React 의 createRoot().render 가 첫 그림에서 통째로 바꾼다 */
export function rootFallback(route: Route): string {
  const t = pageText(route);
  if (route === 'notFound') {
    return `<main><h1>${escapeHtml(t.heading)}</h1><p>${escapeHtml(en.ui.page_not_found_body)}</p><p><a href="/">${escapeHtml(pageText('app').title)}</a></p></main>`;
  }
  // AI 에이전트용 두 파일도 건다 — 스크립트 없이 읽는 쪽이 기계용 안내를 찾게
  const links = [...PAGES.map((p) => [p.path, pageText(p.route).heading]), ['/llms.txt', 'llms.txt'], ['/openapi.json', 'OpenAPI']];
  const nav = links.map(([href, text]) => `<a href="${href}">${escapeHtml(text ?? '')}</a>`).join(' · ');
  return `<main><h1>${escapeHtml(t.title)}</h1><p>${escapeHtml(t.description)}</p><nav>${nav}</nav></main>`;
}

/** 빌드한 index.html 에 경로의 head 와 요약 글을 넣는다. 자리(title · description · </head> · 빈 #root)가 없으면 그 부분만 건너뛴다 */
export function renderPage(html: string, route: Route, origin: string): string {
  const t = pageText(route);
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(t.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${escapeHtml(t.description)}" />`)
    .replace('</head>', `    ${headTags(route, origin)}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root">${rootFallback(route)}</div>`);
}

/** 화면 경로의 HTML — 정적 index.html 을 ASSETS 에서 받아 경로마다 고쳐 쓴다. 표에 없는 경로는 같은 본문에 404 와 noindex */
export async function servePage(c: Context<App>, assets: Fetcher): Promise<Response> {
  const url = new URL(c.req.url);
  const route = routeOf(url.pathname);
  // 요청 헤더를 넘기지 않는다 — If-None-Match 로 304(빈 본문)가 오면 고쳐 쓸 것이 없다
  const index = await assets.fetch(new Request(new URL('/', url.origin)));
  if (index.status !== 200) return index;
  const html = renderPage(await index.text(), route, url.origin);
  const headers = new Headers(index.headers);
  // 본문이 바뀌었다 — 길이 · ETag 는 정적 파일의 것이라 뗀다
  headers.delete('content-length');
  headers.delete('etag');
  headers.set('Content-Type', 'text/html; charset=utf-8');
  for (const [k, v] of PAGE_HEADERS) headers.set(k, v);
  return new Response(c.req.method === 'HEAD' ? null : html, { status: route === 'notFound' ? 404 : 200, headers });
}

export function serveRobots(c: Context<App>): Response {
  return c.text(robotsText(new URL(c.req.url).origin), 200, { 'Cache-Control': DAY_CACHE });
}

export function serveSitemap(c: Context<App>): Response {
  return c.body(sitemapXml(new URL(c.req.url).origin), 200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': DAY_CACHE });
}
