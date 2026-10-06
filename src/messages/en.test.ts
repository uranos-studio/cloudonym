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
  'request.body_not_json': { code: 'request.body_not_json' },
  'request.body_not_object': { code: 'request.body_not_object' },
  'request.body_too_large': { code: 'request.body_too_large', params: { max_bytes: 16384 } },
  'request.context_not_object': { code: 'request.context_not_object' },
  'request.field_too_long': { code: 'request.field_too_long', field: 'owner', params: { max: 1024 } },
  'request.providers_not_array': { code: 'request.providers_not_array' },
  'request.providers_empty': { code: 'request.providers_empty' },
  'request.value_unsupported': { code: 'request.value_unsupported', field: 'providers[1]', params: { value: 'BBB' } },
  'request.field_not_string': { code: 'request.field_not_string', field: 'name' },
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
    expect(codes).toHaveLength(74);
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

  it('params 가 문장에 들어간다', () => {
    expect(format(SAMPLES['name.too_long'], en)).toBe('Name is 34 characters long; the maximum is 30');
    expect(format(SAMPLES['step.abbreviated'], en)).toContain("'AAA' to 'BBB'");
    expect(format(SAMPLES['rule.unknown_resource_type'], en)).toContain('CCC, DDD');
    expect(format(SAMPLES['request.value_unsupported'], en)).toBe("Unsupported providers[1] 'BBB'");
    // requested 는 params 에만 있고 문장에는 넣지 않는다 (리뷰 S1)
    expect(format(SAMPLES['request.rules_version_mismatch'], en)).toContain("does not match the current rules revision 'BBB'");
    expect(format(SAMPLES['request.rules_version_mismatch'], en)).not.toContain('AAA');
  });

  it('사용자 값의 제어 · 양방향 · 폭 없는 문자는 문장과 params 에서 \\uXXXX 로 바뀐다 (리뷰 S2)', () => {
    const rlo = String.fromCodePoint(0x202e);
    const m = { code: 'request.value_unsupported', field: 'provider', params: { value: `a${rlo}b\u0000c\u200Bd` } } as const;
    expect(format(m, en)).toBe("Unsupported provider 'a\\u202Eb\\u0000c\\u200Bd'");
    expect(displayMessage(m).params.value).toBe('a\\u202Eb\\u0000c\\u200Bd');
    expect(m.params.value).toContain(rlo); // 입력은 그대로
    const arr: Extract<Message, { code: 'context.value_unsupported' }> = { code: 'context.value_unsupported', field: 'env', params: { value: 'x', supported: [`p${rlo}`] } };
    expect(displayMessage(arr).params.supported).toEqual(['p\\u202E']);
    expect(escapeInvisible('plain-name_01 · é')).toBe('plain-name_01 · é');
  });

  it('notes 는 한 구분자로 잇는다 — 화면과 llms.txt 가 같다 (리뷰 Q4)', () => {
    const notes = [SAMPLES['note.s3_an_suffix'], SAMPLES['note.gcs_dotted_names_222']] as Message[];
    expect(formatNotes(notes, en)).toBe(`${format(notes[0]!, en)}${NOTE_SEPARATOR}${format(notes[1]!, en)}`);
  });

  it('format 은 입력을 바꾸지 않는다', () => {
    const m: Message = { code: 'context.value_unsupported', field: 'env', params: { value: 'qa', supported: ['prd', 'stg'] } };
    const before = JSON.stringify(m);
    format(m, en);
    expect(JSON.stringify(m)).toBe(before);
  });

  it('fillUi 는 {이름} 자리를 채우고 없는 이름은 그대로 둔다', () => {
    expect(fillUi(en, 'version_footer', { engine: '0.1.0', rules: '2026-09-29.1' })).toBe('Engine 0.1.0 · rules 2026-09-29.1');
    expect(fillUi(en, 'length_range', { min: 3 })).toBe('Length 3–{max}');
  });
});
