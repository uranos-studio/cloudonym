// 복사 버튼 — 결과(복사됨 · 불가 · 거부)를 role=status 로 알린다. 복사가 되면 ui_copy 비콘(target 만)을 보낸다. 실패 문구는 눈에 보이게, 성공은 아이콘 + 스크린리더로
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyText, COPY_MESSAGE, type CopyResult } from './clipboard';
import { copyTarget, sendBeacon } from './beacon';

interface Props {
  text: string;
  /** 접근성 이름 · 툴팁 — 「Service Account 이름 복사」처럼 무엇을 복사하는지 */
  label: string;
  disabled?: boolean;
  /** 화면 시험이 잡는 안정 속성 (data-copy) · ui_copy 비콘의 target 이 여기서 나온다 (D56) */
  copyKey?: string;
  children?: ReactNode;
}

const BUTTON =
  'inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 ' +
  'hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ' +
  'dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus-visible:outline-indigo-400';

export function CopyButton({ text, label, disabled = false, copyKey, children }: Props) {
  const [state, setState] = useState<CopyResult | 'idle'>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onClick = async () => {
    const result = await copyText(text);
    // 복사가 된 것만 센다 — 거부 · 불가는 복사가 아니다
    const target = copyTarget(copyKey);
    if (result === 'copied' && target) sendBeacon('ui_copy', { target });
    setState(result);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), result === 'copied' ? 2000 : 6000);
  };
  const failed = state === 'unavailable' || state === 'failed';

  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} data-copy={copyKey} className={BUTTON}>
        {state === 'copied'
          ? <Check aria-hidden="true" className="size-4 text-emerald-600 dark:text-emerald-400" />
          : <Copy aria-hidden="true" className="size-4" />}
        {children}
      </button>
      <span role="status" aria-live="polite" className={failed ? 'text-xs text-rose-700 dark:text-rose-300' : 'sr-only'}>
        {state === 'idle' ? '' : COPY_MESSAGE[state]}
      </span>
    </span>
  );
}
