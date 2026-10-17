import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from './index';
import { req, fakeLimiter } from './test-support';
import { headersRule, indexNowKeyPath, PAGE_HEADERS, pageHeaders, renderPage, robotsText, sitemapXml } from './site';
import { PAGES } from '../site/pages';
import { pageText } from '../site/copy';
import { en } from '../messages/en';

const root = join(import.meta.dirname, '..', '..');
const INDEX = readFileSync(join(root, 'index.html'), 'utf-8');
const HEADERS_TEXT = readFileSync(join(root, 'public/_headers'), 'utf-8');
const HANGUL = /\p{Script=Hangul}/u;

/** 정적 자산 바인딩 흉내 — `/` 에 index.html 을 주고, 받은 요청을 적어 둔다 */
function fakeAssets(html = INDEX, init: ResponseInit = { headers: { 'content-type': 'text/html', etag: '"abc"', 'content-length': '999', 'cache-control': 'public, max-age=0, must-revalidate' } }) {
  const seen: Request[] = [];
  const assets = { fetch: async (r: Request) => { seen.push(r); return new Response(html, init); }, connect: () => { throw new Error('no'); } } as unknown as Fetcher;
  return { assets, seen };
}
const get = (path: string, init?: RequestInit, assets = fakeAssets().assets) => req(app, `https://example.org${path}`, init, { ASSETS: assets });

describe('robots.txt · sitemap.xml (D106) — 요청 origin 으로 절대 URL', () => {
  it('robots — 전부 허용 · /v1/ 막기 · Sitemap 은 origin 의 /sitemap.xml', async () => {
    expect(robotsText('https://a.test')).toBe('User-agent: *\nAllow: /\nDisallow: /v1/\n\nSitemap: https://a.test/sitemap.xml\n');
    const { res, promises } = await req(app, 'https://x.example/robots.txt', undefined, { API_LIMITER: fakeLimiter('deny').limiter });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(await res.text()).toContain('Sitemap: https://x.example/sitemap.xml');
    // 상수 본문 — 요청 제한 · 카운터를 걸지 않는다
    expect(promises).toEqual([]);
  });
  it('sitemap — 경로 표 여섯이 순서대로 · lastmod 없음 · application/xml', async () => {
    const { res, promises } = await req(app, 'https://x.example/sitemap.xml', undefined, { API_LIMITER: fakeLimiter('deny').limiter });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/xml/);
    const body = await res.text();
    expect(body).toBe(sitemapXml('https://x.example'));
    expect([...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])).toEqual(PAGES.map((p) => `https://x.example${p.path}`));
    expect(body).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
    expect(body).not.toContain('lastmod');
    expect(promises).toEqual([]);
  });
});

describe('화면 HTML (D106) — 경로마다 head · 모르는 경로는 404 + noindex', () => {
  it('index.html 에 고쳐 쓸 자리 넷이 다 있다 — title · description · </head> · 빈 #root', () => {
    expect(INDEX).toMatch(/<title>[^<]*<\/title>/);
    expect(INDEX).toMatch(/<meta name="description" content="[^"]*"\s*\/?>/);
    expect(INDEX).toContain('</head>');
    expect(INDEX).toContain('<div id="root"></div>');
  });

  it.each(PAGES.map((p) => [p.path, p.route] as const))('%s → 200 · 제 제목 · 설명 · canonical · og · twitter', async (path, route) => {
    const { res } = await get(path);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const html = await res.text();
    const t = pageText(route);
    expect(html).toContain(`<title>${t.title}</title>`);
    expect(html).toContain(`<meta name="description" content="${t.description}" />`);
    expect(html).toContain(`<link rel="canonical" href="https://example.org${path}">`);
    expect(html).toContain(`<meta property="og:url" content="https://example.org${path}">`);
    expect(html).toContain(`<meta property="og:title" content="${t.title}">`);
    expect(html).toContain('<meta property="og:type" content="website">');
    expect(html).toContain('<meta property="og:site_name" content="Cloudonym">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain('<meta property="og:image" content="https://example.org/og-image.png">');
    expect(html).not.toContain('noindex');
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html.match(/<meta name="description"/g)).toHaveLength(1);
    // 요약 글 — 스크립트 없이 읽힌다 · 한글 0(release-check 가 / 본문에서 센다)
    expect(html).toMatch(/<div id="root"><main><h1>[^<]+<\/h1><p>[^<]+<\/p><nav>/);
    expect(html).toContain('<a href="/llms.txt">llms.txt</a>');
    expect(html).not.toMatch(HANGUL);
  });

  it('canonical 은 경로 표의 자리 — 끝 / · query 를 뗀다', async () => {
    const html = await (await get('/pick/?fixture=x')).res.text();
    expect(html).toContain('<link rel="canonical" href="https://example.org/pick">');
  });

  it('JSON-LD 는 뿌리에만 — WebApplication · DeveloperApplication · 무료 · 평점 없음 · url 은 origin', async () => {
    const html = await (await get('/')).res.text();
    const m = /<script type="application\/ld\+json">([^<]*)<\/script>/.exec(html);
    expect(m).not.toBeNull();
    const ld = JSON.parse(m![1]!);
    expect(ld).toMatchObject({ '@context': 'https://schema.org', '@type': 'WebApplication', name: 'Cloudonym', url: 'https://example.org/', applicationCategory: 'DeveloperApplication', operatingSystem: 'Any', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, description: en.ui.meta_description });
    expect(Object.keys(ld).filter((k) => /^(?:aggregateRating|review)$/.test(k))).toEqual([]);
    for (const p of PAGES.filter((x) => x.route !== 'app')) expect(await (await get(p.path)).res.text(), p.path).not.toContain('ld+json');
  });

  it('모르는 경로 → 404 · 같은 index.html 본문 · noindex · canonical 없음 · 「Page not found」', async () => {
    for (const path of ['/no-such-page', '/docs', '/pick/x', '/index.html', '/missing.png']) {
      const { res } = await get(path);
      expect(res.status, path).toBe(404);
      const html = await res.text();
      expect(html).toContain('<meta name="robots" content="noindex">');
      expect(html).not.toContain('rel="canonical"');
      expect(html).toContain(`<title>${pageText('notFound').title}</title>`);
      expect(html).toContain(en.ui.page_not_found_body);
      expect(html).toContain('<script type="module"');
    }
  });

  it('보안 헤더 — _headers 의 /* 줄 전부를 같은 값으로 단다(secureHeaders 의 SAMEORIGIN · no-referrer 로 덮이지 않는다) · ETag · 길이는 뗀다', async () => {
    const rule = headersRule(HEADERS_TEXT, '/*');
    expect(rule.map(([k]) => k)).toEqual(['Content-Security-Policy', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy', 'Cross-Origin-Opener-Policy']);
    expect(PAGE_HEADERS).toEqual(rule);
    for (const path of ['/', '/docs/api', '/nope']) {
      const { res } = await get(path);
      for (const [k, v] of rule) expect(res.headers.get(k), `${path} ${k}`).toBe(v);
      expect(res.headers.get('etag')).toBeNull();
      expect(res.headers.get('content-length')).toBeNull();
      expect(res.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    }
  });

  it('개발 서버만 CSP 를 뺀다 (D108) — 운영 헤더는 _headers 그대로 · 나머지 다섯은 개발 서버도 같다', () => {
    const rule = headersRule(HEADERS_TEXT, '/*');
    expect(pageHeaders(false)).toEqual(rule);
    expect(pageHeaders(true)).toEqual(rule.filter(([k]) => k !== 'Content-Security-Policy'));
    expect(pageHeaders(true)).toHaveLength(rule.length - 1);
    // 판정은 MODE === 'development' 하나다 — vite build 는 'production', vitest 는 'test' 라 여기 응답에는 CSP 가 붙는다(위 시험)
    const src = readFileSync(join(root, 'src/api/site.ts'), 'utf-8');
    expect(src).toContain("const DEV_SERVER = import.meta.env.MODE === 'development';");
    expect(src).toContain('pageHeaders(DEV_SERVER)');
    expect(import.meta.env.MODE).not.toBe('development');
  });

  it('검사기 자체 — headersRule 은 그 규칙 아래 줄만 · 주석은 건너뛴다', () => {
    expect(headersRule('# c\n/*\n  A: 1\n  B: x: y\n/o\n  A: 2\n', '/*')).toEqual([['A', '1'], ['B', 'x: y']]);
    expect(headersRule('# c\n/*\n  A: 1\n/o\n  A: 2\n', '/o')).toEqual([['A', '2']]);
  });

  it('ASSETS 에는 요청 헤더 없이 / 를 묻는다(304 를 받지 않게) · HEAD 는 본문 없이 같은 상태 · 헤더', async () => {
    const { assets, seen } = fakeAssets();
    const { res } = await get('/docs/naming', { headers: { 'if-none-match': '"abc"' } }, assets);
    expect(res.status).toBe(200);
    expect(seen.map((r) => new URL(r.url).pathname)).toEqual(['/']);
    expect(seen[0]!.headers.get('if-none-match')).toBeNull();
    const head = await get('/nope', { method: 'HEAD' });
    expect(head.res.status).toBe(404);
    expect(await head.res.text()).toBe('');
    expect(head.res.headers.get('content-security-policy')).toBe(PAGE_HEADERS[0]![1]);
  });

  it('ASSETS 가 200 이 아니면 그대로 돌려준다', async () => {
    const { assets } = fakeAssets('gone', { status: 503 });
    expect((await get('/', undefined, assets)).res.status).toBe(503);
  });

  it('Worker 경로는 화면이 가로채지 않는다 — /v1/* · /llms.txt · /catalog.json · /robots.txt · /sitemap.xml · POST', async () => {
    expect((await get('/v1/health')).res.headers.get('content-type')).toMatch(/json/);
    const nope = await get('/v1/nope');
    expect(nope.res.status).toBe(404);
    expect(nope.res.headers.get('content-type')).toMatch(/json/);
    for (const p of ['/llms.txt', '/robots.txt']) expect((await get(p)).res.headers.get('content-type'), p).toMatch(/^text\/plain/);
    expect((await get('/catalog.json')).res.headers.get('content-type')).toMatch(/json/);
    expect((await get('/sitemap.xml')).res.headers.get('content-type')).toMatch(/xml/);
    const post = await get('/pick', { method: 'POST' });
    expect(post.res.status).toBe(404);
    expect(post.res.headers.get('content-type')).toMatch(/json/);
  });

  it('origin 은 이스케이프한다 — 속성 · 본문을 깨지 않는다', () => {
    const html = renderPage(INDEX, 'app', 'https://a.test"><x');
    expect(html).toContain('href="https://a.test&quot;&gt;&lt;x/"');
    expect(html).not.toContain('"><x');
  });
});

describe('wrangler.jsonc — 화면 HTML 을 Worker 가 받는 설정 (D106)', () => {
  const cfg = readFileSync(join(root, 'wrangler.jsonc'), 'utf-8');
  it('ASSETS 바인딩 · not_found_handling none · run_worker_first 에 / 와 Worker 파일 경로', () => {
    expect(cfg).toMatch(/"binding":\s*"ASSETS"/);
    expect(cfg).toMatch(/"not_found_handling":\s*"none"/);
    const first = JSON.parse(/"run_worker_first":\s*(\[[^\]]*\])/.exec(cfg)![1]!) as string[];
    expect(first).toEqual(['/', '/v1/*', '/llms.txt', '/catalog.json', '/robots.txt', '/sitemap.xml']);
  });
});

describe('검색 엔진 소유 확인 · IndexNow (D120) — vars 가 없으면 아무것도 내지 않는다', () => {
  const NAVER = 'n0a1v2e3r4';
  const DAUM = '#DaumWebMasterTool:abc:def+/==';
  const KEY = '0123456789abcdef0123456789abcdef';
  const VARS = { NAVER_SITE_VERIFICATION: NAVER, DAUM_WEBMASTER_LINE: DAUM, INDEXNOW_KEY: KEY };
  const getEnv = (path: string, env: Record<string, unknown>) => req(app, `https://example.org${path}`, undefined, { ASSETS: fakeAssets().assets, ...env });

  it('네이버 메타는 뿌리 `/` 의 head 에만', async () => {
    const home = await (await getEnv('/', VARS)).res.text();
    const head = home.slice(0, home.indexOf('</head>'));
    expect(head).toContain(`<meta name="naver-site-verification" content="${NAVER}">`);
    for (const p of PAGES.filter((x) => x.path !== '/')) {
      expect(await (await getEnv(p.path, VARS)).res.text()).not.toContain('naver-site-verification');
    }
    expect(await (await getEnv('/nope', VARS)).res.text()).not.toContain('naver-site-verification');
  });
  it('vars 가 없거나 비면 네이버 메타가 없다', async () => {
    expect(await (await getEnv('/', {})).res.text()).not.toContain('naver-site-verification');
    expect(await (await getEnv('/', { NAVER_SITE_VERIFICATION: '' })).res.text()).not.toContain('naver-site-verification');
  });

  it('robots — Daum 줄이 맨 끝 줄 · 전부 허용은 그대로', async () => {
    const body = await (await getEnv('/robots.txt', VARS)).res.text();
    const lines = body.trimEnd().split('\n');
    expect(lines.at(-1)).toBe(DAUM);
    expect(body).toMatch(/^User-agent: \*\nAllow: \/\n/);
    expect(robotsText('https://a.test', DAUM)).toBe(`User-agent: *\nAllow: /\nDisallow: /v1/\n\nSitemap: https://a.test/sitemap.xml\n\n${DAUM}\n`);
  });
  it('robots — Daum 값이 없거나 비거나 줄바꿈이 섞이면 원래 본문', async () => {
    const plain = robotsText('https://example.org');
    expect(await (await getEnv('/robots.txt', {})).res.text()).toBe(plain);
    expect(robotsText('https://example.org', '')).toBe(plain);
    expect(robotsText('https://example.org', 'a\nDisallow: /')).toBe(plain);
  });

  it('`/<키>.txt` → 200 text/plain · 본문은 키', async () => {
    const { res, promises } = await getEnv(`/${KEY}.txt`, VARS);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(await res.text()).toBe(KEY);
    expect(promises).toEqual([]);
  });
  it('다른 .txt 와 키가 없을 때는 지금처럼 — 화면 404', async () => {
    for (const [path, env] of [[`/${KEY.slice(1)}0.txt`, VARS], [`/${KEY}.txt`, {}], [`/${KEY}.txt`, { INDEXNOW_KEY: '' }], ['/../x.txt', { INDEXNOW_KEY: 'bad key!' }]] as const) {
      const { res } = await getEnv(path, env);
      expect(res.status, path).toBe(404);
      expect(await res.text()).not.toBe(KEY);
    }
    expect(indexNowKeyPath('short')).toBeUndefined();
    expect(indexNowKeyPath(KEY)).toBe(`/${KEY}.txt`);
  });

  it('wrangler.jsonc vars 에 세 값이 있다 — 키 파일 경로는 정적 파일과 겹치지 않는다', () => {
    const w = readFileSync(join(root, 'wrangler.jsonc'), 'utf-8');
    for (const k of ['NAVER_SITE_VERIFICATION', 'DAUM_WEBMASTER_LINE', 'INDEXNOW_KEY']) expect(w).toMatch(new RegExp(`"${k}": "[^"]+"`));
    const key = /"INDEXNOW_KEY": "([^"]+)"/.exec(w)![1];
    expect(indexNowKeyPath(key)).toBeDefined();
    expect(readdirSync(join(root, 'public'))).not.toContain(`${key}.txt`);
    // not_found_handling none — 정적 파일이 없는 경로는 Worker 로 온다
    expect(w).toMatch(/"not_found_handling": "none"/);
  });
});
