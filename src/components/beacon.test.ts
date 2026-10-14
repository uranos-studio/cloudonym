import { describe, it, expect, vi } from 'vitest';
import { COPY_TARGETS } from './copyTargets';
import type { WizardPlan } from '../core/wizard/plan';
import { pickedRuleIds } from './pickedRules';
import { copyTarget, debounce, sendBeacon, sessionStore, visitOnce, wizardGenerateMeta, EVENTS_PATH, VISIT_KEY, type StorageLike, type UiBeacon } from './beacon';

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
  it('인자는 마지막 호출의 것 — 마법사가 보낼 때의 meta 를 싣는다 (D71)', () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const d = debounce(fn, 1000);
      d('a'); d('b'); d('c');
      vi.advanceTimersByTime(1000);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('c');
    } finally {
      vi.useRealTimers();
    }
  });
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
  it('sessionStorage 가 없는 환경에서는 undefined · 접근이 던져도 undefined', () => {
    // Node 버전에 따라 전역 sessionStorage 가 있다 — 시험 안에서 「없음」 · 「던짐」을 만들고 끝나면 원래 서술자로 되돌린다
    const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    try {
      Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, writable: true, value: undefined });
      expect(sessionStore()).toBeUndefined();
      // 브라우저는 window.sessionStorage 게터 자체가 SecurityError 를 던진다 — 게터로 흉내 낸다 (vi.stubGlobal 은 값만 둔다)
      Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
      expect(sessionStore()).toBeUndefined();
      // 검사기 — 저장소가 있으면 그것을 돌려준다
      const fake = { getItem: () => null, setItem: () => undefined };
      Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, writable: true, value: fake });
      expect(sessionStore()).toBe(fake);
    } finally {
      if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
      else Reflect.deleteProperty(globalThis, 'sessionStorage');
    }
  });
});

describe('ui_copy — 어느 복사 버튼인가만 보낸다 (D56)', () => {
  it('일곱 — API 가 받는 목록과 같은지는 src/api/privacy-sync.test.ts 가 본다', () => {
    expect(COPY_TARGETS).toEqual(['share-url', 'name', 'all-names', 'names-json', 'terraform', 'tags-json', 'plan-json']);
  });
  it('copyKey → target — name:<항목 키> 는 name 으로(항목 키 · 리소스 종류를 싣지 않는다) · 모르는 키는 undefined', () => {
    expect(copyTarget('share-url')).toBe('share-url');
    expect(copyTarget('name:gcp.compute_instance#2')).toBe('name');
    expect(copyTarget('all-names')).toBe('all-names');
    expect(copyTarget('names-json')).toBe('names-json');
    expect(copyTarget('terraform')).toBe('terraform');
    expect(copyTarget('tags-json')).toBe('tags-json');
    for (const k of [undefined, '', 'name', 'names', 'owner', 'name-x']) expect(copyTarget(k), String(k)).toBeUndefined();
  });
  it('본문은 { event, target } 뿐 — 문맥값 · 항목 키가 없다', () => {
    const calls: [string, unknown][] = [];
    vi.stubGlobal('navigator', { sendBeacon: (url: string, body: unknown) => { calls.push([url, body]); return true; } });
    try {
      sendBeacon('ui_copy', { target: copyTarget('name:gcp.project_id')! });
      expect(calls).toEqual([[EVENTS_PATH, '{"event":"ui_copy","target":"name"}']]);
      expect(Object.keys(JSON.parse(calls[0]![1] as string))).toEqual(['event', 'target']);
      for (const w of ['gcp', 'project_id', 'owner', 'example']) expect(calls[0]![1] as string).not.toContain(w);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('wizardGenerateMeta — 마법사 ui_generate 의 두 칸 (D71)', () => {
  const project = { owner: 'example-team', system: 'payroll', env: 'prod', region: 'asia-northeast3' };
  it('pickedRuleIds — 칩만 · 유효 규칙 id · 중복 없음 · 정렬 (네트워크 칩 · 방화벽 둘 · web 둘)', () => {
    const plan: WizardPlan = {
      provider: 'gcp', project,
      projectPicks: [{ preset: 'vpc' }, { preset: 'subnet' }, { preset: 'firewall', tier: 'ssh' }, { preset: 'firewall', tier: 'web' }],
      services: [{ purpose: 'shop', picks: [{ preset: 'web' }, { preset: 'db', kind: 'POSTGRES' }] }, { purpose: 'pay', picks: [{ preset: 'web', ha: true }] }],
    };
    expect(pickedRuleIds(plan)).toEqual({ chip: ['gcp.cloud_sql_instance', 'gcp.compute_instance', 'gcp.firewall_rule', 'gcp.subnet', 'gcp.vpc_network'], custom: [] });
  });
  it('pickedRuleIds — serverless 를 켜면 그 규칙 · 데이터에 없는 serverless 값은 기본 규칙 · 프로젝트 ID · 모르는 프리셋은 넣지 않는다', () => {
    const plan = {
      provider: 'gcp', project,
      projectPicks: [{ preset: null, ruleId: 'gcp.project_id' }, { preset: 'nope' }],
      services: [{ purpose: 'shop', picks: [{ preset: 'web', serverless: 'gcp.cloud_function' }, { preset: 'was', serverless: 'gcp.storage_bucket' }, { preset: null, ruleId: 'gcp.secret' }, { preset: null, ruleId: 'gcp.secret' }] }],
    } as unknown as WizardPlan;
    expect(pickedRuleIds(plan)).toEqual({ chip: ['gcp.cloud_function', 'gcp.compute_instance'], custom: ['gcp.secret'] });
  });
  it('pickedRuleIds — 고른 것이 없으면 빈 배열 둘', () => {
    expect(pickedRuleIds({ provider: 'gcp', project, projectPicks: [], services: [] })).toEqual({ chip: [], custom: [] });
  });
  it('칩(프리셋)의 유효 규칙 · Custom 의 규칙 — 정렬 · 중복 없음 · 입력값 없음', () => {
    const meta = wizardGenerateMeta({
      provider: 'gcp', project,
      projectPicks: [{ preset: 'vpc' }, { preset: null, ruleId: 'gcp.secret' }],
      services: [{ purpose: 'shop', picks: [{ preset: 'web', serverless: 'gcp.run_service', tier: 'front' }, { preset: null, ruleId: 'gcp.gke_cluster', role: 'sync' }] }],
    });
    expect(meta).toEqual({ chip_rules: ['gcp.run_service', 'gcp.vpc_network'], custom_rules: ['gcp.gke_cluster', 'gcp.secret'] });
    const text = JSON.stringify(meta);
    for (const w of ['example-team', 'payroll', 'shop', 'front', 'sync', 'asia-northeast3', 'project_id']) expect(text, w).not.toContain(w);
  });
  it('sendBeacon 본문 — event 와 두 칸', () => {
    const calls: [string, unknown][] = [];
    vi.stubGlobal('navigator', { sendBeacon: (url: string, body: unknown) => { calls.push([url, body]); return true; } });
    try {
      sendBeacon('ui_generate', { chip_rules: ['gcp.subnet'], custom_rules: [] });
      expect(calls).toEqual([[EVENTS_PATH, '{"event":"ui_generate","chip_rules":["gcp.subnet"],"custom_rules":[]}']]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
