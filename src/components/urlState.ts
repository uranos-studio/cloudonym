// URL hash ↔ 화면 상태(문맥 다섯 값 · 규칙 버전 v · CSP p · 선택 r) — 화면 상태의 저장소는 URL 뿐이다 (D17 · D42).
// 깨진 hash 는 undefined 로 돌려주고 화면은 기본값으로 간다. 선택은 걸린 항목만 버리고 몇 개 버렸는지 돌려준다
import { DEFAULT_ROLE, ENV_VALUES, MAX_CONTEXT_CHARS, parseContext, parseProjectContext } from '../core/engine';
import { MAX_ITEMS, MAX_NAMES, validateSelection, type Attachments, type SelectionItem } from '../core/selection';
import { MAX_PICKS_PER_SERVICE, MAX_SERVICES, MAX_SLOT_ID_CHARS, checkProjectIdSuffix, validatePlan, type Pick as WizardPick, type PlanError, type WizardPlan } from '../core/wizard/plan';
import { PRESETS, presetOf } from '../core/wizard/presets';
import { inputKind } from '../core/tree';
import { MAX_REGION_CHARS, REGIONAL_LOCATION, canonicalLocation } from '../core/regions';
import { MAX_KIND_VALUE_CHARS, rowOf } from '../core/catalog';
import { ENABLED_PROVIDERS, PROVIDERS, type Env, type NamingContext, type Provider, type RawContext, type ResourceRule } from '../core/types';
import { EXAMPLE_REGIONS } from './formContext';
import { envList, envsFromHash } from './wizardEnvs';

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
/** r 의 항목 하나 최악 — 수(`"<40>":99,` 47 바이트) · 역할(`"<40>":"<16>",` 62 바이트) · 종류(`"<40>":"99:<27>",` 76 바이트 — MAX_KIND_VALUE_CHARS) 중 큰 쪽.
 *  값이 배타라 한 type 은 한 번만 나온다. Σ count 200 이라 200 항목이 모두 99 일 수는 없다 — 식은 넉넉한 쪽이다 (D55) */
const MAX_ITEM_JSON_BYTES = Math.max(
  `"${'t'.repeat(MAX_RESOURCE_TYPE_CHARS)}":99,`.length,
  `"${'t'.repeat(MAX_RESOURCE_TYPE_CHARS)}":"${'r'.repeat(MAX_ROLE_CHARS)}",`.length,
  `"${'t'.repeat(MAX_RESOURCE_TYPE_CHARS)}":"99:${'k'.repeat(MAX_KIND_VALUE_CHARS)}",`.length,
);
/** 최악 JSON 바이트 — 뼈대(env `prod`(가장 긴 표준값 4자) · region 은 가장 긴 지역 코드(MAX_REGION_CHARS — 존 코드 ause1a · global 이 6자) · `v` 13자 · p `azure`(가장 긴 provider) · 빈 r) + 자유 입력 셋이 모두 상한 + 항목 200개(마지막 항목은 쉼표가 없다) */
const MAX_JSON_BYTES = JSON.stringify({ owner: '', system: '', purpose: '', env: 'prod', region: 'r'.repeat(MAX_REGION_CHARS), v: V_PLACEHOLDER, p: 'azure', r: {} }).length
  + FREE_FIELDS.length * MAX_CONTEXT_CHARS * MAX_JSON_BYTES_PER_UNIT
  + MAX_ITEMS * MAX_ITEM_JSON_BYTES - 1;
/** hash 전체 상한 — 화면 · API 가 받는 모든 입력(자유 입력 셋 각 MAX_CONTEXT_CHARS 자 · 아무 유니코드)과 최대 선택이 왕복하도록 최악 JSON 의
 *  표준 Base64(패딩 포함) 길이에 `#state=` 를 더한 값(urlState.test 가 잰다). 넘으면 디코딩하지 않는다 (매우 긴 링크가 여는 사람의 탭을 느리게 하지 않게) */
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

/** r 의 값 — 항목마다 하나(배타 · D42 · D55): count 규칙은 수 또는 `"n:값이름"`, role 규칙은 역할 문자열(기본 역할도 적는다), 입력 없는 규칙은 1 또는 `"1:값이름"`.
 *  역할 꼴(ROLE_PATTERN)에는 `:` 가 없어 문자열 값의 뜻이 하나로 정해진다 */
function itemValue(item: SelectionItem): number | string {
  const input = inputKind(item.rule);
  if (input === 'role') return item.role ?? DEFAULT_ROLE;
  const n = input === 'count' ? item.count : 1;
  return item.kind === undefined ? n : `${n}:${item.kind}`;
}

/** `"n:값이름"` — n 은 1~99, 값 이름은 영숫자 · 밑줄 · 붙임표(`POSTGRES` · `snapshot-schedule`) MAX_KIND_VALUE_CHARS 자까지. 값이 그 규칙에 맞는지는 validateSelection 이 본다 */
const KIND_VALUE_RE = new RegExp(`^([1-9]\\d?):([A-Za-z0-9_-]{1,${MAX_KIND_VALUE_CHARS}})$`);

/** 다섯 필드를 고정 순서로 담고(region 은 리전 코드 — 존은 싣지 않는다 · D50 revised · D55), 규칙 버전 `v` · CSP `p` · 선택 `r` 을 이 순서로 붙인다 — 같은 상태면 같은 문자열.
 *  p 가 없으면 p · r 을 모두 빼고, 선택이 비면 r 을 뺀다 — 다섯 키 · v 만 든 링크와 같은 문자열이 나와 링크 상태가 유지된다 */
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
 *  종류에 안 맞는 값 · 범위 밖 · 역할 꼴 · 종류 값(허용 밖 · 종류 표 없음 · 필수인데 없음)) → role 규칙에 수(기본 역할로 읽지 않는다) · 같은 catalog 행의 둘째 키(D53) → Σ count 상한은 끝에서부터. 판정은 core 하나다 (D40 · D52).
 *  문자열은 `"n:값이름"` 꼴이면 수와 종류, 아니면 역할로 읽는다 — `"2:"` · `":POSTGRES"` 는 역할 꼴에도 맞지 않아 버려진다 */
function decodeSelection(provider: Provider, r: unknown, rules?: readonly ResourceRule[]): { items: SelectionItem[]; dropped: number } {
  if (r === null || typeof r !== 'object' || Array.isArray(r)) return { items: [], dropped: 1 };
  let dropped = 0;
  let raw: Array<{ type: string; count?: number; role?: string; kind?: string }> = [];
  for (const [type, v] of Object.entries(r)) {
    const m = typeof v === 'string' ? KIND_VALUE_RE.exec(v) : null;
    if (typeof v === 'number') raw.push({ type, count: v });
    else if (m) raw.push({ type, count: Number(m[1]), kind: m[2] });
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
      // 화면 · hash 는 행마다 규칙 하나다 (D53) — 같은 catalog 행의 키가 둘 이상이면 catalog 규칙 순서의 첫 것만 남긴다
      const sameRow = sameRowExtras(res.items);
      if (numericRole.size === 0 && sameRow.size === 0) return { items: res.items, dropped };
      const drop = new Set([...numericRole, ...sameRow]);
      dropped += drop.size;
      raw = raw.filter((_, i) => !drop.has(i));
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

/** 같은 catalog 행의 항목 중 catalog 규칙 순서가 첫째가 아닌 것의 index (hash 의 키 순서와 무관하다) */
function sameRowExtras(items: readonly SelectionItem[]): Set<number> {
  const best = new Map<string, { i: number; order: number }>();
  const extras = new Set<number>();
  items.forEach((it, i) => {
    const row = rowOf(it.rule.id);
    if (!row) return;
    const order = Object.keys(row.rules).indexOf(it.rule.id);
    const cur = best.get(row.key);
    if (cur === undefined) best.set(row.key, { i, order });
    else if (order < cur.order) { extras.add(cur.i); best.set(row.key, { i, order }); }
    else extras.add(i);
  });
  return extras;
}

/** r 의 항목 수 — 통째로 버릴 때 센다. 객체가 아니면 한 건 */
const entryCount = (r: unknown): number => (r !== null && typeof r === 'object' && !Array.isArray(r) ? Object.keys(r).length : 1);

/** `#state=…` · `state=…` 를 받는다. 길이 상한 · 디코딩 · JSON · 모양 · parseContext 중 하나라도 실패하면 undefined.
 *  `v` 는 parseContext 가 읽지 않는다 — 꼴이 `YYYY-MM-DD.N` 일 때만 rulesVersion 으로 돌려주고, 아니면 없는 것으로 본다.
 *  `p` 가 셋 밖이면 없는 것으로 보고 `r` 은 판정할 수 없어 버린다. rules 는 기본이 규칙 표(시험 전용 fixture 가 다른 표를 넘긴다).
 *  enabled — 켜진 CSP (D45). 지역은 CSP 마다 다른 표로 푼다 (D49) — 링크의 p 가 켜져 있으면 그 표, p 가 없으면 켜진 CSP 를 차례로 대어 처음 풀리는 표.
 *  p 가 꺼진 CSP 면 (D55) ① p 로 원래 CSP 를 알고 ② 그 CSP 의 표로 풀리는지 본다(안 풀리면 깨진 링크) ③ 지역은 켜진 CSP 로 옮길 수 없어 켜진 첫 CSP 의 예시(R0)로 바꾸고
 *  ④ 선택은 전부 버린다 ⑤ 켜진 CSP 가 하나면 그것을 고르고 unavailable 에 원래 CSP 를 싣는다(화면이 안내 한 줄을 띄운다) */
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
  // 마법사 링크(v4 · w)는 이 디코더의 몫이 아니다 — decodeWizardState
  if ('w' in raw) return undefined;
  if (Object.values(raw).some((v) => typeof v === 'string' && v.length > MAX_FIELD_CHARS)) return undefined;
  if (FREE_FIELDS.some((f) => { const v = (raw as Record<string, unknown>)[f]; return typeof v === 'string' && v.length > MAX_CONTEXT_CHARS; })) return undefined;
  const { v, p, r } = raw as Record<string, unknown>;
  const rulesVersion = typeof v === 'string' && RULES_VERSION_RE.test(v) ? { rulesVersion: v } : {};
  const firstOk = (input: RawContext, tryAs: readonly Provider[]) => tryAs.map((q) => parseContext(input, q)).find((x) => x.ok);

  if (isProvider(p) && enabled.includes(p)) {
    const parsed = firstOk(raw as RawContext, [p]);
    if (!parsed?.ok) return undefined;
    const out: DecodedState = { context: parsed.context, ...rulesVersion, provider: p };
    if (r !== undefined) {
      const { items, dropped } = decodeSelection(p, r, rules);
      if (items.length > 0) out.selection = items;
      if (dropped > 0) out.dropped = dropped;
    }
    return out;
  }
  // 고를 CSP 가 정해지지 않은 링크 — 켜진 것이 하나면 그것. 선택은 규칙 id 가 CSP 에 묶여 있어 옮기지 않는다
  const only = enabled.length === 1 ? enabled[0] : undefined;
  const disabled = isProvider(p) ? p : undefined;
  let input = raw as RawContext;
  if (disabled !== undefined) {
    if (!firstOk(input, [disabled])?.ok) return undefined;
    input = { ...input, region: EXAMPLE_REGIONS[only ?? enabled[0]!] };
  }
  const parsed = firstOk(input, only !== undefined ? [only] : enabled);
  if (!parsed?.ok) return undefined;
  const out: DecodedState = { context: parsed.context, ...rulesVersion };
  if (only !== undefined) out.provider = only;
  if (r !== undefined) {
    const n = entryCount(r);
    if (n > 0) out.dropped = n;
  }
  if (disabled !== undefined) out.unavailable = disabled;
  return out;
}

/** 공유 URL — base 는 `location.origin + location.pathname` (도메인을 코드에 박지 않는다). 화면은 지금 규칙 버전을 넘긴다 (D27 ⑵) */
export function shareUrl(ctx: NamingContext, base: string, rulesVersion?: string, pick: PickState = {}): string {
  return `${base}#${HASH_KEY}=${encodeState(ctx, rulesVersion, pick)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// hash v4 — 마법사 모델 `w` (D67). 문맥 넷(owner · system · env · region 코드) + 규칙 버전 v + w. 최상위 purpose 는 싣지 않는다.
// 환경을 둘 이상 고르면 최상위 `e` 에 표준값 목록(ENV_VALUES 순서 · env 가 첫째)을 싣는다 — 하나면 싣지 않아 hash 가 그대로다 (D82)
// 키 표 (모델 ↔ hash) — 없는 칸은 싣지 않는다 · 표 밖의 키는 그 자리의 오류다:
//   w        { pp: projectPicks, s: services }
//   service  { n: purpose, p: picks }
//   pick     { pr: preset(null 이면 생략 — custom), ru: ruleId(custom 만 · 규칙 id 전체 `gcp.compute_instance`), t: tier, ro: role,
//              k: kind(값 이름 `POSTGRES`), h: ha(켜졌을 때만 · 값 1), sv: serverless(짧은 값 `gcf` · `run`), i: instances,
//              l: location(멀티 · 이중 리전 코드 `us` · `asia1` — D78) }
//   slot     { id, q: seq, a: attach }
//   attach   { b: boot(값 1), d: data(순번 배열), ip(값 1), ipi(값 1) }
// 인코더 · 디코더 모두 validatePlan 을 지난다. 디코더 순서 — parseProjectContext → validatePlan(복구) → 서비스마다 parseContext
// ─────────────────────────────────────────────────────────────────────────────

/** sv 의 짧은 값 ↔ 규칙 id — 프리셋 데이터의 serverless.ruleIds 와 같은 집합이다(urlState.test 가 센다) */
export const SERVERLESS_SHORT: Readonly<Record<string, string>> = { gcf: 'gcp.cloud_function', run: 'gcp.run_service' };
const SERVERLESS_LONG: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(SERVERLESS_SHORT).map(([k, v]) => [v, k]));

/** 마법사 hash 의 문맥 넷 — region 은 리전 코드 */
export type ProjectFields = WizardPlan['project'];

const PICK_KEYS = new Set(['pr', 'ru', 't', 'ro', 'k', 'h', 'sv', 'i', 'l']);
const SLOT_KEYS = new Set(['id', 'q', 'a']);
const SERVICE_KEYS = new Set(['n', 'p']);
const W_KEYS = new Set(['pp', 's']);

function shortAttach(a: Attachments | undefined): Record<string, unknown> | undefined {
  if (!a) return undefined;
  const out: Record<string, unknown> = {};
  if (a.boot === true) out.b = 1;
  if (a.data && a.data.length > 0) out.d = [...a.data];
  if (a.ip === true) out.ip = 1;
  if (a.ipi === true) out.ipi = 1;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** pick 위치를 고르기의 값으로 — 멀티 · 이중 리전은 코드(us), Secret 의 regional 은 소문자(D79), 그 밖은 그대로(검사가 거부한다) */
function locationCode(v: string): string {
  return canonicalLocation(v, 'gcp')?.code ?? (v.trim().toLowerCase() === REGIONAL_LOCATION ? REGIONAL_LOCATION : v);
}

function shortPick(p: WizardPick): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (p.preset !== null) out.pr = p.preset;
  else if (p.ruleId !== undefined) out.ru = p.ruleId;
  if (p.tier !== undefined) out.t = p.tier;
  if (p.role !== undefined) out.ro = p.role;
  if (p.kind !== undefined) out.k = p.kind;
  if (p.ha === true) out.h = 1;
  if (typeof p.serverless === 'string') out.sv = SERVERLESS_LONG[p.serverless] ?? p.serverless;
  // 위치는 코드로 싣는다 — 검사를 지난 모델이라 늘 풀리고, 길이가 MAX_REGION_CHARS · regional(D79) 안이라 상한식이 닫힌다 (D78)
  if (p.location !== undefined) out.l = locationCode(p.location);
  if (p.instances !== undefined) {
    out.i = p.instances.map((s) => {
      const a = shortAttach(s.attach);
      return { id: s.id, q: s.seq, ...(a ? { a } : {}) };
    });
  }
  return out;
}

/** 모델 → hash 의 w (검사하지 않는다 — encodeWizardState 가 먼저 validatePlan 을 부른다) */
export function wizardToHash(plan: WizardPlan): Record<string, unknown> {
  return {
    pp: plan.projectPicks.map(shortPick),
    s: plan.services.map((s) => ({ n: s.purpose, p: s.picks.map(shortPick) })),
  };
}

/** 마법사 상태 → hash 문자열(Base64url). 모델이 validatePlan · 프로젝트 문맥을 지나지 못하면 undefined — 화면은 마지막 온전한 hash 를 둔다.
 *  envs — 화면에서 고른 환경 목록(D82). 모델의 env 와 합쳐 둘 이상이면 `e` 로 싣는다 */
export function encodeWizardState(plan: WizardPlan, rulesVersion?: string, envs: readonly Env[] = []): string | undefined {
  const ctx = parseProjectContext(plan.project, 'gcp');
  if (!ctx.ok || !validatePlan(plan).ok) return undefined;
  if (plan.services.some((s) => !parseContext({ ...plan.project, purpose: s.purpose }, 'gcp').ok)) return undefined;
  const c = ctx.context;
  const body: Record<string, unknown> = { owner: c.owner, system: c.system, env: c.env, region: c.region };
  if (rulesVersion !== undefined) body.v = rulesVersion;
  const list = envList(c.env, envs);
  if (list.length > 1) body.e = list;
  // 프로젝트 ID 접미사 (D85) — 있을 때만 x. 없으면 바이트가 옛 hash 와 같다
  if (plan.projectIdSuffix !== undefined) body.x = plan.projectIdSuffix;
  body.w = wizardToHash(plan);
  return toBase64Url(new TextEncoder().encode(JSON.stringify(body)));
}

/** 링크를 열며 고친 것 — 화면이 한 줄씩 알린다. discarded 면 w 전체를 버렸다(모델 전체 오류 · 표 밖 꼴) */
export interface WizardNotices { dropped: number; haOff: number; serverlessOff: number; trimmed: number; discarded: boolean }
const NO_NOTICES = (): WizardNotices => ({ dropped: 0, haOff: 0, serverlessOff: 0, trimmed: 0, discarded: false });

export interface DecodedWizard {
  project: ProjectFields;
  rulesVersion?: string;
  /** w 를 버렸으면 없다 */
  plan?: WizardPlan;
  /** `e` 로 고른 환경이 둘 이상일 때만 — 첫째가 project.env 다 (D82) */
  envs?: Env[];
  notices: WizardNotices;
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** hash 의 짧은 꼴 → 모델. 표 밖의 키가 든 pick · 슬롯 · 서비스는 그 자리에서 버리고 센다. 값의 꼴은 validatePlan 이 본다 */
function longAttach(a: unknown): unknown {
  if (!isObj(a)) return a;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a)) {
    if (k === 'b') out.boot = v === 1 ? true : v;
    else if (k === 'd') out.data = v;
    else if (k === 'ip' || k === 'ipi') out[k] = v === 1 ? true : v;
    else out[k] = v; // 표 밖 — validatePlan 이 attach 자리의 오류로 낸다
  }
  return out;
}

function longPick(p: unknown, n: WizardNotices): WizardPick | undefined {
  if (!isObj(p)) return p as WizardPick; // validatePlan 이 selection.item_not_object 로 낸다
  if (Object.keys(p).some((k) => !PICK_KEYS.has(k))) { n.dropped++; return undefined; }
  const out: Record<string, unknown> = { preset: p.pr === undefined ? null : p.pr };
  if (p.ru !== undefined) out.ruleId = p.ru;
  if (p.t !== undefined) out.tier = p.t;
  if (p.ro !== undefined) out.role = p.ro;
  if (p.k !== undefined) out.kind = p.k;
  if (p.h !== undefined) out.ha = p.h === 1 ? true : p.h;
  if (p.sv !== undefined) out.serverless = typeof p.sv === 'string' ? (SERVERLESS_SHORT[p.sv] ?? p.sv) : p.sv;
  // 위치는 코드로 푼다 — 화면의 고르기 값이 코드다(` US ` 로 손댄 링크도 고르기에 맞게). 모르는 값은 그대로 두어 validatePlan 이 거부한다
  if (p.l !== undefined) out.location = typeof p.l === 'string' ? locationCode(p.l) : p.l;
  if (p.i !== undefined) {
    if (!Array.isArray(p.i)) out.instances = p.i;
    else {
      const slots: unknown[] = [];
      for (const s of p.i as unknown[]) {
        if (!isObj(s)) { slots.push(s); continue; }
        if (Object.keys(s).some((k) => !SLOT_KEYS.has(k))) { n.dropped++; continue; }
        slots.push({ id: s.id, seq: s.q, ...(s.a === undefined ? {} : { attach: longAttach(s.a) }) });
      }
      out.instances = slots;
    }
  }
  return out as unknown as WizardPick;
}

/** path 꼴 `services[1].picks[0].instances[2].attach.data[0]` → 토막 */
type Seg = { key: string; index?: number };
function segments(path: string): Seg[] | undefined {
  const out: Seg[] = [];
  for (const part of path.split('.')) {
    const m = /^([A-Za-z]+)(?:\[(\d+)\])?$/.exec(part);
    if (!m) return undefined;
    out.push(m[2] === undefined ? { key: m[1]! } : { key: m[1]!, index: Number(m[2]) });
  }
  return out;
}

/** 모델 안의 pick 목록 하나와 그 pick 자리 — path 의 앞 토막(services[i].picks[j] · projectPicks[j]) */
interface PickRef { list: WizardPick[]; index: number; service?: number }
function pickRef(plan: WizardPlan, segs: Seg[]): { ref: PickRef; rest: Seg[] } | undefined {
  const [a, b] = segs;
  if (a?.key === 'projectPicks' && a.index !== undefined) return { ref: { list: plan.projectPicks, index: a.index }, rest: segs.slice(1) };
  if (a?.key === 'services' && a.index !== undefined && b?.key === 'picks' && b.index !== undefined) {
    const svc = plan.services[a.index];
    if (!svc || !Array.isArray(svc.picks)) return undefined;
    return { ref: { list: svc.picks, index: b.index, service: a.index }, rest: segs.slice(2) };
  }
  return undefined;
}

const FLAG_HA = new Set(['wizard.count_below_min', 'wizard.ha_not_supported']);

/** 오류 하나를 고친다 — path 가 가리키는 그 자리 하나만(§5-5). 고쳤으면 true */
function repair(plan: WizardPlan, e: PlanError, n: WizardNotices): boolean {
  const segs = e.path === undefined ? undefined : segments(e.path);
  if (!segs || segs.length === 0) return false;
  // pick 수 상한 — 앞에서부터 상한까지 남긴다
  if (e.code === 'wizard.too_many_picks') {
    if (segs.length === 1 && segs[0]!.key === 'projectPicks' && segs[0]!.index === undefined) {
      n.trimmed += plan.projectPicks.length - MAX_PICKS_PER_SERVICE;
      plan.projectPicks.splice(MAX_PICKS_PER_SERVICE);
      return true;
    }
    const svc = segs[0]!.key === 'services' && segs[0]!.index !== undefined ? plan.services[segs[0]!.index] : undefined;
    if (svc && Array.isArray(svc.picks) && segs.length === 1) {
      n.trimmed += svc.picks.length - MAX_PICKS_PER_SERVICE;
      svc.picks.splice(MAX_PICKS_PER_SERVICE);
      return true;
    }
    return false;
  }
  // 서비스 자체
  if (segs.length === 1 && segs[0]!.key === 'services' && segs[0]!.index !== undefined) {
    if (segs[0]!.index >= plan.services.length) return false;
    plan.services.splice(segs[0]!.index, 1);
    n.dropped++;
    return true;
  }
  const found = pickRef(plan, segs);
  if (!found) return false;
  const { ref, rest } = found;
  const pick = ref.list[ref.index];
  if (pick === undefined) return false;
  const removePick = () => {
    ref.list.splice(ref.index, 1);
    // 지워서 빈 서비스는 지운다
    if (ref.service !== undefined && plan.services[ref.service]?.picks.length === 0) plan.services.splice(ref.service, 1);
  };
  // ⓪ 플래그 — 지우지 않고 끈다
  if (rest.length === 0 && FLAG_HA.has(e.code) && isObj(pick)) {
    delete (pick as { ha?: unknown }).ha;
    n.haOff++;
    return true;
  }
  if (rest.length === 0 && e.code === 'wizard.serverless_not_supported' && isObj(pick)) {
    delete (pick as { serverless?: unknown }).serverless;
    n.serverlessOff++;
    return true;
  }
  if (rest.length === 0) { removePick(); n.dropped++; return true; }
  const slots = (pick as { instances?: unknown }).instances;
  const s0 = rest[0]!;
  if (s0.key !== 'instances' || s0.index === undefined || !Array.isArray(slots) || s0.index >= slots.length) return false;
  const slot = slots[s0.index] as Record<string, unknown>;
  if (rest.length === 1) {
    slots.splice(s0.index, 1);
    n.dropped++;
    if (slots.length === 0) { removePick(); return true; }
    const min = pick.preset === null ? undefined : presetOf(String(pick.preset))?.ha?.minInstances;
    if (pick.ha === true && min !== undefined && slots.length < min) { delete pick.ha; n.haOff++; }
    return true;
  }
  if (!isObj(slot) || rest[1]!.key !== 'attach') return false;
  if (rest.length === 2) { delete slot.attach; n.dropped++; return true; }
  const attach = slot.attach;
  if (!isObj(attach)) return false;
  const k = rest[2]!;
  if (k.key === 'data' && k.index !== undefined) {
    const data = attach.data;
    if (!Array.isArray(data) || k.index >= data.length) return false;
    data.splice(k.index, 1);
  } else if (k.key in attach) {
    delete attach[k.key];
  } else return false;
  n.dropped++;
  if (Array.isArray(attach.data) && attach.data.length === 0) delete attach.data;
  if (Object.keys(attach).length === 0) delete slot.attach;
  return true;
}

/** 서비스마다 문맥(넷 + purpose)이 풀리는가 — 안 풀리는 첫 서비스의 오류(path services[i]) */
function serviceContextError(plan: WizardPlan): PlanError | undefined {
  for (let i = 0; i < plan.services.length; i++) {
    const res = parseContext({ ...plan.project, purpose: plan.services[i]!.purpose }, 'gcp');
    if (!res.ok) return { ...res.errors[0]!, path: `services[${i}]` };
  }
  return undefined;
}

const DUP_PICK = 'wizard.duplicate_pick';
const DUP_SLOT_ID = 'wizard.duplicate_slot_id';
const DUP_SEQ = 'wizard.duplicate_seq';
const SERVERLESS = 'wizard.serverless_not_supported';

/** 한 번에 고칠 오류들 — 하나씩 고친 것과 결과가 같은 것만 고른다(recoverPlan.test 가 무작위 모델 600개로 대어 본다). 뒤 자리부터 돌려준다 — 지워도 아직 고치지 않은 자리가 밀리지 않는다.
 *  · 오류 목록을 앞에서부터 본다. pick 밖 오류(서비스 자리 · pick 수 상한)를 만나면 멈춘다 — 서비스를 지우거나 자르면 자리가 밀린다
 *  · pick 마다 첫 오류 하나. 그 첫 오류가 슬롯 자리면 pick 자리 오류를 만나기 전까지 슬롯마다 첫 오류 하나 — 슬롯 오류는 그 슬롯만 본다
 *  · 목록(pick 중복을 보는 단위 — checkPicks 의 seen) · pick(슬롯 중복을 보는 단위)을 얼린다: 얼린 뒤의 오류는 다음 회로 미룬다. 다른 목록은 서로의 판정을 바꾸지 않는다
 *    - 서버리스를 끄면 그 pick 의 규칙이 바뀌어 뒤 pick 이 중복이 될 수 있다 → 그 목록을 얼린다
 *    - pick 중복은 앞의 것이 지워지면 사라질 수 있다 → 그 목록에서 이번 회에 중복 아닌 고침을 고른 pick 이 앞에 있으면 얼린다
 *      (하나씩 고치면 앞 pick 의 오류를 끝까지 고친 뒤에 중복을 본다 — 플래그만 끈 pick 도 뒤 오류로 지워질 수 있다). 중복으로 지우는 것은 괜찮다(같은 값이 앞에 남는다)
 *    - 슬롯 중복은 키가 둘(id · seq)이다 → id 중복으로 지운 슬롯은 seq 를, seq 중복으로 지운 슬롯은 id 를, 그 밖의 이유로 지운 슬롯은 둘 다를 막는다 */
function batchOf(errors: readonly PlanError[]): PlanError[] {
  interface Group { list: number; pick: number; closed: boolean; fixes: { e: PlanError; slot: number }[] }
  const groups = new Map<string, Group>();
  const frozenLists = new Set<number>();
  const frozenPicks = new Set<string>();
  /** 이번 회에 중복 아닌 고침을 고른 목록 — 그 pick 은 다음 회에 지워질 수 있다(플래그를 끈 pick 도 뒤 오류로 지워진다) */
  const touched = new Set<number>();
  /** pick 마다 막힌 슬롯 중복 키 */
  const slotBlocked = new Map<string, { id: boolean; seq: boolean }>();
  for (const e of errors) {
    const segs = segments(e.path!);
    const [a, b] = segs ?? [];
    let list: number;
    let pick: number;
    let rest: Seg[];
    if (a?.key === 'projectPicks' && a.index !== undefined) { list = -1; pick = a.index; rest = segs!.slice(1); }
    else if (a?.key === 'services' && a.index !== undefined && b?.key === 'picks' && b.index !== undefined) { list = a.index; pick = b.index; rest = segs!.slice(2); }
    else break;
    const key = `${list}:${pick}`;
    if (frozenLists.has(list) || frozenPicks.has(key)) continue;
    const slot = rest[0]?.key === 'instances' && rest[0].index !== undefined ? rest[0].index : undefined;
    const slotLevel = slot !== undefined && rest.length === 1;
    const blocked = slotBlocked.get(key) ?? { id: false, seq: false };
    if (e.code === DUP_PICK && rest.length === 0 && touched.has(list)) { frozenLists.add(list); continue; }
    if (slotLevel && ((e.code === DUP_SLOT_ID && blocked.id) || (e.code === DUP_SEQ && blocked.seq))) { frozenPicks.add(key); continue; }
    const g = groups.get(key);
    if (!g) groups.set(key, { list, pick, closed: slot === undefined, fixes: [{ e, slot: slot ?? -1 }] });
    else if (g.closed) continue;
    else if (slot === undefined) { g.closed = true; continue; }
    else if (g.fixes.some((f) => f.slot === slot)) continue;
    else g.fixes.push({ e, slot });
    // 고른 고침이 바꾸는 것
    if (e.code === SERVERLESS && rest.length === 0) frozenLists.add(list);
    if (e.code !== DUP_PICK) touched.add(list);
    if (slotLevel) {
      // 슬롯을 지운다(슬롯 자리 오류는 모두 그 슬롯을 지운다)
      slotBlocked.set(key, { id: blocked.id || e.code !== DUP_SLOT_ID, seq: blocked.seq || e.code !== DUP_SEQ });
    }
  }
  const all = [...groups.values()].flatMap((g) => g.fixes.map((f) => ({ ...f, list: g.list, pick: g.pick })));
  all.sort((x, y) => y.list - x.list || y.pick - x.pick || y.slot - x.slot);
  return all.map((f) => f.e);
}

/** 모델을 고쳐 validatePlan 을 지나게 한다. 모델 전체 오류 · 고칠 수 없는 오류면 undefined. 매 회 모델이 줄거나 플래그가 꺼지므로 끝난다.
 *  batch(기본) — 서로 판정을 바꾸지 않는 자리들을 한 번에 고친다(batchOf). single — 오류 하나씩(시험이 batch 와 대어 보는 기준).
 *  하나씩만 고치면 틀린 자리 n 개에 검사를 n 번 돌려 n² 이 된다 — 틀린 pick 200개짜리 링크가 1.2 s 걸렸다 */
export function recoverPlan(plan: WizardPlan, n: WizardNotices, mode: 'batch' | 'single' = 'batch'): WizardPlan | undefined {
  for (;;) {
    const res = validatePlan(plan);
    const errors: PlanError[] = res.ok ? [] : res.errors;
    if (res.ok) {
      const svcErr = serviceContextError(plan);
      if (!svcErr) return plan;
      errors.push(svcErr);
    }
    const pathed = errors.filter((e) => e.path !== undefined);
    if (pathed.length === 0) return undefined;
    const batch = mode === 'batch' ? batchOf(pathed) : [];
    if (batch.length > 1) {
      for (const e of batch) if (!repair(plan, e, n)) return undefined;
      continue;
    }
    if (!repair(plan, pathed[0]!, n)) return undefined;
  }
}

/** 복구 전에 보는 크기 상한 — pick 수 · 슬롯과 딸린 data 수. 검사를 지나는 모델은 이름이 MAX_NAMES 이하이고 pick 마다 이름이 하나 이상이라
 *  (count 규칙은 슬롯이 하나 이상이어야 한다) 둘 다 MAX_NAMES 를 넘을 수 없다. 그 두 배를 넘으면 화면이 만든 입력이 아니라고 보고 고치지 않고 버린다(discarded) —
 *  고치는 시간은 입력 크기에 따라 늘므로 크기를 먼저 닫는다. 링크 · 계획 파일 모두 이 길을 지난다 (D100 · recoverPlan.test) */
export const MAX_RECOVER_PICKS = 2 * MAX_NAMES;
export const MAX_RECOVER_NAMES = 2 * MAX_NAMES;

/** 짧은 꼴 w 의 pick 수와 슬롯 · data 수 — 꼴을 믿지 않는다(배열이 아니면 0) */
function rawSize(pp: unknown[], ss: unknown[]): { picks: number; names: number } {
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const picks = [...pp, ...ss.flatMap((s) => (isObj(s) ? arr(s.p) : []))];
  let names = 0;
  for (const p of picks) {
    if (!isObj(p)) continue;
    for (const s of arr(p.i)) {
      names++;
      if (isObj(s) && isObj(s.a)) names += arr(s.a.d).length;
    }
  }
  return { picks: picks.length, names };
}

/** 마법사 hash 의 길이 상한 (D67 · 이름 수로 닫힌 식) — 인코더는 validatePlan 을 지난 모델만 싣고, 그 모델의 슬롯 · 딸린 것은 하나하나가 이름이라
 *  합이 MAX_NAMES - 1(프로젝트 ID) 이하다. 그래서 식 = 뼈대 + 자유 입력 둘 + 서비스마다(purpose · 감싸기 + pick 마다 고정 칸) + 프로젝트 공용 pick 고정 칸
 *  + 이름 하나의 최악 바이트 × MAX_NAMES. 값은 urlState.test 가 잰다 */
/** 프리셋 id 의 가장 긴 길이 — 인코더는 데이터의 id 만 싣는다 */
const MAX_PRESET_ID_CHARS = Math.max(...PRESETS.map((p) => p.id.length));
const PICK_FIXED_JSON_BYTES = JSON.stringify({
  pr: 'p'.repeat(MAX_PRESET_ID_CHARS), ru: 'r'.repeat(MAX_RESOURCE_TYPE_CHARS + 4), t: 't'.repeat(16), ro: 'o'.repeat(MAX_ROLE_CHARS),
  k: 'k'.repeat(MAX_KIND_VALUE_CHARS), h: 1, sv: 'run', l: 'l'.repeat(Math.max(MAX_REGION_CHARS, REGIONAL_LOCATION.length)), i: [],
}).length + 1;
/** 슬롯 하나(`{"id":"<8>","q":"99","a":{}},` — attach 감싸기 · 데이터 배열 감싸기 포함) 와 딸린 것 하나(`"ipi":1,` · `"99",` 중 큰 쪽) 중 큰 쪽 */
const NAME_JSON_BYTES = Math.max(
  JSON.stringify({ id: 'i'.repeat(MAX_SLOT_ID_CHARS), q: '99', a: { d: [] } }).length + 1,
  '"ipi":1,'.length, '"b":1,'.length, '"99",'.length,
);
/** 마법사 hash 를 푼 JSON 의 최악 바이트 — 계획 파일의 읽기 상한(planFile.ts)도 이 값이다 */
export const MAX_WIZARD_JSON_BYTES = JSON.stringify({ owner: '', system: '', env: 'prod', region: 'r'.repeat(MAX_REGION_CHARS), v: V_PLACEHOLDER, e: ENV_VALUES, x: 'x'.repeat(16), w: { pp: [], s: [] } }).length
  + 2 * MAX_CONTEXT_CHARS * MAX_JSON_BYTES_PER_UNIT
  + MAX_SERVICES * (JSON.stringify({ n: '', p: [] }).length + 1 + MAX_CONTEXT_CHARS * MAX_JSON_BYTES_PER_UNIT + MAX_PICKS_PER_SERVICE * PICK_FIXED_JSON_BYTES)
  + MAX_PICKS_PER_SERVICE * PICK_FIXED_JSON_BYTES
  + MAX_NAMES * NAME_JSON_BYTES;
export const MAX_WIZARD_HASH_CHARS = `#${HASH_KEY}=`.length + Math.ceil(MAX_WIZARD_JSON_BYTES / 3) * 4;
/** v3 · v4 어느 버전이든 받을 수 있는 가장 긴 hash — 화면의 경로 분기가 쓴다 */
export const MAX_ANY_HASH_CHARS = Math.max(MAX_HASH_CHARS, MAX_WIZARD_HASH_CHARS);

/** hash → JSON 객체(꼴만 본다 — 길이 · Base64 · JSON · 객체). 아니면 undefined */
function hashJson(hash: string, max: number): Record<string, unknown> | undefined {
  if (hash.length > max) return undefined;
  const m = new RegExp(`^#?${HASH_KEY}=(.*)$`).exec(hash);
  if (!m) return undefined;
  const bytes = fromBase64Url(m[1] ?? '');
  if (!bytes) return undefined;
  try {
    const raw: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return isObj(raw) ? raw : undefined;
  } catch {
    return undefined;
  }
}

/** hash 의 꼴 (D68 · D76) — 디코더가 받는 꼴만 그 화면이다: decodeWizardState 가 받으면 wizard · `w` 가 없고 decodeState 가 받으면 tree
 *  (v3 · 다섯 키 — 걸린 항목은 그 디코더가 버리고 연다) · hash 가 없으면 none · 그 밖(풀리지 않는 꼴 · 문맥이 틀린 링크)은 broken.
 *  뿌리 `/` 는 tree 꼴이면 `/pick` 으로 옮기고, broken 이면 마법사에 한 줄 안내를 띄운다 */
export type HashKind = 'wizard' | 'tree' | 'none' | 'broken';
export function hashKind(hash: string): HashKind {
  if (hash === '' || hash === '#') return 'none';
  const raw = hashJson(hash, MAX_ANY_HASH_CHARS);
  if (!raw) return 'broken';
  if ('w' in raw) return decodeWizardState(hash) !== undefined ? 'wizard' : 'broken';
  return decodeState(hash) !== undefined ? 'tree' : 'broken';
}

/** 마법사 hash 를 푼다 — 문맥 넷이 안 풀리면(깨진 링크) undefined. w 와 r 이 같이 있으면 깨진 링크다.
 *  w 의 꼴이 틀리거나 모델 전체 오류면 w 를 버리고(notices.discarded) 문맥만 돌려준다 */
export function decodeWizardState(hash: string): DecodedWizard | undefined {
  const raw = hashJson(hash, MAX_WIZARD_HASH_CHARS);
  return raw ? decodeWizardObject(raw) : undefined;
}

/** hash 의 JSON(짧은 꼴) → 마법사 상태. 계획 파일(D100 · planFile.ts)도 짧은 꼴로 옮겨 이 길을 지난다 — 복구 · 안내가 링크와 같다 */
export function decodeWizardObject(raw: Record<string, unknown>): DecodedWizard | undefined {
  if (!('w' in raw) || 'r' in raw) return undefined;
  if (Object.values(raw).some((v) => typeof v === 'string' && v.length > MAX_FIELD_CHARS)) return undefined;
  if ((['owner', 'system'] as const).some((f) => typeof raw[f] === 'string' && (raw[f] as string).length > MAX_CONTEXT_CHARS)) return undefined;
  const ctx = parseProjectContext(raw as RawContext, 'gcp');
  if (!ctx.ok) return undefined;
  const project: ProjectFields = { owner: ctx.context.owner, system: ctx.context.system, env: ctx.context.env, region: ctx.context.region };
  const out: DecodedWizard = { project, notices: NO_NOTICES() };
  // e — 배열이 아니면 통째로, 표준값이 아닌 항목은 하나씩 버리고 센다. env 와 합쳐 둘 이상이면 첫째(표준값 순서)가 모델의 env 다
  if ('e' in raw) {
    const e = envsFromHash(raw.e);
    if (!e) out.notices.dropped++;
    else {
      out.notices.dropped += e.dropped;
      const list = envList(project.env, e.envs);
      if (list.length > 1) { out.envs = list; project.env = list[0]!; }
    }
  }
  if (typeof raw.v === 'string' && RULES_VERSION_RE.test(raw.v)) out.rulesVersion = raw.v;
  // x — 프로젝트 ID 접미사 (D85). 꼴 · 예약어가 틀리면 그것만 버리고 센다(모델 검사가 w 전체를 버리지 않게 먼저 본다)
  let projectIdSuffix: string | undefined;
  if ('x' in raw) {
    if (checkProjectIdSuffix(raw.x).length === 0) projectIdSuffix = raw.x as string;
    else out.notices.dropped++;
  }
  const w = raw.w;
  const discard = () => { out.notices.discarded = true; return out; };
  if (!isObj(w) || Object.keys(w).some((k) => !W_KEYS.has(k))) return discard();
  const n = out.notices;
  const pp = w.pp === undefined ? [] : w.pp;
  const ss = w.s === undefined ? [] : w.s;
  if (!Array.isArray(pp) || !Array.isArray(ss)) return discard();
  const size = rawSize(pp as unknown[], ss as unknown[]);
  if (size.picks > MAX_RECOVER_PICKS || size.names > MAX_RECOVER_NAMES) return discard();
  const services: WizardPlan['services'] = [];
  for (const s of ss as unknown[]) {
    if (!isObj(s) || Object.keys(s).some((k) => !SERVICE_KEYS.has(k))) { n.dropped++; continue; }
    const picks = s.p === undefined ? [] : s.p;
    services.push({
      purpose: s.n as string,
      picks: Array.isArray(picks) ? (picks as unknown[]).map((p) => longPick(p, n)).filter((p): p is WizardPick => p !== undefined) : (picks as WizardPick[]),
    });
  }
  const plan: WizardPlan = {
    provider: 'gcp', project,
    projectPicks: (pp as unknown[]).map((p) => longPick(p, n)).filter((p): p is WizardPick => p !== undefined),
    services,
    ...(projectIdSuffix === undefined ? {} : { projectIdSuffix }),
  };
  const fixed = recoverPlan(plan, n);
  if (!fixed) return discard();
  out.plan = fixed;
  return out;
}

/** 마법사 공유 URL — base 는 `location.origin + location.pathname` */
export function wizardShareUrl(plan: WizardPlan, base: string, rulesVersion?: string): string | undefined {
  const enc = encodeWizardState(plan, rulesVersion);
  return enc === undefined ? undefined : `${base}#${HASH_KEY}=${enc}`;
}
