// README 의 숫자 · 버전 · 예시가 엔진과 같은지 센다 — 손으로 옮겨 적는 자리라 규칙이 바뀌면 낡는다 (D45 · D58)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rulesFor } from '../core/constraints';
import { RULES_REVISION } from '../core/revision';
import { ENABLED_PROVIDERS, PROVIDERS } from '../core/types';

const readme = readFileSync(join(import.meta.dirname, '..', '..', 'README.md'), 'utf-8');

describe('README.md — 지원 리소스 · 규칙 버전 · 예시', () => {
  it('「Supported resources (N rules」 의 N 은 켜진 CSP 의 규칙 수다', () => {
    const m = /^## Supported resources \((\d+) rules/m.exec(readme);
    expect(m, '머리가 없다').not.toBeNull();
    expect(ENABLED_PROVIDERS).toEqual(['gcp']);
    expect(Number(m![1])).toBe(rulesFor('gcp').length);
  });
  it('켜지지 않은 CSP 의 규칙 수도 엔진 값과 같다', () => {
    for (const p of PROVIDERS.filter((x) => !ENABLED_PROVIDERS.includes(x))) {
      const name = p === 'aws' ? 'AWS' : 'Azure';
      expect(readme, p).toContain(`${name} ${rulesFor(p).length}`);
    }
  });
  it('규칙 버전 문장은 RULES_REVISION 이다 — 영어 · 한국어 절 모두', () => {
    const en = [...readme.matchAll(/rules revision `([0-9.-]+)`/g)].map((x) => x[1]);
    const ko = [...readme.matchAll(/규칙 버전 `([0-9.-]+)`/g)].map((x) => x[1]);
    expect(en.length).toBeGreaterThan(0);
    expect(ko.length).toBeGreaterThan(0);
    for (const v of [...en, ...ko]) expect(v).toBe(RULES_REVISION);
    // 응답 예시의 version.rules 도 같다
    const inJson = [...readme.matchAll(/"rules": "([0-9.-]+)"/g)].map((x) => x[1]);
    expect(inJson.length).toBeGreaterThan(0);
    for (const v of inJson) expect(v).toBe(RULES_REVISION);
  });
  it('옛 이름 체계의 값이 예시에 남지 않는다 — 나라 지역 값 · prd 이름 · 꺼진 CSP 요청', () => {
    expect(readme).not.toMatch(/"region":\s*"(kr|us|jp|eu)"/);
    expect(readme).not.toMatch(/-(kr|prd)-/);
    expect(readme).not.toMatch(/"provider":\s*"(aws|azure)"/);
    expect(readme).not.toMatch(/"environment":\s*"prd"/);
  });
});
