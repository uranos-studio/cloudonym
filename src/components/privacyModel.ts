// /privacy 의 숫자 · 표 (D56) — 안내 문장이 코드와 같은지 privacy.test 가 api 쪽 상수(META_KEYS · KV_TTL_SECONDS · RATE_LIMIT)에 대어 본다.
// components 는 api 를 들여오지 않으므로 값을 여기 따로 두고, 시험이 둘을 묶는다
import { en } from '../messages/en';
import { fillUi, type UiKey } from '../messages/catalog';
import { AVAILABILITY_ORIGIN } from './availabilityOrigin';
import { SOURCE_REPOSITORY_URL } from './aboutModel';

/** KV 일자 카운터의 수명(일) — telemetry.ts 의 KV_TTL_SECONDS / 86400 */
export const PRIVACY_KV_RETENTION_DAYS = 366;
/** Axiom 데이터셋에 설정한 보존 기간(일). 데이터셋을 만들기 전에는 null — 정하지 않은 숫자를 안내에 적지 않는다. 설정하면 그 값을 넣는다 */
export const PRIVACY_AXIOM_RETENTION_DAYS: number | null = 30;
/** 버킷 이름 「Check」가 브라우저에서 직접 묻는 곳 (D83) — availability.ts 의 값 · public/_headers 의 connect-src 와 같다(privacy-sync.test) */
export const PRIVACY_BUCKET_CHECK_ORIGIN = AVAILABILITY_ORIGIN;
/** Cloudflare Web Analytics 스크립트의 출처 (D110) — Cloudflare 가 HTML 응답에 넣는다. public/_headers 의 script-src 가 self 밖에 허용하는 유일한 출처(privacy-sync.test) */
export const PRIVACY_WEB_ANALYTICS_ORIGIN = 'https://static.cloudflareinsights.com';
/** Web Analytics 가 무엇을 모으는지 Cloudflare 가 적은 문서 — 안내가 링크로 건다 */
export const PRIVACY_WEB_ANALYTICS_DOCS: readonly { href: string; label: UiKey }[] = [
  { href: 'https://developers.cloudflare.com/web-analytics/about/', label: 'privacy_web_analytics_link_about' },
  { href: 'https://developers.cloudflare.com/web-analytics/data-metrics/core-web-vitals/#information-collected', label: 'privacy_web_analytics_link_collected' },
  { href: 'https://developers.cloudflare.com/web-analytics/faq/', label: 'privacy_web_analytics_link_faq' },
];
/** 운영자 점검 요청이 싣는 헤더 이름 (D99) — telemetry.ts 의 TELEMETRY_SKIP_HEADER 와 같다(privacy-sync.test). 값(비밀)은 화면에 없다 */
export const PRIVACY_SKIP_HEADER = 'x-cloudonym-telemetry-skip';
/** ratelimit.ts 의 RATE_LIMIT 과 같다 */
export const PRIVACY_RATE_LIMIT = { limit: 60, period: 60 } as const;

/** 계측 표 — 이벤트 · 언제 · 덧붙는 필드. telemetry.ts 의 META_KEYS 와 같은 순서 · 같은 필드 */
export const PRIVACY_EVENTS: readonly { event: string; when: UiKey; fields: readonly string[] }[] = [
  { event: 'ui_visit', when: 'privacy_when_ui_visit', fields: [] },
  { event: 'ui_generate', when: 'privacy_when_ui_generate', fields: ['chip_rules', 'custom_rules'] },
  { event: 'ui_copy', when: 'privacy_when_ui_copy', fields: ['target'] },
  { event: 'api_generate', when: 'privacy_when_api_generate', fields: ['providers'] },
  { event: 'api_names', when: 'privacy_when_api_names', fields: ['provider', 'resource_count', 'name_count', 'valid'] },
  { event: 'api_validate', when: 'privacy_when_api_validate', fields: ['provider', 'resource_type', 'valid'] },
  { event: 'api_wizard', when: 'privacy_when_api_wizard', fields: ['provider', 'service_count', 'resource_count', 'name_count', 'valid', 'chip_rules', 'custom_rules'] },
  { event: 'llms_txt_accessed', when: 'privacy_when_llms_txt_accessed', fields: [] },
  { event: 'catalog_json_accessed', when: 'privacy_when_catalog_json_accessed', fields: [] },
];

/** Axiom 보존 문장 — 설정한 일수가 있으면 그 숫자, 없으면 숫자 없이 「데이터셋에 설정한 값」 */
export function axiomRetentionText(days: number | null): string {
  return days === null ? en.ui.privacy_retention_axiom_unset : fillUi(en, 'privacy_retention_axiom', { days });
}

/** 안내를 마지막으로 고친 날(KST). 본문이 바뀌면 privacy.test 의 지문 시험이 깨진다 — 이 날짜와 지문을 같이 고친다 */
export const PRIVACY_LAST_UPDATED = '2026-10-15';
/** 연락 경로 — 질문은 공개 이슈, 보안 문제는 GitHub 비공개 취약점 신고(SECURITY.md 와 같은 창구). 이메일은 적지 않는다 */
export const PRIVACY_CONTACT = {
  issues: `${SOURCE_REPOSITORY_URL}/issues`,
  security: `${SOURCE_REPOSITORY_URL}/security/advisories/new`,
} as const;
