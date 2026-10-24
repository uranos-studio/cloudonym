// 경로 분기 (D57 · D68 · D98 · D106 · D109 · D129) — 경로 표와 routeOf 는 Worker 와 같이 쓰는 src/site/pages 가 정본이다. 화면은 여기서 다시 내보낸 것을 쓴다.
// 라우터 의존성 없이 pathname 하나로 고른다 — 모르는 경로는 notFound(서버도 같은 표로 404 를 준다)
import { HOME_PATH, PICK_PATH, wizardPath, wizardRouteOf, type Route, type WizardCloud } from '../site/pages';
import { pageText } from '../site/copy';
import { decodeWizardState, hashKind } from './urlState';

export { ABOUT_PATH, API_PATH, HOME_PATH, NAMING_PATH, PICK_PATH, PRIVACY_PATH, WIZARD_PATHS, routeOf, wizardPath, wizardRouteOf, type Route, type WizardCloud } from '../site/pages';

/** 앱 상태 hash 꼴 — `#state=` 뒤 Base64(url) 글자만. 다른 hash 는 싣지 않는다 */
const STATE_HASH_RE = /^#state=[A-Za-z0-9_\-+/=]+$/;

/** 앱 ↔ 문서 경로를 오갈 때 상태 hash 를 실어 간다 — 문서에서 돌아와도 입력 · 선택이 남는다. hash 는 서버로 가지 않는다 */
export function withStateHash(path: string, hash: string): string {
  return STATE_HASH_RE.test(hash) ? `${path}${hash}` : path;
}

/** 상태 hash 가 열릴 화면의 경로 (D129) — 마법사 꼴은 그 클라우드의 마법사(c 가 없으면 gcp), 트리 꼴은 /pick, 그 밖(빈 · 깨진 hash)은 소개 페이지 */
export function appPathFor(hash: string): string {
  const kind = hashKind(hash);
  if (kind === 'tree') return PICK_PATH;
  if (kind === 'wizard') {
    const d = decodeWizardState(hash);
    if (d) return wizardPath(d.provider);
  }
  return HOME_PATH;
}

/** 문서 쪽의 「Back」 — 상태 hash 가 열릴 화면으로, hash 를 실어 간다. 깨진 hash 는 싣지 않는다 */
export function backToAppHref(hash: string): string {
  const path = appPathFor(hash);
  return path === HOME_PATH ? HOME_PATH : withStateHash(path, hash);
}

/** 진입 때 옮길 곳 (D76 · D129) — main.tsx 한 곳에서만 부른다(마법사는 받은 클라우드를 믿는다 — 두 곳에서 옮기면 두 번 뛴다).
 *  소개 페이지 · 마법사 경로에서: 트리 꼴 hash 는 /pick, 온전한 마법사 hash 는 그 클라우드의 경로(지금 경로와 같으면 머문다).
 *  빈 · 깨진 hash 는 머문다 — 소개 페이지는 hash 를 보지 않고, 마법사는 깨진 링크 안내를 띄운다. 옮길 곳이 없으면 undefined */
/** 소개 페이지가 떠 있는 동안 같은 문서 안에서 hash 만 바뀌면(옛 공유 링크를 주소창에 붙여 넣기 등) start() 가 다시 돌지 않는다 —
 *  그때도 진입과 같은 규칙으로 옮긴다. 옮길 곳이 없는 hash 는 그대로 둔다. 떼는 함수를 돌려준다 */
export function watchHomeHash(win: Pick<Window, 'addEventListener' | 'removeEventListener'> & { location: Pick<Location, 'search' | 'hash' | 'replace'> }): () => void {
  const onHash = () => {
    const target = entryRedirect('home', win.location.search, win.location.hash);
    if (target !== undefined) win.location.replace(target);
  };
  win.addEventListener('hashchange', onHash);
  return () => win.removeEventListener('hashchange', onHash);
}

export function entryRedirect(route: Route, search: string, hash: string): string | undefined {
  if (route !== 'home' && wizardRouteOf(route) === undefined) return undefined;
  const kind = hashKind(hash);
  if (kind === 'tree') return PICK_PATH + search + hash;
  if (kind !== 'wizard') return undefined;
  const d = decodeWizardState(hash);
  if (!d || d.provider === route) return undefined;
  return wizardPath(d.provider) + search + hash;
}

/** 화면 안에서 클라우드를 바꾼 뒤 주소창의 경로 · 제목을 맞춘다 (D129) — 다시 불러오지 않는다(적어 둔 값이 남는다). query · hash 는 그대로 */
export function moveToCloud(
  provider: WizardCloud,
  w: { location: { search: string; hash: string }; history: { replaceState(data: unknown, unused: string, url: string): void }; document: { title: string } } = window,
): void {
  w.history.replaceState(null, '', wizardPath(provider) + w.location.search + w.location.hash);
  w.document.title = pageText(provider).title;
}
