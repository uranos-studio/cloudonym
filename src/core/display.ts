// 사용자 값을 메시지 params 에 실을 때의 꼴 — 순수 함수 둘. 엔진 · API 오류(api/schemas.ts) · 표현 계층(messages/catalog.ts)이 같이 쓴다

/** C0 · DEL · C1 · ALM(U+061C) · 폭 없는 문자와 LRM/RLM(U+200B–200F) · 줄/문단 구분과 LRE–RLO(U+2028–202E) · U+2060–2064 · 격리(U+2066–2069) · BOM */
// oxlint-disable-next-line no-control-regex -- 제어 문자를 찾는 것이 이 정규식의 목적이다
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/** 제어 문자 · 양방향 제어 · 폭 없는 문자를 `\uXXXX` 글자로 바꾼다 — 사용자 값이 보이는 것과 다른 순서로 렌더되지 않게 (Trojan Source) */
export function escapeInvisible(text: string): string {
  return text.replace(INVISIBLE, (ch) => `\\u${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
}

/** 메시지에 되돌려 싣는 사용자 값의 최대 글자 수(이스케이프한 뒤) — 넘으면 자르고 `…` 를 붙인다 */
export const DISPLAY_MAX_CHARS = 80;

/** 표시용 사용자 값 — 보이지 않는 문자를 바꾼 뒤 DISPLAY_MAX_CHARS 자까지. 같은 값을 다시 넣어도 결과가 같다(멱등) */
export function clipForDisplay(text: string): string {
  const escaped = escapeInvisible(text);
  return escaped.length > DISPLAY_MAX_CHARS ? `${escaped.slice(0, DISPLAY_MAX_CHARS)}…` : escaped;
}
