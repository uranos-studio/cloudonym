import { describe, it, expect, vi } from 'vitest';
import { debounce, sendBeacon, sessionStore, visitOnce, EVENTS_PATH, VISIT_KEY, type StorageLike, type UiBeacon } from './beacon';

function fakeStorage(mode: 'ok' | 'throw' = 'ok'): { storage: StorageLike; map: Map<string, string> } {
  const map = new Map<string, string>();
  const storage: StorageLike = {
    getItem: (k) => { if (mode === 'throw') throw new Error('SecurityError'); return map.get(k) ?? null; },
    setItem: (k, v) => { if (mode === 'throw') throw new Error('SecurityError'); map.set(k, v); },
  };
  return { storage, map };
}
function spy(): { send: (e: UiBeacon) => void; sent: UiBeacon[] } {
  const sent: UiBeacon[] = [];
  return { send: (e) => { sent.push(e); }, sent };
}

describe('visitOnce — ui_visit 은 탭당 1회 (D17 · sessionStorage 가드)', () => {
  it('첫 호출은 보내고 키를 남긴다 · 둘째 호출(StrictMode 이중 effect · 새로고침)은 보내지 않는다', () => {
    const { storage, map } = fakeStorage();
    const { send, sent } = spy();
    expect(visitOnce(storage, send)).toBe(true);
    expect(visitOnce(storage, send)).toBe(false);
    expect(sent).toEqual(['ui_visit']);
    expect(map.get(VISIT_KEY)).toBe('1');
  });
  it('저장소가 없으면(undefined) 가드 없이 보낸다', () => {
    const { send, sent } = spy();
    expect(visitOnce(undefined, send)).toBe(true);
    expect(sent).toEqual(['ui_visit']);
  });
  it('저장소가 던져도(사생활 보호 모드) 화면은 죽지 않고 보낸다', () => {
    const { send, sent } = spy();
    expect(visitOnce(fakeStorage('throw').storage, send)).toBe(true);
    expect(sent).toEqual(['ui_visit']);
  });
});

describe('debounce — ui_generate 는 마지막 입력 뒤 1초에 한 번', () => {
  it('1초 안의 연속 호출 다섯 → 실행 1회 · 1초 전에는 0회', () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const d = debounce(fn, 1000);
      for (let i = 0; i < 5; i++) { d(); vi.advanceTimersByTime(100); }   // 마지막 호출 뒤 100ms 지남
      expect(fn).toHaveBeenCalledTimes(0);
      vi.advanceTimersByTime(899);                                          // 999ms
      expect(fn).toHaveBeenCalledTimes(0);
      vi.advanceTimersByTime(1);                                            // 1000ms
      expect(fn).toHaveBeenCalledTimes(1);
      d();
      vi.advanceTimersByTime(1000);
      expect(fn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('sendBeacon — navigator.sendBeacon 우선 · 없으면 fetch keepalive · 본문은 { event } 뿐', () => {
  it('navigator.sendBeacon 이 있으면 /v1/events 에 JSON 문자열을 보낸다 (문맥값 없음)', () => {
    const calls: [string, unknown][] = [];
    vi.stubGlobal('navigator', { sendBeacon: (url: string, body: unknown) => { calls.push([url, body]); return true; } });
    try {
      sendBeacon('ui_generate');
      expect(calls).toEqual([[EVENTS_PATH, '{"event":"ui_generate"}']]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('sendBeacon 이 없으면 fetch(POST · keepalive) — fetch 가 거부해도 던지지 않는다', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => { calls.push([url, init]); return Promise.reject(new Error('offline')); });
    try {
      expect(() => sendBeacon('ui_visit')).not.toThrow();
      await Promise.resolve();
      expect(calls).toHaveLength(1);
      expect(calls[0]![0]).toBe(EVENTS_PATH);
      expect(calls[0]![1]).toMatchObject({ method: 'POST', keepalive: true, body: '{"event":"ui_visit"}' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('sessionStore', () => {
  it('sessionStorage 가 없는 환경(Node)에서는 undefined · 접근이 던져도 undefined', () => {
    expect(sessionStore()).toBeUndefined();
    // 브라우저는 window.sessionStorage 게터 자체가 SecurityError 를 던진다 — 게터로 흉내 낸다 (vi.stubGlobal 은 값만 둔다)
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
    try {
      expect(sessionStore()).toBeUndefined();
    } finally {
      Reflect.deleteProperty(globalThis, 'sessionStorage');
    }
  });
});
