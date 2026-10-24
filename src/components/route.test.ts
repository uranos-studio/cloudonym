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
import { pageText } from '../site/copy';

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

import { entryRedirect, moveToCloud } from './route';

describe('entryRedirect (D76 · D129) — 진입 때 한 번, hash 가 경로를 이긴다 · 옮길 곳이 없으면 undefined', () => {
  const gcpHash = `#state=${encodeWizardState(samplePlan(), VERSION.rules, ['prod'])}`;
  const awsHash = `#state=${encodeWizardState(samplePlan('aws'), VERSION.rules, ['prod'])}`;
  const treeHash = `#state=${encodeState({ owner: 'a', system: 'b', purpose: 'c', env: 'prod', region: 'ane3' }, VERSION.rules, { provider: 'gcp', selection: [] })}`;
  it('소개 페이지 — 트리 꼴은 /pick · 마법사 꼴은 그 클라우드의 경로(query 를 실어 간다) · 빈 · 깨진 hash 는 머문다', () => {
    expect(entryRedirect('home', '?x=1', treeHash)).toBe(`/pick?x=1${treeHash}`);
    expect(entryRedirect('home', '', gcpHash)).toBe(`/gcp${gcpHash}`);
    expect(entryRedirect('home', '?x=1', awsHash)).toBe(`/aws?x=1${awsHash}`);
    for (const h of ['', '#state=abc', '#other']) expect(entryRedirect('home', '', h), h).toBeUndefined();
  });
  it('마법사 경로 — hash 의 클라우드가 다르면 그 경로로 · 같으면 머문다 · 트리 꼴은 /pick · 깨진 hash 는 머문다(마법사가 안내한다)', () => {
    expect(entryRedirect('aws', '', gcpHash)).toBe(`/gcp${gcpHash}`);
    expect(entryRedirect('gcp', '?q', awsHash)).toBe(`/aws?q${awsHash}`);
    expect(entryRedirect('aws', '', awsHash)).toBeUndefined();
    expect(entryRedirect('gcp', '', gcpHash)).toBeUndefined();
    expect(entryRedirect('gcp', '', treeHash)).toBe(`/pick${treeHash}`);
    for (const r of ['aws', 'gcp'] as const) for (const h of ['', '#state=abc']) expect(entryRedirect(r, '', h), `${r} ${h}`).toBeUndefined();
  });
  it('그 밖의 쪽은 옮기지 않는다 — 트리 화면 · 문서 · 404', () => {
    for (const r of ['pick', 'naming', 'api', 'privacy', 'about', 'notFound'] as const) {
      for (const h of [gcpHash, awsHash, treeHash]) expect(entryRedirect(r, '', h), r).toBeUndefined();
    }
  });
});

describe('moveToCloud (D129) — 선택기로 클라우드를 바꾸면 주소창의 경로와 제목이 따라간다(다시 불러오지 않는다)', () => {
  it('replaceState 로 경로만 바꾼다 — query · hash 는 그대로 · 제목은 그 경로의 것', () => {
    const calls: unknown[][] = [];
    const doc = { title: 'x' };
    moveToCloud('aws', { location: { search: '?a=1', hash: '#state=abc' }, history: { replaceState: (...a: unknown[]) => { calls.push(a); } }, document: doc });
    expect(calls).toEqual([[null, '', '/aws?a=1#state=abc']]);
    expect(doc.title).toBe(pageText('aws').title);
    moveToCloud('gcp', { location: { search: '', hash: '' }, history: { replaceState: (...a: unknown[]) => { calls.push(a); } }, document: doc });
    expect(calls.at(-1)).toEqual([null, '', '/gcp']);
    expect(doc.title).toBe(pageText('gcp').title);
  });
});

import { watchHomeHash } from './route';

describe('watchHomeHash (D129) — 소개 페이지가 떠 있는 동안 hash 만 바뀌어도 진입과 같은 규칙으로 옮긴다', () => {
  const fakeWindow = (hash: string) => {
    let listener: (() => void) | undefined;
    const replaced: string[] = [];
    const win = {
      location: { search: '', hash, replace: (u: string) => { replaced.push(u); } },
      addEventListener: (_t: string, f: () => void) => { listener = f; },
      removeEventListener: () => { listener = undefined; },
    };
    return { win, replaced, fire: () => listener?.(), has: () => listener !== undefined };
  };
  it('마법사 · 트리 링크로 바뀌면 그 경로로 · 옮길 곳 없는 hash 는 머문다 · 떼면 더는 듣지 않는다', () => {
    const awsHash = `#state=${encodeWizardState(samplePlan('aws'), VERSION.rules, ['prod'])}`;
    const f = fakeWindow('');
    const stop = watchHomeHash(f.win as unknown as Parameters<typeof watchHomeHash>[0]);
    f.fire();
    expect(f.replaced).toEqual([]);
    f.win.location.hash = awsHash;
    f.fire();
    expect(f.replaced).toEqual([`/aws${awsHash}`]);
    f.win.location.hash = '#state=broken';
    f.fire();
    expect(f.replaced).toHaveLength(1);
    stop();
    expect(f.has()).toBe(false);
  });
});
