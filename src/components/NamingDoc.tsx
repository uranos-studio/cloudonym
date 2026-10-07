// /docs/naming — 이름 안내 (D57). 생성 TS 에서 만든 모델을 그리는 페이지의 자리 — 지금은 제목과 돌아가는 링크만 있다
import { DocPage } from './DocPage';
import { en } from '../messages/en';

export function NamingDoc() {
  return <DocPage title={en.ui.doc_title} />;
}
