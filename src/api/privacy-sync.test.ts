// 화면 쪽 값(beacon · /privacy 안내)이 API 가 실제로 하는 일과 같은가 (D56). components 는 api 를 들여오지 않아 값을 따로 들고 있다 — 둘을 여기서 묶는다
import { describe, it, expect } from 'vitest';
import { KV_TTL_SECONDS, META_KEYS, TELEMETRY_SKIP_HEADER } from './telemetry';
import { RATE_LIMIT } from './ratelimit';
import { UI_COPY_TARGETS, wizardPickedRules } from './schemas';
import { COPY_TARGETS } from '../components/copyTargets';
import { pickedRuleIds } from '../components/pickedRules';
import type { WizardPlan } from '../core/wizard/plan';
import { PRESETS } from '../core/wizard/presets';
import { PRIVACY_BUCKET_CHECK_ORIGIN, PRIVACY_EVENTS, PRIVACY_KV_RETENTION_DAYS, PRIVACY_RATE_LIMIT, PRIVACY_SKIP_HEADER } from '../components/privacyModel';
import { AVAILABILITY_ORIGIN } from '../components/availabilityOrigin';
import { API_DOC_RATE_LIMIT, API_DOC_SKIP_HEADER } from '../components/apiDocModel';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('화면 · 안내 ↔ API 상수', () => {
  it('복사 버튼 target 여섯 — beacon.ts 와 schemas.ts', () => {
    expect(COPY_TARGETS).toEqual(UI_COPY_TARGETS);
  });
  it('안내의 계측 표 = telemetry 의 허용 표 (이벤트 · 필드 · 순서)', () => {
    expect(Object.fromEntries(PRIVACY_EVENTS.map((e) => [e.event, e.fields]))).toEqual(META_KEYS);
    expect(PRIVACY_EVENTS.map((e) => e.event)).toEqual(Object.keys(META_KEYS));
  });
  it('버킷 「Check」(D83) — 화면이 묻는 곳 = 안내가 적은 곳 = CSP connect-src 의 self 밖 유일한 출처', () => {
    expect(PRIVACY_BUCKET_CHECK_ORIGIN).toBe(AVAILABILITY_ORIGIN);
    // 주석 줄은 빼고 헤더 줄에서 읽는다
    const headers = readFileSync(join(import.meta.dirname, '../../public/_headers'), 'utf-8').split('\n').filter((l) => l.includes('Content-Security-Policy:')).join('\n');
    const connect = /connect-src ([^;]+);/.exec(headers)?.[1]?.trim().split(/\s+/);
    expect(connect).toEqual(["'self'", AVAILABILITY_ORIGIN]);
    const release = readFileSync(join(import.meta.dirname, '../../scripts/release-check.sh'), 'utf-8').split('\n').filter((l) => l.startsWith('CSP=')).join('\n');
    expect(/connect-src ([^;]+);/.exec(release)?.[1]?.trim().split(/\s+/)).toEqual(connect);
  });
  it('KV 보존 일수 × 86400 = expirationTtl · 요청 제한 숫자 = RATE_LIMIT', () => {
    expect(PRIVACY_KV_RETENTION_DAYS * 86400).toBe(KV_TTL_SECONDS);
    expect(PRIVACY_RATE_LIMIT).toEqual(RATE_LIMIT);
    // /docs/api 안내(D98)도 같은 숫자를 보인다
    expect(API_DOC_RATE_LIMIT).toEqual(RATE_LIMIT);
  });
  it('점검 헤더 이름 (D99) — /privacy · /docs/api 가 적는 이름 = telemetry 가 읽는 이름', () => {
    expect(PRIVACY_SKIP_HEADER).toBe(TELEMETRY_SKIP_HEADER);
    expect(API_DOC_SKIP_HEADER).toBe(TELEMETRY_SKIP_HEADER);
  });
});

describe('고른 규칙 id — 화면(beacon.ts)과 API(schemas.ts)가 같은 값을 낸다 (D71)', () => {
  const project = { owner: 'example-team', system: 'payroll', env: 'prod', region: 'asia-northeast3' };
  it('프리셋 전부 · serverless 둘 · Custom · 프로젝트 ID · 모르는 프리셋', () => {
    const picks = [
      ...PRESETS.map((p) => ({ preset: p.id })),
      { preset: 'web', serverless: 'gcp.run_service' }, { preset: 'was', serverless: 'gcp.cloud_function' }, { preset: 'bastion', serverless: 'gcp.run_service' },
      { preset: null, ruleId: 'gcp.secret' }, { preset: null, ruleId: 'gcp.project_id' }, { preset: 'nope' },
    ];
    const plan = { provider: 'gcp', project, projectPicks: picks.slice(0, 3), services: [{ purpose: 'shop', picks: picks.slice(3) }] } as unknown as WizardPlan;
    const out = wizardPickedRules(plan);
    expect(pickedRuleIds(plan)).toEqual(out);
    expect(out.chip).toContain('gcp.run_service');
    expect(out.custom).toEqual(['gcp.secret']);
  });
});
