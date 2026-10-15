// 첫 화면 이해 (D107) — 소개 상자의 예시 · More 메뉴의 About · Project ID 경고 접기 · 빈 이름 칸의 PASS 문단. 브라우저 없이 정적 마크업으로 본다
import { afterEach, describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import committed from './introExamples.json';
import { buildIntroExample } from './introExampleModel';
import { IntroExample, INTRO_EXAMPLE, type IntroExampleData } from './IntroExample';
import { AppHeader } from './AppHeader';
import { WizardNames } from './WizardNames';
import { ProjectForm } from './WizardSettings';
import { introDismissed, rememberIntroDismissed } from './localPrefs';
import { generateProject, parseProjectContext } from '../core/engine';
import { expandPlan } from '../core/wizard/plan';
import * as S from './wizardState';
import { en } from '../messages/en';
import { VERSION } from '../version';

describe('소개 상자의 예시 (D107) — 엔진이 만든 값만 · PASS 는 valid:true 에서만', () => {
  it('커밋된 introExamples.json 은 지금 엔진이 만든 것과 같다 — 다르면 `npm run intro-examples` 를 돌린다', () => {
    expect(committed).toEqual(buildIntroExample());
    expect(committed.rules).toBe(VERSION.rules);
  });
  it('세 줄 — 프로젝트 ID · VM · 부트 디스크, 전부 valid:true', () => {
    expect(committed.input).toEqual(['devops', 'payments', 'prod', 'asia-northeast3']);
    expect(committed.rows.map((r) => r.id)).toEqual(['project', 'vm', 'boot']);
    for (const r of committed.rows) expect(r.valid, r.name).toBe(true);
    // 검사기 — 값은 06-wizard 스크린샷(rules 2026-10-13.3)에 찍힌 이름과 같다
    expect(committed.rows.map((r) => r.name)).toEqual(['devops-payments-prod', 'payments-shop-prod-ane3-gce-web-01', 'payments-shop-prod-ane3-gce-web-01-boot']);
  });
  it('넓은 화면은 세 줄 모두 PASS · 폰은 VM 한 줄만', () => {
    const wide = renderToStaticMarkup(createElement(IntroExample, { phone: false }));
    expect(wide.replace(/<[^>]+>/g, '')).toContain('devops · payments · prod · asia-northeast3');
    expect(wide.match(/data-intro-example-row=/g)).toHaveLength(3);
    expect(wide.match(/data-intro-example-pass/g)).toHaveLength(3);
    const phone = renderToStaticMarkup(createElement(IntroExample, { phone: true }));
    expect(phone.match(/data-intro-example-row="([^"]+)"/g)).toEqual(['data-intro-example-row="vm"']);
    expect(phone).toContain('payments-shop-prod-ane3-gce-web-01');
    expect(phone).not.toContain('devops-payments-prod<');
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

describe('More 메뉴의 About (D107)', () => {
  const header = (onAbout?: () => void) => renderToStaticMarkup(createElement(AppHeader, {
    screen: 'wizard', otherHref: '/pick', namingHref: '/docs/naming', apiHref: '/docs/api', ...(onAbout ? { onAbout } : {}),
  }));
  it('onAbout 를 넘기면 메뉴 항목이 하나 생긴다 · 안 넘기면(트리 화면) 없다', () => {
    const m = header(() => {});
    const item = /<button[^>]*data-nav-about[^>]*>/.exec(m)?.[0];
    expect(item).toMatch(/role="menuitem"/);
    expect(item).toMatch(/tabindex="-1"/);
    expect(m).toContain(`${en.ui.nav_about}</button>`);
    expect(header()).not.toContain('data-nav-about');
  });

  afterEach(() => vi.unstubAllGlobals());
  it('닫으면 기억하고, About 은 그 기억을 지운다 — 새로 열어도 보인다', () => {
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
