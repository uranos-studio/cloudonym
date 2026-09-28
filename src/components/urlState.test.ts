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

describe('decodeState 길이 상한 (보안 리뷰 L-5 · codex P2)', () => {
  const at = (s: string): NamingContext => ({ owner: s, system: s, purpose: s, env: 'prd', region: 'global' });
  const hashOf = (c: NamingContext) => `#${'state'}=${encodeState(c)}`;
  it('필드 상한은 API 와 같은 1024', () => expect(MAX_FIELD_CHARS).toBe(API_MAX_FIELD_CHARS));
  it('필드 하나가 1024자를 넘으면 undefined(기본값) · 딱 1024자는 받는다', () => {
    expect(decodeState(`#state=${b64({ ...ctx, owner: 'a'.repeat(1025) })}`)).toBeUndefined();
    expect(decodeState(`#state=${b64({ ...ctx, owner: 'a'.repeat(1024) })}`)?.owner).toBe('a'.repeat(1024));
  });
  it.each([
    ['ASCII 1024자 × 3', 'a'.repeat(1024)],
    ['한글(UTF-8 3바이트) 1024자 × 3', '가'.repeat(1024)],
    ['보조 평면(UTF-8 4바이트 · UTF-16 2단위) 512자 × 3', '😀'.repeat(512)],
    ['제어 문자(JSON 이 \\uXXXX 6바이트로 적는다) 1024자 × 3', '\u0001'.repeat(1024)],
  ])('필드마다 상한까지 채운 문맥도 왕복한다 — %s', (_label, s) => {
    const c = at(s);
    const h = hashOf(c);
    expect(h.length).toBeLessThanOrEqual(MAX_HASH_CHARS);
    expect(decodeState(h)).toEqual(c);
  });
  it('hash 상한은 최악 입력(필드당 6바이트 × 1024 × 3 · region global)의 표준 Base64(패딩 포함) 길이와 같다', () => {
    const worst = at('\u0001'.repeat(1024));
    const url = hashOf(worst);
    const padded = `#state=${btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(worst))))}`;
    expect(url.length).toBe(24673);
    expect(padded.length).toBe(24675);
    expect(MAX_HASH_CHARS).toBe(padded.length);
    expect(decodeState(padded)).toEqual(worst);
  });
  it('상한을 한 글자라도 넘으면 내용이 멀쩡해도 디코딩하지 않고 undefined', () => {
    // env 별칭 production 은 parseContext 가 prd 로 받는 값이다 — 상한이 없다면 풀린다
    const over = `#state=${b64({ ...at('\u0001'.repeat(1024)), env: 'production' })}`;
    expect(over.length).toBeGreaterThan(MAX_HASH_CHARS);
    expect(decodeState(over)).toBeUndefined();
    const big = `#state=${encodeState(ctx)}${'A'.repeat(MAX_HASH_CHARS)}`;
    expect(decodeState(big)).toBeUndefined();
  });
});
