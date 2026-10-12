// 지역 · 존 (D49 · D50) — 생성 파일 regions-data.ts 의 표를 읽는 순수 함수.
// 받는 꼴은 그 CSP 의 리전 이름 · 존 이름 · 리전 코드 · 존 코드 · global 이다. 옛 나라 값(kr · us …) · 다른 CSP 의 리전 이름은 받지 않는다
import type { Provider, ResourceRule } from './types';
import type { CoreMessage } from './messages';
import { LOCATIONS, REGIONS, type LocationEntry, type RegionEntry, type ZoneEntry } from './regions-data';
import { regionTokenOfRule } from './compose';

export type { LocationEntry, RegionEntry, ZoneEntry };

/** 이름에 들어가는 지역 자리의 최장 길이 — 리전 · 존 코드 · 멀티/이중 리전 코드 전부에서 잰다(GCP 존 ause1a 6자). 공유 hash 상한식이 쓴다 */
export const MAX_REGION_CHARS: number = Math.max(
  ...Object.values(REGIONS).flatMap((rs) => rs.flatMap((r) => [r.code.length, ...r.zones.map((z) => z.code.length)])),
  ...Object.values(LOCATIONS).flatMap((ls) => ls.map((l) => l.code.length)),
);

/** 기본이 전역인 규칙(defaultLocation 'global' — Secret)의 마법사 pick 위치 값 (D79) — 전역 대신 프로젝트 지역에 둔다(지역 Secret).
 *  멀티 · 이중 리전 표(LOCATIONS)의 값이 아니다 */
export const REGIONAL_LOCATION = 'regional';

/** 멀티 · 이중 리전 위치 (D78) — 위치 이름(US · ASIA1) · 코드(us · asia1)를 대소문자 없이 푼다. 리전 · 존 · global 이면 undefined */
export function canonicalLocation(raw: string, provider: Provider): LocationEntry | undefined {
  const key = raw.trim().toLowerCase();
  return LOCATIONS[provider].find((l) => l.code === key || l.location.toLowerCase() === key);
}

/** 그 규칙이 받는 멀티 · 이중 리전 위치 (D78) — 지역 토큰이 없는 규칙 · 표에 없는 규칙은 빈 목록 */
export function locationsFor(rule: Pick<ResourceRule, 'id' | 'provider' | 'regionToken' | 'template'>): readonly LocationEntry[] {
  if (regionTokenOfRule(rule) === 'none') return [];
  return LOCATIONS[rule.provider].filter((l) => Object.hasOwn(l.rules, rule.id));
}

/** 마법사 pick 의 위치 값 → 엔진에 넘길 값 (D78 · D79). 받지 않는 값이면 undefined.
 *  기본이 전역인 규칙(Secret)은 regional 하나, 그 밖은 그 규칙이 받는 멀티 · 이중 리전 위치(이름 · 코드, 대소문자 없이)를 코드로 */
export function pickLocation(rule: Pick<ResourceRule, 'id' | 'provider' | 'regionToken' | 'template' | 'defaultLocation'>, raw: string): string | undefined {
  if (rule.defaultLocation === 'global') return raw.trim().toLowerCase() === REGIONAL_LOCATION ? REGIONAL_LOCATION : undefined;
  const hit = canonicalLocation(raw, rule.provider);
  return hit && locationsFor(rule).includes(hit) ? hit.code : undefined;
}

/** pick 위치로 받는 값의 목록 — 오류 문장의 supported */
export function pickLocationNames(rule: Pick<ResourceRule, 'id' | 'provider' | 'regionToken' | 'template' | 'defaultLocation'>): string[] {
  return rule.defaultLocation === 'global' ? [REGIONAL_LOCATION] : locationsFor(rule).map((l) => l.location);
}

/** 문맥의 지역 값(엔진 문맥 — 코드)이 이 규칙에 맞지 않는 멀티 · 이중 리전 위치면 그 위치, 아니면 undefined (D78).
 *  지역 토큰이 없는 규칙은 지역을 이름에 쓰지 않으므로 늘 맞다 */
export function locationMismatch(region: string, rule: Pick<ResourceRule, 'id' | 'provider' | 'regionToken' | 'template' | 'defaultLocation'>): LocationEntry | undefined {
  const loc = LOCATIONS[rule.provider].find((l) => l.code === region);
  // 기본이 전역인 규칙은 문맥 지역을 이름에 쓰지 않는다 (D79)
  if (!loc || regionTokenOfRule(rule) === 'none' || rule.defaultLocation === 'global' || Object.hasOwn(loc.rules, rule.id)) return undefined;
  return loc;
}

/** 그 위치를 받는 규칙의 resourceType — 오류 문장의 후보 */
export function locationRuleTypes(loc: LocationEntry): string[] {
  return Object.keys(loc.rules).map((id) => id.slice(id.indexOf('.') + 1));
}

/** 요청 단위 검사 (D78) — 문맥 지역이 멀티 · 이중 리전 위치인데 그 위치를 받지 않는 규칙이 하나라도 있으면 오류 하나. API 가 400 으로 거부할 때 쓴다 */
export function locationError(region: string, rules: readonly Pick<ResourceRule, 'id' | 'provider' | 'regionToken' | 'template' | 'defaultLocation'>[]): CoreMessage | undefined {
  for (const r of rules) {
    const loc = locationMismatch(region, r);
    if (loc) return { code: 'context.location_unsupported', field: 'region', params: { value: loc.location, supported: locationRuleTypes(loc) } };
  }
  return undefined;
}

/** 옛 나라 값 → 그 나라의 리전 이름 (CSP 마다). 받지 않는 값이고, 거부할 때 supported 를 좁히는 데만 쓴다.
 *  korea · japan · europe 은 0.1.0 전 별칭이었다 */
const KR = { gcp: ['asia-northeast3'], aws: ['ap-northeast-2'], azure: ['koreacentral', 'koreasouth'] };
const JP = { gcp: ['asia-northeast1', 'asia-northeast2'], aws: ['ap-northeast-1', 'ap-northeast-3'], azure: ['japaneast', 'japanwest'] };
const US = {
  gcp: ['us-central1', 'us-east1', 'us-east4', 'us-east5', 'us-south1', 'us-west1', 'us-west2', 'us-west3', 'us-west4'],
  aws: ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2'],
  azure: ['centralus', 'eastus', 'eastus2', 'northcentralus', 'southcentralus', 'westcentralus', 'westus', 'westus2', 'westus3'],
};
const EU = {
  gcp: ['europe-north1', 'europe-north2', 'europe-central2', 'europe-southwest1', 'europe-west1', 'europe-west2', 'europe-west3', 'europe-west4',
        'europe-west6', 'europe-west8', 'europe-west9', 'europe-west10', 'europe-west12'],
  aws: ['eu-central-1', 'eu-west-1', 'eu-west-2', 'eu-south-1', 'eu-west-3', 'eu-south-2', 'eu-north-1', 'eu-central-2'],
  azure: ['austriaeast', 'belgiumcentral', 'denmarkeast', 'francecentral', 'francesouth', 'germanynorth', 'germanywestcentral', 'italynorth',
          'northeurope', 'norwayeast', 'norwaywest', 'polandcentral', 'spaincentral', 'swedencentral', 'switzerlandnorth', 'switzerlandwest',
          'uksouth', 'ukwest', 'westeurope'],
};
const byProvider = (p: Provider): Readonly<Record<string, readonly string[]>> => ({
  kr: KR[p], korea: KR[p], jp: JP[p], japan: JP[p], us: US[p], eu: EU[p], europe: EU[p],
});
export const COUNTRY_HINTS: Readonly<Record<Provider, Readonly<Record<string, readonly string[]>>>> = {
  gcp: byProvider('gcp'), aws: byProvider('aws'), azure: byProvider('azure'),
};

export interface CanonicalRegion { region: string; zone?: string }

/** 소문자 입력 → 푼 값. 리전 이름 · 리전 코드 · 존 이름 · 존 코드를 한 표에 둔다 — 겹침은 시험이 0 으로 센다 */
function indexOf(entries: readonly RegionEntry[]): ReadonlyMap<string, { entry: RegionEntry; zone?: ZoneEntry }> {
  const m = new Map<string, { entry: RegionEntry; zone?: ZoneEntry }>();
  for (const entry of entries) {
    m.set(entry.region.toLowerCase(), { entry });
    m.set(entry.code.toLowerCase(), { entry });
    for (const zone of entry.zones) {
      m.set(zone.zone.toLowerCase(), { entry, zone });
      m.set(zone.code.toLowerCase(), { entry, zone });
    }
  }
  return m;
}
const INDEX: Readonly<Record<Provider, ReturnType<typeof indexOf>>> = { gcp: indexOf(REGIONS.gcp), aws: indexOf(REGIONS.aws), azure: indexOf(REGIONS.azure) };

/** 지역 입력 → { region: 리전 코드 | 'global', zone?: 존 코드 }. 받지 않는 값이면 undefined */
export function canonicalRegion(raw: string, provider: Provider): CanonicalRegion | undefined {
  const key = raw.trim().toLowerCase();
  if (key === 'global') return { region: 'global' };
  const hit = INDEX[provider].get(key);
  if (!hit) return undefined;
  return hit.zone ? { region: hit.entry.code, zone: hit.zone.code } : { region: hit.entry.code };
}

/** 거부한 지역 입력의 후보 — 옛 나라 값이면 그 나라의 리전 이름, 아니면 그 CSP 의 리전 이름 전부(표 순서) */
export function regionCandidates(raw: string, provider: Provider): string[] {
  const hint = COUNTRY_HINTS[provider];
  const key = raw.trim().toLowerCase();
  return Object.hasOwn(hint, key) ? [...hint[key]!] : REGIONS[provider].map((r) => r.region);
}

/** 리전 · 존의 이름 · 코드 → 그 리전의 표시 이름(도시 · 나라). global · 모르는 값은 undefined */
export function regionLabel(value: string, provider: Provider): string | undefined {
  return INDEX[provider].get(value.trim().toLowerCase())?.entry.label;
}

/** 리전(이름 · 코드)의 존 — 존이 없는 CSP · 모르는 값은 빈 배열 */
export function zonesOf(value: string, provider: Provider): readonly ZoneEntry[] {
  return INDEX[provider].get(value.trim().toLowerCase())?.entry.zones ?? [];
}
