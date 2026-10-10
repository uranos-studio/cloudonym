// ③ Resources — 이름 유일 범위 트리(D37) · 검색 · 분류 칩 · 「선택만 보기」 · 접기 · 체크 · 개수/역할.
// 펼침은 두 벌이다 — 거르지 않은 보기와 걸러진 보기. 걸러진 보기는 필터가 바뀔 때마다 모두 펼쳐 시작하고, 필터를 지우면 거르지 않은 보기의 펼침이 그대로 돌아온다.
// 선택 상태는 App 의 Map 하나이고 이 트리는 그것을 읽기만 한다. 바꾼 값은 onChange 로 넘기고 판정(core validateSelection)은 App 이 한다.
// 행(D53) — 화면 행은 catalog 행이다. 규칙이 둘 이상인 행은 범위 select 로 규칙 하나를 고르고, 고르기 전에는 체크할 수 없다.
// 종류(D52) — 고른 범위의 규칙에 종류 표가 있으면 select. 체크 전에 고른 범위 · 종류는 트리가 행 key 로 들고 있다가(행이 걸러져 사라져도 남는다) 체크할 때 싣는다.
// 존(D50) — 문맥에 존이 없으면 존 규칙 행을 새로 체크할 수 없다. 이미 고른 행은 켜 둔 채 끌 수만 있고 같은 안내를 보인다.
// (i) — catalog 의 설명 · 입력 위치(gcloud · Terraform) · 표지(D54). 문장은 catalog 데이터(영어)다.
// 키보드 — 행의 체크 상자에서 ↑ ↓ 로 행 이동 · 스페이스로 체크 · + - 로 개수 · 범위 머리(summary)에서 Enter · 스페이스로 접고 편다
import { memo, useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, Info, Minus, Plus, Search } from 'lucide-react';
import { inputKind, rowRules, scopeChoices, type TreeNode, type TreeRow } from '../core/tree';
import { ROLE_PATTERN } from '../core/selection';
import { SCOPES } from '../core/scopes';
import type { Category, Provider, ResourceRule, ScopeId } from '../core/types';
import {
  activeRule, canIncrease, kindChoices, kindSelectValue, pickedRule, refilterKind, rowBlock, setCount, setKind, setRole, setRowScope, toggleRow,
  type KindChoices, type Picked, type PickedEntry, type RowBlock, type RowDraft,
} from './selection';
import { apiOnlyCount, categoryCounts, filterTree, isFiltering, type TreeFilter, type ViewNode } from './treeFilter';
import { collapseAll, expandAll, groupId, initialOpen, isGroupOpen, isScopeOpen, setGroupOpen, setScopeOpen, type OpenState } from './treeOpen';
import { providerName } from './providerName';
import { fillUi } from '../messages/catalog';
import { en } from '../messages/en';

/** 범위 안 규칙이 이보다 많고 분류가 둘 이상이면 분류별로 접는다 (많아지는 것은 깊이가 아니라 한 범위 아래의 폭이다) */
const GROUP_AT = 8;
const CATEGORY_LABEL: Record<Category, string> = {
  compute: en.ui.category_compute, networking: en.ui.category_networking, storage: en.ui.category_storage, database: en.ui.category_database,
  identity: en.ui.category_identity, security: en.ui.category_security, management: en.ui.category_management, containers: en.ui.category_containers,
};

const SMALL_BUTTON =
  'inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800';
const CHIP =
  'shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ' +
  'aria-pressed:border-indigo-600 aria-pressed:bg-indigo-50 aria-pressed:text-indigo-800 dark:aria-pressed:border-indigo-400 dark:aria-pressed:bg-indigo-950 dark:aria-pressed:text-indigo-200 ' +
  'border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800';
const BADGE =
  'shrink-0 rounded border px-1.5 py-0.5 text-[0.6875rem] font-medium leading-none ' +
  'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200';
const STEP =
  'inline-flex size-8 items-center justify-center rounded-md border border-zinc-300 text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800';

interface Props {
  provider: Provider;
  tree: TreeNode;
  picked: Picked;
  onChange: (next: Picked) => void;
}

/** 행 key → 체크 전에 고른 범위 · 종류와, 범위를 바꿔 버린 종류(안내 한 줄) */
type Drafts = ReadonlyMap<string, RowDraft & { droppedKind?: string }>;
const NO_DRAFT: RowDraft = {};

function ResourceTreeImpl({ provider, tree, picked, onChange }: Props) {
  const [filter, setFilter] = useState<TreeFilter>({ query: '', selectedOnly: false });
  // 펼침 두 벌 — plain 은 거르지 않은 보기, filtered 는 걸러진 보기(필터가 바뀔 때마다 모두 펼침으로 다시 시작)
  const [plain, setPlain] = useState<OpenState>(() => initialOpen(tree, picked));
  const [filtered, setFiltered] = useState<OpenState>(() => expandAll(tree));
  // 트리가 바뀌면(CSP 전환) 펼침을 처음으로 — 렌더 중 이전 값과 대어 본다(React 문서의 「props 가 바뀔 때 state 조정」)
  const [shownTree, setShownTree] = useState(tree);
  // 체크 전에 고른 범위 · 종류 — 행 key 로 든다. 행 컴포넌트가 걸러져 사라져도 값이 남는다
  const [drafts, setDrafts] = useState<Drafts>(() => new Map());
  if (shownTree !== tree) {
    setShownTree(tree);
    setPlain(initialOpen(tree, picked));
    setFiltered(expandAll(tree));
    setFilter({ query: '', selectedOnly: false });
    setDrafts(new Map());
  }

  // 행의 콜백이 매번 바뀌지 않게 최신 선택 · draft 를 ref 로 읽는다 — 행은 memo 라 자기 값이 같으면 다시 그리지 않는다
  const pickedRef = useRef(picked);
  const draftsRef = useRef(drafts);
  useLayoutEffect(() => { pickedRef.current = picked; draftsRef.current = drafts; }, [picked, drafts]);
  const putDraft = useCallback((key: string, d: RowDraft & { droppedKind?: string }) => setDrafts((m) => new Map(m).set(key, d)), []);
  const onToggleRow = useCallback((row: TreeRow) => {
    const cur = pickedRef.current;
    const d: RowDraft & { droppedKind?: string } = draftsRef.current.get(row.key) ?? NO_DRAFT;
    const was = pickedRule(row, cur);
    // 체크를 풀면 그 범위 · 종류를 다시 들고 있는다 — 다시 체크하면 같은 것이 돌아온다
    if (was) putDraft(row.key, { scope: was.scope, kind: cur.get(was.resourceType)?.kind });
    else if (d.droppedKind !== undefined) putDraft(row.key, { scope: d.scope, kind: d.kind });
    onChange(toggleRow(cur, row, { scope: d.scope, kind: d.kind }));
  }, [onChange, putDraft]);
  const onScope = useCallback((row: TreeRow, scope: ScopeId) => {
    const cur = pickedRef.current;
    const d = draftsRef.current.get(row.key) ?? NO_DRAFT;
    const was = pickedRule(row, cur);
    if (was) {
      const res = setRowScope(cur, row, scope);
      putDraft(row.key, { scope, ...(res.kindDropped ? { droppedKind: cur.get(was.resourceType)?.kind } : {}) });
      onChange(res.picked);
      return;
    }
    const rule = rowRules(row, scope)[0];
    if (!rule) return;
    const { kind, dropped } = refilterKind(rule, d.kind);
    putDraft(row.key, { scope, kind, ...(dropped ? { droppedKind: d.kind } : {}) });
  }, [onChange, putDraft]);
  const onDraftKind = useCallback((row: TreeRow, kind: string | undefined) => {
    const d = draftsRef.current.get(row.key) ?? NO_DRAFT;
    putDraft(row.key, { scope: d.scope, kind });
  }, [putDraft]);
  const onCount = useCallback((r: ResourceRule, n: number) => onChange(setCount(pickedRef.current, r, n)), [onChange]);
  const onRole = useCallback((r: ResourceRule, role: string) => onChange(setRole(pickedRef.current, r, role)), [onChange]);
  const onKind = useCallback((r: ResourceRule, kind: string | undefined) => onChange(setKind(pickedRef.current, r, kind)), [onChange]);

  const view = useMemo(() => filterTree(tree, filter, picked), [tree, filter, picked]);
  const counts = useMemo(() => categoryCounts(tree), [tree]);
  const apiOnly = useMemo(() => apiOnlyCount(tree), [tree]);
  const total = useMemo(() => [...counts.values()].reduce((a, b) => a + b, 0), [counts]);
  const filtering = isFiltering(filter);

  // 지금 보이는 보기의 펼침 — 걸러진 동안은 filtered, 아니면 plain 을 읽고 쓴다
  const shown = filtering ? filtered : plain;
  const setShown = filtering ? setFiltered : setPlain;
  /** 필터를 바꾼다 — 걸러진 보기의 펼침은 모두 펼침으로 다시 시작한다(새로 걸린 행이 접힌 채 숨지 않게) */
  const changeFilter = (fn: (f: TreeFilter) => TreeFilter) => {
    setFilter(fn);
    setFiltered(expandAll(tree));
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!(target instanceof HTMLInputElement) || target.dataset.rowCheck === undefined) return;
    const row = target.closest<HTMLElement>('[data-row]');
    if (!row) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      // 보이는 행만 — 닫힌 <details> 의 내용은 content-visibility 로 숨어 offsetParent 가 남으므로 checkVisibility 로 본다.
      // 선택 상한에서 비활성인 상자는 건너뛴다 — focus() 가 먹지 않아 이동이 거기서 막힌다
      const boxes = [...(containerRef.current?.querySelectorAll<HTMLInputElement>('input[data-row-check]') ?? [])].filter((b) => b === target || (!b.disabled && b.checkVisibility()));
      const i = boxes.indexOf(target);
      const next = boxes[e.key === 'ArrowDown' ? i + 1 : i - 1];
      if (next) { e.preventDefault(); next.focus(); }
      return;
    }
    if (e.key === '+' || e.key === '=' || e.key === '-') {
      const rule = findRule(tree, row.dataset.rule ?? '');
      const entry = rule && pickedRef.current.get(rule.resourceType);
      if (!rule || !entry || inputKind(rule) !== 'count') return;
      e.preventDefault();
      if (e.key === '-') { if (entry.count > 1) onCount(rule, entry.count - 1); }
      else if (canIncrease(pickedRef.current, rule)) onCount(rule, entry.count + 1);
    }
  };

  const renderRows = (rows: TreeRow[]) => rows.map((row) => {
    const d = drafts.get(row.key) ?? NO_DRAFT;
    const p = pickedRule(row, picked);
    const entry = p && picked.get(p.resourceType);
    return (
      <Row key={row.key} row={row} rule={activeRule(row, picked, d)} entry={entry} draft={d} droppedKind={drafts.get(row.key)?.droppedKind}
        block={rowBlock(row, picked, d)} canInc={p !== undefined && canIncrease(picked, p)}
        onToggle={onToggleRow} onScope={onScope} onDraftKind={onDraftKind} onCount={onCount} onRole={onRole} onKind={onKind} />
    );
  });

  const renderNode = (n: ViewNode, depth: number) => {
    const id = n.scope.id;
    const isOpen = isScopeOpen(shown, id);
    const cats = [...new Set(n.rows.map((r) => r.category))];
    const grouped = n.rows.length > GROUP_AT && cats.length > 1;
    return (
      <details key={id} open={isOpen} data-scope={id} onToggle={(e) => { const o = e.currentTarget.open; setShown((s) => setScopeOpen(s, id, o)); }}>
        <summary className="flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md px-1 text-sm font-semibold text-zinc-800 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-indigo-600 dark:text-zinc-200 dark:hover:bg-zinc-800">
          <ChevronRight aria-hidden="true" data-chevron className="size-4 shrink-0 text-zinc-500" />{n.scope.displayName} <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">({n.total})</span>
        </summary>
        <div className={depth === 0 ? 'pl-1' : 'ml-2 border-l border-zinc-200 pl-2 dark:border-zinc-800'}>
          {grouped
            ? cats.map((c) => {
              const gid = groupId(id, c);
              const rows = n.rows.filter((r) => r.category === c);
              return (
                <details key={gid} open={isGroupOpen(shown, gid)} data-group={gid} onToggle={(e) => { const o = e.currentTarget.open; setShown((s) => setGroupOpen(s, gid, o)); }}>
                  <summary className="flex min-h-8 cursor-pointer items-center gap-1 px-1 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                    <ChevronRight aria-hidden="true" data-chevron className="size-3.5 shrink-0" />{CATEGORY_LABEL[c]} ({rows.length})
                  </summary>
                  <div className="ml-2 border-l border-zinc-200 pl-2 dark:border-zinc-800">{renderRows(rows)}</div>
                </details>
              );
            })
            : renderRows(n.rows)}
          {n.children.map((c) => renderNode(c, depth + 1))}
        </div>
      </details>
    );
  };

  return (
    <section aria-labelledby="step-resources" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="step-resources" className="text-base font-semibold">
          <span aria-hidden="true" className="mr-1.5 text-indigo-600 dark:text-indigo-400">3</span>{fillUi(en, 'resources_title', { provider: providerName(provider) })}
        </h2>
        <span data-selected-count className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{fillUi(en, 'selected_count', { n: picked.size })}</span>
      </div>

      <div className="sticky top-0 z-10 -mx-1 space-y-2 bg-white px-1 py-2 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-0 flex-1 basis-48">
            <span className="sr-only">{en.ui.search_label}</span>
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-zinc-500" />
            <input
              type="search" data-tree-search value={filter.query} placeholder={en.ui.search_placeholder}
              onChange={(e) => { const query = e.target.value; changeFilter((f) => ({ ...f, query })); }}
              className="block w-full rounded-md border border-zinc-300 bg-white py-2 pr-3 pl-8 text-sm placeholder:text-zinc-500 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600 dark:border-zinc-700 dark:bg-zinc-950 dark:placeholder:text-zinc-400"
            />
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" data-selected-only checked={filter.selectedOnly} onChange={(e) => { const selectedOnly = e.target.checked; changeFilter((f) => ({ ...f, selectedOnly })); }} className="size-4 accent-indigo-600" />
            {en.ui.selected_only}
          </label>
        </div>
        <div role="group" aria-label={en.ui.category_filter_label} className="flex gap-1.5 overflow-x-auto pb-1">
          <button type="button" aria-pressed={filter.category === undefined} className={CHIP} onClick={() => changeFilter((f) => ({ ...f, category: undefined }))} data-category="all">
            {en.ui.category_all} ({total})
          </button>
          {[...counts].map(([c, n]) => (
            <button key={c} type="button" aria-pressed={filter.category === c} className={CHIP} data-category={c}
              onClick={() => changeFilter((f) => ({ ...f, category: f.category === c ? undefined : c }))}>
              {CATEGORY_LABEL[c]} ({n})
            </button>
          ))}
          {/* 「API only」 — 분류 칩 줄 끝의 거르기 칩. 기본은 꺼져 그 행들도 트리에 보인다 (D54 · 6-3) */}
          {apiOnly > 0 && (
            <button type="button" aria-pressed={filter.apiOnly === true} className={CHIP} data-api-only-filter
              onClick={() => changeFilter((f) => ({ ...f, apiOnly: f.apiOnly !== true }))}>
              {en.ui.api_only_filter} ({apiOnly})
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" className={SMALL_BUTTON} data-expand-all
            onClick={() => setShown(expandAll(tree))}>
            <ChevronsUpDown aria-hidden="true" className="size-3.5" />{en.ui.expand_all}
          </button>
          <button type="button" className={SMALL_BUTTON} data-collapse-all onClick={() => setShown(collapseAll(tree))}>
            <ChevronsDownUp aria-hidden="true" className="size-3.5" />{en.ui.collapse_all}
          </button>
        </div>
      </div>

      {/* role="tree" 는 두지 않는다 — <details> 와 체크 상자 · 스테퍼가 섞인 구조라 ARIA tree 의 treeitem 계약을 지킬 수 없다. 방향키 · 스페이스 · + - 는 둔다 */}
      <div ref={containerRef} data-tree role="group" aria-label={en.ui.tree_label} onKeyDown={onKey} className="space-y-0.5">
        {view ? renderNode(view, 0) : <p data-search-empty role="status" className="rounded-md border border-dashed border-zinc-300 p-4 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">{en.ui.search_empty}</p>}
      </div>
    </section>
  );
}

function findRule(n: TreeNode, id: string): ResourceRule | undefined {
  return n.rows.flatMap((row) => row.rules).find((r) => r.id === id) ?? n.children.map((c) => findRule(c, id)).find((r) => r !== undefined);
}

interface RowProps {
  row: TreeRow;
  /** 행이 지금 가리키는 규칙 — 고른 규칙 · 단일 규칙 · 고른 범위의 규칙. 범위를 고르기 전 합친 행은 없다 */
  rule: ResourceRule | undefined;
  entry: PickedEntry | undefined;
  draft: RowDraft;
  droppedKind: string | undefined;
  block: RowBlock | undefined;
  canInc: boolean;
  onToggle: (row: TreeRow) => void;
  onScope: (row: TreeRow, scope: ScopeId) => void;
  onDraftKind: (row: TreeRow, kind: string | undefined) => void;
  onCount: (r: ResourceRule, n: number) => void;
  onRole: (r: ResourceRule, role: string) => void;
  onKind: (r: ResourceRule, kind: string | undefined) => void;
}

/** 행 하나 — 높이 44px(터치) · 체크 · 이름 · slug · (i) · 표지 · 범위 select(합친 행) · 종류 select · 입력(개수 · 역할 · 1 고정) · 안내 */
const Row = memo(function Row({ row, rule, entry, draft, droppedKind, block, canInc, onToggle, onScope, onDraftKind, onCount, onRole, onKind }: RowProps) {
  const checked = entry !== undefined;
  const shape = rule ?? row.rules[0]!;
  const input = inputKind(shape);
  const name = { displayName: row.displayName };
  const scopes = useMemo(() => scopeChoices(row), [row]);
  const choices = useMemo(() => (rule ? kindChoices(rule) : undefined), [rule]);
  const shownKind = checked ? entry.kind : draft.kind;
  const [infoOpen, setInfoOpen] = useState(false);
  const hintId = useId();
  const infoId = useId();
  // 행 아래 안내 — 막힌 까닭(범위 · 종류)
  const hint = block === 'scope' ? fillUi(en, 'scope_required_hint', name)
    : block === 'kind' ? fillUi(en, 'kind_required_hint', name) : undefined;
  const hintKind = block === 'scope' ? 'scope' : 'kind';
  const onPickKind = (v: string) => {
    const next = v === '' ? undefined : v;
    if (checked && rule) onKind(rule, next);
    else onDraftKind(row, next);
  };
  const cat = row.catalog;
  return (
    <div data-row={row.key} data-rule={rule?.id} data-type={rule?.resourceType} data-rule-category={row.category} data-entity={rule?.entity} data-checked={checked}
      className="flex min-h-11 flex-wrap items-center gap-x-2 rounded-md px-1 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" data-row-check checked={checked} disabled={!checked && block !== undefined} onChange={() => onToggle(row)}
          aria-label={fillUi(en, 'select_resource_label', name)} aria-describedby={hint ? hintId : undefined} className="size-4 shrink-0 accent-indigo-600 disabled:cursor-not-allowed" />
        <span className="min-w-0 truncate text-zinc-900 dark:text-zinc-100">{row.displayName}</span>
        {shape.slug && <code className="hidden shrink-0 font-mono text-xs text-zinc-500 sm:inline dark:text-zinc-400">{shape.slug}</code>}
      </label>
      {cat && (
        <button type="button" data-info-toggle aria-expanded={infoOpen} aria-controls={infoOpen ? infoId : undefined} aria-label={fillUi(en, 'info_toggle', name)}
          onClick={() => setInfoOpen((o) => !o)}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 aria-expanded:text-indigo-700 focus-visible:outline-2 focus-visible:outline-indigo-600 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:aria-expanded:text-indigo-300">
          <Info aria-hidden="true" className="size-4" />
        </button>
      )}
      {cat?.badges.map((b) => (
        <span key={b} data-badge={b} title={b === 'api-only' ? en.ui.badge_api_only_title : en.ui.badge_preview_title} className={BADGE}>
          {b === 'api-only' ? en.ui.badge_api_only : en.ui.badge_preview}
        </span>
      ))}
      {scopes.length >= 2 && (
        <select data-scope-select value={rule?.scope ?? ''} onChange={(e) => onScope(row, e.target.value as ScopeId)} aria-label={fillUi(en, 'scope_choice_label', name)}
          className="shrink-0 rounded-md border border-zinc-300 bg-white px-1.5 py-1 text-xs focus-visible:outline-2 focus-visible:outline-indigo-600 dark:border-zinc-700 dark:bg-zinc-950">
          <option value="" disabled>{en.ui.scope_choose}</option>
          {scopes.map((c) => <option key={c.scope} value={c.scope}>{c.label}</option>)}
        </select>
      )}
      {rule && choices && <KindSelect rule={rule} choices={choices} value={kindSelectValue(rule, shownKind)} onPick={onPickKind} />}
      {input === 'count' && (
        <div role="group" aria-label={fillUi(en, 'count_label', name)} className="flex shrink-0 items-center gap-1">
          <button type="button" className={STEP} aria-label={fillUi(en, 'count_decrease', name)} data-dec
            disabled={!checked || (entry?.count ?? 1) <= 1} onClick={() => rule && entry && onCount(rule, entry.count - 1)}>
            <Minus aria-hidden="true" className="size-3.5" />
          </button>
          <span data-count className="w-6 text-center text-sm tabular-nums">{entry?.count ?? 1}</span>
          <button type="button" className={STEP} aria-label={fillUi(en, 'count_increase', name)} data-inc
            disabled={!canInc} onClick={() => rule && entry && onCount(rule, entry.count + 1)}>
            <Plus aria-hidden="true" className="size-3.5" />
          </button>
        </div>
      )}
      {input === 'none' && (
        <span data-count-fixed title={en.ui.count_fixed_hint} className="w-[5.5rem] shrink-0 text-center text-sm text-zinc-500 tabular-nums dark:text-zinc-400">
          1<span className="sr-only"> — {en.ui.count_fixed_hint}</span>
        </span>
      )}
      {input === 'role' && <RoleInput rule={shape} value={entry?.role} disabled={!checked} onRole={onRole} />}
      {hint && (
        <p id={hintId} data-scope-required={hintKind === 'scope' || undefined} data-kind-required={hintKind === 'kind' || undefined}
          className="basis-full pb-1 pl-6 text-xs text-zinc-600 dark:text-zinc-400">{hint}</p>
      )}
      {droppedKind !== undefined && rule && (
        <p data-kind-dropped role="status" className="basis-full pb-1 pl-6 text-xs text-amber-800 dark:text-amber-300">
          {fillUi(en, 'kind_dropped_on_scope', { kind: droppedKind, scope: SCOPES[rule.scope]?.displayName ?? rule.scope })}
        </p>
      )}
      {cat && infoOpen && (
        <div id={infoId} data-info className="basis-full space-y-0.5 pb-1.5 pl-6 text-xs text-zinc-700 dark:text-zinc-300">
          <p>{cat.info}</p>
          {(cat.enterNameAt.gcloud.length > 0 || cat.enterNameAt.terraform.length > 0) && (
            <p data-enter-name-at className="text-zinc-600 dark:text-zinc-400">
              {en.ui.enter_name_at}: {[...cat.enterNameAt.gcloud, ...cat.enterNameAt.terraform].map((t, i) => (
                <span key={t}>{i > 0 && ' · '}<code className="font-mono">{t}</code></span>
              ))}
            </p>
          )}
        </div>
      )}
    </div>
  );
});

/** 종류 select — 빈 칸('')은 그 범위의 기본값 · 토큰 없음 · 아직 고르지 않음(필수) 중 하나이고, 나머지는 규칙의 allowed 값 이름이다 */
function KindSelect({ rule, choices, value, onPick }: { rule: ResourceRule; choices: KindChoices; value: string; onPick: (v: string) => void }) {
  const b = choices.blank;
  const blank = b.type === 'default' ? fillUi(en, 'kind_default', { value: b.value }) : b.type === 'none' ? en.ui.kind_none : en.ui.kind_choose;
  return (
    <select data-kind-select value={value} onChange={(e) => onPick(e.target.value)} aria-label={fillUi(en, 'kind_label', { displayName: rule.displayName })}
      className="max-w-[12rem] shrink-0 truncate rounded-md border border-zinc-300 bg-white px-1.5 py-1 font-mono text-xs focus-visible:outline-2 focus-visible:outline-indigo-600 dark:border-zinc-700 dark:bg-zinc-950">
      <option value="" disabled={b.type === 'choose'}>{blank}</option>
      {choices.options.map((v) => <option key={v} value={v}>{v}</option>)}
    </select>
  );
}

/** 역할 입력 — 꼴(ROLE_PATTERN)에 맞을 때만 선택에 반영한다. 무효인 동안은 aria-invalid 와 「이전 역할로 생성됨」 안내(행 아래 한 줄)를 보이고,
 *  blur 때 대문자를 소문자로 바꿔 맞으면 반영하고 아니면 칸을 마지막 유효 값으로 되돌린다 — 칸과 이름 · hash 가 다른 값을 보이지 않게 */
function RoleInput({ rule, value, disabled, onRole }: { rule: ResourceRule; value: string | undefined; disabled: boolean; onRole: (r: ResourceRule, role: string) => void }) {
  const [draft, setDraft] = useState(value ?? '');
  const [shown, setShown] = useState(value);
  const noteId = useId();
  if (shown !== value) {
    setShown(value);
    setDraft(value ?? '');
  }
  const valid = disabled || ROLE_PATTERN.test(draft);
  const settle = () => {
    if (disabled) return;
    const lower = draft.toLowerCase();
    if (ROLE_PATTERN.test(lower)) {
      setDraft(lower);
      if (lower !== value) onRole(rule, lower);
    } else setDraft(value ?? '');
  };
  return (
    <>
      <input
        type="text" data-role-input value={disabled ? '' : draft} disabled={disabled} maxLength={16} placeholder="sync"
        aria-label={fillUi(en, 'role_label', { displayName: rule.displayName })} aria-invalid={!valid} aria-describedby={valid ? undefined : noteId} title={en.ui.role_hint}
        onChange={(e) => {
          const v = e.target.value;
          setDraft(v);
          if (ROLE_PATTERN.test(v)) onRole(rule, v);
        }}
        onBlur={settle}
        className="w-[5.5rem] shrink-0 rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono text-xs disabled:opacity-40 aria-invalid:border-rose-600 focus-visible:outline-2 focus-visible:outline-indigo-600 dark:border-zinc-700 dark:bg-zinc-950"
      />
      {!valid && value !== undefined && (
        <p id={noteId} data-role-stale role="status" className="basis-full pb-1 text-right text-xs text-rose-700 dark:text-rose-300">
          {fillUi(en, 'role_stale', { role: value })}
        </p>
      )}
    </>
  );
}

export const ResourceTree = memo(ResourceTreeImpl);
