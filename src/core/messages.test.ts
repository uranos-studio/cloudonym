import { describe, it, expect } from 'vitest';
import { MESSAGE_CODES, MESSAGE_CODES_MATCH_UNION } from './messages';

describe('엔진 메시지 코드 (D23)', () => {
  it('36개 · 중복 없음 · 꼴 영역.이름', () => {
    expect(MESSAGE_CODES).toHaveLength(36);
    expect(new Set(MESSAGE_CODES).size).toBe(MESSAGE_CODES.length);
    for (const c of MESSAGE_CODES) expect(c).toMatch(/^[a-z]+\.[a-z_0-9]+$/);
  });
  it('배열과 유니언이 같은 집합이다 (컴파일 때 확인한 값)', () => {
    expect(MESSAGE_CODES_MATCH_UNION).toBe(true);
  });
});
