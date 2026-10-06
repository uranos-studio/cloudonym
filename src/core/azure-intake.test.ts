// 전사 검사 (D43) — 들인 Azure 행이 원문 표와 같은지 원문 스냅샷(__fixtures__/azure-intake.json)에 대어 본다.
// 정답은 RULES 가 아니라 원문이다 — RULES 에서 뽑아 RULES 를 검사하면 돌림 시험이 된다.
// 원문 402행은 셋 중 하나여야 한다: 손으로 쓴 규칙 · 들인 규칙 · 보류 목록(docs/azure-intake-held.md).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rulesFor } from './constraints';
import { SCOPES } from './scopes';
import { AZURE_INTAKE_CHARS, AZURE_INTAKE_ROWS } from './rules/azure-intake';

interface SourceRow { entity: string; scope: string; length: string; characters: string; judgement: string; anchor: string }
const SNAP = JSON.parse(readFileSync(join(import.meta.dirname, '__fixtures__', 'azure-intake.json'), 'utf-8')) as { commit: string; rows: SourceRow[] };
const HELD = readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'azure-intake-held.md'), 'utf-8');
const AZURE_RULES = 'https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules';

const key = (e: string) => e.toLowerCase();
const rules = rulesFor('azure');
const ruleByEntity = new Map(rules.map((r) => [key(r.entity), r]));
const intakeIds = new Set(AZURE_INTAKE_ROWS.map((r) => r.id));
/** 보류 표의 (Provider, Entity) — 표의 Entity 칸은 원문 그대로라 스냅샷과 같은 꼴로 맞춘다 */
const heldKeys = new Set(
  HELD.split('\n').filter((l) => /^\| Microsoft\./.test(l)).map((l) => {
    const [ns, ent] = l.slice(2).split(' | ');
    return key(`${ns}/${ent!.replace(/^\/+/, '').split('/').map((s) => s.trim()).filter(Boolean).join('/')}`);
  }),
);

describe('들인 Azure 행 — 원문 스냅샷과 대조', () => {
  it('스냅샷은 402행 · 고정 커밋이다', () => {
    expect(SNAP.rows).toHaveLength(402);
    expect(SNAP.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('원문 행은 전부 규칙이거나 보류 목록에 있다 — 둘 다인 행 · 둘 다 아닌 행이 없다', () => {
    const lost: string[] = [];
    const both: string[] = [];
    for (const row of SNAP.rows) {
      const isRule = ruleByEntity.has(key(row.entity));
      const isHeld = heldKeys.has(key(row.entity));
      if (!isRule && !isHeld) lost.push(row.entity);
      if (isRule && isHeld) both.push(row.entity);
    }
    expect(lost).toEqual([]);
    expect(both).toEqual([]);
  });

  it('보류에 정형 행이 남으면 사유가 범위 · 이름 길이다 — 문자 규칙 해석 실패로 빠진 정형 행이 없다', () => {
    expect(HELD).not.toMatch(/\| characters: /);
  });

  it.each(AZURE_INTAKE_ROWS.map((r) => r.id))('%s — 길이 · 문자 규칙 원문 · 앵커 · 범위가 원문 행과 같다', (id) => {
    const row = AZURE_INTAKE_ROWS.find((r) => r.id === id)!;
    const src = SNAP.rows.find((s) => key(s.entity) === key(row.entity));
    expect(src, row.entity).toBeDefined();
    expect(src!.judgement).toBe('formal');
    const [min, max] = src!.length.split('-').map(Number);
    const rule = rules.find((r) => r.id === id)!;
    expect([rule.minLength, rule.maxLength]).toEqual([min, max ?? min]);
    expect(AZURE_INTAKE_CHARS[row.chars].raw).toBe(src!.characters);
    expect(rule.docUrl).toBe(`${AZURE_RULES}#${src!.anchor}`);
    const scopeText = src!.scope.replace(/<br\s*\/?>.*$/i, '').trim().toLowerCase();
    const direct: Record<string, string> = {
      'resource group': 'azure:resource_group', 'resource group & region': 'azure:resource_group', global: 'azure:global',
      subscription: 'azure:subscription', region: 'azure:region', 'azure region': 'azure:region',
    };
    if (scopeText in direct && rule.entity !== 'Microsoft.ServiceBus/namespaces/topics/subscriptions/rules') expect(rule.scope).toBe(direct[scopeText]);
    else expect(SCOPES[rule.scope].parent, `${id} → ${rule.scope}`).toBeDefined(); // 부모 리소스 범위 — 뿌리가 아니다
  });

  it('들인 규칙은 손으로 쓴 규칙과 Entity 가 겹치지 않는다', () => {
    const hand = rules.filter((r) => !intakeIds.has(r.id)).map((r) => key(r.entity));
    expect(AZURE_INTAKE_ROWS.filter((r) => hand.includes(key(r.entity))).map((r) => r.id)).toEqual([]);
  });

  it('resourceType 은 Azure 안에서 유일하고 40자 이하다 (화면 hash 상한이 이 수에 기댄다)', () => {
    const types = rules.map((r) => r.resourceType);
    expect(new Set(types).size).toBe(types.length);
    for (const t of types) expect(t.length, t).toBeLessThanOrEqual(40);
  });
});
