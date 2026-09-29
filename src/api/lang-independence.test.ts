// 언어 계층과 무관 (완료 기준 ⑵) — 모든 문구를 'X' 로 내는 가짜 사전으로 직렬화해도 message 만 다르고 나머지는 깊이 같다
import { describe, it, expect } from 'vitest';
import { generate, parseContext, validateName } from '../core/engine';
import { labelsFor } from '../core/labels';
import { MESSAGE_CODES } from '../core/messages';
import { PROVIDERS } from '../core/types';
import { API_CODES } from './codes';
import { en } from '../messages/en';
import type { Catalog } from '../messages/catalog';
import { toWireGenerate, toWireValidate, type ProviderResult } from './serialize';
import { BASELINE_CONTEXTS, baselineValidateCases } from '../core/baseline-inputs';
import { VERSION } from '../version';

const stub = {
  messages: Object.fromEntries([...MESSAGE_CODES, ...API_CODES].map((c) => [c, () => 'X'])),
  ui: Object.fromEntries(Object.keys(en.ui).map((k) => [k, 'X'])),
} as unknown as Catalog;

/** message 키만 지운다 */
function withoutMessage(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withoutMessage);
  if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'message').map(([k, x]) => [k, withoutMessage(x)]));
  return v;
}

describe('사전을 바꿔도 이름 · 판정 · 코드 · params 는 같다', () => {
  it('가짜 사전은 정말 다른 문장을 낸다 (검사기 자체)', () => {
    const a = toWireValidate({ valid: false, violations: [{ code: 'name.empty' }] }, VERSION, en);
    const b = toWireValidate({ valid: false, violations: [{ code: 'name.empty' }] }, VERSION, stub);
    expect(a.violations[0]!.message).not.toBe(b.violations[0]!.message);
    expect(withoutMessage(a)).toEqual(withoutMessage(b));
  });
  it('기준선 문맥 전부 — generate', () => {
    let n = 0;
    for (const { raw } of BASELINE_CONTEXTS) {
      const parsed = parseContext(raw);
      if (!parsed.ok) continue;
      const out = generate(parsed.context);
      const results: ProviderResult[] = PROVIDERS.map((p) => ({ provider: p, names: out[p] ?? {}, labels: labelsFor(parsed.context, p) }));
      const a = toWireGenerate(results, parsed.transformed, VERSION, en);
      const b = toWireGenerate(results, parsed.transformed, VERSION, stub);
      expect(withoutMessage(b)).toEqual(withoutMessage(a));
      expect(JSON.stringify(b)).toContain('"message":"X"');
      n++;
    }
    expect(n).toBeGreaterThan(10);
  });
  it('기준선 검증 입력 전부 — validate', () => {
    for (const c of baselineValidateCases()) {
      const r = validateName(c.provider, c.resourceType, c.name);
      expect(withoutMessage(toWireValidate(r, VERSION, stub))).toEqual(withoutMessage(toWireValidate(r, VERSION, en)));
    }
  });
});
