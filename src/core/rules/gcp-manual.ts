// 손으로 넣은 GCP 규칙 (D43) — 생성기가 정형으로 읽지 못한 행을 공식 문서에서 한 줄씩 읽고 옮겼다.
// 행마다 위 주석이 근거 URL 과 원문 인용이다. 보수적으로 좁힌 행은 notes 에 무엇을 더 거부하는지 코드로 싣는다 (D20).
// rules/gcp.ts 가 손 규칙 · 들인 행과 합친다.
import type { CoreMessage } from '../messages';
import type { ResourceRule, Token } from '../types';
import type { ScopeDef } from '../scopes';

const COMPUTE_DISCOVERY = 'https://www.googleapis.com/discovery/v1/apis/compute/v1/rest';
const IAM_V1_DISCOVERY = 'https://www.googleapis.com/discovery/v1/apis/iam/v1/rest';
const AR_DOWNLOAD_RULES = 'https://docs.cloud.google.com/artifact-registry/docs/restrict-artifact-downloads#gcloud';
const RFC1035 = /^[a-z](?:[-a-z0-9]{0,61}[a-z0-9])?$/;
const SPANNER_ID = /^[a-z][-a-z0-9]{0,62}[a-z0-9]$/;
const IAM_V3_ID = /^[a-z][a-z0-9.-]{2,62}$/;
const IAM_4_32 = /^[a-z0-9-]{4,32}$/;
const IAM_6_63 = /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/;
const IAM_63 = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const GCP_PREFIX = { prefixes: ['gcp-'] };

const SCOPE: CoreMessage = { code: 'note.scope_unconfirmed' };
const NARROWER: CoreMessage = { code: 'note.narrower_source_used' };
const ADVISORY: CoreMessage = { code: 'note.advisory_rule_enforced' };

const PLACED: Token[] = ['system', 'purpose', 'env', 'region', 'slug', 'seq'];
const NOSEP: Token[] = ['slug', 'system', 'purpose', 'env'];

type Spec = Pick<ResourceRule, 'id' | 'displayName' | 'slug' | 'minLength' | 'maxLength' | 'pattern' | 'scope' | 'entity' | 'category' | 'docUrl'>
  & Partial<Pick<ResourceRule, 'forbidden' | 'allowed' | 'separator' | 'caseRule' | 'startsWithLetter' | 'endsWithAlnum' | 'template' | 'notes' | 'uniquenessDocUrl'>>;

/** 기본 — 소문자 · 숫자 · 하이픈, 글자로 시작 · 영숫자로 끝, 순번 꼴 */
function rule(s: Spec): ResourceRule {
  const template = s.template ?? PLACED;
  return {
    provider: 'gcp', resourceType: s.id.slice('gcp.'.length),
    allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'lower', startsWithLetter: true, endsWithAlnum: true,
    optional: template.includes('region') ? ['region'] : [], uniqueness: 'csp',
    ...s, template,
  };
}

/** 부모 리소스 범위 — 원문이 「이 안에서 유일하다」고 적은 부모 */
export type GcpManualScopeId = 'gcp:spanner_instance' | 'gcp:workforce_pool' | 'gcp:workload_identity_pool' | 'gcp:artifact_registry_repository';
export const GCP_MANUAL_SCOPES: Record<GcpManualScopeId, ScopeDef> = {
  // "The instance partition ID must also be unique within your instance." (Spanner 안내서) · Backup.name 은 instances/<instance>/backups/ 아래
  'gcp:spanner_instance': { id: 'gcp:spanner_instance', provider: 'gcp', displayName: 'Spanner instance', parent: 'gcp:project', ruleId: 'gcp.spanner_instance', docUrl: 'https://cloud.google.com/spanner/docs/reference/rest/v1/projects.instances.instancePartitions/create' },
  // 공급자 · 키는 workforcePools/{pool}/providers 아래 — 유일 범위 문장은 없다(규칙 notes)
  'gcp:workforce_pool': { id: 'gcp:workforce_pool', provider: 'gcp', displayName: 'Workforce pool', parent: 'gcp:namespace', ruleId: 'gcp.iam_workforce_pool', docUrl: IAM_V1_DISCOVERY },
  // 관리 ID · 네임스페이스 · 공급자 · 키는 workloadIdentityPools/{pool} 아래 — 유일 범위 문장은 없다(규칙 notes)
  'gcp:workload_identity_pool': { id: 'gcp:workload_identity_pool', provider: 'gcp', displayName: 'Workload identity pool', parent: 'gcp:project_location', ruleId: 'gcp.iam_workload_identity_pool', docUrl: IAM_V1_DISCOVERY },
  // 다운로드 규칙 "The name must be unique within your repository" — 저장소(repositoryId) 규칙은 원문이 없어 보류라 ruleId 가 없다
  'gcp:artifact_registry_repository': { id: 'gcp:artifact_registry_repository', provider: 'gcp', displayName: 'Artifact Registry repository', parent: 'gcp:project_location', docUrl: AR_DOWNLOAD_RULES },
};

const RULES: ResourceRule[] = [
  // ── Compute Engine — 디스커버리에 pattern 칸이 없거나 RFC1035 꼴이 아니었던 insert ──
  // schemas.NodeGroup.properties.name "The resource name must be 1-63 characters long, and comply withRFC1035. … match the regular expression `[a-z]([-a-z0-9]*[a-z0-9])?`" · compute.nodeGroups.insert = zones/{zone}
  rule({ id: 'gcp.node_group', displayName: 'Node Group', slug: 'ng', minLength: 1, maxLength: 63, pattern: RFC1035, scope: 'gcp:project_zone', entity: 'compute.nodeGroups', category: 'compute', docUrl: COMPUTE_DISCOVERY }),
  // schemas.NodeTemplate.properties.name (같은 문장) · compute.nodeTemplates.insert = regions/{region}
  rule({ id: 'gcp.node_template', displayName: 'Node Template', slug: 'nt', minLength: 1, maxLength: 63, pattern: RFC1035, scope: 'gcp:project_region', entity: 'compute.nodeTemplates', category: 'compute', docUrl: COMPUTE_DISCOVERY }),
  // schemas.NetworkEndpointGroup.properties.name "The name must be 1-63 characters long, and comply withRFC1035. … match the regular expression `[a-z]([-a-z0-9]*[a-z0-9])?`" — insert 셋(zone · region · global)
  rule({ id: 'gcp.network_endpoint_group', displayName: 'Network Endpoint Group', slug: 'neg', minLength: 1, maxLength: 63, pattern: RFC1035, scope: 'gcp:project_zone', entity: 'compute.networkEndpointGroups', category: 'networking', docUrl: COMPUTE_DISCOVERY }),
  rule({ id: 'gcp.region_network_endpoint_group', displayName: 'Region Network Endpoint Group', slug: 'neg', minLength: 1, maxLength: 63, pattern: RFC1035, scope: 'gcp:project_region', entity: 'compute.regionNetworkEndpointGroups', category: 'networking', docUrl: COMPUTE_DISCOVERY }),
  rule({ id: 'gcp.global_network_endpoint_group', displayName: 'Global Network Endpoint Group', slug: 'neg', minLength: 1, maxLength: 63, pattern: RFC1035, scope: 'gcp:project_global', entity: 'compute.globalNetworkEndpointGroups', category: 'networking', docUrl: COMPUTE_DISCOVERY }),

  // ── Firestore ──
  // "This value should be 4-63 characters. Valid characters are /[a-z][0-9]-/ with first character a letter and the last a letter or a number. Must not be UUID-like /[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/."
  // `/[a-z][0-9]-/` 는 문자 집합 셋([a-z] · [0-9] · -)의 나열로 읽는다. `(default)` 는 생성할 값이 아니라 받지 않는다
  rule({ id: 'gcp.firestore_database', displayName: 'Firestore Database', slug: 'fs', minLength: 4, maxLength: 63,
    pattern: /^(?![0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$)[a-z][a-z0-9-]{2,61}[a-z0-9]$/,
    scope: 'gcp:project', entity: 'firestore.databases', category: 'database', docUrl: 'https://cloud.google.com/firestore/docs/reference/rest/v1/projects.databases/create' }),

  // ── Spanner — 디스커버리 설명은 대괄호가 깨졌다(`a-z*[a-z0-9]`). REST 참조 쪽 원문을 쓴다 ──
  // "Valid identifiers are of the form [a-z][-a-z0-9]*[a-z0-9] and must be between 2 and 64 characters in length." · 안내서 "The instance ID must also be unique within your Google Cloud project."
  rule({ id: 'gcp.spanner_instance', displayName: 'Spanner Instance', slug: 'spn', minLength: 2, maxLength: 64, pattern: SPANNER_ID, scope: 'gcp:project', entity: 'spanner.instances', category: 'database', docUrl: 'https://cloud.google.com/spanner/docs/reference/rest/v1/projects.instances/create' }),
  // "Valid identifiers are of the form `custom-[-a-z0-9]*[a-z0-9]` and must be between 2 and 64 characters in length. The `custom-` prefix is required" · quotas "Custom instance configuration ID length 8 to 64 characters"
  // custom- 접두를 slug 로 맨 앞에 둔다
  rule({ id: 'gcp.spanner_instance_config', displayName: 'Spanner Instance Config', slug: 'custom', minLength: 8, maxLength: 64, pattern: /^custom-(?:[-a-z0-9]{0,56}[a-z0-9])$/,
    startsWithLetter: false, endsWithAlnum: false, template: ['slug', 'system', 'purpose', 'env'], scope: 'gcp:project', entity: 'spanner.instanceConfigs', category: 'database', docUrl: 'https://cloud.google.com/spanner/quotas' }),
  // "Valid identifiers are of the form [a-z][-a-z0-9]*[a-z0-9] and must be between 2 and 64 characters in length." · "The instance partition ID must also be unique within your instance."
  rule({ id: 'gcp.spanner_instance_partition', displayName: 'Spanner Instance Partition', slug: 'ip', minLength: 2, maxLength: 64, pattern: SPANNER_ID, scope: 'gcp:spanner_instance', entity: 'spanner.instances.instancePartitions', category: 'database', docUrl: 'https://cloud.google.com/spanner/docs/reference/rest/v1/projects.instances.instancePartitions/create' }),
  // "The database ID must conform to the regular expression [a-z][a-z0-9_\-]*[a-z0-9] and be between 2 and 30 characters in length."
  rule({ id: 'gcp.spanner_database', displayName: 'Spanner Database', slug: 'db', minLength: 2, maxLength: 30, pattern: /^[a-z][a-z0-9_-]{0,28}[a-z0-9]$/, scope: 'gcp:spanner_instance', entity: 'spanner.instances.databases', category: 'database', docUrl: 'https://cloud.google.com/spanner/docs/reference/rest/v1/projects.instances.databases/create' }),
  // Backup.name "Values are of the form projects/<project>/instances/<instance>/backups/[a-z][a-z0-9_\-]*[a-z0-9] The final segment of the name must be between 2 and 60 characters in length."
  rule({ id: 'gcp.spanner_backup', displayName: 'Spanner Backup', slug: 'bkp', minLength: 2, maxLength: 60, pattern: /^[a-z][a-z0-9_-]{0,58}[a-z0-9]$/, scope: 'gcp:spanner_instance', entity: 'spanner.instances.backups', category: 'database', docUrl: 'https://cloud.google.com/spanner/docs/reference/rest/v1/projects.instances.backups' }),

  // ── GKE ──
  // schemas.Cluster.properties.name "The name must be unique within this project and location (e.g. zone or region), and can be up to 40 characters with the following restrictions: * Lowercase letters, numbers, and hyphens only. * Must start with a letter. * Must end with a number or a letter."
  rule({ id: 'gcp.gke_cluster', displayName: 'GKE Cluster', slug: 'gke', minLength: 1, maxLength: 40, pattern: /^[a-z](?:[a-z0-9-]{0,38}[a-z0-9])?$/, scope: 'gcp:project_location', entity: 'container.clusters', category: 'containers', docUrl: 'https://www.googleapis.com/discovery/v1/apis/container/v1/rest' }),

  // ── Artifact Registry ──
  // 다운로드 규칙 gcloud "RULE_NAME: the name of the rule. The name must be unique within your repository, have a max length of 256 characters, and consist of alpha-numeric characters, percent-encoded characters, or characters in the list [-, ., _, ~, :, @, +, ^]."
  // 디스커버리 rules.create ruleId 는 "The rule id to use for this repository." 뿐이다. 최소 길이 문장이 없어 1 로 둔다. 생성은 영숫자 · - · _ 만 쓴다(나머지 문자는 검증만 받는다)
  rule({ id: 'gcp.artifact_registry_rule', displayName: 'Artifact Registry Rule', slug: 'rule', minLength: 1, maxLength: 256, pattern: /^(?:[A-Za-z0-9._~:@+^-]|%[0-9A-Fa-f]{2})+$/,
    allowed: 'alnum-hyphen-underscore', caseRule: 'any', startsWithLetter: false, endsWithAlnum: false, scope: 'gcp:artifact_registry_repository', entity: 'artifactregistry.repositories.rules', category: 'containers', docUrl: AR_DOWNLOAD_RULES, notes: [NARROWER] }),

  // ── Cloud Functions ──
  // 1세대 "The function name must start with a letter followed by up to 62 letters, numbers, hyphens, or underscores, and must end with a letter or a number." · discovery v1 "Function names must be unique globally and match pattern `projects/*/locations/*/functions/*`"
  rule({ id: 'gcp.cloud_function_gen1', displayName: 'Cloud Function (1st gen)', slug: 'fn', minLength: 1, maxLength: 63, pattern: /^[A-Za-z](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9])?$/,
    allowed: 'alnum-hyphen-underscore', caseRule: 'any', scope: 'gcp:project_location', entity: 'cloudfunctions.v1.functions', category: 'compute', docUrl: 'https://cloud.google.com/functions/1stgendocs/deploy' }),
  // REST v2 "This value should be 4-63 characters, and valid characters are /[a-z][0-9]-/." · 배포 안내서 "The function name must start with a letter followed by up to 62 letters, numbers, hyphens, or underscores, and must end with a letter or a number."
  // 두 원문의 교집합 — 대문자 · 밑줄 · 4자 미만을 더 거부한다
  rule({ id: 'gcp.cloud_function', displayName: 'Cloud Function (2nd gen)', slug: 'fn', minLength: 4, maxLength: 63, pattern: /^[a-z][a-z0-9-]{2,61}[a-z0-9]$/,
    scope: 'gcp:project_location', entity: 'cloudfunctions.v2.functions', category: 'compute', docUrl: 'https://cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/create', notes: [NARROWER, SCOPE] }),

  // ── IAM ──
  // "This value should be a string of 6 to 63 lowercase letters, digits, or hyphens. It must start with a letter, and cannot have a trailing hyphen. The prefix `gcp-` is reserved for use by Google, and may not be specified."
  rule({ id: 'gcp.iam_oauth_client', displayName: 'IAM OAuth Client', slug: 'oc', minLength: 6, maxLength: 63, pattern: IAM_6_63, forbidden: GCP_PREFIX, scope: 'gcp:project_location', entity: 'iam.oauthClients', category: 'identity', docUrl: IAM_V1_DISCOVERY, notes: [SCOPE] }),
  // "This value should be 4-32 characters, and may contain the characters [a-z0-9-]. The prefix `gcp-` is reserved for use by Google, and may not be specified." — 클라이언트 아래지만 범위 문장이 없어 위치에 둔다
  rule({ id: 'gcp.iam_oauth_client_credential', displayName: 'IAM OAuth Client Credential', slug: 'occ', minLength: 4, maxLength: 32, pattern: IAM_4_32, forbidden: GCP_PREFIX, startsWithLetter: false, endsWithAlnum: false, scope: 'gcp:project_location', entity: 'iam.oauthClients.credentials', category: 'identity', docUrl: IAM_V1_DISCOVERY, notes: [SCOPE] }),
  // REST v3 "This value must start with a lowercase letter followed by up to 62 lowercase letters, numbers, hyphens, or dots. Pattern, /[a-z][a-z0-9-.]{2,62}/." — 문장은 1-63, 정규식은 3-63: 좁은 쪽
  rule({ id: 'gcp.iam_policy_binding', displayName: 'IAM Policy Binding', slug: 'pb', minLength: 3, maxLength: 63, pattern: IAM_V3_ID, endsWithAlnum: false, scope: 'gcp:project_location', entity: 'iam.policyBindings', category: 'identity', docUrl: 'https://cloud.google.com/iam/docs/reference/rest/v3/projects.locations.policyBindings/create', notes: [NARROWER, SCOPE] }),
  // REST v3 "… Pattern, /[a-z][a-z0-9-.]{2,62}/." (PolicyBinding 과 같은 문장) — 조직 아래라 프로젝트 밖 전역 노드에 둔다
  rule({ id: 'gcp.iam_principal_access_boundary_policy', displayName: 'IAM Principal Access Boundary Policy', slug: 'pab', minLength: 3, maxLength: 63, pattern: IAM_V3_ID, endsWithAlnum: false, scope: 'gcp:namespace', entity: 'iam.principalAccessBoundaryPolicies', category: 'identity', docUrl: 'https://cloud.google.com/iam/docs/reference/rest/v3/organizations.locations.principalAccessBoundaryPolicies/create', notes: [NARROWER, SCOPE] }),
  // v2 "The ID must contain 3 to 63 characters. It can contain lowercase letters and numbers, as well as dashes (`-`) and periods (`.`). The first character must be a lowercase letter."
  rule({ id: 'gcp.iam_deny_policy', displayName: 'IAM Deny Policy', slug: 'deny', minLength: 3, maxLength: 63, pattern: IAM_V3_ID, endsWithAlnum: false, scope: 'gcp:project', entity: 'iam.policies', category: 'identity', docUrl: 'https://iam.googleapis.com/$discovery/rest?version=v2', notes: [SCOPE] }),
  // schemas.CreateRoleRequest.properties.roleId "A role ID may contain alphanumeric characters, underscores (`_`), and periods (`.`). It must contain a minimum of 3 characters and a maximum of 64 characters." — 하이픈이 없어 붙여 쓴다
  rule({ id: 'gcp.iam_custom_role', displayName: 'IAM Custom Role', slug: 'role', minLength: 3, maxLength: 64, pattern: /^[A-Za-z0-9_.]{3,64}$/,
    allowed: 'lower-digit', separator: '', startsWithLetter: false, endsWithAlnum: false, template: NOSEP, scope: 'gcp:project', entity: 'iam.roles', category: 'identity', docUrl: IAM_V1_DISCOVERY, notes: [SCOPE] }),
  // "The IDs must be a globally unique string of 6 to 63 lowercase letters, digits, or hyphens. It must start with a letter, and cannot have a trailing hyphen. The prefix `gcp-` is reserved for use by Google, and may not be specified."
  rule({ id: 'gcp.iam_workforce_pool', displayName: 'IAM Workforce Pool', slug: 'wfp', minLength: 6, maxLength: 63, pattern: IAM_6_63, forbidden: GCP_PREFIX, scope: 'gcp:namespace', entity: 'iam.workforcePools', category: 'identity', docUrl: IAM_V1_DISCOVERY }),
  // "This value must be 4-32 characters, and may contain the characters `[a-z0-9-]`. The prefix `gcp-` is reserved for use by Google, and may not be specified."
  rule({ id: 'gcp.iam_workforce_pool_provider', displayName: 'IAM Workforce Pool Provider', slug: 'wpp', minLength: 4, maxLength: 32, pattern: IAM_4_32, forbidden: GCP_PREFIX, startsWithLetter: false, endsWithAlnum: false, scope: 'gcp:workforce_pool', entity: 'iam.workforcePools.providers', category: 'identity', docUrl: IAM_V1_DISCOVERY, notes: [SCOPE] }),
  // "This value must be 4-32 characters, and may contain the characters `[a-z0-9-]`." — 공급자 아래지만 범위 문장이 없어 풀에 둔다
  rule({ id: 'gcp.iam_workforce_pool_provider_key', displayName: 'IAM Workforce Pool Provider Key', slug: 'key', minLength: 4, maxLength: 32, pattern: IAM_4_32, startsWithLetter: false, endsWithAlnum: false, scope: 'gcp:workforce_pool', entity: 'iam.workforcePools.providers.keys', category: 'identity', docUrl: IAM_V1_DISCOVERY, notes: [SCOPE] }),
  // "This value should be 4-32 characters, and may contain the characters [a-z0-9-]. The prefix `gcp-` is reserved for use by Google, and may not be specified."
  rule({ id: 'gcp.iam_workload_identity_pool', displayName: 'IAM Workload Identity Pool', slug: 'wip', minLength: 4, maxLength: 32, pattern: IAM_4_32, forbidden: GCP_PREFIX, startsWithLetter: false, endsWithAlnum: false, scope: 'gcp:project_location', entity: 'iam.workloadIdentityPools', category: 'identity', docUrl: IAM_V1_DISCOVERY, notes: [SCOPE] }),
  // "This value must: * contain at most 63 characters * contain only lowercase alphanumeric characters or `-` * start with an alphanumeric character * end with an alphanumeric character The prefix "gcp-" will be reserved for future uses."
  // gcp- 는 「앞으로 예약」 — 지금부터 거부한다
  rule({ id: 'gcp.iam_wip_managed_identity', displayName: 'IAM Workload Identity Pool Managed Identity', slug: 'mi', minLength: 1, maxLength: 63, pattern: IAM_63, forbidden: GCP_PREFIX, startsWithLetter: false, scope: 'gcp:workload_identity_pool', entity: 'iam.workloadIdentityPools.namespaces.managedIdentities', category: 'identity', docUrl: IAM_V1_DISCOVERY, notes: [ADVISORY, SCOPE] }),
  // (ManagedIdentity 와 같은 문장)
  rule({ id: 'gcp.iam_wip_namespace', displayName: 'IAM Workload Identity Pool Namespace', slug: 'ns', minLength: 1, maxLength: 63, pattern: IAM_63, forbidden: GCP_PREFIX, startsWithLetter: false, scope: 'gcp:workload_identity_pool', entity: 'iam.workloadIdentityPools.namespaces', category: 'identity', docUrl: IAM_V1_DISCOVERY, notes: [ADVISORY, SCOPE] }),
  // "This value must be 4-32 characters, and may contain the characters [a-z0-9-]. The prefix `gcp-` is reserved for use by Google, and may not be specified."
  rule({ id: 'gcp.iam_wip_provider', displayName: 'IAM Workload Identity Pool Provider', slug: 'wpp', minLength: 4, maxLength: 32, pattern: IAM_4_32, forbidden: GCP_PREFIX, startsWithLetter: false, endsWithAlnum: false, scope: 'gcp:workload_identity_pool', entity: 'iam.workloadIdentityPools.providers', category: 'identity', docUrl: IAM_V1_DISCOVERY, notes: [SCOPE] }),
  // "This value should be 4-32 characters, and may contain the characters [a-z0-9-]." — 공급자 아래지만 범위 문장이 없어 풀에 둔다
  rule({ id: 'gcp.iam_wip_provider_key', displayName: 'IAM Workload Identity Pool Provider Key', slug: 'key', minLength: 4, maxLength: 32, pattern: IAM_4_32, startsWithLetter: false, endsWithAlnum: false, scope: 'gcp:workload_identity_pool', entity: 'iam.workloadIdentityPools.providers.keys', category: 'identity', docUrl: IAM_V1_DISCOVERY, notes: [SCOPE] }),

  // ── Secret Manager ──
  // "This must be unique within the project. A secret ID is a string with a maximum length of 255 characters and can contain uppercase and lowercase letters, numerals, and the hyphen (`-`) and underscore (`_`) characters."
  rule({ id: 'gcp.secret', displayName: 'Secret Manager Secret', slug: 'secret', minLength: 1, maxLength: 255, pattern: /^[A-Za-z0-9_-]{1,255}$/,
    allowed: 'alnum-hyphen-underscore', caseRule: 'any', startsWithLetter: false, endsWithAlnum: false, scope: 'gcp:project', entity: 'secretmanager.secrets', category: 'security', docUrl: 'https://www.googleapis.com/discovery/v1/apis/secretmanager/v1/rest' }),
];

export const GCP_MANUAL_RULES: Record<string, ResourceRule> = Object.fromEntries(RULES.map((r) => [r.id, r]));
