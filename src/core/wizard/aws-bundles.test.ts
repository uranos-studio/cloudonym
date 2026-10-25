// AWS 카드 데이터 (D141) — GCP 카드 표(bundles.test)와 같은 성질을 AWS 표에서 센다: 부품은 AWS 프리셋에 있고 · 참조는 카드의 부품만 가리키고 · 카드 하나로 만든 계획은 엔진 검사를 지난다
import { describe, it, expect } from 'vitest';
import { AWS_BUNDLES, BUNDLES, bundleById, bundlesFor, partIsProject, partKey, type Bundle, type BundlePart } from './bundles';
import { presetOf } from './presets';
import { RULES } from '../constraints';
import { inputKind } from '../tree';
import { MAX_PICKS_PER_SERVICE, expandPlan, validatePlan, type Pick, type WizardPlan } from './plan';
import { generateProject } from '../engine';

const PROJECT = { owner: 'platform', system: 'billing', env: 'prod', region: 'ap-northeast-2' };
const NETWORK: BundlePart[] = [{ preset: 'vpc' }, { preset: 'subnet' }, { preset: 'igw' }, { preset: 'rt' }, { preset: 'nat' }];

function pickOf(p: BundlePart): Pick {
  const preset = presetOf(p.preset, 'aws')!;
  const base: Pick = { preset: p.preset, ...(p.tier === undefined ? {} : { tier: p.tier }), ...(p.role === undefined ? {} : { role: p.role }) };
  return inputKind(RULES[preset.ruleId]!) === 'count' ? { ...base, instances: [{ id: '1', seq: '01' }] } : base;
}
function partsOf(b: Bundle, opts: 'default' | 'all' | 'none' = 'default'): BundlePart[] {
  const out: BundlePart[] = [];
  const add = (p: BundlePart) => { if (!out.some((x) => partKey(x) === partKey(p))) out.push(p); };
  const backend = b.backends?.[0];
  if (backend) add({ preset: backend.needs });
  [...b.parts, ...(backend?.parts ?? [])].forEach(add);
  for (const o of b.options) if (opts === 'all' || (opts === 'default' && o.on)) o.parts.forEach(add);
  return out;
}
const isProject = (p: BundlePart) => partIsProject(p, 'aws');
function planOf(parts: BundlePart[], withNetwork = true): WizardPlan {
  const own = parts.filter(isProject);
  const project = [...(withNetwork ? NETWORK.filter((n) => !own.some((p) => partKey(p) === partKey(n))) : []), ...own];
  return { provider: 'aws', project: PROJECT, projectPicks: project.map(pickOf), services: [{ purpose: 'site', picks: parts.filter((p) => !isProject(p)).map(pickOf) }] };
}
const names = (id: string, opts: 'default' | 'all' | 'none' = 'all') => Object.fromEntries(generateProject(expandPlan(planOf(partsOf(bundleById(id, 'aws')!, opts), false)), 'aws').items.map((i) => [i.key, i.name]));

describe('AWS 카드 표 (D141)', () => {
  it('표는 CSP 마다 하나 — bundlesFor · bundleById 가 provider 를 받고 GCP 가 기본값이다', () => {
    expect(bundlesFor('gcp')).toBe(BUNDLES);
    expect(bundlesFor('aws')).toBe(AWS_BUNDLES);
    expect(bundlesFor('azure')).toEqual([]);
    expect(bundleById('website')).toBe(BUNDLES[0]);
    expect(bundleById('website', 'aws')).toBe(AWS_BUNDLES[0]);
    expect(bundleById('gke', 'aws')).toBeUndefined();
    expect(bundleById('eks')).toBeUndefined();
  });

  it('일곱 카드 — id 는 고유 · 갤러리 순서 · GCP 와 같은 id 는 같은 뜻(website · serverless-web · static-site · vm-app · https-lb)', () => {
    expect(AWS_BUNDLES.map((b) => b.id)).toEqual(['website', 'serverless-web', 'static-site', 'vm-app', 'https-lb', 'ecs-service', 'eks']);
    expect(AWS_BUNDLES.map((b) => b.label)).toEqual(['Website', 'Serverless web', 'Static site', 'Internal app on EC2', 'HTTPS load balancer', 'ECS service (Fargate)', 'EKS cluster']);
    expect(AWS_BUNDLES.map((b) => b.family)).toEqual(['lb', 'lb', undefined, undefined, 'lb', undefined, undefined]);
  });

  it('부품 · 선택 · 백엔드의 프리셋은 AWS 표에 있고 · tier 는 그 프리셋의 tier 칩 안 · 한 카드 안에서 부품이 겹치지 않는다 · GCP 전용 프리셋(run · ar · psa)이 없다', () => {
    for (const b of AWS_BUNDLES) {
      const all = [...b.parts, ...(b.backends ?? []).flatMap((x) => [{ preset: x.needs }, ...x.parts]), ...b.options.flatMap((o) => o.parts)];
      for (const p of all) {
        const preset = presetOf(p.preset, 'aws');
        expect(preset, `${b.id} ${p.preset}`).toBeDefined();
        expect(RULES[preset!.ruleId]!.provider, `${b.id} ${p.preset}`).toBe('aws');
        if (p.tier !== undefined) expect(preset!.tierChoices, `${b.id} ${partKey(p)}`).toContain(p.tier);
        else expect(preset!.tierChoices, `${b.id} ${p.preset}`).toBeUndefined();
      }
      const required = b.parts.map(partKey);
      expect(new Set(required).size, b.id).toBe(required.length);
      expect(b.evidence.length, b.id).toBeGreaterThan(0);
      expect(b.summary.length, b.id).toBeGreaterThan(20);
    }
  });

  it('참조는 카드의 부품이나 vpc 만 가리킨다 · 근거는 https URL', () => {
    for (const b of AWS_BUNDLES) {
      const keys = new Set([...b.parts, ...b.options.flatMap((o) => o.parts), ...(b.backends ?? []).flatMap((x) => [{ preset: x.needs }, ...x.parts])].map(partKey));
      for (const r of b.refs) {
        expect(keys.has(r.from), `${b.id} ${r.from}`).toBe(true);
        expect(r.to === 'vpc' || keys.has(r.to), `${b.id} ${r.to}`).toBe(true);
        expect(r.evidence, `${b.id} ${r.from}`).toMatch(/^https:\/\//);
      }
    }
  });

  it('카드의 꼴 — 필수 부품 · 선택 (설계 §3)', () => {
    const shape = (id: string) => { const b = bundleById(id, 'aws')!; return { parts: b.parts.map(partKey), options: b.options.map((o) => [o.id, o.on, o.parts.map(partKey)]) }; };
    expect(shape('website')).toEqual({ parts: ['web', 'tg', 'lb', 'lis', 'lisredir', 'cert', 'firewall:web', 'firewall:internal'], options: [['db', true, ['db', 'sng']], ['was', false, ['was']], ['bastion', false, ['bastion', 'firewall:ssh']], ['role', false, ['sa', 'prof']]] });
    expect(shape('serverless-web')).toEqual({ parts: ['fn', 'tg', 'lb', 'lis', 'lisredir', 'cert', 'sa', 'firewall:web'], options: [['db', false, ['db', 'sng']], ['secret', false, ['secret']], ['ddb', false, ['ddb']], ['lg', false, ['lg']]] });
    expect(shape('static-site')).toEqual({ parts: ['object'], options: [['kms', false, ['kms']]] });
    expect(shape('vm-app')).toEqual({ parts: ['intweb', 'intwas', 'db', 'sng', 'firewall:ssh', 'firewall:icmp', 'firewall:internal'], options: [['bastion', true, ['bastion']], ['file', false, ['file']], ['role', false, ['sa', 'prof']]] });
    expect(shape('https-lb')).toEqual({ parts: ['tg', 'lb', 'lis', 'lisredir', 'cert'], options: [] });
    expect(shape('ecs-service')).toEqual({ parts: ['ecs', 'svc', 'td', 'ecr', 'sa', 'lg', 'firewall:web'], options: [['secret', false, ['secret']], ['ddb', false, ['ddb']], ['roles', false, ['sa@task']]] });
    expect(shape('eks')).toEqual({ parts: ['eks', 'ng', 'ecr', 'sa', 'sa@node', 'vpc', 'subnet'], options: [['cache', false, ['redis']]] });
    expect(bundleById('https-lb', 'aws')!.backends!.map((x) => [x.needs, x.parts.map(partKey)])).toEqual([['web', ['firewall:web', 'firewall:internal']], ['fn', ['sa', 'firewall:web']]]);
  });

  it('가족 lb — 고정 카드 = https-lb 앞쪽 + 그 백엔드 · 백엔드 needs 가 카드의 첫 부품', () => {
    const lb = bundleById('https-lb', 'aws')!;
    for (const [id, needs] of [['website', 'web'], ['serverless-web', 'fn']] as const) {
      const backend = lb.backends!.find((x) => x.needs === needs)!;
      expect(new Set(bundleById(id, 'aws')!.parts.map(partKey)), id).toEqual(new Set([needs, ...lb.parts.map(partKey), ...backend.parts.map(partKey)]));
      expect(bundleById(id, 'aws')!.parts[0]!.preset, id).toBe(needs);
    }
  });

  it('카드 하나(기본 선택 · 선택 전부 · 선택 없음)를 첫 화면 네트워크 다섯 위에 얹으면 validatePlan 을 지나고 이름이 전부 유효 · 축소 없음 · 상한 안', () => {
    for (const b of AWS_BUNDLES) {
      for (const opts of ['default', 'all', 'none'] as const) {
        const plan = planOf(partsOf(b, opts));
        expect(validatePlan(plan), `${b.id} ${opts}`).toEqual({ ok: true });
        expect(plan.services[0]!.picks.length, b.id).toBeLessThanOrEqual(MAX_PICKS_PER_SERVICE);
        const items = generateProject(expandPlan(plan), 'aws').items;
        expect(items.every((i) => i.valid && !i.isTruncated), `${b.id} ${opts}`).toBe(true);
        expect(items.some((i) => i.resourceType === 'project_id')).toBe(false);
      }
    }
  });

  it('website 의 이름 — 리스너 둘은 tier(https · redir)로 나뉘고 인증서는 계정 범위라 지역 토큰이 없다 · 보안 그룹은 프로젝트 자리', () => {
    expect(names('website', 'none')).toEqual({
      'project/-/security_group/-/web/01': 'billing-prod-apne2-sg-web-01',
      'project/-/security_group/-/internal/01': 'billing-prod-apne2-sg-internal-01',
      'service/site/ec2_instance/-/web/01': 'billing-site-prod-apne2-ec2-web-01',
      'service/site/elbv2_target_group/-/-/01': 'billing-site-prod-apne2-tg-01',
      'service/site/elbv2_load_balancer/-/-/01': 'billing-site-prod-apne2-lb-01',
      'service/site/elbv2_listener/-/https/01': 'billing-site-prod-apne2-lsnr-https-01',
      'service/site/elbv2_listener/-/redir/01': 'billing-site-prod-apne2-lsnr-redir-01',
      'service/site/iam_server_certificate/-/-/01': 'billing-site-prod-cert-01',
    });
    const all = names('website');
    expect(all['service/site/rds_instance/-/-/01']).toBe('billing-site-prod-apne2-rds-01');
    expect(all['service/site/rds_db_subnet_group/-/-/01']).toBe('billing-site-prod-apne2-sng-01');
    expect(all['service/site/iam_role/-/-/sync']).toBe('billing-site-prod-role-sync');
    expect(all['service/site/iam_instance_profile/-/-/01']).toBe('billing-site-prod-prof-01');
    expect(all['project/-/security_group/-/ssh/01']).toBe('billing-prod-apne2-sg-ssh-01');
  });

  it('eks · ecs-service · serverless-web 의 이름 — 노드 역할은 role node · 작업 역할은 role task · 버킷은 owner 가 앞에 붙고 서비스에 하나', () => {
    expect(names('eks')).toEqual({
      'project/-/vpc/-/-/01': 'billing-prod-apne2-vpc-01',
      'project/-/subnet/-/-/01': 'billing-prod-apne2-snet-01',
      'service/site/eks_cluster/-/-/01': 'billing-site-prod-apne2-eks-01',
      'service/site/eks_nodegroup/-/-/01': 'billing-site-prod-apne2-ng-01',
      'service/site/ecr_repository/-/-/01': 'billing-site-prod-apne2-ecr-01',
      'service/site/iam_role/-/-/sync': 'billing-site-prod-role-sync',
      'service/site/iam_role/-/-/node': 'billing-site-prod-role-node',
      'service/site/elasticache_replication_group/-/-/01': 'billing-site-prod-apne2-ecrg-01',
    });
    expect(Object.keys(names('ecs-service'))).toEqual([
      'project/-/security_group/-/web/01',
      'service/site/ecs_cluster/-/-/01', 'service/site/ecs_service/-/-/01', 'service/site/ecs_task_definition/-/-/01', 'service/site/ecr_repository/-/-/01',
      'service/site/iam_role/-/-/sync', 'service/site/logs_log_group/-/-/01', 'service/site/secretsmanager_secret/-/-/01', 'service/site/dynamodb_table/-/-/01', 'service/site/iam_role/-/-/task',
    ]);
    const sw = names('serverless-web');
    expect(sw['service/site/lambda_function/-/-/01']).toBe('billing-site-prod-apne2-lambda-01');
    expect(sw['service/site/dynamodb_table/-/-/01']).toBe('billing-site-prod-apne2-ddb-01');
    expect(names('static-site')).toEqual({ 'service/site/s3_bucket/-/-/-': 'platform-billing-site-prod-s3', 'service/site/kms_key/-/-/01': 'billing-site-prod-apne2-kms-01' });
  });

  it('선택마다 서비스 부품이 하나 이상 · 카드마다 필수 서비스 부품이 하나 이상 · 가족 밖 카드끼리 부분집합이 아니다', () => {
    for (const b of AWS_BUNDLES) {
      for (const o of b.options) expect(o.parts.some((p) => !isProject(p)), `${b.id} ${o.id}`).toBe(true);
      expect([...b.parts, ...(b.backends ?? []).map((x) => ({ preset: x.needs }))].some((p) => !isProject(p)), b.id).toBe(true);
      expect(new Set(b.options.map((o) => o.id)).size, b.id).toBe(b.options.length);
    }
    const others = AWS_BUNDLES.filter((b) => b.family === undefined).map((b) => ({ id: b.id, keys: new Set(b.parts.filter((p) => !isProject(p)).map(partKey)) }));
    for (const a of others) for (const b of others) {
      if (a.id === b.id) continue;
      expect([...a.keys].every((k) => b.keys.has(k)), `${a.id} ⊂ ${b.id}`).toBe(false);
    }
  });

  it('D123 — tested 인 카드는 시험 기록(testedWith)이 하나 이상 · 기록의 선택은 그 카드의 선택 id · 날짜는 YYYY-MM-DD · 근거에 D141', () => {
    for (const b of AWS_BUNDLES) {
      expect(b.evidence, b.id).toContain('D141');
      if (b.tested) expect(b.testedWith?.length ?? 0, b.id).toBeGreaterThan(0);
      else expect(b.testedWith, b.id).toBeUndefined();
      const ids = new Set(b.options.map((o) => o.id));
      for (const r of b.testedWith ?? []) {
        expect(r.on, b.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        for (const o of r.options) expect(ids.has(o), `${b.id} ${o}`).toBe(true);
        if (r.backend !== undefined) expect((b.backends ?? []).map((x) => x.needs), b.id).toContain(r.backend);
      }
    }
  });

  it('partIsProject 는 provider 를 따른다 — igw · rt 는 AWS 에서 프로젝트 자리, GCP 표에는 없다', () => {
    expect(partIsProject({ preset: 'igw' }, 'aws')).toBe(true);
    expect(partIsProject({ preset: 'igw' })).toBe(false);
    expect(partIsProject({ preset: 'firewall', tier: 'web' }, 'aws')).toBe(true);
    expect(partIsProject({ preset: 'fn' }, 'aws')).toBe(false);
    expect(partIsProject({ preset: 'router' })).toBe(true);
  });
});
