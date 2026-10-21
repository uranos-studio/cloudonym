// GET /catalog.json 본문 (D46 · D101 · D121) — 켜진 CSP 의 catalog 행과 리전 표, 그리고 클라이언트(저장소 CLI)가 물을 것을 정하는 데이터.
// 정본은 catalog/*.json 과 core 의 표다. 여기서는 읽어 옮겨 적기만 한다 — core 를 바꾸지 않으므로 규칙 버전이 그대로다 (D101)
import { TIER_PATTERN, type Provider } from '../core/types';
import { catalogFor } from '../core/catalog';
import { RULES } from '../core/constraints';
import { GCP_CATALOG_META, type CatalogRow } from '../core/rules/gcp-catalog';
import { REGIONS } from '../core/regions-data';
import { pickLocationNames } from '../core/regions';
import { inputKind } from '../core/tree';
import { MAX_COUNT, MAX_NAMES, ROLE_PATTERN, SEQ_PATTERN } from '../core/selection';
import { MAX_PICKS_PER_SERVICE, MAX_SERVICES, SLOT_ID_PATTERN } from '../core/wizard/plan';
import { PRESETS } from '../core/wizard/presets';
import { ATTACHMENTS, MAX_DATA_DISKS } from '../core/wizard/attachments';
import { PLAN_MAX_BODY_BYTES } from '../plan/wire';
import { ENV_VALUES } from '../core/normalize';
import { SCOPES } from '../core/scopes';

/** catalog 머리(출처 버전) — catalog 가 아직 없는 CSP 는 null */
const META: Partial<Record<Provider, unknown>> = { gcp: GCP_CATALOG_META };

/** 규칙 하나에 더하는 칸 (D101) — input(슬롯 · 역할 · 없음) · tier(템플릿에 tier 자리가 있는가) · locations(pick 의 location 으로 받는 값, 받는 규칙만) */
export interface CatalogRuleExtra { input: 'count' | 'role' | 'none'; tier: boolean; locations?: string[] }

export function ruleExtra(id: string): CatalogRuleExtra | undefined {
  const rule = RULES[id];
  if (!rule) return undefined;
  const locations = pickLocationNames(rule);
  return { input: inputKind(rule), tier: rule.template.includes('tier'), ...(locations.length > 0 ? { locations } : {}) };
}

/** 행의 rules 에 규칙 칸을 얹는다 — 행의 다른 칸은 그대로 */
function withRuleExtras(row: CatalogRow): CatalogRow {
  const rules = Object.fromEntries(Object.entries(row.rules).map(([id, spec]) => [id, { ...spec, ...ruleExtra(id) }]));
  return { ...row, rules };
}

/** 마법사 프리셋 (D59 · D64) — 요청 본문의 이름으로(rule · tier_choices · min_instances). 마법사는 gcp 만이라 다른 CSP 는 빈 배열 */
export function catalogPresets(provider: Provider): Record<string, unknown>[] {
  if (provider !== 'gcp') return [];
  return PRESETS.map((p) => ({
    id: p.id, label: p.label, rule: p.ruleId, tier: p.tier,
    ...(p.tierChoices ? { tier_choices: [...p.tierChoices] } : {}),
    ...(p.kind === undefined ? {} : { kind: p.kind }),
    ha: p.ha ? { min_instances: p.ha.minInstances } : null,
    serverless: p.serverless ? [...p.serverless.ruleIds] : null,
    ...(p.defaultAttach ? { default_attach: p.defaultAttach } : {}),
    level: p.level,
    ...(p.group === undefined ? {} : { group: p.group }),
  }));
}

/** 딸린 것 표 (D62) — 부모 규칙의 접두가 그 CSP 인 행만 */
export function catalogAttachments(provider: Provider): Record<string, unknown>[] {
  return ATTACHMENTS.filter((a) => a.parent.startsWith(`${provider}.`)).map((a) => ({ parent: a.parent, attach: a.attach, child: a.child, seq: a.seq }));
}

/** 유일 범위 표 (D37) — /v1/wizard · /v1/names 항목의 scope id 를 사람 이름과 부모로 푼다. parent 가 없으면 그 CSP 의 가장 넓은 범위(전역 유일) */
export function catalogScopes(provider: Provider): { id: string; name: string; parent?: string }[] {
  return Object.values(SCOPES).filter((s) => s.provider === provider).map((s) => ({ id: s.id, name: s.displayName, ...(s.parent === undefined ? {} : { parent: s.parent }) }));
}

/** 요청 상한과 꼴 — 보내기 전 안내용이다. 판정은 늘 서버가 한다 */
export const CATALOG_LIMITS = {
  max_services: MAX_SERVICES, max_picks_per_service: MAX_PICKS_PER_SERVICE, max_names: MAX_NAMES, max_count: MAX_COUNT,
  max_data_disks: MAX_DATA_DISKS, max_body_bytes: PLAN_MAX_BODY_BYTES,
  seq_pattern: SEQ_PATTERN.source, slot_id_pattern: SLOT_ID_PATTERN.source, tier_pattern: TIER_PATTERN.source, role_pattern: ROLE_PATTERN.source,
} as const;

/** 직렬화한 JSON 문자열 — Worker 가 모듈 로드 때 한 번 부른다. providers 의 키 순서 = 받은 목록 순서 */
export function buildCatalogJson(enabled: readonly Provider[], version: { engine: string; rules: string }): string {
  const providers = Object.fromEntries(enabled.map((p) => [p, {
    meta: META[p] ?? null, rows: catalogFor(p).map(withRuleExtras), regions: REGIONS[p],
    presets: catalogPresets(p), attachments: catalogAttachments(p), limits: CATALOG_LIMITS, scopes: catalogScopes(p),
  }]));
  // env_values — project.env 가 받는 표준값(별칭을 푼 뒤) 순서 그대로. CSP 와 무관해 providers 밖에 둔다 (D121 — CLI 가 환경을 번호 목록으로 묻는다)
  return JSON.stringify({ version, env_values: [...ENV_VALUES], providers });
}
