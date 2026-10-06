// 금지형(「Can't use … or control characters」) 규칙이 보이지 않는 문자를 받지 않는지 — 이름이 화면에서 다르게 보이는 것을 막는다(Trojan Source).
// 원문은 「control characters」만 말한다. C1 · 양방향 제어 · 폭 없는 문자까지 막는 것은 보수적 읽기다(display.ts INVISIBLE 과 같은 집합).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { rulesFor } from './constraints';
import { checkName } from './validate';

type Cases = Record<string, { valid: string[]; invalid: string[] }>;
const dir = join(import.meta.dirname, '__fixtures__');
const CASES: Cases = Object.assign({}, ...readdirSync(dir).filter((f) => /^rule-cases.*\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf-8'))));

/** 리뷰가 든 넷 — RLO(U+202E) · 폭 없는 공백(U+200B) · DEL(U+007F) · C1 NEL(U+0085) — 과 나머지 대표 */
const INVISIBLE = ['\u202E', '\u200B', '\u007F', '\u0085', '\u061C', '\u2066', '\u2060', '\uFEFF', '\u2028'];

describe('Azure 규칙은 보이지 않는 문자를 거부한다', () => {
  const rules = rulesFor('azure');
  it('리뷰가 든 입력 넷 — policy 이름 · Synapse SQL pool', () => {
    for (const id of ['azure.authorization_policy_assignments', 'azure.synapse_workspaces_sql_pools']) {
      const rule = rules.find((r) => r.id === id);
      expect(rule, id).toBeDefined();
      for (const name of ['a\u202Eb', 'a\u200Bb', 'ab\u007f', 'ab\u0085c']) expect(checkName(name, rule!).length, `${id} ${JSON.stringify(name)}`).toBeGreaterThan(0);
    }
  });
  it.each(rules.map((r) => r.id))('%s — 통과 예 가운데에 넣으면 거부', (id) => {
    const rule = rules.find((r) => r.id === id)!;
    // 가장 짧은 통과 예 — 상한에 닿았으면 둘째 글자를 빼 한 글자 자리를 만든다(첫 · 끝 글자는 그대로)
    let base = [...CASES[id]!.valid].filter((v) => v.length >= 2).sort((a, b) => a.length - b.length)[0]!;
    expect(base, id).toBeDefined();
    while (base.length >= rule.maxLength) base = base[0] + base.slice(2);
    expect(checkName(base, rule), `${id} ${base}`).toEqual([]);
    for (const ch of INVISIBLE) {
      const name = base[0] + ch + base.slice(1);
      expect(checkName(name, rule).length, `${id} ${JSON.stringify(name)}`).toBeGreaterThan(0);
    }
  });
});
