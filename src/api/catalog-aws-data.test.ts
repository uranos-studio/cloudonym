// catalog/aws.json 과 AWS 규칙 표의 대조 (0.2 준비) — aws.json 은 아직 생성 TS 가 없어(AWS 를 켜는 커밋에서 쓴다) 화면이 읽지 않는다.
// 그동안 규칙 표가 바뀌어 catalog 행이 규칙과 어긋나지 않게, 행의 규칙 id · 표시 이름 · slug · 분류 · entity · 길이 · 지역 토큰을 규칙에 대어 본다
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RULES } from '../core/constraints';

interface AwsRow {
  key: string; displayName: string; category: string; entity: string | null; info: string;
  slug: { value: string };
  rules: Record<string, { scope: string; regionToken: 'none' | 'region' }>;
}
const aws = JSON.parse(readFileSync(join(import.meta.dirname, '../../catalog/aws.json'), 'utf-8')) as { rows: AwsRow[] };
const specs = aws.rows.flatMap((row) => Object.entries(row.rules).map(([id, spec]) => ({ row, id, spec })));

/** 규칙의 CloudFormation 꼴 entity(AWS::EC2::Subnet) → catalog 꼴(ec2.Subnet) — 스키마가 서비스 소문자 · 점 구분을 요구한다 */
const catalogEntity = (entity: string | undefined): string | null =>
  entity === undefined ? null : entity.replace(/^AWS::([A-Za-z0-9]+)::/, (_, svc: string) => `${svc.toLowerCase()}.`);

describe('catalog/aws.json ↔ AWS 규칙 표', () => {
  it('AWS 규칙마다 catalog 규칙이 정확히 하나다 — 빠진 규칙 · 없는 규칙 id 가 없다', () => {
    const ids = specs.map((s) => s.id).sort();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(Object.keys(RULES).filter((id) => RULES[id]!.provider === 'aws').sort());
  });

  it('표시 이름 · slug · 분류 · entity 가 규칙과 같다', () => {
    for (const { row, id } of specs) {
      const r = RULES[id]!;
      expect({ id, displayName: row.displayName, slug: row.slug.value, category: row.category, entity: row.entity })
        .toEqual({ id, displayName: r.displayName, slug: r.slug, category: r.category, entity: catalogEntity(r.entity) });
    }
  });

  it('info 의 길이가 규칙의 minLength · maxLength 와 같다', () => {
    for (const { row, id } of specs) {
      const m = /(\d+) to (\d+) characters\.$/.exec(row.info);
      expect(m, `${id}: ${row.info}`).not.toBeNull();
      expect([id, Number(m![1]), Number(m![2])]).toEqual([id, RULES[id]!.minLength, RULES[id]!.maxLength]);
    }
  });

  it('지역 토큰이 규칙 template 의 region 자리와 같다', () => {
    for (const { id, spec } of specs) {
      expect([id, spec.regionToken]).toEqual([id, RULES[id]!.template.includes('region') ? 'region' : 'none']);
    }
  });
});
