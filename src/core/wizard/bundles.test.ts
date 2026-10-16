// 카드 데이터 (D93) — 부품은 프리셋에 있고 · 참조는 카드의 부품만 가리키고 · 카드 하나로 만든 계획은 엔진 검사를 지난다
import { describe, it, expect } from 'vitest';
import { BUNDLES, bundleById, partIsProject, partKey, type Bundle, type BundlePart } from './bundles';
import { PRESETS, presetOf } from './presets';
import { RULES } from '../constraints';
import { inputKind } from '../tree';
import { MAX_PICKS_PER_SERVICE, expandPlan, validatePlan, type Pick, type WizardPlan } from './plan';
import { generateProject, validateName } from '../engine';

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
  const own = parts.filter(partIsProject);
  const project = [...(withNetwork ? NETWORK.filter((n) => !own.some((p) => partKey(p) === partKey(n))) : []), ...own];
  return { provider: 'gcp', project: PROJECT, projectPicks: project.map(pickOf), services: [{ purpose: 'site', picks: parts.filter((p) => !partIsProject(p)).map(pickOf) }] };
}

describe('카드 데이터 (D93)', () => {
  it('1차 카드 다섯 + D114 의 다섯 — id 는 고유 · 갤러리 순서', () => {
    expect(BUNDLES.map((b) => b.id)).toEqual(['website', 'serverless-web', 'static-site', 'vm-app', 'https-lb', 'data-warehouse', 'gke', 'event-pipeline', 'ci-cd', 'batch-job']);
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
      // 되읽기는 첫 부품을 그 카드의 백엔드로 본다(wizardBundles.cardsIn)
      expect(bundleById(id)!.parts[0]!.preset, id).toBe(needs);
    }
    expect(bundleById('vm-app')!.family).toBeUndefined();
  });

  it('실제로 만들어 본 카드(tested)는 website · serverless-web · static-site · vm-app 넷 (D91 · D96) — https-lb 는 단독으로 응답하지 않아 빠진다', () => {
    expect(BUNDLES.filter((b) => b.tested).map((b) => b.id)).toEqual(['website', 'serverless-web', 'static-site', 'vm-app']);
    for (const id of ['serverless-web', 'static-site']) expect(bundleById(id)!.evidence, id).toContain('D96');
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

  it('선택마다 서비스 부품이 하나 이상 — 프로젝트 공용 부품뿐인 선택은 켜짐(optionOn)을 되읽을 수 없고 끌 수도 없다', () => {
    for (const b of BUNDLES) for (const o of b.options) expect(o.parts.some((p) => !partIsProject(p)), `${b.id} ${o.id}`).toBe(true);
  });

  it('카드마다 필수 서비스 부품이 하나 이상 — 프로젝트 공용 부품뿐인 카드는 모든 서비스에 되읽힌다(그래서 사설 네트워크 카드는 두지 않는다 · D114)', () => {
    for (const b of BUNDLES) expect([...b.parts, ...(b.backends ?? []).map((x) => ({ preset: x.needs }))].some((p) => !partIsProject(p)), b.id).toBe(true);
  });

  it('가족 밖 카드끼리 필수 서비스 부품 묶음이 서로의 부분집합이 아니다 — 되읽기가 한 카드로 정해진다', () => {
    const others = BUNDLES.filter((b) => b.family === undefined).map((b) => ({ id: b.id, keys: new Set(b.parts.filter((p) => !partIsProject(p)).map(partKey)) }));
    for (const a of others) for (const b of others) {
      if (a.id === b.id) continue;
      expect([...a.keys].every((k) => b.keys.has(k)), `${a.id} ⊂ ${b.id}`).toBe(false);
    }
  });

  it('D114 의 새 카드 다섯 — 필수 부품 · 선택 · 아직 만들어 보지 않음(tested false)', () => {
    const shape = (id: string) => { const b = bundleById(id)!; return { parts: b.parts.map(partKey), options: b.options.map((o) => [o.id, o.on, o.parts.map(partKey)]), tested: b.tested, family: b.family }; };
    expect(shape('data-warehouse')).toEqual({ parts: ['object', 'bq', 'sa'], options: [['schedule', false, ['cron']]], tested: false, family: undefined });
    expect(shape('gke')).toEqual({ parts: ['gke', 'ar', 'sa', 'vpc', 'subnet'], options: [['cache', false, ['redis']]], tested: false, family: undefined });
    expect(shape('event-pipeline')).toEqual({ parts: ['topic', 'sub', 'dlq', 'run', 'sa'], options: [], tested: false, family: undefined });
    expect(shape('ci-cd')).toEqual({ parts: ['ar', 'build', 'sa'], options: [['secret', false, ['secret']]], tested: false, family: undefined });
    expect(shape('batch-job')).toEqual({ parts: ['runjob', 'cron', 'sa'], options: [], tested: false, family: undefined });
    // 네트워크(vpc · subnet)는 프로젝트 공용 자리다 — 첫 화면에 이미 있으면 카드가 더하지 않는다
    expect(bundleById('gke')!.parts.filter(partIsProject).map(partKey)).toEqual(['vpc', 'subnet']);
  });

  it('D114 — 카드를 펼친 이름: 데이터셋은 밑줄 · 버킷과 나머지는 하이픈 · 데드레터 토픽은 토픽과 키 · 이름이 다르다', () => {
    const names = (id: string) => Object.fromEntries(generateProject(expandPlan(planOf(partsOf(bundleById(id)!, 'all'), false)), 'gcp').items.slice(1).map((i) => [i.key, i.name]));
    expect(names('data-warehouse')).toEqual({
      'service/site/storage_bucket/-/-/-': 'platform-billing-site-prod-ane3-gcs',
      'service/site/bigquery_dataset/-/-/-': 'billing_site_prod_ane3_bq',
      'service/site/service_account/-/-/sync': 'billing-site-prod-sa-sync',
      'service/site/scheduler_job/-/-/01': 'billing-site-prod-ane3-cron-01',
    });
    expect(names('event-pipeline')).toEqual({
      'service/site/pubsub_topic/-/-/01': 'billing-site-prod-topic-01',
      'service/site/pubsub_subscription/-/-/01': 'billing-site-prod-sub-01',
      'service/site/pubsub_topic/-/dlq/01': 'billing-site-prod-topic-dlq-01',
      'service/site/run_service/-/-/01': 'billing-site-prod-ane3-run-01',
      'service/site/service_account/-/-/sync': 'billing-site-prod-sa-sync',
    });
    expect(Object.keys(names('gke'))).toEqual([
      'project/-/vpc_network/-/-/01', 'project/-/subnet/-/-/01',
      'service/site/gke_cluster/-/-/01', 'service/site/artifact_registry_repository/-/-/01', 'service/site/service_account/-/-/sync', 'service/site/redis_instance/-/-/01',
    ]);
    expect(Object.keys(names('ci-cd'))).toEqual(['service/site/artifact_registry_repository/-/-/01', 'service/site/cloudbuild_trigger/-/-/01', 'service/site/service_account/-/-/sync', 'service/site/secret/-/-/01']);
    expect(Object.keys(names('batch-job'))).toEqual(['service/site/run_job/-/-/01', 'service/site/scheduler_job/-/-/01', 'service/site/service_account/-/-/sync']);
  });

  it('D114 — 긴 문맥값에서도 GKE 클러스터 이름은 40자 이하로 줄거나 실패(valid false)로 돌아온다 · 유효로 표시된 이름은 엔진 검사를 다시 지난다', () => {
    const gkeOf = (system: string, purpose: string) => {
      const plan: WizardPlan = { provider: 'gcp', project: { owner: 'platform', system, env: 'prod', region: 'asia-northeast3' }, projectPicks: [], services: [{ purpose, picks: partsOf(bundleById('gke')!, 'all').filter((p) => !partIsProject(p)).map(pickOf) }] };
      expect(validatePlan(plan), `${system} ${purpose}`).toEqual({ ok: true });
      const items = generateProject(expandPlan(plan), 'gcp').items;
      for (const i of items) if (i.valid) expect(validateName('gcp', i.resourceType, i.name).valid, `${i.key} ${i.name}`).toBe(true);
      const gke = items.find((i) => i.key.includes('/gke_cluster/'))!;
      expect(!gke.valid || gke.name.length <= 40, gke.name).toBe(true);
      return gke;
    };
    const shortened = gkeOf('customerbillingplatform', 'recommendationengine');
    expect(shortened).toMatchObject({ valid: true, isTruncated: true });
    expect(shortened.name.length).toBeLessThanOrEqual(40);
    // 축소 없이 40자를 넘는 입력 — 축소가 실제로 걸린다
    expect('customerbillingplatform-recommendationengine-prod-ane3-gke-01'.length).toBeGreaterThan(40);
    expect(shortened.name).toBe('customerbilli-recommendatio-prod-gke-01');
    // 입력 상한(40자) 둘 — 지역 토큰을 빼고 두 값을 고르게 줄여 40자 안에 든다
    expect(gkeOf('x'.repeat(40), 'y'.repeat(40))).toMatchObject({ name: 'xxxxxxxxxxxxx-yyyyyyyyyyyyy-prod-gke-01', valid: true, isTruncated: true });
  });
});
