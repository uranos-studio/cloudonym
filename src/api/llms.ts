// /llms.txt 본문 — 규칙 표(RULES)에서 만든다. 손으로 쓴 공식 · 숫자를 두지 않는다 (D9 · D17)
import { ENABLED_PROVIDERS, MIN_TOKEN, PROTECTED, PROVIDERS, TIER_PATTERN, type Provider, type ResourceRule, type Token } from '../core/types';
import { RESERVED_TIERS } from '../core/tier';
import { MAX_PICKS_PER_SERVICE, MAX_SERVICES } from '../core/wizard/plan';
import { PRESETS, PRESET_TIERS, type Preset } from '../core/wizard/presets';
import { BUNDLES, partIsProject, partKey } from '../core/wizard/bundles';
import { ATTACHMENTS, MAX_DATA_DISKS } from '../core/wizard/attachments';
import { buildTree, inputKind, type TreeNode } from '../core/tree';
import { rulesFor } from '../core/constraints';
import { SHORT_WORDS } from '../core/shorten';
import { SCOPES } from '../core/scopes';
import { ENV_ALIASES, ENV_VALUES } from '../core/normalize';
import { LOCATIONS, REGIONS } from '../core/regions-data';
import { MAX_CONTEXT_CHARS } from '../core/engine';
import { catalogFor } from '../core/catalog';
import { GCP_KIND_CHECKED, type CatalogRow } from '../core/rules/gcp-catalog';
import { MAX_FIELD_CHARS } from './schemas';
import { MAX_BODY_BYTES } from './v1';
import { RATE_LIMIT } from './ratelimit';
import { MAX_ECHO_CHARS, MAX_GENERATE_ERRORS, MAX_WIZARD_ERRORS } from './errors';
import { CATALOG_LIMITS, catalogAttachments, catalogPresets } from './catalog';
import { MAX_ITEMS, MAX_NAMES } from '../core/selection';
import { PLAN_FILE_MAX_BYTES } from '../components/planFile';
import { API_DOC_LIMITED_ROOT, API_DOC_UNLIMITED } from '../components/apiDocModel';
import { SHAREABLE_PARTS } from '../components/wizardBundles';
import { enabledResourceCounts } from '../components/resourceCount';
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

/** 「짧은 이름」 표시 기준 — 이 길이 이하인 규칙을 「규약 그대로면 넘치기 쉽다」로 묶는다. CSP 숫자가 아니라 표시 기준이다:
 *  다섯 문맥값을 보통 낱말로 채우고 구분자 넷을 더하면 이 길이를 넘는다. 목록의 숫자는 규칙 표(maxLength)에서 온다 */
export const SHORT_NAME_LIMIT = 32;

/** 탐침 — 같은 길이의 소문자 이름(control)은 받는데 이 꼴은 받지 않는 규칙을 센다. 길이 · 고정 접두 때문에 control 부터 받지 않는 규칙은 세지 않는다 */
export const PROBES = { control: 'abcdefghijkl', underscore: 'abcdef_ghijk', dot: 'abcdef.ghijk', upper: 'Abcdefghijkl' } as const;

/** 「## For AI coding agents」 절 — 직접 짓지 말고 API 를 부르라는 안내 · 축소 순서 · 약어 표 · 규약을 그대로 쓰면 깨지는 규칙.
 *  축소 순서는 truncate.ts fit() 의 단계, 약어는 SHORT_WORDS, 목록은 켜진 규칙의 separator · maxLength · pattern · 범위에서 만든다 */
export function agentLines(rules: readonly ResourceRule[], order: readonly Provider[]): string[] {
  const listOr = (xs: readonly string[]): string => (xs.length === 0 ? 'none' : xs.join(', '));
  const withMax = (rs: readonly ResourceRule[]): string => listOr(rs.map((r) => `\`${r.id}\` ${r.maxLength}`));
  const lines = [
    '', '## For AI coding agents', '',
    'Do not compose resource names yourself, and do not apply a naming convention to them by hand. Send the five context values to `POST /v1/generate` (every rule of a provider) or `POST /v1/names` (only the resources you need) and use each item\'s `name` as it is. The same request on the same rules revision always gives the same name; a name composed by hand comes out differently from one model or session to the next, is shortened differently, and many resources cannot be renamed after they are created.',
    '- A name you already have: send it to `POST /v1/validate`. When `valid` is false, use `suggested_name` if there is one (read `suggested_warnings` with it), otherwise generate the name. `warnings` never makes a name invalid.',
    '- Use only names with `valid: true`. A name that cannot fit is `valid: false` with the reason in `violations` — the engine never cuts a name just to pass.',
    '- Keep the names you created and send `rules_version` with later requests (see the API section below).',
    '',
    'How the engine shortens a name that is too long — in this order, stopping as soon as the name fits:',
    '1. It drops the rule\'s `optional` tokens in the order given in its formula line below.',
    `2. It replaces a token that equals a word in the abbreviation list below. Only ${codes(['owner', 'system', 'purpose'].filter((t) => !PROTECTED.includes(t as Token)))} are replaced; ${codes(PROTECTED)} are never changed in this step or the next.`,
    `3. It cuts each of those tokens to the same length, ⌊(maximum − length of the unchanged tokens − separators) / number of cut tokens⌋, and never below ${MIN_TOKEN} characters.`,
    '4. If the name still does not fit, the item is `valid: false` with `name.cannot_fit`.',
    '',
    'Abbreviations (step 2):',
    ...Object.entries(SHORT_WORDS).map(([w, a]) => `- \`${w}\` → \`${a}\``),
    '',
    `Regions: names carry the short region code from \`## Regions\`, never the region name (${order.map((p) => { const r = REGIONS[p][0]!; return `\`${r.region}\` → \`${r.code}\``; }).join(', ')}). Use the codes listed there; do not make up your own.`,
    '',
    'Rules a naming convention breaks when it is applied word for word (from `## Provider Constraints`):',
  ];
  for (const p of order) {
    const rs = rules.filter((r) => r.provider === p);
    const plain = rs.filter((r) => r.pattern.test(PROBES.control));
    const rejects = (probe: string) => plain.filter((r) => !r.pattern.test(probe)).length;
    const scopeNote = (r: ResourceRule) => (r.notes ?? []).some((n) => n.code === 'note.scope_unconfirmed') ? ' (scope not confirmed)' : '';
    const label = LABEL[p];
    const noHyphen = rs.filter((r) => r.separator !== '-');
    lines.push(
      `- ${label}, no hyphen between tokens: ${listOr(noHyphen.map((r) => `\`${r.id}\` (joined with ${r.separator === '' ? 'nothing' : `\`${r.separator}\``})`))}`,
      `- ${label}, characters: of the ${plain.length} rules that accept a plain lower-case name, \`_\` is rejected by ${rejects(PROBES.underscore)}, \`.\` by ${rejects(PROBES.dot)} and capital letters by ${rejects(PROBES.upper)} — a convention that uses them fails those rules`,
      `- ${label}, at most ${SHORT_NAME_LIMIT} characters — names of five context words are usually too long and get shortened: ${withMax(rs.filter((r) => r.maxLength <= SHORT_NAME_LIMIT))}`,
      `- ${label}, unique across every customer of the provider (global namespace) — a name that passes can still be taken: ${listOr(rs.filter((r) => r.uniqueness === 'csp' && SCOPES[r.scope].parent === undefined).map((r) => `\`${r.id}\`${scopeNote(r)}`))}`,
    );
  }
  return lines;
}

/** 「## Tiers」 절 (D60) — 꼴 · 예약어 · 프리셋 토큰. 예약어는 tier.ts 의 목록 그대로(규칙 · 별칭 · 지역 표에서 만든다) */
function tierLines(): string[] {
  return [
    '', '## Tiers', '',
    'A tier is a short purpose token (`web`, `was`) that only `/v1/wizard` fills. It goes after the abbreviation and kind token and before the sequence number: `[-<tier>]` in the formulas, for example `billing-shop-prod-ane3-gce-web-01`. Rules with a sequence number (`input: count`) take it there; on Google Cloud, rules with neither a sequence number nor a role (Cloud Storage bucket, BigQuery dataset, Spanner instance config, IAM custom role) take it right after the abbreviation, so two of them in one service can be told apart (`platform-billing-shop-prod-ane3-gcs-uploads`). Role rules and the project ID never take one. It is never shortened or dropped. A preset brings its own tier; `tier` on a pick overrides it. `/v1/generate` and `/v1/names` never put a tier in a name.',
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
    `\`preset\` on a \`/v1/wizard\` pick. Each preset is one rule; \`preset: null\` with \`rule\` picks any other rule. Network presets (VPC, subnet, firewall, Cloud Router, Cloud NAT) are usually project-level (\`project_picks\`); the load balancer parts are separate presets, one name each. A working set of them is listed under "Wizard cards" below. At most ${MAX_SERVICES} services and ${MAX_PICKS_PER_SERVICE} picks per service or in \`project_picks\`.`,
    ...presetGroups().map((g) => {
      const ha = g.find((p) => p.ha);
      return `- ${g.map(one).join('; ')}${ha?.ha ? ` · HA (\`ha: true\`) on ${g.filter((p) => p.ha).map((p) => `\`${p.id}\``).join(' and ')} as virtual machines only: at least ${ha.ha.minInstances} servers` : ''}`;
    }),
  ];
}

/** 「## Wizard cards」 절 (D93) — 카드마다 한 줄: 서비스 picks · project_picks · 선택. 카드는 화면의 동작이고 API 에는 없다 — 같은 picks 를 보내면 같은 이름이다 */
function cardLines(): string[] {
  const list = (ps: readonly { preset: string; tier?: string }[]) => ps.map((p) => (p.tier === undefined ? `\`${p.preset}\`` : `\`${p.preset}\` tier \`${p.tier}\``)).join(', ');
  return [
    '', '## Wizard cards', '',
    'A card on the wizard screen adds a working set of presets at once. Cards are not part of `/v1/wizard`: send the same picks to get the same names. Project parts go in `project_picks`; the rest in the service.',
    ...BUNDLES.map((b) => {
      const svc = b.parts.filter((p) => !partIsProject(p));
      const prj = b.parts.filter(partIsProject);
      const bits = [`\`${b.id}\` (${b.label}): ${svc.length > 0 ? list(svc) : 'no service parts'}`];
      if (b.backends) bits.push(`plus one backend by what the service has: ${b.backends.map((x) => `\`${x.needs}\` → ${list(x.parts)}`).join('; ')}`);
      if (prj.length > 0) bits.push(`project: ${list(prj)}`);
      if (b.options.length > 0) bits.push(`options: ${b.options.map((o) => `${o.label} (${list(o.parts)}${o.on ? ', on by default' : ''})`).join('; ')}`);
      bits.push(b.tested ? 'built and tested on Google Cloud' : 'rules verified, the set not yet applied');
      return `- ${bits.join(' · ')}`;
    }),
    `One load balancer card per service (shared parts such as \`${partKey({ preset: 'ip' })}\` and \`${partKey({ preset: 'url' })}\` would be duplicate picks); add another service for a second one.`,
    // D115 — 함께 쓰는 부품은 pick 하나로 보낸다(같은 pick 둘은 duplicate_pick)
    `Other cards can share a service: send ${[...SHAREABLE_PARTS].map((x) => `\`${x}\``).join(', ')} once and every card in that service uses it (for example \`event-pipeline\`, \`ci-cd\` and \`batch-job\` with one \`sa\`).`,
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
    '`region` takes a region or a zone of the provider you name, by name or by code, in any case: `asia-northeast3`, `asia-northeast3-a`, `ane3` or `ane3a`, or `global`. Country values such as `kr` and `jp` are rejected (400 `context.value_unsupported`, with the matching region names in `supported`), and so are region names of another provider. On Google Cloud, `us` and `eu` are the multi-region locations below, not countries.',
    'Names carry a short region code, not the region name: each region has the code listed below, and a zone name is accepted and resolved to its region (`asia-northeast3-a` and `ane3a` -> `ane3`); names never carry a zone. A region name, zone name or zone code you send is reported once as `context.normalized`. `global` puts no region token in any name.',
    'Zonal and regional resources alike carry the region code (or drop it first when the name is too long); global resources carry none.',
  ];
  for (const p of order) {
    lines.push('', `### ${p.toUpperCase()}`);
    for (const r of REGIONS[p]) {
      const zones = r.zones.length > 0 ? ` · zones: ${r.zones.map((z) => `\`${z.zone}\` \`${z.code}\``).join(', ')}` : '';
      lines.push(`- \`${r.region}\` · \`${r.code}\` — ${r.label}${zones}`);
    }
    if (LOCATIONS[p].length > 0) {
      lines.push('', 'Multi-region and dual-region locations (D78): `region` (and `location` on a `/v1/wizard` pick) also takes these, by name or code in any case, but only for the resource types listed on each line — names carry the lower-case code in the region slot (`…-prod-us-gcs`). Any other type with a region token is 400 `context.location_unsupported` on `/v1/generate` (which names every type, so always) and `/v1/names`, and `wizard.invalid_location` on a wizard pick; the wizard project region stays a single region.');
      for (const l of LOCATIONS[p]) {
        const types = Object.keys(l.rules).map((id) => `\`${id.slice(id.indexOf('.') + 1)}\``).join(', ');
        lines.push(`- \`${l.location}\` · \`${l.code}\` — ${l.type} · ${l.label} · for ${types} · ${[...new Set(Object.values(l.rules))].join(' · ')}`);
      }
      lines.push('', 'Secret Manager secrets (`secret`, D79) carry no region token by default: a secret has no location unless it is created as a regional secret (`projects/*/locations/*/secrets`), so its name ignores the context region and a location never fails it. On a `/v1/wizard` pick, `location: "regional"` puts the project region in its name (`…-prod-ane3-secret-01`); with a `global` project region that is 400 `wizard.location_needs_region`.');
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


/** 세 자리마다 쉼표 — 176,548. Number.toLocale* 은 kst-guard 가 막는 이름이라 쓰지 않는다 */
const grouped = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** 백틱으로 감싼 목록 — `a`, `b` and `c` */
const codes = (xs: readonly string[]): string => joinNames(xs.map((x) => `\`${x}\``));

/** 「## Limits」 절 — 본문 · 요청 제한 · 필드 · 항목 · 오류 수 · 되돌린 값. 숫자는 전부 서버 상수에서 (D100 · D103).
 *  요청 제한을 받는 · 받지 않는 GET 목록은 /docs/api 와 같은 상수(apiDocModel)다 — 서버 동작과 같은지는 apidoc-sync.test 가 본다 */
function limitLines(): string[] {
  const gets = (xs: readonly string[]) => joinNames(xs.map((x) => `\`GET ${x}\``));
  return [
    '', '## Limits', '',
    `- Request body: at most ${MAX_BODY_BYTES} bytes on \`POST /v1/*\`. A larger body is 413 \`request.body_too_large\` with \`params: { max_bytes }\`, before the body is read. A saved plan file fits (see \`## Plan file\`).`,
    `- Rate limit: ${RATE_LIMIT.limit} requests per ${RATE_LIMIT.period} seconds per client IP, counted together across ${joinNames(['every `POST /v1/*`', ...API_DOC_LIMITED_ROOT.map((x) => `\`GET ${x}\``)])}. ${gets(API_DOC_UNLIMITED)} are not counted. Over the limit the answer is 429 \`request.rate_limited\` with \`Retry-After: ${RATE_LIMIT.period}\` (seconds) — wait that long, then send again.`,
    `- Fields: \`owner\`, \`system\` and \`purpose\` are at most ${MAX_CONTEXT_CHARS} characters; \`env\`, \`region\` and the other strings at most ${MAX_FIELD_CHARS}. A longer value is 400 \`request.field_too_long\`.`,
    `- \`/v1/names\`: At most ${MAX_ITEMS} resources and ${MAX_NAMES} names per request. \`/v1/wizard\`: at most ${MAX_NAMES} names including the project ID.`,
    `- Errors: ${MAX_WIZARD_ERRORS === MAX_GENERATE_ERRORS ? `a \`POST /v1/wizard\` or \`POST /v1/generate\` 400 lists at most the first ${MAX_WIZARD_ERRORS} errors` : `a \`POST /v1/wizard\` 400 lists at most the first ${MAX_WIZARD_ERRORS} errors and a \`POST /v1/generate\` 400 at most the first ${MAX_GENERATE_ERRORS}`}; when there are more, the last entry is \`request.errors_truncated\` with \`params: { shown, total }\` — fix those and send again to see the rest. \`/v1/names\`, \`/v1/validate\` and \`/v1/events\` list every error.`,
    `- Echoed values: a user value echoed in an error (\`params.value\`, \`params.requested\` and the \`message\` built from them) is cut to ${MAX_ECHO_CHARS} characters followed by \`…\`; control, bidirectional and zero-width characters appear as \`\\uXXXX\`. Lists such as \`supported\` are never cut.`,
  ];
}

/** 「## Plan file」 절 (D100) — 웹이 내려주고 · 열고 · API 와 CLI 가 받는 파일. 칸 이름은 public/plan.schema.json 과 같다(llms.test 가 본다) */
function planFileLines(): string[] {
  return [
    '', '## Plan file', '',
    'A plan file is the `POST /v1/wizard` request body plus two fields. Its fields: `provider`, `project`, `project_id_suffix` (optional), `project_picks`, `services` (as in the request), `rules_version` and `environments` (optional). `rules_version` is always there (the rules revision when it was saved); `environments` is there only when the plan has two or more environments, and `project.env` is the first of them.',
    '- The API ignores `environments` and names one environment, `project.env`: to name every environment, send one request per environment with `project.env` changed. With one environment the file is a request body as it stands (`curl -d @file`). `rules_version` pins the request: a 409 means the rules changed since the file was saved.',
    `- Requests carry at most ${MAX_BODY_BYTES} bytes; a saved file is indented, so send a large plan compacted (\`jq -c .\`).`,
    '- Fields the API does not know are ignored, so the same file gives the same names on the web and from the API; an unknown field inside `attach` is the exception (400).',
    '- JSON Schema: `GET /plan.schema.json`.',
    `- On the web, **Save plan** downloads the current plan as \`cloudonym-plan-<system>-<env>.json\`, and **Open plan** loads such a file the way a share link opens (invalid picks are left out and counted). Open plan does not read files over ${grouped(PLAN_FILE_MAX_BYTES)} bytes, the most a share link can hold.`,
  ];
}

/** 「## catalog.json fields」 절 (D101) — 클라이언트가 계획을 만들 때 읽는 칸. 키는 catalog.ts 가 만드는 것에서 꺼낸다 */
function catalogFieldLines(order: readonly Provider[]): string[] {
  const presetKeys = [...new Set(order.flatMap((p) => catalogPresets(p).flatMap((x) => Object.keys(x))))];
  const attachKeys = [...new Set(order.flatMap((p) => catalogAttachments(p).flatMap((x) => Object.keys(x))))];
  return [
    '', '## catalog.json fields', '',
    '`GET /catalog.json` is what a client reads to build a `/v1/wizard` pick or a plan file without keeping its own copy of the rules. The limits are guidance before sending — the API\'s answer is the verdict.',
    `- \`env_values\` (top level, not per provider): the standard \`project.env\` values in order — ${codes(ENV_VALUES)}; aliases resolve to these`,
    '- per rule (`providers.<provider>.rows[].rules.<rule id>`): `input` — what a pick of it takes: `count` (numbered servers in `instances[]`), `role` (a `role`) or `none`; `tier` — `true` when the name has a tier slot (see `## Tiers`); `locations` — the values a pick may send as `location`, only on rules that take one',
    `- \`presets\` (per provider): the wizard presets in request names — ${codes(presetKeys)}; send \`id\` as \`preset\``,
    `- \`attachments\` (per provider): what a server slot can carry — ${codes(attachKeys)} (see \`## Attached resources\`)`,
    `- \`limits\` (per provider): ${codes(Object.keys(CATALOG_LIMITS))}`,
    '- `scopes` (per provider): the uniqueness scopes — `id` (the `scope` that `/v1/wizard` and `/v1/names` items carry), `name` and `parent`; a scope with no `parent` is the provider\'s widest one, so a name unique there is unique across every customer of the provider (see `## Resource tree`)',
  ];
}

/** 「## CLI」 절 (D102) — 저장소의 명령줄 도구. Worker 는 cli/ 를 들여오지 않는다(src → cli 는 시험만) — 종료 코드 줄은 cli 의 --help 줄과 글자까지 같아야 하고,
 *  llms.test 가 그 줄과 EXIT 를 대어 본다(--help 줄은 cli/main.test.mjs [6] 이 README · D102 와 대어 본다) */
export const CLI_EXIT_LINE = 'Exit codes: 0 ok · 1 a name FAILs or add would change existing names or verdicts · 2 plan, names file or arguments rejected (400, 413), a file cannot be read or written, it changed while the command ran, or its lock could not be removed after saving · 3 rules_version differs (409) · 4 server unreachable, 429, 5xx or an answer that cannot be interpreted · 64 usage · 70 internal error';
function cliLines(): string[] {
  return [
    '', '## CLI', '',
    'The source repository has a command-line tool (Node 22, no dependencies). It is not published to npm yet: run it from a clone with `node cli/cloudonym.mjs <command>` (`cli/package.json` is its package). It holds no naming rules — it edits a plan file and asks `POST /v1/wizard` for every name and verdict, and reads presets, rule inputs and limits from `/catalog.json`, so it gives the same names as the web and the API for the same rules revision.',
    '- Server: the public deployment by default, nothing to set; `--server <origin>`, then `CLOUDONYM_SERVER`, then `"server"` in the config file (`~/.config/cloudonym/config.json`, `$XDG_CONFIG_HOME/cloudonym/config.json` when set, `%APPDATA%\\cloudonym\\config.json` on Windows) override it. `--version` prints the server and its source on stderr.',
    '- Files: the plan file (default `cloudonym.plan.json`, `-f` to choose) and the names kept next to it (`cloudonym.plan.names.json`).',
    '- `new` — on a terminal, asks who runs the system, its name, the environments, the region and what to build (numbered lists from `/catalog.json`: `env_values`, `regions`, `presets`, and each rule\'s count, role, kinds, tier choices, HA and attachments), then saves the plan and names files and prints a What · Name · Check table. `cloudonym` with no command does the same when there is no plan file, and shows the names table when there is. A wrong answer is asked again from the 400 `field`. Not on a terminal, or with `--json`, it never asks: scripts use the commands below',
    '- `init` — a new plan file (`--owner --system --env E[,E2] --region`, `rules_version` from the server) or `--from <file>` to copy a file saved with Save plan',
    '- `add` — with no arguments on a terminal, asks what to add; otherwise appends a pick (a preset, a rule id or a resource name) to a service (`--service <purpose>`) or the project (`--project`), or numbered servers to the same pick; it writes the file only if every existing name and verdict stays the same in every environment and every new name passes, otherwise it exits 1 and leaves the file as it was. It never edits an existing pick. `--dry-run` checks without writing',
    '- `names` — every name, one request per environment; `--new` only names not yet kept, `--repin` re-pins `rules_version` after a 409; `--no-write` writes neither the plan nor the names file',
    '- `validate` — exit 0 when every name is valid and matches the kept names',
    '- `completion` — prints a bash, zsh or fish completion script for the commands and flags',
    '- Provider: `init --provider gcp|aws|azure` (or `new --provider`) sets the plan file\'s `provider` (default `gcp`); one plan file is one provider and later commands read it from the file. A provider the server has not enabled is refused with one line (400 `request.provider_not_enabled`, exit 2).',
    '- Output: `--output table|json|tsv` (`-o`; `--json` is `--output json`). `tsv` is a header line, then `env`, `what`, `name`, `check` (and `key` with `--keys`) per name. `--no-input` or `CLOUDONYM_NO_INPUT=1` never asks; where a question would be needed it exits 64 and names the flags to pass.',
    '- On 429 it prints `Retry-After`; `--wait` waits that long and retries once per command.',
    '- Saving holds `<plan>.lock` next to the file from the last check to the replace; while it exists another command does not write (exit 2). If no command is running, a left-over lock is from one that stopped: delete it. If the file is saved but its lock cannot be removed, the command says so, names the lock and exits 2.',
    `- ${CLI_EXIT_LINE}`,
  ];
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
    '> People: the API guide is the page `/docs/api` (curl examples, limits, failures); the naming guide is `/docs/naming`.',
    ...agentLines(rules, order),
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
  lines.push(...tierLines(), ...attachLines(), ...presetLines(), ...cardLines());
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
    // 화면(CloudPicker · /about)과 같은 함수 — 웹과 API 의 숫자가 갈라지지 않는다
    '', `Supported resources: ${enabledResourceCounts().map(({ provider, count }) => `${provider} ${count}`).join(' · ')} (rows of the tree below, counted from the catalog)`,
  );
  for (const p of order) lines.push('', `### ${p.toUpperCase()}`, ...treeLines(buildTree(p)));
  // PASS 의 뜻 (D28) — 정본은 사전의 ui.pass_meaning. README · openapi.json 은 같은 문장을 옮겨 적고 시험이 대어 본다
  lines.push('', '## What PASS means', '', catalog.ui.pass_meaning);
  lines.push(
    '',
    '## API',
    '',
    `- \`POST /v1/generate\` — body \`{ "context": { "owner", "system", "purpose", "env", "region" }, "providers"?: [${order.map((p) => `"${p}"`).join(', ')}], "rules_version"?: string }\``,
    '- `POST /v1/names` — body `{ "provider", "context": { … }, "resources": [{ "type", "count"?: 1-99, "role"?: string, "kind"?: string }], "rules_version"?: string }` — only the resources you pick; `data.<provider>` is `{ valid, items[], conflicts[] }`. Each item carries `key`, `resource_type`, `seq` or `role`, `kind` and `kind_token` when a kind was picked (`kind_token` only when the name carries one), `scope`, `uniqueness` and the same fields as a `/v1/generate` name (limits: see `## Limits`)',
    '- `POST /v1/wizard` — body `{ "provider", "project": { "owner", "system", "env", "region" }, "project_id_suffix"?: string, "project_picks"?: [pick], "services"?: [{ "purpose", "picks": [pick] }], "rules_version"?: string }` with pick `{ "preset": id | null, "rule"?: rule id, "tier"?, "role"?, "kind"?, "ha"?: boolean, "serverless"?: rule id, "instances"?: [{ "id", "seq", "attach"?: { "boot"?: true, "data"?: [seq], "ip"?: true, "ipi"?: true } }] }` — one project: the project ID first (with `project_id_suffix` appended as a protected token when given — same pattern and reserved words as a tier; project IDs are global and permanent, and Cloudonym cannot check whether one is free), then project-level items, then each service; each parent is followed by its attached resources. `data.<provider>` is `{ valid, items[], conflicts[] }`; items carry a structured `key` (`service/shop/compute_instance/-/web/01/data/01`), `namespace` (`project` or the service), `level`, `tier`, `parent` and `attach` when they apply, and the `/v1/names` item fields. `metadata.generated_labels.<provider>` maps each namespace to its labels (the `project` labels have no `purpose`). A 400 names the offending element in `field` with the request names (`project_picks[0].instances[0].attach.data[1]`); errors about the whole plan have no `field`. A plan file (see `## Plan file`) is this body',
    'The wizard response is not reproduced through `/v1/names`: the wizard response is reproduced by repeating the same wizard request with its `rules_version`; `/v1/names` is a separate, flat endpoint.',
    '- `POST /v1/validate` — body `{ "provider", "resource_type", "name", "rules_version"?: string }` — answers `{ valid, version, violations, warnings?, suggested_name?, suggested_warnings? }`: `suggested_name` when the name is invalid and a fix is possible, `warnings` when the name you sent has a form the documentation advises against without forbidding it, and `suggested_warnings` when `suggested_name` has one (warnings never change `valid`; name items carry the same `warnings`)',
    '- `GET /v1/health` — `{ "ok": true, "version": { "engine", "rules" } }`',
    '- `GET /openapi.json` — OpenAPI 3.0.3',
    '- `GET /catalog.json` — the resource catalog of the enabled providers as JSON: one row per resource with its rule ids, abbreviation, kinds and kind tokens, region-token kind (`none` or `region`), description and search aliases, the region and zone codes, and `version: { engine, rules }`; each rule also says what a wizard pick of it takes (`input`: `count`, `role` or `none`; `tier`; `locations`), and each provider lists the wizard `presets`, the `attachments` of a server slot and the request `limits` (see `## catalog.json fields`)',
    '',
    '`/v1/generate` is the catalogue (every rule of the providers, sequence `01`, no kind); `/v1/names` is the selection. Rules that need a kind come back `valid: false` there (`name.kind_required`) — use `/v1/names` with `kind` for them. One `/v1/names` request stands for one instance of each parent scope (one resource group, one project, one VPC): names that collide inside the request (same kind of resource, same name; Azure and AWS compare case-insensitively) are each marked `valid: false` with `name.conflict`, and `conflicts` lists each collision once. Two resource groups are two requests.',
    'Successful responses of `/v1/generate`, `/v1/names`, `/v1/wizard`, `/v1/validate` and `/v1/health` carry `version: { engine, rules }` (failures and `/v1/events` do not). `violations`, `warnings`, `steps`, `errors`, `rule.notes` and the label lists are arrays of `{ code, field?, params?, message }` — branch on `code`, show `message` to people.',
    '`rules_version` pins a request to a rules revision: if it differs from the current one the API answers 409 `request.rules_version_mismatch` instead of returning names that may differ. The API never serves an old rules revision — store the names you created and keep using them.',
    'Every failure (400, 403, 404, 409, 413, 429, 500) has the same shape: `{ "success": false, "errors": [{ code, field?, params?, message }], "supported"?: [...] }`. An unknown `/v1` path or method is 404 `request.not_found`.',
  );
  lines.push(...limitLines(), ...planFileLines(), ...catalogFieldLines(order), ...cliLines());
  lines.push('', 'Paths are relative to the host that served this file.');
  return `${lines.join('\n')}\n`;
}
