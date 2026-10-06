// 시험 전용 규칙 표 — 화면을 `?fixture=…` 로 열 때만 쓴다. DEV 빌드에서만 들인다(main.tsx).
// rules500 — Azure 규칙 500개(500행 측정). 범위 다섯 · 분류 여덟 · 입력 종류 셋을 고루 섞는다. 이름은 fx500_ 로 시작한다(번들 검사가 이 글자를 센다)
// conflict — Azure 규칙 표 + 충돌 fixture 둘(D41 · core/__fixtures__/conflict.ts — 엔진 · API 시험과 같은 것)
import { rulesFor } from '../core/constraints';
import { CONFLICT_RULE_A, CONFLICT_RULE_B } from '../core/__fixtures__/conflict';
import type { Category, ResourceRule, ScopeId } from '../core/types';

const SCOPES: readonly ScopeId[] = ['azure:resource_group', 'azure:resource_group', 'azure:virtual_network', 'azure:global', 'azure:subscription', 'azure:managed_cluster'];
const CATEGORIES: readonly Category[] = ['compute', 'networking', 'storage', 'database', 'identity', 'security', 'management', 'containers'];

function rules500(): ResourceRule[] {
  const azure = rulesFor('azure');
  const byType = (t: string) => azure.find((r) => r.resourceType === t)!;
  // 입력 종류 셋 — count(VM) · role(관리 ID) · none(Key Vault)
  const bases = [byType('virtual_machine'), byType('virtual_machine'), byType('managed_identity'), byType('key_vault')];
  return Array.from({ length: 500 }, (_, i): ResourceRule => {
    const base = bases[i % bases.length]!;
    const n = String(i).padStart(3, '0');
    return {
      ...base,
      id: `azure.fx500_${n}`, resourceType: `fx500_${n}`, displayName: `Fixture resource ${n}`,
      scope: SCOPES[i % SCOPES.length]!, category: CATEGORIES[i % CATEGORIES.length]!,
      entity: `Fixture.Test/kind${n}`,
    };
  });
}

export function fixtureRules(name: string): readonly ResourceRule[] | undefined {
  if (name === 'rules500') return rules500();
  if (name === 'conflict') return [...rulesFor('azure'), CONFLICT_RULE_A, CONFLICT_RULE_B];
  return undefined;
}
