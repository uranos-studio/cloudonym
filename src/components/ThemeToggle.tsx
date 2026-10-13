// 화면 모드 고르기 (D94) — 머리의 라디오 묶음 셋(Light · Dark · System). 화살표 키로 옮기면서 바로 고른다(WAI-ARIA radio group)
import { useRef, type KeyboardEvent } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { THEME_MODES, setMode, useThemeMode, type ThemeMode } from './theme';
import { en } from '../messages/en';

const ICON = { light: Sun, dark: Moon, system: Monitor } as const;
const LABEL: Record<ThemeMode, string> = { light: en.ui.theme_light, dark: en.ui.theme_dark, system: en.ui.theme_system };

export function ThemeToggle() {
  const mode = useThemeMode();
  const refs = useRef<Partial<Record<ThemeMode, HTMLButtonElement | null>>>({});
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const at = THEME_MODES.indexOf(mode);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const next = THEME_MODES[(at + step + THEME_MODES.length) % THEME_MODES.length]!;
    setMode(next);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={en.ui.theme_label} data-theme-toggle className="inline-flex items-center rounded-md border border-zinc-300 bg-white p-0.5 dark:border-zinc-700 dark:bg-zinc-900">
      {THEME_MODES.map((m) => {
        const Icon = ICON[m];
        return (
          <button key={m} ref={(el) => { refs.current[m] = el; }} type="button" role="radio" aria-checked={mode === m} aria-label={LABEL[m]} title={LABEL[m]} data-theme-mode={m}
            tabIndex={mode === m ? 0 : -1} onKeyDown={onKey} onClick={() => setMode(m)}
            className="inline-flex size-7 items-center justify-center rounded text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 aria-checked:bg-indigo-600 aria-checked:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 dark:aria-checked:bg-indigo-500 dark:aria-checked:text-white">
            <Icon aria-hidden="true" className="size-4" />
          </button>
        );
      })}
    </div>
  );
}
