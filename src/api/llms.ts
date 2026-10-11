// /llms.txt 본문 — 규칙 표(RULES)에서 만든다. 손으로 쓴 공식 · 숫자를 두지 않는다 (D9 · D17)
import { ENABLED_PROVIDERS, PROVIDERS, TIER_PATTERN, type Provider, type ResourceRule, type Token } from '../core/types';
import { RESERVED_TIERS } from '../core/tier';
import { MAX_PICKS_PER_SERVICE, MAX_SERVICES } from '../core/wizard/plan';
import { PRESETS, PRESET_TIERS, type Preset } from '../core/wizard/presets';
import { ATTACHMENTS, MAX_DATA_DISKS } from '../core/wizard/attachments';
import { buildTree, inputKind, type TreeNode } from '../core/tree';
import { rulesFor } from '../core/constraints';
import { ENV_ALIASES } from '../core/normalize';
import { REGIONS } from '../core/regions-data';
import { MAX_CONTEXT_CHARS } from '../core/engine';
import { catalogFor } from '../core/catalog';
import { GCP_KIND_CHECKED, type CatalogRow } from '../core/rules/gcp-catalog';
import { MAX_FIELD_CHARS } from './schemas';
import { formatNotes, type Catalog } from '../messages/catalog';
import { en } from '../messages/en';
import type { Version } from '../version';

/** 절 순서 — 켜진 CSP 만 이 순서로 싣는다 (D45). 꺼진 CSP 는 「planned」 한 줄이다 */
const ORDER: readonly Provider[] = ['gcp', 'aws', 'azure'];
const LABEL: Record<Provider, string> = { aws: 'AWS', gcp: 'GCP', azure: 'Azure' };

/** 「A」 · 「A and B」 · 「A, B and C」 */
function joinNames(names: readonly string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** /v1/names 항목의 scope · uniqueness 뜻 — openapi.json NameItem 의 두 설명이 같은 문장이다(openapi.test 가 대어 본다) */
export const SCOPE_MEANING = 'scope is the placement scope: the parent the resource is created in (a scope id such as azure:resource_group). It says where the name lives, not that the provider enforces uniqueness there; see uniqueness.';
export const UNIQUENESS_MEANING = 'uniqueness "csp" means the provider requires the name to be unique within its scope; "none" (AWS Name tags) means the provider does not enforce uniqueness at all. Cloudonym compares names only with each other inside one request (name.conflict), never with resources that already exist.';

/** 범위 트리를 들여쓰기로 — 범위 한 줄(이름 · id · 근거 URL) 아래에 그 범위의 규칙(id · 입력 종류)과 자식 범위. 규칙 줄은 늘 들여쓰여 공식 · 제약 줄과 섞이지 않는다.
 *  규칙은 자기 범위 아래에 적는다 — 화면 트리는 합친 행을 공통 조상에 두지만(D53) API 문서는 규칙 단위다 */
function treeLines(node: TreeNode, depth = 0): string[] {
  const pad = '  '.repeat(depth);
  return [
    `${pad}- ${node.scope.displayName} (\`${node.scope.id}\`) — docs: ${node.scope.docUrl}`,
    ...rulesFor(node.scope.provider).filter((r) => r.scope === node.scope.id).map((r) => `${pad}  - \`${r.id}\` · input: ${inputKind(r)}${r.uniqueness === 'none' ? ' · uniqueness: none' : ''}`),
    ...node.children.flatMap((c) => treeLines(c, depth + 1)),
  ];
}

/** template 을 `<owner>-<system>-…-sa-<role>` 꼴로 펼친다. slug 는 실제 약어를 그대로 쓴다 (구분자 없는 규칙은 붙여 쓴다).
 *  용도 토큰 tier(D60)는 마법사(/v1/wizard)만 채우는 자리라 `[-<tier>]` 로 적는다 — 괄호가 앞 구분자까지 감싼다(없으면 이름에 들지 않는다) */
export function formulaOf(rule: ResourceRule): string {
  const part = (t: Token): string => (t === 'slug' ? rule.slug : `<${t}>`);
  return rule.template.reduce((out, t, i) => (t === 'tier' ? `${out}[${rule.separator}<tier>]` : `${out}${i === 0 ? '' : rule.separator}${part(t)}`), '');
}

/** 「## Tiers」 절 (D60) — 꼴 · 예약어 · 프리셋 토큰. 예약어는 tier.ts 의 목록 그대로(규칙 · 별칭 · 지역 표에서 만든다) */
function tierLines(): string[] {
  return [
    '', '## Tiers', '',
    'A tier is a short purpose token (`web`, `was`) that only `/v1/wizard` fills. It goes after the abbreviation and kind token and before the sequence number: `[-<tier>]` in the formulas, for example `billing-shop-prod-ane3-gce-web-01`. Rules with a sequence number (`input: count`) take it there; on Google Cloud, rules with neither a sequence number nor a role (Cloud Storage bucket, BigQuery dataset, Spanner instance config, IAM custom role) take it right after the abbreviation, so two of them in one service can be told apart (`platform-billing-shop-prod-gcs-uploads`). Role rules and the project ID never take one. It is never shortened or dropped. A preset brings its own tier; `tier` on a pick overrides it. `/v1/generate` and `/v1/names` never put a tier in a name.',
    `- \`<tier>\` = \`${TIER_PATTERN.source}\``,
    '- rejected with 400 `wizard.invalid_tier` when it does not match, and `wizard.tier_reserved` when it is one of the reserved words below: abbreviations, kind tokens, environment values and their aliases, and region and zone codes — they would read as that token',
    `- reserved: ${[...RESERVED_TIERS].sort().map((w) => `\`${w}\``).join(' ')}`,
    `- preset tokens: ${PRESET_TIERS.map((t) => `\`${t}\``).join(' ')}`,
  ];
}

/** 「## Attached resources」 절 (D62) — 호환표(attachments.ts) 행마다 한 줄 · 상속 · 줄이지 않는다 */
function attachLines(): string[] {
  return [
    '', '## Attached resources', '',
    `A server slot on \`/v1/wizard\` can carry attached resources. Their name is the final name of the parent plus a suffix, so they inherit its region, tier and sequence; they are never shortened. If the result is too long the attached item is \`valid: false\` with \`name.cannot_fit\` and \`name.parent_name\`; if the parent is not valid the attached item comes back with an empty name and \`name.parent_invalid\`. Data disks take their own numbers (\`data: ["01", "02"]\`, 1 to ${MAX_DATA_DISKS}).`,
    ...ATTACHMENTS.map((a) => `- \`-${a.attach}${a.seq ? '-<seq>' : ''}\` · attach \`${a.attach}\` on \`${a.parent}\` → \`${a.child}\``),
  ];
}

/** 프리셋 묶음 (D59 · D73) — 네트워크 · 로드 밸런서는 group, 서버 VM(초기 딸린 것 없음)은 한 줄, 나머지는 하나씩 */
function presetGroups(): Preset[][] {
  const groups = new Map<string, Preset[]>();
  for (const p of PRESETS) {
    const key = p.group ?? (p.ruleId === 'gcp.compute_instance' && !p.defaultAttach ? 'server' : p.id);
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.values()];
}

/** 「## Wizard presets」 절 (D59 · D61 · D65) — 묶음마다 한 줄: 프리셋 id · 규칙 · tier · HA · 서버리스 · 초기 딸린 것 */
function presetLines(): string[] {
  const one = (p: Preset): string => {
    const bits = [`\`${p.id}\` (${p.label}) → \`${p.ruleId}\``];
    if (p.tier !== null) bits.push(`tier \`${p.tier}\`${p.tierChoices ? ` (or ${p.tierChoices.filter((t) => t !== p.tier).map((t) => `\`${t}\``).join(', ')})` : ''}`);
    if (p.serverless) bits.push(`serverless: ${p.serverless.ruleIds.map((r) => `\`${r}\``).join(' or ')}`);
    if (p.defaultAttach?.data) bits.push(`the screen starts it with data disk ${p.defaultAttach.data.map((d) => `\`${d}\``).join(', ')}`);
    return bits.join(', ');
  };
  return [
    '', '## Wizard presets', '',
    `\`preset\` on a \`/v1/wizard\` pick. Each preset is one rule; \`preset: null\` with \`rule\` picks any other rule. Network presets (VPC, subnet, firewall, Cloud Router, Cloud NAT) are usually project-level (\`project_picks\`); the load balancer parts are separate presets, one name each, and are not linked to one another. At most ${MAX_SERVICES} services and ${MAX_PICKS_PER_SERVICE} picks per service or in \`project_picks\`.`,
    ...presetGroups().map((g) => {
      const ha = g.find((p) => p.ha);
      return `- ${g.map(one).join('; ')}${ha?.ha ? ` · HA (\`ha: true\`) on ${g.filter((p) => p.ha).map((p) => `\`${p.id}\``).join(' and ')} as virtual machines only: at least ${ha.ha.minInstances} servers` : ''}`;
    }),
  ];
}

/** 표준값 한 줄씩 — 별칭이 있으면 같이 (ENV_ALIASES 가 정본) */
function allowedValues(dict: Record<string, string>): string[] {
  return [...new Set(Object.values(dict))].map((canon) => {
    const aliases = Object.entries(dict).filter(([k, v]) => v === canon && k !== canon).map(([k]) => k);
    return aliases.length > 0 ? `- \`${canon}\` — aliases: ${aliases.join(', ')}` : `- \`${canon}\``;
  });
}

/** 「## Regions」 절 (D49 · D50 revised) — 받는 꼴 · 코드 규칙 · 켜진 CSP 마다 리전 한 줄(이름 · 코드 · 위치 · 존). 존 입력은 리전으로 풀린다. 표는 지역 표(regions-data)가 정본이다 */
function regionLines(order: readonly Provider[]): string[] {
  const lines = [
    '', '## Regions', '',
    '`region` takes a region or a zone of the provider you name, by name or by code, in any case: `asia-northeast3`, `asia-northeast3-a`, `ane3` or `ane3a`, or `global`. Country values such as `kr`, `us`, `jp` and `eu` are rejected (400 `context.value_unsupported`, with the matching region names in `supported`), and so are region names of another provider.',
    'Names carry a short region code, not the region name: each region has the code listed below, and a zone name is accepted and resolved to its region (`asia-northeast3-a` and `ane3a` -> `ane3`); names never carry a zone. A region name, zone name or zone code you send is reported once as `context.normalized`. `global` puts no region token in any name.',
    'Zonal and regional resources alike carry the region code (or drop it first when the name is too long); global resources carry none.',
  ];
  for (const p of order) {
    lines.push('', `### ${p.toUpperCase()}`);
    for (const r of REGIONS[p]) {
      const zones = r.zones.length > 0 ? ` · zones: ${r.zones.map((z) => `\`${z.zone}\` \`${z.code}\``).join(', ')}` : '';
      lines.push(`- \`${r.region}\` · \`${r.code}\` — ${r.label}${zones}`);
    }
  }
  return lines;
}

/** 「## Kind tokens」 절 (D52) — 종류 표가 있는 catalog 행마다 한 줄(값 → 토큰 · 기본값 근거 · 확인일), 그 아래 규칙(= 범위)마다 기본값 · 허용 값.
 *  표는 catalog 가 정본이고 확인일은 kind-sources.json 의 전사 날(생성 파일 GCP_KIND_CHECKED)이다 */
export function kindLines(order: readonly Provider[], rowsOf: (p: Provider) => readonly CatalogRow[] = catalogFor): string[] {
  const lines = [
    '', '## Kind tokens', '',
    '`kind` on `/v1/names` takes a value name from the list below (`POSTGRES`, `snapshot-schedule`), not the token. The token goes right after the abbreviation: `…-<slug>-<kind>-<seq>`. The provider default of the scope, and values marked (no token), add no token even when sent. A rule that needs a kind (`required`) comes back `valid: false` with `name.kind_required` without one; `/v1/names` rejects that request first (400 `selection.kind_required`). One kind per item.',
    'Each line: the catalogue row, its values (value → token), the kind rule, the basis for the provider default and the date the sources were last checked. Under it, one line per rule (scope): its default and the values it accepts — the same value can be accepted in one scope and not another.',
  ];
  const checked: Readonly<Record<string, string | null>> = GCP_KIND_CHECKED;
  for (const p of order) {
    const rows = rowsOf(p).flatMap((row) => (row.kind === null ? [] : [{ row, k: row.kind }]));
    if (rows.length === 0) continue;
    lines.push('', `### ${p.toUpperCase()}`);
    for (const { row, k } of rows) {
      const values = Object.entries(k.tokens).map(([v, t]) => (t === null ? `\`${v}\` (no token)` : `\`${v}\` → \`${t}\``)).join(' · ');
      const rule = k.rule === 'required' ? 'required' : k.rule === 'only-when-chosen' ? 'only when chosen' : 'omitted when it is the provider default';
      // 「- `id` (」 는 제약 줄 · 「- `id`: `」 는 공식 줄의 꼴이라 겹치지 않게 「- `key` · slug」 로 쓴다
      lines.push(`- \`${row.key}\` · slug \`${row.slug.value}\`: ${values} — ${rule} · basis: ${k.defaultBasis} · checked ${checked[row.key] ?? 'unknown'}`);
      for (const [id, spec] of Object.entries(row.rules)) {
        // 행에 종류 표가 있어도 규칙에 kinds 가 없으면 적을 기본값 · 허용 값이 없다 — 그 줄만 뺀다
        const kinds = spec.kinds;
        if (!kinds) continue;
        lines.push(`  - \`${id}\` (${spec.scope}): ${kinds.default === null ? 'no default' : `default \`${kinds.default}\``} · accepts ${kinds.allowed.map((v) => `\`${v}\``).join(', ')}`);
      }
    }
  }
  return lines;
}

function constraintLine(rule: ResourceRule, catalog: Catalog): string {
  const f = rule.forbidden;
  const forbidden = f
    ? [
        ...(f.prefixes ? [`prefixes ${f.prefixes.join(' ')}`] : []),
        ...(f.suffixes ? [`suffixes ${f.suffixes.join(' ')}`] : []),
        ...(f.contains ? [`contains ${f.contains.join(' ')}`] : []),
        ...(f.exact ? [`exact ${f.exact.join(' ')}`] : []),
        ...(f.words ? [`words ${f.words.join(' ')} (as a word: not next to a letter)`] : []),
        ...(f.ipv4 ? ['no IPv4 form'] : []),
        ...(f.ignoreCase ? ['case-insensitive'] : []),
      ].join('; ')
    : '';
  // 플래그가 있으면 같이 적는다 — \p{L} · \u{…} 는 u 없이는 다른 뜻이 된다
  const flags = rule.pattern.flags ? ` (flags: ${rule.pattern.flags})` : '';
  const bits = [`${rule.minLength}-${rule.maxLength} chars`, `pattern \`${rule.pattern.source}\`${flags}`];
  if (rule.noConsecutiveSeparator) bits.push('no consecutive separators');
  if (forbidden) bits.push(`forbidden: ${forbidden}`);
  // 설명은 코드로 싣고 문장은 사전이 만든다 (D23) — 여러 개면 「; 」로 잇는다
  if (rule.notes && rule.notes.length > 0) bits.push(`note: ${formatNotes(rule.notes, catalog)}`);
  bits.push(`docs: ${rule.docUrl}`);
  return `- \`${rule.id}\` (${rule.displayName}): ${bits.join(' · ')}`;
}

/** providers — 실을 CSP. 기본은 켜진 CSP(D45). 시험은 셋을 넘겨 꺼진 CSP 의 줄 꼴도 본다 */
export function buildLlmsText(rules: ResourceRule[], version: Version, catalog: Catalog = en, providers: readonly Provider[] = ENABLED_PROVIDERS): string {
  const byProvider = (p: Provider): ResourceRule[] => rules.filter((r) => r.provider === p);
  const order = ORDER.filter((p) => providers.includes(p));
  const planned = PROVIDERS.filter((p) => !providers.includes(p)).map((p) => LABEL[p]);
  const enabledNames = joinNames(order.map((p) => LABEL[p]));
  const lines: string[] = [
    '# Cloudonym',
    '',
    `> Engine ${version.engine} · rules revision ${version.rules}`,
    '',
    `> Cloud resource naming engine for ${enabledNames} — generates, corrects and validates names against each provider's physical constraints.`,
    ...(planned.length > 0 ? [`> ${joinNames(planned)}: planned — not enabled yet. The API answers 400 \`request.provider_not_enabled\` for them.`] : []),
    '> For humans (web UI) and for AI coding agents / IaC (`POST /v1/generate` · `POST /v1/names` · `POST /v1/wizard` · `POST /v1/validate` · `GET /openapi.json`).',
    "> Cloudonym does not replace the provider's final verdict — it checks only the reserved words and patterns that the official documents state.",
    '',
    '## Naming Formulas',
    '',
    'One line per rule: `<rule id>`: formula · `optional` = tokens dropped first (in this order) when the name is too long. `<seq>` defaults to `01` (`count` on `/v1/names` gives `01`…`99`), `<role>` defaults to `sync` (`role` on `/v1/names`), `<kind>` is empty unless `kind` on `/v1/names` picks a value with a token (see `## Kind tokens`). `[-<tier>]` is filled only by `/v1/wizard` (see `## Tiers`).',
  ];
  for (const p of order) {
    lines.push('', `### ${p.toUpperCase()}`);
    for (const r of byProvider(p)) {
      lines.push(`- \`${r.id}\`: \`${formulaOf(r)}\`${r.optional.length > 0 ? ` · optional: ${r.optional.join(', ')}` : ''}`);
    }
  }
  lines.push('', '## Canonical Allowed Values', '', '### env', ...allowedValues(ENV_ALIASES), '', '### region',
    '- a region or a zone of the provider, by name or by code — see `## Regions`', '- `global`');
  lines.push(...regionLines(order));
  lines.push(...kindLines(order));
  lines.push(...tierLines(), ...attachLines(), ...presetLines());
  lines.push('', '## Provider Constraints');
  for (const p of order) {
    lines.push('', `### ${p.toUpperCase()}`);
    for (const r of byProvider(p)) lines.push(constraintLine(r, catalog));
  }
  // 범위 트리 (D37 · D39) — buildTree 에서 만든다. 손으로 쓴 트리는 없다
  lines.push(
    '', '## Resource tree', '',
    'Where each resource is created, from the widest scope down. Under each scope: its rules (`input` = what `/v1/names` accepts for that rule: `count` 1-99, `role`, or `none`), then its child scopes.',
    '', SCOPE_MEANING, '', UNIQUENESS_MEANING,
  );
  for (const p of order) lines.push('', `### ${p.toUpperCase()}`, ...treeLines(buildTree(p)));
  // PASS 의 뜻 (D28) — 정본은 사전의 ui.pass_meaning. README · openapi.json 은 같은 문장을 옮겨 적고 시험이 대어 본다
  lines.push('', '## What PASS means', '', catalog.ui.pass_meaning);
  lines.push(
    '',
    '## API',
    '',
    `- \`POST /v1/generate\` — body \`{ "context": { "owner", "system", "purpose", "env", "region" }, "providers"?: [${order.map((p) => `"${p}"`).join(', ')}], "rules_version"?: string }\``,
    '- `POST /v1/names` — body `{ "provider", "context": { … }, "resources": [{ "type", "count"?: 1-99, "role"?: string, "kind"?: string }], "rules_version"?: string }` — only the resources you pick; `data.<provider>` is `{ valid, items[], conflicts[] }`. Each item carries `key`, `resource_type`, `seq` or `role`, `kind` and `kind_token` when a kind was picked (`kind_token` only when the name carries one), `scope`, `uniqueness` and the same fields as a `/v1/generate` name. At most 200 resources and 200 names per request',
    `- \`owner\`, \`system\` and \`purpose\` are at most ${MAX_CONTEXT_CHARS} characters; \`env\`, \`region\` and the other strings at most ${MAX_FIELD_CHARS}. A longer value is 400 \`request.field_too_long\``,
    '- `POST /v1/wizard` — body `{ "provider", "project": { "owner", "system", "env", "region" }, "project_picks"?: [pick], "services"?: [{ "purpose", "picks": [pick] }], "rules_version"?: string }` with pick `{ "preset": id | null, "rule"?: rule id, "tier"?, "role"?, "kind"?, "ha"?: boolean, "serverless"?: rule id, "instances"?: [{ "id", "seq", "attach"?: { "boot"?: true, "data"?: [seq], "ip"?: true, "ipi"?: true } }] }` — one project: the project ID first, then project-level items, then each service; each parent is followed by its attached resources. `data.<provider>` is `{ valid, items[], conflicts[] }`; items carry a structured `key` (`service/shop/compute_instance/web/01/data/01`), `namespace` (`project` or the service), `level`, `tier`, `parent` and `attach` when they apply, and the `/v1/names` item fields. `metadata.generated_labels.<provider>` maps each namespace to its labels (the `project` labels have no `purpose`). A 400 names the offending element in `field` with the request names (`project_picks[0].instances[0].attach.data[1]`); errors about the whole plan have no `field`. At most 200 names including the project ID',
    'The wizard response is not reproduced through `/v1/names`: the wizard response is reproduced by repeating the same wizard request with its `rules_version`; `/v1/names` is a separate, flat endpoint.',
    '- `POST /v1/validate` — body `{ "provider", "resource_type", "name", "rules_version"?: string }`',
    '- `GET /v1/health` — `{ "ok": true, "version": { "engine", "rules" } }`',
    '- `GET /openapi.json` — OpenAPI 3.0.3',
    '- `GET /catalog.json` — the resource catalog of the enabled providers as JSON: one row per resource with its rule ids, abbreviation, kinds and kind tokens, region-token kind (`none` or `region`), description and search aliases, the region and zone codes, and `version: { engine, rules }`',
    '',
    '`/v1/generate` is the catalogue (every rule of the providers, sequence `01`, no kind); `/v1/names` is the selection. Rules that need a kind come back `valid: false` there (`name.kind_required`) — use `/v1/names` with `kind` for them. One `/v1/names` request stands for one instance of each parent scope (one resource group, one project, one VPC): names that collide inside the request (same kind of resource, same name; Azure and AWS compare case-insensitively) are each marked `valid: false` with `name.conflict`, and `conflicts` lists each collision once. Two resource groups are two requests.',
    'Successful responses of `/v1/generate`, `/v1/names`, `/v1/wizard`, `/v1/validate` and `/v1/health` carry `version: { engine, rules }` (failures and `/v1/events` do not). `violations`, `steps`, `errors`, `rule.notes` and the label lists are arrays of `{ code, field?, params?, message }` — branch on `code`, show `message` to people.',
    '`rules_version` pins a request to a rules revision: if it differs from the current one the API answers 409 `request.rules_version_mismatch` instead of returning names that may differ. The API never serves an old rules revision — store the names you created and keep using them.',
    'Every failure (400, 403, 404, 409, 413, 429, 500) has the same shape: `{ "success": false, "errors": [{ code, field?, params?, message }], "supported"?: [...] }`. An unknown `/v1` path or method is 404 `request.not_found`.',
    '',
    'Paths are relative to the host that served this file.',
  );
  return `${lines.join('\n')}\n`;
}
