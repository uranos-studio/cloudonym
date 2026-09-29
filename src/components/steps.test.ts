import { describe, it, expect } from 'vitest';
import { visibleSteps } from './steps';
import type { CoreMessage } from '../core/types';

// 엔진 steps 는 그대로 두고 화면에서만 거른다 — 정제 뒤 빈 값은 위반 이유(name.token_empty)가 이미 말한다
const emptied = (field: 'system' | 'purpose', from: string): CoreMessage => ({ code: 'step.normalized', field, params: { from, to: '' } });

describe('visibleSteps — 대상이 빈 변환 단계를 숨긴다', () => {
  it('대상이 빈 변환만 뺀다', () => {
    const keep: CoreMessage[] = [{ code: 'step.normalized', field: 'owner', params: { from: 'Ac Mex', to: 'acmex' } }, { code: 'step.separator_removed' }];
    expect(visibleSteps([emptied('system', 'x'), ...keep])).toEqual(keep);
  });
  it('축약 · 생략 단계는 건드리지 않는다', () => {
    const steps: CoreMessage[] = [{ code: 'step.token_dropped', field: 'region' }, { code: 'step.abbreviated', field: 'purpose', params: { from: 'trade', to: 'trd' } }, { code: 'step.budget_shortened', params: { budget: 2 } }];
    expect(visibleSteps(steps)).toEqual(steps);
  });
  it('입력에 화살표가 들어 있어도 대상이 있으면 남긴다 · 전부 비면 빈 배열', () => {
    const arrow: CoreMessage = { code: 'step.normalized', field: 'owner', params: { from: 'a→b', to: 'ab' } };
    expect(visibleSteps([arrow])).toEqual([arrow]);
    expect(visibleSteps([emptied('system', 'x'), emptied('purpose', 'y')])).toEqual([]);
    expect(visibleSteps([])).toEqual([]);
  });
});
