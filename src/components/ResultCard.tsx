// 카드 하나 — 이름 · PASS/FAIL · 축약/변환 안내(steps) · 위반 이유 · 권고 경고(warnings) · 규칙(물리 · 생성 · note · 공식 문서). 판정은 전부 엔진 값이다.
// 제목에 종류 토큰 · 순번 · 역할을 붙이고(`Virtual Machine (Linux) · 01` · `IP Address · int · 01`) data-key 로 항목을 가리킨다
import { useState } from 'react';
import { CircleCheck, CircleX, ExternalLink, Info, TriangleAlert } from 'lucide-react';
import { CopyButton } from './CopyButton';
import { checkBucketName, type Availability } from './availability';
import { visibleSteps } from './steps';
import type { NameItem } from '../core/engine';
import type { NameResult } from '../core/types';
import { rowOf } from '../core/catalog';
import { fillUi, format, formatNotes } from '../messages/catalog';
import { en } from '../messages/en';

const CARD =
  'flex flex-col gap-2 rounded-lg border bg-white p-3 shadow-xs dark:bg-zinc-900 ' +
  'data-[valid=false]:border-rose-300 border-zinc-200 dark:border-zinc-800 dark:data-[valid=false]:border-rose-900';

const COMPACT =
  'flex flex-col gap-1 border-b border-zinc-100 py-2 last:border-b-0 dark:border-zinc-800 ' +
  'data-[valid=false]:rounded-md data-[valid=false]:border data-[valid=false]:border-rose-300 data-[valid=false]:px-2 dark:data-[valid=false]:border-rose-900';

/** parentName — 마법사의 딸린 이름이면 부모의 이름(카드에 「attached to」 한 줄).
 *  scope — 한 화면에 같은 key 의 카드가 여럿일 때(마법사의 환경 여럿 · D82) id · 복사 키를 가르는 접두.
 *  compact — 마법사의 이름 칸(D93): 제목 · PASS 한 줄 + 이름 · 복사 한 줄. 규칙(길이 · 문자 · 공식 문서 · 정규식)은 접힌 칸 안이다. 판정 · 위반 · 축약 안내는 늘 보인다 */
export function ResultCard({ result: r, parentName, scope, compact = false }: { result: NameResult | NameItem; parentName?: string; scope?: string; compact?: boolean }) {
  const item = 'key' in r ? r : undefined;
  /** compact 의 규칙 펼침 — 화면 상태 */
  const [ruleOpen, setRuleOpen] = useState(false);
  const key = item?.key ?? r.resourceType;
  const scoped = scope === undefined ? key : `${scope}/${key}`;
  const id = `card-${r.ruleId.replace('.', '-')}-${scoped}`;
  // 제목 — 이름(catalog 행 이름 — 트리 행과 같다. 행이 없으면 규칙 이름) · 종류 토큰(붙었을 때만 · D52) · 순번 또는 역할
  // 마법사 항목은 용도 토큰(tier) · 딸린 것의 종류(attach)도 붙인다 — `VM Instance · web · 01` · `Persistent Disk · data · 01`
  const title = [rowOf(r.ruleId)?.displayName ?? r.displayName, item?.kindToken, item?.tier, item?.attach, item?.seq ?? item?.role].filter((x) => x !== undefined).join(' · ');
  const stepsText = visibleSteps(r.steps).map((m) => format(m, en)).join(' · ');
  const verdict = r.valid
    ? <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400"><CircleCheck aria-hidden="true" className="size-3.5" />PASS</span>
    : <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-rose-700 dark:text-rose-400"><CircleX aria-hidden="true" className="size-3.5" />FAIL</span>;
  const copy = <CopyButton text={r.name} label={r.valid ? fillUi(en, 'copy_name_label', { displayName: title }) : en.ui.copy_invalid_label} disabled={!r.valid} copyKey={`name:${scoped}`} />;
  const steps = stepsText && (
    <p data-steps className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
      {r.isTruncated ? <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /> : <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />}
      <span>{r.isTruncated ? en.ui.shortened : en.ui.transformed} — {stepsText}{r.isTruncated && ` ${fillUi(en, 'originally_chars', { n: r.original.length })}`}</span>
    </p>
  );
  const violations = !r.valid && (
    <ul data-violations className="list-disc space-y-0.5 pl-5 text-xs text-rose-700 dark:text-rose-300">
      {r.violations.map((v) => format(v, en)).map((v) => <li key={v}>{v}</li>)}
    </ul>
  );
  // 권고 경고 (D112) — 위반이 아니다. PASS 는 그대로이고 문서가 권고하지 않는 꼴이라는 안내만 따로 보인다
  const warnings = r.warnings !== undefined && r.warnings.length > 0 && (
    <div data-warnings className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <div>
        <p className="font-medium">{en.ui.name_warnings}</p>
        <ul className="list-disc space-y-0.5 pl-4">
          {r.warnings.map((w) => format(w, en)).map((w) => <li key={w}>{w}</li>)}
        </ul>
      </div>
    </div>
  );
  const rule = (
    <>
      <p>
        {fillUi(en, 'length_range', { min: r.rule.minLength, max: r.rule.maxLength })} · {en.ui.generation_charset} <code className="font-mono">{r.rule.allowed}</code>
        {' · '}
        <a href={r.rule.docUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-indigo-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:text-indigo-300">
          {en.ui.official_doc}<ExternalLink aria-hidden="true" className="size-3" />
        </a>
      </p>
      <p className="break-all">{en.ui.validation} <code className="font-mono">/{r.rule.pattern}/{r.rule.patternFlags}</code></p>
      {r.rule.notes.length > 0 && <p className="mt-1">{formatNotes(r.rule.notes, en)}</p>}
    </>
  );
  if (compact) {
    const ruleId = `${id}-rule`;
    return (
      <article data-rule={r.ruleId} data-key={key} data-valid={r.valid} data-compact aria-labelledby={`${id}-title`} className={COMPACT}>
        <div className="flex items-center justify-between gap-2">
          <h4 id={`${id}-title`} className="min-w-0 truncate text-xs text-zinc-600 dark:text-zinc-400">{title}</h4>
          {verdict}
        </div>
        <div className="flex items-start justify-between gap-2">
          <code data-name className="min-w-0 break-all pt-0.5 font-mono text-sm text-zinc-900 dark:text-zinc-100">{r.name || '—'}</code>
          <span className="flex shrink-0 items-center gap-1">
            {copy}
            <button type="button" data-rule-toggle aria-expanded={ruleOpen} aria-controls={ruleId} aria-label={fillUi(en, 'rule_details_label', { displayName: title })} title={fillUi(en, 'rule_details_label', { displayName: title })}
              className="inline-flex size-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 aria-expanded:bg-zinc-100 aria-expanded:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 dark:aria-expanded:bg-zinc-800 dark:aria-expanded:text-zinc-100"
              onClick={() => setRuleOpen((o) => !o)}>
              <Info aria-hidden="true" className="size-4" />
            </button>
          </span>
        </div>
        {r.valid && r.ruleId === BUCKET_RULE && <BucketCheck key={r.name} name={r.name} />}
        {steps}
        {violations}
        {warnings}
        {/* 규칙 — 펼칠 때만 보인다(hidden). 글자는 DOM 에 남아 「attached to」 · 문서 링크를 찾을 수 있다 */}
        <div id={ruleId} data-rule-details hidden={!ruleOpen} className="space-y-0.5 rounded-md bg-zinc-50 px-2 py-1.5 text-[11px] leading-relaxed text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
          {item?.parent !== undefined && (
            <p data-parent={item.parent}>{en.ui.wizard_attached_to} <code className="break-all font-mono">{parentName || item.parent}</code></p>
          )}
          {rule}
        </div>
      </article>
    );
  }
  // aria-invalid 는 폼 위젯 역할에만 허용된다 — 카드는 data-valid 로 상태를 들고 PASS/FAIL 글자가 뜻을 전한다
  return (
    <article data-rule={r.ruleId} data-key={key} data-valid={r.valid} aria-labelledby={`${id}-title`} className={CARD}>
      <div className="flex items-start justify-between gap-2">
        <h4 id={`${id}-title`} className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">{title}</h4>
        {verdict}
      </div>

      {item?.parent !== undefined && (
        <p data-parent={item.parent} className="text-[11px] text-zinc-600 dark:text-zinc-400">{en.ui.wizard_attached_to} <code className="break-all font-mono">{parentName || item.parent}</code></p>
      )}
      <div className="flex items-center justify-between gap-2 rounded-md bg-zinc-50 px-2.5 py-2 dark:bg-zinc-950">
        <code data-name className="min-w-0 break-all font-mono text-sm text-zinc-900 dark:text-zinc-100">{r.name || '—'}</code>
        {/* 무효한 이름은 복사할 수 없다 — 「유효하지 않은 이름을 유효로」 내보내지 않는다 */}
        {copy}
      </div>

      {/* key — 이름이 바뀌면 판정을 버리고 새로 시작한다(A → B → A 에서 옛 판정 · 늦게 온 옛 응답이 보이지 않게) */}
      {r.valid && r.ruleId === BUCKET_RULE && <BucketCheck key={r.name} name={r.name} />}
      {steps}
      {violations}
      {warnings}

      <footer className="mt-auto border-t border-zinc-100 pt-2 text-[11px] leading-relaxed text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        {rule}
      </footer>
    </article>
  );
}

const BUCKET_RULE = 'gcp.storage_bucket';
const CHECK_BTN =
  'inline-flex min-h-8 items-center rounded-md border border-zinc-300 bg-white px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ' +
  'dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800';
const VERDICT: Record<Availability, { text: string; className: string }> = {
  available: { text: en.ui.bucket_available, className: 'text-emerald-700 dark:text-emerald-400' },
  taken: { text: en.ui.bucket_taken, className: 'text-rose-700 dark:text-rose-300' },
  unknown: { text: en.ui.bucket_unknown, className: 'text-amber-800 dark:text-amber-300' },
};

/** 버킷 이름의 「Check」 (D83) — 누를 때만 브라우저가 Cloud Storage 에 직접 묻는다. 부르는 쪽이 key={name} 으로 이름마다 새로 만든다 —
 *  이름이 바뀌면 이 상태 · 진행 중인 요청의 결과는 버려진 인스턴스에 남는다. 조회 중에는 단추가 꺼져 요청이 겹치지 않는다 */
function BucketCheck({ name }: { name: string }) {
  const [current, setCurrent] = useState<Availability | 'checking' | undefined>(undefined);
  const onCheck = () => {
    setCurrent('checking');
    void checkBucketName(name).then(setCurrent);
  };
  return (
    <div data-bucket-check className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <button type="button" data-check-bucket onClick={onCheck} disabled={current === 'checking'} aria-label={en.ui.bucket_check_label} title={en.ui.bucket_check_label} className={CHECK_BTN}>
        {current === 'checking' ? en.ui.bucket_checking : en.ui.bucket_check}
      </button>
      <span role="status" aria-live="polite" data-bucket-verdict={current === undefined || current === 'checking' ? '' : current}
        className={current === undefined || current === 'checking' ? 'text-zinc-600 dark:text-zinc-400' : VERDICT[current].className}>
        {current === undefined || current === 'checking' ? en.ui.bucket_check_note : VERDICT[current].text}
      </span>
    </div>
  );
}
