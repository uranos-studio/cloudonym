import type { NamingContext, ResourceRule, Token } from './types';

/** 항목 입력 (D30') — 문맥이 아니라 resources[i] 의 값. 없으면 seq 01 · role sync (지금 출력과 같다) */
export interface ItemExtra { seq?: string; role?: string }

export function tokenValues(ctx: NamingContext, rule: ResourceRule, extra: ItemExtra = {}): Partial<Record<Token, string>> {
  const all: Record<Token, string> = { owner: ctx.owner, system: ctx.system, purpose: ctx.purpose, env: ctx.env, region: ctx.region,
                                       slug: rule.slug, seq: extra.seq ?? '01', role: extra.role ?? 'sync' };
  const out: Partial<Record<Token, string>> = {};
  for (const t of rule.template) out[t] = all[t];
  return out;
}

export function compose(values: Partial<Record<Token, string>>, order: Token[], separator: '' | '-'): string {
  return order.map((t) => values[t] ?? '').filter((v) => v.length > 0).join(separator);
}
