// openapi-scopes.mjs 시험 — 생성기가 openapi.json 의 scope enum 을 손 범위까지 포함한 전체 SCOPES 로 맞추는지 본다.
// vitest 쪽 src/api/openapi.test.ts 가 「enum = Object.keys(SCOPES)」를 단언한다 — 여기는 생성기가 그 등식을 깨지 않음을 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scopeIdsFromSources, syncScopeEnum, SCOPE_SOURCES } from './openapi-scopes.mjs';

const api = () => JSON.parse(readFileSync('public/openapi.json', 'utf-8'));
const enumOf = (a) => a.components.schemas.NameItem.properties.scope.enum;

test('소스에서 읽은 범위 id 전체 = 지금 openapi scope enum (손 범위 · 들인 범위 모두)', () => {
  const ids = scopeIdsFromSources((f) => readFileSync(f, 'utf-8'));
  assert.deepEqual([...ids].sort(), [...enumOf(api())].sort());
  for (const hand of ['azure:appconfiguration/configurationstores', 'azure:web/sites', 'aws:ecs_cluster', 'gcp:spanner_instance', 'azure:region']) assert.ok(ids.includes(hand), hand);
});

test('syncScopeEnum — 손 범위(경로 꼴 포함)를 지우지 않고, 없어진 id 만 빼고, 새 id 는 뒤에 붙인다', () => {
  const a = { components: { schemas: { NameItem: { properties: { scope: { enum: ['azure:global', 'azure:web/sites', 'azure:old/gone', 'gcp:project'] } } } } } };
  syncScopeEnum(a, ['azure:global', 'azure:web/sites', 'gcp:project', 'azure:new/one']);
  assert.deepEqual(enumOf(a), ['azure:global', 'azure:web/sites', 'gcp:project', 'azure:new/one']);
});

test('SCOPE_SOURCES — scopes.ts 와 provider 별 손 · 들인 규칙 파일 전부', () => {
  for (const f of ['src/core/scopes.ts', 'src/core/rules/azure-manual.ts', 'src/core/rules/azure-intake.ts', 'src/core/rules/gcp-manual.ts', 'src/core/rules/gcp-intake.ts', 'src/core/rules/aws-manual.ts']) assert.ok(SCOPE_SOURCES.includes(f), f);
});
