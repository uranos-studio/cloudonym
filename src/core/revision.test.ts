// 규칙 지문 (D26) — 규칙 데이터 · 기준선 출력 · 엔진 소스의 sha256 을 rules-fingerprint.json 과 대어 본다.
// 기준선 표본 밖의 알고리즘 변경(예: validate.ts 의 IPV4 정규식)은 출력 표본으로 못 잡는다 — 그래서 src/core 의 비시험 소스를
// 토큰 단위로 정규화해 함께 넣는다. 주석 · 공백 · displayName 문구만 바뀐 것은 지문을 바꾸지 않고, 토큰 하나라도 바뀌면 바꾼다(보수적).
// 지문이 달라졌으면 같은 입력에서 이름 · 판정 · 제안 · 라벨이 달라질 수 있다는 뜻이다 — RULES_REVISION 을 올리고 파일을 다시 쓴다.
// CI(.github/workflows/ci.yml)가 origin/main 의 파일과 대어 revision 을 안 올린 지문 변경을 막는다
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { RULES_REVISION } from './revision';
import { RULES, LABEL_LIMITS, AWS_TAG_VALUE } from './constraints';
import { SHORT_WORDS } from './shorten';
import { ENV_ALIASES, REGION_ALIASES } from './normalize';
import { MIN_TOKEN, PROTECTED } from './types';
import { coreBaseline, coreBaselineCodes } from './baseline-inputs';

const FILE = join(import.meta.dirname, 'rules-fingerprint.json');
const HINT = '규칙 데이터 · 엔진 소스 · 기준선 출력 가운데 하나가 바뀌었다 — RULES_REVISION 을 올리고 UPDATE_FINGERPRINT=1 npx vitest run src/core/revision.test.ts 로 파일을 다시 쓴다';

/** 키를 정렬해 직렬화한다 — 규칙 표의 필드 순서만 바뀐 것은 지문을 바꾸지 않는다. RegExp 는 source · flags */
function canonical(v: unknown): unknown {
  if (v instanceof RegExp) return { source: v.source, flags: v.flags };
  if (Array.isArray(v)) return v.map(canonical);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  }
  return v;
}

/** 규칙 데이터 — displayName · notes 는 뺀다. 표시용 문구라 이름 · 판정에 관여하지 않고, 문구 이관 때 바뀐다 */
function rulesData() {
  return Object.keys(RULES).sort().map((id) => {
    const { displayName: _d, notes: _n, ...rest } = RULES[id]!;
    return rest;
  });
}

/** 지문에서 빼는 소스 — revision.ts 는 RULES_REVISION 자체라 넣으면 올릴 때마다 지문이 바뀌어 CI 의 「revision 만 바뀜」 검사가 무의미해진다.
 *  baseline-inputs.ts 는 시험 표본이고 그 변화는 outputs 로 이미 들어간다 */
const SOURCE_EXCLUDE = new Set(['revision.ts', 'baseline-inputs.ts']);

/** 소스를 토큰 열로 정규화한다 — 파서가 만든 잎 토큰만 모은다. 주석 · JSDoc · 공백 · 줄바꿈은 빠지고(트리비아),
 *  정규식 · 템플릿 리터럴은 파서가 한 토큰으로 읽는다. `displayName:` 의 문자열 값(표시용 문구)은 비운다 */
function normalizeSource(text: string): string {
  const sf = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const tokens: string[] = [];
  const visit = (node: ts.Node): void => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const children = node.getChildren(sf);
    if (children.length === 0) {
      if (node.kind === ts.SyntaxKind.EndOfFileToken) return;
      const p = node.parent;
      const displayText = ts.isStringLiteral(node) && p !== undefined && ts.isPropertyAssignment(p) && p.initializer === node
        && ts.isIdentifier(p.name) && p.name.text === 'displayName';
      tokens.push(displayText ? "''" : node.getText(sf));
      return;
    }
    for (const c of children) visit(c);
  };
  visit(sf);
  return tokens.join(' ');
}

/** src/core 의 비시험 소스(제외 둘 빼고) — 파일 이름 순. core 는 ./ 만 들여오므로(boundary.test.ts) 이것이 엔진 소스 전부다 */
function coreSources(): Record<string, string> {
  const dir = import.meta.dirname;
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !SOURCE_EXCLUDE.has(f)).sort();
  return Object.fromEntries(files.map((f) => [f, createHash('sha256').update(normalizeSource(readFileSync(join(dir, f), 'utf-8'))).digest('hex')]));
}

function fingerprintOf(parts: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(parts))).digest('hex');
}

function currentParts() {
  return {
    rules: rulesData(), shortWords: SHORT_WORDS, envAliases: ENV_ALIASES, regionAliases: REGION_ALIASES,
    protected: PROTECTED, minToken: MIN_TOKEN, labelLimits: LABEL_LIMITS, awsTagValue: AWS_TAG_VALUE,
    outputs: coreBaseline(), violationCodes: coreBaselineCodes(), sources: coreSources(),
  };
}

describe('규칙 버전 · 지문 (D26)', () => {
  const fingerprint = fingerprintOf(currentParts());
  if (process.env.UPDATE_FINGERPRINT === '1') {
    writeFileSync(FILE, `${JSON.stringify({ revision: RULES_REVISION, fingerprint }, null, 2)}\n`);
  }
  const file = JSON.parse(readFileSync(FILE, 'utf-8')) as { revision: string; fingerprint: string };

  it('RULES_REVISION 꼴은 YYYY-MM-DD.N — N 은 1~99 (공유 URL 이 13자를 잡아 둔다)', () => {
    expect(RULES_REVISION).toMatch(/^\d{4}-\d{2}-\d{2}\.[1-9]\d?$/);
  });

  it('검사기 자체 시험 — 규칙 숫자 하나 · 출력 하나 · 별칭 하나가 바뀌면 지문이 바뀌고, 필드 순서만 바뀌면 그대로다', () => {
    const base = currentParts();
    const rules = base.rules.map((r, i) => (i === 0 ? { ...r, maxLength: r.maxLength + 1 } : r));
    expect(fingerprintOf({ ...base, rules })).not.toBe(fingerprint);
    // 범위 한 글자 — scope 는 규칙 데이터라 지문에 들어간다 (D37)
    const scoped = base.rules.map((r, i) => (i === 0 ? { ...r, scope: `${r.scope}x` } : r));
    expect(fingerprintOf({ ...base, rules: scoped })).not.toBe(fingerprint);
    const outputs = { ...base.outputs, validate: base.outputs.validate.map((v, i) => (i === 0 ? { ...v, valid: !v.valid } : v)) };
    expect(fingerprintOf({ ...base, outputs })).not.toBe(fingerprint);
    expect(fingerprintOf({ ...base, envAliases: { ...base.envAliases, qa: 'stg' } })).not.toBe(fingerprint);
    const reordered = base.rules.map((r) => Object.fromEntries(Object.entries(r).reverse()));
    expect(fingerprintOf({ ...base, rules: reordered })).toBe(fingerprint);
  });

  it('검사기 자체 시험 — 엔진 소스: 주석 · 공백 · displayName 문구만 바뀌면 그대로, 토큰 하나가 바뀌면 달라진다', () => {
    const src = "// a\nconst IPV4 = /^\\d{1,3}(\\.\\d{1,3}){3}$/; /** doc */\nconst r = { displayName: 'X', max: 3 };\n";
    const same = "// b\n\n/* c */ const  IPV4 = /^\\d{1,3}(\\.\\d{1,3}){3}$/;\nconst r = {\n  displayName: 'Other text', max: 3\n};";
    expect(normalizeSource(same)).toBe(normalizeSource(src));
    expect(normalizeSource(src.replace('{3}$', '{2,3}$'))).not.toBe(normalizeSource(src));
    expect(normalizeSource(src.replace('max: 3', 'max: 4'))).not.toBe(normalizeSource(src));
    // 정규식 안의 // 와 템플릿 안의 /* 를 주석으로 읽어 뒤를 삼키지 않는다
    expect(normalizeSource('const a = /\\/\\//; const b = 1;')).toContain('b');
    expect(normalizeSource('const a = `/* ${x} */`; const b = 1;')).toContain('b');
    // 위 src 의 {3}→{2,3} 이 리뷰 M1 의 변이다 — 실제 validate.ts 글자에 묶지 않는다(정규식을 고치면 이 시험이 엉뚱하게 깨진다)
    expect(Object.keys(currentParts().sources)).toEqual(expect.arrayContaining(['validate.ts', 'engine.ts', 'constraints.ts', 'truncate.ts']));
    expect(Object.keys(currentParts().sources)).not.toContain('revision.ts');
  });

  it('파일의 revision 이 RULES_REVISION 과 같다', () => {
    expect(file.revision, HINT).toBe(RULES_REVISION);
  });

  it('계산한 지문이 파일과 같다', () => {
    expect(fingerprint, HINT).toBe(file.fingerprint);
  });
});
