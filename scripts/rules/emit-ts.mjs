// 생성기가 TS 소스를 쓸 때의 리터럴 — 외부 원문(디스커버리 · 스키마 · 문서 표)의 문자열이 코드로 새지 않게 한다.
// 세 생성기(build-gcp/aws/azure-rules.mjs)가 같이 쓴다. 특수 문자가 없는 값은 예전 출력('${v}')과 바이트까지 같다

/** 홑따옴표 TS 문자열 리터럴 — JSON.stringify 로 이스케이프한 뒤 큰따옴표 이스케이프를 풀고 홑따옴표를 이스케이프한다.
 *  줄 바꿈 · 제어 문자 · 역슬래시 · U+2028/2029 가 들어와도 리터럴 밖으로 나가지 않는다 */
export function sq(v) {
  if (typeof v !== 'string') throw new Error(`문자열이 아니다: ${typeof v}`);
  const body = JSON.stringify(v).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'").replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `'${body}'`;
}

/** 큰따옴표 리터럴 — 예전처럼 JSON.stringify 그대로(displayName · raw 등) */
export const dq = (v) => {
  if (typeof v !== 'string') throw new Error(`문자열이 아니다: ${typeof v}`);
  return JSON.stringify(v);
};

/** 규칙 id · 범위 id(azure 는 `azure:a/b`) — 소문자 · 숫자 · `_ . : / -` 만. 아니면 생성을 멈춘다 */
export const ID_RE = /^[a-z0-9_.:/-]+$/;
/** API 메서드 이름(gcp `cloudkms.projects.locations.keyRings.create`) — 영숫자와 `. _ : -` 만 */
export const METHOD_RE = /^[A-Za-z0-9._:-]+$/;
export function idLit(v, re = ID_RE) {
  if (typeof v !== 'string' || !re.test(v)) throw new Error(`식별자 꼴이 아니다: ${JSON.stringify(v)}`);
  return `'${v}'`;
}

/** 정수 리터럴 — 숫자가 아니면 멈춘다 */
export function intLit(v) {
  if (!Number.isInteger(v)) throw new Error(`정수가 아니다: ${JSON.stringify(v)}`);
  return String(v);
}

/** 불리언 리터럴 */
export function boolLit(v) {
  if (typeof v !== 'boolean') throw new Error(`불리언이 아니다: ${JSON.stringify(v)}`);
  return String(v);
}

/** 정규식 리터럴 `/…/flags` — 줄 끝 문자 · 이스케이프 안 된 `/` 가 없고, 같은 플래그로 컴파일되어야 한다 */
export function regexLit(source, flags = '') {
  if (typeof source !== 'string' || /[\n\r\u2028\u2029]/.test(source)) throw new Error(`정규식에 줄 끝 문자가 있다: ${JSON.stringify(source)}`);
  if (!/^[dgimsuy]*$/.test(flags)) throw new Error(`정규식 플래그 꼴이 아니다: ${JSON.stringify(flags)}`);
  // JS 정규식 리터럴 문법 그대로 — 문자 클래스([…]) 밖의 이스케이프 안 된 `/` 는 리터럴을 끝내므로 거부한다. 클래스 안의 `/` 는 된다
  let escaped = false;
  let inClass = false;
  for (const ch of source) {
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (inClass) { if (ch === ']') inClass = false; continue; }
    if (ch === '[') { inClass = true; continue; }
    if (ch === '/') throw new Error(`정규식에 이스케이프 안 된 / 가 있다: ${JSON.stringify(source)}`);
  }
  if (escaped) throw new Error(`정규식이 역슬래시로 끝난다: ${JSON.stringify(source)}`);
  new RegExp(source, flags);
  return `/${source}/${flags}`;
}

/** 주석 한 줄에 넣는 출처 표지(커밋 · 리비전 · 날짜) — 영숫자와 `. _ / -` 만. 줄 바꿈이 주석 밖으로 나가지 않게 */
export function metaToken(v) {
  const s = String(v);
  if (!/^[A-Za-z0-9._/-]+$/.test(s)) throw new Error(`출처 표지 꼴이 아니다: ${JSON.stringify(s)}`);
  return s;
}
