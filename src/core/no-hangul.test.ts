// 시스템 문구 한글 0 (D23) — src/core/*.ts 의 문자열 리터럴 · 템플릿 리터럴에 한글이 없다.
// TypeScript 컴파일러 API 로 리터럴 노드만 모은다 — 주석은 노드가 아니라 자연히 빠지고, URL 속 // 도 망가지지 않는다
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const HANGUL = /\p{Script=Hangul}/u;

/** 소스의 문자열 · 템플릿 리터럴 조각 가운데 한글이 든 것 */
function hangulLiterals(source: string, fileName = 'x.ts'): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)
      || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (HANGUL.test(node.text)) hits.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

describe('src/core 문자열 리터럴에 한글이 없다', () => {
  it('검사기 자체 — 한글 리터럴 · 템플릿은 잡고, 한글 주석과 URL 은 통과시킨다', () => {
    const hangul = String.fromCodePoint(0xd7a3); // 힣 — [ㄱ-힝] 범위 밖
    expect(hangulLiterals(`const a = '${hangul}';`)).toEqual([hangul]);
    expect(hangulLiterals(`const b = \`x \${1} ${hangul}\`;`)).toHaveLength(1);
    expect(hangulLiterals(`// ${hangul}\n/* ${hangul} */\nconst u = 'https://example.com/a'; // ${hangul}`)).toEqual([]);
    expect(HANGUL.test(String.fromCodePoint(0x3131))).toBe(true); // ㄱ
    expect(HANGUL.test('A→·')).toBe(false);
  });

  const dir = import.meta.dirname;
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

  it(`대상 파일이 10개 이상 있다 (현재 ${files.length}개)`, () => expect(files.length).toBeGreaterThanOrEqual(10));

  it('모든 비시험 소스의 리터럴에 한글 0', () => {
    const found = files.flatMap((f) => hangulLiterals(readFileSync(join(dir, f), 'utf-8'), f).map((t) => `${f}: ${t}`));
    expect(found).toEqual([]);
  });
});
