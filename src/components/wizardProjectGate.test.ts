// 첫 화면의 Project 관문 (D97) — 빈 프로젝트로 시작 · 손대지 않은 빈 칸은 오류 없음 · 채우는 중이면 이름 칸은 안내만 · 내보내기 없음
import { describe, it, expect } from 'vitest';
import { initialView, namesPanel, projectGate, showsFieldError, showsNext, visibleProjectErrors, type ProjectField } from './wizardProjectGate';
import { DEFAULT_PROJECT, EMPTY_PROJECT, startPlan } from './wizardState';
import { parseProjectContext } from '../core/engine';
import type { WizardPlan } from '../core/wizard/plan';

const errorsOf = (project: WizardPlan['project']) => {
  const r = parseProjectContext(project, 'gcp');
  return r.ok ? [] : r.errors;
};
const none: ReadonlySet<ProjectField> = new Set();
const fieldsOf = (errs: ReturnType<typeof errorsOf>) => errs.map((e) => ('field' in e ? e.field : undefined));

describe('손대지 않은 빈 칸 (D97)', () => {
  it('빈 프로젝트 — 엔진은 넷 다 오류지만 보이는 오류는 없다 · 관문은 pending', () => {
    const errs = errorsOf(EMPTY_PROJECT);
    expect(new Set(fieldsOf(errs))).toEqual(new Set(['owner', 'system', 'env', 'region']));
    expect(visibleProjectErrors(errs, EMPTY_PROJECT, none)).toEqual([]);
    expect(projectGate(false, 0)).toBe('pending');
  });
  it('칸을 건드리면(blur · 입력) 그 칸의 오류만 보인다 · 관문은 errors', () => {
    const errs = errorsOf(EMPTY_PROJECT);
    const shown = visibleProjectErrors(errs, EMPTY_PROJECT, new Set<ProjectField>(['owner']));
    expect(fieldsOf(shown)).toEqual(['owner']);
    expect(projectGate(false, shown.length)).toBe('errors');
  });
  it('값이 있는 칸은 건드리지 않아도 오류가 보인다 — 링크로 연 틀린 값', () => {
    const project = { ...DEFAULT_PROJECT, region: 'nowhere-1' };
    const shown = visibleProjectErrors(errorsOf(project), project, none);
    expect(fieldsOf(shown)).toEqual(['region']);
    expect(showsFieldError('region', project, none)).toBe(true);
    expect(showsFieldError('owner', EMPTY_PROJECT, none)).toBe(false);
  });
  it('넷이 다 맞으면 ok · Next 를 보인다 · 접미사가 틀리면 Next 없음', () => {
    expect(errorsOf(DEFAULT_PROJECT)).toEqual([]);
    expect(projectGate(true, 0)).toBe('ok');
    expect(showsNext(true, 0)).toBe(true);
    expect(showsNext(true, 1)).toBe(false);
    expect(showsNext(false, 0)).toBe(false);
  });
  it('env 만 비었다(나머지 셋은 맞다) — 건드리지 않았으면 pending · Next 없음', () => {
    const project = { ...DEFAULT_PROJECT, env: '' };
    const shown = visibleProjectErrors(errorsOf(project), project, none);
    expect(shown).toEqual([]);
    expect(projectGate(false, shown.length)).toBe('pending');
  });
});

describe('이름 칸 (D97)', () => {
  it('채우는 중이면 안내만 — 이름 · 내보내기(Copy all · JSON · Terraform) 없음', () => {
    expect(namesPanel(false, true, false)).toEqual({ exports: false, notice: 'need_project' });
    // 결과가 있어도 pending 이면 막는다(방어)
    expect(namesPanel(true, true, false)).toEqual({ exports: false, notice: 'need_project' });
  });
  it('값이 맞으면 이름과 내보내기 · 고른 것이 없으면 빈 안내 · 오류면 고치라는 안내', () => {
    expect(namesPanel(true, false, false)).toEqual({ exports: true, notice: undefined });
    expect(namesPanel(false, false, true)).toEqual({ exports: false, notice: 'empty' });
    expect(namesPanel(false, false, false)).toEqual({ exports: false, notice: 'fix_errors' });
  });
});

describe('폰의 첫 탭 (D97)', () => {
  it('처음 온 사람은 Edit(Project 설정) · 링크로 연 계획은 Plan', () => {
    expect(initialView(true)).toBe('edit');
    expect(initialView(false)).toBe('plan');
  });
  it('첫 화면 계획의 프로젝트는 비어 있다', () => {
    expect(startPlan().project).toEqual(EMPTY_PROJECT);
  });
});
