// AWS 규칙 표 — constraints.ts 가 gcp · azure 와 합쳐 RULES 로 낸다 (파일을 나눠도 이름 · 판정 불변)
import type { ResourceRule, Token } from '../types';
import type { CoreMessage } from '../messages';
import { NO_INVISIBLE } from '../invisible.mjs';
import { AWS_INTAKE_ROWS } from './aws-intake';
import { AWS_MANUAL_RULES } from './aws-manual';
import { AWS_CATALOG } from './aws-catalog';
import { withTier } from '../compose';

const AWS_TAGS = 'https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Using_Tags.html#tag-restrictions';
/** AWS Name 태그 값 — 아무 문자 1~256 (UTF-16 길이) */
export const AWS_NAME_TAG = /^[\s\S]{1,256}$/;
const AWS_NAME_TAG_NOTE: CoreMessage = { code: 'note.aws_tag_utf16_length' };

const AWS_HAND_RULES: Record<string, ResourceRule> = {
  'aws.s3_bucket': {
    id: 'aws.s3_bucket', provider: 'aws', resourceType: 's3_bucket',
    displayName: 'S3 Bucket', slug: 'bucket', minLength: 3, maxLength: 63,
    pattern: /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'lower',
    startsWithLetter: false, endsWithAlnum: true,
    forbidden: { prefixes: ['xn--', 'sthree-', 'amzn-s3-demo-'], suffixes: ['-s3alias', '--ol-s3', '.mrap', '--x-s3', '--table-s3', '-an'], contains: ['..'], ipv4: true },
    template: ['owner', 'system', 'purpose', 'env', 'slug'], optional: ['owner'],
    scope: 'aws:partition', entity: 's3.bucket', category: 'storage', uniqueness: 'csp',
    docUrl: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html',
    notes: [{ code: 'note.s3_an_suffix' }],
  },
  'aws.iam_role': {
    id: 'aws.iam_role', provider: 'aws', resourceType: 'iam_role',
    displayName: 'IAM Role', slug: 'role', minLength: 1, maxLength: 64,
    pattern: /^[\w+=,.@-]{1,64}$/, allowed: 'alnum-hyphen-underscore', separator: '-', caseRule: 'any',
    startsWithLetter: false, endsWithAlnum: false,
    template: ['system', 'purpose', 'env', 'slug', 'role'], optional: [],
    scope: 'aws:account', entity: 'iam.role', category: 'identity', uniqueness: 'csp', uniquenessDocUrl: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html',
    docUrl: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_iam-quotas.html',
  },
  'aws.vpc': {
    id: 'aws.vpc', provider: 'aws', resourceType: 'vpc',
    displayName: 'VPC (Name tag)', slug: 'vpc', minLength: 1, maxLength: 256,
    pattern: AWS_NAME_TAG, allowed: 'alnum-hyphen', separator: '-', caseRule: 'any',
    startsWithLetter: false, endsWithAlnum: false,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'aws:region', entity: 'ec2.vpc.NameTag', category: 'networking', uniqueness: 'none',
    docUrl: AWS_TAGS, notes: [AWS_NAME_TAG_NOTE],
  },
  'aws.subnet': {
    id: 'aws.subnet', provider: 'aws', resourceType: 'subnet',
    displayName: 'Subnet (Name tag)', slug: 'subnet', minLength: 1, maxLength: 256,
    pattern: AWS_NAME_TAG, allowed: 'alnum-hyphen', separator: '-', caseRule: 'any',
    startsWithLetter: false, endsWithAlnum: false,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'aws:vpc', entity: 'ec2.subnet.NameTag', category: 'networking', uniqueness: 'none',
    docUrl: AWS_TAGS, notes: [AWS_NAME_TAG_NOTE],
  },
  'aws.ec2_instance': {
    id: 'aws.ec2_instance', provider: 'aws', resourceType: 'ec2_instance',
    displayName: 'EC2 Instance (Name tag)', slug: 'vm', minLength: 1, maxLength: 256,
    pattern: AWS_NAME_TAG, allowed: 'alnum-hyphen', separator: '-', caseRule: 'any',
    startsWithLetter: false, endsWithAlnum: false,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'aws:vpc', entity: 'ec2.instance.NameTag', category: 'compute', uniqueness: 'none',
    docUrl: AWS_TAGS, notes: [AWS_NAME_TAG_NOTE],
  },
  'aws.rds_instance': {
    id: 'aws.rds_instance', provider: 'aws', resourceType: 'rds_instance',
    displayName: 'RDS DB Instance', slug: 'db', minLength: 1, maxLength: 63,
    // API 는 대문자를 받아 소문자로 저장한다 — 검증은 대소문자를 허용한다
    pattern: /^[a-zA-Z]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/, noConsecutiveSeparator: true,
    allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'any',
    startsWithLetter: true, endsWithAlnum: true,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'aws:region', entity: 'rds.dbInstance', category: 'database', uniqueness: 'csp', uniquenessDocUrl: 'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Limits.html',
    docUrl: 'https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_CreateDBInstance.html',
  },
  // 2026-10-06 추가 11종 — Name 태그 셋은 aws.vpc 와 같은 규칙에 slug 만 다르다
  'aws.internet_gateway': {
    id: 'aws.internet_gateway', provider: 'aws', resourceType: 'internet_gateway',
    displayName: 'Internet Gateway (Name tag)', slug: 'igw', minLength: 1, maxLength: 256,
    pattern: AWS_NAME_TAG, allowed: 'alnum-hyphen', separator: '-', caseRule: 'any',
    startsWithLetter: false, endsWithAlnum: false,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'aws:region', entity: 'ec2.internetGateway.NameTag', category: 'networking', uniqueness: 'none',
    docUrl: AWS_TAGS, notes: [AWS_NAME_TAG_NOTE],
  },
  'aws.route_table': {
    id: 'aws.route_table', provider: 'aws', resourceType: 'route_table',
    displayName: 'Route Table (Name tag)', slug: 'rt', minLength: 1, maxLength: 256,
    pattern: AWS_NAME_TAG, allowed: 'alnum-hyphen', separator: '-', caseRule: 'any',
    startsWithLetter: false, endsWithAlnum: false,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'aws:vpc', entity: 'ec2.routeTable.NameTag', category: 'networking', uniqueness: 'none',
    docUrl: AWS_TAGS, notes: [AWS_NAME_TAG_NOTE],
  },
  'aws.security_group': {
    id: 'aws.security_group', provider: 'aws', resourceType: 'security_group',
    displayName: 'Security Group', slug: 'sg', minLength: 1, maxLength: 255,
    // GroupName — "Names are case-insensitive and must be unique within the VPC." · "Up to 255 characters in length. Can't start with sg-."
    // "Valid characters: a-z, A-Z, 0-9, spaces, and ._-:/()#,@[]+=&;{}!$*" (쪽의 HTML 을 글자 단위로 대어 봤다)
    pattern: /^[A-Za-z0-9 ._\-:/()#,@[\]+=&;{}!$*]{1,255}$/, allowed: 'alnum-hyphen', separator: '-', caseRule: 'any',
    startsWithLetter: false, endsWithAlnum: false,
    // 이름이 대소문자를 가리지 않으므로 SG- 도 sg- 로 보고 거부한다 (보수적 · D20)
    forbidden: { prefixes: ['sg-'], ignoreCase: true },
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'aws:vpc', entity: 'ec2.securityGroup', category: 'networking', uniqueness: 'csp',
    docUrl: 'https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateSecurityGroup.html',
  },
  'aws.key_pair': {
    id: 'aws.key_pair', provider: 'aws', resourceType: 'key_pair',
    displayName: 'EC2 Key Pair', slug: 'key', minLength: 1, maxLength: 255,
    // KeyName — "A unique name for the key pair." · "Up to 255 ASCII characters". 제어 문자는 받지 않는다 — 인쇄 가능한 ASCII 만 (보수적 · D20)
    pattern: /^[\x20-\x7E]{1,255}$/, allowed: 'alnum-hyphen', separator: '-', caseRule: 'any',
    startsWithLetter: false, endsWithAlnum: false,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    // 유일 범위를 적은 문장이 없다 — 리전에 두되 note 로 미확인임을 싣는다
    scope: 'aws:region', entity: 'ec2.keyPair', category: 'compute', uniqueness: 'csp',
    docUrl: 'https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateKeyPair.html',
    notes: [{ code: 'note.aws_key_pair_scope_unconfirmed' }],
  },
  'aws.ebs_volume': {
    id: 'aws.ebs_volume', provider: 'aws', resourceType: 'ebs_volume',
    displayName: 'EBS Volume (Name tag)', slug: 'vol', minLength: 1, maxLength: 256,
    pattern: AWS_NAME_TAG, allowed: 'alnum-hyphen', separator: '-', caseRule: 'any',
    startsWithLetter: false, endsWithAlnum: false,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'aws:region', entity: 'ec2.volume.NameTag', category: 'storage', uniqueness: 'none',
    docUrl: AWS_TAGS, notes: [AWS_NAME_TAG_NOTE],
  },
};

// ─── 들인 행 (D43) — rules/aws-intake.ts 의 행을 규칙으로 편다 ──────────────
/** 일반 태그 값 문자(LABEL_LIMITS 의 #tag-conventions — AWS_TAG_VALUE 와 같은 문자)에 Name 태그 길이 1~256.
 *  EC2 밖 서비스(S3 · IAM · RDS …)는 EC2 보다 좁게 받는다 — 무효를 유효로 내지 않는 쪽 (docs/decisions.md 2026-09-29) */
export const AWS_NAME_TAG_GENERAL = new RegExp(String.raw`${NO_INVISIBLE}^[\p{L}\p{Z}\p{N}_.:/=+\-@]{1,256}$`, 'u');
const AWS_TAG_CONVENTIONS = 'https://docs.aws.amazon.com/tag-editor/latest/userguide/best-practices-and-strats.html#tag-conventions';
const AWS_SCHEMA_NOTE: CoreMessage = { code: 'note.aws_schema_scope_unconfirmed' };
const PLACED_TEMPLATE: Token[] = ['system', 'purpose', 'env', 'region', 'slug', 'seq'];
/** 계정 범위(IAM · Multi-Region Access Point)는 지역이 없다 */
const ACCOUNT_TEMPLATE: Token[] = ['system', 'purpose', 'env', 'slug', 'seq'];

/** 스키마 pattern 은 앵커가 없을 수 있다(JSON Schema 는 부분 일치) — 이름 전체로 읽는다(좁히는 쪽 · D20). `\Z` 는 끝으로 읽는다 */
export const anchorSchemaPattern = (raw: string): RegExp => new RegExp(`^(?:${raw.replace(/\\Z$/, '$')})$`, raw.includes('\\p{') ? 'u' : '');

function fromIntakeRow(r: (typeof AWS_INTAKE_ROWS)[number]): ResourceRule {
  const template = r.scope === 'aws:account' ? ACCOUNT_TEMPLATE : PLACED_TEMPLATE;
  const base = {
    id: r.id, provider: 'aws' as const, resourceType: r.id.slice('aws.'.length), displayName: r.displayName, slug: r.slug,
    template, optional: template.includes('region') ? (['region'] as Token[]) : [],
    scope: r.scope, entity: r.entity, category: r.category,
  };
  if (r.kind === 'b') {
    const ec2 = r.tag === 'ec2';
    return {
      ...base, minLength: 1, maxLength: 256, pattern: ec2 ? AWS_NAME_TAG : AWS_NAME_TAG_GENERAL,
      allowed: 'alnum-hyphen', separator: '-', caseRule: 'any', startsWithLetter: false, endsWithAlnum: false,
      uniqueness: 'none', docUrl: ec2 ? AWS_TAGS : AWS_TAG_CONVENTIONS, notes: [AWS_NAME_TAG_NOTE],
    };
  }
  return {
    ...base, minLength: r.min, maxLength: r.max, pattern: anchorSchemaPattern(r.matchPattern ?? r.schemaPattern),
    ...(r.noConsecutiveSeparator ? { noConsecutiveSeparator: true } : {}),
    allowed: r.allowed, separator: r.separator, caseRule: r.caseRule, startsWithLetter: r.startsWithLetter, endsWithAlnum: r.endsWithAlnum,
    uniqueness: 'csp', docUrl: r.docUrl, notes: [AWS_SCHEMA_NOTE],
  };
}

/** 규칙 id → catalog 행의 약어 — 약어의 정본은 catalog 다(rules/gcp.ts 의 applyCatalog 와 같다). 위 표 · aws-intake.ts 의 slug 는 옛 값이다 */
const SLUG_BY_RULE: ReadonlyMap<string, string> = new Map(AWS_CATALOG.flatMap((row) => Object.keys(row.rules).map((id) => [id, row.slug.value] as const)));

function slugFromCatalog(id: string): string {
  const slug = SLUG_BY_RULE.get(id);
  if (slug === undefined) throw new Error(`AWS rule not in catalog: ${id}`);
  return slug;
}

/** 손으로 쓴 규칙 다음에 들인 행 — 생성기 순서(타입 이름 순).
 *  count 규칙 템플릿에는 seq 바로 앞에 용도 토큰 자리를 둔다 (D60) — 꺼진 CSP 라도 템플릿 꼴을 맞춘다. 빈 토큰이라 이름은 그대로다 */
export const AWS_RULES: Record<string, ResourceRule> = Object.fromEntries(Object.entries({
  ...AWS_HAND_RULES,
  ...Object.fromEntries(AWS_INTAKE_ROWS.map((r) => [r.id, fromIntakeRow(r)])),
  ...AWS_MANUAL_RULES,
}).map(([id, r]) => [id, { ...r, slug: slugFromCatalog(id), template: withTier(r.template) }]));
