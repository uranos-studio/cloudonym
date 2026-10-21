// catalog 생성기 (D46) — catalog/gcp.json · catalog/aws.json · catalog/regions.json(정본)을 스키마로 검사한 뒤
// src/core/rules/gcp-catalog.ts · src/core/regions-data.ts 를 쓴다(종류 표의 확인일은 kind-sources.json 에서). 개발 때만 돈다 — 엔진은 JSON 을 읽지 않고 생성 TS 를 들여온다(D9).
// aws.json 은 검사만 하고 기본으로는 쓰지 않는다 — src/core 에 파일이 하나 늘면 규칙 지문(D26)이 바뀌므로 AWS 를 켜는 커밋에서 --aws 로 aws-catalog.ts 를 함께 쓴다
// 사용: node scripts/catalog/build-catalog.mjs [--aws]   (npm run catalog)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import Ajv from 'ajv';

const HEADER = '// 생성 파일 — 손으로 고치지 않는다. scripts/catalog/build-catalog.mjs 가 catalog/';

/** catalog 폴더의 JSON 다섯 */
export function loadCatalog(root) {
  const read = (f) => JSON.parse(readFileSync(join(root, 'catalog', f), 'utf-8'));
  return { gcp: read('gcp.json'), aws: read('aws.json'), regions: read('regions.json'), kindSources: read('kind-sources.json'), schema: read('schema.json') };
}

/** 스키마를 어기면 던진다 — 생성 파일에 틀린 데이터가 들어가지 않게 */
export function validateCatalog({ gcp, aws, regions, kindSources, schema }) {
  const ajv = new Ajv({ allErrors: true });
  ajv.addSchema(schema, 'catalog');
  for (const [name, ref, data] of [['gcp.json', 'catalog', gcp], ['aws.json', 'catalog', aws], ['regions.json', 'catalog#/definitions/regions', regions], ['kind-sources.json', 'catalog#/definitions/kindSources', kindSources]]) {
    if (!ajv.validate(ref, data)) throw new Error(`${name} 이 schema 를 어겼다: ${ajv.errorsText()}`);
  }
  // 스키마가 meta 를 보장한 뒤에 본다 — 먼저 보면 meta 가 없을 때 스키마 오류 대신 TypeError 로 죽는다
  if (gcp.meta.provider !== 'gcp') throw new Error(`gcp.json 의 meta.provider 가 ${gcp.meta.provider} 다`);
  if (aws.meta.provider !== 'aws') throw new Error(`aws.json 의 meta.provider 가 ${aws.meta.provider} 다`);
}

/** JSON 값을 TS 리터럴로 — JSON.stringify 가 따옴표 · 제어 문자를 이스케이프하고, JS 줄 끝 문자 둘은 따로 막는다 */
function literal(v) {
  return JSON.stringify(v, null, 2).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** 종류 표가 있는 행마다 kind-sources.json 의 checked 가운데 가장 늦은 날 — 전사가 없거나 날이 없으면 null */
export function kindChecked(gcp, kindSources) {
  const out = {};
  for (const row of gcp.rows) {
    if (!row.kind) continue;
    const dates = (kindSources.rows[row.key] ?? []).map((e) => e.checked).filter((d) => typeof d === 'string').sort();
    out[row.key] = dates.length > 0 ? dates[dates.length - 1] : null;
  }
  return out;
}

export function renderGcpCatalog(gcp, kindSources = { rows: {} }) {
  return `${HEADER}gcp.json 에서 만든다 (D46).
// 행 하나 = 화면 행 하나. rules 는 규칙 id → 그 규칙의 범위 · 지역 토큰 종류 · 허용 종류(D52). 규칙에 덮어쓰는 일은 rules/gcp.ts 가 한다
import type { Category, RegionToken } from '../types';

/** 범위 선택지 — 'namespace' · 'project' · 'location' · 'global' · 'region' · 'zone' · 'in <부모 resourceType>' */
export type ScopeChoice = string;
export type { RegionToken };

export interface RuleKinds { default: string | null; allowed: readonly string[] }
export interface CatalogRuleSpec { scope: ScopeChoice; regionToken: RegionToken; kinds?: RuleKinds }

/** 행 공통 종류 표 — 값 → 토큰(null 은 토큰 없음). 어느 값이 기본인지 · 되는지는 규칙의 kinds 가 정한다 */
export interface KindSpec {
  rule: 'omit-when-csp-default' | 'only-when-chosen' | 'required';
  defaultBasis: string;
  tokens: Readonly<Record<string, string | null>>;
  omitValues: readonly string[];
  source: string;
}

export interface CatalogRow {
  key: string;
  displayName: string;
  category: Category;
  rules: Readonly<Record<string, CatalogRuleSpec>>;
  slug: { value: string; basis: string; previous: readonly string[] };
  entity: string | null;
  kind: KindSpec | null;
  info: string;
  enterNameAt: { gcloud: readonly string[]; terraform: readonly string[]; apiOnly: boolean; preview: boolean };
  badges: readonly ('api-only' | 'preview')[];
  aliases: readonly string[];
}

export const GCP_CATALOG_META = ${literal(gcp.meta)} as const;

export const GCP_CATALOG: readonly CatalogRow[] = ${literal(gcp.rows)};

/** 종류 표의 출처(기본값 근거 포함)를 사람이 마지막으로 열어 본 날 — 행 key → kind-sources.json 의 checked 가운데 가장 늦은 날 (D52 · §4-5).
 *  llms.txt 「Kind tokens」 절이 싣는다. 전사에 날이 없으면 null */
export const GCP_KIND_CHECKED: Readonly<Record<string, string | null>> = ${literal(kindChecked(gcp, kindSources))};
`;
}

/** aws.json → aws-catalog.ts. 행 꼴은 gcp-catalog.ts 의 CatalogRow 에서 enterNameAt 만 다르다(gcloud 대신 awsCli) */
export function renderAwsCatalog(aws) {
  return `${HEADER}aws.json 에서 만든다 (D46).
// 행 하나 = 화면 행 하나. 행 꼴은 gcp-catalog.ts 의 CatalogRow 에서 enterNameAt 만 다르다
import type { CatalogRow } from './gcp-catalog';

export interface AwsCatalogRow extends Omit<CatalogRow, 'enterNameAt'> {
  enterNameAt: { awsCli: readonly string[]; terraform: readonly string[]; apiOnly: boolean; preview: boolean };
}

export const AWS_CATALOG_META = ${literal(aws.meta)} as const;

export const AWS_CATALOG: readonly AwsCatalogRow[] = ${literal(aws.rows)};
`;
}

/** label — GCP 는 도시 · 나라(location), AWS · Azure 는 표시 이름 */
export function renderRegions(regions) {
  const gcp = regions.gcp.map((r) => ({ region: r.region, code: r.code, zones: r.zones, label: r.location }));
  const aws = regions.aws.map((r) => ({ region: r.region, code: r.code, zones: [], label: r.displayName }));
  const azure = regions.azure.map((r) => ({ region: r.region, code: r.code, zones: [], label: r.displayName }));
  const locations = regions.locations.gcp.map((l) => ({ location: l.location, code: l.code, type: l.type, label: l.description, rules: l.rules }));
  return `${HEADER}regions.json 에서 만든다 (D46 · D49).
// 지역 코드 표 — GCP 는 리전 · 존 · 멀티/이중 리전 위치, AWS · Azure 는 리전만. status: GCP final · AWS · Azure draft
import type { Provider } from './types';

export interface ZoneEntry { zone: string; code: string }
export interface RegionEntry { region: string; code: string; zones: readonly ZoneEntry[]; label: string }
/** 멀티 · 이중 리전 위치 (D78) — 받는 규칙만 받는다. rules 는 규칙 id → 그 위치를 적은 공식 문서 URL */
export interface LocationEntry { location: string; code: string; type: 'multi-region' | 'dual-region'; label: string; rules: Readonly<Record<string, string>> }

export const REGIONS_META = ${literal(regions.meta)} as const;

export const REGIONS: Readonly<Record<Provider, readonly RegionEntry[]>> = ${literal({ gcp, aws, azure })};

export const LOCATIONS: Readonly<Record<Provider, readonly LocationEntry[]>> = ${literal({ gcp: locations, aws: [], azure: [] })};
`;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const catalog = loadCatalog(root);
  validateCatalog(catalog);
  writeFileSync(join(root, 'src/core/rules/gcp-catalog.ts'), renderGcpCatalog(catalog.gcp, catalog.kindSources));
  writeFileSync(join(root, 'src/core/regions-data.ts'), renderRegions(catalog.regions));
  if (process.argv.includes('--aws')) writeFileSync(join(root, 'src/core/rules/aws-catalog.ts'), renderAwsCatalog(catalog.aws));
  console.log(`gcp-catalog.ts ${catalog.gcp.rows.length}행 · aws.json ${catalog.aws.rows.length}행(${process.argv.includes('--aws') ? 'aws-catalog.ts 씀' : '검사만'}) · regions-data.ts gcp ${catalog.regions.gcp.length} · aws ${catalog.regions.aws.length} · azure ${catalog.regions.azure.length}`);
}
