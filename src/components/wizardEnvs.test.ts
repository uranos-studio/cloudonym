// 한 계획에 환경 여럿 (D82) — 고른 목록 · 칩 켜고 끄기 · hash 의 e 풀이
import { describe, it, expect } from 'vitest';
import { envList, envsFromHash, toggleEnv, withEnv } from './wizardEnvs';
import type { WizardPlan } from '../core/wizard/plan';

describe('wizardEnvs', () => {
  it('envList — 표준값만 · 중복 없이 · 표준값 순서 · primary 가 든다', () => {
    expect(envList('dr', ['stg', 'prod', 'stg'])).toEqual(['prod', 'stg', 'dr']);
    expect(envList('prod')).toEqual(['prod']);
    expect(envList('production', ['qa', 'nope', 3])).toEqual(['qa']);
  });
  it('toggleEnv — 켜면 표준값 순서로 들고 · 끄면 빠지고 · 마지막 하나는 끄지 않는다', () => {
    expect(toggleEnv(['prod'], 'test')).toEqual(['prod', 'test']);
    expect(toggleEnv(['prod', 'test'], 'prod')).toEqual(['test']);
    expect(toggleEnv(['test'], 'test')).toEqual(['test']);
  });
  it('envsFromHash — 배열만 · 표준값이 아닌 항목은 센다', () => {
    expect(envsFromHash('prod')).toBeUndefined();
    expect(envsFromHash(['prod', 'staging', null, 'dr'])).toEqual({ envs: ['prod', 'dr'], dropped: 2 });
  });
  it('withEnv — 모델의 env 만 바꾼다', () => {
    const plan: WizardPlan = { provider: 'gcp', project: { owner: 'a', system: 'b', env: 'prod', region: 'ane3' }, projectPicks: [], services: [] };
    expect(withEnv(plan, 'qa')).toEqual({ ...plan, project: { ...plan.project, env: 'qa' } });
    expect(plan.project.env).toBe('prod');
  });
});
