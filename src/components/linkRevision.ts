// 공유 링크의 규칙 버전 (D27 ⑵) — 링크에서 읽은 상태는 폼과 따로 둔다.
// 폼이 링크 상태와 같은 동안은 hash 를 다시 쓰지 않는다(새로고침해도 옛 `v` 와 안내가 남는다). 사용자가 폼을 고치면 링크 상태를 버린다
import { HASH_KEY, type DecodedState } from './urlState';

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

/** 주소창에 쓸 hash — 쓰지 않을 때 undefined.
 *  문맥이 불완전한 동안(stateKey 빈 값)은 쓰지 않는다 — 지우면 그 상태로 새로고침할 때 CSP · 선택까지 사라진다. 주소창에는 마지막으로 온전했던 hash 가 남는다.
 *  그동안 Share URL 버튼은 그려지지 않으므로(App) 낡은 값을 복사하지 않는다 */
export function hashToWrite(stateKey: string, link: LinkState | undefined): string | undefined {
  if (!stateKey || !shouldRewriteHash(stateKey, link)) return undefined;
  return `#${HASH_KEY}=${stateKey}`;
}

/** 깨진 hash 로 이동했을 때 주소창을 되돌릴 값 — 링크 상태 그대로면 링크의 원래 hash(옛 v 를 잃지 않는다) · 문맥이 불완전하면 직전 값 */
export function hashToRestore(stateKey: string, link: LinkState | undefined, previous: string): string {
  if (link && !shouldRewriteHash(stateKey, link)) return link.hash;
  return stateKey ? `#${HASH_KEY}=${stateKey}` : previous;
}
