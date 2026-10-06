// intake-gcp-discovery.mjs 시험 — 고정 표본(fixtures/gcp-sample.json).
// 반례 둘(readOnly 인 LicenseCode.name · 참조값 pattern 인 FirewallPolicyRuleSecureTag.name)을
// 일부러 insert 요청 스키마에 묶어 둔다 — 실제 문서에서는 둘 다 insert 요청이 아니라서
// 「후보에 없다」만 보면 시험이 아무것도 재지 않고 통과한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseComputeDiscovery, RFC1035_PATTERN } from './intake-gcp-discovery.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(readFileSync(join(here, 'fixtures/gcp-sample.json'), 'utf-8'));

test('insert 메서드만 센다 — bulkInsert · get 은 아니다 · 하위 resources 도 본다', () => {
  const r = parseComputeDiscovery(doc);
  assert.equal(r.counts.insertMethods, 8);
  assert.ok(r.all.some((x) => x.method === 'compute.parents.children.insert'));
  assert.ok(!r.all.some((x) => x.method.endsWith('bulkInsert')));
});

test('RFC1035 pattern 인 것만 정형 후보 — 메서드마다 하나', () => {
  const r = parseComputeDiscovery(doc);
  assert.deepEqual(r.candidates.map((x) => x.method), ['compute.disks.insert', 'compute.parents.children.insert', 'compute.regionDisks.insert']);
  assert.equal(r.counts.formal, 3);
  const d = r.candidates[0];
  assert.equal(d.schema, 'Disk');
  assert.equal(d.pattern, RFC1035_PATTERN);
  assert.deepEqual(d.length, { min: 1, max: 63 });
  assert.equal(d.docUrl, 'https://docs.cloud.google.com/compute/docs/reference/rest/v1/disks#Disk.FIELDS.name');
});

test('readOnly 인 name(LicenseCode)은 후보에도 손 확인에도 없다', () => {
  const r = parseComputeDiscovery(doc);
  assert.ok(!r.candidates.some((x) => x.schema === 'LicenseCode'));
  assert.ok(!r.manual.some((x) => x.schema === 'LicenseCode'));
  assert.deepEqual(r.excluded.find((x) => x.schema === 'LicenseCode').reason, 'readOnly');
});

test('RFC1035 가 아닌 pattern(FirewallPolicyRuleSecureTag)은 후보가 아니라 손 확인', () => {
  const r = parseComputeDiscovery(doc);
  assert.ok(!r.candidates.some((x) => x.schema === 'FirewallPolicyRuleSecureTag'));
  assert.equal(r.manual.find((x) => x.schema === 'FirewallPolicyRuleSecureTag').reason, 'non-rfc1035-pattern');
});

test('pattern 이 없거나 깨진 것은 손 확인 · name 이 없으면 제외', () => {
  const r = parseComputeDiscovery(doc);
  assert.equal(r.manual.find((x) => x.schema === 'NodeGroup').reason, 'no-pattern');
  assert.equal(r.manual.find((x) => x.schema === 'Broken').reason, 'broken-pattern');
  assert.equal(r.excluded.find((x) => x.schema === 'NoName').reason, 'no-name');
  assert.deepEqual(r.counts, { insertMethods: 8, formal: 3, manual: 3, excluded: 2, uniqueSchemas: 7, uniqueFormalSchemas: 2 });
});

test('CLI — 후보 JSON 을 쓴다', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'intake-gcp-')), 'gcp.json');
  const p = spawnSync(process.execPath, [join(here, 'intake-gcp-discovery.mjs'), join(here, 'fixtures/gcp-sample.json'), '--out', out], { encoding: 'utf-8' });
  assert.equal(p.status, 0, p.stderr);
  const j = JSON.parse(readFileSync(out, 'utf-8'));
  assert.equal(j.revision, '20260101');
  assert.equal(j.candidates.length, 3);
});
