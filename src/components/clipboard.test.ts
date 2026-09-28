import { describe, it, expect } from 'vitest';
import { copyText, COPY_MESSAGE } from './clipboard';

describe('copyText — 성공 · 없음(HTTP) · 거부(권한) 셋을 구분한다', () => {
  it('writeText 가 이행하면 copied · 넘긴 문자열 그대로', async () => {
    const written: string[] = [];
    const result = await copyText('locals {\n}\n', { writeText: (t) => { written.push(t); return Promise.resolve(); } });
    expect(result).toBe('copied');
    expect(written).toEqual(['locals {\n}\n']);
  });
  it('클립보드가 없으면(HTTP · Node) unavailable — 던지지 않는다', async () => {
    expect(await copyText('x', undefined)).toBe('unavailable');
    expect(await copyText('x')).toBe('unavailable');
  });
  it('writeText 가 거부하면(권한) failed', async () => {
    expect(await copyText('x', { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) })).toBe('failed');
  });
  it('안내 문구는 셋 다 있고 실패 둘은 「직접 선택」을 안내한다', () => {
    expect(Object.keys(COPY_MESSAGE).sort()).toEqual(['copied', 'failed', 'unavailable']);
    expect(COPY_MESSAGE.unavailable).toContain('직접 선택');
    expect(COPY_MESSAGE.failed).toContain('직접 선택');
  });
});
