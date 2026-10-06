// build-azure-rules.mjs 시험 — 원문 문장 → 정규식 · 통과/실패 예 · 이름 · 범위 판정.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCharacters, patternOf, casesOf, generationOf, resourceTypeOf, scopeKind, fallbackSlug, HAND_REVIEWED } from './build-azure-rules.mjs';

const re = (raw) => new RegExp(patternOf(parseCharacters(raw)), 'u');

test('나열형 + 시작 · 끝 문장 — 정규식이 원문 문장대로 받고 거부한다', () => {
  const r = re('Alphanumerics, underscores, periods, and hyphens<br><br>Start with alphanumeric. End with alphanumeric or underscore.');
  for (const ok of ['a', 'a.b-c_', 'A_', '9']) assert.ok(r.test(ok), ok);
  for (const bad of ['_a', '.a', 'a.', 'a-', 'a b', 'a!b']) assert.ok(!r.test(bad), bad);
});

test('금지형 — 목록 글자 · 제어 문자 · 끝 공백을 거부하고 나머지(유니코드 포함)는 받는다', () => {
  const r = re("Can't use:<br>`<>*%&:\\?.+/` or control characters <br><br>Can't end with space.");
  for (const ok of ['a b', 'a-b_c', 'é']) assert.ok(r.test(ok), ok);
  for (const bad of ['a<b', 'a.b', 'a/b', 'a\\b', 'a\u0001', 'a ']) assert.ok(!r.test(bad), JSON.stringify(bad));
});

test('연속 하이픈 · 하이픈으로 시작 · 끝 금지', () => {
  const r = re("Lowercase letters, numbers, and hyphens<br><br>Can't start or end with hyphen. Consecutive hyphens aren't allowed.");
  assert.ok(r.test('a-b-1'));
  for (const bad of ['-a', 'a-', 'a--b', 'A']) assert.ok(!r.test(bad), bad);
});

test('문법 밖 문장은 멈춘다 — 추측해서 넓히지 않는다', () => {
  assert.throws(() => parseCharacters('Alphanumerics<br><br>Must be unique within the subscription.'), /문장을 모른다/);
  assert.throws(() => parseCharacters('Emoji and hyphens'), /모른다/);
});

test('생성한 예 — 통과 예는 정규식을 통과하고 실패 예는 정규식 · 길이 중 하나에 걸린다', () => {
  for (const [raw, min, max] of [
    ['Alphanumerics and hyphens<br><br>Start with a letter and end with alphanumeric.', 1, 63],
    ['Lowercase letters and numbers', 3, 24],
    ["Can't use:<br>`<>*#.%&:\\\\+?/-` or control characters<br><br>Start with alphanumeric.", 1, 260],
  ]) {
    const spec = parseCharacters(raw);
    const r = new RegExp(patternOf(spec), 'u');
    const c = casesOf(spec, min, max);
    for (const v of c.valid) assert.ok(r.test(v) && v.length >= min && v.length <= max, `${raw} valid ${v}`);
    for (const v of c.invalid) assert.ok(!r.test(v) || v.length < min || v.length > max, `${raw} invalid ${v}`);
    assert.ok(c.invalid.some((v) => v.length === max + 1), 'max+1 예가 있다');
  }
});

test('생성 문자 집합은 허용 집합 안이다 — 하이픈이 없으면 구분자 없이 소문자', () => {
  assert.deepEqual(generationOf(parseCharacters('Alphanumerics and underscores<br><br>Start with a letter.')).allowed, 'lower-digit');
  assert.deepEqual(generationOf(parseCharacters('Alphanumerics and underscores<br><br>Start with a letter.')).separator, '');
  assert.equal(generationOf(parseCharacters('Lowercase letters, numbers, and hyphens')).allowed, 'lower-digit-hyphen');
});

test('resourceType — 40자 이하 · 겹치면 다음 후보', () => {
  const used = new Set();
  const a = resourceTypeOf('Microsoft.ServiceBus', ['namespaces', 'AuthorizationRules'], used);
  assert.ok(a.length <= 40);
  used.add(a);
  const b = resourceTypeOf('Microsoft.ServiceBus', ['namespaces', 'AuthorizationRules'], used);
  assert.notEqual(a, b);
  assert.equal(resourceTypeOf('Microsoft.Network', ['loadBalancers'], new Set()), 'network_load_balancers');
});

test('범위 칸 — 기존 셋 · region · 부모 리소스 · 판정 불가', () => {
  assert.equal(scopeKind('Resource Group'), 'azure:resource_group');
  assert.equal(scopeKind('Azure region'), 'azure:region');
  assert.equal(scopeKind('namespace'), 'parent');
  // 여러 범위에 걸치는 칸은 넓은 쪽(구독)에 둔다 — 넓은 노드가 유일성 판정에서 보수적이다
  assert.equal(scopeKind('subscription or resource group'), 'azure:subscription');
  assert.equal(scopeKind('scope of assignment'), 'azure:subscription');
  assert.equal(scopeKind('tenant'), 'azure:tenant');
  // 관리 그룹 · 구독 · RG 셋에 걸치는 blueprint 는 길이 칸이 정해지지 않아 손 확인 보류다 — 범위도 정하지 않는다
  assert.equal(scopeKind('Management groups, Subscriptions, Resource groups'), null);
  assert.equal(scopeKind('resource'), null);
  assert.equal(scopeKind('subscription; resource group'), null);
});

test('손 확인 보류 — Azure 범위 칸이 한 노드에 맞지 않던 행의 사유가 구체적이다', () => {
  for (const e of ['Microsoft.Blueprint/blueprint', 'Microsoft.Blueprint/blueprintAssignments', 'Microsoft.Security/assessmentMetadata', 'Microsoft.Security/assessments', 'Microsoft.Security/sqlVulnerabilityAssessments/baselineRules']) {
    assert.match(HAND_REVIEWED[e] ?? '', /^reviewed by hand — (not imported|unconfirmed) \(.{40,}\)$/, e);
  }
});

test('약어가 없을 때 — 낱말 둘 이상이면 머리글자 · 하나면 앞 세 글자', () => {
  assert.equal(fallbackSlug('service / authorizationServers'), 'as');
  assert.equal(fallbackSlug('service / apis'), 'api');
});

test('손으로 다시 읽고 넣지 않은 행 — 원문 스냅샷의 Entity 이고 사유는 넣지 않음 · 미확인 둘 중 하나와 괄호 안 이유', () => {
  const snap = JSON.parse(readFileSync(new URL('../../src/core/__fixtures__/azure-intake.json', import.meta.url), 'utf-8'));
  const entities = new Set(snap.rows.map((r) => r.entity));
  for (const [e, why] of Object.entries(HAND_REVIEWED)) {
    assert.ok(entities.has(e), e);
    assert.match(why, /^reviewed by hand — (not imported|unconfirmed) \(.+\)$/, e);
  }
});
