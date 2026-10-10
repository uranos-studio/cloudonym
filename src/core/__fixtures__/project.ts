// 마법사 생성 fixture (D62 · D69) — 엔진 · 기준선 · 마법사 Terraform 시험이 같이 쓴다.
// 문맥은 parseProjectContext 를 거친 값(존 입력도 리전 코드로 풀린다 — D50 수정)
import { getRule } from '../constraints';
import type { ProjectSelection } from '../engine';
import type { ProjectContext, ResourceRule } from '../types';

const rule = (t: string): ResourceRule => getRule('gcp', t)!;

export const WIZARD_PROJECT: ProjectContext = { owner: 'platform', system: 'billing', env: 'prod', region: 'ane3' };

/** 계획 §5-2 의 요청을 펼친 꼴 — 프로젝트 네트워크 넷 · shop(web VM + boot · data 01 · ip, Cloud SQL) · pay(web VM 둘 · boot 둘). 이름 14 */
export const WIZARD_SAMPLE: ProjectSelection = {
  project: WIZARD_PROJECT,
  projectItems: [
    { rule: rule('vpc_network'), count: 1, level: 'project', instances: [{ seq: '01' }] },
    { rule: rule('subnet'), count: 1, level: 'project', instances: [{ seq: '01' }] },
    { rule: rule('firewall_rule'), count: 1, level: 'project', tier: 'ssh', instances: [{ seq: '01' }] },
    { rule: rule('firewall_rule'), count: 1, level: 'project', tier: 'web', instances: [{ seq: '01' }] },
  ],
  services: [
    { purpose: 'shop', items: [
      { rule: rule('compute_instance'), count: 1, tier: 'web', instances: [{ seq: '01', attach: { boot: true, data: ['01'], ip: true } }] },
      { rule: rule('cloud_sql_instance'), count: 1, kind: 'POSTGRES', instances: [{ seq: '01' }] },
    ] },
    { purpose: 'pay', items: [
      { rule: rule('compute_instance'), count: 2, tier: 'web', instances: [{ seq: '01', attach: { boot: true } }, { seq: '02', attach: { boot: true } }] },
    ] },
  ],
};

/** 부모 FAIL → 자식 (§5-1) — 60자 purpose 둘이 축소 뒤 같은 VM 이름이 된다. boot 는 첫 서버에만 */
export const PARENT_FAIL_PURPOSES = ['a'.repeat(59) + 'b', 'a'.repeat(59) + 'c'] as const;
export const WIZARD_PARENT_FAIL: ProjectSelection = {
  project: WIZARD_PROJECT,
  projectItems: [],
  services: [
    { purpose: PARENT_FAIL_PURPOSES[0], items: [{ rule: rule('compute_instance'), count: 1, tier: 'web', instances: [{ seq: '01', attach: { boot: true } }] }] },
    { purpose: PARENT_FAIL_PURPOSES[1], items: [{ rule: rule('compute_instance'), count: 1, tier: 'web', instances: [{ seq: '01' }] }] },
  ],
};

/** 충돌 fixture (§5-1) — cloud_function · cloud_function_gen1 은 약어 · 템플릿 · entity 가 같아 같은 이름이 된다 */
export const WIZARD_CONFLICT: ProjectSelection = {
  project: WIZARD_PROJECT,
  projectItems: [],
  services: [{ purpose: 'shop', items: [
    { rule: rule('cloud_function'), count: 1, instances: [{ seq: '01' }] },
    { rule: rule('cloud_function_gen1'), count: 1, instances: [{ seq: '01' }] },
  ] }],
};
