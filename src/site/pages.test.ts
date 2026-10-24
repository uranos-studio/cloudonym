import { describe, it, expect } from 'vitest';
import { PAGES, pathOf, routeOf } from './pages';
import { pageText, SITE_NAME } from './copy';
import { en } from '../messages/en';

describe('경로 표 (D106) — 화면 · Worker · sitemap 이 같은 표를 쓴다', () => {
  it('여덟 경로 · 순서 · 경로마다 routeOf 가 제자리로 돌아온다 (D129 — 소개 페이지 / · 마법사 /aws · /gcp)', () => {
    expect(PAGES.map((p) => p.path)).toEqual(['/', '/aws', '/gcp', '/pick', '/docs/naming', '/docs/api', '/privacy', '/about']);
    expect(PAGES.map((p) => p.route)).toEqual(['home', 'aws', 'gcp', 'pick', 'naming', 'api', 'privacy', 'about']);
    for (const p of PAGES) {
      expect(routeOf(p.path)).toBe(p.route);
      expect(pathOf(p.route)).toBe(p.path);
    }
  });
  it('쪽 제목이 경로마다 다르고 「Cloudonym — 」 로 시작한다 · 뿌리 설명은 index.html 의 meta_description 과 같다', () => {
    const titles = [...PAGES.map((p) => p.route), 'notFound' as const].map((r) => pageText(r).title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const t of titles) expect(t.startsWith(`${SITE_NAME} — `), t).toBe(true);
    expect(pageText('home').description).toBe(en.ui.meta_description);
    expect(pageText('home').heading).toBe(en.ui.page_home_title);
    expect(pageText('aws').heading).toBe(en.ui.page_aws_title);
    expect(pageText('gcp').heading).toBe(en.ui.page_gcp_title);
    expect(pageText('notFound').heading).toBe(en.ui.page_not_found_title);
  });
});

import { WIZARD_PATHS, wizardPath, wizardRouteOf } from './pages';

describe('마법사 경로 (D129) — 클라우드마다 경로 하나 · 표에 없는 클라우드는 뿌리', () => {
  it('WIZARD_PATHS 는 aws · gcp 둘 · 경로 표에 그 route 로 들어 있다', () => {
    expect(WIZARD_PATHS).toEqual({ aws: '/aws', gcp: '/gcp' });
    for (const [p, path] of Object.entries(WIZARD_PATHS)) expect(routeOf(path)).toBe(p);
  });
  it('wizardPath — aws · gcp 는 제 경로, 그 밖(undefined · azure · 프로토타입 이름)은 /', () => {
    expect(wizardPath('aws')).toBe('/aws');
    expect(wizardPath('gcp')).toBe('/gcp');
    for (const p of [undefined, 'azure', '', 'AWS', 'constructor', 'toString', '__proto__']) expect(wizardPath(p), String(p)).toBe('/');
  });
  it('wizardRouteOf — 마법사 route 면 그 클라우드, 아니면 undefined', () => {
    expect(wizardRouteOf('aws')).toBe('aws');
    expect(wizardRouteOf('gcp')).toBe('gcp');
    for (const r of ['home', 'pick', 'naming', 'api', 'privacy', 'about', 'notFound'] as const) expect(wizardRouteOf(r), r).toBeUndefined();
  });
});
