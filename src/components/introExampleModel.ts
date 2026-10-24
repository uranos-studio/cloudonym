// 소개 상자의 예시 한 줄 (D107 · D108) — 손으로 적지 않는다. 입력은 첫 방문 예시 계획(wizardSample)과 같다. 마법사와 같은 길(모델 → validatePlan → expandPlan → generateProject)로 엔진이 만든다.
// 빌드 때 scripts/gen-intro-examples.mjs 가 이 함수를 불러 introExamples.json 을 쓰고, 화면은 그 JSON 만 읽는다(이 파일은 번들에 들어가지 않는다).
// introExamples.test 가 이 함수의 결과와 커밋된 JSON 이 같은지 · 셋이 전부 valid:true 인지 본다 — 규칙이 바뀌어 틀린 이름이 「PASS」로 남지 않게
import { generateProject } from '../core/engine';
import { expandPlan, validatePlan } from '../core/wizard/plan';
import { samplePlan, SAMPLE_PROJECT } from './wizardSample';
import { en } from '../messages/en';
import { VERSION } from '../version';

/** 줄 하나 — id 는 화면이 폰에서 남길 줄(run)을 고르는 자리 */
export interface IntroExampleRow { id: 'project' | 'run' | 'fwd'; label: string; key: string; name: string; valid: boolean }
/** purpose — 예시 서비스 이름(EXAMPLE_SERVICE). 소개 페이지의 움직이는 그림이 input 넷과 함께 다섯 문맥값으로 보인다 (D129) */
export interface IntroExample { rules: string; input: string[]; purpose: string; rows: IntroExampleRow[] }

/** 항목 키로 고른다 — url_map · global_forwarding_rule 은 HTTPS 와 리다이렉트(redir) 둘이라 ruleId 로는 하나가 정해지지 않는다 */
const ROW_KEYS = {
  project: 'project/-/project_id/-/-/-',
  run: 'service/shop/run_service/-/-/01',
  fwd: 'service/shop/global_forwarding_rule/-/-/01',
} as const;

/** 첫 방문 예시 계획(D108 — 서비스 shop 의 serverless-web 카드)에서 세 이름 — 프로젝트 ID · Cloud Run 서비스 · HTTPS 전달 규칙(부하 분산기 앞단) */
export function buildIntroExample(): IntroExample {
  const plan = samplePlan();
  if (!validatePlan(plan).ok) throw new Error('intro example: the plan did not pass validatePlan');
  const { items } = generateProject(expandPlan(plan), 'gcp');
  const pick = (id: keyof typeof ROW_KEYS) => {
    const it = items.find((i) => i.key === ROW_KEYS[id]);
    if (!it) throw new Error(`intro example: the engine did not return ${ROW_KEYS[id]}`);
    return it;
  };
  const row = (id: IntroExampleRow['id'], label: string): IntroExampleRow => {
    const it = pick(id);
    return { id, label, key: it.key, name: it.name, valid: it.valid };
  };
  const { owner, system, env, region } = SAMPLE_PROJECT;
  return {
    rules: VERSION.rules,
    input: [owner, system, env, region],
    purpose: plan.services[0]!.purpose,
    rows: [row('project', en.ui.wizard_project_id), row('run', en.ui.intro_example_run), row('fwd', en.ui.intro_example_fwd)],
  };
}
