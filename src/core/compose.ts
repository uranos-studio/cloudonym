import type { NamingContext, RegionToken, ResourceRule, Token } from './types';

/** 항목 입력 (D30') — 문맥이 아니라 resources[i] 의 값. 없으면 seq 01 · role sync (지금 출력과 같다) */
export interface ItemExtra { seq?: string; role?: string }

/** 지역 자리에 무엇이 오나 — 규칙의 regionToken(catalog 가 덮은 GCP), 없으면 템플릿에 region 이 있는지로 (AWS · Azure) */
export function regionTokenOfRule(rule: Pick<ResourceRule, 'regionToken' | 'template'>): RegionToken {
  return rule.regionToken ?? (rule.template.includes('region') ? 'region' : 'none');
}

/** 지역 자리 값 (D49 · D50) — 존 규칙은 존 코드(없으면 '' → generateOne 이 name.zone_required), 리전 규칙은 리전 코드(global 이면 ''),
 *  none 은 키를 넣지 않는다 */
export function tokenValues(ctx: NamingContext, rule: ResourceRule, extra: ItemExtra = {}): Partial<Record<Token, string>> {
  const kind = regionTokenOfRule(rule);
  const region = kind === 'zone' ? (ctx.zone ?? '') : ctx.region === 'global' ? '' : ctx.region;
  const all: Record<Token, string> = { owner: ctx.owner, system: ctx.system, purpose: ctx.purpose, env: ctx.env, region,
                                       slug: rule.slug, seq: extra.seq ?? '01', role: extra.role ?? 'sync' };
  const out: Partial<Record<Token, string>> = {};
  for (const t of rule.template) if (t !== 'region' || kind !== 'none') out[t] = all[t];
  return out;
}

export function compose(values: Partial<Record<Token, string>>, order: Token[], separator: '' | '-'): string {
  return order.map((t) => values[t] ?? '').filter((v) => v.length > 0).join(separator);
}
