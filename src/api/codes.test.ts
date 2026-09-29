import { describe, it, expect } from 'vitest';
import { API_CODES, API_CODES_MATCH_UNION } from './codes';
import { MESSAGE_CODES } from '../core/messages';

describe('API 메시지 코드 (D23)', () => {
  it('13개 · 중복 없음 · 꼴 영역.이름 · 엔진 코드와 겹치지 않는다', () => {
    expect(API_CODES).toHaveLength(13);
    expect(new Set(API_CODES).size).toBe(API_CODES.length);
    for (const c of API_CODES) expect(c).toMatch(/^[a-z]+\.[a-z_0-9]+$/);
    expect(API_CODES.filter((c) => (MESSAGE_CODES as readonly string[]).includes(c))).toEqual([]);
  });
  it('배열과 유니언이 같은 집합이다 (컴파일 때 확인한 값)', () => {
    expect(API_CODES_MATCH_UNION).toBe(true);
  });
});
