// 소개 페이지 `/` (D129) — 한 문장 · 움직이는 소개 · 카드 셋 · 꼬리. 브라우저 없이 정적 마크업으로 본다(움직임 · 정지 화면은 화면 시험 (56) 이 본다)
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Landing } from './Landing';
import { LandingMotion } from './LandingMotion';
import { INTRO_EXAMPLE, type IntroExampleData } from './IntroExample';
import committed from './introExamples.json';
import { WIZARD_PATHS } from './route';
import { resourceCount } from './resourceCount';
import { providerName } from './providerName';
import { en } from '../messages/en';
import { fillUi } from '../messages/catalog';
import { VERSION } from '../version';

const sources = import.meta.glob(['./Landing.tsx', './LandingMotion.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('소개 페이지 (D129)', () => {
  beforeAll(() => { vi.stubGlobal('window', { location: { hash: '', search: '' } }); });
  afterAll(() => { vi.unstubAllGlobals(); });
  const markup = () => renderToStaticMarkup(createElement(Landing));
  const run = committed.rows.find((r) => r.id === 'run')!;

  it('한 문장이 제목(h1)이다 · 클라우드 셋을 말한다', () => {
    const m = markup();
    expect(m.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1]).toBe(en.ui.landing_lead);
    for (const name of ['AWS', 'Google Cloud', 'Azure']) expect(en.ui.landing_lead).toContain(name);
  });

  it('카드 둘은 링크 — href 가 WIZARD_PATHS 의 값 · 카드마다 resourceCount 로 센 리소스 수', () => {
    const m = markup();
    for (const p of ['aws', 'gcp'] as const) {
      const card = new RegExp(`<a [^>]*data-landing-card="${p}"[^>]*>([\\s\\S]*?)</a>`).exec(m);
      expect(card, p).not.toBeNull();
      expect(card![0]).toContain(`href="${WIZARD_PATHS[p]}"`);
      expect(card![1]).toContain(providerName(p));
      expect(card![1].replace(/<!-- -->/g, '')).toContain(fillUi(en, 'landing_card_resources', { count: resourceCount(p) }));
    }
    // 순서 — AWS · Google Cloud · Azure
    expect([...m.matchAll(/data-landing-card="([a-z]+)"/g)].map((x) => x[1])).toEqual(['aws', 'gcp', 'azure']);
  });

  it('Azure 카드는 링크가 아니다 — aria-disabled · href 없음 · 「Coming soon」 · 툴팁은 계획 버전', () => {
    const m = markup();
    expect(m).not.toMatch(/<a [^>]*data-landing-card="azure"/);
    // 카드 하나가 <li> 하나다 — 여는 태그부터 그 <li> 끝까지
    const azure = /<(\w+) [^>]*data-landing-card="azure"[^>]*>([\s\S]*?)<\/li>/.exec(m);
    expect(azure).not.toBeNull();
    expect(azure![0]).toContain('aria-disabled="true"');
    expect(azure![0]).not.toContain('href=');
    expect(azure![0]).toContain(`title="${en.ui.cloud_planned_azure}"`);
    expect(azure![2]).toContain(en.ui.cloud_coming_soon);
    expect(azure![2]).toContain(providerName('azure'));
    expect(m).not.toContain('href="/azure"');
  });

  it('카드 묶음에 이름표가 있다 · 꼬리는 버전 · Privacy · About · Naming guide · API · llms.txt', () => {
    const m = markup();
    expect(m).toContain(`aria-label="${en.ui.landing_cards_label}"`);
    expect(m).toContain(fillUi(en, 'version_footer', VERSION));
    const footer = /<footer[^>]*>([\s\S]*?)<\/footer>/.exec(m)?.[1] ?? '';
    expect([...footer.matchAll(/href="([^"]+)"/g)].map((x) => x[1])).toEqual(['/privacy', '/about', '/docs/naming', '/docs/api', '/llms.txt']);
  });

  it('마법사의 것이 없다 — data-wizard · Share URL · Save plan · More 메뉴 · 로고는 링크가 아니다(자기 자신)', () => {
    const m = markup();
    expect(m).not.toContain('data-wizard');
    expect(m).not.toContain(en.ui.share_button);
    expect(m).not.toContain(en.ui.plan_save);
    expect(m).not.toContain('data-nav-home');
    expect(m).not.toMatch(/<a [^>]*href="\/"/);
  });

  it('움직이는 그림 — aria-hidden · 값 다섯(입력 넷 + purpose) · 이름 · PASS 는 introExamples.json 의 run 줄에서만 · 같은 내용을 글 한 줄로', () => {
    const m = markup();
    const fig = /<figure [^>]*data-landing-motion[^>]*>([\s\S]*?)<\/figure>/.exec(m);
    expect(fig).not.toBeNull();
    expect(fig![0]).toMatch(/aria-hidden="true"/);
    expect([...fig![1].matchAll(/data-landing-value="[^"]*"[^>]*>([^<]*)</g)].map((x) => x[1])).toEqual([...committed.input.slice(0, 2), committed.purpose, ...committed.input.slice(2)]);
    expect(/data-landing-name="[^"]*"[^>]*>([^<]*)</.exec(fig![1])?.[1]).toBe(run.name);
    expect(fig![1]).toContain('data-landing-pass');
    const text = /<p [^>]*data-landing-motion-text[^>]*>([\s\S]*?)<\/p>/.exec(m)?.[1]?.replace(/<!-- -->/g, '');
    expect(text).toContain(run.name);
    expect(text).toContain(committed.purpose);
    for (const v of committed.input) expect(text).toContain(v);
    expect(text).toContain(en.ui.landing_motion_pass);
  });

  it('PASS 는 valid:true 에서만 — valid:false 를 넣으면 PASS 표지 · 문장이 없다', () => {
    const bad: IntroExampleData = { ...INTRO_EXAMPLE, rows: INTRO_EXAMPLE.rows.map((r) => (r.id === 'run' ? { ...r, valid: false } : r)) };
    const m = renderToStaticMarkup(createElement(LandingMotion, { example: bad }));
    expect(m).not.toContain('data-landing-pass');
    expect(m).not.toContain(en.ui.landing_motion_pass);
    expect(m).toContain(run.name);
  });

  it('ui_visit 은 마법사와 같은 탭당 1회 가드로 보낸다 — 소개 → 마법사가 두 번 세어지지 않는다', () => {
    expect(sources['./Landing.tsx']).toContain('visitOnce(sessionStore())');
  });

  it('손으로 쓴 이름 · 값이 없다 — 예시 글자는 JSON 에서만 온다 · 인라인 style 속성 없음(CSP style-src self)', () => {
    for (const [f, src] of Object.entries(sources)) {
      for (const v of [run.name, ...committed.input, `'${committed.purpose}'`]) expect(src.includes(v), `${f} ${v}`).toBe(false);
      expect(src, f).not.toMatch(/\bstyle=\{/);
    }
  });
});
