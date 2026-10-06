// 손 예로 들인 규칙의 정규식을 검사한다 (D43).
// rule-cases-<provider>-intake.json 은 생성기가 규칙과 같은 spec 에서 짠다 — 문장을 정규식으로 잘못 옮겨도 함께 틀려 통과한다.
// __fixtures__/intake-hand-cases.json 은 원문 문장(Azure Valid Characters 칸 · AWS 스키마 pattern · GCP 패턴)만 읽고 손으로 쓴 예다.
// 열쇠는 원문 그 자체다 — Azure 는 생성기가 매기는 C 번호가 아니라 그 번호의 원문 문장(raw)으로 짝짓는다. C 번호는 새 문자 규칙이 앞에 끼면 다시 매겨진다.
// 문장 · 패턴 하나의 예를 그것을 쓰는 모든 행에 행의 길이로 맞춰 적용한다. '~' 는 채움 글자가 들어갈 자리다 — 결함 앞뒤를 피해 둔다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RULES } from './constraints';
import { checkName } from './validate';
import type { ResourceRule } from './types';
import { AZURE_INTAKE_CHARS, AZURE_INTAKE_ROWS } from './rules/azure-intake';
import { AWS_INTAKE_ROWS } from './rules/aws-intake';
import { GCP_INTAKE_ROWS } from './rules/gcp-intake';

type Invalid = string | { name: string; checkOnly: string };
/** invisibleAllowed — 원문이 어떤 글자든 받는다(검사하지 않는다) · invisibleAccepted — 공개 패턴이 받는 글자 몇 개와 그 근거 */
interface Entry { source: string; url: string; valid: string[]; invalid: Invalid[]; noInvalid?: string; invisibleAllowed?: string; invisibleAccepted?: { chars: string[]; reason: string } }
type Provider = 'azure' | 'aws' | 'gcp';
const HAND = JSON.parse(readFileSync(join(import.meta.dirname, '__fixtures__', 'intake-hand-cases.json'), 'utf-8')) as Record<Provider, Record<string, Entry>>;

/** 손 예 열쇠 → 그 열쇠를 쓰는 들인 행 id */
const ROWS: Record<Provider, Map<string, string[]>> = { azure: new Map(), aws: new Map(), gcp: new Map() };
const add = (p: Provider, k: string, id: string) => ROWS[p].set(k, [...(ROWS[p].get(k) ?? []), id]);
for (const r of AZURE_INTAKE_ROWS) add('azure', AZURE_INTAKE_CHARS[r.chars].raw, r.id);
for (const r of AWS_INTAKE_ROWS) add('aws', r.kind === 'a' ? r.schemaPattern : `tag:${r.tag}`, r.id);
for (const r of GCP_INTAKE_ROWS) add('gcp', r.pattern, r.id);

const FILL = 'a';
/** '~' 를 채움 글자로 늘려 길이 n 을 만든다 — 줄이지 않는다(핵심 길이가 상한을 넘으면 시험이 실패한다) */
function fit(core: string, n: number): string {
  const parts = core.split('~');
  if (parts.length !== 2) throw new Error(`'~' 가 하나가 아니다: ${JSON.stringify(core)}`);
  const pad = n - (parts[0]!.length + parts[1]!.length);
  if (pad < 0) throw new Error(`핵심 ${JSON.stringify(core)} 가 길이 ${n} 보다 길다`);
  return parts[0] + FILL.repeat(pad) + parts[1];
}
const coreLen = (core: string) => core.length - 1;
const LEN_CODES = new Set(['name.too_short', 'name.too_long', 'name.empty']);

/** invisible-chars.test.ts 와 같은 대표 — RLO · 폭 없는 공백 · DEL · C1 NEL · 아랍 글자 표시 · 방향 격리 · 단어 결합 · BOM · 줄 구분 */
const INVISIBLE = ['\u202E', '\u200B', '\u007F', '\u0085', '\u061C', '\u2066', '\u2060', '\uFEFF', '\u2028'];

const PROVIDERS: Provider[] = ['azure', 'aws', 'gcp'];
const rule = (id: string): ResourceRule => {
  const r = RULES[id];
  if (!r) throw new Error(`규칙 없음: ${id}`);
  return r;
};

describe('손 예 — 빠짐 · 남음', () => {
  it('열쇠 수 — Azure 문장 86 · AWS 패턴 19 + 태그 둘 · GCP 패턴 2', () => {
    expect([ROWS.azure.size, ROWS.aws.size, ROWS.gcp.size]).toEqual([86, 21, 2]);
  });
  it.each(PROVIDERS)('%s — 행이 쓰는 문장 · 패턴마다 손 예가 있고, 손 예에 쓰이지 않는 열쇠가 없다', (p) => {
    expect([...ROWS[p].keys()].filter((k) => !(k in HAND[p])), '손 예가 없는 문장 · 패턴').toEqual([]);
    expect(Object.keys(HAND[p]).filter((k) => !ROWS[p].has(k)), '어느 행도 쓰지 않는 손 예').toEqual([]);
  });
  it('Azure 손 예의 열쇠는 원문 Valid Characters 칸의 문장 그대로이고 source 와 같다 — 문장이 둘 이상의 C 번호에 겹치지 않는다', () => {
    const raws = Object.values(AZURE_INTAKE_CHARS).map((c) => c.raw);
    expect(new Set(raws).size, '같은 문장이 두 C 번호에 있다 — 문장으로 짝지을 수 없다').toBe(raws.length);
    for (const [k, e] of Object.entries(HAND.azure)) {
      expect(raws, k).toContain(k);
      expect(e.source, k).toBe(k);
    }
  });
  it.each(PROVIDERS)('%s — 통과 예 하나 이상 · 실패 예 하나 이상(없으면 원문 근거) · 출처 URL', (p) => {
    for (const [k, e] of Object.entries(HAND[p])) {
      expect(e.valid.length, k).toBeGreaterThan(0);
      if (e.invalid.length === 0) expect(e.noInvalid, k).toBeTruthy();
      expect(e.url, k).toMatch(/^https:\/\//);
      expect(e.source, k).toBeTruthy();
      if (e.invisibleAccepted) expect(e.invisibleAccepted.reason, k).toBeTruthy();
    }
  });
});

for (const p of PROVIDERS) {
  describe(`손 예를 행마다 적용한다 — ${p}`, () => {
    const cases = [...ROWS[p].entries()].flatMap(([k, ids]) => ids.map((id) => [id, k] as const));
    it.each(cases)('%s', (id, k) => {
      const e = HAND[p][k]!;
      const r = rule(id);
      for (const core of e.valid) {
        expect(coreLen(core), `${id} 통과 핵심 ${JSON.stringify(core)} 가 상한 ${r.maxLength} 을 넘는다`).toBeLessThanOrEqual(r.maxLength);
        for (const n of new Set([Math.max(r.minLength, coreLen(core)), r.maxLength])) {
          const name = fit(core, n);
          expect(checkName(name, r), `${id} valid ${JSON.stringify(name)}`).toEqual([]);
        }
      }
      for (const inv of e.invalid) {
        const core = typeof inv === 'string' ? inv : inv.name;
        expect(coreLen(core), `${id} 실패 핵심 ${JSON.stringify(core)} 가 상한 ${r.maxLength} 을 넘는다`).toBeLessThanOrEqual(r.maxLength);
        for (const n of new Set([Math.max(r.minLength, coreLen(core)), r.maxLength])) {
          const name = fit(core, n);
          const v = checkName(name, r);
          expect(v.length, `${id} invalid ${JSON.stringify(name)}`).toBeGreaterThan(0);
          // 길이 위반으로 걸린 것은 문자 규칙을 검사하지 못한 것이다
          expect(v.filter((m) => LEN_CODES.has(m.code)), `${id} invalid ${JSON.stringify(name)} 가 길이로 걸렸다`).toEqual([]);
          // checkName 은 첫 · 끝 글자 표지가 걸리면 pattern 을 건너뛴다 — 표지와 pattern 이 같은 spec 에서 나오므로 pattern 도 직접 본다
          if (typeof inv === 'string') expect(r.pattern.test(name), `${id} pattern 이 ${JSON.stringify(name)} 를 받는다`).toBe(false);
        }
      }
      if (!e.invisibleAllowed) {
        const core = e.valid[0]!;
        const base = fit(core, Math.max(r.minLength - 1, coreLen(core), 1));
        for (const ch of INVISIBLE.filter((c) => !e.invisibleAccepted?.chars.includes(c))) {
          const name = base[0] + ch + base.slice(1);
          if (name.length > r.maxLength) continue;
          expect(checkName(name, r).length, `${id} 보이지 않는 문자 ${JSON.stringify(name)}`).toBeGreaterThan(0);
          expect(r.pattern.test(name), `${id} pattern 이 보이지 않는 문자 ${JSON.stringify(name)} 를 받는다`).toBe(false);
        }
      }
    });
  });
}

describe('손 예가 닿은 행 수', () => {
  it('들인 행 전부(Azure 332 · AWS 116 · GCP 82)', () => {
    expect([AZURE_INTAKE_ROWS.length, AWS_INTAKE_ROWS.length, GCP_INTAKE_ROWS.length]).toEqual([332, 116, 82]);
    const reached = PROVIDERS.reduce((n, p) => n + [...ROWS[p].values()].reduce((m, ids) => m + ids.length, 0), 0);
    expect(reached).toBe(332 + 116 + 82);
  });
});
