// 손으로 넣은 Azure 규칙 (D43) — resource-name-rules 표에서 생성기 문법 밖이라 보류된 행을 한 줄씩 다시 읽고 옮겼다.
// 행마다 위 주석이 표의 원문 인용이다(근거 URL 은 docUrl 의 앵커). 보수적으로 좁힌 행은 notes 에 무엇을 더 거부하는지 코드로 싣는다 (D20).
// 예약어(reserved)는 rules/azure.ts 가 손 규칙과 같은 목록 · note 로 붙인다 — 전역 범위 행과 원문이 예약어를 가리킨 행이다.
import type { CoreMessage } from '../messages';
import type { ResourceRule, Token } from '../types';
import type { ScopeDef } from '../scopes';

const RULES_URL = 'https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules';
const PARENT: CoreMessage = { code: 'note.parent_length_limit' };
const BLOCKLIST: CoreMessage = { code: 'note.blocklist_narrowed' };
const UNICODE: CoreMessage = { code: 'note.unicode_excluded' };
const VARIANT: CoreMessage = { code: 'note.variant_narrowed' };
const NARROWER: CoreMessage = { code: 'note.narrower_source_used' };
const OBSOLETE: CoreMessage = { code: 'note.obsolete_source_applied' };
const SECONDARY: CoreMessage = { code: 'note.secondary_source' };

const SEP: Token[] = ['system', 'purpose', 'env', 'region', 'slug', 'seq'];
const NOSEP: Token[] = ['slug', 'system', 'purpose', 'env'];

/** policy* 리소스 이름 — "Resource name can't use: `#<>%&:\?/` or control characters. Can't end with period or space."
 *  control characters 는 C0 · DEL · C1 에 폭 없는 문자 · 양방향 제어 · BOM 까지 넓게 읽는다(생성기 INVISIBLE_CLASS · display.ts 와 같은 집합) */
// oxlint-disable-next-line no-control-regex -- 제어 문자를 막는 것이 이 정규식의 목적이다
const POLICY_NAME = /^[^#<>%&:\\?/\x00-\x1F\x7F-\x9F\u061C\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]{0,63}[^#<>%&:\\?/\x00-\x1F\x7F-\x9F\u061C\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF. ]$/;
/** tagNames — "Can't use: `<>%&\?/` or control characters" (제어 문자 집합은 POLICY_NAME 과 같다) */
// oxlint-disable-next-line no-control-regex -- 제어 문자를 막는 것이 이 정규식의 목적이다
const TAG_NAME = /^[^<>%&\\?/\x00-\x1F\x7F-\x9F\u061C\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]{1,512}$/;
/** 영숫자로 시작 · 끝, `.` 뒤는 영숫자 — MobileNetwork dataNetworks · attachedDataNetworks */
const DOTTED_64 = /^(?=.{1,64}$)[A-Za-z0-9](?:(?:[A-Za-z0-9-]|\.(?=[A-Za-z0-9]))*[A-Za-z0-9])?$/;

export interface AzureManualRule extends ResourceRule { reserved: boolean }
type Spec = Pick<ResourceRule, 'id' | 'displayName' | 'slug' | 'minLength' | 'maxLength' | 'pattern' | 'scope' | 'entity' | 'category'> & { anchor: string; reserved?: boolean }
  & Partial<Pick<ResourceRule, 'forbidden' | 'noConsecutiveSeparator' | 'allowed' | 'separator' | 'caseRule' | 'startsWithLetter' | 'endsWithAlnum' | 'template' | 'notes'>>;

/** 기본 — 영숫자 · 하이픈으로 생성, 대소문자 허용(표 머리 "Resource and resource group names are case-insensitive"), VM 꼴 */
function rule({ anchor, reserved = false, ...s }: Spec): AzureManualRule {
  const separator = s.separator ?? '-';
  const template = s.template ?? (separator === '' ? NOSEP : SEP);
  return {
    provider: 'azure', resourceType: s.id.slice('azure.'.length),
    allowed: 'alnum-hyphen', caseRule: 'any', startsWithLetter: false, endsWithAlnum: false,
    optional: template.includes('region') ? ['region'] : [], uniqueness: 'csp', docUrl: `${RULES_URL}#${anchor}`, reserved,
    ...s, separator, template,
  };
}

/** 부모 리소스 범위 — 표의 Scope 칸이 부모 리소스 이름인 행. 꼴은 생성기(rules/azure-intake.ts)와 같다 */
export type AzureManualScopeId = 'azure:appconfiguration/configurationstores' | 'azure:elasticsan/elasticsans' | 'azure:machinelearningservices/workspaces' | 'azure:synapse/workspaces' | 'azure:web/sites';
export const AZURE_MANUAL_SCOPES: Record<AzureManualScopeId, ScopeDef> = {
  'azure:appconfiguration/configurationstores': { id: 'azure:appconfiguration/configurationstores', provider: 'azure', displayName: 'configurationStore', parent: 'azure:global', ruleId: 'azure.app_configuration_configuration_stores', docUrl: `${RULES_URL}#microsoftappconfiguration` },
  'azure:elasticsan/elasticsans': { id: 'azure:elasticsan/elasticsans', provider: 'azure', displayName: 'elastic san', parent: 'azure:global', ruleId: 'azure.elastic_san_elastic_sans', docUrl: `${RULES_URL}#microsoftelasticsan-preview` },
  'azure:machinelearningservices/workspaces': { id: 'azure:machinelearningservices/workspaces', provider: 'azure', displayName: 'workspace', parent: 'azure:resource_group', ruleId: 'azure.machine_learning_services_workspaces', docUrl: `${RULES_URL}#microsoftmachinelearningservices` },
  'azure:synapse/workspaces': { id: 'azure:synapse/workspaces', provider: 'azure', displayName: 'workspace', parent: 'azure:global', ruleId: 'azure.synapse_workspaces', docUrl: `${RULES_URL}#microsoftsynapse` },
  'azure:web/sites': { id: 'azure:web/sites', provider: 'azure', displayName: 'site', parent: 'azure:global', ruleId: 'azure.web_sites', docUrl: `${RULES_URL}#microsoftweb` },
};

const RULES: AzureManualRule[] = [
  // containerApps 2-32 "Lowercase letters, numbers, and hyphens. Start with a letter and end with alphanumeric." (원문 앞 글자 `n` 은 오타로 읽는다)
  rule({ id: 'azure.app_container_apps', displayName: 'Container App', slug: 'ca', minLength: 2, maxLength: 32, pattern: /^[a-z][a-z0-9-]{0,30}[a-z0-9]$/,
    allowed: 'lower-digit-hyphen', caseRule: 'lower', startsWithLetter: true, endsWithAlnum: true, scope: 'azure:resource_group', entity: 'Microsoft.App/containerApps', category: 'containers', anchor: 'microsoftapp' }),
  // configurationStores 5-50 "Alphanumerics and hyphens. Can't contain a sequence of more than two hyphens. Can't start with or end with a hyphen." Scope global
  rule({ id: 'azure.app_configuration_configuration_stores', displayName: 'App Configuration store', slug: 'cs', minLength: 5, maxLength: 50, pattern: /^(?!.*---)[A-Za-z0-9][A-Za-z0-9-]{3,48}[A-Za-z0-9]$/,
    endsWithAlnum: true, reserved: true, scope: 'azure:global', entity: 'Microsoft.AppConfiguration/configurationStores', category: 'management', anchor: 'microsoftappconfiguration' }),
  // configurationStores / replicas 1-50 "The combined length of the configurationStore name and the replica name can't exceed 60 characters. | Only alphanumerics are valid."
  // 저장소 이름이 최대 50 이므로 60 − 50 = 10 으로 줄인다
  rule({ id: 'azure.app_configuration_stores_replicas', displayName: 'App Configuration store / replicas', slug: 'rep', minLength: 1, maxLength: 10, pattern: /^[A-Za-z0-9]{1,50}$/,
    allowed: 'lower-digit', separator: '', caseRule: 'lower', scope: 'azure:appconfiguration/configurationstores', entity: 'Microsoft.AppConfiguration/configurationStores/replicas', category: 'management', anchor: 'microsoftappconfiguration', notes: [PARENT] }),

  // ── Microsoft.Authorization — "Scope of definition / assignment / exemption" 은 한 노드가 아니라 구독에 둔다 ──
  // policyAssignments "1-64 resource name · 1-24 resource name at management group scope | Resource name can't use: `#<>%&:\?/` or control characters. Can't end with period or space."
  rule({ id: 'azure.authorization_policy_assignments', displayName: 'Policy assignment', slug: 'pa', minLength: 1, maxLength: 24, pattern: POLICY_NAME,
    scope: 'azure:subscription', entity: 'Microsoft.Authorization/policyAssignments', category: 'management', anchor: 'microsoftauthorization', notes: [VARIANT] }),
  // policyDefinitions "1-64 resource name | Resource name can't use: `#<>%&:\?/` or control characters. Can't end with period or space."
  rule({ id: 'azure.authorization_policy_definitions', displayName: 'Policy definition', slug: 'pd', minLength: 1, maxLength: 64, pattern: POLICY_NAME,
    scope: 'azure:subscription', entity: 'Microsoft.Authorization/policyDefinitions', category: 'management', anchor: 'microsoftauthorization' }),
  // policyExemptions (policyDefinitions 와 같은 문장)
  rule({ id: 'azure.authorization_policy_exemptions', displayName: 'Policy exemption', slug: 'pe', minLength: 1, maxLength: 64, pattern: POLICY_NAME,
    scope: 'azure:subscription', entity: 'Microsoft.Authorization/policyExemptions', category: 'management', anchor: 'microsoftauthorization' }),
  // policySetDefinitions (policyDefinitions 와 같은 문장)
  rule({ id: 'azure.authorization_policy_set_definitions', displayName: 'Policy set definition', slug: 'psd', minLength: 1, maxLength: 64, pattern: POLICY_NAME,
    scope: 'azure:subscription', entity: 'Microsoft.Authorization/policySetDefinitions', category: 'management', anchor: 'microsoftauthorization' }),

  // ── Microsoft.Compute — "Can't use spaces, control characters, or these characters: `~ ! @ # $ % ^ & * ( ) = + _ [ ] { } \ | ; : . ' " , < > / ?` Can't start with underscore. Can't end with period or hyphen." ──
  // cloudservices 1-15 — 남는 ASCII(영숫자 · 하이픈 · 백틱) 가운데 영숫자 · 하이픈만. 15자 규칙 셋은 순번 없이 짓는다(약어가 3자 이상이라 순번까지는 안 들어간다)
  rule({ id: 'azure.compute_cloudservices', displayName: 'Cloud service', slug: 'clo', minLength: 1, maxLength: 15, pattern: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,13}[A-Za-z0-9])?$/,
    template: ['system', 'purpose', 'env', 'slug'], endsWithAlnum: true, scope: 'azure:resource_group', entity: 'Microsoft.Compute/cloudservices', category: 'compute', anchor: 'microsoftcompute', notes: [BLOCKLIST] }),
  // virtualMachineScaleSets "1-15 (Windows) 1-64 (Linux)" — OS 마다 규칙 하나
  rule({ id: 'azure.compute_vm_scale_sets', displayName: 'Virtual machine scale set (Linux)', slug: 'vmss', minLength: 1, maxLength: 64, pattern: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?$/,
    endsWithAlnum: true, scope: 'azure:resource_group', entity: 'Microsoft.Compute/virtualMachineScaleSets', category: 'compute', anchor: 'microsoftcompute', notes: [BLOCKLIST] }),
  rule({ id: 'azure.compute_vm_scale_sets_windows', displayName: 'Virtual machine scale set (Windows)', slug: 'vmss', minLength: 1, maxLength: 15, pattern: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,13}[A-Za-z0-9])?$/,
    template: ['system', 'purpose', 'env', 'slug'], endsWithAlnum: true, scope: 'azure:resource_group', entity: 'Microsoft.Compute/virtualMachineScaleSets', category: 'compute', anchor: 'microsoftcompute', notes: [BLOCKLIST] }),

  // ── Microsoft.DevTestLab labs / virtualmachines "1-15 (Windows) 1-64 (Linux) | Alphanumerics and hyphens. Start and end with alphanumeric; can't be all numbers." ──
  rule({ id: 'azure.dev_test_lab_virtualmachines', displayName: 'DevTest Labs virtual machine (Linux)', slug: 'vir', minLength: 1, maxLength: 64, pattern: /^(?![0-9]+$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?$/,
    endsWithAlnum: true, scope: 'azure:devtestlab/labs', entity: 'Microsoft.DevTestLab/labs/virtualmachines', category: 'compute', anchor: 'microsoftdevtestlab' }),
  rule({ id: 'azure.dev_test_lab_virtualmachines_windows', displayName: 'DevTest Labs virtual machine (Windows)', slug: 'vir', minLength: 1, maxLength: 15, pattern: /^(?![0-9]+$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,13}[A-Za-z0-9])?$/,
    template: ['system', 'purpose', 'env', 'slug'], endsWithAlnum: true, scope: 'azure:devtestlab/labs', entity: 'Microsoft.DevTestLab/labs/virtualmachines', category: 'compute', anchor: 'microsoftdevtestlab' }),

  // ── Microsoft.ElasticSan (preview) ──
  // elasticSans 3-24 "Lowercase letters, numbers, hyphens, and underscores. Start with lowercase letter or number. Must begin and end with a letter or number. Each hyphen and underscore must be preceded and followed by an alphanumeric character."
  rule({ id: 'azure.elastic_san_elastic_sans', displayName: 'Elastic SAN', slug: 'es', minLength: 3, maxLength: 24, pattern: /^(?=.{3,24}$)[a-z0-9]+(?:[-_][a-z0-9]+)*$/,
    allowed: 'lower-digit-hyphen', caseRule: 'lower', endsWithAlnum: true, noConsecutiveSeparator: true, reserved: true, scope: 'azure:global', entity: 'Microsoft.ElasticSan/elasticSans', category: 'storage', anchor: 'microsoftelasticsan-preview' }),
  // elasticSans / volumeGroups 3-63 "Lowercase letters, numbers, and hyphens … Each hyphen must be preceded and followed by an alphanumeric character."
  rule({ id: 'azure.elastic_san_elastic_sans_volume_groups', displayName: 'Elastic SAN / volume groups', slug: 'vg', minLength: 3, maxLength: 63, pattern: /^(?=.{3,63}$)[a-z0-9]+(?:-[a-z0-9]+)*$/,
    allowed: 'lower-digit-hyphen', caseRule: 'lower', endsWithAlnum: true, noConsecutiveSeparator: true, scope: 'azure:elasticsan/elasticsans', entity: 'Microsoft.ElasticSan/elasticSans/volumeGroups', category: 'storage', anchor: 'microsoftelasticsan-preview' }),

  // ── Microsoft.MachineLearningServices workspaces / computes ──
  // 표 "3-24 for compute instance · 3-32 for AML compute · 2-16 for other compute types | Alphanumerics and hyphens"
  // how-to(azure/machine-learning/how-to-create-attach-compute-cluster) "must be between 3 to 24 characters long. … Valid characters are upper and lower case letters, digits, and the - character. … Name must start with a letter … If - character is used, then it needs to be followed by at least one letter later in the name."
  // 셋 다 만족하는 3-16 · how-to 문자 규칙. 하이픈 뒤에 글자가 와야 해서 순번을 붙이지 않는다
  rule({ id: 'azure.machine_learning_workspaces_computes', displayName: 'Machine Learning compute', slug: 'com', minLength: 3, maxLength: 16, pattern: /^[A-Za-z](?!.*-[^A-Za-z]*$)[A-Za-z0-9-]{2,15}$/,
    startsWithLetter: true, endsWithAlnum: true, template: ['system', 'purpose', 'env', 'slug'], scope: 'azure:machinelearningservices/workspaces', entity: 'Microsoft.MachineLearningServices/workspaces/computes', category: 'compute', anchor: 'microsoftmachinelearningservices', notes: [VARIANT, NARROWER] }),

  // ── Microsoft.Maps accounts "1-98 (for resource group name and account name) | Alphanumerics, underscores, periods, and hyphens. Start with alphanumeric." ──
  // 리소스 그룹 이름이 최대 90 이고 둘을 어떻게 합쳐 세는지(구분자 포함 여부)가 없어 98 − 90 − 1 = 7 로 줄인다
  rule({ id: 'azure.maps_accounts', displayName: 'Maps account', slug: 'acc', minLength: 1, maxLength: 7, pattern: /^[A-Za-z0-9][A-Za-z0-9_.-]*$/,
    template: ['system', 'slug'], scope: 'azure:resource_group', entity: 'Microsoft.Maps/accounts', category: 'management', anchor: 'microsoftmaps', notes: [PARENT] }),

  // ── Microsoft.MobileNetwork ──
  // mobileNetworks / services 1-64 "Alphanumerics and hyphens. Start with alphanumeric. The following words can't be used on their own as the name: `default`, `requested`, `service`."
  rule({ id: 'azure.mobile_network_mobile_networks_services', displayName: 'Mobile Network / services', slug: 'ser', minLength: 1, maxLength: 64, pattern: /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/,
    forbidden: { exact: ['default', 'requested', 'service'], ignoreCase: true }, scope: 'azure:mobilenetwork/mobilenetworks', entity: 'Microsoft.MobileNetwork/mobileNetworks/services', category: 'networking', anchor: 'microsoftmobilenetwork' }),
  // mobileNetworks / dataNetworks 1-64 "Alphanumeric, hyphens, and a period/dot (`.`). Start and end with alphanumeric. Note: A period/dot (`.`) must be followed by an alphanumeric character."
  rule({ id: 'azure.mobile_network_data_networks', displayName: 'Mobile Network / data networks', slug: 'dn', minLength: 1, maxLength: 64, pattern: DOTTED_64,
    endsWithAlnum: true, scope: 'azure:mobilenetwork/mobilenetworks', entity: 'Microsoft.MobileNetwork/mobileNetworks/dataNetworks', category: 'networking', anchor: 'microsoftmobilenetwork' }),
  // packetCoreControlPlanes / packetCoreDataPlanes / attachedDataNetworks (dataNetworks 와 같은 문장 · Scope Mobile Network)
  rule({ id: 'azure.mobile_network_attached_data_networks', displayName: 'Packet core data plane / attached data networks', slug: 'adn', minLength: 1, maxLength: 64, pattern: DOTTED_64,
    endsWithAlnum: true, scope: 'azure:mobilenetwork/mobilenetworks', entity: 'Microsoft.MobileNetwork/packetCoreControlPlanes/packetCoreDataPlanes/attachedDataNetworks', category: 'networking', anchor: 'microsoftmobilenetwork' }),

  // ── Microsoft.NetApp netAppAccounts / volumes 1-64 "Alphanumerics, underscores, and hyphens. Start with alphanumeric. Volume can't be named `bin` or `default`." ──
  rule({ id: 'azure.net_app_net_app_accounts_volumes', displayName: 'NetApp account / volumes', slug: 'vol', minLength: 1, maxLength: 64, pattern: /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/,
    allowed: 'alnum-hyphen-underscore', forbidden: { exact: ['bin', 'default'], ignoreCase: true }, scope: 'azure:netapp/netappaccounts', entity: 'Microsoft.NetApp/netAppAccounts/volumes', category: 'storage', anchor: 'microsoftnetapp' }),

  // ── Microsoft.Network trafficmanagerprofiles 1-63 "Alphanumerics and hyphens. Start and end with alphanumeric. Note: A period/dot (.) is not allowed in the profile name." Scope global ──
  rule({ id: 'azure.network_trafficmanagerprofiles', displayName: 'Traffic Manager profile', slug: 'tra', minLength: 1, maxLength: 63, pattern: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/,
    endsWithAlnum: true, reserved: true, scope: 'azure:global', entity: 'Microsoft.Network/trafficmanagerprofiles', category: 'networking', anchor: 'microsoftnetwork' }),

  // ── Microsoft.Portal dashboards 3-160 "Alphanumerics and hyphens. To use restricted characters, add a tag named hidden-title …" ──
  rule({ id: 'azure.portal_dashboards', displayName: 'Portal dashboard', slug: 'das', minLength: 3, maxLength: 160, pattern: /^[A-Za-z0-9-]{3,160}$/,
    scope: 'azure:resource_group', entity: 'Microsoft.Portal/dashboards', category: 'management', anchor: 'microsoftportal' }),

  // ── Microsoft.Resources tagNames 1-512 "Can't use: `<>%&\?/` or control characters" (Scope 칸 resource) ──
  // REST 참조 Tags - Create Or Update "This operation allows adding a name to the list of predefined tag names for the given subscription. A tag name can have a maximum of 512 characters and is case-insensitive. Tag names cannot have the following prefixes which are reserved for Azure use: 'microsoft', 'azure', 'windows'."
  // 경로가 subscriptions/{id}/tagNames/{tagName} 라 구독에 둔다. 제어 문자는 policy* 와 같은 넓은 집합으로 읽는다
  rule({ id: 'azure.resources_tag_names', displayName: 'Predefined tag name', slug: 'tag', minLength: 1, maxLength: 512, pattern: TAG_NAME,
    forbidden: { prefixes: ['microsoft', 'azure', 'windows'], ignoreCase: true }, scope: 'azure:subscription', entity: 'Microsoft.Resources/tagNames', category: 'management', anchor: 'microsoftresources', notes: [SECONDARY] }),

  // ── Microsoft.ServiceBus namespaces 6-50 "Alphanumerics and hyphens. Start with a letter. End with a letter or number." Scope global ──
  // 표가 가리키는 Create namespace 쪽(learn.microsoft.com/en-us/rest/api/servicebus/create-namespace) "The name doesn't end with “-“, “-sb“ or “-mgmt“." — 그 쪽은 "This API is obsolete and retired as of 11/1/2021"
  rule({ id: 'azure.service_bus_namespaces', displayName: 'Service Bus namespace', slug: 'nam', minLength: 6, maxLength: 50, pattern: /^[A-Za-z][A-Za-z0-9-]{4,48}[A-Za-z0-9]$/,
    startsWithLetter: true, endsWithAlnum: true, forbidden: { suffixes: ['-sb', '-mgmt'], ignoreCase: true }, reserved: true, scope: 'azure:global', entity: 'Microsoft.ServiceBus/namespaces', category: 'management', anchor: 'microsoftservicebus', notes: [OBSOLETE] }),

  // ── Microsoft.Synapse ──
  // workspaces 1-50 "Lowercase letters, hyphens, and numbers. Start and end with letter or number. Can't contain `-ondemand`." Scope global
  rule({ id: 'azure.synapse_workspaces', displayName: 'Synapse workspace', slug: 'wor', minLength: 1, maxLength: 50, pattern: /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/,
    allowed: 'lower-digit-hyphen', caseRule: 'lower', endsWithAlnum: true, forbidden: { contains: ['-ondemand'] }, reserved: true, scope: 'azure:global', entity: 'Microsoft.Synapse/workspaces', category: 'database', anchor: 'microsoftsynapse' }),
  // workspaces / bigDataPools 1-15 "Letters and numbers. Start with a letter. End with letter or number. Can't contain reserved words."
  rule({ id: 'azure.synapse_workspaces_big_data_pools', displayName: 'Synapse workspace / Apache Spark pools', slug: 'bdp', minLength: 1, maxLength: 15, pattern: /^[A-Za-z][A-Za-z0-9]{0,14}$/,
    allowed: 'lower-digit', separator: '', caseRule: 'lower', startsWithLetter: true, reserved: true, scope: 'azure:synapse/workspaces', entity: 'Microsoft.Synapse/workspaces/bigDataPools', category: 'database', anchor: 'microsoftsynapse' }),
  // workspaces / sqlPools 1-60 "Can't contain `<>*%&:\/?@-` or control characters. Can't end with `.` or space. Can't contain reserved words." — 하이픈이 금지 목록에 있다
  // oxlint-disable-next-line no-control-regex -- 제어 문자를 막는 것이 이 정규식의 목적이다
  rule({ id: 'azure.synapse_workspaces_sql_pools', displayName: 'Synapse workspace / SQL pools', slug: 'sp', minLength: 1, maxLength: 60, pattern: /^[^<>*%&:\\/?@\x00-\x1F\x7F-\x9F\u061C\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF-]{0,59}[^<>*%&:\\/?@\x00-\x1F\x7F-\x9F\u061C\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF. -]$/,
    allowed: 'lower-digit', separator: '', caseRule: 'lower', reserved: true, scope: 'azure:synapse/workspaces', entity: 'Microsoft.Synapse/workspaces/sqlPools', category: 'database', anchor: 'microsoftsynapse' }),

  // ── Microsoft.Web — "Alphanumeric, hyphens, and Unicode characters that can be mapped to Punycode" · "Unicode characters are parsed to Punycode using the IdnMapping.GetAscii method" ──
  // serverfarms 1-60
  rule({ id: 'azure.web_serverfarms', displayName: 'App Service plan', slug: 'ser', minLength: 1, maxLength: 60, pattern: /^[A-Za-z0-9-]{1,60}$/,
    scope: 'azure:resource_group', entity: 'Microsoft.Web/serverfarms', category: 'compute', anchor: 'microsoftweb', notes: [UNICODE] }),
  // sites 2-60 "Can't start or end with hyphen." · "The app name must be globally unique."
  rule({ id: 'azure.web_sites', displayName: 'App Service app', slug: 'sit', minLength: 2, maxLength: 60, pattern: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,58}[A-Za-z0-9])$/,
    endsWithAlnum: true, reserved: true, scope: 'azure:global', entity: 'Microsoft.Web/sites', category: 'compute', anchor: 'microsoftweb', notes: [UNICODE] }),
  // sites / slots 2-59
  rule({ id: 'azure.web_sites_slots', displayName: 'App Service app / slots', slug: 'slo', minLength: 2, maxLength: 59, pattern: /^[A-Za-z0-9-]{2,59}$/,
    scope: 'azure:web/sites', entity: 'Microsoft.Web/sites/slots', category: 'compute', anchor: 'microsoftweb', notes: [UNICODE] }),
];

export const AZURE_MANUAL_ROWS: readonly AzureManualRule[] = RULES;
