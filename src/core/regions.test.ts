import { describe, it, expect } from 'vitest';
import { COUNTRY_HINTS, MAX_REGION_CHARS, canonicalLocation, canonicalRegion, locationError, locationMismatch, locationsFor, regionLabel, zonesOf } from './regions';
import { LOCATIONS, REGIONS } from './regions-data';
import { RULES } from './constraints';
import { PROVIDERS } from './types';

describe('지역 표 (D49)', () => {
  it('GCP 리전 43 · 존 130 · AWS 34 · Azure 57', () => {
    expect(REGIONS.gcp).toHaveLength(43);
    expect(REGIONS.gcp.flatMap((r) => r.zones)).toHaveLength(130);
    expect(REGIONS.aws).toHaveLength(34);
    expect(REGIONS.azure).toHaveLength(57);
  });

  it('MAX_REGION_CHARS 는 표의 가장 긴 리전 · 존 코드 — GCP ause1a 6자', () => {
    const all = PROVIDERS.flatMap((p) => REGIONS[p].flatMap((r) => [r.code, ...r.zones.map((z) => z.code)]));
    expect(MAX_REGION_CHARS).toBe(Math.max(...all.map((c) => c.length)));
    expect(MAX_REGION_CHARS).toBe(6);
  });

  it('CSP 안에서 리전 이름 · 존 이름 · 리전 코드 · 존 코드가 서로 겹치지 않는다', () => {
    for (const p of PROVIDERS) {
      const keys = REGIONS[p].flatMap((r) => [r.region, r.code, ...r.zones.flatMap((z) => [z.zone, z.code])]);
      expect(keys.length - new Set(keys).size, p).toBe(0);
    }
  });

  /** 세 CSP 규칙 표의 약어 전부 — 이름 안에서 지역 코드와 약어가 같은 글자로 읽히는지 본다 */
  const slugs = new Set(Object.values(RULES).map((r) => r.slug));
  it('GCP 지역 코드는 어느 CSP 의 약어와도 겹치지 않는다', () => {
    const codes = REGIONS.gcp.flatMap((r) => [r.code, ...r.zones.map((z) => z.code)]);
    expect(codes.filter((c) => slugs.has(c))).toEqual([]);
  });

  it('약어와 같은 Azure 지역 코드는 정확히 ae · cus · ne 셋이다 (R6 미결 — 새 겹침은 여기서 잡힌다)', () => {
    expect(REGIONS.azure.map((r) => r.code).filter((c) => slugs.has(c)).sort()).toEqual(['ae', 'cus', 'ne']);
  });

  it('나라 힌트 표의 값은 모두 그 CSP 표에 있는 리전 이름이다', () => {
    for (const p of PROVIDERS) {
      const names = new Set(REGIONS[p].map((r) => r.region));
      for (const [hint, list] of Object.entries(COUNTRY_HINTS[p])) {
        expect(list.length, `${p} ${hint}`).toBeGreaterThan(0);
        expect(list.filter((n) => !names.has(n)), `${p} ${hint}`).toEqual([]);
      }
    }
  });

  it('나라 힌트 — GCP kr 은 asia-northeast3 하나 · us 는 9개', () => {
    expect(COUNTRY_HINTS.gcp.kr).toEqual(['asia-northeast3']);
    expect(COUNTRY_HINTS.gcp.us).toHaveLength(9);
    expect(COUNTRY_HINTS.aws.kr).toEqual(['ap-northeast-2']);
    expect(COUNTRY_HINTS.azure.kr).toEqual(['koreacentral', 'koreasouth']);
  });
});

describe('canonicalRegion (D49 · D50)', () => {
  it('GCP 리전 이름 → 코드', () => expect(canonicalRegion('asia-northeast3', 'gcp')).toEqual({ region: 'ane3' }));
  it('GCP 존 이름 → 리전 코드 + 존 코드', () => expect(canonicalRegion('asia-northeast3-a', 'gcp')).toEqual({ region: 'ane3', zone: 'ane3a' }));
  it('코드는 그대로 받는다 — 리전 코드 · 존 코드', () => {
    expect(canonicalRegion('ane3', 'gcp')).toEqual({ region: 'ane3' });
    expect(canonicalRegion('ane3a', 'gcp')).toEqual({ region: 'ane3', zone: 'ane3a' });
  });
  it('대소문자 · 앞뒤 공백은 보지 않는다', () => {
    expect(canonicalRegion('ANE3', 'gcp')).toEqual({ region: 'ane3' });
    expect(canonicalRegion(' Asia-Northeast3-B ', 'gcp')).toEqual({ region: 'ane3', zone: 'ane3b' });
  });
  it('global 은 모든 CSP 에서 그대로', () => {
    for (const p of PROVIDERS) expect(canonicalRegion('global', p)).toEqual({ region: 'global' });
  });
  it('옛 나라 값 · 나라 이름은 거부한다', () => {
    for (const v of ['kr', 'us', 'jp', 'eu', 'korea', 'japan', 'europe']) expect(canonicalRegion(v, 'gcp'), v).toBeUndefined();
  });
  it('다른 CSP 의 리전 이름은 거부한다 — ap-northeast-2 를 GCP 에 · asia-northeast3 를 Azure 에', () => {
    expect(canonicalRegion('ap-northeast-2', 'gcp')).toBeUndefined();
    expect(canonicalRegion('asia-northeast3', 'azure')).toBeUndefined();
    expect(canonicalRegion('koreacentral', 'aws')).toBeUndefined();
  });
  it('AWS ap-northeast-2 → apne2 · Azure koreacentral → krc', () => {
    expect(canonicalRegion('ap-northeast-2', 'aws')).toEqual({ region: 'apne2' });
    expect(canonicalRegion('koreacentral', 'azure')).toEqual({ region: 'krc' });
  });
  it('상속 프로퍼티 이름은 값이 아니다', () => {
    for (const v of ['constructor', '__proto__', 'toString']) expect(canonicalRegion(v, 'gcp'), v).toBeUndefined();
  });
  it('표의 모든 리전 · 존 이름과 코드가 풀린다', () => {
    for (const p of PROVIDERS) {
      for (const r of REGIONS[p]) {
        expect(canonicalRegion(r.region, p)).toEqual({ region: r.code });
        expect(canonicalRegion(r.code, p)).toEqual({ region: r.code });
        for (const z of r.zones) {
          expect(canonicalRegion(z.zone, p)).toEqual({ region: r.code, zone: z.code });
          expect(canonicalRegion(z.code, p)).toEqual({ region: r.code, zone: z.code });
        }
      }
    }
  });
});

describe('regionLabel · zonesOf', () => {
  it('리전 코드 · 존 코드 · 이름으로 그 리전의 표시 이름', () => {
    expect(regionLabel('ane3', 'gcp')).toBe('Seoul, South Korea, APAC');
    expect(regionLabel('ane3a', 'gcp')).toBe('Seoul, South Korea, APAC');
    expect(regionLabel('asia-northeast3', 'gcp')).toBe('Seoul, South Korea, APAC');
    expect(regionLabel('mars', 'gcp')).toBeUndefined();
    expect(regionLabel('global', 'gcp')).toBeUndefined();
  });
  it('리전의 존 — 이름 · 코드로 찾고, 존이 없는 CSP 는 빈 배열', () => {
    expect(zonesOf('asia-northeast3', 'gcp').map((z) => z.code)).toEqual(['ane3a', 'ane3b', 'ane3c']);
    expect(zonesOf('ane3', 'gcp').map((z) => z.zone)).toEqual(['asia-northeast3-a', 'asia-northeast3-b', 'asia-northeast3-c']);
    expect(zonesOf('ap-northeast-2', 'aws')).toEqual([]);
    expect(zonesOf('mars', 'gcp')).toEqual([]);
  });
});

describe('멀티 · 이중 리전 위치 (D78)', () => {
  const bucket = RULES['gcp.storage_bucket']!;
  const bq = RULES['gcp.bigquery_dataset']!;
  const vm = RULES['gcp.compute_instance']!;
  it('GCS 멀티 셋 · 이중(사전 정의) 여섯 · BigQuery 멀티 둘 — 규칙마다 공식 위치 문서 URL', () => {
    expect(LOCATIONS.gcp.map((l) => l.location)).toEqual(['US', 'EU', 'ASIA', 'ASIA1', 'EUR4', 'EUR5', 'EUR7', 'EUR8', 'NAM4']);
    expect(LOCATIONS.aws).toEqual([]);
    expect(LOCATIONS.azure).toEqual([]);
    for (const l of LOCATIONS.gcp) {
      expect(l.code, l.location).toBe(l.location.toLowerCase());
      for (const [id, url] of Object.entries(l.rules)) {
        expect(RULES[id], id).toBeDefined();
        expect(RULES[id]!.regionToken, id).toBe('region');
        expect(url, id).toMatch(id === 'gcp.bigquery_dataset' ? /^https:\/\/docs\.cloud\.google\.com\/bigquery\/docs\/locations#/ : /^https:\/\/docs\.cloud\.google\.com\/storage\/docs\/locations#/);
      }
    }
    expect(locationsFor(bucket).map((l) => l.code)).toEqual(['us', 'eu', 'asia', 'asia1', 'eur4', 'eur5', 'eur7', 'eur8', 'nam4']);
    expect(locationsFor(bq).map((l) => l.code)).toEqual(['us', 'eu']);
    expect(locationsFor(vm)).toEqual([]);
    expect(locationsFor(RULES['gcp.vpc_network']!)).toEqual([]);
  });
  it('위치 이름 · 코드를 대소문자 없이 푼다 — 리전 풀이(canonicalRegion)는 그대로 받지 않는다', () => {
    expect(canonicalLocation('US', 'gcp')?.code).toBe('us');
    expect(canonicalLocation(' asia1 ', 'gcp')?.location).toBe('ASIA1');
    expect(canonicalLocation('asia-northeast3', 'gcp')).toBeUndefined();
    expect(canonicalLocation('us', 'aws')).toBeUndefined();
    expect(canonicalRegion('us', 'gcp')).toBeUndefined();
  });
  it('받지 않는 규칙에만 어긋난다 — 지역 토큰이 없는 규칙은 늘 맞다 · 요청 단위 오류는 받는 resourceType 을 싣는다', () => {
    expect(locationMismatch('us', bucket)).toBeUndefined();
    expect(locationMismatch('ane3', vm)).toBeUndefined();
    expect(locationMismatch('us', vm)?.location).toBe('US');
    expect(locationMismatch('asia', bq)?.location).toBe('ASIA');
    expect(locationMismatch('us', RULES['gcp.vpc_network']!)).toBeUndefined();
    expect(locationError('eu', [bucket, bq])).toBeUndefined();
    expect(locationError('eu', [bucket, vm])).toEqual({ code: 'context.location_unsupported', field: 'region', params: { value: 'EU', supported: ['storage_bucket', 'bigquery_dataset'] } });
    expect(locationError('nam4', [bq])).toEqual({ code: 'context.location_unsupported', field: 'region', params: { value: 'NAM4', supported: ['storage_bucket'] } });
  });
});
