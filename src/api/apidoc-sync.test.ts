// /docs/api 안내(D98)의 문장 속 목록이 Worker 가 실제로 하는 일과 같은가. components 는 api 를 들여오지 않아 값을 따로 들고 있다 — 둘을 여기서 실제 요청으로 묶는다
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from './index';
import { FAIL_STATUSES, MAX_GENERATE_ERRORS, MAX_WIZARD_ERRORS } from './errors';
import { META_KEYS, logTelemetry } from './telemetry';
import { beaconPost, fakeKv, fakeLimiter, jsonPost, req } from './test-support';
import { VERSION } from '../version';
import {
  API_DOC_COMMON_FIELDS, API_DOC_COUNTED, API_DOC_FAIL_STATUSES, API_DOC_MAX_ERRORS, API_DOC_LIMITED_ROOT, API_DOC_SKIP_HEADER, API_DOC_UNLIMITED,
  apiEndpoints, requestExample, type ApiSpec,
} from '../components/apiDocModel';

const root = join(import.meta.dirname, '../..');
const spec = JSON.parse(readFileSync(join(root, 'public/openapi.json'), 'utf-8')) as ApiSpec;
const rows = apiEndpoints(spec, 'https://example.org', VERSION);
/** 정적 파일 — Worker 를 거치지 않는다 */
const STATIC = '/openapi.json';

/** 표의 한 행을 실제로 부르는 요청 — POST 는 명세의 request example, /v1/events 는 화면 비콘과 같은 헤더 */
function init(method: string, path: string, headers: Record<string, string> = {}): RequestInit | undefined {
  if (method === 'GET') return { headers };
  const body = requestExample(spec, path.replace(/^\/v1/, ''));
  if (path === '/v1/events') return beaconPost(body ?? { event: 'ui_visit' }, headers);
  const r = jsonPost(body);
  return { ...r, headers: { ...(r.headers as Record<string, string>), ...headers } };
}

describe('/docs/api ↔ Worker — 요청 제한', () => {
  it('표의 「Rate limited」 = 한도를 넘긴 limiter 아래에서 실제로 429 가 나는가 (정적 /openapi.json 제외)', async () => {
    for (const r of rows.filter((x) => x.path !== STATIC)) {
      const { limiter, keys } = fakeLimiter('deny');
      const { res } = await req(app, r.path, init(r.method, r.path), { API_LIMITER: limiter });
      expect(res.status === 429, `${r.method} ${r.path} → ${res.status}`).toBe(r.limited);
      expect(keys.length > 0, `${r.method} ${r.path} limiter`).toBe(r.limited);
    }
  });

  it('문장의 목록 — 제한을 받는 뿌리 GET · 받지 않는 GET 이 표와 같고, 제한 받는 POST 는 /v1/ 아래에만 있다', () => {
    const limitedGets = rows.filter((r) => r.method === 'GET' && r.limited).map((r) => r.path);
    expect(limitedGets).toEqual([...API_DOC_LIMITED_ROOT]);
    expect(rows.filter((r) => r.method === 'GET' && !r.limited).map((r) => r.path).sort()).toEqual([...API_DOC_UNLIMITED].sort());
    for (const r of rows.filter((x) => x.method === 'POST')) {
      expect(r.path.startsWith('/v1/'), r.path).toBe(true);
      expect(r.limited, r.path).toBe(true);
    }
  });

  it('/openapi.json 은 Worker 경로가 아니다 — run_worker_first 에 없고 app 은 404, 그래서 제한을 받지 않는다', async () => {
    const wrangler = readFileSync(join(root, 'wrangler.jsonc'), 'utf-8');
    const first = JSON.parse(/"run_worker_first":\s*(\[[^\]]*\])/.exec(wrangler)![1]!) as string[];
    expect(first).not.toContain(STATIC);
    const { res } = await req(app, STATIC, undefined, { API_LIMITER: fakeLimiter('deny').limiter });
    expect(res.status).toBe(404);
  });
});

describe('/docs/api ↔ Worker — CORS', () => {
  it('/v1/events 만 CORS 를 내지 않는다 · /openapi.json 은 _headers 가 * 를 단다', async () => {
    for (const r of rows.filter((x) => x.path !== STATIC)) {
      const { res } = await req(app, r.path, init(r.method, r.path, { origin: 'https://example.org' }));
      expect(res.headers.get('access-control-allow-origin'), `${r.method} ${r.path}`).toBe(r.internal ? null : '*');
    }
    const headers = readFileSync(join(root, 'public/_headers'), 'utf-8');
    expect(headers).toMatch(/^\/openapi\.json\n\s+Access-Control-Allow-Origin: \*/m);
  });
});

describe('/docs/api ↔ Worker — 실패 · 계측', () => {
  it('실패 상태 코드 = FAIL_STATUSES · 명세의 200 아닌 응답은 전부 그 안에 있다', () => {
    expect(API_DOC_FAIL_STATUSES).toEqual([...FAIL_STATUSES]);
    const codes = new Set(Object.values(spec.paths).flatMap((item) => (['get', 'post'] as const)
      .flatMap((m) => Object.keys((item[m] as { responses?: object } | undefined)?.responses ?? {}))));
    for (const c of codes) if (c !== '200') expect(API_DOC_FAIL_STATUSES, c).toContain(Number(c));
  });

  it('/v1/wizard · /v1/generate 400 오류 수 상한 = MAX_WIZARD_ERRORS = MAX_GENERATE_ERRORS (D103)', () => {
    expect(API_DOC_MAX_ERRORS).toBe(MAX_WIZARD_ERRORS);
    expect(API_DOC_MAX_ERRORS).toBe(MAX_GENERATE_ERRORS);
  });

  it('세는 요청 — 각 요청이 실제로 그 이벤트 하나를 KV 에 센다 · 목록 = 화면 이벤트(ui_*) 밖의 META_KEYS', async () => {
    expect(API_DOC_COUNTED.map((c) => c.event).sort()).toEqual(Object.keys(META_KEYS).filter((e) => !e.startsWith('ui_')).sort());
    for (const c of API_DOC_COUNTED) {
      const [method, path] = c.request.split(' ') as [string, string];
      const { kv, store } = fakeKv();
      const { res, promises } = await req(app, path, init(method, path), { CLOUDONYM_KV: kv });
      await Promise.all(promises);
      expect(res.status, c.request).toBe(200);
      expect([...store.keys()].map((k) => k.split(':')[1]), c.request).toEqual([c.event]);
    }
  });

  it('세지 않는 요청 (D99) — 안내가 적은 헤더에 비밀과 같은 값을 실으면 세는 요청 전부가 KV 에 아무것도 쓰지 않고 응답은 200', async () => {
    const secret = 'apidoc-sync-secret';
    for (const c of API_DOC_COUNTED) {
      const [method, path] = c.request.split(' ') as [string, string];
      const { kv, store } = fakeKv();
      const { res, promises } = await req(app, path, init(method, path, { [API_DOC_SKIP_HEADER]: secret }), { CLOUDONYM_KV: kv, TELEMETRY_SKIP_TOKEN: secret });
      await Promise.all(promises);
      expect(res.status, c.request).toBe(200);
      expect(store.size, c.request).toBe(0);
    }
  });

  it('기록마다 서버가 싣는 칸 = API_DOC_COMMON_FIELDS (meta 없는 이벤트의 Axiom 본문)', async () => {
    const bodies: string[] = [];
    const fetchFn = (_url: string, i: { body: string }) => { bodies.push(i.body); return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') }); };
    await logTelemetry({ env: { AXIOM_API_KEY: 'k', AXIOM_DATASET: 'd' }, req: { header: () => undefined } }, 'llms_txt_accessed', {}, { fetchFn });
    const record = (JSON.parse(bodies[0]!) as Record<string, unknown>[])[0]!;
    expect(Object.keys(record).sort()).toEqual([...API_DOC_COMMON_FIELDS].sort());
  });
});
