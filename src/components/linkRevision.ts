// 공유 링크의 규칙 버전 (D27 ⑵) — 링크에서 읽은 상태는 폼과 따로 둔다.
// 폼이 링크 상태와 같은 동안은 hash 를 다시 쓰지 않는다(새로고침해도 옛 `v` 와 안내가 남는다). 사용자가 폼을 고치면 링크 상태를 버린다
import type { DecodedState } from './urlState';

/** 링크로 연 상태 — key 는 그 문맥을 지금 버전으로 인코딩한 값(폼과 대어 보는 용도), hash 는 주소창에 있던 원래 값 */
export interface LinkState {
  key: string;
  hash: string;
  rulesVersion?: string;
}

/** 풀린 hash → 링크 상태. key 는 부르는 쪽이 지금 버전으로 만든다(같은 규칙으로 폼의 key 도 만든다) */
export function linkStateOf(decoded: DecodedState, hash: string, key: string): LinkState {
  return decoded.rulesVersion === undefined ? { key, hash } : { key, hash, rulesVersion: decoded.rulesVersion };
}

/** 앱이 hash 를 지금 폼으로 다시 써야 하는가 — 링크가 없거나 폼이 링크 상태와 달라졌을 때만 */
export function shouldRewriteHash(formKey: string, link: LinkState | undefined): boolean {
  return link === undefined || link.key !== formKey;
}

/** 안내를 보일 링크 버전 — 링크가 폼과 같은 동안, 링크의 `v` 가 지금 규칙 버전과 다를 때만 */
export function mismatchedLinkVersion(formKey: string, link: LinkState | undefined, current: string): string | undefined {
  if (!link || shouldRewriteHash(formKey, link)) return undefined;
  return link.rulesVersion !== undefined && link.rulesVersion !== current ? link.rulesVersion : undefined;
}
