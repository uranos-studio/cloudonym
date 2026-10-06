// 사용자 값을 메시지 params 에 실을 때의 꼴 — 순수 함수 둘. 엔진 · API 오류(api/schemas.ts) · 표현 계층(messages/catalog.ts)이 같이 쓴다

import { INVISIBLE_CLASS } from './invisible.mjs';

/** 보이지 않는 글자 — 정의는 invisible.mjs 하나다(규칙 · 생성기와 같은 집합) */
const INVISIBLE = new RegExp(`[${INVISIBLE_CLASS}]`, 'gu');

/** 보이지 않는 글자를 글자 그대로의 이스케이프로 바꾼다 — 사용자 값이 보이는 것과 다른 순서로 렌더되지 않게 (Trojan Source).
 *  BMP 는 `\uXXXX`, 보조 평면(태그 문자 U+E0000 대)은 `\UXXXXXXXX` — 둘 다 HCL 이 받는 꼴이다(terraform.ts hclString 이 이 함수를 쓴다) */
export function escapeInvisible(text: string): string {
  return text.replace(INVISIBLE, (ch) => {
    const cp = ch.codePointAt(0)!;
    return cp > 0xffff ? `\\U${cp.toString(16).toUpperCase().padStart(8, '0')}` : `\\u${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  });
}

/** 메시지에 되돌려 싣는 사용자 값의 최대 글자 수(이스케이프한 뒤) — 넘으면 자르고 `…` 를 붙인다 */
export const DISPLAY_MAX_CHARS = 80;

/** 표시용 사용자 값 — 보이지 않는 문자를 바꾼 뒤 DISPLAY_MAX_CHARS 자까지. 같은 값을 다시 넣어도 결과가 같다(멱등) */
export function clipForDisplay(text: string): string {
  const escaped = escapeInvisible(text);
  return escaped.length > DISPLAY_MAX_CHARS ? `${escaped.slice(0, DISPLAY_MAX_CHARS)}…` : escaped;
}
