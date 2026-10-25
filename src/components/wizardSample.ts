// 첫 방문의 예시 계획 (D108 · D129) — hash 없이 처음 온 사람이 보는 계획. 클라우드마다 하나다(마법사 경로 /aws · /gcp 가 고른다).
// GCP 는 입력 넷과 서비스 하나에 serverless-web 카드를 얹은 것, AWS 는 같은 값 셋에 지역만 다르고 서비스 하나에 칩 다섯을 켠 것이다(카드는 GCP 전용).
// 카드 · 칩은 사용자가 갤러리 · 칩 칸에서 더할 때와 같은 함수(addBundle · togglePreset)로 더한다 — 숨은 기본값이 아니라 보통 pick 이다(링크 · API 와 같은 바이트).
// 소개 상자의 예시(introExampleModel)도 GCP 계획에서 이름을 뽑는다 — 화면의 예시와 소개의 예시가 갈라지지 않게
import type { WizardPlan, WizardProvider } from '../core/wizard/plan';
import { addBundle } from './wizardBundles';
import { startPlan } from './wizardState';
import { EXAMPLE_REGIONS } from './formContext';

/** 예시 입력 넷 — 중립 값. region 은 정식 이름(약어는 엔진이 만든다) */
export const SAMPLE_PROJECT: WizardPlan['project'] = { owner: 'demo', system: 'payment', env: 'prod', region: 'asia-northeast3' };
/** 클라우드마다 예시 입력 — 값 셋은 같고 지역만 그 클라우드의 예시 지역이다 */
export const SAMPLE_PROJECTS: Readonly<Record<WizardProvider, WizardPlan['project']>> = {
  gcp: SAMPLE_PROJECT,
  aws: { ...SAMPLE_PROJECT, region: EXAMPLE_REGIONS.aws },
};
/** 예시 서비스에 얹는 카드 — Cloud Run 뒤의 HTTPS 부하 분산기 */
export const SAMPLE_CARD = 'serverless-web';
/** AWS 예시 서비스에 얹는 카드 (D141 — D129 의 칩 다섯을 대신한다) — EC2 web 뒤의 ALB HTTPS · RDS(기본 선택). 이름 15개가 전부 valid:true 다(wizardSample.test) */
export const SAMPLE_CARD_AWS = 'website';

/** 예시를 지운 계획 — 지금 클라우드의 빈 Project 값과 네트워크 미리 채움. 클라우드를 넘겨야 /aws 에서 Clear 가 GCP 로 바뀌지 않는다 */
export function clearedPlan(provider: WizardProvider): WizardPlan {
  return startPlan(undefined, provider);
}

/** 첫 방문 계획 — D90 의 네트워크 미리 채움 위에 첫 서비스(EXAMPLE_SERVICE)의 카드 하나(GCP) 또는 칩 다섯(AWS) */
export function samplePlan(provider: WizardProvider = 'gcp'): WizardPlan {
  if (provider === 'aws') return addBundle(startPlan(SAMPLE_PROJECTS.aws, 'aws'), 0, SAMPLE_CARD_AWS);
  return addBundle(startPlan(SAMPLE_PROJECT), 0, SAMPLE_CARD);
}
