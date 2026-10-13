// 카드 데이터 (D93) — 부품은 프리셋에 있고 · 참조는 카드의 부품만 가리키고 · 카드 하나로 만든 계획은 엔진 검사를 지난다
import { describe, it, expect } from 'vitest';
import { BUNDLES, bundleById, partIsProject, partKey, type Bundle, type BundlePart } from './bundles';
import { PRESETS, presetOf } from './presets';
import { RULES } from '../constraints';
import { inputKind } from '../tree';
import { MAX_PICKS_PER_SERVICE, expandPlan, validatePlan, type Pick, type WizardPlan } from './plan';
import { generateProject } from '../engine';

const PROJECT = { owner: 'platform', system: 'billing', env: 'prod', region: 'asia-northeast3' };
const NETWORK: BundlePart[] = [{ preset: 'vpc' }, { preset: 'subnet' }, { preset: 'router' }, { preset: 'nat' }];

function pickOf(p: BundlePart): Pick {
  const preset = presetOf(p.preset)!;
  const base: Pick = { preset: p.preset, ...(p.tier === undefined ? {} : { tier: p.tier }) };
  return inputKind(RULES[preset.ruleId]!) === 'count' ? { ...base, instances: [{ id: '1', seq: '01' }] } : base;
}
/** 카드의 부품(백엔드는 첫째 · 선택은 opts) 전부 — 같은 부품은 한 번 */
function partsOf(b: Bundle, opts: 'default' | 'all' | 'none' = 'default'): BundlePart[] {
  const out: BundlePart[] = [];
  const add = (p: BundlePart) => { if (!out.some((x) => partKey(x) === partKey(p))) out.push(p); };
  const backend = b.backends?.[0];
  if (backend) add({ preset: backend.needs });
  [...b.parts, ...(backend?.parts ?? [])].forEach(add);
  for (const o of b.options) if (opts === 'all' || (opts === 'default' && o.on)) o.parts.forEach(add);
  return out;
}
function planOf(parts: BundlePart[], withNetwork = true): WizardPlan {
  const project = [...(withNetwork ? NETWORK : []), ...parts.filter(partIsProject)];
  return { provider: 'gcp', project: PROJECT, projectPicks: project.map(pickOf), services: [{ purpose: 'site', picks: parts.filter((p) => !partIsProject(p)).map(pickOf) }] };
}

describe('카드 데이터 (D93)', () => {
  it('1차 카드 다섯 — id 는 고유 · 갤러리 순서', () => {
    expect(BUNDLES.map((b) => b.id)).toEqual(['website', 'serverless-web', 'static-site', 'vm-app', 'https-lb']);
    expect(bundleById('website')?.label).toBe('Website');
    expect(bundleById('nope')).toBeUndefined();
  });

  it('부품 · 선택 · 백엔드의 프리셋은 표에 있고 · tier 는 그 프리셋의 tier 칩 안 · 한 카드 안에서 부품이 겹치지 않는다', () => {
    for (const b of BUNDLES) {
      const all = [...b.parts, ...(b.backends ?? []).flatMap((x) => [{ preset: x.needs }, ...x.parts]), ...b.options.flatMap((o) => o.parts)];
      for (const p of all) {
        const preset = presetOf(p.preset);
        expect(preset, `${b.id} ${p.preset}`).toBeDefined();
        if (p.tier !== undefined) expect(preset!.tierChoices, `${b.id} ${partKey(p)}`).toContain(p.tier);
        else expect(preset!.tierChoices, `${b.id} ${p.preset}`).toBeUndefined();
      }
      const required = b.parts.map(partKey);
      expect(new Set(required).size, b.id).toBe(required.length);
    }
  });

  it('카드마다 서비스 부품 수 — website 12 · serverless-web 11 · static-site 10 · 프로젝트 공용 부품 — website 은 방화벽 web · lbhc', () => {
    const count = (id: string) => partsOf(bundleById(id)!, 'none');
    expect(count('website').filter((p) => !partIsProject(p)).length).toBe(12);
    expect(count('website').filter(partIsProject).map(partKey)).toEqual(['firewall:web', 'firewall:lbhc']);
    expect(count('serverless-web').filter((p) => !partIsProject(p)).length).toBe(11);
    expect(count('serverless-web').filter(partIsProject)).toEqual([]);
    expect(count('static-site').filter((p) => !partIsProject(p)).length).toBe(10);
    // Cloud Run · 버킷 백엔드에는 헬스 체크가 없다 — 서버리스 NEG 백엔드는 헬스 체크를 둘 수 없다(공식 문서)
    expect(count('serverless-web').map(partKey)).not.toContain('hc');
    expect(count('static-site').map(partKey)).not.toContain('bs');
  });

  it('참조는 카드의 부품(필수 · 백엔드)이나 vpc 만 가리킨다 · 근거는 https URL', () => {
    for (const b of BUNDLES) {
      const keys = new Set([...b.parts, ...(b.backends ?? []).flatMap((x) => [{ preset: x.needs }, ...x.parts])].map(partKey));
      for (const r of b.refs) {
        expect(keys.has(r.from), `${b.id} ${r.from}`).toBe(true);
        expect(r.to === 'vpc' || keys.has(r.to), `${b.id} ${r.to}`).toBe(true);
        expect(r.evidence, `${b.id} ${r.from}`).toMatch(/^https:\/\//);
      }
      expect(b.evidence.length, b.id).toBeGreaterThan(0);
    }
  });

  it('가족 lb 의 카드는 백엔드 셋(VM · Cloud Run · 버킷)을 https-lb 의 백엔드 표와 같은 부품으로 쓴다 — 특정 카드 = https-lb + 그 백엔드', () => {
    const lb = bundleById('https-lb')!;
    for (const [id, needs] of [['website', 'web'], ['serverless-web', 'run'], ['static-site', 'object']] as const) {
      const backend = lb.backends!.find((x) => x.needs === needs)!;
      const viaLb = new Set([needs, ...lb.parts.map(partKey), ...backend.parts.map(partKey)]);
      expect(new Set(bundleById(id)!.parts.map(partKey)), id).toEqual(viaLb);
      expect(bundleById(id)!.family, id).toBe('lb');
    }
    expect(bundleById('vm-app')!.family).toBeUndefined();
  });

  it('실제로 만들어 본 카드(tested)는 website · vm-app 둘 (D91)', () => {
    expect(BUNDLES.filter((b) => b.tested).map((b) => b.id)).toEqual(['website', 'vm-app']);
  });

  it('카드 하나(기본 선택 · 선택 전부 · 선택 없음)를 첫 화면 네트워크 위에 얹으면 validatePlan 을 지나고 이름이 전부 유효 · 축소 없음 · 상한 안', () => {
    for (const b of BUNDLES) {
      for (const opts of ['default', 'all', 'none'] as const) {
        const plan = planOf(partsOf(b, opts));
        expect(validatePlan(plan), `${b.id} ${opts}`).toEqual({ ok: true });
        expect(plan.services[0]!.picks.length, b.id).toBeLessThanOrEqual(MAX_PICKS_PER_SERVICE);
        expect(plan.projectPicks.length, b.id).toBeLessThanOrEqual(MAX_PICKS_PER_SERVICE);
        const items = generateProject(expandPlan(plan), 'gcp').items;
        expect(items.every((i) => i.valid && !i.isTruncated), `${b.id} ${opts}`).toBe(true);
      }
    }
  });

  it('website 카드의 이름 — 실제 배포(D91)의 키와 같은 꼴(서비스 site)', () => {
    const items = generateProject(expandPlan(planOf(partsOf(bundleById('website')!, 'none'), false)), 'gcp').items.slice(1);
    expect(items.map((i) => i.key)).toEqual([
      'project/-/firewall_rule/-/web/01', 'project/-/firewall_rule/-/lbhc/01',
      'service/site/compute_instance/-/web/01', 'service/site/instance_group/-/-/01', 'service/site/health_check/-/-/01', 'service/site/backend_service/-/-/01',
      'service/site/global_address/-/-/01', 'service/site/url_map/-/-/01', 'service/site/ssl_certificate/-/-/01', 'service/site/target_https_proxy/-/-/01',
      'service/site/global_forwarding_rule/-/-/01', 'service/site/url_map/-/redir/01', 'service/site/target_http_proxy/-/-/01', 'service/site/global_forwarding_rule/-/redir/01',
    ]);
  });

  it('카드의 선택 id 는 카드 안에서 고유 · 라벨이 있다', () => {
    for (const b of BUNDLES) {
      expect(new Set(b.options.map((o) => o.id)).size, b.id).toBe(b.options.length);
      for (const o of b.options) expect(o.label.length, `${b.id} ${o.id}`).toBeGreaterThan(0);
    }
    expect(PRESETS.length).toBeGreaterThan(0);
  });
});
