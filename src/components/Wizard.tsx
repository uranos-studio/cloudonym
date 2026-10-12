// 이름 짓기 마법사 (D59 · D64 · D67 · D68 · D84 · D89 · D90) — ① 프로젝트 ② 필수 네트워크 ③ 서비스 ④ 용도 칩 ⑤ 선택지(HA · Serverless · 엔진) ⑥ 서버 줄마다 딸린 것 · 번호 없는 공용 추가 리소스 · ⑦ 이름.
// 화면 상태는 마법사 모델(WizardPlan) 하나이고 URL hash `w` 에 실린다. 결과는 모델에서 매번 다시 만든다 — validatePlan → expandPlan → generateProject (D17 · D69).
// 넓은 화면은 세 칸이다(D89) — 목록(WizardList) · 고른 줄 하나의 설정(WizardSettings) · 이름(WizardNames). 고른 줄은 화면 상태이고 hash 에 싣지 않는다.
// 판정은 전부 엔진 값이다 — 이 파일은 이름 규칙을 모른다. 오류는 엔진이 준 path 로 그 자리(서비스 · pick · 서버 줄 · 디스크)에 붙인다
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { generateProject, parseContext, parseProjectContext } from '../core/engine';
import { inputKind } from '../core/tree';
import { checkProjectIdSuffix, expandPlan, validatePlan, type PlanError, type WizardPlan } from '../core/wizard/plan';
import type { CoreMessage, Env } from '../core/types';
import { AppHeader } from './AppHeader';
import { CloudPicker } from './CloudPicker';
import { CopyButton } from './CopyButton';
import { decodeWizardState, encodeWizardState, hashKind, HASH_KEY, type WizardNotices } from './urlState';
import { hashToRestore, hashToWrite, mismatchedLinkVersion, type LinkState } from './linkRevision';
import { NAMING_PATH, PICK_PATH, PRIVACY_PATH, WIZARD_PATH, withStateHash } from './route';
import { envList, toggleEnv, withEnv } from './wizardEnvs';
import * as S from './wizardState';
import { addedRow, expandedAfterRemove, firstErrorRow, parseRow, resolveSelection, selectAdded, selectionAfter, serviceRow, type Edit, type EditOp, type RowPath } from './wizardSelection';
import { WizardList } from './WizardList';
import { CustomDialog, ExtrasSettings, NetworkSettings, PickPanel, ProjectForm, ServiceSettings } from './WizardSettings';
import { WizardNames, type EnvResult } from './WizardNames';
import { NOTICE, PANEL } from './wizardStyles';
import { debounce, sendBeacon, sessionStore, visitOnce, wizardGenerateMeta, GENERATE_DEBOUNCE_MS } from './beacon';
import { fillUi } from '../messages/catalog';
import { en } from '../messages/en';
import { VERSION } from '../version';

// ── 첫 상태 — hash 가 마법사 링크면 그것, hash 가 없으면 네트워크를 미리 채운 첫 화면(D90), 깨진 링크면 빈 예시 ──
interface Start { plan: WizardPlan; envs: Env[]; notices?: WizardNotices; broken: boolean; link?: LinkState }
function startFrom(hash: string, brokenAtRoot: boolean): Start {
  if (hashKind(hash) === 'wizard') {
    const d = decodeWizardState(hash);
    if (!d) return { plan: S.initialPlan(), envs: [], broken: true };
    const plan = d.plan ?? S.initialPlan(d.project);
    const envs = d.envs ?? [];
    const key = encodeWizardState(plan, VERSION.rules, envs) ?? '';
    return { plan, envs, notices: d.notices, broken: false, link: { key, hash, ...(d.rulesVersion === undefined ? {} : { rulesVersion: d.rulesVersion }) } };
  }
  // 미리 채움은 hash 가 없을 때만 — 링크에서 떨어진 경로(깨진 링크)는 링크가 누구에게나 같도록 빈 예시로 연다
  return { plan: brokenAtRoot || hash !== '' ? S.initialPlan() : S.startPlan(), envs: [], broken: brokenAtRoot };
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

/** 서비스 문맥(넷 + purpose) 오류 — validatePlan 이 지난 뒤에도 서비스 이름이 문맥으로 풀리는지 */
function serviceErrorsOf(plan: WizardPlan): CoreMessage[][] {
  return plan.services.map((s) => {
    const r = parseContext({ ...plan.project, purpose: s.purpose }, 'gcp');
    return r.ok ? [] : r.errors.filter((e) => 'field' in e && e.field === 'purpose');
  });
}
/** 첫 선택 — 오류가 있는 첫 줄, 없으면 project (D89) */
function firstSelection(plan: WizardPlan): RowPath {
  const check = validatePlan(plan);
  const project = parseProjectContext(plan.project, 'gcp');
  const projectCount = (project.ok ? 0 : project.errors.length) + checkProjectIdSuffix(plan.projectIdSuffix).length;
  return firstErrorRow(plan, check.ok ? [] : check.errors.filter((e) => e.code !== 'wizard.empty'), serviceErrorsOf(plan), projectCount);
}

const FOCUSABLE = 'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** brokenLink — 뿌리에 온 hash 가 어느 꼴로도 풀리지 않았다(한 줄 안내 · 예시로 연다) */
export function Wizard({ brokenLink = false }: { brokenLink?: boolean }) {
  const [start] = useState(() => startFrom(window.location.hash, brokenLink));
  // 모델과 고른 줄은 한 상태다 — 바꾸는 함수 하나가 둘을 함께 정한다(선택 규칙은 wizardSelection.selectionAfter)
  const [state, setState] = useState<{ plan: WizardPlan; selected: RowPath }>(() => ({ plan: start.plan, selected: firstSelection(start.plan) }));
  const { plan } = state;
  const selected = resolveSelection(plan, state.selected);
  /** 고른 환경(D82) — 모델의 env 와 합친 목록이 화면의 환경이다. 첫째(표준값 순서)가 모델의 env 다 */
  const [extraEnvs, setExtraEnvs] = useState<Env[]>(start.envs);
  const [notices, setNotices] = useState<string[]>(() => [...(start.broken ? [en.ui.wizard_link_broken] : []), ...noticeLines(start.notices)]);
  const [link, setLink] = useState<LinkState | undefined>(start.link);
  const [custom, setCustom] = useState<number | null | undefined>(undefined);
  /** 사용자가 펴고 접은 서비스 줄 — 화면 상태. 손대지 않은 서비스는 고른 줄이 그 안일 때만 펴진다 */
  const [toggled, setToggled] = useState<ReadonlyMap<number, boolean>>(() => new Map());
  /** 칩 · 단발 추가로 막 더한 줄 — 더할 때마다 새 객체라 같은 줄을 다시 더해도 타이머가 다시 돈다 */
  const [flash, setFlash] = useState<{ path: RowPath } | undefined>(undefined);
  /** 사용자가 바꾸면 링크 상태 · 링크 안내를 버린다. op 는 고른 줄을 어떻게 옮길지(없으면 그대로) */
  const edit: Edit = (fn, op: EditOp = { type: 'keep' }) => {
    setLink(undefined);
    setNotices([]);
    // 서비스를 지우면 펼침 상태의 자리 번호도 당긴다 — 지운 서비스의 펼침이 다음 서비스에 붙지 않게
    if (typeof op !== 'function' && op.type === 'removeService') setToggled((t) => expandedAfterRemove(t, op.service));
    setState((s) => {
      const next = fn(s.plan);
      const o = typeof op === 'function' ? op(s.plan, next) : op;
      return { plan: next, selected: selectionAfter(o, resolveSelection(s.plan, s.selected), s.plan, next) };
    });
  };
  const select = (path: RowPath) => setState((s) => ({ ...s, selected: path }));

  // 고른 줄이 서비스 안이면 그 서비스를 편다(고른 pick 의 서비스는 늘 펴진다) · 칩으로 더한 줄은 잠깐 강조한다
  const sel = parseRow(selected);
  const selService = sel?.kind === 'service' ? sel.service : sel?.kind === 'pick' ? sel.ref.service : null;
  const isExpanded = (i: number) => (sel?.kind === 'pick' && selService === i) || (toggled.get(i) ?? selService === i);
  const prevPlan = useRef(plan);
  useEffect(() => {
    const added = addedRow(prevPlan.current, plan);
    prevPlan.current = plan;
    if (added) setFlash({ path: added });
  }, [plan]);
  // 강조를 끄는 타이머는 강조에만 묶는다 — 계획에 묶으면 더한 뒤 1.2초 안에 값을 고칠 때 타이머가 지워져 강조가 남는다
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(undefined), 1200);
    return () => window.clearTimeout(t);
  }, [flash]);
  const onExpand = (i: number, on: boolean) => {
    // 고른 줄이 그 서비스 안의 pick 이면 접어도 그 줄 때문에 펴진 채다 — 서비스 줄을 고르고(포커스도) 접는다
    if (!on && sel?.kind === 'pick' && sel.ref.service === i) {
      select(serviceRow(i));
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-row-path="${serviceRow(i)}"]`)?.focus());
    }
    setToggled((t) => new Map(t).set(i, on));
  };

  const envsKey = envList(plan.project.env, extraEnvs).join(',');
  const envs = useMemo(() => (envsKey === '' ? [] : envsKey.split(',') as Env[]), [envsKey]);
  const onToggleEnv = (env: Env) => {
    const next = toggleEnv(envs.length > 0 ? envs : [env], env);
    setLink(undefined);
    setNotices([]);
    setExtraEnvs(next);
    setState((s) => ({ ...s, plan: S.setProject(s.plan, { ...s.plan.project, env: next[0]! }) }));
  };

  const projectParsed = useMemo(() => parseProjectContext(plan.project, 'gcp'), [plan.project]);
  const check = useMemo(() => validatePlan(plan), [plan]);
  const planErrors: PlanError[] = check.ok ? [] : check.errors;
  const serviceErrors = useMemo(() => serviceErrorsOf(plan), [plan]);
  const ready = check.ok && projectParsed.ok && serviceErrors.every((e) => e.length === 0);
  // env 마다 같은 계획을 돌린다 (D82) — env 하나면 그 하나
  const results = useMemo<EnvResult[] | undefined>(() => (ready ? envs.map((env) => ({ env, result: generateProject(expandPlan(withEnv(plan, env)), 'gcp') })) : undefined), [ready, plan, envs]);
  // 프로젝트 ID 접미사 (D85) — 빈 모델이면 validatePlan 이 wizard.empty 에서 멈추므로 칸의 오류는 직접 검사한다. 미리보기에는 꼴을 지난 값만 싣는다
  const suffixErrors = useMemo(() => checkProjectIdSuffix(plan.projectIdSuffix), [plan.projectIdSuffix]);
  // 프로젝트 이름 · ID 미리보기 — 고른 것이 없어도 문맥 넷이 풀리면 보인다 · env 마다 하나. 이름은 암묵 항목이 아니다(D85) — 미리보기와 이름 칸의 표시 카드에만 나온다
  const previews = useMemo(() => (projectParsed.ok ? envs.map((env) => S.projectPreview({ ...projectParsed.context, env }, plan.projectIdSuffix)) : []), [projectParsed, envs, plan.projectIdSuffix]);
  const projectIds = previews.map((x) => x.id);
  const projectNames = previews.map((x) => x.name);
  const projectCount = (projectParsed.ok ? 0 : projectParsed.errors.length) + suffixErrors.length;

  // hash — 모델이 온전할 때만 쓴다(마지막 온전한 hash 가 남는다). 링크로 연 그대로인 동안은 쓰지 않는다 (D27 ⑵)
  const stateKey = ready ? encodeWizardState(plan, VERSION.rules, envs) ?? '' : '';
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
          // 계획이 통째로 바뀐다 — 고른 줄이 새 계획에 없으면 project (resolveSelection)
          setState((st) => ({ plan: s.plan, selected: resolveSelection(s.plan, st.selected) }));
          setToggled(new Map());
          setExtraEnvs(s.envs);
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

  // 키보드 — Enter 는 설정 칸 첫 컨트롤로, 설정 칸의 Esc 는 고른 줄로 되돌린다
  const settingsRef = useRef<HTMLElement>(null);
  const focusSettings = () => settingsRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  const onSettingsKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    document.querySelector<HTMLElement>(`[data-row-path="${selected}"]`)?.focus();
  };

  const settings = (() => {
    if (!sel || sel.kind === 'project') {
      return (
        <ProjectForm plan={plan} envs={envs} onToggleEnv={onToggleEnv} errors={projectParsed.ok ? [] : projectParsed.errors} projectIds={projectIds} projectNames={projectNames}
          suffixErrors={suffixErrors} onSuffix={(x) => edit((p) => S.setProjectIdSuffix(p, x))} onChange={(project) => edit((p) => S.setProject(p, project))} />
      );
    }
    if (sel.kind === 'network') return <NetworkSettings plan={plan} errors={planErrors} edit={edit} />;
    if (sel.kind === 'extras') return <ExtrasSettings plan={plan} onCustom={() => setCustom(null)} />;
    if (sel.kind === 'service') {
      return <ServiceSettings index={sel.service} plan={plan} errors={planErrors} contextErrors={serviceErrors[sel.service] ?? []} edit={edit} onCustom={() => setCustom(sel.service)} />;
    }
    const pick = sel.ref.service === null ? plan.projectPicks[sel.ref.pick] : plan.services[sel.ref.service]?.picks[sel.ref.pick];
    return pick ? <PickPanel pick={pick} at={sel.ref} errors={planErrors} edit={edit} /> : null;
  })();

  // 넓은 화면(lg 이상)의 세 칸은 높이가 고정이고 칸마다 스크롤한다 — 무엇을 더해도 페이지가 길어지지 않는다. 좁은 화면은 한 칸으로 쌓는다(2단계에서 드로어 · 시트)
  // relative — 칸 안의 절대 위치 요소(sr-only 글자 등)가 칸의 스크롤 안에 갇히게 한다. 없으면 그 요소들이 문서 높이를 늘린다
  const COLUMN = `${PANEL} relative min-w-0 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain`;
  return (
    <div className="min-h-screen">
      <AppHeader
        screen="wizard" otherHref={PICK_PATH} namingHref={withStateHash(NAMING_PATH, addressHash)}
        share={shareText && <CopyButton text={shareText} label={en.ui.share_button_label} copyKey="share-url">{en.ui.share_button}</CopyButton>}
      />
      <main data-wizard className="mx-auto max-w-[100rem] space-y-4 px-4 py-4">
        <p className="max-w-4xl text-sm text-zinc-700 dark:text-zinc-300">{en.ui.wizard_intro}</p>
        {linkedVersion && <p data-rules-mismatch role="status" className={NOTICE}>{fillUi(en, 'rules_version_mismatch', { linked: linkedVersion, current: VERSION.rules })}</p>}
        {notices.map((t) => <p key={t} data-wizard-notice role="status" className={NOTICE}>{t}</p>)}
        {/* CSP — GCP 하나만 켜져 있다. 번호 없는 한 줄 · hash 에 provider 키가 없어 이름 · 링크는 같다 (D75) */}
        <div data-wizard-cloud className={PANEL}>
          <CloudPicker value="gcp" onPick={() => {}} numbered={false} />
        </div>

        <div data-wizard-layout className="grid gap-4 lg:h-[calc(100dvh-2rem)] lg:grid-rows-1 lg:grid-cols-[15rem_minmax(0,1fr)_22rem] xl:grid-cols-[17.5rem_minmax(0,1fr)_26rem]">
          <nav data-wizard-list-column aria-label={en.ui.wizard_list_label} className={`${COLUMN} p-2`}>
            <WizardList plan={plan} envs={envs} selected={selected} onSelect={select} isExpanded={isExpanded} onExpand={onExpand}
              result={results?.[0]?.result} errors={planErrors} serviceErrors={serviceErrors} projectCount={projectCount} flash={flash?.path}
              onAddService={() => edit(S.addService, (_b, a) => ({ type: 'select', path: serviceRow(a.services.length - 1) }))} onEnter={focusSettings} />
          </nav>
          <section key={selected} ref={settingsRef} data-settings data-pick-path={selected} aria-label={en.ui.wizard_settings_label} className={COLUMN} onKeyDown={onSettingsKey}>
            {settings}
          </section>
          <div data-names-column className={COLUMN}>
            <WizardNames plan={plan} results={results} errors={planErrors} projectContext={projectParsed.ok ? projectParsed.context : undefined} projectNames={projectNames} />
          </div>
        </div>
      </main>

      {custom !== undefined && (
        <CustomDialog service={custom} plan={plan} onClose={() => setCustom(undefined)}
          onPick={(rule, entry) => {
            edit((p) => S.addCustom(p, custom, { ruleId: rule.id, input: inputKind(rule), count: entry.count, ...(entry.role === undefined ? {} : { role: entry.role }), ...(entry.kind === undefined ? {} : { kind: entry.kind }) }), selectAdded(custom));
            setCustom(undefined);
          }} />
      )}

      <footer className="mx-auto max-w-[100rem] px-4 pb-6 text-xs text-zinc-600 dark:text-zinc-400">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span data-version>{fillUi(en, 'version_footer', VERSION)}</span>
          <a href={withStateHash(PRIVACY_PATH, addressHash)} data-footer-privacy className="underline hover:text-zinc-900 dark:hover:text-zinc-100">{en.ui.footer_privacy}</a>
        </p>
      </footer>
    </div>
  );
}
