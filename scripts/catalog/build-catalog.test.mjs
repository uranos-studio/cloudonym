// build-catalog.mjs 시험 — 생성 결과가 작업 트리의 생성 파일과 바이트까지 같고(D46 ⑵), 스키마를 어긴 입력은 생성을 멈춘다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { kindChecked, loadCatalog, renderAwsCatalog, renderGcpCatalog, renderRegions, validateCatalog } from './build-catalog.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf-8');

test('생성 파일이 catalog/*.json 에서 다시 만든 것과 같다', () => {
  const { gcp, regions, kindSources } = loadCatalog(root);
  assert.equal(renderGcpCatalog(gcp, kindSources), read('src/core/rules/gcp-catalog.ts'));
  assert.equal(renderRegions(regions), read('src/core/regions-data.ts'));
});

test('생성 파일 머리에 「손으로 고치지 않는다」가 있다', () => {
  for (const f of ['src/core/rules/gcp-catalog.ts', 'src/core/regions-data.ts']) assert.match(read(f).split('\n')[0], /생성 파일 — 손으로 고치지 않는다/);
});

test('스키마를 어긴 catalog 는 생성을 멈춘다', () => {
  const { gcp, aws, regions, kindSources, schema } = loadCatalog(root);
  assert.doesNotThrow(() => validateCatalog({ gcp, aws, regions, kindSources, schema }));
  const broken = structuredClone(gcp);
  broken.rows[0].badges = ['beta'];
  assert.throws(() => validateCatalog({ gcp: broken, aws, regions, kindSources, schema }), /schema/);
  const badRegions = structuredClone(regions);
  badRegions.gcp[0].code = 'TOO-LONG';
  assert.throws(() => validateCatalog({ gcp, aws, regions: badRegions, kindSources, schema }), /schema/);
});

test('문자열 값은 JSON 리터럴로만 들어가 코드로 새지 않는다', () => {
  const { gcp } = loadCatalog(root);
  const evil = structuredClone(gcp);
  evil.rows[0].info = "x'; throw 1; //\u2028y";
  const out = renderGcpCatalog(evil);
  assert.ok(out.includes(JSON.stringify("x'; throw 1; //\u2028y").replace(/\u2028/g, '\\u2028')));
  assert.ok(!out.includes('\u2028'));
});

test('종류 확인일 — 행마다 전사 checked 의 가장 늦은 날 · 종류 표가 있는 행만 · 전사의 날을 바꾸면 따라 바뀐다', () => {
  const { gcp, kindSources } = loadCatalog(root);
  const checked = kindChecked(gcp, kindSources);
  assert.deepEqual(Object.keys(checked).sort(), gcp.rows.filter((r) => r.kind).map((r) => r.key).sort());
  assert.equal(checked['gcp.backend_service'], '2026-10-08');
  assert.equal(checked['gcp.cloud_sql_instance'], '2026-10-07');
  const moved = structuredClone(kindSources);
  moved.rows['gcp.cloud_sql_instance'][1].checked = '2026-11-01';
  assert.equal(kindChecked(gcp, moved)['gcp.cloud_sql_instance'], '2026-11-01');
  const empty = structuredClone(kindSources);
  for (const e of empty.rows['gcp.snapshot']) e.checked = null;
  assert.equal(kindChecked(gcp, empty)['gcp.snapshot'], null);
});

test('aws.json — 스키마를 지키고, gcp 행의 요구(gcloud · gcp. 키)는 aws 를 받아도 느슨해지지 않는다', () => {
  const catalog = loadCatalog(root);
  const { gcp, aws } = catalog;
  assert.equal(aws.meta.provider, 'aws');
  assert.doesNotThrow(() => validateCatalog(catalog));
  // gcp.json 에 aws 키 · gcloud 없는 행이 들어오면 멈춘다
  const awsKeyInGcp = structuredClone(gcp);
  awsKeyInGcp.rows[0].key = 'aws.s3_bucket';
  assert.throws(() => validateCatalog({ ...catalog, gcp: awsKeyInGcp }), /gcp\.json 이 schema/);
  const noGcloud = structuredClone(gcp);
  delete noGcloud.rows[0].enterNameAt.gcloud;
  assert.throws(() => validateCatalog({ ...catalog, gcp: noGcloud }), /gcp\.json 이 schema/);
  // aws 행은 awsCli 를 요구하고 gcloud · gcp. 키를 받지 않는다
  const gcloudInAws = structuredClone(aws);
  gcloudInAws.rows[0].enterNameAt.gcloud = [];
  assert.throws(() => validateCatalog({ ...catalog, aws: gcloudInAws }), /aws\.json 이 schema/);
  const gcpKeyInAws = structuredClone(aws);
  gcpKeyInAws.rows[0].rules = { 'gcp.project_id': gcpKeyInAws.rows[0].rules[gcpKeyInAws.rows[0].key] };
  assert.throws(() => validateCatalog({ ...catalog, aws: gcpKeyInAws }), /aws\.json 이 schema/);
  // 파일이 서로 바뀌면 provider 로 잡는다
  assert.throws(() => validateCatalog({ ...catalog, gcp: aws }), /meta\.provider/);
});

test('aws.json — 행 key 가 겹치지 않고, 행마다 자기 key 의 규칙을 담는다', () => {
  const { aws } = loadCatalog(root);
  const keys = aws.rows.map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const row of aws.rows) assert.ok(Object.hasOwn(row.rules, row.key), row.key);
});

test('aws-catalog.ts 생성 — 같은 입력이면 같은 출력이고 행을 빠짐없이 싣는다', () => {
  const { aws } = loadCatalog(root);
  const out = renderAwsCatalog(aws);
  assert.equal(renderAwsCatalog(structuredClone(aws)), out);
  assert.match(out.split('\n')[0], /생성 파일 — 손으로 고치지 않는다/);
  assert.ok(out.includes(`export const AWS_CATALOG: readonly AwsCatalogRow[] = ${JSON.stringify(aws.rows, null, 2)};`));
});
