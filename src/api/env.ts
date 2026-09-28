// 앱용 바인딩 타입 — `wrangler types` 가 만드는 Env 와 별개다 (바인딩이 생기기 전엔 그쪽이 비어 있다 · codex 2차 #16)
// 셋 다 optional: 로컬 · 개발 4단계 전에는 없다. 없으면 텔레메트리가 조용히 건너뛴다
export type Bindings = { CLOUDONYM_KV?: KVNamespace; AXIOM_API_KEY?: string; AXIOM_DATASET?: string };
export type App = { Bindings: Bindings };
