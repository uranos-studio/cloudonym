import { describe, it, expect } from 'vitest';
import { visibleSteps } from './steps';

// 엔진 steps 는 그대로 두고 화면에서만 거른다 — 정제 뒤 빈 값(`system: 매매→`)은 위반 이유(「system 이 정제 뒤 비었다」)가 이미 말한다
describe('visibleSteps — 화살표 뒤가 빈 변환 줄을 숨긴다', () => {
  it('대상이 빈 변환 줄만 뺀다', () => {
    expect(visibleSteps(['system: 매매→', 'owner: Ac Mex→acmex', '하이픈 제거'])).toEqual(['owner: Ac Mex→acmex', '하이픈 제거']);
  });
  it('축약 · 생략 줄은 건드리지 않는다', () => {
    expect(visibleSteps(['region 생략', 'owner 생략', '균등 축소 B=2'])).toEqual(['region 생략', 'owner 생략', '균등 축소 B=2']);
  });
  it('입력에 화살표가 들어 있어도 대상이 있으면 남긴다 · 전부 비면 빈 배열', () => {
    expect(visibleSteps(['owner: a→b→ab'])).toEqual(['owner: a→b→ab']);
    expect(visibleSteps(['system: 매매→', 'purpose: 거래→'])).toEqual([]);
    expect(visibleSteps([])).toEqual([]);
  });
});
