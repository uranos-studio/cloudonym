// catalog 정본 (D46 · D47 · D52 · D54) — catalog/*.json 이 스키마를 만족하고, 생성 TS 가 JSON 과 같고,
// GCP 규칙 표와 catalog 의 ruleIds 가 양방향으로 맞는지 센다. 규칙에 덮어쓰는 일(applyCatalog)은 여기서 보지 않는다
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import { GCP_RULES } from './rules/gcp';
import { GCP_CATALOG } from './rules/gcp-catalog';
import { REGIONS } from './regions-data';
import { catalogFor, rowOf, allowedKinds, regionTokenOf, kindToken, MAX_KIND_CHARS } from './catalog';

const CATALOG_DIR = join(import.meta.dirname, '..', '..', 'catalog');
const readJson = (f: string) => JSON.parse(readFileSync(join(CATALOG_DIR, f), 'utf-8'));
const gcpJson = readJson('gcp.json');
const regionsJson = readJson('regions.json');
const kindSourcesJson = readJson('kind-sources.json');
const schema = readJson('schema.json');

const ruleIdsOfCatalog = GCP_CATALOG.flatMap((r) => Object.keys(r.rules));

/** 승인 데이터와 규칙 표가 어긋나는 자리 — 이름을 적어 두고 하나씩만 허용한다 */
// 디스크 행은 gcp.disk(compute) 와 gcp.region_disk(storage) 를 합쳤다 — 행 category 는 첫 규칙을 따른다
const CATEGORY_EXCEPTIONS = new Set(['gcp.region_disk']);
// 전역 NEG 는 손 규칙 템플릿에 region 이 있다 — catalog 를 규칙에 덮는 일(applyCatalog)이 들어오면 이 예외를 지운다
const REGION_IN_TEMPLATE_EXCEPTIONS = new Set(['gcp.global_network_endpoint_group']);

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
  it('100행 · 규칙 121 · 행 key 가 겹치지 않는다', () => {
    expect(GCP_CATALOG).toHaveLength(100);
    expect(new Set(GCP_CATALOG.map((r) => r.key)).size).toBe(100);
    expect(ruleIdsOfCatalog).toHaveLength(121);
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
  const specs = GCP_CATALOG.flatMap((row) => Object.entries(row.rules));

  it('none 34 + 4 · zone 14 · region 69', () => {
    const count = (t: string) => specs.filter(([, s]) => s.regionToken === t).length;
    expect([count('none'), count('zone'), count('region')]).toEqual([38, 14, 69]);
  });

  it('none 인 규칙의 템플릿에 region 이 없다 (이름 붙인 예외 하나)', () => {
    const bad = specs.filter(([id, s]) => s.regionToken === 'none' && GCP_RULES[id]!.template.includes('region') && !REGION_IN_TEMPLATE_EXCEPTIONS.has(id)).map(([id]) => id);
    expect(bad).toEqual([]);
    for (const id of REGION_IN_TEMPLATE_EXCEPTIONS) expect(GCP_RULES[id]!.template).toContain('region');
  });

  it('zone 인 규칙은 gcp:project_zone 범위이거나 compute_instance 다', () => {
    const bad = specs.filter(([id, s]) => s.regionToken === 'zone' && GCP_RULES[id]!.scope !== 'gcp:project_zone' && id !== 'gcp.compute_instance');
    expect(bad).toEqual([]);
    expect(specs.filter(([id]) => GCP_RULES[id]!.scope === 'gcp:project_zone').every(([, s]) => s.regionToken === 'zone')).toBe(true);
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
    expect(text).not.toMatch(/owner decision|codex|§|v1 said/i);
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

  it('정정 — instance-schedule → isc · NEG SERVERLESS 토큰 없음 · backend service · 포워딩 규칙 omitValues 둘', () => {
    expect(rowOf('gcp.resource_policy')!.kind!.tokens['instance-schedule']).toBe('isc');
    expect(rowOf('gcp.region_network_endpoint_group')!.kind!.tokens.SERVERLESS).toBeNull();
    expect(rowOf('gcp.backend_service')!.kind!.omitValues).toEqual(['EXTERNAL', 'EXTERNAL_MANAGED']);
    expect(rowOf('gcp.forwarding_rule')!.kind!.omitValues).toEqual(['EXTERNAL', 'EXTERNAL_MANAGED']);
  });
});

describe('catalog.ts 순수 함수', () => {
  const rule = (id: string) => GCP_RULES[id]!;

  it('catalogFor — GCP 는 100행 · catalog 가 없는 CSP 는 빈 배열', () => {
    expect(catalogFor('gcp')).toBe(GCP_CATALOG);
    expect(catalogFor('aws')).toEqual([]);
    expect(catalogFor('azure')).toEqual([]);
  });

  it('rowOf — 규칙 · 규칙 id 둘 다 받고, 합친 행의 규칙은 같은 행을 준다', () => {
    expect(rowOf(rule('gcp.global_address'))!.key).toBe('gcp.address');
    expect(rowOf('gcp.address')).toBe(rowOf('gcp.global_address'));
    expect(rowOf('aws.s3_bucket')).toBeUndefined();
  });

  it('regionTokenOf — catalog 값 · catalog 밖 규칙은 템플릿으로', () => {
    expect(regionTokenOf(rule('gcp.compute_instance'))).toBe('zone');
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
});
