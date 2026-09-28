import { describe, it, expect } from 'vitest';
import { decodeState, encodeState, shareUrl } from './urlState';
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
