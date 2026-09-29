// 표현 계층 (D23 · D24) — 엔진(CoreMessage)과 API(ApiMessage)의 코드를 사람이 읽는 문장으로 바꾼다.
// core 는 이 폴더를 들여오지 않는다. api 와 components 가 들여온다.
import type { CoreMessage } from '../core/messages';
import type { ApiMessage } from '../api/codes';

export type Message = CoreMessage | ApiMessage;
export type MessageCode = Message['code'];

/** 화면 문구 키 — 값은 사전(en.ts)이 채운다. `{이름}` 자리는 fillUi 가 채운다 */
export const UI_KEYS = [
  // ContextForm
  'form_title', 'form_hint', 'field_owner_hint', 'field_system_hint', 'field_purpose_hint',
  'field_owner_placeholder', 'field_system_placeholder', 'field_purpose_placeholder', 'region_global_label',
  // App
  'tab_all', 'tagline', 'nav_label', 'share_button', 'share_button_label', 'results_title', 'tablist_label',
  'empty_state', 'pass_meaning', 'version_footer', 'rules_version_mismatch',
  // ResultCard
  'copy_name_label', 'copy_invalid_label', 'shortened', 'transformed', 'originally_chars', 'length_range',
  'generation_charset', 'official_doc', 'validation',
  // LabelsPanel
  'copy_tags_json_label', 'copy_tags_json_blocked_label', 'copy_terraform_label', 'tags_json_blocked',
  'label_transformed_prefix', 'label_violation_prefix',
  // ProviderSection
  'provider_name_aws', 'provider_name_gcp', 'provider_name_azure',
  // Terraform 내보내기 첫 줄 주석 (D26)
  'terraform_header_version', 'terraform_header_pass',
  // clipboard
  'copy_done', 'copy_unavailable', 'copy_failed',
  // index.html
  'meta_description',
] as const;
export type UiKey = (typeof UI_KEYS)[number];

/** 코드마다 문장 함수 하나 — 코드가 빠지거나 그 코드의 params 를 안 받으면 tsc 오류다 */
export type MessageTemplates = { [K in MessageCode]: (m: Extract<Message, { code: K }>) => string };

export interface Catalog {
  messages: MessageTemplates;
  ui: Record<UiKey, string>;
}

/** 메시지 하나를 문장으로. 입력을 바꾸지 않는다 */
export function format(m: Message, catalog: Catalog): string {
  const template = catalog.messages[m.code] as (msg: Message) => string;
  return template(m);
}

/** 화면 문구의 `{이름}` 자리를 채운다. 없는 이름은 그대로 둔다 */
export function fillUi(catalog: Catalog, key: UiKey, vars: Record<string, string | number> = {}): string {
  return catalog.ui[key].replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}
