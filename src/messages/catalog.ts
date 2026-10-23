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
  'region_search_placeholder', 'region_no_match', 'region_options_label',
  // App — 네 단계 (D42)
  'headline', 'headline_sub', 'nav_label', 'nav_more', 'nav_more_label', 'share_button', 'share_button_label', 'share_warning', 'results_title',
  'empty_state', 'pass_meaning', 'version_footer', 'rules_version_mismatch',
  'step_cloud', 'step_context', 'step_resources', 'step_names', 'selection_dropped', 'switch_cloud_confirm',
  'sticky_summary', 'sticky_jump',
  // CloudPicker — 꺼진 CSP 의 표지 · 툴팁 · 꺼진 CSP 링크 안내 (D45 · D55)
  'cloud_group_label', 'pick_cloud_prompt', 'cloud_coming_soon', 'cloud_resource_count', 'cloud_planned_aws', 'cloud_planned_azure', 'provider_unavailable',
  // ResourceTree
  'resources_title', 'search_label', 'search_placeholder', 'search_empty', 'selected_only', 'selected_count',
  'expand_all', 'collapse_all', 'category_filter_label', 'category_all',
  'category_compute', 'category_networking', 'category_storage', 'category_database',
  'category_identity', 'category_security', 'category_management', 'category_containers',
  'select_resource_label', 'count_label', 'count_decrease', 'count_increase', 'count_fixed_hint',
  'role_label', 'role_hint', 'role_stale', 'tree_label',
  'kind_label', 'kind_default', 'kind_none', 'kind_choose', 'kind_required_hint',
  // ResourceTree — 행 · 범위 · (i) · 표지 · 존 (D50 · D53 · D54)
  'scope_choice_label', 'scope_choose', 'scope_required_hint', 'kind_dropped_on_scope',
  'info_toggle', 'enter_name_at', 'badge_api_only', 'badge_api_only_title', 'badge_preview', 'badge_preview_title', 'api_only_filter',
  // 헤더 · 푸터의 문서 경로 링크 (D57)
  'nav_naming_guide', 'footer_privacy', 'back_to_app',
  // ApiDoc — /docs/api (D98)
  'nav_api', 'api_title', 'api_intro', 'api_endpoints_title', 'api_col_method', 'api_col_path', 'api_col_what', 'api_col_limited',
  'api_yes', 'api_no', 'api_llms_summary', 'api_openapi_summary', 'api_internal', 'api_examples_title', 'api_examples_body',
  'api_request', 'api_response', 'api_loading', 'api_spec_failed', 'api_auth_title', 'api_auth_body', 'api_limits_title',
  'api_limits_body', 'api_errors_title', 'api_errors_body', 'api_version_title', 'api_version_body', 'api_terraform_title',
  'api_terraform_body', 'api_telemetry_title', 'api_telemetry_body',
  // NamingDoc — /docs/naming (D57)
  'doc_title',
  'doc_intro', 'doc_formula_title', 'doc_formula_body', 'doc_formula_caption', 'doc_col_formula', 'doc_col_optional',
  'doc_col_rule_count', 'doc_tokens_title', 'doc_tokens_body', 'doc_tokens_caption', 'doc_col_token', 'doc_col_meaning',
  'doc_token_owner', 'doc_token_system', 'doc_token_purpose', 'doc_token_env', 'doc_token_region', 'doc_token_slug',
  'doc_token_kind', 'doc_token_tier', 'doc_token_seq', 'doc_token_role', 'doc_regions_title', 'doc_regions_body', 'doc_regions_caption',
  'doc_col_region', 'doc_col_code', 'doc_col_location', 'doc_col_zones', 'doc_zones_title', 'doc_zones_body',
  'doc_env_title', 'doc_env_body', 'doc_env_caption', 'doc_col_value', 'doc_env_prod', 'doc_env_stg',
  'doc_env_dev', 'doc_env_sbx', 'doc_env_qa', 'doc_env_uat', 'doc_env_test', 'doc_env_perf', 'doc_env_dr', 'doc_shrink_title', 'doc_shrink_body', 'doc_shrink_step1', 'doc_shrink_step2',
  'doc_shrink_step3', 'doc_abbr_title', 'doc_abbr_body', 'doc_abbr_principles_title', 'doc_abbr_principle_1',
  'doc_abbr_principle_2', 'doc_abbr_principle_3', 'doc_abbr_principle_4', 'doc_abbr_caption', 'doc_col_resource', 'doc_col_abbr',
  'doc_col_basis', 'doc_col_previous', 'doc_kinds_title', 'doc_kinds_body', 'doc_kinds_caption', 'doc_col_values',
  'doc_col_default', 'doc_col_kind_rule', 'doc_kind_rule_omit', 'doc_kind_rule_chosen', 'doc_kind_rule_required',
  'doc_tiers_title', 'doc_tiers_body', 'doc_tier_pattern', 'doc_tier_reserved', 'doc_tier_presets',
  'doc_attached_title', 'doc_attached_body', 'doc_attached_caption', 'doc_col_suffix', 'doc_col_parent', 'doc_col_child',
  'doc_presets_title', 'doc_presets_body', 'doc_presets_caption', 'doc_col_preset', 'doc_col_label', 'doc_col_rule', 'doc_col_tier',
  'doc_col_options', 'doc_preset_ha', 'doc_preset_serverless', 'doc_preset_start_disk',
  'doc_pass_title', 'doc_none', 'doc_no_token',
  // Privacy — /privacy (D56)
  'privacy_title',
  'privacy_intro', 'privacy_browser_title', 'privacy_browser_session', 'privacy_browser_local', 'privacy_browser_hash', 'privacy_bucket_check', 'privacy_web_analytics', 'privacy_web_analytics_links',
  'privacy_web_analytics_link_about', 'privacy_web_analytics_link_collected', 'privacy_web_analytics_link_faq',
  'privacy_api_title', 'privacy_api_intro', 'privacy_api_common', 'privacy_col_event',
  'privacy_col_when', 'privacy_col_fields', 'privacy_when_ui_visit', 'privacy_when_ui_generate',
  'privacy_when_ui_copy', 'privacy_when_api_generate', 'privacy_when_api_names', 'privacy_when_api_validate', 'privacy_when_api_wizard',
  'privacy_when_llms_txt_accessed', 'privacy_when_catalog_json_accessed', 'privacy_target_note', 'privacy_rules_note', 'privacy_src_note', 'privacy_never_title',
  'privacy_never_body', 'privacy_retention_title', 'privacy_retention_kv', 'privacy_retention_axiom',
  'privacy_retention_axiom_unset', 'privacy_hosting_title', 'privacy_ip', 'privacy_hosting',
  'privacy_contact_title', 'privacy_contact_issues', 'privacy_contact_security', 'privacy_contact_changes', 'privacy_last_updated',
  // About — /about (D109)
  'about_what_title', 'about_what_body', 'about_example_title', 'about_checks_title', 'about_resources_title', 'about_resources_body', 'about_source_title', 'about_source_repo', 'about_license',
  'about_license_notice', 'about_trademark', 'about_status_title', 'about_status', 'about_versions_title', 'about_versions_body', 'about_links_title', 'about_intro_again',
  // NamesPanel
  'names_summary', 'names_empty_selection', 'copy_all_names', 'copy_all_names_skipped', 'copy_all_names_label',
  'copy_names_json_label', 'copy_names_json_blocked_label', 'conflict_prefix',
  // ResultCard
  'copy_name_label', 'copy_invalid_label', 'shortened', 'transformed', 'originally_chars', 'length_range',
  'generation_charset', 'official_doc', 'rule_details', 'rule_details_label', 'validation', 'name_warnings',
  // LabelsPanel
  'copy_tags_json_label', 'copy_tags_json_blocked_label', 'copy_terraform_label', 'tags_json_blocked',
  'label_transformed_prefix', 'label_violation_prefix',
  // ProviderSection
  'provider_name_aws', 'provider_name_gcp', 'provider_name_azure',
  // Terraform 내보내기 첫 줄 주석 (D26)
  'terraform_header_version', 'terraform_header_pass', 'terraform_boot_disk_note',
  // clipboard
  'copy_done', 'copy_unavailable', 'copy_failed',
  // 마법사 — 경로 nav · 일곱 단계 · 공용 추가 리소스 · 링크 복구 안내 (D67 · D68 · D84)
  'nav_wizard', 'nav_pick', 'nav_wizard_label', 'nav_pick_label', 'wizard_intro', 'wizard_step_project', 'wizard_project_hint', 'wizard_project_id', 'wizard_project_name', 'wizard_project_id_suffix', 'wizard_project_id_suffix_hint', 'wizard_project_id_notice', 'wizard_common_parts', 'wizard_project_resources', 'wizard_project_resources_hint', 'wizard_shared_extras', 'wizard_shared_extras_hint', 'wizard_firewall_tiers', 'wizard_firewall_custom', 'wizard_firewall_custom_add', 'wizard_firewall_custom_hint', 'wizard_firewall_custom_exists', 'wizard_add_subnet', 'wizard_project_picks_full', 'wizard_add_same_subnet', 'wizard_firewall_iap_hint', 'wizard_firewall_lbhc_hint', 'wizard_firewall_internal_hint', 'wizard_nat_hint', 'wizard_lb_parts', 'wizard_step_services', 'wizard_services_hint', 'wizard_service_name', 'wizard_service_placeholder', 'wizard_add_service', 'wizard_remove_service', 'wizard_step_purposes', 'wizard_purposes_hint', 'wizard_custom', 'wizard_custom_title', 'wizard_custom_hint_service', 'wizard_custom_hint_project', 'wizard_custom_close', 'wizard_custom_done', 'wizard_custom_full', 'wizard_custom_duplicate', 'wizard_custom_badge', 'wizard_tier', 'wizard_tier_hint', 'wizard_location', 'wizard_location_default', 'wizard_location_global', 'wizard_location_regional', 'wizard_step_options', 'wizard_ha', 'wizard_ha_hint', 'wizard_serverless', 'wizard_serverless_off', 'wizard_serverless_gcf', 'wizard_serverless_run', 'wizard_serverless_hint', 'wizard_servers', 'wizard_rows_of', 'wizard_server_number', 'wizard_server_label', 'wizard_add_server', 'wizard_add_resource', 'wizard_remove_server', 'wizard_renumber', 'wizard_renumber_hint', 'wizard_seq_invalid', 'wizard_step_attached', 'wizard_boot', 'wizard_boot_hint', 'wizard_data_disks', 'wizard_add_disk', 'wizard_remove_disk', 'wizard_disk_number', 'wizard_no_disks', 'wizard_attached_none', 'wizard_ip', 'wizard_ipi', 'wizard_bastion_hint', 'wizard_remove_pick', 'wizard_duplicate_pick', 'wizard_step_names', 'wizard_list_label', 'wizard_settings_label', 'wizard_row_names', 'wizard_row_errors', 'wizard_unnamed_service', 'wizard_service_no_picks', 'wizard_clear_network', 'wizard_clear_network_hint', 'wizard_not_exported', 'wizard_names_empty', 'wizard_fix_errors', 'wizard_names_summary', 'wizard_names_tab', 'wizard_names_bar', 'wizard_names_bar_one', 'wizard_names_bar_short', 'wizard_names_bar_short_one', 'wizard_names_bar_none', 'wizard_names_bar_pass', 'wizard_sample_badge', 'wizard_sample_note', 'wizard_sample_clear', 'wizard_sample_clear_label', 'wizard_names_close', 'wizard_view_tabs', 'wizard_group_project', 'wizard_group_service', 'wizard_group_env', 'wizard_envs', 'wizard_envs_hint',  'wizard_attached_to', 'wizard_link_broken', 'wizard_link_discarded', 'wizard_link_dropped', 'wizard_link_ha_off', 'wizard_link_serverless_off', 'wizard_link_trimmed',
  'plan_save', 'plan_save_label', 'plan_open', 'plan_open_label', 'plan_file_unreadable', 'plan_file_discarded', 'plan_file_ignored_keys', 'plan_file_version_mismatch', 'plan_file_over_api_limit',
  // 마법사 카드 · 화면 모드 (D93 · D94)
  'wizard_intro_close', 'wizard_about_label', 'intro_example', 'intro_example_note', 'intro_example_label', 'intro_example_run', 'intro_example_fwd', 'nav_about', 'nav_about_label', 'wizard_nothing_created', 'wizard_project_id_notice_summary', 'wizard_project_id_notice_more', 'wizard_project_next', 'wizard_project_next_hint', 'wizard_project_pending', 'wizard_region_placeholder', 'wizard_names_need_project', 'wizard_cloud', 'wizard_cloud_soon', 'wizard_cloud_label', 'wizard_gallery_title', 'wizard_gallery_hint', 'wizard_card_names', 'wizard_card_add', 'wizard_card_add_label', 'wizard_card_open', 'wizard_card_open_label', 'wizard_card_tested', 'wizard_card_untested', 'wizard_card_family', 'wizard_card_overlap', 'wizard_card_duplicate', 'wizard_card_full', 'wizard_card_complete', 'wizard_card_incomplete', 'wizard_card_missing', 'wizard_card_missing_lb', 'wizard_card_missing_other', 'wizard_card_no_backend', 'wizard_card_turn_on_full', 'wizard_card_turn_on_duplicate', 'wizard_card_turn_on_overlap', 'wizard_card_fill', 'wizard_card_remove', 'wizard_card_remove_hint', 'wizard_card_shared', 'wizard_card_options', 'wizard_card_parts', 'wizard_card_network', 'wizard_card_network_hint', 'wizard_card_edit', 'wizard_card_edit_label', 'wizard_card_back', 'wizard_card_sources', 'wizard_card_setup', 'wizard_card_setup_run', 'wizard_card_setup_static', 'wizard_card_setup_fs', 'wizard_card_setup_kms', 'wizard_card_setup_armor', 'wizard_card_setup_tasks', 'wizard_card_setup_roles', 'wizard_card_setup_mig', 'wizard_card_setup_mig_named', 'wizard_card_setup_doc', 'wizard_card_tag_lb', 'wizard_card_tag_redirect', 'wizard_card_tag_network', 'wizard_card_parts_count', 'wizard_card_state_complete', 'wizard_card_state_incomplete', 'wizard_add_more', 'wizard_add_more_hint', 'wizard_view_edit', 'theme_label', 'theme_light', 'theme_dark', 'theme_system',
  // ResultCard — 버킷 이름 확인 (D83)
  'bucket_check', 'bucket_check_label', 'bucket_checking', 'bucket_check_note', 'bucket_available', 'bucket_taken', 'bucket_unknown',
  // index.html · 경로마다 제목 · 설명 (D106 — src/site/copy 가 짝짓는다)
  'meta_description',
  'og_image_alt', 'page_app_title', 'page_pick_title', 'page_pick_description', 'page_naming_title', 'page_naming_description', 'page_api_title', 'page_api_description', 'page_privacy_title', 'page_privacy_description', 'page_about_title', 'page_about_description', 'page_not_found_title', 'page_not_found_description', 'page_not_found_body',
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
