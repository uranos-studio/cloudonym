// 계획 파일 (D100) — 웹 Save plan 이 내려준 파일을 그대로 POST /v1/wizard 에 넣으면 200 이고 웹과 같은 이름이 나온다.
// Worker 앱을 in-process 로 부른다(test-support 의 req). environments 는 API 가 읽지 않는 칸이다 — 실제 요청으로 본다
import { describe, it, expect } from 'vitest';
import { app } from './index';
import { json, req } from './test-support';
import { MAX_BODY_BYTES } from './v1';
import { RULES_REVISION } from '../core/revision';
import { generateProject } from '../core/engine';
import { expandPlan, type WizardPlan } from '../core/wizard/plan';
import { encodeWizardState } from '../components/urlState';
import { openPlanFile, savePlan } from '../components/planFile';
import { withEnv } from '../components/wizardEnvs';
import { FULL_PLAN } from '../components/__fixtures__/plan';
import type { Env } from '../core/types';
import { VERSION } from '../version';

const textPost = (text: string): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: text });

function saved(plan: WizardPlan, envs: Env[] = []) {
  const key = encodeWizardState(plan, VERSION.rules, envs);
  expect(key).toBeDefined();
  return savePlan(key!, VERSION.rules)!;
}

/** 웹이 같은 계획 · env 로 내는 이름 — 키 · 이름 · 판정 */
const webNames = (plan: WizardPlan, env: Env) => generateProject(expandPlan(withEnv(plan, env)), 'gcp').items.map((i) => [i.key, i.name, i.valid]);
const apiNames = (body: { data: { gcp: { items: { key: string; name: string; valid: boolean }[] } } }) => body.data.gcp.items.map((i) => [i.key, i.name, i.valid]);

describe('계획 파일 → POST /v1/wizard (D100)', () => {
  it('규칙 버전 — 0.1.12 마법사 카드 표(D123~D127)와 0.2.0 AWS 켜기를 합친 값이다(2026-10-24.1 은 라벨 ASCII 빠른 길 — 출력 불변 · 엔진 소스만 바뀜 · 2026-10-24.2 는 RDS Blue/Green 배포 규칙 — D131 · 2026-10-24.3 은 BigQuery 테이블 규칙 — D132 · 2026-10-24.4 는 Logging 규칙 셋 — D133 · 2026-10-24.5 는 Workflows 규칙 — D134 · 2026-10-24.6 은 태그 키 · 값 규칙 — D135 · 2026-10-24.7 은 네트워크 방화벽 정책 규칙 — D136 · 2026-10-24.8 은 리뷰 반영 — D133 지표 · 버킷 위치 · 2026-10-24.9 는 D132 테이블 앞뒤 공백 · 2026-10-24.10 은 D136 안내 문구)', () => {
    expect(RULES_REVISION).toBe('2026-10-24.10');
    expect(VERSION.rules).toBe(RULES_REVISION);
  });

  it('내려받은 파일(들여쓰기 그대로)을 본문으로 → 200 · 웹과 같은 이름 · rules_version 고정이 지금 버전이라 409 가 아니다', async () => {
    const s = saved(FULL_PLAN);
    const { res } = await req(app, '/v1/wizard', textPost(s.text));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.version.rules).toBe(VERSION.rules);
    expect(apiNames(body)).toEqual(webNames(FULL_PLAN, 'prod'));
    expect(body.data.gcp.items.length).toBeGreaterThanOrEqual(20);
  });

  it('환경 여럿 — environments 는 무시된다(모르는 최상위 키) · project.env 하나만 계산 · env 마다 바꿔 보내면 웹의 env 별 이름과 같다', async () => {
    const s = saved(FULL_PLAN, ['stg', 'dev']);
    expect(s.file.environments).toEqual(['prod', 'stg', 'dev']);
    const withEnvs = await json((await req(app, '/v1/wizard', textPost(s.text))).res);
    const { environments: _e, ...single } = s.file;
    const without = await json((await req(app, '/v1/wizard', textPost(JSON.stringify(single)))).res);
    expect(withEnvs.success).toBe(true);
    expect(withEnvs.data).toEqual(without.data);
    for (const env of s.file.environments as Env[]) {
      const { res } = await req(app, '/v1/wizard', textPost(JSON.stringify({ ...s.file, project: { ...s.file.project, env } })));
      expect(res.status, env).toBe(200);
      expect(apiNames(await json(res)), env).toEqual(webNames(FULL_PLAN, env));
    }
    // 모르는 최상위 키 하나 더 — 그래도 같은 답(parseWizardBody 는 아는 키만 읽는다)
    const extra = await json((await req(app, '/v1/wizard', textPost(JSON.stringify({ ...s.file, note: { any: 1 } })))).res);
    expect(extra.data).toEqual(without.data);
  });

  /** 같은 파일 글을 웹(Open plan)으로 연 계획의 이름 — 화면이 실제로 들고 있는 모델(openPlanFile)에서 낸다 */
  const openedNames = (text: string) => {
    const opened = openPlanFile(text)!;
    expect(opened.plan, 'openPlanFile').toBeDefined();
    return { opened, names: webNames(opened.plan!, opened.project.env as Env) };
  };

  it('같은 파일 글을 웹과 API 에 — 깨끗한 파일: Open plan 으로 연 계획의 이름 = 그 글을 보낸 응답의 이름', async () => {
    const text = saved(FULL_PLAN).text;
    const { opened, names } = openedNames(text);
    expect(opened.ignoredKeys).toBe(0);
    const { res } = await req(app, '/v1/wizard', textPost(text));
    expect(res.status).toBe(200);
    expect(apiNames(await json(res))).toEqual(names);
  });

  it('같은 파일 글을 웹과 API 에 — 모르는 키(최상위 · project · 서비스 · pick · 슬롯)가 섞여도 둘 다 무시해 같은 이름이다 · $schema 도 받는다', async () => {
    const f = structuredClone(saved(FULL_PLAN).file) as unknown as Record<string, any>;
    f.$schema = 'https://example.com/plan.schema.json';
    f.note = { any: 1 };
    f.project.purpose = 'shop';
    f.services[1].n = 'other';
    f.services[0].picks[3].pr = 'web';
    f.services[0].picks[0].instances[1].note = 'x';
    f.project_picks[1].instances[1].q = '09';
    const text = JSON.stringify(f, null, 2);
    const { opened, names } = openedNames(text);
    expect(opened.ignoredKeys).toBe(6);
    expect(opened.notices).toEqual({ dropped: 0, haOff: 0, serverlessOff: 0, trimmed: 0, discarded: false });
    const { res } = await req(app, '/v1/wizard', textPost(text));
    expect(res.status).toBe(200);
    expect(apiNames(await json(res))).toEqual(names);
    // 깨끗한 파일과도 같다 — 모르는 키가 결과를 바꾸지 않는다
    expect(names).toEqual(webNames(FULL_PLAN, 'prod'));
  });

  it('큰 계획 — 이름 180개 넘는 계획의 들여쓴 파일이 16 KiB 를 넘어도 32 KiB 안이면 그대로 200 (설계서 실측: 188개 = 16,393 B)', async () => {
    // 서비스 18개 × (web 서버 셋 + boot · Cloud SQL · 버킷 · 서비스 계정 · Secret) = 이름 10개씩 + 네트워크 + 프로젝트 ID
    const services = Array.from({ length: 18 }, (_, i) => ({
      purpose: `service${i + 1}`,
      picks: [
        { preset: 'web', instances: Array.from({ length: 3 }, (_, k) => ({ id: String(k + 1), seq: `0${k + 1}`, attach: { boot: true as const } })) },
        { preset: 'db', kind: 'POSTGRES', instances: [{ id: '1', seq: '01' }] },
        { preset: 'object' },
        { preset: 'sa', role: 'db' },
        { preset: 'secret', instances: [{ id: '1', seq: '01' }] },
      ],
    }));
    const big: WizardPlan = { ...FULL_PLAN, projectPicks: FULL_PLAN.projectPicks, services };
    const s = saved(big);
    const indented = new TextEncoder().encode(s.text).length;
    expect(indented).toBeGreaterThan(16 * 1024);
    expect(indented).toBeLessThanOrEqual(MAX_BODY_BYTES);
    expect(s.overApiLimit).toBe(false);
    const { res } = await req(app, '/v1/wizard', textPost(s.text));
    expect(res.status).toBe(200);
    const items = (await json(res)).data.gcp.items as unknown[];
    expect(items.length).toBeGreaterThanOrEqual(180);
  });
});
