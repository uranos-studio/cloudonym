// 보이지 않는 글자의 하나뿐인 정의 — 엔진 규칙(rules/*) · 표시(display.ts) · 라벨(labels.ts) · 생성기(scripts/rules/build-*.mjs)가 모두 여기서 가져온다.
// .mjs 인 까닭: 생성기는 Node 로 바로 돌아 .ts 를 읽지 못한다. 타입은 invisible.d.mts 가 준다.
//
// 손으로 나열한 범위(예: \u200B-\u200F)는 빈 곳이 생긴다 — 소프트 하이픈(U+00AD) · 한글 채움(U+3164 · U+115F · U+1160 · U+FFA0) ·
// 몽골 모음 구분(U+180E) · 이체 선택자(U+FE00-FE0F) · 결합 자소 결합 금지(U+034F) · 태그 문자(U+E0000-E007F) 를 빠뜨렸었다.
// 그래서 유니코드 속성으로 정의한다(u 플래그 필요 · ES2018 — Node 22 · Workers · 최신 브라우저가 지원한다).
//   Default_Ignorable_Code_Point — 글꼴이 그리지 않는 글자 전부(폭 없는 문자 · 이체 선택자 · 한글 채움 · 태그 문자 …)
//   Cc — C0 · DEL · C1 제어 문자
//   Cf — 서식 문자(방향 제어 U+061C · U+200E-200F · U+202A-202E · U+2066-2069 와 BOM 을 포함한다)
//   Zl · Zp — 줄 구분(U+2028) · 문단 구분(U+2029). 공백(Zs)은 보이는 공백이라 넣지 않는다

/** 정규식 문자 클래스 본문(대괄호 없이) — `[${INVISIBLE_CLASS}]` 꼴로 쓰고 u 플래그를 단다 */
export const INVISIBLE_CLASS = '\\p{Default_Ignorable_Code_Point}\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}';

/** 「이름 어디에도 보이지 않는 글자가 없다」 앞보기 — 패턴 맨 앞에 붙인다(u 플래그). 맨 앞에서 한 번만 훑으므로 선형이다 */
export const NO_INVISIBLE = `(?![\\s\\S]*[${INVISIBLE_CLASS}])`;
