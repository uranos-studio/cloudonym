// 화면 경로 표 (D57 · D68 · D98 · D106 · D109 · D129) — 화면(src/components)과 Worker(src/api)가 같이 쓴다. 들여오는 것이 없는 순수 모듈이다.
// Worker 는 이 표로 경로마다 head · 상태 코드(모르는 경로는 404)를 고르고 /sitemap.xml 을 만든다. 화면은 같은 routeOf 로 그릴 쪽을 고른다

/** 소개 페이지 (D129) — 한 문장 · 움직이는 소개 · 클라우드 카드. 마법사는 클라우드마다 제 경로(WIZARD_PATHS)에 있다 */
export const HOME_PATH = '/';
/** 마법사가 다루는 클라우드 — 엔진의 WIZARD_PROVIDERS 와 같은 글자(components/wizardPaths.test 가 대어 본다).
 *  이 파일은 아무것도 들여오지 않으므로(import type 도 경계 시험에 걸린다) 글자 그대로 적는다 */
export type WizardCloud = 'aws' | 'gcp';
/** 클라우드마다 마법사 경로 (D129) — provider id 가 그대로 경로다(hash 의 c · API enum · CLI provider 와 같은 낱말). Azure 는 켜는 날 한 줄 더한다 */
export const WIZARD_PATHS: Readonly<Record<WizardCloud, string>> = { aws: '/aws', gcp: '/gcp' };
/** 트리 화면(리소스 고르기) — 트리 Share URL 의 자리 (D68). 트리 꼴 hash 로 뿌리를 열면 이 경로로 옮긴다 (D76) */
export const PICK_PATH = '/pick';
export const NAMING_PATH = '/docs/naming';
/** 사람이 읽는 API 안내 (D98) */
export const API_PATH = '/docs/api';
export const PRIVACY_PATH = '/privacy';
/** 무엇인가 · 소스 · 라이선스 · 버전 (D109) */
export const ABOUT_PATH = '/about';

/** 'notFound' 는 표에 없는 경로 — 서버는 404 로, 화면은 「찾을 수 없음」으로 답한다 (D106) */
export type Route = 'home' | 'aws' | 'gcp' | 'pick' | 'naming' | 'api' | 'privacy' | 'about' | 'notFound';
export type PageRoute = Exclude<Route, 'notFound'>;

/** 검색 엔진에 내보이는 경로 — /sitemap.xml 의 순서이기도 하다. 경로마다 쪽 하나(canonical) */
export const PAGES: readonly { route: PageRoute; path: string }[] = [
  { route: 'home', path: HOME_PATH },
  { route: 'aws', path: WIZARD_PATHS.aws },
  { route: 'gcp', path: WIZARD_PATHS.gcp },
  { route: 'pick', path: PICK_PATH },
  { route: 'naming', path: NAMING_PATH },
  { route: 'api', path: API_PATH },
  { route: 'privacy', path: PRIVACY_PATH },
  { route: 'about', path: ABOUT_PATH },
];

/** 끝의 `/` 는 떼고 대어 본다(`/pick/` 은 `/pick`) — 표에 없는 경로는 notFound */
export function routeOf(pathname: string): Route {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (p === '') return 'home';
  return PAGES.find((x) => x.path === p)?.route ?? 'notFound';
}

/** 경로의 canonical 자리 — 끝 `/` · query 를 뗀 표의 경로 */
export function pathOf(route: PageRoute): string {
  return PAGES.find((x) => x.route === route)!.path;
}

/** 클라우드의 마법사 경로 — aws · gcp 는 제 경로, 그 밖(undefined · 아직 꺼진 azure · 모르는 글자)은 소개 페이지 `/`.
 *  트리 화면의 provider 는 Provider | undefined 라 옛 azure 링크도 그대로 받는다. `in` 이 아니라 글자로 대어 본다(constructor 같은 이름이 통과하지 않게) */
export function wizardPath(provider: string | undefined): string {
  return provider === 'aws' || provider === 'gcp' ? WIZARD_PATHS[provider] : HOME_PATH;
}

/** 경로의 클라우드 — 마법사 route 면 그 클라우드, 아니면 undefined */
export function wizardRouteOf(route: Route): WizardCloud | undefined {
  return route === 'aws' || route === 'gcp' ? route : undefined;
}
