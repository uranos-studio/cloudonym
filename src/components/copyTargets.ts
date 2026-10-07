// ui_copy 의 target (D56) — API 의 UI_COPY_TARGETS 와 같다(src/api/privacy-sync.test). components 는 api 를 들여오지 않으므로 여기 따로 둔다.
// beacon.ts(fetch keepalive — 브라우저 타입)와 떼어 둔 것은 api 시험이 Workers 타입으로 이 파일만 읽게 하려는 것이다
export const COPY_TARGETS = ['share-url', 'name', 'all-names', 'names-json', 'terraform', 'tags-json'] as const;
export type CopyTarget = (typeof COPY_TARGETS)[number];
