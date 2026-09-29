// 규칙 지문 (D26) — 규칙 데이터와 기준선 출력의 sha256 을 rules-fingerprint.json 과 대어 본다.
// 지문이 달라졌으면 같은 입력에서 이름 · 판정 · 제안 · 라벨이 달라졌다는 뜻이다 — RULES_REVISION 을 올리고 파일을 다시 쓴다.
// CI(.github/workflows/ci.yml)가 origin/main 의 파일과 대어 revision 을 안 올린 지문 변경을 막는다
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RULES_REVISION } from './revision';
import { RULES, LABEL_LIMITS, AWS_TAG_VALUE } from './constraints';
import { SHORT_WORDS } from './shorten';
import { ENV_ALIASES, REGION_ALIASES } from './normalize';
import { MIN_TOKEN, PROTECTED } from './types';
import { coreBaseline } from './baseline-inputs';

const FILE = join(import.meta.dirname, 'rules-fingerprint.json');
const HINT = '같은 입력에서 이름 · 판정 · 제안 · 라벨이 달라졌다 — RULES_REVISION 을 올리고 UPDATE_FINGERPRINT=1 npx vitest run src/core/revision.test.ts 로 파일을 다시 쓴다';

/** 키를 정렬해 직렬화한다 — 규칙 표의 필드 순서만 바뀐 것은 지문을 바꾸지 않는다. RegExp 는 source · flags */
function canonical(v: unknown): unknown {
  if (v instanceof RegExp) return { source: v.source, flags: v.flags };
  if (Array.isArray(v)) return v.map(canonical);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  }
  return v;
}

/** 규칙 데이터 — displayName · note 는 뺀다. 표시용 문구라 이름 · 판정에 관여하지 않고, 문구 이관 때 바뀐다 */
function rulesData() {
  return Object.keys(RULES).sort().map((id) => {
    const { displayName: _d, note: _n, ...rest } = RULES[id]!;
    return rest;
  });
}

function fingerprintOf(parts: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(parts))).digest('hex');
}

function currentParts() {
  return {
    rules: rulesData(), shortWords: SHORT_WORDS, envAliases: ENV_ALIASES, regionAliases: REGION_ALIASES,
    protected: PROTECTED, minToken: MIN_TOKEN, labelLimits: LABEL_LIMITS, awsTagValue: AWS_TAG_VALUE,
    outputs: coreBaseline(),
  };
}

describe('규칙 버전 · 지문 (D26)', () => {
  const fingerprint = fingerprintOf(currentParts());
  if (process.env.UPDATE_FINGERPRINT === '1') {
    writeFileSync(FILE, `${JSON.stringify({ revision: RULES_REVISION, fingerprint }, null, 2)}\n`);
  }
  const file = JSON.parse(readFileSync(FILE, 'utf-8')) as { revision: string; fingerprint: string };

  it('RULES_REVISION 꼴은 YYYY-MM-DD.N', () => {
    expect(RULES_REVISION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it('검사기 자체 시험 — 규칙 숫자 하나 · 출력 하나 · 별칭 하나가 바뀌면 지문이 바뀌고, 필드 순서만 바뀌면 그대로다', () => {
    const base = currentParts();
    const rules = base.rules.map((r, i) => (i === 0 ? { ...r, maxLength: r.maxLength + 1 } : r));
    expect(fingerprintOf({ ...base, rules })).not.toBe(fingerprint);
    const outputs = { ...base.outputs, validate: base.outputs.validate.map((v, i) => (i === 0 ? { ...v, valid: !v.valid } : v)) };
    expect(fingerprintOf({ ...base, outputs })).not.toBe(fingerprint);
    expect(fingerprintOf({ ...base, envAliases: { ...base.envAliases, qa: 'stg' } })).not.toBe(fingerprint);
    const reordered = base.rules.map((r) => Object.fromEntries(Object.entries(r).reverse()));
    expect(fingerprintOf({ ...base, rules: reordered })).toBe(fingerprint);
  });

  it('파일의 revision 이 RULES_REVISION 과 같다', () => {
    expect(file.revision, HINT).toBe(RULES_REVISION);
  });

  it('계산한 지문이 파일과 같다', () => {
    expect(fingerprint, HINT).toBe(file.fingerprint);
  });
});
