// /privacy — 개인정보 안내 (D57). 문장은 사전의 privacy_ 키가 맡는다 — 지금은 제목과 돌아가는 링크만 있다
import { DocPage } from './DocPage';
import { en } from '../messages/en';

export function Privacy() {
  return <DocPage title={en.ui.privacy_title} />;
}
