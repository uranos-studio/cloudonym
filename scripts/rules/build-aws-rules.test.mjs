// build-aws-rules.mjs 시험 — 보류 판정 · 생성 설정 · 범위 · 이름 · 판정 표.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { physicalHold, generationOf, anchorPattern, scopeOf, placedInVpc, resourceTypeOf, slugOf, build, PHYSICAL_CASES, EXISTING, MANUAL, HAND_REVIEWED } from './build-aws-rules.mjs';

const targets = JSON.parse(readFileSync(new URL('./aws-intake-targets.json', import.meta.url), 'utf-8'));

test('판정 표 — 298 타입 · a 103 · b 99 · c 93 · d 3 · a 는 이름 속성을 적는다', () => {
  const kinds = Object.values(targets.types).map((t) => t.kind);
  assert.equal(kinds.length, 298);
  assert.deepEqual(['a', 'b', 'c', 'd'].map((k) => kinds.filter((x) => x === k).length), [103, 99, 93, 3]);
  for (const [t, v] of Object.entries(targets.types)) if (v.kind === 'a') assert.ok(v.property, t);
});

test('a 보류 — pattern · maxLength 둘 다 있어야 정형 · ARN · 0-z · 고정 접두는 보류', () => {
  assert.match(physicalHold({}), /no pattern and no maxLength/);
  assert.match(physicalHold({ maxLength: 255 }), /no pattern/);
  assert.match(physicalHold({ pattern: '^[a-z]+$' }), /no maxLength/);
  assert.match(physicalHold({ maxLength: 140, pattern: '^(arn:aws:lambda:x)|[a-z]+$' }), /ARN/);
  assert.match(physicalHold({ maxLength: 64, pattern: '[0-z]*' }), /0-z/);
  assert.match(physicalHold({ maxLength: 256, pattern: '^(alias/)[a-zA-Z0-9:/_-]+$' }), /no plain name/);
  assert.equal(physicalHold({ maxLength: 512, pattern: '^[.\\-_/#A-Za-z0-9]{1,512}\\Z' }), null);
});

test('pattern 은 이름 전체로 읽는다 · \\Z 는 끝', () => {
  const re = new RegExp(anchorPattern('[\\w._-]+'));
  assert.equal(re.test('my provider!'), false);
  assert.equal(new RegExp('[\\w._-]+').test('my provider!'), true); // 부분 일치면 통과해 버린다
  assert.equal(new RegExp(anchorPattern('^[a-z]{1,5}\\Z')).test('abc'), true);
});

test('생성 설정 — pattern 에 이름을 대어 본다', () => {
  assert.deepEqual(generationOf('^[a-z][a-z0-9]*(-[a-z0-9]+)*$'), { allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'lower', startsWithLetter: true, endsWithAlnum: true, noConsecutiveSeparator: true });
  assert.equal(generationOf('[\\w._-]+').allowed, 'alnum-hyphen-underscore');
  assert.equal(generationOf('^[a-zA-Z0-9]+$').separator, '');
});

test('범위 — IAM · MRAP 는 계정 · Name 태그는 쓰기 가능한 VpcId · SubnetId 가 있으면 VPC', () => {
  assert.equal(scopeOf('a', 'AWS::IAM::SAMLProvider', {}), 'aws:account');
  assert.equal(scopeOf('a', 'AWS::S3::MultiRegionAccessPoint', {}), 'aws:account');
  assert.equal(scopeOf('a', 'AWS::Logs::LogGroup', {}), 'aws:region');
  assert.equal(scopeOf('b', 'AWS::EC2::NatGateway', { properties: { SubnetId: {} } }), 'aws:vpc');
  // VPC 자신의 VpcId 는 출력 값이다
  assert.equal(placedInVpc({ properties: { VpcId: {} }, readOnlyProperties: ['/properties/VpcId'] }), false);
  assert.equal(scopeOf('b', 'AWS::EC2::VPC', { properties: { VpcId: {} }, readOnlyProperties: ['/properties/VpcId'] }), 'aws:region');
});

test('이름 — 40자 이하로 줄이고 · 겹치면 다음 후보 · 약어 규칙', () => {
  const t = resourceTypeOf('EC2', 'LocalGatewayRouteTableVirtualInterfaceGroupAssociation', new Set());
  assert.ok(t.length <= 40, t);
  assert.equal(resourceTypeOf('ElasticLoadBalancingV2', 'Listener', new Set()), 'elbv2_listener');
  assert.equal(resourceTypeOf('EC2', 'NatGateway', new Set(['ec2_nat_gateway'])), 'ec2_nat_gw', '겹치면 낱말 약어');
  assert.equal(resourceTypeOf('EC2', 'NatGateway', new Set(['ec2_nat_gateway', 'ec2_nat_gw'])), 'ec2_ng', '그것도 겹치면 머리글자');
  assert.equal(resourceTypeOf('EC2', 'IPv4Pool', new Set()), 'ec2_ipv4_pool');
  assert.equal(resourceTypeOf('EC2', 'Ab', new Set(['ec2_ab'])), null, '머리글자가 한 글자 토막이면 고르지 않는다');
  assert.equal(slugOf('NatGateway'), 'ng');
  assert.equal(slugOf('Key'), 'key');
});

test('build — 손 규칙 타입은 건너뛰고 · 손 예 없는 a 행은 멈춘다', () => {
  const schemas = new Map([
    ['AWS::EC2::VPC', { typeName: 'AWS::EC2::VPC', properties: { VpcId: {} }, readOnlyProperties: ['/properties/VpcId'] }],
    ['AWS::EC2::NatGateway', { typeName: 'AWS::EC2::NatGateway', properties: { SubnetId: {}, Tags: {} } }],
    ['AWS::EFS::FileSystem', { typeName: 'AWS::EFS::FileSystem', properties: { FileSystemTags: {} } }],
    ['AWS::Logs::LogGroup', { typeName: 'AWS::Logs::LogGroup', properties: { LogGroupName: { minLength: 1, maxLength: 512, pattern: '^[.\\-_/#A-Za-z0-9]{1,512}\\Z' } } }],
    ['AWS::Logs::Fake', { typeName: 'AWS::Logs::Fake', properties: { Name: { maxLength: 9, pattern: '^[a-z]+$' } } }],
  ]);
  const t = (types) => ({ types });
  const r = build({ schemas, targets: t({ 'AWS::EC2::VPC': { kind: 'b', category: 'networking' }, 'AWS::EC2::NatGateway': { kind: 'b', category: 'networking' }, 'AWS::EFS::FileSystem': { kind: 'b', category: 'storage' }, 'AWS::Logs::LogGroup': { kind: 'a', property: 'LogGroupName', category: 'management' } }), anchors: { 'AWS::Logs::LogGroup': 'https://example.test/x' } });
  assert.deepEqual(r.rules.map((x) => [x.id, x.scope, x.tag ?? x.kind]), [['aws.ec2_nat_gateway', 'aws:vpc', 'ec2'], ['aws.efs_file_system', 'aws:region', 'general'], ['aws.logs_log_group', 'aws:region', 'a']]);
  assert.equal(r.sourceRows.length, 4);
  assert.deepEqual(r.rules[2].cases, PHYSICAL_CASES['AWS::Logs::LogGroup']);
  assert.throws(() => build({ schemas, targets: t({ 'AWS::Logs::Fake': { kind: 'a', property: 'Name', category: 'management' } }), anchors: { 'AWS::Logs::Fake': 'https://example.test/y' } }), /손 예가 없다/);
  const noAnchor = build({ schemas, targets: t({ 'AWS::Logs::LogGroup': { kind: 'a', property: 'LogGroupName', category: 'management' } }), anchors: {} });
  assert.match(noAnchor.held[0].reason, /anchorMissing/);
});

test('손으로 넣은 타입 · 손 확인 사유 — 판정 표의 a 행이고 서로 겹치지 않는다', () => {
  for (const t of [...Object.keys(MANUAL), ...Object.keys(HAND_REVIEWED)]) assert.equal(targets.types[t]?.kind, 'a', t);
  for (const t of Object.keys(MANUAL)) {
    assert.equal(t in EXISTING || t in HAND_REVIEWED, false, t);
    assert.match(MANUAL[t], /^aws\.[a-z0-9_]+$/);
  }
  for (const [t, why] of Object.entries(HAND_REVIEWED)) assert.match(why, /^reviewed by hand — (not imported|unconfirmed|rule found, not added yet) \(.+\)$/, t);
});

test('손으로 넣은 타입은 건너뛰고 · 손 확인 타입은 사유가 바뀐다', () => {
  const schemas = new Map([
    ['AWS::ECS::Cluster', { typeName: 'AWS::ECS::Cluster', properties: { ClusterName: { type: 'string' } } }],
    ['AWS::EKS::Addon', { typeName: 'AWS::EKS::Addon', properties: { AddonName: { type: 'string' } } }],
  ]);
  const t = { types: { 'AWS::ECS::Cluster': targets.types['AWS::ECS::Cluster'], 'AWS::EKS::Addon': targets.types['AWS::EKS::Addon'] } };
  const r = build({ schemas, targets: t, anchors: {} });
  assert.deepEqual(r.rules, []);
  assert.equal(r.sourceRows.find((x) => x.typeName === 'AWS::ECS::Cluster').existing, 'aws.ecs_cluster');
  assert.deepEqual(r.held.map((h) => [h.src.typeName, h.reason]), [['AWS::EKS::Addon', HAND_REVIEWED['AWS::EKS::Addon']]]);
});
