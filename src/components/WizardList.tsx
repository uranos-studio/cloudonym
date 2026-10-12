// 마법사 목록 칸 (D89) — 계획의 줄(project · network · 네트워크 pick · 서비스와 그 pick · extras 와 그 pick)을 트리로 보인다.
// 줄을 누르거나 ↑↓ 로 옮기면 그 줄이 선택되고 가운데 칸에 설정이 열린다. →/← 는 서비스 줄을 펴고 접고, Enter 는 설정 칸 첫 컨트롤로 간다.
// 줄 key 는 경로 + preset/ruleId 다 — tier · kind 를 넣지 않는다(입력 중에 줄이 다시 만들어지지 않게)
import { useEffect, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { MAX_PICKS_PER_SERVICE, MAX_SERVICES, type PlanError, type WizardPlan } from '../core/wizard/plan';
import { serviceNamespace, type ProjectResult } from '../core/engine';
import type { CoreMessage } from '../core/types';
import * as S from './wizardState';
import { EXTRAS_ROW, NETWORK_ROW, PROJECT_ROW, parseRow, rowErrorCount, rowNames, serviceRow, visibleRows, type RowPath } from './wizardSelection';
import { BTN, HINT, STEP_NUM } from './wizardStyles';
import { fillUi } from '../messages/catalog';
import { en } from '../messages/en';

const ROW =
  'group flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none ' +
  'hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-indigo-600 dark:hover:bg-zinc-800 dark:focus-visible:ring-indigo-400 ' +
  'aria-selected:bg-indigo-50 aria-selected:ring-1 aria-selected:ring-indigo-300 dark:aria-selected:bg-indigo-950 dark:aria-selected:ring-indigo-800 ' +
  'data-[flash=true]:bg-amber-50 dark:data-[flash=true]:bg-amber-950';
const BADGE_ERR = 'shrink-0 rounded-full bg-rose-100 px-1.5 text-[11px] font-semibold text-rose-800 dark:bg-rose-950 dark:text-rose-300';
const BADGE = 'shrink-0 rounded-full bg-zinc-100 px-1.5 text-[11px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300';

/** 줄의 DOM — 키보드로 옮긴 뒤 포커스를 준다 */
function rowElement(path: RowPath): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-row-path="${path}"]`);
}

export function WizardList({ plan, envs, selected, onSelect, isExpanded, onExpand, result, errors, serviceErrors, projectCount, flash, onAddService, onEnter }: {
  plan: WizardPlan; envs: readonly string[]; selected: RowPath; onSelect: (path: RowPath) => void;
  isExpanded: (service: number) => boolean; onExpand: (service: number, open: boolean) => void;
  /** 첫 env 의 결과 — 줄 이름(D89). 온전하지 않으면 undefined(줄 이름 —) */
  result: ProjectResult | undefined;
  errors: readonly PlanError[]; serviceErrors: readonly (readonly CoreMessage[])[]; projectCount: number;
  /** 칩으로 막 더한 줄 — 잠깐 강조하고 보이게 굴린다 */
  flash: RowPath | undefined;
  onAddService: () => void; onEnter: () => void;
}) {
  useEffect(() => {
    if (flash) rowElement(flash)?.scrollIntoView({ block: 'nearest' });
  }, [flash]);

  const rows = visibleRows(plan, isExpanded);
  const move = (path: RowPath) => {
    onSelect(path);
    // 선택한 줄이 그려진 뒤 포커스를 옮긴다(펼침 · 접힘으로 줄이 새로 생길 수 있다)
    requestAnimationFrame(() => rowElement(path)?.focus());
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
      if (r?.kind === 'service' && !isExpanded(r.service)) onExpand(r.service, true);
      else if (r?.kind === 'service' && (plan.services[r.service]?.picks.length ?? 0) > 0) move(S.pickPath({ service: r.service, pick: 0 }));
      else return;
    } else if (e.key === 'ArrowLeft') {
      if (r?.kind === 'service' && isExpanded(r.service)) onExpand(r.service, false);
      else if (r?.kind === 'pick' && r.ref.service !== null) move(serviceRow(r.ref.service));
      else if (r?.kind === 'pick') move(plan.projectPicks[r.ref.pick]?.preset === null ? EXTRAS_ROW : NETWORK_ROW);
      else return;
    } else if (e.key === 'Enter') onEnter();
    else return;
    e.preventDefault();
  };

  const count = (path: RowPath) => rowErrorCount(plan, path, errors, serviceErrors, projectCount);
  const row = (path: RowPath, level: 1 | 2, body: ReactNode, extra: { key?: string; expanded?: boolean; pick?: string } = {}) => {
    const n = count(path);
    return (
      <li key={extra.key ?? path} role="treeitem" aria-level={level} aria-selected={path === selected} tabIndex={path === selected ? 0 : -1}
        {...(extra.expanded === undefined ? {} : { 'aria-expanded': extra.expanded })}
        data-row-path={path} {...(extra.pick === undefined ? {} : { 'data-row-pick': extra.pick })} data-flash={flash === path}
        className={`${ROW} ${level === 2 ? 'ml-5' : ''}`} onClick={() => onSelect(path)}>
        {body}
        {n > 0 && <span data-row-errors={n} className={BADGE_ERR} title={fillUi(en, 'wizard_row_errors', { n })}>!{n}</span>}
      </li>
    );
  };
  const pickRow = (ref: S.PickRef) => {
    const pick = ref.service === null ? plan.projectPicks[ref.pick]! : plan.services[ref.service]!.picks[ref.pick]!;
    const path = S.pickPath(ref);
    const { title } = S.pickTitle(pick);
    const names = rowNames(plan, ref, result);
    const text = names ? `${names.first}${names.rest > 0 ? ` +${names.rest}` : ''}` : '—';
    return row(path, 2, (
      <span className="flex min-w-0 flex-1 flex-col">
        <span data-row-title className="truncate font-medium">{title}</span>
        <code data-row-name title={names?.first} className={`truncate font-mono text-xs ${HINT}`}>{text}</code>
      </span>
    ), { key: `${path}-${pick.preset ?? pick.ruleId}`, pick: pick.preset ?? 'custom' });
  };
  const p = plan.project;
  const full = S.projectPicksFull(plan);

  return (
    <div className="space-y-3">
      <h2 id="wizard-list-title" className="sr-only">{en.ui.wizard_list_label}</h2>
      <ul role="tree" aria-labelledby="wizard-list-title" data-wizard-list className="space-y-0.5" onKeyDown={onKeyDown}>
        {row(PROJECT_ROW, 1, (
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-semibold"><span aria-hidden="true" className={STEP_NUM}>1</span>{en.ui.wizard_step_project}</span>
            <span className={`truncate text-xs ${HINT}`}>{[p.owner, p.system, envs.join(', '), p.region].filter((x) => x !== '').join(' · ')}</span>
          </span>
        ))}
        {row(NETWORK_ROW, 1, (
          <>
            <span className="min-w-0 flex-1 truncate font-semibold"><span aria-hidden="true" className={STEP_NUM}>2</span>{en.ui.wizard_project_resources}</span>
            {full && <span data-row-full className={BADGE}>{`${plan.projectPicks.length}/${MAX_PICKS_PER_SERVICE}`}</span>}
            <Plus aria-hidden="true" className="size-4 shrink-0 text-zinc-500" />
          </>
        ))}
        {S.projectPickIndexes(plan, 'network').map((k) => pickRow({ service: null, pick: k }))}
        <li role="none" className="px-2 pt-2 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          <span aria-hidden="true" className={STEP_NUM}>3</span>{en.ui.wizard_step_services}
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
            ...(open ? svc.picks.map((_, j) => pickRow({ service: i, pick: j })) : []),
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
