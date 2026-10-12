// 좁은 화면의 마법사 겹침 창 (D89) — 태블릿의 이름 드로어(오른쪽에서) · 폰의 설정 바텀 시트(아래에서).
// 브라우저의 모달 dialog(showModal)를 쓴다 — 뒤쪽은 inert 가 되고 Esc 는 cancel 로 온다. 닫기는 늘 부모의 상태로 한다(open 이 정본):
// Esc · 배경 누름 · 닫기 단추는 onClose 를 부르고, 부모가 open 을 내리면 여기서 dialog 를 닫는다. 닫은 뒤 포커스는 부모가 정한다
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { ICON_BTN } from './wizardStyles';

const KIND = {
  // 드로어 — 오른쪽 가장자리 · 폭 min(420px, 90vw) · 높이 전체
  drawer: 'fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-[min(420px,90vw)] max-w-none rounded-l-xl',
  // 시트 — 아래 가장자리 · 폭 전체 · 높이는 내용만큼, 넘으면 70vh 에서 칸 안 스크롤
  sheet: 'fixed inset-x-0 bottom-0 top-auto m-0 w-full max-w-none max-h-[70vh] rounded-t-xl',
} as const;

export function WizardOverlay({ kind, open, onClose, title, closeLabel, labelledBy, children, data }: {
  kind: keyof typeof KIND; open: boolean; onClose: () => void;
  /** 머리의 제목과 닫기 단추 — 없으면 내용이 제 머리(제목 · 닫기)를 갖고 labelledBy 가 그 제목을 가리킨다(드로어 — 이름 칸 머리) */
  title?: ReactNode; closeLabel?: string; labelledBy?: string; children: ReactNode;
  /** 시험이 잡는 속성 이름(data-names-drawer · data-settings-sheet) */
  data: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  /** 우리가 닫은 것인가 — close 이벤트는 나중 태스크로 와서, 그 사이 다시 연 창을 닫지 않게 가려낸다 */
  const ours = useRef(false);
  // layout effect — 그린 직후 동기로 열고 닫는다. 부모가 requestAnimationFrame 으로 주는 포커스가 showModal 의 첫 포커스보다 늦게 오게 한다
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) {
      ours.current = true;
      d.close();
    }
  }, [open]);
  const titleId = labelledBy ?? `${data}-title`;
  return (
    <dialog ref={ref} {...{ [`data-${data}`]: '' }} aria-labelledby={titleId}
      className={`${KIND[kind]} flex-col overflow-hidden border border-zinc-200 bg-white p-0 text-zinc-900 shadow-xl open:flex backdrop:bg-zinc-950/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100`}
      // Esc — 브라우저가 닫기 전에 막고 부모 상태로 닫는다(닫은 뒤 포커스를 부모가 정하게)
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      // 브라우저가 강제로 닫은 경우(Esc 를 거듭 누름 등)에도 상태를 맞춘다
      onClose={() => {
        if (ours.current) ours.current = false;
        else onClose();
      }}
      // 배경(::backdrop)을 누르면 dialog 자신이 target 이다
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {title !== undefined && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
          <h2 id={titleId} className="min-w-0 truncate text-base font-semibold">{title}</h2>
          <button type="button" data-overlay-close aria-label={closeLabel} title={closeLabel} className={ICON_BTN} onClick={onClose}>
            {/* 시트는 아래로 내리는 꺾쇠 — 바로 아래 설정 칸 머리의 ✕(Remove)와 헷갈리지 않게 */}
            {kind === 'sheet' ? <ChevronDown aria-hidden="true" className="size-5" /> : <X aria-hidden="true" className="size-5" />}
          </button>
        </div>
      )}
      {children}
    </dialog>
  );
}
