// 레이아웃 · 탭 · 상태 → URL hash 동기화 · 비콘. 엔진은 브라우저에서 직접 부른다 (D17) — API 왕복 없음. 화면 문구는 사전(en)이 정본이다 (D24)
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Cloud, FileText } from 'lucide-react';
import { generate, parseContext } from './core/engine';
import { labelsFor } from './core/labels';
import { PROVIDERS, type LabelSet, type NamingContext, type Provider } from './core/types';
import { ContextForm } from './components/ContextForm';
import { ProviderSection } from './components/ProviderSection';
import { LabelsPanel } from './components/LabelsPanel';
import { CopyButton } from './components/CopyButton';
import { decodeState, encodeState, shareUrl } from './components/urlState';
import { linkStateOf, mismatchedLinkVersion, shouldRewriteHash, type LinkState } from './components/linkRevision';
import { debounce, sendBeacon, sessionStore, visitOnce, GENERATE_DEBOUNCE_MS } from './components/beacon';
import { en } from './messages/en';
import { fillUi } from './messages/catalog';
import { VERSION } from './version';

/** 첫 화면의 예시 — ① 원문의 예시 그대로. 공유 URL 이 있으면 그것이 이긴다 */
const DEFAULT_CONTEXT: NamingContext = { owner: 'acmex', system: 'billing', purpose: 'trade', env: 'prd', region: 'kr' };

type Tab = 'all' | Provider;
const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'all', label: en.ui.tab_all },
  { id: 'aws', label: 'AWS' },
  { id: 'gcp', label: 'GCP' },
  { id: 'azure', label: 'Azure' },
];

const PANEL = 'rounded-xl border border-zinc-200 bg-white p-4 shadow-xs dark:border-zinc-800 dark:bg-zinc-900';
const LINK =
  'inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800';

/** 주소창의 hash 가 온전하면 그 링크 상태 — 폼과 대어 볼 key 는 지금 규칙 버전으로 만든다 (D27 ⑵) */
function linkFromHash(hash: string): { form: NamingContext; link: LinkState } | undefined {
  const decoded = decodeState(hash);
  if (!decoded) return undefined;
  return { form: decoded.context, link: linkStateOf(decoded, hash, encodeState(decoded.context, VERSION.rules)) };
}

function App() {
  // 첫 상태 — hash 가 온전하면 그것, 아니면 예시 (Review Focus 4: 깨진 hash 는 decodeState 가 undefined 로 돌려준다)
  const [initial] = useState(() => linkFromHash(window.location.hash));
  const [form, setForm] = useState<NamingContext>(() => initial?.form ?? DEFAULT_CONTEXT);
  // 링크에서 읽은 상태 — 폼과 따로 둔다. 사용자가 폼을 고치면 버린다 (D27 ⑵)
  const [link, setLink] = useState<LinkState | undefined>(() => initial?.link);
  const editForm = (next: NamingContext) => {
    setLink(undefined);
    setForm(next);
  };
  const [tab, setTab] = useState<Tab>('all');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const parsed = useMemo(() => parseContext(form), [form]);
  const ctx = parsed.ok ? parsed.context : undefined;
  const output = useMemo(() => (ctx ? generate(ctx) : undefined), [ctx]);
  const labels = useMemo<Partial<Record<Provider, LabelSet>>>(() => {
    if (!ctx) return {};
    const out: Partial<Record<Provider, LabelSet>> = {};
    for (const p of PROVIDERS) out[p] = labelsFor(ctx, p);
    return out;
  }, [ctx]);
  const stateKey = ctx ? encodeState(ctx, VERSION.rules) : '';
  const linkedVersion = mismatchedLinkVersion(stateKey, link, VERSION.rules);

  // 상태 → URL hash (replaceState — 히스토리를 쌓지 않는다). 문맥이 불완전하면 hash 를 비운다 — 낡은 상태를 공유하지 않게.
  // 링크로 연 상태 그대로인 동안은 쓰지 않는다 — 새로고침해도 링크의 옛 v 가 남는다 (D27 ⑵)
  useEffect(() => {
    if (!shouldRewriteHash(stateKey, link)) return;
    window.history.replaceState(null, '', stateKey ? `#state=${stateKey}` : window.location.pathname + window.location.search);
  }, [stateKey, link]);

  // ui_visit — 탭당 1회 (sessionStorage 가드가 StrictMode 이중 effect 와 새로고침을 막는다)
  useEffect(() => {
    visitOnce(sessionStore());
  }, []);

  // ui_generate — 첫 화면은 세지 않고(방문이 이미 셌다) 문맥이 바뀐 뒤 1초 디바운스
  const lastSentKey = useRef(stateKey);
  const scheduleGenerate = useMemo(() => debounce(() => sendBeacon('ui_generate'), GENERATE_DEBOUNCE_MS), []);
  useEffect(() => {
    if (!stateKey || stateKey === lastSentKey.current) return;
    lastSentKey.current = stateKey;
    scheduleGenerate();
  }, [stateKey, scheduleGenerate]);

  // 같은 탭에서 공유 URL 로 이동(주소창에 붙여 Enter) — 브라우저는 hash 만 바꾸고 다시 불러오지 않는다
  // 온전한 hash 면 폼을 그것으로 바꾼다. 사용자가 만든 문맥이 아니므로 lastSentKey 를 먼저 맞춰 ui_generate 를 세지 않는다(첫 로드 복원과 같은 규칙)
  // 깨진 hash 면 화면은 그대로 두고 주소창을 지금 상태로 되돌린다 — 깨진 값이 다시 공유되지 않게. replaceState 는 hashchange 를 내지 않는다.
  // 링크 상태 그대로면 되돌릴 값은 링크의 원래 hash 다(옛 v 를 잃지 않는다). 새 링크의 v 는 링크 상태를 바꾼다 (D27 ⑵)
  const currentHash = useRef('');
  useEffect(() => {
    currentHash.current = !shouldRewriteHash(stateKey, link) && link ? link.hash : stateKey ? `#state=${stateKey}` : '';
  }, [stateKey, link]);
  useEffect(() => {
    const onHashChange = () => {
      const opened = linkFromHash(window.location.hash);
      if (opened) {
        lastSentKey.current = opened.link.key;
        setLink(opened.link);
        setForm(opened.form);
        return;
      }
      const hash = currentHash.current;
      window.history.replaceState(null, '', hash || window.location.pathname + window.location.search);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const visible: Provider[] = tab === 'all' ? [...PROVIDERS] : [tab];

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const moves: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: TABS.length - 1 };
    const next = moves[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const target = TABS[(next + TABS.length) % TABS.length];
    if (!target) return;
    setTab(target.id);
    tabRefs.current[(next + TABS.length) % TABS.length]?.focus();
  };

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
            {ctx && <CopyButton text={shareUrl(ctx, window.location.origin + window.location.pathname, VERSION.rules)} label={en.ui.share_button_label} copyKey="share-url">{en.ui.share_button}</CopyButton>}
            <a href="/llms.txt" target="_blank" rel="noreferrer" className={LINK}><FileText aria-hidden="true" className="size-4" />llms.txt</a>
          </nav>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <aside className="space-y-6">
          <div className={PANEL}>
            <ContextForm value={form} errors={parsed.ok ? [] : parsed.errors} onChange={editForm} />
          </div>
          {output && (
            <div className={PANEL}>
              <LabelsPanel providers={visible} output={output} labels={labels} />
            </div>
          )}
        </aside>

        <section aria-labelledby="results-title" className="min-w-0 space-y-4">
          <h2 id="results-title" className="sr-only">{en.ui.results_title}</h2>
          {linkedVersion && (
            <p data-rules-mismatch role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {fillUi(en, 'rules_version_mismatch', { linked: linkedVersion, current: VERSION.rules })}
            </p>
          )}
          <div role="tablist" aria-label={en.ui.tablist_label} className="flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
            {TABS.map((t, i) => {
              const selected = tab === t.id;
              return (
                <button
                  key={t.id}
                  ref={(el) => { tabRefs.current[i] = el; }}
                  type="button"
                  role="tab"
                  id={`tab-${t.id}`}
                  aria-selected={selected}
                  aria-controls="results-panel"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setTab(t.id)}
                  onKeyDown={(e) => onTabKey(e, i)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:focus-visible:outline-indigo-400 ${
                    selected
                      ? 'border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300'
                      : 'border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          <p data-pass-meaning className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{en.ui.pass_meaning}</p>

          <div role="tabpanel" id="results-panel" aria-labelledby={`tab-${tab}`} className="space-y-8">
            {output
              ? visible.map((p) => <ProviderSection key={p} provider={p} names={output[p] ?? {}} />)
              : <p role="status" className="rounded-lg border border-dashed border-zinc-300 p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">{en.ui.empty_state}</p>}
          </div>
        </section>
      </main>
      <footer className="mx-auto max-w-7xl px-4 pb-6 text-xs text-zinc-600 dark:text-zinc-400">
        <p data-version>{fillUi(en, 'version_footer', VERSION)}</p>
      </footer>
    </div>
  );
}

export default App;
