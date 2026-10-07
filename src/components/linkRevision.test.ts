import { describe, it, expect } from 'vitest';
import { hashToRestore, hashToWrite, linkStateOf, mismatchedLinkVersion, shouldRewriteHash } from './linkRevision';
import { decodeState, encodeState } from './urlState';
import { validateSelection } from '../core/selection';
import type { NamingContext } from '../core/types';

const CURRENT = '2026-09-29.1';
const OLD = '2000-01-01.1';
const ctx: NamingContext = { owner: 'platform', system: 'billing', purpose: 'trade', env: 'prod', region: 'ane3' };
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

describe('링크 키에 p · r 이 들어간다 (D42)', () => {
  /** App 이 하는 것과 같다 — 풀린 문맥 · CSP · 선택을 지금 버전으로 다시 인코딩한 것이 키 */
  const openV2 = (hash: string) => {
    const d = decodeState(hash);
    if (!d) throw new Error('hash 가 풀리지 않는다');
    return linkStateOf(d, hash, encodeState(d.context, CURRENT, { provider: d.provider, selection: d.selection }));
  };
  const pick = (r: unknown[]) => {
    const res = validateSelection('gcp', r);
    if (!res.ok) throw new Error('선택이 틀렸다');
    return res.items;
  };
  it('옛 다섯 키 링크를 연 직후 — 켜진 CSP 하나(gcp)를 자동으로 고른 폼 키와 같아 hash 를 다시 쓰지 않는다 (D45)', () => {
    const link = openV2(`#state=${encodeState(ctx, OLD)}`);
    expect(shouldRewriteHash(encodeState(ctx, CURRENT, { provider: 'gcp' }), link)).toBe(false);
    expect(mismatchedLinkVersion(encodeState(ctx, CURRENT, { provider: 'gcp' }), link, CURRENT)).toBe(OLD);
  });
  it('p · r 링크를 연 직후는 같은 키 · 선택을 바꾸면 링크의 옛 v 를 버린다', () => {
    const items = pick([{ type: 'compute_instance', count: 2 }]);
    const link = openV2(`#state=${encodeState(ctx, OLD, { provider: 'gcp', selection: items })}`);
    expect(shouldRewriteHash(encodeState(ctx, CURRENT, { provider: 'gcp', selection: items }), link)).toBe(false);
    expect(shouldRewriteHash(encodeState(ctx, CURRENT, { provider: 'gcp', selection: pick([{ type: 'compute_instance', count: 3 }]) }), link)).toBe(true);
    expect(shouldRewriteHash(encodeState(ctx, CURRENT, { provider: 'gcp' }), link)).toBe(true);
    expect(mismatchedLinkVersion(encodeState(ctx, CURRENT, { provider: 'gcp' }), link, CURRENT)).toBeUndefined();
  });
  it('꺼진 CSP(azure) 링크를 연 직후 — 선택을 버린 GCP 폼 키와 같아 hash 를 다시 쓰지 않는다 · 옛 v 안내는 남는다 (D55)', () => {
    const azure = validateSelection('azure', [{ type: 'virtual_machine', count: 2 }]);
    if (!azure.ok) throw new Error('선택이 틀렸다');
    // 링크의 지역은 azure 코드다 — 열면 예시 지역(asia-northeast3-a)으로 바뀐 GCP 폼이 된다
    const link = openV2(`#state=${encodeState({ ...ctx, region: 'krc' }, OLD, { provider: 'azure', selection: azure.items })}`);
    const reset: NamingContext = { ...ctx, region: 'ane3', zone: 'ane3a' };
    expect(shouldRewriteHash(encodeState(reset, CURRENT, { provider: 'gcp' }), link)).toBe(false);
    expect(mismatchedLinkVersion(encodeState(reset, CURRENT, { provider: 'gcp' }), link, CURRENT)).toBe(OLD);
  });
});

describe('hashToWrite · hashToRestore — 문맥이 불완전한 동안은 마지막 온전한 hash 를 둔다', () => {
  const key = encodeState(ctx, CURRENT);
  it('온전한 문맥 · 링크 없음 → 지금 상태의 hash', () => {
    expect(hashToWrite(key, undefined)).toBe(`#state=${key}`);
  });
  it('문맥이 불완전(stateKey 빈 값) → 쓰지 않는다(undefined) — 지우지 않아 새로고침해도 CSP · 선택이 남는다', () => {
    expect(hashToWrite('', undefined)).toBeUndefined();
  });
  it('링크 상태 그대로 → 쓰지 않는다', () => {
    const link = open(`#state=${encodeState(ctx, OLD)}`);
    expect(hashToWrite(key, link)).toBeUndefined();
  });
  it('되돌릴 값 — 온전하면 지금 hash · 불완전하면 직전 값 · 링크 그대로면 링크의 원래 hash', () => {
    expect(hashToRestore(key, undefined, '#state=prev')).toBe(`#state=${key}`);
    expect(hashToRestore('', undefined, '#state=prev')).toBe('#state=prev');
    const hash = `#state=${encodeState(ctx, OLD)}`;
    expect(hashToRestore(key, open(hash), '#state=prev')).toBe(hash);
  });
});
