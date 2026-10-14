import { describe, it, expect } from 'vitest';

// src/plan/ 경계 (D100) — 계획 파일 변환은 core 도 api 도 components 도 들여오지 않는다. 같은 폴더(./)만 된다.
// core 밖에 두어 규칙 버전을 움직이지 않고(D27), api · 화면이 같이 쓴다. node:fs 는 tsconfig.app.json(브라우저 타입)이 거부하므로 ?raw 글롭으로 읽는다
// 하위 폴더까지 본다(./**) — src/plan/x/y.ts 가 생겨도 검사 밖으로 빠지지 않게. 하위 폴더의 파일은 같은 폴더(./)나 src/plan 안(../ 가 src/plan 을 벗어나지 않는)만 된다
const sources = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

// src/core/boundary.test.ts 와 같은 검사식 — from '...' · 부수효과 import · 동적 import · require
const STATIC_RE = /(?:import|export)(?:[^'"]*from)?\s+['"]([^'"]+)['"]/g;
const CALL_RE = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]/g;
function specifiers(src: string): string[] {
  const out: string[] = [];
  for (const re of [STATIC_RE, CALL_RE]) for (const m of src.matchAll(re)) out.push(m[1] ?? '');
  return out;
}
/** src/plan 안의 모듈만 — 파일 자리(file: `./wire.ts` · `./sub/x.ts`)에서 지정자를 풀어 src/plan 을 벗어나면 거부. 패키지 이름도 거부 */
function allowed(spec: string, file = './x.ts'): boolean {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return false;
  const dir = file.split('/').slice(1, -1);
  for (const part of spec.split('/')) {
    if (part === '.') continue;
    if (part === '..') { if (dir.length === 0) return false; dir.pop(); }
    else if (/^[A-Za-z0-9_-]+$/.test(part)) dir.push(part);
    else return false;
  }
  return true;
}

describe('src/plan/ 경계 — 같은 폴더만 들여온다', () => {
  it('검사기 자체 — 우회 꼴을 잡고 같은 폴더는 통과시킨다', () => {
    const probe = "import { a } from './wire';\nimport type { W } from '../core/wizard/plan';\nexport * from '../api/schemas';\nconst m = await import('../components/urlState');\nimport 'hono';\nconst z = require('./../core/types');";
    const specs = specifiers(probe);
    expect(specs).toEqual(['./wire', '../core/wizard/plan', '../api/schemas', 'hono', '../components/urlState', './../core/types']);
    expect(specs.filter((s) => !allowed(s))).toEqual(['../core/wizard/plan', '../api/schemas', 'hono', '../components/urlState', './../core/types']);
  });
  it('검사기 자체 — 하위 폴더 파일은 src/plan 안으로만 올라갈 수 있다', () => {
    expect(allowed('../wire', './sub/x.ts')).toBe(true);
    expect(allowed('./y', './sub/x.ts')).toBe(true);
    expect(allowed('../../core/types', './sub/x.ts')).toBe(false);
    expect(allowed('../wire', './x.ts')).toBe(false);
  });
  it('글롭이 하위 폴더를 본다 · wire.ts 가 있고 · 모든 import 지정자가 src/plan 안이다 (지금은 하나도 없다)', () => {
    const files = Object.keys(sources);
    expect(files).toContain('./wire.ts');
    expect(files.every((f) => f.startsWith('./') && !f.endsWith('.test.ts'))).toBe(true);
    const all = files.flatMap((f) => specifiers(sources[f] ?? '').map((s) => ({ f, s })));
    expect(all.filter(({ f, s }) => !allowed(s, f)).map(({ f, s }) => `${f} → ${s}`)).toEqual([]);
  });
});
