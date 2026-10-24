// AWS 마법사 화면 (0.2) — 클라우드 바꾸기 · 링크(c) · 계획 파일 · 칩 · 카드가 provider 를 따른다
import { describe, it, expect } from 'vitest';
import * as S from './wizardState';
import { decodeWizardState, encodeWizardState, HASH_KEY } from './urlState';
import { openPlanFile, savePlan } from './planFile';
import { cardsIn } from './wizardBundles';
import { canonicalRegion } from '../core/regions';
import { validatePlan, type WizardPlan } from '../core/wizard/plan';
import { generateProject } from '../core/engine';
import { expandPlan } from '../core/wizard/plan';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ServiceSettings } from './WizardSettings';

const PROJECT = { owner: 'platform', system: 'billing', env: 'prod', region: 'ap-northeast-2' };
const awsOk = (r: string) => canonicalRegion(r, 'aws') !== undefined;

function awsPlan(): WizardPlan {
  let p = S.startPlan(PROJECT, 'aws');
  p = S.togglePreset(p, 0, 'web');
  p = S.togglePreset(p, 0, 'object');
  return p;
}

describe('AWS 시작 계획 · 칩', () => {
  it('첫 네트워크는 AWS 프리셋 다섯 · 칩은 AWS 표 · 이름이 나온다', () => {
    const p = awsPlan();
    expect(p.provider).toBe('aws');
    expect(p.projectPicks.map((x) => x.preset)).toEqual(['vpc', 'subnet', 'igw', 'rt', 'nat']);
    expect(validatePlan(p)).toEqual({ ok: true });
    const names = generateProject(expandPlan(p), 'aws').items.map((i) => i.name);
    expect(names).toContain('billing-shop-prod-apne2-ec2-web-01');
    expect(S.presetsAt('aws', 'service').map((x) => x.id)).not.toContain('run');
    expect(S.pickTitle(p.projectPicks[0]!, 'aws').title).toBe('VPC');
    expect(S.canAttach(p.services[0]!.picks[0]!, 'aws')).toBe(true);
    expect(S.projectPreview({ owner: 'a', system: 'b', env: 'prod', region: 'apne2' }, undefined, 'aws')).toEqual({ name: undefined, id: undefined });
  });
  it('카드(묶음)는 GCP 계획에서만 맞춘다 — AWS 의 web · db 는 카드가 아니다', () => {
    let p = awsPlan();
    p = S.togglePreset(p, 0, 'db');
    expect(cardsIn(p, 0)).toEqual([]);
  });
  it('custom 트리 — AWS 규칙만 · 프로젝트 칸은 계정 · 리전 · VPC 범위', () => {
    const ids = (t: ReturnType<typeof S.customTree>): string[] => JSON.stringify(t).match(/"aws\.[a-z0-9_]+"/g) ?? [];
    expect(ids(S.customTree('aws', 'service')).length).toBeGreaterThan(100);
    expect(JSON.stringify(S.customTree('aws', 'service'))).not.toMatch(/"gcp\./);
    expect(S.customTree('gcp', 'service')).toBe(S.CUSTOM_TREE);
  });
});

describe('클라우드 바꾸기', () => {
  it('pick 을 지우고 그 CSP 의 첫 네트워크 · 못 푸는 지역은 비운다 · 같은 CSP 면 그대로', () => {
    const gcp = S.startPlan({ ...PROJECT, region: 'asia-northeast3' });
    const a = S.switchProvider(gcp, 'aws', awsOk);
    expect(a.provider).toBe('aws');
    expect(a.project).toEqual({ ...PROJECT, region: '' });
    expect(a.projectPicks.map((x) => x.preset)).toEqual(['vpc', 'subnet', 'igw', 'rt', 'nat']);
    expect(a.services).toEqual([{ purpose: 'shop', picks: [] }]);
    expect(S.switchProvider(a, 'aws', awsOk)).toBe(a);
    const back = S.switchProvider({ ...a, project: PROJECT }, 'gcp', (r) => canonicalRegion(r, 'gcp') !== undefined);
    expect(back.provider).toBe('gcp');
    expect(back.project.region).toBe('');
    expect(back.projectPicks.map((x) => x.preset)).toEqual(['vpc', 'subnet', 'router', 'nat']);
  });
  it('switchLoses — 바꾸면 사라질 것이 있을 때만 묻는다: 손댄 네트워크 · 둘째 서비스 · 서비스 pick · custom · 접미사', () => {
    const start = S.startPlan({ ...PROJECT, region: 'asia-northeast3' });
    expect(S.switchLoses(start)).toBe(false);
    expect(S.switchLoses(S.initialPlan(PROJECT))).toBe(false);
    expect(S.switchLoses(S.startPlan(PROJECT, 'aws'))).toBe(false);
    // 네트워크 프리셋만 고친 계획 — 서비스 pick 은 없다
    expect(S.switchLoses(S.togglePreset(start, null, 'firewall'))).toBe(true);
    expect(S.switchLoses(S.addSlot(start, { service: null, pick: 1 }))).toBe(true);
    // 네트워크를 비운 계획은 잃을 것이 없다 — 바꾸면 새 CSP 의 첫 네트워크가 붙을 뿐이다
    expect(S.switchLoses(S.clearNetwork(start))).toBe(false);
    expect(S.switchLoses({ ...start, services: [...start.services, { purpose: 'api', picks: [] }] })).toBe(true);
    expect(S.switchLoses(S.togglePreset(start, 0, 'web'))).toBe(true);
    expect(S.switchLoses({ ...start, projectIdSuffix: 'x1' })).toBe(true);
  });
});

describe('링크 · 계획 파일 — c 칸', () => {
  it('AWS 계획은 c:aws 를 싣고 같은 계획으로 풀린다 · GCP 링크에는 c 가 없다', () => {
    const p = awsPlan();
    const key = encodeWizardState(p, 'r1')!;
    expect(key).toBeDefined();
    const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0))));
    expect(json.c).toBe('aws');
    const d = decodeWizardState(`#${HASH_KEY}=${key}`)!;
    expect(d.provider).toBe('aws');
    // 링크는 지역을 코드로 싣는다
    expect(d.plan).toEqual({ ...p, project: { ...p.project, region: 'apne2' } });
    const gcpKey = encodeWizardState(S.startPlan({ ...PROJECT, region: 'asia-northeast3' }))!;
    const g = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(gcpKey.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0))));
    expect('c' in g).toBe(false);
  });
  it('c 가 마법사 CSP 가 아니면 깨진 링크 · AWS 링크의 GCP 리전은 깨진 링크', () => {
    const enc = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeWizardState(`#${HASH_KEY}=${enc({ c: 'azure', ...PROJECT, w: {} })}`)).toBeUndefined();
    expect(decodeWizardState(`#${HASH_KEY}=${enc({ c: 'aws', ...PROJECT, region: 'asia-northeast3', w: {} })}`)).toBeUndefined();
  });
  it('Save plan → Open plan 이 provider aws 를 지킨다', () => {
    const p = awsPlan();
    const saved = savePlan(encodeWizardState(p, 'r1')!, 'r1')!;
    expect(saved.file.provider).toBe('aws');
    const opened = openPlanFile(saved.text)!;
    expect(opened.provider).toBe('aws');
    expect(opened.plan).toEqual({ ...p, project: { ...p.project, region: 'apne2' } });
    expect(openPlanFile(JSON.stringify({ ...saved.file, provider: 'azure' }))).toBeUndefined();
  });
});

describe('네트워크 칸 문구 — CSP 별 (0.2)', () => {
  it('GCP 는 옛 문구 그대로 · AWS 는 AWS 문구이고 GCP 낱말이 없다', async () => {
    const { networkText } = await import('./wizardStyles');
    expect(networkText('gcp')).toEqual({ resourcesHint: 'VPC, subnets, router, NAT, firewall rules and the private services access range every service shares', firewallTiers: 'Firewall rules for' });
    const aws = networkText('aws');
    expect(aws.firewallTiers).toBe('Security groups for');
    const { nothingCreatedFor } = await import('./wizardStyles');
    expect(nothingCreatedFor('gcp')).toMatch(/nothing is created in Google Cloud/);
    expect(nothingCreatedFor('aws')).not.toMatch(/Google|GCP|bucket Check/);
    for (const t of Object.values(aws)) expect(t).not.toMatch(/Google|GCP|gcloud|project ID|router|firewall|private services/i);
  });
});

describe('AWS 서비스 칸 — 카드가 없어 칩이 주 경로다', () => {
  const markup = (plan: WizardPlan) => renderToStaticMarkup(createElement(ServiceSettings, { index: 0, plan, errors: [], contextErrors: [], edit: () => {}, onCustom: () => {}, onSelect: () => {} }));
  it('AWS 는 칩 칸(details[data-add-more])이 펼친 채로 그려진다 · GCP 는 카드가 주 경로라 접힌 채다', () => {
    expect(markup(awsPlan())).toMatch(/<details data-add-more="true" open=""/);
    expect(markup(S.startPlan(PROJECT))).toMatch(/<details data-add-more="true" class=/);
  });
});
