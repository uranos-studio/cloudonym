Hono 기반 Worker API(`/v1/*`)와 `/llms.txt`, 텔레메트리 — Worker 엔트리는 `src/api/index.ts` 다. `/openapi.json` 은 `public/` 의 정적 자산이다.

- 응답의 메시지는 전부 `{ code, field?, params?, message }`(`serialize.ts` 의 `toWireMessage`) — 문장은 `src/messages/` 사전이 만든다
- **모든 실패 응답은 `errors.ts` 의 `fail()` 하나를 지난다** (400 · 403 · 409 · 413 · 429 · 500). 새 실패 경로도 `fail()` 로 낸다 — `no-hangul.test` · `openapi.test` 가 표본 응답을 명세로 검증한다
- 응답에 `version`(`src/version.ts`)을 싣는다. 요청의 `rules_version` 이 지금 규칙 버전과 다르면 409 (`schemas.ts`)
