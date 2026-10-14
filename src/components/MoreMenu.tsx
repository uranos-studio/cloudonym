// 머리의 「More」 메뉴 (D104) — 자주 쓰지 않는 단추(Open plan · 다른 화면 · 이름 안내 · API · llms.txt)를 하나로 묶어 머리를 한 줄로 둔다.
// WAI-ARIA menu button 꼴: 단추(aria-haspopup · aria-expanded) → role="menu" 의 menuitem.
// 단추에서 Enter · Space · ↓ 는 열고 첫 항목, ↑ 는 열고 끝 항목 · 메뉴 안 ↑↓ 순환 · Home · End · Esc 는 닫고 단추로 포커스 · Tab 은 닫기만 · 바깥을 누르면 닫는다.
// 메뉴는 늘 그리고 hidden 으로 닫는다 — data-nav-* 링크의 href 를 닫힌 채로도 읽을 수 있다(시험 · 정적 렌더)
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { en } from '../messages/en';

export const MENU_ITEM =
  'flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100 focus:bg-zinc-100 focus:outline-none ' +
  'dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus:bg-zinc-800';

interface Props {
  buttonClassName: string;
  /** 단추 글자를 감싸는 꼴 — 폰 폭에서는 그림만 보인다 */
  textClassName: string;
  /** 메뉴 항목 — 각각 role="menuitem" · tabIndex=-1 을 단 a 또는 button 이다 */
  children: ReactNode;
}

export function MoreMenu({ buttonClassName, textClassName, children }: Props) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const menuId = `${id}-menu`;
  const buttonId = `${id}-button`;
  // 열 때 포커스를 둘 항목 — 열린 뒤(hidden 이 걷힌 뒤)에 옮긴다
  const pending = useRef<'first' | 'last' | null>(null);

  const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  useEffect(() => {
    if (!open) return;
    if (pending.current) {
      const list = items();
      (pending.current === 'first' ? list[0] : list.at(-1))?.focus();
      pending.current = null;
    }
    // 바깥을 누르면 닫는다 — 포커스는 누른 곳으로 간다
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const openAt = (at: 'first' | 'last') => {
    pending.current = at;
    setOpen(true);
  };

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openAt('first');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openAt('last');
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    }
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const to = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    if (e.key === 'ArrowDown') to(at + 1);
    else if (e.key === 'ArrowUp') to(at < 0 ? -1 : at - 1);
    else if (e.key === 'Home') to(0);
    else if (e.key === 'End') to(-1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
    } else if (e.key === 'Tab') setOpen(false); // 포커스는 Tab 의 기본 동작대로 다음 칸으로 간다
  };

  return (
    <div ref={wrap} className="relative">
      <button ref={button} id={buttonId} type="button" data-nav-more aria-haspopup="menu" aria-expanded={open} aria-controls={menuId}
        aria-label={en.ui.nav_more} title={en.ui.nav_more_label} className={buttonClassName}
        onClick={() => { if (open) setOpen(false); else openAt('first'); }} onKeyDown={onButtonKey}>
        <MoreHorizontal aria-hidden="true" className="size-4" /><span className={textClassName}>{en.ui.nav_more}</span>
      </button>
      {/* 항목을 고르면 닫는다 — 링크는 그 화면으로 가고, Open plan 은 같은 click 안에서 파일 고르기 창을 연다(사용자 동작이 이어진다) */}
      <div ref={menu} id={menuId} role="menu" aria-labelledby={buttonId} data-nav-menu hidden={!open} onKeyDown={onMenuKey}
        onClick={(e) => { if ((e.target as HTMLElement).closest('[role="menuitem"]')) { setOpen(false); button.current?.focus(); } }}
        className="absolute right-0 top-full z-40 mt-1 w-56 rounded-md border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
        {children}
      </div>
    </div>
  );
}
