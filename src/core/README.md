순수 로직(제약 · 생성 · 검증) — 런타임 의존성 0, 브라우저와 Worker 양쪽에서 import 한다.

- **문장을 만들지 않는다** — 위반 · 단계 · 설명 · 파싱 오류는 `CoreMessage`(`messages.ts` 의 판별 유니언: `code` · `field` · `params`)로 돌려준다. 문장은 `src/messages/` 가 만든다
- 비시험 소스의 문자열 리터럴에 한글이 없다 — `no-hangul.test.ts` 가 TypeScript 컴파일러 API 로 리터럴 노드만 센다(주석은 된다)
- 같은 입력에서 이름 · 판정 · 제안 · 라벨이 바뀔 수 있는 변경은 `RULES_REVISION`(`revision.ts`)을 올리고 `rules-fingerprint.json` 을 다시 쓴다. 지문에는 이 폴더 비시험 소스(`revision.ts` · `baseline-inputs.ts` 제외)의 토큰 해시가 들어 있어, 출력 표본이 같아도 로직 토큰이 하나라도 바뀌면 올려야 한다. 주석 · 공백 · `displayName` 문구만 바꾼 것은 지문을 바꾸지 않는다
- 규칙마다 `scope`(이름이 유일한 범위 — `scopes.ts` 의 `SCOPES` 키) · `entity`(고유성 부류 — CSP 유형 이름) · `category`(표시 분류) · `uniqueness`(`none` 은 AWS Name 태그)를 적는다. 범위 행에는 「이 안에서 유일하다」는 공식 문서 `docUrl` 이 붙는다. 리소스 트리는 `tree.ts` 의 `buildTree(provider)` 가 `SCOPES` 와 `RULES` 에서 만든다 — 트리를 손으로 적지 않는다. 규칙 · 범위는 행을 더하면 트리가 따라 는다
- 순번 · 역할은 문맥이 아니라 **항목**의 값이다(`tokenValues(ctx, rule, { seq, role })` — 없으면 `01` · `sync`, 지금 출력과 같다). `generateMany(ctx, provider, selection)` 이 고른 항목마다 이름을 만든다 — 순번은 두 자리(`01`…`99`), 입력 없는 · 역할 규칙은 하나. 선택은 먼저 `selection.ts` 의 `validateSelection(provider, raw)` 를 거친다(개수 1~99 · 항목 ≤ 200 · 이름 Σ ≤ 200 · `type` 중복 금지 · 순번 없는 규칙에 개수 1 · 역할은 역할 규칙에만) — API · 화면 · 공유 링크가 같은 함수를 쓴다
- 같은 요청 안에서 같은 부류(`entity`)의 같은 이름은 `conflict.ts` 가 잡는다. 충돌한 **항목마다** `valid:false` 와 `name.conflict` 가 붙고 `ManyResult.conflicts` 는 그 요약이다 — 내보내기가 항목의 `valid` 를 보므로 충돌한 이름이 유효로 나가지 않는다. 한 요청은 부모 범위의 한 인스턴스(한 RG · 한 프로젝트 · 한 VPC)로 본다. 시험 전용 충돌 규칙은 `__fixtures__/conflict.ts`
