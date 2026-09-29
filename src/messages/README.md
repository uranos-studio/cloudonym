표현 계층 — 엔진(`src/core/messages.ts` 의 `CoreMessage`)과 API(`src/api/codes.ts` 의 `ApiMessage`)가 돌려주는 코드를 사람이 읽는 문장으로 바꾼다 (D23 · D24).

- `catalog.ts` — `Message` 합집합 · `Catalog` 타입 · 화면 문구 키 `UI_KEYS` · `format` · `fillUi`
- `en.ts` — 영어 사전. 시스템이 쓰는 문구의 정본이다
- `src/core/` 는 이 폴더를 들여오지 않는다. `src/api/` 와 `src/components/` 가 들여온다
- 코드를 더하면 `en.ts` 에 문장 함수가 없거나 그 코드의 params 를 안 받는 순간 `tsc` 가 실패한다
- 언어를 더할 때는 같은 `Catalog` 타입을 채우는 파일 하나를 더한다
