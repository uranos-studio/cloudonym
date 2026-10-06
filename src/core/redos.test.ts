// 느린 정규식(지수 · 고차 다항 백트래킹) 시험 — 모든 규칙의 판정 정규식(rule.pattern)을 공격 입력 묶음으로 돌려 시간을 잰다.
// 생성기(build-aws-rules.mjs backtracks)는 들인 AWS 행만 본다 — 손 규칙(*-manual.ts · aws.ts · gcp.ts · azure.ts)과 Azure · GCP 생성 규칙까지 여기서 본다.
// checkName 이 아니라 pattern 을 직접 맞춘다: checkName 은 길이 · 첫 · 끝 글자 검사가 걸리면 pattern 을 건너뛰지만,
// API 소비자는 NameResult.rule.pattern 으로 정규식을 다시 만들어 쓴다 — 정규식 자체가 공격면이다.
//
// 공격 입력 = 첫 글자 + 반복 단위(상한 길이까지) + 끝 글자 하나. 백트래킹은 「받는 글자를 길게 늘어놓고 마지막에 받지 않는 글자」에서 터진다.
// 동기 정규식은 중간에 멈출 수 없다 — 상한 길이로 바로 뛰면 지수 꼴에서 시험이 끝나지 않는다. 그래서 길이를 조금씩 늘리고,
// 시간이 재어지기 시작하면 한 글자씩 늘려 예산을 처음 넘는 자리에서 멈춘다(넘어도 예산의 몇 배 안에서 끝난다).
import { describe, it, expect } from 'vitest';
import { RULES } from './constraints';
import type { ResourceRule } from './types';

/** 입력 하나의 예산 — 넘으면 같은 입력을 세 번 다시 재어 가장 짧은 값으로 판정한다(병렬 실행 · GC 로 한 번 튀는 것을 거른다) */
const BUDGET_MS = 50;

/** 반복 단위 — 글자 하나 · 글자와 구분자 · 구분자 반복 · 글자 부류 경계 너머(é · 4바이트 글자) */
const COMMON_UNITS = ['a', 'A', '1', 'a1', '-', '_', '.', '/', ' ', ':', 'a-', 'a_', 'a.', 'a/', 'a ', 'a:', '-a', '--', '__', '..', '//', 'a--', 'a-1', 'a.b-', 'é', 'aé', '\u{1F600}'];
/** 끝 글자 — 흔한 금지 글자 · 구분자 · 대문자 · 제어 · 폭 없는 문자, 그리고 ASCII 글자 부류의 바로 바깥([0-9] 의 / : · [A-Z] 의 @ [ · [a-z] 의 ` {) */
const ENDERS = ['!', '*', '#', '-', '.', '_', ' ', 'A', '/', ':', '@', '[', '`', '{', '\u0000', '​', '\u{1F600}'];

/** 규칙의 생성용 정보(allowed · separator · caseRule)에서 고른 반복 단위 — 규칙이 받는 글자로 길게 늘어놓아야 백트래킹이 일어난다 */
function unitsOf(rule: Pick<ResourceRule, 'allowed' | 'separator' | 'caseRule'>): string[] {
  const units = new Set(COMMON_UNITS);
  const sep = rule.separator || '-';
  const up = rule.caseRule === 'any';
  units.add(`a${sep}`).add(`${sep}${sep}`).add(`a${sep}${sep}`);
  if (up) units.add('Aa').add(`A${sep}`);
  if (rule.allowed.includes('underscore')) units.add('a_-').add('_a');
  if (rule.allowed.includes('period')) units.add('a.-').add('(a)').add('a(').add(').');
  return [...units];
}

function timeOf(re: RegExp, s: string): number {
  const t = performance.now();
  re.test(s);
  return performance.now() - t;
}
/** 예산을 넘으면 세 번 다시 재어 가장 짧은 값 */
function settled(re: RegExp, s: string): number {
  const first = timeOf(re, s);
  if (first <= BUDGET_MS) return first;
  return Math.min(first, timeOf(re, s), timeOf(re, s), timeOf(re, s));
}

interface Slow { input: string; length: number; ms: number }

/** 공격 묶음을 돌려 가장 느린 입력을 돌려준다. 예산을 넘는 입력을 만나면 그 자리에서 멈추고 그것을 돌려준다 */
function worstInput(pattern: RegExp, rule: Pick<ResourceRule, 'maxLength' | 'allowed' | 'separator' | 'caseRule'>): Slow {
  // test() 가 lastIndex 를 쓰는 g · y 깃발은 떼고 같은 원문으로 다시 만든다
  const re = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''));
  const max = rule.maxLength;
  let worst: Slow = { input: '', length: 0, ms: 0 };
  for (const prefix of ['', 'a']) {
    for (const unit of unitsOf(rule)) {
      for (const end of ENDERS) {
        let n = Math.min(4, max);
        let last = 0;
        for (;;) {
          // prefix + 단위 반복(코드 포인트 단위로 자른다) + 끝 글자 — 길이는 UTF-16 단위로 n 이하
          const room = n - prefix.length - end.length;
          if (room >= 0) {
            let body = '';
            while (body.length + unit.length <= room) body += unit;
            const input = prefix + body + end;
            const ms = settled(re, input);
            last = ms;
            if (ms > worst.ms) worst = { input, length: input.length, ms };
            if (ms > BUDGET_MS) return worst;
          }
          if (n >= max) break;
          // 재어지는 시간이 없으면 크게, 재어지기 시작하면 한 글자씩 — 지수 꼴도 예산의 몇 배 안에서 멈춘다
          const step = last < 0.01 ? 8 : last < BUDGET_MS / 20 ? 2 : 1;
          n = Math.min(n + step, max);
        }
      }
    }
  }
  return worst;
}

/** 같은 정규식 원문 · 깃발 · 상한 · 생성 정보는 한 번만 잰다 */
const groups = new Map<string, { rule: ResourceRule; ids: string[] }>();
for (const r of Object.values(RULES)) {
  const key = JSON.stringify([r.pattern.source, r.pattern.flags, r.maxLength, r.allowed, r.separator, r.caseRule]);
  const g = groups.get(key);
  if (g) g.ids.push(r.id);
  else groups.set(key, { rule: r, ids: [r.id] });
}

describe(`모든 규칙의 판정 정규식 — 공격 입력 하나가 ${BUDGET_MS}ms 를 넘지 않는다`, () => {
  it('규칙 전부를 묶었다', () => {
    expect([...groups.values()].reduce((n, g) => n + g.ids.length, 0)).toBe(Object.keys(RULES).length);
  });
  it.each([...groups.values()].map((g) => [g.ids.length > 1 ? `${g.ids[0]} 외 ${g.ids.length - 1}` : g.ids[0], g] as const))('%s', (_label, g) => {
    const w = worstInput(g.rule.pattern, g.rule);
    expect(w.ms, `${g.ids.join(' · ')} — /${g.rule.pattern.source}/${g.rule.pattern.flags} 가 ${JSON.stringify(w.input)}(${w.length}자)에 ${w.ms.toFixed(1)}ms`).toBeLessThanOrEqual(BUDGET_MS);
  });
});

describe('검사기 자체 시험 — 고치기 전의 느린 꼴을 잡는다', () => {
  // 들인 AWS::Logs::ResourcePolicy 의 원문 pattern(선형 꼴로 맞추기 전) · RDS 프록시 API 참조 원문 꼴. 둘 다 규칙 표에는 이제 없다
  const AWS_LIKE = { allowed: 'alnum-hyphen', separator: '-', caseRule: 'any' } as const;
  it.each([
    ['AWS::Logs::ResourcePolicy 원문', /^(?:^([^:*/]+\/?)*[^:*/]+$)$/, 255],
    ['RDS 프록시 원문', /^[A-Za-z](?:-?[A-Za-z0-9]+)*$/, 63],
  ] as const)('%s 는 예산을 넘는다', (_label, pattern, maxLength) => {
    expect(worstInput(pattern, { ...AWS_LIKE, maxLength }).ms).toBeGreaterThan(BUDGET_MS);
  });
  it('RDS 프록시 식별자의 선형 꼴은 원문 꼴과 같은 집합이다 — 길이 1~6 조합 전부 (Logs 쪽은 build-aws-rules.test.mjs 가 본다)', () => {
    const slow = /^[A-Za-z](?:-?[A-Za-z0-9]+)*$/;
    const fast = RULES['aws.rds_db_proxy']!.pattern;
    const walk = (s: string, d: number): void => {
      if (s.length > 0) expect(fast.test(s), JSON.stringify(s)).toBe(slow.test(s));
      if (d > 0) for (const c of ['a', 'A', '1', '-', '_']) walk(s + c, d - 1);
    };
    walk('', 6);
  });
});
