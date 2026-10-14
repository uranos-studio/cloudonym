// 표에 없는 경로 (D106) — 서버는 404 로 같은 index.html 을 주고, 화면은 이 쪽을 그린다. 틀(돌아가는 링크 · 푸터)은 문서 쪽과 같다
import { DocPage } from './DocPage';
import { en } from '../messages/en';

export function NotFound() {
  return (
    <DocPage title={en.ui.page_not_found_title}>
      <p data-not-found className="text-sm leading-6 text-zinc-800 dark:text-zinc-200">{en.ui.page_not_found_body}</p>
    </DocPage>
  );
}
