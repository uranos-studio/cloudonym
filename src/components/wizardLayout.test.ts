// 마법사 배치의 경계 (D89) — 1280 이상 세 칸 · 768–1279 태블릿 · 768 미만 폰. 경계는 Tailwind md · xl 과 같아야 한다
import { describe, it, expect } from 'vitest';
import { layoutOf, TABLET_QUERY, WIDE_QUERY } from './wizardLayout';

describe('wizardLayout', () => {
  it('폭 판정 둘에서 배치 하나', () => {
    expect(layoutOf(true, true)).toBe('wide');
    expect(layoutOf(false, true)).toBe('tablet');
    expect(layoutOf(false, false)).toBe('phone');
  });
  it('경계 — md 768px · xl 1280px', () => {
    expect(WIDE_QUERY).toBe('(min-width: 1280px)');
    expect(TABLET_QUERY).toBe('(min-width: 768px)');
  });
  // 칸에 overscroll-contain 을 걸면 휠이 페이지로 넘어가지 않아 머리글 아래(격자 아래쪽)에 닿을 수 없다
  it('칸은 끝에서 휠을 페이지로 넘긴다 — overscroll-contain 없음', () => {
    const src = Object.values(import.meta.glob('./Wizard.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';
    const line = src.split('\n').find((l: string) => l.includes('const COLUMN ='));
    expect(line).toBeDefined();
    expect(line).not.toContain('overscroll-contain');
  });
});
