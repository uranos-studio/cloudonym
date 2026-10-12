// 요청 본문 검증 — 모양(shape)만 본다. 값의 뜻은 엔진(parseContext · rulesFor)이 판정한다. 의존성 추가 없음(수작업 타입 가드)
import { ENABLED_PROVIDERS, PROVIDERS, type NamingContext, type ProjectContext, type Provider, type RawContext } from '../core/types';
import { rulesFor } from '../core/constraints';
import { MAX_CONTEXT_CHARS, parseContext, parseProjectContext, serviceNamespace, type ProjectSelection } from '../core/engine';
import { expandPlan, validatePlan, PROJECT_ID_RULE, type PlanError, type WizardPlan } from '../core/wizard/plan';
import { presetOf } from '../core/wizard/presets';
import { RULES_REVISION } from '../core/revision';
import { validateSelection, type SelectionItem } from '../core/selection';
import { locationError } from '../core/regions';
import type { CoreMessage } from '../core/messages';
import type { ApiMessage } from './codes';
import type { WireMessage } from './serialize';
import type { Message } from '../messages/catalog';
import { clipForDisplay } from '../core/display';

/** 거부 — 상태 코드와 메시지 코드. 응답 본문은 라우터가 fail() 로 만든다 (D25) */
export interface Rejection { status: 400 | 409; errors: Message[]; supported?: string[] }
export type Parsed<T> = { ok: true; value: T } | { ok: false; rejection: Rejection };

/** contexts — 지역을 CSP 마다 풀어(D49) provider 마다 문맥 하나. transformed 는 provider 순서로 모은 것(같은 기록은 한 번) */
export interface GenerateInput { contexts: Partial<Record<Provider, NamingContext>>; transformed: CoreMessage[]; providers: Provider[] }
export interface NamesInput { provider: Provider; context: NamingContext; transformed: CoreMessage[]; items: SelectionItem[] }
/** POST /v1/wizard (D66) — 펼친 선택 · 문맥 정규화 기록 · 라벨을 만들 문맥(이름공간마다) · 텔레메트리용 pick 수 */
export interface WizardInput {
  provider: Provider; selection: ProjectSelection; transformed: CoreMessage[];
  labelContexts: { namespace: string; context: NamingContext | ProjectContext }[]; pickCount: number;
  /** 고른 규칙 id — 칩 · Custom (D71). 계측만 쓴다 */
  pickedRules: { chip: string[]; custom: string[] };
}
export interface ValidateInput { provider: Provider; resourceType: string; name: string }
export const UI_EVENTS = ['ui_visit', 'ui_generate', 'ui_copy'] as const;
export type UiEvent = (typeof UI_EVENTS)[number];
/** ui_copy 의 target — 어느 복사 버튼인가 (D56). 항목 키 · 리소스 종류는 싣지 않는다. 화면 쪽 같은 목록은 beacon.ts 의 COPY_TARGETS(beacon.test 가 둘을 대어 본다) */
export const UI_COPY_TARGETS = ['share-url', 'name', 'all-names', 'names-json', 'terraform', 'tags-json'] as const;
export type UiCopyTarget = (typeof UI_COPY_TARGETS)[number];
/** 비콘 한 건 — target 은 ui_copy 에만 있다. 다른 이벤트에 온 target 은 버린다 */
/** chip_rules · custom_rules 는 ui_generate 에서만 그대로 넘긴다 — 거르기는 telemetry.ts 의 ruleIdList 한 곳이 한다 (D71) */
export interface EventInput { event: UiEvent; target?: UiCopyTarget; rules?: { chip_rules?: unknown; custom_rules?: unknown } }

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
    // 멀티 · 이중 리전 위치(US …)는 받는 규칙에만 — /v1/generate 는 규칙 전부라 늘 거부한다 (D78)
    const loc = locationError(parsed.context.region, rulesFor(p));
    if (loc) { addOnce(errors, [loc]); continue; }
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
  if (event === 'ui_generate') {
    const rules: NonNullable<EventInput['rules']> = {};
    for (const k of ['chip_rules', 'custom_rules'] as const) if (Object.hasOwn(body, k)) rules[k] = body[k];
    return { ok: true, value: Object.keys(rules).length > 0 ? { event, rules } : { event } };
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
  // 멀티 · 이중 리전 위치(US …)는 그 위치를 받는 리소스만 고른 요청에서만 (D78)
  const loc = locationError(parsed.context.region, selection.items.map((i) => i.rule));
  if (loc) return reject([loc]);
  return { ok: true, value: { provider, context: parsed.context, transformed: parsed.transformed, items: selection.items } };
}

/** 모델 경로의 이름 → 요청 본문의 이름 (§5-5 표) — 표에 없는 글자는 같다 */
export const WIRE_PATH_NAMES: Readonly<Record<string, string>> = { projectPicks: 'project_picks', ruleId: 'rule', projectIdSuffix: 'project_id_suffix' };

/** validatePlan 의 path(모델 표기)를 응답 field(요청 본문 표기)로 — `projectPicks[0].instances[0]` → `project_picks[0].instances[0]` */
export function toWirePath(path: string): string {
  return path.replace(/[A-Za-z_]+/g, (seg) => (Object.hasOwn(WIRE_PATH_NAMES, seg) ? WIRE_PATH_NAMES[seg]! : seg));
}

/** pick 하나의 문자열 칸 상한 — field 는 wire 경로. 객체가 아니면 여기서 보지 않는다(validatePlan 이 본다) */
function pickTooLong(p: unknown, base: string): ApiMessage[] {
  if (!isRecord(p)) return [];
  const own = tooLong(Object.fromEntries(['preset', 'rule', 'tier', 'role', 'kind', 'serverless', 'location'].map((k) => [`${base}.${k}`, p[k]])));
  const slots = Array.isArray(p.instances) ? (p.instances as unknown[]) : [];
  return [...own, ...slots.flatMap((s, k) => {
    if (!isRecord(s)) return [];
    const at = `${base}.instances[${k}]`;
    const data = isRecord(s.attach) && Array.isArray(s.attach.data) ? (s.attach.data as unknown[]) : [];
    return [...tooLong({ [`${at}.id`]: s.id, [`${at}.seq`]: s.seq }), ...data.flatMap((d, i) => tooLong({ [`${at}.attach.data[${i}]`]: d }))];
  })];
}

/** 요청 본문 pick → 모델 Pick — 아는 칸만 옮긴다(rule → ruleId). preset 이 없으면 custom(null). 객체가 아니면 그대로 넘겨 validatePlan 이 거부한다 */
function toModelPick(p: unknown): unknown {
  if (!isRecord(p)) return p;
  const out: Record<string, unknown> = { preset: p.preset === undefined ? null : p.preset };
  if (p.rule !== undefined) out.ruleId = p.rule;
  for (const k of ['tier', 'role', 'kind', 'ha', 'serverless', 'instances', 'location']) if (p[k] !== undefined) out[k] = p[k];
  return out;
}

/** 목록 칸 — 없으면 빈 목록, 배열이면 칸마다 바꾸고, 배열이 아니면 그대로(validatePlan 의 selection.not_array) */
function listOf(v: unknown, map: (x: unknown) => unknown): unknown {
  if (v === undefined) return [];
  return Array.isArray(v) ? v.map(map) : v;
}

/** 모델 경로(services[1].picks[0].instances[1].attach.data[0])가 가리키는 값 — 없으면 undefined */
function atPath(root: unknown, path: string): unknown {
  let node: unknown = root;
  for (const [, key, index] of path.matchAll(/([A-Za-z_]+)|\[(\d+)\]/g)) {
    if (key !== undefined) node = isRecord(node) && Object.hasOwn(node, key) ? node[key] : undefined;
    else node = Array.isArray(node) ? node[Number(index)] : undefined;
  }
  return node;
}

/** 코드마다 사용자 값(value)이 온 칸 — path 가 가리키는 요소(pick · 슬롯 · 디스크 순번)에서 읽는다. null 이면 요소 자체다 */
const VALUE_FIELD: Readonly<Record<string, string | null>> = {
  'wizard.unknown_preset': 'preset', 'selection.unknown_type': 'ruleId', 'selection.unknown_kind': 'kind', 'selection.invalid_role': 'role',
  'wizard.invalid_tier': 'tier', 'wizard.invalid_slot_id': 'id', 'wizard.invalid_seq': 'seq', 'wizard.invalid_data_seq': null, 'wizard.invalid_location': 'location',
  'wizard.location_needs_region': 'location', 'wizard.invalid_project_id_suffix': null, 'wizard.project_id_suffix_reserved': null,
};

/** validatePlan 오류 → API 오류. path 가 있으면 field = wire 경로, 프로젝트 문맥 오류(path 없음)는 field 에 project. 접두,
 *  모델 전체 오류는 field 없음. 되돌리는 사용자 값(value)은 /v1/names 의 echoSafe 처럼 원래 입력에서 다시 만든다(80자 · JSON · 보이지 않는 문자 표시) —
 *  core 의 문자열화는 객체를 [object Object] 로 낸다 */
function toApiError(e: PlanError, plan: unknown): Message {
  const { path, ...m } = e;
  const p: unknown = 'params' in m ? m.params : undefined;
  let params = {};
  if (isRecord(p) && 'value' in p) {
    const at = path === undefined ? undefined : atPath(plan, path);
    const source = Object.hasOwn(VALUE_FIELD, m.code) ? VALUE_FIELD[m.code] : undefined;
    const raw = source === undefined ? p.value : source === null ? at : isRecord(at) ? at[source] : p.value;
    params = { params: { ...p, value: describe(raw) } };
  }
  if (path !== undefined) return { ...m, ...params, field: toWirePath(path) } as Message;
  if (m.code.startsWith('context.') && 'field' in m) return { ...m, ...params, field: `project.${m.field}` } as Message;
  return { ...m, ...params } as Message;
}

/** 객체가 아닌 서비스는 오류 하나 — core 는 같은 자리에 empty_service 와 not_array 를 함께 낸다 */
function mergeServiceShape(errors: Message[], services: unknown): Message[] {
  if (!Array.isArray(services)) return errors;
  const bad = new Set(services.flatMap((s, i) => (isRecord(s) ? [] : [`services[${i}]`])));
  if (bad.size === 0) return errors;
  const out: Message[] = [];
  for (const m of errors) {
    const field = 'field' in m ? m.field : undefined;
    if (field !== undefined && bad.has(field)) {
      if (!out.some((x) => 'field' in x && x.field === field)) out.push({ code: 'selection.item_not_object', params: { index: Number(/\d+/.exec(field)![0]) }, field } as Message);
      continue;
    }
    out.push(m);
  }
  return out;
}

/** /v1/wizard 오류 문장의 위치를 요청 본문의 이름으로 — core 문장은 resources[i] · picks[i] 로 시작한다(한 항목 목록 · 한 pick 목록의 자리).
 *  field 가 있으면 그 자리를 field 로 바꾸고, 목록 모양 오류는 목록 이름을 요청 이름으로 쓴다 */
export function wizardSentence(w: WireMessage): WireMessage {
  if (w.code === 'selection.not_array') {
    const message = w.field === undefined ? "'services' and 'project_picks' must be arrays" : `'${w.field}.picks' must be an array`;
    return { ...w, message };
  }
  if (w.field === undefined) return w;
  return { ...w, message: w.message.replace(/^(resources|picks)\[\d+\]/, w.field) };
}

/** 고른 규칙 id (D71) — 칩(프리셋)은 유효 규칙(serverless 를 켜면 그 규칙), Custom 은 ruleId. 검사를 지난 plan 에 부른다.
 *  화면의 components/pickedRules.ts pickedRuleIds 와 같은 일이다(같은지 privacy-sync.test 가 본다). 엔진 밖에 둔다 — src/core 를 고치면 규칙 버전이 바뀐다 */
export function wizardPickedRules(plan: WizardPlan): { chip: string[]; custom: string[] } {
  const chip = new Set<string>();
  const custom = new Set<string>();
  for (const pick of [...plan.projectPicks, ...plan.services.flatMap((s) => s.picks)]) {
    if (pick.preset === null) {
      if (typeof pick.ruleId === 'string' && pick.ruleId !== PROJECT_ID_RULE) custom.add(pick.ruleId);
      continue;
    }
    const preset = presetOf(pick.preset);
    if (!preset) continue;
    const sv = typeof pick.serverless === 'string' && preset.serverless?.ruleIds.includes(pick.serverless) ? pick.serverless : undefined;
    chip.add(sv ?? preset.ruleId);
  }
  return { chip: [...chip].sort(), custom: [...custom].sort() };
}

/** POST /v1/wizard (D66) — 모양 · 길이는 여기, 마법사 검사는 core validatePlan 하나, 서비스마다 문맥(purpose 포함)은 parseContext */
export function parseWizardBody(body: unknown): Parsed<WizardInput> {
  if (!isRecord(body)) return reject([{ code: 'request.body_not_object' }]);
  const pin = checkRulesVersion(body);
  if (pin) return pin;
  const { provider } = body;
  const longProvider = tooLong({ provider });
  if (longProvider.length > 0) return reject(longProvider);
  const badProvider = providerError(provider, 'provider');
  if (badProvider || !isProvider(provider)) return reject(badProvider ? [badProvider] : [], enabledList());
  const project = body.project;
  if (!isRecord(project)) return reject([{ code: 'request.context_not_object' }]);

  // 전송 위생 — 문맥 넷 · purpose · pick 의 문자열. 엔진까지 보내지 않는다
  const services = Array.isArray(body.services) ? (body.services as unknown[]) : [];
  const projectPicks = Array.isArray(body.project_picks) ? (body.project_picks as unknown[]) : [];
  const long = [
    ...tooLong({ 'project.owner': project.owner, 'project.system': project.system }, MAX_CONTEXT_CHARS),
    ...tooLong({ 'project.env': project.env, 'project.region': project.region, project_id_suffix: body.project_id_suffix }),
    ...projectPicks.flatMap((p, j) => pickTooLong(p, `project_picks[${j}]`)),
    ...services.flatMap((s, i) => (isRecord(s) ? [
      ...tooLong({ [`services[${i}].purpose`]: s.purpose }, MAX_CONTEXT_CHARS),
      ...(Array.isArray(s.picks) ? (s.picks as unknown[]).flatMap((p, j) => pickTooLong(p, `services[${i}].picks[${j}]`)) : []),
    ] : [])),
  ];
  if (long.length > 0) return reject(long);

  const raw = { owner: project.owner, system: project.system, env: project.env, region: project.region };
  const plan = {
    provider, project: raw,
    projectPicks: listOf(body.project_picks, toModelPick),
    services: listOf(body.services, (s) => (isRecord(s) ? { purpose: s.purpose, picks: listOf(s.picks, toModelPick) } : s)),
    // 프로젝트 ID 접미사 (D85) — 없으면 싣지 않는다. 꼴 · 예약어는 validatePlan 이 본다(null 도 거기서 거부된다)
    ...(Object.hasOwn(body, 'project_id_suffix') ? { projectIdSuffix: body.project_id_suffix } : {}),
  } as unknown as WizardPlan;
  const checked = validatePlan(plan);
  if (!checked.ok) {
    const unknownType = checked.errors.some((m) => m.code === 'selection.unknown_type');
    return reject(mergeServiceShape(checked.errors.map((e) => toApiError(e, plan)), plan.services), unknownType ? rulesFor('gcp').map((r) => r.id) : undefined);
  }

  // 서비스마다 다섯 값 문맥 — 프로젝트 넷은 이미 지났으므로 오류는 purpose 의 것이다(field services[i].purpose)
  const proj = parseProjectContext(raw, provider);
  if (!proj.ok) return reject(proj.errors.map((e) => toApiError(e, plan)));
  const transformed: CoreMessage[] = [];
  const addOnce = (ms: readonly CoreMessage[]) => {
    for (const m of ms) if (!transformed.some((x) => JSON.stringify(x) === JSON.stringify(m))) transformed.push(m);
  };
  addOnce(proj.transformed);
  const labelContexts: WizardInput['labelContexts'] = [{ namespace: 'project', context: proj.context }];
  const errors: Message[] = [];
  plan.services.forEach((s, i) => {
    const r = parseContext({ ...raw, purpose: s.purpose }, provider);
    if (!r.ok) {
      errors.push(...r.errors.map((e) => ('field' in e ? { ...e, field: e.field === 'purpose' ? `services[${i}].purpose` : `project.${e.field}` } : e) as Message));
      return;
    }
    addOnce(r.transformed);
    labelContexts.push({ namespace: serviceNamespace(s.purpose), context: r.context });
  });
  if (errors.length > 0) return reject(errors);

  const selection = expandPlan(plan);
  const pickCount = plan.projectPicks.length + plan.services.reduce((n, s) => n + s.picks.length, 0);
  return { ok: true, value: { provider, selection, transformed, labelContexts, pickCount, pickedRules: wizardPickedRules(plan) } };
}
