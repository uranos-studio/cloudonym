// 표현 계층 (D23 · D24) — 엔진(CoreMessage)과 API(ApiMessage)의 코드를 사람이 읽는 문장으로 바꾼다.
// core 는 이 폴더를 들여오지 않는다. api 와 components 가 들여온다.
import type { CoreMessage } from '../core/messages';
import type { ApiMessage } from '../api/codes';
import { escapeInvisible } from '../core/display';

export type Message = CoreMessage | ApiMessage;
export type MessageCode = Message['code'];

/** 화면 문구 키 — 값은 사전(en.ts)이 채운다. `{이름}` 자리는 fillUi 가 채운다 */
export const UI_KEYS = [
  // ContextForm
  'form_title', 'form_hint', 'field_owner_hint', 'field_system_hint', 'field_purpose_hint',
  'field_owner_placeholder', 'field_system_placeholder', 'field_purpose_placeholder', 'region_global_label',
  // RegionPicker (D49 · D50)
  'region_search_placeholder', 'region_no_match', 'region_options_label', 'zone_none', 'zone_hint',
  // App — 네 단계 (D42)
  'tagline', 'nav_label', 'share_button', 'share_button_label', 'share_warning', 'results_title',
  'empty_state', 'pass_meaning', 'version_footer', 'rules_version_mismatch',
  'step_cloud', 'step_context', 'step_resources', 'step_names', 'selection_dropped', 'switch_cloud_confirm',
  'sticky_summary', 'sticky_jump',
  // CloudPicker — 꺼진 CSP 의 표지 · 툴팁 · 꺼진 CSP 링크 안내 (D45 · D55)
  'cloud_group_label', 'pick_cloud_prompt', 'cloud_coming_soon', 'cloud_planned_aws', 'cloud_planned_azure', 'provider_unavailable',
  // ResourceTree
  'resources_title', 'search_label', 'search_placeholder', 'search_empty', 'selected_only', 'selected_count',
  'expand_all', 'collapse_all', 'category_filter_label', 'category_all',
  'category_compute', 'category_networking', 'category_storage', 'category_database',
  'category_identity', 'category_security', 'category_management', 'category_containers',
  'select_resource_label', 'count_label', 'count_decrease', 'count_increase', 'count_fixed_hint',
  'role_label', 'role_hint', 'role_stale', 'tree_label',
  'kind_label', 'kind_default', 'kind_none', 'kind_choose', 'kind_required_hint',
  // ResourceTree — 행 · 범위 · (i) · 표지 · 존 (D50 · D53 · D54)
  'scope_choice_label', 'scope_choose', 'scope_required_hint', 'kind_dropped_on_scope', 'zone_row_hint', 'zone_row_hint_global',
  'info_toggle', 'enter_name_at', 'badge_api_only', 'badge_api_only_title', 'badge_preview', 'badge_preview_title', 'api_only_filter',
  // 헤더 · 푸터의 문서 경로 링크 (D57)
  'nav_naming_guide', 'footer_privacy', 'back_to_app',
  // NamingDoc — /docs/naming (D57)
  'doc_title',
  // Privacy — /privacy
  'privacy_title',
  // NamesPanel
  'names_summary', 'names_empty_selection', 'copy_all_names', 'copy_all_names_skipped', 'copy_all_names_label',
  'copy_names_json_label', 'copy_names_json_blocked_label', 'conflict_prefix',
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

/** 보이지 않는 문자 이스케이프는 core/display.ts 가 정본이다 — Terraform 내보내기(components/terraform.ts)와 메시지 params(아래 displayMessage)가 같이 쓴다 */
export { escapeInvisible };

/** 메시지의 문자열 params(배열 원소 포함)를 escapeInvisible 로 바꾼 사본 — 사용자 값이 들어가는 자리라 표시 전에 거친다 */
export function displayMessage<M extends Message>(m: M): M {
  if (!('params' in m) || m.params === undefined) return m;
  const params = Object.fromEntries(Object.entries(m.params as Record<string, unknown>).map(([k, v]) => [k,
    typeof v === 'string' ? escapeInvisible(v) : Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? escapeInvisible(x) : x)) : v]));
  return { ...m, params };
}

/** 메시지 하나를 문장으로 — params 의 보이지 않는 문자는 `\uXXXX` 로 바꿔 넣는다. 입력을 바꾸지 않는다 */
export function format(m: Message, catalog: Catalog): string {
  const template = catalog.messages[m.code] as (msg: Message) => string;
  return template(displayMessage(m));
}

/** 규칙 notes 를 한 줄로 — 화면(ResultCard)과 llms.txt 가 같은 구분자를 쓴다 */
export const NOTE_SEPARATOR = '; ';
export function formatNotes(notes: readonly Message[], catalog: Catalog): string {
  return notes.map((m) => format(m, catalog)).join(NOTE_SEPARATOR);
}

/** 화면 문구의 `{이름}` 자리를 채운다. 없는 이름은 그대로 둔다 */
export function fillUi(catalog: Catalog, key: UiKey, vars: Record<string, string | number> = {}): string {
  return catalog.ui[key].replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}
