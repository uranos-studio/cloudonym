// 마법사 JSON 내보내기 — 구조 키 · 이름공간 · 부모 · 무효 분리. 트리 화면의 namesExport 는 그대로다(namesExport.test)
import { describe, it, expect } from 'vitest';
import { toWizardExport, toWizardExportByEnv } from './wizardExport';
import { expandPlan, type WizardPlan } from '../core/wizard/plan';
import { generateProject } from '../core/engine';

const project = { owner: 'platform', system: 'billing', env: 'prod' as const, region: 'ane3' };
const V = { engine: '9.9.9', rules: '2000-01-01.1' };

describe('toWizardExport', () => {
  const plan: WizardPlan = { provider: 'gcp', project, projectPicks: [{ preset: 'vpc', instances: [{ id: 'a', seq: '01' }] }],
    services: [{ purpose: 'shop', picks: [{ preset: 'web', instances: [{ id: 'a', seq: '01', attach: { boot: true, data: ['01'] } }, { id: 'b', seq: '02', attach: { boot: true } }] }] }] };
  const result = generateProject(expandPlan(plan), 'gcp');
  const out = toWizardExport(result, project, plan, V);
  it('문맥 — project 넷 · 서비스마다 다섯', () => {
    expect(out.project).toEqual(project);
    expect(out.services).toEqual([{ ...project, purpose: 'shop' }]);
    expect(out.version).toEqual(V);
    expect(out.provider).toBe('gcp');
  });
  it('항목 순서 · 구조 키 · 자식의 parent · attach', () => {
    expect(out.names.map((n) => n.key)).toEqual(result.items.map((i) => i.key));
    expect(out.names[0]).toEqual({ key: 'project/-/project_id/-/-', namespace: 'project', level: 'project', resource_type: 'project_id', name: 'platform-billing-prod' });
    const disk = out.names.find((n) => n.key === 'service/shop/compute_instance/web/01/data/01')!;
    expect(disk).toEqual({ key: 'service/shop/compute_instance/web/01/data/01', namespace: 'shop', resource_type: 'disk', seq: '01',
      parent: 'service/shop/compute_instance/web/01', attach: 'data', name: 'billing-shop-prod-ane3-gce-web-01-data-01' });
    expect(out.invalid).toEqual([]);
  });
  it('무효 항목은 names 에 없고 invalid 에 코드로', () => {
    const long = 'a'.repeat(59);
    const bad: WizardPlan = { ...plan, projectPicks: [], services: [{ purpose: `${long}b`, picks: [{ preset: 'web', instances: [{ id: 'a', seq: '01', attach: { boot: true } }] }] },
      { purpose: `${long}c`, picks: [{ preset: 'web', instances: [{ id: 'a', seq: '01' }] }] }] };
    const r = generateProject(expandPlan(bad), 'gcp');
    const e = toWizardExport(r, project, bad, V);
    expect(e.names.map((n) => n.key)).toEqual(['project/-/project_id/-/-']);
    expect(e.invalid.map((i) => i.codes)).toContainEqual(['name.parent_invalid']);
  });
});

describe('toWizardExportByEnv (D82)', () => {
  const plan: WizardPlan = { provider: 'gcp', project, projectPicks: [], services: [{ purpose: 'shop', picks: [{ preset: 'object' }] }] };
  const entries = (['prod', 'uat'] as const).map((env) => {
    const p = { ...plan, project: { ...project, env } };
    return { env, result: generateProject(expandPlan(p), 'gcp'), project: { ...project, env }, plan: p };
  });
  const out = toWizardExportByEnv(entries, V);
  it('version · provider 한 번 · environments 는 고른 순서 · env 마다 toWizardExport 와 같은 본문', () => {
    expect(out.version).toEqual(V);
    expect(out.provider).toBe('gcp');
    expect(Object.keys(out.environments)).toEqual(['prod', 'uat']);
    const { version: _v, provider: _p, ...uat } = toWizardExport(entries[1]!.result, entries[1]!.project, entries[1]!.plan, V);
    expect(out.environments.uat).toEqual(uat);
    expect(out.environments.uat!.project.env).toBe('uat');
    expect(out.environments.uat!.names.map((n) => n.name)).toEqual(['platform-billing-uat', 'platform-billing-shop-uat-ane3-gcs']);
  });
});
