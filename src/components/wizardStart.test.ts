// 마법사의 첫 상태 (D108 · D129) — 경로의 클라우드가 예시 계획을 고르고, hash 가 있으면 링크가 경로보다 이긴다
import { describe, it, expect } from 'vitest';
import { startFrom } from './wizardStart';
import { samplePlan } from './wizardSample';
import { encodeWizardState } from './urlState';
import { VERSION } from '../version';

describe('startFrom(hash, broken, provider)', () => {
  it('hash 없음 — 경로의 클라우드의 예시 계획 · firstRun', () => {
    const aws = startFrom('', false, 'aws');
    expect(aws.plan).toEqual(samplePlan('aws'));
    expect(aws.firstRun).toBe(true);
    expect(aws.broken).toBe(false);
    const gcp = startFrom('', false, 'gcp');
    expect(gcp.plan).toEqual(samplePlan('gcp'));
    expect(gcp.firstRun).toBe(true);
  });
  it('마법사 링크 — 계획은 링크가 정한다(경로보다 hash) · firstRun 아님', () => {
    const awsHash = `#state=${encodeWizardState(samplePlan('aws'), VERSION.rules, ['prod'])}`;
    const s = startFrom(awsHash, false, 'gcp');
    expect(s.plan.provider).toBe('aws');
    // hash 는 지역을 코드(apne2)로 싣는다 — 같은 계획인지는 다시 만든 hash 로 본다
    expect(encodeWizardState(s.plan, VERSION.rules, s.envs)).toBe(awsHash.slice('#state='.length));
    expect(s.firstRun).toBeFalsy();
    expect(s.link?.hash).toBe(awsHash);
    const gcpHash = `#state=${encodeWizardState(samplePlan('gcp'), VERSION.rules, ['prod'])}`;
    expect(startFrom(gcpHash, false, 'aws').plan.provider).toBe('gcp');
  });
  it('깨진 링크 — 그 경로의 클라우드로 빈 예시 · 안내 표시 · 예시 계획이 아니다', () => {
    for (const p of ['aws', 'gcp'] as const) {
      const s = startFrom('#state=abc', true, p);
      expect(s.broken).toBe(true);
      expect(s.firstRun).toBeFalsy();
      expect(s.plan.provider).toBe(p);
      expect(s.plan.services.every((x) => x.picks.length === 0)).toBe(true);
    }
  });
});
