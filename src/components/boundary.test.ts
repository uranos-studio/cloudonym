import { describe, it, expect } from 'vitest';

// 화면은 엔진을 부르기만 한다 (L3) — 컴포넌트 · App 이 core 에서 들여올 수 있는 것은 공개 API 셋(engine · labels · types)뿐이다.
// node:fs 는 tsconfig.app.json(브라우저 타입 · node 없음)이 거부하므로 Vite 의 ?raw 글롭으로 소스를 읽는다
const sources = import.meta.glob(['./*.ts', './*.tsx', '../App.tsx', '!./*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

// import/export 의 from '...' · 부수효과 import '...' · 동적 import('...') · require('...') — src/core/boundary.test.ts 와 같은 검사식
const STATIC_RE = /(?:import|export)(?:[^'"]*from)?\s+['"]([^'"]+)['"]/g;
const CALL_RE = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]/g;
const ALLOWED = [
  /^react$/,
  /^lucide-react$/,
  /^(?:\.\.?\/)+core\/(?:engine|labels|types)$/,   // 엔진 공개 API 셋
  /^\.\/(?:components\/)?[A-Za-z]+$/,               // 같은 폴더의 모듈 · App 의 ./components/X
  /^\.\.?\/messages\/(?:en|catalog)$/,              // 표현 계층 — 문장은 사전이 만든다 (D23)
  /^\.\.?\/version$/,                               // 결과에 싣는 버전 (D26)
];
const INTERNAL = /core\/(?:normalize|compose|truncate|validate|shorten|constraints|dict)/;

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
    // 우회 꼴 — 재수출 · 동적 import · 부수효과 import 도 잡는다 (core 경계 시험과 같은 검사식 · 3단계 최종 리뷰 이월 minor)
    const sneaky = "export { fit } from '../core/truncate';\nexport * from '../core/validate';\nconst m = await import('../core/constraints');\nimport '../core/dict';";
    expect(specifiers(sneaky)).toEqual(['../core/truncate', '../core/validate', '../core/dict', '../core/constraints']);
    expect(specifiers(sneaky).filter((s) => INTERNAL.test(s))).toHaveLength(4);
    const ok = "import { useState } from 'react';\nimport type { NameResult } from '../core/types';\nimport { generate } from './core/engine';\nimport { ResultCard } from './components/ResultCard';\nimport { Copy } from 'lucide-react';";
    expect(specifiers(ok).every((s) => ALLOWED.some((re) => re.test(s)))).toBe(true);
  });
  it('모든 import 지정자가 허용 목록 안이다 · 내부 모듈은 하나도 없다', () => {
    const all = files.flatMap((f) => specifiers(sources[f] ?? '').map((s) => `${f} → ${s}`));
    expect(all.length).toBeGreaterThan(0);
    const outside = all.filter((line) => !ALLOWED.some((re) => re.test(line.split(' → ')[1] ?? '')));
    expect(outside).toEqual([]);
    expect(all.filter((line) => INTERNAL.test(line))).toEqual([]);
  });
  it('이름 규칙 · 길이 판정을 화면이 스스로 하지 않는다 — maxLength · pattern 으로 검사하는 코드가 없다', () => {
    // 규칙 숫자를 읽어 표시하는 것(r.rule.maxLength)은 되지만, 그 값으로 잘라 내거나 정규식으로 판정하는 코드는 엔진 몫이다
    const judging = /\.(?:slice|substring|substr)\([^)]*maxLength|new RegExp\([^)]*rule\.pattern[^)]*\)\.test/;
    const hits = files.filter((f) => judging.test(sources[f] ?? ''));
    expect(hits).toEqual([]);
  });
});
