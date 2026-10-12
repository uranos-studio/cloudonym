// 마법사 화면의 배치 (D89) — 폭에 따라 셋이다. 경계는 Tailwind 의 md(768px) · xl(1280px) 와 같다(클래스와 JS 가 같은 폭에서 바뀐다)
//   wide   ≥1280  목록 · 설정 · 이름 세 칸
//   tablet 768–1279  목록 · 설정 두 칸 + 오른쪽 가장자리에서 여는 이름 드로어
//   phone  <768   한 칸 — 위 탭 [Plan] [Names] · 줄을 누르면 설정이 바텀 시트로
import { useSyncExternalStore } from 'react';

export type WizardLayout = 'wide' | 'tablet' | 'phone';

export const WIDE_QUERY = '(min-width: 1280px)';
export const TABLET_QUERY = '(min-width: 768px)';

/** 폭 두 개의 판정에서 배치 하나로 */
export function layoutOf(wide: boolean, tablet: boolean): WizardLayout {
  return wide ? 'wide' : tablet ? 'tablet' : 'phone';
}

function current(): WizardLayout {
  return layoutOf(window.matchMedia(WIDE_QUERY).matches, window.matchMedia(TABLET_QUERY).matches);
}

function subscribe(onChange: () => void): () => void {
  const lists = [window.matchMedia(WIDE_QUERY), window.matchMedia(TABLET_QUERY)];
  for (const l of lists) l.addEventListener('change', onChange);
  return () => {
    for (const l of lists) l.removeEventListener('change', onChange);
  };
}

/** 지금 배치 — 창 폭이 경계를 넘으면 다시 그린다 */
export function useWizardLayout(): WizardLayout {
  return useSyncExternalStore(subscribe, current, () => 'wide');
}
