// 경로 분기 (D57) — `/docs/naming` · `/privacy` 는 SPA 경로다(wrangler 의 not_found_handling 이 index.html 을 준다). 라우터 의존성 없이 pathname 하나로 고른다
export type Route = 'app' | 'naming' | 'privacy';

export const NAMING_PATH = '/docs/naming';
export const PRIVACY_PATH = '/privacy';

/** 끝의 `/` 는 떼고 대어 본다 — 모르는 경로는 화면(app)이다 */
export function routeOf(pathname: string): Route {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (p === NAMING_PATH) return 'naming';
  if (p === PRIVACY_PATH) return 'privacy';
  return 'app';
}
