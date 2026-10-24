// 첫 화면 이해 (D107) — 소개 상자의 예시 · 닫힘 기억(About 은 D109 에서 /about 쪽이 됐다 — about.test) · Project ID 경고 접기 · 빈 이름 칸의 PASS 문단. 브라우저 없이 정적 마크업으로 본다
import { afterEach, describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import committed from './introExamples.json';
import { buildIntroExample } from './introExampleModel';
import { IntroExample, INTRO_EXAMPLE, type IntroExampleData } from './IntroExample';
import { WizardNames } from './WizardNames';
import { ProjectForm } from './WizardSettings';
import { introDismissed, rememberIntroDismissed } from './localPrefs';
import { generateProject, parseProjectContext } from '../core/engine';
import { expandPlan } from '../core/wizard/plan';
import * as S from './wizardState';
import { samplePlan, SAMPLE_PROJECT } from './wizardSample';
import { en } from '../messages/en';
import { VERSION } from '../version';

describe('소개 상자의 예시 (D107) — 엔진이 만든 값만 · PASS 는 valid:true 에서만', () => {
  it('커밋된 introExamples.json 은 지금 엔진이 만든 것과 같다 — 다르면 `npm run intro-examples` 를 돌린다', () => {
    expect(committed).toEqual(buildIntroExample());
    expect(committed.rules).toBe(VERSION.rules);
  });
  it('세 줄 — 프로젝트 ID · Cloud Run · HTTPS 전달 규칙, 전부 valid:true · 입력은 첫 방문 예시와 같다 (D108)', () => {
    expect(committed.input).toEqual(['demo', 'payment', 'prod', 'asia-northeast3']);
    expect(committed.input).toEqual([SAMPLE_PROJECT.owner, SAMPLE_PROJECT.system, SAMPLE_PROJECT.env, SAMPLE_PROJECT.region]);
    expect(committed.rows.map((r) => r.id)).toEqual(['project', 'run', 'fwd']);
    for (const r of committed.rows) expect(r.valid, r.name).toBe(true);
    // 검사기 — rules 2026-10-13.3 에서 엔진이 낸 값(전달 규칙은 리다이렉트(redir)가 아니라 HTTPS 쪽)
    expect(committed.rows.map((r) => r.name)).toEqual(['demo-payment-prod', 'payment-shop-prod-ane3-run-01', 'payment-shop-prod-fwd-01']);
  });
  it('purpose 는 예시 서비스 이름 — 소개 페이지의 움직이는 그림이 다섯 문맥값을 보인다 (D129) · 손으로 적지 않는다', () => {
    expect(committed.purpose).toBe(S.EXAMPLE_SERVICE);
    expect(samplePlan().services[0]!.purpose).toBe(committed.purpose);
    expect(INTRO_EXAMPLE.purpose).toBe(committed.purpose);
  });
  it('세 줄은 첫 방문 화면(samplePlan)의 이름에 그대로 있다 — 소개와 화면이 갈라지지 않는다', () => {
    const items = generateProject(expandPlan(samplePlan()), 'gcp').items;
    for (const r of committed.rows) expect(items.find((i) => i.key === r.key)?.name, r.key).toBe(r.name);
  });
  it('넓은 화면은 세 줄 모두 PASS · 폰은 Cloud Run 한 줄만', () => {
    const wide = renderToStaticMarkup(createElement(IntroExample, { phone: false }));
    expect(wide.replace(/<[^>]+>/g, '')).toContain('demo · payment · prod · asia-northeast3');
    expect(wide.match(/data-intro-example-row=/g)).toHaveLength(3);
    expect(wide.match(/data-intro-example-pass/g)).toHaveLength(3);
    const phone = renderToStaticMarkup(createElement(IntroExample, { phone: true }));
    expect(phone.match(/data-intro-example-row="([^"]+)"/g)).toEqual(['data-intro-example-row="run"']);
    expect(phone).toContain('payment-shop-prod-ane3-run-01');
    expect(phone).not.toContain('demo-payment-prod<');
  });
  it('valid:false 줄은 PASS 를 달지 않는다(FAIL) — 화면이 판정을 짓지 않는다', () => {
    const bad: IntroExampleData = { ...INTRO_EXAMPLE, rows: INTRO_EXAMPLE.rows.map((r, i) => (i === 1 ? { ...r, valid: false } : r)) };
    const m = renderToStaticMarkup(createElement(IntroExample, { phone: false, example: bad }));
    expect(m.match(/data-intro-example-pass/g)).toHaveLength(2);
    expect(m.match(/data-intro-example-fail/g)).toHaveLength(1);
  });
  it('읽기 전용 — 단추 · 입력 · 링크가 없다', () => {
    const m = renderToStaticMarkup(createElement(IntroExample, { phone: false }));
    expect(m).not.toMatch(/<(button|input|a|select|textarea)\b/);
  });
});

describe('소개 상자의 닫힘 기억 (D93 · D109)', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('닫으면 기억하고, /about 의 「Show the intro on the home page again」 은 그 기억을 지운다 — 새로 열어도 보인다', () => {
    const map = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) });
    expect(introDismissed()).toBe(false);
    rememberIntroDismissed(true);
    expect(introDismissed()).toBe(true);
    rememberIntroDismissed(false);
    expect(introDismissed()).toBe(false);
    expect(map.size).toBe(0);
  });
});

describe('Project ID 경고 접기 (D107)', () => {
  it('한 줄 요약과 Why? 는 summary, 네 문장은 details 안 — 요약 줄이 접미사 칸의 설명이다', () => {
    const plan = S.initialPlan({ owner: 'devops', system: 'payments', env: 'prod', region: 'asia-northeast3' });
    const noop = () => {};
    const m = renderToStaticMarkup(createElement(ProjectForm, {
      plan, envs: ['prod'], onToggleEnv: noop, errors: [], projectIds: [], projectNames: [], suffixErrors: [], onSuffix: noop, onChange: noop, onTouch: noop,
    }));
    const details = /<details[^>]*data-project-id-notice[^>]*>([\s\S]*?)<\/details>/.exec(m)?.[1];
    expect(details).toBeDefined();
    expect(details).not.toMatch(/\sopen/);
    const summary = /<summary[^>]*>([\s\S]*?)<\/summary>/.exec(details!)?.[1] ?? '';
    expect(summary).toContain(`id="wizard-project-id-notice"`);
    expect(summary).toContain(en.ui.wizard_project_id_notice_summary);
    expect(summary).toContain(en.ui.wizard_project_id_notice_more);
    expect(details).toContain(en.ui.wizard_project_id_notice);
    expect(m).toMatch(/aria-describedby="wizard-project-id-notice"/);
    // 정보 아이콘 (D108) — summary 글 앞 · 읽지 않는다(aria-hidden)
    const icon = /<svg[^>]*data-project-id-notice-icon[^>]*>/.exec(summary)?.[0];
    expect(icon).toMatch(/aria-hidden="true"/);
    expect(summary.indexOf('data-project-id-notice-icon')).toBeLessThan(summary.indexOf('id="wizard-project-id-notice"'));
  });
});

describe('PASS 문단은 이름이 있을 때만 (D107)', () => {
  const plan = S.startPlan({ owner: 'devops', system: 'payments', env: 'prod', region: 'asia-northeast3' });
  const names = (props: Partial<Parameters<typeof WizardNames>[0]>) => renderToStaticMarkup(createElement(WizardNames, {
    plan, results: undefined, errors: [], projectContext: undefined, projectNames: [], ...props,
  }));
  it('빈 칸(프로젝트 값을 채우는 중) — PASS 문단 · 「만들지 않는다」 문장이 없다', () => {
    const m = names({ plan: S.startPlan(), projectPending: true });
    expect(m).toContain('data-names-notice="need_project"');
    expect(m).not.toContain('data-pass-meaning');
    expect(m).not.toContain(en.ui.wizard_nothing_created);
  });
  it('이름이 나오면 PASS 문단과 「만들지 않는다」 문장이 이름 아래 보인다', () => {
    const result = generateProject(expandPlan(plan), 'gcp');
    expect(result.items.length).toBeGreaterThan(0);
    const ctx = parseProjectContext(plan.project, 'gcp');
    if (!ctx.ok) throw new Error('project context');
    const m = names({ results: [{ env: 'prod', result }], projectContext: ctx.context });
    expect(m).toContain('data-pass-meaning');
    expect(m).toContain(en.ui.pass_meaning);
    expect(m).toContain(en.ui.wizard_nothing_created);
    expect(m.indexOf('data-pass-meaning')).toBeGreaterThan(m.indexOf(result.items[0]!.name));
  });
});
