// catalog 조회 (D46 · D52) — 생성 파일 rules/gcp-catalog.ts 를 읽는 순수 함수. 규칙에 덮어쓰는 일은 rules/gcp.ts 가 한다
import type { Provider, ResourceRule } from './types';
import { GCP_CATALOG, type CatalogRow, type RegionToken } from './rules/gcp-catalog';

/** 종류 토큰 길이 상한 — proxy · grpcs · https 가 5자다 */
export const MAX_KIND_CHARS = 5;

const EMPTY: readonly CatalogRow[] = [];

/** provider 의 catalog 행 — 아직 catalog 가 없는 CSP 는 빈 배열 */
export function catalogFor(provider: Provider): readonly CatalogRow[] {
  return provider === 'gcp' ? GCP_CATALOG : EMPTY;
}

/** 규칙 id → 그 규칙을 담은 행 */
const ROW_BY_RULE: ReadonlyMap<string, CatalogRow> = new Map(GCP_CATALOG.flatMap((row) => Object.keys(row.rules).map((id) => [id, row] as const)));

type RuleRef = Pick<ResourceRule, 'id'> | string;
const idOf = (rule: RuleRef): string => (typeof rule === 'string' ? rule : rule.id);

export function rowOf(rule: RuleRef): CatalogRow | undefined {
  return ROW_BY_RULE.get(idOf(rule));
}

/** 그 규칙(= 범위)에서 고를 수 있는 종류 값 — 종류 표가 없으면 빈 배열 */
export function allowedKinds(rule: RuleRef): readonly string[] {
  const id = idOf(rule);
  return rowOf(id)?.rules[id]?.kinds?.allowed ?? [];
}

/** 지역 자리에 무엇이 오나 — catalog 값, catalog 밖 규칙은 템플릿에 region 이 있으면 region */
export function regionTokenOf(rule: Pick<ResourceRule, 'id' | 'template'>): RegionToken {
  return rowOf(rule.id)?.rules[rule.id]?.regionToken ?? (rule.template.includes('region') ? 'region' : 'none');
}

/** 종류 값 → 이름에 넣을 토큰. 허용 밖이면 Error, 규칙 기본값 · 행의 omitValues 면 null(토큰 없음) */
export function kindToken(rule: RuleRef, value: string): string | null | Error {
  const id = idOf(rule);
  const row = rowOf(id);
  const kinds = row?.rules[id]?.kinds;
  if (!row?.kind || !kinds) return new Error(`kind not supported: ${id}`);
  if (!kinds.allowed.includes(value)) return new Error(`kind not allowed: ${id} ${value}`);
  if (value === kinds.default || row.kind.omitValues.includes(value)) return null;
  return row.kind.tokens[value] ?? null;
}
