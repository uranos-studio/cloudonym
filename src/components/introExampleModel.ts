// 소개 상자의 예시 한 줄 (D107) — 손으로 적지 않는다. 마법사와 같은 길(모델 → validatePlan → expandPlan → generateProject)로 엔진이 만든다.
// 빌드 때 scripts/gen-intro-examples.mjs 가 이 함수를 불러 introExamples.json 을 쓰고, 화면은 그 JSON 만 읽는다(이 파일은 번들에 들어가지 않는다).
// introExamples.test 가 이 함수의 결과와 커밋된 JSON 이 같은지 · 셋이 전부 valid:true 인지 본다 — 규칙이 바뀌어 틀린 이름이 「PASS」로 남지 않게
import { generateProject } from '../core/engine';
import { expandPlan, validatePlan, type WizardPlan } from '../core/wizard/plan';
import * as S from './wizardState';
import { en } from '../messages/en';
import { VERSION } from '../version';

/** 예시의 입력 넷 — 첫 화면 스크린샷(06-wizard)과 같은 값 */
export const INTRO_EXAMPLE_PROJECT: WizardPlan['project'] = { owner: 'devops', system: 'payments', env: 'prod', region: 'asia-northeast3' };

/** 줄 하나 — id 는 화면이 폰에서 남길 줄(vm)을 고르는 자리 */
export interface IntroExampleRow { id: 'project' | 'vm' | 'boot'; label: string; key: string; name: string; valid: boolean }
export interface IntroExample { rules: string; input: string[]; rows: IntroExampleRow[] }

/** 서비스 shop 에 웹 서버 01 하나 · 부트 디스크 켬 — 프로젝트 ID · VM · 부트 디스크 세 이름 */
export function buildIntroExample(): IntroExample {
  let plan = S.initialPlan(INTRO_EXAMPLE_PROJECT);
  plan = S.addPresetPick(plan, 0, 'web');
  plan = S.setFlag(plan, { service: 0, pick: 0 }, 0, 'boot', true);
  if (!validatePlan(plan).ok) throw new Error('intro example: the plan did not pass validatePlan');
  const { items } = generateProject(expandPlan(plan), 'gcp');
  const project = items.find((i) => i.level === 'project' && i.ruleId === 'gcp.project_id');
  const vm = items.find((i) => i.ruleId === 'gcp.compute_instance' && i.attach === undefined);
  const boot = items.find((i) => i.parent === vm?.key && i.attach === 'boot');
  if (!project || !vm || !boot) throw new Error('intro example: the engine did not return the three names');
  const row = (id: IntroExampleRow['id'], label: string, it: typeof vm): IntroExampleRow => ({ id, label, key: it.key, name: it.name, valid: it.valid });
  const { owner, system, env, region } = INTRO_EXAMPLE_PROJECT;
  return {
    rules: VERSION.rules,
    input: [owner, system, env, region],
    rows: [row('project', en.ui.wizard_project_id, project), row('vm', en.ui.intro_example_vm, vm), row('boot', en.ui.intro_example_boot, boot)],
  };
}
