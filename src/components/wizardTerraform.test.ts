// 마법사 Terraform (D69) — 구조 키를 그대로 맵 키로 쓴다. toTerraformLocals 는 그대로다(terraform.test 가 센다)
import { describe, it, expect } from 'vitest';
import { wizardLabels, wizardTerraform, wizardTerraformByEnv } from './wizardTerraform';
import { generateProject } from '../core/engine';
import { WIZARD_PARENT_FAIL, WIZARD_SAMPLE } from '../core/__fixtures__/project';
import type { LabelSet } from '../core/types';

const mapKeys = (hcl: string) => [...hcl.matchAll(/^ {4}"([^"]+)" = "/gm)].map((m) => m[1]!);
const invalidKeys = (hcl: string) => [...hcl.matchAll(/^ {2}# INVALID: gcp_names\["([^"]+)"\]/gm)].map((m) => m[1]!);

describe('wizardTerraform (D69)', () => {
  const out = generateProject(WIZARD_SAMPLE, 'gcp');
  const hcl = wizardTerraform(out, wizardLabels(WIZARD_SAMPLE, 'gcp'));

  it('맵 하나 gcp_names — 키는 항목 키와 글자 그대로 같고 순서도 같다', () => {
    expect(hcl.startsWith('locals {\n  gcp_names = {\n')).toBe(true);
    expect(hcl.endsWith('\n}\n')).toBe(true);
    expect(mapKeys(hcl)).toEqual(out.items.map((i) => i.key));
    expect(hcl).toContain('    "service/shop/compute_instance/-/web/01/boot/-" = "billing-shop-prod-ane3-gce-web-01-boot"\n');
    expect(invalidKeys(hcl)).toEqual([]);
  });
  it('라벨은 이름공간별 맵 gcp_labels_by_namespace — project 는 purpose 없음 · 서비스는 purpose', () => {
    expect(hcl).toContain('  gcp_labels_by_namespace = {\n    "project" = {\n      owner = "platform"\n      system = "billing"\n      environment = "prod"\n');
    expect(hcl).toContain('    "shop" = {\n      owner = "platform"\n      system = "billing"\n      purpose = "shop"\n');
    expect(hcl).toContain('    "pay" = {\n');
    expect(hcl).not.toMatch(/^ {2}gcp_labels = /m);
  });
  it('version 을 주면 머리 주석 두 줄', () => {
    const withVersion = wizardTerraform(out, {}, { engine: '9.9.9', rules: '2000-01-01.1' });
    expect(withVersion.split('\n').slice(0, 3).map((l) => l.slice(0, 2))).toEqual(['# ', '# ', 'lo']);
  });
  it('충돌 항목과 그 자식은 맵 밖 # INVALID — 값으로 나가지 않는다', () => {
    const fail = generateProject(WIZARD_PARENT_FAIL, 'gcp');
    const h = wizardTerraform(fail, wizardLabels(WIZARD_PARENT_FAIL, 'gcp'));
    expect(mapKeys(h)).toEqual(['project/-/project_id/-/-/-']);
    expect(invalidKeys(h)).toEqual(fail.items.slice(1).map((i) => i.key));
    expect(invalidKeys(h)).toHaveLength(3);
    expect(h).toMatch(/# INVALID: gcp_names\["[^"]+\/boot\/-"\] — The parent '/);
    // INVALID 줄은 gcp_names 맵이 닫힌 뒤에 온다
    const close = h.indexOf('\n  }\n');
    expect(h.indexOf('# INVALID')).toBeGreaterThan(close);
  });
  it('라벨 위반이 있는 이름공간은 맵 밖 # INVALID', () => {
    const bad: LabelSet = { labels: { owner: 'x' }, violations: [{ code: 'label.too_long', field: 'owner', params: { actual: 65, max: 63 } }], transformed: [] };
    const h = wizardTerraform(out, { project: bad });
    expect(h).toContain('  # INVALID: gcp_labels_by_namespace["project"] — ');
    expect(h).not.toContain('    "project" = {');
  });
});

describe('wizardTerraformByEnv (D82)', () => {
  const withEnv = (env: 'prod' | 'stg') => ({ ...WIZARD_SAMPLE, project: { ...WIZARD_SAMPLE.project, env } });
  const entries = (['prod', 'stg'] as const).map((env) => ({ env, result: generateProject(withEnv(env), 'gcp'), labels: wizardLabels(withEnv(env), 'gcp') }));
  const hcl = wizardTerraformByEnv(entries);
  const envKeys = (env: string) => {
    const block = hcl.slice(hcl.indexOf(`    "${env}" = {\n`), hcl.indexOf('\n    }\n', hcl.indexOf(`    "${env}" = {\n`)));
    return [...block.matchAll(/^ {6}"([^"]+)" = "/gm)].map((m) => m[1]!);
  };
  it('gcp_names_by_env — env 마다 항목 키 그대로 · 이름은 그 env 의 것', () => {
    expect(hcl.startsWith('locals {\n  gcp_names_by_env = {\n    "prod" = {\n')).toBe(true);
    expect(envKeys('prod')).toEqual(entries[0]!.result.items.map((i) => i.key));
    expect(envKeys('stg')).toEqual(entries[1]!.result.items.map((i) => i.key));
    expect(hcl).toContain('      "service/shop/compute_instance/-/web/01/boot/-" = "billing-shop-prod-ane3-gce-web-01-boot"\n');
    expect(hcl).toContain('      "service/shop/compute_instance/-/web/01/boot/-" = "billing-shop-stg-ane3-gce-web-01-boot"\n');
    expect(hcl).not.toMatch(/^ {2}gcp_names = /m);
  });
  it('라벨은 gcp_labels_by_env — env 안에 이름공간', () => {
    expect(hcl).toContain('  gcp_labels_by_env = {\n    "prod" = {\n      "project" = {\n        owner = "platform"\n');
    expect(hcl).toMatch(/ {4}"stg" = \{\n {6}"project" = \{\n(?: {8}.+\n)*? {8}environment = "stg"\n/);
  });
  it('무효는 env 를 단 # INVALID 주석 — 값으로 나가지 않는다', () => {
    const fail = generateProject(WIZARD_PARENT_FAIL, 'gcp');
    const h = wizardTerraformByEnv([{ env: 'dev', result: fail, labels: {} }]);
    expect(h).toContain(`# INVALID: gcp_names_by_env["dev"]["${fail.items[1]!.key}"] — `);
    expect(h).not.toContain('gcp_labels_by_env');
  });
});
