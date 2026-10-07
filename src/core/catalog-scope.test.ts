// 범위별 허용 종류 ↔ 출처 전사 (§4-5) — catalog/kind-sources.json 은 공식 문서 · Terraform 스키마에서 값마다
// 「어느 범위에서 받는가」를 손으로 옮긴 것이다. 규칙의 kinds.allowed 는 그 규칙 범위에 맞는 값의 집합과 정확히 같아야 한다 —
// 값을 더해도 빼도 실패한다. 시험은 URL 을 열지 않는다(전사는 사람이 한다)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GCP_CATALOG, type CatalogRow } from './rules/gcp-catalog';

interface SourceEntry { value: string; scopes: string[]; source: string; quote: string; checked: string | null; conflict?: string }
const SOURCES: Record<string, SourceEntry[]> = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'catalog', 'kind-sources.json'), 'utf-8')).rows;

/** 규칙마다 allowed 와 전사의 차이 — 「rule: +값(allowed 에만) / -값(전사에만)」 */
function mismatches(rows: readonly CatalogRow[], sources: Record<string, SourceEntry[]>): string[] {
  const out: string[] = [];
  for (const row of rows) {
    if (!row.kind) continue;
    const src = sources[row.key] ?? [];
    for (const [id, spec] of Object.entries(row.rules)) {
      const expected = new Set(src.filter((s) => s.scopes.includes(spec.scope)).map((s) => s.value));
      const actual = new Set(spec.kinds?.allowed ?? []);
      for (const v of actual) if (!expected.has(v)) out.push(`${id}: +${v}`);
      for (const v of expected) if (!actual.has(v)) out.push(`${id}: -${v}`);
    }
  }
  return out;
}

describe('범위별 허용 종류 = 출처 전사 (§4-5)', () => {
  it('검사기 자체 — allowed 에 값을 더하거나 빼면 잡는다', () => {
    const neg = structuredClone(GCP_CATALOG.find((r) => r.key === 'gcp.network_endpoint_group')!) as CatalogRow;
    const zonal = neg.rules['gcp.network_endpoint_group']!.kinds! as { default: string | null; allowed: string[] };
    zonal.allowed = [...zonal.allowed.filter((v) => v !== 'GCE_VM_IP'), 'SERVERLESS'];
    expect(mismatches([neg], SOURCES)).toEqual(['gcp.network_endpoint_group: +SERVERLESS', 'gcp.network_endpoint_group: -GCE_VM_IP']);
  });

  it('모든 규칙의 kinds.allowed 가 그 범위의 전사 값과 정확히 같다', () => {
    expect(mismatches(GCP_CATALOG, SOURCES)).toEqual([]);
  });

  it('전사는 종류 표가 있는 19행을 덮고, 행마다 tokens 의 값을 빠짐없이 옮겼다', () => {
    const kindRows = GCP_CATALOG.filter((r) => r.kind !== null);
    expect(Object.keys(SOURCES).sort()).toEqual(kindRows.map((r) => r.key).sort());
    for (const row of kindRows) expect(SOURCES[row.key]!.map((s) => s.value).sort(), row.key).toEqual(Object.keys(row.kind!.tokens).sort());
  });

  it('값마다 출처 URL · 원문 낱말이 있다', () => {
    for (const [key, entries] of Object.entries(SOURCES)) for (const e of entries) {
      expect(e.source, `${key} ${e.value}`).toMatch(/^https:\/\//);
      expect(e.quote.length, `${key} ${e.value}`).toBeGreaterThan(0);
    }
  });

  it('정정 C1 — 영역 NEG 는 SERVERLESS · PRIVATE_SERVICE_CONNECT · GCE_VM_IP_PORTMAP 을 받지 않고, 지역 NEG 는 GCE_VM_IP(_PORT) · NON_GCP_PRIVATE_IP_PORT 를 받지 않는다', () => {
    const neg = GCP_CATALOG.find((r) => r.key === 'gcp.network_endpoint_group')!;
    const zonal = neg.rules['gcp.network_endpoint_group']!.kinds!.allowed;
    const regional = neg.rules['gcp.region_network_endpoint_group']!.kinds!.allowed;
    for (const v of ['SERVERLESS', 'PRIVATE_SERVICE_CONNECT', 'GCE_VM_IP_PORTMAP']) expect(zonal).not.toContain(v);
    for (const v of ['GCE_VM_IP', 'GCE_VM_IP_PORT', 'NON_GCP_PRIVATE_IP_PORT']) expect(regional).not.toContain(v);
    expect(neg.kind!.tokens.SERVERLESS).toBeNull();
  });

  it('정정 C3 — GCE_VM_IP_DEDICATED_BACKEND 는 영역에 두되 Terraform 출처이고 충돌을 적어 둔다', () => {
    const e = SOURCES['gcp.network_endpoint_group']!.find((s) => s.value === 'GCE_VM_IP_DEDICATED_BACKEND')!;
    expect(e.scopes).toEqual(['zone']);
    expect(e.source).toContain('terraform-provider-google');
    expect(e.conflict).toMatch(/Terraform only/);
  });
});
