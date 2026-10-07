// 문서 경로(/docs/naming · /privacy)의 틀 — 제목 · 화면으로 돌아가는 링크 · 본문 · 버전 푸터. 본문은 각 페이지가 채운다
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { en } from '../messages/en';
import { fillUi } from '../messages/catalog';
import { VERSION } from '../version';

export function DocPage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <a href="/" data-back-to-app className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:text-indigo-300">
          <ArrowLeft aria-hidden="true" className="size-4" />{en.ui.back_to_app}
        </a>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {children}
      </main>
      <footer className="mx-auto max-w-3xl px-4 pb-6 text-xs text-zinc-600 dark:text-zinc-400">
        <p data-version>{fillUi(en, 'version_footer', VERSION)}</p>
      </footer>
    </div>
  );
}
