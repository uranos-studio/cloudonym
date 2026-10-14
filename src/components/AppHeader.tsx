// 머리글 — 트리 화면 · 마법사가 같이 쓴다. 제품 이름 · Share URL(있을 때만) · 화면 전환 링크(Wizard ↔ Pick resources · D68) · 이름 안내 · API 안내(D98) · llms.txt
import type { ReactNode } from 'react';
import { BookOpen, Cloud, Copy, FileDown, FileText, ListTree, Terminal, Wand2 } from 'lucide-react';
import { COPY_BUTTON } from './CopyButton';
import { ThemeToggle } from './ThemeToggle';
import { en } from '../messages/en';

export const NAV_LINK =
  'inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800';

interface Props {
  /** Share URL 버튼 — 상태가 온전할 때만 넘긴다 */
  share?: ReactNode;
  /** 지금 화면 — 다른 화면으로 가는 링크를 그린다 */
  screen: 'wizard' | 'tree';
  /** 다른 화면의 경로 */
  otherHref: string;
  namingHref: string;
  /** /docs/api — 상태 hash 를 실어 간다 */
  apiHref: string;
  /** Share URL 이 없을 때도 그 자리(단추 · 경고 줄)를 비워 둔다 — 단추가 나타나고 사라질 때 머리 높이가 바뀌지 않게(마법사) */
  reserveShare?: boolean;
  /** 공유 경고 줄을 머리에 늘 보이는가 — 마법사는 Share 를 누를 때 그 곁에 보인다(D93) */
  shareWarning?: boolean;
  /** 제품 이름 옆 배지 — 마법사의 클라우드(Google Cloud · 나머지는 곧) */
  badge?: ReactNode;
  /** 계획 파일 단추 (D100 · 마법사) — save 는 Share 와 같은 조건(없으면 reserveShare 일 때 자리만 비운다), open 은 늘 */
  planFile?: { save?: ReactNode; open: ReactNode };
}

/** 계획 파일 단추의 꼴 — 폰 폭(sm 아래)에서는 그림만 보여 머리 높이를 늘리지 않는다. 글은 aria-label · title 이 말한다 */
export const PLAN_FILE_BUTTON = `${NAV_LINK} shrink-0`;
export const PLAN_FILE_TEXT = 'hidden sm:inline';

export function AppHeader({ share, screen, otherHref, namingHref, apiHref, reserveShare = false, shareWarning = true, badge, planFile }: Props) {
  return (
    <header className="border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="rounded-lg bg-indigo-600 p-2 text-white dark:bg-indigo-500"><Cloud aria-hidden="true" className="size-5" /></span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight">Cloudonym</h1>
              {badge}
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">{en.ui.tagline}</p>
          </div>
        </div>
        <nav aria-label={en.ui.nav_label} className="flex flex-wrap items-center gap-2">
          {share ?? (reserveShare && (
            <span aria-hidden="true" data-share-reserve className="invisible inline-flex items-center gap-2">
              <span className={COPY_BUTTON}><Copy className="size-4" />{en.ui.share_button}</span>
            </span>
          ))}
          {planFile && (planFile.save ?? (reserveShare && (
            <span aria-hidden="true" data-plan-save-reserve className={`invisible ${PLAN_FILE_BUTTON}`}><FileDown className="size-4" /><span className={PLAN_FILE_TEXT}>{en.ui.plan_save}</span></span>
          )))}
          {planFile?.open}
          {screen === 'tree'
            ? <a href={otherHref} data-nav-wizard title={en.ui.nav_wizard_label} className={NAV_LINK}><Wand2 aria-hidden="true" className="size-4" />{en.ui.nav_wizard}</a>
            : <a href={otherHref} data-nav-pick title={en.ui.nav_pick_label} className={NAV_LINK}><ListTree aria-hidden="true" className="size-4" />{en.ui.nav_pick}</a>}
          <a href={namingHref} data-nav-naming className={NAV_LINK}><BookOpen aria-hidden="true" className="size-4" />{en.ui.nav_naming_guide}</a>
          <a href={apiHref} data-nav-api className={NAV_LINK}><Terminal aria-hidden="true" className="size-4" />{en.ui.nav_api}</a>
          <a href="/llms.txt" target="_blank" rel="noreferrer" className={NAV_LINK}><FileText aria-hidden="true" className="size-4" />llms.txt</a>
          <ThemeToggle />
        </nav>
        {/* 공유 URL 경고 — hash 는 버튼을 누르지 않아도 주소창에 쓰이고 Base64 는 암호화가 아니다. nav 밖 전폭 줄이라 좁은 화면에서 버튼 줄을 깨지 않는다 */}
        {shareWarning && share && <p data-share-warning className="w-full text-xs text-zinc-600 sm:text-right dark:text-zinc-400">{en.ui.share_warning}</p>}
        {shareWarning && !share && reserveShare && <p aria-hidden="true" className="invisible w-full text-xs sm:text-right">{en.ui.share_warning}</p>}
      </div>
    </header>
  );
}
