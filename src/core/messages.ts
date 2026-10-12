// 엔진 메시지 코드 (D23) — 엔진은 문장을 만들지 않고 코드와 params 만 돌려준다. 문장은 src/messages/ 가 만든다.
// params 가 없는 코드는 params 키 자체가 없다. params 의 사용자 값(from · to · value)은 표시용 문자열이다.
import type { Token } from './types';

/** parseContext 가 보는 문맥 필드 */
export type ContextField = 'owner' | 'system' | 'purpose' | 'env' | 'region';

export const MESSAGE_CODES = [
  // validate.ts checkName (13)
  'name.empty', 'name.too_long', 'name.too_short', 'name.first_not_letter', 'name.last_not_alnum', 'name.pattern_mismatch',
  'name.consecutive_separator', 'name.forbidden_prefix', 'name.forbidden_suffix', 'name.forbidden_substring',
  'name.forbidden_exact', 'name.forbidden_word', 'name.ipv4_form',
  // engine.ts (12)
  'step.normalized', 'step.separator_removed', 'name.token_empty', 'name.cannot_fit', 'rule.unknown_resource_type',
  'context.not_string', 'context.empty', 'context.value_unsupported', 'context.normalized', 'name.kind_required',
  'context.location_unsupported', 'name.location_unsupported',
  // truncate.ts (3)
  'step.token_dropped', 'step.abbreviated', 'step.budget_shortened',
  // labels.ts (3)
  'label.normalized', 'label.too_long', 'label.aws_invalid_chars',
  // constraints.ts notes (9)
  'note.aws_tag_utf16_length', 'note.azure_vm_hostname_rule', 'note.azure_reserved', 'note.azure_reserved_ambiguous',
  'note.windows_no_all_digits', 'note.cloud_sql_combined_limit', 'note.gcs_dotted_names_222', 'note.s3_an_suffix',
  'note.gcp_vm_project_unique', 'note.aws_key_pair_scope_unconfirmed', 'note.aws_schema_scope_unconfirmed',
  // rules/*-manual.ts notes (9)
  'note.scope_unconfirmed', 'note.narrower_source_used', 'note.blocklist_narrowed', 'note.parent_length_limit', 'note.unicode_excluded',
  'note.variant_narrowed', 'note.secondary_source', 'note.observed_server_rule', 'note.obsolete_source_applied', 'note.advisory_rule_enforced',
  // conflict.ts (1)
  'name.conflict',
  // selection.ts (14)
  'selection.not_array', 'selection.empty', 'selection.too_many_items', 'selection.item_not_object', 'selection.unknown_type',
  'selection.duplicate_type', 'selection.count_out_of_range', 'selection.count_not_supported', 'selection.role_not_supported',
  'selection.invalid_role', 'selection.too_many_names', 'selection.kind_not_supported', 'selection.unknown_kind', 'selection.kind_required',
  // engine.ts attachName (2)
  'name.parent_invalid', 'name.parent_name',
  // wizard/attachments.ts checkAttachments (5)
  'wizard.children_not_supported', 'wizard.attach_not_object', 'wizard.attach_out_of_range', 'wizard.invalid_data_seq', 'wizard.duplicate_seq',
  // wizard/plan.ts validatePlan (22)
  'wizard.tier_reserved', 'wizard.invalid_tier', 'wizard.tier_not_supported', 'wizard.level_not_supported', 'wizard.reserved_pick',
  'wizard.serverless_not_supported', 'wizard.instances_not_supported', 'wizard.duplicate_pick', 'wizard.empty', 'wizard.duplicate_service',
  'wizard.reserved_service', 'wizard.empty_service', 'wizard.unknown_preset', 'wizard.count_below_min', 'wizard.ha_not_supported',
  'wizard.too_many_names', 'wizard.too_many_services', 'wizard.too_many_picks', 'wizard.invalid_slot_id', 'wizard.duplicate_slot_id',
  'wizard.invalid_seq', 'wizard.invalid_location',
] as const;

export type CoreMessage =
  | { code: 'name.empty' }
  | { code: 'name.too_long'; params: { actual: number; max: number } }
  | { code: 'name.too_short'; params: { actual: number; min: number } }
  | { code: 'name.first_not_letter' }
  | { code: 'name.last_not_alnum' }
  | { code: 'name.pattern_mismatch'; params: { pattern: string } }
  | { code: 'name.consecutive_separator'; params: { separator: string } }
  | { code: 'name.forbidden_prefix'; params: { value: string } }
  | { code: 'name.forbidden_suffix'; params: { value: string } }
  | { code: 'name.forbidden_substring'; params: { value: string } }
  | { code: 'name.forbidden_exact'; params: { value: string } }
  | { code: 'name.forbidden_word'; params: { value: string } }
  | { code: 'name.ipv4_form' }
  | { code: 'step.normalized'; field: Token; params: { from: string; to: string } }
  | { code: 'step.separator_removed' }
  | { code: 'name.token_empty'; field: Token }
  | { code: 'name.cannot_fit'; params: { max: number } }
  /** 종류가 필수인 규칙(리소스 정책)에 종류가 없다 — supported 는 그 규칙의 허용 값 (D52). 이름은 종류 없이 만든 것을 싣는다 */
  | { code: 'name.kind_required'; params: { supported: string[] } }
  /** 문맥의 지역이 이 규칙이 받지 않는 멀티 · 이중 리전 위치다 (D78) — supported 는 그 위치를 받는 resourceType */
  | { code: 'name.location_unsupported'; params: { location: string; supported: string[] } }
  | { code: 'rule.unknown_resource_type'; params: { provider: string; supported: string[] } }
  | { code: 'context.not_string'; field: ContextField }
  | { code: 'context.empty'; field: ContextField }
  | { code: 'context.value_unsupported'; field: 'env' | 'region'; params: { value: string; supported: string[] } }
  /** 멀티 · 이중 리전 위치를 그 위치를 받지 않는 규칙에 썼다 (D78) — supported 는 그 위치를 받는 resourceType */
  | { code: 'context.location_unsupported'; field: 'region'; params: { value: string; supported: string[] } }
  | { code: 'context.normalized'; field: 'env' | 'region'; params: { from: string; to: string } }
  | { code: 'step.token_dropped'; field: Token }
  | { code: 'step.abbreviated'; field: Token; params: { from: string; to: string } }
  | { code: 'step.budget_shortened'; params: { budget: number } }
  | { code: 'label.normalized'; field: string; params: { from: string; to: string } }
  | { code: 'label.too_long'; field: string; params: { actual: number; max: number } }
  | { code: 'label.aws_invalid_chars'; field: string }
  | { code: 'note.aws_tag_utf16_length' }
  | { code: 'note.azure_vm_hostname_rule' }
  | { code: 'note.azure_reserved'; params: { doc_url: string } }
  | { code: 'note.azure_reserved_ambiguous'; params: { doc_url: string } }
  | { code: 'note.windows_no_all_digits'; params: { doc_url: string } }
  | { code: 'note.cloud_sql_combined_limit' }
  | { code: 'note.gcs_dotted_names_222' }
  | { code: 'note.s3_an_suffix' }
  | { code: 'note.gcp_vm_project_unique' }
  | { code: 'note.aws_key_pair_scope_unconfirmed' }
  | { code: 'note.aws_schema_scope_unconfirmed' }
  | { code: 'note.scope_unconfirmed' }
  | { code: 'note.narrower_source_used' }
  | { code: 'note.blocklist_narrowed' }
  | { code: 'note.parent_length_limit' }
  | { code: 'note.unicode_excluded' }
  | { code: 'note.variant_narrowed' }
  | { code: 'note.secondary_source' }
  | { code: 'note.observed_server_rule' }
  | { code: 'note.obsolete_source_applied' }
  | { code: 'note.advisory_rule_enforced' }
  /** keys 는 충돌한 항목의 key(NameItem.key) — 처음 나온 순 */
  | { code: 'name.conflict'; params: { name: string; keys: string[] } }
  | { code: 'selection.not_array' }
  | { code: 'selection.empty' }
  | { code: 'selection.too_many_items'; params: { max: number } }
  | { code: 'selection.item_not_object'; params: { index: number } }
  /** value 는 표시용 문자열(비문자열은 String()). 지원 목록은 항목마다 싣지 않는다 — API 응답 수준 supported 에 한 번 (오류 200개가 목록 200벌이 되지 않게) */
  | { code: 'selection.unknown_type'; params: { index: number; value: string } }
  | { code: 'selection.duplicate_type'; params: { index: number; value: string } }
  | { code: 'selection.count_out_of_range'; params: { index: number; min: number; max: number } }
  | { code: 'selection.count_not_supported'; params: { index: number; type: string } }
  | { code: 'selection.role_not_supported'; params: { index: number; type: string } }
  | { code: 'selection.invalid_role'; params: { index: number; value: string; pattern: string } }
  | { code: 'selection.too_many_names'; params: { max: number; actual: number } }
  /** 종류 (D52) — supported 는 그 규칙(= 범위)의 허용 값 이름. 규칙마다 다르므로 항목에 싣는다(많아야 아홉 값) */
  | { code: 'selection.kind_not_supported'; params: { index: number; type: string } }
  | { code: 'selection.unknown_kind'; params: { index: number; type: string; value: string; supported: string[] } }
  | { code: 'selection.kind_required'; params: { index: number; type: string; supported: string[] } }
  /** 부모가 최종 FAIL(축소 · 충돌 어느 것이든)이라 딸린 이름을 만들지 않았다 — parent 는 부모의 항목 key (D62 · D69) */
  | { code: 'name.parent_invalid'; params: { parent: string } }
  /** 딸린 이름이 넘칠 때 name.cannot_fit 에 같이 싣는다 — parent 는 부모의 최종 이름, suffix 는 더한 접미(-data-01) (D62) */
  | { code: 'name.parent_name'; params: { parent: string; suffix: string } }
  /** 마법사 딸린 것 검사 (D62) — index 는 pick 의 자리. 위치(path)는 부르는 쪽이 꼬리를 붙여 싣는다 */
  | { code: 'wizard.children_not_supported'; params: { index: number; type: string } }
  | { code: 'wizard.attach_not_object'; params: { index: number } }
  | { code: 'wizard.attach_out_of_range'; params: { index: number; max: number } }
  | { code: 'wizard.invalid_data_seq'; params: { index: number; value: string; pattern: string } }
  /** value 는 겹친 순번 — 디스크면 data/03 꼴 */
  | { code: 'wizard.duplicate_seq'; params: { index: number; value: string } }
  /** 마법사 모델 검사 (D60 · D61 · D63 · D64) — index 는 pick 의 자리(서비스 코드는 서비스의 자리). 위치는 validatePlan 이 path 로 싣는다 */
  | { code: 'wizard.tier_reserved'; params: { index: number; value: string } }
  | { code: 'wizard.invalid_tier'; params: { index: number; value: string; pattern: string } }
  | { code: 'wizard.tier_not_supported'; params: { index: number; type: string } }
  /** pick 의 위치(D78) — 그 규칙이 받는 멀티 · 이중 리전 코드가 아니다. supported 가 비면 그 규칙은 위치를 받지 않는다 */
  | { code: 'wizard.invalid_location'; params: { index: number; type: string; value: string; supported: string[] } }
  | { code: 'wizard.level_not_supported'; params: { index: number; type: string } }
  | { code: 'wizard.reserved_pick'; params: { index: number; type: string } }
  | { code: 'wizard.serverless_not_supported'; params: { index: number; type: string } }
  | { code: 'wizard.instances_not_supported'; params: { index: number; type: string } }
  /** value 는 겹친 항목 — type 또는 type/tier */
  | { code: 'wizard.duplicate_pick'; params: { index: number; value: string } }
  | { code: 'wizard.empty' }
  /** value 는 정제 뒤 purpose */
  | { code: 'wizard.duplicate_service'; params: { index: number; value: string } }
  | { code: 'wizard.reserved_service'; params: { index: number; value: string } }
  | { code: 'wizard.empty_service'; params: { index: number } }
  | { code: 'wizard.unknown_preset'; params: { index: number; value: string; supported: string[] } }
  | { code: 'wizard.count_below_min'; params: { index: number; min: number } }
  | { code: 'wizard.ha_not_supported'; params: { index: number; type: string } }
  | { code: 'wizard.too_many_names'; params: { max: number; actual: number } }
  | { code: 'wizard.too_many_services'; params: { max: number; actual: number } }
  /** index 는 서비스의 자리 — 프로젝트 공용 pick 이면 -1 (path 가 projectPicks) */
  | { code: 'wizard.too_many_picks'; params: { index: number; max: number; actual: number } }
  | { code: 'wizard.invalid_slot_id'; params: { index: number; value: string; pattern: string } }
  | { code: 'wizard.duplicate_slot_id'; params: { index: number; value: string } }
  | { code: 'wizard.invalid_seq'; params: { index: number; value: string; pattern: string } };

export type CoreCode = CoreMessage['code'];

// MESSAGE_CODES 와 유니언의 code 가 서로 같은 집합인지 컴파일 때 본다 — 한쪽에만 더하면 아래 줄이 타입 오류다
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const MESSAGE_CODES_MATCH_UNION: Same<(typeof MESSAGE_CODES)[number], CoreCode> = true;
