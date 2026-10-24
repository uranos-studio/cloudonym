// 보이지 않는 글자 하나를 끼운 이름은 모든 규칙이 거부한다 — 이름이 화면에서 다르게 보이는 것을 막는다(Trojan Source).
// 보이지 않는 글자의 정의는 invisible.mjs 하나다. 표본도 거기서 뽑는다 — 손으로 고른 목록은 빈 곳을 남긴다(U+00AD · U+3164 를 놓쳤었다).
// 원문이 그런 글자를 명시적으로 받는 규칙만 예외다(EXEMPT).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RULES } from './constraints';
import { AWS_NAME_TAG } from './rules/aws';
import { checkName } from './validate';
import { escapeInvisible } from './display';
import { NO_INVISIBLE } from './invisible.mjs';
import { INVISIBLE, NAMED, RANGES, SAMPLE } from './__fixtures__/invisible-sample';
import type { ResourceRule } from './types';

type Cases = Record<string, { valid: string[]; invalid: string[] }>;
const dir = join(import.meta.dirname, '__fixtures__');
const CASES: Cases = Object.assign({}, ...readdirSync(dir).filter((f) => /^rule-cases.*\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf-8'))));

/** 원문이 어떤 글자든 받는다고 적은 규칙 — 보이지 않는 글자도 유효다(거부하면 유효한 이름을 무효로 낸다).
 *  EC2 Name 태그: "Although EC2 allows for any character in its tags" (Using_Tags.html#tag-restrictions) — AWS_NAME_TAG 를 쓰는 규칙 전부 */
const EXEMPT = (r: ResourceRule) => r.pattern === AWS_NAME_TAG;

describe('보이지 않는 글자의 정의 (invisible.mjs)', () => {
  it('재검증이 든 낱글자와 예전 대표를 전부 덮는다', () => {
    for (const c of NAMED) expect(INVISIBLE.test(String.fromCodePoint(c)), c.toString(16)).toBe(true);
  });
  it('C0 · DEL · C1 · 방향 제어 · 태그 문자 블록 · 이체 선택자 전부', () => {
    const all = (a: number, b: number) => { for (let c = a; c <= b; c++) expect(INVISIBLE.test(String.fromCodePoint(c)), c.toString(16)).toBe(true); };
    all(0x00, 0x1f); all(0x7f, 0x9f); all(0x200b, 0x200f); all(0x202a, 0x202e); all(0x2066, 0x2069); all(0xe0000, 0xe007f); all(0xfe00, 0xfe0f);
  });
  it('보이는 글자 · 보이는 공백은 넣지 않는다 — 공백(U+0020) · 줄바꿈 없는 공백(U+00A0) · 한글 · 영숫자 · 기호', () => {
    for (const s of [' ', '\u00A0', '\u3000', '가', 'a', 'Z', '0', '-', '_', '.', '(', '😀']) expect(INVISIBLE.test(s), JSON.stringify(s)).toBe(false);
  });
  it('앞보기 NO_INVISIBLE 은 어느 자리에 있든 잡는다', () => {
    const re = new RegExp(`${NO_INVISIBLE}^[^:]*$`, 'u');
    expect(re.test('abc')).toBe(true);
    for (const s of ['\u00ADab', 'a\u3164b', 'ab\u{e0041}']) expect(re.test(s), JSON.stringify(s)).toBe(false);
  });
  it('표본은 구간마다 처음 · 끝을 담는다', () => {
    expect(RANGES.length).toBeGreaterThan(20);
    expect(SAMPLE.length).toBeGreaterThan(NAMED.length);
  });
});

describe('escapeInvisible — 같은 정의로 보이게 한다', () => {
  it('BMP 는 \\uXXXX · 보조 평면(태그 문자)은 \\UXXXXXXXX (HCL 이 받는 꼴)', () => {
    expect(escapeInvisible('ab\u00ADcd')).toBe('ab\\u00ADcd');
    expect(escapeInvisible('a\u3164b')).toBe('a\\u3164b');
    expect(escapeInvisible('a\u{e0041}b')).toBe('a\\U000E0041b');
    expect(escapeInvisible('a\u202Eb')).toBe('a\\u202Eb');
  });
  it('표본 전부를 바꾸고 보이는 글자는 그대로 둔다', () => {
    for (const ch of SAMPLE) expect(INVISIBLE.test(escapeInvisible(`a${ch}b`)), JSON.stringify(ch)).toBe(false);
    expect(escapeInvisible('가 a-b_c(1).😀')).toBe('가 a-b_c(1).😀');
  });
});

describe('모든 규칙은 보이지 않는 글자 하나를 끼운 이름을 거부한다', () => {
  const ids = Object.keys(RULES).sort();
  it('규칙 수 · 예외 수 — 예외는 EC2 Name 태그(원문 「any character」)뿐', () => {
    const exempt = ids.filter((id) => EXEMPT(RULES[id]!));
    expect(ids.length).toBe(694);
    expect(exempt.every((id) => id.startsWith('aws.'))).toBe(true);
    expect(exempt.every((id) => RULES[id]!.docUrl.endsWith('Using_Tags.html#tag-restrictions'))).toBe(true);
  });
  it.each(ids.filter((id) => !EXEMPT(RULES[id]!)))('%s', (id) => {
    const rule = RULES[id]!;
    // 가장 짧은 통과 예 — 보조 평면 글자(UTF-16 두 단위)가 들어갈 자리를 남긴다(첫 · 끝 글자는 그대로)
    let base = [...CASES[id]!.valid].filter((v) => v.length >= 2).sort((a, b) => a.length - b.length)[0]!;
    expect(base, id).toBeDefined();
    while (base.length + 2 > rule.maxLength) base = base[0] + base.slice(2);
    expect(checkName(base, rule), `${id} ${base}`).toEqual([]);
    for (const ch of SAMPLE) {
      const name = base[0] + ch + base.slice(1);
      expect(checkName(name, rule).length, `${id} ${JSON.stringify(name)}`).toBeGreaterThan(0);
      // API 소비자는 rule.pattern 을 다시 만들어 쓴다 — 첫 · 끝 글자 검사에 걸려도 pattern 자체가 받지 않아야 한다
      expect(rule.pattern.test(name), `${id} pattern 이 ${JSON.stringify(name)} 를 받는다`).toBe(false);
    }
  });
});
