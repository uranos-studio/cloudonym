// /llms.txt 본문 — 규칙 표(RULES)에서 만든다. 손으로 쓴 공식 · 숫자를 두지 않는다 (D9 · D17)
import type { Provider, ResourceRule, Token } from '../core/types';
import { ENV_ALIASES, REGION_ALIASES } from '../core/normalize';

const ORDER: readonly Provider[] = ['gcp', 'aws', 'azure'];

/** template 을 `<owner>-<system>-…-sa-<role>` 꼴로 펼친다. slug 는 실제 약어를 그대로 쓴다 (구분자 없는 규칙은 붙여 쓴다) */
export function formulaOf(rule: ResourceRule): string {
  const part = (t: Token): string => (t === 'slug' ? rule.slug : `<${t}>`);
  return rule.template.map(part).join(rule.separator);
}

/** 표준값 한 줄씩 — 별칭이 있으면 같이 (ENV_ALIASES · REGION_ALIASES 가 정본) */
function allowedValues(dict: Record<string, string>): string[] {
  return [...new Set(Object.values(dict))].map((canon) => {
    const aliases = Object.entries(dict).filter(([k, v]) => v === canon && k !== canon).map(([k]) => k);
    return aliases.length > 0 ? `- \`${canon}\` — aliases: ${aliases.join(', ')}` : `- \`${canon}\``;
  });
}

function constraintLine(rule: ResourceRule): string {
  const f = rule.forbidden;
  const forbidden = f
    ? [
        ...(f.prefixes ? [`prefixes ${f.prefixes.join(' ')}`] : []),
        ...(f.suffixes ? [`suffixes ${f.suffixes.join(' ')}`] : []),
        ...(f.contains ? [`contains ${f.contains.join(' ')}`] : []),
        ...(f.exact ? [`exact ${f.exact.join(' ')}`] : []),
        ...(f.ipv4 ? ['no IPv4 form'] : []),
      ].join('; ')
    : '';
  const bits = [`${rule.minLength}-${rule.maxLength} chars`, `pattern \`${rule.pattern.source}\``];
  if (rule.noConsecutiveSeparator) bits.push('no consecutive separators');
  if (forbidden) bits.push(`forbidden: ${forbidden}`);
  if (rule.note) bits.push(`note: ${rule.note}`);
  bits.push(`docs: ${rule.docUrl}`);
  return `- \`${rule.id}\` (${rule.displayName}): ${bits.join(' · ')}`;
}

export function buildLlmsText(rules: ResourceRule[]): string {
  const byProvider = (p: Provider): ResourceRule[] => rules.filter((r) => r.provider === p);
  const lines: string[] = [
    '# Cloudonym',
    '',
    "> Multi-cloud resource naming engine for AWS, GCP and Azure — generates, corrects and validates names against each provider's physical constraints.",
    '> For humans (web UI) and for AI coding agents / IaC (`POST /v1/generate` · `POST /v1/validate` · `GET /openapi.json`).',
    "> Cloudonym does not replace the provider's final verdict — it checks only the reserved words and patterns that the official documents state.",
    '',
    '## Naming Formulas',
    '',
    'One line per rule: `<rule id>`: formula · `optional` = tokens dropped first (in this order) when the name is too long. `<seq>` is `01`, `<role>` is `sync`.',
  ];
  for (const p of ORDER) {
    lines.push('', `### ${p.toUpperCase()}`);
    for (const r of byProvider(p)) {
      lines.push(`- \`${r.id}\`: \`${formulaOf(r)}\`${r.optional.length > 0 ? ` · optional: ${r.optional.join(', ')}` : ''}`);
    }
  }
  lines.push('', '## Canonical Allowed Values', '', '### env', ...allowedValues(ENV_ALIASES), '', '### region', ...allowedValues(REGION_ALIASES));
  lines.push('', '## Provider Constraints');
  for (const p of ORDER) {
    lines.push('', `### ${p.toUpperCase()}`);
    for (const r of byProvider(p)) lines.push(constraintLine(r));
  }
  lines.push(
    '',
    '## API',
    '',
    '- `POST /v1/generate` — body `{ "context": { "owner", "system", "purpose", "env", "region" }, "providers"?: ["aws", "gcp", "azure"] }`',
    '- `POST /v1/validate` — body `{ "provider", "resource_type", "name" }`',
    '- `GET /openapi.json` — OpenAPI 3.0.3',
    '',
    'Paths are relative to the host that served this file.',
  );
  return `${lines.join('\n')}\n`;
}
