// CSP 물리 규칙 검증 (D14) — pattern · 길이 · forbidden 만 본다. 생성용 allowed 는 보지 않는다.
// 이유 문장은 「무엇이 · 얼마인데 · 규칙은 얼마」 꼴이고, 빈 배열이면 유효다.
import type { ResourceRule } from './types';

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
/** 첫 글자 · 끝 글자 검사는 영문 여부만 본다 — 대소문자는 pattern 몫이다 (원장 판정 M2) */
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

export function checkName(name: string, rule: ResourceRule): string[] {
  if (name.length === 0) return ['이름이 비어 있다'];

  const reasons: string[] = [];
  if (name.length > rule.maxLength) reasons.push(`길이 ${name.length}자 — 최대 ${rule.maxLength}자`);
  if (name.length < rule.minLength) reasons.push(`길이 ${name.length}자 — 최소 ${rule.minLength}자`);
  if (rule.startsWithLetter && !FIRST_LETTER.test(name)) reasons.push('첫 글자는 영문이어야 한다');
  if (rule.endsWithAlnum && !LAST_ALNUM.test(name)) reasons.push('끝 글자는 영문·숫자여야 한다');
  // 앞의 구조 검사가 하나라도 걸렸으면 pattern 은 같은 원인을 다시 말하므로 건너뛴다
  if (reasons.length === 0 && !rule.pattern.test(name)) reasons.push(`허용 형식(${rule.pattern.source})에 맞지 않는다`);
  if (rule.noConsecutiveSeparator && name.includes('--')) reasons.push('연속 구분자 「--」');

  const f = rule.forbidden;
  if (f) {
    // ignoreCase 면 이름을 소문자로 바꿔 소문자 목록과 맞춘다 — 목록의 소문자 여부는 constraints.test 가 본다
    const n = f.ignoreCase ? name.toLowerCase() : name;
    for (const p of f.prefixes ?? []) if (n.startsWith(p)) reasons.push(`금지 접두사 「${p}」`);
    for (const s of f.suffixes ?? []) if (n.endsWith(s)) reasons.push(`금지 접미사 「${s}」`);
    for (const c of f.contains ?? []) if (n.includes(c)) reasons.push(`금지 문자열 「${c}」 포함`);
    for (const e of f.exact ?? []) if (n === e) reasons.push(`금지 이름 「${e}」`);
    for (const w of f.words ?? []) if (hasWord(n, w)) reasons.push(`금지 단어 「${w}」`);
    if (f.ipv4 && IPV4.test(name)) reasons.push('IP 주소 꼴은 쓸 수 없다');
  }
  return reasons;
}
