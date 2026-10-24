// catalog 정본 (D46 · D47 · D52 · D54) — catalog/*.json 이 스키마를 만족하고, 생성 TS 가 JSON 과 같고,
// GCP 규칙 표와 catalog 의 ruleIds 가 양방향으로 맞는지 센다. 규칙에 덮어쓰는 일(applyCatalog)은 여기서 보지 않는다
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import { GCP_BASE_RULES, GCP_RULES } from './rules/gcp';
import { GCP_CATALOG } from './rules/gcp-catalog';
import { AWS_CATALOG } from './rules/aws-catalog';
import { REGIONS } from './regions-data';
import { catalogFor, rowOf, allowedKinds, regionTokenOf, kindToken, kindTokenOf, MAX_KIND_CHARS, MAX_KIND_VALUE_CHARS } from './catalog';

const CATALOG_DIR = join(import.meta.dirname, '..', '..', 'catalog');
const readJson = (f: string) => JSON.parse(readFileSync(join(CATALOG_DIR, f), 'utf-8'));
const gcpJson = readJson('gcp.json');
const regionsJson = readJson('regions.json');
const kindSourcesJson = readJson('kind-sources.json');
const schema = readJson('schema.json');

const ruleIdsOfCatalog = GCP_CATALOG.flatMap((r) => Object.keys(r.rules));

/** catalog 와 규칙 표가 어긋나는 자리 — 이름을 적어 두고 하나씩만 허용한다 */
// 디스크 행은 gcp.disk(compute) 와 gcp.region_disk(storage) 를 합쳤다 — 행 category 는 첫 규칙을 따르고, applyCatalog 는 category 를 덮지 않는다(덮는 칸은 약어 · entity · 지역 토큰 · 종류뿐)
const CATEGORY_EXCEPTIONS = new Set(['gcp.region_disk']);

describe('catalog 스키마 (D46 ⑴)', () => {
  const ajv = new Ajv({ allErrors: true });
  ajv.addSchema(schema, 'catalog');

  it('검사기 자체 — 칸이 빠진 행 · 6자 종류 토큰 · 모르는 표지를 거부한다', () => {
    const validate = ajv.getSchema('catalog')!;
    const row = structuredClone(gcpJson.rows[0]);
    delete row.info;
    expect(validate({ ...gcpJson, rows: [row] })).toBe(false);
    const subnet = structuredClone(gcpJson.rows.find((r: { key: string }) => r.key === 'gcp.subnet'));
    subnet.kind.tokens.PRIVATE_NAT = 'natgw1';
    expect(validate({ ...gcpJson, rows: [subnet] })).toBe(false);
    const badged = { ...structuredClone(gcpJson.rows[0]), badges: ['beta'] };
    expect(validate({ ...gcpJson, rows: [badged] })).toBe(false);
  });

  it('gcp.json · regions.json · kind-sources.json 이 스키마를 만족한다', () => {
    expect(ajv.validate('catalog', gcpJson), ajv.errorsText()).toBe(true);
    expect(ajv.validate('catalog#/definitions/regions', regionsJson), ajv.errorsText()).toBe(true);
    expect(ajv.validate('catalog#/definitions/kindSources', kindSourcesJson), ajv.errorsText()).toBe(true);
  });
});

describe('생성 TS = JSON (D46 ⑵)', () => {
  it('GCP_CATALOG 는 gcp.json 의 rows 그대로다', () => {
    expect(GCP_CATALOG).toEqual(gcpJson.rows);
  });

  it('REGIONS 는 regions.json 그대로다 — label 은 GCP location · AWS · Azure displayName', () => {
    expect(REGIONS.gcp).toEqual(regionsJson.gcp.map((r: { region: string; code: string; location: string; zones: unknown[] }) => ({ region: r.region, code: r.code, zones: r.zones, label: r.location })));
    expect(REGIONS.aws).toEqual(regionsJson.aws.map((r: { region: string; code: string; displayName: string }) => ({ region: r.region, code: r.code, zones: [], label: r.displayName })));
    expect(REGIONS.azure).toEqual(regionsJson.azure.map((r: { region: string; code: string; displayName: string }) => ({ region: r.region, code: r.code, zones: [], label: r.displayName })));
  });

  it('지역 수 — GCP 43 리전 · 130 존 · AWS 34 · Azure 57', () => {
    expect(REGIONS.gcp).toHaveLength(43);
    expect(REGIONS.gcp.flatMap((r) => r.zones)).toHaveLength(130);
    expect(REGIONS.aws).toHaveLength(34);
    expect(REGIONS.azure).toHaveLength(57);
  });
});

describe('GCP 규칙 ↔ catalog (D46 ⑶)', () => {
  it('118행 · 규칙 139 · 행 key 가 겹치지 않는다', () => {
    expect(GCP_CATALOG).toHaveLength(118);
    expect(new Set(GCP_CATALOG.map((r) => r.key)).size).toBe(118);
    expect(ruleIdsOfCatalog).toHaveLength(139);
  });

  it('모든 GCP 규칙 id 가 catalog 에 정확히 한 번 있고, catalog 의 모든 ruleId 가 규칙 표에 있다', () => {
    expect([...ruleIdsOfCatalog].sort()).toEqual(Object.keys(GCP_RULES).sort());
  });

  it('행 category 는 규칙 category 와 같다 (이름 붙인 예외 하나)', () => {
    const bad = GCP_CATALOG.flatMap((row) => Object.keys(row.rules)
      .filter((id) => GCP_RULES[id]!.category !== row.category && !CATEGORY_EXCEPTIONS.has(id)).map((id) => `${row.key}:${id}`));
    expect(bad).toEqual([]);
    // 예외는 실제로 어긋나는 것만 둔다 — 고쳐지면 예외를 지운다
    for (const id of CATEGORY_EXCEPTIONS) expect(GCP_RULES[id]!.category).not.toBe(rowOf(id)!.category);
  });

  it('범위 낱말이 규칙 scope 와 맞는다 — project_global → global · project_region → region · project_zone → zone · 그 밖 in <부모>', () => {
    const words: Record<string, string> = { 'gcp:project_global': 'global', 'gcp:project_region': 'region', 'gcp:project_zone': 'zone', 'gcp:project': 'project', 'gcp:namespace': 'namespace', 'gcp:project_location': 'location' };
    const word = (scope: string) => words[scope] ?? `in ${scope.slice('gcp:'.length)}`;
    for (const row of GCP_CATALOG) for (const [id, spec] of Object.entries(row.rules)) expect(spec.scope, id).toBe(word(GCP_RULES[id]!.scope));
  });
});

describe('regionToken 불변식 (§4-1)', () => {
  /** D77 — 위치가 없는 리소스(global 전용 · 경로에 location 없음)와 부모의 위치를 물려받는 자식. spanner_instance_partition 은 자기 위치를 골라 남는다 */
  const D77 = ['gcp.service_account', 'gcp.iam_deny_policy', 'gcp.iam_oauth_client', 'gcp.iam_oauth_client_credential', 'gcp.iam_workload_identity_pool',
    'gcp.iam_wip_managed_identity', 'gcp.iam_wip_namespace', 'gcp.iam_wip_provider', 'gcp.iam_wip_provider_key',
    'gcp.iam_workforce_pool_provider', 'gcp.iam_workforce_pool_provider_key', 'gcp.kms_crypto_key', 'gcp.kms_import_job',
    'gcp.spanner_database', 'gcp.spanner_backup', 'gcp.artifact_registry_rule', 'gcp.cloud_sql_database', 'gcp.cloud_sql_user', 'gcp.router_nat', 'gcp.cloudbuild_repository',
    'gcp.bigquery_table'];
  /** D79 — 위치가 global 하나인 IAM 셋(policy binding 은 탐침: asia-northeast3 403 · global 200) */
  const D79 = ['gcp.iam_policy_binding', 'gcp.iam_principal_access_boundary_policy', 'gcp.iam_workforce_pool'];
  const specs = GCP_CATALOG.flatMap((row) => Object.entries(row.rules));

  it('none 34 + 7 + 21 + 3 · region 74 — zone 은 없다 (D50 revised · D77 · D78 · D79)', () => {
    const count = (t: string) => specs.filter(([, s]) => s.regionToken === t).length;
    expect([count('none'), count('zone'), count('region')]).toEqual([65, 0, 74]);
    // none 의 내역 — gcp:project_global 34 · 그 밖 7(Project ID · Project name · Spanner 인스턴스 구성 · IAM 커스텀 역할 · DNS 영역 · Pub/Sub 둘) — 버킷 · BigQuery 데이터세트는 D78 로 region
    // · D77 의 21(위치가 없는 리소스 · 부모의 위치를 물려받는 자식 — D119 의 Cloud Build 저장소 · D132 의 BigQuery 테이블 포함) · D79 의 3(위치가 global 하나인 IAM)
    const none = specs.filter(([, s]) => s.regionToken === 'none').map(([id]) => id);
    expect(none.filter((id) => GCP_RULES[id]!.scope === 'gcp:project_global')).toHaveLength(34);
    expect(none.filter((id) => GCP_RULES[id]!.scope !== 'gcp:project_global' && !D77.includes(id) && !D79.includes(id)).sort()).toEqual(['gcp.dns_managed_zone', 'gcp.iam_custom_role', 'gcp.project_id', 'gcp.project_name', 'gcp.pubsub_subscription', 'gcp.pubsub_topic', 'gcp.spanner_instance_config']);
    for (const id of [...D77, ...D79]) expect(none, id).toContain(id);
  });

  it('none 인 규칙의 템플릿 · optional 에 region 이 없다 — 덮기 전 규칙 표에서 region 이 빠진 것은 전역 NEG 하나', () => {
    const bad = specs.filter(([id, s]) => s.regionToken === 'none' && (GCP_RULES[id]!.template.includes('region') || GCP_RULES[id]!.optional.includes('region'))).map(([id]) => id);
    expect(bad).toEqual([]);
    const removed = Object.keys(GCP_RULES).filter((id) => GCP_BASE_RULES[id]!.template.includes('region') && !GCP_RULES[id]!.template.includes('region'));
    // D77 의 21 가운데 서비스 계정은 덮기 전 규칙 표(rules/gcp.ts)에서 이미 region 을 뺐다 — 나머지 20 과 D79 의 3 이 catalog 로 빠진다
    expect(removed.sort()).toEqual(['gcp.global_network_endpoint_group', ...D77.filter((id) => id !== 'gcp.service_account'), ...D79].sort());
  });

  it('옛 존 규칙 14종은 region 이고 optional 에 region 이 있다 — 축소 1단계가 뗄 수 있다 (D50 revised · D51 철회)', () => {
    const ids = ['compute_instance', 'disk', 'autoscaler', 'future_reservation', 'instance_group_manager', 'instance_group', 'instant_snapshot_group',
      'instant_snapshot', 'reservation', 'storage_pool', 'target_instance', 'zone_vm_extension_policy', 'node_group', 'network_endpoint_group'].map((t) => `gcp.${t}`);
    for (const id of ids) {
      expect(specs.find(([x]) => x === id)?.[1].regionToken, id).toBe('region');
      expect(GCP_RULES[id]!.optional, id).toContain('region');
    }
    expect(specs.filter(([id]) => GCP_RULES[id]!.scope === 'gcp:project_zone').every(([, s]) => s.regionToken === 'region')).toBe(true);
  });

  it('region 인 규칙은 템플릿에 region 이 있다 · gcp:project_global 은 모두 none', () => {
    expect(specs.filter(([id, s]) => s.regionToken === 'region' && !GCP_RULES[id]!.template.includes('region'))).toEqual([]);
    expect(specs.filter(([id, s]) => GCP_RULES[id]!.scope === 'gcp:project_global' && s.regionToken !== 'none')).toEqual([]);
  });
});

describe('행 데이터 (D47 · D52 · D54)', () => {
  it('info 는 비어 있지 않은 한 문장 이상 · aliases 는 소문자이고 겹치지 않는다', () => {
    for (const row of GCP_CATALOG) {
      expect(row.info.trim().length, row.key).toBeGreaterThan(10);
      expect(row.aliases.every((a) => a === a.toLowerCase()), row.key).toBe(true);
      expect(new Set(row.aliases).size, row.key).toBe(row.aliases.length);
    }
  });

  it('badges — api-only 셋 · preview 하나', () => {
    const withBadge = (b: string) => GCP_CATALOG.filter((r) => (r.badges as readonly string[]).includes(b)).map((r) => r.key).sort();
    expect(withBadge('api-only')).toEqual(['gcp.license', 'gcp.region_health_check_service', 'gcp.region_notification_endpoint']);
    expect(withBadge('preview')).toEqual(['gcp.region_snapshot']);
    for (const row of GCP_CATALOG) {
      expect(row.enterNameAt.apiOnly, row.key).toBe(row.badges.includes('api-only'));
      expect(row.enterNameAt.preview, row.key).toBe(row.badges.includes('preview'));
    }
  });

  it('entity 는 함수 두 행만 cloudfunctions.functions', () => {
    const withEntity = GCP_CATALOG.filter((r) => r.entity !== null);
    expect(withEntity.map((r) => [r.key, r.entity])).toEqual([
      ['gcp.cloud_function_gen1', 'cloudfunctions.functions'],
      ['gcp.cloud_function', 'cloudfunctions.functions'],
    ]);
  });

  it('slug.previous 에 지금 약어가 없고 별칭에 옛 약어가 들어 있다', () => {
    for (const row of GCP_CATALOG) {
      expect(row.slug.previous, row.key).not.toContain(row.slug.value);
      for (const p of row.slug.previous) expect(row.aliases, row.key).toContain(p);
    }
    expect(rowOf('gcp.address')!.aliases).toEqual(expect.arrayContaining(['google_compute_address', 'add']));
  });

  it('공개 데이터에 한글 · 과정 표현이 없다', () => {
    const text = ['gcp.json', 'regions.json', 'kind-sources.json', 'schema.json'].map((f) => readFileSync(join(CATALOG_DIR, f), 'utf-8')).join('\n');
    expect(text).not.toMatch(/\p{Script=Hangul}/u);
    expect(text).not.toMatch(/owner decision|codex|§|v1 said|unchanged|not measured|is now/i);
  });
});

describe('종류 표 (D52)', () => {
  const kindRows = GCP_CATALOG.filter((r) => r.kind !== null);

  it('종류 표가 있는 행은 19 — 디스크는 없다', () => {
    expect(kindRows).toHaveLength(19);
    expect(rowOf('gcp.disk')!.kind).toBeNull();
  });

  it('규칙마다 kinds 가 있는 것은 종류 표가 있는 행뿐이다', () => {
    for (const row of GCP_CATALOG) for (const [id, spec] of Object.entries(row.rules)) expect(spec.kinds !== undefined, id).toBe(row.kind !== null);
  });

  it('default ∈ allowed ∪ {null} · allowed ⊆ keys(tokens) · required · only-when-chosen 이면 default 는 null', () => {
    for (const row of kindRows) {
      const tokens = row.kind!.tokens;
      for (const [id, spec] of Object.entries(row.rules)) {
        const k = spec.kinds!;
        if (k.default !== null) expect(k.allowed, id).toContain(k.default);
        for (const v of k.allowed) expect(Object.keys(tokens), id).toContain(v);
        if (row.kind!.rule !== 'omit-when-csp-default') expect(k.default, id).toBeNull();
      }
    }
  });

  it('tokens[v] === null ⇔ v ∈ omitValues ∪ {어느 규칙의 default}', () => {
    for (const row of kindRows) {
      const defaults = Object.values(row.rules).map((s) => s.kinds!.default).filter((d): d is string => d !== null);
      const silent = new Set([...row.kind!.omitValues, ...defaults]);
      for (const [v, t] of Object.entries(row.kind!.tokens)) expect(t === null, `${row.key} ${v}`).toBe(silent.has(v));
    }
  });

  it(`토큰 길이 ≤ MAX_KIND_CHARS(${MAX_KIND_CHARS}) · 소문자 · 숫자`, () => {
    expect(MAX_KIND_CHARS).toBe(5);
    for (const row of kindRows) for (const t of Object.values(row.kind!.tokens)) if (t !== null) expect(t, row.key).toMatch(/^[a-z0-9]{1,5}$/);
  });

  it(`값 이름 길이 ≤ MAX_KIND_VALUE_CHARS(${MAX_KIND_VALUE_CHARS}) — 상수는 catalog 의 가장 긴 값 이름과 같다 · 값 이름은 대문자 · 숫자 · _ 또는 소문자 · 숫자 · -`, () => {
    const values = kindRows.flatMap((row) => Object.keys(row.kind!.tokens));
    expect(MAX_KIND_VALUE_CHARS).toBe(Math.max(...values.map((v) => v.length)));
    for (const v of values) expect(v).toMatch(/^(?:[A-Z][A-Z0-9_]*|[a-z][a-z0-9-]*)$/);
  });

  it('required 행의 규칙 default 는 전부 null · NEG 세 규칙의 default 는 GCE_VM_IP_PORT · SERVERLESS · null', () => {
    for (const row of kindRows.filter((r) => r.kind!.rule === 'required')) for (const [id, spec] of Object.entries(row.rules)) expect(spec.kinds!.default, id).toBeNull();
    const neg = rowOf('gcp.network_endpoint_group')!.rules;
    expect(['gcp.network_endpoint_group', 'gcp.region_network_endpoint_group', 'gcp.global_network_endpoint_group'].map((id) => neg[id]!.kinds!.default)).toEqual(['GCE_VM_IP_PORT', 'SERVERLESS', null]);
  });

  it('정정 — instance-schedule → isc · NEG SERVERLESS 토큰 없음 · backend service · 포워딩 규칙 omitValues 둘', () => {
    expect(rowOf('gcp.resource_policy')!.kind!.tokens['instance-schedule']).toBe('isc');
    expect(rowOf('gcp.region_network_endpoint_group')!.kind!.tokens.SERVERLESS).toBeNull();
    expect(rowOf('gcp.backend_service')!.kind!.omitValues).toEqual(['EXTERNAL', 'EXTERNAL_MANAGED']);
    expect(rowOf('gcp.forwarding_rule')!.kind!.omitValues).toEqual(['EXTERNAL', 'EXTERNAL_MANAGED']);
  });
});

describe('catalog.ts 순수 함수', () => {
  const rule = (id: string) => GCP_RULES[id]!;

  it('catalogFor — GCP 118행 · AWS 170행 · catalog 가 없는 CSP 는 빈 배열', () => {
    expect(catalogFor('gcp')).toBe(GCP_CATALOG);
    expect(catalogFor('aws')).toBe(AWS_CATALOG);
    expect(AWS_CATALOG).toHaveLength(170);
    expect(catalogFor('azure')).toEqual([]);
  });

  it('rowOf — 규칙 · 규칙 id 둘 다 받고, 합친 행의 규칙은 같은 행을 준다', () => {
    expect(rowOf(rule('gcp.global_address'))!.key).toBe('gcp.address');
    expect(rowOf('gcp.address')).toBe(rowOf('gcp.global_address'));
    expect(rowOf('aws.s3_bucket')!.key).toBe('aws.s3_bucket');
    expect(rowOf('azure.storage_account')).toBeUndefined();
  });

  it('regionTokenOf — catalog 값 · catalog 밖 규칙은 템플릿으로', () => {
    expect(regionTokenOf(rule('gcp.compute_instance'))).toBe('region');
    expect(regionTokenOf(rule('gcp.vpc_network'))).toBe('none');
    expect(regionTokenOf(rule('gcp.global_network_endpoint_group'))).toBe('none');
    expect(regionTokenOf(rule('gcp.subnet'))).toBe('region');
    expect(regionTokenOf({ id: 'aws.x', template: ['system', 'region', 'slug'] })).toBe('region');
    expect(regionTokenOf({ id: 'aws.y', template: ['system', 'slug'] })).toBe('none');
  });

  it('allowedKinds — 범위마다 다르다 · 종류 표 없는 규칙은 빈 배열', () => {
    expect(allowedKinds(rule('gcp.global_network_endpoint_group'))).toEqual(['INTERNET_IP_PORT', 'INTERNET_FQDN_PORT']);
    expect(allowedKinds(rule('gcp.network_endpoint_group'))).not.toContain('SERVERLESS');
    expect(allowedKinds(rule('gcp.vpc_network'))).toEqual([]);
  });

  it('kindToken — 기본값 · omitValues 는 토큰 없음 · 허용 밖은 오류 · 범위를 바꾸면 결과가 바뀐다', () => {
    expect(kindToken(rule('gcp.region_network_endpoint_group'), 'SERVERLESS')).toBeNull();
    expect(kindToken(rule('gcp.network_endpoint_group'), 'SERVERLESS')).toBeInstanceOf(Error);
    expect(kindToken(rule('gcp.global_network_endpoint_group'), 'GCE_VM_IP')).toBeInstanceOf(Error);
    expect(kindToken(rule('gcp.region_network_endpoint_group'), 'GCE_VM_IP_PORTMAP')).toBe('pmap');
    expect(kindToken(rule('gcp.backend_service'), 'EXTERNAL_MANAGED')).toBeNull();
    expect(kindToken(rule('gcp.backend_service'), 'INTERNAL_SELF_MANAGED')).toBe('int');
    expect(kindToken(rule('gcp.backend_service'), 'INTERNAL')).toBeInstanceOf(Error);
    expect(kindToken(rule('gcp.region_backend_service'), 'INTERNAL')).toBe('int');
    // 같은 값 · 다른 범위 — 영역 NEG 의 기본값은 지역 NEG 에서 허용 밖이다
    expect(kindToken(rule('gcp.network_endpoint_group'), 'GCE_VM_IP_PORT')).toBeNull();
    expect(kindToken(rule('gcp.region_network_endpoint_group'), 'GCE_VM_IP_PORT')).toBeInstanceOf(Error);
    expect(kindToken(rule('gcp.resource_policy'), 'instance-schedule')).toBe('isc');
    expect(kindToken(rule('gcp.vpc_network'), 'EXTERNAL')).toBeInstanceOf(Error);
  });

  it('kindTokenOf — 허용 값인데 tokens 에 키가 없으면 던진다(토큰 없음으로 삼키지 않는다) · 키가 있으면 그 값', () => {
    const row = rowOf('gcp.address')!;
    expect(kindTokenOf(row, 'gcp.address', 'INTERNAL')).toBe('int');
    const { INTERNAL: _gone, ...rest } = row.kind!.tokens;
    const broken = { ...row, kind: { ...row.kind!, tokens: rest } };
    expect(() => kindTokenOf(broken, 'gcp.address', 'INTERNAL')).toThrow(/INTERNAL/);
    // tokens 의 키가 있고 값이 null 이면 토큰 없음 — 기본값이 아닌 null 은 불변식 시험이 막지만, 함수는 그대로 돌려준다
    const nulled = { ...row, kind: { ...row.kind!, tokens: { ...row.kind!.tokens, INTERNAL: null } } };
    expect(kindTokenOf(nulled, 'gcp.address', 'INTERNAL')).toBeNull();
  });
});
