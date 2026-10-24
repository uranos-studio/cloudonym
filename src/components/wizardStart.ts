// 마법사의 첫 상태 (D97 · D108 · D129) — 경로의 클라우드 · 주소창 hash 에서 첫 계획을 고른다. 화면 상태를 갖지 않는 순수 함수라 시험이 직접 부른다(wizardStart.test)
import type { Env } from '../core/types';
import type { WizardPlan, WizardProvider } from '../core/wizard/plan';
import { decodeWizardState, encodeWizardState, hashKind, type WizardNotices } from './urlState';
import type { LinkState } from './linkRevision';
import * as S from './wizardState';
import { samplePlan } from './wizardSample';
import { EXAMPLE_REGIONS } from './formContext';
import { VERSION } from '../version';

// hash 가 마법사 링크면 그것, hash 가 없으면 그 클라우드의 예시 계획(D108 · D129), 깨진 링크면 그 클라우드의 빈 예시
/** firstRun — hash 없이 처음 온 사람(D97 · D108). Project(「Example」 표시 · Clear)를 먼저 고른다 · 폰은 Edit 탭으로 연다 */
export interface Start { plan: WizardPlan; envs: Env[]; notices?: WizardNotices; broken: boolean; link?: LinkState; firstRun?: boolean }
/** 링크에서 떨어진(깨진) 경로의 빈 계획 — 그 경로의 클라우드로, 지역은 그 클라우드의 예시 지역 */
const brokenPlan = (provider: WizardProvider): WizardPlan => S.initialPlan(provider === 'gcp' ? S.DEFAULT_PROJECT : { ...S.DEFAULT_PROJECT, region: EXAMPLE_REGIONS[provider] }, provider);
/** provider — 경로의 클라우드(D129). hash 가 마법사 링크면 계획은 링크가 정한다(경로와 다르면 main.tsx 가 진입 때 이미 경로를 맞췄다) */
export function startFrom(hash: string, brokenAtRoot: boolean, provider: WizardProvider = 'gcp'): Start {
  if (hashKind(hash) === 'wizard') {
    const d = decodeWizardState(hash);
    if (!d) return { plan: brokenPlan(provider), envs: [], broken: true };
    const plan = d.plan ?? S.initialPlan(d.project, d.provider);
    const envs = d.envs ?? [];
    const key = encodeWizardState(plan, VERSION.rules, envs) ?? '';
    return { plan, envs, notices: d.notices, broken: false, link: { key, hash, ...(d.rulesVersion === undefined ? {} : { rulesVersion: d.rulesVersion }) } };
  }
  // 미리 채움은 hash 가 없을 때만 — 링크에서 떨어진 경로(깨진 링크)는 링크가 누구에게나 같도록 빈 예시로 연다
  const firstRun = !brokenAtRoot && hash === '';
  return { plan: firstRun ? samplePlan(provider) : brokenPlan(provider), envs: [], broken: brokenAtRoot, firstRun };
}
