// 영어 사전 — 모든 코드에 문장이 있고, 시스템이 쓰는 문구에 한글이 없고, params 가 문장에 들어가는지 본다
import { describe, it, expect } from 'vitest';
import { MESSAGE_CODES } from '../core/messages';
import { API_CODES } from '../api/codes';
import { NOTE_SEPARATOR, UI_KEYS, displayMessage, escapeInvisible, fillUi, format, formatNotes, type Message, type MessageCode } from './catalog';
import { en } from './en';

const HANGUL = /\p{Script=Hangul}/u;

// 코드마다 ASCII sentinel params 를 넣은 표본 — 매핑 타입이라 코드 · params 가 빠지면 이 표가 tsc 오류다.
// 사용자 값 자리는 AAA · BBB · CCC 로 채워 사전 문장만 검사한다 (사용자 값의 한글은 검사 대상이 아니다)
const SAMPLES: { [K in MessageCode]: Extract<Message, { code: K }> } = {
  'name.empty': { code: 'name.empty' },
  'name.too_long': { code: 'name.too_long', params: { actual: 34, max: 30 } },
  'name.too_short': { code: 'name.too_short', params: { actual: 2, min: 3 } },
  'name.first_not_letter': { code: 'name.first_not_letter' },
  'name.last_not_alnum': { code: 'name.last_not_alnum' },
  'name.pattern_mismatch': { code: 'name.pattern_mismatch', params: { pattern: 'AAA' } },
  'name.consecutive_separator': { code: 'name.consecutive_separator', params: { separator: '--' } },
  'name.forbidden_prefix': { code: 'name.forbidden_prefix', params: { value: 'BBB' } },
  'name.forbidden_suffix': { code: 'name.forbidden_suffix', params: { value: 'BBB' } },
  'name.forbidden_substring': { code: 'name.forbidden_substring', params: { value: 'BBB' } },
  'name.forbidden_exact': { code: 'name.forbidden_exact', params: { value: 'BBB' } },
  'name.forbidden_word': { code: 'name.forbidden_word', params: { value: 'BBB' } },
  'name.ipv4_form': { code: 'name.ipv4_form' },
  'step.normalized': { code: 'step.normalized', field: 'owner', params: { from: 'AAA', to: 'BBB' } },
  'step.separator_removed': { code: 'step.separator_removed' },
  'name.token_empty': { code: 'name.token_empty', field: 'system' },
  'name.cannot_fit': { code: 'name.cannot_fit', params: { max: 15 } },
  'name.kind_required': { code: 'name.kind_required', params: { supported: ['CCC', 'DDD'] } },
  'name.parent_invalid': { code: 'name.parent_invalid', params: { parent: 'AAA' } },
  'name.parent_name': { code: 'name.parent_name', params: { parent: 'AAA', suffix: '-BBB' } },
  'wizard.children_not_supported': { code: 'wizard.children_not_supported', params: { index: 2, type: 'AAA' } },
  'wizard.attach_not_object': { code: 'wizard.attach_not_object', params: { index: 2 } },
  'wizard.attach_out_of_range': { code: 'wizard.attach_out_of_range', params: { index: 2, max: 9 } },
  'wizard.invalid_data_seq': { code: 'wizard.invalid_data_seq', params: { index: 2, value: 'BBB', pattern: 'CCC' } },
  'wizard.duplicate_seq': { code: 'wizard.duplicate_seq', params: { index: 2, value: 'BBB' } },
  'wizard.tier_reserved': { code: 'wizard.tier_reserved', params: { index: 2, value: 'BBB' } },
  'wizard.invalid_tier': { code: 'wizard.invalid_tier', params: { index: 2, value: 'BBB', pattern: 'CCC' } },
  'wizard.tier_not_supported': { code: 'wizard.tier_not_supported', params: { index: 2, type: 'AAA' } },
  'wizard.level_not_supported': { code: 'wizard.level_not_supported', params: { index: 2, type: 'AAA' } },
  'wizard.reserved_pick': { code: 'wizard.reserved_pick', params: { index: 2, type: 'AAA' } },
  'wizard.serverless_not_supported': { code: 'wizard.serverless_not_supported', params: { index: 2, type: 'AAA' } },
  'wizard.instances_not_supported': { code: 'wizard.instances_not_supported', params: { index: 2, type: 'AAA' } },
  'wizard.duplicate_pick': { code: 'wizard.duplicate_pick', params: { index: 2, value: 'BBB' } },
  'wizard.empty': { code: 'wizard.empty' },
  'wizard.duplicate_service': { code: 'wizard.duplicate_service', params: { index: 2, value: 'BBB' } },
  'wizard.reserved_service': { code: 'wizard.reserved_service', params: { index: 2, value: 'BBB' } },
  'wizard.empty_service': { code: 'wizard.empty_service', params: { index: 2 } },
  'wizard.unknown_preset': { code: 'wizard.unknown_preset', params: { index: 2, value: 'BBB', supported: ['CCC', 'DDD'] } },
  'wizard.count_below_min': { code: 'wizard.count_below_min', params: { index: 2, min: 2 } },
  'wizard.ha_not_supported': { code: 'wizard.ha_not_supported', params: { index: 2, type: 'AAA' } },
  'wizard.too_many_names': { code: 'wizard.too_many_names', params: { max: 200, actual: 201 } },
  'wizard.too_many_services': { code: 'wizard.too_many_services', params: { max: 20, actual: 21 } },
  'wizard.too_many_picks': { code: 'wizard.too_many_picks', params: { index: 2, max: 20, actual: 21 } },
  'wizard.invalid_slot_id': { code: 'wizard.invalid_slot_id', params: { index: 2, value: 'BBB', pattern: 'CCC' } },
  'wizard.duplicate_slot_id': { code: 'wizard.duplicate_slot_id', params: { index: 2, value: 'BBB' } },
  'wizard.invalid_seq': { code: 'wizard.invalid_seq', params: { index: 2, value: 'BBB', pattern: 'CCC' } },
  'rule.unknown_resource_type': { code: 'rule.unknown_resource_type', params: { provider: 'AAA', supported: ['CCC', 'DDD'] } },
  'context.not_string': { code: 'context.not_string', field: 'owner' },
  'context.empty': { code: 'context.empty', field: 'owner' },
  'context.value_unsupported': { code: 'context.value_unsupported', field: 'env', params: { value: 'BBB', supported: ['CCC'] } },
  'context.normalized': { code: 'context.normalized', field: 'env', params: { from: 'AAA', to: 'BBB' } },
  'step.token_dropped': { code: 'step.token_dropped', field: 'region' },
  'step.abbreviated': { code: 'step.abbreviated', field: 'purpose', params: { from: 'AAA', to: 'BBB' } },
  'step.budget_shortened': { code: 'step.budget_shortened', params: { budget: 7 } },
  'label.normalized': { code: 'label.normalized', field: 'owner', params: { from: 'AAA', to: 'BBB' } },
  'label.too_long': { code: 'label.too_long', field: 'owner', params: { actual: 65, max: 63 } },
  'label.aws_invalid_chars': { code: 'label.aws_invalid_chars', field: 'owner' },
  'note.aws_tag_utf16_length': { code: 'note.aws_tag_utf16_length' },
  'note.azure_vm_hostname_rule': { code: 'note.azure_vm_hostname_rule' },
  'note.azure_reserved': { code: 'note.azure_reserved', params: { doc_url: 'https://example.com/AAA' } },
  'note.azure_reserved_ambiguous': { code: 'note.azure_reserved_ambiguous', params: { doc_url: 'https://example.com/AAA' } },
  'note.windows_no_all_digits': { code: 'note.windows_no_all_digits', params: { doc_url: 'https://example.com/AAA' } },
  'note.cloud_sql_combined_limit': { code: 'note.cloud_sql_combined_limit' },
  'note.gcs_dotted_names_222': { code: 'note.gcs_dotted_names_222' },
  'note.s3_an_suffix': { code: 'note.s3_an_suffix' },
  'note.gcp_vm_project_unique': { code: 'note.gcp_vm_project_unique' },
  'note.aws_key_pair_scope_unconfirmed': { code: 'note.aws_key_pair_scope_unconfirmed' },
  'note.aws_schema_scope_unconfirmed': { code: 'note.aws_schema_scope_unconfirmed' },
  'note.scope_unconfirmed': { code: 'note.scope_unconfirmed' },
  'note.narrower_source_used': { code: 'note.narrower_source_used' },
  'note.blocklist_narrowed': { code: 'note.blocklist_narrowed' },
  'note.parent_length_limit': { code: 'note.parent_length_limit' },
  'note.unicode_excluded': { code: 'note.unicode_excluded' },
  'note.variant_narrowed': { code: 'note.variant_narrowed' },
  'note.secondary_source': { code: 'note.secondary_source' },
  'note.obsolete_source_applied': { code: 'note.obsolete_source_applied' },
  'note.advisory_rule_enforced': { code: 'note.advisory_rule_enforced' },
  'name.conflict': { code: 'name.conflict', params: { name: 'AAA', keys: ['CCC', 'DDD'] } },
  'selection.not_array': { code: 'selection.not_array' },
  'selection.empty': { code: 'selection.empty' },
  'selection.too_many_items': { code: 'selection.too_many_items', params: { max: 200 } },
  'selection.item_not_object': { code: 'selection.item_not_object', params: { index: 3 } },
  'selection.unknown_type': { code: 'selection.unknown_type', params: { index: 3, value: 'BBB' } },
  'selection.duplicate_type': { code: 'selection.duplicate_type', params: { index: 3, value: 'BBB' } },
  'selection.count_out_of_range': { code: 'selection.count_out_of_range', params: { index: 3, min: 1, max: 99 } },
  'selection.count_not_supported': { code: 'selection.count_not_supported', params: { index: 3, type: 'BBB' } },
  'selection.role_not_supported': { code: 'selection.role_not_supported', params: { index: 3, type: 'BBB' } },
  'selection.invalid_role': { code: 'selection.invalid_role', params: { index: 3, value: 'BBB', pattern: 'AAA' } },
  'selection.too_many_names': { code: 'selection.too_many_names', params: { max: 200, actual: 201 } },
  'selection.kind_not_supported': { code: 'selection.kind_not_supported', params: { index: 3, type: 'BBB' } },
  'selection.unknown_kind': { code: 'selection.unknown_kind', params: { index: 3, type: 'BBB', value: 'AAA', supported: ['CCC', 'DDD'] } },
  'selection.kind_required': { code: 'selection.kind_required', params: { index: 3, type: 'BBB', supported: ['CCC', 'DDD'] } },
  'request.body_not_json': { code: 'request.body_not_json' },
  'request.body_not_object': { code: 'request.body_not_object' },
  'request.body_too_large': { code: 'request.body_too_large', params: { max_bytes: 16384 } },
  'request.context_not_object': { code: 'request.context_not_object' },
  'request.field_too_long': { code: 'request.field_too_long', field: 'owner', params: { max: 1024 } },
  'request.providers_not_array': { code: 'request.providers_not_array' },
  'request.providers_empty': { code: 'request.providers_empty' },
  'request.value_unsupported': { code: 'request.value_unsupported', field: 'providers[1]', params: { value: 'BBB' } },
  'request.field_not_string': { code: 'request.field_not_string', field: 'name' },
  'request.field_missing': { code: 'request.field_missing', field: 'target' },
  'request.provider_not_enabled': { code: 'request.provider_not_enabled', field: 'provider', params: { provider: 'AAA' } },
  'request.same_origin_only': { code: 'request.same_origin_only' },
  'request.rate_limited': { code: 'request.rate_limited', params: { retry_after: 42 } },
  'request.rules_version_mismatch': { code: 'request.rules_version_mismatch', params: { requested: 'AAA', current: 'BBB' } },
  'request.not_found': { code: 'request.not_found' },
  'server.internal_error': { code: 'server.internal_error' },
};

describe('영어 사전 (D24)', () => {
  it('한글 검사식 자체 시험 — 완성형 끝(힣) · 자모(ㄱ) · 가 를 잡고 A · → · · 는 안 잡는다', () => {
    for (const ch of ['힣', 'ㄱ', '가']) expect(HANGUL.test(ch), ch).toBe(true);
    for (const ch of ['A', '→', '·', '—', 'é']) expect(HANGUL.test(ch), ch).toBe(false);
  });

  it('엔진 · API 코드 전부에 문장 함수가 있다 (런타임) · 표본도 코드 전부를 덮는다', () => {
    const codes = [...MESSAGE_CODES, ...API_CODES];
    expect(codes).toHaveLength(108);
    expect(Object.keys(en.messages).sort()).toEqual([...codes].sort());
    expect(Object.keys(SAMPLES).sort()).toEqual([...codes].sort());
  });

  it('모든 문장에 한글이 없고 비어 있지 않다', () => {
    for (const m of Object.values(SAMPLES)) {
      const text = format(m as Message, en);
      expect(text.length, m.code).toBeGreaterThan(0);
      expect(HANGUL.test(text), `${m.code}: ${text}`).toBe(false);
    }
  });

  it('화면 문구 전부가 있고 한글이 없다', () => {
    expect(Object.keys(en.ui).sort()).toEqual([...UI_KEYS].sort());
    for (const [k, v] of Object.entries(en.ui)) {
      expect(v.length, k).toBeGreaterThan(0);
      expect(HANGUL.test(v), `${k}: ${v}`).toBe(false);
    }
  });

  it('공유 URL 경고 — Base64 는 암호화가 아니어서 링크를 받은 사람이 입력값을 읽는다고 말하고, 민감한 값을 넣지 말라고 권한다', () => {
    expect(en.ui.share_warning).toContain('Base64');
    expect(en.ui.share_warning).toContain('not encrypted');
    expect(en.ui.share_warning).toMatch(/anyone with the link can read/i);
    expect(en.ui.share_warning).toMatch(/do not enter/i);
    // 버튼의 접근성 이름 · 툴팁도 같은 사실을 짧게 싣는다
    expect(en.ui.share_button_label).toContain('readable');
  });

  it('params 가 문장에 들어간다', () => {
    expect(format(SAMPLES['name.too_long'], en)).toBe('Name is 34 characters long; the maximum is 30');
    expect(format(SAMPLES['step.abbreviated'], en)).toContain("'AAA' to 'BBB'");
    expect(format(SAMPLES['rule.unknown_resource_type'], en)).toContain('CCC, DDD');
    expect(format(SAMPLES['request.value_unsupported'], en)).toBe("Unsupported providers[1] 'BBB'");
    expect(format(SAMPLES['request.provider_not_enabled'], en)).toBe("Provider 'AAA' is not available yet; 'supported' lists the providers you can use");
    // requested 는 params 에만 있고 문장에는 넣지 않는다
    expect(format(SAMPLES['request.rules_version_mismatch'], en)).toContain("does not match the current rules revision 'BBB'");
    expect(format(SAMPLES['request.rules_version_mismatch'], en)).not.toContain('AAA');
  });

  it('사용자 값의 제어 · 양방향 · 폭 없는 문자는 문장과 params 에서 \\uXXXX 로 바뀐다', () => {
    const rlo = String.fromCodePoint(0x202e);
    const m = { code: 'request.value_unsupported', field: 'provider', params: { value: `a${rlo}b\u0000c\u200Bd` } } as const;
    expect(format(m, en)).toBe("Unsupported provider 'a\\u202Eb\\u0000c\\u200Bd'");
    expect(displayMessage(m).params.value).toBe('a\\u202Eb\\u0000c\\u200Bd');
    expect(m.params.value).toContain(rlo); // 입력은 그대로
    const arr: Extract<Message, { code: 'context.value_unsupported' }> = { code: 'context.value_unsupported', field: 'env', params: { value: 'x', supported: [`p${rlo}`] } };
    expect(displayMessage(arr).params.supported).toEqual(['p\\u202E']);
    expect(escapeInvisible('plain-name_01 · é')).toBe('plain-name_01 · é');
  });

  it('notes 는 한 구분자로 잇는다 — 화면과 llms.txt 가 같다', () => {
    const notes = [SAMPLES['note.s3_an_suffix'], SAMPLES['note.gcs_dotted_names_222']] as Message[];
    expect(formatNotes(notes, en)).toBe(`${format(notes[0]!, en)}${NOTE_SEPARATOR}${format(notes[1]!, en)}`);
  });

  it('format 은 입력을 바꾸지 않는다', () => {
    const m: Message = { code: 'context.value_unsupported', field: 'env', params: { value: 'qa', supported: ['prd', 'stg'] } };
    const before = JSON.stringify(m);
    format(m, en);
    expect(JSON.stringify(m)).toBe(before);
  });

  it('종류 select 문구 (D52) — 빈 칸 셋 · 필수 안내', () => {
    expect(fillUi(en, 'kind_default', { value: 'EXTERNAL' })).toBe('default (EXTERNAL)');
    expect(en.ui.kind_none).toBe('none');
    expect(en.ui.kind_choose).toBe('choose…');
    expect(fillUi(en, 'kind_required_hint', { displayName: 'Resource Policy' })).toBe('Choose a kind to select Resource Policy');
    expect(fillUi(en, 'kind_label', { displayName: 'Cloud SQL Instance' })).toBe('Kind of Cloud SQL Instance');
  });
  it('행 · 범위 · (i) · 표지 문구 (D53 · D54)', () => {
    expect(fillUi(en, 'scope_choice_label', { displayName: 'IP Address' })).toBe('Scope of IP Address');
    expect(en.ui.scope_choose).toBe('scope…');
    expect(fillUi(en, 'scope_required_hint', { displayName: 'IP Address' })).toBe('Choose a scope to select IP Address');
    expect(fillUi(en, 'kind_dropped_on_scope', { kind: 'GCE_VM_IP', scope: 'Global' })).toBe('Kind GCE_VM_IP does not exist at Global scope; it was cleared.');
    expect(fillUi(en, 'info_toggle', { displayName: 'IP Address' })).toBe('About IP Address');
    expect(en.ui.enter_name_at).toBe('Enter the name at');
    expect(en.ui.badge_api_only).toBe('API only');
    expect(en.ui.badge_preview).toBe('Preview');
    expect(en.ui.api_only_filter).toBe('API only');
  });
  it('문서 · 개인정보 경로 자리 (D57) — 헤더 · 푸터 링크와 doc_ · privacy_ 블록', () => {
    expect(en.ui.nav_naming_guide).toBe('Naming guide');
    expect(en.ui.footer_privacy).toBe('Privacy');
    const doc = UI_KEYS.filter((k) => k.startsWith('doc_'));
    const privacy = UI_KEYS.filter((k) => k.startsWith('privacy_'));
    expect(doc.length).toBeGreaterThan(0);
    expect(privacy.length).toBeGreaterThan(0);
    // 접두 블록은 이어져 있다 — 뒤 작업이 자기 블록 안에만 키를 더한다
    const run = (keys: readonly string[]) => UI_KEYS.indexOf(keys.at(-1) as never) - UI_KEYS.indexOf(keys[0] as never) + 1;
    expect(run(doc)).toBe(doc.length);
    expect(run(privacy)).toBe(privacy.length);
  });
  it('마법사 문구 (D67 · D68) — 경로 nav · 링크 복구 안내 · 깨진 링크 안내', () => {
    expect(en.ui.nav_wizard).toBe('Wizard');
    expect(en.ui.nav_pick).toBe('Pick resources');
    expect(UI_KEYS.filter((k) => k.startsWith('wizard_link_'))).toEqual(['wizard_link_broken', 'wizard_link_discarded', 'wizard_link_dropped', 'wizard_link_ha_off', 'wizard_link_serverless_off', 'wizard_link_trimmed']);
    expect(en.ui.wizard_link_broken).toMatch(/could not be opened/);
    expect(fillUi(en, 'wizard_link_dropped', { n: 2 })).toBe('2 invalid item(s) in this link were left out.');
    expect(en.ui.wizard_ha_hint).toMatch(/different zones/);
    for (const k of UI_KEYS.filter((x) => x.startsWith('wizard_'))) expect(HANGUL.test(en.ui[k]), k).toBe(false);
  });
  it('fillUi 는 {이름} 자리를 채우고 없는 이름은 그대로 둔다', () => {
    expect(fillUi(en, 'version_footer', { engine: '0.1.0', rules: '2026-09-29.1' })).toBe('Engine 0.1.0 · rules 2026-09-29.1');
    expect(fillUi(en, 'length_range', { min: 3 })).toBe('Length 3–{max}');
  });
});
