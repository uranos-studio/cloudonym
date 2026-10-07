// ① Cloud — AWS · GCP · Azure 중 하나 (D42). 첫 방문은 아무것도 고르지 않는다 — 숨은 기본값을 두지 않는다.
// 라디오 그룹 — 「수동 선택」 꼴: 방향키는 포커스만 옮기고 Space · Enter(버튼의 click)로 고른다. 바꾸기 전 확인은 App 몫.
// CSP 전환은 선택을 지우는 동작이라 방향키마다 고르면 누를 때마다 확인 창이 뜨고, 취소해도 포커스만 옮겨 aria-checked 와 어긋난다.
// WAI-ARIA APG 의 radio group 은 툴바 안에서 이 꼴(방향키는 포커스만 · Space 로 체크)을 정해 둔다. 탭 순서(tabIndex 0)는 체크된 라디오가 받는다
import { useRef, type KeyboardEvent } from 'react';
import { PROVIDERS, type Provider } from '../core/types';
import { en } from '../messages/en';
import { providerName } from './providerName';

const SHORT: Record<Provider, string> = { aws: 'AWS', gcp: 'GCP', azure: 'Azure' };

const BUTTON =
  'flex-1 rounded-md border px-4 py-2 text-sm font-semibold sm:flex-none sm:min-w-24 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:focus-visible:outline-indigo-400 ' +
  'aria-checked:border-indigo-600 aria-checked:bg-indigo-600 aria-checked:text-white dark:aria-checked:border-indigo-500 dark:aria-checked:bg-indigo-500 ' +
  'border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800';

export function CloudPicker({ value, onPick }: { value: Provider | undefined; onPick: (p: Provider) => void }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const moves: Record<string, number> = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: PROVIDERS.length - 1 };
    const next = moves[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const i = (next + PROVIDERS.length) % PROVIDERS.length;
    const p = PROVIDERS[i];
    if (!p) return;
    refs.current[i]?.focus();
  };
  // 아무것도 고르지 않았으면 첫 버튼이 탭 순서를 받는다
  const focusIndex = value === undefined ? 0 : PROVIDERS.indexOf(value);
  return (
    <section aria-labelledby="step-cloud" className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <h2 id="step-cloud" className="text-base font-semibold"><span aria-hidden="true" className="mr-1.5 text-indigo-600 dark:text-indigo-400">1</span>{en.ui.step_cloud}</h2>
      <div role="radiogroup" aria-label={en.ui.cloud_group_label} className="flex w-full gap-2 sm:w-auto">
        {PROVIDERS.map((p, i) => (
          <button
            key={p}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={value === p}
            title={providerName(p)}
            data-cloud={p}
            tabIndex={i === focusIndex ? 0 : -1}
            onClick={() => onPick(p)}
            onKeyDown={(e) => onKey(e, i)}
            className={BUTTON}
          >
            {SHORT[p]}
          </button>
        ))}
      </div>
    </section>
  );
}
