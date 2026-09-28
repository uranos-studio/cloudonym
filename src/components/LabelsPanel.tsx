// 태그 · 라벨 JSON 과 내보내기 — 보이는 provider 만 담는다. 복사 둘: 태그 JSON · Terraform locals (이름 + 태그)
import { CopyButton } from './CopyButton';
import { toTerraformLocals } from './terraform';
import type { GenerateOutput, LabelSet, Provider } from '../core/types';

interface Props {
  providers: Provider[];
  output: GenerateOutput;
  labels: Partial<Record<Provider, LabelSet>>;
}

export function LabelsPanel({ providers, output, labels }: Props) {
  const view: Partial<Record<Provider, Record<string, string>>> = {};
  const picked: GenerateOutput = {};
  const pickedLabels: Partial<Record<Provider, LabelSet>> = {};
  const transformed: string[] = [];
  const violations: string[] = [];
  for (const p of providers) {
    const set = labels[p];
    const names = output[p];
    if (names) picked[p] = names;
    if (!set) continue;
    view[p] = set.labels;
    pickedLabels[p] = set;
    transformed.push(...set.transformed.map((t) => `${p} · ${t}`));
    violations.push(...set.violations.map((v) => `${p} · ${v}`));
  }
  const json = JSON.stringify(view, null, 2);
  const hcl = toTerraformLocals(picked, pickedLabels);
  // 한도를 넘은 값은 CSP 가 거부한다 — Terraform 이 `# INVALID:` 로 바꾸듯 JSON 도 내보내지 않는다 (L3 「무효를 유효로 내지 않는다」)
  const jsonBlocked = violations.length > 0;

  return (
    <section aria-labelledby="labels-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="labels-title" className="text-base font-semibold">Tags · Labels</h2>
        <div className="flex flex-wrap gap-2">
          <CopyButton text={json} label={jsonBlocked ? '한도 위반이 있어 태그 JSON 을 복사할 수 없습니다' : '태그 JSON 복사'} disabled={jsonBlocked} copyKey="tags-json">JSON</CopyButton>
          <CopyButton text={hcl} label="Terraform locals 복사 (이름 + 태그)" copyKey="terraform">Terraform</CopyButton>
        </div>
      </div>
      {jsonBlocked && <p data-json-blocked className="text-xs text-rose-700 dark:text-rose-300">한도 위반이 있어 JSON 복사를 막았습니다 — 아래 위반을 고치세요.</p>}
      <pre data-labels-json className="max-h-72 overflow-auto rounded-md bg-zinc-50 p-3 font-mono text-xs leading-relaxed text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200"><code>{json}</code></pre>
      {transformed.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-800 dark:text-amber-300">
          {transformed.map((t) => <li key={t}>변환 — {t}</li>)}
        </ul>
      )}
      {violations.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-rose-700 dark:text-rose-300">
          {violations.map((v) => <li key={v}>위반 — {v}</li>)}
        </ul>
      )}
    </section>
  );
}
