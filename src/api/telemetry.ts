// 텔레메트리 — Axiom 이벤트 + KV 일자 카운터 (D16 · D17 · D56). 반드시 c.executionCtx.waitUntil() 안에서 부른다. 오류는 삼킨다
import type { Bindings } from './env';

/** Hono Context 가 이 모양을 만족한다 — 시험은 평범한 객체를 넣는다 */
export interface TelemetrySource { env: Bindings; req: { header: (name: string) => string | undefined } }
/** fetch 응답에서 쓰는 부분만 — 전역 Response 가 이것을 만족한다. fetch 는 HTTP 오류에 reject 하지 않으므로 ok · status 를 직접 본다 */
export interface FetchResponseLike { ok: boolean; status: number; text: () => Promise<string> }
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<FetchResponseLike>;
/** formatToParts 꼴 — 시험이 부분이 빠진 결과를 주입한다 */
export type FormatParts = (d: Date) => Intl.DateTimeFormatPart[];
/** 시험이 시계 · fetch · 시각 포매터를 주입하는 자리 — 운영 코드는 넘기지 않는다 */
export interface TelemetryDeps { now?: Date; fetchFn?: FetchLike; formatParts?: FormatParts }

/** ① 의 UA 정규식 그대로 (D17) */
export const AI_AGENT_UA = /Cursor|Windsurf|Claude|GPTBot|Copilot/i;
export function isAiAgent(userAgent: string): boolean {
  return AI_AGENT_UA.test(userAgent);
}

/** UA 원문은 싣지 않는다 (D56) — UA 에는 아무 글자나 넣을 수 있다. 대신 네 값 중 하나 */
export type ClientClass = 'ai_agent' | 'browser' | 'cli' | 'other';
/** 앞머리에 도구 이름이 오고 바로 / 또는 끝 — 「my curl/8」 · 「nodejs-x」 는 cli 가 아니다 */
const CLI_UA = /^(?:curl|wget|python-requests|go-http-client|node)(?:\/|$)/i;
/** ai_agent 를 먼저 본다 — GPTBot 처럼 Mozilla/ 로 시작하는 에이전트가 browser 로 가지 않게 */
export function classifyClient(userAgent: string | undefined): ClientClass {
  const ua = userAgent ?? '';
  if (isAiAgent(ua)) return 'ai_agent';
  if (ua.startsWith('Mozilla/')) return 'browser';
  if (CLI_UA.test(ua)) return 'cli';
  return 'other';
}

/** 이벤트마다 Axiom 에 싣는 meta 키 (D56 필드 표) — 표에 없는 키 · 표에 없는 이벤트의 meta 는 싣지 않는다 */
export const META_KEYS: Readonly<Record<string, readonly string[]>> = {
  ui_visit: [], ui_generate: [], ui_copy: ['target'],
  api_generate: ['providers'], api_names: ['provider', 'resource_count', 'name_count', 'valid'], api_validate: ['provider', 'resource_type', 'valid'],
  llms_txt_accessed: [], catalog_json_accessed: [],
};
function allowedMeta(event: string, meta: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.hasOwn(META_KEYS, event) ? META_KEYS[event]! : [];
  return Object.fromEntries(keys.filter((k) => Object.hasOwn(meta, k)).map((k) => [k, meta[k]]));
}

/** KV 일자 카운터의 수명 — 366일 뒤 Cloudflare 가 지운다 (D56 · /privacy 의 보존 기간) */
export const KV_TTL_SECONDS = 366 * 86400;

const KST = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/** KST 일자 키와 +09:00 타임스탬프 — formatToParts 의 부분값으로 조립한다 (format() 의 구분 문자는 ICU 버전마다 다를 수 있다).
 *  부분이 하나라도 없으면 던진다 — 빈값으로 「--T::」 를 만들어 보내지 않는다. 잘못된 시각은 formatToParts 가 RangeError 를 던진다 */
export function kstStamp(now: Date, formatParts: FormatParts = (d) => KST.formatToParts(d)): { day: string; time: string } {
  const parts = formatParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): string => {
    const value = parts.find((p) => p.type === type)?.value;
    if (!value) throw new Error(`KST 시각에 ${type} 부분이 없다`);
    return value;
  };
  const day = `${get('year')}-${get('month')}-${get('day')}`;
  return { day, time: `${day}T${get('hour')}:${get('minute')}:${get('second')}+09:00` };
}

/** read-modify-write — 동시 요청은 한 건을 잃을 수 있고 같은 키 초당 1회 쓰기 제한에 걸리면 그 건은 버려진다. 근사치로 받아들인다 (D16).
 *  값이 숫자가 아니면 0 에서 다시 센다 — 'NaN' 을 저장하면 그날 카운터가 죽는다 */
async function bump(kv: KVNamespace, key: string): Promise<void> {
  const n = Number.parseInt((await kv.get(key)) ?? '0', 10);
  const current = Number.isFinite(n) ? n : 0;
  await kv.put(key, String(current + 1), { expirationTtl: KV_TTL_SECONDS });
}

async function countKv(kv: KVNamespace, event: string, day: string, ai: boolean): Promise<void> {
  try {
    await bump(kv, `stats:${event}:${day}`);
    if (ai) await bump(kv, `stats:ai_agent_hits:${day}`);
  } catch (e) {
    console.error('KV 카운터 실패:', e);
  }
}

/** Axiom 응답 본문 { ingested, failed, failures[] } 에서 failed 만 본다. 본문이 비었거나 JSON 이 아니면 0 으로 친다 */
function failedCount(body: string): number {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null && 'failed' in parsed && typeof parsed.failed === 'number') return parsed.failed;
  } catch {
    // 빈 본문 · JSON 아님 — 거부 여부는 status 로 이미 봤다
  }
  return 0;
}

async function sendAxiom(fetchFn: FetchLike, apiKey: string, dataset: string, payload: Record<string, unknown>[]): Promise<void> {
  try {
    const res = await fetchFn(`https://api.axiom.co/v1/datasets/${dataset}/ingest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.text();
    if (!res.ok) {
      console.error('Axiom 거부:', res.status, body);
      return;
    }
    const failed = failedCount(body);
    if (failed > 0) console.error('Axiom 일부 버림:', failed, body);
  } catch (e) {
    console.error('Axiom 전송 실패:', e);
  }
}

export async function logTelemetry(c: TelemetrySource, event: string, meta: Record<string, unknown> = {}, deps: TelemetryDeps = {}): Promise<void> {
  // 몸통 전체를 try 로 감싼다 — waitUntil 로 넘긴 Promise 가 reject 하지 않는다
  try {
    const now = deps.now ?? new Date();
    const fetchFn: FetchLike = deps.fetchFn ?? ((url, init) => fetch(url, init));
    const clientClass = classifyClient(c.req.header('user-agent'));
    const ai = clientClass === 'ai_agent';
    const { day, time } = kstStamp(now, deps.formatParts);
    const { CLOUDONYM_KV: kv, AXIOM_API_KEY: apiKey, AXIOM_DATASET: dataset } = c.env;

    // KV 와 Axiom 은 서로를 기다리지 않는다 — 한쪽이 멈춰도 다른 쪽은 간다. 둘 다 안에서 오류를 삼키므로 reject 하지 않는다
    const parts: Promise<void>[] = [];
    if (kv) parts.push(countKv(kv, event, day, ai));
    if (apiKey && dataset) {
      // Axiom 은 _time 을 UTC 로 저장한다 — 일자 집계가 KV 키와 같도록 KST 일자를 따로 싣는다.
      // meta 는 허용 표로 거른 뒤 먼저 펼친다 — 서버가 정하는 값(_time · kst_day · event · client_class · is_ai_agent)을 meta 가 덮어쓰지 못한다
      parts.push(sendAxiom(fetchFn, apiKey, dataset, [{ ...allowedMeta(event, meta), _time: time, kst_day: day, event, client_class: clientClass, is_ai_agent: ai }]));
    }
    await Promise.allSettled(parts);
  } catch (e) {
    console.error('텔레메트리 실패:', e);
  }
}
