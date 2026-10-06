// 호환 불변식 — 기본 문맥(baseline 의 base)에서 만드는 이름 24개를 문자열 리터럴로 고정한다.
// 순번 · 역할을 항목 입력으로 받게 되어도(D30') 기본값(count 1 → 01 · role sync)이면 지금 출력과 글자 하나 다르지 않아야 한다.
// baseline.json 은 UPDATE_BASELINE 으로 다시 쓸 수 있지만 이 파일은 손으로만 바뀐다 — 바뀌었다면 이름이 달라진 것이다
import { describe, it, expect } from 'vitest';
import { generate, parseContext } from './engine';

const BASE = { owner: 'platform', system: 'billing', purpose: 'trade', env: 'prd', region: 'kr' };

const EXPECTED: Record<string, Record<string, string>> = {
  aws: {
    s3_bucket: 'platform-billing-trade-prd-bucket',
    iam_role: 'billing-trade-prd-role-sync',
    vpc: 'billing-trade-prd-kr-vpc-01',
    subnet: 'billing-trade-prd-kr-subnet-01',
    ec2_instance: 'billing-trade-prd-kr-vm-01',
    rds_instance: 'billing-trade-prd-kr-db-01',
  },
  gcp: {
    project_id: 'platform-billing-trade-prd',
    service_account: 'billing-trade-prd-sa-sync',
    compute_instance: 'billing-trade-prd-kr-vm-01',
    vpc_network: 'billing-trade-prd-vpc-01',
    subnet: 'billing-trade-prd-kr-subnet-01',
    cloud_sql_instance: 'billing-trade-prd-kr-db-01',
    storage_bucket: 'platform-billing-trade-prd-bucket',
  },
  azure: {
    resource_group: 'rg-billing-trade-prd',
    storage_account: 'stbillingtradeprd',
    key_vault: 'kv-billing-trade-prd',
    managed_identity: 'billing-trade-prd-id-sync',
    virtual_machine: 'billing-trade-prd-kr-vm-01',
    virtual_machine_windows: 'bi-tr-prd-vm-01',
    virtual_network: 'billing-trade-prd-kr-vnet-01',
    subnet: 'billing-trade-prd-kr-snet-01',
    sql_server: 'billing-trade-prd-kr-sql-01',
    aks_nodepool_linux: 'nptradeprd',
    aks_nodepool_windows: 'nptrd',
  },
};

describe('호환 — 기본 문맥의 이름 24개 (리터럴)', () => {
  it('generate 의 이름 · 판정이 리터럴과 같다', () => {
    const parsed = parseContext(BASE);
    if (!parsed.ok) throw new Error('기본 문맥이 파싱되지 않는다');
    const out = generate(parsed.context);
    const actual = Object.fromEntries(Object.entries(out).map(([p, byType]) => [p, Object.fromEntries(Object.entries(byType!).map(([t, r]) => [t, r.name]))]));
    expect(actual).toEqual(EXPECTED);
    expect(Object.values(EXPECTED).flatMap((byType) => Object.keys(byType))).toHaveLength(24);
    for (const byType of Object.values(out)) for (const r of Object.values(byType!)) expect(r.valid, r.ruleId).toBe(true);
  });
});
