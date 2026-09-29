순수 로직(제약 · 생성 · 검증) — 런타임 의존성 0, 브라우저와 Worker 양쪽에서 import 한다.

- **문장을 만들지 않는다** — 위반 · 단계 · 설명 · 파싱 오류는 `CoreMessage`(`messages.ts` 의 판별 유니언: `code` · `field` · `params`)로 돌려준다. 문장은 `src/messages/` 가 만든다
- 비시험 소스의 문자열 리터럴에 한글이 없다 — `no-hangul.test.ts` 가 TypeScript 컴파일러 API 로 리터럴 노드만 센다(주석은 된다)
- 같은 입력에서 이름 · 판정 · 제안 · 라벨이 바뀌는 변경은 `RULES_REVISION`(`revision.ts`)을 올리고 `rules-fingerprint.json` 을 다시 쓴다
