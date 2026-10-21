// 폼의 값 (D50 revised) — 문맥 다섯 칸. region 은 사용자가 넣은 지역 입력 문자열(리전 · 존의 이름 또는 코드)이다.
// 존 입력은 받아 리전으로 푼다 — 존은 이름에 들지 않는다
import { ENABLED_PROVIDERS, type NamingContext, type Provider } from '../core/types';

export type FormContext = Omit<NamingContext, 'zone'>;

/** 첫 화면 · 꺼진 CSP 링크의 지역 예시 (R0) — CSP 마다 리전 이름. 모든 지역 리소스가 처음부터 이름이 나온다 (D50 revised).
 *  지역 표가 CSP 마다 달라 한 값이 모든 CSP 에서 풀리지 않는다 */
export const EXAMPLE_REGIONS: Readonly<Record<Provider, string>> = { gcp: 'asia-northeast3', aws: 'ap-northeast-2', azure: 'koreacentral' };

/** 첫 화면의 지역 예시 — 켜진 첫 CSP 의 것 */
export const EXAMPLE_REGION = EXAMPLE_REGIONS[ENABLED_PROVIDERS[0]!];

/** 첫 화면의 예시 — 공유 URL 이 있으면 그것이 이긴다 */
export const DEFAULT_FORM: FormContext = { owner: 'platform', system: 'billing', purpose: 'trade', env: 'prod', region: EXAMPLE_REGION };

/** 풀린 문맥 → 폼. 지역 칸은 hash 에 싣는 값과 같다 — 리전 코드 · global */
export function formOf(ctx: NamingContext): FormContext {
  return { owner: ctx.owner, system: ctx.system, purpose: ctx.purpose, env: ctx.env, region: ctx.region };
}
