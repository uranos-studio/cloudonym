import { describe, it, expect } from 'vitest';
import { decodeState, encodeState, shareUrl, MAX_HASH_CHARS, MAX_FIELD_CHARS } from './urlState';
import { MAX_FIELD_CHARS as API_MAX_FIELD_CHARS } from '../api/schemas';
import type { NamingContext } from '../core/types';

const ctx: NamingContext = { owner: 'acmex', system: 'billing', purpose: 'trade', env: 'prd', region: 'kr' };
const b64 = (v: unknown) => btoa(JSON.stringify(v));

describe('encodeState — Base64url', () => {
  it('왕복이 같다 · 출력에 + / = 가 없다', () => {
    const encoded = encodeState(ctx);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeState(`#state=${encoded}`)).toEqual(ctx);
  });
  it('한글 owner 도 왕복이 같다 (UTF-8 · btoa 의 Latin1 한계를 넘는다)', () => {
    const ko: NamingContext = { ...ctx, owner: '홍길동' };
    expect(decodeState(`#state=${encodeState(ko)}`)).toEqual(ko);
  });
  it('필드 순서가 달라도 같은 문자열 — 다섯 필드만 고정 순서로 담는다', () => {
    const shuffled = { region: 'kr', env: 'prd', purpose: 'trade', system: 'billing', owner: 'acmex', extra: 'x' } as unknown as NamingContext;
    expect(encodeState(shuffled)).toBe(encodeState(ctx));
  });
});

describe('decodeState — 깨진 hash 는 전부 undefined (Review Focus 4)', () => {
  it.each([
    ['#state=!!!', 'Base64 가 아니다'],
    [`#state=${btoa('{not json')}`, 'JSON 이 아니다'],
    [`#state=${b64('billing')}`, 'JSON 이 객체가 아니다(문자열)'],
    [`#state=${b64(['a'])}`, 'JSON 이 배열이다'],
    [`#state=${b64(null)}`, 'JSON 이 null 이다'],
    [`#state=${b64({ owner: 'acmex', system: 'billing', purpose: 'trade', env: 'prd' })}`, 'region 이 빠졌다'],
    [`#state=${b64({ ...ctx, owner: 42 })}`, '값이 숫자다'],
    [`#state=${b64({ ...ctx, env: 'qa' })}`, 'env 가 지원 밖이다'],
    ['', '빈 hash'],
    ['#other=abc', '다른 키'],
    ['#state=', '값이 비었다'],
  ])('%s → undefined (%s)', (hash) => {
    expect(decodeState(hash)).toBeUndefined();
  });
  it('① 예시처럼 표준 Base64(패딩 없음 · + /)도 받는다', () => {
    const std = btoa(JSON.stringify(ctx)).replace(/=+$/, '');
    expect(decodeState(`#state=${std}`)).toEqual(ctx);
    // 표준 Base64 의 + 와 / 가 들어가는 값
    const plus: NamingContext = { ...ctx, owner: '>>>???' };
    const stdPlus = btoa(JSON.stringify(plus));
    expect(stdPlus).toMatch(/[+/]/);
    expect(decodeState(`state=${stdPlus}`)).toEqual(plus);
  });
  it('별칭은 parseContext 가 정규화한다 — production · korea → prd · kr', () => {
    expect(decodeState(`#state=${b64({ ...ctx, env: 'production', region: 'korea' })}`)).toEqual(ctx);
  });
});

describe('shareUrl', () => {
  it('base 뒤에 #state= 를 붙인다 · 그 URL 의 hash 가 다시 풀린다', () => {
    const url = shareUrl(ctx, 'http://localhost:5173/');
    expect(url.startsWith('http://localhost:5173/#state=')).toBe(true);
    expect(decodeState(new URL(url).hash)).toEqual(ctx);
  });
});

describe('decodeState 길이 상한 (보안 리뷰 L-5)', () => {
  it('필드 상한은 API 와 같은 1024 · hash 전체 상한은 4096', () => {
    expect(MAX_FIELD_CHARS).toBe(API_MAX_FIELD_CHARS);
    expect(MAX_HASH_CHARS).toBe(4096);
  });
  it('필드 하나가 1024자를 넘으면 undefined(기본값) · 딱 1024자는 받는다', () => {
    expect(decodeState(`#state=${b64({ ...ctx, owner: 'a'.repeat(1025) })}`)).toBeUndefined();
    expect(decodeState(`#state=${b64({ ...ctx, owner: 'a'.repeat(1024) })}`)?.owner).toBe('a'.repeat(1024));
  });
  it('hash 가 4096자를 넘으면 디코딩하지 않고 undefined', () => {
    const big = `#state=${encodeState(ctx)}${'A'.repeat(4096)}`;
    expect(big.length).toBeGreaterThan(MAX_HASH_CHARS);
    expect(decodeState(big)).toBeUndefined();
  });
});
