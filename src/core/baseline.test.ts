// 기준선 — 문구 이관 전 엔진 · 화면 몫의 출력을 fixture 로 고정하고, 이후 모든 변경이 같은 출력을 내는지 대어 본다.
// fixture 갱신: UPDATE_BASELINE=1 npx vitest run src/core/baseline.test.ts
// 이 fixture 는 문구 이관이 끝날 때까지 갱신하지 않는다 — 갱신이 필요하다면 그 자체가 회귀다
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASELINE_CONTEXTS, coreBaseline } from './baseline-inputs';
import { generate, parseContext } from './engine';
import { labelsFor } from './labels';
import { PROVIDERS, type LabelSet, type Provider } from './types';
import { toTerraformLocals } from '../components/terraform';
import { labelsJsonBlocked } from '../components/labelsGate';

const FIXTURE = join(import.meta.dirname, '__fixtures__', 'baseline.json');

/** Terraform locals 에서 문구를 뺀 뼈대 — `key = 값` 줄과 `# INVALID: key` 접두 */
function terraformSkeleton(hcl: string): { assignments: string[]; invalid: string[] } {
  const lines = hcl.split('\n');
  return {
    assignments: lines.filter((l) => /^\s+\w+ = /.test(l)).map((l) => l.trim()),
    invalid: lines.filter((l) => l.includes('# INVALID: ')).map((l) => l.trim().split(' — ')[0]!),
  };
}

function uiBaseline() {
  return BASELINE_CONTEXTS.flatMap(({ id, raw }) => {
    const parsed = parseContext(raw);
    if (!parsed.ok) return [];
    const out = generate(parsed.context);
    const labels: Partial<Record<Provider, LabelSet>> = {};
    for (const p of PROVIDERS) labels[p] = labelsFor(parsed.context, p);
    const blocked: Record<string, boolean> = { all: labelsJsonBlocked([...PROVIDERS], labels) };
    for (const p of PROVIDERS) blocked[p] = labelsJsonBlocked([p], labels);
    return [{ id, terraform: terraformSkeleton(toTerraformLocals(out, labels)), labelsJsonBlocked: blocked }];
  });
}

function snapshot() {
  return { core: coreBaseline(), ui: uiBaseline() };
}

describe('기준선 — 이름 · 판정 · 제안 · 라벨 · 내보내기가 fixture 와 같다', () => {
  const actual = snapshot();

  it('표본이 비어 있지 않다 — 규칙 전부 · 경계 · 파싱 실패가 들어 있다', () => {
    const base = actual.core.contexts.find((c) => c.id === 'base');
    expect(base && 'names' in base).toBe(true);
    const types = PROVIDERS.flatMap((p) => Object.keys((base as { names: Record<string, object> }).names[p] ?? {}));
    expect(types.length).toBe(24);
    expect(actual.core.validate.length).toBeGreaterThan(24 * 10);
    expect(actual.core.contexts.filter((c) => !c.parse.ok).length).toBeGreaterThanOrEqual(5);
    // 무효 · 유효 · 제안이 모두 표본에 있다 — 한쪽만 있으면 회귀를 못 잡는다
    expect(actual.core.validate.some((v) => v.valid)).toBe(true);
    expect(actual.core.validate.some((v) => !v.valid)).toBe(true);
    expect(actual.core.validate.some((v) => v.suggestedName !== null)).toBe(true);
  });

  it('fixture 와 같다', () => {
    const text = `${JSON.stringify(actual, null, 2)}\n`;
    if (process.env.UPDATE_BASELINE === '1') writeFileSync(FIXTURE, text);
    expect(existsSync(FIXTURE), `fixture 가 없다 — UPDATE_BASELINE=1 로 한 번 만든다: ${FIXTURE}`).toBe(true);
    expect(JSON.parse(readFileSync(FIXTURE, 'utf-8'))).toEqual(actual);
  });
});
