// 카드 (6-4) — 제목에 종류 토큰 · 무효(FAIL) 카드의 복사 버튼은 꺼져 있다. 브라우저 없이 정적 마크업으로 본다
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResultCard } from './ResultCard';
import { generate, generateMany, type NameItem } from '../core/engine';
import { getRule } from '../core/constraints';
import type { NameResult } from '../core/types';

const ctx = { owner: 'platform', system: 'payments', purpose: 'ledger', env: 'prod', region: 'ane3', zone: 'ane3a' } as const;
const html = (r: NameResult | NameItem) => renderToStaticMarkup(createElement(ResultCard, { result: r }));
const title = (markup: string) => /<h4[^>]*>([^<]*)<\/h4>/.exec(markup)?.[1];
/** 이름 복사 버튼(data-copy="name:…")이 disabled 인가 */
const copyDisabled = (markup: string) => {
  const tag = /<button[^>]*data-copy="name:[^"]*"[^>]*>/.exec(markup)?.[0];
  if (!tag) throw new Error('no copy button');
  return /\sdisabled=""/.test(tag);
};

describe('ResultCard — 제목 · 복사', () => {
  it('종류 토큰이 붙으면 제목은 「이름 · 토큰 · 순번」 · 없으면 「이름 · 순번」', () => {
    const many = generateMany(ctx, 'gcp', [
      { rule: getRule('gcp', 'address')!, count: 1, kind: 'INTERNAL' },
      { rule: getRule('gcp', 'address')!, count: 1 },
    ]);
    const [kinded, plain] = many.items;
    expect(kinded!.kindToken).toBe('int');
    expect(title(html(kinded!))).toBe('IP Address · int · 01');
    expect(title(html(plain!))).toBe('IP Address · 01');
  });
  it('기본값을 고른 항목(kind 만 있고 kindToken 없음)은 제목에 종류가 없다', () => {
    const it0 = generateMany(ctx, 'gcp', [{ rule: getRule('gcp', 'cloud_sql_instance')!, count: 1, kind: 'MYSQL' }]).items[0]!;
    expect(title(html(it0))).toBe('Cloud SQL Instance · 01');
  });
  it('제목 이름은 catalog 행 이름(트리 행과 같다) — 규칙 이름과 달라도 · 복사 버튼 이름도 같다 · catalog 없는 AWS · Azure 는 규칙 이름', () => {
    const vm = generateMany(ctx, 'gcp', [{ rule: getRule('gcp', 'compute_instance')!, count: 1 }]).items[0]!;
    expect(vm.displayName).not.toBe('VM Instance'); // 검사기 — 규칙 이름이 다르다
    const m = html(vm);
    expect(title(m)).toBe('VM Instance · 01');
    expect(m).toContain('aria-label="Copy VM Instance · 01 name"');
    for (const p of ['aws', 'azure'] as const) {
      const r = Object.values(generate({ ...ctx, region: p === 'aws' ? 'apne2' : 'krc', zone: undefined }, [p])[p]!)[0]!;
      expect(title(html(r)), p).toBe(r.displayName);
    }
  });
  it('유효한 카드는 복사할 수 있고, name.kind_required FAIL 카드는 이름이 있어도 복사 버튼이 꺼져 있다', () => {
    const ok = generateMany(ctx, 'gcp', [{ rule: getRule('gcp', 'resource_policy')!, count: 1, kind: 'snapshot-schedule' }]).items[0]!;
    expect(ok.valid).toBe(true);
    expect(copyDisabled(html(ok))).toBe(false);
    const rp = generate(ctx, ['gcp']).gcp!.resource_policy!;
    expect(rp.valid).toBe(false);
    expect(rp.name).not.toBe('');
    expect(rp.violations.map((v) => v.code)).toEqual(['name.kind_required']);
    expect(copyDisabled(html(rp))).toBe(true);
  });
  it('valid:false 면 위반 코드가 무엇이든 복사 버튼이 꺼져 있다 — 전체 카탈로그의 FAIL 전부', () => {
    const { zone: _zone, ...regionOnly } = ctx;
    const all = Object.values(generate(regionOnly, ['gcp']).gcp!);
    const failed = all.filter((r) => !r.valid);
    expect(failed.length).toBeGreaterThan(1);
    for (const r of failed) expect(copyDisabled(html(r)), r.ruleId).toBe(true);
    for (const r of all.filter((x) => x.valid).slice(0, 5)) expect(copyDisabled(html(r)), r.ruleId).toBe(false);
  });
});
