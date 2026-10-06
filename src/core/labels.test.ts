import { describe, it, expect } from 'vitest';
import { labelsFor } from './labels';
import { AWS_TAG_VALUE } from './constraints';
const ctx = { owner: 'infra', system: 'billing', purpose: 'trade', env: 'prd', region: 'kr' } as const;

describe('labelsFor', () => {
  it('공통 다섯 키', () => {
    expect(labelsFor(ctx, 'aws').labels).toEqual({ owner: 'infra', system: 'billing', purpose: 'trade', environment: 'prd', managed_by: 'cloudonym' });
  });
  it('TC-AWS-02 값 한도 초과는 자르지 않고 violations (AWS 256 · Azure 256 · GCP 63)', () => {
    const big = { ...ctx, owner: 'a'.repeat(257) };
    expect(labelsFor(big, 'aws').violations).toEqual([{ code: 'label.too_long', field: 'owner', params: { actual: 257, max: 256 } }]);
    expect(labelsFor(big, 'azure').violations).toEqual([{ code: 'label.too_long', field: 'owner', params: { actual: 257, max: 256 } }]);
    expect(labelsFor({ ...ctx, owner: 'a'.repeat(64) }, 'gcp').violations).toEqual([{ code: 'label.too_long', field: 'owner', params: { actual: 64, max: 63 } }]);
  });
  it('GCP 는 라벨 값 규격으로 바꾸고 기록한다 — 한글 · 숫자 시작은 유효 (D21)', () => {
    const r = labelsFor({ ...ctx, owner: 'In.Fra' }, 'gcp');
    expect(r.labels.owner).toBe('infra');
    expect(r.transformed).toEqual([{ code: 'label.normalized', field: 'owner', params: { from: 'In.Fra', to: 'infra' } }]);
    expect(labelsFor({ ...ctx, owner: '개발' }, 'gcp')).toMatchObject({ labels: { owner: '개발' }, transformed: [] });
    expect(labelsFor({ ...ctx, owner: '123' }, 'gcp').violations).toEqual([]);
  });
  it('AWS 태그 값 문자 집합 — 문서 밖 문자는 자르지 않고 violations (결정 2026-09-29)', () => {
    const r = labelsFor({ ...ctx, owner: 'team#1<x>' }, 'aws');
    expect(r.labels.owner).toBe('team#1<x>');
    expect(r.violations).toEqual([{ code: 'label.aws_invalid_chars', field: 'owner' }]);
    expect(r.transformed).toEqual([]);
  });
  it('AWS 태그 값 — 문서가 허용하는 기호 · 공백 · 한글 · 악센트 글자는 위반이 아니다', () => {
    expect(labelsFor({ ...ctx, owner: 'a b_c.d:e/f=g+h-i@j' }, 'aws').violations).toEqual([]);
    expect(labelsFor({ ...ctx, owner: '개발팀' }, 'aws').violations).toEqual([]);
    expect(labelsFor({ ...ctx, owner: 'café' }, 'aws').violations).toEqual([]);
  });
  it('AWS 태그 값 — 길이와 문자 위반은 따로 센다 · Azure 는 문자를 보지 않는다', () => {
    expect(labelsFor({ ...ctx, owner: '#'.repeat(257) }, 'aws').violations).toHaveLength(2);
    expect(labelsFor({ ...ctx, owner: 'team#1<x>' }, 'azure').violations).toEqual([]);
  });
  it('AWS_TAG_VALUE 는 고정 앵커 · g/y/m 플래그 없음 · 제어 문자와 # < > 를 거부한다', () => {
    expect(AWS_TAG_VALUE.flags).toBe('u');
    for (const bad of ['#', '<', '>', '\n', '\t', '%', '&', '?', '*']) expect(AWS_TAG_VALUE.test(`a${bad}b`), JSON.stringify(bad)).toBe(false);
    expect(AWS_TAG_VALUE.test('')).toBe(true);
  });
});

describe('labelsFor — 항목 입력(seq · role)이 라벨에 들어가지 않는다 (D30\')', () => {
  it('세 provider 모두 라벨 키 집합이 다섯 그대로다', () => {
    for (const p of ['aws', 'gcp', 'azure'] as const) {
      expect(Object.keys(labelsFor(ctx, p).labels).sort(), p).toEqual(['environment', 'managed_by', 'owner', 'purpose', 'system']);
    }
  });
});
