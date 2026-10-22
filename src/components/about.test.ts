// /about (D109) — 렌더된 쪽이 제목 · 예시 · PASS 문장 · 저장소 링크 · 라이선스 · 상태 · 버전을 싣는가, 그리고 사실을 두 번 적지 않는가.
// 저장소 URL 은 aboutModel 한 곳에만 있다 — src 안의 다른 소스에 같은 글자가 없다(시험 파일 제외)
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { About } from './About';
import { AppHeader } from './AppHeader';
import { repositoryFileUrl, repositoryLabel, SOURCE_REPOSITORY_URL } from './aboutModel';
import { en } from '../messages/en';
import { fillUi } from '../messages/catalog';
import { VERSION } from '../version';

const sources = import.meta.glob(['../**/*.ts', '../**/*.tsx', '!../**/*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const readme = Object.values(import.meta.glob('../../README.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';

const markup = () => renderToStaticMarkup(createElement(About));
/** 태그를 벗긴 본문 */
const text = () => markup().replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('/about (D109)', () => {
  // DocPage · About 이 링크에 window.location.hash 를 싣는다 — node 에는 window 가 없다
  beforeAll(() => { vi.stubGlobal('window', { location: { hash: '#state=abc' } }); });
  afterAll(() => { vi.unstubAllGlobals(); });

  it('제목 하나와 절 머리 여덟이 순서대로', () => {
    const m = markup();
    expect(m.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1]).toBe(en.ui.page_about_title);
    expect([...m.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((x) => x[1])).toEqual([
      en.ui.about_what_title, en.ui.about_example_title, en.ui.about_checks_title, en.ui.about_resources_title, en.ui.about_source_title,
      en.ui.about_status_title, en.ui.about_versions_title, en.ui.about_links_title,
    ]);
  });
  it('예시는 소개 상자와 같은 블록(넓은 꼴 — 세 줄 모두 PASS)', () => {
    const m = markup();
    expect(m.match(/data-intro-example-row=/g)).toHaveLength(3);
    expect(m.match(/data-intro-example-pass/g)).toHaveLength(3);
  });
  it('무엇을 보고 무엇을 안 보나 — 이름 칸과 같은 두 문장을 그대로 쓴다', () => {
    const t = text();
    expect(t).toContain(en.ui.pass_meaning);
    expect(t).toContain(en.ui.wizard_nothing_created);
    // 같은 사실을 about_ 키에 다시 적지 않는다
    for (const k of Object.keys(en.ui).filter((x) => x.startsWith('about_'))) {
      expect(en.ui[k as keyof typeof en.ui], k).not.toMatch(/availability|valid: true|uniqueness/);
    }
  });
  it('저장소 링크 — 평범한 a 하나 · 상수 URL · 스크립트 · fetch 없음', () => {
    const m = markup();
    const a = /<a [^>]*data-about-repo[^>]*>([^<]*)<\/a>/.exec(m);
    expect(a).not.toBeNull();
    expect(a![0]).toContain(`href="${SOURCE_REPOSITORY_URL}"`);
    expect(a![1]).toBe('github.com/uranos-studio/cloudonym');
    expect(repositoryLabel()).toBe(a![1]);
    expect(m).toContain(`href="${repositoryFileUrl('LICENSE')}"`);
    expect(m).toContain(`href="${repositoryFileUrl('NOTICE')}"`);
    expect(m).not.toMatch(/<(script|img|iframe)\b/);
    expect(sources['./About.tsx']).not.toMatch(/\bfetch\(/);
  });
  it('저장소 URL 은 aboutModel 한 곳에만 있다', () => {
    const hits = Object.entries(sources).filter(([, src]) => src.includes('github.com/uranos-studio/cloudonym')).map(([f]) => f);
    expect(hits).toEqual(['./aboutModel.ts']);
    // 검사기 — 글롭이 이 폴더와 다른 폴더를 다 읽는다
    expect(Object.keys(sources)).toContain('./About.tsx');
    expect(Object.keys(sources)).toContain('../site/pages.ts');
  });
  it('라이선스 · NOTICE(§4) · 상표 · 프로젝트 상태(README 와 같은 문장)', () => {
    const t = text();
    expect(t).toContain('Apache License 2.0');
    expect(en.ui.about_license_notice).toMatch(/keep the LICENSE file and the attribution notices in the NOTICE file \(Apache License 2\.0, section 4\)/);
    expect(t).toContain(en.ui.about_license_notice);
    expect(t).toContain(en.ui.about_trademark);
    expect(t).toContain(en.ui.about_status);
    // README 「Project Status」 와 같은 두 문장 — 줄바꿈만 다르다
    expect(readme.length).toBeGreaterThan(0);
    const status = /## Project Status\n\n([\s\S]*?)\n## /.exec(readme)?.[1];
    expect(squash(status ?? '')).toBe(en.ui.about_status);
  });
  it('버전 — 푸터와 같은 VERSION', () => {
    const m = markup();
    expect(text()).toContain(fillUi(en, 'about_versions_body', VERSION));
    expect(m).toContain(VERSION.engine);
    expect(m).toContain(VERSION.rules);
    expect(text()).toContain(fillUi(en, 'version_footer', VERSION));
  });
  it('다른 쪽 링크 넷 · 소개 다시 보기 — 상태 hash 를 실어 간다', () => {
    const m = markup();
    const links = /<ul[^>]*data-about-links[^>]*>([\s\S]*?)<\/ul>/.exec(m)?.[1] ?? '';
    expect([...links.matchAll(/href="([^"]+)"/g)].map((x) => x[1])).toEqual(['/privacy#state=abc', '/docs/naming#state=abc', '/docs/api#state=abc', '/llms.txt']);
    expect(/<a [^>]*data-about-intro-again[^>]*>/.exec(m)?.[0]).toContain('href="/#state=abc"');
    // 문서 쪽 푸터에도 About 이 있다 — 문서 쪽에는 More 메뉴가 없다
    expect(/<a [^>]*data-footer-about[^>]*>/.exec(m)?.[0]).toContain('href="/about#state=abc"');
  });
});

describe('More 메뉴의 About (D109) — 두 화면 모두 /about 링크', () => {
  it.each(['wizard', 'tree'] as const)('%s — role="menuitem" 링크 · 단추가 아니다', (screen) => {
    const m = renderToStaticMarkup(createElement(AppHeader, { screen, otherHref: '/x', namingHref: '/docs/naming', apiHref: '/docs/api', aboutHref: '/about#state=abc' }));
    const item = /<a[^>]*data-nav-about[^>]*>/.exec(m)?.[0];
    expect(item).toMatch(/role="menuitem"/);
    expect(item).toMatch(/tabindex="-1"/);
    expect(item).toContain('href="/about#state=abc"');
    expect(m).not.toMatch(/<button[^>]*data-nav-about/);
  });
});
