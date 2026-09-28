import { describe, it, expect } from 'vitest';
import { labelsFor } from './labels';
const ctx = { owner: 'acmex', system: 'billing', purpose: 'trade', env: 'prd', region: 'kr' } as const;

describe('labelsFor', () => {
  it('공통 다섯 키', () => {
    expect(labelsFor(ctx, 'aws').labels).toEqual({ owner: 'acmex', system: 'billing', purpose: 'trade', environment: 'prd', managed_by: 'cloudonym' });
  });
  it('TC-AWS-02 값 한도 초과는 자르지 않고 violations (AWS 256 · Azure 256 · GCP 63)', () => {
    const big = { ...ctx, owner: 'a'.repeat(257) };
    expect(labelsFor(big, 'aws').violations).toEqual(['owner 값 257자 — 최대 256자']);
    expect(labelsFor(big, 'azure').violations).toEqual(['owner 값 257자 — 최대 256자']);
    expect(labelsFor({ ...ctx, owner: 'a'.repeat(64) }, 'gcp').violations).toEqual(['owner 값 64자 — 최대 63자']);
  });
  it('GCP 는 라벨 값 규격으로 바꾸고 기록한다 — 한글 · 숫자 시작은 유효 (D21)', () => {
    const r = labelsFor({ ...ctx, owner: 'Ac.Mex' }, 'gcp');
    expect(r.labels.owner).toBe('acmex');
    expect(r.transformed).toEqual(['owner: Ac.Mex→acmex']);
    expect(labelsFor({ ...ctx, owner: '개발' }, 'gcp')).toMatchObject({ labels: { owner: '개발' }, transformed: [] });
    expect(labelsFor({ ...ctx, owner: '123' }, 'gcp').violations).toEqual([]);
  });
});
