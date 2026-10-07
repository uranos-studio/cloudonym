// /llms.txt 본문 — 규칙 표(RULES)에서 만든다. 손으로 쓴 공식 · 숫자를 두지 않는다 (D9 · D17)
import { ENABLED_PROVIDERS, PROVIDERS, type Provider, type ResourceRule, type Token } from '../core/types';
import { buildTree, inputKind, type TreeNode } from '../core/tree';
import { ENV_ALIASES } from '../core/normalize';
import { REGIONS } from '../core/regions-data';
import { MAX_CONTEXT_CHARS } from '../core/engine';
import { regionTokenOfRule } from '../core/compose';
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

/** 범위 트리를 들여쓰기로 — 범위 한 줄(이름 · id · 근거 URL) 아래에 그 범위의 규칙(id · 입력 종류)과 자식 범위. 규칙 줄은 늘 들여쓰여 공식 · 제약 줄과 섞이지 않는다 */
function treeLines(node: TreeNode, depth = 0): string[] {
  const pad = '  '.repeat(depth);
  return [
    `${pad}- ${node.scope.displayName} (\`${node.scope.id}\`) — docs: ${node.scope.docUrl}`,
    ...node.rules.map((r) => `${pad}  - \`${r.id}\` · input: ${inputKind(r)}${r.uniqueness === 'none' ? ' · uniqueness: none' : ''}`),
    ...node.children.flatMap((c) => treeLines(c, depth + 1)),
  ];
}

/** template 을 `<owner>-<system>-…-sa-<role>` 꼴로 펼친다. slug 는 실제 약어를 그대로 쓴다 (구분자 없는 규칙은 붙여 쓴다) */
export function formulaOf(rule: ResourceRule): string {
  const part = (t: Token): string => (t === 'slug' ? rule.slug : `<${t}>`);
  return rule.template.map(part).join(rule.separator);
}

/** 표준값 한 줄씩 — 별칭이 있으면 같이 (ENV_ALIASES 가 정본) */
function allowedValues(dict: Record<string, string>): string[] {
  return [...new Set(Object.values(dict))].map((canon) => {
    const aliases = Object.entries(dict).filter(([k, v]) => v === canon && k !== canon).map(([k]) => k);
    return aliases.length > 0 ? `- \`${canon}\` — aliases: ${aliases.join(', ')}` : `- \`${canon}\``;
  });
}

/** 「## Regions」 절 (D49 · D50) — 받는 꼴 · 코드 규칙 · 켜진 CSP 마다 리전 한 줄(이름 · 코드 · 위치 · 존) · 존 규칙 문장. 표는 지역 표(regions-data)가 정본이다 */
function regionLines(rules: readonly ResourceRule[], order: readonly Provider[]): string[] {
  const zonal = rules.filter((r) => order.includes(r.provider) && regionTokenOfRule(r) === 'zone').map((r) => `\`${r.id}\``);
  const lines = [
    '', '## Regions', '',
    '`region` takes a region or a zone of the provider you name, by name or by code, in any case: `asia-northeast3`, `asia-northeast3-a`, `ane3` or `ane3a`, or `global`. Country values such as `kr`, `us`, `jp` and `eu` are rejected (400 `context.value_unsupported`, with the matching region names in `supported`), and so are region names of another provider.',
    'Names carry a short code, not the region name: each region has the code listed below, and a zone code is the region code followed by the zone letter (`asia-northeast3-a` -> `ane3a`). A region or zone name you send is reported once as `context.normalized`. `global` puts no region token in any name.',
    `Zonal resources carry the zone code and need a zone: given only a region, they come back \`valid: false\` with \`name.zone_required\` — ${zonal.join(', ')}. Regional resources carry the region code (or drop it first when the name is too long); global resources carry none.`,
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
    '> For humans (web UI) and for AI coding agents / IaC (`POST /v1/generate` · `POST /v1/names` · `POST /v1/validate` · `GET /openapi.json`).',
    "> Cloudonym does not replace the provider's final verdict — it checks only the reserved words and patterns that the official documents state.",
    '',
    '## Naming Formulas',
    '',
    'One line per rule: `<rule id>`: formula · `optional` = tokens dropped first (in this order) when the name is too long. `<seq>` defaults to `01` (`count` on `/v1/names` gives `01`…`99`), `<role>` defaults to `sync` (`role` on `/v1/names`).',
  ];
  for (const p of order) {
    lines.push('', `### ${p.toUpperCase()}`);
    for (const r of byProvider(p)) {
      lines.push(`- \`${r.id}\`: \`${formulaOf(r)}\`${r.optional.length > 0 ? ` · optional: ${r.optional.join(', ')}` : ''}`);
    }
  }
  lines.push('', '## Canonical Allowed Values', '', '### env', ...allowedValues(ENV_ALIASES), '', '### region',
    '- a region or a zone of the provider, by name or by code — see `## Regions`', '- `global`');
  lines.push(...regionLines(rules, order));
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
    '- `POST /v1/names` — body `{ "provider", "context": { … }, "resources": [{ "type", "count"?: 1-99, "role"?: string }], "rules_version"?: string }` — only the resources you pick; `data.<provider>` is `{ valid, items[], conflicts[] }`. Each item carries `key`, `resource_type`, `seq` or `role`, `scope`, `uniqueness` and the same fields as a `/v1/generate` name. At most 200 resources and 200 names per request',
    `- \`owner\`, \`system\` and \`purpose\` are at most ${MAX_CONTEXT_CHARS} characters; \`env\`, \`region\` and the other strings at most ${MAX_FIELD_CHARS}. A longer value is 400 \`request.field_too_long\``,
    '- `POST /v1/validate` — body `{ "provider", "resource_type", "name", "rules_version"?: string }`',
    '- `GET /v1/health` — `{ "ok": true, "version": { "engine", "rules" } }`',
    '- `GET /openapi.json` — OpenAPI 3.0.3',
    '',
    '`/v1/generate` is the catalogue (every rule of the providers, sequence `01`); `/v1/names` is the selection. One `/v1/names` request stands for one instance of each parent scope (one resource group, one project, one VPC): names that collide inside the request (same kind of resource, same name; Azure and AWS compare case-insensitively) are each marked `valid: false` with `name.conflict`, and `conflicts` lists each collision once. Two resource groups are two requests.',
    'Successful responses of `/v1/generate`, `/v1/names`, `/v1/validate` and `/v1/health` carry `version: { engine, rules }` (failures and `/v1/events` do not). `violations`, `steps`, `errors`, `rule.notes` and the label lists are arrays of `{ code, field?, params?, message }` — branch on `code`, show `message` to people.',
    '`rules_version` pins a request to a rules revision: if it differs from the current one the API answers 409 `request.rules_version_mismatch` instead of returning names that may differ. The API never serves an old rules revision — store the names you created and keep using them.',
    'Every failure (400, 403, 404, 409, 413, 429, 500) has the same shape: `{ "success": false, "errors": [{ code, field?, params?, message }], "supported"?: [...] }`. An unknown `/v1` path or method is 404 `request.not_found`.',
    '',
    'Paths are relative to the host that served this file.',
  );
  return `${lines.join('\n')}\n`;
}
