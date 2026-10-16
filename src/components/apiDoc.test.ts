// /docs/api 안내 — curl 예제는 public/openapi.json 의 request example 에서 만든다 · 요청 제한 숫자는 상수에서 · 도메인 문자열 0 · 명세의 경로가 빠짐없이 표에 있다
// 요청 제한 상수가 api 쪽 RATE_LIMIT 과 같은지는 src/api/privacy-sync.test.ts 가 본다 (components 는 api 를 들여오지 않는다)
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { en } from '../messages/en';
import { VERSION } from '../version';
import { PRIVACY_RATE_LIMIT } from './privacyModel';
import { API_DOC_COUNTED, API_DOC_FAIL_STATUSES, API_DOC_RATE_LIMIT, API_DOC_SKIP_HEADER, API_DOC_VERSIONED, apiDocVars, apiEndpoints, countedFields, errorExample, isApiSpec, listText, loadSpec, requestExample, rulesVersionConflict, shellQuote, type ApiSpec } from './apiDocModel';
import { ApiDocBody } from './ApiDoc';
import { AppHeader } from './AppHeader';

const raw = import.meta.glob('../../public/openapi.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const spec = JSON.parse(Object.values(raw)[0] ?? '{}') as ApiSpec;
const sources = import.meta.glob(['./ApiDoc.tsx', './apiDocModel.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const ORIGIN = 'https://<host>';
const HANGUL = /\p{Script=Hangul}/u;
const POSTS = ['/generate', '/names', '/wizard', '/validate'] as const;

/** 시험용 — curl 줄에서 -d 뒤 작은따옴표 인자를 셸처럼 풀어 낸다 ('\'' 는 ' 하나) */
function dataArg(curl: string): string {
  const m = /-d ('(?:[^']|'\\'')*')\s*$/.exec(curl);
  if (!m) throw new Error(`no -d argument: ${curl}`);
  return m[1]!.slice(1, -1).replace(/'\\''/g, "'");
}

/** 태그를 벗긴 본문 */
function text(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

describe('apiDocModel — 명세(public/openapi.json)에서 만든 엔드포인트 표 · 예제', () => {
  const rows = apiEndpoints(spec, ORIGIN, VERSION);
  const row = (id: string) => rows.find((r) => r.id === id)!;

  it('명세의 경로 · 메서드가 빠짐없이 표에 있고, 명세 밖의 /llms.txt · /openapi.json 이 더해진다', () => {
    const fromSpec = Object.entries(spec.paths).flatMap(([p, item]) => Object.keys(item).filter((k) => k !== 'servers').map((m) => `${m.toUpperCase()} ${p}`));
    expect(fromSpec.length).toBeGreaterThanOrEqual(7);
    for (const s of fromSpec) {
      const [method, p] = s.split(' ');
      expect(rows.some((r) => r.method === method && r.path.endsWith(p!)), s).toBe(true);
    }
    expect(rows.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /v1/generate', 'POST /v1/names', 'POST /v1/wizard', 'POST /v1/validate', 'GET /v1/health',
      'GET /llms.txt', 'GET /openapi.json', 'GET /catalog.json', 'POST /v1/events',
    ]);
  });

  it.each(POSTS)('POST %s — curl 의 본문은 명세의 request example 그대로 · 호스트는 넘긴 origin', (p) => {
    const r = row(p.slice(1));
    const example = requestExample(spec, p);
    expect(example).toBeDefined();
    expect(r.curl).toContain(`-X POST ${ORIGIN}/v1${p} `);
    expect(r.curl).toContain(`-H 'content-type: application/json'`);
    expect(JSON.parse(dataArg(r.curl!))).toEqual(example);
    expect(dataArg(r.curl!)).toBe(JSON.stringify(example));
  });

  it('GET 예제 — health · catalog(사이트 뿌리) · llms.txt · openapi.json 은 본문 없이 origin + 경로', () => {
    expect(row('health').curl).toBe(`curl -s ${ORIGIN}/v1/health`);
    expect(row('catalog').curl).toBe(`curl -s ${ORIGIN}/catalog.json`);
    expect(row('llms').curl).toBe(`curl -s ${ORIGIN}/llms.txt`);
    expect(row('openapi').curl).toBe(`curl -s ${ORIGIN}/openapi.json`);
  });

  it('요청 제한 표시 — 명세에 429 가 있는 것과 /llms.txt 만. health · openapi.json 은 세지 않는다', () => {
    expect(Object.fromEntries(rows.map((r) => [r.id, r.limited]))).toEqual({
      generate: true, names: true, wizard: true, validate: true, health: false, llms: true, openapi: false, catalog: true, events: true,
    });
  });

  it('/v1/events 는 internal — 예제를 싣지 않는다(같은 출처 화면 비콘이라 다른 호출은 403)', () => {
    expect(row('events').internal).toBe(true);
    expect(row('events').curl).toBeUndefined();
    expect(row('events').response).toBeUndefined();
    expect(rows.filter((r) => r.internal).map((r) => r.id)).toEqual(['events']);
  });

  it('응답 일부 — 키는 명세의 응답 스키마 그대로, version 은 지금 VERSION', () => {
    const versionLine = `"version": { "engine": "${VERSION.engine}", "rules": "${VERSION.rules}" }`;
    for (const id of ['generate', 'names', 'wizard', 'validate', 'health', 'catalog']) {
      expect(row(id).response, id).toContain(versionLine);
    }
    expect(row('generate').response).toContain('"success": true');
    expect(row('generate').response).toContain('"data": { … }');
    expect(row('health').response).toBe(`{\n  "ok": true,\n  ${versionLine}\n}`);
    const keysOf = (s: string) => [...s.matchAll(/^ {2}"(\w+)"\??:/gm)].map((m) => m[1]);
    expect(keysOf(row('validate').response!)).toEqual(Object.keys(spec.components.schemas['ValidateResponse']!.properties!));
  });

  it('선택 필드 표시 — 스키마의 required 에 없는 키만 「"키"?:」 (validate 의 warnings · suggested_name · suggested_warnings)', () => {
    for (const r of rows.filter((x) => x.response)) {
      const optional = [...r.response!.matchAll(/^ {2}"(\w+)"\?:/gm)].map((m) => m[1]);
      expect(optional, r.id).toEqual(r.id === 'validate' ? ['warnings', 'suggested_name', 'suggested_warnings'] : []);
    }
    expect(spec.components.schemas['ValidateResponse']!.required).not.toContain('suggested_name');
    expect(spec.components.schemas['ValidateResponse']!.required).not.toContain('warnings');
  });

  it('version 을 싣는 경로 목록 = 명세의 200 응답에 version 이 있는 경로', () => {
    expect(rows.filter((r) => r.response?.includes('"version":')).map((r) => r.path)).toEqual(API_DOC_VERSIONED);
  });

  it('listText · countedFields — 문장에 끼우는 목록', () => {
    expect(listText([])).toBe('');
    expect(listText(['a'])).toBe('a');
    expect(listText(['a', 'b'], 'or')).toBe('a or b');
    expect(listText([1, 2, 3])).toBe('1, 2 and 3');
    expect(countedFields()).toEqual(['providers', 'provider', 'resource_count', 'name_count', 'valid', 'resource_type', 'service_count', 'chip_rules', 'custom_rules']);
  });

  it('isApiSpec · loadSpec — 모양이 틀린 명세 · HTTP 오류 · JSON 아님은 error (화면이 하얗게 되지 않는다)', async () => {
    expect(isApiSpec(spec)).toBe(true);
    const bad: unknown[] = [null, [], 'x', {}, { servers: [], paths: {} }, { servers: [], components: { schemas: {} } },
      { servers: [], paths: { '/x': { get: {} } }, components: { schemas: {} } }, { servers: [], paths: { '/x': null }, components: { schemas: {} } }];
    for (const b of bad) expect(isApiSpec(b), JSON.stringify(b)).toBe(false);
    const got = (body: unknown, ok = true) => () => Promise.resolve({ ok, status: ok ? 200 : 503, json: () => (body instanceof Error ? Promise.reject(body) : Promise.resolve(body)) } as Response);
    expect(await loadSpec(got(spec))).toBe(spec);
    expect(await loadSpec(got({ openapi: '3.0.3' }))).toBe('error');
    expect(await loadSpec(got(spec, false))).toBe('error');
    expect(await loadSpec(got(new SyntaxError('not json')))).toBe('error');
    expect(await loadSpec(() => Promise.reject(new TypeError('offline')))).toBe('error');
    // 모양이 틀린 명세를 그대로 그렸다면 던졌을 것이다 — 검사기가 막는 것이 실제로 터지는지
    expect(() => apiEndpoints({ servers: [], paths: { '/x': { get: {} } }, components: { schemas: {} } } as unknown as ApiSpec, ORIGIN, VERSION)).toThrow();
  });

  it('실패 꼴 — ErrorResponse 의 example 그대로 · 409 문장은 명세의 /generate 409 설명', () => {
    const e = JSON.parse(errorExample(spec)) as { success: boolean; errors: unknown[] };
    expect(e.success).toBe(false);
    expect(e.errors).toEqual(spec.components.schemas['ErrorResponse']!.properties!['errors']!.example);
    const conflict = rulesVersionConflict(spec);
    expect(conflict).toContain('rules_version');
    expect(conflict).toBe((spec.paths['/generate']!['post'] as { responses: Record<string, { description: string }> }).responses['409']!.description);
  });

  it('shellQuote — 작은따옴표를 셸이 푸는 꼴로 감싼다 (검사기 자체 시험 포함)', () => {
    expect(shellQuote(`{"a":"b"}`)).toBe(`'{"a":"b"}'`);
    expect(shellQuote(`it's`)).toBe(`'it'\\''s'`);
    expect(dataArg(`curl -d ${shellQuote(`it's`)}`)).toBe(`it's`);
  });

  it('요청 제한 상수는 /privacy 와 같은 값(그 값은 api 의 RATE_LIMIT 과 privacy-sync.test 가 묶는다)', () => {
    expect(API_DOC_RATE_LIMIT).toBe(PRIVACY_RATE_LIMIT);
  });
});

describe('/docs/api 화면', () => {
  beforeAll(() => { vi.stubGlobal('window', { location: { hash: '', origin: ORIGIN }, localStorage: undefined, matchMedia: undefined }); });
  afterAll(() => { vi.unstubAllGlobals(); });
  const html = () => renderToStaticMarkup(createElement(ApiDocBody, { spec, origin: ORIGIN }));

  it('요청 제한 숫자 · 429 · Retry-After · 인증 없음 · 409 · version · PASS 문장 · 링크', () => {
    const t = text(html());
    expect(t).toContain(`${API_DOC_RATE_LIMIT.limit} requests per ${API_DOC_RATE_LIMIT.period} seconds`);
    expect(t).toContain('429');
    expect(t).toContain('Retry-After');
    expect(t).toContain(en.ui.api_auth_body);
    expect(t).toContain('409');
    expect(t).toContain(rulesVersionConflict(spec));
    expect(t).toContain(en.ui.pass_meaning);
    expect(t).toContain('version: { engine, rules }');
    expect(t).toContain('examples/terraform/');
    // 문장 속 목록은 모델의 상수에서 채운다 — 빈 자리 { 이름 } 이 남지 않는다
    const v = apiDocVars();
    expect(t).toContain(`GET requests for ${v.limited}.`);
    expect(t).toContain(`GET requests for ${v.unlimited} are not counted`);
    expect(t).toContain(`Every failure (${listText(API_DOC_FAIL_STATUSES)})`);
    expect(t).toContain(`Every successful response of ${listText(API_DOC_VERSIONED)} carries`);
    expect(t).toContain(`Each successful ${listText(API_DOC_COUNTED.map((c) => c.request), 'or')} is counted`);
    expect(t).toContain(v.fields);
    // D99 — 점검 요청은 세지 않는다 · KV 는 근사치
    expect(t).toContain(`Requests whose ${API_DOC_SKIP_HEADER} header carries the operator's secret value are not counted`);
    expect(t).toContain('The daily KV counters are approximate');
    expect(t).not.toMatch(/\{[a-z]\w*\}/);
    const h = html();
    for (const href of ['/openapi.json', '/llms.txt', '/catalog.json', '/privacy']) expect(h, href).toContain(`href="${href}"`);
  });

  it('모든 POST 예제가 화면에 그대로 있다 — curl 의 본문 = 명세 example', () => {
    const t = text(html());
    for (const p of POSTS) expect(t, p).toContain(`-d ${shellQuote(JSON.stringify(requestExample(spec, p)))}`);
  });

  it('도메인 문자열이 없다 — 화면의 URL 은 넘긴 origin 뿐 · 소스에 http 리터럴 0', () => {
    const h = html().split(ORIGIN.replace('<', '&lt;').replace('>', '&gt;')).join('');
    expect(h).not.toMatch(/https?:\/\//);
    expect(Object.keys(sources)).toHaveLength(2);
    for (const [f, src] of Object.entries(sources)) expect(src, f).not.toMatch(/https?:\/\//);
    // 사전의 api_* 문구도 — 화면이 그리지 않는 갈래(불러오는 중 · 실패)까지
    const apiKeys = Object.keys(en.ui).filter((k) => k.startsWith('api_'));
    expect(apiKeys.length).toBeGreaterThanOrEqual(20);
    for (const k of apiKeys) expect(en.ui[k as keyof typeof en.ui], k).not.toMatch(/https?:\/\/|\.(?:dev|com|io|net|org)\b/);
    // 검사기 — 도메인이 섞이면 잡는다
    expect('<a href="https://example.com/v1">'.split(ORIGIN).join('')).toMatch(/https?:\/\//);
  });

  it('명세를 아직 못 받았으면 엔드포인트 자리에 불러오는 중 문장 · 나머지 절은 그대로', () => {
    const t = text(renderToStaticMarkup(createElement(ApiDocBody, { spec: null, origin: ORIGIN })));
    expect(t).toContain(en.ui.api_loading);
    expect(t).toContain(en.ui.api_auth_body);
    const failed = text(renderToStaticMarkup(createElement(ApiDocBody, { spec: 'error', origin: ORIGIN })));
    expect(failed).toContain(en.ui.api_spec_failed);
  });

  it('화면 문구에 한글 0', () => {
    expect(html()).not.toMatch(HANGUL);
  });
});

describe('머리글 — API 링크', () => {
  beforeAll(() => { vi.stubGlobal('window', { location: { hash: '' }, localStorage: undefined, matchMedia: undefined }); });
  afterAll(() => { vi.unstubAllGlobals(); });
  it('넘긴 apiHref 로 data-nav-api 링크를 그린다 — 마법사 · 트리 모두', () => {
    for (const screen of ['wizard', 'tree'] as const) {
      const h = renderToStaticMarkup(createElement(AppHeader, { screen, otherHref: '/x', namingHref: '/docs/naming', apiHref: '/docs/api#state=abc', aboutHref: '/about' }));
      expect(h, screen).toMatch(/<a href="\/docs\/api#state=abc" data-nav-api[^>]*>.*?API<\/a>/);
    }
  });
});
