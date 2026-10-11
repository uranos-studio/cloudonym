// 마법사에서 고른 규칙 id (D71) — 계측 meta 의 재료. 순수 함수 · DOM 없음
import { PROJECT_ID_RULE, type Pick, type WizardPlan } from '../core/wizard/plan';
import { presetOf } from '../core/wizard/presets';

/** 고른 규칙 id (D71) — 칩(프리셋)은 유효 규칙(serverless 를 켜면 그 규칙), Custom 은 ruleId. 프로젝트 공용 · 서비스를 함께 센다.
 *  암묵 항목(프로젝트 ID) · 모르는 프리셋은 넣지 않는다. 엔진 밖에 둔다 — src/core 를 고치면 규칙 버전이 바뀐다(revision.test).
 *  DOM 이 없는 파일이라 api 시험도 들여온다. 서버의 같은 함수는 api/schemas.ts 의 wizardPickedRules 이고, 둘이 같은지 api/privacy-sync.test 가 본다. 모르는 id 는 서버가 버린다 */
export function pickedRuleIds(plan: WizardPlan): { chip: string[]; custom: string[] } {
  const chip = new Set<string>();
  const custom = new Set<string>();
  const picks: readonly Pick[] = [...plan.projectPicks, ...plan.services.flatMap((s) => s.picks)];
  for (const pick of picks) {
    if (pick.preset === null) {
      if (typeof pick.ruleId === 'string' && pick.ruleId !== PROJECT_ID_RULE) custom.add(pick.ruleId);
      continue;
    }
    const preset = presetOf(pick.preset);
    if (!preset) continue;
    const sv = typeof pick.serverless === 'string' && preset.serverless?.ruleIds.includes(pick.serverless) ? pick.serverless : undefined;
    chip.add(sv ?? preset.ruleId);
  }
  return { chip: [...chip].sort(), custom: [...custom].sort() };
}
