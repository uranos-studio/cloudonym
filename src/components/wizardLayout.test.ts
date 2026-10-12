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
});
