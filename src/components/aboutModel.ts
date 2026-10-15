// /about 의 값 (D109) — 소스 저장소 URL 은 여기 한 곳에만 둔다(about.test 가 src 안의 다른 자리를 센다).
// 쪽은 이 URL 로 가는 평범한 링크만 건다 — github.com 에 요청을 보내지 않는다(별 수 · fetch 없음 · CSP 그대로)

/** 공개 소스 저장소 */
export const SOURCE_REPOSITORY_URL = 'https://github.com/uranos-studio/cloudonym';

/** 저장소 안 파일의 URL — LICENSE · NOTICE 링크 */
export function repositoryFileUrl(file: string): string {
  return `${SOURCE_REPOSITORY_URL}/blob/main/${file}`;
}

/** 링크 글자 — 스킴을 뗀 꼴(github.com/…) */
export function repositoryLabel(url: string = SOURCE_REPOSITORY_URL): string {
  return url.replace(/^https:\/\//, '');
}
