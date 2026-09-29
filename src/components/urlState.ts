// URL hash ↔ NamingContext — 화면 상태의 저장소는 URL 뿐이다 (L3 · D17). 깨진 hash 는 undefined 로 돌려주고 화면은 기본값으로 간다 (Review Focus 4)
import { parseContext } from '../core/engine';
import type { NamingContext, RawContext } from '../core/types';

export const HASH_KEY = 'state';
/** 필드 하나의 상한 — API 의 MAX_FIELD_CHARS(src/api/schemas.ts)와 같다. 화면은 api 를 들여오지 않으므로 값을 두고 시험이 둘을 대어 본다 (보안 리뷰 L-5) */
export const MAX_FIELD_CHARS = 1024;
/** JSON 이 UTF-16 코드 유닛 하나를 적는 최대 바이트 — 제어 문자 · 짝 없는 서로게이트는 `\uXXXX` 6바이트다 (한글 3 · 보조 평면 2단위에 4) */
const MAX_JSON_BYTES_PER_UNIT = 6;
/** 규칙 버전 꼴 `YYYY-MM-DD.N` (D26) — 이 꼴이 아닌 `v` 는 없는 것으로 본다 */
const RULES_VERSION_RE = /^\d{4}-\d{2}-\d{2}\.\d+$/;
/** 뼈대의 `v` 자리 — N 두 자리(`YYYY-MM-DD.NN` 13자)로 잡는다. 지금 규칙 버전의 길이를 쓰지 않는다 — 상한이 규칙 버전에 따라 움직이면 안 된다 */
const V_PLACEHOLDER = '0000-00-00.00';
/** 다섯 필드 중 자유 입력 셋(owner · system · purpose)이 모두 상한일 때의 JSON 바이트 — 뼈대는 env `prd` · region `global`(가장 긴 정규 값) · `v` 13자 기준 */
const MAX_JSON_BYTES = JSON.stringify({ owner: '', system: '', purpose: '', env: 'prd', region: 'global', v: V_PLACEHOLDER }).length
  + 3 * MAX_FIELD_CHARS * MAX_JSON_BYTES_PER_UNIT;
/** hash 전체 상한 — 화면 · API 가 받는 모든 입력(필드당 1024자 · 아무 유니코드)이 왕복하도록 최악 JSON 의
 *  표준 Base64(패딩 포함) 길이에 `#state=` 를 더한 값(24699 — urlState.test 가 잰다). 넘으면 디코딩하지 않는다 (매우 긴 링크가 여는 사람의 탭을 느리게 하지 않게 · codex P2) */
export const MAX_HASH_CHARS = `#${HASH_KEY}=`.length + Math.ceil(MAX_JSON_BYTES / 3) * 4;

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Base64url 과 표준 Base64(① 예시 `eyJ…`) 둘 다 받는다 — 패딩은 보정한다 */
function fromBase64Url(text: string): Uint8Array | undefined {
  const std = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = std + '='.repeat((4 - (std.length % 4)) % 4);
  try {
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  } catch {
    return undefined;
  }
}

/** 다섯 필드를 고정 순서로 담고, 규칙 버전 `v` 가 있으면 마지막 키로 붙인다 — 같은 문맥 · 같은 버전이면 같은 문자열 */
export function encodeState(ctx: NamingContext, rulesVersion?: string): string {
  const base = { owner: ctx.owner, system: ctx.system, purpose: ctx.purpose, env: ctx.env, region: ctx.region };
  const json = JSON.stringify(rulesVersion === undefined ? base : { ...base, v: rulesVersion });
  return toBase64Url(new TextEncoder().encode(json));
}

/** hash 를 푼 결과 — 문맥과, 링크를 만든 규칙 버전(꼴이 맞을 때만) */
export interface DecodedState {
  context: NamingContext;
  rulesVersion?: string;
}

/** `#state=…` · `state=…` 를 받는다. 길이 상한 · 디코딩 · JSON · 모양 · parseContext 중 하나라도 실패하면 undefined.
 *  `v` 는 parseContext 가 읽지 않는다 — 꼴이 `YYYY-MM-DD.N` 일 때만 rulesVersion 으로 돌려주고, 아니면 없는 것으로 본다 */
export function decodeState(hash: string): DecodedState | undefined {
  if (hash.length > MAX_HASH_CHARS) return undefined;
  const m = new RegExp(`^#?${HASH_KEY}=(.*)$`).exec(hash);
  if (!m) return undefined;
  const bytes = fromBase64Url(m[1] ?? '');
  if (!bytes) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  if (Object.values(raw).some((v) => typeof v === 'string' && v.length > MAX_FIELD_CHARS)) return undefined;
  const parsed = parseContext(raw as RawContext);
  if (!parsed.ok) return undefined;
  const v = (raw as Record<string, unknown>).v;
  return typeof v === 'string' && RULES_VERSION_RE.test(v) ? { context: parsed.context, rulesVersion: v } : { context: parsed.context };
}

/** 공유 URL — base 는 `location.origin + location.pathname` (도메인을 코드에 박지 않는다). 화면은 지금 규칙 버전을 넘긴다 (D27 ⑵) */
export function shareUrl(ctx: NamingContext, base: string, rulesVersion?: string): string {
  return `${base}#${HASH_KEY}=${encodeState(ctx, rulesVersion)}`;
}
