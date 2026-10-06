import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

// import/export 문의 from '...' · 부수효과 import '...' · 동적 import('...') · require('...') 의 지정자를 모은다
const STATIC_RE = /(?:import|export)(?:[^'"]*from)?\s+['"]([^'"]+)['"]/g;
const CALL_RE = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]/g;

function specifiersOf(content: string): string[] {
  const out: string[] = [];
  for (const re of [STATIC_RE, CALL_RE]) for (const m of content.matchAll(re)) out.push(m[1]);
  return out;
}

const CORE_DIR = import.meta.dirname;

/** 상대 경로(./ · ../)이고, 그 파일 자리에서 해석한 경로가 src/core/ 아래여야 한다.
 *  하위 폴더(rules/)의 '../types' 는 통과, '../../api/x' · './../api/x' 는 src/core 밖이라 거부한다. 패키지 이름은 거부 */
function isAllowed(spec: string, fromFile: string): boolean {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return false;
  const rel = relative(CORE_DIR, resolve(dirname(fromFile), spec));
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith(sep) && !rel.split(sep).includes('..');
}

/** src/core 아래 .ts · .mjs(invisible.mjs — 생성기와 같이 쓰는 정의) (시험 · __fixtures__ 제외) — 하위 폴더까지 재귀로 */
function coreFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === '__fixtures__' ? [] : coreFiles(p);
    return /\.(ts|mjs)$/.test(e.name) && !e.name.endsWith('.test.ts') ? [p] : [];
  });
}

describe('src/core/ 모듈 경계 — import 는 ./ 로만', () => {
  // 검사기를 먼저 시험한다 — 잡아야 할 것을 실제로 잡는가
  it('검사기 자체: 우회 꼴을 전부 잡고 정상 꼴은 통과시킨다', () => {
    const probe = [
      "import { a } from './types';",
      "export { x } from './../api/serialize';",
      "import '../api/index';",
      "const h = await import('hono');",
      "const z = require('zod');",
    ].join('\n');
    const specs = specifiersOf(probe);
    expect(specs).toEqual(['./types', './../api/serialize', '../api/index', 'hono', 'zod']);
    const top = join(CORE_DIR, 'engine.ts');
    expect(specs.filter((s) => !isAllowed(s, top))).toEqual(['./../api/serialize', '../api/index', 'hono', 'zod']);
  });

  it('검사기 자체: 하위 폴더 파일 — ../types 통과 · ../../api/x · ./../../api/x · zod 거부', () => {
    const sub = join(CORE_DIR, 'rules', 'azure.ts');
    const probe = "import type { X } from '../types';\nimport { y } from './shared';\nimport '../../api/x';\nexport * from './../../api/x';\nimport 'zod';";
    const specs = specifiersOf(probe);
    expect(specs.filter((s) => !isAllowed(s, sub))).toEqual(['../../api/x', './../../api/x', 'zod']);
  });

  // src/core/ 아래 모든 .ts 파일 (테스트 · __fixtures__ 제외, 하위 폴더 포함)
  const files = coreFiles(CORE_DIR);

  it('검사기 자체: 재귀 수집은 하위 폴더를 읽고 __fixtures__ · 시험 파일을 뺀다', () => {
    const rels = files.map((f) => relative(CORE_DIR, f));
    expect(rels.some((r) => r.includes('__fixtures__'))).toBe(false);
    expect(rels.some((r) => r.endsWith('.test.ts'))).toBe(false);
  });

  it(`대상 파일이 10개 이상 있다 (현재 ${files.length}개)`, () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  const pairs = files.flatMap((file) => specifiersOf(readFileSync(file, 'utf-8')).map((spec) => ({ file, spec })));
  const allSpecifiers = pairs.map((p) => p.spec);

  it(`import/export 지정자가 하나 이상 찾아진다 (현재 ${allSpecifiers.length}개)`, () => {
    expect(allSpecifiers.length).toBeGreaterThan(0);
  });

  it('모든 import/export 지정자는 상대 경로이고 해석하면 src/core/ 아래다', () => {
    const violations = pairs.filter(({ file, spec }) => !isAllowed(spec, file)).map(({ file, spec }) => `${relative(CORE_DIR, file)}: ${spec}`);
    expect(violations, `런타임 의존성/역방향 import 발견 (${violations.length}개)`).toEqual([]);
  });
});
