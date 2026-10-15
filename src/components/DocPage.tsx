// 문서 경로(/docs/naming · /docs/api · /privacy · /about)의 틀 — 제목 · 화면으로 돌아가는 링크 · 본문 · 버전 푸터. 본문은 각 페이지가 채운다
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { en } from '../messages/en';
import { fillUi } from '../messages/catalog';
import { VERSION } from '../version';
import { ABOUT_PATH, PRIVACY_PATH, withStateHash } from './route';
import { ThemeToggle } from './ThemeToggle';

export function DocPage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <div className="flex items-center justify-between gap-3">
          {/* 앱에서 실어 온 상태 hash 로 돌아간다 — 입력 · 선택이 그대로 열린다 */}
          <a href={withStateHash('/', window.location.hash)} data-back-to-app className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:text-indigo-300">
            <ArrowLeft aria-hidden="true" className="size-4" />{en.ui.back_to_app}
          </a>
          {/* 화면 모드 (D94) — 앱 머리와 같은 고르기 */}
          <ThemeToggle />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {children}
      </main>
      <footer className="mx-auto max-w-3xl px-4 pb-6 text-xs text-zinc-600 dark:text-zinc-400">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span data-version>{fillUi(en, 'version_footer', VERSION)}</span>
          {/* 앱 푸터와 같은 꼴 — 상태 hash 를 실어 간다 */}
          <a href={withStateHash(PRIVACY_PATH, window.location.hash)} data-footer-privacy className="underline hover:text-zinc-900 dark:hover:text-zinc-100">{en.ui.footer_privacy}</a>
          {/* 문서 쪽에는 More 메뉴가 없다 — About 은 푸터에서 간다 (D109) */}
          <a href={withStateHash(ABOUT_PATH, window.location.hash)} data-footer-about className="underline hover:text-zinc-900 dark:hover:text-zinc-100">{en.ui.nav_about}</a>
        </p>
      </footer>
    </div>
  );
}
