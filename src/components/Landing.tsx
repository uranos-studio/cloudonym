// 소개 페이지 `/` (D129) — 한 문장 · 움직이는 소개 · 클라우드 카드 셋 · 꼬리. 마법사는 카드가 여는 /aws · /gcp 에 있다.
// 머리는 로고 · 이름(자기 자신이라 링크가 아니다) · 화면 모드뿐이다 — Share · Save plan · More 는 마법사의 것이라 AppHeader 를 쓰지 않는다.
// 카드는 단추가 아니라 링크다(새 탭 · 크롤러 · 가운데 단추가 된다). Azure 는 아직 꺼져 있어 누를 수 없는 카드다.
// 돌아오는 사람도 이 쪽을 지난다 — 건너뛰면 `/` 가 사람마다 다른 쪽이 되어 검색 · 공유에 두 얼굴이 된다
import { useEffect } from 'react';
import { ArrowRight } from 'lucide-react';
import { LandingMotion } from './LandingMotion';
import { ThemeToggle } from './ThemeToggle';
import { API_PATH, ABOUT_PATH, NAMING_PATH, PRIVACY_PATH, WIZARD_PATHS, type WizardCloud } from './route';
import { resourceCount } from './resourceCount';
import { providerName } from './providerName';
import { sessionStore, visitOnce } from './beacon';
import { en } from '../messages/en';
import { fillUi } from '../messages/catalog';
import { VERSION } from '../version';

/** 켜진 카드의 차례 — AWS · Google Cloud. Azure 는 그 뒤에 꺼진 카드로 */
const CLOUDS: readonly WizardCloud[] = ['aws', 'gcp'];
const CARD = 'flex h-full flex-col rounded-xl border p-5 text-left';
const FOOTER_LINK = 'underline hover:text-zinc-900 dark:hover:text-zinc-100';

export function Landing() {
  // ui_visit — 마법사와 같은 탭당 1회 가드. 소개 → 카드 → 마법사가 두 번 세어지지 않는다
  useEffect(() => {
    visitOnce(sessionStore());
  }, []);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <img src="/favicon.svg" alt="" width={36} height={36} className="size-9 shrink-0" />
            <span className="text-lg font-bold tracking-tight">Cloudonym</span>
          </div>
          <ThemeToggle />
        </div>
      </header>
      <main data-landing className="mx-auto w-full max-w-5xl flex-1 space-y-10 px-4 py-10 sm:py-14">
        <section className="space-y-8">
          <h1 className="mx-auto max-w-3xl text-center text-3xl font-bold tracking-tight text-balance text-zinc-900 sm:text-4xl dark:text-zinc-50">{en.ui.landing_lead}</h1>
          <LandingMotion />
        </section>
        <nav aria-label={en.ui.landing_cards_label}>
          <ul className="grid gap-4 sm:grid-cols-3">
            {CLOUDS.map((p) => (
              <li key={p}>
                <a href={WIZARD_PATHS[p]} data-landing-card={p}
                  className={`${CARD} group border-zinc-200 bg-white shadow-xs hover:border-indigo-400 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-500`}>
                  <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{providerName(p)}</span>
                  <span className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{fillUi(en, 'landing_card_resources', { count: resourceCount(p) })}</span>
                  <span className="mt-auto inline-flex items-center gap-1.5 pt-4 text-sm font-medium text-indigo-700 dark:text-indigo-300">
                    {en.ui.landing_card_open}<ArrowRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </a>
              </li>
            ))}
            <li>
              {/* 꺼진 CSP (0.3.0 계획) — 링크가 아니다. 경로 /azure 도 없다(404) */}
              <span data-landing-card="azure" aria-disabled="true" title={en.ui.cloud_planned_azure}
                className={`${CARD} cursor-not-allowed border-dashed border-zinc-300 bg-zinc-50 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-500`}>
                <span className="text-lg font-semibold">{providerName('azure')}</span>
                <span className="mt-auto pt-4"><span className="inline-flex rounded-full border border-zinc-300 px-2 py-0.5 text-xs font-medium dark:border-zinc-700">{en.ui.cloud_coming_soon}</span></span>
              </span>
            </li>
          </ul>
        </nav>
      </main>
      {/* 문서 쪽(DocPage)의 꼬리와 같은 꼴 — 소개 페이지에는 More 메뉴가 없어 문서 링크도 여기서 간다 */}
      <footer className="mx-auto w-full max-w-5xl px-4 pb-6 text-xs text-zinc-600 dark:text-zinc-400">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span data-version>{fillUi(en, 'version_footer', VERSION)}</span>
          <a href={PRIVACY_PATH} data-footer-privacy className={FOOTER_LINK}>{en.ui.footer_privacy}</a>
          <a href={ABOUT_PATH} data-footer-about className={FOOTER_LINK}>{en.ui.nav_about}</a>
          <a href={NAMING_PATH} data-footer-naming className={FOOTER_LINK}>{en.ui.nav_naming_guide}</a>
          <a href={API_PATH} data-footer-api className={FOOTER_LINK}>{en.ui.nav_api}</a>
          <a href="/llms.txt" data-footer-llms className={FOOTER_LINK}>llms.txt</a>
        </p>
      </footer>
    </div>
  );
}
