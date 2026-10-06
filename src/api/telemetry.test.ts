import { describe, it, expect, vi } from 'vitest';
import { isAiAgent, kstStamp, logTelemetry, type FetchLike, type TelemetrySource } from './telemetry';
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
    expect(JSON.parse(calls[0]!.init.body)).toEqual([{ _time: '2026-09-29T00:30:00+09:00', kst_day: '2026-09-29', event: 'api_validate', user_agent: 'Cursor/1.0', is_ai_agent: true, provider: 'gcp' }]);
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

describe('Axiom 에 싣는 User-Agent', () => {
  it('256자로 자르고 제어 문자를 지운다 — 판정(is_ai_agent)도 자른 값으로 한다', async () => {
    const { fetchFn, calls } = fakeFetch();
    const ua = `Claude\n\r\u0000${'x'.repeat(1000)}`;
    await logTelemetry(source({ AXIOM_API_KEY: 'k', AXIOM_DATASET: 'ds' }, ua), 'api_generate', {}, { now: NOW, fetchFn });
    const sent = JSON.parse(calls[0]!.init.body)[0];
    expect(sent.user_agent).toHaveLength(256);
    expect(sent.user_agent).toMatch(/^Claudex+$/);
    expect(sent.is_ai_agent).toBe(true);
  });
});
