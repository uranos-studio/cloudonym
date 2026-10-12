// 마법사 이름 칸 (D89) — ⑦ 이름 · 요약 배지 · Copy all · JSON · Terraform · 충돌 · env/이름공간 묶음. 넓은 화면에서는 자체 스크롤 칸이다.
// 프로젝트 이름(D85)은 Project 묶음 맨 위의 표시 전용 카드다 — 수 · 내보내기에 들지 않는다(화면 이름 = POST /v1/wizard)
import { useMemo, type ReactNode } from 'react';
import { serviceNamespace as serviceNamespaceOf, type NameItem, type ProjectResult } from '../core/engine';
import { expandPlan, type PlanError, type WizardPlan } from '../core/wizard/plan';
import type { Env, NameResult } from '../core/types';
import { CopyButton } from './CopyButton';
import { ResultCard } from './ResultCard';
import { allNamesText } from './namesExport';
import { wizardLabels, wizardTerraform, wizardTerraformByEnv } from './wizardTerraform';
import { toWizardExport, toWizardExportByEnv } from './wizardExport';
import { namesSummary, withEnv } from './wizardEnvs';
import { ErrorList } from './WizardSettings';
import { ENV_NAMES, STEP_NUM } from './wizardStyles';
import { fillUi, format } from '../messages/catalog';
import { en } from '../messages/en';
import { VERSION } from '../version';

/** env 하나의 결과 — 같은 계획을 그 env 로 돌린 것 (D82) */
export interface EnvResult { env: Env; result: ProjectResult }

// ── ⑦ 이름 ──
export function WizardNames({ plan, results, errors, projectContext, projectNames }: {
  plan: WizardPlan; results: EnvResult[] | undefined; errors: PlanError[]; projectContext: Parameters<typeof toWizardExport>[1] | undefined;
  /** env 마다 프로젝트 이름 (D85) — 항목이 아니라 표시 전용 카드 */
  projectNames: readonly (NameResult | undefined)[];
}) {
  const empty = errors.some((e) => e.code === 'wizard.empty');
  const wide = errors.filter((e) => e.path === undefined && e.code !== 'wizard.empty' && !('field' in e));
  const { names, pass } = namesSummary(results);
  const ok = results !== undefined && projectContext !== undefined;
  return (
    <section id="names" aria-labelledby="wizard-names" className="space-y-4">
      {/* 머리(제목 · 요약 · 내보내기)는 이름 칸 위에 붙어 있다 — 이름이 길어 칸을 굴려도 Copy all · JSON · Terraform 이 보인다.
          칸의 안쪽 여백(p-4)을 음수 여백 · top -1rem 으로 덮어 칸 위 끝에 딱 붙는다(sticky 의 기준은 여백 안쪽이다). 배경이 있어야 아래로 지나가는 카드가 비치지 않는다 */}
      <div data-names-head className="sticky -top-4 z-10 -mx-4 -mt-4 space-y-2 rounded-t-xl border-b border-zinc-200 bg-white px-4 pb-3 pt-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="wizard-names" className="text-base font-semibold"><span aria-hidden="true" className={STEP_NUM}>7</span>{en.ui.wizard_step_names}</h2>
          {results && (
            <span data-names-summary className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${pass === names
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
              : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300'}`}>
              {fillUi(en, 'wizard_names_summary', { names, pass })}
            </span>
          )}
        </div>
        {ok && <ExportButtons plan={plan} results={results} projectContext={projectContext} />}
      </div>
      <p data-pass-meaning className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{en.ui.pass_meaning}</p>
      {!results && (
        <p role="status" data-names-empty className="rounded-lg border border-dashed border-zinc-300 p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          {empty ? en.ui.wizard_names_empty : en.ui.wizard_fix_errors}
        </p>
      )}
      <ErrorList errors={wide} />
      {ok && <ResultList plan={plan} results={results} projectNames={projectNames} />}
    </section>
  );
}

/** Copy all · JSON · Terraform — env 하나면 예전 꼴 그대로, 여럿이면 env 로 한 단계 더 묶는다 (D82) */
function ExportButtons({ plan, results, projectContext }: { plan: WizardPlan; results: EnvResult[]; projectContext: Parameters<typeof toWizardExport>[1] }) {
  const multi = results.length > 1;
  const all = useMemo(() => {
    const parts = results.map((r) => allNamesText(r.result));
    return { text: parts.map((x) => x.text).filter((t) => t !== '').join('\n'), skipped: parts.reduce((n, x) => n + x.skipped, 0) };
  }, [results]);
  const json = useMemo(() => JSON.stringify(multi
    ? toWizardExportByEnv(results.map((r) => ({ env: r.env, result: r.result, project: { ...projectContext, env: r.env }, plan: withEnv(plan, r.env) })), VERSION)
    : toWizardExport(results[0]!.result, projectContext, plan, VERSION), null, 2), [multi, results, projectContext, plan]);
  const hcl = useMemo(() => (multi
    ? wizardTerraformByEnv(results.map((r) => ({ env: r.env, result: r.result, labels: wizardLabels(expandPlan(withEnv(plan, r.env)), 'gcp') })), VERSION, en)
    : wizardTerraform(results[0]!.result, wizardLabels(expandPlan(plan), 'gcp'), VERSION, en)), [multi, results, plan]);
  return (
    <div className="flex flex-wrap gap-2">
      <CopyButton text={all.text} label={en.ui.copy_all_names_label} disabled={all.text === ''} copyKey="all-names">
        {all.skipped > 0 ? fillUi(en, 'copy_all_names_skipped', { n: all.skipped }) : en.ui.copy_all_names}
      </CopyButton>
      <CopyButton text={json} label={en.ui.copy_names_json_label} copyKey="names-json">JSON</CopyButton>
      <CopyButton text={hcl} label={en.ui.copy_terraform_label} copyKey="terraform">Terraform</CopyButton>
    </div>
  );
}

function ResultList({ plan, results, projectNames }: { plan: WizardPlan; results: EnvResult[]; projectNames: readonly (NameResult | undefined)[] }) {
  return results.length > 1
    ? (
      <>
        {results.map((r, i) => (
          <section key={r.env} data-names-env={r.env} aria-labelledby={`names-env-${r.env}`} className="space-y-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <h3 id={`names-env-${r.env}`} className="text-sm font-semibold">{fillUi(en, 'wizard_group_env', { env: r.env, name: ENV_NAMES[r.env] })}</h3>
            <EnvNames plan={plan} result={r.result} scope={r.env} projectName={projectNames[i]} />
          </section>
        ))}
      </>
    )
    : <EnvNames plan={plan} result={results[0]!.result} projectName={projectNames[0]} />;
}

/** env 하나의 이름 — 충돌 · 이름공간 묶음(프로젝트 → 서비스, 모델 순서). scope 는 env 가 여럿일 때 카드 id · 복사 키를 구분한다 */
function EnvNames({ plan, result, scope, projectName }: { plan: WizardPlan; result: ProjectResult; scope?: string; projectName: NameResult | undefined }) {
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
            {g.ns === 'project' && projectName && <ProjectNameCard name={projectName} />}
            {g.items.map((r) => (
              <Indented key={r.key} child={r.parent !== undefined}>
                <ResultCard result={r} parentName={r.parent === undefined ? undefined : byKey.get(r.parent)?.name} {...(scope === undefined ? {} : { scope })} />
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

/** 프로젝트 이름 카드 (D85 · D89) — 항목이 아니다: 수 · 내보내기 · 충돌에 들지 않고 「not exported」 배지를 단다. article 이 아니라 이름 목록 시험(article[data-key])에도 들지 않는다 */
function ProjectNameCard({ name }: { name: NameResult }) {
  return (
    <div data-project-name-card data-valid={name.valid} className="flex flex-col gap-2 rounded-lg border border-dashed border-zinc-300 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">{en.ui.wizard_project_name}</p>
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{en.ui.wizard_not_exported}</span>
      </div>
      <div className="flex items-center justify-between gap-2 rounded-md bg-zinc-50 px-2.5 py-2 dark:bg-zinc-950">
        <code data-project-name-value className="min-w-0 break-all font-mono text-sm text-zinc-900 dark:text-zinc-100">{name.name || '—'}</code>
        <CopyButton text={name.name} label={name.valid ? fillUi(en, 'copy_name_label', { displayName: en.ui.wizard_project_name }) : en.ui.copy_invalid_label} disabled={!name.valid} copyKey="project-name" />
      </div>
    </div>
  );
}

