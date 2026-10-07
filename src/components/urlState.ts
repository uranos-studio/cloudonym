// URL hash ↔ 화면 상태(문맥 다섯 값 · 규칙 버전 v · CSP p · 선택 r) — 화면 상태의 저장소는 URL 뿐이다 (D17 · D42).
// 깨진 hash 는 undefined 로 돌려주고 화면은 기본값으로 간다. 선택은 걸린 항목만 버리고 몇 개 버렸는지 돌려준다
import { DEFAULT_ROLE, MAX_CONTEXT_CHARS, parseContext } from '../core/engine';
import { MAX_ITEMS, validateSelection, type SelectionItem } from '../core/selection';
import { inputKind } from '../core/tree';
import { ENABLED_PROVIDERS, PROVIDERS, type NamingContext, type Provider, type RawContext, type ResourceRule } from '../core/types';

export const HASH_KEY = 'state';
/** env · region 등 자유 입력이 아닌 필드의 상한 — API 의 MAX_FIELD_CHARS(src/api/schemas.ts)와 같다. 화면은 api 를 들여오지 않으므로 값을 두고 시험이 둘을 대어 본다.
 *  자유 입력 셋(owner · system · purpose)의 상한은 core 의 MAX_CONTEXT_CHARS 다 */
export const MAX_FIELD_CHARS = 1024;
const FREE_FIELDS = ['owner', 'system', 'purpose'] as const;
/** JSON 이 UTF-16 코드 유닛 하나를 적는 최대 바이트 — 제어 문자 · 짝 없는 서로게이트는 `\uXXXX` 6바이트다 (한글 3 · 보조 평면 2단위에 4) */
const MAX_JSON_BYTES_PER_UNIT = 6;
/** 규칙 버전 꼴 `YYYY-MM-DD.N` (D26) — 이 꼴이 아닌 `v` 는 없는 것으로 본다. N 은 1~2자리 — 아래 V_PLACEHOLDER 가 13자를 잡아 두므로 그보다 긴 `v` 는 받지 않는다 */
const RULES_VERSION_RE = /^\d{4}-\d{2}-\d{2}\.\d{1,2}$/;
/** 뼈대의 `v` 자리 — N 두 자리(`YYYY-MM-DD.NN` 13자)로 잡는다. 지금 규칙 버전의 길이를 쓰지 않는다 — 상한이 규칙 버전에 따라 움직이면 안 된다 */
const V_PLACEHOLDER = '0000-00-00.00';
/** 상한식이 기대는 두 수 — 규칙 표의 resourceType 길이(urlState.test 「상수 둘은 core 의 판정과 맞다」가 세 CSP 규칙 전부를 센다) · 역할 꼴(ROLE_PATTERN 의 16). 규칙이 늘어도 상한은 움직이지 않는다 (D42) */
export const MAX_RESOURCE_TYPE_CHARS = 40;
export const MAX_ROLE_CHARS = 16;
/** r 의 항목 하나 최악 — 수(`"<40>":99,` 47 바이트)와 역할(`"<40>":"<16>",` 62 바이트) 중 큰 쪽. 값이 배타라 한 type 은 한 번만 나온다 */
const MAX_ITEM_JSON_BYTES = Math.max(`"${'t'.repeat(MAX_RESOURCE_TYPE_CHARS)}":99,`.length, `"${'t'.repeat(MAX_RESOURCE_TYPE_CHARS)}":"${'r'.repeat(MAX_ROLE_CHARS)}",`.length);
/** 최악 JSON 바이트 — 뼈대(env `prod`(가장 긴 표준값 4자) · region `global` · `v` 13자 · p `azure`(가장 긴 provider) · 빈 r) + 자유 입력 셋이 모두 상한 + 항목 200개(마지막 항목은 쉼표가 없다) */
const MAX_JSON_BYTES = JSON.stringify({ owner: '', system: '', purpose: '', env: 'prod', region: 'global', v: V_PLACEHOLDER, p: 'azure', r: {} }).length
  + FREE_FIELDS.length * MAX_CONTEXT_CHARS * MAX_JSON_BYTES_PER_UNIT
  + MAX_ITEMS * MAX_ITEM_JSON_BYTES - 1;
/** hash 전체 상한 — 화면 · API 가 받는 모든 입력(자유 입력 셋 각 MAX_CONTEXT_CHARS 자 · 아무 유니코드)과 최대 선택이 왕복하도록 최악 JSON 의
 *  표준 Base64(패딩 포함) 길이에 `#state=` 를 더한 값(18219 — urlState.test 가 잰다). 넘으면 디코딩하지 않는다 (매우 긴 링크가 여는 사람의 탭을 느리게 하지 않게) */
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

/** 화면의 ①·③ 상태 — CSP 하나와 그 선택(validateSelection 을 거친 항목) */
export interface PickState {
  provider?: Provider;
  selection?: readonly SelectionItem[];
}

/** r 의 값 — 항목마다 하나(배타 · D42): count 규칙은 수, role 규칙은 역할 문자열(기본 역할도 적는다), 입력 없는 규칙은 1 */
function itemValue(item: SelectionItem): number | string {
  const kind = inputKind(item.rule);
  if (kind === 'count') return item.count;
  if (kind === 'role') return item.role ?? DEFAULT_ROLE;
  return 1;
}

/** 다섯 필드를 고정 순서로 담고, 규칙 버전 `v` · CSP `p` · 선택 `r` 을 이 순서로 붙인다 — 같은 상태면 같은 문자열.
 *  p 가 없으면 p · r 을 모두 빼고, 선택이 비면 r 을 뺀다 — 옛 링크(다섯 키 · v)와 같은 문자열이 나와 링크 상태가 유지된다 */
export function encodeState(ctx: NamingContext, rulesVersion?: string, pick: PickState = {}): string {
  const body: Record<string, unknown> = { owner: ctx.owner, system: ctx.system, purpose: ctx.purpose, env: ctx.env, region: ctx.region };
  if (rulesVersion !== undefined) body.v = rulesVersion;
  if (pick.provider !== undefined) {
    body.p = pick.provider;
    if (pick.selection && pick.selection.length > 0) body.r = Object.fromEntries(pick.selection.map((i) => [i.rule.resourceType, itemValue(i)]));
  }
  return toBase64Url(new TextEncoder().encode(JSON.stringify(body)));
}

/** hash 를 푼 결과 — 문맥과, 링크를 만든 규칙 버전(꼴이 맞을 때만) · CSP · 선택 · 버린 선택 수(있을 때만) ·
 *  링크의 CSP 가 아직 꺼져 있었으면 그 CSP(unavailable — 화면이 안내 한 줄을 띄운다 · D55) */
export interface DecodedState {
  context: NamingContext;
  rulesVersion?: string;
  provider?: Provider;
  selection?: SelectionItem[];
  dropped?: number;
  unavailable?: Provider;
}

const isProvider = (v: unknown): v is Provider => typeof v === 'string' && (PROVIDERS as readonly string[]).includes(v);

/** r → 선택. 걸린 항목만 버린다: 값 꼴(수 · 문자열 밖) → 201번째부터 → validateSelection 의 index 달린 오류(모르는 type ·
 *  종류에 안 맞는 값 · 범위 밖 · 역할 꼴) → role 규칙에 수(기본 역할로 읽지 않는다) → Σ count 상한은 끝에서부터. 판정은 core 하나다 (D40) */
function decodeSelection(provider: Provider, r: unknown, rules?: readonly ResourceRule[]): { items: SelectionItem[]; dropped: number } {
  if (r === null || typeof r !== 'object' || Array.isArray(r)) return { items: [], dropped: 1 };
  let dropped = 0;
  let raw: Array<{ type: string; count?: number; role?: string }> = [];
  for (const [type, v] of Object.entries(r)) {
    if (typeof v === 'number') raw.push({ type, count: v });
    else if (typeof v === 'string') raw.push({ type, role: v });
    else dropped++;
  }
  if (raw.length > MAX_ITEMS) {
    dropped += raw.length - MAX_ITEMS;
    raw = raw.slice(0, MAX_ITEMS);
  }
  while (raw.length > 0) {
    const res = validateSelection(provider, raw, rules);
    if (res.ok) {
      const numericRole = new Set(res.items.flatMap((it, i) => (inputKind(it.rule) === 'role' && raw[i]?.count !== undefined ? [i] : [])));
      if (numericRole.size === 0) return { items: res.items, dropped };
      dropped += numericRole.size;
      raw = raw.filter((_, i) => !numericRole.has(i));
      continue;
    }
    const bad = new Set(res.errors.flatMap((e) => ('params' in e && e.params && typeof (e.params as { index?: unknown }).index === 'number' ? [(e.params as { index: number }).index] : [])));
    if (bad.size > 0) {
      dropped += bad.size;
      raw = raw.filter((_, i) => !bad.has(i));
    } else if (res.errors.some((e) => e.code === 'selection.too_many_names')) {
      dropped++;
      raw = raw.slice(0, -1);
    } else {
      dropped += raw.length;
      raw = [];
    }
  }
  return { items: [], dropped };
}

/** r 의 항목 수 — 통째로 버릴 때 센다. 객체가 아니면 한 건 */
const entryCount = (r: unknown): number => (r !== null && typeof r === 'object' && !Array.isArray(r) ? Object.keys(r).length : 1);

/** `#state=…` · `state=…` 를 받는다. 길이 상한 · 디코딩 · JSON · 모양 · parseContext 중 하나라도 실패하면 undefined.
 *  `v` 는 parseContext 가 읽지 않는다 — 꼴이 `YYYY-MM-DD.N` 일 때만 rulesVersion 으로 돌려주고, 아니면 없는 것으로 본다.
 *  `p` 가 셋 밖이면 없는 것으로 보고 `r` 은 판정할 수 없어 버린다. rules 는 기본이 규칙 표(시험 전용 fixture 가 다른 표를 넘긴다).
 *  enabled — 켜진 CSP (D45). `p` 가 꺼진 CSP 면(D55) 선택을 전부 버리고 unavailable 에 그 CSP 를 싣는다. 지역 칸은 건드리지 않는다.
 *  `p` 가 없거나 꺼진 CSP 이고 켜진 CSP 가 하나면 그것으로 푼다 — 화면이 그것을 자동으로 고르는 것과 같다 */
export function decodeState(hash: string, rules?: readonly ResourceRule[], enabled: readonly Provider[] = ENABLED_PROVIDERS): DecodedState | undefined {
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
  if (FREE_FIELDS.some((f) => { const v = (raw as Record<string, unknown>)[f]; return typeof v === 'string' && v.length > MAX_CONTEXT_CHARS; })) return undefined;
  const parsed = parseContext(raw as RawContext);
  if (!parsed.ok) return undefined;
  const { v, p, r } = raw as Record<string, unknown>;
  const out: DecodedState = typeof v === 'string' && RULES_VERSION_RE.test(v) ? { context: parsed.context, rulesVersion: v } : { context: parsed.context };
  if (isProvider(p) && enabled.includes(p)) {
    out.provider = p;
    if (r !== undefined) {
      const { items, dropped } = decodeSelection(p, r, rules);
      if (items.length > 0) out.selection = items;
      if (dropped > 0) out.dropped = dropped;
    }
    return out;
  }
  // 고를 CSP 가 정해지지 않은 링크 — 켜진 것이 하나면 그것. 선택은 규칙 id 가 CSP 에 묶여 있어 옮기지 않는다
  const only = enabled.length === 1 ? enabled[0] : undefined;
  if (only !== undefined) out.provider = only;
  if (r !== undefined) {
    const n = entryCount(r);
    if (n > 0) out.dropped = n;
  }
  if (isProvider(p)) out.unavailable = p;
  return out;
}

/** 공유 URL — base 는 `location.origin + location.pathname` (도메인을 코드에 박지 않는다). 화면은 지금 규칙 버전을 넘긴다 (D27 ⑵) */
export function shareUrl(ctx: NamingContext, base: string, rulesVersion?: string, pick: PickState = {}): string {
  return `${base}#${HASH_KEY}=${encodeState(ctx, rulesVersion, pick)}`;
}
