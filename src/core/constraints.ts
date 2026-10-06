// CSP 리소스 이름 규칙 표 (D9 · D14 · D18 · D19 · D20)
// 값은 Task 1-2 에서 CSP 공식 문서로 대조했다 — 표는 docs/규칙-대조-20260928.md, 고친 것은 docs/decisions.md.
// pattern · forbidden · 길이 = CSP 물리 규칙(검증), allowed = 우리가 생성할 때 쓰는 문자 집합.
import type { Forbidden, Provider, ResourceRule } from './types';
import type { CoreMessage } from './messages';
import { lookup } from './dict';

const AZURE_RULES = 'https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules';
const AWS_TAGS = 'https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Using_Tags.html#tag-restrictions';
/** Compute 디스커버리 문서 — insert.path 가 범위(global · regions/{region} · zones/{zone})를 준다 */
const GCP_COMPUTE_DISCOVERY = 'https://www.googleapis.com/discovery/v1/apis/compute/v1/rest';
const AKS_FAQ = 'https://learn.microsoft.com/en-us/troubleshoot/azure/azure-kubernetes/create-upgrade-delete/aks-common-issues-faq#what-naming-restrictions-are-enforced-for-aks-resources-and-parameters-';

/** RFC 1035 라벨 — GCP compute_instance · vpc_network · subnet */
const RFC1035 = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/;
/** AWS Name 태그 값 — 아무 문자 1~256 (UTF-16 길이) */
export const AWS_NAME_TAG = /^[\s\S]{1,256}$/;
const AWS_NAME_TAG_NOTE: CoreMessage = { code: 'note.aws_tag_utf16_length' };
const AZURE_VM_NOTE: CoreMessage = { code: 'note.azure_vm_hostname_rule' };
/** Windows 컴퓨터 이름 규칙 — "computer names that only contain numbers (0-9)" 는 쓸 수 없다 (codex P1).
 *  Azure 이름 규칙 쪽(#microsoftcompute)에는 이 문장이 없어 Windows VM 규칙의 두 번째 근거로 note 에 싣는다 */
export const WINDOWS_COMPUTER_NAME_DOC_URL = 'https://learn.microsoft.com/en-us/windows-hardware/customize/desktop/unattend/microsoft-windows-shell-setup-computername';
/** Azure 예약어 · 상표 — "Resources with an accessible endpoint, such as a fully qualified domain name, can't use reserved words".
 *  ① 목록 38개는 단어로 금지 ② MICROSOFT · WINDOWS 는 부분 문자열로도 금지 ③ LOGIN 은 앞에서만 금지.
 *  「단어」의 정의가 문서에 없어 보수적으로 읽는다 — 앞뒤가 영문 글자가 아니면(숫자 · 기호 · 이름 끝) 단어로 본다.
 *  그래서 azure123 · kv-azure-prd 는 위반, myazurestore 는 통과다. 대소문자는 가리지 않는다 (docs/decisions.md 2026-09-29) */
export const AZURE_RESERVED_DOC_URL = 'https://learn.microsoft.com/en-us/azure/azure-resource-manager/troubleshooting/error-reserved-resource-name';
const AZURE_RESERVED: Forbidden = {
  words: [
    'access', 'app_code', 'app_themes', 'app_data', 'app_globalresources', 'app_localresources', 'app_webreferences', 'app_browsers',
    'azure', 'bing', 'bizspark', 'biztalk', 'cortana', 'directx', 'dotnet', 'dynamics', 'excel', 'exchange', 'forefront', 'groove',
    'hololens', 'hyperv', 'kinect', 'lync', 'msdn', 'o365', 'office', 'office365', 'onedrive', 'onenote', 'outlook', 'powerpoint',
    'sharepoint', 'skype', 'visio', 'visualstudio', 'web.config', 'xbox',
  ],
  contains: ['microsoft', 'windows'],
  prefixes: ['login'],
  ignoreCase: true,
};
const AZURE_RESERVED_NOTE: CoreMessage = { code: 'note.azure_reserved', params: { doc_url: AZURE_RESERVED_DOC_URL } };
/** VM · AKS 노드풀은 리소스 자체에 공개 엔드포인트가 없어 문서가 걸리는지 모호하다 — 보수적으로 건다 (D20) */
const AZURE_RESERVED_AMBIGUOUS_NOTE: CoreMessage = { code: 'note.azure_reserved_ambiguous', params: { doc_url: AZURE_RESERVED_DOC_URL } };
const WINDOWS_NO_ALL_DIGITS_NOTE: CoreMessage = { code: 'note.windows_no_all_digits', params: { doc_url: WINDOWS_COMPUTER_NAME_DOC_URL } };

export const RULES: Record<string, ResourceRule> = {
  // ─── GCP ───────────────────────────────────────────────
  'gcp.project_id': {
    id: 'gcp.project_id', provider: 'gcp', resourceType: 'project_id',
    displayName: 'Project ID', slug: '', minLength: 6, maxLength: 30,
    pattern: /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'lower',
    startsWithLetter: true, endsWithAlnum: true,
    forbidden: { contains: ['google', 'ssl'] },
    template: ['owner', 'system', 'purpose', 'env'], optional: ['owner'],
    scope: 'gcp:namespace', entity: 'cloudresourcemanager.projects', category: 'management', uniqueness: 'csp',
    docUrl: 'https://docs.cloud.google.com/resource-manager/docs/creating-managing-projects#identifiers',
    // undefined · null 은 문서가 "Avoid"(권고)라 적었다 — 금지가 아니므로 넣지 않는다
  },
  'gcp.service_account': {
    id: 'gcp.service_account', provider: 'gcp', resourceType: 'service_account',
    displayName: 'Service Account', slug: 'sa', minLength: 6, maxLength: 30,
    pattern: /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'lower',
    startsWithLetter: true, endsWithAlnum: true,
    template: ['owner', 'system', 'purpose', 'env', 'region', 'slug', 'role'], optional: ['region', 'owner'],
    scope: 'gcp:project', entity: 'iam.serviceAccounts', category: 'identity', uniqueness: 'csp',
    docUrl: 'https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/create',
  },
  'gcp.compute_instance': {
    id: 'gcp.compute_instance', provider: 'gcp', resourceType: 'compute_instance',
    displayName: 'Compute Engine Instance', slug: 'vm', minLength: 1, maxLength: 63,
    pattern: RFC1035, allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'lower',
    startsWithLetter: true, endsWithAlnum: true,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    // 디스커버리 insert.path 는 zones/{zone}/instances 지만 naming-resources 가 「vmDnsSetting 이 ZonalOnly 가 아니면 프로젝트 안 유일」이라 해 프로젝트 범위에 둔다
    scope: 'gcp:project', entity: 'compute.instances', category: 'compute', uniqueness: 'csp',
    docUrl: 'https://docs.cloud.google.com/compute/docs/naming-resources',
    notes: [{ code: 'note.gcp_vm_project_unique' }],
  },
  'gcp.vpc_network': {
    id: 'gcp.vpc_network', provider: 'gcp', resourceType: 'vpc_network',
    displayName: 'VPC Network', slug: 'vpc', minLength: 1, maxLength: 63,
    pattern: RFC1035, allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'lower',
    startsWithLetter: true, endsWithAlnum: true,
    template: ['system', 'purpose', 'env', 'slug', 'seq'], optional: [],
    scope: 'gcp:project_global', entity: 'compute.networks', category: 'networking', uniqueness: 'csp', uniquenessDocUrl: GCP_COMPUTE_DISCOVERY,
    docUrl: 'https://docs.cloud.google.com/compute/docs/reference/rest/v1/networks#Network.FIELDS.name',
  },
  'gcp.subnet': {
    id: 'gcp.subnet', provider: 'gcp', resourceType: 'subnet',
    displayName: 'Subnet', slug: 'subnet', minLength: 1, maxLength: 63,
    pattern: RFC1035, allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'lower',
    startsWithLetter: true, endsWithAlnum: true,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'gcp:project_region', entity: 'compute.subnetworks', category: 'networking', uniqueness: 'csp', uniquenessDocUrl: GCP_COMPUTE_DISCOVERY,
    docUrl: 'https://docs.cloud.google.com/compute/docs/reference/rest/v1/subnetworks#Subnetwork.FIELDS.name',
  },
  'gcp.cloud_sql_instance': {
    id: 'gcp.cloud_sql_instance', provider: 'gcp', resourceType: 'cloud_sql_instance',
    displayName: 'Cloud SQL Instance', slug: 'db', minLength: 1, maxLength: 67,
    pattern: /^[a-z]([a-z0-9-]*[a-z0-9])?$/, allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'lower',
    startsWithLetter: true, endsWithAlnum: true,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'gcp:project', entity: 'sqladmin.instances', category: 'database', uniqueness: 'csp',
    docUrl: 'https://docs.cloud.google.com/sql/docs/mysql/instance-settings',
    notes: [{ code: 'note.cloud_sql_combined_limit' }],
  },
  'gcp.storage_bucket': {
    id: 'gcp.storage_bucket', provider: 'gcp', resourceType: 'storage_bucket',
    displayName: 'Cloud Storage Bucket', slug: 'bucket', minLength: 3, maxLength: 63,
    pattern: /^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/, allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'lower',
    startsWithLetter: false, endsWithAlnum: true,
    forbidden: { prefixes: ['goog'], contains: ['google', 'g00gle', '..'], ipv4: true },
    template: ['owner', 'system', 'purpose', 'env', 'slug'], optional: ['owner'],
    scope: 'gcp:namespace', entity: 'storage.buckets', category: 'storage', uniqueness: 'csp',
    docUrl: 'https://docs.cloud.google.com/storage/docs/buckets#naming',
    notes: [{ code: 'note.gcs_dotted_names_222' }],
  },

  // ─── AWS ───────────────────────────────────────────────
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

  // ─── Azure ─────────────────────────────────────────────
  'azure.resource_group': {
    id: 'azure.resource_group', provider: 'azure', resourceType: 'resource_group',
    displayName: 'Resource Group', slug: 'rg', minLength: 1, maxLength: 90,
    // 끝 점 불가를 pattern 이 표현한다 · 숫자는 DecimalDigitNumber(Nd)만 — 문서가 UnicodeCategory 로 한정한다
    // 보조 평면(U+10000 이상)은 앞보기로 거부한다 — .NET Char.IsLetterOrDigit(char) 는 서로게이트 쌍을 글자로 보지 않는다 (보수적 · D20)
    pattern: /^(?!.*[\u{10000}-\u{10FFFF}])[\p{L}\p{Nd}_().-]*[\p{L}\p{Nd}_()-]$/u, allowed: 'alnum-hyphen-underscore-period-paren', separator: '-', caseRule: 'any',
    startsWithLetter: false, endsWithAlnum: false,
    template: ['slug', 'system', 'purpose', 'env'], optional: [],
    scope: 'azure:subscription', entity: 'Microsoft.Resources/resourceGroups', category: 'management', uniqueness: 'csp',
    docUrl: `${AZURE_RULES}#microsoftresources`,
  },
  'azure.storage_account': {
    id: 'azure.storage_account', provider: 'azure', resourceType: 'storage_account',
    displayName: 'Storage Account', slug: 'st', minLength: 3, maxLength: 24,
    pattern: /^[a-z0-9]{3,24}$/, allowed: 'lower-digit', separator: '', caseRule: 'lower',
    startsWithLetter: false, endsWithAlnum: true, forbidden: AZURE_RESERVED,
    template: ['slug', 'system', 'purpose', 'env'], optional: [],
    scope: 'azure:global', entity: 'Microsoft.Storage/storageAccounts', category: 'storage', uniqueness: 'csp',
    docUrl: `${AZURE_RULES}#microsoftstorage`, notes: [AZURE_RESERVED_NOTE],
  },
  'azure.key_vault': {
    id: 'azure.key_vault', provider: 'azure', resourceType: 'key_vault',
    displayName: 'Key Vault', slug: 'kv', minLength: 3, maxLength: 24,
    pattern: /^[a-zA-Z][a-zA-Z0-9-]{1,22}[a-zA-Z0-9]$/, noConsecutiveSeparator: true,
    allowed: 'alnum-hyphen', separator: '-', caseRule: 'any',
    startsWithLetter: true, endsWithAlnum: true, forbidden: AZURE_RESERVED,
    template: ['slug', 'system', 'purpose', 'env'], optional: [],
    scope: 'azure:global', entity: 'Microsoft.KeyVault/vaults', category: 'security', uniqueness: 'csp',
    docUrl: `${AZURE_RULES}#microsoftkeyvault`, notes: [AZURE_RESERVED_NOTE],
  },
  'azure.managed_identity': {
    id: 'azure.managed_identity', provider: 'azure', resourceType: 'managed_identity',
    displayName: 'User-Assigned Managed Identity', slug: 'id', minLength: 3, maxLength: 128,
    pattern: /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,127}$/, allowed: 'alnum-hyphen-underscore', separator: '-', caseRule: 'any',
    startsWithLetter: false, endsWithAlnum: false,
    template: ['system', 'purpose', 'env', 'slug', 'role'], optional: [],
    scope: 'azure:resource_group', entity: 'Microsoft.ManagedIdentity/userAssignedIdentities', category: 'identity', uniqueness: 'csp',
    docUrl: `${AZURE_RULES}#microsoftmanagedidentity`,
  },
  'azure.virtual_machine': {
    id: 'azure.virtual_machine', provider: 'azure', resourceType: 'virtual_machine',
    displayName: 'Virtual Machine (Linux)', slug: 'vm', minLength: 1, maxLength: 64,
    // 문서가 모순(금지 문자에 `.` · Linux 는 「끝에만」 점 불가)이라 점을 전부 거부한다 (보수적 · D20)
    pattern: /^[A-Za-z0-9]([A-Za-z0-9-]{0,62}[A-Za-z0-9])?$/, allowed: 'alnum-hyphen', separator: '-', caseRule: 'any',
    startsWithLetter: false, endsWithAlnum: true, forbidden: AZURE_RESERVED,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'azure:resource_group', entity: 'Microsoft.Compute/virtualMachines', category: 'compute', uniqueness: 'csp',
    docUrl: `${AZURE_RULES}#microsoftcompute`, notes: [AZURE_VM_NOTE, AZURE_RESERVED_AMBIGUOUS_NOTE],
  },
  'azure.virtual_machine_windows': {
    id: 'azure.virtual_machine_windows', provider: 'azure', resourceType: 'virtual_machine_windows',
    displayName: 'Virtual Machine (Windows)', slug: 'vm', minLength: 1, maxLength: 15,
    // Windows 호스트명은 점 불가 · 숫자로만 된 이름 불가(앞보기 · WINDOWS_COMPUTER_NAME_DOC_URL)
    pattern: /^(?![0-9]+$)[A-Za-z0-9]([A-Za-z0-9-]{0,13}[A-Za-z0-9])?$/, allowed: 'alnum-hyphen', separator: '-', caseRule: 'any',
    startsWithLetter: false, endsWithAlnum: true, forbidden: AZURE_RESERVED,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'azure:resource_group', entity: 'Microsoft.Compute/virtualMachines', category: 'compute', uniqueness: 'csp',
    docUrl: `${AZURE_RULES}#microsoftcompute`, notes: [AZURE_VM_NOTE, WINDOWS_NO_ALL_DIGITS_NOTE, AZURE_RESERVED_AMBIGUOUS_NOTE],
  },
  'azure.virtual_network': {
    id: 'azure.virtual_network', provider: 'azure', resourceType: 'virtual_network',
    displayName: 'Virtual Network', slug: 'vnet', minLength: 2, maxLength: 64,
    pattern: /^[a-zA-Z0-9][\w.-]{0,62}[a-zA-Z0-9_]$/, allowed: 'alnum-hyphen-underscore', separator: '-', caseRule: 'any',
    startsWithLetter: false, endsWithAlnum: false,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'azure:resource_group', entity: 'Microsoft.Network/virtualNetworks', category: 'networking', uniqueness: 'csp',
    docUrl: `${AZURE_RULES}#microsoftnetwork`,
  },
  'azure.subnet': {
    id: 'azure.subnet', provider: 'azure', resourceType: 'subnet',
    displayName: 'Subnet', slug: 'snet', minLength: 1, maxLength: 80,
    pattern: /^[a-zA-Z0-9]([\w.-]{0,78}[a-zA-Z0-9_])?$/, allowed: 'alnum-hyphen-underscore', separator: '-', caseRule: 'any',
    startsWithLetter: false, endsWithAlnum: false,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'azure:virtual_network', entity: 'Microsoft.Network/virtualNetworks/subnets', category: 'networking', uniqueness: 'csp',
    docUrl: `${AZURE_RULES}#microsoftnetwork`,
  },
  'azure.sql_server': {
    id: 'azure.sql_server', provider: 'azure', resourceType: 'sql_server',
    displayName: 'SQL Server', slug: 'sql', minLength: 1, maxLength: 63,
    pattern: /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/, allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'lower',
    startsWithLetter: false, endsWithAlnum: true, forbidden: AZURE_RESERVED,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'azure:global', entity: 'Microsoft.Sql/servers', category: 'database', uniqueness: 'csp',
    docUrl: `${AZURE_RULES}#microsoftsql`, notes: [AZURE_RESERVED_NOTE],
  },
  'azure.aks_nodepool_linux': {
    id: 'azure.aks_nodepool_linux', provider: 'azure', resourceType: 'aks_nodepool_linux',
    displayName: 'AKS Node Pool (Linux)', slug: 'np', minLength: 1, maxLength: 12,
    pattern: /^[a-z][a-z0-9]{0,11}$/, allowed: 'lower-digit', separator: '', caseRule: 'lower',
    startsWithLetter: true, endsWithAlnum: true,
    forbidden: { ...AZURE_RESERVED, exact: ['aksmanagedap'] }, // FAQ: AKS 시스템 구성요소 예약 이름
    template: ['slug', 'purpose', 'env'], optional: [],
    scope: 'azure:managed_cluster', entity: 'Microsoft.ContainerService/managedClusters/agentPools', category: 'containers', uniqueness: 'csp', uniquenessDocUrl: `${AZURE_RULES}#microsoftcontainerservice`,
    docUrl: AKS_FAQ, notes: [AZURE_RESERVED_AMBIGUOUS_NOTE],
  },
  'azure.aks_nodepool_windows': {
    id: 'azure.aks_nodepool_windows', provider: 'azure', resourceType: 'aks_nodepool_windows',
    displayName: 'AKS Node Pool (Windows)', slug: 'np', minLength: 1, maxLength: 6,
    pattern: /^[a-z][a-z0-9]{0,5}$/, allowed: 'lower-digit', separator: '', caseRule: 'lower',
    startsWithLetter: true, endsWithAlnum: true, forbidden: AZURE_RESERVED,
    template: ['slug', 'purpose'], optional: [],
    scope: 'azure:managed_cluster', entity: 'Microsoft.ContainerService/managedClusters/agentPools', category: 'containers', uniqueness: 'csp', uniquenessDocUrl: `${AZURE_RULES}#microsoftcontainerservice`,
    docUrl: AKS_FAQ, notes: [AZURE_RESERVED_AMBIGUOUS_NOTE],
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
