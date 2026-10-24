// build-gcp-rules.mjs 시험 — 설명 안 정규식 문법 · 범위 · 고정 표본(fixtures/gcp-sample.json)으로 행 판정.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { regexInDescription, uniquenessScopeOf, scopeOfPath, slugOf, build, BROKEN_SOURCES, RFC1035_CASES, KMS_CASES, HAND_REVIEWED, ASSET_TYPES_WITHOUT_RULE, renderAssetTypes } from './build-gcp-rules.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const compute = JSON.parse(readFileSync(join(here, 'fixtures/gcp-sample.json'), 'utf-8'));

test('설명 안 정규식 — 백틱 안 · 클래스로 시작 · 대괄호 짝 · 컴파일, 넷 다일 때만', () => {
  assert.deepEqual(regexInDescription('It must be unique within a location and match the regular expression `[a-zA-Z0-9_-]{1,63}`'), { ok: true, raw: '[a-zA-Z0-9_-]{1,63}' });
  // 조사가 찾은 깨진 원문 — spanner 는 컴파일은 되지만 대괄호가 빠졌다 · iam v3 은 백틱이 없다
  assert.equal(regexInDescription('The database ID must conform to the regular expression `a-z*[a-z0-9]` and be between 2 and 30').ok, false);
  assert.equal(regexInDescription('followed by up to 62 lowercase letters, numbers, hyphens, or dots. Pattern, /a-z{2,62}/.').ok, false);
  assert.equal(regexInDescription('match the regular expression `[a-z]]x`').ok, false);
  assert.equal(regexInDescription('valid characters are /a-z-/').ok, false);
  for (const [, , text] of BROKEN_SOURCES) assert.equal(regexInDescription(text).ok, false, text);
});

test('유일 범위 문장 → 범위 · insert.path → 범위', () => {
  assert.equal(uniquenessScopeOf('It must be unique within a location and match'), 'gcp:project_location');
  assert.equal(uniquenessScopeOf('It must be unique within a KeyRing and match'), 'gcp:kms_key_ring');
  assert.equal(uniquenessScopeOf('Must be unique to the resource project and location.'), null);
  assert.equal(scopeOfPath('projects/{project}/global/images'), 'gcp:project_global');
  assert.equal(scopeOfPath('projects/{project}/regions/{region}/disks'), 'gcp:project_region');
  assert.equal(scopeOfPath('projects/{project}/zones/{zone}/disks'), 'gcp:project_zone');
  assert.equal(scopeOfPath('projects/{project}/zones/{zone}/instanceGroupManagers/{instanceGroupManager}/resizeRequests'), null);
  assert.equal(scopeOfPath('locations/global/securityPolicies'), null);
});

test('약어 — 낱말 둘 이상이면 머리글자 · 하나면 앞 세 글자', () => {
  assert.equal(slugOf('TargetHttpsProxy'), 'thp');
  assert.equal(slugOf('Router'), 'rou');
});

test('통과 · 실패 예는 문장 꼴이다 — 길이 경계를 넣는다', () => {
  assert.ok(RFC1035_CASES.valid.some((v) => v.length === 63));
  assert.ok(RFC1035_CASES.invalid.some((v) => v.length === 64));
  assert.ok(KMS_CASES.invalid.some((v) => v.length === 64));
});

const kms = {
  revision: 'test',
  resources: {
    projects: { resources: { locations: { resources: {
      keyRings: {
        methods: { create: { id: 'cloudkms.projects.locations.keyRings.create', flatPath: 'v1/projects/{projectsId}/locations/{locationsId}/keyRings', parameters: { parent: { location: 'path' }, keyRingId: { location: 'query', description: 'Required. It must be unique within a location and match the regular expression `[a-zA-Z0-9_-]{1,63}`' } } } },
        resources: { cryptoKeys: { methods: { create: { id: 'cloudkms.projects.locations.keyRings.cryptoKeys.create', flatPath: 'v1/x', parameters: { cryptoKeyId: { location: 'query', description: 'Required. It must be unique within a KeyRing and match the regular expression `a-z*[a-z0-9]`' } } } } } },
      },
      keyHandles: { methods: { create: { id: 'cloudkms.projects.locations.keyHandles.create', flatPath: 'v1/y', parameters: { keyHandleId: { location: 'query', description: 'Optional. Id of the KeyHandle.' } } } } },
    } } } },
  },
};

test('표본 — 기존 entity 는 건너뛰고 · 깨진 정규식 · 조사 밖 · 앵커 없음은 보류', () => {
  const anchors = { 'compute.regionDisks.insert': 'https://example.test/regionDisks#Disk.FIELDS.name' };
  const r = build({ compute, kms, anchors, existing: ['compute.disks'] });
  assert.deepEqual(r.rules.map((x) => x.id), ['gcp.region_disk', 'gcp.kms_key_ring']);
  const rd = r.rules[0];
  assert.equal(rd.scope, 'gcp:project_region');
  assert.equal(rd.displayName, 'Disk (regional)');
  const reasons = Object.fromEntries(r.held.map((h) => [h.row.method, h.reason]));
  assert.match(reasons['compute.parents.children.insert'], /anchorMissing|parent/);
  assert.match(reasons['cloudkms.projects.locations.keyRings.cryptoKeys.create'], /brackets look lost/);
  assert.match(reasons['cloudkms.projects.locations.keyHandles.create'], /^reviewed by hand — not imported \(/);
  assert.equal(r.rules[1].scope, 'gcp:project_location');
  assert.deepEqual([r.rules[1].min, r.rules[1].max], [1, 63]);
  assert.equal(r.scopes.find((s) => s.id === 'gcp:kms_key_ring').ruleId, 'gcp.kms_key_ring');
  // 원문 행 = 규칙 + 보류 + 기존
  const existingCount = r.sourceRows.filter((x) => x.existing).length;
  assert.equal(r.sourceRows.length, r.rules.length + r.held.length + existingCount);
});

test('손으로 다시 읽은 행 — 사유는 넣지 않음 · 미확인 둘 중 하나와 괄호 안 이유', () => {
  for (const [m, why] of Object.entries(HAND_REVIEWED)) assert.match(why, /^reviewed by hand — (not imported|unconfirmed) \(.+\)$/, m);
});

test('규칙이 없는 자산 유형 표 — 문서 끝에 생성기 출력 그대로 있고, 행마다 종류 · 사유 · 확인한 URL 이 있다', () => {
  const doc = readFileSync(join(here, '../../docs/gcp-intake-held.md'), 'utf-8');
  assert.ok(doc.endsWith(renderAssetTypes()), 'docs/gcp-intake-held.md 끝 절이 renderAssetTypes() 와 다르다 — 생성기로 다시 만든다');
  const kinds = { held: 0, 'no name': 0, 'external value': 0 };
  for (const r of ASSET_TYPES_WITHOUT_RULE) {
    assert.match(r.type, /^[a-z]+\.googleapis\.com\/[A-Za-z0-9]+$/);
    assert.ok(r.kind in kinds, r.kind);
    kinds[r.kind]++;
    assert.ok(r.reason.length > 20, r.type);
    assert.match(r.checked, /^https:\/\//, r.type);
    if (r.kind === 'held') assert.ok(r.confirm && r.confirm.length > 10, `${r.type} — 무엇을 열면 확정되나`);
  }
  assert.deepEqual(kinds, { held: 4, 'no name': 13, 'external value': 5 });
  assert.equal(new Set(ASSET_TYPES_WITHOUT_RULE.map((r) => r.type)).size, ASSET_TYPES_WITHOUT_RULE.length);
});
