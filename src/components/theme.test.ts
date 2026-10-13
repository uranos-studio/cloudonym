// 화면 모드 (D94) — 저장된 값 읽기 · 판정 · 적용 · 첫 칠 스크립트(public/theme.js)와 키 · 값이 같다
import { afterEach, describe, it, expect, vi } from 'vitest';
import { THEME_MODES, applyMode, isDark, storedMode } from './theme';
import { THEME_KEY } from './localPrefs';

afterEach(() => vi.unstubAllGlobals());

// 브라우저 타입 설정(node 없음)이라 Vite 의 ?raw 글롭으로 읽는다 — boundary.test.ts 와 같은 방법
const files = import.meta.glob(['../../public/theme.js', '../../index.html'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

function storage(value: string | null, throws = false) {
  return { getItem: () => { if (throws) throw new Error('blocked'); return value; }, setItem: () => undefined, removeItem: () => undefined };
}

describe('화면 모드 (D94)', () => {
  it('셋 — light · dark · system', () => {
    expect(THEME_MODES).toEqual(['light', 'dark', 'system']);
  });
  it('저장된 값 — light · dark 만 받고, 없음 · 모르는 값 · 막힌 저장소는 system', () => {
    for (const [v, want] of [['light', 'light'], ['dark', 'dark'], ['system', 'system'], [null, 'system'], ['blue', 'system']] as const) {
      vi.stubGlobal('localStorage', storage(v));
      expect(storedMode(), String(v)).toBe(want);
    }
    vi.stubGlobal('localStorage', storage('dark', true));
    expect(storedMode()).toBe('system');
  });
  it('판정 — 고른 값이 기기 설정을 이긴다 · system 은 기기 설정', () => {
    expect(isDark('light', true)).toBe(false);
    expect(isDark('dark', false)).toBe(true);
    expect(isDark('system', true)).toBe(true);
    expect(isDark('system', false)).toBe(false);
  });
  it('적용 — <html> 의 dark 클래스와 data-theme', () => {
    const classes = new Set<string>();
    const attrs = new Map<string, string>();
    const root = { classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)) }, setAttribute: (k: string, v: string) => attrs.set(k, v) } as unknown as HTMLElement;
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    applyMode('light', root);
    expect([classes.has('dark'), attrs.get('data-theme')]).toEqual([false, 'light']);
    applyMode('system', root);
    expect([classes.has('dark'), attrs.get('data-theme')]).toEqual([true, 'system']);
    applyMode('dark', root);
    expect(classes.has('dark')).toBe(true);
  });
  it('첫 칠 스크립트 — 같은 키를 읽고 light · dark 밖은 system · 저장소 접근을 try 로 감싼다 · 모듈이 아니다', () => {
    const js = files['../../public/theme.js']!;
    expect(js).toContain(`'${THEME_KEY}'`);
    expect(js).toContain("mode !== 'light' && mode !== 'dark'");
    expect(js).toContain('(prefers-color-scheme: dark)');
    expect(js).toMatch(/try \{[\s\S]*localStorage[\s\S]*\} catch/);
    expect(js).not.toMatch(/^\s*(?:import|export)\s/m);
    const html = files['../../index.html']!;
    // CSS · 모듈보다 먼저 — head 안의 동기 스크립트
    expect(html.indexOf('<script src="/theme.js"></script>')).toBeGreaterThan(-1);
    expect(html.indexOf('<script src="/theme.js"></script>')).toBeLessThan(html.indexOf('</head>'));
  });
});
