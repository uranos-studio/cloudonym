import { describe, it, expect } from 'vitest';
import { MESSAGE_CODES } from './messages';

describe('엔진 메시지 코드 (D23)', () => {
  it('61개 · 중복 없음 · 꼴 영역.이름', () => {
    expect(MESSAGE_CODES).toHaveLength(61);
    expect(new Set(MESSAGE_CODES).size).toBe(MESSAGE_CODES.length);
    for (const c of MESSAGE_CODES) expect(c).toMatch(/^[a-z]+\.[a-z_0-9]+$/);
  });
  // 배열과 유니언이 같은 집합인지는 messages.ts 의 MESSAGE_CODES_MATCH_UNION 이 컴파일 때 본다 — tsc 가 보장하므로 런타임 단언을 두지 않는다
});
