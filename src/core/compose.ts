import type { NamingContext, RegionToken, ResourceRule, RuleKinds, Token } from './types';

/** 항목 입력 (D30' · D52) — 문맥이 아니라 resources[i] 의 값. 없으면 seq 01 · role sync · 종류 토큰 없음 (지금 출력과 같다).
 *  kind 는 값 이름(POSTGRES)이다 — 이름에 들어갈 토큰(pg)은 kindTokenFor 가 만든다 */
export interface ItemExtra { seq?: string; kind?: string; role?: string }

/** 종류 값 → 이름에 넣을 토큰 (D52). 종류 표가 없거나 허용 밖이면 Error, 규칙 기본값 · omitValues 면 null(토큰 없음).
 *  허용 값인데 tokens 에 키가 없으면 데이터가 깨진 것이다(allowed ⊆ keys(tokens)) — 토큰 없음으로 삼키지 않고 던진다.
 *  catalog.ts 의 kindTokenOf 도 이 함수를 부른다 — 판정이 한 자리에 있다 */
export function kindTokenFor(id: string, kinds: Pick<RuleKinds, 'default' | 'allowed' | 'tokens' | 'omitValues'> | undefined, value: string): string | null | Error {
  if (!kinds) return new Error(`kind not supported: ${id}`);
  if (!kinds.allowed.includes(value)) return new Error(`kind not allowed: ${id} ${value}`);
  if (value === kinds.default || kinds.omitValues.includes(value)) return null;
  if (!Object.hasOwn(kinds.tokens, value)) throw new Error(`kind value missing from catalog tokens: ${id} ${value}`);
  return kinds.tokens[value]!;
}

/** 엔진이 쓰는 꼴 — 허용 밖이면 던진다. API · 화면은 validateSelection 이 앞에서 거르므로 닿지 않는다 */
export function kindTokenOfRule(rule: Pick<ResourceRule, 'id' | 'kinds'>, value: string): string | null {
  const t = kindTokenFor(rule.id, rule.kinds, value);
  if (t instanceof Error) throw t;
  return t;
}

/** 지역 자리에 무엇이 오나 — 규칙의 regionToken(catalog 가 덮은 GCP), 없으면 템플릿에 region 이 있는지로 (AWS · Azure) */
export function regionTokenOfRule(rule: Pick<ResourceRule, 'regionToken' | 'template'>): RegionToken {
  return rule.regionToken ?? (rule.template.includes('region') ? 'region' : 'none');
}

/** 지역 자리 값 (D49 · D50 revised) — 리전 코드(global 이면 ''). 존 규칙도 리전 코드다 — 존은 이름에 들지 않는다,
 *  none 은 키를 넣지 않는다. 종류 자리는 토큰이고, 종류를 주지 않았거나 토큰이 없는 값이면 '' 이라 compose 가 건너뛴다 (D52) */
export function tokenValues(ctx: NamingContext, rule: ResourceRule, extra: ItemExtra = {}): Partial<Record<Token, string>> {
  const kind = regionTokenOfRule(rule);
  const region = ctx.region === 'global' ? '' : ctx.region;
  const all: Record<Token, string> = { owner: ctx.owner, system: ctx.system, purpose: ctx.purpose, env: ctx.env, region,
                                       slug: rule.slug, kind: extra.kind === undefined ? '' : (kindTokenOfRule(rule, extra.kind) ?? ''),
                                       seq: extra.seq ?? '01', role: extra.role ?? 'sync' };
  const out: Partial<Record<Token, string>> = {};
  for (const t of rule.template) if (t !== 'region' || kind !== 'none') out[t] = all[t];
  return out;
}

export function compose(values: Partial<Record<Token, string>>, order: Token[], separator: '' | '-'): string {
  return order.map((t) => values[t] ?? '').filter((v) => v.length > 0).join(separator);
}
