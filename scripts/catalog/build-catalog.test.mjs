// build-catalog.mjs 시험 — 생성 결과가 작업 트리의 생성 파일과 바이트까지 같고(D46 ⑵), 스키마를 어긴 입력은 생성을 멈춘다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadCatalog, renderGcpCatalog, renderRegions, validateCatalog } from './build-catalog.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf-8');

test('생성 파일이 catalog/*.json 에서 다시 만든 것과 같다', () => {
  const { gcp, regions } = loadCatalog(root);
  assert.equal(renderGcpCatalog(gcp), read('src/core/rules/gcp-catalog.ts'));
  assert.equal(renderRegions(regions), read('src/core/regions-data.ts'));
});

test('생성 파일 머리에 「손으로 고치지 않는다」가 있다', () => {
  for (const f of ['src/core/rules/gcp-catalog.ts', 'src/core/regions-data.ts']) assert.match(read(f).split('\n')[0], /생성 파일 — 손으로 고치지 않는다/);
});

test('스키마를 어긴 catalog 는 생성을 멈춘다', () => {
  const { gcp, regions, kindSources, schema } = loadCatalog(root);
  assert.doesNotThrow(() => validateCatalog({ gcp, regions, kindSources, schema }));
  const broken = structuredClone(gcp);
  broken.rows[0].badges = ['beta'];
  assert.throws(() => validateCatalog({ gcp: broken, regions, kindSources, schema }), /schema/);
  const badRegions = structuredClone(regions);
  badRegions.gcp[0].code = 'TOO-LONG';
  assert.throws(() => validateCatalog({ gcp, regions: badRegions, kindSources, schema }), /schema/);
});

test('문자열 값은 JSON 리터럴로만 들어가 코드로 새지 않는다', () => {
  const { gcp } = loadCatalog(root);
  const evil = structuredClone(gcp);
  evil.rows[0].info = "x'; throw 1; //\u2028y";
  const out = renderGcpCatalog(evil);
  assert.ok(out.includes(JSON.stringify("x'; throw 1; //\u2028y").replace(/\u2028/g, '\\u2028')));
  assert.ok(!out.includes('\u2028'));
});
