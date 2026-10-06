// 손 예 — 문서가 허용한다고 말한 이름 · 금지한다고 말한 이름을 사람이 골라 규칙마다 둔다 (D43).
// 기준선의 자동 경계 시험은 pattern 이 틀려도 pattern 대로 통과한다 — 원문에서 뽑은 예만이 정규식을 검사한다
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RULES } from './constraints';
import { checkName } from './validate';

type Cases = Record<string, { valid: string[]; invalid: string[] }>;
const read = (f: string): Cases => JSON.parse(readFileSync(join(import.meta.dirname, '__fixtures__', f), 'utf-8'));
/** 손 예(rule-cases.json) + 들인 행의 생성 예(rule-cases-<provider>-intake.json — scripts/rules/build-<provider>-rules.mjs 가 원문 문장에서 짠다) */
const HAND = read('rule-cases.json');
const INTAKE_FILES = readdirSync(join(import.meta.dirname, '__fixtures__')).filter((f) => /^rule-cases-[a-z]+-intake\.json$/.test(f)).sort();
const INTAKES = INTAKE_FILES.map(read);
const INTAKE: Cases = Object.assign({}, ...INTAKES);
const CASES: Cases = { ...HAND, ...INTAKE };

describe('규칙마다 손 예 (rule-cases.json)', () => {
  it('파일끼리 키가 겹치지 않는다 — 손 예는 손으로 쓴 규칙에만', () => {
    expect(INTAKE_FILES).toContain('rule-cases-azure-intake.json');
    expect(Object.keys(HAND).filter((k) => k in INTAKE)).toEqual([]);
    expect(INTAKES.reduce((n, c) => n + Object.keys(c).length, 0)).toBe(Object.keys(INTAKE).length);
  });
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
