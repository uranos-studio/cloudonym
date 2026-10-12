// 마법사 모델 (D64) — 순수 함수. 이름을 만들지 않는다. 화면 · API · 공유 hash 디코더가 validatePlan → expandPlan → generateProject 를 지난다.
// 마법사 입력의 검사는 전부 validatePlan 하나다 — pick 마다 checkAttachments(호환표) 와 validateSelection(한 항목짜리 목록)을 부르고,
// 입력 요소에 걸린 오류에는 위치 path 를 붙인다. 모델 전체 오류(wizard.empty · too_many_names · too_many_services)에는 path 가 없다
import { RULES, rulesFor } from '../constraints';
import { DEFAULT_ROLE, parseContext, parseProjectContext, serviceNamespace, type ProjectSelection, type ServiceSelection } from '../engine';
import type { CoreMessage } from '../messages';
import { MAX_NAMES, SEQ_PATTERN, validateSelection, type Attachments, type InstanceSlot, type SelectionItem } from '../selection';
import { REGIONAL_LOCATION, canonicalLocation, locationRuleTypes, pickLocation, pickLocationNames } from '../regions';
import { RESERVED_TIERS } from '../tier';
import { kindTokenFor } from '../compose';
import { inputKind } from '../tree';
import { TIER_PATTERN, type ResourceRule, type ScopeId } from '../types';
import { ATTACH_KINDS, checkAttachments } from './attachments';
import { PRESETS, presetOf, type Preset } from './presets';

/** 서비스 수 · 한 서비스(또는 프로젝트 공용)의 pick 수 상한 — hash 길이 상한식이 쓴다 */
export const MAX_SERVICES = 20;
export const MAX_PICKS_PER_SERVICE = 20;
/** 슬롯 id — 소문자 · 숫자 1~8자 · 한 pick 안에서 고유. hash 가 슬롯을 이 값으로 든다 */
export const MAX_SLOT_ID_CHARS = 8;
export const SLOT_ID_PATTERN = /^[a-z0-9]{1,8}$/;
/** 서비스 이름공간으로 쓸 수 없는 값 — 프로젝트 수준 항목의 이름공간이다 */
const RESERVED_SERVICE = 'project';
/** 프로젝트 ID 는 늘 암묵 항목 하나라 pick 으로 고를 수 없다 */
export const PROJECT_ID_RULE = 'gcp.project_id';
/** 프로젝트 수준(level 'project')을 받는 범위 (D63) — Cloud NAT(라우터 안에서 고유)를 프로젝트 칸에 두려고 gcp:router 를 더했다 (D73) */
export const PROJECT_SCOPES: readonly ScopeId[] = ['gcp:namespace', 'gcp:project', 'gcp:project_global', 'gcp:project_region', 'gcp:router'];
/** HA 를 받는 유효 규칙 — serverless 를 푼 뒤의 규칙이 이것이어야 한다 */
const HA_RULE = 'gcp.compute_instance';

/** 서버 줄 하나 (D61) — id 는 hash 의 슬롯 식별 · seq 는 이름의 순번 · attach 는 딸린 것(D62) */
export interface WizardSlot { id: string; seq: string; attach?: Attachments }
/** 고른 용도 하나 = 규칙 하나. preset 이 null 이면 custom 이고 ruleId 가 규칙이다. 프리셋이면 규칙은 데이터가 정한다(ruleId 를 보지 않는다) */
export interface Pick {
  preset: string | null;
  ruleId?: string;
  tier?: string; role?: string; kind?: string;
  /** HA (D61) — 프리셋에 ha 가 있고 유효 규칙이 VM 일 때만. 없거나 null 이면 꺼짐(JSON 이 null 을 보낸다) */
  ha?: boolean | null;
  /** 서버리스 규칙 id — 프리셋 데이터의 serverless.ruleIds 안. 없거나 null 이면 꺼짐 */
  serverless?: string | null;
  /** count 규칙에만(1~99) */
  instances?: WizardSlot[];
  /** 멀티 · 이중 리전 위치(D78) — 그 위치를 받는 규칙(버킷 · BigQuery 데이터세트)에만. 없으면 프로젝트 지역. 코드(us) · 이름(US) 둘 다 받는다.
   *  Secret 은 regional 하나(D79) — 없으면 전역(지역 토큰 없음), regional 이면 프로젝트 지역 */
  location?: string;
}
export interface WizardPlan {
  provider: 'gcp';
  project: { owner: string; system: string; env: string; region: string };
  projectPicks: Pick[];
  services: { purpose: string; picks: Pick[] }[];
}
/** validatePlan 의 오류 — 입력 요소에 걸린 것은 path(services[1].picks[0].instances[1].attach.data[0] · projectPicks[2] · services[1] · projectPicks) */
export type PlanError = CoreMessage & { path?: string };

const shown = (v: unknown): string => {
  if (typeof v === 'string') return v;
  try {
    return String(v);
  } catch {
    return typeof v;
  }
};
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** pick 의 유효 규칙 — 프리셋이면 데이터의 규칙(serverless 를 고르면 그 규칙), custom 이면 ruleId. 못 풀면 undefined */
interface Resolved { rule: ResourceRule; preset: Preset | undefined; tier: string | undefined }
function resolve(pick: Pick): Resolved | undefined {
  const preset = pick.preset === null ? undefined : presetOf(pick.preset);
  if (pick.preset !== null && !preset) return undefined;
  const base = preset ? preset.ruleId : pick.ruleId;
  const sv = preset?.serverless?.ruleIds.includes(pick.serverless as string) ? pick.serverless : undefined;
  const rule = RULES[sv ?? base ?? ''];
  if (!rule || rule.provider !== 'gcp' || rule.id === PROJECT_ID_RULE) return undefined;
  const tier = pick.tier ?? preset?.tier ?? undefined;
  return { rule, preset, tier };
}

/** 한 pick 이 만들 이름 수 — 이름 총합 상한(프로젝트 ID · 자식 포함)에 쓴다. 검사 전 값이라 모양을 믿지 않는다 */
function namesOf(pick: unknown): number {
  if (!isObject(pick)) return 0;
  const slots = pick.instances;
  if (!Array.isArray(slots)) return 1;
  let n = 0;
  for (const s of slots) {
    n += 1;
    const a = isObject(s) ? s.attach : undefined;
    if (!isObject(a)) continue;
    if (a.boot === true) n += 1;
    if (a.ip === true) n += 1;
    if (a.ipi === true) n += 1;
    if (Array.isArray(a.data)) n += a.data.length;
  }
  return n;
}

/** 중복 키의 종류 칸 (D86) — 이름에 드는 종류 토큰. 기본값 · 토큰 없는 값 · 종류 없음은 ''. 허용 밖 · 문자열 아님은 원래 값을 앞에 ? 를 붙여 그대로 센다(오류는 따로 난다) */
function dupKindToken(rule: ResourceRule, kind: unknown): string {
  if (kind === undefined) return '';
  if (typeof kind !== 'string') return `?${shown(kind)}`;
  const t = kindTokenFor(rule.id, rule.kinds, kind);
  return t instanceof Error ? `?${kind}` : (t ?? '');
}

/** pick 목록 하나(서비스 하나 또는 프로젝트 공용)를 검사한다. base 는 그 목록의 위치(services[1] · projectPicks) */
function checkPicks(picks: readonly unknown[], base: string, level: 'project' | undefined, out: PlanError[], projectRegion: string | undefined): void {
  const at = (index: number) => base === 'projectPicks' ? `projectPicks[${index}]` : `${base}.picks[${index}]`;
  const seen = new Set<string>();
  picks.forEach((raw, index) => {
    const path = at(index);
    const push = (m: CoreMessage, tail = '') => out.push({ ...m, path: path + tail });
    if (!isObject(raw)) { push({ code: 'selection.item_not_object', params: { index } }); return; }
    const pick = raw as unknown as Pick;

    // 규칙 풀기 — 프리셋 · 예약 · 모르는 규칙
    if (pick.preset !== null && (typeof pick.preset !== 'string' || !presetOf(pick.preset))) {
      push({ code: 'wizard.unknown_preset', params: { index, value: shown(pick.preset), supported: PRESETS.map((p) => p.id) } });
      return;
    }
    if (pick.preset === null && pick.ruleId === PROJECT_ID_RULE) { push({ code: 'wizard.reserved_pick', params: { index, type: 'project_id' } }); return; }
    const preset = pick.preset === null ? undefined : presetOf(pick.preset);
    const baseRule = RULES[preset ? preset.ruleId : shown(pick.ruleId)];
    if (!baseRule || baseRule.provider !== 'gcp') { push({ code: 'selection.unknown_type', params: { index, value: shown(pick.ruleId) } }); return; }

    // serverless — 프리셋 데이터의 규칙 id 하나여야 한다(불리언 · 다른 규칙 id 는 거부)
    let rule = baseRule;
    if (pick.serverless !== undefined && pick.serverless !== null) {
      const allowed = preset?.serverless?.ruleIds ?? [];
      if (typeof pick.serverless !== 'string' || !allowed.includes(pick.serverless)) {
        push({ code: 'wizard.serverless_not_supported', params: { index, type: baseRule.resourceType } });
      } else {
        rule = RULES[pick.serverless]!;
      }
    }
    const type = rule.resourceType;
    const input = inputKind(rule);
    const slots: unknown = pick.instances;

    // HA — 프리셋에 ha 메타데이터가 있고 유효 규칙이 VM 일 때만 · 켜면 슬롯 ≥ minInstances
    if (pick.ha !== undefined && pick.ha !== null && pick.ha !== false) {
      if (pick.ha !== true || !preset?.ha || rule.id !== HA_RULE) push({ code: 'wizard.ha_not_supported', params: { index, type } });
      else if (!Array.isArray(slots) || slots.length < preset.ha.minInstances) push({ code: 'wizard.count_below_min', params: { index, min: preset.ha.minInstances } });
    }

    // level — 프로젝트 공용 pick 은 프로젝트 수준 범위의 규칙만
    if (level === 'project' && !PROJECT_SCOPES.includes(rule.scope)) push({ code: 'wizard.level_not_supported', params: { index, type } });

    // tier — 템플릿에 tier 자리가 있는 규칙(count 규칙 · 순번 없는 GCP 규칙 — D74)에만 · 꼴 · 예약어
    const tier: unknown = pick.tier ?? preset?.tier ?? undefined;
    if (pick.tier !== undefined) {
      if (!rule.template.includes('tier')) push({ code: 'wizard.tier_not_supported', params: { index, type } });
      else if (typeof pick.tier !== 'string' || !TIER_PATTERN.test(pick.tier)) push({ code: 'wizard.invalid_tier', params: { index, value: shown(pick.tier), pattern: TIER_PATTERN.source } });
      else if (RESERVED_TIERS.has(pick.tier)) push({ code: 'wizard.tier_reserved', params: { index, value: pick.tier } });
    }

    // 위치 (D78 · D79) — 그 규칙이 받는 멀티 · 이중 리전 위치, 기본이 전역인 규칙(Secret)은 regional 이어야 한다
    if (pick.location !== undefined) {
      const loc = typeof pick.location === 'string' ? pickLocation(rule, pick.location) : undefined;
      if (loc === undefined) push({ code: 'wizard.invalid_location', params: { index, type, value: shown(pick.location), supported: pickLocationNames(rule) } });
      // 지역 Secret 은 프로젝트 지역에 둔다 — 프로젝트 지역이 global 이면 둘 곳이 없다 (D79)
      else if (loc === REGIONAL_LOCATION && projectRegion === 'global') push({ code: 'wizard.location_needs_region', params: { index, type } });
    }

    // 같은 (type, 종류 토큰, tier, role, level) 둘 (D86) — role 규칙에서 role 을 빼면 엔진이 DEFAULT_ROLE 을 채우므로 그 값으로 센다.
    // 종류는 이름에 드는 토큰으로 센다 — 기본값 · 토큰 없는 값 · 종류 없음은 같은 이름이 되므로 같은 값('')이다. 허용 밖 종류는 아래 validateSelection 이 알린다
    const role = typeof pick.role === 'string' ? pick.role : input === 'role' ? DEFAULT_ROLE : '';
    const kindToken = dupKindToken(rule, pick.kind);
    const dup = `${type}|${kindToken}|${typeof tier === 'string' ? tier : ''}|${role}|${level ?? ''}`;
    if (seen.has(dup)) push({ code: 'wizard.duplicate_pick', params: { index, value: [type, ...(kindToken === '' ? [] : [kindToken]), ...(typeof tier === 'string' ? [tier] : []), ...(role === '' ? [] : [role])].join('/') } });
    seen.add(dup);

    // 슬롯 — count 규칙에만 · id 꼴 · 고유 · seq 꼴 · 고유 · attach 의 값
    if (input !== 'count') {
      if (slots !== undefined) push({ code: 'wizard.instances_not_supported', params: { index, type } });
    } else if (Array.isArray(slots)) {
      const ids = new Set<string>();
      const seqs = new Set<string>();
      slots.forEach((slot: unknown, i) => {
        const tail = `.instances[${i}]`;
        const s = isObject(slot) ? slot : {};
        if (typeof s.id !== 'string' || !SLOT_ID_PATTERN.test(s.id)) push({ code: 'wizard.invalid_slot_id', params: { index, value: shown(s.id), pattern: SLOT_ID_PATTERN.source } }, tail);
        else if (ids.has(s.id)) push({ code: 'wizard.duplicate_slot_id', params: { index, value: s.id } }, tail);
        else ids.add(s.id);
        if (typeof s.seq !== 'string' || !SEQ_PATTERN.test(s.seq)) push({ code: 'wizard.invalid_seq', params: { index, value: shown(s.seq), pattern: SEQ_PATTERN.source } }, tail);
        else if (seqs.has(s.seq)) push({ code: 'wizard.duplicate_seq', params: { index, value: s.seq } }, tail);
        else seqs.add(s.seq);
        // attach 안의 모르는 키 · true 도 undefined(없음)도 아닌 boot/ip/ipi 는 조용히 버리지 않는다 — 객체가 아닌 것은 checkAttachments 가 본다
        const a = s.attach;
        if (isObject(a) && Object.entries(a).some(([k, v]) => !(ATTACH_KINDS as readonly string[]).includes(k) || (k !== 'data' && v !== undefined && v !== true))) {
          push({ code: 'wizard.attach_not_object', params: { index } }, `${tail}.attach`);
        }
      });
      for (const issue of checkAttachments({ rule, count: slots.length, instances: slots as InstanceSlot[] }, index)) push(issue.message, issue.tail);
    }

    // 지금 검사(한 항목짜리 목록) — type · count · kind · role. index 는 pick 의 자리로 바꿔 싣는다
    const count = input === 'count' ? (Array.isArray(slots) ? slots.length : 0) : 1;
    const one = validateSelection('gcp', [{ type, count, ...(pick.role === undefined ? {} : { role: pick.role }), ...(pick.kind === undefined ? {} : { kind: pick.kind }) }], rulesFor('gcp'));
    if (!one.ok) {
      for (const e of one.errors) push('params' in e && isObject(e.params) && 'index' in e.params ? ({ ...e, params: { ...e.params, index } } as CoreMessage) : e);
    }
  });
}

/** 마법사 모델 검사 — 오류를 모두 낸다. 검사 순서: 모델 전체(서비스 수 · 빈 모델) → 프로젝트 문맥 → 서비스(이름 · 예약 · 중복) → pick → 이름 총합 */
export function validatePlan(plan: WizardPlan): { ok: true } | { ok: false; errors: PlanError[] } {
  // 모양 — services · projectPicks 는 배열(모델 전체 오류 · path 없음). 서비스의 picks 가 배열이 아니면 아래에서 services[i] 에 낸다
  if (!Array.isArray(plan.services) || !Array.isArray(plan.projectPicks)) return { ok: false, errors: [{ code: 'selection.not_array' }] };
  const services: readonly unknown[] = plan.services;
  const projectPicks: readonly unknown[] = plan.projectPicks;
  if (services.length > MAX_SERVICES) return { ok: false, errors: [{ code: 'wizard.too_many_services', params: { max: MAX_SERVICES, actual: services.length } }] };
  const picksOf = (s: unknown): readonly unknown[] => (isObject(s) && Array.isArray(s.picks) ? s.picks : []);
  if (projectPicks.length === 0 && services.every((s) => picksOf(s).length === 0)) return { ok: false, errors: [{ code: 'wizard.empty' }] };

  const errors: PlanError[] = [];
  const ctx = parseProjectContext(plan.project ?? {}, 'gcp');
  if (!ctx.ok) errors.push(...ctx.errors);
  // 프로젝트 지역은 단일 리전이다 — 멀티 · 이중 리전 위치는 그 위치를 받는 pick 의 location 으로 준다 (D78)
  const projectLocation = ctx.ok ? canonicalLocation(ctx.context.region, 'gcp') : undefined;
  if (projectLocation) {
    errors.push({ code: 'context.location_unsupported', field: 'region', params: { value: shown(plan.project.region), supported: locationRuleTypes(projectLocation) } });
  }

  if (projectPicks.length > MAX_PICKS_PER_SERVICE) {
    errors.push({ code: 'wizard.too_many_picks', params: { index: -1, max: MAX_PICKS_PER_SERVICE, actual: projectPicks.length }, path: 'projectPicks' });
  }
  const projectRegion = ctx.ok ? ctx.context.region : undefined;
  checkPicks(projectPicks, 'projectPicks', 'project', errors, projectRegion);

  const namespaces = new Set<string>();
  services.forEach((svc, index) => {
    const path = `services[${index}]`;
    const purpose = isObject(svc) ? svc.purpose : undefined;
    const ns = typeof purpose === 'string' ? serviceNamespace(purpose) : '';
    if (ns === '') errors.push({ code: 'wizard.empty_service', params: { index }, path });
    else if (ns === RESERVED_SERVICE) errors.push({ code: 'wizard.reserved_service', params: { index, value: ns }, path });
    else if (namespaces.has(ns)) errors.push({ code: 'wizard.duplicate_service', params: { index, value: ns }, path });
    namespaces.add(ns);
    if (!isObject(svc) || !Array.isArray(svc.picks)) errors.push({ code: 'selection.not_array', path });
    const picks = picksOf(svc);
    if (picks.length > MAX_PICKS_PER_SERVICE) errors.push({ code: 'wizard.too_many_picks', params: { index, max: MAX_PICKS_PER_SERVICE, actual: picks.length }, path });
    checkPicks(picks, path, undefined, errors, projectRegion);
  });

  const total = 1 + projectPicks.reduce((n: number, p) => n + namesOf(p), 0) + services.reduce((n: number, s) => n + picksOf(s).reduce((m: number, p) => m + namesOf(p), 0), 0);
  if (total > MAX_NAMES) errors.push({ code: 'wizard.too_many_names', params: { max: MAX_NAMES, actual: total } });
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/** 검사를 지난 모델 → generateProject 의 입력. 슬롯 id 는 싣지 않는다(hash 의 일) · 프리셋의 defaultAttach 는 넣지 않는다(화면 초기값일 뿐).
 *  검사를 지나지 않은 모델이면 던진다 */
export function expandPlan(plan: WizardPlan): ProjectSelection {
  // 같은 검사를 다시 지난다 — 검사를 지난 모델은 아래에서 던지지 않는다(모양이 틀린 모델은 여기서 분명히 던진다)
  if (!validatePlan(plan).ok) throw new Error('expandPlan: the plan did not pass validatePlan');
  const ctx = parseProjectContext(plan.project, 'gcp');
  if (!ctx.ok) throw new Error('expandPlan: invalid project context');
  const item = (pick: Pick, level: 'project' | undefined): SelectionItem => {
    const r = resolve(pick);
    if (!r) throw new Error('expandPlan: unresolved pick');
    const { rule, tier } = r;
    const counted = inputKind(rule) === 'count';
    const slots = pick.instances ?? [];
    return {
      rule, count: counted ? slots.length : 1,
      ...(pick.role === undefined ? {} : { role: pick.role }),
      ...(pick.kind === undefined ? {} : { kind: pick.kind }),
      ...(tier === undefined ? {} : { tier }),
      ...(level === undefined ? {} : { level }),
      ...(pick.location === undefined ? {} : { location: pickLocation(rule, pick.location)! }),
      ...(counted ? { instances: slots.map((s): InstanceSlot => ({ seq: s.seq, ...(s.attach === undefined ? {} : { attach: s.attach }) })) } : {}),
    };
  };
  const services: ServiceSelection[] = plan.services.map((s) => {
    // 서비스 문맥이 성립하는지 — purpose 를 더한 다섯 값
    if (!parseContext({ ...plan.project, purpose: s.purpose }, 'gcp').ok) throw new Error('expandPlan: invalid service context');
    return { purpose: s.purpose, items: s.picks.map((p) => item(p, undefined)) };
  });
  return { project: ctx.context, projectItems: plan.projectPicks.map((p) => item(p, 'project')), services };
}
