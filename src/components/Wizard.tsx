// 이름 짓기 마법사 (D59 · D64 · D67 · D68) — ① 프로젝트 ② 서비스 ③ 용도 칩 ④ 선택지(HA · Serverless · 엔진) ⑤ 서버 줄마다 딸린 것 ⑥ 이름.
// 화면 상태는 마법사 모델(WizardPlan) 하나이고 URL hash `w` 에 실린다. 결과는 모델에서 매번 다시 만든다 — validatePlan → expandPlan → generateProject (D17 · D69).
// 판정은 전부 엔진 값이다 — 이 파일은 이름 규칙을 모른다. 오류는 엔진이 준 path 로 그 자리(서비스 · pick · 서버 줄 · 디스크)에 붙인다
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Copy, Plus, Server, Trash2, X } from 'lucide-react';
// serviceNamespace — 결과 묶음의 서비스 이름을 모델의 purpose 와 잇는다(정제는 엔진 함수로)
import { DEFAULT_ROLE, ENV_VALUES, MAX_CONTEXT_CHARS, generateProject, parseContext, parseProjectContext, serviceNamespace as serviceNamespaceOf, type NameItem, type ProjectResult } from '../core/engine';
import { buildTree, inputKind } from '../core/tree';
import { allowedKinds } from '../core/catalog';
import { REGIONAL_LOCATION, locationsFor } from '../core/regions';
import { MAX_COUNT, type Attachments } from '../core/selection';
import { MAX_SERVICES, expandPlan, validatePlan, type Pick, type PlanError, type WizardPlan } from '../core/wizard/plan';
import { MAX_DATA_DISKS } from '../core/wizard/attachments';
import { presetOf, type Preset } from '../core/wizard/presets';
import type { CoreMessage, Env, ResourceRule } from '../core/types';
import { AppHeader } from './AppHeader';
import { CloudPicker } from './CloudPicker';
import { CopyButton } from './CopyButton';
import { RegionPicker } from './RegionPicker';
import { ResourceTree } from './ResourceTree';
import { ResultCard } from './ResultCard';
import { allNamesText } from './namesExport';
import { treeRules, type Picked } from './selection';
import { decodeWizardState, encodeWizardState, hashKind, HASH_KEY, SERVERLESS_SHORT, type WizardNotices } from './urlState';
import { hashToRestore, hashToWrite, mismatchedLinkVersion, type LinkState } from './linkRevision';
import { NAMING_PATH, PICK_PATH, PRIVACY_PATH, WIZARD_PATH, withStateHash } from './route';
import { wizardLabels, wizardTerraform } from './wizardTerraform';
import { toWizardExport } from './wizardExport';
import * as S from './wizardState';
import { debounce, sendBeacon, sessionStore, visitOnce, wizardGenerateMeta, GENERATE_DEBOUNCE_MS } from './beacon';
import { fillUi, format } from '../messages/catalog';
import { en } from '../messages/en';
import { VERSION } from '../version';

const PANEL = 'rounded-xl border border-zinc-200 bg-white p-4 shadow-xs dark:border-zinc-800 dark:bg-zinc-900';
const NOTICE = 'rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200';
const LABEL = 'block text-sm font-medium text-zinc-800 dark:text-zinc-200';
const HINT = 'text-xs text-zinc-600 dark:text-zinc-400';
const CONTROL =
  'mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-500 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600 ' +
  'aria-invalid:border-rose-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-400 dark:focus-visible:outline-indigo-400';
const SMALL_INPUT =
  'w-16 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-center font-mono text-sm text-zinc-900 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600 aria-invalid:border-rose-600 ' +
  'dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100';
const BTN =
  'inline-flex min-h-9 items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 ' +
  'disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ' +
  'dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800';
const ICON_BTN =
  'inline-flex size-9 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-rose-700 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:hover:bg-zinc-800 dark:hover:text-rose-300';
const CHIP =
  'inline-flex min-h-9 items-center gap-1 rounded-full border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ' +
  'aria-pressed:border-indigo-600 aria-pressed:bg-indigo-600 aria-pressed:text-white border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100 ' +
  'dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 dark:aria-pressed:border-indigo-500 dark:aria-pressed:bg-indigo-500';
const ERR = 'text-xs text-rose-700 dark:text-rose-300';
const STEP_NUM = 'mr-1.5 text-indigo-600 dark:text-indigo-400';

const ENV_NAMES: Record<Env, string> = { prod: 'Production', stg: 'Staging', dev: 'Development', sbx: 'Sandbox', qa: 'Quality assurance', uat: 'User acceptance', test: 'Test', perf: 'Performance', dr: 'Disaster recovery' };
/** 규칙 표 — 표시 이름 · 종류 표 · custom 모달의 트리. 화면 안에서 한 번 만든다 */
const TREE = buildTree('gcp');
const RULES = new Map<string, ResourceRule>(treeRules(TREE).map((r) => [r.id, r]));
const SERVERLESS_LABEL: Record<string, string> = { gcf: en.ui.wizard_serverless_gcf, run: en.ui.wizard_serverless_run };

/** 엔진 오류 문장 — 자리에 붙여 보이므로 `picks[0]: ` · `services[1]: ` 머리는 뗀다(API 문장은 그대로다) */
function inline(e: CoreMessage): string {
  return format(e, en).replace(/^(?:picks|services)\[-?\d+\]: /, '');
}
function ErrorList({ errors, id }: { errors: readonly CoreMessage[]; id?: string }) {
  if (errors.length === 0) return null;
  return (
    <ul id={id} data-wizard-error className={`space-y-0.5 ${ERR}`}>
      {[...new Set(errors.map(inline))].map((t) => <li key={t}>{t}</li>)}
    </ul>
  );
}

// ── 첫 상태 — hash 가 마법사 링크면 그것, 아니면 예시 ──
interface Start { plan: WizardPlan; notices?: WizardNotices; broken: boolean; link?: LinkState }
function startFrom(hash: string, brokenAtRoot: boolean): Start {
  if (hashKind(hash) === 'wizard') {
    const d = decodeWizardState(hash);
    if (!d) return { plan: S.initialPlan(), broken: true };
    const plan = d.plan ?? S.initialPlan(d.project);
    const key = encodeWizardState(plan, VERSION.rules) ?? '';
    return { plan, notices: d.notices, broken: false, link: { key, hash, ...(d.rulesVersion === undefined ? {} : { rulesVersion: d.rulesVersion }) } };
  }
  return { plan: S.initialPlan(), broken: brokenAtRoot };
}

function noticeLines(n: WizardNotices | undefined): string[] {
  if (!n) return [];
  if (n.discarded) return [en.ui.wizard_link_discarded];
  return [
    ...(n.dropped > 0 ? [fillUi(en, 'wizard_link_dropped', { n: n.dropped })] : []),
    ...(n.haOff > 0 ? [fillUi(en, 'wizard_link_ha_off', { n: n.haOff })] : []),
    ...(n.serverlessOff > 0 ? [fillUi(en, 'wizard_link_serverless_off', { n: n.serverlessOff })] : []),
    ...(n.trimmed > 0 ? [fillUi(en, 'wizard_link_trimmed', { n: n.trimmed })] : []),
  ];
}

/** brokenLink — 뿌리에 온 hash 가 어느 꼴로도 풀리지 않았다(한 줄 안내 · 예시로 연다) */
export function Wizard({ brokenLink = false }: { brokenLink?: boolean }) {
  const [start] = useState(() => startFrom(window.location.hash, brokenLink));
  const [plan, setPlanState] = useState<WizardPlan>(start.plan);
  const [notices, setNotices] = useState<string[]>(() => [...(start.broken ? [en.ui.wizard_link_broken] : []), ...noticeLines(start.notices)]);
  const [link, setLink] = useState<LinkState | undefined>(start.link);
  const [custom, setCustom] = useState<number | null | undefined>(undefined);
  /** 사용자가 바꾸면 링크 상태 · 링크 안내를 버린다 */
  const edit = (fn: (p: WizardPlan) => WizardPlan) => {
    setLink(undefined);
    setNotices([]);
    setPlanState(fn);
  };

  const projectParsed = useMemo(() => parseProjectContext(plan.project, 'gcp'), [plan.project]);
  const check = useMemo(() => validatePlan(plan), [plan]);
  const planErrors: PlanError[] = check.ok ? [] : check.errors;
  // 서비스 문맥(넷 + purpose) — validatePlan 이 지난 뒤에도 서비스 이름이 문맥으로 풀리는지
  const serviceErrors = useMemo(() => plan.services.map((s) => {
    const r = parseContext({ ...plan.project, purpose: s.purpose }, 'gcp');
    return r.ok ? [] : r.errors.filter((e) => 'field' in e && e.field === 'purpose');
  }), [plan]);
  const ready = check.ok && projectParsed.ok && serviceErrors.every((e) => e.length === 0);
  const result = useMemo<ProjectResult | undefined>(() => (ready ? generateProject(expandPlan(plan), 'gcp') : undefined), [ready, plan]);
  // 프로젝트 ID 미리보기 — 고른 것이 없어도 문맥 넷이 풀리면 보인다
  const projectId = useMemo(() => (projectParsed.ok ? generateProject({ project: projectParsed.context, projectItems: [], services: [] }, 'gcp').items[0] : undefined), [projectParsed]);

  // hash — 모델이 온전할 때만 쓴다(마지막 온전한 hash 가 남는다). 링크로 연 그대로인 동안은 쓰지 않는다 (D27 ⑵)
  const stateKey = ready ? encodeWizardState(plan, VERSION.rules) ?? '' : '';
  const linkedVersion = mismatchedLinkVersion(stateKey, link, VERSION.rules);
  useEffect(() => {
    const hash = hashToWrite(stateKey, link);
    if (hash !== undefined) window.history.replaceState(null, '', hash);
  }, [stateKey, link]);

  useEffect(() => {
    visitOnce(sessionStore());
  }, []);
  // ui_generate — 결과가 바뀐 뒤 1초 디바운스(첫 화면은 세지 않는다). 보낼 때의 모델에서 고른 규칙 id 둘만 싣는다 (D71)
  const lastSent = useRef(stateKey);
  const schedule = useMemo(() => debounce((meta: ReturnType<typeof wizardGenerateMeta>) => sendBeacon('ui_generate', meta), GENERATE_DEBOUNCE_MS), []);
  useEffect(() => {
    if (!stateKey || stateKey === lastSent.current) return;
    lastSent.current = stateKey;
    schedule(wizardGenerateMeta(plan));
  }, [stateKey, schedule, plan]);

  // 같은 탭 hash 이동 — 마법사 링크면 그 상태로 바꾸고, 트리 링크면 `/pick` 으로 옮기고, 깨진 hash 면 지금 상태로 되돌린다
  const current = useRef('');
  useEffect(() => {
    current.current = hashToRestore(stateKey, link, current.current);
  }, [stateKey, link]);
  const [addressHash, setAddressHash] = useState(() => window.location.hash);
  const nextAddress = hashToRestore(stateKey, link, addressHash);
  if (nextAddress !== addressHash) setAddressHash(nextAddress);
  useEffect(() => {
    const onHash = () => {
      const kind = hashKind(window.location.hash);
      // 트리 꼴 hash 는 트리 경로에서 연다 (D76)
      if (kind === 'tree') { window.location.replace(PICK_PATH + window.location.search + window.location.hash); return; }
      if (kind === 'wizard') {
        const s = startFrom(window.location.hash, false);
        if (!s.broken) {
          lastSent.current = s.link?.key ?? '';
          setPlanState(s.plan);
          setLink(s.link);
          setNotices(noticeLines(s.notices));
          return;
        }
      }
      window.history.replaceState(null, '', current.current || window.location.pathname + window.location.search);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const shareText = stateKey ? `${window.location.origin}${WIZARD_PATH}#${HASH_KEY}=${stateKey}` : undefined;

  return (
    <div className="min-h-screen">
      <AppHeader
        screen="wizard" otherHref={PICK_PATH} namingHref={withStateHash(NAMING_PATH, addressHash)}
        share={shareText && <CopyButton text={shareText} label={en.ui.share_button_label} copyKey="share-url">{en.ui.share_button}</CopyButton>}
      />
      <main data-wizard className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        <p className="max-w-3xl text-sm text-zinc-700 dark:text-zinc-300">{en.ui.wizard_intro}</p>
        {linkedVersion && <p data-rules-mismatch role="status" className={NOTICE}>{fillUi(en, 'rules_version_mismatch', { linked: linkedVersion, current: VERSION.rules })}</p>}
        {notices.map((t) => <p key={t} data-wizard-notice role="status" className={NOTICE}>{t}</p>)}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-6">
            {/* CSP — GCP 하나만 켜져 있다. 번호 없는 머리라 ①~⑥ 은 그대로 · hash 에 provider 키가 없어 이름 · 링크는 같다 (D75) */}
            <div data-wizard-cloud className={PANEL}>
              <CloudPicker value="gcp" onPick={() => {}} numbered={false} />
            </div>
            <div className={PANEL}>
              <ProjectForm plan={plan} errors={projectParsed.ok ? [] : projectParsed.errors} projectId={projectId} onChange={(project) => edit((p) => S.setProject(p, project))} />
            </div>
            <div className={PANEL}>
              <ProjectResources plan={plan} errors={planErrors} edit={edit} onCustom={() => setCustom(null)} />
            </div>
            <ServiceList plan={plan} errors={planErrors} serviceErrors={serviceErrors} edit={edit} onCustom={setCustom} />
          </div>
          <div className="min-w-0">
            <div className={PANEL}>
              <WizardResults plan={plan} result={result} errors={planErrors} projectContext={projectParsed.ok ? projectParsed.context : undefined} />
            </div>
          </div>
        </div>
      </main>

      {custom !== undefined && (
        <CustomDialog service={custom} plan={plan} onClose={() => setCustom(undefined)}
          onPick={(rule, entry) => {
            edit((p) => S.addCustom(p, custom, { ruleId: rule.id, input: inputKind(rule), count: entry.count, ...(entry.role === undefined ? {} : { role: entry.role }), ...(entry.kind === undefined ? {} : { kind: entry.kind }) }));
            setCustom(undefined);
          }} />
      )}

      <footer className="mx-auto max-w-7xl px-4 pb-6 text-xs text-zinc-600 dark:text-zinc-400">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span data-version>{fillUi(en, 'version_footer', VERSION)}</span>
          <a href={withStateHash(PRIVACY_PATH, addressHash)} data-footer-privacy className="underline hover:text-zinc-900 dark:hover:text-zinc-100">{en.ui.footer_privacy}</a>
        </p>
      </footer>
    </div>
  );
}

// ── ① 프로젝트 ──
function ProjectForm({ plan, errors, projectId, onChange }: { plan: WizardPlan; errors: CoreMessage[]; projectId: NameItem | undefined; onChange: (p: WizardPlan['project']) => void }) {
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
      <h2 id="wizard-project" className="text-base font-semibold"><span aria-hidden="true" className={STEP_NUM}>1</span>{en.ui.wizard_step_project} <span className={`ml-1 font-normal ${HINT}`}>{en.ui.wizard_project_hint}</span></h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {text('owner', 'Owner', en.ui.field_owner_hint, en.ui.field_owner_placeholder)}
        {text('system', 'System', en.ui.field_system_hint, en.ui.field_system_placeholder)}
        <div>
          <label htmlFor="wizard-env" className={LABEL}>Environment</label>
          <select id="wizard-env" value={v.env} onChange={(e) => onChange({ ...v, env: e.target.value })} className={CONTROL}>
            {ENV_VALUES.map((x) => <option key={x} value={x}>{`${x} — ${ENV_NAMES[x]}`}</option>)}
          </select>
        </div>
        <RegionPicker provider="gcp" value={v.region} onChange={(region) => onChange({ ...v, region })} error={errorFor('region')} labelClass={LABEL} controlClass={CONTROL} />
      </div>
      <dl data-project-preview className="grid gap-2 rounded-lg bg-zinc-50 p-3 text-sm sm:grid-cols-[auto_minmax(0,1fr)] dark:bg-zinc-950">
        <dt className={HINT}>{en.ui.wizard_project_id}</dt>
        <dd><code data-project-id className="break-all font-mono">{projectId?.name || '—'}</code></dd>
        <dt className={HINT}>{en.ui.wizard_common_parts}</dt>
        <dd data-common-parts className="flex flex-wrap gap-1.5">
          {parsed.ok && [parsed.context.system, parsed.context.env, parsed.context.region].map((t, i) => (
            <code key={`${t}-${i}`} className="rounded bg-white px-1.5 py-0.5 font-mono text-xs ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700">{t}</code>
          ))}
        </dd>
      </dl>
    </section>
  );
}

// ── 프로젝트 공용 — 네트워크 칩(VPC · 서브넷 · Cloud Router · Cloud NAT · 방화벽 tier 줄) · custom(프로젝트 수준 범위의 규칙만 — D74) ──
function ProjectResources({ plan, errors, edit, onCustom }: { plan: WizardPlan; errors: PlanError[]; edit: (fn: (p: WizardPlan) => WizardPlan) => void; onCustom: () => void }) {
  const firewall = presetOf('firewall');
  return (
    <section aria-labelledby="wizard-project-resources" className="space-y-3">
      <h2 id="wizard-project-resources" className="text-base font-semibold">{en.ui.wizard_project_resources} <span className={`ml-1 font-normal ${HINT}`}>{en.ui.wizard_project_resources_hint}</span></h2>
      <div className="flex flex-wrap items-center gap-2">
        {S.PROJECT_PRESETS.filter((p) => !p.tierChoices).map((p) => (
          <button key={p.id} type="button" data-project-chip={p.id} aria-pressed={S.findPreset(plan, null, p.id) >= 0} className={CHIP}
            onClick={() => edit((x) => S.togglePreset(x, null, p.id))}>{p.label}</button>
        ))}
        <button type="button" data-project-chip="custom" className={CHIP} onClick={onCustom}>{en.ui.wizard_custom}</button>
      </div>
      {firewall?.tierChoices && (
        <div className="flex flex-wrap items-center gap-2">
          <span className={HINT}>{en.ui.wizard_firewall_tiers}</span>
          {firewall.tierChoices.map((t) => (
            <button key={t} type="button" data-project-chip={`firewall-${t}`} aria-pressed={S.findPreset(plan, null, 'firewall', t) >= 0} className={CHIP}
              onClick={() => edit((x) => S.togglePreset(x, null, 'firewall', t))}>{`${firewall.label} · ${t}`}</button>
          ))}
        </div>
      )}
      <ErrorList errors={S.errorsAt(errors, 'projectPicks')} />
      {plan.projectPicks.map((pick, i) => (
        <PickPanel key={`p-${i}-${pick.preset ?? pick.ruleId}-${pick.tier ?? ''}`} pick={pick} at={{ service: null, pick: i }} errors={errors} edit={edit} />
      ))}
    </section>
  );
}

// ── ② 서비스 ──
function ServiceList({ plan, errors, serviceErrors, edit, onCustom }: {
  plan: WizardPlan; errors: PlanError[]; serviceErrors: CoreMessage[][]; edit: (fn: (p: WizardPlan) => WizardPlan) => void; onCustom: (service: number) => void;
}) {
  return (
    <section aria-labelledby="wizard-services" className="space-y-4">
      <div className="space-y-1">
        <h2 id="wizard-services" className="text-base font-semibold"><span aria-hidden="true" className={STEP_NUM}>2</span>{en.ui.wizard_step_services}</h2>
        <p className={HINT}>{en.ui.wizard_services_hint}</p>
      </div>
      {plan.services.map((_svc, i) => (
        <ServiceCard key={i} index={i} plan={plan} errors={errors} contextErrors={serviceErrors[i] ?? []} edit={edit} onCustom={() => onCustom(i)} />
      ))}
      <button type="button" data-add-service disabled={plan.services.length >= MAX_SERVICES} className={BTN} onClick={() => edit(S.addService)}>
        <Plus aria-hidden="true" className="size-4" />{en.ui.wizard_add_service}
      </button>
    </section>
  );
}

function ServiceCard({ index, plan, errors, contextErrors, edit, onCustom }: {
  index: number; plan: WizardPlan; errors: PlanError[]; contextErrors: CoreMessage[]; edit: (fn: (p: WizardPlan) => WizardPlan) => void; onCustom: () => void;
}) {
  const svc = plan.services[index]!;
  const id = `wizard-service-${index}`;
  const own = [...S.errorsAt(errors, `services[${index}]`), ...contextErrors];
  return (
    <div data-service={index} className={`${PANEL} space-y-4`}>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className={LABEL}>{en.ui.wizard_service_name}</label>
          <input id={id} data-service-name type="text" value={svc.purpose} maxLength={MAX_CONTEXT_CHARS} placeholder={en.ui.wizard_service_placeholder}
            autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-invalid={own.length > 0 ? true : undefined} aria-describedby={own.length > 0 ? `${id}-error` : undefined}
            onChange={(e) => edit((p) => S.renameService(p, index, e.target.value))} className={CONTROL} />
        </div>
        <button type="button" data-remove-service aria-label={fillUi(en, 'wizard_remove_service', { name: svc.purpose || String(index + 1) })} title={fillUi(en, 'wizard_remove_service', { name: svc.purpose || String(index + 1) })}
          className={ICON_BTN} onClick={() => edit((p) => S.removeService(p, index))}><Trash2 aria-hidden="true" className="size-4" /></button>
      </div>
      <ErrorList id={`${id}-error`} errors={own} />

      <div className="space-y-2">
        <h3 className="text-sm font-semibold"><span aria-hidden="true" className={STEP_NUM}>3</span>{en.ui.wizard_step_purposes} <span className={`ml-1 font-normal ${HINT}`}>{en.ui.wizard_purposes_hint}</span></h3>
        <div className="flex flex-wrap gap-2" role="group" aria-label={en.ui.wizard_step_purposes}>
          {S.SERVICE_PRESETS.filter((p) => p.group === undefined).map((p) => (
            <PurposeChip key={p.id} preset={p} pressed={S.findPreset(plan, index, p.id) >= 0} onClick={() => edit((x) => S.togglePreset(x, index, p.id))} />
          ))}
          <button type="button" data-purpose-chip="custom" className={CHIP} onClick={onCustom}>{en.ui.wizard_custom}</button>
        </div>
        {/* 로드 밸런서 부품 (D73) — 방화벽 tier 줄과 같은 하위 줄. 칩 하나 = 이름 하나 · 서로 엮지 않는다 */}
        <div data-lb-parts className="flex flex-wrap items-center gap-2" role="group" aria-label={en.ui.wizard_lb_parts}>
          <span className={HINT}>{en.ui.wizard_lb_parts}</span>
          {S.SERVICE_PRESETS.filter((p) => p.group === 'lb').map((p) => (
            <PurposeChip key={p.id} preset={p} pressed={S.findPreset(plan, index, p.id) >= 0} onClick={() => edit((x) => S.togglePreset(x, index, p.id))} />
          ))}
        </div>
      </div>

      {svc.picks.map((pick, j) => (
        <PickPanel key={`${j}-${pick.preset ?? pick.ruleId}`} pick={pick} at={{ service: index, pick: j }} errors={errors} edit={edit} />
      ))}
    </div>
  );
}

function PurposeChip({ preset, pressed, onClick }: { preset: Preset; pressed: boolean; onClick: () => void }) {
  return (
    <button type="button" data-purpose-chip={preset.id} aria-pressed={pressed} className={CHIP} onClick={onClick}>
      <span className="font-mono">{preset.id}</span><span className="text-xs opacity-80">{preset.label}</span>
    </button>
  );
}

// ── ④ 선택지 · 서버 줄 ──
function pickTitle(pick: Pick): { title: string; custom: boolean } {
  const preset = pick.preset === null ? undefined : presetOf(pick.preset);
  if (preset) return { title: `${preset.label}${preset.tierChoices ? ` · ${pick.tier ?? preset.tier}` : ''}`, custom: false };
  return { title: RULES.get(pick.ruleId ?? '')?.displayName ?? pick.ruleId ?? '', custom: true };
}

function PickPanel({ pick, at, errors, edit }: { pick: Pick; at: S.PickRef; errors: PlanError[]; edit: (fn: (p: WizardPlan) => WizardPlan) => void }) {
  const path = S.pickPath(at);
  const preset: Preset | undefined = pick.preset === null ? undefined : presetOf(pick.preset);
  const ruleId = S.effectiveRuleId(pick);
  const rule = ruleId ? RULES.get(ruleId) : undefined;
  const { title, custom } = pickTitle(pick);
  const kinds = rule ? allowedKinds(rule) : [];
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
    <div data-pick={pick.preset ?? 'custom'} data-pick-path={path} className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-2">
        <h4 className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
          <Server aria-hidden="true" className="size-4 text-indigo-600 dark:text-indigo-400" />{title}
          {custom && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{en.ui.wizard_custom_badge}</span>}
        </h4>
        <div className="flex shrink-0 items-center gap-1">
          {tierInput && (
            <button type="button" data-duplicate-pick aria-label={fillUi(en, 'wizard_duplicate_pick', { name: title })} title={fillUi(en, 'wizard_duplicate_pick', { name: title })} className={ICON_BTN}
              onClick={() => edit((p) => S.duplicatePick(p, at))}><Copy aria-hidden="true" className="size-4" /></button>
          )}
          <button type="button" data-remove-pick aria-label={fillUi(en, 'wizard_remove_pick', { name: title })} title={fillUi(en, 'wizard_remove_pick', { name: title })} className={ICON_BTN}
            onClick={() => edit((p) => S.removePick(p, at))}><X aria-hidden="true" className="size-4" /></button>
        </div>
      </div>
      <ErrorList errors={own} />

      {/* ④ 선택지 — 서버형(web · was)만 HA · Serverless, 종류가 있는 규칙(Cloud SQL · GKE · LB 부품)은 종류, tier 를 정하지 않은 pick 은 tier(D74), role 규칙(sa 칩 포함)은 역할 */}
      {(preset?.serverless || preset?.ha || kinds.length > 0 || locations.length > 0 || globalDefault || tierInput || roleInput) && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400"><span aria-hidden="true" className={STEP_NUM}>4</span>{en.ui.wizard_step_options}</p>
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

      {counted && rule && (
        <InstanceRows pick={pick} at={at} path={path} attachable={attachable} name={rule.displayName} errors={errors} edit={edit} />
      )}
    </div>
  );
}

/** 서버 줄 — VM(딸린 것을 받는 규칙)은 「Servers」 · 「Add server」, 나머지는 규칙 이름으로(「Add Subnet」 — D75) */
function InstanceRows({ pick, at, path, attachable, name, errors, edit }: {
  pick: Pick; at: S.PickRef; path: string; attachable: boolean; name: string; errors: PlanError[]; edit: (fn: (p: WizardPlan) => WizardPlan) => void;
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
            <Plus aria-hidden="true" className="size-4" />{attachable ? en.ui.wizard_add_server : fillUi(en, 'wizard_add_resource', { name })}
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

/** ⑤ 서버 줄마다 딸린 것 — 접힌 칸. 요약 줄은 이름 꼬리(boot · data-01 · ip · ipi)를 보인다 */
function AttachEditor({ attach, at, slot, path, errors, edit, baseId }: {
  attach: Attachments | undefined; at: S.PickRef; slot: number; path: string; errors: PlanError[]; edit: (fn: (p: WizardPlan) => WizardPlan) => void; baseId: string;
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
        <span className="font-medium"><span aria-hidden="true" className={STEP_NUM}>5</span>{en.ui.wizard_step_attached}</span>
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
function CustomDialog({ service, plan, onClose, onPick }: { service: number | null; plan: WizardPlan; onClose: () => void; onPick: (rule: ResourceRule, entry: { count: number; role?: string; kind?: string }) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const name = service === null ? en.ui.wizard_project_resources : plan.services[service]?.purpose || String((service ?? 0) + 1);
  // 프로젝트 공용 칸은 프로젝트 수준 범위의 규칙만 (D74)
  const tree = service === null ? S.PROJECT_CUSTOM_TREE : S.CUSTOM_TREE;
  const onChange = (next: Picked) => {
    for (const [type, entry] of next) {
      const rule = treeRules(tree).find((r) => r.resourceType === type);
      if (rule) { onPick(rule, entry); return; }
    }
  };
  return (
    <dialog ref={ref} data-custom-dialog aria-labelledby="custom-title" onClose={onClose} onCancel={onClose}
      className="m-auto max-h-[90vh] w-[min(56rem,calc(100vw-2rem))] overflow-auto rounded-xl border border-zinc-200 bg-white p-4 text-zinc-900 shadow-xl backdrop:bg-zinc-900/50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 id="custom-title" className="text-base font-semibold">{fillUi(en, 'wizard_custom_title', { service: name })}</h2>
          <p className={HINT}>{service === null ? en.ui.wizard_custom_hint_project : en.ui.wizard_custom_hint_service}</p>
        </div>
        <button type="button" data-custom-close aria-label={en.ui.wizard_custom_close} className={ICON_BTN} onClick={onClose}><X aria-hidden="true" className="size-4" /></button>
      </div>
      <ResourceTree provider="gcp" tree={tree} picked={new Map()} onChange={onChange} />
    </dialog>
  );
}

// ── ⑥ 이름 ──
function WizardResults({ plan, result, errors, projectContext }: { plan: WizardPlan; result: ProjectResult | undefined; errors: PlanError[]; projectContext: Parameters<typeof toWizardExport>[1] | undefined }) {
  const empty = errors.some((e) => e.code === 'wizard.empty');
  const wide = errors.filter((e) => e.path === undefined && e.code !== 'wizard.empty' && !('field' in e));
  const names = result?.items.length ?? 0;
  const pass = result?.items.filter((i) => i.valid).length ?? 0;
  return (
    <section id="names" aria-labelledby="wizard-names" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="wizard-names" className="text-base font-semibold"><span aria-hidden="true" className={STEP_NUM}>6</span>{en.ui.wizard_step_names}</h2>
        {result && (
          <span data-names-summary className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${pass === names
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
            : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300'}`}>
            {fillUi(en, 'wizard_names_summary', { names, pass })}
          </span>
        )}
      </div>
      <p data-pass-meaning className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{en.ui.pass_meaning}</p>
      {!result && (
        <p role="status" data-names-empty className="rounded-lg border border-dashed border-zinc-300 p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          {empty ? en.ui.wizard_names_empty : en.ui.wizard_fix_errors}
        </p>
      )}
      <ErrorList errors={wide} />
      {result && projectContext && <ResultList plan={plan} result={result} projectContext={projectContext} />}
    </section>
  );
}

function ResultList({ plan, result, projectContext }: { plan: WizardPlan; result: ProjectResult; projectContext: Parameters<typeof toWizardExport>[1] }) {
  const all = useMemo(() => allNamesText(result), [result]);
  const json = useMemo(() => JSON.stringify(toWizardExport(result, projectContext, plan, VERSION), null, 2), [result, projectContext, plan]);
  const hcl = useMemo(() => wizardTerraform(result, wizardLabels(expandPlan(plan), 'gcp'), VERSION, en), [result, plan]);
  const byKey = useMemo(() => new Map(result.items.map((i) => [i.key, i])), [result]);
  // 이름공간마다 묶는다 — 프로젝트 → 서비스(모델 순서). 항목 순서는 엔진 순서(부모 바로 뒤 자식)
  const groups = useMemo(() => {
    const out: Array<{ ns: string; items: NameItem[] }> = [];
    for (const it of result.items) {
      const ns = it.namespace ?? '';
      const last = out[out.length - 1];
      if (last && last.ns === ns) last.items.push(it);
      else out.push({ ns, items: [it] });
    }
    return out;
  }, [result]);
  const serviceName = (ns: string) => plan.services.find((s) => serviceNamespaceOf(s.purpose) === ns)?.purpose ?? ns;
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={all.text} label={en.ui.copy_all_names_label} disabled={all.text === ''} copyKey="all-names">
          {all.skipped > 0 ? fillUi(en, 'copy_all_names_skipped', { n: all.skipped }) : en.ui.copy_all_names}
        </CopyButton>
        <CopyButton text={json} label={en.ui.copy_names_json_label} copyKey="names-json">JSON</CopyButton>
        <CopyButton text={hcl} label={en.ui.copy_terraform_label} copyKey="terraform">Terraform</CopyButton>
      </div>
      {result.conflicts.length > 0 && (
        <ul data-conflicts className="space-y-1 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
          {result.conflicts.map((c) => { const t = format(c, en); return <li key={t}>{en.ui.conflict_prefix} {t}</li>; })}
        </ul>
      )}
      {groups.map((g, i) => (
        <div key={`${g.ns}-${i}`} data-names-group={g.ns} className="space-y-2">
          <h3 data-scope-path className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            {g.ns === 'project' ? en.ui.wizard_group_project : fillUi(en, 'wizard_group_service', { name: serviceName(g.ns) })}
          </h3>
          <div className="space-y-2">
            {g.items.map((r) => (
              <Indented key={r.key} child={r.parent !== undefined}>
                <ResultCard result={r} parentName={r.parent === undefined ? undefined : byKey.get(r.parent)?.name} />
              </Indented>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function Indented({ child, children }: { child: boolean; children: ReactNode }) {
  return child ? <div data-child className="ml-4 border-l-2 border-indigo-200 pl-3 sm:ml-6 dark:border-indigo-900">{children}</div> : <>{children}</>;
}
