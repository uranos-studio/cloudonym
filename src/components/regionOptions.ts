// 지역 고르기의 판정 (D49 · D50 · 계획 6-2) — 콤보박스(RegionPicker.tsx)가 그리는 항목 · 거르기 · 폼의 지역 문자열 하나 ↔ 리전 + 존.
// 표는 core 의 지역 표가 정본이다. 존은 따로 칸을 두지 않고 region 문자열 하나에 든다(오너 결정 Z2)
import { REGIONS, type ZoneEntry } from '../core/regions-data';
import type { Provider } from '../core/types';

export interface RegionOption {
  /** 리전 이름 — 고르면 폼에 들어가는 값. global 은 'global' */
  value: string;
  /** 이름에 들어가는 코드 — global 은 빈 문자열(토큰이 없다) */
  code: string;
  /** 위치(도시 · 나라) — global 은 빈 문자열(화면이 사전 문구를 쓴다) */
  label: string;
  zones: readonly ZoneEntry[];
}

const GLOBAL: RegionOption = { value: 'global', code: '', label: '', zones: [] };

/** 그 CSP 의 리전(표 순서) + global */
export function regionOptions(provider: Provider): RegionOption[] {
  return [...REGIONS[provider].map((r) => ({ value: r.region, code: r.code, label: r.label, zones: r.zones })), GLOBAL];
}

/** 지역 표 label 끝의 대륙 꼬리 — GCP label 은 「도시, 나라, 대륙」 꼴이다. 화면에 보일 때만 뗀다(표 · 거르기는 그대로라 「apac」 으로도 찾는다) */
const CONTINENT_TAILS: ReadonlySet<string> = new Set(['APAC', 'Europe', 'Middle East', 'North America', 'South America', 'Africa']);

/** 화면에 보일 위치 — 쉼표로 나뉜 마지막 조각이 대륙이면 뗀다(「Seoul, South Korea, APAC」 → 「Seoul, South Korea」). 조각이 하나면 그대로 */
export function displayLabel(label: string): string {
  const parts = label.split(', ');
  return parts.length > 1 && CONTINENT_TAILS.has(parts.at(-1)!) ? parts.slice(0, -1).join(', ') : label;
}

/** 리전 이름 · 위치 · 코드 · 존 이름 · 존 코드의 부분 문자열로 거른다(대소문자 · 앞뒤 공백 무시). 빈 검색어는 전부 */
export function filterRegions(options: readonly RegionOption[], query: string): RegionOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...options];
  return options.filter((o) => [o.value, o.code, o.label, ...o.zones.flatMap((z) => [z.zone, z.code])].some((s) => s.toLowerCase().includes(q)));
}

/** 폼의 지역 문자열 → 고른 리전 · 존. 이름 · 코드 어느 꼴이든 core 가 푼 코드로 항목을 찾는다. 모르는 값이면 둘 다 없음 */
export function splitRegion(input: string, options: readonly RegionOption[]): { region?: RegionOption; zone?: ZoneEntry } {
  const key = input.trim().toLowerCase();
  if (key === 'global') return { region: options.find((o) => o.value === 'global') };
  for (const o of options) {
    if (o.value === 'global') continue;
    const zone = o.zones.find((z) => z.zone === key || z.code === key);
    if (zone) return { region: o, zone };
    if (o.value === key || o.code === key) return { region: o };
  }
  return {};
}

/** 리전 + 존 → 폼의 지역 문자열 — 존이 있으면 존 이름, 없으면 리전 이름 */
export function composeRegion(region: RegionOption, zone?: ZoneEntry): string {
  return zone ? zone.zone : region.value;
}

/** 리전을 바꿀 때의 존 — 같은 글자의 존이 새 리전에 있으면 그것, 없으면 none(undefined) */
export function zoneAfter(previous: ZoneEntry | undefined, next: RegionOption): ZoneEntry | undefined {
  if (!previous) return undefined;
  const letter = previous.zone.slice(previous.zone.lastIndexOf('-') + 1);
  return next.zones.find((z) => z.zone.endsWith(`-${letter}`));
}

