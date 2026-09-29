// 사용자 값 보존 (§1-2 · codex #6 · #12) — 「오늘과 같은 동작」: 한글 · 공백 · 따옴표 · 결합 문자 입력이
// API 를 지나도 이름 · 판정 · 원래 이름 · 라벨이 기준선 fixture(문구 이관 전 엔진 출력)와 같고, 값은 params 에 실리되 code · field 에는 없다
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from './index';
import { req, jsonPost, json } from './test-support';
import { BASELINE_CONTEXTS } from '../core/baseline-inputs';

const HANGUL = /\p{Script=Hangul}/u;
interface FixtureName { name: string; valid: boolean; isTruncated: boolean; isTransformed: boolean; original: string; violations: number; steps: number }
interface FixtureContext { id: string; names?: Record<string, Record<string, FixtureName>>; labels?: Record<string, { labels: Record<string, string>; violations: number; transformed: number }> }
const fixture = JSON.parse(readFileSync(join(import.meta.dirname, '../core/__fixtures__/baseline.json'), 'utf-8')) as { core: { contexts: FixtureContext[] } };

const IDS = ['hangul-owner', 'space-quote-combining-owner', 'alias-env-region', 'label-gcp-transform', 'empty-after-normalize'];

describe('사용자 값 — API 출력이 기준선 fixture 와 같다', () => {
  for (const id of IDS) {
    it(id, async () => {
      const raw = BASELINE_CONTEXTS.find((c) => c.id === id)!.raw;
      const { res } = await req(app, '/v1/generate', jsonPost({ context: raw }));
      expect(res.status).toBe(200);
      const body = await json(res);
      const want = fixture.core.contexts.find((c) => c.id === id)!;
      for (const [p, byType] of Object.entries(want.names!)) {
        for (const [type, w] of Object.entries(byType)) {
          const got = body.data[p][type];
          expect({
            name: got.name, valid: got.valid, isTruncated: got.is_truncated, isTransformed: got.is_transformed, original: got.original,
            violations: got.violations.length, steps: got.steps.length,
          }, `${p}.${type}`).toEqual(w);
        }
        const l = want.labels![p]!;
        expect(body.metadata.generated_labels[p], p).toEqual(l.labels);
        expect(body.metadata.label_violations[p].length, p).toBe(l.violations);
        expect(body.metadata.label_transformed[p].length, p).toBe(l.transformed);
      }
    });
  }
});

describe('사용자 값은 params · 이름 · 라벨에 있고 code · field 에는 없다', () => {
  it('한글 owner — original · 라벨 · step.normalized 의 params.from 에 그대로', async () => {
    const owner = BASELINE_CONTEXTS.find((c) => c.id === 'hangul-owner')!.raw.owner as string;
    const body = await json((await req(app, '/v1/generate', jsonPost({ context: { owner, system: 'billing', purpose: 'trade', env: 'prd', region: 'kr' }, providers: ['gcp'] }))).res);
    const pid = body.data.gcp.project_id;
    expect(pid.original.startsWith(owner)).toBe(true);
    expect(body.metadata.generated_labels.gcp.owner).toBe(owner);
    expect(pid.steps).toContainEqual(expect.objectContaining({ code: 'step.normalized', field: 'owner', params: { from: owner, to: '' } }));
    const all = Object.values(body.data.gcp as Record<string, { steps: { code: string; field?: string }[]; violations: { code: string; field?: string }[] }>)
      .flatMap((r) => [...r.steps, ...r.violations]);
    for (const m of all) {
      expect(HANGUL.test(m.code)).toBe(false);
      expect(HANGUL.test(m.field ?? '')).toBe(false);
    }
  });
  it('공백 · 따옴표 · 결합 문자 owner — GCP 라벨 변환의 params.from 에 원래 값, message 에도 같은 값', async () => {
    const owner = BASELINE_CONTEXTS.find((c) => c.id === 'space-quote-combining-owner')!.raw.owner as string;
    const body = await json((await req(app, '/v1/generate', jsonPost({ context: { owner, system: 'billing', purpose: 'trade', env: 'prd', region: 'kr' }, providers: ['gcp'] }))).res);
    const t = body.metadata.label_transformed.gcp[0];
    expect(t).toMatchObject({ code: 'label.normalized', field: 'owner' });
    expect(t.params.from).toBe(owner.trim());
    expect(t.message).toContain(owner.trim());
  });
  it('요청 오류의 value 는 표시용 문자열 — 비문자열은 JSON 문자열로, 80자에서 자른다 (D23)', async () => {
    const body = await json((await req(app, '/v1/generate', jsonPost({ context: { owner: 'a', system: 'b', purpose: 'c', env: 'prd', region: 'kr' }, providers: [{ x: 1 }, 'q'.repeat(100)] }))).res);
    expect(body.errors.map((e: { params: { value: string } }) => e.params.value)).toEqual(['{"x":1}', `${'q'.repeat(80)}…`]);
  });
});
