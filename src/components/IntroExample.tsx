// 소개 상자의 예시 한 줄 (D107) — 입력 넷 → 이름 셋. 읽기 전용이다: 누를 수 없고 상태 · hash 에 아무것도 넣지 않는다.
// 이름은 빌드 때 엔진이 만든 introExamples.json 에서만 온다(scripts/gen-intro-examples.mjs) — 이 파일은 이름을 짓지 않는다.
// PASS 는 그 줄이 valid:true 일 때만 붙는다. 폰(<768)은 이름이 길어 줄이 바뀌므로 Cloud Run 한 줄만 보인다.
// 색 — 페이지 · 소개 상자와 다른 어두운 단말 꼴. 밝은 화면은 zinc-900, 어두운 화면은 검정 + 테두리로 zinc-950 페이지와 나뉜다(글자 대비는 AA 를 넘는다)
import { Fragment } from 'react';
import { CircleCheck, CircleX } from 'lucide-react';
import data from './introExamples.json';
import { en } from '../messages/en';

export interface IntroExampleData { rules: string; input: string[]; rows: { id: string; label: string; key: string; name: string; valid: boolean }[] }

export const INTRO_EXAMPLE: IntroExampleData = data;

export function IntroExample({ phone, example = INTRO_EXAMPLE }: { phone: boolean; example?: IntroExampleData }) {
  const rows = phone ? example.rows.filter((r) => r.id === 'run') : example.rows;
  return (
    <figure data-intro-example aria-label={en.ui.intro_example_label}
      className="overflow-x-auto rounded-md border border-zinc-900 bg-zinc-900 px-3 py-2 font-mono text-[11px] leading-relaxed sm:text-xs text-zinc-100 dark:border-zinc-700 dark:bg-black">
      <div className="flex flex-wrap items-baseline gap-x-3">
        {/* 예시는 입력 칸의 값으로 만든 것이 아니다 (D113) — 표지 옆에 그 말을 붙인다 */}
        <span className="font-sans text-[11px] text-zinc-400"><span data-intro-example-tag className="font-semibold uppercase tracking-wider">{en.ui.intro_example}</span>{' '}<span data-intro-example-note>{en.ui.intro_example_note}</span></span>
        {/* 값 하나는 줄을 바꾸지 않는다(asia-northeast3 가 하이픈에서 잘리지 않게) — 줄은 「 · 」 자리에서만 바뀐다 */}
        <code data-intro-example-input>{example.input.map((v, i) => <Fragment key={v}>{i > 0 ? ' · ' : ''}<span className="whitespace-nowrap">{v}</span></Fragment>)}</code>
      </div>
      <ul className="mt-1 space-y-0.5">
        {rows.map((r) => (
          <li key={r.id} data-intro-example-row={r.id} className="flex flex-wrap items-baseline gap-x-3">
            {/* 화살표와 이름은 한 덩어리 — 이름이 하이픈에서 잘리지 않는다. 폭이 모자라면 블록이 가로로 굴러간다(overflow-x-auto) */}
            <span className="whitespace-nowrap"><span aria-hidden="true" className="mr-2 text-zinc-400">→</span><code data-intro-example-name>{r.name}</code></span>
            <span className="font-sans text-zinc-400">{r.label}</span>
            {r.valid === true
              ? <span data-intro-example-pass className="inline-flex items-center gap-1 font-sans font-semibold text-emerald-400"><CircleCheck aria-hidden="true" className="size-3.5" />PASS</span>
              : <span data-intro-example-fail className="inline-flex items-center gap-1 font-sans font-semibold text-rose-400"><CircleX aria-hidden="true" className="size-3.5" />FAIL</span>}
          </li>
        ))}
      </ul>
    </figure>
  );
}
