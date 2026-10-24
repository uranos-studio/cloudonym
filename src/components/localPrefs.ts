// 브라우저에 남기는 화면 설정 (D93 · D94) — localStorage 키 둘. 서버로 보내지 않고 공유 링크(hash)에도 싣지 않는다.
// 사생활 보호 모드 · 저장소 차단에서는 접근이 던지거나 비어 있다 — 그때도 화면은 기본값(안내 보임 · System)으로 정상이다
export const INTRO_KEY = 'cloudonym:intro_dismissed_v2';
export const THEME_KEY = 'cloudonym:theme';

/** localStorage 읽기 — 막혔거나 없으면 null */
export function readPref(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** localStorage 쓰기 · 지우기(null) — 막혔으면 조용히 넘어간다(이번 화면에서만 적용된다) */
export function writePref(key: string, value: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // 저장소가 막힌 브라우저 — 설정은 이 탭에서만 산다
  }
}

/** 소개 상자를 닫았는가 (D93) — 첫 화면의 열림을 정한다 */
export function introDismissed(): boolean {
  return readPref(INTRO_KEY) === '1';
}

/** 소개 상자의 닫힘을 기억하거나(닫기) 지운다(/about 의 「Show the intro in the wizard again」 · D109 · D129 — 다시 닫을 때까지 보인다) */
export function rememberIntroDismissed(dismissed: boolean): void {
  writePref(INTRO_KEY, dismissed ? '1' : null);
}
