// @ts-check
// API 부르기 (D102) — 요청마다 User-Agent: cloudonym-cli/<버전>. 다시 보내는 것은 429 의 --wait 뿐이고 명령 전체에서 한 번이다(400 · 409 · 413 은 다시 보내도 같다)
import { readFileSync } from 'node:fs';

/** 저장소 package.json 의 version — CLI 는 저장소 안에서만 돈다(npm 공개 없음) */
export const CLI_VERSION = /** @type {{ version: string }} */ (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'))).version;
export const USER_AGENT = `cloudonym-cli/${CLI_VERSION}`;

/** --wait 가 기다리는 상한(초) — Retry-After 가 이보다 크면 기다리지 않는다 */
export const MAX_WAIT_SECONDS = 120;
/** Retry-After 가 없거나 읽을 수 없을 때 기다리는 초 — 서버의 창(60 s)과 같다 */
export const DEFAULT_WAIT_SECONDS = 60;
/** --timeout 상한(ms) — AbortSignal.timeout 은 2^31 이상을 1 ms 로 바꾸고(경고만) 2^32 이상은 던진다(Node 22 실측) */
export const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * @typedef {(url: string, init: { method: string, headers: Record<string, string>, body?: string, signal?: AbortSignal }) => Promise<{ status: number, headers: { get(name: string): string | null }, text(): Promise<string> }>} FetchFn
 */
/**
 * 응답 하나 — ok: 2xx 이고 본문이 JSON · malformed: 2xx 인데 본문을 해석할 수 없다 · http: 그 밖의 상태(본문은 JSON 이면 객체) ·
 * unreachable: 닿지 않음 · 시간 초과 · 본문을 읽다 끊김
 * @typedef {{ kind: 'ok', status: number, body: any } | { kind: 'malformed', status: number, message: string } | { kind: 'http', status: number, body: any, retryAfter?: number } | { kind: 'unreachable', message: string }} ApiResult
 */

/**
 * 서버를 고른다 — --server → CLOUDONYM_SERVER. 기본값은 없다(배포 URL 을 도구에 박지 않는다).
 * origin + 경로(끝의 / 를 뗀다)로 조립한다 — 쿼리 · fragment 가 있으면 API 경로가 그 뒤에 붙으므로 거부하고,
 * 사용자 이름 · 암호가 든 URL 은 오류 문장 · 「Cannot reach」 줄에 그대로 찍히므로 거부한다.
 * 거부 문장에는 받은 URL 을 넣지 않는다 — 쿼리의 토큰 · 해석되지 않는 URL 의 자격이 stderr 로 나가므로, 무엇이 틀렸는지만 말한다
 * @param {string | undefined} flag @param {Record<string, string | undefined>} env
 * @returns {{ server: string } | { error: string }}
 */
export function serverOf(flag, env) {
  const raw = flag ?? env.CLOUDONYM_SERVER;
  if (raw === undefined || raw === '') return { error: 'No server: pass --server <origin> or set CLOUDONYM_SERVER (for example http://127.0.0.1:8787 for wrangler dev).' };
  /** @type {URL} */
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { error: 'The server URL is not a valid URL (it is not repeated here, in case it carries a secret).' };
  }
  if (u.username !== '' || u.password !== '') return { error: 'The server URL must not carry a user name or password.' };
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'The server URL must start with http:// or https://.' };
  if (u.search !== '' || u.hash !== '') return { error: 'The server URL must not have a query or fragment.' };
  return { server: `${u.origin}${u.pathname.replace(/\/+$/, '')}` };
}

/**
 * Retry-After → 기다릴 초. 0 이상 정수 초 · HTTP-date(남은 초, 지났으면 0). 음수 · 소수 · 그 밖의 꼴은 없는 것(undefined)
 * @param {string | null} value @param {Date} now
 * @returns {number | undefined}
 */
export function retryAfterSeconds(value, now) {
  if (value === null) return undefined;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v);
  if (!/[a-z]/i.test(v)) return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, Math.ceil((t - now.getTime()) / 1000)) : undefined;
}

/** @param {unknown} e */
const messageOf = (e) => `${e instanceof Error ? e.message : String(e)}${e instanceof Error && e.cause instanceof Error ? ` (${e.cause.message})` : ''}`;

/**
 * 클라이언트 하나 = 명령 하나. 429 다시 보내기(--wait)는 이 클라이언트 전체에서 한 번이다 — 환경이 여럿이어도 최악 대기는 MAX_WAIT_SECONDS 한 번
 * @param {{ server: string, fetchFn: FetchFn, timeoutMs: number, wait: boolean, sleep: (ms: number) => Promise<void>, log: (line: string) => void, now: () => Date }} o
 */
export function createClient(o) {
  let retriesLeft = 1;
  /**
   * @param {string} method @param {string} path @param {unknown} [body]
   * @returns {Promise<ApiResult>}
   */
  async function once(method, path, body) {
    /** @type {Record<string, string>} */
    const headers = { 'user-agent': USER_AGENT, accept: 'application/json' };
    /** @type {{ method: string, headers: Record<string, string>, body?: string, signal?: AbortSignal }} */
    const init = { method, headers, signal: AbortSignal.timeout(o.timeoutMs) };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      // 압축 직렬화 — 들여쓴 파일을 그대로 보내면 큰 계획이 본문 상한을 넘는다 (D100)
      init.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await o.fetchFn(`${o.server}${path}`, init);
    } catch (e) {
      return { kind: 'unreachable', message: messageOf(e) };
    }
    // 본문 읽기도 시간 초과 · 연결 끊김으로 실패한다 — 닿지 않은 것과 같이 다룬다
    let text;
    try {
      text = await res.text();
    } catch (e) {
      return { kind: 'unreachable', message: `reading the answer failed: ${messageOf(e)}` };
    }
    /** @type {any} */
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    if (res.status >= 200 && res.status < 300) {
      return parsed === undefined ? { kind: 'malformed', status: res.status, message: 'the body is not JSON' } : { kind: 'ok', status: res.status, body: parsed };
    }
    const ra = retryAfterSeconds(res.headers.get('retry-after'), o.now());
    return { kind: 'http', status: res.status, body: parsed, ...(ra === undefined ? {} : { retryAfter: ra }) };
  }

  /**
   * 429 이고 --wait 이고 아직 다시 보낸 적이 없으면 Retry-After 만큼 기다려 한 번 다시 보낸다
   * @param {string} method @param {string} path @param {unknown} [body]
   * @returns {Promise<ApiResult>}
   */
  async function call(method, path, body) {
    const r = await once(method, path, body);
    if (r.kind !== 'http' || r.status !== 429 || !o.wait || retriesLeft === 0) return r;
    const secs = r.retryAfter ?? DEFAULT_WAIT_SECONDS;
    if (secs > MAX_WAIT_SECONDS) return r;
    retriesLeft--;
    o.log(`Rate limited (429) — waiting ${secs} s and trying once more (once per command).`);
    await o.sleep(secs * 1000);
    return once(method, path, body);
  }

  return {
    /** @param {string} path */
    get: (path) => call('GET', path),
    /** @param {string} path @param {unknown} body */
    post: (path, body) => call('POST', path, body),
  };
}
