// 화면 경로 표 (D57 · D68 · D98 · D106) — 화면(src/components)과 Worker(src/api)가 같이 쓴다. 들여오는 것이 없는 순수 모듈이다.
// Worker 는 이 표로 경로마다 head · 상태 코드(모르는 경로는 404)를 고르고 /sitemap.xml 을 만든다. 화면은 같은 routeOf 로 그릴 쪽을 고른다

export const WIZARD_PATH = '/';
/** 트리 화면(리소스 고르기) — 트리 Share URL 의 자리 (D68). 뿌리 `/` 는 늘 마법사다 — 트리 꼴 hash 는 이 경로로 옮긴다 (D76) */
export const PICK_PATH = '/pick';
export const NAMING_PATH = '/docs/naming';
/** 사람이 읽는 API 안내 (D98) */
export const API_PATH = '/docs/api';
export const PRIVACY_PATH = '/privacy';

/** 'notFound' 는 표에 없는 경로 — 서버는 404 로, 화면은 「찾을 수 없음」으로 답한다 (D106) */
export type Route = 'app' | 'pick' | 'naming' | 'api' | 'privacy' | 'notFound';
export type PageRoute = Exclude<Route, 'notFound'>;

/** 검색 엔진에 내보이는 경로 — /sitemap.xml 의 순서이기도 하다. 경로마다 쪽 하나(canonical) */
export const PAGES: readonly { route: PageRoute; path: string }[] = [
  { route: 'app', path: WIZARD_PATH },
  { route: 'pick', path: PICK_PATH },
  { route: 'naming', path: NAMING_PATH },
  { route: 'api', path: API_PATH },
  { route: 'privacy', path: PRIVACY_PATH },
];

/** 끝의 `/` 는 떼고 대어 본다(`/pick/` 은 `/pick`) — 표에 없는 경로는 notFound */
export function routeOf(pathname: string): Route {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (p === '') return 'app';
  return PAGES.find((x) => x.path === p)?.route ?? 'notFound';
}

/** 경로의 canonical 자리 — 끝 `/` · query 를 뗀 표의 경로 */
export function pathOf(route: PageRoute): string {
  return PAGES.find((x) => x.route === route)!.path;
}
