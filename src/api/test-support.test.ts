import { describe, it, expect } from 'vitest';
import { isPending } from './test-support';

// 검사기를 먼저 시험한다 — isPending 이 끝난 Promise 를 pending 으로 보면 「응답은 텔레메트리를 기다리지 않는다」 단언이 아무것도 잡지 못한다
describe('isPending — 검사기 자체 시험', () => {
  it('이미 resolve · reject 된 Promise 는 false', async () => {
    expect(await isPending(Promise.resolve('done'))).toBe(false);
    const rejected = Promise.reject(new Error('x'));
    rejected.catch(() => {});
    expect(await isPending(rejected)).toBe(false);
  });
  it('영원히 끝나지 않는 Promise 는 true', async () => {
    expect(await isPending(new Promise<void>(() => {}))).toBe(true);
  });
});
