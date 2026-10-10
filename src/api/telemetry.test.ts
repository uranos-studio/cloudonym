import { describe, it, expect, vi } from 'vitest';
import { classifyClient, isAiAgent, kstStamp, logTelemetry, KV_TTL_SECONDS, META_KEYS, type FetchLike, type TelemetrySource } from './telemetry';
import { fakeKv } from './test-support';

// 고정 시각 — 실제 시계를 쓰지 않는다. UTC 09-28 15:30 = KST 09-29 00:30 (자정 경계)
const NOW = new Date('2026-09-28T15:30:00Z');
const source = (env: TelemetrySource['env'], ua = 'curl/8.7'): TelemetrySource => ({ env, req: { header: (n) => (n === 'user-agent' ? ua : undefined) } });

type Call = { url: string; init: { method: string; headers: Record<string, string>; body: string } };

/** fetch 를 가짜로 — 호출을 기록하고 정한 응답을 돌려준다. fail 이면 reject(네트워크 오류) */
function fakeFetch(opts: { fail?: boolean; status?: number; body?: string } = {}): { fetchFn: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const status = opts.status ?? 200;
  const fetchFn: FetchLike = (url, init) => {
    calls.push({ url, init });
    if (opts.fail) return Promise.reject(new Error('네트워크'));
    return Promise.resolve({ ok: status >= 200 && status < 300, status, text: () => Promise.resolve(opts.body ?? '{"ingested":1,"failed":0,"failures":[]}') });
  };
  return { fetchFn, calls };
}

/** 매크로태스크 한 번 — 마이크로태스크로 이어지는 작업이 다 돌 때까지 기다린다 */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('kstStamp — KST 자정 경계', () => {
  it('2026-09-28T15:30:00Z → 일자 키 2026-09-29 (UTC 날짜 09-28 과 다르다)', () => {
    expect(kstStamp(NOW).day).toBe('2026-09-29');
  });
  it('_time 은 2026-09-29T00:30:00+09:00 (Z 가 아니다)', () => {
    expect(kstStamp(NOW).time).toBe('2026-09-29T00:30:00+09:00');
  });
  it('14:59:59Z 는 전날 23:59:59 · 15:00:00Z 는 00:00:00 (24:00 이 아니다)', () => {
    expect(kstStamp(new Date('2026-09-28T14:59:59Z'))).toEqual({ day: '2026-09-28', time: '2026-09-28T23:59:59+09:00' });
    expect(kstStamp(new Date('2026-09-28T15:00:00Z'))).toEqual({ day: '2026-09-29', time: '2026-09-29T00:00:00+09:00' });
  });
});

describe('isAiAgent — ① 정규식', () => {
  it('Cursor · Windsurf · Claude · GPTBot · Copilot 만 (대소문자 무시)', () => {
    for (const ua of ['Cursor/1.0', 'windsurf', 'Claude-Code/2.0', 'Mozilla/5.0 (compatible; GPTBot/1.0)', 'GitHub-Copilot']) expect(isAiAgent(ua), ua).toBe(true);
    for (const ua of ['curl/8.7', 'Mozilla/5.0 Chrome/130', 'terraform-provider-http/3.4', '']) expect(isAiAgent(ua), ua).toBe(false);
  });
});

describe('logTelemetry', () => {
  it('KV 일자 키를 KST 날짜로 올린다 — 두 번 부르면 2 · AI UA 면 ai_agent_hits 도', async () => {
    const { kv, store } = fakeKv();
    await logTelemetry(source({ CLOUDONYM_KV: kv }), 'api_generate', {}, { now: NOW });
    await logTelemetry(source({ CLOUDONYM_KV: kv }), 'api_generate', {}, { now: NOW });
    expect(store.get('stats:api_generate:2026-09-29')).toBe('2');
    expect(store.has('stats:ai_agent_hits:2026-09-29')).toBe(false);
    await logTelemetry(source({ CLOUDONYM_KV: kv }, 'Claude-Code/2.0'), 'llms_txt_accessed', {}, { now: NOW });
    expect(store.get('stats:ai_agent_hits:2026-09-29')).toBe('1');
    expect(store.get('stats:llms_txt_accessed:2026-09-29')).toBe('1');
  });
  it('Axiom payload: dataset 경로 · Bearer · _time 이 +09:00 · kst_day · meta 병합', async () => {
    const { fetchFn, calls } = fakeFetch();
    await logTelemetry(source({ AXIOM_API_KEY: 'k', AXIOM_DATASET: 'ds' }, 'Cursor/1.0'), 'api_validate', { provider: 'gcp' }, { now: NOW, fetchFn });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.axiom.co/v1/datasets/ds/ingest');
    expect(calls[0]!.init.headers.Authorization).toBe('Bearer k');
    expect(JSON.parse(calls[0]!.init.body)).toEqual([{ _time: '2026-09-29T00:30:00+09:00', kst_day: '2026-09-29', event: 'api_validate', client_class: 'ai_agent', is_ai_agent: true, provider: 'gcp' }]);
  });
  it('자정 경계 한 번 호출 — KV 키 일자 · _time · kst_day 가 모두 KST 09-29 (Axiom 이 _time 을 UTC 로 저장해도 kst_day 로 KV 와 같은 날로 묶인다)', async () => {
    const { kv, store } = fakeKv();
    const { fetchFn, calls } = fakeFetch();
    await logTelemetry(source({ CLOUDONYM_KV: kv, AXIOM_API_KEY: 'k', AXIOM_DATASET: 'ds' }), 'ui_visit', {}, { now: NOW, fetchFn });
    expect([...store.keys()]).toEqual(['stats:ui_visit:2026-09-29']);
    const [row] = JSON.parse(calls[0]!.init.body) as { _time: string; kst_day: string }[];
    expect(row!._time).toBe('2026-09-29T00:30:00+09:00');
    expect(row!.kst_day).toBe('2026-09-29');
  });
  it('env 가 비면 KV 도 fetch 도 부르지 않고 조용히 끝난다 (로컬)', async () => {
    const { fetchFn, calls } = fakeFetch();
    await expect(logTelemetry(source({}), 'api_generate', {}, { now: NOW, fetchFn })).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });
  it('KV 가 throw 해도 resolve 하고 Axiom 은 보낸다 · fetch 가 reject 해도 resolve 한다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { kv } = fakeKv('throw');
      const { fetchFn, calls } = fakeFetch();
      await expect(logTelemetry(source({ CLOUDONYM_KV: kv, AXIOM_API_KEY: 'k', AXIOM_DATASET: 'ds' }), 'x', {}, { now: NOW, fetchFn })).resolves.toBeUndefined();
      expect(calls).toHaveLength(1);
      const failing = fakeFetch({ fail: true });
      await expect(logTelemetry(source({ AXIOM_API_KEY: 'k', AXIOM_DATASET: 'ds' }), 'x', {}, { now: NOW, fetchFn: failing.fetchFn })).resolves.toBeUndefined();
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });
  it('KV put 이 끝나지 않아도 Axiom 은 보낸다 — 둘은 서로를 기다리지 않는다', async () => {
    const { kv } = fakeKv('hang');
    const { fetchFn, calls } = fakeFetch();
    // await 하지 않는다 — KV 쪽이 영원히 끝나지 않으므로 전체 Promise 도 끝나지 않는다
    void logTelemetry(source({ CLOUDONYM_KV: kv, AXIOM_API_KEY: 'k', AXIOM_DATASET: 'ds' }), 'x', {}, { now: NOW, fetchFn });
    await tick();
    expect(calls).toHaveLength(1);
  });
  it('Axiom 이 401 을 돌려주면 console.error 로 남긴다 — fetch 는 HTTP 오류에 reject 하지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { fetchFn } = fakeFetch({ status: 401, body: '{"message":"invalid token"}' });
      await expect(logTelemetry(source({ AXIOM_API_KEY: 'k', AXIOM_DATASET: 'ds' }), 'x', {}, { now: NOW, fetchFn })).resolves.toBeUndefined();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]).toContain(401);
    } finally {
      spy.mockRestore();
    }
  });
  it('Axiom 이 200 이어도 failed > 0 이면 console.error · failed 0 이나 빈 본문이면 조용하다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const env = { AXIOM_API_KEY: 'k', AXIOM_DATASET: 'ds' };
      await logTelemetry(source(env), 'x', {}, { now: NOW, fetchFn: fakeFetch().fetchFn });
      await logTelemetry(source(env), 'x', {}, { now: NOW, fetchFn: fakeFetch({ body: '' }).fetchFn });
      expect(spy).toHaveBeenCalledTimes(0);
      const partial = fakeFetch({ body: '{"ingested":0,"failed":1,"failures":[{"error":"bad _time"}]}' });
      await logTelemetry(source(env), 'x', {}, { now: NOW, fetchFn: partial.fetchFn });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
  it('meta 가 _time · kst_day · event 를 덮어쓰지 못한다 — 서버 값이 이긴다', async () => {
    const { fetchFn, calls } = fakeFetch();
    await logTelemetry(source({ AXIOM_API_KEY: 'k', AXIOM_DATASET: 'ds' }), 'api_validate', { _time: 'x', kst_day: 'x', event: 'x', is_ai_agent: true, provider: 'gcp' }, { now: NOW, fetchFn });
    const [row] = JSON.parse(calls[0]!.init.body) as Record<string, unknown>[];
    expect(row).toMatchObject({ _time: '2026-09-29T00:30:00+09:00', kst_day: '2026-09-29', event: 'api_validate', is_ai_agent: false, provider: 'gcp' });
  });
  it('formatToParts 에 부분이 빠지면 실패로 친다 — console.error 뒤 KV · Axiom 을 건너뛴다 (「--T::」 를 보내지 않는다)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { kv, store } = fakeKv();
      const { fetchFn, calls } = fakeFetch();
      await expect(logTelemetry(source({ CLOUDONYM_KV: kv, AXIOM_API_KEY: 'k', AXIOM_DATASET: 'ds' }), 'x', {}, { now: NOW, fetchFn, formatParts: () => [] })).resolves.toBeUndefined();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(store.size).toBe(0);
      expect(calls).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
  it('어떤 오류도 밖으로 내지 않는다 — 잘못된 시각(RangeError)도 resolve', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { kv, store } = fakeKv();
      await expect(logTelemetry(source({ CLOUDONYM_KV: kv }), 'x', {}, { now: new Date(Number.NaN) })).resolves.toBeUndefined();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(store.size).toBe(0);
      const throwing: TelemetrySource = { env: {}, req: { header: () => { throw new Error('header'); } } };
      await expect(logTelemetry(throwing, 'x', {}, { now: NOW })).resolves.toBeUndefined();
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });
  it('KV 값이 깨졌으면(숫자가 아니면) 0 에서 다시 센다 — NaN 을 저장하지 않는다', async () => {
    const { kv, store } = fakeKv();
    store.set('stats:api_generate:2026-09-29', 'abc');
    await logTelemetry(source({ CLOUDONYM_KV: kv }), 'api_generate', {}, { now: NOW });
    expect(store.get('stats:api_generate:2026-09-29')).toBe('1');
  });
});

describe('classifyClient — UA 원문 대신 네 값 중 하나 (D56)', () => {
  it('ai_agent 를 먼저 본다 — Mozilla 로 시작해도 GPTBot 이면 ai_agent', () => {
    expect(classifyClient('Claude-User')).toBe('ai_agent');
    expect(classifyClient('Mozilla/5.0 (compatible; GPTBot/1.0)')).toBe('ai_agent');
    expect(classifyClient('Cursor/1.0')).toBe('ai_agent');
  });
  it('browser · cli · other', () => {
    expect(classifyClient('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130')).toBe('browser');
    for (const ua of ['curl/8', 'curl/8.7.1', 'Wget/1.21', 'python-requests/2.32', 'Go-http-client/2.0', 'node']) expect(classifyClient(ua), ua).toBe('cli');
    for (const ua of ['', undefined, 'terraform-provider-http/3.4', 'nodejs-thing/1', 'my curl/8', 'Mozilla']) expect(classifyClient(ua), String(ua)).toBe('other');
  });
});

describe('Axiom · KV 에 싣는 것 — 허용 표 밖은 싣지 않는다 (D56)', () => {
  const env = { AXIOM_API_KEY: 'k', AXIOM_DATASET: 'ds' };
  const COMMON = ['_time', 'kst_day', 'event', 'client_class', 'is_ai_agent'];
  it('KV put 은 366일 expirationTtl 을 단다 — 이벤트 키 · ai_agent_hits 키 모두', async () => {
    expect(KV_TTL_SECONDS).toBe(366 * 86400);
    const { kv, puts } = fakeKv();
    await logTelemetry(source({ CLOUDONYM_KV: kv }, 'Claude-User'), 'api_generate', {}, { now: NOW });
    expect(puts.map((p) => p.key)).toEqual(['stats:api_generate:2026-09-29', 'stats:ai_agent_hits:2026-09-29']);
    for (const p of puts) expect(p.options).toEqual({ expirationTtl: 366 * 86400 });
  });
  it('이벤트마다 Axiom 한 건의 키 집합 = 공통 다섯 + 그 이벤트의 허용 meta — 모르는 meta 키 · 모르는 이벤트의 meta 는 버린다', async () => {
    const full: Record<string, Record<string, unknown>> = {
      ui_copy: { target: 'terraform' },
      api_generate: { providers: ['gcp'] },
      api_names: { provider: 'gcp', resource_count: 2, name_count: 3, valid: true },
      api_validate: { provider: 'gcp', resource_type: 'project_id', valid: false },
      api_wizard: { provider: 'gcp', service_count: 2, resource_count: 7, name_count: 14, valid: true },
    };
    for (const event of [...Object.keys(META_KEYS), 'unknown_event']) {
      const { fetchFn, calls } = fakeFetch();
      await logTelemetry(source(env), event, { ...full[event], owner: 'example-team', user_agent: 'x', extra: 1 }, { now: NOW, fetchFn });
      const [row] = JSON.parse(calls[0]!.init.body) as Record<string, unknown>[];
      expect(Object.keys(row!).sort(), event).toEqual([...COMMON, ...(META_KEYS[event] ?? [])].sort());
    }
  });
  it('api_wizard — 서비스 이름 · 문맥값을 meta 로 넘겨도 싣지 않는다 (D17 · D56)', async () => {
    const { fetchFn, calls } = fakeFetch();
    await logTelemetry(source(env), 'api_wizard', { provider: 'gcp', service_count: 1, resource_count: 1, name_count: 2, valid: true, services: ['shop'], purpose: 'shop', project: { owner: 'example-team' } }, { now: NOW, fetchFn });
    const body = calls[0]!.init.body;
    expect(body).not.toContain('shop');
    expect(body).not.toContain('example-team');
  });
  it('허용 표는 D56 의 필드 표와 같다', () => {
    expect(META_KEYS).toEqual({
      ui_visit: [], ui_generate: [], ui_copy: ['target'],
      api_generate: ['providers'], api_names: ['provider', 'resource_count', 'name_count', 'valid'], api_validate: ['provider', 'resource_type', 'valid'],
      api_wizard: ['provider', 'service_count', 'resource_count', 'name_count', 'valid'],
      llms_txt_accessed: [], catalog_json_accessed: [],
    });
  });
  it('UA 에 문맥 글자를 넣어도 payload 전체 문자열 · console.error 인자 어디에도 그 글자가 없다 (Axiom 이 본문을 그대로 돌려주며 거부해도)', async () => {
    const ua = 'Mozilla/5.0 owner=example-team system=payroll';
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // 거부 응답의 본문이 요청 본문을 그대로 되돌려 준다 — 그 본문이 console.error 로 간다
      const calls: Call[] = [];
      const echo: FetchLike = (url, init) => { calls.push({ url, init }); return Promise.resolve({ ok: false, status: 400, text: () => Promise.resolve(init.body) }); };
      const { kv, puts } = fakeKv();
      await logTelemetry(source({ ...env, CLOUDONYM_KV: kv }, ua), 'api_names', { provider: 'gcp', resource_count: 1, name_count: 1, valid: true }, { now: NOW, fetchFn: echo });
      expect(calls).toHaveLength(1);
      expect(errors).toHaveBeenCalledTimes(1);   // 검사기 — 거부 경로를 실제로 탔다
      const sent = calls[0]!.init.body;
      const logged = JSON.stringify(errors.mock.calls);
      const stored = JSON.stringify(puts);
      for (const word of ['example-team', 'payroll', 'owner=', 'system=']) {
        expect(sent.includes(word), `payload: ${word}`).toBe(false);
        expect(logged.includes(word), `console.error: ${word}`).toBe(false);
        expect(stored.includes(word), `KV: ${word}`).toBe(false);
      }
      expect(JSON.parse(sent)[0]).toMatchObject({ client_class: 'browser', is_ai_agent: false });
    } finally {
      errors.mockRestore();
    }
  });
});
