// 태그 · 라벨 JSON — 고른 CSP 하나만 담는다 (계획 §7-5). 복사: 태그 JSON({ version, labels } · D26).
// Terraform(이름 + 태그)은 ④ Names 의 내보내기 셋에 있다
import { CopyButton } from './CopyButton';
import { labelsJsonBlocked } from './labelsGate';
import type { LabelSet, Provider } from '../core/types';
import { format } from '../messages/catalog';
import { en } from '../messages/en';
import { VERSION } from '../version';

export function LabelsPanel({ provider, labels }: { provider: Provider; labels: LabelSet }) {
  const json = JSON.stringify({ version: VERSION, labels: { [provider]: labels.labels } }, null, 2);
  // 한도를 넘은 값은 CSP 가 거부한다 — Terraform 이 `# INVALID:` 로 바꾸듯 JSON 도 내보내지 않는다 (L3 「무효를 유효로 내지 않는다」)
  const jsonBlocked = labelsJsonBlocked([provider], { [provider]: labels });
  const transformed = labels.transformed.map((t) => `${provider} · ${format(t, en)}`);
  const violations = labels.violations.map((v) => `${provider} · ${format(v, en)}`);

  return (
    <section aria-labelledby="labels-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="labels-title" className="text-base font-semibold">Tags · Labels</h2>
        <CopyButton text={json} label={jsonBlocked ? en.ui.copy_tags_json_blocked_label : en.ui.copy_tags_json_label} disabled={jsonBlocked} copyKey="tags-json">JSON</CopyButton>
      </div>
      {jsonBlocked && <p data-json-blocked className="text-xs text-rose-700 dark:text-rose-300">{en.ui.tags_json_blocked}</p>}
      <pre data-labels-json className="max-h-72 overflow-auto rounded-md bg-zinc-50 p-3 font-mono text-xs leading-relaxed text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200"><code>{json}</code></pre>
      {transformed.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-800 dark:text-amber-300">
          {transformed.map((t) => <li key={t}>{en.ui.label_transformed_prefix} {t}</li>)}
        </ul>
      )}
      {violations.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-rose-700 dark:text-rose-300">
          {violations.map((v) => <li key={v}>{en.ui.label_violation_prefix} {v}</li>)}
        </ul>
      )}
    </section>
  );
}
