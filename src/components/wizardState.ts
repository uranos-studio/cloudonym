// 마법사 화면 상태 (D61 · D64) — 순수 함수. 화면 상태는 마법사 모델(WizardPlan) 하나이고, 화면은 이 함수들로만 바꾼다.
// 순번은 슬롯의 값이다 — 서버 줄 · 디스크 줄을 지워도 남은 번호를 당기지 않는다. 「+ server」 · 「+ disk」는 다음 빈 번호를 쓴다.
// 번호를 다시 매기는 것은 사용자가 누르는 별도 동작(renumber)이다. 판정(이름 규칙 · 검사)은 엔진(validatePlan)이 한다
import { SEQ_PATTERN, MAX_COUNT, type Attachments } from '../core/selection';
import { MAX_PICKS_PER_SERVICE, PROJECT_ID_RULE, PROJECT_SCOPES, SLOT_ID_PATTERN, checkProjectIdSuffix, validatePlan, type Pick, type PlanError, type WizardPlan, type WizardSlot } from '../core/wizard/plan';
import { PRESETS, presetOf, type Preset } from '../core/wizard/presets';
import { ATTACHMENTS, MAX_DATA_DISKS } from '../core/wizard/attachments';
import { EXAMPLE_REGION } from './formContext';
import { buildTree, inputKind } from '../core/tree';
import { treeRules } from './selection';
import { kindToken } from '../core/catalog';
import { generateItem, generateProject, type NameItem } from '../core/engine';
import type { NameResult, ProjectContext, ResourceRule } from '../core/types';
import { RESERVED_TIERS } from '../core/tier';
import { TIER_PATTERN } from '../core/types';

/** custom 모달의 트리 — 프로젝트 ID 는 늘 암묵 항목 하나라 고를 수 없어 뺀다(API 는 reserved_pick 으로 한 번 더 막는다) */
export const CUSTOM_TREE = buildTree('gcp', treeRules(buildTree('gcp')).filter((r) => r.id !== PROJECT_ID_RULE));
/** 프로젝트 공용 칸의 custom 트리 — 프로젝트 수준을 받는 범위(PROJECT_SCOPES)의 규칙만. 거르지 않으면 고른 뒤 level_not_supported 가 뜬다 */
export const PROJECT_CUSTOM_TREE = buildTree('gcp', treeRules(CUSTOM_TREE).filter((r) => PROJECT_SCOPES.includes(r.scope)));
/** GCP 규칙 — 칩의 입력 종류(count · role · none)를 본다 */
const GCP_RULES = new Map(treeRules(buildTree('gcp')).map((r) => [r.id, r]));

/** pick 의 자리 — service 가 null 이면 프로젝트 공용(Project resources) */
export interface PickRef { service: number | null; pick: number }

/** 마법사 ① 예시 넷 — 트리 화면의 예시(DEFAULT_FORM)와 같은 값 · 첫 서비스 이름 예시 */
export const DEFAULT_PROJECT: WizardPlan['project'] = { owner: 'platform', system: 'billing', env: 'prod', region: EXAMPLE_REGION };
export const EXAMPLE_SERVICE = 'shop';

/** 첫 화면 — 서비스 하나(이름 예시) · 고른 것 없음. 칩을 켜기 전에는 이름이 하나도 나오지 않는다(숨은 기본값 없음) */
export function initialPlan(project: WizardPlan['project'] = DEFAULT_PROJECT): WizardPlan {
  return { provider: 'gcp', project, projectPicks: [], services: [{ purpose: EXAMPLE_SERVICE, picks: [] }] };
}

/** 첫 화면 (D90) — hash 가 없을 때만. initialPlan 위에 네트워크 넷(VPC · 서브넷(PRIVATE) · Cloud Router · Cloud NAT, 각 01)을 얹는다.
 *  화면 초기값일 뿐이다 — expandPlan · API 에 숨은 기본값이 생기지 않고, 링크는 pick 넷을 그대로 싣는다. 링크에서 연 계획(깨진 링크 포함)은 initialPlan 을 쓴다 */
export function startPlan(): WizardPlan {
  return ['vpc', 'subnet', 'router', 'nat'].reduce((p, id) => addPresetPick(p, null, id), initialPlan());
}

/** 「Clear network」 (D90) — ② 네트워크의 프리셋 pick 을 전부 뗀다. Shared extras(custom pick)는 남긴다 */
export function clearNetwork(plan: WizardPlan): WizardPlan {
  return { ...plan, projectPicks: plan.projectPicks.filter((p) => p.preset === null) };
}

/** pick 의 유효 규칙 — 화면 목록의 줄 이름(rowNames)이 항목 키 머리를 만들 때 쓴다 */
export function pickRule(pick: Pick): ResourceRule | undefined {
  return GCP_RULES.get(effectiveRuleId(pick) ?? '');
}

/** 서비스 칩 · 프로젝트 칩(네트워크) — 데이터의 level 로 나눈다 (D73). 서비스 칸의 묶음(lb)은 화면이 group 으로 한 줄에 모은다 */
export const SERVICE_PRESETS: readonly Preset[] = PRESETS.filter((p) => p.level === 'service');
export const PROJECT_PRESETS: readonly Preset[] = PRESETS.filter((p) => p.level === 'project');

/** pick 의 유효 규칙 id — 프리셋이면 데이터의 규칙(서버리스를 고르면 그 규칙), custom 이면 ruleId */
export function effectiveRuleId(pick: Pick): string | undefined {
  const preset = pick.preset === null ? undefined : presetOf(pick.preset);
  if (!preset) return pick.ruleId;
  return typeof pick.serverless === 'string' && preset.serverless?.ruleIds.includes(pick.serverless) ? pick.serverless : preset.ruleId;
}

/** 딸린 것(boot · data · ip · ipi)을 받는 pick 인가 — 호환표에 부모로 있는 규칙 */
export function canAttach(pick: Pick): boolean {
  const id = effectiveRuleId(pick);
  return ATTACHMENTS.some((r) => r.parent === id);
}

/** tier 를 사용자가 치는 pick 인가 (D74) — 유효 규칙에 tier 자리가 있고 프리셋이 tier 를 정하지 않을 때(custom · db · object · 새 칩).
 *  web · was · 방화벽처럼 프리셋이 tier 를 정하면 칸을 보이지 않는다. 「Duplicate」 도 이때만 — tier 를 칠 수 없으면 복사본이 늘 중복이다 */
export function tierEditable(pick: Pick): boolean {
  const preset = pick.preset === null ? undefined : presetOf(pick.preset);
  if (preset && (preset.tier !== null || preset.tierChoices)) return false;
  const rule = GCP_RULES.get(effectiveRuleId(pick) ?? '');
  return rule !== undefined && rule.template.includes('tier');
}

/** 하나로 시작하는 프리셋 (D75) — VPC 는 프로젝트에 하나가 보통이라 줄을 더하는 단추 · 다시 매기기를 숨긴다.
 *  모델 · 검사는 그대로라 VPC 둘인 계획(API 로 만든 것 · 손으로 만든 링크)도 풀리고, 줄이 둘 이상이면 지금처럼 전부 보인다 */
const SINGLE_PRESETS: ReadonlySet<string> = new Set(['vpc']);
export function singleSlot(pick: Pick): boolean {
  return pick.preset !== null && SINGLE_PRESETS.has(pick.preset) && (pick.instances ?? []).length <= 1;
}

/** HA 토글을 보이는가 — 프리셋에 ha 가 있고 서버리스가 꺼져 있을 때 (D61 · §4-2) */
export function showsHa(pick: Pick): boolean {
  const preset = pick.preset === null ? undefined : presetOf(pick.preset);
  return !!preset?.ha && !pick.serverless;
}

/** 다음 빈 번호 — 쓴 번호 중 가장 큰 것 + 1. 99 를 쓰고 있으면 비어 있는 가장 작은 번호. 다 찼으면 undefined */
export function nextSeq(used: readonly string[]): string | undefined {
  const nums = used.filter((s) => SEQ_PATTERN.test(s)).map(Number);
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  if (max < MAX_COUNT) return String(max + 1).padStart(2, '0');
  for (let i = 1; i <= MAX_COUNT; i++) {
    const s = String(i).padStart(2, '0');
    if (!used.includes(s)) return s;
  }
  return undefined;
}

/** 다음 슬롯 id — pick 안에서 쓰지 않은 가장 작은 36진 수(`1` … `9` · `a` …) · SLOT_ID_PATTERN 안 */
export function nextSlotId(used: readonly string[]): string {
  for (let i = 1; ; i++) {
    const id = i.toString(36);
    if (!used.includes(id) && SLOT_ID_PATTERN.test(id)) return id;
  }
}

/** 슬롯 · 디스크 순번 입력이 꼴 밖인가 — 줄에 오류를 띄운다(판정 꼴은 core 의 SEQ_PATTERN) */
export const seqInvalid = (seq: string): boolean => !SEQ_PATTERN.test(seq);

// ── 내부 — 모델을 복사해 한 pick 을 바꾼다 ──
function picksOf(plan: WizardPlan, service: number | null): Pick[] {
  return service === null ? plan.projectPicks : plan.services[service]?.picks ?? [];
}
function withPicks(plan: WizardPlan, service: number | null, picks: Pick[]): WizardPlan {
  if (service === null) return { ...plan, projectPicks: picks };
  return { ...plan, services: plan.services.map((s, i) => (i === service ? { ...s, picks } : s)) };
}
function updatePick(plan: WizardPlan, ref: PickRef, fn: (p: Pick) => Pick): WizardPlan {
  const picks = picksOf(plan, ref.service);
  const cur = picks[ref.pick];
  if (!cur) return plan;
  return withPicks(plan, ref.service, picks.map((p, i) => (i === ref.pick ? fn(p) : p)));
}
function updateSlot(plan: WizardPlan, ref: PickRef, slot: number, fn: (s: WizardSlot) => WizardSlot): WizardPlan {
  return updatePick(plan, ref, (p) => ({ ...p, instances: (p.instances ?? []).map((s, i) => (i === slot ? fn(s) : s)) }));
}
/** 새 서버 줄 — 다음 빈 번호 · 다음 id · 딸린 것을 받는 pick 이면 프리셋의 초기 딸린 것(file 의 data 01)을 모델에 보이게 넣는다 */
function newSlot(pick: Pick, existing: readonly WizardSlot[]): WizardSlot | undefined {
  const seq = nextSeq(existing.map((s) => s.seq));
  if (seq === undefined) return undefined;
  const preset = pick.preset === null ? undefined : presetOf(pick.preset);
  const attach = canAttach(pick) && preset?.defaultAttach ? cloneAttach(preset.defaultAttach) : undefined;
  return { id: nextSlotId(existing.map((s) => s.id)), seq, ...(attach ? { attach } : {}) };
}
function cloneAttach(a: Attachments): Attachments {
  return { ...a, ...(a.data ? { data: [...a.data] } : {}) };
}

// ── 서비스 ──
export function addService(plan: WizardPlan): WizardPlan {
  return { ...plan, services: [...plan.services, { purpose: '', picks: [] }] };
}
export function removeService(plan: WizardPlan, index: number): WizardPlan {
  return { ...plan, services: plan.services.filter((_, i) => i !== index) };
}
export function renameService(plan: WizardPlan, index: number, purpose: string): WizardPlan {
  return { ...plan, services: plan.services.map((s, i) => (i === index ? { ...s, purpose } : s)) };
}
export function setProject(plan: WizardPlan, project: WizardPlan['project']): WizardPlan {
  return { ...plan, project };
}
/** 프로젝트 ID 접미사 (D85) — 빈 값이면 키를 지운다. 빈 문자열을 남기면 꼴 검사에 걸리고, 접미사 없는 링크의 hash 바이트가 달라진다 */
export function setProjectIdSuffix(plan: WizardPlan, value: string): WizardPlan {
  const { projectIdSuffix: _x, ...rest } = plan;
  return value === '' ? rest : { ...rest, projectIdSuffix: value };
}

// ── 용도 칩 ──
/** 프로젝트 공용 pick 이 상한(MAX_PICKS_PER_SERVICE — ② 네트워크와 Shared extras 를 합친 수)에 닿았는가.
 *  닿으면 더하는 함수는 모델을 그대로 돌려주고 화면은 더하는 단추를 끈다 — 하나 더 넣으면 wizard.too_many_picks 로 이름이 전부 사라진다 */
export function projectPicksFull(plan: WizardPlan): boolean {
  return plan.projectPicks.length >= MAX_PICKS_PER_SERVICE;
}
/** 칩의 pick 자리 — 프리셋 id 와 (방화벽처럼 tier 칩이 여럿이면) tier 로 찾는다. 없으면 -1 */
export function findPreset(plan: WizardPlan, service: number | null, presetId: string, tier?: string): number {
  return picksOf(plan, service).findIndex((p) => p.preset === presetId && (tier === undefined || (p.tier ?? presetOf(presetId)?.tier) === tier));
}

/** 칩을 켠다 · 끈다. 켜면 count 규칙은 서버 줄 하나(01), 입력 없는 규칙(버킷) · role 규칙(서비스 계정)은 줄 없음. tier 는 방화벽처럼 tierChoices 가 있을 때만 싣는다 */
export function togglePreset(plan: WizardPlan, service: number | null, presetId: string, tier?: string): WizardPlan {
  const preset = presetOf(presetId);
  if (!preset) return plan;
  const picks = picksOf(plan, service);
  const at = findPreset(plan, service, presetId, tier);
  if (at >= 0) return withPicks(plan, service, picks.filter((_, i) => i !== at));
  return addPresetPick(plan, service, presetId, tier);
}

/** 프리셋 pick 을 하나 더한다 — 켜고 끄지 않는다 (D86). 「Add subnet」이 쓴다: 이미 있는 pick 과 종류 · tier 가 같으면 duplicate_pick 이 붙고, 종류나 tier 를 고치면 사라진다.
 *  count 규칙은 서버 줄 하나(01), 입력 없는 규칙 · role 규칙은 줄 없음. tier 는 tierChoices 가 있을 때만 싣는다 */
export function addPresetPick(plan: WizardPlan, service: number | null, presetId: string, tier?: string): WizardPlan {
  const preset = presetOf(presetId);
  if (!preset) return plan;
  if (service === null && projectPicksFull(plan)) return plan;
  const picks = picksOf(plan, service);
  const pick: Pick = { preset: presetId, ...(preset.tierChoices && tier !== undefined ? { tier } : {}) };
  // 슬롯은 count 규칙(템플릿에 seq 가 있다)에만 — 규칙의 입력 종류로 정한다
  const rule = GCP_RULES.get(preset.ruleId);
  const withSlots = rule !== undefined && inputKind(rule) === 'count';
  const slot = withSlots ? newSlot(pick, []) : undefined;
  return withPicks(plan, service, [...picks, slot ? { ...pick, instances: [slot] } : pick]);
}

/** 같은 프리셋 pick 을 모두 뗀다 — 서브넷 칩을 끄면 「Add subnet」으로 더한 것까지 지운다 (D86) */
export function removePresetPicks(plan: WizardPlan, service: number | null, presetId: string): WizardPlan {
  return withPicks(plan, service, picksOf(plan, service).filter((p) => p.preset !== presetId));
}

/** 방화벽 tier 직접 입력의 사전 검사 (D87) — 꼴 · 예약어 · 상한, 그리고 「이미 있다」는 엔진에 묻는다:
 *  더한 계획을 validatePlan 에 넣어 새 pick 자리에 wizard.duplicate_pick 이 붙는지 본다(중복 키 type|kindToken|tier|role|level —
 *  Shared extras 의 custom 방화벽 규칙과 겹치는 것까지). 통과면 undefined */
export function firewallTierProblem(plan: WizardPlan, tier: string): 'pattern' | 'reserved' | 'exists' | 'full' | undefined {
  if (!TIER_PATTERN.test(tier)) return 'pattern';
  if (RESERVED_TIERS.has(tier)) return 'reserved';
  if (projectPicksFull(plan)) return 'full';
  if (findPreset(plan, null, 'firewall', tier) >= 0) return 'exists';
  const next = addPresetPick(plan, null, 'firewall', tier);
  const at = `projectPicks[${next.projectPicks.length - 1}]`;
  const check = validatePlan(next);
  if (!check.ok && check.errors.some((e) => e.code === 'wizard.duplicate_pick' && e.path === at)) return 'exists';
  return undefined;
}

/** pick 머리의 이름 — 프리셋 이름 뒤에 tier 칩 값(방화벽) 또는 종류 토큰 · 사용자가 친 tier 를 붙여 같은 프리셋 pick 여럿을 가른다
 *  (`Subnet · proxy` · `Subnet · web`). 고정 종류 프리셋(psa)은 종류를 붙이지 않는다. custom 은 규칙 표시 이름 */
export function pickTitle(pick: Pick): { title: string; custom: boolean } {
  const preset = pick.preset === null ? undefined : presetOf(pick.preset);
  if (preset) {
    if (preset.tierChoices) return { title: `${preset.label} · ${pick.tier ?? preset.tier}`, custom: false };
    const token = pick.kind !== undefined && preset.kind === undefined ? kindToken(effectiveRuleId(pick) ?? preset.ruleId, pick.kind) : null;
    const parts = [...(typeof token === 'string' && token !== '' ? [token] : []), ...(tierEditable(pick) && pick.tier ? [pick.tier] : [])];
    return { title: [preset.label, ...parts].join(' · '), custom: false };
  }
  return { title: GCP_RULES.get(pick.ruleId ?? '')?.displayName ?? pick.ruleId ?? '', custom: true };
}

/** custom — 트리에서 고른 규칙 하나. count 규칙은 count 만큼 서버 줄(01…), role 규칙은 역할, 입력 없는 규칙은 줄 없음 */
export function addCustom(plan: WizardPlan, service: number | null, rule: { ruleId: string; input: 'count' | 'role' | 'none'; count?: number; role?: string; kind?: string; tier?: string }): WizardPlan {
  if (service === null && projectPicksFull(plan)) return plan;
  const base: Pick = {
    preset: null, ruleId: rule.ruleId,
    ...(rule.role === undefined ? {} : { role: rule.role }),
    ...(rule.kind === undefined ? {} : { kind: rule.kind }),
    ...(rule.tier === undefined || rule.tier === '' ? {} : { tier: rule.tier }),
  };
  if (rule.input !== 'count') return withPicks(plan, service, [...picksOf(plan, service), base]);
  const slots: WizardSlot[] = [];
  for (let i = 0; i < Math.max(1, rule.count ?? 1); i++) {
    const s = newSlot(base, slots);
    if (s) slots.push(s);
  }
  return withPicks(plan, service, [...picksOf(plan, service), { ...base, instances: slots }]);
}

/** 같은 pick 을 바로 뒤에 하나 더 (D74) — tier 를 비운 복사본. 칩은 켜고 끄는 단추라 같은 종류 둘째를 만들 수 없다.
 *  tier 없는 같은 pick 이 이미 있으면(원본에 tier 가 없으면) 복사본에 duplicate_pick 이 붙고, tier 를 치면 사라진다. count 규칙은 새 서버 줄 하나(01) · HA 는 끈다 */
export function duplicatePick(plan: WizardPlan, ref: PickRef): WizardPlan {
  const picks = picksOf(plan, ref.service);
  const cur = picks[ref.pick];
  if (!cur) return plan;
  const { tier: _t, ha: _ha, instances, ...rest } = cur;
  const slot = instances === undefined ? undefined : newSlot(rest, []);
  const copy: Pick = slot ? { ...rest, instances: [slot] } : rest;
  return withPicks(plan, ref.service, [...picks.slice(0, ref.pick + 1), copy, ...picks.slice(ref.pick + 1)]);
}

export function removePick(plan: WizardPlan, ref: PickRef): WizardPlan {
  return withPicks(plan, ref.service, picksOf(plan, ref.service).filter((_, i) => i !== ref.pick));
}

/** tier · role · kind · location(D78) — 빈 값이면 키를 지운다(없는 칸은 싣지 않는다) */
export function setPickField(plan: WizardPlan, ref: PickRef, field: 'tier' | 'role' | 'kind' | 'location', value: string | undefined): WizardPlan {
  return updatePick(plan, ref, (p) => {
    const next = { ...p };
    if (value === undefined || value === '') delete next[field];
    else next[field] = value;
    return next;
  });
}

// ── ④ 선택지 ──
/** HA — 켜면 서버 줄을 minInstances 까지 보이게 늘린다 · 끄면 줄은 그대로 둔다 */
export function setHa(plan: WizardPlan, ref: PickRef, on: boolean): WizardPlan {
  return updatePick(plan, ref, (p) => {
    const min = p.preset === null ? undefined : presetOf(p.preset)?.ha?.minInstances;
    if (!on || min === undefined) {
      const { ha: _ha, ...rest } = p;
      return rest;
    }
    const slots = [...(p.instances ?? [])];
    while (slots.length < min) {
      const s = newSlot(p, slots);
      if (!s) break;
      slots.push(s);
    }
    return { ...p, ha: true, instances: slots };
  });
}

/** 서버리스 — 규칙 id(데이터의 serverless.ruleIds 하나) 또는 null(끔). 켜면 HA 를 끄고 서버 줄의 딸린 것을 뗀다(관리형은 붙일 디스크 · 주소가 없다) */
export function setServerless(plan: WizardPlan, ref: PickRef, ruleId: string | null): WizardPlan {
  return updatePick(plan, ref, (p) => {
    const { ha: _ha, serverless: _sv, ...rest } = p;
    if (ruleId === null) return rest;
    return { ...rest, serverless: ruleId, ...(p.instances ? { instances: p.instances.map(({ attach: _a, ...s }) => s) } : {}) };
  });
}

// ── 서버 줄 ──
export function addSlot(plan: WizardPlan, ref: PickRef): WizardPlan {
  return updatePick(plan, ref, (p) => {
    const slots = p.instances ?? [];
    const s = newSlot(p, slots);
    return s ? { ...p, instances: [...slots, s] } : p;
  });
}

/** 서버 줄을 지운다 — 남은 줄의 번호 · 딸린 것은 그대로. 지워서 HA 의 최소 수보다 적어지면 HA 를 끈다(모순 상태를 두지 않는다) */
export function removeSlot(plan: WizardPlan, ref: PickRef, slot: number): WizardPlan {
  return updatePick(plan, ref, (p) => {
    const slots = (p.instances ?? []).filter((_, i) => i !== slot);
    const min = p.preset === null ? undefined : presetOf(p.preset)?.ha?.minInstances;
    const next: Pick = { ...p, instances: slots };
    if (next.ha === true && min !== undefined && slots.length < min) delete next.ha;
    return next;
  });
}

export function setSlotSeq(plan: WizardPlan, ref: PickRef, slot: number, seq: string): WizardPlan {
  return updateSlot(plan, ref, slot, (s) => ({ ...s, seq }));
}

/** 다시 매기기 — 사용자가 누를 때만. 지금 줄 순서대로 01, 02, … (id 와 딸린 것은 그대로) */
export function renumber(plan: WizardPlan, ref: PickRef): WizardPlan {
  return updatePick(plan, ref, (p) => ({ ...p, instances: (p.instances ?? []).map((s, i) => ({ ...s, seq: String(i + 1).padStart(2, '0') })) }));
}

/** 번호에 빈 자리가 있는가 — 「Renumber」 버튼을 보일지 */
export function hasGaps(pick: Pick): boolean {
  return (pick.instances ?? []).some((s, i) => s.seq !== String(i + 1).padStart(2, '0'));
}

// ── ⑤ 딸린 것 ──
function withAttach(s: WizardSlot, fn: (a: Attachments) => Attachments): WizardSlot {
  const a = fn(s.attach ?? {});
  const clean: Attachments = {
    ...(a.boot === true ? { boot: true } : {}),
    ...(a.data && a.data.length > 0 ? { data: a.data } : {}),
    ...(a.ip === true ? { ip: true } : {}),
    ...(a.ipi === true ? { ipi: true } : {}),
  };
  const { attach: _a, ...rest } = s;
  return Object.keys(clean).length > 0 ? { ...rest, attach: clean } : rest;
}

/** boot · ip · ipi 켜기 · 끄기 */
export function setFlag(plan: WizardPlan, ref: PickRef, slot: number, flag: 'boot' | 'ip' | 'ipi', on: boolean): WizardPlan {
  return updateSlot(plan, ref, slot, (s) => withAttach(s, (a) => {
    const next: Attachments = { ...a };
    if (on) (next as Record<string, unknown>)[flag] = true;
    else delete (next as Record<string, unknown>)[flag];
    return next;
  }));
}

/** 「+ disk」 — 다음 빈 번호 · 한 서버 MAX_DATA_DISKS 개까지 */
export function addDisk(plan: WizardPlan, ref: PickRef, slot: number): WizardPlan {
  return updateSlot(plan, ref, slot, (s) => withAttach(s, (a) => {
    const data = a.data ?? [];
    const seq = data.length < MAX_DATA_DISKS ? nextSeq(data) : undefined;
    return seq ? { ...a, data: [...data, seq] } : a;
  }));
}

/** 디스크 줄을 지운다 — 남은 디스크 번호는 그대로. 비면 data 를 뺀다 */
export function removeDisk(plan: WizardPlan, ref: PickRef, slot: number, disk: number): WizardPlan {
  return updateSlot(plan, ref, slot, (s) => withAttach(s, (a) => ({ ...a, data: (a.data ?? []).filter((_, i) => i !== disk) })));
}

export function setDiskSeq(plan: WizardPlan, ref: PickRef, slot: number, disk: number, seq: string): WizardPlan {
  return updateSlot(plan, ref, slot, (s) => withAttach(s, (a) => ({ ...a, data: (a.data ?? []).map((d, i) => (i === disk ? seq : d)) })));
}

// ── ① 미리보기 (D85) ──
const PROJECT_NAME_RULE = GCP_RULES.get('gcp.project_name');
/** 프로젝트 이름 · ID 미리보기 — 고른 것이 없어도 문맥이 풀리면 보인다. 이름은 암묵 항목이 아니라 이 미리보기에만 나온다(마법사 내보내기 · 키는 그대로).
 *  ID 는 generateProject 의 첫 항목과 같다. 접미사가 꼴 · 예약어 검사(checkProjectIdSuffix)에 걸리면 ID 를 내지 않는다 —
 *  접미사 없는 ID 를 보이면 칸의 값과 다른 ID 를 믿게 된다(링크 hash 는 마지막 온전한 계획에 머문다) */
export function projectPreview(context: ProjectContext, suffix: string | undefined): { name: NameResult | undefined; id: NameItem | undefined } {
  const name = PROJECT_NAME_RULE ? generateItem(context, PROJECT_NAME_RULE, { level: 'project' }) : undefined;
  if (checkProjectIdSuffix(suffix).length > 0) return { name, id: undefined };
  const id = generateProject({ project: context, projectItems: [], services: [], ...(suffix === undefined ? {} : { projectIdSuffix: suffix }) }, 'gcp').items[0];
  return { name, id };
}

// ── 프로젝트 공용 칸의 두 자리 (D84) ──
/** 프로젝트 공용 pick 의 자리 번호 — ② Required network 는 프리셋 pick, 「Shared extra resources」는 custom pick. 모델은 projectPicks 하나이고 자리 번호(path)는 그대로다 */
export function projectPickIndexes(plan: WizardPlan, where: 'network' | 'extras'): number[] {
  return plan.projectPicks.flatMap((p, i) => ((p.preset !== null) === (where === 'network') ? [i] : []));
}

// ── 검사 결과를 자리로 ──
/** pick 의 path 머리 — services[1].picks[0] · projectPicks[2] */
export function pickPath(ref: PickRef): string {
  return ref.service === null ? `projectPicks[${ref.pick}]` : `services[${ref.service}].picks[${ref.pick}]`;
}

/** path 가 정확히 그 자리인 오류 */
export function errorsAt(errors: readonly PlanError[], path: string): PlanError[] {
  return errors.filter((e) => e.path === path);
}

/** 그 자리 아래(자기 포함)의 오류 — 서버 줄 · 디스크 줄 */
export function errorsUnder(errors: readonly PlanError[], path: string): PlanError[] {
  return errors.filter((e) => e.path !== undefined && (e.path === path || e.path.startsWith(`${path}.`) || e.path.startsWith(`${path}[`)));
}
