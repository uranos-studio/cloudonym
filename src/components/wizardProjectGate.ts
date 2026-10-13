// 마법사 첫 화면의 Project 관문 (D97) — 순수 함수. 처음 온 사람은 빈 프로젝트 값으로 시작하고, 손대지 않은(pristine) 빈 칸에는 빨간 오류를 띄우지 않는다.
// 판정(값이 맞는가)은 엔진(parseProjectContext)이 하고, 여기는 「그 판정을 지금 보일까」만 정한다 — 화면 상태라 hash · /v1/wizard 에 들지 않는다
import type { CoreMessage } from '../core/types';
import type { WizardPlan } from '../core/wizard/plan';

export type ProjectField = 'owner' | 'system' | 'env' | 'region';
const PROJECT_FIELDS: readonly string[] = ['owner', 'system', 'env', 'region'];

/** 그 칸의 오류를 보이는가 — 건드렸거나(blur · 입력) 값이 있으면. 링크로 연 틀린 값은 비어 있지 않으니 건드리지 않아도 보인다 */
export function showsFieldError(field: ProjectField, project: WizardPlan['project'], touched: ReadonlySet<ProjectField>): boolean {
  return touched.has(field) || project[field] !== '';
}

/** 보일 프로젝트 오류만 — 칸에 딸리지 않은 오류는 늘 보인다 */
export function visibleProjectErrors(errors: readonly CoreMessage[], project: WizardPlan['project'], touched: ReadonlySet<ProjectField>): CoreMessage[] {
  return errors.filter((e) => {
    const field = 'field' in e ? e.field : undefined;
    if (typeof field !== 'string' || !PROJECT_FIELDS.includes(field)) return true;
    return showsFieldError(field as ProjectField, project, touched);
  });
}

/** 프로젝트 값의 상태 — ok: 이름을 지을 수 있다 · errors: 보이는 오류가 있다 · pending: 아직 채우는 중(보이는 오류 없음) */
export type ProjectGate = 'ok' | 'errors' | 'pending';
export function projectGate(parsedOk: boolean, visibleErrorCount: number): ProjectGate {
  if (parsedOk && visibleErrorCount === 0) return 'ok';
  return visibleErrorCount > 0 ? 'errors' : 'pending';
}

/** 「Next」 단추를 보이는가 — 프로젝트 값이 풀리고 접미사도 맞을 때만. 타이핑 중에 저절로 옮기지 않는다(포커스 · 접근성) */
export function showsNext(parsedOk: boolean, suffixErrorCount: number): boolean {
  return parsedOk && suffixErrorCount === 0;
}

/** 폰(768 미만)의 첫 탭 — 처음 온 사람(hash 없음)은 Edit(= Project 설정), 링크로 연 계획 · 깨진 링크는 Plan(목록) */
export function initialView(firstRun: boolean): 'plan' | 'edit' {
  return firstRun ? 'edit' : 'plan';
}

/** 이름 칸이 보일 것 (D97) — 이름(내보내기 단추 포함) 또는 안내 한 줄.
 *  프로젝트 값을 채우는 중(pending)이면 이름 · 오류 대신 「프로젝트 값부터」 안내만 보이고 내보내기(Copy all · JSON · Terraform)는 없다 */
export type NamesNotice = 'need_project' | 'empty' | 'fix_errors';
export function namesPanel(hasResults: boolean, projectPending: boolean, planEmpty: boolean): { exports: boolean; notice: NamesNotice | undefined } {
  if (projectPending) return { exports: false, notice: 'need_project' };
  if (hasResults) return { exports: true, notice: undefined };
  return { exports: false, notice: planEmpty ? 'empty' : 'fix_errors' };
}
