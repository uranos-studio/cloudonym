// ② 의 지역 고르기 (D49 · D50 revised) — 리전 콤보박스(입력 상자 + 걸러진 목록). 존 이름 · 존 코드로도 찾고, 고르면 그 리전이 된다 — 존은 이름에 들지 않는다.
// 입력 상자는 검색어다 — 목록에서 고를 때(클릭 · Enter)만 값을 바꾸고, Escape · 포커스 이탈은 검색어를 버린다. 그래서 폼의 지역은 늘 core 가 받는 값이다.
// 키보드 — ↓ ↑ 로 목록을 열고 옮긴다 · Enter 로 고른다 · Escape 로 닫는다
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import type { Provider } from '../core/types';
import { displayLabel, filterRegions, regionOptions, splitRegion, type RegionOption } from './regionOptions';
import { en } from '../messages/en';

interface Props {
  provider: Provider;
  /** 폼의 지역 문자열 — 리전 · 존의 이름 또는 코드 */
  value: string;
  onChange: (next: string) => void;
  /** parseContext 가 region 에 준 오류 문장 — 링크로 연 값이 아니면 생기지 않는다 */
  error?: string;
  labelClass: string;
  controlClass: string;
  /** 빈 칸에 보일 글 — 없으면 검색 안내. 마법사는 예시 리전을 여기에만 보인다 (D97) */
  placeholder?: string;
  /** 포커스를 잃을 때 — 마법사가 「건드린 칸」으로 센다 (D97) */
  onBlur?: () => void;
}

const OPTION = 'flex cursor-pointer flex-wrap items-baseline gap-x-1.5 px-3 py-1.5 text-sm text-zinc-800 aria-selected:bg-indigo-50 aria-selected:text-indigo-900 dark:text-zinc-200 dark:aria-selected:bg-indigo-950 dark:aria-selected:text-indigo-100';

export function RegionPicker({ provider, value, onChange, error, labelClass, controlClass, placeholder, onBlur }: Props) {
  const options = useMemo(() => regionOptions(provider), [provider]);
  const { region } = splitRegion(value, options);
  // 검색어 — undefined 면 검색 중이 아니고 상자는 고른 리전 이름을 보인다
  const [query, setQuery] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const shown = useMemo(() => filterRegions(options, query ?? ''), [options, query]);
  const base = useId();
  const listId = `${base}-list`;
  const optionId = (i: number) => `${base}-opt-${i}`;

  // 움직인 항목이 목록 밖이면 보이게 — 목록 안에서만 스크롤한다. 열림 · 움직인 항목이 바뀔 때만 돈다
  const activeId = optionId(active);
  useEffect(() => {
    if (open) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeId]);

  const close = () => {
    setQuery(undefined);
    setOpen(false);
  };
  const pick = (o: RegionOption) => {
    onChange(o.value);
    close();
  };
  const openAt = () => {
    setOpen(true);
    setActive(Math.max(0, shown.findIndex((o) => o === region)));
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return openAt();
      if (shown.length === 0) return;
      setActive((i) => (e.key === 'ArrowDown' ? Math.min(i + 1, shown.length - 1) : Math.max(i - 1, 0)));
    } else if (e.key === 'Enter') {
      const o = open ? shown[active] : undefined;
      if (o) { e.preventDefault(); pick(o); }
    } else if (e.key === 'Escape') {
      if (open || query !== undefined) { e.preventDefault(); close(); }
    }
  };

  const errorId = `${base}-error`;
  // 목록은 입력 줄 바로 아래 · 입력 칸과 같은 폭
  return (
    <div>
      <div className="relative flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor="field-region" className={labelClass}>Region</label>
          <input
            id="field-region" name="region" type="text" data-region-input
            role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
            aria-activedescendant={open && shown[active] ? optionId(active) : undefined}
            aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
            value={query ?? region?.value ?? value}
            placeholder={placeholder ?? en.ui.region_search_placeholder}
            autoCapitalize="off" autoCorrect="off" spellCheck={false} autoComplete="off"
            onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
            onFocus={(e) => e.currentTarget.select()}
            onClick={() => { if (!open) openAt(); }}
            onBlur={() => { close(); onBlur?.(); }}
            onKeyDown={onKey}
            className={`${controlClass} font-mono`}
          />
        </div>
        <ul id={listId} role="listbox" aria-label={en.ui.region_options_label} hidden={!open}
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-zinc-300 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-950">
          {shown.length === 0
            ? <li role="presentation" data-region-empty className="px-3 py-2 text-sm text-zinc-600 dark:text-zinc-400">{en.ui.region_no_match}</li>
            : shown.map((o, i) => (
              <li key={o.value} id={optionId(i)} role="option" aria-selected={i === active} data-region-option={o.value}
                onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(o)} className={OPTION}>
                <code className="font-mono">{o.value}</code>
                <span className="text-zinc-600 dark:text-zinc-400">— {o.label ? displayLabel(o.label) : en.ui.region_global_label}</span>
                {o.code && <span className="text-zinc-600 dark:text-zinc-400">· <code className="font-mono">{o.code}</code></span>}
              </li>
            ))}
        </ul>
      </div>
      {region && region.value !== 'global' && (
        <p data-region-summary className="mt-1 truncate text-xs text-zinc-600 dark:text-zinc-400">
          {displayLabel(region.label)} · <code className="font-mono">{region.code}</code>
        </p>
      )}
      {error && <p id={errorId} className="mt-1 text-xs text-rose-700 dark:text-rose-300">{error}</p>}
    </div>
  );
}
