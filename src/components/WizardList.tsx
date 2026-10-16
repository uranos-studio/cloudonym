// 마법사 목록 칸 (D89) — 계획의 줄(project · network · 네트워크 pick · 서비스와 그 pick · extras 와 그 pick)을 트리로 보인다.
// 줄을 누르거나 ↑↓ 로 옮기면 그 줄이 선택되고 가운데 칸에 설정이 열린다. →/← 는 서비스 줄을 펴고 접고, Enter 는 설정 칸 첫 컨트롤로 간다.
// 줄 key 는 경로 + preset/ruleId 다 — tier · kind 를 넣지 않는다(입력 중에 줄이 다시 만들어지지 않게)
import { useEffect, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { MAX_PICKS_PER_SERVICE, MAX_SERVICES, type PlanError, type WizardPlan } from '../core/wizard/plan';
import { serviceNamespace, type ProjectResult } from '../core/engine';
import type { CoreMessage } from '../core/types';
import * as S from './wizardState';
import { EXTRAS_ROW, NETWORK_ROW, PROJECT_ROW, cardRow, parseRow, rowErrorCount, rowNames, serviceRow, visibleRows, type RowPath } from './wizardSelection';
import { serviceLayout } from './wizardBundles';
import { BTN, HINT } from './wizardStyles';
import { fillUi } from '../messages/catalog';
import { en } from '../messages/en';

const ROW =
  'group flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none ' +
  'hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-indigo-600 dark:hover:bg-zinc-800 dark:focus-visible:ring-indigo-400 ' +
  'aria-selected:bg-indigo-50 aria-selected:ring-1 aria-selected:ring-indigo-300 dark:aria-selected:bg-indigo-950 dark:aria-selected:ring-indigo-800 ' +
  'data-[flash=true]:bg-amber-50 dark:data-[flash=true]:bg-amber-950';
const BADGE_ERR = 'shrink-0 rounded-full bg-rose-100 px-1.5 text-[11px] font-semibold text-rose-800 dark:bg-rose-950 dark:text-rose-300';
const BADGE = 'shrink-0 rounded-full bg-zinc-100 px-1.5 text-[11px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300';
const CARD_STATE = {
  complete: 'shrink-0 rounded-full bg-emerald-50 px-1.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  incomplete: 'shrink-0 rounded-full bg-amber-50 px-1.5 text-[11px] font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200',
};

/** 줄의 DOM — 키보드로 옮긴 뒤 포커스를 준다 */
function rowElement(path: RowPath): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-row-path="${path}"]`);
}

export function WizardList({ plan, envs, selected, onSelect, isExpanded, onExpand, cardOpen, networkOpen, result, errors, serviceErrors, projectCount, flash, onAddService, onEnter, onActivate }: {
  plan: WizardPlan; envs: readonly string[]; selected: RowPath; onSelect: (path: RowPath) => void;
  isExpanded: (service: number) => boolean; onExpand: (service: number, open: boolean) => void;
  /** 카드 줄 아래 부품 줄을 보이는가 (D93) · 네트워크 pick 줄을 보이는가 */
  cardOpen: (service: number, card: string) => boolean; networkOpen: boolean;
  /** 첫 env 의 결과 — 줄 이름(D89). 온전하지 않으면 undefined(줄 이름 —) */
  result: ProjectResult | undefined;
  errors: readonly PlanError[]; serviceErrors: readonly (readonly CoreMessage[])[]; projectCount: number;
  /** 칩으로 막 더한 줄 — 잠깐 강조하고 보이게 굴린다 */
  flash: RowPath | undefined;
  onAddService: () => void; onEnter: () => void;
  /** 줄을 눌렀다(↑↓ 이동이 아니다) — 폰은 설정 시트를 연다 */
  onActivate?: (path: RowPath) => void;
}) {
  useEffect(() => {
    if (flash) rowElement(flash)?.scrollIntoView({ block: 'nearest' });
  }, [flash]);

  const rows = visibleRows(plan, isExpanded, cardOpen, networkOpen);
  const move = (path: RowPath) => {
    onSelect(path);
    // 선택한 줄이 그려진 뒤 포커스를 옮긴다(펼침 · 접힘으로 줄이 새로 생길 수 있다)
    // 그 사이 포커스가 목록 밖(Enter 로 설정 칸 등)으로 나갔으면 되찾아오지 않는다 — 빠른 ↑ → Enter 에서 설정 칸 포커스를 덮어쓰던 경쟁
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body && !active.closest('[data-wizard-list]')) return;
      rowElement(path)?.focus();
    });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const at = rows.indexOf(selected);
    const r = parseRow(selected);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const next = rows[Math.min(rows.length - 1, Math.max(0, (at < 0 ? 0 : at) + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next !== undefined) move(next);
    } else if (e.key === 'Home') move(rows[0]!);
    else if (e.key === 'End') move(rows[rows.length - 1]!);
    else if (e.key === 'ArrowRight') {
      // 다음 단계 줄 — 서비스는 펴고 첫 자식(카드 줄 · pick), 카드는 첫 부품, 네트워크는 첫 pick
      const child = rows[at + 1];
      if (r?.kind === 'service' && !isExpanded(r.service)) onExpand(r.service, true);
      else if (r?.kind === 'service' && child !== undefined && child.startsWith(`${serviceRow(r.service)}.`)) move(child);
      else if (r?.kind === 'card') {
        const first = [...serviceLayout(plan, r.service).owned].filter(([, id]) => id === r.card).map(([j]) => j).sort((a, b) => a - b)[0];
        if (first === undefined) return;
        move(S.pickPath({ service: r.service, pick: first }));
      } else if (r?.kind === 'network' && S.projectPickIndexes(plan, 'network').length > 0) move(S.pickPath({ service: null, pick: S.projectPickIndexes(plan, 'network')[0]! }));
      else return;
    } else if (e.key === 'ArrowLeft') {
      if (r?.kind === 'service' && isExpanded(r.service)) onExpand(r.service, false);
      else if (r?.kind === 'card') move(serviceRow(r.service));
      else if (r?.kind === 'pick' && r.ref.service !== null) {
        const card = serviceLayout(plan, r.ref.service).owned.get(r.ref.pick);
        move(card === undefined ? serviceRow(r.ref.service) : cardRow(r.ref.service, card));
      }
      else if (r?.kind === 'pick') move(plan.projectPicks[r.ref.pick]?.preset === null ? EXTRAS_ROW : NETWORK_ROW);
      else return;
    } else if (e.key === 'Enter') onEnter();
    else return;
    e.preventDefault();
  };

  const count = (path: RowPath) => rowErrorCount(plan, path, errors, serviceErrors, projectCount);
  const row = (path: RowPath, level: 1 | 2 | 3, body: ReactNode, extra: { key?: string; expanded?: boolean; pick?: string; card?: string } = {}) => {
    const n = count(path);
    return (
      <li key={extra.key ?? path} role="treeitem" aria-level={level} aria-selected={path === selected} tabIndex={path === selected ? 0 : -1}
        {...(extra.expanded === undefined ? {} : { 'aria-expanded': extra.expanded })}
        data-row-path={path} {...(extra.pick === undefined ? {} : { 'data-row-pick': extra.pick })} {...(extra.card === undefined ? {} : { 'data-row-card': extra.card })} data-flash={flash === path}
        className={`${ROW} ${level === 2 ? 'ml-5' : level === 3 ? 'ml-10' : ''}`} onClick={() => { onSelect(path); onActivate?.(path); }}>
        {body}
        {n > 0 && <span data-row-errors={n} className={BADGE_ERR} title={fillUi(en, 'wizard_row_errors', { n })}>!{n}</span>}
      </li>
    );
  };
  const pickRow = (ref: S.PickRef, level: 2 | 3 = 2) => {
    const pick = ref.service === null ? plan.projectPicks[ref.pick]! : plan.services[ref.service]!.picks[ref.pick]!;
    const path = S.pickPath(ref);
    const { title } = S.pickTitle(pick);
    const names = rowNames(plan, ref, result);
    const text = names ? `${names.first}${names.rest > 0 ? ` +${names.rest}` : ''}` : '—';
    return row(path, level, (
      <span className="flex min-w-0 flex-1 flex-col">
        <span data-row-title className="truncate font-medium">{title}</span>
        <code data-row-name title={names?.first} className={`truncate font-mono text-xs ${HINT}`}>{text}</code>
      </span>
    ), { key: `${path}-${pick.preset ?? pick.ruleId}`, pick: pick.preset ?? 'custom' });
  };
  const p = plan.project;
  const full = S.projectPicksFull(plan);
  // 네트워크 한 줄 (D93) — 이름 수(그 pick 들의 이름 합) · pick 제목들
  const networkIdx = S.projectPickIndexes(plan, 'network');
  const networkNames = result ? networkIdx.reduce((n, k) => { const x = rowNames(plan, { service: null, pick: k }, result); return n + (x ? x.rest + 1 : 0); }, 0) : undefined;
  const networkSummary = [...new Set(networkIdx.map((k) => S.pickTitle(plan.projectPicks[k]!).title))].join(', ');
  /** 펼친 서비스의 자식 — 카드 줄(연 카드는 부품 줄까지) · 카드 밖 pick */
  const serviceChildren = (i: number): ReactNode[] => {
    const { cards, owned, loose } = serviceLayout(plan, i);
    const out: ReactNode[] = [];
    for (const c of cards) {
      const path = cardRow(i, c.bundle.id);
      const open = cardOpen(i, c.bundle.id);
      const mine = [...owned].filter(([, id]) => id === c.bundle.id).map(([j]) => j).sort((a, b) => a - b);
      const first = mine[0] === undefined ? undefined : rowNames(plan, { service: i, pick: mine[0] }, result)?.first;
      out.push(row(path, 2, (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2">
            <span data-row-title className="truncate font-medium">{c.bundle.label}</span>
            <span data-card-state={c.complete ? 'complete' : 'incomplete'} className={c.complete ? CARD_STATE.complete : CARD_STATE.incomplete}>
              {c.complete ? en.ui.wizard_card_state_complete : en.ui.wizard_card_state_incomplete}
            </span>
          </span>
          <span className={`truncate text-xs ${HINT}`}>{fillUi(en, 'wizard_card_parts_count', { n: c.picks.length })}{first ? ` · ${first}` : ''}</span>
        </span>
      ), { expanded: open, card: c.bundle.id }));
      if (open) for (const j of mine) out.push(pickRow({ service: i, pick: j }, 3));
    }
    for (const j of loose) out.push(pickRow({ service: i, pick: j }));
    return out;
  };

  return (
    <div className="space-y-3">
      <h2 id="wizard-list-title" className="sr-only">{en.ui.wizard_list_label}</h2>
      <ul role="tree" aria-labelledby="wizard-list-title" data-wizard-list className="space-y-0.5" onKeyDown={onKeyDown}>
        {row(PROJECT_ROW, 1, (
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-semibold">{en.ui.wizard_step_project}</span>
            <span className={`truncate text-xs ${HINT}`}>{[p.owner, p.system, envs.join(', '), p.region].filter((x) => x !== '').join(' · ')}</span>
          </span>
        ))}
        {row(NETWORK_ROW, 1, (
          <>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-2">
                <span className="truncate font-semibold">{en.ui.wizard_project_resources}</span>
                {networkNames !== undefined && <span data-row-count className={BADGE}>{fillUi(en, 'wizard_row_names', { n: networkNames })}</span>}
              </span>
              <span data-network-summary className={`truncate text-xs ${HINT}`}>{networkSummary || en.ui.wizard_project_resources_hint}</span>
            </span>
            {full && <span data-row-full className={BADGE}>{`${plan.projectPicks.length}/${MAX_PICKS_PER_SERVICE}`}</span>}
            <ChevronRight aria-hidden="true" className={`size-4 shrink-0 text-zinc-500 transition-transform ${networkOpen ? 'rotate-90' : ''}`} />
          </>
        ), { expanded: networkOpen })}
        {networkOpen && S.projectPickIndexes(plan, 'network').map((k) => pickRow({ service: null, pick: k }))}
        <li role="none" className="px-2 pt-2 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          {en.ui.wizard_step_services}
        </li>
        {plan.services.flatMap((svc, i) => {
          const open = isExpanded(i);
          const ns = serviceNamespace(svc.purpose);
          const total = result ? result.items.filter((it) => it.level !== 'project' && it.namespace === ns).length : undefined;
          return [
            row(serviceRow(i), 1, (
              <>
                <span aria-hidden="true" data-row-toggle className="-ml-1 inline-flex size-6 shrink-0 items-center justify-center rounded hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  onClick={(e) => { e.stopPropagation(); onExpand(i, !open); }}>
                  <ChevronRight className={`size-4 transition-transform ${open ? 'rotate-90' : ''}`} />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{svc.purpose || <span className={HINT}>{en.ui.wizard_unnamed_service}</span>}</span>
                <span data-row-count className={`shrink-0 text-xs ${HINT}`}>{total === undefined ? '—' : fillUi(en, 'wizard_row_names', { n: total })}</span>
                {svc.picks.length >= MAX_PICKS_PER_SERVICE && <span className={BADGE}>{`${svc.picks.length}/${MAX_PICKS_PER_SERVICE}`}</span>}
              </>
            ), { expanded: open }),
            ...(open ? serviceChildren(i) : []),
          ];
        })}
        {row(EXTRAS_ROW, 1, (
          <>
            <span className="min-w-0 flex-1 truncate font-semibold">{en.ui.wizard_shared_extras}</span>
            <Plus aria-hidden="true" className="size-4 shrink-0 text-zinc-500" />
          </>
        ))}
        {S.projectPickIndexes(plan, 'extras').map((k) => pickRow({ service: null, pick: k }))}
      </ul>
      <button type="button" data-add-service disabled={plan.services.length >= MAX_SERVICES} className={BTN} onClick={onAddService}>
        <Plus aria-hidden="true" className="size-4" />{en.ui.wizard_add_service}
      </button>
    </div>
  );
}
