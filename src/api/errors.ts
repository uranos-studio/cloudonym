// 실패 응답 직렬화기 (D25) — 모든 실패(400 · 403 · 404 · 409 · 413 · 429 · 500)가 이 fail() 하나를 지난다.
// 404(없는 경로 · 메서드)도 같다. 꼴은 { success:false, errors: WireMessage[], supported? } — errors[i] 마다 code 와 영어 message 가 있다.
// 500 은 스택을 로그에만 남기고 응답에는 싣지 않는다
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Message } from '../messages/catalog';
import { toWireMessage, type WireMessage } from './serialize';

/** 실패 상태 코드 전부 — /docs/api 안내(D98)가 같은 목록을 보이는지 src/api/apidoc-sync.test.ts 가 본다 */
export const FAIL_STATUSES = [400, 403, 404, 409, 413, 429, 500] as const;
export type FailStatus = (typeof FAIL_STATUSES)[number];

/** /v1/wizard 400 의 오류 개수 상한 (D103). 오류 한 건은 잰 것 중 가장 큰 것이 1,042 B(모르는 preset · 값이 UTF-8 3바이트 글자 80자)이고
 *  supported(gcp 규칙 id 전부) 가 약 3.3 KB 라 50건 + 잘림 항목이 64 KB 안이다 — src/api/wizard-errors-cap.test.ts 가 최악 입력으로 잰다.
 *  다른 경로에는 걸지 않는다: /v1/names 는 모르는 type 200개를 200건 그대로 돌려준다(오류 한 건 약 0.1 KB) */
export const MAX_WIZARD_ERRORS = 50;

/** rewrite — 라우트가 문장을 요청 본문의 이름으로 고칠 때(/v1/wizard). 꼴은 그대로다.
 *  maxErrors — 오류를 앞에서부터 그 수까지만 싣고, 넘으면 마지막에 request.errors_truncated(shown · total) 한 항목을 더한다. 없으면 자르지 않는다 */
export function fail(c: Context, status: FailStatus, messages: Message[], extra: { supported?: string[]; rewrite?: (w: WireMessage) => WireMessage; maxErrors?: number } = {}, headers: Record<string, string> = {}): Response {
  const cut = extra.maxErrors !== undefined && messages.length > extra.maxErrors;
  const shown = cut ? messages.slice(0, extra.maxErrors) : messages;
  const errors = shown.map((m) => (extra.rewrite ? extra.rewrite(toWireMessage(m)) : toWireMessage(m)));
  if (cut) errors.push(toWireMessage({ code: 'request.errors_truncated', params: { shown: shown.length, total: messages.length } }));
  const body = {
    success: false as const,
    errors,
    ...(extra.supported ? { supported: extra.supported } : {}),
  };
  return c.json(body, status as ContentfulStatusCode, headers);
}

/** 처리하지 못한 예외의 안전망 — app.onError · v1.onError 가 건다 */
export function internalError(err: Error, c: Context): Response {
  console.error('처리하지 못한 예외:', err);
  return fail(c, 500, [{ code: 'server.internal_error' }]);
}
