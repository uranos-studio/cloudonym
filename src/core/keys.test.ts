// 구조 키 단사 (D69) — GCP 규칙 표의 모든 type × 표본 tier × seq + 자식 다섯으로 항목을 만들어 키 · 마법사 Terraform 맵 키 중복 0 을 센다.
// 밑줄로 잇는 꼴은 type 이름 자체가 밑줄을 품어 깨졌다(instance_group + manager = instance_group_manager) — 그 짝을 표본 tier 로 넣는다
import { describe, it, expect } from 'vitest';
import { generateProject, type ProjectSelection } from './engine';
import { rulesFor } from './constraints';
import { inputKind } from './tree';
import { GCP_CATALOG } from './rules/gcp-catalog';
import type { SelectionItem } from './selection';
import { WIZARD_PROJECT } from './__fixtures__/project';
import { wizardLabels, wizardTerraform } from '../components/wizardTerraform';

const TIERS = ['manager', 'group', 'service', 'attachment', 'web'];
const CHILD_TAILS = ['boot/-', 'data/01', 'data/02', 'ip/-', 'ipi/-'];

/** 규칙마다 — count 규칙은 tier 없음 + 표본 tier 다섯(슬롯 01 · VM 은 자식 다섯), role 규칙 · 입력 없는 규칙은 하나. 프로젝트 ID 는 암묵 항목이라 뺀다 */
function picks(level?: 'project'): SelectionItem[] {
  return rulesFor('gcp').filter((r) => r.id !== 'gcp.project_id').flatMap((rule): SelectionItem[] => {
    const lv = level ? { level } : {};
    if (inputKind(rule) !== 'count') return [{ rule, count: 1, ...lv }];
    const attach = rule.id === 'gcp.compute_instance' ? { attach: { boot: true as const, data: ['01', '02'], ip: true as const, ipi: true as const } } : {};
    return [undefined, ...TIERS].map((tier) => ({ rule, count: 1, ...lv, ...(tier ? { tier } : {}), instances: [{ seq: '01', ...attach }] }));
  });
}

const SEL: ProjectSelection = { project: WIZARD_PROJECT, projectItems: picks('project'), services: [{ purpose: 'shop', items: picks() }] };
const out = generateProject(SEL, 'gcp');
const keys = out.items.map((i) => i.key);

describe('구조 키 — 단사 (D69)', () => {
  it('표본이 넓다 — GCP 규칙 전부(catalog 115행을 다 담는다) · 프로젝트와 서비스 둘 다', () => {
    expect(GCP_CATALOG).toHaveLength(115);
    const types = new Set(out.items.map((i) => i.resourceType));
    for (const row of GCP_CATALOG) expect(types.has(row.key.slice('gcp.'.length)), row.key).toBe(true);
    expect(out.items.length).toBeGreaterThan(1000);
  });
  it('키 중복 0 · 꼴은 부모 5칸 · 자식 7칸 · 칸에 / 가 없다', () => {
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect([5, 7], k).toContain(k.split('/').length);
    for (const k of keys) expect(k, k).toMatch(/^(project|service)\/[a-z0-9-]+\/[a-z0-9_]+\/([a-z0-9]{2,16}|-)\/([a-z0-9]+|-)(\/(boot|data|ip|ipi)\/(\d{2}|-))?$/);
  });
  it('instance_group + manager 와 instance_group_manager 는 다른 키', () => {
    expect(keys).toContain('service/shop/instance_group/manager/01');
    expect(keys).toContain('service/shop/instance_group_manager/-/01');
  });
  it('같은 type 의 level project 와 서비스는 다른 키', () => {
    expect(keys).toContain('project/-/compute_instance/-/01');
    expect(keys).toContain('service/shop/compute_instance/-/01');
  });
  it('서비스 이름이 정제 뒤 project 여도 프로젝트 수준 항목과 키가 다르다 — 키의 level 칸은 namespace 가 아니라 level 에서 온다', () => {
    const vm = rulesFor('gcp').find((r) => r.id === 'gcp.compute_instance')!;
    const r = generateProject({ project: WIZARD_PROJECT, projectItems: [{ rule: vm, count: 1, level: 'project', instances: [{ seq: '01', attach: { boot: true } }] }],
      services: [{ purpose: 'Project', items: [{ rule: vm, count: 1, instances: [{ seq: '01', attach: { boot: true } }] }] }] }, 'gcp');
    const ks = r.items.map((i) => i.key);
    expect(ks.slice(1)).toEqual(['project/-/compute_instance/-/01', 'project/-/compute_instance/-/01/boot/-',
                                 'service/project/compute_instance/-/01', 'service/project/compute_instance/-/01/boot/-']);
    expect(new Set(ks).size).toBe(ks.length);
    const hcl = wizardTerraform(r, {});
    const mapKeys = [...hcl.matchAll(/^ {4}"([^"]+)" = "/gm)].map((m) => m[1]!);
    expect(new Set(mapKeys).size).toBe(mapKeys.length);
  });
  it('같은 슬롯의 자식 다섯은 다른 키이고 그 집합이 정확히 boot/- · data/01 · data/02 · ip/- · ipi/-', () => {
    const parent = 'service/shop/compute_instance/web/01';
    const tails = keys.filter((k) => k.startsWith(`${parent}/`)).map((k) => k.slice(parent.length + 1));
    expect(tails).toEqual(CHILD_TAILS);
  });
  it('마법사 Terraform 맵 키(유효 · INVALID 둘 다) 중복 0 · 항목 키와 같은 집합', () => {
    const hcl = wizardTerraform(out, wizardLabels(SEL, 'gcp'));
    const mapKeys = [...hcl.matchAll(/^ {4}"([^"]+)" = "/gm)].map((m) => m[1]!);
    const invalidKeys = [...hcl.matchAll(/^ {2}# INVALID: gcp_names\["([^"]+)"\]/gm)].map((m) => m[1]!);
    const all = [...mapKeys, ...invalidKeys];
    expect(mapKeys.length).toBeGreaterThan(0);
    expect(invalidKeys.length).toBeGreaterThan(0);
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(all)).toEqual(new Set(keys));
  });
});
