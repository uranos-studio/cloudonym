// 이름 내보내기 (D41) — 무효는 names 에 넣지 않는다. 충돌 항목도 무효다
import { describe, it, expect } from 'vitest';
import { allNamesText, toNamesExport } from './namesExport';
import { generateMany } from '../core/engine';
import { validateSelection } from '../core/selection';
import { CONFLICT_CONTEXT, CONFLICT_SELECTION } from '../core/__fixtures__/conflict';
import type { NamingContext } from '../core/types';

const ctx: NamingContext = { owner: 'platform', system: 'billing', purpose: 'trade', env: 'prod', region: 'krc' };
const VERSION = { engine: '9.9.9', rules: '2000-01-01.1' };
const pick = (r: unknown[]) => {
  const res = validateSelection('azure', r);
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  return res.items;
};

describe('toNamesExport', () => {
  it('{ version, provider, context, names, invalid } — 항목마다 key · resource_type · seq/role · scope · name', () => {
    const sel = pick([{ type: 'virtual_machine', count: 2 }, { type: 'managed_identity', role: 'db' }, { type: 'resource_group' }]);
    const out = toNamesExport(generateMany(ctx, 'azure', sel), ctx, VERSION, sel);
    expect(Object.keys(out)).toEqual(['version', 'provider', 'context', 'names', 'invalid']);
    expect(out.provider).toBe('azure');
    expect(out.context).toEqual(ctx);
    expect(out.names).toEqual([
      { key: 'virtual_machine_01', resource_type: 'virtual_machine', seq: '01', scope: 'azure:resource_group', name: 'billing-trade-prod-krc-vm-01' },
      { key: 'virtual_machine_02', resource_type: 'virtual_machine', seq: '02', scope: 'azure:resource_group', name: 'billing-trade-prod-krc-vm-02' },
      { key: 'managed_identity_db', resource_type: 'managed_identity', role: 'db', scope: 'azure:resource_group', name: 'billing-trade-prod-id-db' },
      { key: 'resource_group', resource_type: 'resource_group', scope: 'azure:subscription', name: 'rg-billing-trade-prod' },
    ]);
    expect(out.invalid).toEqual([]);
  });
  it('무효는 names 밖 · invalid 에 key 와 코드', () => {
    const bad = { ...ctx, system: '###' };
    const sel = pick([{ type: 'virtual_machine' }, { type: 'storage_account' }]);
    const out = toNamesExport(generateMany(bad, 'azure', sel), bad, VERSION, sel);
    expect(out.names.map((n) => n.key)).not.toContain('virtual_machine_01');
    expect(out.invalid.find((i) => i.key === 'virtual_machine_01')?.codes).toEqual(['name.token_empty']);
  });
  it('충돌 fixture 의 두 이름은 names 에 없다 — 둘 다 invalid 에 name.conflict', () => {
    const many = generateMany(CONFLICT_CONTEXT, 'azure', CONFLICT_SELECTION);
    const out = toNamesExport(many, CONFLICT_CONTEXT, VERSION, CONFLICT_SELECTION);
    expect(out.names).toEqual([]);
    expect(out.invalid.map((i) => [i.key, i.codes])).toEqual([['test_conflict_a_01', ['name.conflict']], ['test_conflict_b_01', ['name.conflict']]]);
  });
});

describe('toNamesExport — 종류 (D52)', () => {
  const g: NamingContext = { owner: 'platform', system: 'payments', purpose: 'ledger', env: 'prod', region: 'ane3' };
  const gpick = (r: unknown[]) => {
    const res = validateSelection('gcp', r);
    if (!res.ok) throw new Error(JSON.stringify(res.errors));
    return res.items;
  };
  it('고른 종류는 항목에 kind(값 이름) · 고르지 않은 항목에는 키가 없다 · key 는 type_seq 그대로', () => {
    const sel = gpick([{ type: 'cloud_sql_instance', count: 2, kind: 'POSTGRES' }, { type: 'subnet' }]);
    const out = toNamesExport(generateMany(g, 'gcp', sel), g, VERSION, sel);
    expect(out.names.map((n) => [n.key, n.name, n.kind ?? null])).toEqual([
      ['cloud_sql_instance_01', 'payments-ledger-prod-ane3-sql-pg-01', 'POSTGRES'],
      ['cloud_sql_instance_02', 'payments-ledger-prod-ane3-sql-pg-02', 'POSTGRES'],
      ['subnet_01', 'payments-ledger-prod-ane3-snet-01', null],
    ]);
    expect(Object.keys(out.names[0]!)).toEqual(['key', 'resource_type', 'seq', 'kind', 'scope', 'name']);
    expect(out.names[2]).not.toHaveProperty('kind');
  });
});

describe('allNamesText — 유효한 이름만 한 줄에 하나 · 건너뛴 수', () => {
  it('유효만 · 줄바꿈으로', () => {
    const sel = pick([{ type: 'virtual_machine', count: 2 }]);
    expect(allNamesText(generateMany(ctx, 'azure', sel))).toEqual({ text: 'billing-trade-prod-krc-vm-01\nbilling-trade-prod-krc-vm-02', skipped: 0 });
  });
  it('충돌 fixture — 둘 다 건너뛴다', () => {
    expect(allNamesText(generateMany(CONFLICT_CONTEXT, 'azure', CONFLICT_SELECTION))).toEqual({ text: '', skipped: 2 });
  });
});
