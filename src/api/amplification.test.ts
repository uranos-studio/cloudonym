import { describe, it, expect } from 'vitest';
import { app } from './index';
import { req, jsonPost, json } from './test-support';
import { rulesFor } from '../core/constraints';
import { inputKind } from '../core/tree';
import { MAX_CONTEXT_CHARS } from '../core/engine';
import { ENABLED_PROVIDERS, type Provider } from '../core/types';

// 응답 증폭 상한 — 작은 요청(32KB 본문 상한 안)이 수 MB 응답을 만들지 못하게 한다 (docs/decisions.md · 2026-10-06 응답 증폭).
// 수치는 상한이지 목표가 아니다: 최악 입력의 실제 응답이 이 안이어야 한다.
// HTTP 로 닿는 것은 켜진 CSP 뿐이다 (D45) — 켜는 CSP 가 늘면 이 시험이 그것도 돈다.
// 이름 200개 응답은 입력이 짧아도 규칙(rule)을 항목마다 실어 azure 가 약 270KB 다 — 상한은 그 바닥의 2.4배쯤이다
const MAX_NAMES_RESPONSE_BYTES = 640 * 1024;
const MAX_ERROR_RESPONSE_BYTES = 64 * 1024;

/** 이름 200개를 만드는 선택 — count 규칙 둘(99 + 99) + 하나(2). 규칙 표가 바뀌어도 count 규칙에서 고른다 */
function worstSelection(p: Provider): { type: string; count: number }[] {
  const counted = rulesFor(p).filter((r) => inputKind(r) === 'count').map((r) => r.resourceType);
  return [{ type: counted[0]!, count: 99 }, { type: counted[1]!, count: 99 }, { type: counted[2]!, count: 2 }];
}

const bytes = async (res: Response): Promise<number> => new TextEncoder().encode(await res.text()).length;

/** 자유 입력 한 글자의 꼴 — 정제로 사라지는 것 · 이스케이프로 6배가 되는 것 · 남는 것 · UTF-8 3바이트 */
const FILLERS: [string, string][] = [
  ['ZWSP', '\u200B'], ['C0 제어 문자', '\u0001'], ['대문자', 'A'], ['한글', String.fromCodePoint(0xac00)], ['대문자와 제어 문자', 'A\u0001'],
];

describe('POST /v1/names 응답 증폭', () => {
  it('예전 상한의 최악 입력(자유 입력 셋 각 ZWSP 1024자) → 400 field_too_long 셋, 응답이 작다', async () => {
    const z = '\u200B'.repeat(1024);
    const { res } = await req(app, '/v1/names', jsonPost({ provider: 'gcp', context: { owner: z, system: z, purpose: z, env: 'prod', region: 'asia-northeast3-a' }, resources: worstSelection('gcp') }));
    expect(res.status).toBe(400);
    expect(await bytes(res.clone())).toBeLessThan(MAX_ERROR_RESPONSE_BYTES);
    expect((await json(res)).errors.map((e: { field: string }) => e.field)).toEqual(['owner', 'system', 'purpose']);
  });

  for (const p of ENABLED_PROVIDERS) {
    for (const [label, ch] of FILLERS) {
      it(`${p} · 상한(${MAX_CONTEXT_CHARS}자) ${label} × 3 · 이름 200개 → 응답 ${MAX_NAMES_RESPONSE_BYTES / 1024}KB 안`, async () => {
        const v = ch.repeat(MAX_CONTEXT_CHARS / ch.length);
        const { res } = await req(app, '/v1/names', jsonPost({ provider: p, context: { owner: v, system: v, purpose: v, env: 'prod', region: 'asia-northeast3-a' }, resources: worstSelection(p) }));
        expect(res.status).toBe(200);
        expect(await bytes(res)).toBeLessThan(MAX_NAMES_RESPONSE_BYTES);
      });
    }
  }

  it('자유 입력이 상한을 1자 넘으면 400 field_too_long (max 는 상한)', async () => {
    const { res } = await req(app, '/v1/names', jsonPost({ provider: 'gcp', context: { owner: 'a'.repeat(MAX_CONTEXT_CHARS + 1), system: 'b', purpose: 'c', env: 'prod', region: 'asia-northeast3-a' }, resources: [{ type: 'project_id' }] }));
    expect(res.status).toBe(400);
    expect((await json(res)).errors).toEqual([{ code: 'request.field_too_long', field: 'owner', params: { max: MAX_CONTEXT_CHARS }, message: `'owner' is longer than ${MAX_CONTEXT_CHARS} characters` }]);
  });
});
