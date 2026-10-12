import { describe, it, expect } from 'vitest';
import { MESSAGE_CODES } from './messages';

describe('엔진 메시지 코드 (D23)', () => {
  it('100개 — name.zone_required 삭제 (D50 revised) · 딸린 것 일곱 (D62) · 마법사 모델 스물다섯 (D64 · D78 · D85 · D88) · 위치 둘 (D78) · 서버 관측 규칙 (D80) · 지역 Secret (D79) · 중복 없음 · 꼴 영역.이름', () => {
    expect(MESSAGE_CODES).toHaveLength(100);
    // 마법사 검사 코드는 계획 §5-5 표의 스물여섯 + 위치(D78) + 지역 Secret 의 프로젝트 지역(D79) + 프로젝트 ID 접미사 둘(D85) + 고정 종류 프리셋(D88)
    expect(MESSAGE_CODES.filter((c) => c.startsWith('wizard.'))).toHaveLength(31);
    for (const c of ['name.parent_invalid', 'name.parent_name', 'wizard.children_not_supported', 'wizard.attach_not_object', 'wizard.attach_out_of_range',
                     'wizard.invalid_data_seq', 'wizard.duplicate_seq']) expect(MESSAGE_CODES as readonly string[]).toContain(c);
    expect(MESSAGE_CODES as readonly string[]).not.toContain('name.zone_required');
    expect(new Set(MESSAGE_CODES).size).toBe(MESSAGE_CODES.length);
    for (const c of MESSAGE_CODES) expect(c).toMatch(/^[a-z]+\.[a-z_0-9]+$/);
  });
  // 배열과 유니언이 같은 집합인지는 messages.ts 의 MESSAGE_CODES_MATCH_UNION 이 컴파일 때 본다 — tsc 가 보장하므로 런타임 단언을 두지 않는다
});
