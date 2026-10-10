import { describe, it, expect } from 'vitest';
import { displayLabel, filterRegions, regionOptions, splitRegion } from './regionOptions';
import { canonicalRegion } from '../core/regions';
import { REGIONS } from '../core/regions-data';

const gcp = regionOptions('gcp');
const byValue = (v: string) => gcp.find((o) => o.value === v)!;

describe('regionOptions — 그 CSP 의 리전 표 + global (D49)', () => {
  it('GCP 43 + global 44 · 표 순서 그대로 · global 은 맨 끝', () => {
    expect(gcp).toHaveLength(REGIONS.gcp.length + 1);
    expect(REGIONS.gcp).toHaveLength(43);
    expect(gcp.slice(0, -1).map((o) => o.value)).toEqual(REGIONS.gcp.map((r) => r.region));
    expect(gcp.at(-1)).toMatchObject({ value: 'global', code: '', zones: [] });
  });
  it('항목마다 이름 · 코드 · 위치 · 존이 지역 표와 같다', () => {
    expect(byValue('asia-northeast3')).toMatchObject({ code: 'ane3', label: 'Seoul, South Korea, APAC' });
    expect(byValue('asia-northeast3').zones.map((z) => z.zone)).toEqual(['asia-northeast3-a', 'asia-northeast3-b', 'asia-northeast3-c']);
    expect(byValue('us-central1').zones.map((z) => z.code)).toContain('usc1f');
  });
  it('세 CSP 모두 항목이 풀린다 — 고른 값을 core 가 받는다', () => {
    for (const p of ['gcp', 'aws', 'azure'] as const) for (const o of regionOptions(p)) expect(canonicalRegion(o.value, p), `${p} ${o.value}`).toBeDefined();
  });
});

describe('filterRegions — 리전 이름 · 위치 · 코드로 거른다 (대소문자 무시)', () => {
  it('seoul → 한 줄 (asia-northeast3)', () => {
    expect(filterRegions(gcp, 'seoul').map((o) => o.value)).toEqual(['asia-northeast3']);
    expect(filterRegions(gcp, '  SEOUL ').map((o) => o.value)).toEqual(['asia-northeast3']);
  });
  it('코드 · 이름 일부 · 나라로도 걸린다', () => {
    expect(filterRegions(gcp, 'ane3').map((o) => o.value)).toEqual(['asia-northeast3']);
    expect(filterRegions(gcp, 'northeast').map((o) => o.value)).toEqual(['asia-northeast1', 'asia-northeast2', 'asia-northeast3', 'northamerica-northeast1', 'northamerica-northeast2']);
    expect(filterRegions(gcp, 'japan').map((o) => o.value)).toEqual(['asia-northeast1', 'asia-northeast2']);
    expect(filterRegions(gcp, 'glob').map((o) => o.value)).toEqual(['global']);
  });
  it('존 이름 · 존 코드를 넣으면 그 리전이 걸린다', () => {
    expect(filterRegions(gcp, 'asia-northeast3-b').map((o) => o.value)).toEqual(['asia-northeast3']);
    expect(filterRegions(gcp, 'ane3b').map((o) => o.value)).toEqual(['asia-northeast3']);
  });
  it('빈 검색어는 전부 · 걸리는 것이 없으면 빈 배열', () => {
    expect(filterRegions(gcp, '')).toHaveLength(44);
    expect(filterRegions(gcp, 'mars')).toEqual([]);
  });
});

describe('splitRegion — 폼의 지역 문자열 → 리전 (존 입력도 그 리전으로 · D50 revised)', () => {
  it.each([
    ['asia-northeast3-a', 'asia-northeast3', 'asia-northeast3-a'],
    ['ane3a', 'asia-northeast3', 'asia-northeast3-a'],
    ['ASIA-NORTHEAST3', 'asia-northeast3', undefined],
    ['ane3', 'asia-northeast3', undefined],
    ['global', 'global', undefined],
  ])('%s → 리전 %s · 존 %s', (input, region, zone) => {
    const s = splitRegion(input, gcp);
    expect(s.region?.value).toBe(region);
    expect(s.zone?.zone).toBe(zone);
  });
  it('모르는 값은 리전 없음 — 옛 나라 값 kr 도', () => {
    expect(splitRegion('kr', gcp)).toEqual({});
    expect(splitRegion('', gcp)).toEqual({});
  });
});


describe('displayLabel — 화면의 위치에서 대륙 꼬리를 뗀다', () => {
  it.each([
    ['Seoul, South Korea, APAC', 'Seoul, South Korea'],
    ['Hong Kong, APAC', 'Hong Kong'],
    ['Osasco, São Paulo, Brazil, South America', 'Osasco, São Paulo, Brazil'],
    ['Johannesburg, South Africa', 'Johannesburg, South Africa'],
    ['Korea Central', 'Korea Central'],
    ['Asia Pacific (Seoul)', 'Asia Pacific (Seoul)'],
  ])('%s → %s', (label, shown) => {
    expect(displayLabel(label)).toBe(shown);
  });
  it('GCP 43 리전 전부 — 보이는 위치에 대륙 낱말이 끝에 남지 않고 비지 않는다 · 거르기는 대륙으로도 된다', () => {
    for (const r of REGIONS.gcp) {
      const shown = displayLabel(r.label);
      expect(shown, r.region).not.toMatch(/, (?:APAC|Europe|Middle East|North America|South America)$/);
      expect(shown.length, r.region).toBeGreaterThan(0);
    }
    expect(filterRegions(regionOptions('gcp'), 'apac').length).toBeGreaterThan(1);
  });
});
