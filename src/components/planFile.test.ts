// 계획 파일 (D100) — hash v4 ↔ 파일 왕복이 손실 없는가 · 틀린 파일은 링크와 같은 길로 고쳐지고 같은 안내를 받는가
import { describe, it, expect } from 'vitest';
import { decodeWizardState, encodeWizardState, HASH_KEY, MAX_WIZARD_JSON_BYTES, type DecodedWizard } from './urlState';
import { PLAN_FILE_MAX_BYTES, openPlanFile, readPlanFile, savePlan } from './planFile';
import { initialPlan } from './wizardState';
import { MAX_CONTEXT_CHARS } from '../core/engine';
import { MAX_NAMES } from '../core/selection';
import { validatePlan, type Pick as WPick } from '../core/wizard/plan';
import { PLAN_MAX_BODY_BYTES, type PlanFile } from '../plan/wire';
import type { Env } from '../core/types';
import type { WizardPlan } from '../core/wizard/plan';
import { VERSION } from '../version';
import { FULL_PLAN, PLAN_PROJECT } from './__fixtures__/plan';

const V = VERSION.rules;
const PROJECT = PLAN_PROJECT;
const FULL = FULL_PLAN;

/** 링크로 연 모델 — 지역 · 위치가 코드로 풀린 값(화면이 실제로 들고 있는 꼴) */
function viaLink(plan: WizardPlan, envs: Env[] = []): { key: string; decoded: DecodedWizard } {
  const key = encodeWizardState(plan, V, envs);
  expect(key, 'encodeWizardState').toBeDefined();
  const decoded = decodeWizardState(`#${HASH_KEY}=${key}`)!;
  expect(decoded.plan).toBeDefined();
  return { key: key!, decoded };
}

function roundTrip(plan: WizardPlan, envs: Env[] = []) {
  const { key } = viaLink(plan, envs);
  const saved = savePlan(key, V)!;
  const opened = openPlanFile(saved.text)!;
  expect(opened.notices).toEqual({ dropped: 0, haOff: 0, serverlessOff: 0, trimmed: 0, discarded: false });
  expect(opened.ignoredKeys).toBe(0);
  const back = encodeWizardState(opened.plan!, opened.rulesVersion, opened.envs ?? []);
  return { key, saved, opened, back };
}

describe('왕복 — hash → 모델 → 파일 → 모델 → hash 가 글자까지 같다 · 파일 → 모델 → 파일도 같다', () => {
  it('칸 대응표 전부를 쓰는 계획 (환경 하나)', () => {
    const { key, saved, back } = roundTrip(FULL);
    expect(back).toBe(key);
    expect(savePlan(back!, V)!.text).toBe(saved.text);
    // 파일 꼴 — 요청 본문 이름(project_picks · rule · project_id_suffix) · 프리셋 pick 에 rule 없음 · 꺼진 칸 없음 · 환경 하나면 environments 없음
    const f = saved.file;
    expect(Object.keys(f)).toEqual(['provider', 'project', 'project_id_suffix', 'project_picks', 'services', 'rules_version']);
    expect(f.project).toEqual({ owner: 'platform', system: 'billing', env: 'prod', region: 'ane3' });
    expect(f.rules_version).toBe(V);
    expect(f.project_id_suffix).toBe('core');
    const shop = f.services[0]!.picks;
    expect(shop[0]).toEqual({ preset: 'web', ha: true, instances: [{ id: '1', seq: '01', attach: { boot: true, data: ['01', '02'], ip: true, ipi: true } }, { id: '2', seq: '02', attach: { boot: true } }] });
    expect(shop[1]).toEqual({ preset: 'db', kind: 'POSTGRES', instances: [{ id: '1', seq: '01' }] });
    expect(shop[2]).toEqual({ preset: 'object', location: 'us' });
    expect(shop[3]).toEqual({ preset: 'sa', role: 'db' });
    expect(shop[4]).toEqual({ preset: null, rule: 'gcp.cloud_function', instances: [{ id: 'a', seq: '07' }] });
    const pay = f.services[1]!.picks;
    expect(pay[0]).toMatchObject({ preset: 'was', serverless: 'gcp.run_service' });
    expect(pay[1]).toMatchObject({ preset: 'web', serverless: 'gcp.cloud_function' });
    expect(pay[2]).toMatchObject({ preset: 'secret', location: 'regional' });
    expect(f.project_picks[2]).toEqual({ preset: 'firewall', tier: 'web', instances: [{ id: '1', seq: '01' }] });
    expect(f.project_picks[1]!.instances!.map((s) => s.seq)).toEqual(['01', '03']);
  });

  it('환경 여럿 (D82) — environments 가 실리고 · 열면 환경 칩이 모두 돌아온다 · 첫째가 project.env', () => {
    const { key, saved, opened, back } = roundTrip(FULL, ['dev', 'stg']);
    expect(back).toBe(key);
    expect(saved.file.environments).toEqual(['prod', 'stg', 'dev']);
    expect(saved.file.project.env).toBe('prod');
    expect(opened.envs).toEqual(['prod', 'stg', 'dev']);
    expect(savePlan(back!, V)!.text).toBe(saved.text);
  });

  it('작은 계획 · custom 만 · 서비스만 — 왕복이 같다', () => {
    const { projectIdSuffix: _drop, ...noSuffix } = FULL;
    for (const plan of [
      { ...noSuffix, services: [] } as WizardPlan,
      { ...FULL, projectPicks: [] } as WizardPlan,
      { ...FULL, projectPicks: [{ preset: null, ruleId: 'gcp.vpc_network', instances: [{ id: 'z', seq: '99' }] }], services: [] } as WizardPlan,
    ]) {
      const { key, back } = roundTrip(plan);
      expect(back).toBe(key);
    }
  });

  it('파일 이름 · 들여쓰기 2칸 · 압축 바이트', () => {
    const saved = savePlan(viaLink(FULL).key, V)!;
    expect(saved.fileName).toBe('cloudonym-plan-billing-prod.json');
    expect(saved.text.startsWith('{\n  "provider": "gcp",\n')).toBe(true);
    expect(saved.text.endsWith('}\n')).toBe(true);
    expect(saved.apiBytes).toBe(new TextEncoder().encode(JSON.stringify(saved.file)).length);
    expect(saved.apiBytes).toBeLessThan(saved.text.length);
    expect(saved.overApiLimit).toBe(false);
    expect(PLAN_MAX_BODY_BYTES).toBe(32 * 1024);
    expect(savePlan('', V)).toBeUndefined();
  });
});

/** 같은 계획을 링크(hash)로 열 때 — 파일과 대어 본다 */
function viaHashJson(plan: Record<string, unknown>): DecodedWizard | undefined {
  const json = JSON.stringify(plan);
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return decodeWizardState(`#${HASH_KEY}=${b64}`);
}

describe('틀린 파일 — 링크와 같은 복구 · 같은 안내', () => {
  const base = (): PlanFile => savePlan(viaLink(FULL).key, V)!.file;

  it('JSON 아님 · 객체 아님 · provider 가 gcp 아님 · project 객체 아님 · 프로젝트 값이 틀림 · 너무 큼 → 열지 않는다', () => {
    expect(openPlanFile('not json')).toBeUndefined();
    expect(openPlanFile('[1,2]')).toBeUndefined();
    expect(openPlanFile(JSON.stringify({ ...base(), provider: 'aws' }))).toBeUndefined();
    expect(openPlanFile(JSON.stringify({ ...base(), project: 'x' }))).toBeUndefined();
    expect(openPlanFile(JSON.stringify({ ...base(), project: { ...base().project, env: 'preprod' } }))).toBeUndefined();
    expect(openPlanFile(`${JSON.stringify(base())}${' '.repeat(PLAN_FILE_MAX_BYTES)}`)).toBeUndefined();
  });

  it('pick 하나가 틀림(모르는 프리셋) → 그 pick 만 빠지고 dropped 1 — 같은 내용의 링크와 안내가 같다', () => {
    const f = base();
    f.services[0]!.picks.splice(1, 0, { preset: 'nope' });
    const file = openPlanFile(JSON.stringify(f))!;
    const link = viaHashJson({ ...PROJECT, region: 'ane3', v: V, x: 'core', w: { pp: [], s: [{ n: 'shop', p: [{ pr: 'web', i: [{ id: '1', q: '01' }] }, { pr: 'nope' }] }] } })!;
    expect(file.notices).toEqual({ dropped: 1, haOff: 0, serverlessOff: 0, trimmed: 0, discarded: false });
    expect(link.notices).toEqual(file.notices);
    expect(file.plan!.services[0]!.picks.map((p) => p.preset)).toEqual(['web', 'db', 'object', 'sa', null]);
  });

  it('모르는 키(최상위 · project · 서비스 · pick · 슬롯)는 API 처럼 무시하고 센다 — 계획은 깨끗한 파일과 같다 · 짧은 꼴 이름(n · i · q)도 뜻으로 읽지 않는다', () => {
    const clean = openPlanFile(JSON.stringify(base()))!;
    const f = base() as unknown as Record<string, any>;
    f.services[0].picks[3].extra = 1;
    f.services[0].picks[3].pr = 'web';
    f.project_picks[1].instances[1].note = 'x';
    f.project_picks[1].instances[1].q = '09';
    f.services[1].n = 'other';
    f.project.purpose = 'shop';
    const opened = openPlanFile(JSON.stringify({ ...f, $comment: 'ignored' }))!;
    expect(opened.ignoredKeys).toBe(7);
    expect(opened.notices).toEqual(clean.notices);
    expect(opened.plan).toEqual(clean.plan);
    expect(clean.ignoredKeys).toBe(0);
  });

  it('$schema 는 아는 키다 — 에디터가 단 파일을 그대로 연다(세지 않는다)', () => {
    const opened = openPlanFile(JSON.stringify({ $schema: 'https://example.com/plan.schema.json', ...base() }))!;
    expect(opened.ignoredKeys).toBe(0);
    expect(opened.plan).toEqual(openPlanFile(JSON.stringify(base()))!.plan);
  });

  it('attach 안의 모르는 키는 예외 — API 도 거부하므로(attach_not_object) 링크처럼 그 attach 만 버리고 dropped 로 센다', () => {
    const f = base() as unknown as Record<string, any>;
    f.services[0].picks[0].instances[1].attach.b = 1;
    const opened = openPlanFile(JSON.stringify(f))!;
    expect(opened.ignoredKeys).toBe(0);
    expect(opened.notices.dropped).toBe(1);
    expect(opened.plan!.services[0]!.picks[0]!.instances![1]).toEqual({ id: '2', seq: '02' });
  });

  it('HA 서버가 하나 · 서버리스 값이 틀림 · pick 수 초과 — 링크와 같은 안내', () => {
    const f = base();
    f.services[0]!.picks[0]!.instances!.splice(1);
    f.services[1]!.picks[0]!.serverless = 'gcp.vpc_network';
    const opened = openPlanFile(JSON.stringify(f))!;
    expect(opened.notices).toMatchObject({ haOff: 1, serverlessOff: 1 });
    expect(opened.plan!.services[0]!.picks[0]!.ha).toBeUndefined();
    // hash 의 짧은 값(run)은 파일에서 받지 않는다 — 규칙 id 전체만
    const short = base();
    short.services[1]!.picks[0]!.serverless = 'run';
    expect(openPlanFile(JSON.stringify(short))!.notices.serverlessOff).toBe(1);
    const many = base();
    many.project_picks = Array.from({ length: 41 }, (_, i) => ({ preset: 'firewall', tier: `t${i}`, instances: [{ id: '1', seq: '01' }] }));
    const trimmed = openPlanFile(JSON.stringify(many))!;
    expect(trimmed.notices.trimmed).toBe(1);
    expect(trimmed.plan!.projectPicks).toHaveLength(40);
  });

  it('모델 전체 오류(고른 것이 없음 · services 가 배열 아님) → 계획을 버리고 프로젝트 넷만 — discarded', () => {
    for (const bad of [{ ...base(), project_picks: [], services: [] }, { ...base(), services: 'shop' }]) {
      const opened = openPlanFile(JSON.stringify(bad))!;
      expect(opened.notices.discarded).toBe(true);
      expect(opened.plan).toBeUndefined();
      expect(opened.project).toEqual({ owner: 'platform', system: 'billing', env: 'prod', region: 'ane3' });
    }
  });

  it('environments — 배열 아님은 통째로 · 표준값 아닌 항목은 하나씩 버리고 센다(hash 의 e 와 같다)', () => {
    expect(openPlanFile(JSON.stringify({ ...base(), environments: ['stg', 'preprod', 'dev'] }))!).toMatchObject({ envs: ['prod', 'stg', 'dev'], notices: { dropped: 1 } });
    const notArray = openPlanFile(JSON.stringify({ ...base(), environments: 'stg' }))!;
    expect(notArray.notices.dropped).toBe(1);
    expect(notArray.envs).toBeUndefined();
  });

  it('규칙 버전이 다른 파일 — 열되 rulesVersion 으로 그 버전을 돌려준다(화면이 버전 안내를 띄운다) · 꼴이 틀린 값은 없는 것으로', () => {
    const old = openPlanFile(JSON.stringify({ ...base(), rules_version: '2026-01-01.1' }))!;
    expect(old.rulesVersion).toBe('2026-01-01.1');
    expect(old.plan).toBeDefined();
    expect(openPlanFile(JSON.stringify({ ...base(), rules_version: 'latest' }))!.rulesVersion).toBeUndefined();
  });
});

describe('읽기 상한 · 화면에 놓을 상태 (D100)', () => {
  it('상한은 링크를 푼 JSON 의 최악 바이트와 같다 — 최대에 가까운 계획(서비스 20 · 자유 입력 최악 · 이름 200)의 들여쓴 파일이 그 안이다', () => {
    expect(PLAN_FILE_MAX_BYTES).toBe(MAX_WIZARD_JSON_BYTES);
    const worst = '\u0001'.repeat(MAX_CONTEXT_CHARS);
    const svc = (i: number, n: number) => ({
      purpose: `${String(i).padStart(2, '0')}${'\u0001'.repeat(MAX_CONTEXT_CHARS - 2)}`,
      picks: [{ preset: null, ruleId: 'gcp.compute_instance', tier: 'abcdefghijklmnop', instances: Array.from({ length: n }, (_, k) => ({ id: `abcdef${String(k).padStart(2, '0')}`, seq: String(k + 1).padStart(2, '0'), attach: { boot: true as const, ip: true as const } })) }] as WPick[],
    });
    // 이름 = 1 + 서비스마다 (VM n + boot n + ip n) — 19 × 9 + 1 × 9 + 1 = 181 · 다음 서비스를 더하면 200 을 넘는다
    const plan: WizardPlan = { provider: 'gcp', project: { ...PROJECT, region: 'ane3', owner: worst, system: worst }, projectPicks: [], services: Array.from({ length: 20 }, (_, i) => svc(i, 3)), projectIdSuffix: 'abcdefghijklmnop' };
    expect(validatePlan(plan)).toEqual({ ok: true });
    const saved = savePlan(encodeWizardState(plan, V, ['dev', 'stg', 'uat', 'qa', 'perf', 'dr', 'sandbox', 'test'] as Env[])!, V)!;
    const bytes = new TextEncoder().encode(saved.text).length;
    expect(bytes).toBeLessThan(PLAN_FILE_MAX_BYTES / 2);
    expect(MAX_NAMES).toBe(200);
    expect(openPlanFile(saved.text)!.plan).toBeDefined();
  });

  const fileOf = (text: string, size = new TextEncoder().encode(text).length) => ({ size, text: () => Promise.resolve(text) });

  it('readPlanFile — 연 계획 · 환경 · 그 상태의 hash 키(화면의 stateKey 와 같은 값 — ui_generate 를 보내지 않는 기준)', async () => {
    const saved = savePlan(viaLink(FULL, ['dev']).key, V)!;
    const st = (await readPlanFile(fileOf(saved.text), V))!;
    expect(st.plan).toEqual(st.opened.plan);
    expect(st.envs).toEqual(['prod', 'dev']);
    expect(st.key).toBe(encodeWizardState(st.plan, V, st.envs));
    expect(st.key).toBe(viaLink(FULL, ['dev']).key);
  });

  it('readPlanFile — 계획을 버린 파일은 프로젝트 넷만 든 빈 계획 · 키는 빈 문자열(화면도 stateKey 가 비어 보내지 않는다)', async () => {
    const st = (await readPlanFile(fileOf(JSON.stringify({ ...savePlan(viaLink(FULL).key, V)!.file, project_picks: [], services: [] })), V))!;
    expect(st.opened.notices.discarded).toBe(true);
    expect(st.plan).toEqual(initialPlan({ owner: 'platform', system: 'billing', env: 'prod', region: 'ane3' }));
    expect(st.key).toBe(encodeWizardState(st.plan, V, []) ?? '');
  });

  it('readPlanFile — 읽기가 거부되면(file.text() 실패) · 상한을 넘으면(읽지 않는다) · 열리지 않으면 undefined', async () => {
    const rejecting = { size: 10, text: () => Promise.reject(new Error('NotReadableError')) };
    await expect(readPlanFile(rejecting, V)).resolves.toBeUndefined();
    let read = false;
    const big = { size: PLAN_FILE_MAX_BYTES + 1, text: () => { read = true; return Promise.resolve('{}'); } };
    await expect(readPlanFile(big, V)).resolves.toBeUndefined();
    expect(read).toBe(false);
    await expect(readPlanFile(fileOf('not json'), V)).resolves.toBeUndefined();
  });
});
