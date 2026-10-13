// 마법사 Custom 창 (D95) — 순수 함수. 창은 한 목록(서비스 하나 또는 프로젝트 공용)의 custom pick 을 트리의 선택(Picked)으로 보이고,
// 트리가 바꾼 선택을 계획 편집으로 옮긴다. 체크하면 더하고 · 풀면 그 규칙의 custom pick 을 지우고 · 개수 · 역할 · 종류는 그 pick 에 옮긴다.
// 프리셋 칩 · 카드로 더한 pick 은 보지도 건드리지도 않는다
import { DEFAULT_ROLE } from '../core/engine';
import { inputKind, type TreeNode } from '../core/tree';
import { MAX_PICKS_PER_SERVICE, validatePlan, type Pick, type WizardPlan } from '../core/wizard/plan';
import type { ResourceRule } from '../core/types';
import { treeRules, type Picked, type PickedEntry } from './selection';
import { addCustom, addSlot, pickPath, pickRule, removeSlot, setPickField, type PickRef } from './wizardState';
import { parseRow, type RowPath, type SelectionOp } from './wizardSelection';

const listOf = (plan: WizardPlan, service: number | null): readonly Pick[] =>
  service === null ? plan.projectPicks : plan.services[service]?.picks ?? [];

/** 그 규칙의 custom pick 자리 — 목록 순서 */
function customAt(plan: WizardPlan, service: number | null, ruleId: string): number[] {
  return listOf(plan, service).flatMap((p, i) => (p.preset === null && p.ruleId === ruleId ? [i] : []));
}

/** 목록의 custom pick → 트리의 선택. 트리에 있는 규칙만(트리 밖 규칙의 pick — 프로젝트 이름 등 — 은 창에 보이지 않는다).
 *  같은 규칙의 custom pick 이 둘 이상이면(Duplicate) 첫 것을 보인다. 개수는 서버 줄 수, 역할이 없으면 엔진이 채우는 기본 역할 */
export function customPicked(plan: WizardPlan, service: number | null, tree: TreeNode): Picked {
  const byId = new Map(treeRules(tree).map((r) => [r.id, r]));
  const out = new Map<string, PickedEntry>();
  for (const p of listOf(plan, service)) {
    if (p.preset !== null) continue;
    const rule = byId.get(p.ruleId ?? '');
    if (!rule || out.has(rule.resourceType)) continue;
    const input = inputKind(rule);
    out.set(rule.resourceType, {
      count: input === 'count' ? Math.max(1, p.instances?.length ?? 1) : 1,
      ...(input === 'role' ? { role: p.role ?? DEFAULT_ROLE } : {}),
      ...(p.kind === undefined ? {} : { kind: p.kind }),
    });
  }
  return out;
}

/** 그 규칙의 custom pick 을 모두 지운다 — 체크 상자 하나가 그 규칙을 가리키므로 풀면 남지 않아야 한다. 지운 자리를 함께 돌려준다 */
export function removeCustom(plan: WizardPlan, service: number | null, ruleId: string): { plan: WizardPlan; removed: number[] } {
  const removed = customAt(plan, service, ruleId);
  if (removed.length === 0) return { plan, removed };
  const keep = listOf(plan, service).filter((_, i) => !removed.includes(i));
  const next = service === null
    ? { ...plan, projectPicks: keep }
    : { ...plan, services: plan.services.map((s, i) => (i === service ? { ...s, picks: keep } : s)) };
  return { plan: next, removed };
}

export interface CustomChange { plan: WizardPlan; added: string[]; removed: number[] }

/** 트리가 바꾼 선택(next)을 계획에 옮긴다 — 지금 계획에서 읽은 선택(customPicked)과 대어 더하기 · 지우기 · 고치기를 구분한다.
 *  added 는 새로 더한 규칙 id, removed 는 지운 pick 의 (지우기 전) 자리 */
export function applyCustomChange(plan: WizardPlan, service: number | null, tree: TreeNode, next: Picked): CustomChange {
  const cur = customPicked(plan, service, tree);
  let p = plan;
  const added: string[] = [];
  const removed: number[] = [];
  for (const rule of treeRules(tree)) {
    const a = cur.get(rule.resourceType);
    const b = next.get(rule.resourceType);
    if (!a && b) {
      const after = addCustom(p, service, { ruleId: rule.id, input: inputKind(rule), count: b.count, ...(b.role === undefined ? {} : { role: b.role }), ...(b.kind === undefined ? {} : { kind: b.kind }) });
      if (after !== p) { p = after; added.push(rule.id); }
    } else if (a && !b) {
      const r = removeCustom(p, service, rule.id);
      p = r.plan;
      removed.push(...r.removed);
    } else if (a && b) {
      p = updateCustom(p, service, rule, a, b);
    }
  }
  return { plan: p, added, removed };
}

/** 고른 규칙의 첫 custom pick 에 개수(서버 줄 — 끝에 더하고 끝에서 지운다) · 역할 · 종류를 옮긴다 */
function updateCustom(plan: WizardPlan, service: number | null, rule: ResourceRule, a: PickedEntry, b: PickedEntry): WizardPlan {
  const at = customAt(plan, service, rule.id)[0];
  if (at === undefined) return plan;
  const ref: PickRef = { service, pick: at };
  let p = plan;
  if (b.role !== a.role) p = setPickField(p, ref, 'role', b.role);
  if (b.kind !== a.kind) p = setPickField(p, ref, 'kind', b.kind);
  if (inputKind(rule) === 'count' && b.count !== a.count) {
    for (let n = a.count; n < b.count; n++) p = addSlot(p, ref);
    for (let n = a.count; n > b.count; n--) {
      const len = listOf(p, service)[at]?.instances?.length ?? 0;
      if (len <= 1) break;
      p = removeSlot(p, ref, len - 1);
    }
  }
  return p;
}

/** 행을 새로 체크할 수 없는 까닭 — 목록이 상한(MAX_PICKS_PER_SERVICE)에 닿았거나 · 더하면 같은 목록의 pick 과 이름이 같아진다(엔진의 duplicate_pick).
 *  중복은 같은 목록에 같은 종류의 pick 이 있을 때만 엔진에 묻는다 — 중복 키는 목록마다 따로 센다(행마다 validatePlan 을 돌리지 않는다) */
export function customBlock(plan: WizardPlan, service: number | null, rule: ResourceRule, kind: string | undefined): 'full' | 'duplicate' | undefined {
  const list = listOf(plan, service);
  if (list.length >= MAX_PICKS_PER_SERVICE) return 'full';
  if (!list.some((p) => pickRule(p)?.resourceType === rule.resourceType)) return undefined;
  const input = inputKind(rule);
  const next = addCustom(plan, service, { ruleId: rule.id, input, count: 1, ...(input === 'role' ? { role: DEFAULT_ROLE } : {}), ...(kind === undefined ? {} : { kind }) });
  const at = pickPath({ service, pick: list.length });
  const check = validatePlan(next);
  return !check.ok && check.errors.some((e) => e.code === 'wizard.duplicate_pick' && e.path === at) ? 'duplicate' : undefined;
}

/** 창을 닫을 때 고를 pick — 이 창에서 더한 규칙 가운데 아직 남은 마지막 것의 custom pick. 남은 것이 없으면 undefined(선택을 바꾸지 않는다) */
export function lastAddedPath(plan: WizardPlan, service: number | null, added: readonly string[]): string | undefined {
  for (let i = added.length - 1; i >= 0; i--) {
    const at = customAt(plan, service, added[i]!);
    if (at.length > 0) return pickPath({ service, pick: at[at.length - 1]! });
  }
  return undefined;
}

/** 창에서 pick 을 지웠을 때 고른 줄 — 지운 pick 을 골랐으면 그 자리의 지우기 동작(형제로 옮긴다), 같은 목록의 뒤쪽 pick 을 골랐으면 당겨진 자리, 아니면 그대로 */
export function selectionAfterCustomRemove(selected: RowPath, service: number | null, removed: readonly number[]): SelectionOp {
  if (removed.length === 0) return { type: 'keep' };
  const r = parseRow(selected);
  if (r?.kind !== 'pick' || r.ref.service !== service) return { type: 'keep' };
  if (removed.includes(r.ref.pick)) return { type: 'removePick', path: selected };
  const shift = removed.filter((i) => i < r.ref.pick).length;
  return shift === 0 ? { type: 'keep' } : { type: 'select', path: pickPath({ service, pick: r.ref.pick - shift }) };
}
