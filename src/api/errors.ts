// 처리하지 못한 예외의 안전망 — 500 도 ErrorResponse 꼴(JSON)로 낸다. 스택은 로그에만 남기고 응답에는 싣지 않는다 (최종 리뷰 I-2)
import type { Context } from 'hono';

export function internalError(err: Error, c: Context): Response {
  console.error('처리하지 못한 예외:', err);
  return c.json({ success: false, errors: ['내부 오류'] }, 500);
}
