// 요청 본문 검증 — 모양(shape)만 본다. 값의 뜻은 엔진(parseContext · rulesFor)이 판정한다. 의존성 추가 없음(수작업 타입 가드)
import { ENABLED_PROVIDERS, PROVIDERS, type NamingContext, type Provider, type RawContext } from '../core/types';
import { rulesFor } from '../core/constraints';
import { MAX_CONTEXT_CHARS, parseContext } from '../core/engine';
import { RULES_REVISION } from '../core/revision';
import { validateSelection, type SelectionItem } from '../core/selection';
import type { CoreMessage } from '../core/messages';
import type { ApiMessage } from './codes';
import type { Message } from '../messages/catalog';
import { clipForDisplay } from '../core/display';

/** 거부 — 상태 코드와 메시지 코드. 응답 본문은 라우터가 fail() 로 만든다 (D25) */
export interface Rejection { status: 400 | 409; errors: Message[]; supported?: string[] }
export type Parsed<T> = { ok: true; value: T } | { ok: false; rejection: Rejection };

/** contexts — 지역을 CSP 마다 풀어(D49) provider 마다 문맥 하나. transformed 는 provider 순서로 모은 것(같은 기록은 한 번) */
export interface GenerateInput { contexts: Partial<Record<Provider, NamingContext>>; transformed: CoreMessage[]; providers: Provider[] }
export interface NamesInput { provider: Provider; context: NamingContext; transformed: CoreMessage[]; items: SelectionItem[] }
export interface ValidateInput { provider: Provider; resourceType: string; name: string }
export const UI_EVENTS = ['ui_visit', 'ui_generate', 'ui_copy'] as const;
export type UiEvent = (typeof UI_EVENTS)[number];
/** ui_copy 의 target — 어느 복사 버튼인가 (D56). 항목 키 · 리소스 종류는 싣지 않는다. 화면 쪽 같은 목록은 beacon.ts 의 COPY_TARGETS(beacon.test 가 둘을 대어 본다) */
export const UI_COPY_TARGETS = ['share-url', 'name', 'all-names', 'names-json', 'terraform', 'tags-json'] as const;
export type UiCopyTarget = (typeof UI_COPY_TARGETS)[number];
/** 비콘 한 건 — target 은 ui_copy 에만 있다. 다른 이벤트에 온 target 은 버린다 */
export interface EventInput { event: UiEvent; target?: UiCopyTarget }

function reject(errors: Message[], supported?: string[], status: 400 | 409 = 400): { ok: false; rejection: Rejection } {
  return { ok: false, rejection: { status, errors, ...(supported ? { supported } : {}) } };
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isProvider(v: unknown): v is Provider {
  return typeof v === 'string' && (PROVIDERS as readonly string[]).includes(v);
}
/** 켜진 CSP 인가 (D45) — 아는 provider 라도 꺼져 있으면 API 가 받지 않는다 */
function isEnabled(v: Provider): boolean {
  return ENABLED_PROVIDERS.includes(v);
}
/** supported 에 싣는 목록 — 켜진 CSP 만 */
const enabledList = (): string[] => [...ENABLED_PROVIDERS];

/** 목록 밖 값의 판정 — 필드가 아예 없으면 field_missing(값 자리에 "undefined" 를 싣지 않는다), 있으면 value_unsupported */
function unsupported(v: unknown, field: string): ApiMessage {
  return v === undefined ? { code: 'request.field_missing', field } : { code: 'request.value_unsupported', field, params: { value: describe(v) } };
}

/** provider 하나의 판정 — 없으면 field_missing, 모르는 값은 value_unsupported, 아는데 꺼졌으면 provider_not_enabled. 통과면 undefined */
function providerError(v: unknown, field: string): ApiMessage | undefined {
  if (!isProvider(v)) return unsupported(v, field);
  if (!isEnabled(v)) return { code: 'request.provider_not_enabled', field, params: { provider: v } };
  return undefined;
}

/** 문자열 필드 길이 상한 — 이름 규칙이 아니라 전송 위생이다. 규칙 표의 최대 max_length 는 256 이라
 *  257자 이름은 여기를 지나 엔진에 닿아 「길이 257자 — 최대 256자」를 받는다. 1024 면 엔진의 제안 루프도 1 ms 안이다 */
export const MAX_FIELD_CHARS = 1024;

/** 상한을 넘는 문자열 필드마다 오류 한 건. 문자열이 아닌 값은 여기서 보지 않는다(모양 검사가 따로 본다) */
function tooLong(fields: Record<string, unknown>, max: number = MAX_FIELD_CHARS): ApiMessage[] {
  return Object.entries(fields)
    .filter(([, v]) => typeof v === 'string' && v.length > max)
    .map(([k]): ApiMessage => ({ code: 'request.field_too_long', field: k, params: { max } }));
}

/** 문맥 다섯 값의 상한 — 자유 입력 셋은 MAX_CONTEXT_CHARS, env · region 은 MAX_FIELD_CHARS. 오류 순서는 owner → system → purpose → env → region */
function contextTooLong(ctx: Record<string, unknown>): ApiMessage[] {
  const { owner, system, purpose, env, region } = ctx;
  return [...tooLong({ owner, system, purpose }, MAX_CONTEXT_CHARS), ...tooLong({ env, region })];
}

/** rules_version 핀 (D27 ⑴) — 없으면 통과. 문자열이 아니면(null 포함) 400 · 1024자 초과 400 · 지금 규칙 버전과 다르면(빈 문자열 포함) 409 */
function checkRulesVersion(body: Record<string, unknown>): { ok: false; rejection: Rejection } | undefined {
  if (!('rules_version' in body) || body.rules_version === undefined) return undefined;
  const v = body.rules_version;
  if (typeof v !== 'string') return reject([{ code: 'request.field_not_string', field: 'rules_version' }]);
  if (v.length > MAX_FIELD_CHARS) return reject(tooLong({ rules_version: v }));
  if (v !== RULES_REVISION) {
    // requested 는 다른 사용자 값처럼 80자로 자르고 보이지 않는 문자를 바꾼다. 문장(message)에는 넣지 않는다
    return reject([{ code: 'request.rules_version_mismatch', params: { requested: describe(v), current: RULES_REVISION } }], undefined, 409);
  }
  return undefined;
}

/** 오류 params 에 넣을 표시용 값 — 보이지 않는 문자를 \uXXXX 로 바꾼 뒤 80자까지. String() 은 호출 불가능한 toString 을 가진 객체({"toString":1})에서 던진다 */
function describe(v: unknown): string {
  let text: string;
  if (typeof v === 'string') text = v;
  else {
    try {
      text = JSON.stringify(v) ?? typeof v;
    } catch {
      text = typeof v;
    }
  }
  return clipForDisplay(text);
}

export function parseGenerateBody(body: unknown): Parsed<GenerateInput> {
  if (!isRecord(body)) return reject([{ code: 'request.body_not_object' }]);
  const pin = checkRulesVersion(body);
  if (pin) return pin;
  // parseContext 는 raw[f] 를 읽는다 — null 을 넘기면 던지므로 여기서 막는다
  if (!isRecord(body.context)) return reject([{ code: 'request.context_not_object' }]);
  const long = contextTooLong(body.context);
  if (long.length > 0) return reject(long);
  // 생략하면 켜진 CSP 전부 (D45)
  let providers: Provider[] = [...ENABLED_PROVIDERS];
  if (body.providers !== undefined) {
    if (!Array.isArray(body.providers)) return reject([{ code: 'request.providers_not_array' }], enabledList());
    if (body.providers.length === 0) return reject([{ code: 'request.providers_empty' }], enabledList());
    // 틀린 값마다 메시지 하나 — field 는 원래 배열의 자리 (D23). 모르는 값과 꺼진 값을 자리 순서대로 함께 낸다
    const wrong = body.providers.flatMap((p, i): ApiMessage[] => {
      const e = providerError(p, `providers[${i}]`);
      return e ? [e] : [];
    });
    if (wrong.length > 0) return reject(wrong, enabledList());
    providers = [...new Set(body.providers.filter(isProvider))];
  }
  // 지역은 CSP 마다 다른 표로 푼다 (D49) — 하나라도 실패하면 400. 같은 오류 · 기록은 한 번만 싣는다
  const contexts: Partial<Record<Provider, NamingContext>> = {};
  const errors: CoreMessage[] = [];
  const transformed: CoreMessage[] = [];
  const addOnce = (into: CoreMessage[], ms: readonly CoreMessage[]) => {
    for (const m of ms) if (!into.some((x) => JSON.stringify(x) === JSON.stringify(m))) into.push(m);
  };
  for (const p of providers) {
    const parsed = parseContext(body.context as RawContext, p);
    if (!parsed.ok) { addOnce(errors, parsed.errors); continue; }
    contexts[p] = parsed.context;
    addOnce(transformed, parsed.transformed);
  }
  if (errors.length > 0) return reject(errors);
  return { ok: true, value: { contexts, transformed, providers } };
}

export function parseValidateBody(body: unknown): Parsed<ValidateInput> {
  if (!isRecord(body)) return reject([{ code: 'request.body_not_object' }]);
  const pin = checkRulesVersion(body);
  if (pin) return pin;
  const { provider, resource_type: resourceType, name } = body;
  const long = tooLong({ provider, resource_type: resourceType, name });
  if (long.length > 0) return reject(long);
  const bad = providerError(provider, 'provider');
  if (bad || !isProvider(provider)) return reject(bad ? [bad] : [], enabledList());
  const types = rulesFor(provider).map((r) => r.resourceType);
  if (typeof resourceType !== 'string' || !types.includes(resourceType)) {
    return reject([unsupported(resourceType, 'resource_type')], types);
  }
  if (typeof name !== 'string') return reject([{ code: 'request.field_not_string', field: 'name' }]);
  return { ok: true, value: { provider, resourceType, name } };
}

export function parseEventBody(body: unknown): Parsed<EventInput> {
  if (!isRecord(body)) return reject([{ code: 'request.body_not_object' }]);
  const event = body.event;
  const long = tooLong({ event });
  if (long.length > 0) return reject(long);
  if (typeof event !== 'string' || !(UI_EVENTS as readonly string[]).includes(event)) {
    return reject([unsupported(event, 'event')], [...UI_EVENTS]);
  }
  if (event !== 'ui_copy') return { ok: true, value: { event: event as UiEvent } };
  const target = body.target;
  const longTarget = tooLong({ target });
  if (longTarget.length > 0) return reject(longTarget);
  if (typeof target !== 'string' || !(UI_COPY_TARGETS as readonly string[]).includes(target)) {
    return reject([unsupported(target, 'target')], [...UI_COPY_TARGETS]);
  }
  return { ok: true, value: { event, target: target as UiCopyTarget } };
}

/** selection 오류의 사용자 값(value)을 원래 입력에서 다시 만든다 — 80자 · 보이지 않는 문자 · 비문자열은 JSON (다른 요청 오류와 같은 표시 · 8775326) */
function echoSafe(m: CoreMessage, resources: unknown[]): CoreMessage {
  const entry = (i: number): Record<string, unknown> => (isRecord(resources[i]) ? resources[i] : {});
  if (m.code === 'selection.unknown_type') return { ...m, params: { ...m.params, value: describe(entry(m.params.index).type) } };
  if (m.code === 'selection.invalid_role') return { ...m, params: { ...m.params, value: describe(entry(m.params.index).role) } };
  if (m.code === 'selection.unknown_kind') return { ...m, params: { ...m.params, value: describe(entry(m.params.index).kind) } };
  return m;
}

/** POST /v1/names (D39) — provider · context 는 모양을 보고, resources 는 core validateSelection 에 넘겨 selection.* 를 그대로 싣는다 */
export function parseNamesBody(body: unknown): Parsed<NamesInput> {
  if (!isRecord(body)) return reject([{ code: 'request.body_not_object' }]);
  const pin = checkRulesVersion(body);
  if (pin) return pin;
  const { provider } = body;
  const longProvider = tooLong({ provider });
  if (longProvider.length > 0) return reject(longProvider);
  const badProvider = providerError(provider, 'provider');
  if (badProvider || !isProvider(provider)) return reject(badProvider ? [badProvider] : [], enabledList());
  if (!isRecord(body.context)) return reject([{ code: 'request.context_not_object' }]);
  const resources = Array.isArray(body.resources) ? (body.resources as unknown[]) : [];
  // 항목 안 문자열도 전송 위생 상한을 건다 — 1024 를 넘는 type · role · kind 를 엔진까지 보내지 않는다
  const long = [
    ...contextTooLong(body.context),
    ...resources.flatMap((r, i) => (isRecord(r) ? tooLong({ [`resources[${i}].type`]: r.type, [`resources[${i}].role`]: r.role, [`resources[${i}].kind`]: r.kind }) : [])),
  ];
  if (long.length > 0) return reject(long);

  const parsed = parseContext(body.context as RawContext, provider);
  const selection = validateSelection(provider, body.resources);
  // 문맥 오류와 선택 오류를 함께 — 한 번에 고칠 수 있게. 문맥이 먼저다
  const errors: Message[] = [...(parsed.ok ? [] : parsed.errors), ...(selection.ok ? [] : selection.errors.map((m) => echoSafe(m, resources)))];
  if (!parsed.ok || !selection.ok) {
    const unknownType = errors.some((m) => m.code === 'selection.unknown_type');
    return reject(errors, unknownType ? rulesFor(provider).map((r) => r.resourceType) : undefined);
  }
  return { ok: true, value: { provider, context: parsed.context, transformed: parsed.transformed, items: selection.items } };
}
