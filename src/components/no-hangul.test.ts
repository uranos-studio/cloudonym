// 화면 문구 한글 0 (D24) — 컴포넌트 · App 의 문자열 · 템플릿 · JSX 텍스트 · JSX 속성 문자열과 index.html 에 한글이 없다.
// TypeScript 컴파일러 API 로 그 노드만 모은다 — 주석(// · /* */ · JSX 의 {/* */})은 노드가 아니라 자연히 빠진다.
// node:fs 는 tsconfig.app.json(브라우저 타입)이 거부하므로 Vite 의 ?raw 글롭으로 읽는다 (boundary.test 와 같다)
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { en } from '../messages/en';

const sources = import.meta.glob(['./*.ts', './*.tsx', '../App.tsx', '../main.tsx', '../version.ts', '!./*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const html = import.meta.glob('../../index.html', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const HANGUL = /\p{Script=Hangul}/u;

/** 소스의 리터럴 · JSX 텍스트 가운데 한글이 든 것 */
function hangulTexts(source: string, fileName: string): string[] {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const hits: string[] = [];
  const visit = (node: ts.Node): void => {
    // JSX 속성 문자열(aria-label="…")은 StringLiteral 노드다
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)
      || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) {
      if (HANGUL.test(node.text)) hits.push(node.text.trim());
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/** index.html 에서 주석만 벗긴 본문 */
const stripHtmlComments = (text: string) => text.replace(/<!--[\s\S]*?-->/g, '');

describe('화면 문구에 한글이 없다', () => {
  it('검사기 자체 — JSX 텍스트 · JSX 속성 · 리터럴 · 템플릿은 잡고 주석은 통과시킨다', () => {
    const hangul = String.fromCodePoint(0xd7a3); // 힣
    expect(hangulTexts(`const a = <p>${hangul}</p>;`, 'x.tsx')).toEqual([hangul]);
    expect(hangulTexts(`const a = <b aria-label="${hangul}" />;`, 'x.tsx')).toEqual([hangul]);
    expect(hangulTexts(`const a = \`x \${1} ${hangul}\`;`, 'x.ts')).toHaveLength(1);
    expect(hangulTexts(`// ${hangul}\nconst a = <p>{/* ${hangul} */}ok</p>; /* ${hangul} */`, 'x.tsx')).toEqual([]);
    expect(stripHtmlComments(`<!-- ${hangul} --><p>ok</p>`)).toBe('<p>ok</p>');
  });

  const files = Object.keys(sources);
  it(`대상 파일이 12개 이상이고 App.tsx 가 들어 있다 (현재 ${files.length}개)`, () => {
    expect(files.length).toBeGreaterThanOrEqual(12);
    expect(files.some((f) => f.endsWith('App.tsx'))).toBe(true);
  });

  it('모든 비시험 소스의 리터럴 · JSX 텍스트에 한글 0', () => {
    const found = files.flatMap((f) => hangulTexts(sources[f] ?? '', f).map((t) => `${f}: ${t}`));
    expect(found).toEqual([]);
  });

  it('index.html — lang="en" · 주석 밖 한글 0 · description 은 사전의 meta_description 과 같다', () => {
    const page = Object.values(html)[0] ?? '';
    expect(page).toContain('<html lang="en">');
    expect(stripHtmlComments(page)).not.toMatch(HANGUL);
    expect(page).toContain(`<meta name="description" content="${en.ui.meta_description}" />`);
  });
});
