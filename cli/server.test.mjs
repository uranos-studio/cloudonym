// @ts-check
// 서버 고르기 (D121) — 순위 넷(--server > CLOUDONYM_SERVER > 설정 파일 > DEFAULT_SERVER) · 설정 파일이 깨지면 경고 뒤 기본값 · 운영 URL 은 저장소에 한 곳뿐
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { serverOf, configPathOf, readConfigServer, DEFAULT_SERVER } from './lib/server.mjs';
import { main, EXIT } from './lib/main.mjs';

/** @type {string[]} */
const made = [];
const tmpDir = () => { const d = mkdtempSync(join(tmpdir(), 'cloudonym-cli-server-')); made.push(d); return d; };
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

/** @param {unknown} doc */
function configFile(doc) {
  const p = join(tmpDir(), 'config.json');
  writeFileSync(p, typeof doc === 'string' ? doc : JSON.stringify(doc));
  return p;
}

test('① 순위 — --server > CLOUDONYM_SERVER > 설정 파일 > 기본값', () => {
  const cfg = configFile({ server: 'https://self.example/' });
  const env = { CLOUDONYM_SERVER: 'http://env.example' };
  assert.deepEqual(serverOf('http://flag.example', env, { configPath: cfg }), { server: 'http://flag.example', source: '--server', warnings: [] });
  assert.deepEqual(serverOf(undefined, env, { configPath: cfg }), { server: 'http://env.example', source: 'CLOUDONYM_SERVER', warnings: [] });
  assert.deepEqual(serverOf(undefined, {}, { configPath: cfg }), { server: 'https://self.example', source: `config ${cfg}`, warnings: [] });
  assert.deepEqual(serverOf(undefined, {}, { configPath: null }), { server: DEFAULT_SERVER, source: 'default', warnings: [] });
  // 빈 환경변수는 없는 것 — CI 가 빈 값을 넘겨도 다음 순위로 간다
  assert.equal(/** @type {any} */ (serverOf(undefined, { CLOUDONYM_SERVER: '' }, { configPath: cfg })).server, 'https://self.example');
  // 설정 파일이 없으면 조용히 기본값
  assert.deepEqual(serverOf(undefined, {}, { configPath: join(tmpDir(), 'missing.json') }), { server: DEFAULT_SERVER, source: 'default', warnings: [] });
});

test('① 설정 파일이 깨지면 경고 한 줄 뒤 기본값 · server 가 쓸 수 없는 URL 이면 오류(공개 배포로 조용히 가지 않는다)', () => {
  for (const bad of ['{ not json', '[1]', '"x"', '{"server": 3}', '{"server": ""}']) {
    const r = serverOf(undefined, {}, { configPath: configFile(bad) });
    assert.ok('server' in r, bad);
    assert.equal(r.server, DEFAULT_SERVER, bad);
    assert.equal(r.warnings.length, 1, bad);
    assert.match(r.warnings[0] ?? '', /Ignoring .*Using the default server\./, bad);
  }
  assert.deepEqual(readConfigServer(configFile({ other: 1 })), {});
  const secret = serverOf(undefined, {}, { configPath: configFile({ server: 'http://u:SECRET@h/' }) });
  assert.ok('error' in secret);
  assert.equal(secret.error.includes('SECRET'), false);
  assert.ok('error' in serverOf(undefined, { CLOUDONYM_SERVER: 'ftp://h/' }));
  assert.ok('error' in serverOf('', {}));
});

test('① 설정 파일 자리 — XDG_CONFIG_HOME > HOME/.config · 윈도우는 APPDATA · 홈이 없으면 null', () => {
  assert.equal(configPathOf({ XDG_CONFIG_HOME: '/x', HOME: '/h' }, 'linux'), join('/x', 'cloudonym', 'config.json'));
  assert.equal(configPathOf({ HOME: '/h' }, 'darwin'), join('/h', '.config', 'cloudonym', 'config.json'));
  assert.equal(configPathOf({ APPDATA: 'C:\\A', HOME: '/h' }, 'win32'), join('C:\\A', 'cloudonym', 'config.json'));
  assert.equal(configPathOf({}, 'linux'), null);
  assert.equal(configPathOf({ HOME: '/h' }, 'win32'), null);
});

/** @param {string[]} argv @param {Partial<import('./lib/main.mjs').Deps>} deps */
async function run(argv, deps) {
  /** @type {string[]} */ const out = [];
  /** @type {string[]} */ const err = [];
  const code = await main(argv, { stdout: (s) => { out.push(s); }, stderr: (s) => { err.push(s); }, ...deps });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('① main — 설정 없이 기본 서버를 부른다 · --version 은 stdout 한 줄 그대로, 서버와 출처는 stderr', async () => {
  const dir = tmpDir();
  writeFileSync(join(dir, 'cloudonym.plan.json'), JSON.stringify({ provider: 'gcp', project: { owner: 'o', system: 's', env: 'prod', region: 'r' } }));
  /** @type {string[]} */ const urls = [];
  /** @type {import('./lib/http.mjs').FetchFn} */
  const fetchFn = async (url) => { urls.push(url); return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ success: true, data: { gcp: { valid: true, items: [{ key: 'k', name: 'n', valid: true }] } } }) }; };
  const r = await run(['validate'], { fetchFn, env: {}, cwd: dir, configPath: null });
  assert.equal(r.code, EXIT.OK, r.err);
  assert.deepEqual(urls, [`${DEFAULT_SERVER}/v1/wizard`]);

  const v = await run(['--version'], { env: {}, configPath: null });
  assert.equal(v.code, EXIT.OK);
  assert.match(v.out, /^cloudonym-cli\/\d+\.\d+\.\d+$/);
  assert.equal(v.err, `server ${DEFAULT_SERVER} (default)`);
  const cfg = configFile({ server: 'https://self.example' });
  assert.equal((await run(['--version'], { env: {}, configPath: cfg })).err, `server https://self.example (config ${cfg})`);
  assert.equal((await run(['--version', '--server', 'http://127.0.0.1:8787'], { env: {}, configPath: cfg })).err, 'server http://127.0.0.1:8787 (--server)');
  const broken = configFile('{ nope');
  const b = await run(['--version'], { env: {}, configPath: broken });
  assert.match(b.err, /Ignoring the config file .*not JSON\. Using the default server\.\nserver .* \(default\)$/);
  // 설정 파일의 서버로 실제 요청이 간다
  urls.length = 0;
  assert.equal((await run(['validate'], { fetchFn, env: {}, cwd: dir, configPath: cfg })).code, EXIT.OK);
  assert.deepEqual(urls, ['https://self.example/v1/wizard']);
  // 주지 않으면 env 의 HOME 으로 찾는다 — 실제 홈이 아니라 넣은 env 의 것
  const home = tmpDir();
  mkdirSync(join(home, '.config', 'cloudonym'), { recursive: true });
  writeFileSync(join(home, '.config', 'cloudonym', 'config.json'), JSON.stringify({ server: 'https://home.example' }));
  assert.match((await run(['--version'], { env: { HOME: home } })).err, /^server https:\/\/home\.example \(config /);
});

test('② 운영 URL 은 저장소(추적 파일 + 무시하지 않는 새 파일)에서 cli/lib/server.mjs 의 DEFAULT_SERVER 와 README 의 「Try it」 링크 두 곳뿐이다 (D121 · 2026-10-23 승인)', () => {
  const root = new URL('../', import.meta.url);
  const host = new URL(DEFAULT_SERVER).host;
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf-8' }).split('\0').filter((f) => f !== '');
  assert.ok(files.length > 100, `files: ${files.length}`);
  /** @type {string[]} */
  const hits = [];
  for (const f of files) {
    let text;
    try { text = readFileSync(new URL(f, root), 'utf-8'); } catch { continue; }
    const n = text.split(host).length - 1;
    for (let i = 0; i < n; i++) hits.push(f);
  }
  assert.deepEqual(hits.sort(), ['README.md', 'cli/lib/server.mjs']);
  // 검사기 자체 — 잡아야 할 것을 잡는다
  assert.equal(`x ${DEFAULT_SERVER} y`.split(host).length - 1, 1);
});
