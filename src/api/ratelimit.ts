// 요청 제한 (보안 리뷰 M-1) — Workers Rate Limiting 바인딩 API_LIMITER 로 클라이언트 IP 당 센다.
// https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/ — period 는 10 또는 60 초만 된다
// 공식 문서는 IP 를 키로 권하지 않는다(NAT 뒤 여러 사용자가 한 IP 를 나눈다). 무인증 공개 API 라 다른 식별자가 없어 IP 로 간다 — 한도를 넉넉히 잡는 까닭이다
import type { Context, MiddlewareHandler } from 'hono';
import type { App } from './env';

/** wrangler.jsonc 의 ratelimits.simple 과 같아야 한다 — security.test 가 둘을 대어 본다 */
export const RATE_LIMIT = { limit: 60, period: 60 } as const;

/** 한도를 넘었는가. 바인딩이 없으면(로컬 · 시험) 세지 않는다. limit() 이 던지면 막지 않는다 — 제한 장치의 장애가 API 장애가 되지 않게 (fail-open) */
export async function overLimit(c: Context<App>): Promise<boolean> {
  const limiter = c.env.API_LIMITER;
  if (!limiter) return false;
  const key = c.req.header('cf-connecting-ip') ?? 'unknown';
  try {
    const { success } = await limiter.limit({ key });
    return !success;
  } catch (e) {
    console.error('요청 제한 확인 실패 — 통과시킨다:', e);
    return false;
  }
}

/** 429 — ErrorResponse 꼴 + Retry-After(초). headers 로 CORS 등을 더 싣는다 */
export function tooManyRequests(c: Context<App>, headers: Record<string, string> = {}): Response {
  return c.json({ success: false, errors: [`요청이 너무 많다 — ${RATE_LIMIT.period}초 뒤에 다시 보낸다`] }, 429, { 'Retry-After': String(RATE_LIMIT.period), ...headers });
}

/** /v1/* 미들웨어 — POST 만 센다. GET /v1/health · OPTIONS preflight 는 세지 않는다 */
export const rateLimit: MiddlewareHandler<App> = async (c, next) => {
  if (c.req.method !== 'POST') return next();
  if (await overLimit(c)) return tooManyRequests(c);
  return next();
};
