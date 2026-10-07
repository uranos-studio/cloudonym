// 네 단계 화면 (D42) — ① Cloud ② Context ③ Resources ④ Names · 상태 → URL hash 동기화 · 비콘.
// 엔진은 브라우저에서 직접 부른다 (D17) — API 왕복 없음. 화면 문구는 사전(en)이 정본이다 (D24)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, BookOpen, Cloud, FileText } from 'lucide-react';
import { generateMany, parseContext } from './core/engine';
import { labelsFor } from './core/labels';
import { buildTree } from './core/tree';
import { ENABLED_PROVIDERS, type Provider, type ResourceRule } from './core/types';
import { CloudPicker } from './components/CloudPicker';
import { providerShort } from './components/providerName';
import { ContextForm } from './components/ContextForm';
import { ResourceTree } from './components/ResourceTree';
import { NamesPanel } from './components/NamesPanel';
import { LabelsPanel } from './components/LabelsPanel';
import { CopyButton } from './components/CopyButton';
import { applyChange, clearForCloudSwitch, toItems, totalNames, type Picked } from './components/selection';
import { encodeState, shareUrl } from './components/urlState';
import { hashToRestore, hashToWrite, mismatchedLinkVersion, type LinkState } from './components/linkRevision';
import { openHash } from './components/openHash';
import { NAMING_PATH, PRIVACY_PATH, withStateHash } from './components/route';
import { DEFAULT_FORM, type FormContext } from './components/formContext';
import { debounce, sendBeacon, sessionStore, visitOnce, GENERATE_DEBOUNCE_MS } from './components/beacon';
import { en } from './messages/en';
import { fillUi } from './messages/catalog';
import { VERSION } from './version';

/** 켜진 CSP 가 하나면 첫 그리기 때 그것을 고른다 (D45 · 오너 결정 C1). 둘 이상이면 고르지 않는다 — 숨은 기본값을 두지 않는다 */
const AUTO_PROVIDER: Provider | undefined = ENABLED_PROVIDERS.length === 1 ? ENABLED_PROVIDERS[0] : undefined;
const NO_PICK: Picked = new Map();

const PANEL = 'rounded-xl border border-zinc-200 bg-white p-4 shadow-xs dark:border-zinc-800 dark:bg-zinc-900';
const LINK =
  'inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800';
const NOTICE = 'rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200';

/** rules — 시험 전용 fixture(src/dev · DEV 빌드에서만)가 넘긴다. 없으면 규칙 표 */
function App({ rules }: { rules?: readonly ResourceRule[] }) {
  // 첫 상태 — hash 가 온전하면 그것, 아니면 예시 (깨진 hash 는 decodeState 가 undefined 로 돌려준다)
  const [initial] = useState(() => openHash(window.location.hash, rules));
  // 폼은 지역 입력 문자열을 든다 — 정규화된 문맥으로 덮지 않는다(존이 떨어진다 · D50). 예시는 존 이름(R0)이다
  const [form, setForm] = useState<FormContext>(() => initial?.form ?? DEFAULT_FORM);
  const [provider, setProvider] = useState<Provider | undefined>(() => (initial ? initial.provider : AUTO_PROVIDER));
  const [picked, setPicked] = useState<Picked>(() => initial?.picked ?? NO_PICK);
  // 링크에서 버린 선택 수 — 사용자가 선택 · CSP 를 바꾸면 지운다
  const [dropped, setDropped] = useState(() => initial?.dropped ?? 0);
  // 링크가 아직 꺼진 CSP 로 만들어졌으면 그 CSP — 안내 한 줄 (D55). 사용자가 선택 · CSP 를 바꾸면 지운다
  const [unavailable, setUnavailable] = useState<Provider | undefined>(() => initial?.unavailable);
  // 링크에서 읽은 상태 — 폼과 따로 둔다. 사용자가 폼을 고치면 버린다 (D27 ⑵)
  const [link, setLink] = useState<LinkState | undefined>(() => initial?.link);
  const editForm = (next: FormContext) => {
    setLink(undefined);
    setForm(next);
  };

  const tree = useMemo(() => (provider ? buildTree(provider, rules?.filter((r) => r.provider === provider)) : undefined), [provider, rules]);
  const items = useMemo(() => (tree ? toItems(tree, picked) : []), [tree, picked]);
  // 지역은 고른 CSP 의 표로 푼다 (D49) — 아직 고르지 않았으면 켜진 CSP 의 첫째
  const parsed = useMemo(() => parseContext(form, provider ?? ENABLED_PROVIDERS[0]!), [form, provider]);
  const ctx = parsed.ok ? parsed.context : undefined;
  const many = useMemo(() => (ctx && provider && items.length > 0 ? generateMany(ctx, provider, items) : undefined), [ctx, provider, items]);
  const labels = useMemo(() => (ctx && provider ? labelsFor(ctx, provider) : undefined), [ctx, provider]);
  // 문맥에 존이 없다(리전만 · global) — 존 규칙 행을 새로 체크할 수 없다. 문맥이 불완전한 동안은 막지 않는다(존 칸이 아니라 다른 칸의 문제다) (D50)
  const zoneMissing = ctx !== undefined && ctx.zone === undefined;

  // 상태 key — 다섯 값 + v + p + r. 링크 비교 · hash 쓰기에 쓴다. 비콘은 문맥 key 만 본다(선택 이벤트는 더하지 않는다)
  const stateKey = ctx ? encodeState(ctx, VERSION.rules, { provider, selection: items }) : '';
  const contextKey = ctx ? encodeState(ctx, VERSION.rules) : '';
  const linkedVersion = mismatchedLinkVersion(stateKey, link, VERSION.rules);

  const onPick = useCallback((next: Picked) => {
    if (!provider || !tree) return;
    const ok = applyChange(provider, tree, next, rules);
    if (!ok) return;
    // 선택을 바꾸면 링크 상태를 버린다 — 남겨 두면 링크와 같은 선택으로 돌아왔을 때 hash 쓰기가 멈춰 주소창이 낡은 선택에 남는다
    setLink(undefined);
    setDropped(0);
    setUnavailable(undefined);
    setPicked(ok);
  }, [provider, tree, rules]);

  const onCloud = (p: Provider) => {
    if (p === provider || !ENABLED_PROVIDERS.includes(p)) return;
    // 규칙 id 가 provider 에 묶여 있어 선택을 옮길 수 없다 — 지우기 전에 한 번 묻는다(선택이 있을 때만)
    if (picked.size > 0 && !window.confirm(fillUi(en, 'switch_cloud_confirm', { n: picked.size }))) return;
    setLink(undefined);
    setProvider(p);
    setPicked(clearForCloudSwitch());
    setDropped(0);
    setUnavailable(undefined);
  };

  // 상태 → URL hash (replaceState — 히스토리를 쌓지 않는다). 문맥이 불완전한 동안은 쓰지 않는다 — 마지막 온전한 hash 가 남아 새로고침해도 CSP · 선택이 돌아온다.
  // 그동안 Share URL 버튼은 그리지 않으므로(ctx 가 없다) 낡은 값을 복사하지 않는다.
  // 링크로 연 상태 그대로인 동안도 쓰지 않는다 — 새로고침해도 링크의 옛 v 가 남는다 (D27 ⑵)
  useEffect(() => {
    const hash = hashToWrite(stateKey, link);
    if (hash !== undefined) window.history.replaceState(null, '', hash);
  }, [stateKey, link]);

  // ui_visit — 탭당 1회 (sessionStorage 가드가 StrictMode 이중 effect 와 새로고침을 막는다)
  useEffect(() => {
    visitOnce(sessionStore());
  }, []);

  // ui_generate — 첫 화면은 세지 않고(방문이 이미 셌다) 문맥이 바뀐 뒤 1초 디바운스. 선택 · CSP 변경은 세지 않는다
  const lastSentKey = useRef(contextKey);
  const scheduleGenerate = useMemo(() => debounce(() => sendBeacon('ui_generate'), GENERATE_DEBOUNCE_MS), []);
  useEffect(() => {
    if (!contextKey || contextKey === lastSentKey.current) return;
    lastSentKey.current = contextKey;
    scheduleGenerate();
  }, [contextKey, scheduleGenerate]);

  // 같은 탭에서 공유 URL 로 이동(주소창에 붙여 Enter) — 브라우저는 hash 만 바꾸고 다시 불러오지 않는다.
  // 온전한 hash 면 상태를 그것으로 바꾼다. 사용자가 만든 문맥이 아니므로 lastSentKey 를 먼저 맞춰 ui_generate 를 세지 않는다(첫 로드 복원과 같은 규칙).
  // 깨진 hash 면 화면은 그대로 두고 주소창을 지금 상태로 되돌린다 — 깨진 값이 다시 공유되지 않게. replaceState 는 hashchange 를 내지 않는다.
  // 링크 상태 그대로면 되돌릴 값은 링크의 원래 hash 다(옛 v 를 잃지 않는다) · 문맥이 불완전하면 마지막 온전한 hash 다. 새 링크의 v 는 링크 상태를 바꾼다 (D27 ⑵)
  const currentHash = useRef('');
  useEffect(() => {
    currentHash.current = hashToRestore(stateKey, link, currentHash.current);
  }, [stateKey, link]);
  // 주소창에 있는 hash — 문서 링크(Naming guide · Privacy)가 실어 가서 돌아올 때 그대로 연다. 문맥이 불완전한 동안은 마지막 온전한 hash 다(위 effect 와 같은 규칙)
  const [addressHash, setAddressHash] = useState(() => window.location.hash);
  const nextAddressHash = hashToRestore(stateKey, link, addressHash);
  if (nextAddressHash !== addressHash) setAddressHash(nextAddressHash);
  useEffect(() => {
    const onHashChange = () => {
      const opened = openHash(window.location.hash, rules);
      if (opened) {
        lastSentKey.current = encodeState(opened.context, VERSION.rules);
        setLink(opened.link);
        setForm(opened.form);
        setProvider(opened.provider);
        setPicked(opened.picked);
        setDropped(opened.dropped);
        setUnavailable(opened.unavailable);
        return;
      }
      const hash = currentHash.current;
      window.history.replaceState(null, '', hash || window.location.pathname + window.location.search);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [rules]);

  const nameCount = totalNames(picked);

  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="rounded-lg bg-indigo-600 p-2 text-white dark:bg-indigo-500"><Cloud aria-hidden="true" className="size-5" /></span>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Cloudonym</h1>
              <p className="text-xs text-zinc-600 dark:text-zinc-400">{en.ui.tagline}</p>
            </div>
          </div>
          <nav aria-label={en.ui.nav_label} className="flex flex-wrap items-center gap-2">
            {/* Share URL 은 항상 지금 규칙 버전이다 — 보이는 이름이 지금 규칙의 것이다 (D27 ⑵) */}
            {ctx && <CopyButton text={shareUrl(ctx, window.location.origin + window.location.pathname, VERSION.rules, { provider, selection: items })} label={en.ui.share_button_label} copyKey="share-url">{en.ui.share_button}</CopyButton>}
            <a href={withStateHash(NAMING_PATH, addressHash)} data-nav-naming className={LINK}><BookOpen aria-hidden="true" className="size-4" />{en.ui.nav_naming_guide}</a>
            <a href="/llms.txt" target="_blank" rel="noreferrer" className={LINK}><FileText aria-hidden="true" className="size-4" />llms.txt</a>
          </nav>
          {/* 공유 URL 경고 — hash 는 버튼을 누르지 않아도 주소창에 쓰이고 Base64 는 암호화가 아니다. nav 밖 전폭 줄이라 좁은 화면에서 버튼 줄을 깨지 않는다 */}
          {ctx && <p data-share-warning className="w-full text-xs text-zinc-600 sm:text-right dark:text-zinc-400">{en.ui.share_warning}</p>}
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        <div className={PANEL}>
          <CloudPicker value={provider} onPick={onCloud} />
        </div>
        {linkedVersion && (
          <p data-rules-mismatch role="status" className={NOTICE}>{fillUi(en, 'rules_version_mismatch', { linked: linkedVersion, current: VERSION.rules })}</p>
        )}
        {/* 꺼진 CSP 링크면 그 안내 하나 — 버린 선택은 그 문장이 말한다. 아니면 버린 선택 수 */}
        {unavailable
          ? <p data-provider-unavailable role="status" className={NOTICE}>{fillUi(en, 'provider_unavailable', { name: providerShort(unavailable) })}</p>
          : dropped > 0 && <p data-selection-dropped role="status" className={NOTICE}>{fillUi(en, 'selection_dropped', { n: dropped })}</p>}

        {/* 좁은 화면은 ② → ③ → ④ → 태그 순서, 넓은 화면은 왼쪽 열(② · 태그) · 오른쪽 열(③ · ④) */}
        <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)] lg:grid-rows-[auto_1fr]">
          <div className={`${PANEL} lg:col-start-1 lg:row-start-1`}>
            <ContextForm provider={provider ?? ENABLED_PROVIDERS[0]!} value={form} errors={parsed.ok ? [] : parsed.errors} onChange={editForm} />
          </div>

          <div className="min-w-0 space-y-6 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <div className={PANEL}>
              {provider && tree
                ? <ResourceTree provider={provider} tree={tree} picked={picked} onChange={onPick} zoneMissing={zoneMissing} regionGlobal={ctx?.region === 'global'} />
                : (
                  <section aria-labelledby="step-resources" className="space-y-2">
                    <h2 id="step-resources" className="text-base font-semibold"><span aria-hidden="true" className="mr-1.5 text-indigo-600 dark:text-indigo-400">3</span>{en.ui.step_resources}</h2>
                    <p role="status" data-pick-cloud className="text-sm text-zinc-600 dark:text-zinc-400">{en.ui.pick_cloud_prompt}</p>
                  </section>
                )}
            </div>
            <div className={PANEL}>
              <NamesPanel provider={provider} ctx={ctx} items={items} many={many} labels={labels} />
            </div>
          </div>

          {provider && labels && (
            <div className={`${PANEL} self-start lg:col-start-1 lg:row-start-2`}>
              <LabelsPanel provider={provider} labels={labels} />
            </div>
          )}
        </div>
      </main>

      {/* 좁은 화면 — 아래 고정 막대. 누르면 ④ 로 스크롤 */}
      {provider && picked.size > 0 && (
        <div data-sticky-bar className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200 bg-white/95 px-4 py-2 backdrop-blur lg:hidden dark:border-zinc-800 dark:bg-zinc-900/95">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
            <span className="text-sm font-medium">{fillUi(en, 'sticky_summary', { resources: picked.size, names: nameCount })}</span>
            <button type="button" data-sticky-jump onClick={() => document.getElementById('names')?.scrollIntoView({ block: 'start' })}
              className="inline-flex min-h-11 items-center gap-1 rounded-md bg-indigo-600 px-3 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:bg-indigo-500">
              {en.ui.sticky_jump}<ArrowDown aria-hidden="true" className="size-4" />
            </button>
          </div>
        </div>
      )}

      <footer className={`mx-auto max-w-7xl px-4 text-xs text-zinc-600 dark:text-zinc-400 ${provider && picked.size > 0 ? 'pb-24 lg:pb-6' : 'pb-6'}`}>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span data-version>{fillUi(en, 'version_footer', VERSION)}</span>
          <a href={withStateHash(PRIVACY_PATH, addressHash)} data-footer-privacy className="underline hover:text-zinc-900 dark:hover:text-zinc-100">{en.ui.footer_privacy}</a>
        </p>
      </footer>
    </div>
  );
}

export default App;
