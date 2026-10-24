// 첫 방문 예시 (D108) — 예시 계획의 이름은 전부 엔진의 valid:true · 카드는 갤러리와 같은 보통 pick · Clear 의 빈 상태는 hash 에 실리지 않는다
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { generateProject, parseProjectContext } from '../core/engine';
import { expandPlan, validatePlan } from '../core/wizard/plan';
import { samplePlan, SAMPLE_CARD, SAMPLE_CHIPS_AWS, SAMPLE_PROJECT, SAMPLE_PROJECTS } from './wizardSample';
import { cardsIn } from './wizardBundles';
import { addBundle, cardIn } from './wizardBundles';
import * as S from './wizardState';
import { encodeWizardState } from './urlState';
import { firstSelection } from './wizardSelection';
import { ProjectForm } from './WizardSettings';
import { en } from '../messages/en';
import { VERSION } from '../version';

describe('첫 방문 예시 계획 (D108)', () => {
  const plan = samplePlan();
  it('입력 넷 · 서비스 하나(shop) · 네트워크 미리 채움 넷(D90)', () => {
    expect(plan.project).toEqual({ owner: 'demo', system: 'payment', env: 'prod', region: 'asia-northeast3' });
    expect(plan.project).toEqual(SAMPLE_PROJECT);
    expect(plan.services.map((x) => x.purpose)).toEqual([S.EXAMPLE_SERVICE]);
    expect(plan.projectPicks.map((p) => p.preset)).toEqual(['vpc', 'subnet', 'router', 'nat']);
  });
  it('카드는 사용자가 갤러리에서 더한 것과 같다 — 빈 첫 화면에 addBundle 한 결과 · 읽어 들이면 완성된 serverless-web', () => {
    expect(plan).toEqual(addBundle(S.startPlan(SAMPLE_PROJECT), 0, SAMPLE_CARD));
    const card = cardIn(plan, 0, SAMPLE_CARD);
    expect(card).toBeDefined();
    expect(card!.missing).toEqual([]);
  });
  it('첫 방문 상태의 이름은 전부 엔진의 valid:true — 유효하지 않은 이름을 예시로 보이지 않는다', () => {
    expect(validatePlan(plan).ok).toBe(true);
    expect(parseProjectContext(plan.project, 'gcp').ok).toBe(true);
    const { items } = generateProject(expandPlan(plan), 'gcp');
    expect(items.length).toBe(16);
    for (const it of items) expect(it.valid, `${it.key} ${it.name}`).toBe(true);
    // 검사기 자체 — 같은 길에서 틀린 값은 valid:false 가 나온다(위 단언이 공허하지 않다)
    // 숫자로 시작하는 owner 는 프로젝트 ID 규칙(첫 글자는 영문 소문자)에 걸린다 — 엔진이 valid:false 로 돌려준다
    const bad = generateProject(expandPlan({ ...plan, project: { ...plan.project, owner: '1abc' } }), 'gcp').items;
    expect(bad.filter((i) => !i.valid).map((i) => i.key)).toEqual(['project/-/project_id/-/-/-']);
  });
  it('예시 계획은 hash 로 실릴 수 있다 — 그래서 화면이 「손대지 않은 동안」 쓰지 않는다(Wizard 의 sample 상태)', () => {
    expect(encodeWizardState(plan, VERSION.rules, ['prod'])).toBeTruthy();
    // 첫 오류 규칙은 첫 서비스를 고른다 — 화면은 첫 방문에 Project 를 직접 고른다(Example · Clear 가 거기 있다)
    expect(firstSelection(plan)).toBe('services[0]');
  });
  it('Clear 의 목적지는 D97 의 빈 첫 화면이다 — 빈 값 · 카드 없음 · hash 에 실리지 않는다', () => {
    const empty = S.startPlan();
    expect(empty.project).toEqual(S.EMPTY_PROJECT);
    expect(empty.services).toEqual([{ purpose: S.EXAMPLE_SERVICE, picks: [] }]);
    expect(encodeWizardState(empty, VERSION.rules, [])).toBeUndefined();
  });
});

describe('클라우드별 예시 계획 (D129) — GCP 길은 그대로 · AWS 는 칩 다섯', () => {
  it('인자 없음 = gcp — 지금의 예시와 같은 객체', () => {
    expect(samplePlan('gcp')).toEqual(samplePlan());
    expect(samplePlan().provider).toBe('gcp');
    expect(SAMPLE_PROJECTS.gcp).toEqual(SAMPLE_PROJECT);
  });
  const aws = samplePlan('aws');
  it('AWS — 같은 값 셋(demo · payment · prod)에 지역만 ap-northeast-2 · 네트워크 다섯 · 서비스 shop 하나에 칩 다섯', () => {
    expect(aws.provider).toBe('aws');
    expect(aws.project).toEqual({ owner: 'demo', system: 'payment', env: 'prod', region: 'ap-northeast-2' });
    expect(SAMPLE_PROJECTS.aws).toEqual(aws.project);
    expect(aws.projectPicks.map((p) => p.preset)).toEqual(['vpc', 'subnet', 'igw', 'rt', 'nat']);
    expect(aws.services.map((x) => x.purpose)).toEqual([S.EXAMPLE_SERVICE]);
    expect(SAMPLE_CHIPS_AWS).toEqual(['web', 'lb', 'tg', 'db', 'object']);
    expect(aws.services[0]!.picks.map((p) => p.preset)).toEqual([...SAMPLE_CHIPS_AWS]);
    // 칩은 사용자가 칩 칸에서 켜는 것과 같은 togglePreset 이다 — 숨은 기본값이 아니다
    expect(aws).toEqual(SAMPLE_CHIPS_AWS.reduce((p, c) => S.togglePreset(p, 0, c), S.startPlan(SAMPLE_PROJECTS.aws, 'aws')));
    // 카드는 GCP 전용이다
    expect(cardsIn(aws, 0)).toEqual([]);
  });
  it('AWS 예시의 이름은 정확히 10 · 전부 엔진의 valid:true · 계획 문서 §2.4 의 이름 그대로', () => {
    expect(validatePlan(aws).ok).toBe(true);
    expect(parseProjectContext(aws.project, 'aws').ok).toBe(true);
    const { items } = generateProject(expandPlan(aws), 'aws');
    expect(items.map((i) => [i.key, i.name])).toEqual([
      ['project/-/vpc/-/-/01', 'payment-prod-apne2-vpc-01'],
      ['project/-/subnet/-/-/01', 'payment-prod-apne2-snet-01'],
      ['project/-/internet_gateway/-/-/01', 'payment-prod-apne2-igw-01'],
      ['project/-/route_table/-/-/01', 'payment-prod-apne2-rt-01'],
      ['project/-/ec2_nat_gateway/-/-/01', 'payment-prod-apne2-nat-01'],
      ['service/shop/ec2_instance/-/web/01', 'payment-shop-prod-apne2-ec2-web-01'],
      ['service/shop/elbv2_load_balancer/-/-/01', 'payment-shop-prod-apne2-lb-01'],
      ['service/shop/elbv2_target_group/-/-/01', 'payment-shop-prod-apne2-tg-01'],
      ['service/shop/rds_instance/-/-/01', 'payment-shop-prod-apne2-rds-01'],
      ['service/shop/s3_bucket/-/-/-', 'demo-payment-shop-prod-s3'],
    ]);
    for (const it of items) expect(it.valid, `${it.key} ${it.name}`).toBe(true);
    // 검사기 자체 — 같은 길에서 틀린 값은 valid:false 가 나온다(2026-10-24 실측). 숫자로 시작하는 system 은
    // RDS DB 인스턴스 식별자 규칙(첫 글자는 영문)에 걸린다 — 정규화 · 3단계 축소가 고치지 않고 엔진이 valid:false 로 돌려준다
    const bad = generateProject(expandPlan({ ...aws, project: { ...aws.project, system: '1abc' } }), 'aws').items;
    expect(bad.filter((i) => !i.valid).map((i) => i.key)).toEqual(['service/shop/rds_instance/-/-/01']);
  });
  it('AWS 예시도 hash 로 실릴 수 있다 — 링크 · Share 가 같은 계획을 낸다', () => {
    expect(encodeWizardState(aws, VERSION.rules, ['prod'])).toBeTruthy();
  });
});

describe('Project 칸의 「Example」 표시 · Clear (D108)', () => {
  const noop = () => {};
  const form = (onClearSample?: () => void) => renderToStaticMarkup(createElement(ProjectForm, {
    plan: samplePlan(), envs: ['prod'], onToggleEnv: noop, errors: [], projectIds: [], projectNames: [], suffixErrors: [], onSuffix: noop, onChange: noop, onTouch: noop,
    ...(onClearSample ? { onClearSample } : {}),
  }));
  it('onClearSample 를 받으면 표시 · 설명 · Clear 단추 · 안 받으면(손댔거나 링크) 없다', () => {
    const m = form(noop);
    expect(m).toContain('data-sample-marker');
    expect(m).toContain(`>${en.ui.wizard_sample_badge}</span>`);
    expect(m).toContain(en.ui.wizard_sample_note);
    expect(/<button[^>]*data-sample-clear[^>]*>/.exec(m)?.[0]).toContain(`aria-label="${en.ui.wizard_sample_clear_label}"`);
    expect(form()).not.toContain('data-sample-marker');
  });
});
