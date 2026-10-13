// 화면 모드 (D94) — Light · Dark · System. 고른 값은 이 브라우저의 localStorage 하나에만 둔다(공유 hash 에 싣지 않는다).
// 첫 칠 전의 적용은 public/theme.js 가 한다(같은 키 · 같은 판정). 여기서는 고른 뒤의 적용과 System 일 때 기기 설정의 변화를 따른다.
// Tailwind 의 dark: 변형은 <html class="dark"> 를 본다(index.css 의 @custom-variant)
import { useSyncExternalStore } from 'react';
import { THEME_KEY, readPref, writePref } from './localPrefs';

export type ThemeMode = 'light' | 'dark' | 'system';
export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];
export const DARK_QUERY = '(prefers-color-scheme: dark)';

/** 저장된 값 — 모르는 값 · 없음 · 막힘은 system */
export function storedMode(): ThemeMode {
  const v = readPref(THEME_KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

/** 이 모드에서 어두운 화면인가 — system 은 기기 설정 */
export function isDark(mode: ThemeMode, systemDark: boolean): boolean {
  return mode === 'dark' || (mode === 'system' && systemDark);
}

function systemDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

/** <html> 에 적용한다 — dark 클래스 · data-theme(고른 값) */
export function applyMode(mode: ThemeMode, root: HTMLElement = document.documentElement): void {
  root.classList.toggle('dark', isDark(mode, systemDark()));
  root.setAttribute('data-theme', mode);
}

// ── 고른 값의 저장소 — 탭 안의 구독자에게 알린다 ──
let current: ThemeMode | undefined;
const listeners = new Set<() => void>();
function get(): ThemeMode {
  current ??= storedMode();
  return current;
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  // System 일 때 기기 설정이 바뀌면 다시 적용한다
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : undefined;
  const onMq = () => {
    if (get() === 'system') applyMode('system');
  };
  mq?.addEventListener('change', onMq);
  return () => {
    listeners.delete(fn);
    mq?.removeEventListener('change', onMq);
  };
}

/** 모드를 고른다 — 적용 · 저장(막혔으면 이 탭에서만) · 알림. system 은 키를 지운다(기본값) */
export function setMode(mode: ThemeMode): void {
  current = mode;
  applyMode(mode);
  writePref(THEME_KEY, mode === 'system' ? null : mode);
  for (const fn of listeners) fn();
}

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribe, get, () => 'system');
}
