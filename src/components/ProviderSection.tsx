// CSP 하나의 결과 카드 묶음 — 제목 · PASS 수 · 카드 격자. 순서는 엔진이 준 순서(규칙 표 순서)
import { ResultCard } from './ResultCard';
import type { NameResult, Provider } from '../core/types';

const PROVIDER_NAME: Record<Provider, string> = { aws: 'Amazon Web Services', gcp: 'Google Cloud', azure: 'Microsoft Azure' };

export function ProviderSection({ provider, names }: { provider: Provider; names: Record<string, NameResult> }) {
  const results = Object.values(names);
  const pass = results.filter((r) => r.valid).length;
  const allPass = pass === results.length;
  return (
    <section aria-labelledby={`provider-${provider}`} data-provider={provider} className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id={`provider-${provider}`} className="text-base font-semibold">{PROVIDER_NAME[provider]}</h3>
        <span
          data-pass-count
          className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
            allPass
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
              : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300'
          }`}
        >
          {pass}/{results.length} PASS
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        {results.map((r) => <ResultCard key={r.ruleId} result={r} />)}
      </div>
    </section>
  );
}
