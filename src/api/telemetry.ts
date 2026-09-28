// 텔레메트리 — Axiom 이벤트 + KV 일자 카운터 (D16 · D17). 반드시 c.executionCtx.waitUntil() 안에서 부른다. 오류는 삼킨다
import type { Bindings } from './env';

/** Hono Context 가 이 모양을 만족한다 — 시험은 평범한 객체를 넣는다 */
export interface TelemetrySource { env: Bindings; req: { header: (name: string) => string | undefined } }
/** fetch 응답에서 쓰는 부분만 — 전역 Response 가 이것을 만족한다. fetch 는 HTTP 오류에 reject 하지 않으므로 ok · status 를 직접 본다 (challenge M-2) */
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
 *  값이 숫자가 아니면 0 에서 다시 센다 — 'NaN' 을 저장하면 그날 카운터가 죽는다 (challenge L-2) */
async function bump(kv: KVNamespace, key: string): Promise<void> {
  const n = Number.parseInt((await kv.get(key)) ?? '0', 10);
  const current = Number.isFinite(n) ? n : 0;
  await kv.put(key, String(current + 1));
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
  // 몸통 전체를 try 로 감싼다 — waitUntil 로 넘긴 Promise 가 reject 하지 않는다 (최종 리뷰 M-3)
  try {
    const now = deps.now ?? new Date();
    const fetchFn: FetchLike = deps.fetchFn ?? ((url, init) => fetch(url, init));
    const userAgent = c.req.header('user-agent') ?? 'unknown';
    const ai = isAiAgent(userAgent);
    const { day, time } = kstStamp(now, deps.formatParts);
    const { CLOUDONYM_KV: kv, AXIOM_API_KEY: apiKey, AXIOM_DATASET: dataset } = c.env;

    // KV 와 Axiom 은 서로를 기다리지 않는다 — 한쪽이 멈춰도 다른 쪽은 간다 (challenge L-3). 둘 다 안에서 오류를 삼키므로 reject 하지 않는다
    const parts: Promise<void>[] = [];
    if (kv) parts.push(countKv(kv, event, day, ai));
    if (apiKey && dataset) {
      // Axiom 은 _time 을 UTC 로 저장한다 — 일자 집계가 KV 키와 같도록 KST 일자를 따로 싣는다 (challenge M-3).
      // meta 를 먼저 펼친다 — 서버가 정하는 값(_time · kst_day · event · user_agent · is_ai_agent)을 meta 가 덮어쓰지 못한다
      parts.push(sendAxiom(fetchFn, apiKey, dataset, [{ ...meta, _time: time, kst_day: day, event, user_agent: userAgent, is_ai_agent: ai }]));
    }
    await Promise.allSettled(parts);
  } catch (e) {
    console.error('텔레메트리 실패:', e);
  }
}
