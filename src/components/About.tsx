// /about — 무엇인가 · 예시 · 무엇을 보고 무엇을 안 보나 · 소스와 라이선스 · 프로젝트 상태 · 버전 · 다른 쪽 (D109).
// 문장은 사전의 about_ 키, 예시는 소개 상자와 같은 IntroExample(엔진이 빌드 때 만든 값), PASS 의 뜻은 이름 칸과 같은 문장을 다시 쓴다 — 사실을 두 번 적지 않는다
import type { ReactNode } from 'react';
import { DocPage } from './DocPage';
import { IntroExample } from './IntroExample';
import { rememberIntroDismissed } from './localPrefs';
import { API_PATH, NAMING_PATH, PRIVACY_PATH, WIZARD_PATH, withStateHash } from './route';
import { hashKind } from './urlState';
import { repositoryFileUrl, repositoryLabel, SOURCE_REPOSITORY_URL } from './aboutModel';
import { en } from '../messages/en';
import { fillUi } from '../messages/catalog';
import { VERSION } from '../version';

const LINK = 'font-medium text-indigo-700 underline hover:text-indigo-900 dark:text-indigo-300 dark:hover:text-indigo-100';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function About() {
  const ui = en.ui;
  // 앱에서 실어 온 상태 hash 를 다른 쪽 링크에도 싣는다 — 돌아가도 입력 · 선택이 남는다
  const hash = window.location.hash;
  return (
    <DocPage title={ui.page_about_title}>
      <div data-about className="space-y-8 text-sm leading-6 text-zinc-800 dark:text-zinc-200">
        <Section id="about-what" title={ui.about_what_title}>
          <p data-about-what>{ui.about_what_body}</p>
        </Section>
        <Section id="about-example" title={ui.about_example_title}>
          <IntroExample phone={false} />
          {/* 닫은 소개 상자를 첫 화면에 다시 보인다 — 닫힘 기억을 지우고 첫 화면으로 간다(누른 click 안에서 지운 뒤 링크가 옮긴다).
              트리 꼴 hash 는 뿌리에서 /pick 으로 옮겨져 소개가 안 보이므로 hash 없이 간다 */}
          <p>
            <a href={hashKind(hash) === 'tree' ? WIZARD_PATH : withStateHash(WIZARD_PATH, hash)} data-about-intro-again className={LINK} onClick={() => rememberIntroDismissed(false)}>{ui.about_intro_again}</a>
          </p>
        </Section>
        <Section id="about-checks" title={ui.about_checks_title}>
          <p data-pass-meaning>{ui.pass_meaning}</p>
          <p data-nothing-created>{ui.wizard_nothing_created}</p>
        </Section>
        <Section id="about-source" title={ui.about_source_title}>
          <p>
            {ui.about_source_repo}{' '}
            <a href={SOURCE_REPOSITORY_URL} data-about-repo rel="noreferrer" className={LINK}>{repositoryLabel()}</a>
          </p>
          <p data-about-license>{ui.about_license}</p>
          <p data-about-notice>{ui.about_license_notice}</p>
          <p className="flex flex-wrap gap-x-3">
            <a href={repositoryFileUrl('LICENSE')} data-about-license-file rel="noreferrer" className={LINK}>LICENSE</a>
            <a href={repositoryFileUrl('NOTICE')} data-about-notice-file rel="noreferrer" className={LINK}>NOTICE</a>
            <a href={repositoryFileUrl('TRADEMARKS.md')} data-about-trademarks-file rel="noreferrer" className={LINK}>TRADEMARKS.md</a>
          </p>
          <p data-about-trademark>{ui.about_trademark}</p>
        </Section>
        <Section id="about-status" title={ui.about_status_title}>
          <p data-about-status>{ui.about_status}</p>
        </Section>
        <Section id="about-versions" title={ui.about_versions_title}>
          {/* 푸터와 같은 값(VERSION) */}
          <p data-about-version>{fillUi(en, 'about_versions_body', VERSION)}</p>
        </Section>
        <Section id="about-links" title={ui.about_links_title}>
          <ul data-about-links className="flex flex-wrap gap-x-4 gap-y-1">
            <li><a href={withStateHash(PRIVACY_PATH, hash)} className={LINK}>{ui.footer_privacy}</a></li>
            <li><a href={withStateHash(NAMING_PATH, hash)} className={LINK}>{ui.nav_naming_guide}</a></li>
            <li><a href={withStateHash(API_PATH, hash)} className={LINK}>{ui.nav_api}</a></li>
            <li><a href="/llms.txt" className={LINK}>llms.txt</a></li>
          </ul>
        </Section>
      </div>
    </DocPage>
  );
}
