// 저장소 CLI 의 계약 시험 (D102) — Worker 앱을 in-process 로 띄워(test-support 의 req) CLI 를 실제로 부른다. 네트워크 없이 진짜 엔진의 답이다.
// 방향은 src 시험 → cli 뿐이다 — cli/ 는 src/ 를 들여오지 않는다(cli/boundary.test.mjs)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from './index';
import { req, fakeLimiter, jsonPost, json, type Loose } from './test-support';
import type { Bindings } from './env';
import { classifyClient } from './telemetry';
import { VERSION } from '../version';
import { main, EXIT, USER_AGENT, nextSeq as cliNextSeq, nextSlotId as cliNextSlotId, type FetchFn } from '../../cli/lib/main.mjs';
import { DEFAULT_SERVER } from '../../cli/lib/server.mjs';
import { nextSeq, nextSlotId } from '../components/wizardState';
import { toWizardExport } from '../components/wizardExport';
import { expandPlan, type WizardPlan } from '../core/wizard/plan';
import { generateProject, parseProjectContext } from '../core/engine';
import { toModelPick } from '../plan/wire';
import { catalogPresets } from './catalog';

const SERVER = 'http://cli.test';

/** CLI 의 fetch 를 Worker 앱으로 — origin 을 떼고 req(app, path, init, env) 로 부른다. 보낸 요청을 모은다 */
function viaApp(env: Bindings = {}, calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = []): FetchFn {
  return async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, ...(init.body === undefined ? {} : { body: init.body }) });
    const u = new URL(url);
    const { res } = await req(app, `${u.pathname}${u.search}`, { method: init.method, headers: init.headers, ...(init.body === undefined ? {} : { body: init.body }) }, env);
    return res;
  };
}

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cloudonym-cli-'));
  file = join(dir, 'cloudonym.plan.json');
});
// 시험마다 만든 임시 폴더를 지운다 — 시스템 임시 폴더에 남기지 않는다
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function run(argv: string[], o: { fetchFn?: FetchFn; env?: Record<string, string | undefined>; sleep?: (ms: number) => Promise<void> } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, {
    fetchFn: o.fetchFn ?? viaApp(), env: o.env ?? { CLOUDONYM_SERVER: SERVER }, cwd: dir, configPath: null,
    stdout: (s) => { out.push(s); }, stderr: (s) => { err.push(s); }, sleep: o.sleep ?? (async () => {}), now: () => new Date('2026-10-14T12:00:00Z'),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

/** 계획 A — 프로젝트 공용 VPC · 서비스 shop 에 웹 서버 VM 하나(boot · data 01) */
const PLAN_A = {
  provider: 'gcp',
  project: { owner: 'platform', system: 'billing', env: 'prod', region: 'asia-northeast3' },
  project_picks: [{ preset: 'vpc', instances: [{ id: '1', seq: '01' }] }],
  services: [{ purpose: 'shop', picks: [{ preset: 'web', instances: [{ id: '1', seq: '01', attach: { boot: true, data: ['01'] } }] }] }],
  rules_version: VERSION.rules,
};
const writePlan = (plan: unknown) => writeFileSync(file, `${JSON.stringify(plan, null, 2)}\n`);
const readPlanFile = (): Loose => JSON.parse(readFileSync(file, 'utf-8'));

/** 서버에 직접 묻는다 — 키 → { name, valid } */
async function namesOf(plan: Loose): Promise<Map<string, { name: string; valid: boolean }>> {
  const { environments: _e, ...body } = plan;
  const { res } = await req(app, '/v1/wizard', jsonPost(body));
  expect(res.status).toBe(200);
  const b = await json(res);
  return new Map(b.data.gcp.items.map((it: Loose) => [it.key, { name: it.name, valid: it.valid }]));
}

describe('cloudonym add — 기존 키의 이름 · 판정은 그대로, 새 이름만 (D102)', () => {
  it('① VM 만 있는 계획에 add gcp.cloud_sql_instance --service shop --kind POSTGRES — 새 키 하나 · 기존 키 전부 같은 이름 · 기존 pick 바이트 그대로', async () => {
    writePlan(PLAN_A);
    const before = await namesOf(PLAN_A);
    const r = await run(['add', 'gcp.cloud_sql_instance', '--service', 'shop', '--kind', 'POSTGRES']);
    expect(r.code, r.err).toBe(EXIT.OK);
    const plan = readPlanFile();
    expect(JSON.stringify(plan.project_picks)).toBe(JSON.stringify(PLAN_A.project_picks));
    expect(JSON.stringify(plan.services[0].picks[0])).toBe(JSON.stringify(PLAN_A.services[0]!.picks[0]));
    expect(plan.services[0].picks[1]).toEqual({ preset: null, rule: 'gcp.cloud_sql_instance', kind: 'POSTGRES', instances: [{ id: '1', seq: '01' }] });
    const after = await namesOf(plan);
    for (const [k, x] of before) expect(after.get(k), k).toEqual(x);
    const fresh = [...after.keys()].filter((k) => !before.has(k));
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toMatch(/^service\/shop\/cloud_sql_instance\//);
    // 출력은 새 이름 한 줄뿐
    expect(r.out.split('\n')).toEqual([`${after.get(fresh[0]!)!.name}  ${fresh[0]}`]);
  });

  it('프리셋 이름 · 행 이름으로도 푼다 — add db --kind POSTGRES 는 프리셋 pick, add cloud_sql_instance 는 규칙 pick', async () => {
    writePlan(PLAN_A);
    expect((await run(['add', 'db', '--service', 'pay', '--kind', 'POSTGRES', '--dry-run'])).code).toBe(EXIT.OK);
    expect(readPlanFile()).toEqual(PLAN_A);
    const r = await run(['add', 'cloud_sql_instance', '--service', 'pay', '--kind', 'POSTGRES']);
    expect(r.code, r.err).toBe(EXIT.OK);
    expect(readPlanFile().services[1]).toEqual({ purpose: 'pay', picks: [{ preset: null, rule: 'gcp.cloud_sql_instance', kind: 'POSTGRES', instances: [{ id: '1', seq: '01' }] }] });
    const bad = await run(['add', 'nosuchthing', '--service', 'pay']);
    expect(bad.code).toBe(EXIT.INPUT);
  });

  it('② 같은 pick 에 add web --service shop — 슬롯 02 가 끝에 붙고 01 의 딸린 것 · 이름 그대로', async () => {
    writePlan(PLAN_A);
    const before = await namesOf(PLAN_A);
    const r = await run(['add', 'web', '--service', 'shop']);
    expect(r.code, r.err).toBe(EXIT.OK);
    const plan = readPlanFile();
    expect(plan.services[0].picks).toHaveLength(1);
    expect(plan.services[0].picks[0].instances).toEqual([...PLAN_A.services[0]!.picks[0]!.instances, { id: '2', seq: '02' }]);
    const after = await namesOf(plan);
    for (const [k, x] of before) expect(after.get(k), k).toEqual(x);
    expect([...after.keys()].filter((k) => !before.has(k))).toEqual(['service/shop/compute_instance/-/web/02']);
  });

  it('③ 번호에 빈 자리(01 · 03)가 있으면 최대 + 1 = 04 — 02 를 채우지 않는다', async () => {
    writePlan({ ...PLAN_A, services: [{ purpose: 'shop', picks: [{ preset: 'web', instances: [{ id: '1', seq: '01' }, { id: '3', seq: '03' }] }] }] });
    const r = await run(['add', 'web', '--service', 'shop', '--count', '1']);
    expect(r.code, r.err).toBe(EXIT.OK);
    expect(readPlanFile().services[0].picks[0].instances.map((s: Loose) => s.seq)).toEqual(['01', '03', '04']);
    expect(readPlanFile().services[0].picks[0].instances.at(-1).id).toBe('2');
  });

  it('④ 충돌을 만드는 add — exit 1 · 파일 바이트 그대로 · 기존 키가 FAIL 로 바뀐다고 보인다', async () => {
    // Cloud Functions 1세대 · 2세대는 같은 이름이 된다(test-support 의 wizard-conflict 표본과 같다)
    const plan = { ...PLAN_A, project_picks: [], services: [{ purpose: 'shop', picks: [{ preset: null, rule: 'gcp.cloud_function', instances: [{ id: '1', seq: '01' }] }] }] };
    writePlan(plan);
    const bytes = readFileSync(file, 'utf-8');
    const r = await run(['add', 'gcp.cloud_function_gen1', '--service', 'shop']);
    expect(r.code).toBe(EXIT.FAIL);
    expect(readFileSync(file, 'utf-8')).toBe(bytes);
    expect(r.err).toMatch(/would change service\/shop\/cloud_function\/-\/-\/01: \S+ PASS -> \S+ FAIL/);
    expect(r.err).toContain('Not written');
    expect(r.out).toBe('');
  });

  it('⑤ --dry-run 은 쓰지 않고 새 이름을 보인다 · 고르지 않은 자리는 사용법 오류(64)', async () => {
    writePlan(PLAN_A);
    const bytes = readFileSync(file, 'utf-8');
    const r = await run(['add', 'object', '--service', 'shop', '--dry-run']);
    expect(r.code, r.err).toBe(EXIT.OK);
    expect(r.out).toMatch(/service\/shop\/storage_bucket/);
    expect(readFileSync(file, 'utf-8')).toBe(bytes);
    expect((await run(['add', 'object'])).code).toBe(EXIT.USAGE);
  });

  it('번호 없는 규칙을 두 번 add — 덧붙일 것이 없다(exit 2) · 서버가 거부하는 pick(--pick) 은 400 → exit 2 · 파일 그대로', async () => {
    writePlan({ ...PLAN_A, services: [{ purpose: 'shop', picks: [{ preset: 'object' }] }] });
    expect((await run(['add', 'object', '--service', 'shop'])).code).toBe(EXIT.INPUT);
    const bytes = readFileSync(file, 'utf-8');
    const r = await run(['add', '--service', 'shop', '--pick', '{"preset":null,"rule":"gcp.nope"}']);
    expect(r.code).toBe(EXIT.INPUT);
    expect(r.err).toMatch(/services\[0\]\.picks\[1\]/);
    expect(readFileSync(file, 'utf-8')).toBe(bytes);
  });
});

describe('cloudonym names · validate · init (D102)', () => {
  it('init 은 /v1/health 의 규칙 버전으로 빈 계획을 쓴다 · --from 은 웹 파일을 옮기고 환경을 합친다 · 링크는 아직 받지 않는다(64)', async () => {
    const r = await run(['init', '--owner', 'platform', '--system', 'billing', '--env', 'prod,stg', '--region', 'asia-northeast3']);
    expect(r.code, r.err).toBe(EXIT.OK);
    expect(readPlanFile()).toEqual({ provider: 'gcp', project: { owner: 'platform', system: 'billing', env: 'prod', region: 'asia-northeast3' }, project_picks: [], services: [], rules_version: VERSION.rules, environments: ['prod', 'stg'] });
    expect((await run(['init', '--owner', 'a', '--system', 'b', '--env', 'dev', '--region', 'global'])).code).toBe(EXIT.INPUT);
    const src = join(dir, 'saved.json');
    writeFileSync(src, JSON.stringify({ ...PLAN_A, environments: ['stg', 'prod', 'stg'] }));
    expect((await run(['init', '--from', src, '--force'])).code).toBe(EXIT.OK);
    expect(readPlanFile().environments).toEqual(['prod', 'stg']);
    expect((await run(['init', '--from', 'https://example.org/#w=abc', '--force'])).code).toBe(EXIT.USAGE);
  });

  it('names → 보관 파일 · add 뒤 names --new 는 새 키만 · validate 는 보관 파일과 같으면 0, 다르면 1', async () => {
    writePlan(PLAN_A);
    const n = await run(['names']);
    expect(n.code, n.err).toBe(EXIT.OK);
    const stored = JSON.parse(readFileSync(join(dir, 'cloudonym.plan.names.json'), 'utf-8'));
    expect(stored.received_at).toBe('2026-10-14T21:00:00+09:00');
    expect(stored.rules_version).toBe(VERSION.rules);
    expect((await run(['add', 'db', '--service', 'shop', '--kind', 'POSTGRES'])).code).toBe(EXIT.OK);
    const fresh = await run(['names', '--new']);
    expect(fresh.code).toBe(EXIT.OK);
    expect(fresh.out.split('\n')).toHaveLength(1);
    expect(fresh.out).toMatch(/service\/shop\/cloud_sql_instance/);
    expect((await run(['validate'])).code).toBe(EXIT.OK);
    // 보관 파일의 이름 하나를 바꿔 두면 validate 가 잡는다
    const s2 = JSON.parse(readFileSync(join(dir, 'cloudonym.plan.names.json'), 'utf-8'));
    s2.environments.prod.names[0].name = 'renamed-by-hand';
    writeFileSync(join(dir, 'cloudonym.plan.names.json'), JSON.stringify(s2));
    const v = await run(['validate']);
    expect(v.code).toBe(EXIT.FAIL);
    expect(v.err).toMatch(/differs from the names file/);
  });

  it('names --json 의 이름 칸 = 웹 JSON 내보내기(toWizardExport)의 names 와 글자까지 같다 · 환경 둘이면 환경마다', async () => {
    writePlan({ ...PLAN_A, environments: ['prod', 'stg'] });
    const r = await run(['names', '--json']);
    expect(r.code, r.err).toBe(EXIT.OK);
    const doc = JSON.parse(r.out);
    expect(Object.keys(doc.environments)).toEqual(['prod', 'stg']);
    for (const env of ['prod', 'stg']) {
      const model = { provider: 'gcp', project: { ...PLAN_A.project, env }, projectPicks: PLAN_A.project_picks.map(toModelPick), services: PLAN_A.services.map((s) => ({ purpose: s.purpose, picks: s.picks.map(toModelPick) })) } as unknown as WizardPlan;
      const parsed = parseProjectContext(model.project, 'gcp');
      if (!parsed.ok) throw new Error('project');
      const web = toWizardExport(generateProject(expandPlan(model), 'gcp'), parsed.context, model, VERSION);
      expect(doc.environments[env].names, env).toEqual(web.names);
    }
  });

  it('validate — FAIL 이 있는 계획은 1', async () => {
    writePlan({ ...PLAN_A, project_picks: [], services: [{ purpose: 'shop', picks: [{ preset: null, rule: 'gcp.cloud_function', instances: [{ id: '1', seq: '01' }] }, { preset: null, rule: 'gcp.cloud_function_gen1', instances: [{ id: '1', seq: '01' }] }] }] });
    const r = await run(['validate']);
    expect(r.code).toBe(EXIT.FAIL);
    expect(r.err).toMatch(/FAIL service\/shop\/cloud_function/);
  });
});

describe('cloudonym — 409 · 429 · 연결 실패 · 서버 없음 · User-Agent (D102)', () => {
  it('409 rules_version — exit 3 · 파일 그대로 / names --repin 은 지금 버전으로 고쳐 쓰고 0', async () => {
    writePlan({ ...PLAN_A, rules_version: '2026-01-01.1' });
    const r = await run(['names']);
    expect(r.code).toBe(EXIT.VERSION);
    expect(r.err).toContain(`made with rules 2026-01-01.1; the server's rules are ${VERSION.rules}`);
    expect(readPlanFile().rules_version).toBe('2026-01-01.1');
    expect((await run(['add', 'object', '--service', 'shop'])).code).toBe(EXIT.VERSION);
    expect((await run(['validate'])).code).toBe(EXIT.VERSION);
    const p = await run(['names', '--repin']);
    expect(p.code, p.err).toBe(EXIT.OK);
    expect(readPlanFile().rules_version).toBe(VERSION.rules);
  });

  it('429 — Retry-After 를 알리고 exit 4 · --wait 는 한 번만 다시 보낸다', async () => {
    writePlan(PLAN_A);
    const calls: { url: string }[] = [];
    const env: Bindings = { API_LIMITER: fakeLimiter('deny').limiter };
    const r = await run(['names'], { fetchFn: viaApp(env, calls as never) });
    expect(r.code).toBe(EXIT.UNAVAILABLE);
    expect(r.err).toMatch(/Rate limited \(429\).*Retry after 60 s/);
    expect(calls).toHaveLength(1);
    const waits: number[] = [];
    const calls2: { url: string }[] = [];
    const w = await run(['names', '--wait'], { fetchFn: viaApp(env, calls2 as never), sleep: async (ms) => { waits.push(ms); } });
    expect(w.code).toBe(EXIT.UNAVAILABLE);
    expect(calls2).toHaveLength(2);
    expect(waits).toEqual([60_000]);
    // add 는 /catalog.json 부터 막힌다 — 파일 그대로
    const bytes = readFileSync(file, 'utf-8');
    expect((await run(['add', 'object', '--service', 'shop'], { fetchFn: viaApp(env) })).code).toBe(EXIT.UNAVAILABLE);
    expect(readFileSync(file, 'utf-8')).toBe(bytes);
  });

  it('서버에 못 닿으면 exit 4 — names 는 보관 파일이 있으면 그것을 「낡은 값」이라 밝히고 보인다', async () => {
    writePlan(PLAN_A);
    const down: FetchFn = () => Promise.reject(new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:9') }));
    const r = await run(['names'], { fetchFn: down });
    expect(r.code).toBe(EXIT.UNAVAILABLE);
    expect(r.err).toContain('Cannot reach http://cli.test: fetch failed (connect ECONNREFUSED');
    expect(r.out).toBe('');
    expect((await run(['names'])).code).toBe(EXIT.OK);
    const s = await run(['names'], { fetchFn: down });
    expect(s.code).toBe(EXIT.UNAVAILABLE);
    expect(s.err).toMatch(/stored names .* not fresh/);
    expect(s.out).toMatch(/service\/shop\/compute_instance\/-\/web\/01/);
    expect((await run(['add', 'object', '--service', 'shop'], { fetchFn: down })).code).toBe(EXIT.UNAVAILABLE);
    expect((await run(['validate'], { fetchFn: down })).code).toBe(EXIT.UNAVAILABLE);
  });

  it('서버를 주지 않으면 공개 배포(DEFAULT_SERVER)를 부른다 (D121) · http(s) 가 아니면 64', async () => {
    writePlan(PLAN_A);
    const calls: { url: string; headers: Record<string, string>; body?: string }[] = [];
    const r = await run(['names'], { env: {}, fetchFn: viaApp({}, calls as never) });
    expect(r.code, r.err).toBe(EXIT.OK);
    expect(calls.map((c) => c.url)).toEqual([`${DEFAULT_SERVER}/v1/wizard`]);
    expect((await run(['names', '--server', 'ftp://x'], { env: {} })).code).toBe(EXIT.USAGE);
    expect((await run(['names', '--server', SERVER], { env: {} })).code).toBe(EXIT.OK);
  });

  it('요청마다 User-Agent cloudonym-cli/<버전> — classifyClient 가 cli 로 센다 · 본문은 압축 · environments 를 떼고 보낸다', async () => {
    writePlan({ ...PLAN_A, environments: ['prod', 'stg'] });
    const calls: { url: string; headers: Record<string, string>; body?: string }[] = [];
    await run(['names'], { fetchFn: viaApp({}, calls as never) });
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.headers['user-agent']).toBe(USER_AGENT);
      expect(classifyClient(c.headers['user-agent'])).toBe('cli');
      expect(c.body).not.toContain('\n');
      expect(JSON.parse(c.body!)).not.toHaveProperty('environments');
    }
    expect(calls.map((c) => JSON.parse(c.body!).project.env)).toEqual(['prod', 'stg']);
    expect(USER_AGENT).toMatch(/^cloudonym-cli\/\d+\.\d+\.\d+$/);
  });
});

describe('다음 빈 번호 — 화면(wizardState)과 CLI 가 같은 표(cli/fixtures/next-seq.json)에서 같은 답', () => {
  const fx = JSON.parse(readFileSync(join(import.meta.dirname, '../../cli/fixtures/next-seq.json'), 'utf-8')) as { nextSeq: { used: string[] | 'ALL'; next: string | null }[]; nextSlotId: { used: string[]; next: string }[] };
  const all = Array.from({ length: 99 }, (_, i) => String(i + 1).padStart(2, '0'));
  it('nextSeq · nextSlotId', () => {
    expect(fx.nextSeq.length).toBeGreaterThan(5);
    for (const c of fx.nextSeq) {
      const used = c.used === 'ALL' ? all : c.used;
      expect(nextSeq(used) ?? null, JSON.stringify(c)).toBe(c.next);
      expect(cliNextSeq(used) ?? null, JSON.stringify(c)).toBe(c.next);
    }
    for (const c of fx.nextSlotId) {
      expect(nextSlotId(c.used)).toBe(c.next);
      expect(cliNextSlotId(c.used)).toBe(c.next);
    }
  });
});

describe('cloudonym add — 「같은 pick」을 서버의 duplicate 판정과 맞춘다 (D102 리뷰 9)', () => {
  const withPick = (pick: Loose) => ({ ...PLAN_A, services: [{ purpose: 'shop', picks: [pick] }] });

  it('기본 종류를 밝혀 적은 add db --kind MYSQL 은 kind 없는 db pick 과 같은 pick — 슬롯을 덧붙인다(400 이 아니다)', async () => {
    writePlan(withPick({ preset: 'db', instances: [{ id: '1', seq: '01' }] }));
    const r = await run(['add', 'db', '--service', 'shop', '--kind', 'MYSQL']);
    expect(r.code, r.err).toBe(EXIT.OK);
    const picks = readPlanFile().services[0].picks;
    expect(picks).toHaveLength(1);
    expect(picks[0]).toEqual({ preset: 'db', instances: [{ id: '1', seq: '01' }, { id: '2', seq: '02' }] });
  });

  it('위치만 다른 add object --location US 는 서버가 같은 pick 으로 센다 — exit 2 · 파일 그대로 · 이유를 밝힌다', async () => {
    writePlan(withPick({ preset: 'object' }));
    const bytes = readFileSync(file, 'utf-8');
    const r = await run(['add', 'object', '--service', 'shop', '--location', 'US']);
    expect(r.code).toBe(EXIT.INPUT);
    expect(readFileSync(file, 'utf-8')).toBe(bytes);
    expect(r.err).toMatch(/location does not make a separate pick/);
  });

  it('같은 pick 에 덧붙일 때 --ha 는 쓰이지 않는다고 알린다', async () => {
    writePlan(PLAN_A);
    const r = await run(['add', 'web', '--service', 'shop', '--ha']);
    expect(r.code, r.err).toBe(EXIT.OK);
    expect(r.err).toMatch(/--ha is ignored/);
    expect(readPlanFile().services[0].picks[0].ha).toBeUndefined();
  });
});

describe('묻고 답하는 흐름 — 진짜 엔진의 답 (D121 · 설계 §7 · §8 ④ ⑥)', () => {
  /** 터미널인 척 — 답은 스트림으로, 물음 · 표는 한 줄기로 */
  async function term(argv: string[], answers: string[], cwd: string) {
    let screen = '';
    const err: string[] = [];
    const code = await main(argv, {
      fetchFn: viaApp(), cwd, env: { CLOUDONYM_SERVER: SERVER }, configPath: null, now: () => new Date('2026-10-20T00:00:00+09:00'), sleep: async () => {},
      tty: { stdin: true, stdout: true }, stdin: Readable.from(answers.map((a) => `${a}\n`)), write: (x) => { screen += x; }, stdout: (x) => { screen += `${x}\n`; }, stderr: (x) => { err.push(x); },
    });
    return { code, screen, err: err.join('\n') };
  }
  /** 메뉴 번호 — 프로젝트 공용 프리셋 먼저, 그다음 서비스 프리셋(catalog 순서) */
  const menuNumber = (id: string) => {
    const all = catalogPresets('gcp') as { id: string; level: string }[];
    const ordered = [...all.filter((p) => p.level === 'project'), ...all.filter((p) => p.level !== 'project')];
    return ordered.findIndex((p) => p.id === id) + 1;
  };
  const ANSWERS = () => [
    'demo', 'payment', '1', 'seoul', '1', ['vpc', 'subnet', 'web', 'db'].map(menuNumber).join(','),
    '', // VPC network — how many? [1]
    '', '', // Subnet — how many? [1] · kind [PRIVATE]
    'shop', '2', 'y', 'y', '0', 'n', 'n', // Web server — 서비스 이름 · 2대 · HA · boot · data 0 · ip · ipi
    '', 'POSTGRES', // Database — how many? [1] · kind
    'n', // Add more?
  ];

  it('④ 답으로 만든 계획 파일이 init · add(--pick 포함) 명령으로 만든 파일과 바이트까지 같다', async () => {
    const a = mkdtempSync(join(tmpdir(), 'cloudonym-cli-before-'));
    try {
      const steps = [
        ['init', '--owner', 'demo', '--system', 'payment', '--env', 'prod', '--region', 'asia-northeast3'],
        ['add', 'vpc', '--project'], ['add', 'subnet', '--project'],
        ['add', '--service', 'shop', '--pick', '{"preset":"web","ha":true,"instances":[{"id":"1","seq":"01","attach":{"boot":true}},{"id":"2","seq":"02","attach":{"boot":true}}]}'],
        ['add', 'db', '--service', 'shop', '--kind', 'POSTGRES'],
      ];
      for (const argv of steps) {
        const code = await main(argv, { fetchFn: viaApp(), cwd: a, env: { CLOUDONYM_SERVER: SERVER }, configPath: null, stdout: () => {}, stderr: () => {}, sleep: async () => {}, now: () => new Date('2026-10-20T00:00:00+09:00') });
        expect(code, argv.join(' ')).toBe(EXIT.OK);
      }
      const r = await term([], ANSWERS(), dir);
      expect(r.code, `${r.err}\n${r.screen}`).toBe(EXIT.OK);
      expect(readFileSync(file, 'utf-8')).toBe(readFileSync(join(a, 'cloudonym.plan.json'), 'utf-8'));
    } finally {
      rmSync(a, { recursive: true, force: true });
    }
  });

  it('⑥ 표 — What · Name · Check, 키 없이 · 딸린 것은 들여 쓴다 · 요약과 다음 할 일 (규칙 버전이 바뀌면 이름이 바뀔 수 있다)', async () => {
    const r = await term([], ANSWERS(), dir);
    expect(r.code, r.err).toBe(EXIT.OK);
    expect(r.screen).toContain(`Cloudonym — names for a Google Cloud project. Rules ${VERSION.rules}.\n`);
    expect(r.screen).toContain('Environments, comma-separated [1 prod · 2 stg · 3 dev · 4 sbx · 5 qa · 6 uat · 7 test · 8 perf · 9 dr]: 1\n');
    expect(r.screen).toContain('   1 asia-northeast3 — Seoul, South Korea, APAC\nPick [1]: 1\n');
    expect(r.screen.slice(r.screen.indexOf('What  ')).trimEnd().split('\n')).toEqual([
      'What                            Name                                    Check',
      'Project ID                      demo-payment-prod                       PASS',
      'VPC network 01                  payment-prod-vpc-01                     PASS',
      'Subnet 01                       payment-prod-ane3-snet-01               PASS',
      'Web server 01 (shop)            payment-shop-prod-ane3-gce-web-01       PASS',
      '  boot disk                     payment-shop-prod-ane3-gce-web-01-boot  PASS',
      'Web server 02 (shop)            payment-shop-prod-ane3-gce-web-02       PASS',
      '  boot disk                     payment-shop-prod-ane3-gce-web-02-boot  PASS',
      'Database (Cloud SQL) 01 (shop)  payment-shop-prod-ane3-sql-pg-01        PASS',
      '',
      '8 names · all valid · saved cloudonym.plan.json and cloudonym.plan.names.json',
      'Add more: cloudonym add · Check before applying: cloudonym validate · Machines: cloudonym names --json',
    ]);
    // 보관 파일은 names 가 쓰는 것과 같은 꼴 — validate 가 그대로 통과한다
    expect((await run(['validate'])).code).toBe(EXIT.OK);
  });
});
