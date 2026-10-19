// @ts-check
// 묻고 답하는 흐름 (D121 · 설계 §5 · §8) — 터미널 없이 답을 스트림으로 넣고 물음 · 표를 한 줄기로 모아 본다. 서버는 가짜(엔진의 실답은 src/api/cli-contract.test.ts)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { main, EXIT } from './lib/main.mjs';

/** @type {string[]} */
const made = [];
const tmpDir = () => { const d = mkdtempSync(join(tmpdir(), 'cloudonym-cli-guide-')); made.push(d); return d; };
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

const PRESETS = [
  { id: 'web', label: 'Web server', rule: 'gcp.compute_instance', tier: 'web', ha: { min_instances: 2 }, serverless: null, level: 'service' },
  { id: 'db', label: 'Database (Cloud SQL)', rule: 'gcp.cloud_sql_instance', tier: null, ha: null, serverless: null, level: 'service' },
  { id: 'sa', label: 'Service account', rule: 'gcp.service_account', tier: null, ha: null, serverless: null, level: 'service' },
  { id: 'vpc', label: 'VPC network', rule: 'gcp.vpc_network', tier: null, ha: null, serverless: null, level: 'project', group: 'network' },
];
const ROWS = [
  { key: 'gcp.compute_instance', displayName: 'VM Instance', rules: { 'gcp.compute_instance': { input: 'count', tier: true } } },
  { key: 'gcp.cloud_sql_instance', displayName: 'Cloud SQL', kind: { tokens: { MYSQL: null, POSTGRES: 'pg' }, omitValues: ['MYSQL'] }, rules: { 'gcp.cloud_sql_instance': { input: 'count', tier: true, kinds: { default: 'MYSQL', allowed: ['MYSQL', 'POSTGRES'] } } } },
  { key: 'gcp.service_account', displayName: 'Service Account', rules: { 'gcp.service_account': { input: 'role', tier: true } } },
  { key: 'gcp.vpc_network', displayName: 'VPC Network', rules: { 'gcp.vpc_network': { input: 'count', tier: false } } },
  { key: 'gcp.project_id', displayName: 'Project ID', rules: { 'gcp.project_id': { input: 'none', tier: false } } },
  { key: 'gcp.disk', displayName: 'Persistent Disk', rules: { 'gcp.disk': { input: 'none', tier: false } } },
];
const ATTACHMENTS = [
  { parent: 'gcp.compute_instance', attach: 'boot', child: 'gcp.disk', seq: false },
  { parent: 'gcp.compute_instance', attach: 'data', child: 'gcp.disk', seq: true },
];
const REGIONS = [{ region: 'asia-northeast3', code: 'ane3', label: 'Seoul, South Korea' }, { region: 'us-central1', code: 'usc1', label: 'Iowa, USA' }];
const ENVS = ['prod', 'stg', 'dev'];
/** @param {boolean} withEnvValues */
const catalog = (withEnvValues) => ({
  version: { engine: '0.1.0', rules: 'v1' }, ...(withEnvValues ? { env_values: ENVS } : {}),
  providers: { gcp: { meta: null, rows: ROWS, regions: REGIONS, presets: PRESETS, attachments: ATTACHMENTS, limits: { max_count: 99, max_data_disks: 9 } } },
});

/** 계획 → 항목(프로젝트 ID + 슬롯마다 하나 + boot) — 가짜 서버의 답. role 이 대문자면 400 @param {any} plan */
function wizardAnswer(plan) {
  const env = plan.project.env;
  if (!ENVS.includes(env)) return { status: 400, body: { success: false, errors: [{ code: 'context.value_unsupported', field: 'project.env', message: `project.env '${env}' is not supported (${ENVS.join(', ')})` }] } };
  /** @type {any[]} */
  const items = [{ key: 'project/-/project_id/-/-/-', namespace: 'project', level: 'project', resource_type: 'project_id', name: `${plan.project.owner}-${plan.project.system}-${env}`, valid: true, violations: [] }];
  /** @param {any} p @param {string} ns @param {number} j @param {string} at */
  const pickItems = (p, ns, j, at) => {
    const preset = PRESETS.find((x) => x.id === p.preset);
    if (!preset) return { error: { code: 'x', field: `${at}[${j}]`, message: 'unknown preset' } };
    if (p.role !== undefined && !/^[a-z0-9]{2,16}$/.test(p.role)) return { error: { code: 'selection.invalid_role', field: `${at}[${j}]`, message: `${at}[${j}]: role '${p.role}' does not match ^[a-z0-9]{2,16}$` } };
    const type = preset.rule.slice(4);
    const level = ns === 'project' ? { level: 'project' } : {};
    const tier = preset.tier ? { tier: preset.tier } : {};
    if (!p.instances) return { list: [{ key: `${ns}/${type}/${p.role ?? '-'}`, namespace: ns, ...level, resource_type: type, ...tier, ...(p.role ? { role: p.role } : {}), name: `${ns}-${type}-${p.role ?? 'x'}`, valid: true, violations: [] }] };
    return { list: p.instances.flatMap((/** @type {any} */ s) => {
      const key = `${ns}/${type}/${p.kind ?? '-'}/${s.seq}`;
      const base = { key, namespace: ns, ...level, resource_type: type, ...tier, seq: s.seq, ...(p.kind ? { kind: p.kind } : {}), name: `${plan.project.system}-${ns}-${env}-${type}-${s.seq}`, valid: true, violations: [] };
      return [base, ...(s.attach?.boot ? [{ key: `${key}/boot/-`, namespace: ns, parent: key, attach: 'boot', resource_type: 'disk', name: `${base.name}-boot`, valid: true, violations: [] }] : [])];
    }) };
  };
  /** @type {any[]} */
  const errors = [];
  plan.project_picks.forEach((/** @type {any} */ p, /** @type {number} */ j) => { const r = pickItems(p, 'project', j, 'project_picks'); if (r.error) errors.push(r.error); else items.push(...r.list); });
  plan.services.forEach((/** @type {any} */ s, /** @type {number} */ i) => s.picks.forEach((/** @type {any} */ p, /** @type {number} */ j) => { const r = pickItems(p, s.purpose, j, `services[${i}].picks`); if (r.error) errors.push(r.error); else items.push(...r.list); }));
  if (errors.length > 0) return { status: 400, body: { success: false, errors } };
  return { status: 200, body: { success: true, version: { engine: '0.1.0', rules: 'v1' }, data: { gcp: { valid: true, items, conflicts: [] } } } };
}

/** @param {{ envValues?: boolean }} [o] */
function server(o = {}) {
  /** @type {{ path: string, body: any }[]} */
  const calls = [];
  /** @type {import('./lib/http.mjs').FetchFn} */
  const fetchFn = async (url, init) => {
    const path = new URL(url).pathname;
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    calls.push({ path, body });
    const r = path === '/catalog.json' ? { status: 200, body: catalog(o.envValues ?? true) }
      : path === '/v1/health' ? { status: 200, body: { ok: true, version: { engine: '0.1.0', rules: 'v1' } } }
        : wizardAnswer(body);
    return { status: r.status, headers: { get: () => null }, text: async () => JSON.stringify(r.body) };
  };
  return { fetchFn, calls };
}

/**
 * 터미널인 척 — 답은 스트림으로, 물음 · 표는 한 줄기(screen)로. 스트림이 끝나면 다음 물음은 NoAnswer
 * @param {string[]} argv @param {string[]} answers @param {{ cwd: string, fetchFn: import('./lib/http.mjs').FetchFn, tty?: boolean }} o
 */
async function term(argv, answers, o) {
  let screen = '';
  /** @type {string[]} */ const err = [];
  let reads = 0;
  const stdin = Readable.from(answers.map((a) => { reads++; return `${a}\n`; }));
  const code = await main(argv, {
    fetchFn: o.fetchFn, cwd: o.cwd, env: { CLOUDONYM_SERVER: 'http://fake.test' }, configPath: null, now: () => new Date('2026-10-20T00:00:00+09:00'),
    tty: { stdin: o.tty ?? true, stdout: o.tty ?? true }, stdin, write: (s) => { screen += s; }, stdout: (s) => { screen += `${s}\n`; }, stderr: (s) => { err.push(s); },
  });
  return { code, screen, err: err.join('\n'), reads };
}

const plan = (/** @type {string} */ dir) => JSON.parse(readFileSync(join(dir, 'cloudonym.plan.json'), 'utf-8'));
const count = (/** @type {string} */ s, /** @type {string} */ what) => s.split(what).length - 1;

// 웹 2대(HA · boot) + DB(POSTGRES) + VPC — 설계 §7 의 답(서버 데이터가 작아 번호가 다르다: 1 VPC · 2 Web · 3 DB · 4 SA)
const ANSWERS = ['demo', 'payment', '1', 'seoul', '', '1,2,3', '', 'shop', '2', 'y', 'y', '0', '', 'POSTGRES', 'n'];

test('④ 묻는 흐름 — 답이 init · add 와 같은 꼴의 계획 파일이 된다 · 보관 파일 · 표 · 다음 할 일', async () => {
  const dir = tmpDir();
  const s = server();
  const r = await term([], ANSWERS, { cwd: dir, fetchFn: s.fetchFn });
  assert.equal(r.code, EXIT.OK, `${r.err}\n${r.screen}`);
  assert.equal(readFileSync(join(dir, 'cloudonym.plan.json'), 'utf-8'), `${JSON.stringify({
    provider: 'gcp', project: { owner: 'demo', system: 'payment', env: 'prod', region: 'asia-northeast3' },
    project_picks: [{ preset: 'vpc', instances: [{ id: '1', seq: '01' }] }],
    services: [{ purpose: 'shop', picks: [
      { preset: 'web', ha: true, instances: [{ id: '1', seq: '01', attach: { boot: true } }, { id: '2', seq: '02', attach: { boot: true } }] },
      { preset: 'db', kind: 'POSTGRES', instances: [{ id: '1', seq: '01' }] },
    ] }],
    rules_version: 'v1',
  }, null, 2)}\n`);
  const names = JSON.parse(readFileSync(join(dir, 'cloudonym.plan.names.json'), 'utf-8'));
  assert.equal(names.received_at, '2026-10-20T00:00:00+09:00');
  assert.equal(names.environments.prod.names.length, 7);
  // 물음 — 선택지는 서버 데이터: env_values 번호 목록 · 리전 label · 프리셋 label · kinds
  assert.match(r.screen, /Environments, comma-separated \[1 prod · 2 stg · 3 dev\]: 1\n/);
  assert.match(r.screen, / {3}1 asia-northeast3 — Seoul, South Korea\nPick \[1\]: \n/);
  assert.match(r.screen, /Shared by the project\n {4}1 VPC network\n {2}Parts of a service\n {4}2 Web server · 3 Database \(Cloud SQL\) · 4 Service account\n/);
  assert.match(r.screen, /Database \(Cloud SQL\) — kind \[1 MYSQL · 2 POSTGRES\] \[MYSQL\]: POSTGRES\n/);
  // 표 — 키는 보이지 않는다 · 딸린 것은 들여 쓴다
  const table = r.screen.slice(r.screen.indexOf('What  '));
  assert.deepEqual(table.trimEnd().split('\n'), [
    'What                            Name                                        Check',
    'Project ID                      demo-payment-prod                           PASS',
    'VPC network 01                  payment-project-prod-vpc_network-01         PASS',
    'Web server 01 (shop)            payment-shop-prod-compute_instance-01       PASS',
    '  boot disk                     payment-shop-prod-compute_instance-01-boot  PASS',
    'Web server 02 (shop)            payment-shop-prod-compute_instance-02       PASS',
    '  boot disk                     payment-shop-prod-compute_instance-02-boot  PASS',
    'Database (Cloud SQL) 01 (shop)  payment-shop-prod-cloud_sql_instance-01     PASS',
    '',
    '7 names · all valid · saved cloudonym.plan.json and cloudonym.plan.names.json',
    'Add more: cloudonym add · Check before applying: cloudonym validate · Machines: cloudonym names --json',
  ]);
  assert.equal(table.includes('compute_instance/-/'), false);
  // 부른 것 — catalog · health · 환경 하나에 wizard 한 번
  assert.deepEqual(s.calls.map((c) => c.path), ['/catalog.json', '/v1/health', '/v1/wizard']);
});

test('⑤ env_values 가 없는 서버 — 환경은 자유 입력, 400 project.env 면 그 질문만 다시 묻는다', async () => {
  const dir = tmpDir();
  const s = server({ envValues: false });
  const answers = ['demo', 'payment', 'bogus', 'asia-northeast3', '1', '', 'n', 'prod'];
  const r = await term(['new'], answers, { cwd: dir, fetchFn: s.fetchFn });
  assert.equal(r.code, EXIT.OK, `${r.err}\n${r.screen}`);
  assert.match(r.screen, /Environments, comma-separated \(e\.g\. prod or prod,stg\): bogus\n/);
  assert.match(r.screen, /The server did not accept some answers:\n {2}project\.env: project\.env 'bogus' is not supported \(prod, stg, dev\)\n/);
  assert.equal(count(r.screen, 'Environments, comma-separated'), 2);
  assert.equal(count(r.screen, 'Who runs it?'), 1);
  assert.equal(count(r.screen, 'Region ('), 1);
  assert.equal(count(r.screen, 'What are you building?'), 1);
  assert.equal(plan(dir).project.env, 'prod');
  assert.deepEqual(s.calls.map((c) => c.path), ['/catalog.json', '/v1/health', '/v1/wizard', '/v1/wizard']);
});

test('⑤ 부품의 400(field 가 그 pick) — 그 부품의 세부만 다시 묻는다', async () => {
  const dir = tmpDir();
  const s = server();
  const answers = ['demo', 'payment', '1', 'asia-northeast3', '4', 'shop', 'BAD', 'n', 'deploy'];
  const r = await term([], answers, { cwd: dir, fetchFn: s.fetchFn });
  assert.equal(r.code, EXIT.OK, `${r.err}\n${r.screen}`);
  assert.match(r.screen, /services\[0\]\.picks\[0\]: services\[0\]\.picks\[0\]: role 'BAD'/);
  assert.equal(count(r.screen, 'Service account — role (e.g. deploy): '), 2);
  assert.equal(count(r.screen, 'What is the service called?'), 1);
  assert.deepEqual(plan(dir).services, [{ purpose: 'shop', picks: [{ preset: 'sa', role: 'deploy' }] }]);
});

test('⑤ 같은 답 · 틀린 답 — 번호 밖 · 숫자 아님은 그 자리에서 다시 묻는다(서버에 보내지 않는다)', async () => {
  const dir = tmpDir();
  const s = server();
  const answers = ['', 'demo', 'payment', '9', 'prod,stg', 'nowhere', 'iowa', '', '1,1,9', '1', 'x', '0', '1', 'n'];
  const r = await term([], answers, { cwd: dir, fetchFn: s.fetchFn });
  assert.equal(r.code, EXIT.OK, `${r.err}\n${r.screen}`);
  assert.match(r.screen, /Who runs it\? \(team or organisation, e\.g\. platform\): \n {2}An answer is needed\.\n/);
  assert.match(r.screen, /\[1 prod · 2 stg · 3 dev\]: 9\n {2}Pick numbers from 1 to 3 or the values listed\.\n/);
  assert.match(r.screen, /No region matches "nowhere"\. Filter again: iowa\n/);
  assert.match(r.screen, /Pick one or more \(e\.g\. 1,2\): 1,1,9\n {2}Pick one or more numbers from 1 to 4/);
  assert.match(r.screen, /VPC network — how many\? \[1\]: x\n {2}A whole number from 1 to 99\.\nVPC network — how many\? \[1\]: 0\n {2}A whole number from 1 to 99\.\nVPC network — how many\? \[1\]: 1\n/);
  const p = plan(dir);
  assert.deepEqual(p.environments, ['prod', 'stg']);
  assert.equal(p.project.region, 'us-central1');
  // 환경이 둘이면 환경마다 보내고 표에 환경 제목
  assert.equal(s.calls.filter((c) => c.path === '/v1/wizard').length, 2);
  assert.match(r.screen, /# prod\nWhat/);
  assert.match(r.screen, /\n# stg\nWhat/);
  assert.match(r.screen, /4 names in 2 environments · all valid/);
});

test('계획만 지우고 다시 시작 — 남아 있던 옛 보관 파일은 새 이름으로 바뀐다(계획만 쓰고 멈추지 않는다)', async () => {
  const dir = tmpDir();
  writeFileSync(join(dir, 'cloudonym.plan.names.json'), '{"environments": {"prod": {"names": [{"key": "old", "name": "old-name"}]}}}');
  const r = await term([], ANSWERS, { cwd: dir, fetchFn: server().fetchFn });
  assert.equal(r.code, EXIT.OK, `${r.err}\n${r.screen}`);
  const names = JSON.parse(readFileSync(join(dir, 'cloudonym.plan.names.json'), 'utf-8'));
  assert.equal(names.environments.prod.names.some((/** @type {any} */ n) => n.key === 'old'), false);
  assert.equal(names.environments.prod.names.length, 7);
});

test('⑤ 입력이 끝나면(Ctrl-D) 멈추지 않고 64 · 아무것도 쓰지 않는다', async () => {
  const dir = tmpDir();
  const r = await term([], ['demo', 'payment'], { cwd: dir, fetchFn: server().fetchFn });
  assert.equal(r.code, EXIT.USAGE);
  assert.match(r.err, /No answer \(the input closed\): nothing was written\./);
  assert.equal(existsSync(join(dir, 'cloudonym.plan.json')), false);
  assert.equal(existsSync(join(dir, 'cloudonym.plan.names.json')), false);
});

test('③ 터미널이 아니면 묻지 않는다 — 인자 없음은 USAGE 와 64 · new 는 init 을 쓰라고 64 · --json 이면 터미널이어도 묻지 않는다', async () => {
  const dir = tmpDir();
  const s = server();
  const piped = await term([], ['demo'], { cwd: dir, fetchFn: s.fetchFn, tty: false });
  assert.equal(piped.code, EXIT.USAGE);
  assert.match(piped.screen, /^Usage: cloudonym \[command\]/);
  const n = await term(['new'], ['demo'], { cwd: dir, fetchFn: s.fetchFn, tty: false });
  assert.equal(n.code, EXIT.USAGE);
  assert.match(n.err, /new asks questions, so it needs a terminal .* cloudonym init --owner/);
  for (const argv of [['--json'], ['new', '--json'], ['add', '--json']]) {
    const j = await term(argv, ['demo'], { cwd: dir, fetchFn: s.fetchFn });
    assert.equal(j.code, EXIT.USAGE, argv.join(' '));
    assert.equal(j.screen.includes('Who runs it'), false, argv.join(' '));
    assert.equal(j.screen.includes('What are you building'), false, argv.join(' '));
  }
  assert.equal(s.calls.length, 0);
  assert.equal(existsSync(join(dir, 'cloudonym.plan.json')), false);
});

test('계획이 있으면 — 인자 없는 cloudonym 은 이름 표(--keys 면 키 칸) · new 는 덮지 않고 2', async () => {
  const dir = tmpDir();
  await term([], ANSWERS, { cwd: dir, fetchFn: server().fetchFn });
  const before = readFileSync(join(dir, 'cloudonym.plan.json'), 'utf-8');
  const s = server();
  const r = await term(['--keys'], [], { cwd: dir, fetchFn: s.fetchFn });
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.screen, /^What {2,}Name {2,}Check {2}Key\nProject ID {2,}demo-payment-prod {2,}PASS {2,}project\/-\/project_id\/-\/-\/-\n/);
  assert.match(r.screen, /\nAdd more: cloudonym add · Check before applying: cloudonym validate\n$/);
  assert.deepEqual(s.calls.map((c) => c.path), ['/catalog.json', '/v1/wizard']);
  const again = await term(['new'], ANSWERS, { cwd: dir, fetchFn: server().fetchFn });
  assert.equal(again.code, EXIT.INPUT);
  assert.match(again.err, /already exists\. Add to it with "cloudonym add", or pass --force/);
  assert.equal(readFileSync(join(dir, 'cloudonym.plan.json'), 'utf-8'), before);
});

test('인자 없는 add(터미널) — 있는 서비스를 골라 부품을 더하고, add 의 확인 길(기존 이름 불변)로 쓴다', async () => {
  const dir = tmpDir();
  await term([], ANSWERS, { cwd: dir, fetchFn: server().fetchFn });
  const s = server();
  // 메뉴: 1 VPC · 2 Web · 3 DB · 4 SA. 3(DB) 하나 더 → 같은 pick(POSTGRES) 이므로 슬롯을 덧붙인다
  const r = await term(['add'], ['3', '', '1', 'POSTGRES', 'n'], { cwd: dir, fetchFn: s.fetchFn });
  assert.equal(r.code, EXIT.OK, `${r.err}\n${r.screen}`);
  assert.match(r.screen, /Which service \[1 shop · 2 a new service\] \[shop\]: \n/);
  const db = plan(dir).services[0].picks[1];
  assert.deepEqual(db, { preset: 'db', kind: 'POSTGRES', instances: [{ id: '1', seq: '01' }, { id: '2', seq: '02' }] });
  // 출력은 새 이름 표뿐 · 저장 문장은 add 와 같다
  assert.match(r.screen, /What {2,}Name {2,}Check\nDatabase \(Cloud SQL\) 02 \(shop\) {2,}payment-shop-prod-cloud_sql_instance-02 {2,}PASS\n/);
  assert.match(r.err, /Added Database \(Cloud SQL\) to service shop in cloudonym\.plan\.json: 1 new name\(s\); existing names unchanged\./);
  // 미리 한 번 + add 의 확인(전 · 후)
  assert.deepEqual(s.calls.map((c) => c.path), ['/catalog.json', '/v1/wizard', '/v1/wizard', '/v1/wizard']);
});

test('--from 에 공유 링크를 주면 64 — 브라우저의 Save plan 뒤 new --from <파일> 을 안내한다 (설계 §9 ⑤(c))', async () => {
  const dir = tmpDir();
  for (const argv of [['init', '--from', 'https://example.org/#p=abc'], ['new', '--from', 'https://example.org/#p=abc']]) {
    const r = await term(argv, [], { cwd: dir, fetchFn: server().fetchFn, tty: false });
    assert.equal(r.code, EXIT.USAGE, argv.join(' '));
    assert.match(r.err, /^--from takes a plan file, not a share link \(links are not read yet\)\. Open the link in the browser, press Save plan, then run: cloudonym new --from <the saved file>/);
  }
  // new --from <파일> 은 init --from 과 같다
  const src = join(dir, 'saved.json');
  writeFileSync(src, JSON.stringify({ provider: 'gcp', project: { owner: 'o', system: 's', env: 'prod', region: 'r' }, project_picks: [], services: [], rules_version: 'v1' }));
  const r = await term(['new', '--from', src], [], { cwd: dir, fetchFn: server().fetchFn, tty: false });
  assert.equal(r.code, EXIT.OK, r.err);
  assert.equal(plan(dir).project.owner, 'o');
});
