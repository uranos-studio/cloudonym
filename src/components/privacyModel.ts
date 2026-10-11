// /privacy 의 숫자 · 표 (D56) — 안내 문장이 코드와 같은지 privacy.test 가 api 쪽 상수(META_KEYS · KV_TTL_SECONDS · RATE_LIMIT)에 대어 본다.
// components 는 api 를 들여오지 않으므로 값을 여기 따로 두고, 시험이 둘을 묶는다
import { en } from '../messages/en';
import { fillUi, type UiKey } from '../messages/catalog';

/** KV 일자 카운터의 수명(일) — telemetry.ts 의 KV_TTL_SECONDS / 86400 */
export const PRIVACY_KV_RETENTION_DAYS = 366;
/** Axiom 데이터셋에 설정한 보존 기간(일). 데이터셋을 만들기 전에는 null — 정하지 않은 숫자를 안내에 적지 않는다. 설정하면 그 값을 넣는다 */
export const PRIVACY_AXIOM_RETENTION_DAYS: number | null = null;
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
