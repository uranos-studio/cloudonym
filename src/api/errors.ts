// 실패 응답 직렬화기 (D25) — 모든 실패(400 · 403 · 404 · 409 · 413 · 429 · 500)가 이 fail() 하나를 지난다.
// 404(없는 경로 · 메서드)도 같다. 꼴은 { success:false, errors: WireMessage[], supported? } — errors[i] 마다 code 와 영어 message 가 있다.
// 500 은 스택을 로그에만 남기고 응답에는 싣지 않는다
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Message } from '../messages/catalog';
import { toWireMessage, type WireMessage } from './serialize';

export type FailStatus = 400 | 403 | 404 | 409 | 413 | 429 | 500;

/** rewrite — 라우트가 문장을 요청 본문의 이름으로 고칠 때(/v1/wizard). 꼴은 그대로다 */
export function fail(c: Context, status: FailStatus, messages: Message[], extra: { supported?: string[]; rewrite?: (w: WireMessage) => WireMessage } = {}, headers: Record<string, string> = {}): Response {
  const body = {
    success: false as const,
    errors: messages.map((m) => (extra.rewrite ? extra.rewrite(toWireMessage(m)) : toWireMessage(m))),
    ...(extra.supported ? { supported: extra.supported } : {}),
  };
  return c.json(body, status as ContentfulStatusCode, headers);
}

/** 처리하지 못한 예외의 안전망 — app.onError · v1.onError 가 건다 */
export function internalError(err: Error, c: Context): Response {
  console.error('처리하지 못한 예외:', err);
  return fail(c, 500, [{ code: 'server.internal_error' }]);
}
