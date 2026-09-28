// 카드에 보일 변환 · 축약 줄 — 엔진 steps 는 바꾸지 않고 화면에서만 거른다
// `system: 매매→` 처럼 정제 뒤 빈 값은 위반 이유(「system 이 정제 뒤 비었다」)가 이미 말하므로 화살표만 남은 줄을 숨긴다

/** 대상이 빈 변환 줄(`→` 로 끝남)을 뺀다. 정제된 값은 ASCII 라 화살표로 끝날 수 없다 */
export function visibleSteps(steps: readonly string[]): string[] {
  return steps.filter((s) => !s.endsWith('→'));
}
