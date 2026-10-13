// 화면 설정 저장 (D93 · D94) — 저장소가 던져도 읽기는 null · 쓰기는 조용히 넘어간다
import { afterEach, describe, it, expect, vi } from 'vitest';
import { INTRO_KEY, THEME_KEY, readPref, writePref } from './localPrefs';

function fakeStorage(throws: boolean) {
  const map = new Map<string, string>();
  const fail = () => { throw new Error('blocked'); };
  return {
    map,
    storage: {
      getItem: (k: string) => (throws ? fail() : map.get(k) ?? null),
      setItem: (k: string, v: string) => (throws ? fail() : void map.set(k, v)),
      removeItem: (k: string) => (throws ? fail() : void map.delete(k)),
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('localPrefs', () => {
  it('키 이름 — 앱 머리말(cloudonym:)을 단다', () => {
    expect([INTRO_KEY, THEME_KEY]).toEqual(['cloudonym:intro_dismissed_v2', 'cloudonym:theme']);
  });
  it('읽고 쓰고 지운다', () => {
    const f = fakeStorage(false);
    vi.stubGlobal('localStorage', f.storage);
    expect(readPref(THEME_KEY)).toBeNull();
    writePref(THEME_KEY, 'dark');
    expect(readPref(THEME_KEY)).toBe('dark');
    writePref(THEME_KEY, null);
    expect(f.map.has(THEME_KEY)).toBe(false);
  });
  it('저장소가 던지면 읽기는 null · 쓰기는 던지지 않는다', () => {
    vi.stubGlobal('localStorage', fakeStorage(true).storage);
    expect(readPref(INTRO_KEY)).toBeNull();
    expect(() => writePref(INTRO_KEY, '1')).not.toThrow();
  });
});
