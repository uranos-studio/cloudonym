// 마법사 화면의 선택 줄 (D89) — 순수 함수. 선택은 화면 상태이고 모델(WizardPlan) · hash · /v1/wizard 에 들지 않는다.
// 선택 식별자는 경로 문자열이다: project · network · extras · services[i] · services[i].picks[j] · projectPicks[k] (= pickPath).
// Pick 에 id 를 더하지 않는다 — 더하면 hash v4 와 /v1/wizard 모양이 바뀐다.
// 기존 selection.ts 는 트리 화면 것이라 이름을 피했다
import { DEFAULT_ROLE, serviceNamespace, type ProjectResult } from '../core/engine';
import { kindToken } from '../core/catalog';
import { inputKind } from '../core/tree';
import { presetOf } from '../core/wizard/presets';
import type { PlanError, WizardPlan } from '../core/wizard/plan';
import type { CoreMessage } from '../core/types';
import { errorsAt, errorsUnder, pickPath, pickRule, projectPickIndexes, type PickRef } from './wizardState';

export type RowPath = string;
export const PROJECT_ROW: RowPath = 'project';
export const NETWORK_ROW: RowPath = 'network';
export const EXTRAS_ROW: RowPath = 'extras';
export const serviceRow = (i: number): RowPath => `services[${i}]`;

export type Row =
  | { kind: 'project' } | { kind: 'network' } | { kind: 'extras' }
  | { kind: 'service'; service: number }
  | { kind: 'pick'; ref: PickRef };

const SERVICE_RE = /^services\[(\d+)\]$/;
const SERVICE_PICK_RE = /^services\[(\d+)\]\.picks\[(\d+)\]$/;
const PROJECT_PICK_RE = /^projectPicks\[(\d+)\]$/;

/** 경로를 줄로 — 꼴 밖이면 undefined */
export function parseRow(path: RowPath): Row | undefined {
  if (path === 'project' || path === 'network' || path === 'extras') return { kind: path };
  let m = SERVICE_RE.exec(path);
  if (m) return { kind: 'service', service: Number(m[1]) };
  m = SERVICE_PICK_RE.exec(path);
  if (m) return { kind: 'pick', ref: { service: Number(m[1]), pick: Number(m[2]) } };
  m = PROJECT_PICK_RE.exec(path);
  if (m) return { kind: 'pick', ref: { service: null, pick: Number(m[1]) } };
  return undefined;
}

/** 그 줄이 지금 계획에 있는가 */
export function rowExists(plan: WizardPlan, path: RowPath): boolean {
  const r = parseRow(path);
  if (!r) return false;
  if (r.kind === 'service') return r.service < plan.services.length;
  if (r.kind === 'pick') {
    const { service, pick } = r.ref;
    return service === null ? pick < plan.projectPicks.length : pick < (plan.services[service]?.picks.length ?? 0);
  }
  return true;
}

/** 부모 줄 — 프로젝트 공용 pick 은 프리셋이면 network, custom 이면 extras. 서비스 pick 은 그 서비스. 머리 줄의 부모는 project */
export function parentRow(plan: WizardPlan, path: RowPath): RowPath {
  const r = parseRow(path);
  if (!r || r.kind !== 'pick') return PROJECT_ROW;
  if (r.ref.service !== null) return serviceRow(r.ref.service);
  return plan.projectPicks[r.ref.pick]?.preset === null ? EXTRAS_ROW : NETWORK_ROW;
}

/** 경로가 사라졌으면 project (hashchange 가 계획을 통째로 바꿀 때) */
export function resolveSelection(plan: WizardPlan, path: RowPath): RowPath {
  return rowExists(plan, path) ? path : PROJECT_ROW;
}

/** 목록에 보이는 줄의 순서 — project · network · 네트워크 pick · 서비스(펼친 것은 그 pick) · extras · extras pick. 키보드 ↑↓ 가 이 순서를 따른다 */
export function visibleRows(plan: WizardPlan, expanded: (service: number) => boolean): RowPath[] {
  const out: RowPath[] = [PROJECT_ROW, NETWORK_ROW];
  for (const k of projectPickIndexes(plan, 'network')) out.push(pickPath({ service: null, pick: k }));
  plan.services.forEach((s, i) => {
    out.push(serviceRow(i));
    if (expanded(i)) s.picks.forEach((_, j) => out.push(pickPath({ service: i, pick: j })));
  });
  out.push(EXTRAS_ROW);
  for (const k of projectPickIndexes(plan, 'extras')) out.push(pickPath({ service: null, pick: k }));
  return out;
}

/** 줄의 오류 건수 — 자식 오류를 합친다. 서비스 줄은 서비스 문맥 오류(serviceErrors[i])도 · network 줄은 projectPicks 자리의 오류도.
 *  project 줄은 문맥 · 접미사 오류라 호출하는 쪽이 따로 센다(projectCount) */
export function rowErrorCount(plan: WizardPlan, path: RowPath, errors: readonly PlanError[], serviceErrors: readonly (readonly CoreMessage[])[], projectCount = 0): number {
  const r = parseRow(path);
  if (!r) return 0;
  switch (r.kind) {
    case 'project': return projectCount;
    case 'network':
      return errorsAt(errors, 'projectPicks').length
        + projectPickIndexes(plan, 'network').reduce((n, k) => n + errorsUnder(errors, pickPath({ service: null, pick: k })).length, 0);
    case 'extras':
      return projectPickIndexes(plan, 'extras').reduce((n, k) => n + errorsUnder(errors, pickPath({ service: null, pick: k })).length, 0);
    case 'service': return errorsUnder(errors, path).length + (serviceErrors[r.service]?.length ?? 0);
    case 'pick': return errorsUnder(errors, path).length;
  }
}

/** 첫 선택 — 오류가 있는 첫 줄(모든 pick 줄을 펼친 순서), 없으면 project */
export function firstErrorRow(plan: WizardPlan, errors: readonly PlanError[], serviceErrors: readonly (readonly CoreMessage[])[], projectCount = 0): RowPath {
  if (projectCount > 0) return PROJECT_ROW;
  for (const path of visibleRows(plan, () => true)) {
    if (path === PROJECT_ROW) continue;
    // 머리 줄(network · 서비스)은 자식 오류를 합치므로, 자식 줄이 있으면 그 줄을 고른다
    const r = parseRow(path);
    const own = r?.kind === 'network' ? errorsAt(errors, 'projectPicks').length
      : r?.kind === 'service' ? errorsAt(errors, path).length + (serviceErrors[r.service]?.length ?? 0)
      : r?.kind === 'extras' ? 0
      : rowErrorCount(plan, path, errors, serviceErrors);
    if (own > 0) return path;
  }
  return PROJECT_ROW;
}

/** 선택을 옮기는 동작 — 화면이 모델을 바꿀 때 함께 넘긴다 (D89 · §2)
 *  - keep: 칩 토글 · 값 입력 — 선택은 그대로(사라졌으면 부모 줄)
 *  - select: 단발 추가(Custom · Add subnet · 방화벽 Add · Duplicate · Add service) — 새 줄
 *  - removePick: 그 pick 삭제 — 다음 형제, 없으면 이전 형제, 없으면 부모 줄
 *  - removeService: 그 서비스 삭제 — 다음 서비스, 없으면 project */
export type SelectionOp =
  | { type: 'keep' }
  | { type: 'select'; path: RowPath }
  | { type: 'removePick'; path: RowPath }
  | { type: 'removeService'; service: number };

/** 형제 pick 자리 — 같은 묶음(서비스 하나 · network · extras)의 모델 자리 번호 */
function siblings(plan: WizardPlan, ref: PickRef): number[] {
  if (ref.service !== null) return (plan.services[ref.service]?.picks ?? []).map((_, j) => j);
  const where = plan.projectPicks[ref.pick]?.preset === null ? 'extras' : 'network';
  return projectPickIndexes(plan, where);
}

export function selectionAfter(op: SelectionOp, prev: RowPath, before: WizardPlan, after: WizardPlan): RowPath {
  switch (op.type) {
    case 'select':
      return rowExists(after, op.path) ? op.path : resolveSelection(after, prev);
    case 'removeService':
      if (op.service < after.services.length) return serviceRow(op.service);
      return PROJECT_ROW;
    case 'removePick': {
      const r = parseRow(op.path);
      if (!r || r.kind !== 'pick') return resolveSelection(after, prev);
      const sib = siblings(before, r.ref);
      const at = sib.indexOf(r.ref.pick);
      const next = sib[at + 1];
      const prevSib = at > 0 ? sib[at - 1] : undefined;
      // 지운 자리 뒤의 번호는 하나씩 당겨진다
      if (next !== undefined) return pickPath({ service: r.ref.service, pick: next - 1 });
      if (prevSib !== undefined) return pickPath({ service: r.ref.service, pick: prevSib });
      return parentRow(before, op.path);
    }
    case 'keep': {
      if (rowExists(after, prev)) {
        // 선택한 pick 이 그대로 그 자리에 있는가 — 앞의 pick 이 지워져 번호가 당겨졌거나 다른 pick 이 그 자리에 왔으면 부모 줄
        const r = parseRow(prev);
        if (r?.kind === 'pick') {
          const a = r.ref.service === null ? before.projectPicks[r.ref.pick] : before.services[r.ref.service]?.picks[r.ref.pick];
          const b = r.ref.service === null ? after.projectPicks[r.ref.pick] : after.services[r.ref.service]?.picks[r.ref.pick];
          const same = a !== undefined && b !== undefined && a.preset === b.preset && a.ruleId === b.ruleId;
          if (!same) return parentRow(before, prev);
        }
        return prev;
      }
      return rowExists(after, parentRow(before, prev)) ? parentRow(before, prev) : PROJECT_ROW;
    }
  }
}

/** 줄 이름 (D89) — 그 pick 의 첫 이름과 나머지 수(딸린 이름 포함). 계획이 온전할 때(result 있음)만 — 아니면 undefined(화면은 —).
 *  항목에 pick 경로가 없으므로 항목 키 머리 `<level>/<service>/<type>/<kindToken|->/<tier|->/` 로 거른다 — D86 뒤로 중복 키와 같아
 *  온전한 계획에서는 pick 마다 유일하다(role 규칙은 역할까지, 입력 없는 규칙은 `-` 까지). core 를 바꾸지 않는다 */
export function rowNames(plan: WizardPlan, ref: PickRef, result: ProjectResult | undefined): { first: string; rest: number } | undefined {
  if (!result) return undefined;
  const pick = ref.service === null ? plan.projectPicks[ref.pick] : plan.services[ref.service]?.picks[ref.pick];
  if (!pick) return undefined;
  const rule = pickRule(pick);
  if (!rule) return undefined;
  const preset = pick.preset === null ? undefined : presetOf(pick.preset);
  const tier = pick.tier ?? preset?.tier ?? undefined;
  const kind = pick.kind === undefined ? preset?.kind : pick.kind;
  const token = kind === undefined || kind === null ? null : kindToken(rule, kind);
  const tok = typeof token === 'string' && token !== '' ? token : '-';
  const head = ref.service === null ? 'project/-' : `service/${serviceNamespace(plan.services[ref.service]!.purpose)}`;
  const base = `${head}/${rule.resourceType}/${tok}/${tier ?? '-'}`;
  const input = inputKind(rule);
  const own = input === 'count' ? `${base}/` : `${base}/${input === 'role' ? pick.role ?? DEFAULT_ROLE : '-'}`;
  const items = result.items.filter((i) => (input === 'count' ? i.key.startsWith(own) : i.key === own || i.key.startsWith(`${own}/`)));
  if (items.length === 0) return undefined;
  return { first: items[0]!.name, rest: items.length - 1 };
}

/** 화면이 모델을 바꿀 때 넘기는 선택 동작 — 값 그대로이거나, 바뀐 계획을 보고 정하는 함수(새 pick 의 자리 번호는 바꾼 뒤에야 안다) */
export type EditOp = SelectionOp | ((before: WizardPlan, after: WizardPlan) => SelectionOp);
export type Edit = (fn: (p: WizardPlan) => WizardPlan, op?: EditOp) => void;

/** 묶음 끝에 더해진 pick 을 선택한다 — 더해지지 않았으면(상한) 그대로 */
export const selectAdded = (service: number | null): EditOp => (before, after) => {
  const n = (p: WizardPlan) => (service === null ? p.projectPicks.length : p.services[service]?.picks.length ?? 0);
  return n(after) > n(before) ? { type: 'select', path: pickPath({ service, pick: n(after) - 1 }) } : { type: 'keep' };
};

/** 끝에 하나 더해진 pick 줄 — 목록이 잠깐 강조하고 보이게 굴린다(칩 토글은 선택을 옮기지 않으므로). 없으면 undefined */
export function addedRow(before: WizardPlan, after: WizardPlan): RowPath | undefined {
  if (before.services.length !== after.services.length) return undefined;
  if (after.projectPicks.length === before.projectPicks.length + 1) return pickPath({ service: null, pick: after.projectPicks.length - 1 });
  for (let i = 0; i < after.services.length; i++) {
    const a = after.services[i]!.picks.length;
    if (a === (before.services[i]?.picks.length ?? 0) + 1) return pickPath({ service: i, pick: a - 1 });
  }
  return undefined;
}
