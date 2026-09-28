// CSP 리소스 이름 규칙 표 (D9 · D14 · D18 · D19 · D20)
// 값은 Task 1-2 에서 CSP 공식 문서로 대조했다 — 표는 docs/규칙-대조-20260928.md, 고친 것은 docs/decisions.md.
// pattern · forbidden · 길이 = CSP 물리 규칙(검증), allowed = 우리가 생성할 때 쓰는 문자 집합.
import type { Provider, ResourceRule } from './types';
import { lookup } from './dict';

const AZURE_RULES = 'https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules';
const AWS_TAGS = 'https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Using_Tags.html#tag-restrictions';
const AKS_FAQ = 'https://learn.microsoft.com/en-us/troubleshoot/azure/azure-kubernetes/create-upgrade-delete/aks-common-issues-faq#what-naming-restrictions-are-enforced-for-aks-resources-and-parameters-';

/** RFC 1035 라벨 — GCP compute_instance · vpc_network · subnet */
const RFC1035 = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/;
/** AWS Name 태그 값 — 아무 문자 1~256 (UTF-16 길이) */
const AWS_NAME_TAG = /^[\s\S]{1,256}$/;
const AWS_NAME_TAG_NOTE = '태그 값 — UTF-16 길이로 잰다 (D20)';
const AZURE_VM_NOTE = '호스트명 규칙 · ARM 이 허용하는 다른 기호는 거부될 수 있다 (D20)';

export const RULES: Record<string, ResourceRule> = {
  // ─── GCP ───────────────────────────────────────────────
  'gcp.project_id': {
    id: 'gcp.project_id', provider: 'gcp', resourceType: 'project_id',
    displayName: 'Project ID', slug: '', minLength: 6, maxLength: 30,
    pattern: /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'lower',
    startsWithLetter: true, endsWithAlnum: true,
    forbidden: { contains: ['google', 'ssl'] },
    template: ['owner', 'system', 'purpose', 'env'], optional: ['owner'],
    scope: 'global', docUrl: 'https://docs.cloud.google.com/resource-manager/docs/creating-managing-projects#identifiers',
    // undefined · null 은 문서가 "Avoid"(권고)라 적었다 — 금지가 아니므로 넣지 않는다
  },
  'gcp.service_account': {
    id: 'gcp.service_account', provider: 'gcp', resourceType: 'service_account',
    displayName: 'Service Account', slug: 'sa', minLength: 6, maxLength: 30,
    pattern: /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'lower',
    startsWithLetter: true, endsWithAlnum: true,
    template: ['owner', 'system', 'purpose', 'env', 'region', 'slug', 'role'], optional: ['region', 'owner'],
    scope: 'project', docUrl: 'https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/create',
  },
  'gcp.compute_instance': {
    id: 'gcp.compute_instance', provider: 'gcp', resourceType: 'compute_instance',
    displayName: 'Compute Engine Instance', slug: 'vm', minLength: 1, maxLength: 63,
    pattern: RFC1035, allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'lower',
    startsWithLetter: true, endsWithAlnum: true,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'zone', docUrl: 'https://docs.cloud.google.com/compute/docs/naming-resources',
  },
  'gcp.vpc_network': {
    id: 'gcp.vpc_network', provider: 'gcp', resourceType: 'vpc_network',
    displayName: 'VPC Network', slug: 'vpc', minLength: 1, maxLength: 63,
    pattern: RFC1035, allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'lower',
    startsWithLetter: true, endsWithAlnum: true,
    template: ['system', 'purpose', 'env', 'slug', 'seq'], optional: [],
    scope: 'project', docUrl: 'https://docs.cloud.google.com/compute/docs/reference/rest/v1/networks#Network.FIELDS.name',
  },
  'gcp.subnet': {
    id: 'gcp.subnet', provider: 'gcp', resourceType: 'subnet',
    displayName: 'Subnet', slug: 'subnet', minLength: 1, maxLength: 63,
    pattern: RFC1035, allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'lower',
    startsWithLetter: true, endsWithAlnum: true,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'region', docUrl: 'https://docs.cloud.google.com/compute/docs/reference/rest/v1/subnetworks#Subnetwork.FIELDS.name',
  },
  'gcp.cloud_sql_instance': {
    id: 'gcp.cloud_sql_instance', provider: 'gcp', resourceType: 'cloud_sql_instance',
    displayName: 'Cloud SQL Instance', slug: 'db', minLength: 1, maxLength: 67,
    pattern: /^[a-z]([a-z0-9-]*[a-z0-9])?$/, allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'lower',
    startsWithLetter: true, endsWithAlnum: true,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'project', docUrl: 'https://docs.cloud.google.com/sql/docs/mysql/instance-settings',
    note: 'project-id:instance-id 합이 98자 — 최장 project ID 30 을 뺀 보수적 상한 · 끝 영숫자 요구는 문서 근거 없는 보수적 한도 (D20)',
  },
  'gcp.storage_bucket': {
    id: 'gcp.storage_bucket', provider: 'gcp', resourceType: 'storage_bucket',
    displayName: 'Cloud Storage Bucket', slug: 'bucket', minLength: 3, maxLength: 63,
    pattern: /^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/, allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'lower',
    startsWithLetter: false, endsWithAlnum: true,
    forbidden: { prefixes: ['goog'], contains: ['google', 'g00gle', '..'], ipv4: true },
    template: ['owner', 'system', 'purpose', 'env', 'slug'], optional: ['owner'],
    scope: 'global', docUrl: 'https://docs.cloud.google.com/storage/docs/buckets#naming',
    note: '점이 있으면 222자까지 허용되나 엔진은 점을 만들지 않으므로 63 으로 둔다 (보수적 · D20)',
  },

  // ─── AWS ───────────────────────────────────────────────
  'aws.s3_bucket': {
    id: 'aws.s3_bucket', provider: 'aws', resourceType: 's3_bucket',
    displayName: 'S3 Bucket', slug: 'bucket', minLength: 3, maxLength: 63,
    pattern: /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'lower',
    startsWithLetter: false, endsWithAlnum: true,
    forbidden: { prefixes: ['xn--', 'sthree-', 'amzn-s3-demo-'], suffixes: ['-s3alias', '--ol-s3', '.mrap', '--x-s3', '--table-s3', '-an'], contains: ['..'], ipv4: true },
    template: ['owner', 'system', 'purpose', 'env', 'slug'], optional: ['owner'],
    scope: 'global', docUrl: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html',
    note: '-an 접미사는 계정 지역 네임스페이스 버킷 전용 — 일반 이름에는 쓸 수 없다',
  },
  'aws.iam_role': {
    id: 'aws.iam_role', provider: 'aws', resourceType: 'iam_role',
    displayName: 'IAM Role', slug: 'role', minLength: 1, maxLength: 64,
    pattern: /^[\w+=,.@-]{1,64}$/, allowed: 'alnum-hyphen-underscore', separator: '-', caseRule: 'any',
    startsWithLetter: false, endsWithAlnum: false,
    template: ['system', 'purpose', 'env', 'slug', 'role'], optional: [],
    scope: 'account', docUrl: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_iam-quotas.html',
  },
  'aws.vpc': {
    id: 'aws.vpc', provider: 'aws', resourceType: 'vpc',
    displayName: 'VPC (Name 태그)', slug: 'vpc', minLength: 1, maxLength: 256,
    pattern: AWS_NAME_TAG, allowed: 'alnum-hyphen', separator: '-', caseRule: 'any',
    startsWithLetter: false, endsWithAlnum: false,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'region', docUrl: AWS_TAGS, note: AWS_NAME_TAG_NOTE,
  },
  'aws.subnet': {
    id: 'aws.subnet', provider: 'aws', resourceType: 'subnet',
    displayName: 'Subnet (Name 태그)', slug: 'subnet', minLength: 1, maxLength: 256,
    pattern: AWS_NAME_TAG, allowed: 'alnum-hyphen', separator: '-', caseRule: 'any',
    startsWithLetter: false, endsWithAlnum: false,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'zone', docUrl: AWS_TAGS, note: AWS_NAME_TAG_NOTE,
  },
  'aws.ec2_instance': {
    id: 'aws.ec2_instance', provider: 'aws', resourceType: 'ec2_instance',
    displayName: 'EC2 Instance (Name 태그)', slug: 'vm', minLength: 1, maxLength: 256,
    pattern: AWS_NAME_TAG, allowed: 'alnum-hyphen', separator: '-', caseRule: 'any',
    startsWithLetter: false, endsWithAlnum: false,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'zone', docUrl: AWS_TAGS, note: AWS_NAME_TAG_NOTE,
  },
  'aws.rds_instance': {
    id: 'aws.rds_instance', provider: 'aws', resourceType: 'rds_instance',
    displayName: 'RDS DB Instance', slug: 'db', minLength: 1, maxLength: 63,
    // API 는 대문자를 받아 소문자로 저장한다 — 검증은 대소문자를 허용한다
    pattern: /^[a-zA-Z]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/, noConsecutiveSeparator: true,
    allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'any',
    startsWithLetter: true, endsWithAlnum: true,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'region', docUrl: 'https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_CreateDBInstance.html',
  },

  // ─── Azure ─────────────────────────────────────────────
  'azure.resource_group': {
    id: 'azure.resource_group', provider: 'azure', resourceType: 'resource_group',
    displayName: 'Resource Group', slug: 'rg', minLength: 1, maxLength: 90,
    // 끝 점 불가를 pattern 이 표현한다 · 숫자는 DecimalDigitNumber(Nd)만 — 문서가 UnicodeCategory 로 한정한다
    // 보조 평면(U+10000 이상)은 앞보기로 거부한다 — .NET Char.IsLetterOrDigit(char) 는 서로게이트 쌍을 글자로 보지 않는다 (보수적 · D20)
    pattern: /^(?!.*[\u{10000}-\u{10FFFF}])[\p{L}\p{Nd}_().-]*[\p{L}\p{Nd}_()-]$/u, allowed: 'alnum-hyphen-underscore-period-paren', separator: '-', caseRule: 'any',
    startsWithLetter: false, endsWithAlnum: false,
    template: ['slug', 'system', 'purpose', 'env'], optional: [],
    scope: 'subscription', docUrl: `${AZURE_RULES}#microsoftresources`,
  },
  'azure.storage_account': {
    id: 'azure.storage_account', provider: 'azure', resourceType: 'storage_account',
    displayName: 'Storage Account', slug: 'st', minLength: 3, maxLength: 24,
    pattern: /^[a-z0-9]{3,24}$/, allowed: 'lower-digit', separator: '', caseRule: 'lower',
    startsWithLetter: false, endsWithAlnum: true,
    template: ['slug', 'system', 'purpose', 'env'], optional: [],
    scope: 'global', docUrl: `${AZURE_RULES}#microsoftstorage`,
  },
  'azure.key_vault': {
    id: 'azure.key_vault', provider: 'azure', resourceType: 'key_vault',
    displayName: 'Key Vault', slug: 'kv', minLength: 3, maxLength: 24,
    pattern: /^[a-zA-Z][a-zA-Z0-9-]{1,22}[a-zA-Z0-9]$/, noConsecutiveSeparator: true,
    allowed: 'alnum-hyphen', separator: '-', caseRule: 'any',
    startsWithLetter: true, endsWithAlnum: true,
    template: ['slug', 'system', 'purpose', 'env'], optional: [],
    scope: 'global', docUrl: `${AZURE_RULES}#microsoftkeyvault`,
  },
  'azure.managed_identity': {
    id: 'azure.managed_identity', provider: 'azure', resourceType: 'managed_identity',
    displayName: 'User-Assigned Managed Identity', slug: 'id', minLength: 3, maxLength: 128,
    pattern: /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,127}$/, allowed: 'alnum-hyphen-underscore', separator: '-', caseRule: 'any',
    startsWithLetter: false, endsWithAlnum: false,
    template: ['system', 'purpose', 'env', 'slug', 'role'], optional: [],
    scope: 'resource_group', docUrl: `${AZURE_RULES}#microsoftmanagedidentity`,
  },
  'azure.virtual_machine': {
    id: 'azure.virtual_machine', provider: 'azure', resourceType: 'virtual_machine',
    displayName: 'Virtual Machine (Linux)', slug: 'vm', minLength: 1, maxLength: 64,
    // 문서가 모순(금지 문자에 `.` · Linux 는 「끝에만」 점 불가)이라 점을 전부 거부한다 (보수적 · D20)
    pattern: /^[A-Za-z0-9]([A-Za-z0-9-]{0,62}[A-Za-z0-9])?$/, allowed: 'alnum-hyphen', separator: '-', caseRule: 'any',
    startsWithLetter: false, endsWithAlnum: true,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'resource_group', docUrl: `${AZURE_RULES}#microsoftcompute`, note: AZURE_VM_NOTE,
  },
  'azure.virtual_machine_windows': {
    id: 'azure.virtual_machine_windows', provider: 'azure', resourceType: 'virtual_machine_windows',
    displayName: 'Virtual Machine (Windows)', slug: 'vm', minLength: 1, maxLength: 15,
    // Windows 호스트명은 점 불가
    pattern: /^[A-Za-z0-9]([A-Za-z0-9-]{0,13}[A-Za-z0-9])?$/, allowed: 'alnum-hyphen', separator: '-', caseRule: 'any',
    startsWithLetter: false, endsWithAlnum: true,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'resource_group', docUrl: `${AZURE_RULES}#microsoftcompute`, note: AZURE_VM_NOTE,
  },
  'azure.virtual_network': {
    id: 'azure.virtual_network', provider: 'azure', resourceType: 'virtual_network',
    displayName: 'Virtual Network', slug: 'vnet', minLength: 2, maxLength: 64,
    pattern: /^[a-zA-Z0-9][\w.-]{0,62}[a-zA-Z0-9_]$/, allowed: 'alnum-hyphen-underscore', separator: '-', caseRule: 'any',
    startsWithLetter: false, endsWithAlnum: false,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'resource_group', docUrl: `${AZURE_RULES}#microsoftnetwork`,
  },
  'azure.subnet': {
    id: 'azure.subnet', provider: 'azure', resourceType: 'subnet',
    displayName: 'Subnet', slug: 'snet', minLength: 1, maxLength: 80,
    pattern: /^[a-zA-Z0-9]([\w.-]{0,78}[a-zA-Z0-9_])?$/, allowed: 'alnum-hyphen-underscore', separator: '-', caseRule: 'any',
    startsWithLetter: false, endsWithAlnum: false,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'resource_group', docUrl: `${AZURE_RULES}#microsoftnetwork`,
  },
  'azure.sql_server': {
    id: 'azure.sql_server', provider: 'azure', resourceType: 'sql_server',
    displayName: 'SQL Server', slug: 'sql', minLength: 1, maxLength: 63,
    pattern: /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/, allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'lower',
    startsWithLetter: false, endsWithAlnum: true,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'global', docUrl: `${AZURE_RULES}#microsoftsql`,
  },
  'azure.aks_nodepool_linux': {
    id: 'azure.aks_nodepool_linux', provider: 'azure', resourceType: 'aks_nodepool_linux',
    displayName: 'AKS Node Pool (Linux)', slug: 'np', minLength: 1, maxLength: 12,
    pattern: /^[a-z][a-z0-9]{0,11}$/, allowed: 'lower-digit', separator: '', caseRule: 'lower',
    startsWithLetter: true, endsWithAlnum: true,
    forbidden: { exact: ['aksmanagedap'] }, // FAQ: AKS 시스템 구성요소 예약 이름
    template: ['slug', 'purpose', 'env'], optional: [],
    scope: 'resource_group', docUrl: AKS_FAQ,
  },
  'azure.aks_nodepool_windows': {
    id: 'azure.aks_nodepool_windows', provider: 'azure', resourceType: 'aks_nodepool_windows',
    displayName: 'AKS Node Pool (Windows)', slug: 'np', minLength: 1, maxLength: 6,
    pattern: /^[a-z][a-z0-9]{0,5}$/, allowed: 'lower-digit', separator: '', caseRule: 'lower',
    startsWithLetter: true, endsWithAlnum: true,
    template: ['slug', 'purpose'], optional: [],
    scope: 'resource_group', docUrl: AKS_FAQ,
  },
};

/** 태그 · 라벨의 키 · 값 길이 한도 (Task 1-2 에서 문서로 대조했다)
 *  Azure 스토리지 계정만 키 128 — 엔진의 태그 키는 고정 다섯(11자 이하)이라 적용하지 않는다 (docs/decisions.md) */
const LABEL_LIMITS_AWS_DOC = 'https://docs.aws.amazon.com/tag-editor/latest/userguide/best-practices-and-strats.html#tag-conventions';

export const LABEL_LIMITS: Record<Provider, { key: number; value: number; docUrl: string }> = {
  aws: { key: 128, value: 256, docUrl: LABEL_LIMITS_AWS_DOC },
  azure: { key: 512, value: 256, docUrl: 'https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/tag-resources#limitations' },
  gcp: { key: 63, value: 63, docUrl: 'https://docs.cloud.google.com/resource-manager/docs/labels-overview#requirements' },
};

/** AWS 태그 값에 쓸 수 있는 문자 — 문서: "letters, numbers, spaces representable in UTF-8, and the following characters: _ . : / = + - @".
 *  AWS API 가 공개하는 TagValue 패턴(`^([\p{L}\p{Z}\p{N}_.:/=+\-@]*)$`)과 같다. 서비스마다 다를 수 있고(EC2 는 더 넓다) 여기서는 일반 규칙을 따른다 — 무효를 유효로 내지 않는 쪽 (docs/decisions.md 2026-09-29)
 *  docUrl: https://docs.aws.amazon.com/tag-editor/latest/userguide/best-practices-and-strats.html#tag-conventions (LABEL_LIMITS.aws.docUrl 과 같은 쪽) */
export const AWS_TAG_VALUE = /^[\p{L}\p{Z}\p{N}_.:/=+\-@]*$/u;
export const AWS_TAG_VALUE_DOC_URL = LABEL_LIMITS_AWS_DOC;

export function rulesFor(provider: Provider): ResourceRule[] {
  return Object.values(RULES).filter((r) => r.provider === provider);
}

export function getRule(provider: Provider, resourceType: string): ResourceRule | undefined {
  return lookup(RULES, `${provider}.${resourceType}`);
}
