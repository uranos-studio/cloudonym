// ① Cloud — AWS · GCP · Azure (D42). 버튼은 셋 다 그리고, 아직 켜지지 않은 CSP 는 눌리지 않는 「Coming soon」 예고로 둔다 (D45).
// 켜진 것이 하나면 App 이 첫 그리기 때 그것을 고른다. 켜진 것이 둘 이상이면 첫 방문은 아무것도 고르지 않는다 — 숨은 기본값을 두지 않는다.
// 라디오 그룹 — 「수동 선택」 꼴: 방향키는 포커스만 옮기고 Space · Enter(버튼의 click)로 고른다. 바꾸기 전 확인은 App 몫.
// CSP 전환은 선택을 지우는 동작이라 방향키마다 고르면 누를 때마다 확인 창이 뜨고, 취소해도 포커스만 옮겨 aria-checked 와 어긋난다.
// WAI-ARIA APG 의 radio group 은 툴바 안에서 이 꼴(방향키는 포커스만 · Space 로 체크)을 정해 둔다. 탭 순서(tabIndex 0)는 체크된 라디오가 받는다.
// 꺼진 버튼은 disabled 라 포커스를 받지 않고, 방향키 이동은 그것을 건너뛴다
import { useRef, type KeyboardEvent } from 'react';
import { ENABLED_PROVIDERS, PROVIDERS, type Provider } from '../core/types';
import { en } from '../messages/en';
import type { UiKey } from '../messages/catalog';
import { providerName, providerShort } from './providerName';

/** 꺼진 CSP 의 툴팁 — 언제 열리는지 (사전 문구) */
const PLANNED: Partial<Record<Provider, UiKey>> = { aws: 'cloud_planned_aws', azure: 'cloud_planned_azure' };

const BUTTON =
  // 좁은 화면에서 버튼 셋 + 「Coming soon」 표지가 360px 에 들어가도록 표지를 글자 아래로 내린다
  'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-md border px-2 py-2 text-sm font-semibold sm:flex-none sm:min-w-24 sm:flex-row sm:gap-1.5 sm:px-4 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:focus-visible:outline-indigo-400 ' +
  'aria-checked:border-indigo-600 aria-checked:bg-indigo-600 aria-checked:text-white dark:aria-checked:border-indigo-500 dark:aria-checked:bg-indigo-500 ' +
  'border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 ' +
  'disabled:cursor-not-allowed disabled:border-dashed disabled:bg-zinc-50 disabled:text-zinc-500 disabled:hover:bg-zinc-50 ' +
  'dark:disabled:bg-zinc-900 dark:disabled:text-zinc-400 dark:disabled:hover:bg-zinc-900';

const isEnabled = (p: Provider): boolean => ENABLED_PROVIDERS.includes(p);

export function CloudPicker({ value, onPick }: { value: Provider | undefined; onPick: (p: Provider) => void }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  // 방향키가 오가는 자리 — 켜진 버튼의 PROVIDERS 안 위치
  const live = PROVIDERS.flatMap((p, i) => (isEnabled(p) ? [i] : []));
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const at = live.indexOf(index);
    const moves: Record<string, number> = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: live.length - 1 };
    const next = moves[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const i = live[(next + live.length) % live.length];
    if (i === undefined) return;
    refs.current[i]?.focus();
  };
  // 고른 것이 없으면 첫 켜진 버튼이 탭 순서를 받는다
  const focusIndex = value !== undefined && isEnabled(value) ? PROVIDERS.indexOf(value) : (live[0] ?? 0);
  return (
    <section aria-labelledby="step-cloud" className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <h2 id="step-cloud" className="text-base font-semibold"><span aria-hidden="true" className="mr-1.5 text-indigo-600 dark:text-indigo-400">1</span>{en.ui.step_cloud}</h2>
      <div role="radiogroup" aria-label={en.ui.cloud_group_label} className="flex w-full gap-2 sm:w-auto">
        {PROVIDERS.map((p, i) => {
          const on = isEnabled(p);
          const planned = PLANNED[p];
          return (
            <button
              key={p}
              ref={(el) => { refs.current[i] = el; }}
              type="button"
              role="radio"
              aria-checked={value === p}
              aria-disabled={on ? undefined : true}
              disabled={!on}
              title={on || planned === undefined ? providerName(p) : en.ui[planned]}
              data-cloud={p}
              data-cloud-enabled={on ? 'true' : 'false'}
              tabIndex={i === focusIndex ? 0 : -1}
              onClick={() => { if (on) onPick(p); }}
              onKeyDown={(e) => onKey(e, i)}
              className={BUTTON}
            >
              {providerShort(p)}
              {!on && <span data-coming-soon className="whitespace-nowrap rounded bg-zinc-200 px-1.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">{en.ui.cloud_coming_soon}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
