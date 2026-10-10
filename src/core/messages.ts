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
  // engine.ts (10)
  'step.normalized', 'step.separator_removed', 'name.token_empty', 'name.cannot_fit', 'rule.unknown_resource_type',
  'context.not_string', 'context.empty', 'context.value_unsupported', 'context.normalized', 'name.kind_required',
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
  'note.variant_narrowed', 'note.secondary_source', 'note.obsolete_source_applied', 'note.advisory_rule_enforced',
  // conflict.ts (1)
  'name.conflict',
  // selection.ts (14)
  'selection.not_array', 'selection.empty', 'selection.too_many_items', 'selection.item_not_object', 'selection.unknown_type',
  'selection.duplicate_type', 'selection.count_out_of_range', 'selection.count_not_supported', 'selection.role_not_supported',
  'selection.invalid_role', 'selection.too_many_names', 'selection.kind_not_supported', 'selection.unknown_kind', 'selection.kind_required',
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
  | { code: 'rule.unknown_resource_type'; params: { provider: string; supported: string[] } }
  | { code: 'context.not_string'; field: ContextField }
  | { code: 'context.empty'; field: ContextField }
  | { code: 'context.value_unsupported'; field: 'env' | 'region'; params: { value: string; supported: string[] } }
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
  | { code: 'selection.kind_required'; params: { index: number; type: string; supported: string[] } };

export type CoreCode = CoreMessage['code'];

// MESSAGE_CODES 와 유니언의 code 가 서로 같은 집합인지 컴파일 때 본다 — 한쪽에만 더하면 아래 줄이 타입 오류다
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const MESSAGE_CODES_MATCH_UNION: Same<(typeof MESSAGE_CODES)[number], CoreCode> = true;
