// 화면 쪽 값(beacon · /privacy 안내)이 API 가 실제로 하는 일과 같은가 (D56). components 는 api 를 들여오지 않아 값을 따로 들고 있다 — 둘을 여기서 묶는다
import { describe, it, expect } from 'vitest';
import { KV_TTL_SECONDS, META_KEYS } from './telemetry';
import { RATE_LIMIT } from './ratelimit';
import { UI_COPY_TARGETS } from './schemas';
import { COPY_TARGETS } from '../components/copyTargets';
import { PRIVACY_EVENTS, PRIVACY_KV_RETENTION_DAYS, PRIVACY_RATE_LIMIT } from '../components/privacyModel';

describe('화면 · 안내 ↔ API 상수', () => {
  it('복사 버튼 target 여섯 — beacon.ts 와 schemas.ts', () => {
    expect(COPY_TARGETS).toEqual(UI_COPY_TARGETS);
  });
  it('안내의 계측 표 = telemetry 의 허용 표 (이벤트 · 필드 · 순서)', () => {
    expect(Object.fromEntries(PRIVACY_EVENTS.map((e) => [e.event, e.fields]))).toEqual(META_KEYS);
    expect(PRIVACY_EVENTS.map((e) => e.event)).toEqual(Object.keys(META_KEYS));
  });
  it('KV 보존 일수 × 86400 = expirationTtl · 요청 제한 숫자 = RATE_LIMIT', () => {
    expect(PRIVACY_KV_RETENTION_DAYS * 86400).toBe(KV_TTL_SECONDS);
    expect(PRIVACY_RATE_LIMIT).toEqual(RATE_LIMIT);
  });
});
