// README · docs/rules.md · docs/api.md 의 숫자 · 버전 · 예시가 엔진과 같은지 센다 — 손으로 옮겨 적는 자리라 규칙이 바뀌면 낡는다 (D45 · D58)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rulesFor } from '../core/constraints';
import { RULES_REVISION } from '../core/revision';
import { ENABLED_PROVIDERS, PROVIDERS } from '../core/types';

const doc = (f: string) => readFileSync(join(import.meta.dirname, '..', '..', f), 'utf-8');
// README 의 상세는 docs/ 로 옮겼다 — 지원 리소스 · 한계는 docs/rules.md, API 는 docs/api.md
const readme = doc('README.md');
const rules = doc('docs/rules.md');
const api = doc('docs/api.md');
const all = [readme, rules, api].join('\n');

describe('README.md · docs/rules.md · docs/api.md — 지원 리소스 · 규칙 버전 · 예시', () => {
  it('「Supported resources (N rules」 의 N 은 켜진 CSP 의 규칙 수다', () => {
    const m = /^## Supported resources \((\d+) rules/m.exec(rules);
    expect(m, '머리가 없다').not.toBeNull();
    expect(ENABLED_PROVIDERS).toEqual(['aws', 'gcp']);
    expect(Number(m![1])).toBe(rulesFor('aws').length + rulesFor('gcp').length);
  });
  it('켜지지 않은 CSP 의 규칙 수도 엔진 값과 같다', () => {
    for (const p of PROVIDERS.filter((x) => !ENABLED_PROVIDERS.includes(x))) {
      const name = p === 'aws' ? 'AWS' : 'Azure';
      expect(rules, p).toContain(`${name} ${rulesFor(p).length}`);
    }
  });
  it('규칙 버전 문장은 RULES_REVISION 이다 — 영어 · 한국어 절 모두', () => {
    const en = [...rules.matchAll(/rules revision `([0-9.-]+)`/g)].map((x) => x[1]);
    const ko = [...rules.matchAll(/규칙 버전 `([0-9.-]+)`/g)].map((x) => x[1]);
    expect(en.length).toBeGreaterThan(0);
    expect(ko.length).toBeGreaterThan(0);
    for (const v of [...en, ...ko]) expect(v).toBe(RULES_REVISION);
    // 응답 예시의 version.rules 도 같다
    const inJson = [...api.matchAll(/"rules": "([0-9.-]+)"/g)].map((x) => x[1]);
    expect(inJson.length).toBeGreaterThan(0);
    for (const v of inJson) expect(v).toBe(RULES_REVISION);
  });
  it('API 절은 배포돼 있다는 사실과 맞다 — 「공개 도메인이 없다」 문장이 없고 /docs/api 를 가리킨다 (D98)', () => {
    expect(all).not.toMatch(/no public domain yet/i);
    expect(all).not.toContain('아직 공개 도메인이 없다');
    expect(api).toMatch(/^## API in three lines\n\n[^\n]*`\/docs\/api`/m);
    expect(api).toMatch(/^## API 세 줄\n\n[^\n]*`\/docs\/api`/m);
  });
  it('옛 이름 체계의 값이 예시에 남지 않는다 — 나라 지역 값 · prd 이름 · 꺼진 CSP 요청', () => {
    expect(all).not.toMatch(/"region":\s*"(kr|us|jp|eu)"/);
    expect(all).not.toMatch(/-(kr|prd)-/);
    expect(all).not.toMatch(/"provider":\s*"(aws|azure)"/);
    expect(all).not.toMatch(/"environment":\s*"prd"/);
  });
});
