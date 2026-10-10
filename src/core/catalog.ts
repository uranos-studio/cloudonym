// catalog 조회 (D46 · D52) — 생성 파일 rules/gcp-catalog.ts 를 읽는 순수 함수. 규칙에 덮어쓰는 일은 rules/gcp.ts 가 한다
import type { Provider, RegionToken, ResourceRule } from './types';
import { GCP_CATALOG, type CatalogRow } from './rules/gcp-catalog';
import { kindTokenFor, regionTokenOfRule } from './compose';

/** 종류 토큰 길이 상한 — proxy · grpcs · https 가 5자다 */
export const MAX_KIND_CHARS = 5;
/** 종류 값 이름 길이 상한 — catalog 의 가장 긴 값 이름(GCE_VM_IP_DEDICATED_BACKEND). 공유 hash 의 길이 상한식이 쓴다 (catalog.test 가 catalog 에서 다시 센다) */
export const MAX_KIND_VALUE_CHARS = 27;

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

/** 지역 자리에 무엇이 오나 — catalog 행의 값을 규칙에 얹어 엔진과 같은 판정(compose.regionTokenOfRule)에 넘긴다 */
export function regionTokenOf(rule: Pick<ResourceRule, 'id' | 'template'>): RegionToken {
  return regionTokenOfRule({ regionToken: rowOf(rule.id)?.rules[rule.id]?.regionToken, template: rule.template });
}

/** 종류 값 → 이름에 넣을 토큰. 허용 밖이면 Error, 규칙 기본값 · 행의 omitValues 면 null(토큰 없음) */
export function kindToken(rule: RuleRef, value: string): string | null | Error {
  const id = idOf(rule);
  return kindTokenOf(rowOf(id), id, value);
}

/** kindToken 의 본체 — 행을 인자로 받는다(시험이 고친 행을 넣는다). 판정은 엔진과 같은 compose.kindTokenFor 다.
 *  허용 값인데 tokens 에 키가 없으면 catalog 데이터가 깨진 것이다(allowed ⊆ keys(tokens)) — 토큰 없음으로 삼키지 않고 던진다 */
export function kindTokenOf(row: CatalogRow | undefined, id: string, value: string): string | null | Error {
  const kinds = row?.rules[id]?.kinds;
  if (!row?.kind || !kinds) return kindTokenFor(id, undefined, value);
  return kindTokenFor(id, { default: kinds.default, allowed: kinds.allowed, tokens: row.kind.tokens, omitValues: row.kind.omitValues }, value);
}
