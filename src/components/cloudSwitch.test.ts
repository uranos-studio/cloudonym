// CSP 를 바꿀 때 지역 칸 (0.2 준비) — 옛 CSP 의 지역이 새 CSP 표에서 안 풀리면 새 CSP 의 예시로 바꾼다.
// 켜진 CSP 에 기대는 절은 aws-enabled.test.ts 가 ['aws', 'gcp'] 로 다시 돈다
import { describe, it, expect } from 'vitest';
import { DEFAULT_FORM, EXAMPLE_REGIONS, formForCloudSwitch } from './formContext';
import { ENABLED_PROVIDERS, PROVIDERS } from '../core/types';
import { canonicalRegion } from '../core/regions';

describe('formForCloudSwitch', () => {
  it('옛 CSP 에서 풀리고 새 CSP 에서 안 풀리면 새 CSP 의 예시로 바꾼다 — 다른 칸은 그대로', () => {
    const aws = { ...DEFAULT_FORM, region: 'ap-northeast-2' };
    expect(formForCloudSwitch(aws, 'aws', 'gcp')).toEqual({ ...aws, region: EXAMPLE_REGIONS.gcp });
    const gcp = { ...DEFAULT_FORM, region: 'asia-northeast3-a' };
    expect(formForCloudSwitch(gcp, 'gcp', 'aws')).toEqual({ ...gcp, region: EXAMPLE_REGIONS.aws });
  });

  it('새 CSP 에서도 풀리는 값(global) · 같은 CSP · 옛 CSP 에서도 안 풀리던 입력은 그대로 둔다', () => {
    const global = { ...DEFAULT_FORM, region: 'global' };
    expect(formForCloudSwitch(global, 'aws', 'gcp')).toBe(global);
    const typo = { ...DEFAULT_FORM, region: 'asia-northeast' };
    expect(formForCloudSwitch(typo, 'aws', 'gcp')).toBe(typo);
    const empty = { ...DEFAULT_FORM, region: '' };
    expect(formForCloudSwitch(empty, 'gcp', 'aws')).toBe(empty);
    expect(formForCloudSwitch(DEFAULT_FORM, 'gcp', 'gcp')).toBe(DEFAULT_FORM);
  });

  it('CSP 마다 예시 지역은 자기 표에서 풀린다 — 바꾼 뒤 이름이 나온다', () => {
    for (const p of PROVIDERS) expect(canonicalRegion(EXAMPLE_REGIONS[p], p), p).toBeDefined();
  });

  it('켜진 CSP 사이를 오가면 첫 화면의 예시 지역은 늘 그 CSP 에서 풀린다', () => {
    let form = DEFAULT_FORM;
    let from = ENABLED_PROVIDERS[0]!;
    for (const to of [...ENABLED_PROVIDERS, ...[...ENABLED_PROVIDERS].reverse()]) {
      form = formForCloudSwitch(form, from, to);
      expect(canonicalRegion(form.region, to), `${from}→${to}`).toBeDefined();
      from = to;
    }
    // GCP 하나만 켜졌으면 오갈 곳이 없어 폼이 그대로다(0.1 동작 불변)
    if (ENABLED_PROVIDERS.length === 1) expect(form).toBe(DEFAULT_FORM);
  });
});
