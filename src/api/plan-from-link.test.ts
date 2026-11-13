import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from './index';
import { req, jsonPost, json } from './test-support';
import { VERSION } from '../version';
import { encodeWizardState, encodeState, HASH_KEY } from '../components/urlState';
import { savePlan } from '../components/planFile';
import { FULL_PLAN } from '../components/__fixtures__/plan';
import { ENABLED_PROVIDERS, type Env } from '../core/types';

// 공유 링크 → 계획 파일 (D144) — 웹의 Save plan 과 같은 파일을 서버가 낸다. CLI 의 init --from <링크> 가 부른다
const post = (body: unknown) => req(app, '/v1/plan/from-link', jsonPost(body));
const OLD = '2026-01-01.1';

describe('POST /v1/plan/from-link', () => {
  it('마법사 링크 → 웹 Save plan 과 같은 계획 파일 · 안내 0 · 링크의 규칙 버전', async () => {
    const envs: Env[] = ['prod', 'stg'];
    const key = encodeWizardState(FULL_PLAN, OLD, envs)!;
    const { res } = await post({ link: `https://example.com/#${HASH_KEY}=${key}` });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.plan).toEqual(savePlan(key, VERSION.rules)!.file);
    expect(body).toMatchObject({ link_rules_version: OLD, notices: { dropped: 0, ha_off: 0, serverless_off: 0, trimmed: 0 }, version: VERSION });
  });
  it('조각만(#state=…) 보내도 같다 · 호스트는 읽지 않는다', async () => {
    const key = encodeWizardState(FULL_PLAN, VERSION.rules)!;
    const a = await json((await post({ link: `#${HASH_KEY}=${key}` })).res);
    const b = await json((await post({ link: `https://other.invalid/wizard?x=1#${HASH_KEY}=${key}` })).res);
    expect(a.plan).toEqual(b.plan);
    expect(a.plan.rules_version).toBe(VERSION.rules);
  });
  it('링크에 규칙 버전이 없으면 link_rules_version 키가 없다', async () => {
    const key = encodeWizardState(FULL_PLAN)!;
    const body = await json((await post({ link: `#${HASH_KEY}=${key}` })).res);
    expect('link_rules_version' in body).toBe(false);
  });
  it('버린 항목은 notices 로 센다 — 링크를 여는 웹과 같은 복구', async () => {
    // 슬롯 id 가 틀린 pick 하나 — 디코더가 그 pick 만 버린다
    const raw = { owner: 'platform', system: 'billing', env: 'prod', region: 'asia-northeast3-a', w: { pp: [{ pr: 'vpc', i: [{ id: '1', q: '01' }] }, { pr: 'subnet', zz: 1 }] } };
    const key = Buffer.from(JSON.stringify(raw)).toString('base64url');
    const body = await json((await post({ link: `#${HASH_KEY}=${key}` })).res);
    expect(body.notices.dropped).toBeGreaterThan(0);
    expect(body.plan.project_picks).toHaveLength(1);
  });
  it.each([
    ['조각이 없다', 'https://example.com/', 'none'],
    ['트리 화면 링크', `#${HASH_KEY}=${encodeState({ owner: 'platform', system: 'billing', env: 'prod', region: 'asia-northeast3', purpose: 'shop' } as never)}`, 'tree'],
    ['풀리지 않는다', `#${HASH_KEY}=!!!`, 'broken'],
    ['#state= 가 아닌 조각', '#foo', 'none'],
    ['계획(w)을 버린 링크', `#${HASH_KEY}=${Buffer.from(JSON.stringify({ owner: 'platform', system: 'billing', env: 'prod', region: 'asia-northeast3-a', w: 1 })).toString('base64url')}`, 'broken'],
  ])('%s → 400 request.link_unreadable (kind %s)', async (_, link, kind) => {
    const { res } = await post({ link });
    expect(res.status).toBe(400);
    expect((await json(res)).errors[0]).toMatchObject({ code: 'request.link_unreadable', field: 'link', params: { kind } });
  });
  it('이 배포에서 꺼진 provider 의 링크는 400 request.provider_not_enabled (/v1/wizard 와 같다)', async () => {
    const off = (['gcp', 'aws', 'azure'] as const).find((p) => !ENABLED_PROVIDERS.includes(p))!;
    const raw = { c: off, owner: 'platform', system: 'billing', env: 'prod', region: 'koreacentral', w: {} };
    const { res } = await post({ link: `#${HASH_KEY}=${Buffer.from(JSON.stringify(raw)).toString('base64url')}` });
    // 마법사가 모르는 CSP 면 디코더가 먼저 깨진 링크로 본다 — 어느 쪽이든 계획을 주지 않는다
    expect(res.status).toBe(400);
    expect(['request.provider_not_enabled', 'request.link_unreadable']).toContain((await json(res)).errors[0].code);
  });
  it('AWS 링크 → provider aws 계획 파일 · Save plan 과 같다', async () => {
    const aws = { provider: 'aws', project: { owner: 'platform', system: 'billing', env: 'prod', region: 'ap-northeast-2' }, projectPicks: [{ preset: 'vpc', instances: [{ id: 'a', seq: '01' }] }], services: [{ purpose: 'shop', picks: [{ preset: 'db', instances: [{ id: 'g', seq: '01' }] }] }] } as const;
    const key = encodeWizardState(aws as never)!;
    const body = await json((await post({ link: `#${HASH_KEY}=${key}` })).res);
    expect(body.plan).toEqual(savePlan(key, VERSION.rules)!.file);
    expect(body.plan.provider).toBe('aws');
  });
  it('link 가 없거나 문자열이 아니면 400', async () => {
    expect((await json((await post({})).res)).errors[0]).toMatchObject({ code: 'request.field_missing', field: 'link' });
    expect((await json((await post({ link: 1 })).res)).errors[0]).toMatchObject({ code: 'request.field_not_string', field: 'link' });
    expect((await json((await post([])).res)).errors[0]).toMatchObject({ code: 'request.body_not_object' });
  });
  it('본문 상한(32 KiB)을 넘는 링크는 413 — 웹에서 Save plan 으로 받는다', async () => {
    const { res } = await post({ link: `#${HASH_KEY}=${'A'.repeat(33 * 1024)}` });
    expect(res.status).toBe(413);
    expect((await json(res)).errors[0]).toMatchObject({ code: 'request.body_too_large' });
  });
  it('문맥값을 원격 기록에 남기지 않는다 — 이벤트를 보내지 않는다', async () => {
    const key = encodeWizardState(FULL_PLAN)!;
    const { promises } = await post({ link: `#${HASH_KEY}=${key}` });
    expect(promises).toHaveLength(0);
  });
});

describe('openapi 예시', () => {
  it('명세의 요청 예시가 200 으로 풀린다', async () => {
    const spec = JSON.parse(readFileSync(join(import.meta.dirname, '../../public/openapi.json'), 'utf-8'));
    const example = spec.paths['/plan/from-link'].post.requestBody.content['application/json'].example;
    const { res } = await post(example);
    expect(res.status).toBe(200);
    expect((await json(res)).plan.project_picks).toEqual([{ preset: 'vpc', instances: [{ id: '1', seq: '01' }] }]);
  });
});
