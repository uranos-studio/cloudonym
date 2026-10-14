// @ts-check
// cli/ 경계 (D102) — CLI 는 엔진을 들이지 않는다. import 지정자는 node: 내장이거나 cli/ 안을 가리키는 상대 경로뿐이다(src/ · npm 패키지 거부).
// 검사식은 src/core/boundary.test.ts · src/plan/boundary.test.ts 와 같다 — from '...' · 부수효과 import · 동적 import · require
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, dirname, sep } from 'node:path';

const CLI = import.meta.dirname;
const STATIC_RE = /(?:import|export)(?:[^'"]*from)?\s+['"]([^'"]+)['"]/g;
const CALL_RE = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]/g;

/** @param {string} src */
export function specifiers(src) {
  /** @type {string[]} */
  const out = [];
  for (const re of [STATIC_RE, CALL_RE]) for (const m of src.matchAll(re)) out.push(m[1] ?? '');
  return out;
}

/** node: 내장 · 또는 file 자리에서 풀어 cli/ 안에 머무는 상대 경로 @param {string} spec @param {string} file cli/ 안의 절대 경로 */
export function allowed(spec, file) {
  if (spec.startsWith('node:')) return true;
  if (!spec.startsWith('./') && !spec.startsWith('../')) return false;
  const rel = relative(CLI, resolve(dirname(file), spec));
  return rel !== '' && !rel.startsWith('..') && !rel.split(sep).includes('..');
}

/** @param {string} d @returns {string[]} */
function walk(d) {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : /\.(mjs|d\.mts)$/.test(e.name) ? [join(d, e.name)] : []));
}

test('검사기 자체 — 우회 꼴을 잡고 node: · cli 안은 통과시킨다', () => {
  const probe = "import { a } from './lib/plan.mjs';\nimport { e } from '../src/core/engine';\nexport * from '../src/api/schemas';\nconst m = await import('../src/plan/wire');\nimport 'hono';\nimport fs from 'fs';\nconst z = require('./../src/core/types');\nimport { x } from 'node:fs';";
  const specs = specifiers(probe);
  assert.deepEqual(specs, ['./lib/plan.mjs', '../src/core/engine', '../src/api/schemas', 'hono', 'fs', 'node:fs', '../src/plan/wire', './../src/core/types']);
  const file = join(CLI, 'cloudonym.mjs');
  assert.deepEqual(specs.filter((s) => !allowed(s, file)), ['../src/core/engine', '../src/api/schemas', 'hono', 'fs', '../src/plan/wire', './../src/core/types']);
  // 하위 폴더 — cli 안으로만 올라갈 수 있다
  assert.equal(allowed('../http.mjs', join(CLI, 'lib', 'sub', 'x.mjs')), true);
  assert.equal(allowed('../../../src/x', join(CLI, 'lib', 'sub', 'x.mjs')), false);
});

test('cli/ 의 모든 .mjs · .d.mts 는 node: 와 cli/ 안만 들여온다 (검사식 견본을 담은 이 파일만 빼고)', () => {
  const files = walk(CLI).filter((f) => f !== import.meta.filename);
  assert.ok(files.length >= 5, `files: ${files.length}`);
  for (const f of files) {
    const bad = specifiers(readFileSync(f, 'utf-8')).filter((s) => !allowed(s, f));
    assert.deepEqual(bad, [], relative(CLI, f));
  }
});

test('시각은 KST — cli/ 에 toISOString 이 없다', () => {
  for (const f of walk(CLI).filter((x) => !x.endsWith('.test.mjs'))) assert.equal(/toISOString\s*\(/.test(readFileSync(f, 'utf-8')), false, relative(CLI, f));
});
