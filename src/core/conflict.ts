// 같은 요청 안 이름 충돌 (D41) — 한 요청은 부모 범위의 한 인스턴스(한 RG · 한 프로젝트 · 한 VPC)로 본다.
// 범위는 키에 넣지 않는다. uniqueness 'none'(AWS Name 태그)이어도 같은 이름 둘은 사람이 구분할 수 없어 충돌로 낸다
import type { CoreMessage } from './messages';
import type { NameResult, Provider, ResourceRule } from './types';

export const NAME_COMPARISON: Record<Provider, 'case-insensitive' | 'exact'> = {
  azure: 'case-insensitive',   // resource-name-rules 상단 "Always perform a case-insensitive comparison of names"
  gcp: 'exact',                // 규칙 전부가 소문자 pattern — 비교 방식이 결과를 바꾸지 않는다
  aws: 'case-insensitive',     // 보안 그룹만 공식 문장이 있다("Names are case-insensitive") — 나머지는 보수적(D20)
};

/** `${provider}|${entity}|${비교용 이름}` */
export function conflictKey(rule: ResourceRule, name: string): string {
  const cmp = NAME_COMPARISON[rule.provider] === 'case-insensitive' ? name.toLowerCase() : name;
  return `${rule.provider}|${rule.entity}|${cmp}`;
}

/** 충돌 하나에 메시지 하나 — 같은 키에 셋이 겹치면 keys 에 셋. valid:false 항목(빈 이름 · FAIL)은 뺀다. 순서는 처음 나온 자리 순 */
export function findConflicts(items: readonly { key: string; rule: ResourceRule; result: NameResult }[]): CoreMessage[] {
  const groups = new Map<string, { name: string; keys: string[] }>();
  for (const it of items) {
    if (!it.result.valid) continue;
    const k = conflictKey(it.rule, it.result.name);
    const g = groups.get(k);
    if (g) g.keys.push(it.key);
    else groups.set(k, { name: it.result.name, keys: [it.key] });
  }
  return [...groups.values()].filter((g) => g.keys.length > 1).map((g): CoreMessage => ({ code: 'name.conflict', params: { name: g.name, keys: g.keys } }));
}
