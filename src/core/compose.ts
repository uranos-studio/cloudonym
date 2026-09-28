import type { NamingContext, ResourceRule, Token } from './types';

export function tokenValues(ctx: NamingContext, rule: ResourceRule): Partial<Record<Token, string>> {
  const all: Record<Token, string> = { owner: ctx.owner, system: ctx.system, purpose: ctx.purpose, env: ctx.env, region: ctx.region,
                                       slug: rule.slug, seq: '01', role: 'sync' };
  const out: Partial<Record<Token, string>> = {};
  for (const t of rule.template) out[t] = all[t];
  return out;
}

export function compose(values: Partial<Record<Token, string>>, order: Token[], separator: '' | '-'): string {
  return order.map((t) => values[t] ?? '').filter((v) => v.length > 0).join(separator);
}
