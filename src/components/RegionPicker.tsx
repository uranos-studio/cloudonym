// ② 의 지역 고르기 (D49 · D50 · 계획 6-2) — 리전 콤보박스(입력 상자 + 걸러진 목록) + 존 select. 둘이 합쳐 폼의 region 문자열 하나를 만든다(오너 결정 Z2).
// 입력 상자는 검색어다 — 목록에서 고를 때(클릭 · Enter)만 값을 바꾸고, Escape · 포커스 이탈은 검색어를 버린다. 그래서 폼의 지역은 늘 core 가 받는 값이다.
// 키보드 — ↓ ↑ 로 목록을 열고 옮긴다 · Enter 로 고른다 · Escape 로 닫는다
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import type { Provider } from '../core/types';
import { composeRegion, displayLabel, filterRegions, regionOptions, splitRegion, zoneAfter, type RegionOption } from './regionOptions';
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
}

const OPTION = 'flex cursor-pointer flex-wrap items-baseline gap-x-1.5 px-3 py-1.5 text-sm text-zinc-800 aria-selected:bg-indigo-50 aria-selected:text-indigo-900 dark:text-zinc-200 dark:aria-selected:bg-indigo-950 dark:aria-selected:text-indigo-100';

export function RegionPicker({ provider, value, onChange, error, labelClass, controlClass }: Props) {
  const options = useMemo(() => regionOptions(provider), [provider]);
  const { region, zone } = splitRegion(value, options);
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
    // 리전을 바꾸면 같은 글자의 존을 잇고, 없으면 none — 고른 리소스는 그대로 두고 존 리소스만 FAIL 로 보인다 (D50)
    onChange(composeRegion(o, o === region ? zone : zoneAfter(zone, o)));
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

  const zones = region?.zones ?? [];
  const errorId = `${base}-error`;
  // 목록은 입력 줄 바로 아래 · 리전 칸과 존 칸을 합친 폭 — 리전 칸만으로는 위치 이름이 잘린다
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
            placeholder={en.ui.region_search_placeholder}
            autoCapitalize="off" autoCorrect="off" spellCheck={false} autoComplete="off"
            onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
            onFocus={(e) => e.currentTarget.select()}
            onClick={() => { if (!open) openAt(); }}
            onBlur={close}
            onKeyDown={onKey}
            className={`${controlClass} font-mono`}
          />
        </div>
        <div className="w-28 shrink-0">
          <label htmlFor="field-zone" className={labelClass}>Zone</label>
          <select id="field-zone" name="zone" data-zone-select value={zone?.zone ?? ''} disabled={zones.length === 0}
            onChange={(e) => region && onChange(composeRegion(region, zones.find((z) => z.zone === e.target.value)))}
            className={`${controlClass} px-2 disabled:opacity-50`}>
            <option value="">{en.ui.zone_none}</option>
            {zones.map((z) => <option key={z.zone} value={z.zone}>{z.zone.slice(z.zone.lastIndexOf('-') + 1)} — {z.code}</option>)}
          </select>
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
          {displayLabel(region.label)} · <code className="font-mono">{zone?.code ?? region.code}</code>
        </p>
      )}
      {zones.length > 0 && !zone && <p data-zone-hint className="mt-1 text-xs text-amber-800 dark:text-amber-300">{en.ui.zone_hint}</p>}
      {error && <p id={errorId} className="mt-1 text-xs text-rose-700 dark:text-rose-300">{error}</p>}
    </div>
  );
}
