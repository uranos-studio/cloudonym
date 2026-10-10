// 약어 · 종류 토큰 겹침 검사 (D47 ⑴~⑸) — 같은 이름 자리에 같은 글자가 오면 읽는 사람이 다른 리소스로 읽는다.
// ⑸ 약어 ↔ 종류 토큰은 자리가 달라(…-{slug}-{kind}-…) 검사하지 않는다
import { describe, it, expect } from 'vitest';
import { GCP_CATALOG, type CatalogRow } from './rules/gcp-catalog';
import { REGIONS } from './regions-data';
import { RESERVED_TIERS } from './tier';
import { TIER_PATTERN } from './types';
import { rulesFor } from './constraints';

/** 같은 약어를 나눠 쓰는 것이 의도된 행 묶음 — 같은 개념(스냅숏 둘 · 함수 1 · 2세대) */
const SHARED_SLUGS: Record<string, readonly string[]> = {
  snap: ['gcp.region_snapshot', 'gcp.snapshot'],
  gcf: ['gcp.cloud_function', 'gcp.cloud_function_gen1'],
};
/** 한 행 안에서 여러 값이 같은 토큰을 쓰는 것이 의도된 묶음 */
const SHARED_KIND_TOKENS: Record<string, string> = {
  'gcp.subnet': 'proxy',
  'gcp.backend_service': 'int',
  'gcp.forwarding_rule': 'int',
};
const ENV_VALUES = ['prod', 'prd', 'stg', 'dev', 'sbx'];

interface Input { rows: readonly Pick<CatalogRow, 'key' | 'slug' | 'kind'>[]; regionCodes: readonly string[]; envValues: readonly string[] }

/** 검사기 — 걸린 것을 「⑴ slug sql: a, b」 꼴로 돌려준다. 비어 있으면 통과 */
function collisions({ rows, regionCodes, envValues }: Input): string[] {
  const out: string[] = [];
  // ⑴ 약어끼리 — 빈 약어(Project ID)는 뺀다
  const bySlug = new Map<string, string[]>();
  for (const r of rows) if (r.slug.value) bySlug.set(r.slug.value, [...(bySlug.get(r.slug.value) ?? []), r.key]);
  for (const [slug, keys] of bySlug) {
    if (keys.length < 2) continue;
    const allowed = SHARED_SLUGS[slug];
    if (!allowed || [...keys].sort().join() !== [...allowed].sort().join()) out.push(`(1) slug ${slug}: ${keys.join(', ')}`);
  }
  // ⑵ 종류 토큰끼리 같은 행 안 — null 은 「토큰 없음」 하나로 본다
  for (const r of rows) {
    if (!r.kind) continue;
    const seen = new Map<string, number>();
    for (const t of Object.values(r.kind.tokens)) if (t !== null) seen.set(t, (seen.get(t) ?? 0) + 1);
    for (const [t, n] of seen) if (n > 1 && SHARED_KIND_TOKENS[r.key] !== t) out.push(`(2) kind ${r.key}: ${t} x${n}`);
  }
  // ⑶ ⑷ 약어 · 종류 토큰 ↔ 지역 · 존 코드 · 환경 값
  const words = rows.flatMap((r) => [
    ...(r.slug.value ? [[r.slug.value, `${r.key} slug`]] : []),
    ...Object.values(r.kind?.tokens ?? {}).filter((t): t is string => t !== null).map((t) => [t, `${r.key} kind`]),
  ]);
  const regionSet = new Set(regionCodes);
  const envSet = new Set(envValues);
  for (const [w, where] of words) {
    if (regionSet.has(w!)) out.push(`(3) region ${w}: ${where}`);
    if (envSet.has(w!)) out.push(`(4) env ${w}: ${where}`);
  }
  return out;
}

const regionCodes = REGIONS.gcp.flatMap((r) => [r.code, ...r.zones.map((z) => z.code)]);

describe('catalog 겹침 검사 (D47)', () => {
  it('검사기 자체 — ane3 · prod · sql 을 약어로 넣으면 셋 다 잡는다', () => {
    const extra = ['ane3', 'prod', 'sql'].map((value, i) => ({ key: `gcp.fixture_${i}`, slug: { value, basis: 'x', previous: [] }, kind: null }));
    const found = collisions({ rows: [...GCP_CATALOG, ...extra], regionCodes, envValues: ENV_VALUES });
    expect(found).toEqual([
      '(1) slug sql: gcp.cloud_sql_instance, gcp.fixture_2',
      '(3) region ane3: gcp.fixture_0 slug',
      '(4) env prod: gcp.fixture_1 slug',
    ]);
  });

  it('검사기 자체 — 한 행 안의 같은 종류 토큰 · 종류 토큰과 존 코드를 잡는다', () => {
    const row = { key: 'gcp.fixture', slug: { value: 'fx', basis: 'x', previous: [] }, kind: { rule: 'only-when-chosen' as const, defaultBasis: 'x', tokens: { A: 'ab', B: 'ab', C: 'ane3a' }, omitValues: [], source: 'x' } };
    expect(collisions({ rows: [row], regionCodes, envValues: ENV_VALUES })).toEqual(['(2) kind gcp.fixture: ab x2', '(3) region ane3a: gcp.fixture kind']);
  });

  it('지역 코드 표 — GCP 43 리전 + 130 존 = 173', () => {
    expect(new Set(regionCodes).size).toBe(173);
  });

  it('GCP catalog 에 겹침이 없다 (⑴ snap · gcf · ⑵ proxy · int 는 의도한 묶음)', () => {
    expect(collisions({ rows: GCP_CATALOG, regionCodes, envValues: ENV_VALUES })).toEqual([]);
  });

  it('의도한 묶음은 실제로 있다 — 없어지면 예외를 지운다', () => {
    for (const [slug, keys] of Object.entries(SHARED_SLUGS)) {
      expect(GCP_CATALOG.filter((r) => r.slug.value === slug).map((r) => r.key).sort()).toEqual([...keys].sort());
    }
    for (const [key, token] of Object.entries(SHARED_KIND_TOKENS)) {
      const row = GCP_CATALOG.find((r) => r.key === key)!;
      expect(Object.values(row.kind!.tokens).filter((t) => t === token).length, key).toBeGreaterThan(1);
    }
  });
});

// ⑹ ⑺ 용도 토큰 tier · 딸린 것 접미 attach (D60 · D62) — tier 는 약어 · 종류 토큰 바로 뒤에 온다(…-{slug}[-{kind}]-{tier}-{seq}).
// 프리셋 · 접미 데이터는 마법사 데이터(뒤 작업)가 들인다 — 그때까지 이 목록이 기대값이다
const PRESET_TIERS = ['web', 'was', 'bastion', 'file', 'ssh', 'icmp'];
const ATTACH_SUFFIXES = ['boot', 'data', 'ip', 'ipi'];

interface TierInput { tiers: readonly string[]; attach: readonly string[]; rows: readonly Pick<CatalogRow, 'key' | 'slug' | 'kind'>[]; regionCodes: readonly string[]; envValues: readonly string[] }

/** ⑹ tier · attach ↔ 지역 · 환경 값 ⑺ tier ↔ 약어 · 종류 토큰. attach 는 부모 이름 뒤라 ⑺ 에서 뺀다(ip 는 주소 약어와 같은 글자 — 자리로 구분) */
function tierCollisions({ tiers, attach, rows, regionCodes, envValues }: TierInput): string[] {
  const out: string[] = [];
  const regionSet = new Set(regionCodes);
  const envSet = new Set(envValues);
  for (const [w, what] of [...tiers.map((t) => [t, 'tier']), ...attach.map((a) => [a, 'attach'])] as const) {
    if (regionSet.has(w)) out.push(`(6) region ${w}: ${what}`);
    if (envSet.has(w)) out.push(`(6) env ${w}: ${what}`);
  }
  const slugs = new Set(rows.map((r) => r.slug.value).filter((s) => s !== ''));
  const kinds = new Set(rows.flatMap((r) => Object.values(r.kind?.tokens ?? {}).filter((t): t is string => t !== null)));
  for (const t of tiers) {
    if (slugs.has(t)) out.push(`(7) slug ${t}: tier`);
    if (kinds.has(t)) out.push(`(7) kind ${t}: tier`);
  }
  return out;
}

describe('tier · attach 겹침 검사 (D60 · D62)', () => {
  const input = { tiers: PRESET_TIERS, attach: ATTACH_SUFFIXES, rows: GCP_CATALOG, regionCodes, envValues: ENV_VALUES };

  it('검사기 자체 — ane3 · prod · db · pg 를 tier 로 넣으면 넷 다 잡고, attach 의 prod 도 잡는다', () => {
    expect(tierCollisions({ ...input, tiers: [...PRESET_TIERS, 'ane3', 'prod', 'db', 'pg'], attach: [...ATTACH_SUFFIXES, 'prod'] })).toEqual([
      '(6) region ane3: tier', '(6) env prod: tier', '(6) env prod: attach', '(7) slug db: tier', '(7) kind pg: tier',
    ]);
  });
  it('⑹ 프리셋 tier · attach ↔ 지역 173 · 환경 5 = 0 · ⑺ 프리셋 tier ↔ 약어 · 종류 토큰 = 0', () => {
    expect(tierCollisions(input)).toEqual([]);
  });
  it('프리셋 tier 는 TIER_PATTERN 을 지나고 예약 목록에 없다', () => {
    for (const t of PRESET_TIERS) {
      expect(TIER_PATTERN.test(t), t).toBe(true);
      expect(RESERVED_TIERS.has(t), t).toBe(false);
    }
  });
});

describe('RESERVED_TIERS — tier 로 쓸 수 없는 글자 (D60)', () => {
  it('catalog 의 약어 전부 · 종류 토큰 전부를 담는다(규칙 표에서 센다)', () => {
    const slugs = [...new Set(GCP_CATALOG.map((r) => r.slug.value).filter((s) => s !== ''))];
    const kinds = [...new Set(GCP_CATALOG.flatMap((r) => Object.values(r.kind?.tokens ?? {}).filter((t): t is string => t !== null)))];
    expect(slugs.length).toBeGreaterThan(0);
    expect(kinds.length).toBeGreaterThan(0);
    expect(slugs.filter((s) => !RESERVED_TIERS.has(s))).toEqual([]);
    expect(kinds.filter((k) => !RESERVED_TIERS.has(k))).toEqual([]);
    for (const r of rulesFor('gcp')) if (r.slug) expect(RESERVED_TIERS.has(r.slug), r.id).toBe(true);
  });
  it('환경 값 다섯 · GCP 지역 코드 173 을 담는다', () => {
    for (const e of ENV_VALUES) expect(RESERVED_TIERS.has(e), e).toBe(true);
    expect(regionCodes.filter((c) => !RESERVED_TIERS.has(c))).toEqual([]);
  });
  it('넷 밖의 글자는 담지 않는다', () => {
    const slugs = GCP_CATALOG.map((r) => r.slug.value);
    const kinds = GCP_CATALOG.flatMap((r) => Object.values(r.kind?.tokens ?? {}));
    // 환경 값은 글자로 적는다 — 옛 표준값 prd(지금은 prod 의 별칭)가 들어 있어야 한다
    const envs = ['prod', 'prd', 'stg', 'dev', 'sbx'];
    const expected = new Set([...slugs, ...kinds, ...envs, ...regionCodes].filter((w): w is string => typeof w === 'string' && w !== ''));
    expect([...RESERVED_TIERS].sort()).toEqual([...expected].sort());
  });
});
