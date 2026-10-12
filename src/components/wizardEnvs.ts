// 한 계획에 환경 여럿 (D82) — 화면만의 상태다. 모델(WizardPlan) · validatePlan · /v1/wizard 는 env 하나를 그대로 받고,
// 화면은 같은 계획을 고른 env 마다 한 번씩 돌린다. 첫 env(표준값 순서)가 모델의 project.env 다
import { ENV_VALUES } from '../core/engine';
import type { Env } from '../core/types';
import type { WizardPlan } from '../core/wizard/plan';

const isEnv = (v: unknown): v is Env => typeof v === 'string' && (ENV_VALUES as readonly string[]).includes(v);

/** 고른 env 목록 — 표준값만 · 중복 없이 · ENV_VALUES 순서로. primary 가 표준값이면 늘 든다 */
export function envList(primary: string, others: readonly unknown[] = []): Env[] {
  const picked = new Set<unknown>([primary, ...others]);
  return ENV_VALUES.filter((e) => picked.has(e));
}

/** 칩 하나를 켜고 끈다 — 마지막 하나는 끄지 않는다 */
export function toggleEnv(list: readonly Env[], env: Env): Env[] {
  if (!list.includes(env)) return envList(env, list);
  return list.length === 1 ? [...list] : list.filter((e) => e !== env);
}

/** hash 의 `e` 값을 푼다 — 배열이 아니면 undefined, 표준값이 아닌 항목은 버리고 센다 */
export function envsFromHash(raw: unknown): { envs: Env[]; dropped: number } | undefined {
  if (!Array.isArray(raw)) return undefined;
  const envs = raw.filter(isEnv);
  return { envs, dropped: raw.length - envs.length };
}

/** 같은 계획을 다른 env 로 */
export function withEnv(plan: WizardPlan, env: Env): WizardPlan {
  return { ...plan, project: { ...plan.project, env } };
}
