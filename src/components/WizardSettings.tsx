// 마법사 설정 칸 (D89) — 목록에서 고른 줄 하나의 설정. ① 프로젝트 · ② 네트워크 칩 · 공용 추가 리소스 · ③ 서비스(④ 용도 칩) · pick(⑤ 선택지 · 서버 줄 · ⑥ 딸린 것).
// 판정은 전부 엔진 값이다 — 오류는 엔진이 준 path 로 그 자리에 붙인다. 이 칸은 선택 경로로 key 한 컴포넌트 하나이고,
// 안의 입력칸은 tier · kind 로 key 하지 않는다(글자마다 다시 만들어지면 커서가 빠진다)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Copy, Plus, Server, Trash2, X } from 'lucide-react';
import { DEFAULT_ROLE, ENV_VALUES, MAX_CONTEXT_CHARS, parseProjectContext, type NameItem } from '../core/engine';
import { inputKind } from '../core/tree';
import { allowedKinds } from '../core/catalog';
import { REGIONAL_LOCATION, locationsFor } from '../core/regions';
import { MAX_COUNT, type Attachments } from '../core/selection';
import { MAX_PICKS_PER_SERVICE, type Pick, type PlanError, type WizardPlan } from '../core/wizard/plan';
import { MAX_DATA_DISKS } from '../core/wizard/attachments';
import { presetOf, type Preset } from '../core/wizard/presets';
import type { CoreMessage, Env, ResourceRule } from '../core/types';
import { RegionPicker } from './RegionPicker';
import { ResourceTree } from './ResourceTree';
import type { Picked } from './selection';
import { applyCustomChange, customBlock, customPicked, type CustomChange } from './wizardCustom';
import { SERVERLESS_SHORT } from './urlState';
import * as S from './wizardState';
import { selectAdded, type Edit, type RowPath } from './wizardSelection';
import { CardGallery } from './WizardCards';
import { BTN, CHIP, CONTROL, ENV_NAMES, ERR, HINT, ICON_BTN, LABEL, RULES, SMALL_INPUT, inline } from './wizardStyles';
import { fillUi, format } from '../messages/catalog';
import { en } from '../messages/en';

// 프로젝트 pick 상한 안내 — 숫자는 엔진 상수에서 온다(D91: 20 → 40)
const PICKS_FULL = fillUi(en, 'wizard_project_picks_full', { max: MAX_PICKS_PER_SERVICE });
const CUSTOM_FULL = fillUi(en, 'wizard_custom_full', { max: MAX_PICKS_PER_SERVICE });
const SERVERLESS_LABEL: Record<string, string> = { gcf: en.ui.wizard_serverless_gcf, run: en.ui.wizard_serverless_run };

export function ErrorList({ errors, id }: { errors: readonly CoreMessage[]; id?: string }) {
  if (errors.length === 0) return null;
  return (
    <ul id={id} data-wizard-error className={`space-y-0.5 ${ERR}`}>
      {[...new Set(errors.map(inline))].map((t) => <li key={t}>{t}</li>)}
    </ul>
  );
}

// ── ① 프로젝트 ──
export function ProjectForm({ plan, envs, onToggleEnv, errors, projectIds, projectNames, suffixErrors, onSuffix, onChange }: {
  plan: WizardPlan; envs: readonly Env[]; onToggleEnv: (env: Env) => void; errors: CoreMessage[]; projectIds: readonly (NameItem | undefined)[]; projectNames: readonly ({ name: string } | undefined)[];
  suffixErrors: readonly CoreMessage[]; onSuffix: (value: string) => void; onChange: (p: WizardPlan['project']) => void;
}) {
  const v = plan.project;
  const errorFor = (f: string) => {
    const e = errors.find((m) => 'field' in m && m.field === f);
    return e ? format(e, en) : undefined;
  };
  const parsed = parseProjectContext(v, 'gcp');
  const text = (key: 'owner' | 'system', label: string, hint: string, placeholder: string) => {
    const id = `wizard-${key}`;
    const err = errorFor(key);
    return (
      <div>
        <label htmlFor={id} className={LABEL}>{label} <span className={`ml-1 font-normal ${HINT}`}>{hint}</span></label>
        <input id={id} type="text" value={v[key]} maxLength={MAX_CONTEXT_CHARS} placeholder={placeholder} autoCapitalize="off" autoCorrect="off" spellCheck={false}
          aria-invalid={err ? true : undefined} aria-describedby={err ? `${id}-error` : undefined}
          onChange={(e) => onChange({ ...v, [key]: e.target.value })} className={CONTROL} />
        {err && <p id={`${id}-error`} className={`mt-1 ${ERR}`}>{err}</p>}
      </div>
    );
  };
  return (
    <section aria-labelledby="wizard-project" className="space-y-4">
      <h2 id="wizard-project" className="text-base font-semibold">{en.ui.wizard_step_project} <span className={`ml-1 font-normal ${HINT}`}>{en.ui.wizard_project_hint}</span></h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {text('owner', 'Owner', en.ui.field_owner_hint, en.ui.field_owner_placeholder)}
        {text('system', 'System', en.ui.field_system_hint, en.ui.field_system_placeholder)}
        {/* 환경 — 칩 여럿 (D82). 둘 이상 고르면 같은 계획을 env 마다 짓는다 · 마지막 하나는 끌 수 없다 */}
        <div role="group" aria-labelledby="wizard-envs-label" aria-describedby="wizard-envs-hint" className="sm:col-span-2">
          <p id="wizard-envs-label" className={LABEL}>{en.ui.wizard_envs} <span id="wizard-envs-hint" className={`ml-1 font-normal ${HINT}`}>{en.ui.wizard_envs_hint}</span></p>
          <div className="mt-1 flex flex-wrap gap-2">
            {ENV_VALUES.map((x) => (
              <button key={x} type="button" data-env-chip={x} aria-pressed={envs.includes(x)} title={ENV_NAMES[x]} className={CHIP}
                onClick={() => onToggleEnv(x)}>{x}</button>
            ))}
          </div>
        </div>
        <RegionPicker provider="gcp" value={v.region} onChange={(region) => onChange({ ...v, region })} error={errorFor('region')} labelClass={LABEL} controlClass={CONTROL} />
        {/* 프로젝트 ID 접미사 (D85) — 선택. tier 와 같은 꼴 · 예약어. 빈 칸이면 모델에서 키를 지운다 */}
        <div>
          <label htmlFor="wizard-project-id-suffix" className={LABEL}>{en.ui.wizard_project_id_suffix} <span className={`ml-1 font-normal ${HINT}`}>{en.ui.wizard_project_id_suffix_hint}</span></label>
          <input id="wizard-project-id-suffix" data-project-id-suffix type="text" value={plan.projectIdSuffix ?? ''} maxLength={16} autoCapitalize="off" autoCorrect="off" spellCheck={false}
            aria-invalid={suffixErrors.length > 0 ? true : undefined} aria-describedby={suffixErrors.length > 0 ? 'wizard-project-id-suffix-error wizard-project-id-notice' : 'wizard-project-id-notice'}
            onChange={(e) => onSuffix(e.target.value)} className={CONTROL} />
          <ErrorList id="wizard-project-id-suffix-error" errors={suffixErrors} />
        </div>
      </div>
      <p id="wizard-project-id-notice" data-project-id-notice className={HINT}>{en.ui.wizard_project_id_notice}</p>
      <dl data-project-preview className="grid gap-2 rounded-lg bg-zinc-50 p-3 text-sm sm:grid-cols-[auto_minmax(0,1fr)] dark:bg-zinc-950">
        <dt className={HINT}>{en.ui.wizard_project_name}</dt>
        <dd className="flex flex-col gap-0.5">
          {projectNames.length === 0 && <code data-project-name className="break-all font-mono">—</code>}
          {projectNames.map((n, i) => <code key={envs[i] ?? i} data-project-name className="break-all font-mono">{n?.name || '—'}</code>)}
        </dd>
        <dt className={HINT}>{en.ui.wizard_project_id}</dt>
        <dd className="flex flex-col gap-0.5">
          {projectIds.length === 0 && <code data-project-id className="break-all font-mono">—</code>}
          {projectIds.map((id, i) => <code key={envs[i] ?? i} data-project-id className="break-all font-mono">{id?.name || '—'}</code>)}
        </dd>
        <dt className={HINT}>{en.ui.wizard_common_parts}</dt>
        <dd data-common-parts className="flex flex-wrap gap-1.5">
          {parsed.ok && [parsed.context.system, ...(envs.length > 0 ? envs : [parsed.context.env]), parsed.context.region].map((t, i) => (
            <code key={`${t}-${i}`} className="rounded bg-white px-1.5 py-0.5 font-mono text-xs ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700">{t}</code>
          ))}
        </dd>
      </dl>
    </section>
  );
}

// ── ② 필수 네트워크 (D84) — 네트워크 칩(VPC · 서브넷 · Cloud Router · Cloud NAT · 방화벽 tier 줄 · PSA 대역)과 그 프리셋 pick ──
// 모델은 projectPicks 하나다 — 이 칸은 프리셋 pick 만, 「Shared extra resources」는 custom pick 만 그린다(자리 번호 · path 는 모델 순서 그대로)
const FIREWALL_HINTS: Record<string, string> = { iap: en.ui.wizard_firewall_iap_hint, lbhc: en.ui.wizard_firewall_lbhc_hint };
const FIREWALL_PROBLEM: Record<NonNullable<ReturnType<typeof S.firewallTierProblem>>, string> = {
  pattern: en.ui.wizard_firewall_custom_hint, reserved: en.ui.wizard_firewall_custom_hint, exists: en.ui.wizard_firewall_custom_exists, full: PICKS_FULL,
};

export function NetworkSettings({ plan, errors, edit }: { plan: WizardPlan; errors: PlanError[]; edit: Edit }) {
  const firewall = presetOf('firewall');
  // 방화벽 tier 직접 입력 (D87) — 이 칸의 상태. 엔진 검사와 같은 꼴 · 예약어에 「이미 있다」를 더해 미리 막는다
  const [typed, setTyped] = useState('');
  const problem = typed === '' ? undefined : S.firewallTierProblem(plan, typed);
  const subnets = plan.projectPicks.filter((p) => p.preset === 'subnet').length;
  // 프로젝트 pick 상한 — ② 와 Shared extras 를 합친 수. 닿으면 더하는 단추를 끄고 까닭을 보인다(켜진 칩을 끄는 것은 된다)
  const full = S.projectPicksFull(plan);
  return (
    <section aria-labelledby="wizard-network" className="space-y-3">
      <h2 id="wizard-network" className="text-base font-semibold">{en.ui.wizard_project_resources} <span className={`ml-1 font-normal ${HINT}`}>{en.ui.wizard_project_resources_hint}</span></h2>
      <div className="flex flex-wrap items-center gap-2">
        {S.PROJECT_PRESETS.filter((p) => !p.tierChoices).map((p) => (
          // 서브넷 칩 (D86) — 하나 이상이면 눌린 상태 · 끄면 「Add subnet」으로 더한 것까지 전부 뗀다
          <button key={p.id} type="button" data-project-chip={p.id} aria-pressed={S.findPreset(plan, null, p.id) >= 0} className={CHIP}
            disabled={full && S.findPreset(plan, null, p.id) < 0} aria-describedby={full ? 'wizard-network-full' : undefined}
            onClick={() => edit((x) => (p.id === 'subnet' && subnets > 0 ? S.removePresetPicks(x, null, 'subnet') : S.togglePreset(x, null, p.id)))}>{p.label}</button>
        ))}
        {subnets > 0 && (
          <button type="button" data-add-subnet disabled={full} aria-describedby={full ? 'wizard-network-full' : undefined} className={BTN} onClick={() => edit((x) => S.addPresetPick(x, null, 'subnet'), selectAdded(null))}>
            <Plus aria-hidden="true" className="size-4" />{en.ui.wizard_add_subnet}
          </button>
        )}
      </div>
      {full && <p id="wizard-network-full" data-project-picks-full className={ERR}>{PICKS_FULL}</p>}
      {firewall?.tierChoices && (
        <div className="flex flex-wrap items-center gap-2">
          <span className={HINT}>{en.ui.wizard_firewall_tiers}</span>
          {firewall.tierChoices.map((t) => (
            <button key={t} type="button" data-project-chip={`firewall-${t}`} aria-pressed={S.findPreset(plan, null, 'firewall', t) >= 0} className={CHIP} title={FIREWALL_HINTS[t]}
              disabled={full && S.findPreset(plan, null, 'firewall', t) < 0}
              onClick={() => edit((x) => S.togglePreset(x, null, 'firewall', t))}>{`${firewall.label} · ${t}`}</button>
          ))}
          <form className="flex items-center gap-1" onSubmit={(e) => {
            e.preventDefault();
            if (typed === '' || problem) return;
            edit((x) => S.togglePreset(x, null, 'firewall', typed), selectAdded(null));
            setTyped('');
          }}>
            <label htmlFor="wizard-firewall-tier" className="sr-only">{en.ui.wizard_firewall_custom}</label>
            <input id="wizard-firewall-tier" data-firewall-tier type="text" value={typed} maxLength={16} placeholder={en.ui.wizard_firewall_custom} autoCapitalize="off" autoCorrect="off" spellCheck={false}
              aria-invalid={problem ? true : undefined} aria-describedby="wizard-firewall-tier-hint"
              onChange={(e) => setTyped(e.target.value)} className={`${SMALL_INPUT} w-32 text-left`} />
            <button type="submit" data-firewall-tier-add disabled={typed === '' || problem !== undefined} className={BTN}>
              <Plus aria-hidden="true" className="size-4" />{en.ui.wizard_firewall_custom_add}
            </button>
          </form>
        </div>
      )}
      {firewall?.tierChoices && (
        <p id="wizard-firewall-tier-hint" data-firewall-tier-hint className={problem ? ERR : HINT}>{problem ? FIREWALL_PROBLEM[problem] : en.ui.wizard_firewall_custom_hint}</p>
      )}
      <ErrorList errors={S.errorsAt(errors, 'projectPicks')} />
      {/* 한 번에 비우기 (D90) — 서버리스만 쓰는 계획용. 확인 창 없음: 칩을 다시 켜거나 링크로 되돌린다 */}
      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <button type="button" data-clear-network disabled={S.projectPickIndexes(plan, 'network').length === 0} className={BTN}
          onClick={() => edit(S.clearNetwork)}><Trash2 aria-hidden="true" className="size-4" />{en.ui.wizard_clear_network}</button>
        <span className={HINT}>{en.ui.wizard_clear_network_hint}</span>
      </div>
    </section>
  );
}

// ── 공용 추가 리소스 (D84 · 번호 없음) — 서비스 하나에 묶이지 않는 custom(프로젝트 수준 범위의 규칙만 — D74) ──
export function ExtrasSettings({ plan, onCustom }: { plan: WizardPlan; onCustom: () => void }) {
  return (
    <section aria-labelledby="wizard-shared-extras" className="space-y-3">
      <h2 id="wizard-shared-extras" className="text-base font-semibold">{en.ui.wizard_shared_extras} <span className={`ml-1 font-normal ${HINT}`}>{en.ui.wizard_shared_extras_hint}</span></h2>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" data-project-chip="custom" className={CHIP} disabled={S.projectPicksFull(plan)} aria-describedby={S.projectPicksFull(plan) ? 'wizard-extras-full' : undefined} onClick={onCustom}>{en.ui.wizard_custom}</button>
      </div>
      {S.projectPicksFull(plan) && <p id="wizard-extras-full" data-project-picks-full className={ERR}>{PICKS_FULL}</p>}
    </section>
  );
}

// ── ③ 서비스 — 이름 · 삭제 · ④ 용도 칩 · 로드 밸런서 부품. 고른 pick 은 목록의 줄이다 (D89) ──
export function ServiceSettings({ index, plan, errors, contextErrors, edit, onCustom, onSelect }: {
  index: number; plan: WizardPlan; errors: PlanError[]; contextErrors: CoreMessage[]; edit: Edit; onCustom: () => void; onSelect: (path: RowPath) => void;
}) {
  const svc = plan.services[index]!;
  const id = `wizard-service-${index}`;
  const own = [...S.errorsAt(errors, `services[${index}]`), ...contextErrors];
  return (
    <div data-service={index} className="space-y-4">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className={LABEL}>{en.ui.wizard_service_name}</label>
          <input id={id} data-service-name type="text" value={svc.purpose} maxLength={MAX_CONTEXT_CHARS} placeholder={en.ui.wizard_service_placeholder}
            autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-invalid={own.length > 0 ? true : undefined} aria-describedby={own.length > 0 ? `${id}-error` : undefined}
            onChange={(e) => edit((p) => S.renameService(p, index, e.target.value))} className={CONTROL} />
        </div>
        <button type="button" data-remove-service aria-label={fillUi(en, 'wizard_remove_service', { name: svc.purpose || String(index + 1) })} title={fillUi(en, 'wizard_remove_service', { name: svc.purpose || String(index + 1) })}
          className={ICON_BTN} onClick={() => edit((p) => S.removeService(p, index), { type: 'removeService', service: index })}><Trash2 aria-hidden="true" className="size-4" /></button>
      </div>
      <ErrorList id={`${id}-error`} errors={own} />

      <CardGallery plan={plan} service={index} edit={edit} onSelect={onSelect} />

      {/* 하나씩 고르기 (D93) — 칩 · 로드 밸런서 부품 · Custom 은 접힌 칸 안이다. 카드가 주 경로이고 칩은 세부 조정이다 */}
      <details data-add-more className="rounded-lg border border-dashed border-zinc-300 px-3 py-2 dark:border-zinc-700">
        <summary className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
          <ChevronRight data-chevron aria-hidden="true" className="size-4 shrink-0 transition-transform" />
          <span><span className="font-semibold">{en.ui.wizard_add_more}</span> <span className={HINT}>— {en.ui.wizard_add_more_hint}</span></span>
        </summary>
        <div className="space-y-2 pb-1 pt-2">
          <p className={HINT}>{en.ui.wizard_purposes_hint}</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label={en.ui.wizard_step_purposes}>
            {S.SERVICE_PRESETS.filter((p) => p.group === undefined).map((p) => (
              <PurposeChip key={p.id} preset={p} pressed={S.findPreset(plan, index, p.id) >= 0} onClick={() => edit((x) => S.togglePreset(x, index, p.id))} />
            ))}
            <button type="button" data-purpose-chip="custom" className={CHIP} onClick={onCustom}>{en.ui.wizard_custom}</button>
          </div>
          {/* 로드 밸런서 부품 — 칩 하나 = 이름 하나. 동작하는 묶음은 위 카드가 더한다 */}
          <div data-lb-parts className="flex flex-wrap items-center gap-2" role="group" aria-label={en.ui.wizard_lb_parts}>
            <span className={HINT}>{en.ui.wizard_lb_parts}</span>
            {S.SERVICE_PRESETS.filter((p) => p.group === 'lb').map((p) => (
              <PurposeChip key={p.id} preset={p} pressed={S.findPreset(plan, index, p.id) >= 0} onClick={() => edit((x) => S.togglePreset(x, index, p.id))} />
            ))}
          </div>
        </div>
      </details>
      {svc.picks.length === 0 && <p data-service-empty className={HINT}>{en.ui.wizard_service_no_picks}</p>}
    </div>
  );
}

function PurposeChip({ preset, pressed, onClick }: { preset: Preset; pressed: boolean; onClick: () => void }) {
  return (
    <button type="button" data-purpose-chip={preset.id} aria-pressed={pressed} className={CHIP} onClick={onClick}>
      {/* 뜻이 앞 · 큰 글자, 약어는 뒤 · 작은 글자 (review P3 · P11 — 불투명도 없이 대비를 지킨다) */}
      <span>{preset.label}</span><span className="font-mono text-[13px] font-normal">{preset.id}</span>
    </button>
  );
}

// ── ⑤ 선택지 · 서버 줄 ──
export function PickPanel({ pick, at, errors, edit }: { pick: Pick; at: S.PickRef; errors: PlanError[]; edit: Edit }) {
  const path = S.pickPath(at);
  const preset: Preset | undefined = pick.preset === null ? undefined : presetOf(pick.preset);
  const ruleId = S.effectiveRuleId(pick);
  const rule = ruleId ? RULES.get(ruleId) : undefined;
  const { title, custom } = S.pickTitle(pick);
  // 고정 종류 프리셋(psa · D88)은 종류를 고르지 않는다 — 칸을 숨긴다
  const kinds = rule && preset?.kind === undefined ? allowedKinds(rule) : [];
  // 위치 (D78) — 멀티 · 이중 리전을 받는 규칙(버킷 · BigQuery 데이터세트)만. 비우면 프로젝트 지역.
  // 기본이 전역인 규칙(Secret · D79)은 전역(비움) · 지역(regional — 프로젝트 지역) 둘
  const locations = rule ? locationsFor(rule) : [];
  const globalDefault = rule?.defaultLocation === 'global';
  const counted = rule ? inputKind(rule) === 'count' : false;
  // 역할 입력 — role 규칙이면 프리셋(sa)이든 custom 이든. 비우면 엔진이 기본 역할을 쓴다
  const roleInput = rule ? inputKind(rule) === 'role' : false;
  // tier 입력 · 「Duplicate」 — 규칙에 tier 자리가 있고 프리셋이 tier 를 정하지 않은 pick (D74)
  const tierInput = S.tierEditable(pick);
  const attachable = S.canAttach(pick);
  const own = S.errorsAt(errors, path);
  const base = `wizard-${path.replace(/[^a-z0-9]+/gi, '-')}`;
  const svFor = (id: string | undefined) => Object.entries(SERVERLESS_SHORT).find(([, v]) => v === id)?.[0] ?? '';

  return (
    <div data-pick={pick.preset ?? 'custom'} data-pick-path={path} className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <h2 className="flex flex-wrap items-center gap-1.5 text-base font-semibold">
          <Server aria-hidden="true" className="size-4 text-indigo-600 dark:text-indigo-400" />{title}
          {custom && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{en.ui.wizard_custom_badge}</span>}
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          {tierInput && (
            <button type="button" data-duplicate-pick aria-label={fillUi(en, 'wizard_duplicate_pick', { name: title })} title={fillUi(en, 'wizard_duplicate_pick', { name: title })} className={ICON_BTN}
              onClick={() => edit((p) => S.duplicatePick(p, at), { type: 'select', path: S.pickPath({ service: at.service, pick: at.pick + 1 }) })}><Copy aria-hidden="true" className="size-4" /></button>
          )}
          <button type="button" data-remove-pick aria-label={fillUi(en, 'wizard_remove_pick', { name: title })} title={fillUi(en, 'wizard_remove_pick', { name: title })} className={ICON_BTN}
            onClick={() => edit((p) => S.removePick(p, at), { type: 'removePick', path })}><X aria-hidden="true" className="size-4" /></button>
        </div>
      </div>
      <ErrorList errors={own} />

      {/* ⑤ 선택지 — 서버형(web · was)만 HA · Serverless, 종류가 있는 규칙(Cloud SQL · GKE · LB 부품)은 종류, tier 를 정하지 않은 pick 은 tier(D74), role 규칙(sa 칩 포함)은 역할 */}
      {(preset?.serverless || preset?.ha || kinds.length > 0 || locations.length > 0 || globalDefault || tierInput || roleInput) && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">{en.ui.wizard_step_options}</p>
          <div className="flex flex-wrap items-end gap-4">
            {preset?.serverless && (
              <div>
                <label htmlFor={`${base}-sv`} className={LABEL}>{en.ui.wizard_serverless}</label>
                <select id={`${base}-sv`} data-serverless value={svFor(pick.serverless ?? undefined)} className={CONTROL}
                  onChange={(e) => edit((p) => S.setServerless(p, at, e.target.value === '' ? null : SERVERLESS_SHORT[e.target.value] ?? null))}>
                  <option value="">{en.ui.wizard_serverless_off}</option>
                  {preset.serverless.ruleIds.map((id) => { const s = svFor(id); return <option key={id} value={s}>{SERVERLESS_LABEL[s] ?? id}</option>; })}
                </select>
              </div>
            )}
            {S.showsHa(pick) && (
              <label className="inline-flex min-h-9 items-center gap-2 text-sm font-medium">
                <input type="checkbox" data-ha checked={pick.ha === true} onChange={(e) => edit((p) => S.setHa(p, at, e.target.checked))} className="size-4 accent-indigo-600" />
                {en.ui.wizard_ha}
              </label>
            )}
            {kinds.length > 0 && rule && (
              <div>
                <label htmlFor={`${base}-kind`} className={LABEL}>{fillUi(en, 'kind_label', { displayName: rule.displayName })}</label>
                <select id={`${base}-kind`} data-kind value={pick.kind ?? ''} className={CONTROL} onChange={(e) => edit((p) => S.setPickField(p, at, 'kind', e.target.value))}>
                  {rule.kinds?.rule !== 'required' && <option value="">{rule.kinds?.default ? fillUi(en, 'kind_default', { value: rule.kinds.default }) : en.ui.kind_none}</option>}
                  {rule.kinds?.rule === 'required' && pick.kind === undefined && <option value="">{en.ui.kind_choose}</option>}
                  {kinds.filter((k) => k !== rule.kinds?.default).map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
            )}
            {(locations.length > 0 || globalDefault) && (
              <div>
                <label htmlFor={`${base}-location`} className={LABEL}>{en.ui.wizard_location}</label>
                <select id={`${base}-location`} data-location value={pick.location ?? ''} className={CONTROL} onChange={(e) => edit((p) => S.setPickField(p, at, 'location', e.target.value))}>
                  <option value="">{globalDefault ? en.ui.wizard_location_global : en.ui.wizard_location_default}</option>
                  {globalDefault && <option value={REGIONAL_LOCATION}>{en.ui.wizard_location_regional}</option>}
                  {locations.map((l) => <option key={l.code} value={l.code}>{`${l.location} · ${l.type} · ${l.label}`}</option>)}
                </select>
              </div>
            )}
            {tierInput && (
              <div>
                <label htmlFor={`${base}-tier`} className={LABEL}>{en.ui.wizard_tier} <span className={`ml-1 font-normal ${HINT}`}>{en.ui.wizard_tier_hint}</span></label>
                <input id={`${base}-tier`} data-tier type="text" value={pick.tier ?? ''} maxLength={16} autoCapitalize="off" spellCheck={false} className={CONTROL}
                  onChange={(e) => edit((p) => S.setPickField(p, at, 'tier', e.target.value))} />
              </div>
            )}
            {roleInput && rule && (
              <div>
                <label htmlFor={`${base}-role`} className={LABEL}>{fillUi(en, 'role_label', { displayName: rule.displayName })}</label>
                <input id={`${base}-role`} data-role type="text" value={pick.role ?? ''} placeholder={DEFAULT_ROLE} maxLength={16} autoCapitalize="off" spellCheck={false} className={CONTROL}
                  onChange={(e) => edit((p) => S.setPickField(p, at, 'role', e.target.value))} />
              </div>
            )}
          </div>
          {pick.ha === true && <p data-ha-hint className={HINT}>{en.ui.wizard_ha_hint}</p>}
          {pick.serverless && <p className={HINT}>{en.ui.wizard_serverless_hint}</p>}
        </div>
      )}
      {pick.preset === 'bastion' && <p data-bastion-hint className={HINT}>{en.ui.wizard_bastion_hint}</p>}
      {pick.preset === 'nat' && <p data-nat-hint className={HINT}>{en.ui.wizard_nat_hint}</p>}

      {counted && rule && (
        <InstanceRows pick={pick} at={at} path={path} attachable={attachable} name={rule.displayName} errors={errors} edit={edit} />
      )}
    </div>
  );
}

/** 서버 줄 — VM(딸린 것을 받는 규칙)은 「Servers」 · 「Add server」, 나머지는 규칙 이름으로(「Add Subnet」 — D75) */
function InstanceRows({ pick, at, path, attachable, name, errors, edit }: {
  pick: Pick; at: S.PickRef; path: string; attachable: boolean; name: string; errors: PlanError[]; edit: Edit;
}) {
  const slots = pick.instances ?? [];
  const single = S.singleSlot(pick);
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">{attachable ? en.ui.wizard_servers : fillUi(en, 'wizard_rows_of', { name })}</p>
      <ul className="space-y-2">
        {slots.map((slot, k) => {
          const sp = `${path}.instances[${k}]`;
          const rowErrors = S.errorsAt(errors, sp);
          const bad = S.seqInvalid(slot.seq) || rowErrors.length > 0;
          const id = `wizard-${sp.replace(/[^a-z0-9]+/gi, '-')}`;
          return (
            <li key={slot.id} data-slot={slot.id} data-seq={slot.seq} className="rounded-md bg-zinc-50 p-2 dark:bg-zinc-950">
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor={`${id}-seq`} className="text-sm font-medium">{attachable ? en.ui.wizard_server_label : en.ui.wizard_server_number}</label>
                <input id={`${id}-seq`} data-slot-seq type="text" inputMode="numeric" value={slot.seq} maxLength={2} className={SMALL_INPUT}
                  aria-invalid={bad ? true : undefined} aria-describedby={bad ? `${id}-error` : undefined}
                  onChange={(e) => edit((p) => S.setSlotSeq(p, at, k, e.target.value))} />
                {slots.length > 1 && (
                  <button type="button" data-remove-slot aria-label={fillUi(en, 'wizard_remove_server', { seq: slot.seq })} title={fillUi(en, 'wizard_remove_server', { seq: slot.seq })}
                    className={ICON_BTN} onClick={() => edit((p) => S.removeSlot(p, at, k))}><X aria-hidden="true" className="size-4" /></button>
                )}
              </div>
              {(bad || rowErrors.length > 0) && (
                <div id={`${id}-error`}>
                  {S.seqInvalid(slot.seq) && rowErrors.length === 0 && <p className={ERR}>{en.ui.wizard_seq_invalid}</p>}
                  <ErrorList errors={rowErrors} />
                </div>
              )}
              {attachable && <AttachEditor attach={slot.attach} at={at} slot={k} path={sp} errors={errors} edit={edit} baseId={id} />}
            </li>
          );
        })}
      </ul>
      {!single && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" data-add-slot disabled={slots.length >= MAX_COUNT} className={BTN} onClick={() => edit((p) => S.addSlot(p, at))}>
            <Plus aria-hidden="true" className="size-4" />{attachable ? en.ui.wizard_add_server : pick.preset === 'subnet' ? en.ui.wizard_add_same_subnet : fillUi(en, 'wizard_add_resource', { name })}
          </button>
          {S.hasGaps(pick) && (
            <button type="button" data-renumber title={en.ui.wizard_renumber_hint} className={BTN} onClick={() => edit((p) => S.renumber(p, at))}>{en.ui.wizard_renumber}</button>
          )}
        </div>
      )}
      {!single && S.hasGaps(pick) && <p className={HINT}>{en.ui.wizard_renumber_hint}</p>}
    </div>
  );
}

/** ⑥ 서버 줄마다 딸린 것 — 접힌 칸. 요약 줄은 이름 꼬리(boot · data-01 · ip · ipi)를 보인다 */
function AttachEditor({ attach, at, slot, path, errors, edit, baseId }: {
  attach: Attachments | undefined; at: S.PickRef; slot: number; path: string; errors: PlanError[]; edit: Edit; baseId: string;
}) {
  const a = attach ?? {};
  const data = a.data ?? [];
  const summary = [...(a.boot ? ['boot'] : []), ...data.map((d) => `data-${d}`), ...(a.ip ? ['ip'] : []), ...(a.ipi ? ['ipi'] : [])];
  const attachErrors = S.errorsUnder(errors, `${path}.attach`).filter((e) => !/\.data\[\d+\]$/.test(e.path ?? ''));
  const flag = (key: 'boot' | 'ip' | 'ipi', label: string, hint?: string) => (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" data-attach={key} checked={a[key] === true} onChange={(e) => edit((p) => S.setFlag(p, at, slot, key, e.target.checked))} className="mt-0.5 size-4 accent-indigo-600" />
      <span>{label}{hint && <span className={`block ${HINT}`}>{hint}</span>}</span>
    </label>
  );
  return (
    <details data-attached className="mt-2 rounded-md border border-zinc-200 bg-white px-2 py-1 dark:border-zinc-800 dark:bg-zinc-900">
      <summary className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
        <span className="font-medium">{en.ui.wizard_step_attached}</span>
        <span data-attached-summary className={`font-mono ${HINT}`}>{summary.length > 0 ? summary.join(' · ') : en.ui.wizard_attached_none}</span>
      </summary>
      <div className="space-y-3 py-2">
        {flag('boot', en.ui.wizard_boot, en.ui.wizard_boot_hint)}
        <div className="space-y-1.5">
          <p className="text-sm font-medium">{en.ui.wizard_data_disks}</p>
          {data.length === 0 && <p className={HINT}>{en.ui.wizard_no_disks}</p>}
          <ul className="flex flex-wrap gap-2">
            {data.map((d, j) => {
              const dp = `${path}.attach.data[${j}]`;
              const derr = S.errorsAt(errors, dp);
              const bad = S.seqInvalid(d) || derr.length > 0;
              const id = `${baseId}-disk-${j}`;
              return (
                <li key={j} data-disk={d} className="flex items-center gap-1">
                  <label htmlFor={id} className="sr-only">{fillUi(en, 'wizard_disk_number', { n: j + 1 })}</label>
                  <span aria-hidden="true" className={`font-mono ${HINT}`}>data-</span>
                  <input id={id} data-disk-seq type="text" inputMode="numeric" value={d} maxLength={2} className={SMALL_INPUT} aria-invalid={bad ? true : undefined}
                    onChange={(e) => edit((p) => S.setDiskSeq(p, at, slot, j, e.target.value))} />
                  <button type="button" data-remove-disk aria-label={fillUi(en, 'wizard_remove_disk', { seq: d })} title={fillUi(en, 'wizard_remove_disk', { seq: d })} className={ICON_BTN}
                    onClick={() => edit((p) => S.removeDisk(p, at, slot, j))}><X aria-hidden="true" className="size-4" /></button>
                  {bad && <span className={ERR}>{derr.length > 0 ? inline(derr[0]!) : en.ui.wizard_seq_invalid}</span>}
                </li>
              );
            })}
          </ul>
          <button type="button" data-add-disk disabled={data.length >= MAX_DATA_DISKS} className={BTN} onClick={() => edit((p) => S.addDisk(p, at, slot))}>
            <Plus aria-hidden="true" className="size-4" />{en.ui.wizard_add_disk}
          </button>
        </div>
        {flag('ip', en.ui.wizard_ip)}
        {flag('ipi', en.ui.wizard_ipi)}
        <ErrorList errors={attachErrors} />
      </div>
    </details>
  );
}

// ── custom — 트리를 모달로 (ResourceTree 재사용) ──
// 창은 열린 채로 여러 행을 고른다 (D95) — 체크하면 그 목록에 더하고 · 풀면 그 custom pick 을 지운다. 프리셋 칩 · 카드로 더한 pick 은 보이지도 건드리지도 않는다.
// 범위 · 분류는 모두 접힌 채 연다. 「Done」 · ✕ · Esc 가 닫는다 — 닫을 때 고를 줄은 Wizard 가 정한다
export function CustomDialog({ service, plan, onClose, onApply }: { service: number | null; plan: WizardPlan; onClose: () => void; onApply: (fn: (p: WizardPlan) => WizardPlan, change: CustomChange) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const name = service === null ? en.ui.wizard_shared_extras : plan.services[service]?.purpose || String((service ?? 0) + 1);
  // 프로젝트 공용 칸은 프로젝트 수준 범위의 규칙만 (D74)
  const tree = service === null ? S.PROJECT_CUSTOM_TREE : S.CUSTOM_TREE;
  const picked = useMemo(() => customPicked(plan, service, tree), [plan, service, tree]);
  const onChange = (next: Picked) => {
    const change = applyCustomChange(plan, service, tree, next);
    if (change.plan !== plan) onApply((p) => applyCustomChange(p, service, tree, next).plan, change);
  };
  const addBlock = useCallback((rule: ResourceRule, kind: string | undefined) => {
    const b = customBlock(plan, service, rule, kind);
    return b === 'full' ? CUSTOM_FULL : b === 'duplicate' ? en.ui.wizard_custom_duplicate : undefined;
  }, [plan, service]);
  return (
    <dialog ref={ref} data-custom-dialog aria-labelledby="custom-title" aria-describedby="custom-hint" onClose={onClose} onCancel={onClose}
      className="m-auto max-h-[90vh] w-[min(56rem,calc(100vw-2rem))] overflow-auto rounded-xl border border-zinc-200 bg-white p-4 pb-0 text-zinc-900 shadow-xl backdrop:bg-zinc-900/50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 id="custom-title" className="text-base font-semibold">{fillUi(en, 'wizard_custom_title', { service: name })}</h2>
          <p id="custom-hint" className={HINT}>{service === null ? en.ui.wizard_custom_hint_project : en.ui.wizard_custom_hint_service}</p>
        </div>
        <button type="button" data-custom-close aria-label={en.ui.wizard_custom_close} className={ICON_BTN} onClick={onClose}><X aria-hidden="true" className="size-4" /></button>
      </div>
      <ResourceTree provider="gcp" tree={tree} picked={picked} onChange={onChange} start="collapsed" addBlock={addBlock} />
      <div className="sticky bottom-0 -mx-4 mt-3 flex justify-end border-t border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <button type="button" data-custom-done className={BTN} onClick={onClose}>{en.ui.wizard_custom_done}</button>
      </div>
    </dialog>
  );
}
