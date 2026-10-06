// generateMany 의 항목 key — `${resourceType}_${seq}`(count) · `${resourceType}_${role}`(role) · resourceType(입력 없음).
// 한 요청 안에서 key 가 겹치면 충돌 판정(findConflicts)과 응답 소비자가 두 항목을 하나로 본다.
// 규칙 표가 커져도 「가능한 모든 key」가 서로 다른 규칙끼리 겹치지 않는지를 표 전체로 단언한다.
import { describe, it, expect } from 'vitest';
import { PROVIDERS } from './types';
import { rulesFor } from './constraints';
import { MAX_COUNT, ROLE_PATTERN } from './selection';
import { inputKind } from './tree';

const seqs = Array.from({ length: MAX_COUNT }, (_, i) => String(i + 1).padStart(2, '0'));
const roleBody = ROLE_PATTERN.source.replace(/^\^|\$$/g, '');

describe.each(PROVIDERS)('%s — 가능한 항목 key 가 규칙끼리 겹치지 않는다', (provider) => {
  const rules = rulesFor(provider);
  /** 정해진 key(count · 입력 없음) → 규칙 id */
  const fixed = new Map<string, string[]>();
  for (const r of rules) {
    const kind = inputKind(r);
    const keys = kind === 'count' ? seqs.map((s) => `${r.resourceType}_${s}`) : kind === 'none' ? [r.resourceType] : [];
    for (const k of keys) fixed.set(k, [...(fixed.get(k) ?? []), r.id]);
  }
  const roleRules = rules.filter((r) => inputKind(r) === 'role');

  it('count · 입력 없음 규칙의 key 는 서로 다르다', () => {
    expect([...fixed].filter(([, ids]) => ids.length > 1)).toEqual([]);
  });

  it('role 규칙의 key 꼴(`<type>_<role>`)이 다른 규칙의 정해진 key 를 덮지 않는다', () => {
    const hits: string[] = [];
    for (const r of roleRules) {
      const re = new RegExp(`^${r.resourceType}_${roleBody}$`);
      for (const [k, ids] of fixed) if (re.test(k) && !ids.includes(r.id)) hits.push(`${r.id} ↔ ${k} (${ids.join(', ')})`);
    }
    expect(hits).toEqual([]);
  });

  it('role 규칙끼리 key 꼴이 겹치지 않는다 — 한 type 이 다른 type 의 `_<role>` 꼴이 아니다', () => {
    const hits: string[] = [];
    for (const a of roleRules) for (const b of roleRules) {
      if (a === b) continue;
      // b 의 key `${b}_${role}` 가 a 의 꼴에도 맞으려면 b 가 `${a}_` 로 시작해야 한다
      if (b.resourceType.startsWith(`${a.resourceType}_`) || a.resourceType === b.resourceType) hits.push(`${a.id} ↔ ${b.id}`);
    }
    expect(hits).toEqual([]);
  });
});
