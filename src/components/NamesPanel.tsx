// ④ Names — 고른 것만. 범위 경로 머리글 · ResultCard · 충돌 목록 · PASS 수 · 내보내기 셋(Copy all names · JSON · Terraform).
// 결과는 App 이 generateMany 로 만든 것을 그대로 보인다 — 판정은 전부 엔진 값이다. 무효(충돌 포함)는 어느 내보내기에도 유효로 실리지 않는다 (D41)
import type { ManyResult, NameItem } from '../core/engine';
import type { SelectionItem } from '../core/selection';
import { scopePath } from '../core/tree';
import type { LabelSet, NamingContext } from '../core/types';
import { CopyButton } from './CopyButton';
import { ResultCard } from './ResultCard';
import { allNamesText, toNamesExport } from './namesExport';
import { manyEntries, toTerraformLocals } from './terraform';
import { fillUi, format } from '../messages/catalog';
import { en } from '../messages/en';
import { VERSION } from '../version';

interface Props {
  ctx: NamingContext | undefined;
  items: readonly SelectionItem[];
  many: ManyResult | undefined;
  labels: LabelSet | undefined;
}

const EMPTY = 'rounded-lg border border-dashed border-zinc-300 p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400';

/** 범위 경로가 바뀌는 자리마다 묶는다 — 항목 순서는 이미 트리 순서다 */
function groupByScope(many: ManyResult, items: readonly SelectionItem[]): Array<{ path: string; results: NameItem[] }> {
  const ruleOf = new Map(items.map((i) => [i.rule.id, i.rule]));
  const groups: Array<{ path: string; results: NameItem[] }> = [];
  for (const it of many.items) {
    const rule = ruleOf.get(it.ruleId);
    const path = rule ? scopePath(rule).map((s) => s.displayName).join(' › ') : '';
    const last = groups[groups.length - 1];
    if (last && last.path === path) last.results.push(it);
    else groups.push({ path, results: [it] });
  }
  return groups;
}

export function NamesPanel({ ctx, items, many, labels }: Props) {
  const names = many?.items.length ?? 0;
  const pass = many?.items.filter((i) => i.valid).length ?? 0;
  const allPass = names > 0 && pass === names;

  return (
    <section id="names" aria-labelledby="step-names" className="scroll-mt-4 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="step-names" className="text-base font-semibold"><span aria-hidden="true" className="mr-1.5 text-indigo-600 dark:text-indigo-400">4</span>{en.ui.step_names}</h2>
        {many && (
          <span data-names-summary className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
            allPass
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
              : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300'
          }`}>
            {fillUi(en, 'names_summary', { resources: items.length, names, pass })}
          </span>
        )}
      </div>
      <p data-pass-meaning className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{en.ui.pass_meaning}</p>

      {!ctx && <p role="status" data-names-empty className={EMPTY}>{en.ui.empty_state}</p>}
      {ctx && items.length === 0 && <p role="status" data-names-empty className={EMPTY}>{en.ui.names_empty_selection}</p>}
      {ctx && many && <Results ctx={ctx} items={items} many={many} labels={labels} />}
    </section>
  );
}

function Results({ ctx, items, many, labels }: { ctx: NamingContext; items: readonly SelectionItem[]; many: ManyResult; labels: LabelSet | undefined }) {
  const all = allNamesText(many);
  const json = JSON.stringify(toNamesExport(many, ctx, VERSION, items), null, 2);
  const hcl = toTerraformLocals(manyEntries(many), labels ? { [many.provider]: labels } : {}, en, VERSION);
  const groups = groupByScope(many, items);
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={all.text} label={en.ui.copy_all_names_label} disabled={all.text === ''} copyKey="all-names">
          {all.skipped > 0 ? fillUi(en, 'copy_all_names_skipped', { n: all.skipped }) : en.ui.copy_all_names}
        </CopyButton>
        <CopyButton text={json} label={many.items.length > 0 ? en.ui.copy_names_json_label : en.ui.copy_names_json_blocked_label} disabled={many.items.length === 0} copyKey="names-json">JSON</CopyButton>
        <CopyButton text={hcl} label={en.ui.copy_terraform_label} copyKey="terraform">Terraform</CopyButton>
      </div>
      {many.conflicts.length > 0 && (
        <ul data-conflicts className="space-y-1 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
          {many.conflicts.map((c) => { const text = format(c, en); return <li key={text}>{en.ui.conflict_prefix} {text}</li>; })}
        </ul>
      )}
      {groups.map((g, i) => (
        <div key={`${g.path}-${i}`} className="space-y-2">
          <h3 data-scope-path className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">{g.path}</h3>
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {g.results.map((r) => <ResultCard key={r.key} result={r} />)}
          </div>
        </div>
      ))}
    </>
  );
}
