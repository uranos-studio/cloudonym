// 요청 제한 — Workers Rate Limiting 바인딩 API_LIMITER 로 클라이언트 IP 당 센다.
// https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/ — period 는 10 또는 60 초만 된다
// 공식 문서는 IP 를 키로 권하지 않는다(NAT 뒤 여러 사용자가 한 IP 를 나눈다). 무인증 공개 API 라 다른 식별자가 없어 IP 로 간다 — 한도를 넉넉히 잡는 까닭이다
import type { Context, MiddlewareHandler } from 'hono';
import type { App } from './env';
import { fail } from './errors';

/** wrangler.jsonc 의 ratelimits.simple 과 같아야 한다 — security.test 가 둘을 대어 본다 */
export const RATE_LIMIT = { limit: 60, period: 60 } as const;

/** 요청 제한 key — IPv4 는 그대로, IPv6 는 앞 64 비트(/64)로 묶는다. 한 가입자가 /64 를 통째로 받으므로 주소를 바꿔 가며 한도를 피하지 못하게.
 *  `::` 줄임 · 대소문자 · 앞자리 0 · 끝의 IPv4 표기가 달라도 같은 key 가 되도록 여덟 묶음으로 펼친 뒤 앞 넷만 쓴다. 읽을 수 없는 값은 그대로 둔다 */
export function limitKey(ip: string): string {
  if (!ip.includes(':')) return ip;
  let text = ip.toLowerCase();
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    text = `${text.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return ip;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const groups = halves.length === 2 ? [...head, ...Array<string>(8 - head.length - tail.length).fill('0'), ...tail] : head;
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return ip;
  return `${groups.slice(0, 4).map((g) => Number.parseInt(g, 16).toString(16)).join(':')}::/64`;
}

/** 한도를 넘었는가. 바인딩이 없으면(로컬 · 시험) 세지 않는다. limit() 이 던지면 막지 않는다 — 제한 장치의 장애가 API 장애가 되지 않게 (fail-open) */
export async function overLimit(c: Context<App>): Promise<boolean> {
  const limiter = c.env.API_LIMITER;
  if (!limiter) return false;
  const key = limitKey(c.req.header('cf-connecting-ip') ?? 'unknown');
  try {
    const { success } = await limiter.limit({ key });
    return !success;
  } catch (e) {
    console.error('요청 제한 확인 실패 — 통과시킨다:', e);
    return false;
  }
}

/** 429 — fail() 꼴 + Retry-After(초). headers 로 CORS 등을 더 싣는다 */
export function tooManyRequests(c: Context<App>, headers: Record<string, string> = {}): Response {
  return fail(c, 429, [{ code: 'request.rate_limited', params: { retry_after: RATE_LIMIT.period } }], {}, { 'Retry-After': String(RATE_LIMIT.period), ...headers });
}

/** /v1/* 미들웨어 — POST 만 센다. GET /v1/health · OPTIONS preflight 는 세지 않는다 */
export const rateLimit: MiddlewareHandler<App> = async (c, next) => {
  if (c.req.method !== 'POST') return next();
  if (await overLimit(c)) return tooManyRequests(c);
  return next();
};
