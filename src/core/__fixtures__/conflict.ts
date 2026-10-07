// 충돌 fixture (D41) — 시험 전용 규칙 둘. 같은 entity · 같은 template 이라 같은 문맥에서 같은 이름이 나온다.
// 실제 규칙 표(RULES)에는 같은 이름을 내는 짝이 없어 충돌 검사가 「공허하게」 통과한다 — 검사기를 먼저 시험하려고 둔다.
// 엔진 · API 200 본문 · 카드 · 내보내기가 같은 fixture 를 쓴다
import { getRule } from '../constraints';
import type { NamingContext, ResourceRule } from '../types';

const vm = getRule('azure', 'virtual_machine')!;

export const CONFLICT_RULE_A: ResourceRule = { ...vm, id: 'azure.test_conflict_a', resourceType: 'test_conflict_a', displayName: 'Test Conflict A' };
export const CONFLICT_RULE_B: ResourceRule = { ...vm, id: 'azure.test_conflict_b', resourceType: 'test_conflict_b', displayName: 'Test Conflict B' };

export const CONFLICT_CONTEXT: NamingContext = { owner: 'example', system: 'billing', purpose: 'trade', env: 'prod', region: 'krc' };

/** 둘 다 count 1 — 같은 이름 하나씩 */
export const CONFLICT_SELECTION = [
  { rule: CONFLICT_RULE_A, count: 1 },
  { rule: CONFLICT_RULE_B, count: 1 },
];

// GCP 짝 — API · 화면은 켜진 CSP 만 연다(D45). HTTP · 화면 시험은 이쪽을 쓴다. 위 Azure 짝은 core 기준선 · 회계가 그대로 쓴다
const gcpVm = getRule('gcp', 'compute_instance')!;

export const CONFLICT_GCP_RULE_A: ResourceRule = { ...gcpVm, id: 'gcp.test_conflict_a', resourceType: 'test_conflict_a', displayName: 'Test Conflict A' };
export const CONFLICT_GCP_RULE_B: ResourceRule = { ...gcpVm, id: 'gcp.test_conflict_b', resourceType: 'test_conflict_b', displayName: 'Test Conflict B' };

/** GCP 짝의 문맥 — VM 규칙의 사본이라 존 토큰 규칙이다(D50). API 에 보내는 원시 입력(존 이름)과 그것을 GCP 표로 푼 문맥 */
export const CONFLICT_GCP_RAW = { owner: 'example', system: 'billing', purpose: 'trade', env: 'prod', region: 'asia-northeast3-a' };
export const CONFLICT_GCP_CONTEXT: NamingContext = { owner: 'example', system: 'billing', purpose: 'trade', env: 'prod', region: 'ane3', zone: 'ane3a' };

/** 둘 다 count 1 — 같은 이름 하나씩 */
export const CONFLICT_GCP_SELECTION = [
  { rule: CONFLICT_GCP_RULE_A, count: 1 },
  { rule: CONFLICT_GCP_RULE_B, count: 1 },
];
