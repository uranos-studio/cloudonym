import { describe, it, expect } from 'vitest';
import { conflictKey, findConflicts, NAME_COMPARISON } from './conflict';
import { attachName, generateMany, generateProject, parseContext } from './engine';
import { WIZARD_PROJECT } from './__fixtures__/project';
import { getRule, rulesFor } from './constraints';
import { inputKind } from './tree';
import { PROVIDERS, type NameResult, type ResourceRule } from './types';
import { CONFLICT_CONTEXT, CONFLICT_RULE_A, CONFLICT_RULE_B } from './__fixtures__/conflict';

const ok = (name: string): NameResult => ({
  ruleId: 'x', resourceType: 'x', displayName: 'x', name, valid: true, isTruncated: false, isTransformed: false, original: name,
  violations: [], steps: [], rule: { minLength: 1, maxLength: 64, pattern: '.*', patternFlags: '', allowed: 'alnum-hyphen', docUrl: 'https://example.com', notes: [] },
});

describe('conflictKey · NAME_COMPARISON', () => {
  it('Azure · AWS 는 대소문자 없이, GCP 는 그대로 비교한다', () => {
    expect(NAME_COMPARISON).toEqual({ azure: 'case-insensitive', aws: 'case-insensitive', gcp: 'exact' });
    const az = getRule('azure', 'virtual_machine')!;
    expect(conflictKey(az, 'Vm-A')).toBe(conflictKey(az, 'vm-a'));
    const gcp = getRule('gcp', 'compute_instance')!;
    expect(conflictKey(gcp, 'Vm-A')).not.toBe(conflictKey(gcp, 'vm-a'));
  });
  it('키는 provider · entity · 비교용 이름 — resourceType 이 달라도 entity 가 같으면 같은 키', () => {
    const lin = getRule('azure', 'virtual_machine')!;
    const win = getRule('azure', 'virtual_machine_windows')!;
    expect(conflictKey(lin, 'abc')).toBe(conflictKey(win, 'abc'));
    expect(conflictKey(lin, 'abc')).not.toBe(conflictKey(getRule('azure', 'virtual_network')!, 'abc'));
  });
});

describe('findConflicts — 검사기를 먼저 시험한다', () => {
  it('같은 entity 의 같은 이름 둘은 충돌 하나 — keys 에 둘', () => {
    const out = findConflicts([
      { key: 'a', rule: CONFLICT_RULE_A, result: ok('vm-x') },
      { key: 'b', rule: CONFLICT_RULE_B, result: ok('vm-x') },
    ]);
    expect(out).toEqual([{ code: 'name.conflict', params: { name: 'vm-x', keys: ['a', 'b'] } }]);
  });
  it('Azure 는 대소문자만 다른 이름도 충돌이다', () => {
    const out = findConflicts([
      { key: 'a', rule: CONFLICT_RULE_A, result: ok('VM-X') },
      { key: 'b', rule: CONFLICT_RULE_B, result: ok('vm-x') },
    ]);
    expect(out).toHaveLength(1);
  });
  it('셋이 겹치면 한 메시지에 셋', () => {
    const c: ResourceRule = { ...CONFLICT_RULE_A, id: 'azure.test_conflict_c', resourceType: 'test_conflict_c' };
    const out = findConflicts([
      { key: 'a', rule: CONFLICT_RULE_A, result: ok('n') },
      { key: 'b', rule: CONFLICT_RULE_B, result: ok('n') },
      { key: 'c', rule: c, result: ok('n') },
    ]);
    expect(out).toEqual([{ code: 'name.conflict', params: { name: 'n', keys: ['a', 'b', 'c'] } }]);
  });
  it('valid:false 항목(빈 이름 · FAIL)은 검사에서 뺀다', () => {
    const out = findConflicts([
      { key: 'a', rule: CONFLICT_RULE_A, result: { ...ok(''), valid: false } },
      { key: 'b', rule: CONFLICT_RULE_B, result: { ...ok(''), valid: false } },
      { key: 'c', rule: CONFLICT_RULE_A, result: { ...ok('n'), valid: false } },
      { key: 'd', rule: CONFLICT_RULE_B, result: ok('n') },
    ]);
    expect(out).toEqual([]);
  });
  it('entity 가 다르면 같은 이름이어도 충돌이 아니다', () => {
    const out = findConflicts([
      { key: 'a', rule: getRule('azure', 'virtual_machine')!, result: ok('n') },
      { key: 'b', rule: getRule('azure', 'virtual_network')!, result: ok('n') },
    ]);
    expect(out).toEqual([]);
  });
  it('fixture 규칙 둘을 엔진에 넣으면 실제로 잡힌다', () => {
    const r = generateMany(CONFLICT_CONTEXT, 'azure', [{ rule: CONFLICT_RULE_A, count: 1 }, { rule: CONFLICT_RULE_B, count: 1 }]);
    expect(r.conflicts).toHaveLength(1);
  });
});

describe('실제 데이터 — 공허한 통과가 아니라는 대조', () => {
  // env dev — prod(4자)면 Windows VM(15자)이 축소에 실패해(D48) 「둘 다 유효한데 이름이 다르다」를 볼 수 없다
  const base = parseContext({ owner: 'platform', system: 'billing', purpose: 'trade', env: 'dev', region: 'koreacentral' }, 'azure');
  if (!base.ok) throw new Error('base context');
  it('Linux VM + Windows VM 은 같은 entity 지만 이름이 달라 충돌 0', () => {
    const lin = getRule('azure', 'virtual_machine')!;
    const win = getRule('azure', 'virtual_machine_windows')!;
    expect(lin.entity).toBe(win.entity);
    const r = generateMany(base.context, 'azure', [{ rule: lin, count: 1 }, { rule: win, count: 1 }]);
    expect(r.items.map((i) => i.name)).toEqual(['billing-trade-dev-krc-vm-01', 'bi-tr-dev-vm-01']);
    expect(r.conflicts).toEqual([]);
    expect(r.valid).toBe(true);
  });
  it('seq 는 보호 토큰이라 같은 규칙 안에서 축소가 이름을 접지 않는다 — count 규칙 전부 · 긴 문맥 · count 3', () => {
    // GCP 는 존 이름을 넣어도 리전 코드로 풀린다 — 옛 존 규칙도 리전 코드로 이름이 나온다 (D50 revised)
    const region = { gcp: 'asia-northeast3-a', aws: 'global', azure: 'global' } as const;
    let checked = 0;
    for (const p of PROVIDERS) {
      const long = parseContext({ owner: 'platformengineering', system: 'paymentsettlement', purpose: 'reconciliation', env: 'dev', region: region[p] }, p);
      if (!long.ok) throw new Error('long context');
      for (const rule of rulesFor(p).filter((r) => inputKind(r) === 'count')) {
        const r = generateMany(long.context, p, [{ rule, count: 3 }]);
        const names = r.items.filter((i) => i.valid).map((i) => i.name);
        checked += names.length;
        expect(new Set(names).size, rule.id).toBe(names.length);
        expect(r.conflicts, rule.id).toEqual([]);
      }
    }
    expect(checked).toBeGreaterThan(0);   // 전부 FAIL 이라 공허하게 통과하지 않는다
  });
});

describe('딸린 것의 충돌 (D62 · D69)', () => {
  const vm = getRule('gcp', 'compute_instance')!;
  const sel = (instances: { seq: string; attach?: { data?: string[] } }[]) =>
    ({ project: WIZARD_PROJECT, projectItems: [], services: [{ purpose: 'shop', items: [{ rule: vm, count: instances.length, instances }] }] });

  it('…-gce-01-data-01 과 …-gce-02-data-01 — 같은 entity 이지만 글자가 달라 충돌 0', () => {
    const out = generateProject(sel([{ seq: '01', attach: { data: ['01'] } }, { seq: '02', attach: { data: ['01'] } }]), 'gcp');
    const disks = out.items.filter((i) => i.attach === 'data');
    expect(disks.map((d) => d.name)).toEqual(['billing-shop-prod-ane3-gce-01-data-01', 'billing-shop-prod-ane3-gce-02-data-01']);
    expect(out.conflicts).toEqual([]);
    expect(out.valid).toBe(true);
  });
  it('시험 전용 — 같은 부모에 같은 접미 둘을 넣으면 name.conflict (검사기 자체)', () => {
    const parent = generateProject(sel([{ seq: '01' }]), 'gcp').items[1]!;
    const disk = getRule('gcp', 'disk')!;
    const a = attachName(parent, { attach: 'data', seq: '01' });
    const b = { ...attachName(parent, { attach: 'data', seq: '01' }), key: `${a.key}#copy` };
    expect(findConflicts([{ key: a.key, rule: disk, result: a }, { key: b.key, rule: disk, result: b }]))
      .toEqual([{ code: 'name.conflict', params: { name: a.name, keys: [a.key, b.key] } }]);
  });
});
