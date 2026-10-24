import { describe, it, expect } from 'vitest';
import { ABOUT_PATH, API_PATH, NAMING_PATH, PICK_PATH, PRIVACY_PATH, routeOf } from './route';

describe('routeOf — pathname 으로 화면 · 이름 안내 · 개인정보를 고르고, 표에 없는 경로는 notFound (D57 · D106)', () => {
  it.each([
    ['/', 'home'], ['', 'home'], ['//', 'home'],
    ['/aws', 'aws'], ['/aws/', 'aws'], ['/gcp', 'gcp'], ['/gcp/', 'gcp'], ['/azure', 'notFound'], ['/azure/', 'notFound'], ['/aws/x', 'notFound'], ['/gcp/x', 'notFound'], ['/AWS', 'notFound'], ['/Gcp', 'notFound'], ['/google-cloud', 'notFound'], ['/index.html', 'notFound'], ['/docs', 'notFound'], ['/docs/naming/extra', 'notFound'], ['/privacy-policy', 'notFound'],
    [PICK_PATH, 'pick'], ['/pick/', 'pick'], ['/pick/x', 'notFound'], ['/picks', 'notFound'], ['/PICK', 'notFound'],
    [NAMING_PATH, 'naming'], ['/docs/naming/', 'naming'], [PRIVACY_PATH, 'privacy'], ['/privacy/', 'privacy'],
    [API_PATH, 'api'], ['/docs/api/', 'api'], ['/docs/api/x', 'notFound'], ['/docs/apis', 'notFound'], ['/robots.txt', 'notFound'],
    [ABOUT_PATH, 'about'], ['/about/', 'about'], ['/about/x', 'notFound'], ['/abouts', 'notFound'], ['/About', 'notFound'],
  ])('%s → %s', (path, route) => {
    expect(routeOf(path)).toBe(route);
  });
});

import { withStateHash } from './route';

describe('withStateHash — 앱 ↔ 문서 링크가 상태 hash 를 실어 간다', () => {
  it('상태 hash 면 붙이고, 비었거나 다른 꼴이면 경로만', () => {
    expect(withStateHash(NAMING_PATH, '#state=eyJvd25lciI6ImEifQ')).toBe('/docs/naming#state=eyJvd25lciI6ImEifQ');
    expect(withStateHash('/', '#state=ab-_c+/d=')).toBe('/#state=ab-_c+/d=');
    expect(withStateHash(PRIVACY_PATH, '')).toBe('/privacy');
    expect(withStateHash(PICK_PATH, '#state=abc')).toBe('/pick#state=abc');
    expect(withStateHash(API_PATH, '#state=abc')).toBe('/docs/api#state=abc');
    expect(withStateHash(ABOUT_PATH, '#state=abc')).toBe('/about#state=abc');
    expect(withStateHash('/', '#other')).toBe('/');
    expect(withStateHash('/', '#state=')).toBe('/');
    expect(withStateHash('/', '#state=a"><script>')).toBe('/');
  });
});

import { appPathFor, backToAppHref } from './route';
import { encodeState, encodeWizardState, hashKind } from './urlState';
import { samplePlan } from './wizardSample';
import { startPlan } from './wizardState';
import { VERSION } from '../version';

describe('appPathFor · backToAppHref (D129) — 문서 쪽에서 돌아갈 화면을 hash 의 종류로 고른다', () => {
  const gcpHash = `#state=${encodeWizardState(samplePlan(), VERSION.rules, ['prod'])}`;
  const awsHash = `#state=${encodeWizardState(startPlan({ owner: 'demo', system: 'payment', env: 'prod', region: 'ap-northeast-2' }, 'aws'), VERSION.rules, ['prod'])}`;
  const treeHash = `#state=${encodeState({ owner: 'a', system: 'b', purpose: 'c', env: 'prod', region: 'ane3' }, VERSION.rules, { provider: 'gcp', selection: [] })}`;
  it('검사기 자체 — 시험 hash 셋이 실제로 그 종류다', () => {
    expect([hashKind(gcpHash), hashKind(awsHash), hashKind(treeHash), hashKind('#state=abc')]).toEqual(['wizard', 'wizard', 'tree', 'broken']);
  });
  it('마법사 꼴 → 그 클라우드의 경로(c 없으면 gcp) · 트리 꼴 → /pick · 빈 · 깨진 · 다른 hash → /', () => {
    expect(appPathFor(awsHash)).toBe('/aws');
    expect(appPathFor(gcpHash)).toBe('/gcp');
    expect(appPathFor(treeHash)).toBe('/pick');
    for (const h of ['', '#state=abc', '#other', '#state=']) expect(appPathFor(h), h).toBe('/');
  });
  it('backToAppHref — 경로에 상태 hash 를 실어 간다 · 깨진 hash 는 싣지 않는다', () => {
    expect(backToAppHref(awsHash)).toBe(`/aws${awsHash}`);
    expect(backToAppHref(gcpHash)).toBe(`/gcp${gcpHash}`);
    expect(backToAppHref(treeHash)).toBe(`/pick${treeHash}`);
    expect(backToAppHref('')).toBe('/');
    expect(backToAppHref('#state=abc')).toBe('/');
    expect(backToAppHref('#state=a"><script>')).toBe('/');
  });
});
