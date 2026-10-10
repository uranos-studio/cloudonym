// catalog 생성기 (D46) — catalog/gcp.json · catalog/regions.json(정본)을 스키마로 검사한 뒤
// src/core/rules/gcp-catalog.ts · src/core/regions-data.ts 를 쓴다(종류 표의 확인일은 kind-sources.json 에서). 개발 때만 돈다 — 엔진은 JSON 을 읽지 않고 생성 TS 를 들여온다(D9).
// 사용: node scripts/catalog/build-catalog.mjs   (npm run catalog)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import Ajv from 'ajv';

const HEADER = '// 생성 파일 — 손으로 고치지 않는다. scripts/catalog/build-catalog.mjs 가 catalog/';

/** catalog 폴더의 JSON 넷 */
export function loadCatalog(root) {
  const read = (f) => JSON.parse(readFileSync(join(root, 'catalog', f), 'utf-8'));
  return { gcp: read('gcp.json'), regions: read('regions.json'), kindSources: read('kind-sources.json'), schema: read('schema.json') };
}

/** 스키마를 어기면 던진다 — 생성 파일에 틀린 데이터가 들어가지 않게 */
export function validateCatalog({ gcp, regions, kindSources, schema }) {
  const ajv = new Ajv({ allErrors: true });
  ajv.addSchema(schema, 'catalog');
  for (const [name, ref, data] of [['gcp.json', 'catalog', gcp], ['regions.json', 'catalog#/definitions/regions', regions], ['kind-sources.json', 'catalog#/definitions/kindSources', kindSources]]) {
    if (!ajv.validate(ref, data)) throw new Error(`${name} 이 schema 를 어겼다: ${ajv.errorsText()}`);
  }
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

/** label — GCP 는 도시 · 나라(location), AWS · Azure 는 표시 이름 */
export function renderRegions(regions) {
  const gcp = regions.gcp.map((r) => ({ region: r.region, code: r.code, zones: r.zones, label: r.location }));
  const aws = regions.aws.map((r) => ({ region: r.region, code: r.code, zones: [], label: r.displayName }));
  const azure = regions.azure.map((r) => ({ region: r.region, code: r.code, zones: [], label: r.displayName }));
  return `${HEADER}regions.json 에서 만든다 (D46 · D49).
// 지역 코드 표 — GCP 는 리전 · 존, AWS · Azure 는 리전만. status: GCP final · AWS · Azure draft
import type { Provider } from './types';

export interface ZoneEntry { zone: string; code: string }
export interface RegionEntry { region: string; code: string; zones: readonly ZoneEntry[]; label: string }

export const REGIONS_META = ${literal(regions.meta)} as const;

export const REGIONS: Readonly<Record<Provider, readonly RegionEntry[]>> = ${literal({ gcp, aws, azure })};
`;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const catalog = loadCatalog(root);
  validateCatalog(catalog);
  writeFileSync(join(root, 'src/core/rules/gcp-catalog.ts'), renderGcpCatalog(catalog.gcp, catalog.kindSources));
  writeFileSync(join(root, 'src/core/regions-data.ts'), renderRegions(catalog.regions));
  console.log(`gcp-catalog.ts ${catalog.gcp.rows.length}행 · regions-data.ts gcp ${catalog.regions.gcp.length} · aws ${catalog.regions.aws.length} · azure ${catalog.regions.azure.length}`);
}
