import { describe, it, expect } from 'vitest';
import { lookup } from './dict';

describe('lookup', () => {
  const d: Record<string, string> = { prod: 'prd' };
  it('있는 키는 값', () => expect(lookup(d, 'prod')).toBe('prd'));
  it('없는 키는 undefined', () => expect(lookup(d, 'qa')).toBeUndefined());
  it('상속 프로퍼티는 undefined (constructor · __proto__ · toString)', () => {
    for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) expect(lookup(d, k)).toBeUndefined();
  });
});
