// 머리글 — 트리 화면 · 마법사가 같이 쓴다. 밖에는 제품 이름 · Share URL(있을 때만) · Save plan(마법사) · 화면 모드만 두고,
// Open plan(마법사) · 화면 전환 링크(Wizard ↔ Pick resources · D68) · 이름 안내 · API 안내(D98) · llms.txt 는 「More」 메뉴 하나에 둔다 (D104 — 1280 에서 한 줄 · 360 에서 두 줄)
import type { ReactNode } from 'react';
import { BookOpen, Cloud, Copy, FileDown, FileText, FileUp, ListTree, Terminal, Wand2 } from 'lucide-react';
import { COPY_BUTTON } from './CopyButton';
import { MENU_ITEM, MoreMenu } from './MoreMenu';
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
  /** 계획 파일 (D100 · 마법사) — save 는 머리의 단추로 Share 와 같은 조건(없으면 reserveShare 일 때 자리만 비운다).
   *  open 은 More 메뉴의 항목이다(D104) — 눌린 click 안에서 동기로 파일 고르기 창을 연다(숨은 input 은 부르는 쪽이 메뉴 밖에 둔다) */
  planFile?: { save?: ReactNode; open: () => void };
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
        <nav aria-label={en.ui.nav_label} className="ml-auto flex flex-wrap items-center gap-2">
          {share ?? (reserveShare && (
            <span aria-hidden="true" data-share-reserve className="invisible inline-flex items-center gap-2">
              <span className={COPY_BUTTON}><Copy className="size-4" />{en.ui.share_button}</span>
            </span>
          ))}
          {planFile && (planFile.save ?? (reserveShare && (
            <span aria-hidden="true" data-plan-save-reserve className={`invisible ${PLAN_FILE_BUTTON}`}><FileDown className="size-4" /><span className={PLAN_FILE_TEXT}>{en.ui.plan_save}</span></span>
          )))}
          {/* 폰 폭에서는 그림만 — 글은 aria-label · title 이 말한다 */}
          <MoreMenu buttonClassName={PLAN_FILE_BUTTON} textClassName={PLAN_FILE_TEXT}>
            {planFile && (
              <button type="button" role="menuitem" tabIndex={-1} data-plan-open title={en.ui.plan_open_label} className={MENU_ITEM} onClick={planFile.open}>
                <FileUp aria-hidden="true" className="size-4" />{en.ui.plan_open}
              </button>
            )}
            {screen === 'tree'
              ? <a href={otherHref} data-nav-wizard role="menuitem" tabIndex={-1} title={en.ui.nav_wizard_label} className={MENU_ITEM}><Wand2 aria-hidden="true" className="size-4" />{en.ui.nav_wizard}</a>
              : <a href={otherHref} data-nav-pick role="menuitem" tabIndex={-1} title={en.ui.nav_pick_label} className={MENU_ITEM}><ListTree aria-hidden="true" className="size-4" />{en.ui.nav_pick}</a>}
            <a href={namingHref} data-nav-naming role="menuitem" tabIndex={-1} className={MENU_ITEM}><BookOpen aria-hidden="true" className="size-4" />{en.ui.nav_naming_guide}</a>
            <a href={apiHref} data-nav-api role="menuitem" tabIndex={-1} className={MENU_ITEM}><Terminal aria-hidden="true" className="size-4" />{en.ui.nav_api}</a>
            <a href="/llms.txt" data-nav-llms role="menuitem" tabIndex={-1} target="_blank" rel="noreferrer" className={MENU_ITEM}><FileText aria-hidden="true" className="size-4" />llms.txt</a>
          </MoreMenu>
          <ThemeToggle />
        </nav>
        {/* 공유 URL 경고 — hash 는 버튼을 누르지 않아도 주소창에 쓰이고 Base64 는 암호화가 아니다. nav 밖 전폭 줄이라 좁은 화면에서 버튼 줄을 깨지 않는다 */}
        {shareWarning && share && <p data-share-warning className="w-full text-xs text-zinc-600 sm:text-right dark:text-zinc-400">{en.ui.share_warning}</p>}
        {shareWarning && !share && reserveShare && <p aria-hidden="true" className="invisible w-full text-xs sm:text-right">{en.ui.share_warning}</p>}
      </div>
    </header>
  );
}
