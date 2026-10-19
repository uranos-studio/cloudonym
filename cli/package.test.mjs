// @ts-check
// 공개 단위 (D121 · 설계 §3) — npm 에 낼 수 있는 꾸러미는 cli/ 하나다. 뿌리 package.json 은 웹 · Worker 의 것이라 private 그대로 둔다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { CLI_VERSION, USER_AGENT } from './lib/http.mjs';

const read = (/** @type {string} */ rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf-8'));
const cli = read('./package.json');
const root = read('../package.json');

test('⑦ cli/package.json 의 version 은 뿌리 package.json 과 같다 — User-Agent 도 그 값', () => {
  assert.equal(cli.version, root.version);
  assert.equal(CLI_VERSION, cli.version);
  assert.equal(USER_AGENT, `cloudonym-cli/${root.version}`);
});

test('⑦ 꾸러미 꼴 — 이름 cloudonym · bin 하나 · 의존성 0 · 시험 파일은 싣지 않는다 · Node 는 .nvmrc 와 같은 주 버전부터', () => {
  assert.equal(cli.name, 'cloudonym');
  assert.equal(cli.private, undefined);
  assert.equal(cli.type, 'module');
  assert.deepEqual(cli.bin, { cloudonym: 'cloudonym.mjs' });
  assert.match(readFileSync(new URL('./cloudonym.mjs', import.meta.url), 'utf-8'), /^#!\/usr\/bin\/env node\n/);
  assert.equal(cli.dependencies, undefined);
  assert.equal(cli.devDependencies, undefined);
  assert.deepEqual(cli.files, ['cloudonym.mjs', 'lib/', 'NOTICE']);
  for (const f of cli.files) assert.equal(/test/.test(f), false, f);
  assert.equal(cli.license, root.license);
  const nvmrc = readFileSync(new URL('../.nvmrc', import.meta.url), 'utf-8').trim();
  assert.equal(cli.engines.node, `>=${nvmrc.replace(/^v/, '').split('.')[0]}`);
  // LICENSE · NOTICE 는 꾸러미를 만들 때만 뿌리에서 복사하고 끝나면 지운다 — 저장소에는 뿌리의 한 벌뿐
  assert.ok(existsSync(new URL('../LICENSE', import.meta.url)));
  assert.ok(existsSync(new URL('../NOTICE', import.meta.url)));
  assert.match(cli.scripts.prepack, /copyFileSync\('\.\.\/' \+ f, f\)/);
  assert.match(cli.scripts.postpack, /rmSync\(f/);
  // 뿌리는 웹 · Worker 꾸러미 — 공개하지 않는다. 저장소에서 npm link · npm run cli 는 그대로 된다
  assert.equal(root.private, true);
  assert.deepEqual(root.bin, { cloudonym: 'cli/cloudonym.mjs' });
});
