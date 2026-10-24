// 규칙 버전 (D26) — 같은 입력에서 다른 이름 · 판정 · 제안 · 라벨이 나올 수 있는 변경마다 올린다.
// 꼴 YYYY-MM-DD.N — 같은 날 두 번째 변경은 .2. 규칙 데이터(constraints · 단축 사전 · 별칭 · 보호 토큰 · 라벨 한도)와
// 정제 · 축소 · 검증 알고리즘이 대상이다 — src/core 비시험 소스의 토큰이 하나라도 바뀌면 출력 표본이 같아도 올린다(보수적).
// 주석 · 공백 · displayName 문구만 바뀐 것은 올리지 않는다. 올렸으면 rules-fingerprint.json 을 다시 쓴다 (revision.test.ts 의 안내)
export const RULES_REVISION = '2026-10-24.1';
