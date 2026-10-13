// 화면 모드 (D94) — 첫 칠(paint) 전에 <html> 에 dark 클래스를 단다. 모듈이 아닌 동기 스크립트라 CSS 보다 먼저 돈다(CSP script-src 'self' — 인라인 스크립트는 쓰지 않는다).
// 고른 값은 localStorage 'cloudonym:theme' 하나(light · dark · system). 없거나 저장소가 막혔으면 system — 기기 설정(prefers-color-scheme)을 따른다.
// 같은 판정을 src/components/theme.ts 가 React 안에서 한다 — 두 곳의 키 · 값이 같아야 한다(theme.test.ts 가 이 파일을 읽어 대어 본다)
(function () {
  var mode = null;
  try {
    mode = window.localStorage.getItem('cloudonym:theme');
  } catch {
    mode = null;
  }
  if (mode !== 'light' && mode !== 'dark') mode = 'system';
  var dark = mode === 'dark' || (mode === 'system' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var root = document.documentElement;
  if (dark) root.classList.add('dark');
  else root.classList.remove('dark');
  root.setAttribute('data-theme', mode);
})();
