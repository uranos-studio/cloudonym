// 사용자 값 보존 — 「오늘과 같은 동작」: 한글 · 공백 · 따옴표 · 결합 문자 입력이
// API 를 지나도 이름 · 판정 · 원래 이름 · 라벨이 기준선 fixture(문구 이관 전 엔진 출력)와 같고, 값은 params 에 실리되 code · field 에는 없다
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from './index';
import { req, jsonPost, json, beaconPost, fakeKv } from './test-support';
import { BASELINE_CONTEXTS, baselineRaw } from '../core/baseline-inputs';
import { ENABLED_PROVIDERS, type Provider } from '../core/types';

const HANGUL = /\p{Script=Hangul}/u;
interface FixtureName { name: string; valid: boolean; isTruncated: boolean; isTransformed: boolean; original: string; violations: number; steps: number }
interface FixtureContext { id: string; provider: Provider; names?: Record<string, FixtureName>; labels?: { labels: Record<string, string>; violations: number; transformed: number } }
const fixture = JSON.parse(readFileSync(join(import.meta.dirname, '../core/__fixtures__/baseline.json'), 'utf-8')) as { core: { contexts: FixtureContext[] } };

const IDS = ['hangul-owner', 'space-quote-combining-owner', 'alias-env-region', 'label-gcp-transform', 'empty-after-normalize'];

describe('사용자 값 — API 출력이 기준선 fixture 와 같다', () => {
  for (const id of IDS) {
    it(id, async () => {
      // API 는 켜진 CSP 만 낸다 (D45) — 꺼진 CSP 의 기준선은 core 시험이 본다. 지역은 CSP 마다 다르므로 CSP 마다 보낸다 (D49)
      for (const p of ENABLED_PROVIDERS) {
        const raw = baselineRaw(BASELINE_CONTEXTS.find((c) => c.id === id)!, p);
        const { res } = await req(app, '/v1/generate', jsonPost({ context: raw, providers: [p] }));
        expect(res.status).toBe(200);
        const body = await json(res);
        expect(Object.keys(body.data)).toEqual([p]);
        const want = fixture.core.contexts.find((c) => c.id === id && c.provider === p)!;
        for (const [type, w] of Object.entries(want.names!)) {
          const got = body.data[p][type];
          expect({
            name: got.name, valid: got.valid, isTruncated: got.is_truncated, isTransformed: got.is_transformed, original: got.original,
            violations: got.violations.length, steps: got.steps.length,
          }, `${p}.${type}`).toEqual(w);
        }
        const l = want.labels!;
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
    const body = await json((await req(app, '/v1/generate', jsonPost({ context: { owner, system: 'billing', purpose: 'trade', env: 'prod', region: 'asia-northeast3-a' }, providers: ['gcp'] }))).res);
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
    const body = await json((await req(app, '/v1/generate', jsonPost({ context: { owner, system: 'billing', purpose: 'trade', env: 'prod', region: 'asia-northeast3-a' }, providers: ['gcp'] }))).res);
    const t = body.metadata.label_transformed.gcp[0];
    expect(t).toMatchObject({ code: 'label.normalized', field: 'owner' });
    expect(t.params.from).toBe(owner.trim());
    expect(t.message).toContain(owner.trim());
  });
  it('요청 오류의 value 는 표시용 문자열 — 비문자열은 JSON 문자열로, 80자에서 자른다 (D23)', async () => {
    const body = await json((await req(app, '/v1/generate', jsonPost({ context: { owner: 'a', system: 'b', purpose: 'c', env: 'prod', region: 'asia-northeast3-a' }, providers: [{ x: 1 }, 'q'.repeat(100)] }))).res);
    expect(body.errors.map((e: { params: { value: string } }) => e.params.value)).toEqual(['{"x":1}', `${'q'.repeat(80)}…`]);
  });
});

describe('계측 쪽에는 문맥값이 없다 — 요청자에게 돌려주는 응답만 입력을 보존한다 (D56)', () => {
  // 다섯 값 · UA · 비콘의 덤 필드에 같은 표지 글자를 넣고, Axiom 전송 본문 · KV · console.* 전부에서 센다
  const MARK = { owner: 'example-team', system: 'payroll', purpose: 'ledgerx', env: 'prod', region: 'asia-northeast3-a' };
  const WORDS = ['example-team', 'payroll', 'ledgerx', 'asia-northeast3', 'ane3'];
  const UA = 'Mozilla/5.0 owner=example-team system=payroll purpose=ledgerx';
  const env = { AXIOM_API_KEY: 'k', AXIOM_DATASET: 'ds' };

  async function capture(run: () => Promise<{ res: Response; promises: Promise<unknown>[] }>): Promise<{ res: Response; leaked: string }> {
    const bodies: string[] = [];
    // Axiom 이 본문을 되돌려 주며 거부한다 — 그 본문이 console.error 로 가는 길까지 잰다
    vi.stubGlobal('fetch', (_url: string, init: { body: string }) => { bodies.push(init.body); return Promise.resolve(new Response(init.body, { status: 400 })); });
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    try {
      const { res, promises } = await run();
      await Promise.all(promises);
      expect(bodies.length, '검사기 — Axiom 전송이 실제로 일어났다').toBeGreaterThan(0);
      expect(logs[3]!.mock.calls.length, '검사기 — 거부 본문이 console.error 로 갔다').toBeGreaterThan(0);
      return { res, leaked: JSON.stringify([bodies, logs.map((l) => l.mock.calls)]) };
    } finally {
      for (const l of logs) l.mockRestore();
      vi.unstubAllGlobals();
    }
  }

  it('/v1/names — 응답의 라벨은 owner 를 그대로 싣지만 Axiom 본문 · KV · console 에는 문맥 글자가 없다', async () => {
    const { kv, puts } = fakeKv();
    const { res, leaked } = await capture(() => req(app, '/v1/names', { ...jsonPost({ provider: 'gcp', context: MARK, resources: [{ type: 'project_id' }] }), headers: { 'content-type': 'application/json', 'user-agent': UA } }, { ...env, CLOUDONYM_KV: kv }));
    expect(res.status).toBe(200);
    expect((await json(res)).metadata.generated_labels.gcp.owner).toBe('example-team');
    for (const w of WORDS) {
      expect(leaked.includes(w), w).toBe(false);
      expect(JSON.stringify(puts).includes(w), `KV ${w}`).toBe(false);
    }
  });
  it('/v1/generate · /v1/validate 도 같다', async () => {
    const gen = await capture(() => req(app, '/v1/generate', { ...jsonPost({ context: MARK }), headers: { 'content-type': 'application/json', 'user-agent': UA } }, env));
    expect(gen.res.status).toBe(200);
    const val = await capture(() => req(app, '/v1/validate', { ...jsonPost({ provider: 'gcp', resource_type: 'project_id', name: 'example-team-payroll' }), headers: { 'content-type': 'application/json', 'user-agent': UA } }, env));
    expect(val.res.status).toBe(200);
    for (const w of WORDS) {
      expect(gen.leaked.includes(w), `generate ${w}`).toBe(false);
      expect(val.leaked.includes(w), `validate ${w}`).toBe(false);
    }
  });
  it('/v1/events — 비콘 본문에 문맥 필드를 덧붙여 보내도 Axiom 에는 event · target 만 간다', async () => {
    const { res, leaked } = await capture(() => req(app, '/v1/events', beaconPost({ event: 'ui_copy', target: 'name', ...MARK }, { 'user-agent': UA }), env));
    expect(res.status).toBe(200);
    for (const w of WORDS) expect(leaked.includes(w), w).toBe(false);
  });
});
