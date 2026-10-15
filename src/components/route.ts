// 경로 분기 (D57 · D68 · D98 · D106 · D109) — 경로 표와 routeOf 는 Worker 와 같이 쓰는 src/site/pages 가 정본이다. 화면은 여기서 다시 내보낸 것을 쓴다.
// 라우터 의존성 없이 pathname 하나로 고른다 — 모르는 경로는 notFound(서버도 같은 표로 404 를 준다)
export { ABOUT_PATH, API_PATH, NAMING_PATH, PICK_PATH, PRIVACY_PATH, WIZARD_PATH, routeOf, type Route } from '../site/pages';

/** 앱 상태 hash 꼴 — `#state=` 뒤 Base64(url) 글자만. 다른 hash 는 싣지 않는다 */
const STATE_HASH_RE = /^#state=[A-Za-z0-9_\-+/=]+$/;

/** 앱 ↔ 문서 경로를 오갈 때 상태 hash 를 실어 간다 — 문서에서 돌아와도 입력 · 선택이 남는다. hash 는 서버로 가지 않는다 */
export function withStateHash(path: string, hash: string): string {
  return STATE_HASH_RE.test(hash) ? `${path}${hash}` : path;
}
