import { describe, it, expect } from 'vitest';
import { MAX_COUNT, MAX_ITEMS, MAX_NAMES, validateSelection } from './selection';
import { rulesFor } from './constraints';
import { inputKind } from './tree';

const codes = (r: ReturnType<typeof validateSelection>) => (r.ok ? [] : r.errors.map((e) => e.code));
const AWS_COUNT_TYPES = rulesFor('aws').filter((r) => inputKind(r) === 'count').map((r) => r.resourceType);

/** aws count 규칙들에 total 을 99 씩 나눠 담는다 */
function spread(total: number) {
  const out: { type: string; count: number }[] = [];
  let left = total;
  for (const type of AWS_COUNT_TYPES) {
    if (left <= 0) break;
    const c = Math.min(MAX_COUNT, left);
    out.push({ type, count: c });
    left -= c;
  }
  if (left > 0) throw new Error('aws count 규칙이 모자란다');
  return out;
}

describe('validateSelection (D40)', () => {
  it('상수 셋', () => {
    expect([MAX_ITEMS, MAX_NAMES, MAX_COUNT]).toEqual([200, 200, 99]);
  });
  it('시험 전제 — aws 의 count 규칙만으로 Σ count 201 을 담을 수 있다', () => {
    expect(AWS_COUNT_TYPES.length * MAX_COUNT).toBeGreaterThanOrEqual(201);
  });

  it('정상 — 규칙 · 개수 · 역할을 돌려준다. count 기본 1 · role 없으면 undefined', () => {
    const r = validateSelection('gcp', [{ type: 'compute_instance', count: 2 }, { type: 'service_account', role: 'db' }, { type: 'project_id' }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items.map((i) => [i.rule.id, i.count, i.role])).toEqual([
      ['gcp.compute_instance', 2, undefined], ['gcp.service_account', 1, 'db'], ['gcp.project_id', 1, undefined],
    ]);
  });

  it('배열이 아니면 not_array · 빈 배열이면 empty', () => {
    expect(codes(validateSelection('aws', { type: 'vpc' }))).toEqual(['selection.not_array']);
    expect(codes(validateSelection('aws', null))).toEqual(['selection.not_array']);
    expect(codes(validateSelection('aws', []))).toEqual(['selection.empty']);
  });

  it('항목 199 · 200 은 항목 수로 막지 않고 201 은 too_many_items 하나만', () => {
    const items = (n: number) => Array.from({ length: n }, () => ({ type: 'vpc' }));
    expect(codes(validateSelection('aws', items(199)))).not.toContain('selection.too_many_items');
    expect(codes(validateSelection('aws', items(200)))).not.toContain('selection.too_many_items');
    expect(validateSelection('aws', items(201))).toEqual({ ok: false, errors: [{ code: 'selection.too_many_items', params: { max: 200 } }] });
  });

  it('Σ count 199 · 200 통과 · 201 은 too_many_names', () => {
    expect(validateSelection('aws', spread(199)).ok).toBe(true);
    expect(validateSelection('aws', spread(200)).ok).toBe(true);
    expect(validateSelection('aws', spread(201))).toEqual({ ok: false, errors: [{ code: 'selection.too_many_names', params: { max: 200, actual: 201 } }] });
  });

  it('count 는 정수 1~99 — 0 · 100 · 1.5 · 문자열 2 는 count_out_of_range', () => {
    for (const count of [0, 100, 1.5, '2', -1, null, Number.NaN]) {
      expect(validateSelection('aws', [{ type: 'vpc', count }]), String(count)).toEqual({ ok: false, errors: [{ code: 'selection.count_out_of_range', params: { index: 0, min: 1, max: 99 } }] });
    }
    expect(validateSelection('aws', [{ type: 'vpc', count: 99 }]).ok).toBe(true);
    expect(validateSelection('aws', [{ type: 'vpc', count: 1 }]).ok).toBe(true);
  });

  it('항목이 객체가 아니면 item_not_object · type 이 모르는 값이면 unknown_type', () => {
    const r = validateSelection('aws', ['vpc', { type: 'no_such' }, { type: 3 }, {}]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toEqual({ code: 'selection.item_not_object', params: { index: 0 } });
    expect(r.errors[1]).toMatchObject({ code: 'selection.unknown_type', params: { index: 1, value: 'no_such' } });
    expect(r.errors[1]!.code === 'selection.unknown_type' && r.errors[1]!.params.supported).toEqual(rulesFor('aws').map((x) => x.resourceType));
    expect(r.errors[2]).toMatchObject({ code: 'selection.unknown_type', params: { index: 2, value: '3' } });
    expect(r.errors[3]).toMatchObject({ code: 'selection.unknown_type', params: { index: 3, value: 'undefined' } });
    // 다른 provider 의 type 은 모른다
    expect(codes(validateSelection('aws', [{ type: 'compute_instance' }]))).toEqual(['selection.unknown_type']);
  });

  it('같은 type 두 번은 duplicate_type — 뒤의 것에', () => {
    expect(validateSelection('aws', [{ type: 'vpc' }, { type: 'subnet' }, { type: 'vpc' }])).toEqual({ ok: false, errors: [{ code: 'selection.duplicate_type', params: { index: 2, value: 'vpc' } }] });
  });

  it('seq 없는 규칙에 count 2 는 count_not_supported — count 1 은 된다', () => {
    expect(validateSelection('azure', [{ type: 'resource_group', count: 2 }])).toEqual({ ok: false, errors: [{ code: 'selection.count_not_supported', params: { index: 0, type: 'resource_group' } }] });
    expect(validateSelection('azure', [{ type: 'managed_identity', count: 2 }])).toEqual({ ok: false, errors: [{ code: 'selection.count_not_supported', params: { index: 0, type: 'managed_identity' } }] });
    expect(validateSelection('azure', [{ type: 'resource_group', count: 1 }]).ok).toBe(true);
  });

  it('role 규칙이 아닌 곳의 role 은 role_not_supported', () => {
    expect(validateSelection('aws', [{ type: 'vpc', role: 'db' }])).toEqual({ ok: false, errors: [{ code: 'selection.role_not_supported', params: { index: 0, type: 'vpc' } }] });
    expect(codes(validateSelection('aws', [{ type: 's3_bucket', role: 'db' }]))).toEqual(['selection.role_not_supported']);
  });

  it("role 꼴은 ^[a-z0-9]{2,16}$ — 'Sync' · 'a' · 17자 · 숫자는 invalid_role", () => {
    for (const role of ['Sync', 'a', 'a'.repeat(17), 'db-1', 12]) {
      expect(validateSelection('aws', [{ type: 'iam_role', role }]), String(role)).toEqual({ ok: false, errors: [{ code: 'selection.invalid_role', params: { index: 0, value: String(role), pattern: '^[a-z0-9]{2,16}$' } }] });
    }
    expect(validateSelection('aws', [{ type: 'iam_role', role: 'a'.repeat(16) }]).ok).toBe(true);
  });

  it('오류는 index 순으로 모두 낸다', () => {
    const r = validateSelection('aws', [{ type: 'vpc', count: 0 }, 7, { type: 'iam_role', role: 'X' }, { type: 's3_bucket', count: 2 }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => [e.code, 'params' in e ? (e.params as { index?: number }).index : undefined])).toEqual([
      ['selection.count_out_of_range', 0], ['selection.item_not_object', 1], ['selection.invalid_role', 2], ['selection.count_not_supported', 3],
    ]);
  });

  it('반환 items 는 입력 순서다', () => {
    const r = validateSelection('aws', [{ type: 'rds_instance' }, { type: 'vpc' }]);
    expect(r.ok && r.items.map((i) => i.rule.resourceType)).toEqual(['rds_instance', 'vpc']);
  });
});

describe('validateSelection — 던지지 않는다', () => {
  it('toString 이 호출 불가능한 type · role 객체도 오류 하나로 (String() 이 던지는 값)', () => {
    const evil = { toString: 1 };
    expect(codes(validateSelection('azure', [{ type: evil }]))).toEqual(['selection.unknown_type']);
    expect(codes(validateSelection('azure', [{ type: 'managed_identity', role: evil }]))).toEqual(['selection.invalid_role']);
  });
});
