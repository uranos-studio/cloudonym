// 경로 분기 (D57 · D68 · D98) — `/pick` · `/docs/naming` · `/docs/api` · `/privacy` 는 SPA 경로다(wrangler 의 not_found_handling 이 index.html 을 준다). 라우터 의존성 없이 pathname 하나로 고른다
export type Route = 'app' | 'pick' | 'naming' | 'api' | 'privacy';

export const NAMING_PATH = '/docs/naming';
/** 사람이 읽는 API 안내 (D98) */
export const API_PATH = '/docs/api';
export const PRIVACY_PATH = '/privacy';
/** 트리 화면(리소스 고르기) — 트리 Share URL 의 자리 (D68). 뿌리 `/` 는 늘 마법사다 — 트리 꼴 hash 는 이 경로로 옮긴다 (D76) */
export const PICK_PATH = '/pick';
export const WIZARD_PATH = '/';

/** 끝의 `/` 는 떼고 대어 본다 — 모르는 경로는 화면(app)이다 */
export function routeOf(pathname: string): Route {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (p === NAMING_PATH) return 'naming';
  if (p === API_PATH) return 'api';
  if (p === PRIVACY_PATH) return 'privacy';
  if (p === PICK_PATH) return 'pick';
  return 'app';
}

/** 앱 상태 hash 꼴 — `#state=` 뒤 Base64(url) 글자만. 다른 hash 는 싣지 않는다 */
const STATE_HASH_RE = /^#state=[A-Za-z0-9_\-+/=]+$/;

/** 앱 ↔ 문서 경로를 오갈 때 상태 hash 를 실어 간다 — 문서에서 돌아와도 입력 · 선택이 남는다. hash 는 서버로 가지 않는다 */
export function withStateHash(path: string, hash: string): string {
  return STATE_HASH_RE.test(hash) ? `${path}${hash}` : path;
}
