// check-sources.mjs 시험 — 검사기를 먼저 시험한다: 같으면 0, 한 글자만 달라도 1.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildLock, AWS_NAMESPACES, awsDigest, kstNow } from './check-sources.mjs';

/** 시험이 만든 임시 폴더 — 끝나면 지운다(시스템 임시 폴더에 남기지 않는다) @type {string[]} */
const madeDirs = [];
/** @param {string} prefix */
const tmpDir = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); madeDirs.push(d); return d; };
after(() => { for (const d of madeDirs) rmSync(d, { recursive: true, force: true }); });

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'check-sources.mjs');
const fx = (p) => join(here, 'fixtures', p);

function inputs(dir) {
  return {
    azure: join(dir, 'azure.md'),
    azureHtml: fx('azure-sample.html'),
    gcp: join(dir, 'gcp.json'),
    gcpKms: join(dir, 'kms.json'),
    aws: join(dir, 'aws'),
  };
}

function setup() {
  const dir = tmpDir('check-sources-');
  cpSync(fx('azure-sample.md'), join(dir, 'azure.md'));
  cpSync(fx('gcp-sample.json'), join(dir, 'gcp.json'));
  cpSync(fx('kms-sample.json'), join(dir, 'kms.json'));
  cpSync(fx('aws'), join(dir, 'aws'), { recursive: true });
  const lock = join(dir, 'lock.json');
  const w = run(dir, lock, ['--write', '--azure-commit', 'abc123']);
  assert.equal(w.status, 0, w.stderr);
  return { dir, lock };
}

function run(dir, lock, extra = []) {
  const i = inputs(dir);
  return spawnSync(process.execPath, [script, '--lock', lock, '--azure', i.azure, '--azure-html', i.azureHtml, '--gcp', i.gcp, '--gcp-kms', i.gcpKms, '--aws', i.aws, ...extra], { encoding: 'utf-8' });
}

test('AWS 는 파일 이름이 아니라 typeName 으로 18개 네임스페이스를 고른다', () => {
  assert.equal(AWS_NAMESPACES.length, 18);
  const d = awsDigest(fx('aws'));
  assert.equal(d.counts.types, 2);
  assert.match(d.sha256, /^[0-9a-f]{64}$/);
});

test('fetchedAt 은 KST 오프셋이다', () => {
  assert.match(kstNow(), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+09:00$/);
});

test('--write 로 만든 lock 과 같은 입력이면 exit 0', () => {
  const { dir, lock } = setup();
  const j = JSON.parse(readFileSync(lock, 'utf-8'));
  assert.equal(j.sources.azure.commit, 'abc123');
  assert.equal(j.sources.azure.marker.msDate, '01/02/2026');
  assert.equal(j.sources.gcp.marker.revision, '20260101');
  assert.equal(j.sources.azure.counts.rows, 7);
  assert.equal(j.sources.azure.counts.anchorsMissing, 1);
  const p = run(dir, lock);
  assert.equal(p.status, 0, p.stdout + p.stderr);
});

for (const src of ['azure', 'gcp', 'gcpKms', 'aws']) {
  test(`lock 의 ${src} 해시 한 글자를 바꾸면 exit 1`, () => {
    const { dir, lock } = setup();
    const j = JSON.parse(readFileSync(lock, 'utf-8'));
    const h = j.sources[src].sha256;
    j.sources[src].sha256 = (h[0] === '0' ? '1' : '0') + h.slice(1);
    writeFileSync(lock, JSON.stringify(j, null, 2));
    const p = run(dir, lock);
    assert.equal(p.status, 1);
    assert.match(p.stderr, new RegExp(src));
  });
}

test('원문 행 하나를 고치면 exit 1', () => {
  const { dir, lock } = setup();
  const md = readFileSync(join(dir, 'azure.md'), 'utf-8');
  writeFileSync(join(dir, 'azure.md'), md.replace('| servers | global | 3-63 |', '| servers | global | 3-64 |'));
  assert.equal(run(dir, lock).status, 1);
});

test('lock 의 수가 다르면 exit 1', () => {
  const { dir, lock } = setup();
  const j = JSON.parse(readFileSync(lock, 'utf-8'));
  j.sources.gcp.counts.formal += 1;
  writeFileSync(lock, JSON.stringify(j, null, 2));
  const p = run(dir, lock);
  assert.equal(p.status, 1);
  assert.match(p.stderr, /gcp/);
});

test('표 밖 문장 · revision 만 바뀌면 통과하고 알림만 낸다', () => {
  const { dir, lock } = setup();
  const md = readFileSync(join(dir, 'azure.md'), 'utf-8');
  writeFileSync(join(dir, 'azure.md'), md.replace('- nothing here', '- changed prose').replace('ms.date: 01/02/2026', 'ms.date: 02/02/2026'));
  const g = JSON.parse(readFileSync(join(dir, 'gcp.json'), 'utf-8'));
  g.revision = '20260202';
  writeFileSync(join(dir, 'gcp.json'), JSON.stringify(g));
  const p = run(dir, lock, ['--azure-commit', 'def456']);
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /20260202/);
  assert.match(p.stdout, /def456/);
});

test('입력이 빠지면 exit 2 — --azure-html 도 필수다', () => {
  const p = spawnSync(process.execPath, [script, '--lock', 'x.json'], { encoding: 'utf-8' });
  assert.equal(p.status, 2);
  const { dir, lock } = setup();
  const i = inputs(dir);
  const q = spawnSync(process.execPath, [script, '--lock', lock, '--azure', i.azure, '--gcp', i.gcp, '--gcp-kms', i.gcpKms, '--aws', i.aws], { encoding: 'utf-8' });
  assert.equal(q.status, 2);
  const r = spawnSync(process.execPath, [script, '--lock', lock, '--azure', i.azure, '--azure-html', i.azureHtml, '--gcp', i.gcp, '--aws', i.aws], { encoding: 'utf-8' });
  assert.equal(r.status, 2, '--gcp-kms 도 필수다');
});

test('buildLock 은 네 출처를 모두 담는다', () => {
  const dir = tmpDir('check-sources-b-');
  cpSync(fx('azure-sample.md'), join(dir, 'azure.md'));
  cpSync(fx('gcp-sample.json'), join(dir, 'gcp.json'));
  cpSync(fx('kms-sample.json'), join(dir, 'kms.json'));
  cpSync(fx('aws'), join(dir, 'aws'), { recursive: true });
  const l = buildLock(inputs(dir), { azureCommit: null });
  assert.deepEqual(Object.keys(l.sources), ['azure', 'gcp', 'gcpKms', 'aws']);
  assert.equal(l.sources.aws.marker, null);
});
