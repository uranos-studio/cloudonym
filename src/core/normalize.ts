// 연속 하이픈을 하나로 줄인다 — 순수 함수, 런타임 의존성 없음
export function collapseHyphens(input: string): string {
  return input.replace(/-{2,}/g, '-')
}
