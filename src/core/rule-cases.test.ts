// 손 예 — 문서가 허용한다고 말한 이름 · 금지한다고 말한 이름을 사람이 골라 규칙마다 둔다 (D43 · 계획 §8-4).
// 기준선의 자동 경계 시험은 pattern 이 틀려도 pattern 대로 통과한다 — 원문에서 뽑은 예만이 정규식을 검사한다
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RULES } from './constraints';
import { checkName } from './validate';

type Cases = Record<string, { valid: string[]; invalid: string[] }>;
const CASES: Cases = JSON.parse(readFileSync(join(import.meta.dirname, '__fixtures__', 'rule-cases.json'), 'utf-8'));

describe('규칙마다 손 예 (rule-cases.json)', () => {
  it('모든 규칙에 손 예가 있고 · fixture 에 없는 규칙 키가 없다', () => {
    expect(Object.keys(CASES).sort()).toEqual(Object.keys(RULES).sort());
  });
  it('규칙마다 통과 예 하나 이상 · 실패 예 하나 이상', () => {
    for (const [id, c] of Object.entries(CASES)) {
      expect(c.valid.length, id).toBeGreaterThan(0);
      expect(c.invalid.length, id).toBeGreaterThan(0);
    }
  });
  it.each(Object.keys(RULES))('%s — valid 는 위반 0건 · invalid 는 1건 이상', (id) => {
    const rule = RULES[id]!;
    const c = CASES[id]!;
    for (const name of c.valid) expect(checkName(name, rule), `${id} valid ${JSON.stringify(name)}`).toEqual([]);
    for (const name of c.invalid) expect(checkName(name, rule).length, `${id} invalid ${JSON.stringify(name)}`).toBeGreaterThan(0);
  });
});
