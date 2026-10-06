Hono 기반 Worker API(`/v1/*`)와 `/llms.txt`, 텔레메트리 — Worker 엔트리는 `src/api/index.ts` 다. `/openapi.json` 은 `public/` 의 정적 자산이다.

- 응답의 메시지는 전부 `{ code, field?, params?, message }`(`serialize.ts` 의 `toWireMessage`) — 문장은 `src/messages/` 사전이 만든다
- **모든 실패 응답은 `errors.ts` 의 `fail()` 하나를 지난다** (400 · 403 · 409 · 413 · 429 · 500). 새 실패 경로도 `fail()` 로 낸다 — `no-hangul.test` · `openapi.test` 가 표본 응답을 명세로 검증한다
- 응답에 `version`(`src/version.ts`)을 싣는다. 요청의 `rules_version` 이 지금 규칙 버전과 다르면 409 (`schemas.ts`)
- 라우트 — `POST /v1/generate`(카탈로그: provider 의 규칙 전부 · 순번 `01`) · `POST /v1/names`(고른 리소스와 개수 · D39) · `POST /v1/validate` · `GET /v1/health` · `POST /v1/events`(화면 비콘) · `GET /llms.txt`
- `/v1/names` — `parseNamesBody` 는 provider · context 모양만 보고 `resources` 는 core `validateSelection` 에 넘긴다. 400 은 core `selection.*` 를 그대로 싣고(API 전용 코드 없음) 되돌려 싣는 `type` · `role` 값은 원래 입력에서 80자 · `\uXXXX` 로 다시 만든다. 항목의 `scope`(배치 범위) · `uniqueness` 는 `toWireNames` 가 규칙에서 붙인다 — 두 필드의 설명 문장은 `llms.ts` 의 `SCOPE_MEANING` · `UNIQUENESS_MEANING` 이 정본이고 `openapi.json` 이 같은 문장을 쓴다
- 충돌 fixture(시험 전용 규칙 둘)는 규칙 표에 없어 HTTP 로 닿지 않는다 — `names-conflict.test.ts` 가 `rulesFor` 를 mock 해 본다. 운영 코드에 시험용 훅을 두지 않는다
