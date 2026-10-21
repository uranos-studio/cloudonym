// /catalog.json 의 클라이언트 칸 (D101) — CLI 가 규칙을 복제하지 않고 물을 것을 정하도록 core 의 표를 그대로 옮겨 싣는가
import { describe, it, expect } from 'vitest';
import { buildCatalogJson, CATALOG_LIMITS } from './catalog';
import { VERSION } from '../version';
import { RULES } from '../core/constraints';
import { inputKind } from '../core/tree';
import { pickLocationNames } from '../core/regions';
import { PRESETS } from '../core/wizard/presets';
import { ATTACHMENTS, MAX_DATA_DISKS } from '../core/wizard/attachments';
import { MAX_PICKS_PER_SERVICE, MAX_SERVICES, SLOT_ID_PATTERN } from '../core/wizard/plan';
import { MAX_COUNT, MAX_NAMES, ROLE_PATTERN, SEQ_PATTERN } from '../core/selection';
import { TIER_PATTERN } from '../core/types';
import { ENV_VALUES } from '../core/normalize';
import { SCOPES } from '../core/scopes';
import { MAX_BODY_BYTES } from './v1';
import type { Loose } from './test-support';

const doc = JSON.parse(buildCatalogJson(['gcp'], VERSION)) as Loose;
const gcp = doc.providers.gcp;

describe('/catalog.json 클라이언트 칸 (D101)', () => {
  it('규칙마다 input = inputKind · tier = 템플릿의 tier 자리 · locations = pickLocationNames(받는 규칙만)', () => {
    let n = 0;
    for (const row of gcp.rows) {
      for (const [id, spec] of Object.entries(row.rules as Record<string, Loose>)) {
        const rule = RULES[id]!;
        expect(rule, id).toBeDefined();
        expect(spec.input, id).toBe(inputKind(rule));
        expect(spec.tier, id).toBe(rule.template.includes('tier'));
        const locs = pickLocationNames(rule);
        if (locs.length === 0) expect(spec.locations, id).toBeUndefined();
        else expect(spec.locations, id).toEqual(locs);
        n++;
      }
    }
    expect(n).toBeGreaterThan(100);
    // 대표 셋 — VM 은 개수 · 서비스 계정은 역할 · 버킷은 위치를 받는다
    const rule = (id: string) => gcp.rows.find((r: Loose) => id in r.rules).rules[id];
    expect(rule('gcp.compute_instance')).toMatchObject({ input: 'count', tier: true });
    expect(rule('gcp.service_account').input).toBe('role');
    expect(rule('gcp.storage_bucket').locations).toContain('US');
  });

  it('presets — PRESETS 와 같은 수 · 같은 순서 · 요청 본문 이름(rule · tier_choices · min_instances)', () => {
    expect(gcp.presets.map((p: Loose) => p.id)).toEqual(PRESETS.map((p) => p.id));
    for (const [i, p] of PRESETS.entries()) {
      const w = gcp.presets[i];
      expect(w.rule, p.id).toBe(p.ruleId);
      expect(w.tier, p.id).toBe(p.tier);
      expect(w.tier_choices, p.id).toEqual(p.tierChoices ? [...p.tierChoices] : undefined);
      expect(w.kind, p.id).toBe(p.kind);
      expect(w.ha, p.id).toEqual(p.ha ? { min_instances: p.ha.minInstances } : null);
      expect(w.serverless, p.id).toEqual(p.serverless ? [...p.serverless.ruleIds] : null);
      expect(w.level, p.id).toBe(p.level);
    }
    // 프리셋 규칙은 전부 catalog 행에 있다 — CLI 가 프리셋 id 를 규칙으로 풀 수 있다
    const ruleIds = new Set(gcp.rows.flatMap((r: Loose) => Object.keys(r.rules)));
    for (const p of gcp.presets) expect(ruleIds.has(p.rule), p.id).toBe(true);
  });

  it('attachments · limits — core 상수 그대로 · 본문 상한은 Worker 의 MAX_BODY_BYTES', () => {
    expect(gcp.attachments).toEqual(ATTACHMENTS.map((a) => ({ ...a })));
    expect(gcp.limits).toEqual({
      max_services: MAX_SERVICES, max_picks_per_service: MAX_PICKS_PER_SERVICE, max_names: MAX_NAMES, max_count: MAX_COUNT,
      max_data_disks: MAX_DATA_DISKS, max_body_bytes: MAX_BODY_BYTES,
      seq_pattern: SEQ_PATTERN.source, slot_id_pattern: SLOT_ID_PATTERN.source, tier_pattern: TIER_PATTERN.source, role_pattern: ROLE_PATTERN.source,
    });
    expect(CATALOG_LIMITS.max_body_bytes).toBe(MAX_BODY_BYTES);
  });

  it('scopes — 그 CSP 의 SCOPES 그대로(id · displayName · parent) · 뿌리만 parent 가 없다 · 규칙의 scope 는 전부 표에 있다 (CLI 의 Unique in 칸)', () => {
    const want = Object.values(SCOPES).filter((s) => s.provider === 'gcp').map((s) => ({ id: s.id, name: s.displayName, ...(s.parent === undefined ? {} : { parent: s.parent }) }));
    expect(gcp.scopes).toEqual(want);
    expect(gcp.scopes.filter((s: Loose) => s.parent === undefined).map((s: Loose) => s.id)).toEqual(['gcp:namespace']);
    const ids = new Set(gcp.scopes.map((s: Loose) => s.id));
    for (const row of gcp.rows) for (const id of Object.keys(row.rules)) expect(ids.has(RULES[id]!.scope), id).toBe(true);
    const aws = JSON.parse(buildCatalogJson(['gcp', 'aws'], VERSION)).providers.aws;
    expect(aws.scopes.every((s: Loose) => s.id.startsWith('aws:'))).toBe(true);
  });

  it('env_values — 맨 위 칸 · core 의 ENV_VALUES 그대로(순서까지) · CSP 와 무관하게 한 번 (D121)', () => {
    expect(Object.keys(doc)).toEqual(['version', 'env_values', 'providers']);
    expect(doc.env_values).toEqual([...ENV_VALUES]);
    expect(gcp.env_values).toBeUndefined();
  });

  it('마법사가 없는 CSP 는 빈 presets · 그 CSP 부모의 attachments 만', () => {
    const aws = JSON.parse(buildCatalogJson(['gcp', 'aws'], VERSION)).providers.aws;
    expect(aws.presets).toEqual([]);
    expect(aws.attachments).toEqual([]);
    expect(aws.limits).toEqual(gcp.limits);
  });
});
