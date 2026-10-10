// /docs/naming 모델 (D57) — 절 아홉 · PASS 문장은 사전 그대로 · 표의 행 수가 손이 아니라 넣은 데이터에서 온다(크기가 다른 두 입력) · 모델 문자열 한글 0
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { catalogFor } from '../core/catalog';
import { REGIONS } from '../core/regions-data';
import { buildTree } from '../core/tree';
import { ENV_VALUES, generateMany, parseContext } from '../core/engine';
import { PROTECTED, type ResourceRule } from '../core/types';
import { en } from '../messages/en';
import { VERSION } from '../version';
import { treeRules } from './selection';
import { ABBR_PRINCIPLES, NAMING_DOC_SECTIONS, namingDocModel, zoneCodeMismatches, type NamingDocInput, type NamingDocModel } from './namingDocModel';
import { NamingDoc } from './NamingDoc';

const HANGUL = /\p{Script=Hangul}/u;

const real: NamingDocInput = {
  provider: 'gcp', catalog: catalogFor('gcp'), regions: REGIONS.gcp, rules: treeRules(buildTree('gcp')), messages: en, version: VERSION,
};
/** 작은 입력 — catalog 3행(종류 표가 있는 subnet 하나 포함) · 리전 2개 · 그 행들의 규칙 */
const FIXTURE_KEYS = ['gcp.project_id', 'gcp.service_account', 'gcp.subnet'];
const fixtureRows = real.catalog.filter((r) => FIXTURE_KEYS.includes(r.key));
const fixtureRuleIds = new Set(fixtureRows.flatMap((r) => Object.keys(r.rules)));
const fixture: NamingDocInput = {
  ...real, catalog: fixtureRows, regions: REGIONS.gcp.slice(0, 2), rules: real.rules.filter((r) => fixtureRuleIds.has(r.id)),
};

const section = (m: NamingDocModel, id: string) => m.sections.find((s) => s.id === id)!;
const rowsOf = (m: NamingDocModel, id: string) => section(m, id).table?.rows ?? [];

/** 모델 안의 문자열 전부 */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

describe('namingDocModel', () => {
  const model = namingDocModel(real);

  it('절 아홉 — 이름 공식 · 토큰 · 지역 코드 · 존 · 환경 값 · 축소 · 약어 · 종류 토큰 · PASS 의 뜻, 이 순서', () => {
    expect(NAMING_DOC_SECTIONS).toEqual(['formula', 'tokens', 'regions', 'zones', 'env', 'shrink', 'abbreviations', 'kinds', 'pass']);
    expect(model.sections.map((s) => s.id)).toEqual([...NAMING_DOC_SECTIONS]);
    for (const s of model.sections) expect(s.title.length, s.id).toBeGreaterThan(0);
  });

  it('PASS 의 뜻은 사전의 pass_meaning 그대로다', () => {
    expect(section(model, 'pass').paragraphs).toEqual([en.ui.pass_meaning]);
  });

  it('실제 데이터 — 약어 100행 · 리전 43행 · 종류 토큰 19행 · 환경 값 넷 · 토큰 아홉', () => {
    expect(rowsOf(model, 'abbreviations')).toHaveLength(100);
    expect(rowsOf(model, 'regions')).toHaveLength(43);
    expect(rowsOf(model, 'kinds')).toHaveLength(19);
    expect(rowsOf(model, 'env').map((r) => r.cells[0])).toEqual([...ENV_VALUES]);
    expect(rowsOf(model, 'tokens').map((r) => r.cells[0])).toEqual(['owner', 'system', 'purpose', 'env', 'region', 'slug', 'kind', 'seq', 'role']);
    expect(model.intro).toContain(VERSION.rules);
  });

  it('숫자가 데이터를 따른다 — 같은 함수에 catalog 3행 · 리전 2개를 넣으면 표가 3 · 2 · 종류 1행이다', () => {
    const small = namingDocModel(fixture);
    expect(rowsOf(small, 'abbreviations').map((r) => r.key)).toEqual(FIXTURE_KEYS);
    expect(rowsOf(small, 'regions')).toHaveLength(2);
    expect(rowsOf(small, 'kinds').map((r) => r.key)).toEqual(['gcp.subnet']);
    expect(section(small, 'regions').table!.caption).toContain('2');
    expect(section(model, 'regions').table!.caption).toContain('43');
    // 공식 표의 규칙 수 합 = 넣은 규칙 수
    const sum = (m: NamingDocModel) => rowsOf(m, 'formula').reduce((n, r) => n + Number(r.cells.at(-1)), 0);
    expect(sum(small)).toBe(fixture.rules.length);
    expect(sum(model)).toBe(real.rules.length);
  });

  it('약어 표 — 행마다 약어(없으면 —)와 근거 · 종류 표 — 값 → 토큰과 CSP 기본값', () => {
    const abbr = rowsOf(model, 'abbreviations');
    const project = abbr.find((r) => r.key === 'gcp.project_id')!;
    expect(project.cells[1]).toBe('—');
    for (const r of abbr) expect(r.cells[2]!.length, r.key).toBeGreaterThan(0);
    const sa = abbr.find((r) => r.key === 'gcp.service_account')!;
    expect(sa.cells[1]).toBe('sa');
    const sql = rowsOf(model, 'kinds').find((r) => r.key === 'gcp.cloud_sql_instance')!;
    expect(sql.cells.join(' | ')).toContain('POSTGRES → pg');
    expect(sql.cells[3]).toBe('MYSQL');
    const hc = rowsOf(model, 'kinds').find((r) => r.key === 'gcp.health_check')!;
    expect(hc.cells[3]).toBe('—');   // 기본값 없음
    const neg = rowsOf(model, 'kinds').find((r) => r.key === 'gcp.network_endpoint_group')!;
    expect(neg.cells[3]).toContain('zone: GCE_VM_IP_PORT');   // 범위마다 기본값이 다르면 범위를 붙인다
  });

  it('약어 원칙 — catalog 근거가 가리키는 「principle N」의 N 이 모두 약어 절의 원칙 목록에 있다 (검사기 자체 시험 포함)', () => {
    const cited = (basis: string): number[] =>
      [...basis.matchAll(/principles? (\d+(?:\s*(?:,|and)\s*\d+)*)/gi)].flatMap((m) => m[1]!.split(/\s*(?:,|and)\s*/).map(Number));
    expect(cited('meaning (principle 1) before frequency; principles 1, 3 and 5')).toEqual([1, 1, 3, 5]);
    const abbr = section(model, 'abbreviations');
    expect(abbr.subheading).toBe('Abbreviation principles');
    expect(abbr.ordered).toBe(true);
    expect(abbr.items).toEqual(ABBR_PRINCIPLES.map((k) => en.ui[k]));
    const defined = new Set(abbr.items!.map((_, i) => i + 1));
    const all = real.catalog.flatMap((row) => cited(row.slug.basis).map((n) => ({ key: row.key, n })));
    expect(all.length).toBeGreaterThan(20);
    expect(all.filter(({ n }) => !defined.has(n))).toEqual([]);
    // 원칙 목록에 없는 번호는 잡는다
    expect(cited('principle 5').filter((n) => !defined.has(n))).toEqual([5]);
  });

  it('존 — 존 코드는 리전 코드 + 존 글자다(데이터로 확인) · 존 입력은 리전으로 풀린다고 말한다 · 존 리소스 목록은 없다 (D50 revised)', () => {
    expect(zoneCodeMismatches(REGIONS.gcp)).toEqual([]);
    // 검사기 자체 — 틀린 코드를 넣으면 잡는다
    const broken = [{ ...REGIONS.gcp[0]!, zones: [{ zone: `${REGIONS.gcp[0]!.region}-a`, code: 'zzz9a' }] }];
    expect(zoneCodeMismatches(broken)).toEqual(['zzz9a']);
    const zones = section(model, 'zones');
    expect(zones.items).toBeUndefined();
    expect(zones.paragraphs[0]).toMatch(/resolves to its region: names carry the region code, never a zone/);
  });

  it('축소 세 단계 — 순서 있는 세 항목', () => {
    expect(section(model, 'shrink').items).toHaveLength(3);
    expect(section(model, 'shrink').ordered).toBe(true);
  });

  it('모델 문자열에 한글이 없다 — catalog 데이터를 거쳐 온 문자열까지 (검사기 자체 시험 포함)', () => {
    expect(strings({ a: ['x', { b: String.fromCodePoint(0xd7a3) }] }).filter((s) => HANGUL.test(s))).toHaveLength(1);
    const all = strings(model);
    expect(all.length).toBeGreaterThan(500);
    expect(all.filter((s) => HANGUL.test(s))).toEqual([]);
  });
});

describe('페이지 문장이 엔진이 하는 일과 같다', () => {
  const model = namingDocModel(real);
  const ctxOf = (raw: Record<string, string>) => {
    const p = parseContext({ owner: 'platform', system: 'billing', purpose: 'trade', env: 'prod', region: 'asia-northeast3-a', ...raw }, 'gcp');
    if (!p.ok) throw new Error('context');
    return p.context;
  };
  const one = (rule: ResourceRule, raw: Record<string, string> = {}, count = 1) =>
    generateMany(ctxOf(raw), 'gcp', [{ rule, count, ...(rule.kinds?.rule === 'required' ? { kind: rule.kinds.allowed[0]! } : {}) }]).items;
  const sa = real.rules.find((r) => r.id === 'gcp.service_account')!;

  it('축소 1단계 — 규칙의 optional 순서로 뗀다(service_account 는 공식에서 뒤인 region 을 먼저) · 문장은 공식 순서라 하지 않는다', () => {
    expect(sa.template.indexOf('owner')).toBeLessThan(sa.template.indexOf('region'));
    expect(sa.optional[0]).toBe('region');
    const long = 'x'.repeat(20);
    const dropped = one(sa, { owner: long, system: long })[0]!.steps.filter((m) => m.code === 'step.token_dropped').map((m) => m.field);
    expect(dropped[0]).toBe('region');
    const step1 = section(model, 'shrink').items![0]!;
    expect(step1).toContain(en.ui.doc_col_optional);
    expect(step1).not.toMatch(/order the formula lists/);
    // 공식 표의 생략 칸은 규칙의 optional 순서 그대로다
    const row = rowsOf(model, 'formula').find((r) => r.cells[0] === `<${sa.template.join('>-<')}>`)!;
    expect(row.cells[1]).toBe(sa.optional.join(', '));
  });

  it('빈 토큰 — 필수 토큰이 비면 FAIL(name.token_empty) · 생략 토큰 · 종류만 건너뛴다고 말한다', () => {
    const items = one(sa, { system: '!!!' });
    expect(items[0]!.valid).toBe(false);
    expect(items[0]!.violations.map((v) => v.code)).toContain('name.token_empty');
    const body = section(model, 'formula').paragraphs[0]!;
    expect(body).toContain('fails');
    expect(body).not.toMatch(/A token with no value is skipped/);
  });

  it('global — 지역 토큰 없이 모든 규칙이 PASS (존 리소스도 · D50 revised) · 문장도 그렇게 말한다', () => {
    for (const r of real.rules) expect(one(r, { region: 'global' })[0]!.valid, r.id).toBe(true);
    expect(section(model, 'regions').paragraphs[0]).toMatch(/global puts no region token in any name\.$/);
    expect(section(model, 'regions').paragraphs[0]).not.toMatch(/zone-required/);
  });

  it('축소 2단계 — 보호 토큰은 줄이지 않되 1단계가 그 가운데 optional 은 뗄 수 있다고 말한다', () => {
    expect(real.rules.some((r) => r.optional.some((t) => PROTECTED.includes(t)))).toBe(true);
    const step2 = section(model, 'shrink').items![1]!;
    expect(step2).toContain('never shortened (step 1 may still drop the optional ones among them)');
    expect(step2).not.toMatch(/never cut/);
  });

  it('순번 — 문장의 자릿수 · 처음 값이 엔진이 만든 seq 와 같다', () => {
    const vm = real.rules.find((r) => r.id === 'gcp.compute_instance')!;
    const seqs = one(vm, {}, 2).map((i) => i.seq);
    const meaning = rowsOf(model, 'tokens').find((r) => r.key === 'seq')!.cells[1]!;
    expect(meaning).toContain(`zero-padded to ${seqs[0]!.length} digits`);
    expect(meaning).toContain(`from ${seqs[0]} to`);
  });
});

describe('/docs/naming 화면', () => {
  beforeAll(() => { vi.stubGlobal('window', { location: { hash: '' } }); });
  afterAll(() => { vi.unstubAllGlobals(); });

  it('표마다 caption · th scope=col · 가로 스크롤은 표 상자 안에서 · PASS 문장 그대로', () => {
    const html = renderToStaticMarkup(createElement(NamingDoc));
    expect(html).toContain('<h1');
    expect((html.match(/<table/g) ?? []).length).toBe((html.match(/<caption/g) ?? []).length);
    expect(html).toContain('scope="col"');
    expect((html.match(/<table/g) ?? []).length).toBe((html.match(/overflow-x-auto/g) ?? []).length);
    expect((html.match(/<tr data-row=/g) ?? []).length).toBeGreaterThan(160);
    for (const id of NAMING_DOC_SECTIONS) expect(html, id).toContain(`id="doc-${id}"`);
    const text = html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/\s+/g, ' ');
    expect(text).toContain(en.ui.pass_meaning);
    // 푸터 Privacy 링크 — 앱 푸터와 같은 꼴(상태 hash 가 없으면 경로만)
    expect(html).toMatch(/<a href="\/privacy" data-footer-privacy/);
  });
});
