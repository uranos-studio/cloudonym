// 전사 검사 (D43) — 들인 GCP 행이 원문(디스커버리 문서)과 같은지 원문 스냅샷(__fixtures__/gcp-intake.json)에 대어 본다.
// 정답은 RULES 가 아니라 원문이다. 원문 행(compute insert 메서드 · KMS create 의 …Id 인자)은 셋 중 하나여야 한다:
// 손으로 쓴 규칙 · 들인 규칙 · 보류 목록(docs/gcp-intake-held.md).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rulesFor } from './constraints';
import { SCOPES } from './scopes';
import { GCP_INTAKE_ROWS, GCP_INTAKE_SCOPES } from './rules/gcp-intake';

interface SourceRow { api: string; method: string; resource?: string; schema?: string; path: string | null; pattern?: string | null; readOnly?: boolean; param?: string; description: string | null }
const SNAP = JSON.parse(readFileSync(join(import.meta.dirname, '__fixtures__', 'gcp-intake.json'), 'utf-8')) as { revisions: { computeRevision: string; kmsRevision: string }; rows: SourceRow[] };
const HELD = readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'gcp-intake-held.md'), 'utf-8');
const RFC1035 = '[a-z](?:[-a-z0-9]{0,61}[a-z0-9])?';

const rules = rulesFor('gcp');
const ruleByEntity = new Map(rules.map((r) => [r.entity, r]));
const intakeByMethod = new Map(GCP_INTAKE_ROWS.map((r) => [r.method, r]));
const heldMethods = new Set(HELD.split('\n').filter((l) => /^\| (compute|cloudkms) \| /.test(l)).map((l) => l.split(' | ')[1]!.trim()));
const entityOf = (s: SourceRow) => `compute.${s.resource}`;

describe('들인 GCP 행 — 원문 스냅샷과 대조', () => {
  it('스냅샷 — compute insert 메서드 95 · revision 이 lock 과 같다', () => {
    expect(SNAP.rows.filter((r) => r.api === 'compute')).toHaveLength(95);
    const lock = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'rule-sources.lock.json'), 'utf-8'));
    expect(SNAP.revisions.computeRevision).toBe(lock.sources.gcp.marker.revision);
  });

  it('원문 행은 전부 손 규칙 · 들인 규칙 · 보류 가운데 정확히 하나다', () => {
    const bad: string[] = [];
    for (const s of SNAP.rows) {
      const hand = s.api === 'compute' && ruleByEntity.has(entityOf(s)) && !intakeByMethod.has(s.method);
      const n = Number(hand) + Number(intakeByMethod.has(s.method)) + Number(heldMethods.has(s.method));
      if (n !== 1) bad.push(`${s.method} (${n})`);
    }
    expect(bad).toEqual([]);
  });

  it.each(GCP_INTAKE_ROWS.map((r) => r.id))('%s — pattern · 길이 · 범위가 원문 행과 같다', (id) => {
    const row = GCP_INTAKE_ROWS.find((r) => r.id === id)!;
    const src = SNAP.rows.find((s) => s.method === row.method)!;
    expect(src, row.method).toBeDefined();
    const rule = rules.find((r) => r.id === id)!;
    if (src.api === 'compute') {
      expect(src.pattern).toBe(RFC1035);
      expect(src.readOnly).toBe(false);
      expect(row.pattern).toBe(src.pattern);
      expect(rule.entity).toBe(entityOf(src));
      expect([rule.minLength, rule.maxLength]).toEqual([1, 63]);
      const place = /^projects\/\{project\}\/(global|regions|zones)\//.exec(src.path ?? '')![1];
      expect(rule.scope).toBe({ global: 'gcp:project_global', regions: 'gcp:project_region', zones: 'gcp:project_zone' }[place!]);
      expect(rule.docUrl).toMatch(new RegExp(`/compute/docs/reference/rest/v1/${src.resource}(/insert#body\\.request_body|#${src.schema})\\.FIELDS\\.name$`));
    } else {
      // 설명 안 백틱 정규식 그대로 · 길이는 {min,max}
      expect(src.description).toContain(`regular expression \`${row.pattern}\``);
      expect(row.pattern).toMatch(new RegExp(`\\{${rule.minLength},${rule.maxLength}\\}$`));
      const within = /unique within an? (location|KeyRing)/.exec(src.description ?? '')![1];
      expect(rule.scope).toBe(within === 'location' ? 'gcp:project_location' : 'gcp:kms_key_ring');
      expect(rule.docUrl).toMatch(/^https:\/\/docs\.cloud\.google\.com\/kms\/docs\/reference\/rest\/v1\/projects\.locations\.[A-Za-z.]+\/create#query-parameters$/);
    }
    expect(rule.pattern.source).toBe(`^(?:${row.pattern})$`);
  });

  it('보류에 KMS 깨진 원문 · 조사 밖 행이 사유와 함께 있다 · 깨진 여섯 칸이 적혀 있다', () => {
    expect(HELD).toMatch(/cloudkms\.projects\.locations\.keyHandles\.create .*reviewed by hand — not imported \(/);
    expect(HELD.match(/^\| compute \| compute\.\w*[fF]irewallPolicies\.insert .*reviewed by hand — unconfirmed \(/gm)).toHaveLength(3);
    expect(HELD).toMatch(/singleTenantHsmInstances\.create .*outside the surveyed/);
    expect(HELD.match(/^\| (spanner|iam) v\d \| /gm)).toHaveLength(6);
  });

  it('새 범위 둘은 프로젝트 아래 · key ring 범위의 규칙은 location 범위에 놓인다', () => {
    expect(Object.keys(GCP_INTAKE_SCOPES)).toEqual(['gcp:project_location', 'gcp:kms_key_ring']);
    expect(SCOPES['gcp:project_location'].parent).toBe('gcp:project');
    expect(SCOPES['gcp:kms_key_ring'].parent).toBe('gcp:project_location');
    expect(rules.find((r) => r.id === 'gcp.kms_key_ring')!.scope).toBe('gcp:project_location');
  });

  it('resourceType 은 GCP 안에서 유일하고 40자 이하다', () => {
    const types = rules.map((r) => r.resourceType);
    expect(new Set(types).size).toBe(types.length);
    for (const t of types) expect(t.length, t).toBeLessThanOrEqual(40);
  });
});
