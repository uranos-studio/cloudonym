// ③ Resources — 이름 유일 범위 트리(D37) · 검색 · 분류 칩 · 「선택만 보기」 · 접기 · 체크 · 개수/역할.
// 선택 상태는 App 의 Map 하나이고 이 트리는 그것을 읽기만 한다. 바꾼 값은 onChange 로 넘기고 판정(core validateSelection)은 App 이 한다.
// 키보드 — 행의 체크 상자에서 ↑ ↓ 로 행 이동 · 스페이스로 체크 · + - 로 개수
import { memo, useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, Minus, Plus, Search } from 'lucide-react';
import { inputKind, scopePath, type TreeNode } from '../core/tree';
import { ROLE_PATTERN } from '../core/selection';
import type { Category, Provider, ResourceRule } from '../core/types';
import { canAdd, canIncrease, setCount, setRole, toggle, type Picked, type PickedEntry } from './selection';
import { categoryCounts, filterTree, isFiltering, type TreeFilter, type ViewNode } from './treeFilter';
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
const STEP =
  'inline-flex size-8 items-center justify-center rounded-md border border-zinc-300 text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800';

interface Props {
  provider: Provider;
  tree: TreeNode;
  picked: Picked;
  onChange: (next: Picked) => void;
}

/** 처음 펼침 — 뿌리와 그 바로 아래 한 단계. 링크로 연 선택이 있으면 그 행의 조상 범위도 연다 — 고른 행이 접힌 채 숨지 않게 */
function initialOpen(tree: TreeNode, picked: Picked): Set<string> {
  const open = new Set<string>([tree.scope.id, ...tree.children.map((c) => c.scope.id)]);
  const walk = (n: TreeNode) => {
    for (const r of n.rules) if (picked.has(r.resourceType)) for (const s of scopePath(r)) open.add(s.id);
    n.children.forEach(walk);
  };
  walk(tree);
  return open;
}
const allScopeIds = (n: TreeNode): string[] => [n.scope.id, ...n.children.flatMap(allScopeIds)];
/** 분류 묶음 id 전부 — 「모두 접기」가 묶음도 접는다. 걸러진 트리는 묶음 판정이 달라질 수 있어 범위 × 분류 전부를 담는다(없는 id 는 쓰이지 않을 뿐이다) */
const allGroupIds = (n: TreeNode): string[] => [...new Set(n.rules.map((r) => `${n.scope.id}/${r.category}`)), ...n.children.flatMap(allGroupIds)];
/** 걸러진 동안 summary 를 눌러도 접지 않는다 — open 은 그동안 늘 true 라 React 가 DOM 을 다시 쓰지 않아, 접힌 DOM 과 상태가 어긋난다 */
const keepOpenWhile = (filtering: boolean) => (e: MouseEvent<HTMLElement>) => { if (filtering) e.preventDefault(); };

function ResourceTreeImpl({ provider, tree, picked, onChange }: Props) {
  const [filter, setFilter] = useState<TreeFilter>({ query: '', selectedOnly: false });
  const [open, setOpen] = useState<Set<string>>(() => initialOpen(tree, picked));
  const [closedGroups, setClosedGroups] = useState<Set<string>>(() => new Set());
  // 트리가 바뀌면(CSP 전환) 펼침을 처음으로 — 렌더 중 이전 값과 대어 본다(React 문서의 「props 가 바뀔 때 state 조정」)
  const [shownTree, setShownTree] = useState(tree);
  if (shownTree !== tree) {
    setShownTree(tree);
    setOpen(initialOpen(tree, picked));
    setClosedGroups(new Set());
    setFilter({ query: '', selectedOnly: false });
  }

  // 행의 콜백이 매번 바뀌지 않게 최신 선택을 ref 로 읽는다 — 행은 memo 라 자기 값이 같으면 다시 그리지 않는다
  const pickedRef = useRef(picked);
  useLayoutEffect(() => { pickedRef.current = picked; }, [picked]);
  const onToggleRule = useCallback((r: ResourceRule) => onChange(toggle(pickedRef.current, r)), [onChange]);
  const onCount = useCallback((r: ResourceRule, n: number) => onChange(setCount(pickedRef.current, r, n)), [onChange]);
  const onRole = useCallback((r: ResourceRule, role: string) => onChange(setRole(pickedRef.current, r, role)), [onChange]);

  const view = useMemo(() => filterTree(tree, filter, picked), [tree, filter, picked]);
  const counts = useMemo(() => categoryCounts(tree), [tree]);
  const total = useMemo(() => [...counts.values()].reduce((a, b) => a + b, 0), [counts]);
  const filtering = isFiltering(filter);
  const addable = canAdd(picked);

  const setScopeOpen = (id: string, isOpen: boolean) => setOpen((prev) => {
    if (prev.has(id) === isOpen) return prev;
    const next = new Set(prev);
    if (isOpen) next.add(id); else next.delete(id);
    return next;
  });
  const setGroupOpen = (id: string, isOpen: boolean) => setClosedGroups((prev) => {
    if (prev.has(id) === !isOpen) return prev;
    const next = new Set(prev);
    if (isOpen) next.delete(id); else next.add(id);
    return next;
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!(target instanceof HTMLInputElement) || target.dataset.rowCheck === undefined) return;
    const row = target.closest<HTMLElement>('[data-rule]');
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

  const renderRows = (rules: ResourceRule[]) => rules.map((r) => {
    const entry = picked.get(r.resourceType);
    return (
      <Row key={r.id} rule={r} entry={entry} canCheck={entry !== undefined || addable}
        canInc={entry !== undefined && canIncrease(picked, r)} onToggle={onToggleRule} onCount={onCount} onRole={onRole} />
    );
  });

  const renderNode = (n: ViewNode, depth: number) => {
    const id = n.scope.id;
    const isOpen = filtering || open.has(id);
    const cats = [...new Set(n.rules.map((r) => r.category))];
    const grouped = n.rules.length > GROUP_AT && cats.length > 1;
    return (
      <details key={id} open={isOpen} data-scope={id} onToggle={(e) => { if (!filtering) setScopeOpen(id, e.currentTarget.open); }}>
        <summary onClick={keepOpenWhile(filtering)} className="flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md px-1 text-sm font-semibold text-zinc-800 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-indigo-600 dark:text-zinc-200 dark:hover:bg-zinc-800">
          <ChevronRight aria-hidden="true" data-chevron className="size-4 shrink-0 text-zinc-500" />{n.scope.displayName} <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">({n.total})</span>
        </summary>
        <div className={depth === 0 ? 'pl-1' : 'ml-2 border-l border-zinc-200 pl-2 dark:border-zinc-800'}>
          {grouped
            ? cats.map((c) => {
              const gid = `${id}/${c}`;
              const rules = n.rules.filter((r) => r.category === c);
              return (
                <details key={gid} open={filtering || !closedGroups.has(gid)} data-group={gid} onToggle={(e) => { if (!filtering) setGroupOpen(gid, e.currentTarget.open); }}>
                  <summary onClick={keepOpenWhile(filtering)} className="flex min-h-8 cursor-pointer items-center gap-1 px-1 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                    <ChevronRight aria-hidden="true" data-chevron className="size-3.5 shrink-0" />{CATEGORY_LABEL[c]} ({rules.length})
                  </summary>
                  <div className="ml-2 border-l border-zinc-200 pl-2 dark:border-zinc-800">{renderRows(rules)}</div>
                </details>
              );
            })
            : renderRows(n.rules)}
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
              onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
              className="block w-full rounded-md border border-zinc-300 bg-white py-2 pr-3 pl-8 text-sm placeholder:text-zinc-500 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600 dark:border-zinc-700 dark:bg-zinc-950 dark:placeholder:text-zinc-400"
            />
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" data-selected-only checked={filter.selectedOnly} onChange={(e) => setFilter((f) => ({ ...f, selectedOnly: e.target.checked }))} className="size-4 accent-indigo-600" />
            {en.ui.selected_only}
          </label>
        </div>
        <div role="group" aria-label={en.ui.category_filter_label} className="flex gap-1.5 overflow-x-auto pb-1">
          <button type="button" aria-pressed={filter.category === undefined} className={CHIP} onClick={() => setFilter((f) => ({ ...f, category: undefined }))} data-category="all">
            {en.ui.category_all} ({total})
          </button>
          {[...counts].map(([c, n]) => (
            <button key={c} type="button" aria-pressed={filter.category === c} className={CHIP} data-category={c}
              onClick={() => setFilter((f) => ({ ...f, category: f.category === c ? undefined : c }))}>
              {CATEGORY_LABEL[c]} ({n})
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" className={SMALL_BUTTON} data-expand-all
            onClick={() => { setOpen(new Set(allScopeIds(tree))); setClosedGroups(new Set()); }}>
            <ChevronsUpDown aria-hidden="true" className="size-3.5" />{en.ui.expand_all}
          </button>
          <button type="button" className={SMALL_BUTTON} data-collapse-all onClick={() => { setOpen(new Set([tree.scope.id])); setClosedGroups(new Set(allGroupIds(tree))); }}>
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
  return n.rules.find((r) => r.id === id) ?? n.children.map((c) => findRule(c, id)).find((r) => r !== undefined);
}

interface RowProps {
  rule: ResourceRule;
  entry: PickedEntry | undefined;
  canCheck: boolean;
  canInc: boolean;
  onToggle: (r: ResourceRule) => void;
  onCount: (r: ResourceRule, n: number) => void;
  onRole: (r: ResourceRule, role: string) => void;
}

/** 행 하나 — 높이 44px(터치) · 체크 · 이름 · slug · 입력(개수 · 역할 · 1 고정) */
const Row = memo(function Row({ rule, entry, canCheck, canInc, onToggle, onCount, onRole }: RowProps) {
  const checked = entry !== undefined;
  const kind = inputKind(rule);
  const name = { displayName: rule.displayName };
  return (
    <div data-rule={rule.id} data-type={rule.resourceType} data-rule-category={rule.category} data-entity={rule.entity} data-checked={checked} className="flex min-h-11 flex-wrap items-center gap-x-2 rounded-md px-1 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" data-row-check checked={checked} disabled={!canCheck} onChange={() => onToggle(rule)}
          aria-label={fillUi(en, 'select_resource_label', name)} className="size-4 shrink-0 accent-indigo-600 disabled:cursor-not-allowed" />
        <span className="min-w-0 truncate text-zinc-900 dark:text-zinc-100">{rule.displayName}</span>
        {rule.slug && <code className="hidden shrink-0 font-mono text-xs text-zinc-500 sm:inline dark:text-zinc-400">{rule.slug}</code>}
      </label>
      {kind === 'count' && (
        <div role="group" aria-label={fillUi(en, 'count_label', name)} className="flex shrink-0 items-center gap-1">
          <button type="button" className={STEP} aria-label={fillUi(en, 'count_decrease', name)} data-dec
            disabled={!checked || (entry?.count ?? 1) <= 1} onClick={() => entry && onCount(rule, entry.count - 1)}>
            <Minus aria-hidden="true" className="size-3.5" />
          </button>
          <span data-count className="w-6 text-center text-sm tabular-nums">{entry?.count ?? 1}</span>
          <button type="button" className={STEP} aria-label={fillUi(en, 'count_increase', name)} data-inc
            disabled={!canInc} onClick={() => entry && onCount(rule, entry.count + 1)}>
            <Plus aria-hidden="true" className="size-3.5" />
          </button>
        </div>
      )}
      {kind === 'none' && (
        <span data-count-fixed title={en.ui.count_fixed_hint} className="w-[5.5rem] shrink-0 text-center text-sm text-zinc-500 tabular-nums dark:text-zinc-400">
          1<span className="sr-only"> — {en.ui.count_fixed_hint}</span>
        </span>
      )}
      {kind === 'role' && <RoleInput rule={rule} value={entry?.role} disabled={!checked} onRole={onRole} />}
    </div>
  );
});

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
