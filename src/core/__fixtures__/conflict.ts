// 충돌 fixture (D41) — 시험 전용 규칙 둘. 같은 entity · 같은 template 이라 같은 문맥에서 같은 이름이 나온다.
// 실제 규칙 표(RULES)에는 같은 이름을 내는 짝이 없어 충돌 검사가 「공허하게」 통과한다 — 검사기를 먼저 시험하려고 둔다.
// 엔진(Task 2) · API 200 본문(Task 3) · 카드 · 내보내기(Task 4)가 같은 fixture 를 쓴다
import { getRule } from '../constraints';
import type { NamingContext, ResourceRule } from '../types';

const vm = getRule('azure', 'virtual_machine')!;

export const CONFLICT_RULE_A: ResourceRule = { ...vm, id: 'azure.test_conflict_a', resourceType: 'test_conflict_a', displayName: 'Test Conflict A' };
export const CONFLICT_RULE_B: ResourceRule = { ...vm, id: 'azure.test_conflict_b', resourceType: 'test_conflict_b', displayName: 'Test Conflict B' };

export const CONFLICT_CONTEXT: NamingContext = { owner: 'example', system: 'billing', purpose: 'trade', env: 'prd', region: 'kr' };

/** 둘 다 count 1 — 같은 이름 하나씩 */
export const CONFLICT_SELECTION = [
  { rule: CONFLICT_RULE_A, count: 1 },
  { rule: CONFLICT_RULE_B, count: 1 },
];
