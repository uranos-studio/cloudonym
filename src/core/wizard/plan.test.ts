import { describe, it, expect } from 'vitest';
import { expandPlan, validatePlan, MAX_PICKS_PER_SERVICE, MAX_SERVICES, SLOT_ID_PATTERN, type Pick, type PlanError, type WizardPlan, type WizardSlot } from './plan';
import { generateProject } from '../engine';
import { WIZARD_SAMPLE } from '../__fixtures__/project';
import { GCP_CATALOG } from '../rules/gcp-catalog';
import { REGIONS } from '../regions-data';
import { ENV_ALIASES } from '../normalize';
import { TIER_PATTERN } from '../types';
import { SEQ_PATTERN } from '../selection';

const PROJECT = { owner: 'platform', system: 'billing', env: 'prod', region: 'asia-northeast3-a' };

/** 계획 §5-2 의 요청 — 프로젝트 네트워크 넷 · shop(web VM + boot · data 01 · ip, Cloud SQL) · pay(web HA 서버 둘 · boot 둘) */
const SAMPLE: WizardPlan = {
  provider: 'gcp',
  project: PROJECT,
  projectPicks: [
    { preset: 'vpc', instances: [{ id: 'a', seq: '01' }] },
    { preset: 'subnet', instances: [{ id: 'b', seq: '01' }] },
    { preset: 'firewall', tier: 'ssh', instances: [{ id: 'c', seq: '01' }] },
    { preset: 'firewall', tier: 'web', instances: [{ id: 'd', seq: '01' }] },
  ],
  services: [
    { purpose: 'shop', picks: [
      { preset: 'web', instances: [{ id: 'e', seq: '01', attach: { boot: true, data: ['01'], ip: true } }] },
      { preset: 'db', kind: 'POSTGRES', instances: [{ id: 'f', seq: '01' }] },
    ] },
    { purpose: 'pay', picks: [
      { preset: 'web', ha: true, instances: [{ id: 'g', seq: '01', attach: { boot: true } }, { id: 'h', seq: '02', attach: { boot: true } }] },
    ] },
  ],
};

/** 서비스 하나 · pick 목록으로 모델을 만든다 */
const svc = (...picks: Pick[]): WizardPlan => ({ provider: 'gcp', project: PROJECT, projectPicks: [], services: [{ purpose: 'shop', picks }] });
/** 검사 전 값(모양이 틀린 입력)을 모델로 넣는다 */
const raw = (v: unknown): Pick => v as Pick;
const slots = (n: number, from = 1, attach?: WizardSlot['attach']): WizardSlot[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${from + i}`, seq: String(from + i).padStart(2, '0'), ...(attach ? { attach } : {}) }));

function errorsOf(plan: WizardPlan): PlanError[] {
  const r = validatePlan(plan);
  return r.ok ? [] : r.errors;
}
/** code 하나가 path 에 있는가 — 나머지 오류는 보지 않는다 */
function expectError(plan: WizardPlan, code: string, path: string | undefined, params?: Record<string, unknown>) {
  const errs = errorsOf(plan);
  const hit = errs.find((e) => e.code === code && e.path === path);
  expect(hit, `${code} @ ${path} — got ${JSON.stringify(errs)}`).toBeDefined();
  if (params) expect((hit as { params?: unknown }).params).toMatchObject(params);
}
const names = (plan: WizardPlan) => generateProject(expandPlan(plan), 'gcp').items.map((i) => i.name);

// §5-5 path 꼴 — 프로젝트 · 서비스 pick 이 같은 꼬리를 쓴다
const TAIL = String.raw`(\.instances\[\d+\](\.attach(\.(boot|ip|ipi|data(\[\d+\])?))?)?)?`;
const PATH_RE = new RegExp(String.raw`^(services\[\d+\](\.picks\[\d+\]${TAIL})?|projectPicks(\[\d+\]${TAIL})?)$`);
const MODEL_WIDE = new Set(['wizard.empty', 'wizard.too_many_names', 'wizard.too_many_services']);

describe('계획의 표본 요청 (§5-2) — validatePlan → expandPlan → generateProject', () => {
  it('검사를 지나고 · 펼친 값이 엔진 fixture 와 같고 · 항목 14 가 모두 PASS', () => {
    expect(validatePlan(SAMPLE)).toEqual({ ok: true });
    const sel = expandPlan(SAMPLE);
    // 존을 넣은 region 은 문맥에 표시용 zone 이 남는다(이름에는 리전 코드만 — D50 수정)
    expect(sel).toEqual({ ...WIZARD_SAMPLE, project: { ...WIZARD_SAMPLE.project, zone: 'ane3a' } });
    const res = generateProject(sel, 'gcp');
    expect(res.items).toHaveLength(14);
    expect(res.valid).toBe(true);
    const byName = res.items.map((i) => i.name);
    for (const n of ['billing-shop-prod-ane3-gce-web-01', 'billing-shop-prod-ane3-gce-web-01-boot', 'billing-shop-prod-ane3-gce-web-01-data-01',
      'billing-pay-prod-ane3-gce-web-01', 'billing-pay-prod-ane3-gce-web-01-boot', 'billing-pay-prod-ane3-gce-web-02-boot']) expect(byName, n).toContain(n);
    expect(res.items.map((i) => i.key)).toContain('service/shop/compute_instance/web/01/data/01');
    expect(res.items[0]!.key).toBe('project/-/project_id/-/-');
  });

  it('expandPlan 은 슬롯 id 를 싣지 않고 file 의 defaultAttach 를 넣지 않는다', () => {
    const sel = expandPlan(svc({ preset: 'file', instances: [{ id: 'a', seq: '01' }] }));
    expect(sel.services[0]!.items[0]).toEqual({ rule: expect.objectContaining({ id: 'gcp.compute_instance' }), count: 1, tier: 'file', instances: [{ seq: '01' }] });
  });

  it('검사를 지나지 않은 모델은 expandPlan 이 던진다', () => {
    expect(() => expandPlan(svc({ preset: 'nope' }))).toThrow();
    expect(() => expandPlan({ ...SAMPLE, project: { ...PROJECT, env: 'xx' } })).toThrow();
  });
});

describe('HA · serverless (§4-2 · D61 · Q5 ⑵)', () => {
  it('HA web 슬롯 하나 → count_below_min { min: 2 }', () => {
    expectError(svc({ preset: 'web', ha: true, instances: slots(1) }), 'wizard.count_below_min', 'services[0].picks[0]', { index: 0, min: 2 });
  });
  it('db · bastion · custom VM 에 ha → ha_not_supported (슬롯 둘이어도)', () => {
    expectError(svc({ preset: 'db', ha: true, instances: slots(2) }), 'wizard.ha_not_supported', 'services[0].picks[0]', { type: 'cloud_sql_instance' });
    expectError(svc({ preset: 'bastion', ha: true, instances: slots(2) }), 'wizard.ha_not_supported', 'services[0].picks[0]');
    expectError(svc({ preset: null, ruleId: 'gcp.compute_instance', ha: true, instances: slots(2) }), 'wizard.ha_not_supported', 'services[0].picks[0]');
  });
  it('web + serverless(Cloud Functions · Cloud Run) + ha + 슬롯 둘 → ha_not_supported (유효 규칙 기준)', () => {
    for (const s of ['gcp.cloud_function', 'gcp.run_service']) {
      expectError(svc({ preset: 'web', serverless: s, ha: true, instances: slots(2) }), 'wizard.ha_not_supported', 'services[0].picks[0]');
    }
  });
  it('HA web 슬롯 둘은 지난다', () => {
    expect(validatePlan(svc({ preset: 'web', ha: true, instances: slots(2) }))).toEqual({ ok: true });
  });
  it('serverless: true (불리언) · 데이터 밖 규칙 id · 서버리스 없는 프리셋 → serverless_not_supported', () => {
    expectError(svc(raw({ preset: 'web', serverless: true, instances: slots(1) })), 'wizard.serverless_not_supported', 'services[0].picks[0]', { type: 'compute_instance' });
    expectError(svc({ preset: 'web', serverless: 'gcp.cloud_sql_instance', instances: slots(1) }), 'wizard.serverless_not_supported', 'services[0].picks[0]');
    expectError(svc({ preset: 'bastion', serverless: 'gcp.run_service', instances: slots(1) }), 'wizard.serverless_not_supported', 'services[0].picks[0]');
  });
  it('ha: null · serverless: null 은 꺼짐 (JSON 클라이언트가 null 을 보낸다)', () => {
    const plan = svc({ preset: 'web', ha: null, serverless: null, instances: slots(1) }, { preset: 'db', ha: null, serverless: null, instances: slots(1) });
    expect(validatePlan(plan)).toEqual({ ok: true });
    expect(names(plan)).toEqual(['platform-billing-prod', 'billing-shop-prod-ane3-gce-web-01', 'billing-shop-prod-ane3-sql-01']);
  });
  it('serverless run_service → …-run-web-01 · 같은 서비스의 was → …-run-was-01', () => {
    const plan = svc({ preset: 'web', serverless: 'gcp.run_service', instances: slots(1) }, { preset: 'was', serverless: 'gcp.run_service', instances: slots(1) });
    expect(validatePlan(plan)).toEqual({ ok: true });
    expect(names(plan)).toEqual(['platform-billing-prod', 'billing-shop-prod-ane3-run-web-01', 'billing-shop-prod-ane3-run-was-01']);
  });
  it('web + serverless 에 attach → children_not_supported (유효 규칙에 호환표가 없다)', () => {
    expectError(svc({ preset: 'web', serverless: 'gcp.cloud_function', instances: [{ id: 'a', seq: '01', attach: { boot: true } }] }), 'wizard.children_not_supported', 'services[0].picks[0]');
  });
});

describe('슬롯 (D61)', () => {
  it('서버 01 을 지운 모델 → 02 의 이름 · 자식 그대로', () => {
    const two = svc({ preset: 'web', instances: [{ id: 'a', seq: '01', attach: { boot: true } }, { id: 'b', seq: '02', attach: { boot: true, data: ['01'] } }] });
    const one = svc({ preset: 'web', instances: [{ id: 'b', seq: '02', attach: { boot: true, data: ['01'] } }] });
    expect(validatePlan(one)).toEqual({ ok: true });
    const kept = ['billing-shop-prod-ane3-gce-web-02', 'billing-shop-prod-ane3-gce-web-02-boot', 'billing-shop-prod-ane3-gce-web-02-data-01'];
    for (const n of kept) expect(names(two)).toContain(n);
    expect(names(one)).toEqual(['platform-billing-prod', ...kept]);
  });
  it('슬롯 id 중복 → duplicate_slot_id · 9자 · 대문자 · 빈 값 → invalid_slot_id', () => {
    expectError(svc({ preset: 'web', instances: [{ id: 'a', seq: '01' }, { id: 'a', seq: '02' }] }), 'wizard.duplicate_slot_id', 'services[0].picks[0].instances[1]', { value: 'a' });
    for (const id of ['abcdefghi', 'A', '']) {
      expectError(svc({ preset: 'web', instances: [{ id, seq: '01' }] }), 'wizard.invalid_slot_id', 'services[0].picks[0].instances[0]', { value: id, pattern: SLOT_ID_PATTERN.source });
    }
    expect(validatePlan(svc({ preset: 'web', instances: [{ id: 'abcdefg8', seq: '01' }] }))).toEqual({ ok: true });
  });
  it('슬롯 seq 중복 → duplicate_seq · 00 · 7 · 100 · ab → invalid_seq', () => {
    expectError(svc({ preset: 'web', instances: [{ id: 'a', seq: '03' }, { id: 'b', seq: '03' }] }), 'wizard.duplicate_seq', 'services[0].picks[0].instances[1]', { value: '03' });
    for (const seq of ['00', '7', '100', 'ab']) {
      expectError(svc({ preset: 'web', instances: [{ id: 'a', seq }] }), 'wizard.invalid_seq', 'services[0].picks[0].instances[0]', { value: seq, pattern: SEQ_PATTERN.source });
    }
  });
  it('count 규칙에 instances 가 없거나 비면 → selection.count_out_of_range (숨은 슬롯 없음)', () => {
    expectError(svc({ preset: 'web' }), 'selection.count_out_of_range', 'services[0].picks[0]', { index: 0 });
    expectError(svc({ preset: 'web', instances: [] }), 'selection.count_out_of_range', 'services[0].picks[0]');
  });
  it('storage_bucket 에 instances 하나 → instances_not_supported · role 규칙도 같다', () => {
    expectError(svc({ preset: 'object', instances: slots(1) }), 'wizard.instances_not_supported', 'services[0].picks[0]', { type: 'storage_bucket' });
    expectError(svc({ preset: null, ruleId: 'gcp.service_account', instances: slots(1) }), 'wizard.instances_not_supported', 'services[0].picks[0]');
  });
});

describe('tier · level · 중복 (D60 · D63)', () => {
  it('tier on role 규칙 → tier_not_supported · Web → invalid_tier', () => {
    expectError(svc({ preset: null, ruleId: 'gcp.service_account', tier: 'abc' }), 'wizard.tier_not_supported', 'services[0].picks[0]', { type: 'service_account' });
    expectError(svc({ preset: 'web', tier: 'Web', instances: slots(1) }), 'wizard.invalid_tier', 'services[0].picks[0]', { value: 'Web', pattern: TIER_PATTERN.source });
  });
  it('순번 없는 규칙의 tier (D74) — 버킷 둘은 tier 없이 duplicate_pick · uploads/backups 면 통과하고 이름 둘 · tier 없는 버킷 이름은 그대로', () => {
    expectError(svc({ preset: 'object' }, { preset: 'object' }), 'wizard.duplicate_pick', 'services[0].picks[1]', { value: 'storage_bucket' });
    expectError(svc({ preset: 'object' }, { preset: 'object', tier: 'uploads' }, { preset: null, ruleId: 'gcp.storage_bucket', tier: 'uploads' }), 'wizard.duplicate_pick', 'services[0].picks[2]', { value: 'storage_bucket/uploads' });
    const two = svc({ preset: 'object', tier: 'uploads' }, { preset: 'object', tier: 'backups' });
    expect(validatePlan(two)).toEqual({ ok: true });
    expect(names(two).slice(1)).toEqual(['platform-billing-shop-prod-ane3-gcs-uploads', 'platform-billing-shop-prod-ane3-gcs-backups']);
    expect(names(svc({ preset: 'object' })).slice(1)).toEqual(['platform-billing-shop-prod-ane3-gcs']);
    // 밑줄 규칙(BigQuery 데이터셋) · 앞 약어 규칙(커스텀 역할 — 구분자 없음)
    expect(names(svc({ preset: null, ruleId: 'gcp.bigquery_dataset', tier: 'raw' })).slice(1)).toEqual(['billing_shop_prod_ane3_bq_raw']);
    expect(validatePlan(svc({ preset: null, ruleId: 'gcp.iam_custom_role', tier: 'audit' }))).toEqual({ ok: true });
    // 예약어 · 꼴은 count 규칙과 같은 검사
    expectError(svc({ preset: 'object', tier: 'gcs' }), 'wizard.tier_reserved', 'services[0].picks[0]', { value: 'gcs' });
    expectError(svc({ preset: 'object', tier: 'Up' }), 'wizard.invalid_tier', 'services[0].picks[0]');
    // 역할 규칙(Cloud SQL 사용자)은 여전히 받지 않는다
    expectError(svc({ preset: null, ruleId: 'gcp.cloud_sql_user', tier: 'abc' }), 'wizard.tier_not_supported', 'services[0].picks[0]', { type: 'cloud_sql_user' });
  });
  it('custom tier db → tier_reserved · tier run(Cloud Run 약어) → tier_reserved', () => {
    expectError(svc({ preset: null, ruleId: 'gcp.compute_instance', tier: 'db', instances: slots(1) }), 'wizard.tier_reserved', 'services[0].picks[0]', { value: 'db' });
    expectError(svc({ preset: null, ruleId: 'gcp.compute_instance', tier: 'run', instances: slots(1) }), 'wizard.tier_reserved', 'services[0].picks[0]', { value: 'run' });
  });
  it('예약 목록 전부(규칙 표 · 별칭 표 · 지역 표에서 그 자리에서 만든다) → tier_reserved', () => {
    const words = new Set([
      ...GCP_CATALOG.map((r) => r.slug.value),
      ...GCP_CATALOG.flatMap((r) => Object.values(r.kind?.tokens ?? {})),
      ...Object.keys(ENV_ALIASES),
      ...REGIONS.gcp.flatMap((r) => [r.code, ...r.zones.map((z) => z.code)]),
    ].filter((w): w is string => typeof w === 'string' && TIER_PATTERN.test(w)));
    for (const w of ['run', 'gce', 'pg', 'prd', 'production', 'live', 'real', 'ane3']) expect(words.has(w), w).toBe(true);
    for (const w of words) {
      const errs = errorsOf(svc({ preset: null, ruleId: 'gcp.compute_instance', tier: w, instances: slots(1) }));
      expect(errs.map((e) => e.code), w).toEqual(['wizard.tier_reserved']);
    }
  });
  it('level on 존 범위 규칙(projectPicks 의 disk) → level_not_supported · cloud_function 도 같다', () => {
    const plan = (p: Pick): WizardPlan => ({ provider: 'gcp', project: PROJECT, projectPicks: [p], services: [] });
    expectError(plan({ preset: null, ruleId: 'gcp.disk', instances: slots(1) }), 'wizard.level_not_supported', 'projectPicks[0]', { type: 'disk' });
    expectError(plan({ preset: null, ruleId: 'gcp.cloud_function', instances: slots(1) }), 'wizard.level_not_supported', 'projectPicks[0]');
    expect(validatePlan(plan({ preset: 'vpc', instances: slots(1) }))).toEqual({ ok: true });
  });
  it('같은 (type, tier) 둘 → duplicate_pick · web + was(둘 다 VM 슬롯 01) → 통과', () => {
    expectError(svc({ preset: 'web', instances: slots(1) }, { preset: 'web', instances: slots(1, 2) }), 'wizard.duplicate_pick', 'services[0].picks[1]', { value: 'compute_instance/web' });
    expect(validatePlan(svc({ preset: 'web', instances: slots(1) }, { preset: 'was', instances: slots(1) }))).toEqual({ ok: true });
  });
  it('같은 서비스의 서비스 계정 둘 — role 이 다르면 통과 · 같으면 duplicate_pick', () => {
    const sa = (role: string): Pick => ({ preset: null, ruleId: 'gcp.service_account', role });
    expect(validatePlan(svc(sa('worker'), sa('deploy')))).toEqual({ ok: true });
    expectError(svc(sa('worker'), sa('worker')), 'wizard.duplicate_pick', 'services[0].picks[1]', { value: 'service_account/worker' });
  });
  it('role 을 뺀 서비스 계정은 엔진처럼 기본 role(sync)로 친다 — 빠진 것 + sync → duplicate_pick', () => {
    const bare: Pick = { preset: null, ruleId: 'gcp.service_account' };
    const sync: Pick = { preset: null, ruleId: 'gcp.service_account', role: 'sync' };
    expectError(svc(bare, sync), 'wizard.duplicate_pick', 'services[0].picks[1]', { value: 'service_account/sync' });
    expectError(svc(sync, bare), 'wizard.duplicate_pick', 'services[0].picks[1]', { value: 'service_account/sync' });
    expect(validatePlan(svc(bare, { preset: null, ruleId: 'gcp.service_account', role: 'worker' }))).toEqual({ ok: true });
  });
  it('custom 버킷 tier 없음 · custom 서비스 계정 role worker → 통과', () => {
    expect(validatePlan(svc({ preset: null, ruleId: 'gcp.storage_bucket' }))).toEqual({ ok: true });
    expect(validatePlan(svc({ preset: null, ruleId: 'gcp.service_account', role: 'worker' }))).toEqual({ ok: true });
  });
  it('모르는 preset → unknown_preset · custom gcp.project_id → reserved_pick · 모르는 규칙 → selection.unknown_type', () => {
    expectError(svc({ preset: 'nope' }), 'wizard.unknown_preset', 'services[0].picks[0]', { value: 'nope' });
    expectError(svc({ preset: null, ruleId: 'gcp.project_id' }), 'wizard.reserved_pick', 'services[0].picks[0]', { type: 'project_id' });
    expectError(svc({ preset: null, ruleId: 'gcp.nope' }), 'selection.unknown_type', 'services[0].picks[0]');
    expectError(svc({ preset: null, ruleId: 'aws.ec2_instance' }), 'selection.unknown_type', 'services[0].picks[0]');
  });
});

describe('딸린 것 (D62) — checkAttachments 를 pick 마다', () => {
  const vm = (attach: unknown) => svc(raw({ preset: 'web', instances: [{ id: 'a', seq: '01', attach }] }));
  it('cloud_sql_instance · vpc_network 에 attach → children_not_supported', () => {
    expectError(svc({ preset: 'db', instances: [{ id: 'a', seq: '01', attach: { boot: true } }] }), 'wizard.children_not_supported', 'services[0].picks[0]', { type: 'cloud_sql_instance' });
    expectError(svc({ preset: 'vpc', instances: [{ id: 'a', seq: '01', attach: { ip: true } }] }), 'wizard.children_not_supported', 'services[0].picks[0]', { type: 'vpc_network' });
  });
  it('attach 배열 → attach_not_object · data 10개 → attach_out_of_range · [1] → invalid_data_seq · [01,01] → duplicate_seq', () => {
    expectError(vm([]), 'wizard.attach_not_object', 'services[0].picks[0].instances[0].attach');
    const ten = Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(2, '0'));
    expectError(vm({ data: ten }), 'wizard.attach_out_of_range', 'services[0].picks[0].instances[0].attach.data', { max: 9 });
    expectError(vm({ data: ['1'] }), 'wizard.invalid_data_seq', 'services[0].picks[0].instances[0].attach.data[0]');
    expectError(vm({ data: ['01', '01'] }), 'wizard.duplicate_seq', 'services[0].picks[0].instances[0].attach.data[1]', { value: 'data/01' });
  });
  it('boot:false · ip:"yes" · 모르는 키 → attach_not_object (조용히 버리지 않는다) · 한 번만', () => {
    for (const a of [{ boot: false }, { ip: 'yes' }, { ipi: 1 }, { disk: true }]) {
      const errs = errorsOf(vm(a));
      expect(errs.map((e) => [e.code, e.path]), JSON.stringify(a)).toEqual([['wizard.attach_not_object', 'services[0].picks[0].instances[0].attach']]);
    }
  });
  it('값이 undefined 인 boot · ip 는 없는 것과 같다(화면 상태) — 통과', () => {
    expect(validatePlan(vm({ boot: undefined, ip: undefined, data: ['01'] }))).toEqual({ ok: true });
  });
  it('data [01,02] → [02] 로 바꿔도 …-data-02 이름 그대로', () => {
    const a = names(vm({ boot: true, data: ['01', '02'] }));
    const b = names(vm({ boot: true, data: ['02'] }));
    expect(a).toContain('billing-shop-prod-ane3-gce-web-01-data-02');
    expect(b).toEqual(['platform-billing-prod', 'billing-shop-prod-ane3-gce-web-01', 'billing-shop-prod-ane3-gce-web-01-boot', 'billing-shop-prod-ane3-gce-web-01-data-02']);
  });
});

describe('서비스 · 모델 전체', () => {
  const two = (a: string, b: string): WizardPlan => ({ provider: 'gcp', project: PROJECT, projectPicks: [], services: [
    { purpose: a, picks: [{ preset: 'web', instances: slots(1) }] }, { purpose: b, picks: [{ preset: 'web', instances: slots(1) }] }] });
  it('shop · SHOP → duplicate_service · ### → empty_service · project → reserved_service', () => {
    expectError(two('shop', 'SHOP'), 'wizard.duplicate_service', 'services[1]', { index: 1, value: 'shop' });
    expectError(two('shop', '###'), 'wizard.empty_service', 'services[1]', { index: 1 });
    expectError(two('shop', 'Project'), 'wizard.reserved_service', 'services[1]', { value: 'project' });
  });
  it('services 0 + projectPicks 있음 → 통과 · 둘 다 없음 → wizard.empty (path 없음)', () => {
    expect(validatePlan({ provider: 'gcp', project: PROJECT, projectPicks: [{ preset: 'vpc', instances: slots(1) }], services: [] })).toEqual({ ok: true });
    const r = validatePlan({ provider: 'gcp', project: PROJECT, projectPicks: [], services: [] });
    expect(r).toEqual({ ok: false, errors: [{ code: 'wizard.empty' }] });
    expect(validatePlan({ provider: 'gcp', project: PROJECT, projectPicks: [], services: [{ purpose: 'shop', picks: [] }] })).toEqual({ ok: false, errors: [{ code: 'wizard.empty' }] });
  });
  it('services 21 → too_many_services (path 없음)', () => {
    const many: WizardPlan = { provider: 'gcp', project: PROJECT, projectPicks: [],
      services: Array.from({ length: MAX_SERVICES + 1 }, (_, i) => ({ purpose: `s${i}`, picks: [{ preset: 'web', instances: slots(1) }] })) };
    const errs = errorsOf(many);
    expect(errs).toEqual([{ code: 'wizard.too_many_services', params: { max: MAX_SERVICES, actual: MAX_SERVICES + 1 } }]);
    expect(errs[0]!.path).toBeUndefined();
  });
  it('pick 이 상한 + 1 → too_many_picks — 서비스는 services[i] · 프로젝트 공용은 projectPicks', () => {
    const picks = Array.from({ length: MAX_PICKS_PER_SERVICE + 1 }, (): Pick => ({ preset: null, ruleId: 'gcp.storage_bucket' }));
    const plan: WizardPlan = { provider: 'gcp', project: PROJECT, projectPicks: [], services: [{ purpose: 'a', picks: [{ preset: 'web', instances: slots(1) }] }, { purpose: 'b', picks }] };
    expectError(plan, 'wizard.too_many_picks', 'services[1]', { index: 1, max: MAX_PICKS_PER_SERVICE, actual: MAX_PICKS_PER_SERVICE + 1 });
    const proj = Array.from({ length: MAX_PICKS_PER_SERVICE + 1 }, (): Pick => ({ preset: 'vpc', instances: slots(1) }));
    expectError({ provider: 'gcp', project: PROJECT, projectPicks: proj, services: [] }, 'wizard.too_many_picks', 'projectPicks', { max: MAX_PICKS_PER_SERVICE });
  });
  it('services · projectPicks 가 배열이 아니면 selection.not_array (path 없음) · expandPlan 은 분명히 던진다', () => {
    for (const bad of [{ ...SAMPLE, services: raw({}) as unknown as WizardPlan['services'] }, { ...SAMPLE, projectPicks: raw(null) as unknown as Pick[] }]) {
      expect(errorsOf(bad)).toEqual([{ code: 'selection.not_array' }]);
      expect(() => expandPlan(bad)).toThrow(/validatePlan/);
    }
  });
  it('서비스의 picks 가 배열이 아니면 selection.not_array @ services[i] · expandPlan 은 분명히 던진다', () => {
    const bad: WizardPlan = { ...SAMPLE, services: [SAMPLE.services[0]!, { purpose: 'pay', picks: raw('x') as unknown as Pick[] }] };
    expectError(bad, 'selection.not_array', 'services[1]');
    expect(() => expandPlan(bad)).toThrow(/validatePlan/);
  });
  it('서비스 항목이 객체가 아니면 empty_service · not_array @ services[i]', () => {
    const bad: WizardPlan = { ...SAMPLE, services: [SAMPLE.services[0]!, raw(null) as unknown as WizardPlan['services'][number]] };
    expectError(bad, 'wizard.empty_service', 'services[1]');
    expectError(bad, 'selection.not_array', 'services[1]');
  });
  it('프로젝트 문맥 오류는 context.* (field) 로 낸다', () => {
    const errs = errorsOf({ ...SAMPLE, project: { ...PROJECT, env: 'xx' } });
    expect(errs.map((e) => e.code)).toEqual(['context.value_unsupported']);
  });
});

describe('이름 총합 — 프로젝트 ID · 프로젝트 수준 · 부모 · 자식을 한 번에 센다', () => {
  const vms = (counts: number[], attach?: WizardSlot['attach']): WizardPlan => ({ provider: 'gcp', project: PROJECT, projectPicks: [],
    services: counts.map((n, i) => ({ purpose: `s${i}`, picks: [{ preset: 'web', instances: slots(n, 1, attach) }] })) });
  it('프로젝트 ID 1 + VM 199(67 · 66 · 66) = 200 통과', () => {
    expect(validatePlan(vms([67, 66, 66]))).toEqual({ ok: true });
  });
  it('프로젝트 ID 1 + VM 200(67 · 67 · 66) = 201 → too_many_names { max: 200, actual: 201 } (path 없음)', () => {
    const errs = errorsOf(vms([67, 67, 66]));
    expect(errs).toEqual([{ code: 'wizard.too_many_names', params: { max: 200, actual: 201 } }]);
  });
  it('자식도 센다 — VM 100(web 50 + was 50) + data 100 + 프로젝트 ID = 201 → 거부', () => {
    const plan: WizardPlan = { provider: 'gcp', project: PROJECT, projectPicks: [], services: [{ purpose: 'shop', picks: [
      { preset: 'web', instances: slots(50, 1, { data: ['01'] }) }, { preset: 'was', instances: slots(50, 1, { data: ['01'] }) }] }] };
    expect(errorsOf(plan)).toEqual([{ code: 'wizard.too_many_names', params: { max: 200, actual: 201 } }]);
  });
});

describe('위치 path (§5-5)', () => {
  it('둘째 서비스의 둘째 pick 오류는 services[1].picks[1] — 감싼 selection.* 도 같고 index 는 pick 자리', () => {
    const plan: WizardPlan = { provider: 'gcp', project: PROJECT, projectPicks: [], services: [
      { purpose: 'shop', picks: [{ preset: 'web', instances: slots(1) }] },
      { purpose: 'pay', picks: [{ preset: 'web', instances: slots(1) }, { preset: 'db', kind: 'XX', instances: slots(1) }, { preset: 'was', role: 'worker', instances: slots(1) }] }] };
    expectError(plan, 'selection.unknown_kind', 'services[1].picks[1]', { index: 1, type: 'cloud_sql_instance' });
    expectError(plan, 'selection.role_not_supported', 'services[1].picks[2]', { index: 2 });
  });
  it('입력 요소 오류는 모두 path 가 있고 §5-5 꼴 · 모델 전체 오류는 path 가 없다', () => {
    const bad: WizardPlan = { provider: 'gcp', project: PROJECT,
      projectPicks: [{ preset: null, ruleId: 'gcp.disk', instances: slots(1) }, { preset: 'vpc', instances: [{ id: 'A', seq: '00', attach: { data: ['1'] } }] }],
      services: [
        { purpose: 'shop', picks: [{ preset: 'web', ha: true, instances: [{ id: 'a', seq: '01', attach: { boot: true, data: ['01', '01'] } }] }, raw(null)] },
        { purpose: 'SHOP', picks: [{ preset: 'nope' }, { preset: null, ruleId: 'gcp.service_account', tier: 'x' }, raw({ preset: 'web', instances: [{ id: 'b', seq: '01', attach: [] }] })] },
      ] };
    const errs = errorsOf(bad);
    expect(errs.length).toBeGreaterThan(8);
    for (const e of errs) {
      expect(MODEL_WIDE.has(e.code), e.code).toBe(false);
      expect(e.path, e.code).toMatch(PATH_RE);
    }
    const wide = [errorsOf({ ...bad, projectPicks: [], services: [] })[0]!, errorsOf(
      { provider: 'gcp', project: PROJECT, projectPicks: [], services: [{ purpose: 'a', picks: [{ preset: 'web', instances: slots(99) }, { preset: 'was', instances: slots(99) }, { preset: 'bastion', instances: slots(3) }] }] })[0]!];
    expect(wide.map((e) => e.code)).toEqual(['wizard.empty', 'wizard.too_many_names']);
    for (const e of wide) expect(e.path).toBeUndefined();
  });
  it('검사식 자체 — 틀린 꼴을 거부한다', () => {
    for (const p of ['services[0].picks[0]', 'projectPicks', 'projectPicks[2].instances[1].attach.data[0]', 'services[1]']) expect(p).toMatch(PATH_RE);
    for (const p of ['services', 'project_picks[0]', 'services[0].picks', 'services[0].picks[0].attach']) expect(p).not.toMatch(PATH_RE);
  });
});

describe('pick 의 위치 (D78)', () => {
  it('버킷 · BigQuery 데이터세트는 멀티 · 이중 리전 위치를 받는다 — 코드 · 이름 둘 다 · 이름에는 코드', () => {
    const plan = svc({ preset: 'object', tier: 'logs', location: 'US' }, { preset: 'object', tier: 'dr', location: 'asia1' }, { preset: null, ruleId: 'gcp.bigquery_dataset', location: 'eu' }, { preset: 'object' });
    expect(validatePlan(plan)).toEqual({ ok: true });
    expect(names(plan).slice(1)).toEqual(['platform-billing-shop-prod-us-gcs-logs', 'platform-billing-shop-prod-asia1-gcs-dr', 'billing_shop_prod_eu_bq', 'platform-billing-shop-prod-ane3-gcs']);
    expect(expandPlan(plan).services[0]!.items[0]!.location).toBe('us');
  });
  it('받지 않는 위치 · 위치를 받지 않는 규칙 · 모르는 값은 wizard.invalid_location', () => {
    expectError(svc({ preset: null, ruleId: 'gcp.bigquery_dataset', location: 'ASIA' }), 'wizard.invalid_location', 'services[0].picks[0]', { type: 'bigquery_dataset', value: 'ASIA', supported: ['US', 'EU'] });
    expectError(svc({ preset: 'web', location: 'US', instances: slots(1) }), 'wizard.invalid_location', 'services[0].picks[0]', { type: 'compute_instance', supported: [] });
    expectError(svc({ preset: 'object', location: 'asia-northeast1' }), 'wizard.invalid_location', 'services[0].picks[0]', { value: 'asia-northeast1' });
  });
  it('프로젝트 지역은 단일 리전이다 — 멀티 리전이면 context.location_unsupported', () => {
    expectError({ ...svc({ preset: 'object' }), project: { ...PROJECT, region: 'US' } }, 'context.location_unsupported', undefined, { value: 'US', supported: ['storage_bucket', 'bigquery_dataset'] });
  });
});
