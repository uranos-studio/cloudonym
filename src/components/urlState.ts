// URL hash ↔ NamingContext — 화면 상태의 저장소는 URL 뿐이다 (L3 · D17). 깨진 hash 는 undefined 로 돌려주고 화면은 기본값으로 간다 (Review Focus 4)
import { parseContext } from '../core/engine';
import type { NamingContext, RawContext } from '../core/types';

export const HASH_KEY = 'state';
/** 필드 하나의 상한 — API 의 MAX_FIELD_CHARS(src/api/schemas.ts)와 같다. 화면은 api 를 들여오지 않으므로 값을 두고 시험이 둘을 대어 본다 (보안 리뷰 L-5) */
export const MAX_FIELD_CHARS = 1024;
/** hash 전체 상한 — 정상 공유 URL 은 수백 자다. 넘으면 디코딩하지 않는다 (매우 긴 링크가 여는 사람의 탭을 느리게 하지 않게) */
export const MAX_HASH_CHARS = 4096;

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

/** 다섯 필드만 고정 순서로 담는다 — 같은 문맥이면 같은 문자열 */
export function encodeState(ctx: NamingContext): string {
  const json = JSON.stringify({ owner: ctx.owner, system: ctx.system, purpose: ctx.purpose, env: ctx.env, region: ctx.region });
  return toBase64Url(new TextEncoder().encode(json));
}

/** `#state=…` · `state=…` 를 받는다. 길이 상한 · 디코딩 · JSON · 모양 · parseContext 중 하나라도 실패하면 undefined */
export function decodeState(hash: string): NamingContext | undefined {
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
  return parsed.ok ? parsed.context : undefined;
}

/** 공유 URL — base 는 `location.origin + location.pathname` (도메인을 코드에 박지 않는다) */
export function shareUrl(ctx: NamingContext, base: string): string {
  return `${base}#${HASH_KEY}=${encodeState(ctx)}`;
}
