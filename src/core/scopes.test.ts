// 범위 그래프 불변식 (D37 · 계획 §4-5) — SCOPES 는 provider 마다 뿌리 하나 · 순환 없음 · ruleId 의 scope = 그 범위의 parent
import { describe, it, expect } from 'vitest';
import { SCOPES, type ScopeId } from './scopes';
import { RULES } from './constraints';
import { PROVIDERS } from './types';
import { AZURE_INTAKE_SCOPES } from './rules/azure-intake';
import { GCP_INTAKE_SCOPES } from './rules/gcp-intake';
import { GCP_MANUAL_SCOPES } from './rules/gcp-manual';
import { AWS_MANUAL_SCOPES } from './rules/aws-manual';

/** 손으로 넣은 규칙(rules/*-manual.ts)의 부모 리소스 범위 */
const MANUAL_SCOPES: Record<string, unknown> = { ...GCP_MANUAL_SCOPES, ...AWS_MANUAL_SCOPES };

const ALL = Object.values(SCOPES);

describe('SCOPES — 범위 그래프 (D37)', () => {
  it('손으로 쓴 15 행 + 들인 부모 리소스 범위 · 키와 id 가 같다 · docUrl 은 https', () => {
    expect(ALL).toHaveLength(15 + Object.keys(AZURE_INTAKE_SCOPES).length + Object.keys(GCP_INTAKE_SCOPES).length + Object.keys(MANUAL_SCOPES).length);
    for (const [k, s] of Object.entries(SCOPES)) {
      expect(s.id).toBe(k);
      expect(s.id.startsWith(`${s.provider}:`), s.id).toBe(true);
      expect(s.docUrl, s.id).toMatch(/^https:\/\//);
      expect(s.displayName.length, s.id).toBeGreaterThan(0);
    }
  });

  it('뿌리는 provider 마다 하나 — 가장 넓은 유일 범위 (azure:global · gcp:namespace · aws:partition)', () => {
    const roots = Object.fromEntries(PROVIDERS.map((p) => [p, ALL.filter((s) => s.provider === p && s.parent === undefined).map((s) => s.id)]));
    expect(roots).toEqual({ aws: ['aws:partition'], gcp: ['gcp:namespace'], azure: ['azure:global'] });
  });

  it('parent 는 같은 provider 의 범위이고, 따라가면 순환 없이 뿌리에 닿는다', () => {
    for (const s of ALL) {
      const seen = new Set<ScopeId>([s.id]);
      let cur = s;
      while (cur.parent !== undefined) {
        const parent = SCOPES[cur.parent];
        expect(parent, `${cur.id} → ${cur.parent}`).toBeDefined();
        expect(parent.provider).toBe(s.provider);
        expect(seen.has(parent.id), `순환 ${s.id}`).toBe(false);
        seen.add(parent.id);
        cur = parent;
      }
    }
  });

  it('ruleId 가 가리키는 규칙은 같은 provider 에 있고 그 규칙의 scope 는 이 범위의 parent 다', () => {
    const withRule = ALL.filter((s) => s.ruleId !== undefined);
    const hand = withRule.filter((s) => !(s.id in AZURE_INTAKE_SCOPES) && !(s.id in GCP_INTAKE_SCOPES) && !(s.id in MANUAL_SCOPES));
    expect(hand.map((s) => s.ruleId).sort()).toEqual(['aws.vpc', 'azure.container_service_managed_clusters', 'azure.resource_group', 'azure.virtual_network', 'gcp.project_id']);
    for (const s of withRule) {
      const r = RULES[s.ruleId!];
      expect(r, s.ruleId).toBeDefined();
      expect(r!.provider).toBe(s.provider);
      expect(r!.scope).toBe(s.parent);
    }
  });

  it('모든 규칙의 scope 는 SCOPES 에 있고 provider 가 같다', () => {
    for (const r of Object.values(RULES)) {
      const s = SCOPES[r.scope];
      expect(s, `${r.id} → ${r.scope}`).toBeDefined();
      expect(s.provider, r.id).toBe(r.provider);
    }
  });
});
