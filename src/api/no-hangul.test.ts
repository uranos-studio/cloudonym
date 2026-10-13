// 시스템 문구 한글 0 (D24) — ASCII 입력만 쓰는 대표 요청의 응답 JSON 전체를 면제 없이 걷는다.
// 입력이 ASCII 라 응답에 한글이 있으면 그것은 시스템 문구다. 사용자 값 보존은 user-data.test 가 따로 본다
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from './index';
import { collectSamples, type Sample } from './test-support';
import { VERSION } from '../version';

const HANGUL = /\p{Script=Hangul}/u;

/** JSON 값 안의 모든 문자열(키 포함)과 그 경로 */
function strings(v: unknown, path = '$'): { path: string; text: string }[] {
  if (typeof v === 'string') return [{ path, text: v }];
  if (Array.isArray(v)) return v.flatMap((x, i) => strings(x, `${path}[${i}]`));
  if (v !== null && typeof v === 'object') {
    return Object.entries(v).flatMap(([k, x]) => [{ path: `${path}.<key>`, text: k }, ...strings(x, `${path}.${k}`)]);
  }
  return [];
}

describe('API 응답 — 한글 0 · 모든 실패에 code 와 message', () => {
  let samples: Sample[] = [];
  beforeAll(async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try { samples = await collectSamples(app, VERSION.rules); } finally { spy.mockRestore(); }
  });

  it('검사기 자체 — 깊은 곳 · 키 · 배열 안의 한글을 찾고 ASCII · 기호는 통과시킨다', () => {
    const hangul = String.fromCodePoint(0xd7a3);
    const found = (v: unknown) => strings(v).filter((s) => HANGUL.test(s.text)).map((s) => s.path);
    expect(found({ a: [{ b: `x${hangul}` }] })).toEqual(['$.a[0].b']);
    expect(found({ [hangul]: 1 })).toEqual(['$.<key>']);
    expect(found({ a: 'A → · — …', b: [1, true, null] })).toEqual([]);
  });

  it('표본이 여섯 실패 경로(v1 파싱 400 · 409 · 413 · 403 · 429 v1 · 429 /llms.txt · 500)를 모두 담는다', () => {
    const ids = samples.map((x) => x.id);
    for (const id of ['400-not-json', '409-rules-version', '413-body-too-large', '403-events-cross-site', '429-generate', '429-llms-txt', '500-internal']) {
      expect(ids, id).toContain(id);
    }
  });

  it('모든 응답의 모든 문자열에 한글 0', () => {
    const hits = samples.flatMap((x) => strings(x.body).filter((s) => HANGUL.test(s.text)).map((s) => `${x.id} ${s.path}: ${s.text}`));
    expect(hits).toEqual([]);
  });

  it('모든 실패 응답은 success:false 이고 errors[i] 마다 code 와 비어 있지 않은 message 가 있다', () => {
    const failures = samples.filter((x) => x.status >= 400);
    expect(failures.length).toBeGreaterThanOrEqual(20);
    for (const x of failures) {
      expect(x.body.success, x.id).toBe(false);
      expect(x.body.errors.length, x.id).toBeGreaterThan(0);
      for (const e of x.body.errors) {
        expect(e.code, x.id).toMatch(/^[a-z]+\.[a-z_0-9]+$/);
        expect(typeof e.message === 'string' && e.message.length > 0, x.id).toBe(true);
      }
    }
  });

  it('200 응답의 모든 메시지 배열(violations · steps · notes · 라벨 · transformed) 원소에도 code 와 message 가 있다', () => {
    const messages: unknown[] = [];
    const walk = (v: unknown, key = ''): void => {
      if (Array.isArray(v)) {
        if (['violations', 'steps', 'notes', 'transformed', 'gcp', 'aws', 'azure'].includes(key)) messages.push(...v.filter((m) => typeof m === 'object'));
        v.forEach((x) => walk(x));
      } else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
    };
    for (const x of samples.filter((s) => s.status === 200)) walk(x.body);
    expect(messages.length).toBeGreaterThan(50);
    for (const m of messages as { code: unknown; message: unknown }[]) {
      expect(typeof m.code).toBe('string');
      expect(typeof m.message === 'string' && m.message.length > 0).toBe(true);
    }
  });

  it('goog-billing 은 무효 · 모든 200 응답에 version', () => {
    const ms = samples.find((x) => x.id === 'validate-invalid-goog')!;
    expect(ms.body.valid).toBe(false);
    expect(ms.body.violations[0]).toMatchObject({ code: 'name.forbidden_prefix', params: { value: 'goog' } });
    for (const x of samples.filter((s) => s.status === 200 && s.path !== '/v1/events')) expect(x.body.version, x.id).toEqual(VERSION);
  });
});

// 정적 자산도 공개 화면이다 — index.html 은 빌드에 그대로 실려 배포 점검(release-check)의 「GET / Hangul in body」에 걸린다
describe('정적 index.html — 한글 0', () => {
  it('주석까지 한글이 없다', () => {
    const html = readFileSync(join(import.meta.dirname, '..', '..', 'index.html'), 'utf-8');
    expect(html.split('\n').filter((l) => HANGUL.test(l))).toEqual([]);
  });
});
