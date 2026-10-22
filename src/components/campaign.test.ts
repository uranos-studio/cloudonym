// 캠페인 출처 (D122) — 첫 로드의 utm_* 를 읽어 탭 세션에만 둔다 · 주소창에서 utm 을 지운다
import { describe, it, expect } from 'vitest';
import { CAMPAIGN_KEY, captureCampaign, campaignFromSearch, storedCampaign, stripUtm } from './campaign';
import type { StorageLike } from './beacon';

function store(): { s: StorageLike; map: Map<string, string> } {
  const map = new Map<string, string>();
  return { s: { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); } }, map };
}
const throwing: StorageLike = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };

describe('campaignFromSearch', () => {
  it('utm_medium=house_ad 이고 utm_source 가 정규식에 맞을 때만', () => {
    expect(campaignFromSearch('?utm_source=parking&utm_medium=house_ad&utm_campaign=map')).toBe('parking');
    expect(campaignFromSearch('?utm_source=parking&utm_medium=cpc')).toBeUndefined();
    expect(campaignFromSearch('?utm_source=parking')).toBeUndefined();
    expect(campaignFromSearch('?utm_source=Parking&utm_medium=house_ad')).toBeUndefined();
    expect(campaignFromSearch(`?utm_source=${'x'.repeat(33)}&utm_medium=house_ad`)).toBeUndefined();
    expect(campaignFromSearch('?utm_source=a%2Fb&utm_medium=house_ad')).toBeUndefined();
    expect(campaignFromSearch('')).toBeUndefined();
  });
});

describe('captureCampaign · storedCampaign — sessionStorage 하나', () => {
  it('맞는 값은 저장하고 돌려준다 · 다음 로드(utm 없음)에도 남는다', () => {
    const { s, map } = store();
    expect(captureCampaign('?utm_source=parking&utm_medium=house_ad', s)).toBe('parking');
    expect(map.get(CAMPAIGN_KEY)).toBe('parking');
    expect(captureCampaign('', s)).toBe('parking');
    expect(storedCampaign(s)).toBe('parking');
  });
  it('틀린 utm 은 저장된 값을 바꾸지 않는다 · 저장된 값이 깨졌으면 버린다', () => {
    const { s, map } = store();
    captureCampaign('?utm_source=parking&utm_medium=house_ad', s);
    captureCampaign('?utm_source=EVIL&utm_medium=house_ad', s);
    expect(storedCampaign(s)).toBe('parking');
    map.set(CAMPAIGN_KEY, 'BAD VALUE');
    expect(storedCampaign(s)).toBeUndefined();
  });
  it('저장소가 없거나 던져도 죽지 않는다', () => {
    expect(captureCampaign('?utm_source=parking&utm_medium=house_ad', undefined)).toBe('parking');
    expect(captureCampaign('?utm_source=parking&utm_medium=house_ad', throwing)).toBe('parking');
    expect(storedCampaign(throwing)).toBeUndefined();
    expect(storedCampaign(undefined)).toBeUndefined();
  });
});

describe('stripUtm — utm_* 만 지우고 다른 query · hash 는 남긴다', () => {
  it('바뀔 때만 새 URL, 아니면 undefined', () => {
    expect(stripUtm('/', '?utm_source=parking&utm_medium=house_ad&utm_campaign=map', '#v4abc')).toBe('/#v4abc');
    expect(stripUtm('/pick', '?fixture=x&utm_source=parking', '')).toBe('/pick?fixture=x');
    expect(stripUtm('/', '?fixture=x', '#h')).toBeUndefined();
    expect(stripUtm('/', '', '')).toBeUndefined();
  });
});

describe('sendBeacon — 탭 세션에 출처가 있으면 src 를 싣는다', () => {
  it('저장된 출처 → 본문에 src · 없으면 src 없음', async () => {
    const { vi } = await import('vitest');
    const { sendBeacon } = await import('./beacon');
    const { s } = store();
    const bodies: string[] = [];
    vi.stubGlobal('sessionStorage', s);
    vi.stubGlobal('navigator', { sendBeacon: (_p: string, b: string) => { bodies.push(b); return true; } });
    try {
      sendBeacon('ui_visit');
      captureCampaign('?utm_source=parking&utm_medium=house_ad', s);
      sendBeacon('ui_copy', { target: 'terraform' });
      expect(JSON.parse(bodies[0]!)).toEqual({ event: 'ui_visit' });
      expect(JSON.parse(bodies[1]!)).toEqual({ event: 'ui_copy', target: 'terraform', src: 'parking' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
