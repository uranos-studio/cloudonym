// 버킷 이름 「Check」 (D83) — 판정은 상태 코드만 본다 · 요청은 Cloud Storage 로만 · 쿠키 · Referer 없이 · 실패는 unknown
import { describe, it, expect, vi } from 'vitest';
import { AVAILABILITY_ORIGIN, bucketLookupUrl, checkBucketName, classifyBucketStatus } from './availability';

describe('classifyBucketStatus', () => {
  it('404 만 available · 200 · 401 · 403 은 taken · 그 밖은 unknown', () => {
    expect(classifyBucketStatus(404)).toBe('available');
    for (const s of [200, 401, 403]) expect(classifyBucketStatus(s), String(s)).toBe('taken');
    for (const s of [0, 204, 301, 400, 429, 500, 503]) expect(classifyBucketStatus(s), String(s)).toBe('unknown');
  });
});

describe('checkBucketName', () => {
  it('URL — storage.googleapis.com 의 JSON API · 이름은 경로 하나로 인코딩 · fields=name', () => {
    expect(AVAILABILITY_ORIGIN).toBe('https://storage.googleapis.com');
    expect(bucketLookupUrl('platform-billing-prod-ane3-gcs')).toBe('https://storage.googleapis.com/storage/v1/b/platform-billing-prod-ane3-gcs?fields=name');
    expect(bucketLookupUrl('a/b?c#d')).toBe('https://storage.googleapis.com/storage/v1/b/a%2Fb%3Fc%23d?fields=name');
  });
  it('요청 옵션 — GET · cors · 쿠키 없음 · 캐시 없음 · Referer 없음', async () => {
    const f = vi.fn(async () => new Response(null, { status: 404 }));
    expect(await checkBucketName('example-bucket', f as unknown as typeof fetch)).toBe('available');
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(bucketLookupUrl('example-bucket'));
    expect(init).toMatchObject({ method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
    expect(init.headers).toBeUndefined();
  });
  it('401 → taken · 네트워크 오류(CORS 포함) → unknown · 시간 초과 → unknown', async () => {
    expect(await checkBucketName('x', (async () => new Response(null, { status: 401 })) as unknown as typeof fetch)).toBe('taken');
    expect(await checkBucketName('x', (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch)).toBe('unknown');
    const hang = ((_u: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as unknown as typeof fetch;
    expect(await checkBucketName('x', hang, 10)).toBe('unknown');
  });
});
