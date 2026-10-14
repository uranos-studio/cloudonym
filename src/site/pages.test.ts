import { describe, it, expect } from 'vitest';
import { PAGES, pathOf, routeOf } from './pages';
import { pageText, SITE_NAME } from './copy';
import { en } from '../messages/en';

describe('경로 표 (D106) — 화면 · Worker · sitemap 이 같은 표를 쓴다', () => {
  it('다섯 경로 · 순서 · 경로마다 routeOf 가 제자리로 돌아온다', () => {
    expect(PAGES.map((p) => p.path)).toEqual(['/', '/pick', '/docs/naming', '/docs/api', '/privacy']);
    for (const p of PAGES) {
      expect(routeOf(p.path)).toBe(p.route);
      expect(pathOf(p.route)).toBe(p.path);
    }
  });
  it('쪽 제목이 경로마다 다르고 「Cloudonym — 」 로 시작한다 · 뿌리 설명은 index.html 의 meta_description 과 같다', () => {
    const titles = [...PAGES.map((p) => p.route), 'notFound' as const].map((r) => pageText(r).title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const t of titles) expect(t.startsWith(`${SITE_NAME} — `), t).toBe(true);
    expect(pageText('app').description).toBe(en.ui.meta_description);
    expect(pageText('notFound').heading).toBe(en.ui.page_not_found_title);
  });
});
