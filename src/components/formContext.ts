// 폼의 값 (D50) — 문맥 다섯 칸. region 은 사용자가 넣은 지역 입력 문자열(리전 · 존의 이름 또는 코드)이고, 존은 그 안에 든다.
// 정규화된 문맥(NamingContext — region 은 리전 코드, zone 은 따로)으로 폼을 덮지 않는다: 덮으면 존이 떨어진다 (codex #6)
import type { NamingContext } from '../core/types';

export type FormContext = Omit<NamingContext, 'zone'>;

/** 첫 화면 · 꺼진 CSP 링크의 지역 예시 (R0) — 존 이름이라 존 리소스도 처음부터 이름이 나온다 */
export const EXAMPLE_REGION = 'asia-northeast3-a';

/** 첫 화면의 예시 — 공유 URL 이 있으면 그것이 이긴다 */
export const DEFAULT_FORM: FormContext = { owner: 'platform', system: 'billing', purpose: 'trade', env: 'prod', region: EXAMPLE_REGION };

/** 풀린 문맥 → 폼. 지역 칸은 hash 에 싣는 값과 같다 — 존 코드(있으면) 아니면 리전 코드 · global */
export function formOf(ctx: NamingContext): FormContext {
  return { owner: ctx.owner, system: ctx.system, purpose: ctx.purpose, env: ctx.env, region: ctx.zone ?? ctx.region };
}
