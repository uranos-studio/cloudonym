// 원시 입력 호환 — 기준선의 옛 원시 입력 20개(__fixtures__/raw-inputs-before-v0.1.0.ts 에 얼린 사본)를 provider 마다 문맥 파서에 넣은 결과를 고정한다.
// 0.1.0 작업 동안 환경 값(prd → prod)과 지역 값(나라 값 → provider 별 리전 · 존 코드)이 바뀌면 이 결과도 바뀐다 —
// 그때마다 fixture 의 기대값을 그 변경에 맞게 고쳐 쓰고, 고친 차이를 커밋에서 읽는다.
// 기대값 갱신: UPDATE_RAW_COMPAT=1 npx vitest run src/core/raw-compat.test.ts (변경 회계 fixture 와 함께 0.1.0 마감 검토 뒤 지운다)
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAW_INPUTS_BEFORE } from './__fixtures__/raw-inputs-before-v0.1.0';
import { parseContext } from './engine';
import { PROVIDERS, type Provider, type RawContext } from './types';

const FILE = join(import.meta.dirname, '__fixtures__', 'raw-compat-v0.1.0.json');

type Results = Record<string, Partial<Record<Provider, unknown>>>;

/** 원시 입력 → 파서 결과 전체(성공이면 문맥 · 바뀐 값, 실패면 오류 — code · field · params 그대로).
 *  지역 · 존 파서가 provider 를 받게 되면 이 호출 한 줄이 바뀐다 */
function parseFor(raw: RawContext, _provider: Provider): unknown {
  const r = parseContext(raw);
  return r.ok ? { ok: true, context: r.context, transformed: r.transformed } : { ok: false, errors: r.errors };
}

function collect(): Results {
  return Object.fromEntries(RAW_INPUTS_BEFORE.map(({ id, raw }) => [id, Object.fromEntries(PROVIDERS.map((p) => [p, parseFor(raw, p)]))]));
}

/** 다른 칸의 목록 — `${id}/${provider}` */
function compatDiff(actual: Results, expected: Results): string[] {
  const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
  const out: string[] = [];
  for (const id of [...keys].sort()) {
    for (const p of PROVIDERS) {
      if (JSON.stringify(actual[id]?.[p]) !== JSON.stringify(expected[id]?.[p])) out.push(`${id}/${p}`);
    }
  }
  return out;
}

describe('원시 입력 호환 — 옛 원시 입력 20개 × provider', () => {
  const actual = collect();
  if (process.env.UPDATE_RAW_COMPAT === '1') writeFileSync(FILE, `${JSON.stringify(actual, null, 2)}\n`);
  const expected = JSON.parse(readFileSync(FILE, 'utf-8')) as Results;

  it('파서 결과가 fixture 의 기대값과 같다 (20 입력 × 3 provider)', () => {
    expect(Object.keys(expected)).toHaveLength(20);
    expect(compatDiff(actual, expected)).toEqual([]);
  });

  it('검사기 자체 시험 — 기대값 한 글자 · 한 칸을 바꾸면 그 칸만 다르다고 보고한다', () => {
    const changed = structuredClone(expected);
    const base = changed['base']!.gcp as { context: { region: string } };
    base.context.region = `${base.context.region}x`;
    expect(compatDiff(actual, changed)).toEqual(['base/gcp']);
    const dropped = structuredClone(expected);
    delete dropped['parse-region-mars']!.azure;
    expect(compatDiff(actual, dropped)).toEqual(['parse-region-mars/azure']);
  });
});
