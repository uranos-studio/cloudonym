// API 메시지 코드 (D23) — 요청 모양 · 전송 위생 · 서버 오류. 엔진 코드(src/core/messages.ts)와 같이 code 로 구분하는 유니언이다.
// 이 파일은 화면 번들(src/messages/catalog.ts)에도 들어가므로 Worker · node 타입을 들여오지 않는다.

export const API_CODES = [
  'request.body_not_json', 'request.body_not_object', 'request.body_too_large', 'request.context_not_object',
  'request.field_too_long', 'request.providers_not_array', 'request.providers_empty', 'request.value_unsupported',
  'request.field_not_string', 'request.same_origin_only', 'request.rate_limited', 'request.rules_version_mismatch',
  'request.not_found', 'server.internal_error',
] as const;

export type ApiMessage =
  | { code: 'request.body_not_json' }
  | { code: 'request.body_not_object' }
  | { code: 'request.body_too_large'; params: { max_bytes: number } }
  | { code: 'request.context_not_object' }
  | { code: 'request.field_too_long'; field: string; params: { max: number } }
  | { code: 'request.providers_not_array' }
  | { code: 'request.providers_empty' }
  /** field 는 providers[i] · provider · resource_type · event. value 는 표시용 문자열(80자 자름 · 비문자열은 JSON 문자열화) */
  | { code: 'request.value_unsupported'; field: string; params: { value: string } }
  | { code: 'request.field_not_string'; field: string }
  | { code: 'request.same_origin_only' }
  | { code: 'request.rate_limited'; params: { retry_after: number } }
  | { code: 'request.rules_version_mismatch'; params: { requested: string; current: string } }
  /** /v1 아래 없는 경로 · 메서드 (리뷰 L1). 경로를 되돌려 싣지 않는다 */
  | { code: 'request.not_found' }
  | { code: 'server.internal_error' };

export type ApiCode = ApiMessage['code'];

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const API_CODES_MATCH_UNION: Same<(typeof API_CODES)[number], ApiCode> = true;
