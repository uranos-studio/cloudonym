// GET /catalog.json 본문 (D46) — 켜진 CSP 의 catalog 행과 리전 표만 싣는다. 정본은 catalog/*.json, 여기서는 생성 TS 를 읽기만 한다
import type { Provider } from '../core/types';
import { catalogFor } from '../core/catalog';
import { GCP_CATALOG_META } from '../core/rules/gcp-catalog';
import { REGIONS } from '../core/regions-data';

/** catalog 머리(출처 판) — catalog 가 아직 없는 CSP 는 null */
const META: Partial<Record<Provider, unknown>> = { gcp: GCP_CATALOG_META };

/** 직렬화한 JSON 문자열 — Worker 가 모듈 로드 때 한 번 부른다. providers 의 키 순서 = 받은 목록 순서 */
export function buildCatalogJson(enabled: readonly Provider[], version: { engine: string; rules: string }): string {
  const providers = Object.fromEntries(enabled.map((p) => [p, { meta: META[p] ?? null, rows: catalogFor(p), regions: REGIONS[p] }]));
  return JSON.stringify({ version, providers });
}
