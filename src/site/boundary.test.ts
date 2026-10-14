import { describe, it, expect } from 'vitest';

// src/site/ 경계 (D106) — 화면과 Worker 가 같이 쓰는 경로 표 · 쪽 문구. 같은 폴더(./)와 사전(../messages/en · catalog)만 들여온다.
// core · api · components 를 들이면 Worker 번들에 화면 코드가, 화면 번들에 Worker 코드가 섞인다. src/plan/boundary.test.ts 와 같은 검사식
const sources = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const STATIC_RE = /(?:import|export)(?:[^'"]*from)?\s+['"]([^'"]+)['"]/g;
const CALL_RE = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]/g;
function specifiers(src: string): string[] {
  const out: string[] = [];
  for (const re of [STATIC_RE, CALL_RE]) for (const m of src.matchAll(re)) out.push(m[1] ?? '');
  return out;
}
/** 최상위 파일 기준 — 같은 폴더의 모듈(./x) · 사전 둘만 */
const ALLOWED = [/^\.\/[A-Za-z]+$/, /^\.\.\/messages\/(?:en|catalog)$/];
const allowed = (spec: string) => ALLOWED.some((re) => re.test(spec));

describe('src/site/ 경계 — 같은 폴더 · 사전만 들여온다', () => {
  it('검사기 자체 — 우회 꼴을 잡고 허용 꼴은 통과시킨다', () => {
    const probe = "import { a } from './pages';\nimport { en } from '../messages/en';\nimport type { C } from '../messages/catalog';\nexport * from '../api/schemas';\nconst m = await import('../components/route');\nimport 'hono';\nimport { R } from '../core/types';\nimport { x } from './../api/env';";
    const specs = specifiers(probe);
    expect(specs.filter((s) => !allowed(s))).toEqual(['../api/schemas', 'hono', '../core/types', './../api/env', '../components/route']);
  });
  it('하위 폴더가 없고 · pages.ts · copy.ts 가 있고 · 모든 import 지정자가 허용 목록 안이다', () => {
    const files = Object.keys(sources);
    expect(files).toEqual(expect.arrayContaining(['./pages.ts', './copy.ts']));
    expect(files.every((f) => /^\.\/[A-Za-z]+\.ts$/.test(f))).toBe(true);
    const all = files.flatMap((f) => specifiers(sources[f] ?? '').map((s) => ({ f, s })));
    expect(all.filter(({ s }) => !allowed(s)).map(({ f, s }) => `${f} → ${s}`)).toEqual([]);
  });
  it('pages.ts 는 아무것도 들여오지 않는다 — 경로 표는 순수하다', () => {
    expect(specifiers(sources['./pages.ts'] ?? '')).toEqual([]);
  });
});
