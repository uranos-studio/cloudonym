// @ts-check
// CLI 단위 시험 (D102) — 서버 없이 가짜 fetchFn 으로. 엔진의 실답은 src/api/cli-contract.test.ts 가 본다
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, chmodSync, statSync, symlinkSync, lstatSync, unlinkSync, closeSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, EXIT, resolveTarget, USER_AGENT } from './lib/main.mjs';
import { nextSeq, nextSlotId, appendSlots, environmentsOf, bodyFor, namesPathFor, kstTime, writeJson, readPlan, PlanError } from './lib/plan.mjs';
import { serverOf, MAX_WAIT_SECONDS } from './lib/http.mjs';

/** 시험이 만든 임시 폴더 — 끝나면 지운다(시스템 임시 폴더에 남기지 않는다) @type {string[]} */
const made = [];
const tmpDir = () => { const d = mkdtempSync(join(tmpdir(), 'cloudonym-cli-unit-')); made.push(d); return d; };
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

const fx = JSON.parse(readFileSync(new URL('./fixtures/next-seq.json', import.meta.url), 'utf-8'));
const ALL = Array.from({ length: 99 }, (_, i) => String(i + 1).padStart(2, '0'));

test('nextSeq · nextSlotId — 공유 표(cli/fixtures/next-seq.json)', () => {
  for (const c of fx.nextSeq) assert.equal(nextSeq(c.used === 'ALL' ? ALL : c.used) ?? null, c.next, JSON.stringify(c));
  for (const c of fx.nextSlotId) assert.equal(nextSlotId(c.used), c.next, JSON.stringify(c));
});

test('appendSlots — 기존 슬롯은 같은 객체 그대로 · 새 슬롯은 다음 번호 · 다 차면 PlanError', () => {
  const a = { id: '1', seq: '01', attach: { boot: true } };
  const out = appendSlots([a], 2);
  assert.equal(out[0], a);
  assert.deepEqual(out.slice(1), [{ id: '2', seq: '02' }, { id: '3', seq: '03' }]);
  assert.throws(() => appendSlots(ALL.map((s, i) => ({ id: (i + 1).toString(36), seq: s })), 1), /No free sequence number/);
});

test('environmentsOf · bodyFor — project.env 가 첫째 · 중복 없음 · 보낼 본문에 environments 없음', () => {
  const plan = { provider: 'gcp', project: { owner: 'o', system: 's', env: 'prod', region: 'r' }, project_picks: [], services: [], environments: ['stg', 'prod', 'stg', 'dev'] };
  assert.deepEqual(environmentsOf(plan), ['prod', 'stg', 'dev']);
  assert.deepEqual(environmentsOf(plan, 'dev'), ['dev']);
  assert.throws(() => environmentsOf(plan, 'qa'), /not in the plan/);
  const body = bodyFor(plan, 'stg');
  assert.equal('environments' in body, false);
  assert.deepEqual(body.project, { owner: 'o', system: 's', env: 'stg', region: 'r' });
  assert.equal(plan.project.env, 'prod');
});

test('namesPathFor · kstTime · serverOf', () => {
  assert.equal(namesPathFor('/x/cloudonym.plan.json'), '/x/cloudonym.plan.names.json');
  assert.equal(namesPathFor('/x/plan'), '/x/plan.names.json');
  assert.equal(kstTime(new Date('2026-10-14T15:30:05Z')), '2026-10-15T00:30:05+09:00');
  assert.deepEqual(serverOf('http://127.0.0.1:8787/', {}), { server: 'http://127.0.0.1:8787' });
  assert.deepEqual(serverOf(undefined, { CLOUDONYM_SERVER: 'https://example.org' }), { server: 'https://example.org' });
  assert.deepEqual(serverOf('https://example.org/base//', {}), { server: 'https://example.org/base' });
  assert.ok('error' in serverOf('--x', {}));
  assert.ok('error' in serverOf(undefined, {}));
  assert.match(USER_AGENT, /^cloudonym-cli\/\d+\.\d+\.\d+$/);
});

const CAT = {
  rows: [
    { key: 'gcp.cloud_sql_instance', aliases: ['google_sql_database_instance', 'Cloud SQL'], slug: { value: 'sql' }, rules: { 'gcp.cloud_sql_instance': { input: 'count', tier: true } } },
    { key: 'gcp.address', aliases: ['ip'], slug: { value: 'ip' }, rules: { 'gcp.address': { input: 'count' }, 'gcp.global_address': { input: 'count' } } },
  ],
  presets: [{ id: 'db', rule: 'gcp.cloud_sql_instance', tier: null }],
};

test('resolveTarget — 규칙 id → 프리셋 → <provider>.<이름> → 별칭(규칙 하나인 행만) · 못 풀면 후보', () => {
  assert.deepEqual(resolveTarget('gcp.cloud_sql_instance', 'gcp', CAT), { rule: 'gcp.cloud_sql_instance' });
  assert.equal(/** @type {any} */ (resolveTarget('db', 'gcp', CAT)).preset.id, 'db');
  assert.deepEqual(resolveTarget('cloud_sql_instance', 'gcp', CAT), { rule: 'gcp.cloud_sql_instance' });
  assert.deepEqual(resolveTarget('cloud sql', 'gcp', CAT), { rule: 'gcp.cloud_sql_instance' });
  assert.match(/** @type {any} */ (resolveTarget('ip', 'gcp', CAT)).error, /several rules.*gcp\.address, gcp\.global_address/);
  assert.match(/** @type {any} */ (resolveTarget('gcp.sql', 'gcp', CAT)).error, /Unknown rule id/);
  assert.match(/** @type {any} */ (resolveTarget('sql_inst', 'gcp', CAT)).error, /Did you mean: gcp\.cloud_sql_instance/);
});

// ── 가짜 서버 ──

/** @param {(path: string, body: any) => { status: number, body?: unknown, headers?: Record<string, string>, raw?: string, textError?: Error }} handler */
function fake(handler) {
  /** @type {{ path: string, body: any, headers: Record<string, string> }[]} */
  const calls = [];
  /** @type {import('./lib/http.mjs').FetchFn} */
  const fetchFn = async (url, init) => {
    const path = new URL(url).pathname;
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    calls.push({ path, body, headers: init.headers });
    const r = handler(path, body);
    const h = new Map(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      status: r.status, headers: { get: (n) => h.get(n.toLowerCase()) ?? null },
      text: async () => { if (r.textError) throw r.textError; return r.raw ?? JSON.stringify(r.body); },
    };
  };
  return { fetchFn, calls };
}

/** @param {string[]} argv @param {import('./lib/http.mjs').FetchFn} fetchFn @param {string} cwd @param {(ms: number) => Promise<void>} [sleep] @param {Record<string, string | undefined>} [env] */
async function run(argv, fetchFn, cwd, sleep = async () => {}, env = { CLOUDONYM_SERVER: 'http://fake.test' }) {
  /** @type {string[]} */ const out = [];
  /** @type {string[]} */ const err = [];
  const code = await main(argv, { fetchFn, cwd, env, stdout: (s) => { out.push(s); }, stderr: (s) => { err.push(s); }, sleep, now: () => new Date('2026-10-14T00:00:00Z') });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const PLAN = { provider: 'gcp', project: { owner: 'o', system: 's', env: 'prod', region: 'r' }, project_picks: [], services: [{ purpose: 'shop', picks: [{ preset: 'db', instances: [{ id: '1', seq: '01' }] }] }], rules_version: 'v1' };
const CATALOG_BODY = { version: { engine: '0.1.0', rules: 'v1' }, providers: { gcp: { ...CAT, limits: { max_count: 99 } } } };
/** @param {{ key: string, name: string, valid: boolean }[]} items */
const wizard = (items) => ({ success: true, version: { engine: '0.1.0', rules: 'v1' }, data: { gcp: { valid: items.every((i) => i.valid), items: items.map((i) => ({ namespace: 'shop', resource_type: 'x', violations: i.valid ? [] : [{ code: 'name.conflict', message: 'same name' }], ...i })), conflicts: [] } } });

function tmpPlan() {
  const dir = tmpDir();
  writeFileSync(join(dir, 'cloudonym.plan.json'), `${JSON.stringify(PLAN, null, 2)}\n`);
  return dir;
}

test('add — 새 이름은 PASS 인데 기존 키의 이름이 바뀐 답이 오면 exit 1 · 파일 그대로 (방어선)', async () => {
  const dir = tmpPlan();
  const before = readFileSync(join(dir, 'cloudonym.plan.json'), 'utf-8');
  let n = 0;
  const { fetchFn } = fake((path) => {
    if (path === '/catalog.json') return { status: 200, body: CATALOG_BODY };
    n++;
    return { status: 200, body: n === 1 ? wizard([{ key: 'k1', name: 'a-01', valid: true }]) : wizard([{ key: 'k1', name: 'a-01-x', valid: true }, { key: 'k2', name: 'a-02', valid: true }]) };
  });
  const r = await run(['add', 'db', '--service', 'shop'], fetchFn, dir);
  assert.equal(r.code, EXIT.FAIL);
  assert.match(r.err, /would change k1: a-01 PASS -> a-01-x PASS/);
  assert.equal(readFileSync(join(dir, 'cloudonym.plan.json'), 'utf-8'), before);
});

test('add — 같은 pick 이면 슬롯을 덧붙이고, 새 키만 출력한다', async () => {
  const dir = tmpPlan();
  let n = 0;
  const { fetchFn, calls } = fake((path) => {
    if (path === '/catalog.json') return { status: 200, body: CATALOG_BODY };
    n++;
    return { status: 200, body: n === 1 ? wizard([{ key: 'k1', name: 'a-01', valid: true }]) : wizard([{ key: 'k1', name: 'a-01', valid: true }, { key: 'k2', name: 'a-02', valid: true }]) };
  });
  const r = await run(['add', 'gcp.cloud_sql_instance', '--service', 'shop', '--count', '1'], fetchFn, dir);
  assert.equal(r.code, EXIT.OK, r.err);
  assert.equal(r.out, 'a-02  k2');
  assert.deepEqual(calls[2]?.body.services[0].picks[0].instances, [{ id: '1', seq: '01' }, { id: '2', seq: '02' }]);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'cloudonym.plan.json'), 'utf-8')).services[0].picks[0].instances.map((/** @type {any} */ s) => s.seq), ['01', '02']);
});

test('429 --wait — Retry-After 가 상한보다 크면 기다리지 않는다 · 5xx 는 4 · 사용법 오류는 64', async () => {
  const dir = tmpPlan();
  const slow = fake(() => ({ status: 429, body: { success: false, errors: [{ code: 'request.rate_limited' }] }, headers: { 'Retry-After': String(MAX_WAIT_SECONDS + 1) } }));
  /** @type {number[]} */ const waits = [];
  const r = await run(['names', '--wait'], slow.fetchFn, dir, async (ms) => { waits.push(ms); });
  assert.equal(r.code, EXIT.UNAVAILABLE);
  assert.deepEqual(waits, []);
  assert.equal(slow.calls.length, 1);
  assert.match(r.err, new RegExp(`Retry after ${MAX_WAIT_SECONDS + 1} s`));
  const boom = fake(() => ({ status: 503, body: { success: false, errors: [{ code: 'x', message: 'down' }] } }));
  assert.equal((await run(['validate'], boom.fetchFn, dir)).code, EXIT.UNAVAILABLE);
  assert.equal((await run(['frobnicate'], boom.fetchFn, dir)).code, EXIT.USAGE);
  assert.equal((await run(['names', '--nope'], boom.fetchFn, dir)).code, EXIT.USAGE);
  assert.equal((await run(['names', '--timeout', 'soon'], boom.fetchFn, dir)).code, EXIT.USAGE);
  assert.equal((await run([], boom.fetchFn, dir)).code, EXIT.USAGE);
  assert.equal((await run(['--help'], boom.fetchFn, dir)).code, EXIT.OK);
});

test('계획 파일이 아니면 exit 2 — JSON 아님 · project 없음 · 파일 없음', async () => {
  const dir = tmpDir();
  const { fetchFn, calls } = fake(() => ({ status: 200, body: {} }));
  assert.equal((await run(['names'], fetchFn, dir)).code, EXIT.INPUT);
  writeFileSync(join(dir, 'cloudonym.plan.json'), 'not json');
  assert.equal((await run(['names'], fetchFn, dir)).code, EXIT.INPUT);
  writeFileSync(join(dir, 'cloudonym.plan.json'), '{"provider":"gcp"}');
  assert.equal((await run(['validate'], fetchFn, dir)).code, EXIT.INPUT);
  assert.equal(calls.length, 0);
});

// ── 독립 리뷰 반영 (D102) ──

const ENVS3 = { ...PLAN, environments: ['prod', 'stg', 'dev'] };
/** @param {string} dir @param {unknown} plan */
const putPlan = (dir, plan) => writeFileSync(join(dir, 'cloudonym.plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
const planBytes = (/** @type {string} */ dir) => readFileSync(join(dir, 'cloudonym.plan.json'), 'utf-8');
/** 슬롯이 둘이면 k2 가 생긴다 — badEnv 환경에서만 새 이름이 FAIL @param {string} [badEnv] */
const slotsServer = (badEnv) => fake((path, body) => {
  if (path === '/catalog.json') return { status: 200, body: CATALOG_BODY };
  const slots = body.services[0]?.picks[0]?.instances?.length ?? 0;
  const env = body.project.env;
  const items = [{ key: `k1-${env}`, name: `a-01-${env}`, valid: true }];
  if (slots > 1) items.push({ key: `k2-${env}`, name: `a-02-${env}`, valid: env !== badEnv });
  return { status: 200, body: wizard(items) };
});

test('[1] add --env dev 도 계획의 모든 환경을 확인한다 — prod 에서만 FAIL 이면 exit 1 · 파일 그대로', async () => {
  const dir = tmpPlan();
  putPlan(dir, ENVS3);
  const before = planBytes(dir);
  const s = slotsServer('prod');
  const r = await run(['add', 'db', '--service', 'shop', '--env', 'dev'], s.fetchFn, dir);
  assert.equal(r.code, EXIT.FAIL, r.err);
  assert.match(r.err, /\[prod\] new name FAILs k2-prod/);
  assert.equal(planBytes(dir), before);
  assert.deepEqual([...new Set(s.calls.filter((c) => c.path === '/v1/wizard').map((c) => c.body.project.env))], ['prod', 'stg', 'dev']);
});

test('[1] add --env dev 가 통과하면 출력은 dev 의 새 이름뿐 · 파일은 쓴다', async () => {
  const dir = tmpPlan();
  putPlan(dir, ENVS3);
  const r = await run(['add', 'db', '--service', 'shop', '--env', 'dev'], slotsServer().fetchFn, dir);
  assert.equal(r.code, EXIT.OK, r.err);
  assert.equal(r.out, 'a-02-dev  k2-dev');
  assert.equal(JSON.parse(planBytes(dir)).services[0].picks[0].instances.length, 2);
});

/** @param {{ status?: number, raw?: string, body?: unknown }} answer */
const badWizard = (answer) => fake((path) => (path === '/catalog.json' ? { status: 200, body: CATALOG_BODY } : { status: 200, ...answer }));

test('[2] 2xx 인데 JSON 이 아니거나 data.<provider>.items 가 없으면 exit 4 — add 는 쓰지 않고 validate · names 는 0 을 내지 않는다', async () => {
  const shapes = [
    { raw: '<html>maintenance</html>' },
    { body: { success: true, data: { gcp: { valid: true, conflicts: [] } } } },
    { body: { success: true, data: { aws: { valid: true, items: [{ key: 'k', name: 'n', valid: true }], conflicts: [] } } } },
    { body: { success: true, data: { gcp: { valid: true, items: [], conflicts: [] } } } },
    { body: { success: true, data: { gcp: { valid: true, items: [{ key: 'k', valid: true }], conflicts: [] } } } },
  ];
  for (const answer of shapes) {
    const dir = tmpPlan();
    const before = planBytes(dir);
    const a = await run(['add', 'db', '--service', 'shop'], badWizard(answer).fetchFn, dir);
    assert.equal(a.code, EXIT.UNAVAILABLE, `${JSON.stringify(answer)} ${a.err}`);
    assert.match(a.err, /Cannot interpret the server's answer/);
    assert.equal(planBytes(dir), before);
    assert.equal((await run(['validate'], badWizard(answer).fetchFn, dir)).code, EXIT.UNAVAILABLE, JSON.stringify(answer));
    const n = await run(['names'], badWizard(answer).fetchFn, dir);
    assert.equal(n.code, EXIT.UNAVAILABLE, JSON.stringify(answer));
    assert.equal(existsSync(join(dir, 'cloudonym.plan.names.json')), false);
  }
});

test('[2] /catalog.json 이 JSON 이 아니면 exit 4', async () => {
  const dir = tmpPlan();
  const s = fake(() => ({ status: 200, raw: '<html></html>' }));
  const r = await run(['add', 'db', '--service', 'shop'], s.fetchFn, dir);
  assert.equal(r.code, EXIT.UNAVAILABLE, r.err);
});

test('[3] 본문 읽기 실패(시간 초과 · 연결 끊김)는 exit 4 와 한 줄 — 스택 · exit 1 이 아니다', async () => {
  const dir = tmpPlan();
  const s = fake(() => ({ status: 200, textError: Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }) }));
  const r = await run(['validate'], s.fetchFn, dir);
  assert.equal(r.code, EXIT.UNAVAILABLE);
  assert.match(r.err, /Cannot reach http:\/\/fake\.test: reading the answer failed: This operation was aborted/);
});

test('[3] 파일을 못 쓰면 exit 2 · 임시 파일이 남지 않는다 · 뜻밖의 예외는 exit 70 과 한 줄', async () => {
  const dir = tmpDir();
  mkdirSync(join(dir, 'taken'));
  writeFileSync(join(dir, 'taken', 'x'), '');
  const src = join(dir, 'web.json');
  writeFileSync(src, JSON.stringify(PLAN));
  const r = await run(['init', '--from', src, '-f', 'taken', '--force'], fake(() => ({ status: 200, body: {} })).fetchFn, dir);
  assert.equal(r.code, EXIT.INPUT, r.err);
  assert.match(r.err, /Cannot write \S*taken/);
  assert.deepEqual(readdirSync(dir).filter((f) => f.includes('.tmp-')), []);
  /** @type {string[]} */ const err = [];
  const code = await main(['--version'], { stdout: () => { throw new Error('stdout closed'); }, stderr: (s) => { err.push(s); } });
  assert.equal(code, EXIT.INTERNAL);
  assert.match(err.join('\n'), /Internal error: stdout closed/);
});

test('[4] 보관 파일이 있는데 못 읽으면 exit 2 — validate 가 비교를 건너뛰지 않고 names 가 덮어쓰지 않는다', async () => {
  const dir = tmpPlan();
  const namesFile = join(dir, 'cloudonym.plan.names.json');
  writeFileSync(namesFile, '{ broken');
  const ok = () => fake(() => ({ status: 200, body: wizard([{ key: 'k1', name: 'a-01', valid: true }]) })).fetchFn;
  const v = await run(['validate'], ok(), dir);
  assert.equal(v.code, EXIT.INPUT, v.err);
  assert.match(v.err, /cloudonym\.plan\.names\.json/);
  assert.equal((await run(['names'], ok(), dir)).code, EXIT.INPUT);
  assert.equal(readFileSync(namesFile, 'utf-8'), '{ broken');
  writeFileSync(namesFile, '{"environments": []}');
  assert.equal((await run(['validate'], ok(), dir)).code, EXIT.INPUT);
  // 환경 안의 꼴도 본다 — names 가 배열이 아니면 빈 목록과 비교해 「같다」고 말하게 된다
  for (const bad of [
    '{"environments": {"prod": {"names": null}}}',
    '{"environments": {"prod": null}}',
    '{"environments": {"prod": {"names": [{"key": "k1"}]}}}',
    '{"environments": {"prod": {"names": [{"key": 1, "name": "a-01"}]}}}',
    '{"environments": {"prod": {"names": [], "invalid": {}}}}',
  ]) {
    writeFileSync(namesFile, bad);
    const r = await run(['validate'], ok(), dir);
    assert.equal(r.code, EXIT.INPUT, `${bad}\n${r.out}\n${r.err}`);
    assert.equal(r.out.includes('same as the names file'), false, bad);
  }
  // 검사기 — 맞는 꼴은 그대로 받는다
  writeFileSync(namesFile, '{"environments": {"prod": {"valid": true, "names": [{"key": "k1", "name": "a-01"}], "invalid": []}}}');
  assert.equal((await run(['validate'], ok(), dir)).code, EXIT.OK);
});

test('[5] 서버 URL — 쿼리 · fragment · 자격이 든 URL 은 거부하고, 자격을 출력에 내지 않는다', async () => {
  for (const bad of ['http://h/?a=1', 'http://h/#x', 'http://user:secret-pw@h/', 'ftp://h/']) assert.ok('error' in serverOf(bad, {}), bad);
  const dir = tmpPlan();
  const s = fake(() => ({ status: 200, body: {} }));
  const r = await run(['validate'], s.fetchFn, dir, async () => {}, { CLOUDONYM_SERVER: 'http://user:secret-pw@fake.test/' });
  assert.equal(r.code, EXIT.USAGE);
  assert.equal(r.err.includes('secret-pw'), false, r.err);
  assert.equal(s.calls.length, 0);
});

test('[7] --timeout 상한 2147483647 ms — 넘으면 64 (2^31 이상은 Node 가 1 ms 로 바꾼다)', async () => {
  const dir = tmpPlan();
  const ok = () => fake(() => ({ status: 200, body: wizard([{ key: 'k1', name: 'a-01', valid: true }]) })).fetchFn;
  for (const t of ['9999999999', '3000000000', '2147483648']) assert.equal((await run(['validate', '--timeout', t], ok(), dir)).code, EXIT.USAGE, t);
  assert.equal((await run(['validate', '--timeout', '2147483647'], ok(), dir)).code, EXIT.OK);
});

test('[8] Retry-After — 음수 · 형식 오류는 없는 것(60 s), HTTP-date 는 남은 초, 다시 보내기는 명령 전체에서 한 번', async () => {
  const dir = tmpPlan();
  /** @param {string} ra */
  const once429 = (ra) => { let n = 0; return fake(() => (n++ === 0 ? { status: 429, body: { success: false, errors: [] }, headers: { 'Retry-After': ra } } : { status: 200, body: wizard([{ key: 'k1', name: 'a-01', valid: true }]) })); };
  for (const [ra, ms] of /** @type {[string, number][]} */ ([['-5', 60000], ['soon', 60000], ['1.5', 60000], ['Tue, 14 Oct 2026 00:00:30 GMT', 30000], ['Tue, 13 Oct 2026 00:00:00 GMT', 0]])) {
    /** @type {number[]} */ const waits = [];
    const r = await run(['validate', '--wait'], once429(ra).fetchFn, dir, async (w) => { waits.push(w); });
    assert.equal(r.code, EXIT.OK, `${ra} ${r.err}`);
    assert.deepEqual(waits, [ms], ra);
  }
  putPlan(dir, ENVS3);
  /** @type {number[]} */ const waits = [];
  const all429 = fake(() => ({ status: 429, body: { success: false, errors: [] }, headers: { 'Retry-After': '1' } }));
  const r = await run(['names', '--wait'], all429.fetchFn, dir, async (w) => { waits.push(w); });
  assert.equal(r.code, EXIT.UNAVAILABLE);
  assert.deepEqual(waits, [1000]);
  assert.equal(all429.calls.length, 4);
});

test('[10] 413 은 exit 2 (다시 보내도 같다)', async () => {
  const dir = tmpPlan();
  const s = fake(() => ({ status: 413, body: { success: false, errors: [{ code: 'request.too_large', params: { max_bytes: 32768 } }] } }));
  assert.equal((await run(['validate'], s.fetchFn, dir)).code, EXIT.INPUT);
});

test('[11] names --repin --env dev 도 모든 환경을 확인한다 — prod 가 새 규칙에서 실패하면 rules_version 을 고치지 않는다', async () => {
  const dir = tmpPlan();
  putPlan(dir, ENVS3);
  const s = fake((_path, body) => {
    if (body.rules_version === 'v1') return { status: 409, body: { success: false, errors: [{ code: 'request.rules_version_mismatch', params: { requested: 'v1', current: 'v2' } }] } };
    if (body.project.env === 'prod') return { status: 503, body: { success: false, errors: [{ code: 'x', message: 'down' }] } };
    return { status: 200, body: wizard([{ key: `k1-${body.project.env}`, name: 'a-01', valid: true }]) };
  });
  const r = await run(['names', '--repin', '--env', 'dev'], s.fetchFn, dir);
  assert.equal(r.code, EXIT.UNAVAILABLE, r.err);
  assert.equal(JSON.parse(planBytes(dir)).rules_version, 'v1');
  assert.ok(s.calls.some((c) => c.body?.project.env === 'prod' && c.body.rules_version === 'v2'));
});

test('[12] 쓰기 — 권한 보존 · 심볼릭 링크는 대상 파일에 · 읽은 뒤 바뀌었으면 쓰지 않고 exit 2', async () => {
  const dir = tmpPlan();
  const file = join(dir, 'cloudonym.plan.json');
  chmodSync(file, 0o600);
  assert.equal((await run(['add', 'db', '--service', 'shop'], slotsServer().fetchFn, dir)).code, EXIT.OK);
  assert.equal(statSync(file).mode & 0o777, 0o600);

  const real = join(dir, 'real.plan.json');
  writeFileSync(real, `${JSON.stringify(PLAN, null, 2)}\n`);
  symlinkSync('real.plan.json', join(dir, 'link.plan.json'));
  assert.equal((await run(['add', 'db', '--service', 'shop', '-f', 'link.plan.json'], slotsServer().fetchFn, dir)).code, EXIT.OK);
  assert.equal(lstatSync(join(dir, 'link.plan.json')).isSymbolicLink(), true);
  assert.equal(JSON.parse(readFileSync(real, 'utf-8')).services[0].picks[0].instances.length, 2);

  putPlan(dir, PLAN);
  const other = `${JSON.stringify({ ...PLAN, project: { ...PLAN.project, owner: 'someone-else' } }, null, 2)}\n`;
  let n = 0;
  const racing = fake((path) => {
    if (path === '/catalog.json') return { status: 200, body: CATALOG_BODY };
    if (++n === 2) writeFileSync(file, other);
    return { status: 200, body: wizard(n === 1 ? [{ key: 'k1', name: 'a-01', valid: true }] : [{ key: 'k1', name: 'a-01', valid: true }, { key: 'k2', name: 'a-02', valid: true }]) };
  });
  const r = await run(['add', 'db', '--service', 'shop'], racing.fetchFn, dir);
  assert.equal(r.code, EXIT.INPUT, r.err);
  assert.match(r.err, /changed since it was read/);
  assert.equal(readFileSync(file, 'utf-8'), other);
  assert.deepEqual(readdirSync(dir).filter((f) => f.includes('.tmp-')), []);
});

test('[13] add — FAIL 로 남는 기존 키도 위반 코드가 바뀌면 판정이 바뀐 것으로 막는다', async () => {
  const dir = tmpPlan();
  let n = 0;
  const s = fake((path) => {
    if (path === '/catalog.json') return { status: 200, body: CATALOG_BODY };
    n++;
    const k1 = { key: 'k1', name: 'a-01', valid: false, namespace: 'shop', resource_type: 'x', violations: n === 1 ? [{ code: 'name.too_long', message: 'long' }] : [{ code: 'name.too_long', message: 'long' }, { code: 'name.conflict', message: 'same' }] };
    return { status: 200, body: { success: true, version: { rules: 'v1' }, data: { gcp: { valid: false, items: n === 1 ? [k1] : [k1, { key: 'k2', name: 'a-02', valid: true, namespace: 'shop', resource_type: 'x', violations: [] }], conflicts: [] } } } };
  });
  const before = planBytes(dir);
  const r = await run(['add', 'db', '--service', 'shop'], s.fetchFn, dir);
  assert.equal(r.code, EXIT.FAIL, r.err);
  assert.match(r.err, /would change k1: a-01 FAIL -> a-01 FAIL/);
  assert.equal(planBytes(dir), before);
});

test('[6] 종료 코드 표 — EXIT · --help · README(영어 · 한국어) · D102 가 같은 코드를 말한다', async () => {
  const root = new URL('../', import.meta.url);
  const readme = readFileSync(new URL('README.md', root), 'utf-8');
  const decisions = readFileSync(new URL('docs/decisions.md', root), 'utf-8');
  const codes = Object.values(EXIT).sort((a, b) => a - b);
  /** @param {string} line @param {RegExp} re */
  const nums = (line, re) => [...line.matchAll(re)].map((m) => Number(m[1])).sort((a, b) => a - b);
  const en = readme.split('\n').find((l) => l.startsWith('- **Exit codes**')) ?? '';
  const ko = readme.split('\n').find((l) => l.startsWith('- **종료 코드**')) ?? '';
  assert.deepEqual(nums(en, /`(\d+)`/g), codes, en);
  assert.deepEqual(nums(ko, /`(\d+)`/g), codes, ko);
  const d102 = decisions.split('\n').find((l) => l.startsWith('| D102 |')) ?? '';
  const sentence = /\*\*Exit codes:\*\*([^*]*)/.exec(d102)?.[1] ?? '';
  assert.deepEqual(nums(sentence, /(?:^|, | )(\d+) \(/g), codes, sentence);
  /** @type {string[]} */ const out = [];
  await main(['--help'], { stdout: (s) => { out.push(s); } });
  const help = out.join('\n').split('\n').find((l) => l.startsWith('Exit codes:')) ?? '';
  assert.deepEqual(nums(help, /(?:: | · )(\d+) /g), codes, help);
});

test('[9] 서버가 duplicate_pick(400)으로 막으면 무엇을 세는지 밝힌다 · exit 2 · 파일 그대로', async () => {
  const dir = tmpPlan();
  const before = planBytes(dir);
  let n = 0;
  const s = fake((path) => {
    if (path === '/catalog.json') return { status: 200, body: CATALOG_BODY };
    if (++n === 1) return { status: 200, body: wizard([{ key: 'k1', name: 'a-01', valid: true }]) };
    return { status: 400, body: { success: false, errors: [{ code: 'wizard.duplicate_pick', field: 'services[0].picks[1]', message: "picks[1]: 'cloud_sql_instance' is picked twice" }] } };
  });
  const r = await run(['add', 'gcp.cloud_sql_instance', '--service', 'shop', '--tier', 'x'], s.fetchFn, dir);
  assert.equal(r.code, EXIT.INPUT, r.err);
  assert.match(r.err, /the server counts the resource type, the kind token, the tier and the role/);
  assert.equal(planBytes(dir), before);
});

// ── 독립 리뷰 반영 2차 (D102) ──

test('[14] 저장 잠금 — <계획>.lock 이 있으면 쓰지 않고 exit 2 · 잠금 파일은 그대로 · 끝나면 잠금이 남지 않는다', async () => {
  const dir = tmpPlan();
  const before = planBytes(dir);
  const lock = join(dir, 'cloudonym.plan.json.lock');
  writeFileSync(lock, '');
  const r = await run(['add', 'db', '--service', 'shop'], slotsServer().fetchFn, dir);
  assert.equal(r.code, EXIT.INPUT, r.err);
  assert.match(r.err, /cloudonym\.plan\.json\.lock/);
  assert.match(r.err, /delete/i);
  assert.equal(planBytes(dir), before);
  assert.equal(existsSync(lock), true);
  unlinkSync(lock);
  assert.equal((await run(['add', 'db', '--service', 'shop'], slotsServer().fetchFn, dir)).code, EXIT.OK);
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.lock') || f.includes('.tmp-')), []);
});

/** 계획 하나를 쓰고 읽은 digest 를 돌려준다 @returns {{ dir: string, file: string, digest: string }} */
function planOnDisk() {
  const dir = tmpPlan();
  const file = join(dir, 'cloudonym.plan.json');
  return { dir, file, digest: readPlan(file).digest };
}
/** @param {string} owner */
const owned = (owner) => ({ ...PLAN, project: { ...PLAN.project, owner } });
/** @param {string} dir */
const leftovers = (dir) => readdirSync(dir).filter((f) => f.endsWith('.lock') || f.includes('.tmp-'));

test('[14] 동시 저장(결정적) — 첫 저장이 재검사를 마친 뒤 · 임시 파일을 만들기 전에 같은 원본을 읽은 둘째가 저장하면 둘째는 잠금으로 멈춘다', () => {
  const { dir, file, digest } = planOnDisk();
  /** @type {unknown} */
  let second;
  // 첫째가 「재검사 통과 → 옮기기」 사이에 멈춘 순간 — 잠금이 없으면 둘째의 재검사도 통과해 먼저 쓰고, 첫째가 그것을 덮는다
  writeJson(file, owned('first'), digest, { afterCheck: () => {
    try { writeJson(file, owned('second'), digest); second = 'written'; } catch (e) { second = e; }
  } });
  assert.ok(second instanceof PlanError, `second save was not refused: ${String(second)}`);
  assert.match(second.message, /is locked by another cloudonym command/);
  assert.equal(JSON.parse(planBytes(dir)).project.owner, 'first');
  assert.deepEqual(leftovers(dir), []);
});

test('[14] 부분 쓰기 — writeSync 가 일부만 쓰면 이어 쓰고, 더 못 쓰면 원본을 바꾸지 않는다', () => {
  {
    // 한 번에 5바이트씩만 쓰는 파일 시스템 — 끝까지 이어 써서 온전한 JSON 이 된다
    const { dir, file, digest } = planOnDisk();
    /** @type {typeof writeSync} */
    const fiveAtATime = /** @type {any} */ ((/** @type {number} */ fd, /** @type {Buffer} */ buf, /** @type {number} */ off, /** @type {number} */ len) => writeSync(fd, buf, off, Math.min(5, len)));
    writeJson(file, owned('chunked'), digest, { fs: { writeSync: fiveAtATime } });
    assert.equal(JSON.parse(planBytes(dir)).project.owner, 'chunked');
    assert.deepEqual(leftovers(dir), []);
  }
  {
    // 5바이트 뒤 0 을 돌려주는 파일 시스템(디스크 가득) — 원본 그대로 · 임시 파일 없음
    const { dir, file, digest } = planOnDisk();
    const before = planBytes(dir);
    let first = true;
    /** @type {typeof writeSync} */
    const fullAfterFive = /** @type {any} */ ((/** @type {number} */ fd, /** @type {Buffer} */ buf, /** @type {number} */ off) => { if (!first) return 0; first = false; return writeSync(fd, buf, off, 5); });
    assert.throws(() => writeJson(file, owned('torn'), digest, { fs: { writeSync: fullAfterFive } }), (e) => e instanceof PlanError && /wrote 5 of \d+ bytes/.test(e.message));
    assert.equal(planBytes(dir), before);
    assert.deepEqual(leftovers(dir), []);
  }
});

test('[14] 주입점은 기본에서 꺼져 있다 — 운영 호출은 네 번째 인자를 넘기지 않고 plan.mjs 는 환경변수를 읽지 않는다 · 인자 없이도 쓴다', () => {
  const mainSrc = readFileSync(new URL('./lib/main.mjs', import.meta.url), 'utf-8');
  const calls = [...mainSrc.matchAll(/writeJson\(([^;]*)\);/g)].map((m) => m[1] ?? '');
  assert.ok(calls.length >= 4, `calls: ${calls.length}`);
  /** 괄호 · 중괄호 · 대괄호 밖의 쉼표 수 @param {string} a */
  const topCommas = (a) => { let depth = 0; let n = 0; for (const c of a) { if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--; else if (c === ',' && depth === 0) n++; } return n; };
  for (const c of calls) assert.ok(topCommas(c) <= 2, `writeJson(${c}) passes hooks`);
  const planSrc = readFileSync(new URL('./lib/plan.mjs', import.meta.url), 'utf-8');
  assert.equal(/process\.env/.test(planSrc), false);
  const { dir, file, digest } = planOnDisk();
  writeJson(file, owned('plain'), digest);
  assert.equal(JSON.parse(planBytes(dir)).project.owner, 'plain');
  assert.deepEqual(leftovers(dir), []);
});

test('[14] 잠금을 만든 뒤 닫기가 실패(EIO)해도 잠금을 지운다 — exit 2 문장 · 계획 그대로 · 다음 저장은 된다', () => {
  const { dir, file, digest } = planOnDisk();
  const before = planBytes(dir);
  let calls = 0;
  /** @param {number} fd */
  const closeOnceFails = (fd) => { closeSync(fd); if (++calls === 1) throw Object.assign(new Error('EIO: i/o error, close'), { code: 'EIO' }); };
  assert.throws(() => writeJson(file, owned('x'), digest, { fs: { closeSync: closeOnceFails } }), (e) => e instanceof PlanError && /cannot close the lock .*cloudonym\.plan\.json\.lock: EIO/.test(e.message));
  assert.equal(calls, 1);
  assert.equal(planBytes(dir), before);
  assert.deepEqual(leftovers(dir), []);
  writeJson(file, owned('next'), digest);
  assert.equal(JSON.parse(planBytes(dir)).project.owner, 'next');
});

test('[14] 저장 뒤 잠금 삭제가 실패(EACCES)하면 성공으로 숨기지 않는다 — 「저장됨」과 지울 잠금 경로를 알리고 exit 2', async () => {
  const { dir, file, digest } = planOnDisk();
  const lock = `${file}.lock`;
  /** @param {import('node:fs').PathLike} p */
  const lockStays = (p) => { if (String(p) === lock) throw Object.assign(new Error('EACCES: permission denied, unlink'), { code: 'EACCES' }); unlinkSync(p); };
  /** @type {unknown} */
  let err;
  try { writeJson(file, owned('saved'), digest, { fs: { unlinkSync: lockStays } }); } catch (e) { err = e; }
  assert.ok(err instanceof PlanError, String(err));
  assert.match(err.message, /cloudonym\.plan\.json is written, but its lock \S*cloudonym\.plan\.json\.lock could not be removed: EACCES/);
  assert.match(err.message, /Delete \S*cloudonym\.plan\.json\.lock before the next cloudonym command/);
  assert.equal(JSON.parse(planBytes(dir)).project.owner, 'saved');
  assert.equal(existsSync(lock), true);
  // main 은 PlanError 를 exit 2 와 그 문장으로 낸다 — 남은 잠금 때문에 다음 명령도 exit 2 로 경로를 알린다
  const r = await run(['add', 'db', '--service', 'shop'], slotsServer().fetchFn, dir);
  assert.equal(r.code, EXIT.INPUT);
  assert.match(r.err, /is locked by another cloudonym command/);
  unlinkSync(lock);
  assert.deepEqual(leftovers(dir), []);
});

test('[14] 저장 전 실패에 잠금 삭제까지 실패하면 원래 오류를 덮지 않고 잠금 경로를 덧붙인다', () => {
  const { dir, file } = planOnDisk();
  const lock = `${file}.lock`;
  /** @param {import('node:fs').PathLike} p */
  const lockStays = (p) => { if (String(p) === lock) throw Object.assign(new Error('EACCES: permission denied, unlink'), { code: 'EACCES' }); unlinkSync(p); };
  assert.throws(() => writeJson(file, owned('x'), 'stale-digest', { fs: { unlinkSync: lockStays } }), (e) => e instanceof PlanError && /changed since it was read/.test(e.message) && /lock \S*\.lock could not be removed either/.test(e.message));
  unlinkSync(lock);
  assert.deepEqual(leftovers(dir), []);
});

test('[15] add — picks 를 생략한 서비스는 API 처럼 빈 목록 · services/project_picks 생략도 같다', async () => {
  const dir = tmpPlan();
  putPlan(dir, { provider: 'gcp', project: PLAN.project, services: [{ purpose: 'shop' }], rules_version: 'v1' });
  const r = await run(['add', 'db', '--service', 'shop'], slotsServer().fetchFn, dir);
  assert.equal(r.code, EXIT.OK, r.err);
  const saved = JSON.parse(planBytes(dir));
  assert.deepEqual(saved.services, [{ purpose: 'shop', picks: [{ preset: 'db', instances: [{ id: '1', seq: '01' }] }] }]);
  assert.deepEqual(saved.project_picks, []);
  putPlan(dir, { provider: 'gcp', project: PLAN.project, rules_version: 'v1' });
  assert.equal((await run(['add', 'db', '--service', 'shop'], slotsServer().fetchFn, dir)).code, EXIT.OK);
});

test('[15] add — 틀린 구조는 편집 전에 exit 2 (70 이 아니다) · 서버에 보내지 않는다 · 파일 그대로', async () => {
  const dir = tmpPlan();
  const bad = [
    { services: {} }, { project_picks: {} }, { services: ['shop'] }, { services: [null] },
    { services: [{ purpose: 'shop', picks: {} }] }, { services: [{ purpose: 'shop', picks: [null] }] },
    { services: [{ purpose: 'shop', picks: [{ preset: 'db', instances: {} }] }] },
  ];
  for (const b of bad) {
    putPlan(dir, { ...PLAN, ...b });
    const before = planBytes(dir);
    const s = fake((path) => (path === '/catalog.json' ? { status: 200, body: CATALOG_BODY } : { status: 200, body: wizard([{ key: 'k1', name: 'a-01', valid: true }]) }));
    const r = await run(['add', 'db', '--service', 'shop'], s.fetchFn, dir);
    assert.equal(r.code, EXIT.INPUT, `${JSON.stringify(b)} ${r.err}`);
    assert.equal(r.err.includes('Internal error'), false, r.err);
    assert.equal(s.calls.filter((c) => c.path === '/v1/wizard').length, 0, JSON.stringify(b));
    assert.equal(planBytes(dir), before);
  }
});

test('[16] names --repin --no-write — 계획의 rules_version 도 보관 파일도 쓰지 않는다', async () => {
  const dir = tmpPlan();
  const before = planBytes(dir);
  const s = fake((_path, body) => (body.rules_version === 'v1'
    ? { status: 409, body: { success: false, errors: [{ code: 'request.rules_version_mismatch', params: { requested: 'v1', current: 'v2' } }] } }
    : { status: 200, body: wizard([{ key: 'k1', name: 'a-01', valid: true }]) }));
  const r = await run(['names', '--repin', '--no-write'], s.fetchFn, dir);
  assert.equal(r.code, EXIT.OK, r.err);
  assert.equal(planBytes(dir), before);
  assert.equal(existsSync(join(dir, 'cloudonym.plan.names.json')), false);
  assert.match(r.err, /--no-write/);
});

test('[16] --no-write 설명 — --help · README(영어 · 한국어) · D102 · llms 가 「두 파일 모두」를 말한다', async () => {
  const root = new URL('../', import.meta.url);
  const readme = readFileSync(new URL('README.md', root), 'utf-8');
  const decisions = readFileSync(new URL('docs/decisions.md', root), 'utf-8');
  const llms = readFileSync(new URL('src/api/llms.ts', root), 'utf-8');
  /** @type {string[]} */ const out = [];
  await main(['--help'], { stdout: (s) => { out.push(s); } });
  const help = out.join('\n');
  assert.match(help, /--no-write\s+names: write neither the plan nor the names file/);
  assert.match(help, /\.lock/);
  const d102 = decisions.split('\n').find((l) => l.startsWith('| D102 |')) ?? '';
  for (const [where, text] of /** @type {[string, string][]} */ ([['README', readme], ['D102', d102], ['llms', llms]])) {
    assert.match(text, /`--no-write` writes neither the plan nor the names file/, where);
    assert.match(text, /`<plan>\.lock`/, where);
  }
  // 저장은 됐는데 잠금을 못 지운 경우 — 성공(0)으로 숨기지 않고 exit 2 로 알린다
  for (const [where, text] of /** @type {[string, string][]} */ ([['help', help], ['README', readme], ['D102', d102], ['llms', llms]])) {
    assert.match(text, /saved but its lock cannot be removed/, where);
    assert.match(text, /or its lock could not be removed after saving/, where);
  }
  assert.match(readme, /저장 뒤 잠금을 못 지움/);
  assert.match(readme, /`--no-write` 는 계획 파일도 보관 파일도 쓰지 않는다/);
  assert.match(readme, /`<계획>\.lock`/);
});

test('[17] 서버 URL 거부 문장에 원문을 넣지 않는다 — 쿼리 토큰 · 호스트가 틀린 user:pass@ URL', async () => {
  const bads = ['http://h/?token=SECRET-TOKEN', 'http://h/#SECRET-TOKEN', 'http://u:SECRET-TOKEN@[bad/', 'ftp://u:SECRET-TOKEN@h/', 'SECRET-TOKEN://x', 'not a url SECRET-TOKEN'];
  const dir = tmpPlan();
  for (const bad of bads) {
    const e = serverOf(bad, {});
    assert.ok('error' in e, bad);
    assert.equal(JSON.stringify(e).includes('SECRET'), false, `${bad}: ${JSON.stringify(e)}`);
    for (const env of [{ CLOUDONYM_SERVER: bad }, {}]) {
      const s = fake(() => ({ status: 200, body: {} }));
      const argv = 'CLOUDONYM_SERVER' in env ? ['validate'] : ['validate', '--server', bad];
      const r = await run(argv, s.fetchFn, dir, async () => {}, env);
      assert.equal(r.code, EXIT.USAGE, bad);
      assert.equal(`${r.out}${r.err}`.includes('SECRET'), false, `${bad}: ${r.err}`);
      assert.equal(s.calls.length, 0);
    }
  }
});

test('[18] 임시 파일 <대상>.tmp-<PID> 가 이미 있으면 exit 2 이고 그 파일은 지우지 않는다(이번 호출이 만든 것만 지운다)', async () => {
  const dir = tmpPlan();
  const before = planBytes(dir);
  const tmp = join(dir, `cloudonym.plan.json.tmp-${process.pid}`);
  writeFileSync(tmp, 'someone else');
  const r = await run(['add', 'db', '--service', 'shop'], slotsServer().fetchFn, dir);
  assert.equal(r.code, EXIT.INPUT, r.err);
  assert.equal(readFileSync(tmp, 'utf-8'), 'someone else');
  assert.equal(planBytes(dir), before);
  unlinkSync(tmp);
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.lock') || f.includes('.tmp-')), []);
});
