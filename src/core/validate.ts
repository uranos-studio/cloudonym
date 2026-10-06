// CSP 물리 규칙 검증 (D14) — pattern · 길이 · forbidden 만 본다. 생성용 allowed 는 보지 않는다.
// 이유는 코드와 params 로 돌려준다(D23) — 문장은 src/messages/ 가 만든다. 빈 배열이면 유효다.
import type { ResourceRule } from './types';
import type { CoreMessage } from './messages';

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
/** 첫 글자 · 끝 글자 검사는 영문 여부만 본다 — 대소문자는 pattern 몫이다 */
const FIRST_LETTER = /^[A-Za-z]/;
const LAST_ALNUM = /[A-Za-z0-9]$/;
const LETTER = /[A-Za-z]/;

/** word 가 name 안에서 앞뒤가 영문 글자가 아닌 자리에 있는가 — 숫자 · 기호 · 이름 끝은 경계로 본다 (보수적) */
function hasWord(name: string, word: string): boolean {
  for (let i = name.indexOf(word); i !== -1; i = name.indexOf(word, i + 1)) {
    const before = i === 0 ? '' : name[i - 1];
    const after = name[i + word.length] ?? '';
    if (!LETTER.test(before) && !LETTER.test(after)) return true;
  }
  return false;
}

export function checkName(name: string, rule: ResourceRule): CoreMessage[] {
  if (name.length === 0) return [{ code: 'name.empty' }];

  const reasons: CoreMessage[] = [];
  if (name.length > rule.maxLength) reasons.push({ code: 'name.too_long', params: { actual: name.length, max: rule.maxLength } });
  if (name.length < rule.minLength) reasons.push({ code: 'name.too_short', params: { actual: name.length, min: rule.minLength } });
  if (rule.startsWithLetter && !FIRST_LETTER.test(name)) reasons.push({ code: 'name.first_not_letter' });
  if (rule.endsWithAlnum && !LAST_ALNUM.test(name)) reasons.push({ code: 'name.last_not_alnum' });
  // 앞의 구조 검사가 하나라도 걸렸으면 pattern 은 같은 원인을 다시 말하므로 건너뛴다
  if (reasons.length === 0 && !rule.pattern.test(name)) reasons.push({ code: 'name.pattern_mismatch', params: { pattern: rule.pattern.source } });
  if (rule.noConsecutiveSeparator && name.includes('--')) reasons.push({ code: 'name.consecutive_separator', params: { separator: '--' } });

  const f = rule.forbidden;
  if (f) {
    // ignoreCase 면 이름을 소문자로 바꿔 소문자 목록과 맞춘다 — 목록의 소문자 여부는 constraints.test 가 본다
    const n = f.ignoreCase ? name.toLowerCase() : name;
    for (const p of f.prefixes ?? []) if (n.startsWith(p)) reasons.push({ code: 'name.forbidden_prefix', params: { value: p } });
    for (const s of f.suffixes ?? []) if (n.endsWith(s)) reasons.push({ code: 'name.forbidden_suffix', params: { value: s } });
    for (const c of f.contains ?? []) if (n.includes(c)) reasons.push({ code: 'name.forbidden_substring', params: { value: c } });
    for (const e of f.exact ?? []) if (n === e) reasons.push({ code: 'name.forbidden_exact', params: { value: e } });
    for (const w of f.words ?? []) if (hasWord(n, w)) reasons.push({ code: 'name.forbidden_word', params: { value: w } });
    if (f.ipv4 && IPV4.test(name)) reasons.push({ code: 'name.ipv4_form' });
  }
  return reasons;
}
