// @ts-check
// 벤치마크 권장 1~7 (provider · --no-input · 오류 제안 · --output · 유일 범위 · 셸 완성) — 서버 없이 가짜 fetchFn 으로. 묻는 흐름의 2단 메뉴는 guide.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { main, EXIT, resolveTarget } from './lib/main.mjs';
import { nameTable, scopeLabel } from './lib/table.mjs';
import { distance, closest } from './lib/suggest.mjs';

/** @type {string[]} */
const made = [];
const tmpDir = () => { const d = mkdtempSync(join(tmpdir(), 'cloudonym-cli-options-')); made.push(d); return d; };
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

const ROWS = [
  { key: 'gcp.cloud_sql_instance', displayName: 'Cloud SQL', category: 'database', aliases: [], slug: { value: 'sql' }, rules: { 'gcp.cloud_sql_instance': { input: 'count', tier: true } } },
  { key: 'gcp.project_id', displayName: 'Project ID', category: 'management', rules: { 'gcp.project_id': { input: 'none', tier: false } } },
];
const PRESETS = [
  { id: 'db', label: 'Database (Cloud SQL)', rule: 'gcp.cloud_sql_instance', tier: null, level: 'service' },
  { id: 'cache', label: 'Cache', rule: 'gcp.cloud_sql_instance', tier: 'cache', level: 'service' },
];
const SCOPES = [{ id: 'gcp:namespace', name: 'Global namespace' }, { id: 'gcp:project', name: 'Project', parent: 'gcp:namespace' }, { id: 'gcp:project_region', name: 'Region', parent: 'gcp:project' }];
/** @param {Record<string, unknown>} [providers] */
const catalog = (providers) => ({ version: { engine: '0.1.0', rules: 'v1' }, providers: providers ?? { gcp: { rows: ROWS, presets: PRESETS, limits: { max_count: 99 }, scopes: SCOPES } } });
const ITEMS = [
  { key: 'project/-/project_id/-/-/-', namespace: 'project', level: 'project', resource_type: 'project_id', name: 'o-s-prod', valid: true, violations: [], scope: 'gcp:namespace', uniqueness: 'csp' },
  { key: 'shop/cloud_sql_instance/-/01', namespace: 'shop', resource_type: 'cloud_sql_instance', seq: '01', name: 's-shop-prod-sql-01', valid: true, violations: [], scope: 'gcp:project', uniqueness: 'csp' },
];
/** @param {string} provider @param {any[]} items */
const wizard = (provider, items) => ({ success: true, version: { engine: '0.1.0', rules: 'v1' }, data: { [provider]: { valid: true, items, conflicts: [] } } });

/**
 * @param {(path: string, body: any) => { status: number, body?: unknown }} handler
 */
function fake(handler) {
  /** @type {{ path: string, body: any }[]} */
  const calls = [];
  /** @type {import('./lib/http.mjs').FetchFn} */
  const fetchFn = async (url, init) => {
    const path = new URL(url).pathname;
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    calls.push({ path, body });
    const r = handler(path, body);
    return { status: r.status, headers: { get: () => null }, text: async () => JSON.stringify(r.body) };
  };
  return { fetchFn, calls };
}

/** 기본 가짜 서버 — health · catalog(gcp 만) · wizard(계획의 provider 가 gcp 가 아니면 400 provider_not_enabled) */
function server() {
  return fake((path, body) => {
    if (path === '/v1/health') return { status: 200, body: { ok: true, version: { engine: '0.1.0', rules: 'v1' } } };
    if (path === '/catalog.json') return { status: 200, body: catalog() };
    if (body?.provider !== 'gcp') {
      return { status: 400, body: { success: false, errors: [{ code: 'request.provider_not_enabled', field: 'provider', params: { provider: body?.provider }, message: `Provider '${body?.provider}' is not available yet` }], supported: ['gcp'] } };
    }
    return { status: 200, body: wizard('gcp', ITEMS) };
  });
}

/**
 * @param {string[]} argv @param {import('./lib/http.mjs').FetchFn} fetchFn @param {string} cwd
 * @param {{ tty?: boolean, env?: Record<string, string> }} [o]
 */
async function run(argv, fetchFn, cwd, o = {}) {
  /** @type {string[]} */ const out = [];
  /** @type {string[]} */ const err = [];
  let screen = '';
  const code = await main(argv, {
    fetchFn, cwd, env: { CLOUDONYM_SERVER: 'http://fake.test', ...o.env }, configPath: null, now: () => new Date('2026-10-21T00:00:00+09:00'),
    stdout: (s) => { out.push(s); }, stderr: (s) => { err.push(s); }, write: (s) => { screen += s; }, tty: { stdin: o.tty === true, stdout: o.tty === true },
    // 답 없는 입력 — 묻는 흐름에 들어가면 첫 물음에서 NoAnswer(64)로 끝난다(시험이 멈추지 않게)
    stdin: Readable.from([]),
  });
  return { code, out: out.join('\n'), err: err.join('\n'), screen };
}

const PLAN = { provider: 'gcp', project: { owner: 'o', system: 's', env: 'prod', region: 'r' }, project_picks: [], services: [{ purpose: 'shop', picks: [{ preset: 'db', instances: [{ id: '1', seq: '01' }] }] }], rules_version: 'v1' };
/** @param {Record<string, unknown>} [over] */
function withPlan(over = {}) {
  const dir = tmpDir();
  writeFileSync(join(dir, 'cloudonym.plan.json'), `${JSON.stringify({ ...PLAN, ...over }, null, 2)}\n`);
  return dir;
}
const planOf = (/** @type {string} */ dir) => JSON.parse(readFileSync(join(dir, 'cloudonym.plan.json'), 'utf-8'));

// ── 1. provider ──

test('[1] init --provider — 기본 gcp(catalog 를 읽지 않는다) · 켜진 provider 면 그 값 · 켜지지 않았으면 2 와 한 줄 · 파일 없음 · 틀린 값은 64 와 제안', async () => {
  const a = tmpDir();
  const s1 = server();
  const r1 = await run(['init', '--owner', 'o', '--system', 's', '--env', 'prod', '--region', 'r'], s1.fetchFn, a);
  assert.equal(r1.code, EXIT.OK, r1.err);
  assert.equal(planOf(a).provider, 'gcp');
  assert.deepEqual(s1.calls.map((c) => c.path), ['/v1/health']);

  const b = tmpDir();
  const r2 = await run(['init', '--owner', 'o', '--system', 's', '--env', 'prod', '--region', 'r', '--provider', 'GCP'], server().fetchFn, b);
  assert.equal(r2.code, EXIT.OK, r2.err);
  assert.equal(planOf(b).provider, 'gcp');

  const c = tmpDir();
  const r3 = await run(['init', '--owner', 'o', '--system', 's', '--env', 'prod', '--region', 'us-east-1', '--provider', 'aws'], server().fetchFn, c);
  assert.equal(r3.code, EXIT.INPUT);
  assert.equal(r3.err, 'aws is not enabled on this server yet (this server supports gcp). One plan file is one provider: make a plan with --provider gcp.');
  assert.equal(existsSync(join(c, 'cloudonym.plan.json')), false);

  // 켜진 서버라면 aws 계획 파일을 쓴다 — provider 는 파일 최상위 한 곳
  const d = tmpDir();
  const awsOn = fake((path) => (path === '/v1/health' ? { status: 200, body: { ok: true, version: { rules: 'v1' } } } : { status: 200, body: catalog({ gcp: {}, aws: {} }) }));
  const r4 = await run(['init', '--owner', 'o', '--system', 's', '--env', 'prod', '--region', 'us-east-1', '--provider', 'aws'], awsOn.fetchFn, d);
  assert.equal(r4.code, EXIT.OK, r4.err);
  assert.equal(planOf(d).provider, 'aws');

  const r5 = await run(['init', '--owner', 'o', '--system', 's', '--env', 'prod', '--region', 'r', '--provider', 'gpc'], server().fetchFn, tmpDir());
  assert.equal(r5.code, EXIT.USAGE);
  assert.match(r5.err, /--provider must be gcp, aws, azure: gpc\. Did you mean gcp\?/);
});

test('[1] 그 뒤 명령은 계획 파일의 provider — 서버 400 provider_not_enabled 는 한 줄과 2(400 의 코드 그대로) · names --json 의 provider 도 계획의 값', async () => {
  const dir = withPlan({ provider: 'aws' });
  const s = server();
  const r = await run(['names'], s.fetchFn, dir);
  assert.equal(r.code, EXIT.INPUT);
  assert.equal(r.err, 'aws is not enabled on this server yet (this server supports gcp). One plan file is one provider: make a plan with --provider gcp.');
  assert.equal(s.calls[0]?.body.provider, 'aws');
  const v = await run(['validate'], server().fetchFn, dir);
  assert.equal(v.code, EXIT.INPUT);
  assert.match(v.err, /^aws is not enabled on this server yet/);
  // add 는 /catalog.json 에 그 provider 가 없으면 같은 한 줄
  const a = await run(['add', 'db', '--service', 'shop'], server().fetchFn, dir);
  assert.equal(a.code, EXIT.INPUT);
  assert.match(a.err, /^aws is not enabled on this server yet \(this server supports gcp\)/);
  assert.equal(planOf(dir).provider, 'aws');

  // 켜진 서버 — data.aws 를 읽고 --json 에 provider aws
  const on = fake((_path, body) => ({ status: 200, body: wizard(body.provider, ITEMS) }));
  const j = await run(['names', '--json', '--no-write'], on.fetchFn, dir);
  assert.equal(j.code, EXIT.OK, j.err);
  assert.equal(JSON.parse(j.out).provider, 'aws');
});

test('[1] new --provider — 켜지지 않았으면 묻기 전에 2 · 아무것도 쓰지 않는다', async () => {
  const dir = tmpDir();
  const r = await run(['new', '--provider', 'azure'], server().fetchFn, dir, { tty: true });
  assert.equal(r.code, EXIT.INPUT);
  assert.match(r.err, /^azure is not enabled on this server yet/);
  assert.equal(r.screen.includes('Who runs it'), false);
  assert.equal(existsSync(join(dir, 'cloudonym.plan.json')), false);
});

// ── 2. --no-input ──

test('[2] --no-input · CLOUDONYM_NO_INPUT=1 — 터미널이어도 묻지 않고 64, 넘길 플래그를 알린다 · 서버에 보내지 않는다', async () => {
  const dir = tmpDir();
  for (const o of [{ argv: ['--no-input'] }, { argv: [], env: { CLOUDONYM_NO_INPUT: '1' } }]) {
    const s = server();
    const r = await run(o.argv, s.fetchFn, dir, { tty: true, ...(o.env ? { env: o.env } : {}) });
    assert.equal(r.code, EXIT.USAGE, JSON.stringify(o));
    assert.match(r.err, /Nothing is asked with --no-input .* cloudonym init --owner O --system S --env E --region R/);
    assert.equal(r.err.includes('Usage:'), false);
    assert.equal(r.screen, '');
    assert.equal(s.calls.length, 0);
  }
  const n = await run(['new', '--no-input'], server().fetchFn, dir, { tty: true });
  assert.equal(n.code, EXIT.USAGE);
  assert.match(n.err, /new asks questions, so it needs a terminal \(and no --json, --output json\|tsv or --no-input\)\. In scripts use: cloudonym init/);
  const p = withPlan();
  const a = await run(['add'], server().fetchFn, p, { tty: true, env: { CLOUDONYM_NO_INPUT: 'true' } });
  assert.equal(a.code, EXIT.USAGE);
  assert.match(a.err, /add asks what to add only on a terminal without --no-input\. Pass what to add: cloudonym add <preset \| rule id \| resource> --service <purpose>/);
  // 0 · 빈 값은 꺼짐 — 묻는 흐름으로 간다(입력이 닫혀 64 이지만 물음은 보인다)
  const off = await run([], server().fetchFn, tmpDir(), { tty: true, env: { CLOUDONYM_NO_INPUT: '0' } });
  assert.match(off.screen, /Who runs it\?/);
});

// ── 3. 오류 제안 ──

test('[3] 편집 거리 — distance · closest(짧은 말은 1, 긴 말은 2까지)', () => {
  assert.equal(distance('valdate', 'validate'), 1);
  assert.equal(distance('', 'abc'), 3);
  assert.deepEqual(closest('valdate', ['new', 'init', 'add', 'names', 'validate']), ['validate']);
  assert.equal(distance('gpc', 'gcp'), 1);
  assert.deepEqual(closest('ad', ['new', 'add']), ['add']);
  assert.deepEqual(closest('nme', ['new', 'names']), []);
  assert.deepEqual(closest('xyz', ['new', 'names']), []);
});

test('[3] 모르는 명령 — 「Did you mean」 · 사용법 전체 대신 --help 한 줄 · 64 그대로 · 모르는 플래그도 가까운 것을 제안', async () => {
  const dir = tmpDir();
  const r = await run(['valdate'], server().fetchFn, dir);
  assert.equal(r.code, EXIT.USAGE);
  assert.equal(r.err, 'Unknown command: valdate. Did you mean validate?\nRun "cloudonym --help" for the commands and options.');
  const far = await run(['frobnicate'], server().fetchFn, dir);
  assert.equal(far.err, 'Unknown command: frobnicate.\nRun "cloudonym --help" for the commands and options.');
  const flag = await run(['names', '--kyes'], server().fetchFn, dir);
  assert.equal(flag.code, EXIT.USAGE);
  assert.match(flag.err, /^Unknown option '--kyes'\. Did you mean --keys\?\nRun "cloudonym --help" for the commands and options\.$/);
});

test('[3] add <번호> — 메뉴 번호라고 알리고 그 번호의 프리셋 id 와 명령을 보인다 · 대상 자리가 비면 64, 아니면 2(전과 같다) · 파일 그대로', async () => {
  const dir = withPlan();
  const before = readFileSync(join(dir, 'cloudonym.plan.json'), 'utf-8');
  const r = await run(['add', '2', '--service', 'shop'], server().fetchFn, dir);
  assert.equal(r.code, EXIT.INPUT);
  assert.match(r.err, /^2 is a menu number: numbers work only in the questions of "cloudonym add" with no arguments on a terminal\./);
  assert.match(r.err, /In that menu 2 is Cache — preset cache: cloudonym add cache --service shop/);
  assert.match(r.err, /Preset ids: db, cache \(all of them: "presets" in \/catalog\.json/);
  const bare = await run(['add', '15'], server().fetchFn, dir);
  assert.equal(bare.code, EXIT.USAGE);
  assert.match(bare.err, /^15 is a menu number/);
  assert.equal(bare.err.includes('In that menu'), false);
  assert.equal(readFileSync(join(dir, 'cloudonym.plan.json'), 'utf-8'), before);
});

test('[3] hint — 오타는 편집 거리로(dbb → db · cloud_sql_instnce → gcp.cloud_sql_instance), 부분 문자열 후보도 그대로', () => {
  const cat = { rows: ROWS, presets: PRESETS };
  assert.match(/** @type {any} */ (resolveTarget('dbb', 'gcp', cat)).error, /Did you mean: db\b/);
  assert.match(/** @type {any} */ (resolveTarget('cloud_sql_instnce', 'gcp', cat)).error, /Did you mean: gcp\.cloud_sql_instance/);
  assert.match(/** @type {any} */ (resolveTarget('sql_inst', 'gcp', cat)).error, /Did you mean: gcp\.cloud_sql_instance/);
});

// ── 4. --output ──

test('[4] --output tsv — 머리 줄 하나 + env · what · name · check(--keys 면 key) · 파이프에서도 · 환경 둘이면 한 머리 줄', async () => {
  const dir = withPlan({ environments: ['prod', 'stg'] });
  const r = await run(['names', '-o', 'tsv', '--no-write'], server().fetchFn, dir);
  assert.equal(r.code, EXIT.OK, r.err);
  assert.deepEqual(r.out.split('\n'), [
    'env\twhat\tname\tcheck',
    'prod\tProject ID\to-s-prod\tPASS',
    'prod\tDatabase (Cloud SQL) 01 (shop)\ts-shop-prod-sql-01\tPASS',
    'stg\tProject ID\to-s-prod\tPASS',
    'stg\tDatabase (Cloud SQL) 01 (shop)\ts-shop-prod-sql-01\tPASS',
  ]);
  const k = await run(['names', '--output', 'tsv', '--keys', '--env', 'stg', '--no-write'], server().fetchFn, dir);
  assert.deepEqual(k.out.split('\n').slice(0, 2), ['env\twhat\tname\tcheck\tkey', 'stg\tProject ID\to-s-prod\tPASS\tproject/-/project_id/-/-/-']);
});

test('[4] --json 은 --output json 과 같다 · 섞으면 64 · 모르는 꼴은 64 · --output table 은 파이프에서도 표 · json · tsv 는 묻지 않는다', async () => {
  const dir = withPlan();
  const a = await run(['names', '--json', '--no-write'], server().fetchFn, dir);
  const b = await run(['names', '-o', 'json', '--no-write'], server().fetchFn, dir);
  assert.equal(a.code, EXIT.OK, a.err);
  assert.equal(a.out, b.out);
  assert.equal(JSON.parse(a.out).provider, 'gcp');
  assert.equal((await run(['names', '--json', '-o', 'tsv'], server().fetchFn, dir)).code, EXIT.USAGE);
  const x = await run(['names', '-o', 'xml'], server().fetchFn, dir);
  assert.equal(x.code, EXIT.USAGE);
  assert.match(x.err, /--output must be table, json, tsv: xml/);
  const t = await run(['names', '-o', 'table', '--no-write'], server().fetchFn, dir);
  assert.match(t.out, /^What {2,}Name {2,}Unique in {2,}Check\n/);
  for (const argv of [['-o', 'json'], ['new', '-o', 'tsv'], ['add', '--output', 'json']]) {
    const s = server();
    const r = await run(argv, s.fetchFn, tmpDir(), { tty: true });
    assert.equal(r.code, EXIT.USAGE, argv.join(' '));
    assert.equal(r.screen.includes('Who runs it'), false, argv.join(' '));
  }
});

test('[4] add -o tsv · init -o json — 새 이름의 tsv · 쓴 계획의 요약 JSON', async () => {
  const dir = withPlan();
  let n = 0;
  const s = fake((path) => {
    if (path === '/catalog.json') return { status: 200, body: catalog() };
    n++;
    return { status: 200, body: wizard('gcp', n === 1 ? ITEMS : [...ITEMS, { ...ITEMS[1], key: 'shop/cloud_sql_instance/-/02', seq: '02', name: 's-shop-prod-sql-02' }]) };
  });
  const r = await run(['add', 'db', '--service', 'shop', '-o', 'tsv'], s.fetchFn, dir);
  assert.equal(r.code, EXIT.OK, r.err);
  assert.deepEqual(r.out.split('\n'), ['env\twhat\tname\tcheck', 'prod\tDatabase (Cloud SQL) 02 (shop)\ts-shop-prod-sql-02\tPASS']);
  const i = await run(['init', '--owner', 'o', '--system', 's', '--env', 'prod,stg', '--region', 'r', '-o', 'json'], server().fetchFn, tmpDir());
  assert.deepEqual(JSON.parse(i.out), { file: 'cloudonym.plan.json', provider: 'gcp', rules_version: 'v1', environments: ['prod', 'stg'] });
});

// ── 5. 유일 범위 ──

test('[5] Unique in 칸 — /catalog.json scopes 로 이름 · 뿌리는 global 과 표 아래 한 줄 · scopes 가 없는 서버는 id · 항목에 범위가 없으면 칸이 없다', () => {
  const cat = { scopes: SCOPES, rows: ROWS, presets: PRESETS };
  assert.equal(scopeLabel('gcp:namespace', 'csp', cat), 'global');
  assert.equal(scopeLabel('gcp:project', 'csp', cat), 'Project');
  assert.equal(scopeLabel('gcp:project_region', 'csp', cat), 'Project · Region');
  assert.equal(scopeLabel('gcp:project_region', 'csp', {}), 'project_region');
  assert.equal(scopeLabel('aws:region', 'none', cat), 'not enforced');
  const rows = ITEMS.map((it) => ({ item: it, valid: true, scope: it.scope, uniqueness: it.uniqueness }));
  const lines = nameTable(rows, cat, 'gcp', false);
  assert.match(lines[0] ?? '', /^What {2,}Name {2,}Unique in {2}Check$/);
  assert.match(lines[1] ?? '', /^Project ID {2,}o-s-prod {2,}global {5}PASS$/);
  assert.match(lines[2] ?? '', / {2}Project {4}PASS$/);
  assert.equal(lines[3], 'global: unique across every customer of the provider — a name that passes can still be taken by someone else.');
  const plain = nameTable(rows.map(({ item, valid }) => ({ item, valid })), cat, 'gcp', false);
  assert.match(plain[0] ?? '', /^What {2,}Name {2,}Check$/);
  assert.equal(plain.length, 3);
});

// ── 7. 셸 완성 ──

test('[7] completion — bash · zsh · fish 에 명령 · 플래그가 다 들어 있다 · bash · zsh 문법 검사 · 서버를 부르지 않는다 · 틀린 셸은 64', async () => {
  const help = await run(['--help'], server().fetchFn, tmpDir());
  const flags = [...new Set([...help.out.matchAll(/(?:^|\s)(--[a-z][a-z-]*)/g)].map((m) => m[1]))];
  assert.ok(flags.includes('--output') && flags.includes('--no-input') && flags.includes('--provider'), flags.join(' '));
  for (const shell of ['bash', 'zsh', 'fish']) {
    const s = server();
    const r = await run(['completion', shell], s.fetchFn, tmpDir());
    assert.equal(r.code, EXIT.OK, r.err);
    assert.equal(s.calls.length, 0);
    for (const c of ['new', 'init', 'add', 'names', 'validate', 'completion']) assert.ok(r.out.includes(c), `${shell} ${c}`);
    for (const f of flags) assert.ok(shell === 'fish' ? r.out.includes(`-l ${f.slice(2)}`) : r.out.includes(f), `${shell} ${f}`);
    if (shell !== 'fish') {
      const dir = tmpDir();
      const file = join(dir, `c.${shell}`);
      writeFileSync(file, r.out);
      execFileSync(shell, ['-n', file]);
    }
  }
  assert.match((await run(['completion', 'zsh'], server().fetchFn, tmpDir())).out, /^#compdef cloudonym\n/);
  const bad = await run(['completion', 'zhs'], server().fetchFn, tmpDir());
  assert.equal(bad.code, EXIT.USAGE);
  assert.match(bad.err, /completion takes one shell: bash, zsh, fish \(got zhs\)\. Did you mean zsh\?/);
  assert.equal((await run(['completion'], server().fetchFn, tmpDir())).code, EXIT.USAGE);
});

// ── 독립 리뷰 지적 (재현 시험) ──

/** 프로젝트 공용 프리셋이 있는 서버 — 메뉴 번호: 1 vpc · 2 db · 3 cache */
function serverWithProject() {
  const presets = [{ id: 'vpc', label: 'VPC network', rule: 'gcp.project_id', tier: null, level: 'project' }, ...PRESETS];
  return fake((path) => (path === '/catalog.json' ? { status: 200, body: catalog({ gcp: { rows: ROWS, presets, limits: { max_count: 99 }, scopes: SCOPES } }) } : { status: 200, body: wizard('gcp', ITEMS) }));
}

test('[R1] add <번호> --service — 번호는 인자 없는 add · new 의 메뉴(프로젝트 공용 먼저) 그대로 · 프로젝트 공용이면 --project 로 안내', async () => {
  const dir = withPlan();
  const r = await run(['add', '1', '--service', 'shop'], serverWithProject().fetchFn, dir);
  assert.match(r.err, /In that menu 1 is VPC network — preset vpc: cloudonym add vpc --project/);
  const r2 = await run(['add', '2', '--service', 'shop'], serverWithProject().fetchFn, dir);
  assert.match(r2.err, /In that menu 2 is Database \(Cloud SQL\) — preset db: cloudonym add db --service shop/);
});

test('[R2] init --from — -o json 요약 · --provider 가 파일과 다르면 64(파일을 쓰지 않는다)', async () => {
  const dir = tmpDir();
  const src = join(dir, 'saved.json');
  writeFileSync(src, JSON.stringify(PLAN));
  const r = await run(['init', '--from', src, '-f', 'out.json', '-o', 'json'], server().fetchFn, dir);
  assert.equal(r.code, EXIT.OK, r.err);
  assert.deepEqual(JSON.parse(r.out), { file: 'out.json', provider: 'gcp', rules_version: 'v1', environments: ['prod'] });
  const t = await run(['new', '--from', src, '-f', 'out2.json', '-o', 'tsv'], server().fetchFn, dir);
  assert.equal(t.out, 'file\tprovider\trules_version\tenvironments\nout2.json\tgcp\tv1\tprod');
  const p = await run(['init', '--from', src, '-f', 'out3.json', '--provider', 'aws'], server().fetchFn, dir);
  assert.equal(p.code, EXIT.USAGE);
  assert.match(p.err, /--provider aws does not match the provider of .*saved\.json \(gcp\)/);
  assert.equal(existsSync(join(dir, 'out3.json')), false);
});

test('[R3] names --new — 보관 파일의 invalid 키도 이미 아는 것 · 새 것이 없으면 표 머리도 없다', async () => {
  const dir = withPlan();
  writeFileSync(join(dir, 'cloudonym.plan.names.json'), JSON.stringify({ received_at: 'x', rules_version: 'v1', environments: { prod: { names: [{ key: ITEMS[0]?.key, name: 'o-s-prod' }], invalid: [{ key: ITEMS[1]?.key, name: 'old' }] } } }));
  const t = await run(['names', '--new', '-o', 'tsv', '--no-write'], server().fetchFn, dir);
  assert.equal(t.out, 'env\twhat\tname\tcheck');
  const tb = await run(['names', '--new', '-o', 'table', '--no-write'], server().fetchFn, dir);
  assert.equal(tb.code, EXIT.OK, tb.err);
  assert.equal(tb.out, '');
});

test('[R4] --no-input — add --service · --project 도 짧은 문장 · 계획이 있으면 cloudonym 은 이름을 보인다 · 파이프에서도 짧은 문장', async () => {
  const p = withPlan();
  for (const flag of [['--service', 'shop'], ['--project']]) {
    const a = await run(['add', ...flag, '--no-input'], server().fetchFn, p, { tty: true });
    assert.equal(a.code, EXIT.USAGE);
    assert.match(a.err, /^add asks what to add only on a terminal without --no-input/);
    assert.equal(a.err.includes('Usage:'), false);
  }
  const n = await run(['--no-input', '--no-write'], server().fetchFn, p, { tty: true });
  assert.equal(n.code, EXIT.OK, n.err);
  assert.match(n.out, /o-s-prod/);
  const piped = await run(['--no-input'], server().fetchFn, tmpDir());
  assert.equal(piped.code, EXIT.USAGE);
  assert.match(piped.err, /^Nothing is asked with --no-input/);
  assert.equal(piped.out.includes('Usage:'), false);
});

test('[R5] 거르기는 provider 앞머리(gcp.)를 보지 않는다', async () => {
  const { filterItems } = await import('./lib/menu.mjs');
  const items = PRESETS.map((preset, i) => ({ n: i + 1, preset }));
  assert.deepEqual(filterItems(items, 'gcp'), []);
  assert.deepEqual(filterItems(items, 'p.').map((x) => x.preset.id), []);
  assert.deepEqual(filterItems(items, 'sql').map((x) => x.preset.id), ['db', 'cache']);
});

test('[R6] add <번호> — 계획 파일이 깨졌으면 그 오류를 숨기지 않는다(2)', async () => {
  const dir = tmpDir();
  writeFileSync(join(dir, 'cloudonym.plan.json'), '{ not json');
  const r = await run(['add', '2', '--service', 'shop'], server().fetchFn, dir);
  assert.equal(r.code, EXIT.INPUT);
  assert.match(r.err, /2 is a menu number/);
  assert.match(r.err, /cloudonym\.plan\.json/);
});

test('[R7] 짧은 플래그 오타는 짧은 플래그로(-H → -h) · add gcp. 는 아무거나 제안하지 않는다', async () => {
  const h = await run(['-H'], server().fetchFn, tmpDir());
  assert.match(h.err, /^Unknown option '-H'\. Did you mean -h\?/);
  const cat = { rows: ROWS, presets: PRESETS };
  assert.equal(/** @type {any} */ (resolveTarget('gcp.', 'gcp', cat)).error.includes('Did you mean'), false);
});

test('[R8] new — 마법사 데이터가 없는 서버면 health 전에 2', async () => {
  const s = fake((path) => (path === '/catalog.json' ? { status: 200, body: catalog({ gcp: { rows: ROWS, presets: [], limits: {} } }) } : { status: 500, body: {} }));
  const r = await run(['new'], s.fetchFn, tmpDir(), { tty: true });
  assert.equal(r.code, EXIT.INPUT, r.err);
  assert.deepEqual(s.calls.map((c) => c.path), ['/catalog.json']);
});
