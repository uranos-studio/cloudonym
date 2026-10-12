React UI components (`.tsx`) — Tailwind CSS and lucide-react. They call the engine (`src/core/`) directly and hold no naming rules.

- **Routes** (D57) — `main.tsx` draws one of `App` (the wizard at `/`, the four-step tree at `/pick`), `NamingDoc` (`/docs/naming`) or `Privacy` (`/privacy`) from `routeOf(location.pathname)` in `route.ts`. There is no router dependency. The naming guide draws a model that pure functions in `namingDocModel.ts` build from the generated catalog, the region table, the dictionary and the version — no hand-written numbers or tables
- **Share hash v3** (D55 · `urlState.ts`) — the region code (a zone input is stored as its region code — D50 revised) · an `r` value of `n` or `"n:kindName"`. The cap `MAX_HASH_CHARS` is a fixed formula measured by `urlState.test`. A link for a provider that is not enabled keeps the three free fields and `env`, drops the region and the selection, and says so in one line
- **A tree row is a catalog row** (D53 · `selection.ts` · `ResourceTree.tsx`) — a row with more than one rule picks the scope first, and kinds are filtered again by that scope's `allowed`.
- UI text comes only from `src/messages/en.ts` — `no-hangul.test.ts` counts literals and JSX text

## 한국어

React UI 컴포넌트(`.tsx`) — Tailwind CSS · lucide-react 를 쓴다. 엔진(`src/core/`)을 직접 부르고 이름 규칙을 여기에 두지 않는다.

- **경로** (D57) — `main.tsx` 가 `route.ts` 의 `routeOf(location.pathname)` 로 `App`(네 단계) · `NamingDoc`(`/docs/naming`) · `Privacy`(`/privacy`) 중 하나를 그린다. 라우터 의존성은 없다. 이름 안내는 `namingDocModel.ts` 의 순수 함수가 생성 catalog · 지역 표 · 사전 · 버전에서 만든 모델을 그린다 — 손으로 쓴 숫자 · 표가 없다
- **공유 hash v3** (D55 · `urlState.ts`) — 지역 입력 코드(존이면 존 코드) · `r` 값 `n` 또는 `"n:값이름"`. 상한 `MAX_HASH_CHARS` 는 고정식이고 `urlState.test` 가 잰다. 꺼진 CSP 의 링크는 자유 입력 셋과 `env` 만 살리고 지역 · 선택을 버린 뒤 한 줄로 알린다
- **트리 행 = catalog 행** (D53 · `selection.ts` · `ResourceTree.tsx`) — 규칙이 둘 이상인 행은 범위를 먼저 고르고, 종류는 범위의 `allowed` 로 다시 거른다. 존이 없으면 존 행은 새로 체크할 수 없다(이미 고른 행은 남기고 FAIL 카드로 이유를 보인다)
- 화면 문구는 `src/messages/en.ts` 에서만 온다 — `no-hangul.test.ts` 가 리터럴 · JSX 글자를 센다
