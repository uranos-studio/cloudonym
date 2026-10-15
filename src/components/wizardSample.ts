// 첫 방문의 예시 계획 (D108) — hash 없이 처음 온 사람이 보는 계획. 입력 넷과 서비스 하나에 serverless-web 카드를 얹은 것이다.
// 카드는 사용자가 갤러리에서 더할 때와 같은 함수(addBundle)로 더한다 — 숨은 기본값이 아니라 보통 pick 이다(링크 · API 와 같은 바이트).
// 소개 상자의 예시(introExampleModel)도 같은 계획에서 이름을 뽑는다 — 화면의 예시와 소개의 예시가 갈라지지 않게
import type { WizardPlan } from '../core/wizard/plan';
import { addBundle } from './wizardBundles';
import { startPlan } from './wizardState';

/** 예시 입력 넷 — 중립 값. region 은 정식 이름(약어는 엔진이 만든다) */
export const SAMPLE_PROJECT: WizardPlan['project'] = { owner: 'demo', system: 'payment', env: 'prod', region: 'asia-northeast3' };
/** 예시 서비스에 얹는 카드 — Cloud Run 뒤의 HTTPS 부하 분산기 */
export const SAMPLE_CARD = 'serverless-web';

/** 첫 방문 계획 — D90 의 네트워크 미리 채움 위에 첫 서비스(EXAMPLE_SERVICE)의 카드 하나 */
export function samplePlan(): WizardPlan {
  return addBundle(startPlan(SAMPLE_PROJECT), 0, SAMPLE_CARD);
}
