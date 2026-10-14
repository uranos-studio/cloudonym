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

/** 실패 응답에 되돌려 싣는 사용자 값의 최대 글자 수 (D103 · 2026-10-14) — params.value · params.requested 를 이 길이에서 자르고 `…` 를 붙인다.
 *  message 는 params 로 만들므로 같이 짧아진다. 값을 만드는 쪽(schemas.ts describe · core clipForDisplay)이 먼저 보이지 않는 문자를 이스케이프하고 80자로 자른 것을
 *  fail() 이 한 번 더 자른다 — 모든 경로 · 모든 실패 상태가 같은 규칙을 지난다. 이 길이 이하 값은 바이트까지 그대로다.
 *  80 → 40 으로 /v1/names 최악 400 이 111,469 B → 약 87 KB 가 됐다(src/api/error-response-cap.test.ts) */
export const MAX_ECHO_CHARS = 40;
/** 사용자 값을 되돌려 싣는 params 칸 — supported · pattern · type · current 처럼 서버가 아는 값은 자르지 않는다 */
const ECHO_PARAMS = ['value', 'requested'] as const;
/** value 가 사용자 값이 아니라 서버가 만든 식별자인 코드 — 규칙의 resource type(selection.duplicate_type) · pick 의 중복 키 type/kind/tier/role(wizard.duplicate_pick).
 *  40자를 넘을 수 있고(gcp.iam_principal_access_boundary_policy 의 키 + tier + role) 잘리면 어느 pick 인지 못 알아본다 */
const DERIVED_VALUE_CODES: ReadonlySet<string> = new Set(['selection.duplicate_type', 'wizard.duplicate_pick']);

/** 메시지 하나의 되돌린 값을 자른다. 자를 것이 없으면 같은 객체를 돌려준다 */
export function clipEchoes(m: Message): Message {
  const params: unknown = 'params' in m ? m.params : undefined;
  if (typeof params !== 'object' || params === null || DERIVED_VALUE_CODES.has(m.code)) return m;
  const p = params as Record<string, unknown>;
  const long = ECHO_PARAMS.filter((k) => typeof p[k] === 'string' && (p[k] as string).length > MAX_ECHO_CHARS);
  if (long.length === 0) return m;
  const clipped = { ...p };
  for (const k of long) clipped[k] = `${(p[k] as string).slice(0, MAX_ECHO_CHARS)}…`;
  return { ...m, params: clipped } as Message;
}

/** 400 오류 개수 상한 (D103) — 경로마다 「정상 요청이 낼 수 있는 오류 수보다 크고, 32 KiB 본문의 최악 응답이 64 KB 안」인 값.
 *  넘으면 앞에서부터 그 수까지 싣고 request.errors_truncated(shown · total) 한 항목을 더한다. 잰 값은 src/api/*-cap.test.ts 가 최악 입력으로 다시 잰다.
 *  /v1/wizard — 오류 한 건이 가장 큰 것은 되돌린 값이 UTF-8 3바이트 글자 40자인 모르는 preset 이고, supported(gcp 규칙 id 전부)가 약 3.3 KB 라 50건 + 잘림 항목이 64 KB 안이다 */
export const MAX_WIZARD_ERRORS = 50;
/** /v1/generate — 정상 요청의 오류는 문맥 다섯 칸 · provider 몇 개라 열 건을 넘지 않는다. 50건 + 잘림 항목이 64 KB 안이다.
 *  상한 전에는 `providers: [0, 0, …]` 32 KiB 가 오류 16,330건 · 2.1 MB 응답을 만들었다 */
export const MAX_GENERATE_ERRORS = 50;
/* /v1/names 에는 걸지 않는다 — 항목 200개(MAX_ITEMS)마다 오류가 나는 요청도 정상 범위라 그 응답을 바꾸지 않는다.
 * 그 대가로 이 경로의 최악 400 은 64 KB 를 넘는다 — 규칙마다 오류 셋인 요청은 되돌린 값이 한 글자여도 77 KB 다(오류 수가 만든 크기).
 * /v1/validate · /v1/events 는 오류가 많아야 셋이다 */

/** rewrite — 라우트가 문장을 요청 본문의 이름으로 고칠 때(/v1/wizard). 꼴은 그대로다.
 *  maxErrors — 오류를 앞에서부터 그 수까지만 싣고, 넘으면 마지막에 request.errors_truncated(shown · total) 한 항목을 더한다. 없으면 자르지 않는다 */
export function fail(c: Context, status: FailStatus, messages: Message[], extra: { supported?: string[]; rewrite?: (w: WireMessage) => WireMessage; maxErrors?: number } = {}, headers: Record<string, string> = {}): Response {
  const cut = extra.maxErrors !== undefined && messages.length > extra.maxErrors;
  const shown = (cut ? messages.slice(0, extra.maxErrors) : messages).map(clipEchoes);
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
