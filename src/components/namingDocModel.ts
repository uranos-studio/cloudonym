// /docs/naming 의 모델 (D57) — catalog · 지역 표 · 규칙 · 사전 · 버전에서 절 아홉을 만드는 순수 함수. 손으로 쓴 숫자 · 표가 없다(D9).
// 입력을 인자로 받는다 — 시험이 작은 입력을 넣어 표가 따라 변하는지 본다
import { catalogFor } from '../core/catalog';
import type { RegionEntry } from '../core/regions-data';
import { DEFAULT_ROLE, ENV_VALUES, MAX_CONTEXT_CHARS } from '../core/engine';
import { MAX_COUNT } from '../core/selection';
import { MIN_TOKEN, PROTECTED, type Env, type Provider, type ResourceRule, type Token } from '../core/types';
import { fillUi, type Catalog, type UiKey } from '../messages/catalog';
import type { Version } from '../version';

type CatalogRow = ReturnType<typeof catalogFor>[number];

export const NAMING_DOC_SECTIONS = ['formula', 'tokens', 'regions', 'zones', 'env', 'shrink', 'abbreviations', 'kinds', 'pass'] as const;
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
}

const PROVIDER_LABEL: Record<Provider, string> = { aws: 'AWS', gcp: 'GCP', azure: 'Azure' };
/** 토큰 표의 순서 · 뜻 — Record 라 Token 이 늘면 typecheck 가 잡는다 */
const TOKEN_MEANING: Record<Token, UiKey> = {
  owner: 'doc_token_owner', system: 'doc_token_system', purpose: 'doc_token_purpose', env: 'doc_token_env', region: 'doc_token_region',
  slug: 'doc_token_slug', kind: 'doc_token_kind', seq: 'doc_token_seq', role: 'doc_token_role',
};
const ENV_MEANING: Record<Env, UiKey> = { prod: 'doc_env_prod', stg: 'doc_env_stg', dev: 'doc_env_dev', sbx: 'doc_env_sbx' };
/** 약어 원칙 — 번호가 곧 순서다. catalog 의 slug.basis 가 「principle N」으로 가리킨다(시험이 N 이 모두 여기 있는지 센다) */
export const ABBR_PRINCIPLES: readonly UiKey[] = ['doc_abbr_principle_1', 'doc_abbr_principle_2', 'doc_abbr_principle_3', 'doc_abbr_principle_4'];
const KIND_RULE: Record<NonNullable<CatalogRow['kind']>['rule'], UiKey> = {
  'omit-when-csp-default': 'doc_kind_rule_omit', 'only-when-chosen': 'doc_kind_rule_chosen', required: 'doc_kind_rule_required',
};

/** 규칙의 조립 순서를 `<system>-<purpose>-…` 꼴로 — 표시일 뿐 이름을 만들지 않는다 */
export function formulaText(rule: Pick<ResourceRule, 'template' | 'separator'>): string {
  return rule.template.map((t) => `<${t}>`).join(rule.separator);
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

export function namingDocModel({ provider, catalog, regions, rules, messages, version }: NamingDocInput): NamingDocModel {
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

  const tokens = Object.keys(TOKEN_MEANING) as Token[];
  // 순번 자릿수 — 상한의 자릿수(엔진은 이 폭으로 0 을 채운다 · 시험이 generateMany 에 대어 본다)
  const seqWidth = String(MAX_COUNT).length;
  const tokenVars = { max: MAX_CONTEXT_CHARS, maxCount: MAX_COUNT, width: seqWidth, first: '1'.padStart(seqWidth, '0'), role: DEFAULT_ROLE, hint: ui.role_hint };

  const zoneCount = regions.reduce((n, r) => n + r.zones.length, 0);
  const sample = regions.find((r) => r.zones.length > 0);
  const example = sample ? `${sample.zones[0]!.zone} → ${sample.zones[0]!.code}` : none;
  const zonalRows = catalog.filter((row) => Object.values(row.rules).some((s) => s.regionToken === 'zone'));

  const kindRows = catalog.filter((row) => row.kind !== null);

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
      ...(zonalRows.length > 0 ? { listLead: fill('doc_zones_list', { n: zonalRows.length }), items: zonalRows.map((row) => row.displayName) } : {}),
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
    { id: 'pass', title: ui.doc_pass_title, paragraphs: [ui.pass_meaning] },
  ];
  return { intro: fill('doc_intro', { provider: name, rules: version.rules }), sections };
}
