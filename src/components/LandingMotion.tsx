// 소개 페이지의 움직이는 소개 (D129) — 3~4초 한 번, 반복 없음. 다섯 문맥값이 차례로 들어오고 → 화살표 → 이름 하나가 조립되고 → PASS.
// 값 · 이름 · 판정은 introExamples.json(빌드 때 엔진이 만든 값)에서만 온다 — 이 파일은 이름을 짓지 않는다. PASS 는 그 줄이 valid:true 일 때만 그린다.
// 움직임은 CSS @keyframes(src/index.css 의 landing-*)와 인라인 SVG 뿐이다 — 스크립트 타이머 · style 속성이 없다(CSP style-src 'self').
// 클래스를 뗀 쉬는 상태가 마지막 장면이다 — prefers-reduced-motion: reduce 면 CSS 가 animation 을 끄고 마지막 장면만 보인다.
// 그림은 aria-hidden 이고 같은 내용을 아래 글 한 줄(data-landing-motion-text)이 말한다
import { useState } from 'react';
import { INTRO_EXAMPLE, type IntroExampleData } from './IntroExample';
import { en } from '../messages/en';
import { fillUi } from '../messages/catalog';

/** 값 다섯의 이름표 — API · CLI 의 필드 이름 그대로 */
const FIELDS = ['owner', 'system', 'purpose', 'env', 'region'] as const;
/** 값마다 들어오는 차례 — 지연은 클래스로 준다(style 속성을 쓰지 않는다) */
const DELAY = ['landing-d1', 'landing-d2', 'landing-d3', 'landing-d4', 'landing-d5'] as const;

/** 움직임을 줄인 기기인가 — 화면 시험이 정지 화면을 확인하는 표지(data-landing-motion-static)일 뿐이고, 그리는 것은 CSS 가 정한다 */
function reducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function LandingMotion({ example = INTRO_EXAMPLE }: { example?: IntroExampleData }) {
  const [still] = useState(reducedMotion);
  const run = example.rows.find((r) => r.id === 'run');
  const [owner = '', system = '', env = '', region = ''] = example.input;
  const values = [owner, system, example.purpose, env, region];
  const pass = run?.valid === true;
  return (
    <div className="space-y-3">
      <figure data-landing-motion aria-hidden="true" {...(still ? { 'data-landing-motion-static': '' } : {})}
        className="mx-auto max-w-3xl overflow-hidden rounded-xl border border-zinc-900 bg-zinc-900 px-4 py-6 font-mono text-zinc-100 shadow-sm sm:px-6 dark:border-zinc-700 dark:bg-black">
        <ol className="flex flex-wrap items-end justify-center gap-2">
          {values.map((v, i) => (
            <li key={FIELDS[i]} className={`landing-rise ${DELAY[i]} flex flex-col items-start rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 dark:bg-zinc-900`}>
              <span className="font-sans text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">{FIELDS[i]}</span>
              <code data-landing-value={FIELDS[i]} className="text-sm sm:text-base">{v}</code>
            </li>
          ))}
        </ol>
        <svg viewBox="0 0 24 40" className="landing-arrow mx-auto my-3 h-9 w-5 text-indigo-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v32M5 28l7 7 7-7" />
        </svg>
        {run && (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
            <code data-landing-name={run.id} className="landing-type rounded-md bg-zinc-800 px-3 py-1.5 text-sm whitespace-nowrap text-white sm:text-lg dark:bg-zinc-900">{run.name}</code>
            {pass && (
              <span data-landing-pass className="landing-pop inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 font-sans text-sm font-semibold text-emerald-400">
                <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                PASS
              </span>
            )}
          </div>
        )}
        {run && <p className="landing-pop mt-2 text-center font-sans text-xs text-zinc-400">{run.label}</p>}
      </figure>
      {run && (
        <p data-landing-motion-text className="mx-auto max-w-3xl text-center text-sm text-pretty text-zinc-600 dark:text-zinc-400">
          {fillUi(en, 'landing_motion_text', { values: values.join(' · '), label: run.label, name: run.name })}
          {pass && <> {en.ui.landing_motion_pass}</>}
        </p>
      )}
    </div>
  );
}
