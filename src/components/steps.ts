// 카드에 보일 변환 · 축약 단계 — 엔진 steps 는 바꾸지 않고 화면에서만 거른다
// 정제 뒤 빈 값이 된 토큰의 변환(step.normalized 의 to 가 '')은 위반 이유(name.token_empty)가 이미 말하므로 숨긴다
import type { CoreMessage } from '../core/types';

/** 대상이 빈 변환 단계를 뺀다 */
export function visibleSteps(steps: readonly CoreMessage[]): CoreMessage[] {
  return steps.filter((s) => !(s.code === 'step.normalized' && s.params.to === ''));
}
