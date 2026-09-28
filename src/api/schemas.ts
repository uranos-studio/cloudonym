// 요청 본문 검증 — 모양(shape)만 본다. 값의 뜻은 엔진(parseContext · rulesFor)이 판정한다. 의존성 추가 없음(수작업 타입 가드)
import { PROVIDERS, type NamingContext, type Provider, type RawContext } from '../core/types';
import { rulesFor } from '../core/constraints';
import { parseContext } from '../core/engine';

/** 400 응답 본문 — 모든 경로가 같은 꼴 */
export interface Rejection { success: false; errors: string[]; supported?: string[] }
export type Parsed<T> = { ok: true; value: T } | { ok: false; body: Rejection };

export interface GenerateInput { context: NamingContext; transformed: string[]; providers: Provider[] }
export interface ValidateInput { provider: Provider; resourceType: string; name: string }
export const UI_EVENTS = ['ui_visit', 'ui_generate', 'ui_copy'] as const;
export type UiEvent = (typeof UI_EVENTS)[number];

function reject(errors: string[], supported?: string[]): { ok: false; body: Rejection } {
  return { ok: false, body: { success: false, errors, ...(supported ? { supported } : {}) } };
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isProvider(v: unknown): v is Provider {
  return typeof v === 'string' && (PROVIDERS as readonly string[]).includes(v);
}

/** 문자열 필드 길이 상한 — 이름 규칙이 아니라 전송 위생이다(최종 리뷰 I-1). 규칙 표의 최대 max_length 는 256 이라
 *  257자 이름은 여기를 지나 엔진에 닿아 「길이 257자 — 최대 256자」를 받는다. 1024 면 엔진의 제안 루프도 1 ms 안이다 */
export const MAX_FIELD_CHARS = 1024;

/** 상한을 넘는 문자열 필드마다 오류 한 줄. 문자열이 아닌 값은 여기서 보지 않는다(모양 검사가 따로 본다) */
function tooLong(fields: Record<string, unknown>): string[] {
  return Object.entries(fields)
    .filter(([, v]) => typeof v === 'string' && v.length > MAX_FIELD_CHARS)
    .map(([k]) => `${k}: ${MAX_FIELD_CHARS}자를 넘는다`);
}

/** 오류 문구에 넣을 값 — 80자까지. String() 은 호출 불가능한 toString 을 가진 객체({"toString":1})에서 던진다(최종 리뷰 I-2) */
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
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

export function parseGenerateBody(body: unknown): Parsed<GenerateInput> {
  if (!isRecord(body)) return reject(['본문은 JSON 객체여야 한다']);
  // parseContext 는 raw[f] 를 읽는다 — null 을 넘기면 던지므로 여기서 막는다
  if (!isRecord(body.context)) return reject(['context 는 객체여야 한다']);
  const { owner, system, purpose, env, region } = body.context;
  const long = tooLong({ owner, system, purpose, env, region });
  if (long.length > 0) return reject(long);
  let providers: Provider[] = [...PROVIDERS];
  if (body.providers !== undefined) {
    if (!Array.isArray(body.providers)) return reject(['providers 는 배열이어야 한다'], [...PROVIDERS]);
    if (body.providers.length === 0) return reject(['providers 가 비어 있다'], [...PROVIDERS]);
    const unknown = body.providers.filter((p) => !isProvider(p));
    if (unknown.length > 0) return reject([`지원하지 않는 provider: ${unknown.map(describe).join(', ')}`], [...PROVIDERS]);
    providers = [...new Set(body.providers.filter(isProvider))];
  }
  const parsed = parseContext(body.context as RawContext);
  if (!parsed.ok) return reject(parsed.errors);
  return { ok: true, value: { context: parsed.context, transformed: parsed.transformed, providers } };
}

export function parseValidateBody(body: unknown): Parsed<ValidateInput> {
  if (!isRecord(body)) return reject(['본문은 JSON 객체여야 한다']);
  const { provider, resource_type: resourceType, name } = body;
  const long = tooLong({ provider, resource_type: resourceType, name });
  if (long.length > 0) return reject(long);
  if (!isProvider(provider)) return reject([`지원하지 않는 provider: ${describe(provider)}`], [...PROVIDERS]);
  const types = rulesFor(provider).map((r) => r.resourceType);
  if (typeof resourceType !== 'string' || !types.includes(resourceType)) {
    return reject([`지원하지 않는 resource_type: ${describe(resourceType)}`], types);
  }
  if (typeof name !== 'string') return reject(['name 은 문자열이어야 한다']);
  return { ok: true, value: { provider, resourceType, name } };
}

export function parseEventBody(body: unknown): Parsed<UiEvent> {
  if (!isRecord(body)) return reject(['본문은 JSON 객체여야 한다']);
  const event = body.event;
  const long = tooLong({ event });
  if (long.length > 0) return reject(long);
  if (typeof event !== 'string' || !(UI_EVENTS as readonly string[]).includes(event)) {
    return reject([`지원하지 않는 event: ${describe(event)}`], [...UI_EVENTS]);
  }
  return { ok: true, value: event as UiEvent };
}
