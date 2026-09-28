import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// import/export 문의 from '...' · 부수효과 import '...' · 동적 import('...') · require('...') 의 지정자를 모은다
const STATIC_RE = /(?:import|export)(?:[^'"]*from)?\s+['"]([^'"]+)['"]/g;
const CALL_RE = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]/g;

function specifiersOf(content: string): string[] {
  const out: string[] = [];
  for (const re of [STATIC_RE, CALL_RE]) for (const m of content.matchAll(re)) out.push(m[1]);
  return out;
}

/** ./ 로 시작하고 .. 구간이 없어야 한다 — './../api/x' 처럼 ./ 를 붙인 역방향 import 를 막는다 */
function isAllowed(s: string): boolean {
  return s.startsWith('./') && !s.split('/').includes('..');
}

describe('src/core/ 모듈 경계 — import 는 ./ 로만', () => {
  // 검사기를 먼저 시험한다 — 잡아야 할 것을 실제로 잡는가 (최종 리뷰 I-4)
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
    expect(specs.filter((s) => !isAllowed(s))).toEqual(['./../api/serialize', '../api/index', 'hono', 'zod']);
  });

  // src/core/ 디렉터리의 모든 .ts 파일 (테스트 파일 제외)
  const coreDir = join(import.meta.dirname, '.');
  const files = readdirSync(coreDir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => join(coreDir, f));

  it(`대상 파일이 10개 이상 있다 (현재 ${files.length}개)`, () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  const allSpecifiers = files.flatMap((file) => specifiersOf(readFileSync(file, 'utf-8')));

  it(`import/export 지정자가 하나 이상 찾아진다 (현재 ${allSpecifiers.length}개)`, () => {
    expect(allSpecifiers.length).toBeGreaterThan(0);
  });

  it('모든 import/export 지정자는 ./ 로 시작하고 .. 구간이 없다', () => {
    const violations = allSpecifiers.filter((s) => !isAllowed(s));
    expect(violations, `런타임 의존성/역방향 import 발견 (${violations.length}개)`).toEqual([]);
  });
});
