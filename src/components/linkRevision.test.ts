import { describe, it, expect } from 'vitest';
import { linkStateOf, mismatchedLinkVersion, shouldRewriteHash } from './linkRevision';
import { decodeState, encodeState } from './urlState';
import type { NamingContext } from '../core/types';

const CURRENT = '2026-09-29.1';
const OLD = '2000-01-01.1';
const ctx: NamingContext = { owner: 'platform', system: 'billing', purpose: 'trade', env: 'prd', region: 'kr' };
const other: NamingContext = { ...ctx, owner: 'infra' };

/** 링크 hash 를 연 상태 — App 이 하는 것과 같다 */
function open(hash: string) {
  const decoded = decodeState(hash);
  if (!decoded) throw new Error('hash 가 풀리지 않는다');
  return linkStateOf(decoded, hash, encodeState(decoded.context, CURRENT));
}

describe('shouldRewriteHash — 폼이 링크 상태와 같은 동안은 hash 를 다시 쓰지 않는다 (D27 ⑵)', () => {
  it('링크가 없으면 항상 다시 쓴다', () => {
    expect(shouldRewriteHash(encodeState(ctx, CURRENT), undefined)).toBe(true);
  });
  it('옛 v 링크를 연 직후(폼 = 링크 상태) → false · 폼을 고치면 → true', () => {
    const link = open(`#state=${encodeState(ctx, OLD)}`);
    expect(shouldRewriteHash(encodeState(ctx, CURRENT), link)).toBe(false);
    expect(shouldRewriteHash(encodeState(other, CURRENT), link)).toBe(true);
  });
  it('v 없는 링크도 링크 상태다 — 고치기 전에는 다시 쓰지 않는다', () => {
    const link = open(`#state=${encodeState(ctx)}`);
    expect(link.rulesVersion).toBeUndefined();
    expect(shouldRewriteHash(encodeState(ctx, CURRENT), link)).toBe(false);
  });
  it('링크 상태는 주소창의 원래 hash 를 갖고 있다 — 깨진 hash 를 되돌릴 때 쓴다', () => {
    const hash = `#state=${encodeState(ctx, OLD)}`;
    expect(open(hash).hash).toBe(hash);
  });
});

describe('mismatchedLinkVersion — 안내는 옛 v 링크가 폼과 같은 동안만', () => {
  it('옛 v → 그 버전 · 지금 v · v 없음 · 꼴 틀린 v → 안내 없음', () => {
    const key = encodeState(ctx, CURRENT);
    expect(mismatchedLinkVersion(key, open(`#state=${encodeState(ctx, OLD)}`), CURRENT)).toBe(OLD);
    expect(mismatchedLinkVersion(key, open(`#state=${encodeState(ctx, CURRENT)}`), CURRENT)).toBeUndefined();
    expect(mismatchedLinkVersion(key, open(`#state=${encodeState(ctx)}`), CURRENT)).toBeUndefined();
    expect(mismatchedLinkVersion(key, open(`#state=${encodeState(ctx, 'v1')}`), CURRENT)).toBeUndefined();
  });
  it('폼을 고치면 안내가 사라진다 · 링크가 없으면 안내 없음', () => {
    const link = open(`#state=${encodeState(ctx, OLD)}`);
    expect(mismatchedLinkVersion(encodeState(other, CURRENT), link, CURRENT)).toBeUndefined();
    expect(mismatchedLinkVersion(encodeState(ctx, CURRENT), undefined, CURRENT)).toBeUndefined();
  });
});
