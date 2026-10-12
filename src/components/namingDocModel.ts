// /docs/naming 의 모델 (D57) — catalog · 지역 표 · 규칙 · 프리셋 · 호환표 · 예약어 · 사전 · 버전에서 절 열둘을 만드는 순수 함수. 손으로 쓴 숫자 · 표가 없다(D9).
// 입력을 인자로 받는다 — 시험이 작은 입력을 넣어 표가 따라 변하는지 본다
import { catalogFor } from '../core/catalog';
import type { RegionEntry } from '../core/regions-data';
import { DEFAULT_ROLE, ENV_VALUES, MAX_CONTEXT_CHARS } from '../core/engine';
import { MAX_COUNT } from '../core/selection';
import { MIN_TOKEN, PROTECTED, TIER_PATTERN, type Env, type Provider, type ResourceRule, type Token } from '../core/types';
import type { Preset } from '../core/wizard/presets';
import { MAX_DATA_DISKS, type AttachmentRow } from '../core/wizard/attachments';
import { fillUi, type Catalog, type UiKey } from '../messages/catalog';
import type { Version } from '../version';

type CatalogRow = ReturnType<typeof catalogFor>[number];

export const NAMING_DOC_SECTIONS = ['formula', 'tokens', 'regions', 'zones', 'env', 'shrink', 'abbreviations', 'kinds', 'tiers', 'attached', 'presets', 'pass'] as const;
export type NamingDocSectionId = (typeof NAMING_DOC_SECTIONS)[number];

export interface DocTable {
  caption: string;
  columns: readonly string[];
  /** 칸마다 고정폭 글꼴로 보일지 — 값 · 코드 칸 */
  mono: readonly boolean[];
  rows: readonly { key: string; cells: readonly string[] }[];
}
export interface DocSection {
  id: NamingDocSectionId;
  title: string;
  paragraphs: readonly string[];
  /** 소절 제목(h3) — 목록 앞에 온다 */
  subheading?: string;
  /** 목록 머리 문장 · 목록 · 순서 있는 목록인지 */
  listLead?: string;
  items?: readonly string[];
  ordered?: boolean;
  table?: DocTable;
}
export interface NamingDocModel { intro: string; sections: readonly DocSection[] }

export interface NamingDocInput {
  provider: Provider;
  catalog: readonly CatalogRow[];
  regions: readonly RegionEntry[];
  rules: readonly ResourceRule[];
  messages: Catalog;
  version: Version;
  /** 마법사 프리셋 (D59 · D64) · 부모 ↔ 딸린 것 호환표 (D62) · tier 예약어 (D60) */
  presets: readonly Preset[];
  attachments: readonly AttachmentRow[];
  reservedTiers: ReadonlySet<string>;
}

const PROVIDER_LABEL: Record<Provider, string> = { aws: 'AWS', gcp: 'GCP', azure: 'Azure' };
/** 토큰 표의 순서 · 뜻 — Record 라 Token 이 늘면 typecheck 가 잡는다. 순서는 이름 안의 자리를 따른다(tier 는 kind 와 seq 사이 · D60) */
const TOKEN_MEANING: Record<Token, UiKey> = {
  owner: 'doc_token_owner', system: 'doc_token_system', purpose: 'doc_token_purpose', env: 'doc_token_env', region: 'doc_token_region',
  slug: 'doc_token_slug', kind: 'doc_token_kind', tier: 'doc_token_tier', seq: 'doc_token_seq', role: 'doc_token_role',
};
const ENV_MEANING: Record<Env, UiKey> = { prod: 'doc_env_prod', stg: 'doc_env_stg', dev: 'doc_env_dev', sbx: 'doc_env_sbx', qa: 'doc_env_qa', uat: 'doc_env_uat', test: 'doc_env_test', perf: 'doc_env_perf', dr: 'doc_env_dr' };
/** 약어 원칙 — 번호가 곧 순서다. catalog 의 slug.basis 가 「principle N」으로 가리킨다(시험이 N 이 모두 여기 있는지 센다) */
export const ABBR_PRINCIPLES: readonly UiKey[] = ['doc_abbr_principle_1', 'doc_abbr_principle_2', 'doc_abbr_principle_3', 'doc_abbr_principle_4'];
const KIND_RULE: Record<NonNullable<CatalogRow['kind']>['rule'], UiKey> = {
  'omit-when-csp-default': 'doc_kind_rule_omit', 'only-when-chosen': 'doc_kind_rule_chosen', required: 'doc_kind_rule_required',
};

/** 규칙의 조립 순서를 `<system>-<purpose>-…` 꼴로 — 표시일 뿐 이름을 만들지 않는다.
 *  tier(D60)는 마법사만 채우는 자리라 `[-<tier>]` 로 적는다 — 괄호가 앞 구분자까지 감싼다(/llms.txt 의 formulaOf 와 같은 꼴) */
export function formulaText(rule: Pick<ResourceRule, 'template' | 'separator'>): string {
  return rule.template.reduce((out, t, i) => (t === 'tier' ? `${out}[${rule.separator}<tier>]` : `${out}${i === 0 ? '' : rule.separator}<${t}>`), '');
}

/** 프리셋 묶음 — 화면 묶음 칩(group)은 한 줄, 딸린 것 초기값이 없는 VM 프리셋은 「server」 한 줄, 나머지는 하나씩.
 *  /llms.txt 의 「## Wizard presets」 와 같은 묶음이다 */
export function presetGroups(presets: readonly Preset[]): { key: string; presets: Preset[] }[] {
  const groups = new Map<string, Preset[]>();
  for (const p of presets) {
    const key = p.group ?? (p.ruleId === 'gcp.compute_instance' && !p.defaultAttach ? 'server' : p.id);
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.entries()].map(([key, ps]) => ({ key, presets: ps }));
}

/** 존 코드가 「리전 코드 + 존 글자」가 아닌 것 — 존 절의 문장이 데이터와 맞는지 시험이 본다 */
export function zoneCodeMismatches(regions: readonly RegionEntry[]): string[] {
  return regions.flatMap((r) => r.zones.filter((z) => z.code !== r.code + z.zone.slice(r.region.length + 1)).map((z) => z.code));
}

/** 범위마다 기본값 — 모두 같으면 값 하나, 다르면 「범위: 값」을 잇는다. 기본값이 없으면 none */
function defaultText(row: CatalogRow, none: string): string {
  const specs = Object.values(row.rules).filter((s) => s.kinds !== undefined);
  const values = [...new Set(specs.map((s) => s.kinds!.default ?? none))];
  if (values.length <= 1) return values[0] ?? none;
  return specs.map((s) => `${s.scope}: ${s.kinds!.default ?? none}`).join(' · ');
}

export function namingDocModel({ provider, catalog, regions, rules, messages, version, presets, attachments, reservedTiers }: NamingDocInput): NamingDocModel {
  const ui = messages.ui;
  const fill = (key: UiKey, vars: Record<string, string | number> = {}) => fillUi(messages, key, vars);
  const name = PROVIDER_LABEL[provider];
  const none = ui.doc_none;

  // 이름 공식 — 조립 순서 · 구분자 · 생략 토큰이 같은 규칙을 묶는다. 규칙 수가 많은 공식부터
  const formulas = new Map<string, { formula: string; optional: string; count: number }>();
  for (const r of rules) {
    const formula = formulaText(r);
    const optional = r.optional.length > 0 ? r.optional.join(', ') : none;
    const key = `${formula} ${optional}`;
    const f = formulas.get(key) ?? { formula, optional, count: 0 };
    f.count += 1;
    formulas.set(key, f);
  }
  const formulaRows = [...formulas.entries()].sort((a, b) => b[1].count - a[1].count || a[1].formula.localeCompare(b[1].formula))
    .map(([key, f]) => ({ key, cells: [f.formula, f.optional, String(f.count)] }));

  const tokens = Object.keys(TOKEN_MEANING) as (keyof typeof TOKEN_MEANING)[];
  // 순번 자릿수 — 상한의 자릿수(엔진은 이 폭으로 0 을 채운다 · 시험이 generateMany 에 대어 본다)
  const seqWidth = String(MAX_COUNT).length;
  const tokenVars = { max: MAX_CONTEXT_CHARS, maxCount: MAX_COUNT, width: seqWidth, first: '1'.padStart(seqWidth, '0'), role: DEFAULT_ROLE, hint: ui.role_hint };

  const zoneCount = regions.reduce((n, r) => n + r.zones.length, 0);
  const sample = regions.find((r) => r.zones.length > 0);
  const example = sample ? `${sample.zones[0]!.zone} → ${sample.zones[0]!.code}` : none;

  const kindRows = catalog.filter((row) => row.kind !== null);

  // 용도 토큰 · 딸린 것 · 프리셋 (D60 · D62 · D59) — 규칙 이름은 넣은 규칙에서, 없으면 id
  const ruleName = (id: string) => rules.find((r) => r.id === id)?.displayName ?? id;
  const presetTiers = [...new Set(presets.flatMap((p) => [...(p.tier === null ? [] : [p.tier]), ...(p.tierChoices ?? [])]))];
  const groups = presetGroups(presets);
  // tier 칸 — 프리셋 id 와 같은 tier 는 값만, 다르면 「id: 값」(방화벽 ssh / web / icmp) · tier 없는 프리셋은 싣지 않는다
  const tierCell = (ps: readonly Preset[]): string => {
    const parts = ps.filter((p) => p.tier !== null).map((p) => {
      const values = [p.tier!, ...(p.tierChoices ?? []).filter((t) => t !== p.tier)].join(' / ');
      return values === p.id ? values : `${p.id}: ${values}`;
    });
    return parts.length > 0 ? parts.join(' · ') : none;
  };
  const optionText = (p: Preset): string[] => [
    ...(p.ha ? [fill('doc_preset_ha', { n: p.ha.minInstances })] : []),
    ...(p.serverless ? [fill('doc_preset_serverless', { rules: p.serverless.ruleIds.map(ruleName).join(' or ') })] : []),
    ...(p.defaultAttach?.data ? [fill('doc_preset_start_disk', { data: p.defaultAttach.data.join(', ') })] : []),
  ];
  const sameAll = (values: string[]) => ([...new Set(values)].length === 1 ? values[0]! : values.join(' · '));

  const sections: DocSection[] = [
    {
      id: 'formula', title: ui.doc_formula_title, paragraphs: [fill('doc_formula_body', { optional: ui.doc_col_optional })],
      table: {
        caption: fill('doc_formula_caption', { n: formulaRows.length, count: rules.length, provider: name }),
        columns: [ui.doc_col_formula, ui.doc_col_optional, ui.doc_col_rule_count], mono: [true, true, false], rows: formulaRows,
      },
    },
    {
      id: 'tokens', title: ui.doc_tokens_title, paragraphs: [ui.doc_tokens_body],
      table: {
        caption: fill('doc_tokens_caption', { n: tokens.length }), columns: [ui.doc_col_token, ui.doc_col_meaning], mono: [true, false],
        rows: tokens.map((t) => ({ key: t, cells: [t, fill(TOKEN_MEANING[t], tokenVars)] })),
      },
    },
    {
      id: 'regions', title: ui.doc_regions_title, paragraphs: [ui.doc_regions_body],
      table: {
        caption: fill('doc_regions_caption', { n: regions.length, provider: name }),
        columns: [ui.doc_col_region, ui.doc_col_code, ui.doc_col_location, ui.doc_col_zones], mono: [true, true, false, true],
        rows: regions.map((r) => ({ key: r.region, cells: [r.region, r.code, r.label, r.zones.length > 0 ? r.zones.map((z) => z.code).join(' ') : none] })),
      },
    },
    {
      id: 'zones', title: ui.doc_zones_title, paragraphs: [fill('doc_zones_body', { example, n: zoneCount })],
    },
    {
      id: 'env', title: ui.doc_env_title, paragraphs: [ui.doc_env_body],
      table: {
        caption: fill('doc_env_caption', { n: ENV_VALUES.length }), columns: [ui.doc_col_value, ui.doc_col_meaning], mono: [true, false],
        rows: ENV_VALUES.map((v) => ({ key: v, cells: [v, ui[ENV_MEANING[v]]] })),
      },
    },
    {
      id: 'shrink', title: ui.doc_shrink_title, paragraphs: [ui.doc_shrink_body], ordered: true,
      items: [
        fill('doc_shrink_step1', { optional: ui.doc_col_optional }),
        fill('doc_shrink_step2', { protected: PROTECTED.join(', '), min: MIN_TOKEN }),
        ui.doc_shrink_step3,
      ],
    },
    {
      id: 'abbreviations', title: ui.doc_abbr_title, paragraphs: [ui.doc_abbr_body],
      subheading: ui.doc_abbr_principles_title, ordered: true, items: ABBR_PRINCIPLES.map((k) => ui[k]),
      table: {
        caption: fill('doc_abbr_caption', { n: catalog.length, provider: name }),
        columns: [ui.doc_col_resource, ui.doc_col_abbr, ui.doc_col_basis, ui.doc_col_previous], mono: [false, true, false, true],
        rows: catalog.map((row) => ({
          key: row.key,
          cells: [row.displayName, row.slug.value || none, row.slug.basis, row.slug.previous.length > 0 ? row.slug.previous.join(', ') : none],
        })),
      },
    },
    {
      id: 'kinds', title: ui.doc_kinds_title, paragraphs: [ui.doc_kinds_body],
      table: {
        caption: fill('doc_kinds_caption', { n: kindRows.length, provider: name }),
        columns: [ui.doc_col_resource, ui.doc_col_abbr, ui.doc_col_values, ui.doc_col_default, ui.doc_col_kind_rule], mono: [false, true, true, true, false],
        rows: kindRows.map((row) => ({
          key: row.key,
          cells: [
            row.displayName, row.slug.value || none,
            Object.entries(row.kind!.tokens).map(([v, t]) => `${v} → ${t ?? ui.doc_no_token}`).join(' · '),
            defaultText(row, none), ui[KIND_RULE[row.kind!.rule]],
          ],
        })),
      },
    },
    {
      id: 'tiers', title: ui.doc_tiers_title,
      paragraphs: [ui.doc_tiers_body],
      items: [
        fill('doc_tier_pattern', { pattern: TIER_PATTERN.source }),
        fill('doc_tier_reserved', { n: reservedTiers.size }),
        fill('doc_tier_presets', { tiers: presetTiers.length > 0 ? presetTiers.join(', ') : none }),
      ],
    },
    {
      id: 'attached', title: ui.doc_attached_title, paragraphs: [fill('doc_attached_body', { max: MAX_DATA_DISKS })],
      table: {
        caption: fill('doc_attached_caption', { n: attachments.length }),
        columns: [ui.doc_col_suffix, ui.doc_col_parent, ui.doc_col_child], mono: [true, false, false],
        rows: attachments.map((a) => ({ key: `${a.parent}/${a.attach}`, cells: [`-${a.attach}${a.seq ? '-<seq>' : ''}`, ruleName(a.parent), ruleName(a.child)] })),
      },
    },
    {
      id: 'presets', title: ui.doc_presets_title, paragraphs: [ui.doc_presets_body],
      table: {
        caption: fill('doc_presets_caption', { n: groups.length, count: presets.length }),
        columns: [ui.doc_col_preset, ui.doc_col_label, ui.doc_col_rule, ui.doc_col_tier, ui.doc_col_options], mono: [true, false, false, true, false],
        rows: groups.map((g) => {
          // 선택 사항 — 묶음의 일부 프리셋에만 있으면 그 프리셋 id 를 앞에 붙인다(HA · 서버리스는 web · was 만)
          const options = [...new Set(g.presets.flatMap(optionText))].map((o) => {
            const owners = g.presets.filter((p) => optionText(p).includes(o)).map((p) => p.id);
            return owners.length === g.presets.length ? o : `${owners.join(', ')}: ${o}`;
          });
          return {
            key: g.key,
            cells: [
              g.presets.map((p) => p.id).join(' · '), g.presets.map((p) => p.label).join(' · '),
              sameAll(g.presets.map((p) => ruleName(p.ruleId))), tierCell(g.presets),
              options.length > 0 ? options.join('; ') : none,
            ],
          };
        }),
      },
    },
    { id: 'pass', title: ui.doc_pass_title, paragraphs: [ui.pass_meaning] },
  ];
  return { intro: fill('doc_intro', { provider: name, rules: version.rules }), sections };
}
