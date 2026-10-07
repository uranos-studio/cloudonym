import { describe, it, expect } from 'vitest';
import { generate, generateMany, validateName, parseContext } from './engine';
import { getRule, rulesFor } from './constraints';
import { CONFLICT_CONTEXT, CONFLICT_SELECTION } from './__fixtures__/conflict';
const ctx = { owner: 'infra', system: 'billing', purpose: 'trade', env: 'prod', region: 'kr' } as const;

describe('generate', () => {
  it('① 응답 예시: GCP SA 는 축약, Azure Storage 는 변환(하이픈 제거)', () => {
    const out = generate(ctx, ['gcp', 'azure']);
    expect(out.gcp?.service_account).toMatchObject({ name: 'billing-trade-prod-sa-sync', valid: true, isTruncated: true, original: 'infra-billing-trade-prod-kr-sa-sync' });
    expect(out.azure?.storage_account).toMatchObject({ name: 'stbillingtradeprod', valid: true, isTransformed: true });
    expect(out.azure?.storage_account.steps).toContainEqual({ code: 'step.separator_removed' });
    expect(out.aws).toBeUndefined();
  });
  it('providers 를 안 주면 셋 다', () => expect(Object.keys(generate(ctx)).sort()).toEqual(['aws', 'azure', 'gcp']));
  it('TC-AZ-01 하이픈 든 system 도 Storage Account 에서는 지워진다', () => {
    const out = generate({ ...ctx, system: 'billing-trade' }, ['azure']);
    expect(out.azure?.storage_account).toMatchObject({ name: 'stbillingtradetradeprod', isTransformed: true });
  });
  it('정제 뒤 빈 필수 토큰은 valid:false 이고 이름을 만들지 않는다', () => {
    const out = generate({ ...ctx, system: '매매' }, ['azure']);
    expect(out.azure?.storage_account).toMatchObject({ valid: false, name: '', violations: [{ code: 'name.token_empty', field: 'system' }] });
  });
  it('정제로는 못 고치는 위반(숫자 시작)은 valid:false + 이유', () => {
    const vm = generate({ ...ctx, system: '3tier' }, ['gcp']).gcp!.compute_instance;
    expect(vm).toMatchObject({ valid: false, name: '3tier-trade-prod-kr-gce-01', violations: [{ code: 'name.first_not_letter' }] });
  });
  it('긴 owner 는 optional 생략으로 들어간다', () => {
    const p = generate({ ...ctx, owner: 'a'.repeat(40) }, ['gcp']).gcp!.project_id;   // owner 생략 → billing-trade-prod
    expect(p).toMatchObject({ valid: true, isTruncated: true, steps: [{ code: 'step.token_dropped', field: 'owner' }] });
  });
  it('축소가 실패하면 valid:false + 이유', () => {
    const w = generate({ ...ctx, system: 'a-long', purpose: 'longpurpose' }, ['azure']).azure!.virtual_machine_windows;
    expect(w).toMatchObject({ valid: false, violations: [{ code: 'name.cannot_fit', params: { max: 15 } }] });
  });
  it('rule 메타데이터에 물리 규칙과 생성 규칙이 둘 다 있다 (D14)', () => {
    const s3 = generate(ctx, ['aws']).aws!.s3_bucket;
    expect(s3.rule).toMatchObject({ maxLength: 63, allowed: 'lower-digit-hyphen', pattern: '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$' });
  });
  // GCP 에서 owner 가 든 규칙은 전부 owner 가 optional 이다
  it('한글 owner 는 정제 뒤 비어도 optional 이라 GCP 규칙 전부 유효 — 같은 이름인 함수 둘의 충돌만 남는다', () => {
    const out = generate({ ...ctx, owner: '홍길동' }, ['gcp']).gcp!;
    const fns = new Set(['cloud_function_gen1', 'cloud_function']);
    for (const r of rulesFor('gcp')) {
      if (fns.has(r.resourceType)) expect(out[r.resourceType]!.violations.map((v) => v.code), r.id).toEqual(['name.conflict']);
      else expect(out[r.resourceType], r.id).toMatchObject({ valid: true, violations: [] });
    }
    expect(out.project_id).toMatchObject({ name: 'billing-trade-prod', isTransformed: true });
    expect(out.project_id.steps).toContainEqual({ code: 'step.normalized', field: 'owner', params: { from: '홍길동', to: '' } });
  });
  it('한 글자 system 은 축소 대상이 아니다 — GCP compute_instance 유효', () => {
    expect(generate({ ...ctx, system: 'a' }, ['gcp']).gcp!.compute_instance).toMatchObject({ name: 'a-trade-prod-kr-gce-01', valid: true });
  });
});

describe('parseContext', () => {
  it('빈 purpose 는 막는다', () => {
    expect(parseContext({ ...ctx, purpose: ' ' })).toMatchObject({ ok: false, errors: [{ code: 'context.empty', field: 'purpose' }] });
  });
  it('TC-COM-02 env 별칭은 변환 기록과 함께 통과', () => {
    expect(parseContext({ ...ctx, env: 'production' })).toMatchObject({ ok: true, context: { env: 'prod' }, transformed: [{ code: 'context.normalized', field: 'env', params: { from: 'production', to: 'prod' } }] });
  });
  it('옛 표준값 prd 는 별칭이다 — prod 로 바꾸고 기록한다 (D48)', () => {
    expect(parseContext({ ...ctx, env: 'prd' })).toMatchObject({ ok: true, context: { env: 'prod' }, transformed: [{ code: 'context.normalized', field: 'env', params: { from: 'prd', to: 'prod' } }] });
  });
  it('prod 는 표준값이라 바꾼 기록이 없다 (D48)', () => {
    expect(parseContext({ ...ctx, env: 'prod' })).toMatchObject({ ok: true, context: { env: 'prod' }, transformed: [] });
  });
  it('모르는 env · 문자열 아닌 값', () => {
    expect(parseContext({ ...ctx, env: 'qa' })).toMatchObject({ ok: false, errors: [{ code: 'context.value_unsupported', field: 'env', params: { value: 'qa', supported: ['prod', 'stg', 'dev', 'sbx'] } }] });
    expect(parseContext({ ...ctx, owner: 3 })).toMatchObject({ ok: false });
  });
  it('모르는 region 문구와 필드 순서', () => {
    expect(parseContext({ ...ctx, region: 'mars', owner: '' })).toEqual({ ok: false, errors: [{ code: 'context.empty', field: 'owner' }, { code: 'context.value_unsupported', field: 'region', params: { value: 'mars', supported: ['kr', 'us', 'jp', 'eu', 'global'] } }] });
  });
});

describe('validateName', () => {
  it('이유와 제안을 준다 (앞 토큰부터 뗀다)', () => {
    expect(validateName('gcp', 'service_account', 'infra-billing-trade-prd-kr-sa-sync')).toEqual({ valid: false, violations: [{ code: 'name.too_long', params: { actual: 34, max: 30 } }], suggestedName: 'billing-trade-prd-kr-sa-sync' });
  });
  it('정제만으로 되면 그 값을 제안', () => {
    expect(validateName('azure', 'storage_account', 'st-web-prod')).toMatchObject({ valid: false, suggestedName: 'stwebprod' });
  });
  it('구분자 없는 규칙의 길이 초과는 제안하지 않는다', () => {
    expect(validateName('azure', 'storage_account', 'st' + 'a'.repeat(23)).suggestedName).toBeUndefined();
  });
  it('모르는 resource_type 은 violations 하나로 알린다', () => {
    expect(validateName('gcp', 'nope', 'x').violations[0]).toMatchObject({ code: 'rule.unknown_resource_type', params: { provider: 'gcp' } });
  });
  it('유효한 이름은 제안 없이 valid:true', () => {
    expect(validateName('gcp', 'service_account', 'billing-trade-prd-sa-sync')).toEqual({ valid: true, violations: [] });
  });
  it('⑵ 는 정제한 값을 쪼갠다', () => {
    // 대문자 · 밑줄이 섞인 긴 이름 — 정제 뒤 값에서 앞 토큰을 뗀다
    expect(validateName('gcp', 'service_account', 'InFra-Billing-trade-prd-kr-sa_sync').suggestedName).toBe('billing-trade-prd-kr-sasync');
  });
});

describe('2026-09-28 고침', () => {
  it('rule.patternFlags 를 함께 내보내 wire 쪽에서 같은 정규식을 다시 만들 수 있다', () => {
    const rg = generate(ctx, ['azure']).azure?.resource_group;
    expect(rg?.rule.patternFlags).toBe('u');
    const re = new RegExp(rg!.rule.pattern, rg!.rule.patternFlags);
    expect(re.test('개발-1')).toBe(true);
    expect(re.test(rg!.name)).toBe(true);
  });
  it('GCS 버킷은 연속 점(빈 구성요소)을 거부한다 · S3 도 거부한다', () => {
    expect(validateName('gcp', 'storage_bucket', 'a..b').valid).toBe(false);
    expect(validateName('gcp', 'storage_bucket', 'a.b').valid).toBe(true);
    expect(validateName('aws', 's3_bucket', 'a..b').valid).toBe(false);
  });
  it('리소스 그룹은 보조 평면 글자(U+10000 이상)를 거부하고 BMP 글자는 받는다', () => {
    expect(validateName('azure', 'resource_group', 'rg-𝔸').valid).toBe(false);
    expect(validateName('azure', 'resource_group', '𝔸').valid).toBe(false);
    expect(validateName('azure', 'resource_group', '개발').valid).toBe(true);
    expect(validateName('azure', 'resource_group', 'rg-개발-1').valid).toBe(true);
  });
  it('Azure VM(Linux · Windows)은 이름 어디에서도 점을 거부한다 — 문서 모순이라 보수적으로', () => {
    for (const t of ['virtual_machine', 'virtual_machine_windows']) {
      expect(validateName('azure', t, 'a.b').valid, `${t} a.b`).toBe(false);
      expect(validateName('azure', t, 'vm-web-01').valid, `${t} vm-web-01`).toBe(true);
    }
  });
  it('Windows VM 은 숫자로만 된 이름(12345)을 거부한다 — Linux VM 은 문서 근거가 없어 그대로 받는다', () => {
    expect(validateName('azure', 'virtual_machine_windows', '12345').valid).toBe(false);
    expect(validateName('azure', 'virtual_machine_windows', '1').valid).toBe(false);
    expect(validateName('azure', 'virtual_machine_windows', '123456789012345').valid).toBe(false);
    expect(validateName('azure', 'virtual_machine_windows', '1234a').valid).toBe(true);
    expect(validateName('azure', 'virtual_machine_windows', '12-34').valid).toBe(true);
    expect(validateName('azure', 'virtual_machine', '12345').valid).toBe(true);
  });
  it('숫자만 넣어도 generate 의 Windows VM 이름은 숫자만으로 되지 않는다 (slug vm 이 늘 든다)', () => {
    // env dev — prod(4자)면 12-34-prod-vm-01 이 16자라 축소에 실패한다(D48). 여기서 보는 것은 숫자만인 이름이 나오지 않는다는 것이다
    const w = generate({ owner: '1', system: '12', purpose: '34', env: 'dev', region: 'kr' }, ['azure']).azure!.virtual_machine_windows;
    expect(w.valid).toBe(true);
    expect(w.name).not.toMatch(/^\d+$/);
    expect(validateName('azure', 'virtual_machine_windows', w.name).valid).toBe(true);
  });
  it('Azure 예약어: system 이 windows 면 Storage Account 는 이름을 바꾸지 않고 valid:false', () => {
    const st = generate({ ...ctx, system: 'windows' }, ['azure']).azure!.storage_account;
    expect(st).toMatchObject({ valid: false, name: 'stwindowstradeprod', violations: [{ code: 'name.forbidden_substring', params: { value: 'windows' } }] });
  });
  it('Azure 예약어: /v1/validate 경로 — microsoft123 Storage Account 는 무효', () => {
    const r = validateName('azure', 'storage_account', 'microsoft123');
    expect(r.valid).toBe(false);
    expect(r.suggestedName ?? '').not.toMatch(/microsoft/);
    expect(validateName('azure', 'storage_account', 'stbilling01').valid).toBe(true);
  });
  it('결과의 rule.notes 를 고쳐도 규칙 표는 그대로다 — 참조가 아니라 사본', () => {
    const first = generate(ctx, ['gcp']).gcp!.cloud_sql_instance!;
    expect(first.rule.notes.length).toBeGreaterThan(0);
    first.rule.notes.push({ code: 'note.s3_an_suffix' });
    (first.rule.notes[0] as { code: string }).code = 'x.changed';
    expect(generate(ctx, ['gcp']).gcp!.cloud_sql_instance!.rule.notes).toEqual([{ code: 'note.cloud_sql_combined_limit' }]);
  });
});

describe('generateMany (D30\' · D41)', () => {
  const base = { owner: 'platform', system: 'billing', purpose: 'trade', env: 'prod', region: 'kr' } as const;
  const rule = (p: 'aws' | 'gcp' | 'azure', t: string) => getRule(p, t)!;

  it('항목 순서 = 선택 순서 → 순번 순서 · count 2 → 01 02', () => {
    const r = generateMany(base, 'azure', [
      { rule: rule('azure', 'subnet'), count: 2 },
      { rule: rule('azure', 'virtual_machine'), count: 2 },
    ]);
    expect(r.items.map((i) => i.key)).toEqual(['subnet_01', 'subnet_02', 'virtual_machine_01', 'virtual_machine_02']);
    expect(r.items.map((i) => i.seq)).toEqual(['01', '02', '01', '02']);
    expect(r.items[3]!.name).toBe('billing-trade-prod-kr-vm-02');
    expect(r).toMatchObject({ provider: 'azure', valid: true, conflicts: [] });
  });

  it('count 1 · 기본 role 은 generate 와 이름 · 판정이 같다 (호환)', () => {
    const all = generate(base, ['gcp']).gcp!;
    const r = generateMany(base, 'gcp', rulesFor('gcp').map((x) => ({ rule: x, count: 1 })));
    for (const it of r.items) expect({ name: it.name, valid: it.valid }, it.key).toEqual({ name: all[it.resourceType]!.name, valid: all[it.resourceType]!.valid });
  });

  it('key 꼴 셋 — count 규칙 type_seq · role 규칙 type_role(생략이면 sync) · 입력 없는 규칙 type', () => {
    const r = generateMany(base, 'gcp', [
      { rule: rule('gcp', 'compute_instance'), count: 1 },
      { rule: rule('gcp', 'service_account'), count: 1, role: 'db' },
      { rule: rule('gcp', 'project_id'), count: 1 },
    ]);
    expect(r.items.map((i) => [i.key, i.seq, i.role])).toEqual([
      ['compute_instance_01', '01', undefined], ['service_account_db', undefined, 'db'], ['project_id', undefined, undefined],
    ]);
    expect(r.items[1]!.name).toBe('billing-trade-prod-sa-db');
    const d = generateMany(base, 'gcp', [{ rule: rule('gcp', 'service_account'), count: 1 }]);
    expect(d.items.map((i) => [i.key, i.role, i.name])).toEqual([['service_account_sync', 'sync', 'billing-trade-prod-sa-sync']]);
  });

  it('순번은 두 자리 고정 — 9 → 09 · 99 → 99', () => {
    const r = generateMany(base, 'aws', [{ rule: rule('aws', 'vpc'), count: 99 }]);
    expect(r.items).toHaveLength(99);
    expect(r.items[8]!.seq).toBe('09');
    expect(r.items[98]!.seq).toBe('99');
    for (const it of r.items) expect(it.seq).toMatch(/^\d{2}$/);
  });

  it('입력 없는 · role 규칙은 count 와 무관하게 하나 (검증은 validateSelection 몫)', () => {
    const r = generateMany(base, 'azure', [{ rule: rule('azure', 'resource_group'), count: 3 }, { rule: rule('azure', 'managed_identity'), count: 3 }]);
    expect(r.items).toHaveLength(2);
  });

  it('FAIL 항목도 전부 돌려준다 — 축소 실패한 Windows VM 3개', () => {
    const r = generateMany({ ...base, system: 'a-long', purpose: 'longpurpose' }, 'azure', [{ rule: rule('azure', 'virtual_machine_windows'), count: 3 }]);
    expect(r.items).toHaveLength(3);
    expect(r.items.every((i) => !i.valid && i.violations[0]!.code === 'name.cannot_fit')).toBe(true);
    expect(r.valid).toBe(false);
    expect(r.conflicts).toEqual([]);
  });

  it('충돌 fixture — 두 항목 모두 valid:false + name.conflict · conflicts 한 건 · 전체 valid = 항목 전부 valid', () => {
    const r = generateMany(CONFLICT_CONTEXT, 'azure', CONFLICT_SELECTION);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]!.name).toBe(r.items[1]!.name);
    const msg = { code: 'name.conflict', params: { name: r.items[0]!.name, keys: ['test_conflict_a_01', 'test_conflict_b_01'] } };
    for (const it of r.items) {
      expect(it.valid).toBe(false);
      expect(it.violations).toEqual([msg]);
    }
    expect(r.conflicts).toEqual([msg]);
    expect(r.valid).toBe(false);
    expect(r.valid).toBe(r.items.every((i) => i.valid));
    // 항목 위반과 요약은 서로 다른 객체 — 한쪽을 고쳐도 다른 쪽이 바뀌지 않는다
    expect(r.items[0]!.violations[0]).not.toBe(r.conflicts[0]);
  });
});

describe('함수 1 · 2세대 — entity 가 같아 같은 이름이면 충돌이다 (D47)', () => {
  const keys = ['cloud_function_gen1', 'cloud_function'];
  it('generateMany 로 같이 고르면 둘 다 valid:false + name.conflict', () => {
    const r = generateMany(ctx, 'gcp', [{ rule: getRule('gcp', 'cloud_function_gen1')!, count: 1 }, { rule: getRule('gcp', 'cloud_function')!, count: 1 }]);
    expect(r.items.map((i) => i.name)).toEqual(['billing-trade-prod-kr-gcf-01', 'billing-trade-prod-kr-gcf-01']);
    const msg = { code: 'name.conflict', params: { name: 'billing-trade-prod-kr-gcf-01', keys: ['cloud_function_gen1_01', 'cloud_function_01'] } };
    for (const it of r.items) expect(it).toMatchObject({ valid: false, violations: [msg] });
    expect(r.conflicts).toEqual([msg]);
  });
  it('generate(전체 카탈로그)에서도 둘 다 valid:false + name.conflict — 키는 resourceType', () => {
    const gcp = generate(ctx, ['gcp']).gcp!;
    const msg = { code: 'name.conflict', params: { name: 'billing-trade-prod-kr-gcf-01', keys } };
    for (const k of keys) expect(gcp[k]).toMatchObject({ name: 'billing-trade-prod-kr-gcf-01', valid: false, violations: [msg] });
    // 둘 사이 항목 위반은 서로 다른 객체다
    expect(gcp[keys[0]!]!.violations[0]).not.toBe(gcp[keys[1]!]!.violations[0]);
  });
  it('generate 의 충돌은 함수 둘뿐이다 — 세 CSP 기본 문맥', () => {
    const out = generate(ctx);
    const hit = Object.entries(out).flatMap(([p, byType]) => Object.entries(byType!).filter(([, r]) => r.violations.some((v) => v.code === 'name.conflict')).map(([t]) => `${p}.${t}`));
    expect(hit).toEqual(['gcp.cloud_function_gen1', 'gcp.cloud_function']);
  });
});

describe('메시지에 되돌려 싣는 사용자 값은 이스케이프한 뒤 80자까지 (docs/decisions.md · 2026-10-06 응답 증폭)', () => {
  const ctx0 = { owner: 'infra', system: 'billing', purpose: 'trade', env: 'prod', region: 'kr' } as const;
  it('step.normalized 의 from 은 보이지 않는 문자를 \\uXXXX 로 바꾸고 80자 + … · to 도 같은 꼴', () => {
    const owner = `A${'\u200B'.repeat(200)}`;
    const r = generate({ ...ctx0, owner }, ['aws'])['aws']!['s3_bucket']!;
    const step = r.steps.find((m) => m.code === 'step.normalized' && m.field === 'owner');
    expect(step).toBeDefined();
    if (step?.code !== 'step.normalized') return;
    expect(step.params.from).toBe(`A${'\\u200B'.repeat(13)}\\…`);
    expect(step.params.from.length).toBe(81);
    expect(step.params.to).toBe('a');
  });
  it('길이 80 이하 · 보이는 문자는 그대로', () => {
    const r = generate({ ...ctx0, owner: 'Team A' }, ['aws'])['aws']!['s3_bucket']!;
    expect(r.steps.find((m) => m.code === 'step.normalized')).toMatchObject({ params: { from: 'Team A', to: 'team-a' } });
  });
  it('context.value_unsupported 의 value · context.normalized 의 from 도 80자 + …', () => {
    const bad = parseContext({ ...ctx0, env: 'q'.repeat(1024) });
    expect(bad).toMatchObject({ ok: false, errors: [{ code: 'context.value_unsupported', field: 'env', params: { value: `${'q'.repeat(80)}…` } }] });
    const padded = parseContext({ ...ctx0, region: `kr${' '.repeat(500)}` });
    expect(padded.ok && padded.transformed[0]).toMatchObject({ code: 'context.normalized', field: 'region', params: { from: `kr${' '.repeat(78)}…`, to: 'kr' } });
  });
});
