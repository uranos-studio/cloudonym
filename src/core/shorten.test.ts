import { describe, it, expect } from 'vitest';
import { SHORT_WORDS, shorten, elementBudget } from './shorten';
import { ENV_ALIASES } from './normalize';
import { MIN_TOKEN } from './types';

describe('shorten · elementBudget', () => {
  it('사전에 있으면 줄이고 없으면 그대로', () => {
    expect(shorten('koreacentral')).toBe('kc');
    expect(shorten('trade')).toBe('trd');
    expect(shorten('billing')).toBe('billing');
    expect(shorten('constructor')).toBe('constructor');
  });
  it('사전 값은 전부 MIN_TOKEN(2) 이상이고 env 별칭과 겹치지 않는다 (D13)', () => {
    for (const [k, v] of Object.entries(SHORT_WORDS)) {
      expect(v.length, k).toBeGreaterThanOrEqual(MIN_TOKEN);
      expect(ENV_ALIASES).not.toHaveProperty(k);
    }
  });
  it('② 예산식: max 24, 고정 2(st), 구분자 0, 가변 3 → 7', () => {
    expect(elementBudget(24, 2, 0, 3)).toBe(7);
  });
  it('가변 0개면 예산 0 · 음수는 0', () => {
    expect(elementBudget(24, 2, 0, 0)).toBe(0);
    expect(elementBudget(5, 3, 1, 1)).toBe(1);
    expect(elementBudget(3, 5, 0, 1)).toBe(0);
  });
});
