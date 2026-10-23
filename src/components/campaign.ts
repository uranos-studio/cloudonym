// 캠페인 출처 (D122) — 지도 사이트의 자체 광고 링크(?utm_source=<지도 id>&utm_medium=house_ad&utm_campaign=map)로 온 탭을 그 출처로 센다.
// 쿠키 · localStorage · 식별자를 쓰지 않는다. 출처 이름 하나만 sessionStorage 에 두어 같은 탭의 비콘(ui_visit · ui_generate · ui_copy)이 src 로 싣는다
/** beacon.ts 의 StorageLike 와 같은 꼴 — beacon.ts 를 들이지 않는다(api 시험이 이 파일을 들인다 · worker 타입 검사에 화면 코드가 끌려오지 않게) */
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }

/** 서버(telemetry.ts 의 CAMPAIGN_SRC_RE)와 같은 정규식 — campaign-src.test 가 둘을 대어 본다 */
export const CAMPAIGN_SRC_PATTERN = /^[a-z0-9-]{1,32}$/;
export const CAMPAIGN_MEDIUM = 'house_ad';
export const CAMPAIGN_KEY = 'cloudonym:campaign_src';

/** query 에서 출처를 읽는다 — utm_medium 이 house_ad 이고 utm_source 가 정규식에 맞을 때만 */
export function campaignFromSearch(search: string): string | undefined {
  const q = new URLSearchParams(search);
  const src = q.get('utm_source');
  if (q.get('utm_medium') !== CAMPAIGN_MEDIUM || src === null || !CAMPAIGN_SRC_PATTERN.test(src)) return undefined;
  return src;
}

/** 저장된 출처 — 저장소가 없거나 던지거나 값이 깨졌으면 undefined */
export function storedCampaign(storage: StorageLike | undefined): string | undefined {
  try {
    const v = storage?.getItem(CAMPAIGN_KEY) ?? null;
    return v !== null && CAMPAIGN_SRC_PATTERN.test(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** 첫 로드에 부른다 — 맞는 utm 이면 저장하고 그 값을, 아니면 이미 저장된 값을 돌려준다 */
export function captureCampaign(search: string, storage: StorageLike | undefined): string | undefined {
  const src = campaignFromSearch(search);
  if (src === undefined) return storedCampaign(storage);
  try {
    storage?.setItem(CAMPAIGN_KEY, src);
  } catch {
    // 저장소가 막혀 있으면 이번 로드만 모른다
  }
  return src;
}

/** utm_* 를 지운 주소(pathname + 남은 query + hash). 지울 것이 없으면 undefined */
export function stripUtm(pathname: string, search: string, hash: string): string | undefined {
  const q = new URLSearchParams(search);
  const utm = [...q.keys()].filter((k) => k.startsWith('utm_'));
  if (utm.length === 0) return undefined;
  for (const k of utm) q.delete(k);
  const rest = q.toString();
  return `${pathname}${rest ? `?${rest}` : ''}${hash}`;
}
