// 텔레메트리 — Axiom 이벤트 + KV 일자 카운터 (D16 · D17 · D56 · D99). 반드시 c.executionCtx.waitUntil() 안에서 부른다. 오류는 삼킨다
import type { Bindings } from './env';
import { RULES } from '../core/constraints';
import { ENABLED_PROVIDERS } from '../core/types';

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
/** 앞머리에 도구 이름이 오고 바로 / 또는 끝 — 「my curl/8」 · 「nodejs-x」 는 cli 가 아니다. cloudonym-cli 는 저장소의 CLI 다 (D102) */
const CLI_UA = /^(?:cloudonym-cli|curl|wget|python-requests|go-http-client|node)(?:\/|$)/i;
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
  ui_visit: ['src', 'cloud'], ui_generate: ['chip_rules', 'custom_rules', 'src'], ui_copy: ['target', 'src'],
  api_generate: ['providers'], api_names: ['provider', 'resource_count', 'name_count', 'valid'], api_validate: ['provider', 'resource_type', 'valid'],
  api_wizard: ['provider', 'service_count', 'resource_count', 'name_count', 'valid', 'chip_rules', 'custom_rules'],
  llms_txt_accessed: [], catalog_json_accessed: [],
};

/** 고른 규칙 id 칸 (D71) — 화면이 보낸 값은 믿지 않는다. 엔진의 규칙 표에 있는 id 만 남긴다 */
const RULE_ID_KEYS: ReadonlySet<string> = new Set(['chip_rules', 'custom_rules']);
/** 한 칸의 배열 길이 상한 — 규칙 수. 중복 없는 정상 값은 이것을 넘을 수 없다 */
export const MAX_RULE_IDS = Object.keys(RULES).length;
/** 배열이 아니거나 · 문자열 아닌 원소가 있거나 · 상한을 넘으면 undefined(칸째 버린다). 아니면 알려진 id 만 · 중복 없이 · 정렬해 돌려준다 */
export function ruleIdList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_RULE_IDS) return undefined;
  if (!value.every((v): v is string => typeof v === 'string')) return undefined;
  return [...new Set(value.filter((id) => Object.hasOwn(RULES, id)))].sort();
}

/** 캠페인 출처 (D122) — 화면 쪽 campaign.ts 의 CAMPAIGN_SRC_PATTERN 과 같다(campaign-src.test). 화면 값을 믿지 않고 여기서 다시 거른다 */
export const CAMPAIGN_SRC_RE = /^[a-z0-9-]{1,32}$/;
/** 맞으면 그 값, 아니면 undefined(칸째 버린다) */
export function campaignSrc(value: unknown): string | undefined {
  return typeof value === 'string' && CAMPAIGN_SRC_RE.test(value) ? value : undefined;
}

/** 마법사 경로의 클라우드 (D130) — ui_visit 이 싣는다. 켜진 CSP id(ENABLED_PROVIDERS)일 때만 그 값, 아니면 undefined(칸째 버린다) */
export function visitCloud(value: unknown): string | undefined {
  return typeof value === 'string' && (ENABLED_PROVIDERS as readonly string[]).includes(value) ? value : undefined;
}

function allowedMeta(event: string, meta: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.hasOwn(META_KEYS, event) ? META_KEYS[event]! : [];
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (!Object.hasOwn(meta, k)) continue;
    if (k === 'src') { const src = campaignSrc(meta[k]); if (src !== undefined) out[k] = src; continue; }
    if (k === 'cloud') { const cloud = visitCloud(meta[k]); if (cloud !== undefined) out[k] = cloud; continue; }
    if (!RULE_ID_KEYS.has(k)) { out[k] = meta[k]; continue; }
    const ids = ruleIdList(meta[k]);
    if (ids !== undefined) out[k] = ids;
  }
  return out;
}

/** KV 일자 카운터의 수명 — 366일 뒤 Cloudflare 가 지운다 (D56 · /privacy 의 보존 기간) */
export const KV_TTL_SECONDS = 366 * 86400;

/** KST 는 UTC+9 고정이다 — Asia/Seoul 의 일광 절약 시간은 1988년이 마지막이다. 9시간을 더한 시각을 UTC 필드로 읽으면 KST 의 연 · 월 · 일 · 시 · 분 · 초다.
 *  Intl.DateTimeFormat 을 쓰지 않는다 — 모듈에서 만들면 ICU 지역 · 시간대 자료를 읽느라 isolate 기동 CPU 가 약 10 ms 늘었다(CPU 조사 2026-10-24).
 *  값이 Intl(Asia/Seoul) 과 같은지는 telemetry.test 가 대어 본다. 잘못된 시각은 Intl 처럼 RangeError 를 던진다 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const two = (n: number): string => String(n).padStart(2, '0');
function kstParts(d: Date): Intl.DateTimeFormatPart[] {
  const t = d.getTime();
  if (!Number.isFinite(t)) throw new RangeError('Invalid time value');
  const k = new Date(t + KST_OFFSET_MS);
  return [
    { type: 'year', value: String(k.getUTCFullYear()).padStart(4, '0') }, { type: 'month', value: two(k.getUTCMonth() + 1) }, { type: 'day', value: two(k.getUTCDate()) },
    { type: 'hour', value: two(k.getUTCHours()) }, { type: 'minute', value: two(k.getUTCMinutes()) }, { type: 'second', value: two(k.getUTCSeconds()) },
  ];
}

/** KST 일자 키와 +09:00 타임스탬프 — formatToParts 꼴의 부분값으로 조립한다 (시험이 부분이 빠진 결과를 주입한다).
 *  부분이 하나라도 없으면 던진다 — 빈값으로 「--T::」 를 만들어 보내지 않는다. 잘못된 시각은 kstParts 가 RangeError 를 던진다 */
export function kstStamp(now: Date, formatParts: FormatParts = kstParts): { day: string; time: string } {
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
 *  정확한 집계는 이벤트마다 한 줄인 Axiom 이 기준이고, KV 는 1년치 추세다 (D99)
 *  값이 숫자가 아니면 0 에서 다시 센다 — 'NaN' 을 저장하면 그날 카운터가 죽는다 */
async function bump(kv: KVNamespace, key: string): Promise<void> {
  const n = Number.parseInt((await kv.get(key)) ?? '0', 10);
  const current = Number.isFinite(n) ? n : 0;
  await kv.put(key, String(current + 1), { expirationTtl: KV_TTL_SECONDS });
}

async function countKv(kv: KVNamespace, event: string, day: string, ai: boolean, src: string | undefined, cloud: string | undefined): Promise<void> {
  try {
    await bump(kv, `stats:${event}:${day}`);
    // 캠페인 출처별 카운터 (D122) — 허용 표에 src 가 있는 이벤트이고 값이 정규식에 맞을 때만
    if (src !== undefined) await bump(kv, `stats:${event}:src:${src}:${day}`);
    // 클라우드별 카운터 (D130) — 허용 표에 cloud 가 있는 이벤트(ui_visit)이고 켜진 CSP id 일 때만
    if (cloud !== undefined) await bump(kv, `stats:${event}:cloud:${cloud}:${day}`);
    if (ai) await bump(kv, `stats:ai_agent_hits:${day}`);
  } catch (e) {
    console.error('KV 카운터 실패:', e);
  }
}

/** 운영자 점검 요청(scripts/release-check.sh)이 싣는 헤더 (D99) — 값이 비밀 TELEMETRY_SKIP_TOKEN 과 같으면 KV · Axiom 어디에도 쓰지 않는다 */
export const TELEMETRY_SKIP_HEADER = 'x-cloudonym-telemetry-skip';

/** 상수 시간 비교 — 앞에서 다른 글자가 나와도 끝까지 본다. 길이가 다르면 짧은 쪽을 0 으로 채워 긴 쪽 길이만큼 돌고 길이 차이를 결과에 섞는다.
 *  crypto.subtle.timingSafeEqual 은 workerd 에만 있고 시험이 도는 Node 에는 없어 직접 쓴다. 길이는 감추지 않는다(비밀의 길이는 비밀이 아니다) */
export function constantTimeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  const n = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** 비밀이 설정돼 있고 헤더 값이 그것과 같을 때만 true. 비밀이 없거나 빈 값이면 헤더가 있어도 센다 — 설정 누락으로 계측이 꺼지지 않게 */
function isSkipped(c: TelemetrySource): boolean {
  // 앞뒤 공백은 뗀다 — 헤더 값은 fetch 가 이미 다듬어 오므로 비밀 쪽 끝의 개행 하나로 영영 맞지 않는 일을 막는다
  const secret = c.env.TELEMETRY_SKIP_TOKEN?.trim();
  if (!secret) return false;
  const value = c.req.header(TELEMETRY_SKIP_HEADER);
  return value !== undefined && constantTimeEqual(value, secret);
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
    // 점검 요청은 아무것도 쓰지 않는다 (D99). 요청 제한 · 응답은 이 함수 밖이라 영향이 없다
    if (isSkipped(c)) return;
    const now = deps.now ?? new Date();
    const fetchFn: FetchLike = deps.fetchFn ?? ((url, init) => fetch(url, init));
    const clientClass = classifyClient(c.req.header('user-agent'));
    const ai = clientClass === 'ai_agent';
    const { day, time } = kstStamp(now, deps.formatParts);
    const { CLOUDONYM_KV: kv, AXIOM_API_KEY: apiKey, AXIOM_DATASET: dataset } = c.env;

    // KV 와 Axiom 은 서로를 기다리지 않는다 — 한쪽이 멈춰도 다른 쪽은 간다. 둘 다 안에서 오류를 삼키므로 reject 하지 않는다
    const parts: Promise<void>[] = [];
    const src = Object.hasOwn(META_KEYS, event) && META_KEYS[event]!.includes('src') ? campaignSrc(meta.src) : undefined;
    const cloud = Object.hasOwn(META_KEYS, event) && META_KEYS[event]!.includes('cloud') ? visitCloud(meta.cloud) : undefined;
    if (kv) parts.push(countKv(kv, event, day, ai, src, cloud));
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
