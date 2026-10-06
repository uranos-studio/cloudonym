// 전사 검사 (D43) — 들인 AWS 행이 원문(CloudFormation 리소스 스키마)과 같은지 원문 스냅샷(__fixtures__/aws-intake.json)에 대어 본다.
// 정답은 RULES 가 아니라 원문이다. 원문 행(판정 표의 a · b 타입 202)은 셋 중 하나여야 한다:
// 손으로 쓴 규칙 · 들인 규칙 · 보류 목록(docs/aws-intake-held.md).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RULES, rulesFor } from './constraints';
import { AWS_NAME_TAG, AWS_NAME_TAG_GENERAL, anchorSchemaPattern } from './rules/aws';
import { AWS_INTAKE_ROWS } from './rules/aws-intake';
import { AWS_MANUAL_RULES } from './rules/aws-manual';
import { checkName } from './validate';

interface SourceRow { typeName: string; kind: 'a' | 'b'; property: string | null; minLength: number | null; maxLength: number | null; pattern: string | null; hasVpcOrSubnet: boolean }
const SNAP = JSON.parse(readFileSync(join(import.meta.dirname, '__fixtures__', 'aws-intake.json'), 'utf-8')) as { rows: SourceRow[] };
const HELD = readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'aws-intake-held.md'), 'utf-8');
/** 손으로 쓴 규칙이 덮는 타입 — 생성기(scripts/rules/build-aws-rules.mjs EXISTING)와 같은 표 */
const EXISTING: Record<string, string> = {
  'AWS::S3::Bucket': 'aws.s3_bucket', 'AWS::IAM::Role': 'aws.iam_role', 'AWS::RDS::DBInstance': 'aws.rds_instance',
  'AWS::EC2::SecurityGroup': 'aws.security_group', 'AWS::EC2::KeyPair': 'aws.key_pair',
  'AWS::EC2::VPC': 'aws.vpc', 'AWS::EC2::Subnet': 'aws.subnet', 'AWS::EC2::Instance': 'aws.ec2_instance',
  'AWS::EC2::InternetGateway': 'aws.internet_gateway', 'AWS::EC2::RouteTable': 'aws.route_table', 'AWS::EC2::Volume': 'aws.ebs_volume',
};

const rules = rulesFor('aws');
const intakeByType = new Map(AWS_INTAKE_ROWS.map((r) => [r.entity.replace(/\.NameTag$/, ''), r]));
/** 손으로 넣은 규칙이 덮는 타입 — entity 가 타입 이름이다 (rules/aws-manual.ts) */
const manualTypes = new Set(Object.values(AWS_MANUAL_RULES).map((r) => r.entity));
const heldTypes = new Set(HELD.split('\n').filter((l) => /^\| AWS::/.test(l)).map((l) => l.split(' | ')[0]!.slice(2)));

describe('들인 AWS 행 — 원문 스냅샷과 대조', () => {
  it('스냅샷 — a 103 · b 99', () => {
    expect(SNAP.rows.filter((r) => r.kind === 'a')).toHaveLength(103);
    expect(SNAP.rows.filter((r) => r.kind === 'b')).toHaveLength(99);
  });

  it('손으로 쓴 규칙이 덮는 타입 11 — 규칙이 실제로 있다', () => {
    for (const [t, id] of Object.entries(EXISTING)) {
      expect(RULES[id], `${t} → ${id}`).toBeDefined();
      expect(SNAP.rows.some((r) => r.typeName === t), t).toBe(true);
    }
  });

  it('원문 행은 전부 손 규칙 · 들인 규칙 · 손으로 넣은 규칙 · 보류 가운데 정확히 하나다', () => {
    const bad: string[] = [];
    for (const s of SNAP.rows) {
      const n = Number(s.typeName in EXISTING) + Number(intakeByType.has(s.typeName)) + Number(manualTypes.has(s.typeName)) + Number(heldTypes.has(s.typeName));
      if (n !== 1) bad.push(`${s.typeName} (${n})`);
    }
    expect(bad).toEqual([]);
  });

  it.each(AWS_INTAKE_ROWS.map((r) => r.id))('%s — 길이 · pattern · 범위가 원문 행과 같다', (id) => {
    const row = AWS_INTAKE_ROWS.find((r) => r.id === id)!;
    const typeName = row.entity.replace(/\.NameTag$/, '');
    const src = SNAP.rows.find((s) => s.typeName === typeName)!;
    const rule = rules.find((r) => r.id === id)!;
    expect(src.kind).toBe(row.kind);
    if (row.kind === 'a') {
      expect(row.property).toBe(src.property);
      expect(row.schemaPattern).toBe(src.pattern);
      expect([rule.minLength, rule.maxLength]).toEqual([src.minLength ?? 1, src.maxLength]);
      // matchPattern — 원문이 지수 백트래킹을 하거나 「[^…]」 꼴이라 보이지 않는 문자를 받을 때만 생성기가 싣는다(좁히는 쪽).
      // 같은 집합 · 좁힘은 build-aws-rules.test.mjs 와 intake-hand.test.ts 가 본다
      if (row.matchPattern === undefined) expect(rule.pattern.source).toBe(anchorSchemaPattern(src.pattern!).source);
      else {
        expect(src.pattern, id).toMatch(/\[\^/);
        expect(rule.pattern.source).toBe(anchorSchemaPattern(row.matchPattern).source);
      }
      expect(rule.uniqueness).toBe('csp');
      expect(rule.scope).toBe(typeName.startsWith('AWS::IAM::') || typeName === 'AWS::S3::MultiRegionAccessPoint' ? 'aws:account' : 'aws:region');
      const [, ns, type] = typeName.split('::').map((x) => x.toLowerCase());
      expect(rule.docUrl).toBe(`https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-${ns}-${type}.html#cfn-${ns}-${type}-${src.property!.toLowerCase()}`);
      expect(rule.notes).toEqual([{ code: 'note.aws_schema_scope_unconfirmed' }]);
    } else {
      expect(rule.uniqueness).toBe('none');
      expect(rule.pattern).toBe(typeName.startsWith('AWS::EC2::') ? AWS_NAME_TAG : AWS_NAME_TAG_GENERAL);
      expect([rule.minLength, rule.maxLength]).toEqual([1, 256]);
      const want = typeName.startsWith('AWS::IAM::') ? 'aws:account' : src.hasVpcOrSubnet ? 'aws:vpc' : 'aws:region';
      expect(rule.scope).toBe(want);
    }
  });

  it('Name 태그 범위 규칙이 손으로 쓴 여섯과 맞는다 — 쓰기 가능한 VpcId · SubnetId 가 있으면 VPC', () => {
    for (const t of ['AWS::EC2::VPC', 'AWS::EC2::Subnet', 'AWS::EC2::Instance', 'AWS::EC2::InternetGateway', 'AWS::EC2::RouteTable', 'AWS::EC2::Volume']) {
      const src = SNAP.rows.find((s) => s.typeName === t)!;
      expect(src.hasVpcOrSubnet ? 'aws:vpc' : 'aws:region', t).toBe(RULES[EXISTING[t]!]!.scope);
    }
  });

  it('`\\Z` 로 끝나는 스키마 pattern 은 끝으로 읽는다 — 글자 Z 를 요구하지 않는다', () => {
    const lg = rules.find((r) => r.entity === 'AWS::Logs::LogGroup')!;
    expect(AWS_INTAKE_ROWS.find((r) => r.id === lg.id)!.kind === 'a' && (AWS_INTAKE_ROWS.find((r) => r.id === lg.id) as { schemaPattern: string }).schemaPattern).toMatch(/\\Z$/);
    expect(checkName('my-log', lg)).toEqual([]);
  });

  it('앵커 없는 스키마 pattern 은 이름 전체로 읽는다 — 부분 일치로 통과시키지 않는다', () => {
    const saml = rules.find((r) => r.entity === 'AWS::IAM::SAMLProvider')!;
    expect(new RegExp((AWS_INTAKE_ROWS.find((r) => r.id === saml.id) as { schemaPattern: string }).schemaPattern).test('my provider!')).toBe(true);
    expect(checkName('my provider!', saml).length).toBeGreaterThan(0);
  });

  it('EC2 밖 Name 태그는 일반 태그 문자만 — # 는 EC2 에서만 된다', () => {
    const ec2 = rules.find((r) => r.entity === 'AWS::EC2::NatGateway.NameTag')!;
    const efs = rules.find((r) => r.entity === 'AWS::EFS::FileSystem.NameTag')!;
    expect(checkName('web #1', ec2)).toEqual([]);
    expect(checkName('web #1', efs).length).toBeGreaterThan(0);
  });

  it('resourceType 은 AWS 안에서 유일하고 40자 이하다', () => {
    const types = rules.map((r) => r.resourceType);
    expect(new Set(types).size).toBe(types.length);
    for (const t of types) expect(t.length, t).toBeLessThanOrEqual(40);
  });
});
