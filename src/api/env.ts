// 앱용 바인딩 타입 — `wrangler types` 가 만드는 Env 와 별개다 (바인딩이 생기기 전엔 그쪽이 비어 있다)
// 전부 optional: 로컬이나 바인딩을 만들기 전에는 없다. 없으면 텔레메트리 · 요청 제한이 조용히 건너뛴다
// API_LIMITER — Workers Rate Limiting 바인딩 (wrangler.jsonc ratelimits). RateLimit 타입은 worker-configuration.d.ts 에 있다
// TELEMETRY_SKIP_TOKEN — 비밀(wrangler secret put). 운영자 점검 요청이 같은 값을 헤더에 실으면 세지 않는다 (D99). 없으면 전부 센다
export type Bindings = { CLOUDONYM_KV?: KVNamespace; AXIOM_API_KEY?: string; AXIOM_DATASET?: string; API_LIMITER?: RateLimit; TELEMETRY_SKIP_TOKEN?: string };
export type App = { Bindings: Bindings };
