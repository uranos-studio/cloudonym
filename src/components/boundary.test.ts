import { describe, it, expect } from 'vitest';

// 화면은 엔진을 부르기만 한다 — 컴포넌트 · App 이 core 에서 들여올 수 있는 것은 공개 API(engine · labels · types · tree · selection · scopes · catalog)뿐이다.
// 시험 전용 fixture(src/dev)는 import.meta.env.DEV 분기 안의 동적 import 로만 들인다 — 운영 번들에서 빠진다
// node:fs 는 tsconfig.app.json(브라우저 타입 · node 없음)이 거부하므로 Vite 의 ?raw 글롭으로 소스를 읽는다
const sources = import.meta.glob(['./*.ts', './*.tsx', '../App.tsx', '../main.tsx', '!./*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

// import/export 의 from '...' · 부수효과 import '...' · 동적 import('...') · require('...') — src/core/boundary.test.ts 와 같은 검사식
const STATIC_RE = /(?:import|export)(?:[^'"]*from)?\s+['"]([^'"]+)['"]/g;
const CALL_RE = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]/g;
const ALLOWED = [
  /^react$/, /^react-dom\/client$/,
  /^lucide-react$/,
  /^(?:\.\.?\/)+core\/(?:engine|labels|types|tree|selection|scopes|catalog)$/,   // 엔진 공개 API — 트리 · 선택 검증 · 범위 · catalog 조회 (D37 · D40 · D54)
  /^(?:\.\.?\/)+core\/(?:regions|regions-data)$/,     // 지역 표 · 지역 입력 풀이 — 지역 고르기 · 공유 hash 상한 (D49 · D50)
  /^(?:\.\.?\/)+core\/tier$/,                        // tier 예약어 표(데이터) — 이름 안내의 Tiers 절 (D60)
  /^(?:\.\.?\/)+core\/wizard\/(?:plan|presets|attachments|bundles)$/, // 마법사 모델 검사 · 펼치기 · 프리셋 · 호환표 · 카드 데이터 (D64 · D67 · D93)
  /^\.\/index\.css$/, /^\.\/App\.tsx$/,              // main.tsx 의 진입
  /^\.\/(?:components\/)?[A-Za-z]+$/,               // 같은 폴더의 모듈 · App 의 ./components/X
  /^\.\/introExamples\.json$/,                    // 소개 상자의 예시 (D107) — 빌드 때 엔진이 만든 데이터(scripts/gen-intro-examples.mjs)
  /^\.\.?\/messages\/(?:en|catalog)$/,              // 표현 계층 — 문장은 사전이 만든다 (D23)
  /^\.\.?\/version$/,                               // 결과에 싣는 버전 (D26)
  /^\.\.?\/site\/(?:pages|copy)$/,                 // 경로 표 · 쪽 문구 (D106) — Worker 와 같이 쓰는 순수 모듈
  /^\.\.\/plan\/wire$/,                             // 계획 파일 wire ↔ 모델 (D100) — core · api 를 들여오지 않는 순수 모듈
];
const INTERNAL = /core\/(?:normalize|compose|truncate|validate|shorten|constraints|dict|__fixtures__)/;
/** src/dev 를 들이는 자리는 `import.meta.env.DEV` 가 앞선 같은 식의 동적 import 뿐이다 */
const DEV_SPEC = /\/dev\//;
const DEV_GUARDED = /import\.meta\.env\.DEV[^;]*?import\(\s*['"][^'"]*\/dev\//g;
const DEV_ANY = /(?:from\s+|import\s*\(\s*|import\s+)['"][^'"]*\/dev\//g;

function specifiers(src: string): string[] {
  const out: string[] = [];
  for (const re of [STATIC_RE, CALL_RE]) for (const m of src.matchAll(re)) out.push(m[1] ?? '');
  return out;
}

describe('src/components · App.tsx 경계 — 엔진 공개 API 밖의 core 모듈을 들여오지 않는다', () => {
  const files = Object.keys(sources);
  it(`대상 파일이 8개 이상이고 App.tsx 가 들어 있다 (현재 ${files.length}개)`, () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
    expect(files.some((f) => f.endsWith('App.tsx'))).toBe(true);
    expect(files.every((f) => !f.endsWith('.test.ts'))).toBe(true);
  });
  it('검사식이 위반을 실제로 잡는다 (검사기 자체 시험)', () => {
    const bad = "import { fit } from '../core/truncate';\nimport { RULES } from '../core/constraints';\nimport { Hono } from 'hono';";
    const specs = specifiers(bad);
    expect(specs).toEqual(['../core/truncate', '../core/constraints', 'hono']);
    expect(specs.filter((s) => ALLOWED.some((re) => re.test(s)))).toEqual([]);
    expect(specs.filter((s) => INTERNAL.test(s))).toHaveLength(2);
    // 우회 꼴 — 재수출 · 동적 import · 부수효과 import 도 잡는다 (core 경계 시험과 같은 검사식)
    const sneaky = "export { fit } from '../core/truncate';\nexport * from '../core/validate';\nconst m = await import('../core/constraints');\nimport '../core/dict';";
    expect(specifiers(sneaky)).toEqual(['../core/truncate', '../core/validate', '../core/dict', '../core/constraints']);
    expect(specifiers(sneaky).filter((s) => INTERNAL.test(s))).toHaveLength(4);
    const ok = "import { useState } from 'react';\nimport type { NameResult } from '../core/types';\nimport { generate } from './core/engine';\nimport { ResultCard } from './components/ResultCard';\nimport { Copy } from 'lucide-react';";
    expect(specifiers(ok).every((s) => ALLOWED.some((re) => re.test(s)))).toBe(true);
  });
  it('src/dev 는 DEV 가드 안의 동적 import 로만 들인다 (검사기 자체 시험 포함)', () => {
    const guarded = "if (import.meta.env.DEV && fx) { const m = await import('./dev/fixtureRules'); }";
    const bare = "import { fixtureRules } from './dev/fixtureRules';";
    const unguarded = "const m = await import('./dev/fixtureRules');";
    const devImports = (src: string) => ({ any: [...src.matchAll(DEV_ANY)].length, guarded: [...src.matchAll(DEV_GUARDED)].length });
    expect(devImports(guarded)).toEqual({ any: 1, guarded: 1 });
    expect(devImports(bare)).toEqual({ any: 1, guarded: 0 });
    expect(devImports(unguarded)).toEqual({ any: 1, guarded: 0 });
    for (const f of files) {
      const d = devImports(sources[f] ?? '');
      expect(d.any, f).toBe(d.guarded);
    }
    expect(devImports(sources['../main.tsx'] ?? '').guarded).toBe(1);
  });
  it('모든 import 지정자가 허용 목록 안이다 · 내부 모듈은 하나도 없다', () => {
    const all = files.flatMap((f) => specifiers(sources[f] ?? '').filter((s) => !DEV_SPEC.test(s)).map((s) => `${f} → ${s}`));
    expect(all.length).toBeGreaterThan(0);
    const outside = all.filter((line) => !ALLOWED.some((re) => re.test(line.split(' → ')[1] ?? '')));
    expect(outside).toEqual([]);
    expect(all.filter((line) => INTERNAL.test(line))).toEqual([]);
  });
  it('main.tsx 가 경로 셋을 그린다 — App · NamingDoc · Privacy (D57) · 문서 페이지도 같은 허용 목록 안이다', () => {
    const main = specifiers(sources['../main.tsx'] ?? '');
    for (const m of ['./App.tsx', './components/NamingDoc', './components/Privacy', './components/About', './components/NotFound', './components/route']) expect(main, m).toContain(m);
    for (const f of ['./NamingDoc.tsx', './Privacy.tsx', './About.tsx', './aboutModel.ts', './DocPage.tsx', './route.ts']) expect(files, f).toContain(f);
  });
  it('화면은 api 를 들여오지 않는다 — 마법사도 엔진을 직접 부른다 (D17)', () => {
    expect(specifiers("import { toWirePath } from '../api/schemas';").filter((s) => ALLOWED.some((re) => re.test(s)))).toEqual([]);
    const all = files.flatMap((f) => specifiers(sources[f] ?? '').map((s) => `${f} → ${s}`));
    expect(all.filter((line) => /\/api\//.test(line))).toEqual([]);
    expect(files, 'Wizard.tsx').toContain('./Wizard.tsx');
  });
  it('이름 규칙 · 길이 판정을 화면이 스스로 하지 않는다 — maxLength · pattern 으로 검사하는 코드가 없다', () => {
    // 규칙 숫자를 읽어 표시하는 것(r.rule.maxLength)은 되지만, 그 값으로 잘라 내거나 정규식으로 판정하는 코드는 엔진 몫이다
    const judging = /\.(?:slice|substring|substr)\([^)]*maxLength|new RegExp\([^)]*rule\.pattern[^)]*\)\.test/;
    const hits = files.filter((f) => judging.test(sources[f] ?? ''));
    expect(hits).toEqual([]);
  });
});
