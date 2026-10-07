// 시험 전용 규칙 표 — 화면을 `?fixture=…` 로 열 때만 쓴다. DEV 빌드에서만 들인다(main.tsx).
// 화면은 켜진 CSP 만 연다(D45) — 둘 다 GCP 위에 둔다.
// rules500 — GCP 규칙 500개(500행 측정). 범위 다섯 · 분류 여덟 · 입력 종류 셋을 고루 섞는다. 이름은 fx500_ 로 시작한다(번들 검사가 이 글자를 센다)
// conflict — GCP 규칙 표 + 충돌 fixture 둘(D41 · core/__fixtures__/conflict.ts 의 GCP 짝 — API 시험과 같은 것)
import { rulesFor } from '../core/constraints';
import { CONFLICT_GCP_RULE_A, CONFLICT_GCP_RULE_B } from '../core/__fixtures__/conflict';
import type { Category, ResourceRule, ScopeId } from '../core/types';

const SCOPES: readonly ScopeId[] = ['gcp:project', 'gcp:project', 'gcp:project_region', 'gcp:namespace', 'gcp:project_zone', 'gcp:project_global'];
const CATEGORIES: readonly Category[] = ['compute', 'networking', 'storage', 'database', 'identity', 'security', 'management', 'containers'];

function rules500(): ResourceRule[] {
  const gcp = rulesFor('gcp');
  const byType = (t: string) => gcp.find((r) => r.resourceType === t)!;
  // 입력 종류 셋 — count(VM) · role(서비스 계정) · none(Cloud Storage 버킷)
  const bases = [byType('compute_instance'), byType('compute_instance'), byType('service_account'), byType('storage_bucket')];
  return Array.from({ length: 500 }, (_, i): ResourceRule => {
    const base = bases[i % bases.length]!;
    const n = String(i).padStart(3, '0');
    return {
      ...base,
      id: `gcp.fx500_${n}`, resourceType: `fx500_${n}`, displayName: `Fixture resource ${n}`,
      scope: SCOPES[i % SCOPES.length]!, category: CATEGORIES[i % CATEGORIES.length]!,
      entity: `Fixture.Test/kind${n}`,
    };
  });
}

export function fixtureRules(name: string): readonly ResourceRule[] | undefined {
  if (name === 'rules500') return rules500();
  if (name === 'conflict') return [...rulesFor('gcp'), CONFLICT_GCP_RULE_A, CONFLICT_GCP_RULE_B];
  return undefined;
}
