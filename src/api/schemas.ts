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

export function parseGenerateBody(body: unknown): Parsed<GenerateInput> {
  if (!isRecord(body)) return reject(['본문은 JSON 객체여야 한다']);
  // parseContext 는 raw[f] 를 읽는다 — null 을 넘기면 던지므로 여기서 막는다
  if (!isRecord(body.context)) return reject(['context 는 객체여야 한다']);
  let providers: Provider[] = [...PROVIDERS];
  if (body.providers !== undefined) {
    if (!Array.isArray(body.providers)) return reject(['providers 는 배열이어야 한다'], [...PROVIDERS]);
    if (body.providers.length === 0) return reject(['providers 가 비어 있다'], [...PROVIDERS]);
    const unknown = body.providers.filter((p) => !isProvider(p));
    if (unknown.length > 0) return reject([`지원하지 않는 provider: ${unknown.map(String).join(', ')}`], [...PROVIDERS]);
    providers = [...new Set(body.providers.filter(isProvider))];
  }
  const parsed = parseContext(body.context as RawContext);
  if (!parsed.ok) return reject(parsed.errors);
  return { ok: true, value: { context: parsed.context, transformed: parsed.transformed, providers } };
}

export function parseValidateBody(body: unknown): Parsed<ValidateInput> {
  if (!isRecord(body)) return reject(['본문은 JSON 객체여야 한다']);
  const { provider, resource_type: resourceType, name } = body;
  if (!isProvider(provider)) return reject([`지원하지 않는 provider: ${String(provider)}`], [...PROVIDERS]);
  const types = rulesFor(provider).map((r) => r.resourceType);
  if (typeof resourceType !== 'string' || !types.includes(resourceType)) {
    return reject([`지원하지 않는 resource_type: ${String(resourceType)}`], types);
  }
  if (typeof name !== 'string') return reject(['name 은 문자열이어야 한다']);
  return { ok: true, value: { provider, resourceType, name } };
}

export function parseEventBody(body: unknown): Parsed<UiEvent> {
  if (!isRecord(body)) return reject(['본문은 JSON 객체여야 한다']);
  const event = body.event;
  if (typeof event !== 'string' || !(UI_EVENTS as readonly string[]).includes(event)) {
    return reject([`지원하지 않는 event: ${String(event)}`], [...UI_EVENTS]);
  }
  return { ok: true, value: event as UiEvent };
}
