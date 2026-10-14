// 경로마다 제목 · 설명 (D106) — 문장은 사전(en.ui 의 page_ 키 · meta_description)이 정본이고, 여기는 경로와 짝짓기만 한다.
// 화면은 document.title 에, Worker 는 <title> · meta description · og · twitter 와 #root 안의 요약 글에 같은 값을 쓴다
import { en } from '../messages/en';
import type { Catalog } from '../messages/catalog';
import type { Route } from './pages';

export const SITE_NAME = 'Cloudonym';

export interface PageText {
  /** 「Cloudonym — <쪽 이름>」 — <title> · og:title · document.title */
  title: string;
  /** 쪽 이름만 — 요약 글의 <h1> */
  heading: string;
  /** meta description · og:description — 160자 안 (en.test) */
  description: string;
}

export function pageText(route: Route, c: Catalog = en): PageText {
  const ui = c.ui;
  const pick = (heading: string, description: string): PageText => ({ title: `${SITE_NAME} — ${heading}`, heading, description });
  switch (route) {
    case 'app': return pick(ui.page_app_title, ui.meta_description);
    case 'pick': return pick(ui.page_pick_title, ui.page_pick_description);
    case 'naming': return pick(ui.page_naming_title, ui.page_naming_description);
    case 'api': return pick(ui.page_api_title, ui.page_api_description);
    case 'privacy': return pick(ui.page_privacy_title, ui.page_privacy_description);
    case 'notFound': return pick(ui.page_not_found_title, ui.page_not_found_description);
  }
}
