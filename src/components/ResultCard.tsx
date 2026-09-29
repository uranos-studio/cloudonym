// 카드 하나 — 이름 · PASS/FAIL · 축약/변환 안내(steps) · 위반 이유 · 규칙(물리 · 생성 · note · 공식 문서). 판정은 전부 엔진 값이다
import { CircleCheck, CircleX, ExternalLink, Info, TriangleAlert } from 'lucide-react';
import { CopyButton } from './CopyButton';
import { visibleSteps } from './steps';
import type { NameResult } from '../core/types';
import { format } from '../messages/catalog';
import { en } from '../messages/en';

const CARD =
  'flex flex-col gap-2 rounded-lg border bg-white p-3 shadow-xs dark:bg-zinc-900 ' +
  'data-[valid=false]:border-rose-300 border-zinc-200 dark:border-zinc-800 dark:data-[valid=false]:border-rose-900';

export function ResultCard({ result: r }: { result: NameResult }) {
  const id = `card-${r.ruleId.replace('.', '-')}`;
  const stepsText = visibleSteps(r.steps).map((m) => format(m, en)).join(' · ');
  // aria-invalid 는 폼 위젯 역할에만 허용된다 — 카드는 data-valid 로 상태를 들고 PASS/FAIL 글자가 뜻을 전한다
  return (
    <article data-rule={r.ruleId} data-valid={r.valid} aria-labelledby={`${id}-title`} className={CARD}>
      <div className="flex items-start justify-between gap-2">
        <h4 id={`${id}-title`} className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">{r.displayName}</h4>
        {r.valid
          ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400"><CircleCheck aria-hidden="true" className="size-3.5" />PASS</span>
          : <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 dark:text-rose-400"><CircleX aria-hidden="true" className="size-3.5" />FAIL</span>}
      </div>

      <div className="flex items-center justify-between gap-2 rounded-md bg-zinc-50 px-2.5 py-2 dark:bg-zinc-950">
        <code data-name className="min-w-0 break-all font-mono text-sm text-zinc-900 dark:text-zinc-100">{r.name || '—'}</code>
        {/* 무효한 이름은 복사할 수 없다 — 「유효하지 않은 이름을 유효로」 내보내지 않는다 (L3) */}
        <CopyButton text={r.name} label={r.valid ? `${r.displayName} 이름 복사` : '유효하지 않은 이름은 복사할 수 없습니다'} disabled={!r.valid} copyKey={`name:${r.ruleId}`} />
      </div>

      {stepsText && (
        <p data-steps className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
          {r.isTruncated ? <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /> : <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />}
          <span>{r.isTruncated ? '축약' : '변환'} — {stepsText}{r.isTruncated && ` (원래 ${r.original.length}자)`}</span>
        </p>
      )}
      {!r.valid && (
        <ul data-violations className="list-disc space-y-0.5 pl-5 text-xs text-rose-700 dark:text-rose-300">
          {r.violations.map((v) => format(v, en)).map((v) => <li key={v}>{v}</li>)}
        </ul>
      )}

      <footer className="mt-auto border-t border-zinc-100 pt-2 text-[11px] leading-relaxed text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        <p>
          길이 {r.rule.minLength}–{r.rule.maxLength} · 생성 문자 <code className="font-mono">{r.rule.allowed}</code>
          {' · '}
          <a href={r.rule.docUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-indigo-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:text-indigo-300">
            공식 문서<ExternalLink aria-hidden="true" className="size-3" />
          </a>
        </p>
        <p className="break-all">검증 <code className="font-mono">/{r.rule.pattern}/{r.rule.patternFlags}</code></p>
        {r.rule.notes.length > 0 && <p className="mt-1">{r.rule.notes.map((m) => format(m, en)).join(' · ')}</p>}
      </footer>
    </article>
  );
}
