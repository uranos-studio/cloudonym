// 충돌 fixture (D41) 를 HTTP 로 — 실제 규칙 표에는 같은 이름을 내는 짝이 없어(Windows VM 은 region 을 늘 떨구고 Linux VM 은 남긴다)
// API 는 켜진 CSP(gcp)만 받으므로(D45) constraints 의 rulesFor('gcp') 에만 시험 전용 규칙 둘을 덧붙인다. RULES · getRule 은 원본 그대로다. 운영 코드에는 시험용 훅이 없다
import { describe, it, expect, vi } from 'vitest';
import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ResourceRule } from '../core/types';

vi.mock('../core/constraints', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/constraints')>();
  const vm = actual.RULES['gcp.compute_instance']!;
  // __fixtures__/conflict.ts 의 GCP 짝과 같은 정의 — 아래 첫 시험이 둘이 같은지 대어 본다(fixture 는 이 모듈을 들여오므로 여기서 import 할 수 없다)
  const extra: ResourceRule[] = [
    { ...vm, id: 'gcp.test_conflict_a', resourceType: 'test_conflict_a', displayName: 'Test Conflict A' },
    { ...vm, id: 'gcp.test_conflict_b', resourceType: 'test_conflict_b', displayName: 'Test Conflict B' },
  ];
  return { ...actual, rulesFor: (p: Parameters<typeof actual.rulesFor>[0]) => (p === 'gcp' ? [...actual.rulesFor(p), ...extra] : actual.rulesFor(p)) };
});

const { app } = await import('./index');
const { req, jsonPost, json } = await import('./test-support');
const { rulesFor } = await import('../core/constraints');
const { CONFLICT_GCP_RULE_A, CONFLICT_GCP_RULE_B, CONFLICT_CONTEXT } = await import('../core/__fixtures__/conflict');

describe('POST /v1/names — 충돌 fixture (D41)', () => {
  it('시험 전제 — 덧붙인 규칙이 __fixtures__/conflict.ts 의 GCP 두 규칙과 같다', () => {
    const gcp = rulesFor('gcp');
    expect(gcp.find((r) => r.id === 'gcp.test_conflict_a')).toEqual(CONFLICT_GCP_RULE_A);
    expect(gcp.find((r) => r.id === 'gcp.test_conflict_b')).toEqual(CONFLICT_GCP_RULE_B);
  });
  it('두 항목 모두 valid:false + name.conflict · 본문 conflicts 한 건 · 전체 valid:false · 상태 200 · 명세의 NamesResponse 에 맞는다', async () => {
    const { res } = await req(app, '/v1/names', jsonPost({ provider: 'gcp', context: CONFLICT_CONTEXT, resources: [{ type: 'test_conflict_a' }, { type: 'test_conflict_b' }, { type: 'project_id' }] }));
    expect(res.status).toBe(200);
    const body = await json(res);
    const az = body.data.gcp;
    expect(az.valid).toBe(false);
    expect(az.items.map((i: { key: string; valid: boolean }) => [i.key, i.valid])).toEqual([['test_conflict_a_01', false], ['test_conflict_b_01', false], ['project_id', true]]);
    expect(az.items[0].name).toBe(az.items[1].name);
    for (const i of az.items.slice(0, 2)) expect(i.violations).toEqual([expect.objectContaining({ code: 'name.conflict', params: { name: az.items[0].name, keys: ['test_conflict_a_01', 'test_conflict_b_01'] } })]);
    expect(az.conflicts).toHaveLength(1);
    expect(az.conflicts[0]).toMatchObject({ code: 'name.conflict', params: { keys: ['test_conflict_a_01', 'test_conflict_b_01'] } });
    expect(az.conflicts[0].message).toContain('test_conflict_a_01, test_conflict_b_01');

    const spec = JSON.parse(readFileSync(join(import.meta.dirname, '../../public/openapi.json'), 'utf-8')) as { components: unknown };
    const ajv = new Ajv({ strict: false, allErrors: true });
    ajv.addSchema({ $id: 'openapi', components: spec.components }, 'openapi');
    const v = ajv.getSchema('openapi#/components/schemas/NamesResponse')!;
    expect(v(body), ajv.errorsText(v.errors)).toBe(true);
  });
});
