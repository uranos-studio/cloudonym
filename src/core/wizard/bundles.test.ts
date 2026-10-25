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
  const base: Pick = { preset: p.preset, ...(p.tier === undefined ? {} : { tier: p.tier }), ...(p.role === undefined ? {} : { role: p.role }) };
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
  const own = parts.filter((p) => partIsProject(p));
  const project = [...(withNetwork ? NETWORK.filter((n) => !own.some((p) => partKey(p) === partKey(n))) : []), ...own];
  return { provider: 'gcp', project: PROJECT, projectPicks: project.map(pickOf), services: [{ purpose: 'site', picks: parts.filter((p) => !partIsProject(p)).map(pickOf) }] };
}

describe('카드 데이터 (D93)', () => {
  it('1차 카드 다섯 + D114 의 다섯 — id 는 고유 · 갤러리 순서', () => {
    expect(BUNDLES.map((b) => b.id)).toEqual(['website', 'serverless-web', 'static-site', 'website-mig', 'vm-app', 'https-lb', 'data-warehouse', 'gke', 'event-pipeline', 'ci-cd', 'batch-job', 'task-queue']);
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
    expect(count('website').filter((p) => partIsProject(p)).map(partKey)).toEqual(['firewall:web', 'firewall:lbhc']);
    expect(count('serverless-web').filter((p) => !partIsProject(p)).length).toBe(11);
    expect(count('serverless-web').filter((p) => partIsProject(p))).toEqual([]);
    expect(count('static-site').filter((p) => !partIsProject(p)).length).toBe(10);
    // Cloud Run · 버킷 백엔드에는 헬스 체크가 없다 — 서버리스 NEG 백엔드는 헬스 체크를 둘 수 없다(공식 문서)
    expect(count('serverless-web').map(partKey)).not.toContain('hc');
    expect(count('static-site').map(partKey)).not.toContain('bs');
  });

  it('참조는 카드의 부품(필수 · 선택 · 백엔드)이나 vpc 만 가리킨다 · 근거는 https URL', () => {
    for (const b of BUNDLES) {
      const keys = new Set([...b.parts, ...b.options.flatMap((o) => o.parts), ...(b.backends ?? []).flatMap((x) => [{ preset: x.needs }, ...x.parts])].map(partKey));
      for (const r of b.refs) {
        expect(keys.has(r.from), `${b.id} ${r.from}`).toBe(true);
        expect(r.to === 'vpc' || keys.has(r.to), `${b.id} ${r.to}`).toBe(true);
        expect(r.evidence, `${b.id} ${r.from}`).toMatch(/^https:\/\//);
      }
      expect(b.evidence.length, b.id).toBeGreaterThan(0);
    }
  });

  it('가족 lb 의 카드는 https-lb 의 백엔드 표와 같은 부품을 쓴다 — https-lb 앞쪽 + 그 백엔드 부품 ⊆ 고정 카드의 부품 · 백엔드 needs 가 카드의 첫 부품 (D127 — website-mig 은 템플릿 · 자동 확장이 더 있다)', () => {
    const lb = bundleById('https-lb')!;
    for (const [id, needs] of [['website', 'web'], ['serverless-web', 'run'], ['static-site', 'object'], ['website-mig', 'mig']] as const) {
      const backend = lb.backends!.find((x) => x.needs === needs)!;
      const card = new Set(bundleById(id)!.parts.map(partKey));
      for (const k of [needs, ...lb.parts.map(partKey), ...backend.parts.map(partKey)]) expect(card.has(k), `${id} ${k}`).toBe(true);
      expect(bundleById(id)!.family, id).toBe('lb');
      // 되읽기는 첫 부품을 그 카드의 백엔드로 본다(wizardBundles.cardsIn)
      expect(bundleById(id)!.parts[0]!.preset, id).toBe(needs);
    }
    // 옛 셋은 등식 그대로 — 고정 카드 = https-lb + 그 백엔드
    for (const [id, needs] of [['website', 'web'], ['serverless-web', 'run'], ['static-site', 'object']] as const) {
      const backend = lb.backends!.find((x) => x.needs === needs)!;
      expect(new Set(bundleById(id)!.parts.map(partKey)), id).toEqual(new Set([needs, ...lb.parts.map(partKey), ...backend.parts.map(partKey)]));
    }
    expect(bundleById('vm-app')!.family).toBeUndefined();
  });

  it('실제로 만들어 본 카드(tested)는 열둘 전부 (D91 · D96 · D117 · D128) — https-lb 는 이 카드 계획으로 백엔드 셋(run · web · object)과 함께 만들었다', () => {
    expect(BUNDLES.filter((b) => b.tested).map((b) => b.id)).toEqual(BUNDLES.map((b) => b.id));
    expect(BUNDLES).toHaveLength(12);
    // D128 — 2026-10-23 실배포 시험(https-lb 의 web · object 백엔드 · task-queue · website-mig · 역할별 계정)
    for (const id of ['https-lb', 'task-queue', 'website-mig']) expect(bundleById(id)!.evidence, id).toContain('D128');
    expect(bundleById('https-lb')!.testedWith!.map((r) => [r.on, r.backend])).toEqual([['2026-10-16', 'run'], ['2026-10-23', 'web'], ['2026-10-23', 'object']]);
    expect(bundleById('task-queue')!.testedWith).toEqual([expect.objectContaining({ on: '2026-10-23', options: ['api'] })]);
    expect(bundleById('website-mig')!.testedWith).toEqual([expect.objectContaining({ on: '2026-10-23', options: [] })]);
    for (const id of ['ci-cd', 'batch-job', 'event-pipeline']) expect(bundleById(id)!.testedWith!.at(-1), id).toEqual(expect.objectContaining({ on: '2026-10-23', options: ['roles'] }));
    // D117 — 2026-10-16 실배포 시험(카드마다 만들고 동작을 보고 지웠다)
    for (const id of ['website', 'serverless-web', 'static-site', 'vm-app', 'data-warehouse', 'gke', 'event-pipeline', 'ci-cd', 'batch-job']) expect(bundleById(id)!.evidence, id).toContain('D117');
    for (const id of ['serverless-web', 'static-site']) expect(bundleById(id)!.evidence, id).toContain('D96');
  });

  it('D123 — tested 인 카드는 시험 기록(testedWith)이 하나 이상 · 기록의 선택은 그 카드의 선택 id · backend 는 백엔드 needs · 날짜는 YYYY-MM-DD', () => {
    for (const b of BUNDLES) {
      if (b.tested) expect(b.testedWith?.length ?? 0, b.id).toBeGreaterThan(0);
      else expect(b.testedWith, b.id).toBeUndefined();
      const ids = new Set(b.options.map((o) => o.id));
      for (const r of b.testedWith ?? []) {
        expect(r.on, b.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        for (const o of r.options) expect(ids.has(o), `${b.id} ${o}`).toBe(true);
        if (r.backend !== undefined) expect((b.backends ?? []).map((x) => x.needs), b.id).toContain(r.backend);
      }
    }
    // 2026-10-16 실배포 — website 는 db 선택을 덮지 않았다(같은 프리셋을 vm-app 에서 시험)
    expect(bundleById('website')!.testedWith).toEqual([expect.objectContaining({ on: '2026-10-16', options: ['was', 'bastion'] })]);
    expect(bundleById('ci-cd')!.testedWith!.map((r) => r.on)).toEqual(['2026-10-16', '2026-10-17', '2026-10-23']);
  });

  it('D125 — Async task queue: 큐 · 처리 서비스(handler) · 서비스 계정 · API 서비스(run) 선택 켜짐 · 나머지 꺼짐 · 실배포 시험 지남(D128)', () => {
    const b = bundleById('task-queue')!;
    expect(b.parts.map(partKey)).toEqual(['queue', 'handler', 'sa']);
    expect(b.options.map((o) => [o.id, o.on, o.parts.map(partKey)])).toEqual([['api', true, ['run']], ['appdata', false, ['appdata']], ['secret', false, ['secret']], ['fs', false, ['fs']], ['roles', false, ['sa@push']]]);
    expect(b.tested).toBe(true);
    expect(b.family).toBeUndefined();
    expect(b.refs).toContainEqual(expect.objectContaining({ from: 'queue', to: 'handler', attr: 'http_target.uri_override' }));
  });

  it('D127 — Website (autoscaling): 템플릿 · 리전 MIG · 자동 확장 + https-lb 앞쪽 · 백엔드 mig 를 https-lb 가 받는다 · 실배포 시험 지남(D128)', () => {
    const b = bundleById('website-mig')!;
    expect(b.label).toBe('Website (autoscaling)');
    expect(b.family).toBe('lb');
    expect(b.tested).toBe(true);
    expect(b.parts.map(partKey)).toEqual(['mig', 'tpl', 'as', 'hc', 'bs', 'ip', 'url', 'cert', 'thps', 'fwd', 'urlredir', 'thp', 'fwdredir', 'firewall:web', 'firewall:lbhc']);
    expect(b.options.map((o) => [o.id, o.on])).toEqual([['db', false], ['bastion', false], ['armor', false]]);
    expect(bundleById('https-lb')!.backends!.map((x) => x.needs)).toEqual(['web', 'run', 'object', 'mig']);
    expect(b.refs).toContainEqual(expect.objectContaining({ from: 'mig', to: 'tpl', attr: 'version.instance_template' }));
    expect(b.refs).toContainEqual(expect.objectContaining({ from: 'as', to: 'mig', attr: 'target' }));
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

  it('D124 — 숨은 규칙의 선택: 웹 카드의 Cloud Armor · Database name and user · Firestore · 정적 사이트의 엣지 정책 · 전부 기본 꺼짐', () => {
    const opts = (id: string) => Object.fromEntries(bundleById(id)!.options.map((o) => [o.id, [o.on, o.parts.map(partKey)]]));
    expect(opts('website')).toMatchObject({ armor: [false, ['waf']], dbuser: [false, ['sqldb', 'sqluser']] });
    expect(opts('serverless-web')).toMatchObject({ fs: [false, ['fs']], armor: [false, ['waf']], dbuser: [false, ['sqldb', 'sqluser']] });
    expect(opts('static-site')).toEqual({ armor: [false, ['wafedge']] });
    expect(bundleById('static-site')!.refs).toContainEqual(expect.objectContaining({ from: 'bb', to: 'wafedge', attr: 'edge_security_policy' }));
    expect(bundleById('website')!.refs).toContainEqual(expect.objectContaining({ from: 'bs', to: 'waf', attr: 'security_policy' }));
    expect(bundleById('data-warehouse')!.refs).toContainEqual(expect.objectContaining({ from: 'key', to: 'ring', attr: 'key_ring' }));
  });

  it('이 릴리스(D124 · D125 · D126 · D127)에서 더한 선택은 전부 기본 꺼짐 — 옛 카드의 기본 이름 수가 바뀌지 않는다 (task-queue 의 API 서비스만 켜짐 · 새 카드)', () => {
    const NEW = new Set(['armor', 'dbuser', 'fs', 'kms', 'roles', 'appdata', 'secret']);
    for (const b of BUNDLES) for (const o of b.options) if (NEW.has(o.id) && !(b.id === 'website' && o.id === 'db')) expect(o.on, `${b.id} ${o.id}`).toBe(false);
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

  it('D114 의 새 카드 다섯 — 필수 부품 · 선택 · 실배포 시험을 지남(tested true · D117)', () => {
    const shape = (id: string) => { const b = bundleById(id)!; return { parts: b.parts.map(partKey), options: b.options.map((o) => [o.id, o.on, o.parts.map(partKey)]), tested: b.tested, family: b.family }; };
    // D116 — 적재 버킷 raw · 예약 적재 ingest · push 대상 Cloud Run worker (같은 서비스의 Static site · Batch job · Serverless web 과 이름이 나뉜다)
    expect(shape('data-warehouse')).toEqual({ parts: ['raw', 'bq', 'sa'], options: [['schedule', false, ['ingest']], ['kms', false, ['ring', 'key']], ['roles', false, ['sa@cron']]], tested: true, family: undefined });
    expect(shape('gke')).toEqual({ parts: ['gke', 'ar', 'sa', 'vpc', 'subnet'], options: [['cache', false, ['redis']]], tested: true, family: undefined });
    // D117 — 데드레터 토픽에 구독이 없으면 넘어간 메시지가 사라진다(실배포 시험 · pubsub/docs/handling-failures) — 데드레터 구독 dlqsub 가 필수다
    expect(shape('event-pipeline')).toEqual({ parts: ['topic', 'sub', 'dlq', 'dlqsub', 'worker', 'sa'], options: [['roles', false, ['sa@push']]], tested: true, family: undefined });
    // D116 — Internal app 은 내부 전용 서버 intweb · intwas 와 버킷 appdata (같은 서비스의 Website 와 이름이 나뉜다)
    // D117 — 네트워크 안의 웹 · 앱 포트를 여는 방화벽 internal 이 없으면 bastion 에서도 intweb · intwas 의 HTTP 가 막힌다(실배포 시험)
    expect(shape('vm-app')).toMatchObject({ parts: ['intweb', 'intwas', 'db', 'firewall:ssh', 'firewall:icmp', 'firewall:iap', 'firewall:internal', 'psa'], options: [['bastion', true, ['bastion']], ['file', false, ['file']], ['object', false, ['appdata']], ['dbuser', false, ['sqldb', 'sqluser']]], tested: true });
    // D119 — GitHub 연결은 선택(webhook · 1세대 트리거는 연결 없이 된다) — 연결 conn 과 연결된 저장소 repo
    expect(shape('ci-cd')).toEqual({ parts: ['ar', 'build', 'sa'], options: [['secret', false, ['secret']], ['github', false, ['conn', 'repo']], ['roles', false, ['sa@build']]], tested: true, family: undefined });
    expect(shape('batch-job')).toEqual({ parts: ['runjob', 'cron', 'sa'], options: [['roles', false, ['sa@cron']]], tested: true, family: undefined });
    // 네트워크(vpc · subnet)는 프로젝트 공용 자리다 — 첫 화면에 이미 있으면 카드가 더하지 않는다
    expect(bundleById('gke')!.parts.filter((p) => partIsProject(p)).map(partKey)).toEqual(['vpc', 'subnet']);
  });

  it('D114 — 카드를 펼친 이름: 데이터셋은 밑줄 · 버킷과 나머지는 하이픈 · 데드레터 토픽은 토픽과 키 · 이름이 다르다', () => {
    const names = (id: string) => Object.fromEntries(generateProject(expandPlan(planOf(partsOf(bundleById(id)!, 'all'), false)), 'gcp').items.slice(1).map((i) => [i.key, i.name]));
    expect(names('data-warehouse')).toEqual({
      'service/site/storage_bucket/-/raw/-': 'platform-billing-site-prod-ane3-gcs-raw',
      'service/site/bigquery_dataset/-/-/-': 'billing_site_prod_ane3_bq',
      'service/site/service_account/-/-/sync': 'billing-site-prod-sa-sync',
      'service/site/scheduler_job/-/ingest/01': 'billing-site-prod-ane3-cron-ingest-01',
      // D124 — Encryption key (KMS) 선택: 키 링은 위치 범위(지역 토큰) · 키는 키 링 안
      'service/site/kms_key_ring/-/-/01': 'billing-site-prod-ane3-ring-01',
      'service/site/kms_crypto_key/-/-/01': 'billing-site-prod-key-01',
      // D126 — 역할별 서비스 계정 선택: 실행 계정(sync) 옆에 스케줄러 호출 계정이 더해진다
      'service/site/service_account/-/-/cron': 'billing-site-prod-sa-cron',
    });
    expect(names('event-pipeline')).toEqual({
      'service/site/pubsub_topic/-/-/01': 'billing-site-prod-topic-01',
      'service/site/pubsub_subscription/-/-/01': 'billing-site-prod-sub-01',
      'service/site/pubsub_topic/-/dlq/01': 'billing-site-prod-topic-dlq-01',
      'service/site/pubsub_subscription/-/dlq/01': 'billing-site-prod-sub-dlq-01',
      'service/site/run_service/-/worker/01': 'billing-site-prod-ane3-run-worker-01',
      'service/site/service_account/-/-/sync': 'billing-site-prod-sa-sync',
      'service/site/service_account/-/-/push': 'billing-site-prod-sa-push',
    });
    expect(Object.keys(names('gke'))).toEqual([
      'project/-/vpc_network/-/-/01', 'project/-/subnet/-/-/01',
      'service/site/gke_cluster/-/-/01', 'service/site/artifact_registry_repository/-/-/01', 'service/site/service_account/-/-/sync', 'service/site/redis_instance/-/-/01',
    ]);
    expect(Object.keys(names('ci-cd'))).toEqual(['service/site/artifact_registry_repository/-/-/01', 'service/site/cloudbuild_trigger/-/-/01', 'service/site/service_account/-/-/sync', 'service/site/secret/-/-/01', 'service/site/cloudbuild_connection/-/-/01', 'service/site/cloudbuild_repository/-/-/01', 'service/site/service_account/-/-/build']);
    // D119 — 연결은 지역 토큰 · 저장소는 부모(연결)의 위치를 물려받아 지역 토큰이 없다
    const ci = names('ci-cd');
    expect(ci['service/site/cloudbuild_connection/-/-/01']).toBe('billing-site-prod-ane3-conn-01');
    expect(ci['service/site/cloudbuild_repository/-/-/01']).toBe('billing-site-prod-repo-01');
    expect(Object.keys(names('batch-job'))).toEqual(['service/site/run_job/-/-/01', 'service/site/scheduler_job/-/-/01', 'service/site/service_account/-/-/sync', 'service/site/service_account/-/-/cron']);
  });

  it('D119 — 저장소는 연결을 · 트리거는 저장소를 가리킨다', () => {
    const ci = bundleById('ci-cd')!;
    expect(ci.refs).toContainEqual(expect.objectContaining({ from: 'repo', to: 'conn', attr: 'parent_connection' }));
    expect(ci.refs).toContainEqual(expect.objectContaining({ from: 'build', to: 'repo', attr: 'repository_event_config.repository' }));
    expect(ci.evidence).toContain('D119');
  });

  it('D117 — 데드레터 구독은 데드레터 토픽을 가리킨다 · vm-app 과 website 의 App server 선택에는 internal 방화벽이 있다', () => {
    const ep = bundleById('event-pipeline')!;
    expect(ep.refs).toContainEqual(expect.objectContaining({ from: 'dlqsub', to: 'dlq', attr: 'topic' }));
    expect(bundleById('vm-app')!.parts.filter((p) => partIsProject(p)).map(partKey)).toContain('firewall:internal');
    // website 의 App server 선택도 같다 — web → was 는 네트워크 안의 통신이라 GFE 대역만 받는 web 방화벽으로는 닿지 않는다(실배포 시험)
    expect(bundleById('website')!.options.find((o) => o.id === 'was')!.parts.map(partKey)).toEqual(['was', 'firewall:internal']);
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
