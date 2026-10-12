// 버킷 이름을 지금 쓸 수 있는가 (D83) — 사용자가 「Check」를 누를 때만, 사용자의 브라우저가 Cloud Storage JSON API 에 인증 없이 직접 묻는다.
// Cloudonym 서버(Worker)를 거치지 않는다 — 이름은 Google 에만 간다. 자동 조회 · 캐시 · 계측 없음.
// 실측(2026-10-12, 로컬 화면 Origin 에서 fetch): 없는 버킷 404 · 공개 버킷 200 · 비공개 버킷 401 · 꼴이 틀린 이름 400, 넷 다
// `access-control-allow-origin: <요청 Origin>` 이 와서 브라우저가 상태 코드를 읽을 수 있다

import { AVAILABILITY_ORIGIN } from './availabilityOrigin';

/** CSP connect-src(public/_headers) · /privacy 안내가 이 값과 같은지 src/api/privacy-sync.test 가 본다 */
export { AVAILABILITY_ORIGIN };
/** 응답을 기다리는 시간 — 넘으면 unknown */
export const AVAILABILITY_TIMEOUT_MS = 8000;

export type Availability = 'available' | 'taken' | 'unknown';

/** 상태 코드 → 판정. 404 만 「쓸 수 있다」 — 있는 버킷은 공개면 200, 비공개면 401 · 403. 그 밖(400 · 429 · 5xx)은 모른다 */
export function classifyBucketStatus(status: number): Availability {
  if (status === 404) return 'available';
  if (status === 200 || status === 401 || status === 403) return 'taken';
  return 'unknown';
}

/** 버킷 메타데이터 GET — 이름만 돌려받는다(fields=name) */
export function bucketLookupUrl(name: string): string {
  return `${AVAILABILITY_ORIGIN}/storage/v1/b/${encodeURIComponent(name)}?fields=name`;
}

/** 브라우저에서 묻는다 — 쿠키 · Referer 를 싣지 않는다. 네트워크 오류 · 시간 초과는 unknown */
export async function checkBucketName(name: string, fetchFn: typeof fetch = fetch, timeoutMs = AVAILABILITY_TIMEOUT_MS): Promise<Availability> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(bucketLookupUrl(name), { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: ctrl.signal });
    return classifyBucketStatus(res.status);
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timer);
  }
}
