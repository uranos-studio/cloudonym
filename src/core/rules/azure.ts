// Azure 규칙 표 — constraints.ts 가 gcp · aws 와 합쳐 RULES 로 낸다 (파일을 나눠도 이름 · 판정 불변)
import type { Forbidden, ResourceRule, Token } from '../types';
import type { CoreMessage } from '../messages';
import { AZURE_INTAKE_CHARS, AZURE_INTAKE_ROWS } from './azure-intake';
import { AZURE_MANUAL_ROWS, type AzureManualRule } from './azure-manual';

const AZURE_RULES = 'https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules';
const AKS_FAQ = 'https://learn.microsoft.com/en-us/troubleshoot/azure/azure-kubernetes/create-upgrade-delete/aks-common-issues-faq#what-naming-restrictions-are-enforced-for-aks-resources-and-parameters-';
const AZURE_VM_NOTE: CoreMessage = { code: 'note.azure_vm_hostname_rule' };
/** Windows 컴퓨터 이름 규칙 — "computer names that only contain numbers (0-9)" 는 쓸 수 없다.
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

const AZURE_HAND_RULES: Record<string, ResourceRule> = {
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
  // 조사 11종 — 이름 규칙 표의 행 그대로. 예약어는 걸지 않는다: 리소스 이름이 DNS 이름이 되지 않는다(Public IP 의 FQDN 은 별도 DNS 라벨 속성이 만든다)
  // NIC · PIP · NSG — 1-80 · "Alphanumerics, underscores, periods, and hyphens. Start with alphanumeric. End with alphanumeric or underscore." (azure.subnet 과 같은 문장)
  'azure.public_ip': {
    id: 'azure.public_ip', provider: 'azure', resourceType: 'public_ip',
    displayName: 'Public IP Address', slug: 'pip', minLength: 1, maxLength: 80,
    pattern: /^[a-zA-Z0-9]([\w.-]{0,78}[a-zA-Z0-9_])?$/, allowed: 'alnum-hyphen-underscore', separator: '-', caseRule: 'any',
    startsWithLetter: false, endsWithAlnum: false,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'azure:resource_group', entity: 'Microsoft.Network/publicIPAddresses', category: 'networking', uniqueness: 'csp',
    docUrl: `${AZURE_RULES}#microsoftnetwork`,
  },
  'azure.network_security_group': {
    id: 'azure.network_security_group', provider: 'azure', resourceType: 'network_security_group',
    displayName: 'Network Security Group', slug: 'nsg', minLength: 1, maxLength: 80,
    pattern: /^[a-zA-Z0-9]([\w.-]{0,78}[a-zA-Z0-9_])?$/, allowed: 'alnum-hyphen-underscore', separator: '-', caseRule: 'any',
    startsWithLetter: false, endsWithAlnum: false,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'azure:resource_group', entity: 'Microsoft.Network/networkSecurityGroups', category: 'networking', uniqueness: 'csp',
    docUrl: `${AZURE_RULES}#microsoftnetwork`,
  },
  'azure.network_interface': {
    id: 'azure.network_interface', provider: 'azure', resourceType: 'network_interface',
    displayName: 'Network Interface', slug: 'nic', minLength: 1, maxLength: 80,
    pattern: /^[a-zA-Z0-9]([\w.-]{0,78}[a-zA-Z0-9_])?$/, allowed: 'alnum-hyphen-underscore', separator: '-', caseRule: 'any',
    startsWithLetter: false, endsWithAlnum: false,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'azure:resource_group', entity: 'Microsoft.Network/networkInterfaces', category: 'networking', uniqueness: 'csp',
    docUrl: `${AZURE_RULES}#microsoftnetwork`,
  },
  // disks — 1-80 · "Alphanumerics, underscores, and hyphens" — 점 없음 · 시작 · 끝 규칙 없음(문서에 없는 것을 더하지 않는다)
  'azure.os_disk': {
    id: 'azure.os_disk', provider: 'azure', resourceType: 'os_disk',
    displayName: 'Managed Disk (OS)', slug: 'osdisk', minLength: 1, maxLength: 80,
    pattern: /^[a-zA-Z0-9_-]{1,80}$/, allowed: 'alnum-hyphen-underscore', separator: '-', caseRule: 'any',
    startsWithLetter: false, endsWithAlnum: false,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'azure:resource_group', entity: 'Microsoft.Compute/disks', category: 'compute', uniqueness: 'csp',
    docUrl: `${AZURE_RULES}#microsoftcompute`,
  },
};

// ─── 들인 행 (D43) — rules/azure-intake.ts 의 행을 규칙으로 편다 ──────────────
// 생성 꼴은 기존 두 꼴을 따른다: 구분자가 있으면 VM 꼴(순번 · region 선택), 없으면 storage 꼴.
// 전역 범위 행(이름이 엔드포인트가 된다)은 storage · key vault · SQL 처럼 예약어를 건다 (보수적 · D20).
const SEP_TEMPLATE: Token[] = ['system', 'purpose', 'env', 'region', 'slug', 'seq'];
const NOSEP_TEMPLATE: Token[] = ['slug', 'system', 'purpose', 'env'];

function fromIntakeRow(r: (typeof AZURE_INTAKE_ROWS)[number]): ResourceRule {
  const c = AZURE_INTAKE_CHARS[r.chars];
  const base = c.separator === '' ? NOSEP_TEMPLATE : SEP_TEMPLATE;
  const template = r.slug === '' ? base.filter((t) => t !== 'slug') : base;
  return {
    id: r.id, provider: 'azure', resourceType: r.id.slice('azure.'.length), displayName: r.displayName, slug: r.slug,
    minLength: r.min, maxLength: r.max, pattern: c.pattern,
    ...(c.noConsecutiveSeparator ? { noConsecutiveSeparator: true } : {}),
    allowed: c.allowed, separator: c.separator, caseRule: c.caseRule, startsWithLetter: c.startsWithLetter, endsWithAlnum: c.endsWithAlnum,
    ...(r.reserved ? { forbidden: AZURE_RESERVED } : {}),
    template, optional: template.includes('region') ? ['region'] : [],
    scope: r.scope, entity: r.entity, category: r.category, uniqueness: 'csp',
    docUrl: `${AZURE_RULES}#${r.anchor}`,
    ...(r.reserved ? { notes: [AZURE_RESERVED_NOTE] } : {}),
  };
}

/** 손으로 넣은 행 (rules/azure-manual.ts) — 예약어 행은 손 규칙과 같은 목록을 더하고 note 를 앞에 싣는다 */
function fromManualRow({ reserved, ...r }: AzureManualRule): ResourceRule {
  if (!reserved) return r;
  const f = r.forbidden ?? {};
  const merged: Forbidden = { ...AZURE_RESERVED, ...f, ignoreCase: true };
  for (const k of ['words', 'contains', 'prefixes', 'suffixes', 'exact'] as const) {
    const xs = [...(AZURE_RESERVED[k] ?? []), ...(f[k] ?? [])];
    if (xs.length > 0) merged[k] = xs;
  }
  return { ...r, forbidden: merged, notes: [AZURE_RESERVED_NOTE, ...(r.notes ?? [])] };
}

/** 손으로 쓴 규칙 다음에 들인 행 — 표 순서 */
export const AZURE_RULES_TABLE: Record<string, ResourceRule> = {
  ...AZURE_HAND_RULES,
  ...Object.fromEntries(AZURE_INTAKE_ROWS.map((r) => [r.id, fromIntakeRow(r)])),
  ...Object.fromEntries(AZURE_MANUAL_ROWS.map((r) => [r.id, fromManualRow(r)])),
};
