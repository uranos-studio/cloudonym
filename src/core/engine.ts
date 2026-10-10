// 엔진 공개 API — API 와 화면은 generate · validateName · parseContext · generateMany 넷을 부른다 (선택 검증은 selection.ts)
import { PROVIDERS, type GenerateOutput, type NameResult, type NamingContext, type ProjectContext, type Provider, type RawContext, type ResourceRule, type Token } from './types';
import { RULES, getRule, rulesFor } from './constraints';
import { ENV_VALUES, canonicalEnv, normalizeToken } from './normalize';
import { canonicalRegion, regionCandidates } from './regions';
import { compose, kindTokenOfRule, tokenValues, type ItemExtra } from './compose';
import { findConflicts } from './conflict';
import type { InstanceSlot, SelectionItem } from './selection';
import { inputKind } from './tree';
import { fit } from './truncate';
import { checkName } from './validate';
import type { CoreMessage, ContextField } from './messages';
import { clipForDisplay } from './display';
import { attachmentRow, type AttachKind } from './wizard/attachments';

/** 결과에 싣는 규칙 요약 — 규칙 표의 notes 를 참조로 넘기지 않는다(호출자가 결과를 고쳐도 규칙 표가 바뀌지 않게) */
function ruleInfo(rule: ResourceRule): NameResult['rule'] {
  return { minLength: rule.minLength, maxLength: rule.maxLength, pattern: rule.pattern.source, patternFlags: rule.pattern.flags, allowed: rule.allowed, docUrl: rule.docUrl,
           notes: (rule.notes ?? []).map((m) => structuredClone(m)) };
}

function generateOne(ctx: NamingContext | ProjectContext, rule: ResourceRule, extra: ItemExtra = {}): NameResult {
  const raw = tokenValues(ctx, rule, extra);
  const steps: CoreMessage[] = [];
  let transformed = false;
  const values: Partial<Record<Token, string>> = {};
  for (const t of rule.template) {
    const before = raw[t] ?? '';
    const { value, changed } = normalizeToken(before, rule.allowed);
    values[t] = value;
    if (changed) { transformed = true; steps.push({ code: 'step.normalized', field: t, params: { from: clipForDisplay(before), to: clipForDisplay(value) } }); }
  }
  // 구분자를 쓰지 않는 규칙은 토큰 사이 하이픈이 빠진다 (D15)
  if (rule.separator === '' && rule.template.length >= 2) { transformed = true; steps.push({ code: 'step.separator_removed' }); }

  const base = {
    ruleId: rule.id, resourceType: rule.resourceType, displayName: rule.displayName,
    original: compose(raw, rule.template, rule.separator),
    isTransformed: transformed,
    rule: ruleInfo(rule),
  };

  // 필수 토큰이 정제 뒤 비면 compose 가 건너뛰어 엉뚱한 「유효」 이름이 나온다. 만들지 않는다.
  // 종류 자리는 비는 것이 정상이다 — 종류를 주지 않았거나 기본값이면 토큰이 없다 (D52). 필수 종류는 아래 kind_required 가 본다.
  // 용도 자리는 주지 않았을 때만 비어도 된다 (D60) — 준 tier 가 정제 뒤 비면 빈 토큰이다(떼고 유효로 내지 않는다).
  // 프로젝트 수준 항목에는 purpose 자리가 없다 (D63)
  const emptied = rule.template.filter((t) => t !== 'kind' && !(t === 'tier' && extra.tier === undefined) && !(t === 'purpose' && extra.level === 'project')
                                             && !rule.optional.includes(t) && !values[t]);
  if (emptied.length > 0) {
    return { ...base, name: '', valid: false, isTruncated: false, violations: emptied.map((t): CoreMessage => ({ code: 'name.token_empty', field: t })), steps };
  }

  const f = fit(values, rule);
  steps.push(...f.steps);
  // 축소 실패면 이유는 그 하나만 (checkName 을 부르지 않는다)
  const violations: CoreMessage[] = f.fits ? checkName(f.name, rule) : [{ code: 'name.cannot_fit', params: { max: rule.maxLength } }];
  // 종류가 필수인 규칙(리소스 정책)에 종류가 없다 (D52) — generate · generateMany 둘 다 여기를 지난다.
  // 이름 · 단계는 종류 없이 만든 그대로 두고 판정만 FAIL 로 한다(쓸 수 있는 이름이 아니다)
  if (rule.kinds?.rule === 'required' && extra.kind === undefined) violations.unshift({ code: 'name.kind_required', params: { supported: [...rule.kinds.allowed] } });
  return { ...base, name: f.name, valid: violations.length === 0, isTruncated: f.truncated, violations, steps };
}

/** 항목 하나의 이름 — 용도 토큰 · 프로젝트 수준을 받는 진입점 (D60 · D63). 충돌 검사는 하지 않는다(부르는 쪽이 요청 전체로 한다).
 *  extra 가 없으면 generate 의 그 규칙 결과와 같다(충돌 표시 전). generateMany 는 이 함수를 거치지 않는다 — 옛 경로 그대로다.
 *  입력은 부르는 쪽이 이미 검사한 것이다 — tier 꼴(TIER_PATTERN) · 예약어 · level 을 받는 규칙인지는 마법사 모델의 검사가 본다.
 *  여기서는 조용히 버리지 않는다: 허용 밖 종류 · tier 자리가 없는 규칙(순번 없는 규칙)의 tier 는 던진다 — 이름에 들지 않은 tier 가
 *  항목에 실려 나가는 일이 없다. 준 tier 가 정제 뒤 비면 name.token_empty(field tier) 로 valid:false 다 */
export function generateItem(ctx: NamingContext | ProjectContext, rule: ResourceRule, extra: ItemExtra = {}): NameResult {
  if (extra.tier !== undefined && !rule.template.includes('tier')) throw new Error(`tier not supported: ${rule.id}`);
  return generateOne(ctx, rule, extra);
}

/** 같은 부류(entity)의 같은 이름을 찾아 그 항목마다 valid:false + name.conflict 를 단다 (D41 · D47). 요약(충돌마다 메시지 하나)을 돌려준다.
 *  generate · generateMany 가 같이 쓴다 — 항목 위반은 요약의 복사본이다 */
function markConflicts(items: readonly { key: string; rule: ResourceRule; result: NameResult }[]): CoreMessage[] {
  const conflicts = findConflicts(items);
  for (const c of conflicts) {
    if (c.code !== 'name.conflict') continue;
    for (const { key, result } of items) {
      if (!c.params.keys.includes(key)) continue;
      result.valid = false;
      result.violations.push(structuredClone(c));
    }
  }
  return conflicts;
}

/** 전체 카탈로그 — provider 마다 규칙 전부의 이름. 키는 resourceType 이고 충돌 검사도 그 키로 한다 */
export function generate(ctx: NamingContext, providers: Provider[] = [...PROVIDERS]): GenerateOutput {
  const out: GenerateOutput = {};
  for (const p of providers) {
    const items = rulesFor(p).map((rule) => ({ key: rule.resourceType, rule, result: generateOne(ctx, rule) }));
    markConflicts(items);
    out[p] = Object.fromEntries(items.map(({ key, result }) => [key, result]));
  }
  return out;
}

/** 항목 하나의 이름 — key 는 `${resourceType}_${seq}`(count 규칙) · `${resourceType}_${role}`(role 규칙, 생략이면 기본 역할) · resourceType(입력 없음).
 *  종류가 달라도 key 는 같은 꼴이다(한 행에 종류 하나 — D52).
 *  kind 는 고른 값 이름(POSTGRES) · kindToken 은 이름에 넣은 토큰(pg) — 기본값 · omitValues 를 고르면 kind 만 있고 kindToken 은 없다 (D52) */
export interface NameItem extends NameResult {
  key: string; seq?: string; role?: string; kind?: string; kindToken?: string; tier?: string; level?: 'project';
  /** generateProject 만 — 이름공간('project' 또는 정제된 purpose) · 딸린 것이면 부모 key 와 접미 종류 (D62 · D69) */
  namespace?: string; parent?: string; attach?: AttachKind;
}
export interface ManyResult { provider: Provider; valid: boolean; items: NameItem[]; conflicts: CoreMessage[] }

/** 순번은 두 자리 고정 (D40) — 한 항목의 이름이 같은 자리수를 써서 축소 경로가 같다 */
const seqOf = (i: number): string => String(i).padStart(2, '0');
/** role 규칙에 역할을 주지 않았을 때의 역할 — 화면의 공유 hash 도 이 값을 문자열로 적는다 (D42) */
export const DEFAULT_ROLE = 'sync';

/** 고른 항목마다 이름을 만든다 (D30' · D41). 선택은 validateSelection 을 거친 것이라 여기서 다시 검사하지 않는다.
 *  항목 순서 = 선택 순서 → 순번 순서. 입력 없는 · role 규칙은 count 와 무관하게 하나.
 *  같은 부류(entity)의 같은 이름은 그 항목마다 valid:false + name.conflict 이고, conflicts 는 그 요약이다 — 전체 valid 는 항목 전부의 valid 다 */
export function generateMany(ctx: NamingContext, provider: Provider, selection: readonly SelectionItem[]): ManyResult {
  const items: { item: NameItem; rule: ResourceRule }[] = [];
  for (const { rule, count, role, kind } of selection) {
    if (rule.provider !== provider) throw new Error(`rule ${rule.id} is not a ${provider} rule`);
    // 종류 — 허용 밖이면 여기서 던진다(validateSelection 을 거친 선택에는 없다)
    const token = kind === undefined ? null : kindTokenOfRule(rule, kind);
    const k: ItemExtra = kind === undefined ? {} : { kind };
    // 이름이 빈 항목(token_empty)에는 토큰을 싣지 않는다 — 이름에 들어가지 않은 토큰이다. 고른 값 이름은 남긴다
    const kindFields = (res: NameResult) => ({ ...(kind === undefined ? {} : { kind }), ...(token === null || res.name === '' ? {} : { kindToken: token }) });
    const one = (extra: ItemExtra, meta: { key: string; seq?: string; role?: string }): NameItem => {
      const res = generateOne(ctx, rule, { ...k, ...extra });
      return { ...res, ...meta, ...kindFields(res) };
    };
    const input = inputKind(rule);
    if (input === 'count') {
      for (let i = 1; i <= count; i++) {
        const seq = seqOf(i);
        items.push({ rule, item: one({ seq }, { key: `${rule.resourceType}_${seq}`, seq }) });
      }
    } else if (input === 'role') {
      const r = role ?? DEFAULT_ROLE;
      items.push({ rule, item: one({ role: r }, { key: `${rule.resourceType}_${r}`, role: r }) });
    } else {
      items.push({ rule, item: one({}, { key: rule.resourceType }) });
    }
  }

  const conflicts = markConflicts(items.map(({ item, rule }) => ({ key: item.key, rule, result: item })));
  const out = items.map(({ item }) => item);
  return { provider, valid: out.every((i) => i.valid), items: out, conflicts };
}

/** 프로젝트 한 번의 선택 (D69) — 프로젝트 수준 항목과 서비스(purpose)마다의 항목. 마법사 모델이 펼친 것이다(검사는 부르는 쪽) */
export interface ServiceSelection { purpose: string; items: readonly SelectionItem[] }
export interface ProjectSelection { project: ProjectContext; projectItems: readonly SelectionItem[]; services: readonly ServiceSelection[] }
export interface ProjectResult { provider: Provider; valid: boolean; items: NameItem[]; conflicts: CoreMessage[] }

/** 서비스의 이름공간 — 정제 뒤 purpose (키의 service 칸 · 라벨 맵 키) */
export function serviceNamespace(purpose: string): string {
  return normalizeToken(purpose, 'lower-digit-hyphen').value;
}

const PROJECT_NAMESPACE = 'project';

/** 구조 키 (D69) — generateProject 만 쓴다. `/` 로 이은 고정 길이 경로: 부모 `<level>/<service>/<type>/<tier|->/<seq|role|->`,
 *  자식은 그 뒤에 `/<attach>/<seq|->`. 어느 칸에도 `/` 가 올 수 없고 칸 수가 모양마다 고정이라 다른 항목이 같은 키가 될 수 없다.
 *  level 'project' 면 level 칸이 project · service 칸이 '-' 다. generateMany 의 키(compute_instance_01)와는 다른 함수다 */
export function projectItemKey(p: { level?: 'project'; namespace: string; type: string; tier?: string; slot?: string }, child?: { attach: AttachKind; seq?: string }): string {
  // level 칸은 level 에서 온다 — 정제 뒤 project 인 서비스 이름이 프로젝트 수준 키를 흉내 내지 못한다
  const head = p.level === 'project' ? 'project/-' : `service/${p.namespace}`;
  const parent = `${head}/${p.type}/${p.tier ?? '-'}/${p.slot ?? '-'}`;
  return child ? `${parent}/${child.attach}/${child.seq ?? '-'}` : parent;
}

/** 딸린 이름 (D62) — 부모의 최종 이름에 `-{attach}[-{seq}]` 를 더하고 checkName 만 돌린다(fit 을 부르지 않는다 — 자식을 줄이면 부모와 글자가 달라진다).
 *  부모가 valid:false 면 이름 '' + name.parent_invalid. 넘치면 checkName 의 name.too_long 을 name.cannot_fit 으로 바꾸고 name.parent_name 을 더한다.
 *  자식 규칙은 호환표에서 온다 — 표에 없는 짝은 던진다(마법사 모델 검사가 먼저 거른다) */
export function attachName(parent: NameItem, child: { attach: AttachKind; seq?: string }): NameItem {
  const row = attachmentRow(parent.ruleId, child.attach);
  if (!row) throw new Error(`attachment not supported: ${parent.ruleId} ${child.attach}`);
  if (row.seq !== (child.seq !== undefined)) throw new Error(`attachment sequence mismatch: ${child.attach}`);
  const rule = RULES[row.child];
  if (!rule) throw new Error(`attachment rule missing: ${row.child}`);
  const suffix = `-${child.attach}${child.seq === undefined ? '' : `-${child.seq}`}`;
  const meta = {
    key: `${parent.key}/${child.attach}/${child.seq ?? '-'}`, parent: parent.key, attach: child.attach,
    ...(child.seq === undefined ? {} : { seq: child.seq }), ...(parent.namespace === undefined ? {} : { namespace: parent.namespace }),
    ...(parent.level === undefined ? {} : { level: parent.level }),
  };
  const base = { ruleId: rule.id, resourceType: rule.resourceType, displayName: rule.displayName, isTruncated: false, isTransformed: false, steps: [], rule: ruleInfo(rule) };
  if (!parent.valid) {
    return { ...base, ...meta, name: '', original: '', valid: false, violations: [{ code: 'name.parent_invalid', params: { parent: parent.key } }] };
  }
  const name = `${parent.name}${suffix}`;
  const violations: CoreMessage[] = [];
  let tooLong = false;
  for (const v of checkName(name, rule)) {
    if (v.code === 'name.too_long') { tooLong = true; violations.push({ code: 'name.cannot_fit', params: { max: v.params.max } }); }
    else violations.push(v);
  }
  if (tooLong) violations.push({ code: 'name.parent_name', params: { parent: parent.name, suffix } });
  return { ...base, ...meta, name, original: name, valid: violations.length === 0, violations };
}

/** 프로젝트 한 번에 (D69) — 마감 순서가 계약이다:
 *  ① 부모 전부(프로젝트 ID · 프로젝트 수준 · 모든 서비스)를 만든다 ② 충돌 표시 한 번(전체) ③ 요청된 자식 전부 — 부모가 최종 valid 면 attachName,
 *  아니면 이름 '' + name.parent_invalid(항목은 반드시 나온다) ④ 충돌 표시 한 번 더 — 아직 valid 인 항목 전체(자식끼리 · 자식과 같은 부류의 부모)
 *  ⑤ valid = 항목 전부. 프로젝트 ID(project/-/project_id/-/-)는 늘 첫 항목이다. 순번은 슬롯의 값(instances[].seq)이고, 슬롯이 없으면 01…count.
 *  항목 순서 = 선택 순서 · 자식은 부모 바로 뒤(boot · data(준 순서) · ip · ipi). 입력은 마법사 모델 검사를 거친 것이다 */
export function generateProject(sel: ProjectSelection, provider: Provider): ProjectResult {
  const projectRule = getRule(provider, 'project_id');
  if (!projectRule) throw new Error(`no project_id rule for ${provider}`);
  type Built = { item: NameItem; rule: ResourceRule; children: { attach: AttachKind; seq?: string }[] };
  const parents: Built[] = [];

  const add = (ctx: NamingContext | ProjectContext, namespace: string, it: SelectionItem, level: 'project' | undefined) => {
    const { rule, count, role, kind, tier, instances } = it;
    if (rule.provider !== provider) throw new Error(`rule ${rule.id} is not a ${provider} rule`);
    const token = kind === undefined ? null : kindTokenOfRule(rule, kind);
    const lv = level === undefined ? {} : { level };
    const one = (extra: ItemExtra, slot: string | undefined, meta: { seq?: string; role?: string }, children: Built['children']) => {
      const res = generateItem(ctx, rule, { ...(kind === undefined ? {} : { kind }), ...(tier === undefined ? {} : { tier }), ...lv, ...extra });
      const key = projectItemKey({ ...lv, namespace, type: rule.resourceType, ...(tier === undefined ? {} : { tier }), ...(slot === undefined ? {} : { slot }) });
      const item: NameItem = {
        ...res, key, ...meta, ...(kind === undefined ? {} : { kind }), ...(token === null || res.name === '' ? {} : { kindToken: token }),
        ...(tier === undefined ? {} : { tier }), ...lv, namespace,
      };
      parents.push({ item, rule, children });
    };
    const input = inputKind(rule);
    if (input !== 'count' && instances !== undefined) throw new Error(`instances not supported: ${rule.id}`);
    if (input === 'count') {
      const slots: readonly InstanceSlot[] = instances ?? Array.from({ length: count }, (_, i) => ({ seq: seqOf(i + 1) }));
      for (const s of slots) {
        const a = s.attach;
        const children: Built['children'] = a === undefined ? [] : [
          ...(a.boot === true ? [{ attach: 'boot' as const }] : []),
          ...(a.data ?? []).map((seq) => ({ attach: 'data' as const, seq })),
          ...(a.ip === true ? [{ attach: 'ip' as const }] : []),
          ...(a.ipi === true ? [{ attach: 'ipi' as const }] : []),
        ];
        one({ seq: s.seq }, s.seq, { seq: s.seq }, children);
      }
    } else if (input === 'role') {
      const r = role ?? DEFAULT_ROLE;
      one({ role: r }, r, { role: r }, []);
    } else {
      one({}, undefined, {}, []);
    }
  };

  // 입력은 중복이 없어야 한다 — 같은 이름공간으로 정제되는 서비스 · 같은 (type, tier, level) 항목은 T5 의 마법사 모델 검사(validatePlan)가 먼저 거부한다
  // ① 부모 전부
  add(sel.project, PROJECT_NAMESPACE, { rule: projectRule, count: 1 }, 'project');
  for (const it of sel.projectItems) add(sel.project, PROJECT_NAMESPACE, it, 'project');
  for (const svc of sel.services) {
    for (const it of svc.items) {
      if (it.level !== undefined) throw new Error(`project level item inside service: ${it.rule.id}`);
      add({ ...sel.project, purpose: svc.purpose }, serviceNamespace(svc.purpose), it, undefined);
    }
  }
  // ② 부모 충돌 — 전체 한 번
  const conflicts = markConflicts(parents.map(({ item, rule }) => ({ key: item.key, rule, result: item })));
  // ③ 자식 — 부모가 최종 판정을 받은 뒤
  const ordered: { item: NameItem; rule: ResourceRule }[] = [];
  for (const p of parents) {
    ordered.push({ item: p.item, rule: p.rule });
    for (const c of p.children) {
      const child = attachName(p.item, c);
      ordered.push({ item: child, rule: RULES[child.ruleId]! });
    }
  }
  // ④ 아직 valid 인 항목 전체 — 이미 표시된 부모 충돌은 valid:false 라 다시 잡히지 않는다
  conflicts.push(...markConflicts(ordered.map(({ item, rule }) => ({ key: item.key, rule, result: item }))));
  const items = ordered.map(({ item }) => item);
  return { provider, valid: items.every((i) => i.valid), items, conflicts };
}

export function validateName(provider: Provider, resourceType: string, name: string):
  { valid: boolean; violations: CoreMessage[]; suggestedName?: string } {
  const rule = getRule(provider, resourceType);
  if (!rule) return { valid: false, violations: [{ code: 'rule.unknown_resource_type', params: { provider, supported: rulesFor(provider).map((r) => r.resourceType) } }] };

  const violations = checkName(name, rule);
  if (violations.length === 0) return { valid: true, violations };

  // ⑴ 정제만으로 되는가
  const normalized = normalizeToken(name, rule.allowed).value;
  if (checkName(normalized, rule).length === 0) return { valid: false, violations, suggestedName: normalized };

  // ⑵ 길이 초과면 정제한 값을 쪼개 앞 토큰부터 뗀다.
  // 생성의 축소 1단계(template 순서대로 optional 을 뗀다)와 다른 까닭: 검증은 이름이 어떤 template 으로 만들어졌는지 모른다
  // ⑶ 구분자 없는 규칙은 토큰 경계를 모르므로 제안하지 않는다
  if (normalized.length > rule.maxLength && rule.separator === '-') {
    const parts = normalized.split('-');
    for (let i = 1; i < parts.length; i++) {
      const candidate = parts.slice(i).join('-');
      if (checkName(candidate, rule).length === 0) return { valid: false, violations, suggestedName: candidate };
    }
  }
  return { valid: false, violations };
}

/** env 표준값 — 화면의 env 고르기가 쓰는 공개 API (D48). 정본은 normalize.ts 의 별칭 표다 */
export { ENV_VALUES };
const FIELDS: readonly ContextField[] = ['owner', 'system', 'purpose', 'env', 'region'];
/** 프로젝트 문맥의 필드 (D63) — purpose 가 없다 */
const PROJECT_FIELDS: readonly ContextField[] = FIELDS.filter((f) => f !== 'purpose');

/** 자유 입력(owner · system · purpose) 하나의 길이 상한 — 이름 규칙이 아니라 전송 위생이다. API 와 화면 입력 · 공유 hash 가 이 값을 쓴다.
 *  가장 긴 이름 규칙이 256자라 필드 하나 64자면 모자라지 않고, 이름 200개 응답이 작은 요청으로 커지지 않는다 (docs/decisions.md · 2026-10-06).
 *  parseContext 는 길이를 보지 않는다 — 엔진을 직접 부르는 시험 · 기준선은 더 긴 값도 넣는다 */
export const MAX_CONTEXT_CHARS = 64;

/** 원시 문맥 → 엔진 문맥. region 은 provider 의 지역 표로 푼다 (D49) — 리전 이름 · 존 이름 · 코드 · global.
 *  받지 않는 지역이면 supported 에 후보(옛 나라 값이면 그 나라의 리전 이름, 아니면 그 CSP 리전 이름 전부) */
export function parseContext(raw: RawContext, provider: Provider):
  { ok: true; context: NamingContext; transformed: CoreMessage[] } | { ok: false; errors: CoreMessage[] } {
  const r = parseFields(raw, provider, FIELDS);
  return r.ok ? { ok: true, context: r.vals as unknown as NamingContext, transformed: r.transformed } : r;
}

/** 프로젝트 문맥 (D63) — owner · system · env · region 넷. purpose 는 보지 않는다(와도 무시한다).
 *  판정 · 오류 순서는 parseContext 와 같은 함수를 쓴다 */
export function parseProjectContext(raw: RawContext, provider: Provider):
  { ok: true; context: ProjectContext; transformed: CoreMessage[] } | { ok: false; errors: CoreMessage[] } {
  const r = parseFields(raw, provider, PROJECT_FIELDS);
  return r.ok ? { ok: true, context: r.vals as unknown as ProjectContext, transformed: r.transformed } : r;
}

function parseFields(raw: RawContext, provider: Provider, fields: readonly ContextField[]):
  { ok: true; vals: Record<string, string>; transformed: CoreMessage[] } | { ok: false; errors: CoreMessage[] } {
  const errors: CoreMessage[] = [];
  const transformed: CoreMessage[] = [];
  const vals: Record<string, string> = {};
  // 여러 필드가 틀리면 owner → system → purpose → env → region 순서로 알린다
  for (const f of fields) {
    const v = raw[f];
    if (typeof v !== 'string') { errors.push({ code: 'context.not_string', field: f }); continue; }
    if (v.trim() === '') { errors.push({ code: 'context.empty', field: f }); continue; }
    if (f === 'env') {
      const c = canonicalEnv(v);
      if (!c) { errors.push({ code: 'context.value_unsupported', field: 'env', params: { value: clipForDisplay(v), supported: [...ENV_VALUES] } }); continue; }
      if (c !== v) transformed.push({ code: 'context.normalized', field: 'env', params: { from: clipForDisplay(v), to: c } });
      vals[f] = c;
    } else if (f === 'region') {
      const c = canonicalRegion(v, provider);
      if (!c) { errors.push({ code: 'context.value_unsupported', field: 'region', params: { value: clipForDisplay(v), supported: regionCandidates(v, provider) } }); continue; }
      // 이름에 들어가는 리전 코드와 입력이 다르면 기록한다 — 리전 · 존의 이름 · 존 코드는 리전 코드로 바뀐다 (D50 revised).
      // 존 코드는 문맥의 zone 에 남는다(입력 왕복 · 표시용) — 이름에는 쓰지 않는다
      const to = c.region;
      if (to !== v) transformed.push({ code: 'context.normalized', field: 'region', params: { from: clipForDisplay(v), to } });
      vals[f] = c.region;
      if (c.zone) vals.zone = c.zone;
    } else {
      vals[f] = v.trim();
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, vals, transformed };
}
