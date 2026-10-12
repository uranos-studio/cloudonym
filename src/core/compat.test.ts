// 호환 불변식 — 기본 문맥(baseline 의 base)에서 만드는 이름 35개를(처음 24개 + 2026-10-06 에 더한 11종) 문자열 리터럴로 고정한다.
// 순번 · 역할을 항목 입력으로 받게 되어도(D30') 기본값(count 1 → 01 · role sync)이면 지금 출력과 글자 하나 다르지 않아야 한다.
// baseline.json 은 UPDATE_BASELINE 으로 다시 쓸 수 있지만 이 파일은 손으로만 바뀐다 — 바뀌었다면 이름이 달라진 것이다
import { describe, it, expect } from 'vitest';
import { generate, generateMany, parseContext } from './engine';
import { getRule } from './constraints';
import { PROVIDERS, type GenerateOutput } from './types';

const BASE = { owner: 'platform', system: 'billing', purpose: 'trade', env: 'prod' };
/** 서울 — GCP 는 존 이름을 넣어도 리전 코드로 풀린다. compute_instance · disk 두 리터럴만 D50 revised 로 ane3a → ane3 */
const REGION = { gcp: 'asia-northeast3-a', aws: 'ap-northeast-2', azure: 'koreacentral' } as const;

/** 리터럴 가운데 유효하지 않은 것 — env prod(4자)로 Windows VM(15자)의 축소 예산이 MIN_TOKEN 아래가 되어 name.cannot_fit (D48).
 *  이름 리터럴은 축소를 포기한 그 이름이다 */
const CANNOT_FIT = new Set(['azure.virtual_machine_windows']);

const EXPECTED: Record<string, Record<string, string>> = {
  aws: {
    s3_bucket: 'platform-billing-trade-prod-bucket',
    iam_role: 'billing-trade-prod-role-sync',
    vpc: 'billing-trade-prod-apne2-vpc-01',
    subnet: 'billing-trade-prod-apne2-subnet-01',
    ec2_instance: 'billing-trade-prod-apne2-vm-01',
    rds_instance: 'billing-trade-prod-apne2-db-01',
    internet_gateway: 'billing-trade-prod-apne2-igw-01',
    route_table: 'billing-trade-prod-apne2-rt-01',
    security_group: 'billing-trade-prod-apne2-sg-01',
    key_pair: 'billing-trade-prod-apne2-key-01',
    ebs_volume: 'billing-trade-prod-apne2-vol-01',
  },
  gcp: {
    project_id: 'platform-billing-trade-prod',
    service_account: 'billing-trade-prod-sa-sync',
    compute_instance: 'billing-trade-prod-ane3-gce-01',
    vpc_network: 'billing-trade-prod-vpc-01',
    subnet: 'billing-trade-prod-ane3-snet-01',
    cloud_sql_instance: 'billing-trade-prod-ane3-sql-01',
    storage_bucket: 'platform-billing-trade-prod-ane3-gcs',
    firewall_rule: 'billing-trade-prod-fw-01',
    disk: 'billing-trade-prod-ane3-disk-01',
  },
  azure: {
    resource_group: 'rg-billing-trade-prod',
    storage_account: 'stbillingtradeprod',
    key_vault: 'kv-billing-trade-prod',
    managed_identity: 'billing-trade-prod-id-sync',
    virtual_machine: 'billing-trade-prod-krc-vm-01',
    virtual_machine_windows: 'billing-trd-prod-vm-01',
    virtual_network: 'billing-trade-prod-krc-vnet-01',
    subnet: 'billing-trade-prod-krc-snet-01',
    sql_server: 'billing-trade-prod-krc-sql-01',
    aks_nodepool_linux: 'nptradeprod',
    aks_nodepool_windows: 'nptrd',
    public_ip: 'billing-trade-prod-krc-pip-01',
    network_security_group: 'billing-trade-prod-krc-nsg-01',
    network_interface: 'billing-trade-prod-krc-nic-01',
    os_disk: 'billing-trade-prod-krc-osdisk-01',
  },
};

describe('호환 — 기본 문맥의 이름 35개 (리터럴)', () => {
  it('generate 의 이름 · 판정이 리터럴과 같다', () => {
    const out: GenerateOutput = {};
    for (const p of PROVIDERS) {
      const parsed = parseContext({ ...BASE, region: REGION[p] }, p);
      if (!parsed.ok) throw new Error('기본 문맥이 파싱되지 않는다');
      out[p] = generate(parsed.context, [p])[p];
    }
    // 리터럴에 있는 35종만 본다 — 뒤에 들인 규칙(Azure 정형 행 등)은 이 불변식 밖이다
    const actual = Object.fromEntries(Object.entries(out).map(([p, byType]) => [p, Object.fromEntries(Object.entries(byType!)
      .filter(([t]) => t in (EXPECTED as Record<string, Record<string, string>>)[p]!).map(([t, r]) => [t, r.name]))]));
    expect(actual).toEqual(EXPECTED);
    expect(Object.values(EXPECTED).flatMap((byType) => Object.keys(byType))).toHaveLength(35);
    for (const [p, byType] of Object.entries(out)) for (const [t, r] of Object.entries(byType!)) if (t in (EXPECTED as Record<string, Record<string, string>>)[p]!) expect(r.valid, r.ruleId).toBe(!CANNOT_FIT.has(r.ruleId));
  });
});

describe('호환 — 종류 토큰 (D52)', () => {
  it('종류를 고르면 약어 바로 뒤에 토큰 · 기본값을 고르면 위 리터럴과 글자 하나 다르지 않다', () => {
    const parsed = parseContext({ ...BASE, region: REGION.gcp }, 'gcp');
    if (!parsed.ok) throw new Error('기본 문맥이 파싱되지 않는다');
    const r = generateMany(parsed.context, 'gcp', [
      { rule: getRule('gcp', 'cloud_sql_instance')!, count: 1, kind: 'POSTGRES' }, { rule: getRule('gcp', 'subnet')!, count: 1, kind: 'PRIVATE' },
      { rule: getRule('gcp', 'firewall_rule')!, count: 1, kind: 'EGRESS' },
    ]);
    expect(r.items.map((i) => i.name)).toEqual(['billing-trade-prod-ane3-sql-pg-01', EXPECTED.gcp!.subnet, 'billing-trade-prod-fw-egr-01']);
  });
});
