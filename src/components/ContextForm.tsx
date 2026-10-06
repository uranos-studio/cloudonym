// 다섯 문맥값 입력 — owner · system · purpose 는 텍스트, env · region 은 select(정본 값만). 검증은 하지 않는다 — 오류는 parseContext 가 준 코드를 사전으로 문장으로 만들어 보인다
import type { CoreMessage, Env, NamingContext, Region } from '../core/types';
import { MAX_CONTEXT_CHARS } from '../core/engine';
import { format } from '../messages/catalog';
import { en } from '../messages/en';

type TextKey = 'owner' | 'system' | 'purpose';
const TEXT_FIELDS: ReadonlyArray<{ key: TextKey; label: string; hint: string; placeholder: string }> = [
  { key: 'owner', label: 'Owner', hint: en.ui.field_owner_hint, placeholder: en.ui.field_owner_placeholder },
  { key: 'system', label: 'System', hint: en.ui.field_system_hint, placeholder: en.ui.field_system_placeholder },
  { key: 'purpose', label: 'Purpose', hint: en.ui.field_purpose_hint, placeholder: en.ui.field_purpose_placeholder },
];
const ENVS: ReadonlyArray<{ value: Env; label: string }> = [
  { value: 'prd', label: 'prd — Production' },
  { value: 'stg', label: 'stg — Staging' },
  { value: 'dev', label: 'dev — Development' },
  { value: 'sbx', label: 'sbx — Sandbox' },
];
const REGIONS: ReadonlyArray<{ value: Region; label: string }> = [
  { value: 'kr', label: 'kr — Korea' },
  { value: 'us', label: 'us — United States' },
  { value: 'jp', label: 'jp — Japan' },
  { value: 'eu', label: 'eu — Europe' },
  { value: 'global', label: en.ui.region_global_label },
];

const LABEL = 'block text-sm font-medium text-zinc-800 dark:text-zinc-200';
const HINT = 'ml-1 text-xs font-normal text-zinc-600 dark:text-zinc-400';
const CONTROL =
  'mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-500 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600 ' +
  'aria-invalid:border-rose-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-400 dark:focus-visible:outline-indigo-400';

interface Props {
  value: NamingContext;
  /** parseContext 의 errors — 메시지 코드. field 로 나눠 보인다 */
  errors: CoreMessage[];
  onChange: (next: NamingContext) => void;
}

export function ContextForm({ value, errors, onChange }: Props) {
  const errorFor = (key: TextKey) => {
    const e = errors.find((m) => 'field' in m && m.field === key);
    return e ? format(e, en) : undefined;
  };
  const setText = (key: TextKey, text: string) => {
    const next = { ...value };
    next[key] = text;
    onChange(next);
  };

  return (
    <form aria-labelledby="ctx-title" onSubmit={(e) => e.preventDefault()} className="space-y-4">
      <h2 id="ctx-title" className="text-base font-semibold">
        {en.ui.form_title} <span className={HINT}>{en.ui.form_hint}</span>
      </h2>
      {TEXT_FIELDS.map((f) => {
        const id = `field-${f.key}`;
        const err = errorFor(f.key);
        return (
          <div key={f.key}>
            <label htmlFor={id} className={LABEL}>
              {f.label}<span className={HINT}>{f.hint}</span>
            </label>
            <input
              id={id}
              name={f.key}
              type="text"
              value={value[f.key]}
              onChange={(e) => setText(f.key, e.target.value)}
              maxLength={MAX_CONTEXT_CHARS}
              placeholder={f.placeholder}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={err ? true : undefined}
              aria-describedby={err ? `${id}-error` : undefined}
              className={CONTROL}
            />
            {err && <p id={`${id}-error`} className="mt-1 text-xs text-rose-700 dark:text-rose-300">{err}</p>}
          </div>
        );
      })}
      {/* 옆 열(22rem)과 360px 에서 둘을 나란히 두면 「prd — Production」이 잘린다 — 넓은 한 열(sm~lg)에서만 나란히 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
        <div>
          <label htmlFor="field-env" className={LABEL}>Environment</label>
          {/* 옵션은 정본 값만 — select 값은 항상 Env 다 */}
          <select id="field-env" name="env" value={value.env} onChange={(e) => onChange({ ...value, env: e.target.value as Env })} className={CONTROL}>
            {ENVS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="field-region" className={LABEL}>Region</label>
          <select id="field-region" name="region" value={value.region} onChange={(e) => onChange({ ...value, region: e.target.value as Region })} className={CONTROL}>
            {REGIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>
    </form>
  );
}
