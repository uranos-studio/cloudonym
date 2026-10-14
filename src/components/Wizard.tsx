// 이름 짓기 마법사 (D59 · D64 · D67 · D68 · D84 · D89 · D90) — ① 프로젝트 ② 필수 네트워크 ③ 서비스 ④ 용도 칩 ⑤ 선택지(HA · Serverless · 엔진) ⑥ 서버 줄마다 딸린 것 · 번호 없는 공용 추가 리소스 · ⑦ 이름.
// 화면 상태는 마법사 모델(WizardPlan) 하나이고 URL hash `w` 에 실린다. 결과는 모델에서 매번 다시 만든다 — validatePlan → expandPlan → generateProject (D17 · D69).
// 넓은 화면은 세 칸이다(D89) — 목록(WizardList) · 고른 줄 하나의 설정(WizardSettings · 카드는 WizardCards) · 이름(WizardNames). 폰은 같은 셋을 탭으로 바꾼다(D93). 고른 줄은 화면 상태이고 hash 에 싣지 않는다.
// 판정은 전부 엔진 값이다 — 이 파일은 이름 규칙을 모른다. 오류는 엔진이 준 path 로 그 자리(서비스 · pick · 서버 줄 · 디스크)에 붙인다
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { generateProject, parseProjectContext } from '../core/engine';
import { checkProjectIdSuffix, expandPlan, validatePlan, type PlanError, type WizardPlan } from '../core/wizard/plan';
import type { Env } from '../core/types';
import { AppHeader } from './AppHeader';
import { CopyButton } from './CopyButton';
import { decodeWizardState, encodeWizardState, hashKind, HASH_KEY, type WizardNotices } from './urlState';
import { hashToRestore, hashToWrite, mismatchedLinkVersion, type LinkState } from './linkRevision';
import { API_PATH, NAMING_PATH, PICK_PATH, PRIVACY_PATH, WIZARD_PATH, withStateHash } from './route';
import { envList, namesSummary, toggleEnv, withEnv } from './wizardEnvs';
import * as S from './wizardState';
import { addedRow, expandedAfterRemove, firstSelection, parseRow, resolveSelection, selectionAfter, serviceErrorsOf, serviceRow, type Edit, type EditOp, type RowPath } from './wizardSelection';
import { CardPanel } from './WizardCards';
import { serviceLayout } from './wizardBundles';
import { WizardList } from './WizardList';
import { lastAddedPath, selectionAfterCustomRemove } from './wizardCustom';
import { CustomDialog, ExtrasSettings, NetworkSettings, PickPanel, ProjectForm, ServiceSettings } from './WizardSettings';
import { WizardNames, type EnvResult } from './WizardNames';
import { WizardOverlay } from './WizardOverlay';
import { useWizardLayout } from './wizardLayout';
import { Check, PanelRightOpen, X } from 'lucide-react';
import { INTRO_KEY, readPref, writePref } from './localPrefs';
import { initialView, projectGate, showsNext, visibleProjectErrors, type ProjectField } from './wizardProjectGate';
import { NOTICE, PANEL } from './wizardStyles';
import { debounce, sendBeacon, sessionStore, visitOnce, wizardGenerateMeta, GENERATE_DEBOUNCE_MS } from './beacon';
import { fillUi } from '../messages/catalog';
import { en } from '../messages/en';
import { VERSION } from '../version';

// ── 첫 상태 — hash 가 마법사 링크면 그것, hash 가 없으면 빈 프로젝트 · 네트워크를 미리 채운 첫 화면(D90 · D97), 깨진 링크면 빈 예시 ──
/** firstRun — hash 없이 처음 온 사람(D97). Project 부터 채운다 · 폰은 Edit 탭으로 연다 */
interface Start { plan: WizardPlan; envs: Env[]; notices?: WizardNotices; broken: boolean; link?: LinkState; firstRun?: boolean }
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
  const firstRun = !brokenAtRoot && hash === '';
  return { plan: firstRun ? S.startPlan() : S.initialPlan(), envs: [], broken: brokenAtRoot, firstRun };
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

/** 폰의 탭 셋 (D93) — 목록 · 고른 줄의 설정 · 이름 */
type View = 'plan' | 'edit' | 'names';
const VIEWS: readonly View[] = ['plan', 'edit', 'names'];

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
  /** Custom 창에서 더한 규칙 id — 창을 닫을 때 고를 줄을 정한다 */
  const customAdded = useRef<string[]>([]);
  /** 사용자가 펴고 접은 서비스 줄 — 화면 상태. 손대지 않은 서비스는 고른 줄이 그 안일 때만 펴진다 */
  const [toggled, setToggled] = useState<ReadonlyMap<number, boolean>>(() => new Map());
  /** 칩 · 단발 추가로 막 더한 줄 — 더할 때마다 새 객체라 같은 줄을 다시 더해도 타이머가 다시 돈다 */
  const [flash, setFlash] = useState<{ path: RowPath } | undefined>(undefined);
  /** 설정 칸에서 바꾼 것이 고른 줄을 옮겼는가 — 그러면 설정 칸이 새로 그려져 포커스를 잃는다(아래 useLayoutEffect) */
  const refocus = useRef(false);
  /** 사용자가 바꾸면 링크 상태 · 링크 안내를 버린다. op 는 고른 줄을 어떻게 옮길지(없으면 그대로) */
  const edit: Edit = (fn, op: EditOp = { type: 'keep' }) => {
    refocus.current = true;
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
  const select = (path: RowPath) => {
    refocus.current = false;
    setState((s) => ({ ...s, selected: path }));
  };
  /** 건드린 Project 칸 (D97) — 화면 상태. 손대지 않은 빈 칸에는 오류를 보이지 않는다. 설정 칸은 고른 줄로 key 되므로 여기에 둔다 */
  const [touched, setTouched] = useState<ReadonlySet<ProjectField>>(() => new Set());
  const touch = (f: ProjectField) => setTouched((t) => (t.has(f) ? t : new Set(t).add(f)));

  // 고른 줄이 서비스 안이면 그 서비스를 편다(고른 pick 의 서비스는 늘 펴진다) · 칩으로 더한 줄은 잠깐 강조한다
  const sel = parseRow(selected);
  const selService = sel?.kind === 'service' || sel?.kind === 'card' ? sel.service : sel?.kind === 'pick' ? sel.ref.service : null;
  const isExpanded = (i: number) => ((sel?.kind === 'pick' || sel?.kind === 'card') && selService === i) || (toggled.get(i) ?? selService === i);
  // 카드의 부품 줄은 그 카드의 부품을 골랐을 때만 펴진다 (D93) — 카드 줄 하나로 접힌다
  const ownedBy = sel?.kind === 'pick' && sel.ref.service !== null ? serviceLayout(plan, sel.ref.service).owned.get(sel.ref.pick) : undefined;
  const cardOpen = (i: number, card: string) => ownedBy === card && selService === i;
  // 네트워크 pick 줄은 네트워크 줄이나 그 pick 을 골랐을 때만 펴진다 — 「Network · N names」 한 줄로 접힌다
  const networkOpen = sel?.kind === 'network' || (sel?.kind === 'pick' && sel.ref.service === null && plan.projectPicks[sel.ref.pick]?.preset !== null);
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
    touch('env');
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
  // 보일 프로젝트 오류 (D97) — 손대지 않은 빈 칸은 빠진다. 목록의 오류 수 · 설정 칸 · 이름 칸 안내가 같은 값을 본다
  const projectErrors = useMemo(() => visibleProjectErrors(projectParsed.ok ? [] : projectParsed.errors, plan.project, touched), [projectParsed, plan.project, touched]);
  const projectCount = projectErrors.length + suffixErrors.length;
  const gate = projectGate(projectParsed.ok, projectCount);

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
          refocus.current = false;
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
  // 첫 방문 안내 한 줄 (D93) — 닫으면 이 브라우저에 기억한다(저장소가 막혀 있으면 이 화면에서만 닫힌다)
  const [introOpen, setIntroOpen] = useState(() => readPref(INTRO_KEY) !== '1');
  const closeIntro = () => {
    setIntroOpen(false);
    writePref(INTRO_KEY, '1');
  };
  // 공유 경고 — Share 를 누르면 그 곁(머리 바로 아래)에 보인다. 링크는 암호화가 아니다
  const [shared, setShared] = useState(false);

  // 키보드 — Enter 는 설정 칸 첫 컨트롤로, 설정 칸의 Esc 는 고른 줄로 되돌린다
  const settingsRef = useRef<HTMLElement>(null);
  const focusSettings = () => settingsRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  // 설정 칸에서 바꾼 것(Duplicate · Add subnet · Remove …)이 고른 줄을 옮기면 칸이 새로 그려지고 포커스가 body 로 떨어진다 —
  // 새 칸의 첫 컨트롤로 옮겨 키보드 흐름(Esc 로 줄에 돌아가기)이 이어지게 한다. 목록 이동 · 첫 화면 · hash 이동은 건드리지 않는다
  useLayoutEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    focusSettings();
  }, [selected]);
  const focusRow = (path: RowPath) => document.querySelector<HTMLElement>(`[data-row-path="${path}"]`)?.focus();

  // 좁은 화면 (D89 · D93) — 태블릿은 이름이 드로어, 폰은 위 탭 셋(Plan · Edit · Names)이 한 칸을 바꾼다. 배치가 바뀌면 열린 드로어는 닫힌 것으로 본다
  const layout = useWizardLayout();
  const [drawer, setDrawer] = useState(false);
  const [view, setView] = useState<View>(() => initialView(start.firstRun === true));
  const drawerOpen = layout === 'tablet' && drawer;
  // 폭을 바꿨다 돌아오면 저절로 다시 열리지 않게 — 배치가 바뀌는 렌더에서 연 상태를 지운다(effect 가 아니라 렌더 중 조정)
  const [shownLayout, setShownLayout] = useState(layout);
  if (shownLayout !== layout) {
    setShownLayout(layout);
    setDrawer(false);
  }
  const handleRef = useRef<HTMLButtonElement>(null);
  const closeDrawer = () => {
    setDrawer(false);
    requestAnimationFrame(() => handleRef.current?.focus());
  };
  /** Plan 탭으로 돌아가면 포커스는 고른 줄로 — Edit 탭에서 고른 줄이 바뀌었을 수 있다(Duplicate · Remove · 카드 부품) */
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  const backToPlan = () => {
    setView('plan');
    requestAnimationFrame(() => focusRow(selectedRef.current));
  };
  /** 폰에서 줄을 누르거나 Add service — Edit 탭을 연다. 칸의 맨 위부터 보이게 페이지를 올린다.
   *  포커스는 칸으로 옮긴다 — 누른 줄은 숨은 Plan 탭에 있어 거기 남으면 Esc 가 닿지 않는다. focusFirst 면 칸의 첫 컨트롤 */
  const openEdit = (focusFirst: boolean) => {
    setView('edit');
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0 });
      if (focusFirst) focusSettings();
      else settingsRef.current?.focus({ preventScroll: true });
    });
  };

  /** 폰 탭 — 고른 탭만 Tab 순서에 두고, 좌우 · Home · End 로 옮기면서 바로 고른다 (WAI-ARIA tabs, 자동 선택) */
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const at = VIEWS.indexOf(view);
    const next = ({ ArrowLeft: VIEWS[(at + VIEWS.length - 1) % VIEWS.length], ArrowRight: VIEWS[(at + 1) % VIEWS.length], Home: VIEWS[0], End: VIEWS[VIEWS.length - 1] } as Record<string, View | undefined>)[e.key];
    if (!next) return;
    e.preventDefault();
    setView(next);
    document.getElementById(`wizard-tab-${next}`)?.focus();
  };

  const onSettingsKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    if (layout === 'phone') backToPlan();
    else focusRow(selected);
  };

  /** Project 의 「Next」 (D97) — 첫 서비스의 카드 갤러리로. 서비스가 없는 링크면 하나 더해 고른다. 설정 칸이 새로 그려지므로 포커스를 그 첫 컨트롤로 옮긴다(폰은 Edit 탭 그대로 · 맨 위부터) */
  const goNext = () => {
    if (plan.services.length > 0) select(serviceRow(0));
    else edit(S.addService, (_b, a) => ({ type: 'select', path: serviceRow(a.services.length - 1) }));
    requestAnimationFrame(() => {
      if (layout === 'phone') window.scrollTo({ top: 0 });
      focusSettings();
    });
  };

  const settings = (() => {
    if (!sel || sel.kind === 'project') {
      return (
        <ProjectForm plan={plan} envs={envs} onToggleEnv={onToggleEnv} errors={projectErrors} projectIds={projectIds} projectNames={projectNames}
          suffixErrors={suffixErrors} onSuffix={(x) => edit((p) => S.setProjectIdSuffix(p, x))} onChange={(project) => edit((p) => S.setProject(p, project))}
          onTouch={touch} {...(showsNext(projectParsed.ok, suffixErrors.length) ? { onNext: goNext } : {})} />
      );
    }
    if (sel.kind === 'network') return <NetworkSettings plan={plan} errors={planErrors} edit={edit} />;
    if (sel.kind === 'extras') return <ExtrasSettings plan={plan} onCustom={() => setCustom(null)} />;
    if (sel.kind === 'service') {
      return <ServiceSettings index={sel.service} plan={plan} errors={planErrors} contextErrors={serviceErrors[sel.service] ?? []} edit={edit} onCustom={() => setCustom(sel.service)} onSelect={select} />;
    }
    if (sel.kind === 'card') return <CardPanel plan={plan} service={sel.service} card={sel.card} result={results?.[0]?.result} edit={edit} onSelect={select} />;
    const pick = sel.ref.service === null ? plan.projectPicks[sel.ref.pick] : plan.services[sel.ref.service]?.picks[sel.ref.pick];
    return pick ? <PickPanel pick={pick} at={sel.ref} errors={planErrors} edit={edit} /> : null;
  })();

  // 넓은 화면(≥1280)은 세 칸 · 태블릿(768–1279)은 목록 · 설정 두 칸 — 높이가 고정이고 칸마다 스크롤한다(무엇을 더해도 페이지가 길어지지 않는다).
  // 폰(<768)은 한 칸이고 페이지가 스크롤한다. relative — 칸 안의 절대 위치 요소(sr-only 글자 등)가 칸의 스크롤 안에 갇히게 한다
  const fixed = layout !== 'phone';
  const COLUMN = `${PANEL} relative min-w-0 ${fixed ? 'min-h-0 overflow-y-auto overscroll-contain' : ''}`;
  const GRID = {
    wide: 'grid h-[calc(100dvh-2rem)] grid-rows-1 grid-cols-[17.5rem_minmax(0,1fr)_26rem] gap-4',
    tablet: 'grid h-[calc(100dvh-2rem)] grid-rows-1 grid-cols-[15rem_minmax(0,1fr)] gap-4',
    phone: 'space-y-4',
  }[layout];
  const { names: nameCount, pass: passCount } = namesSummary(results);
  const allPass = results !== undefined && passCount === nameCount;

  const settingsSection = (
    <section key={selected} ref={settingsRef} data-settings data-pick-path={selected} aria-label={en.ui.wizard_settings_label} onKeyDown={onSettingsKey} className={COLUMN}
      {...(layout === 'phone' ? { id: 'wizard-panel-edit', role: 'tabpanel', 'aria-labelledby': 'wizard-tab-edit', hidden: view !== 'edit', tabIndex: -1 } : {})}>
      {settings}
    </section>
  );
  const names = (
    <WizardNames plan={plan} results={results} errors={planErrors} projectPending={gate === 'pending'} projectContext={projectParsed.ok ? projectParsed.context : undefined} projectNames={projectNames}
      {...(layout === 'tablet' ? { onClose: closeDrawer } : {})} />
  );
  return (
    <div className="min-h-screen">
      <AppHeader
        screen="wizard" otherHref={PICK_PATH} namingHref={withStateHash(NAMING_PATH, addressHash)} apiHref={withStateHash(API_PATH, addressHash)} reserveShare shareWarning={false}
        share={shareText && <span className="contents" onClickCapture={() => setShared(true)}><CopyButton text={shareText} label={en.ui.share_button_label} copyKey="share-url">{en.ui.share_button}</CopyButton></span>}
        // 클라우드 (D75 · D93) — 켜진 것은 GCP 하나라 고르는 줄 대신 머리의 배지다. hash 에 provider 키가 없어 이름 · 링크는 같다
        badge={(
          // 지금 쓰는 것(진한 배지 · 체크)과 예정인 것(점선 · 흐림)을 두 배지로 나눈다 — 한 배지에 붙여 쓰면 셋 다 되는 것처럼 읽힌다
          <span role="group" aria-label={en.ui.wizard_cloud_label} className="inline-flex flex-wrap items-center gap-1.5">
            <span data-wizard-cloud className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-200">
              <Check aria-hidden="true" className="size-3" />{en.ui.wizard_cloud}
            </span>
            <span data-wizard-cloud-soon className="rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
              {en.ui.wizard_cloud_soon}
            </span>
          </span>
        )}
      />
      {/* 태블릿은 오른쪽 가장자리의 이름 손잡이가 내용을 가리지 않게 오른쪽을 비운다 */}
      <main data-wizard className={`mx-auto max-w-[100rem] space-y-4 py-4 ${layout === 'tablet' ? 'pl-4 pr-14' : 'px-4'}`}>
        {/* 짧은 소개 (D97) — 무엇인가 · 무엇을 받나 · 무엇을 안 하나 · 순서. 경고색이 아니다(공유 링크 경고는 Share 를 누를 때 따로 뜬다) */}
        {introOpen && (
          <section data-wizard-intro aria-label={en.ui.wizard_about_label}
            className="flex items-start justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            <div className="space-y-1">
              <p data-wizard-about>{en.ui.wizard_about}</p>
              <p>
                {en.ui.wizard_intro}{' '}
                <a href={withStateHash(NAMING_PATH, addressHash)} data-intro-guide className="font-medium text-indigo-700 underline hover:text-indigo-900 dark:text-indigo-300 dark:hover:text-indigo-100">{en.ui.nav_naming_guide}</a>
              </p>
            </div>
            <button type="button" data-intro-close aria-label={en.ui.wizard_intro_close} title={en.ui.wizard_intro_close}
              className="-my-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-indigo-600 dark:hover:bg-zinc-800"
              onClick={closeIntro}><X aria-hidden="true" className="size-4" /></button>
          </section>
        )}
        {shared && <p data-share-warning role="status" className={NOTICE}>{en.ui.share_warning}</p>}
        {linkedVersion && <p data-rules-mismatch role="status" className={NOTICE}>{fillUi(en, 'rules_version_mismatch', { linked: linkedVersion, current: VERSION.rules })}</p>}
        {notices.map((t) => <p key={t} data-wizard-notice role="status" className={NOTICE}>{t}</p>)}

        <div data-wizard-layout={layout} className={GRID}>
          {layout === 'phone' && (
            // 폰의 위 탭 — 목록과 이름을 바꾼다. 탭 막대는 페이지 위에 붙고, 이름 칸 머리는 그 바로 아래에 붙는다(top-12)
            <div role="tablist" aria-label={en.ui.wizard_view_tabs} data-wizard-tabs className="sticky top-0 z-20 -mx-4 flex h-12 items-stretch gap-1 border-b border-zinc-200 bg-zinc-50/95 px-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
              {VIEWS.map((v) => (
                <button key={v} type="button" role="tab" id={`wizard-tab-${v}`} aria-selected={view === v} aria-controls={`wizard-panel-${v}`} data-wizard-tab={v}
                  tabIndex={view === v ? 0 : -1} onKeyDown={onTabKey}
                  className="min-w-0 flex-1 truncate border-b-2 border-transparent px-2 text-sm font-medium text-zinc-600 aria-selected:border-indigo-600 aria-selected:text-zinc-900 dark:text-zinc-400 dark:aria-selected:border-indigo-400 dark:aria-selected:text-zinc-100"
                  onClick={() => setView(v)}>
                  {v === 'plan' ? en.ui.wizard_list_label : v === 'edit' ? en.ui.wizard_view_edit : results ? fillUi(en, 'wizard_names_tab', { names: nameCount, pass: passCount }) : en.ui.wizard_step_names}
                </button>
              ))}
            </div>
          )}
          <nav data-wizard-list-column aria-label={en.ui.wizard_list_label} className={`${COLUMN} p-2`} hidden={layout === 'phone' && view !== 'plan'}
            {...(layout === 'phone' ? { id: 'wizard-panel-plan', role: 'tabpanel', 'aria-labelledby': 'wizard-tab-plan' } : {})}>
            <WizardList plan={plan} envs={envs} selected={selected} onSelect={select} isExpanded={isExpanded} onExpand={onExpand} cardOpen={cardOpen} networkOpen={networkOpen}
              result={results?.[0]?.result} errors={planErrors} serviceErrors={serviceErrors} projectCount={projectCount} flash={flash?.path}
              onAddService={() => {
                edit(S.addService, (_b, a) => ({ type: 'select', path: serviceRow(a.services.length - 1) }));
                if (layout === 'phone') openEdit(true);
              }}
              onEnter={() => (layout === 'phone' ? openEdit(true) : focusSettings())}
              {...(layout === 'phone' ? { onActivate: () => openEdit(false) } : {})} />
          </nav>
          {settingsSection}
          {layout === 'wide' && <div data-names-column className={COLUMN}>{names}</div>}
          {layout === 'phone' && (
            <div data-names-column id="wizard-panel-names" role="tabpanel" aria-labelledby="wizard-tab-names" className={COLUMN} hidden={view !== 'names'}>{names}</div>
          )}
        </div>
        {layout === 'tablet' && (
          <>
            {/* 태블릿 — 오른쪽 가장자리의 손잡이가 이름 드로어를 연다. 손잡이의 수 · PASS 는 늘 지금 값이다 */}
            <button ref={handleRef} type="button" data-names-handle aria-expanded={drawerOpen} aria-label={en.ui.wizard_names_open} title={en.ui.wizard_names_open}
              className="fixed right-0 top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-2 rounded-l-lg border border-r-0 border-zinc-300 bg-white px-1.5 py-3 text-xs font-semibold text-zinc-800 shadow-md hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
              onClick={() => { setDrawer(true); requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-names-close]')?.focus()); }}>
              <PanelRightOpen aria-hidden="true" className="size-4" />
              <span className="[writing-mode:vertical-rl]">{en.ui.wizard_step_names}</span>
              {results && (
                <span data-names-handle-summary className={`rounded-full px-1 py-1.5 text-[11px] font-medium [writing-mode:vertical-rl] ${allPass
                  ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-300'}`}>
                  {fillUi(en, 'wizard_names_handle', { names: nameCount, pass: passCount })}
                </span>
              )}
            </button>
            <WizardOverlay kind="drawer" data="names-drawer" open={drawerOpen} onClose={closeDrawer} labelledBy="wizard-names">
              <div data-names-column className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{names}</div>
            </WizardOverlay>
          </>
        )}
      </main>

      {custom !== undefined && (
        <CustomDialog service={custom} plan={plan}
          onClose={() => {
            // 닫을 때 — 이 창에서 더한 것 가운데 남은 마지막 pick 을 고른다. 더한 것이 없으면 고른 줄을 그대로 둔다 (D95)
            const path = lastAddedPath(plan, custom, customAdded.current);
            customAdded.current = [];
            setCustom(undefined);
            if (path !== undefined) edit((p) => p, { type: 'select', path });
          }}
          onApply={(fn, change) => {
            customAdded.current.push(...change.added);
            edit(fn, selectionAfterCustomRemove(selected, custom, change.removed));
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
