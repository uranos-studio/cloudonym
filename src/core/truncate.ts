import { MIN_TOKEN, PROTECTED, type ResourceRule, type Token } from './types';
import type { CoreMessage } from './messages';
import { compose } from './compose';
import { elementBudget, shorten } from './shorten';

type Values = Partial<Record<Token, string>>;

export function fit(input: Values, rule: ResourceRule) {
  const steps: CoreMessage[] = [];
  const values: Values = { ...input };
  const name = () => compose(values, rule.template, rule.separator);
  // 가변 토큰 = 입력에 값이 있고(정제로 빈 '' 은 제외) 1단계에서 떼지 않은 비보호 토큰
  const variableTokens = () => rule.template.filter((t) => !!input[t] && values[t] !== undefined && !PROTECTED.includes(t));
  // MIN_TOKEN 은 2단계(단축·균등)가 바꾼 토큰에만 건다 — 사용자가 준 짧은 값은 축소의 결과가 아니다 (D13)
  const shrunkTooShort = (t: Token) => values[t] !== input[t] && (values[t] ?? '').length < MIN_TOKEN;
  const holds = () => {
    const n = name();
    return n.length <= rule.maxLength
      && !variableTokens().some(shrunkTooShort)
      && !n.includes('--') && !n.startsWith('-') && !n.endsWith('-');
  };
  const done = () => ({ values, name: name(), truncated: steps.length > 0, steps, fits: holds() });

  if (name().length <= rule.maxLength) return done();

  // 1단계 — 생략 가능 토큰을 적힌 순서대로 뗀다
  for (const t of rule.optional) {
    if (!values[t]) continue;
    delete values[t];
    steps.push({ code: 'step.token_dropped', field: t });
    if (name().length <= rule.maxLength) return done();
  }

  // 2단계 — 단축 사전
  const present = rule.template.filter((t) => values[t]);
  const variable = present.filter((t) => !PROTECTED.includes(t));
  for (const t of variable) {
    const s = shorten(values[t]!);
    if (s !== values[t]) { steps.push({ code: 'step.abbreviated', field: t, params: { from: values[t]!, to: s } }); values[t] = s; }
  }
  if (name().length <= rule.maxLength) return done();

  // 2단계 — 균등 예산 (고정 길이는 template 에 실제로 있는 보호 토큰만)
  const fixedLen = present.filter((t) => PROTECTED.includes(t)).reduce((n, t) => n + values[t]!.length, 0);
  const separators = rule.separator.length * Math.max(0, present.length - 1);
  const budget = elementBudget(rule.maxLength, fixedLen, separators, variable.length);
  if (budget < MIN_TOKEN) return done();               // D13 — 한 글자 토큰은 만들지 않는다
  for (const t of variable) {
    if (values[t]!.length > budget) values[t] = values[t]!.slice(0, budget).replace(/^-+|-+$/g, '');
  }
  steps.push({ code: 'step.budget_shortened', params: { budget } });
  return done();                                        // 3단계 — 불변조건이 깨지면 fits:false
}
