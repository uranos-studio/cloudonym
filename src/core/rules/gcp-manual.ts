// 손으로 넣은 GCP 규칙 (D43) — 생성기가 정형으로 읽지 못한 행을 공식 문서에서 한 줄씩 읽고 옮겼다.
// 행마다 위 주석이 근거 URL 과 원문 인용이다. 보수적으로 좁힌 행은 notes 에 무엇을 더 거부하는지 코드로 싣는다 (D20).
// rules/gcp.ts 가 손 규칙 · 들인 행과 합친다.
import type { CoreMessage } from '../messages';
import type { ResourceRule, RuleEvidence, Token } from '../types';
import type { ScopeDef } from '../scopes';

const COMPUTE_DISCOVERY = 'https://www.googleapis.com/discovery/v1/apis/compute/v1/rest';
const IAM_V1_DISCOVERY = 'https://www.googleapis.com/discovery/v1/apis/iam/v1/rest';
const AR_DOWNLOAD_RULES = 'https://docs.cloud.google.com/artifact-registry/docs/restrict-artifact-downloads#gcloud';
const ROUTERS_REST = 'https://docs.cloud.google.com/compute/docs/reference/rest/v1/routers#Router.FIELDS.inlinedField_48';
const RFC1035 = /^[a-z](?:[-a-z0-9]{0,61}[a-z0-9])?$/;
const SPANNER_ID = /^[a-z][-a-z0-9]{0,62}[a-z0-9]$/;
const IAM_V3_ID = /^[a-z][a-z0-9.-]{2,62}$/;
const IAM_4_32 = /^[a-z0-9-]{4,32}$/;
const IAM_6_63 = /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/;
const IAM_63 = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const GCP_PREFIX = { prefixes: ['gcp-'] };
const PUBSUB_ID = /^[A-Za-z][A-Za-z0-9_.~+%-]{2,254}$/;
const PUBSUB_NAMES = 'https://docs.cloud.google.com/pubsub/docs/pubsub-basics#resource_names';

const AR_CREATE_REPOS = 'https://docs.cloud.google.com/artifact-registry/docs/repositories/create-repos';
const RUN_CREATE_JOBS = 'https://docs.cloud.google.com/run/docs/create-jobs';
/** 문서 문장이 없어 SDK 검증 코드 · 서버 응답으로 정한 규칙의 근거 (D80) — 프로젝트 ID 는 <project> */
const RUN_JOB_EVIDENCE: readonly RuleEvidence[] = [
  { kind: 'api_error', source: 'POST https://run.googleapis.com/v2/projects/<project>/locations/asia-northeast3/jobs?jobId=<id>&validateOnly=true', date: '2026-10-12',
    quote: 'Violation in CreateJobRequest.job_id: only lowercase, digits, and hyphens; must begin with letter, cannot end with hyphen. Must be no longer than 63 characters.' },
  { kind: 'sdk', source: 'Google Cloud SDK 588.0.0 googlecloudsdk/command_lib/run/flags.py ValidateResource', date: '2026-10-12',
    quote: '(?=^[a-z0-9-]{1,63}$)(?!^\\-.*)(?!.*\\-$)' },
];
const AR_REPOSITORY_EVIDENCE: readonly RuleEvidence[] = [
  { kind: 'api_error', source: 'POST https://artifactregistry.googleapis.com/v1/projects/<project>/locations/asia-northeast3/repositories?repositoryId=<id>', date: '2026-10-12',
    quote: 'Invalid repository ID: "<id>" for Abc, a_b, a.b, a-, -a, 1abc and 64 or 100 characters; a, a1, a-1, a--b and 49, 50 or 63 characters pass the ID check; a 63-character DOCKER repository was created and deleted' },
];

const CB_CONNECTIONS_CREATE = 'https://docs.cloud.google.com/build/docs/api/reference/rest/v2/projects.locations.connections/create#body.QUERY_PARAMETERS.connection_id';
/** Cloud Build 2세대 연결 (D118) — 문서는 글자 · 유일 범위만 적었다. 길이는 서버 응답으로 정한다 */
const CB_CONNECTION_EVIDENCE: readonly RuleEvidence[] = [
  { kind: 'api_error', source: 'POST https://cloudbuild.googleapis.com/v2/projects/<project>/locations/asia-northeast3/connections?connectionId=<id>', date: '2026-10-16',
    quote: "Resource name should match regex ^projects/((?:[^:]+:.)?[a-z0-9\\\\-]+)/locations/([\\w-]{2,40})/connections/([a-zA-Z0-9-._~%!$&'()*+,;=@]{1,200})$ (make sure connection_id is 200 chars or less) — for 201 and 300 characters; a, Abc, 1abc, -a, a-, a_b, a.b and 200 characters were created; a:b, 'a b' and a#b answered Malformed name" },
  { kind: 'api_error', source: 'GET https://cloudbuild.googleapis.com/v2/projects/<project>/locations/<location>/connections/<id>', date: '2026-10-16',
    quote: "Malformed name: … (gcloud: Resource path is longer than allowed) once the ID and the location name together pass 181 characters — 166 + asia-northeast3, 173 + us-east1, 169 + europe-west1, 158 + northamerica-northeast2 answer 404; one more character answers 400. A 200-character connection that create accepted could not be read or deleted" },
  { kind: 'api_error', source: 'POST https://cloudbuild.googleapis.com/v2/projects/<project>/locations/asia-northeast3/connections/<connection>/repositories?repositoryId=<id>', date: '2026-10-17',
    quote: "resource name 'projects/<number>/locations/asia-northeast3/connections/<connection>/repositories/<id>' length (201) exceeds the limit 200 — with a 25-character connection a 101-character ID passes the ID check (the next error is remote_uri must be specified) and 102 is refused, so connection + repository + location name may total 141 with a 12-digit project number; 201 characters answer the regex ([a-zA-Z0-9-._~%!$&'()*+,;=@]{1,200}); a, Abc, 1abc, -a, a-, a_b, a.b pass and a:b, 'a b', a#b answer Malformed name" },
];
const CB_REPOSITORIES_CREATE = 'https://docs.cloud.google.com/build/docs/api/reference/rest/v2/projects.locations.connections.repositories/create#body.QUERY_PARAMETERS.repository_id';
/** Cloud Build 2세대 저장소 (D119) — 연결과 같은 만들기 한계를 나눠 쓴다 */
const CB_REPOSITORY_EVIDENCE: readonly RuleEvidence[] = [
  { kind: 'api_error', source: 'POST https://cloudbuild.googleapis.com/v2/projects/<project>/locations/asia-northeast3/connections/<connection>/repositories?repositoryId=<id>', date: '2026-10-17',
    quote: "resource name 'projects/<number>/locations/asia-northeast3/connections/<connection>/repositories/<id>' length (201) exceeds the limit 200 — with a 25-character connection a 101-character ID passes the ID check (the next error is remote_uri must be specified) and 102 is refused, so connection + repository + location name may total 141 with a 12-digit project number; 201 characters answer the regex ([a-zA-Z0-9-._~%!$&'()*+,;=@]{1,200}); a, Abc, 1abc, -a, a-, a_b, a.b pass and a:b, 'a b', a#b answer Malformed name" },
  { kind: 'api_error', source: 'GET https://cloudbuild.googleapis.com/v2/projects/<project>/locations/<location>/connections/<connection>/repositories/<id>', date: '2026-10-16',
    quote: 'Malformed name: … once repository + connection + location name pass 180 characters (164 with a 1-character connection in asia-northeast3, 155 with a 10-character one, 171 in us-east1) — wider than the create limit' },
];

const BQ_TABLE_ID = 'https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/TableReference#FIELDS.table_id';
const BQ_TABLE_NAMING = 'https://docs.cloud.google.com/bigquery/docs/tables#table_naming';

const SCOPE: CoreMessage = { code: 'note.scope_unconfirmed' };
const OBSERVED: CoreMessage = { code: 'note.observed_server_rule' };
const NARROWER: CoreMessage = { code: 'note.narrower_source_used' };
const ADVISORY: CoreMessage = { code: 'note.advisory_rule_enforced' };
const SECONDARY: CoreMessage = { code: 'note.secondary_source' };

const PLACED: Token[] = ['system', 'purpose', 'env', 'region', 'slug', 'seq'];
/** 지역이 없는 순번 꼴 — 프로젝트에 하나인 리소스(Pub/Sub · DNS 영역) */
const UNPLACED: Token[] = ['system', 'purpose', 'env', 'slug', 'seq'];
/** 역할 꼴 — 서비스 계정처럼 순번 대신 역할(sync …)이 구별자다 */
const ROLE: Token[] = ['system', 'purpose', 'env', 'region', 'slug', 'role'];
/** 밑줄로 잇는 규칙(D72) — 하이픈을 받지 않는 BigQuery dataset · Cloud SQL database · user */
const UNDERSCORE = { allowed: 'lower-digit-underscore', separator: '_', endsWithAlnum: false } as const;
/** Cloud SQL 의 데이터베이스 · 사용자 이름 — 세 엔진의 따옴표 없는 식별자 규칙의 교집합(소문자로 시작 · 소문자 · 숫자 · 밑줄).
 *  MySQL "Permitted characters in unquoted identifiers: ASCII: [0-9,a-z,A-Z$_]" (https://dev.mysql.com/doc/refman/8.4/en/identifiers.html)
 *  PostgreSQL "SQL identifiers and key words must begin with a letter … or an underscore (_). Subsequent characters … can be letters, underscores, digits (0-9), or dollar signs ($)."
 *    · "unquoted names are always folded to lower case" (https://www.postgresql.org/docs/current/sql-syntax-lexical.html)
 *  SQL Server "they can only contain letters, digits, and certain symbols (_, @, #, $), must start with a letter or one of _, @, #"
 *    (https://learn.microsoft.com/en-us/sql/relational-databases/databases/database-identifiers) — 셋 다 하이픈이 없다.
 *  소문자만 받는 것 · 밑줄로 시작하지 않는 것은 보수적으로 좁힌 것이다(NARROWER) */
const SQL_IDENT = (max: number) => new RegExp(`^[a-z][a-z0-9_]{0,${max - 1}}$`);
const SQL_DOCS = 'https://docs.cloud.google.com/sql/docs/mysql/create-manage-databases#create';
const SQL_USERS = 'https://docs.cloud.google.com/sql/docs/mysql/create-manage-users#create-user';
const NOSEP: Token[] = ['slug', 'system', 'purpose', 'env'];

type Spec = Pick<ResourceRule, 'id' | 'displayName' | 'slug' | 'minLength' | 'maxLength' | 'pattern' | 'scope' | 'entity' | 'category' | 'docUrl'>
  & Partial<Pick<ResourceRule, 'forbidden' | 'allowed' | 'separator' | 'caseRule' | 'startsWithLetter' | 'endsWithAlnum' | 'template' | 'notes' | 'uniquenessDocUrl' | 'defaultLocation' | 'evidence'>>;

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
export type GcpManualScopeId = 'gcp:spanner_instance' | 'gcp:workforce_pool' | 'gcp:workload_identity_pool' | 'gcp:artifact_registry_repository' | 'gcp:cloud_sql_instance' | 'gcp:router' | 'gcp:cloudbuild_connection' | 'gcp:bigquery_dataset';
export const GCP_MANUAL_SCOPES: Record<GcpManualScopeId, ScopeDef> = {
  // "The instance partition ID must also be unique within your instance." (Spanner 안내서) · Backup.name 은 instances/<instance>/backups/ 아래
  'gcp:spanner_instance': { id: 'gcp:spanner_instance', provider: 'gcp', displayName: 'Spanner instance', parent: 'gcp:project', ruleId: 'gcp.spanner_instance', docUrl: 'https://cloud.google.com/spanner/docs/reference/rest/v1/projects.instances.instancePartitions/create' },
  // 공급자 · 키는 workforcePools/{pool}/providers 아래 — 유일 범위 문장은 없다(규칙 notes)
  'gcp:workforce_pool': { id: 'gcp:workforce_pool', provider: 'gcp', displayName: 'Workforce pool', parent: 'gcp:namespace', ruleId: 'gcp.iam_workforce_pool', docUrl: IAM_V1_DISCOVERY },
  // 관리 ID · 네임스페이스 · 공급자 · 키는 workloadIdentityPools/{pool} 아래 — 유일 범위 문장은 없다(규칙 notes)
  'gcp:workload_identity_pool': { id: 'gcp:workload_identity_pool', provider: 'gcp', displayName: 'Workload identity pool', parent: 'gcp:project_location', ruleId: 'gcp.iam_workload_identity_pool', docUrl: IAM_V1_DISCOVERY },
  // 다운로드 규칙 "The name must be unique within your repository" — 저장소 규칙은 gcp.artifact_registry_repository (D80)
  'gcp:artifact_registry_repository': { id: 'gcp:artifact_registry_repository', provider: 'gcp', displayName: 'Artifact Registry repository', parent: 'gcp:project_location', ruleId: 'gcp.artifact_registry_repository', docUrl: AR_DOWNLOAD_RULES },
  // Database.name "The name of the database in the Cloud SQL instance. This does not include the project ID or instance name." · User.name 같은 꼴 —
  // 데이터베이스 · 사용자는 인스턴스 아래다. 유일 범위 문장은 없다(규칙 notes)
  'gcp:cloud_sql_instance': { id: 'gcp:cloud_sql_instance', provider: 'gcp', displayName: 'Cloud SQL instance', parent: 'gcp:project', ruleId: 'gcp.cloud_sql_instance', docUrl: 'https://docs.cloud.google.com/sql/docs/mysql/admin-api/rest/v1/databases#Database.FIELDS.name' },
  // Router.nats[].name "Unique name of this Nat service. The name must be 1-63 characters long and comply with RFC1035." — NAT 는 라우터 안의 칸이다
  'gcp:router': { id: 'gcp:router', provider: 'gcp', displayName: 'Cloud Router', parent: 'gcp:project_region', ruleId: 'gcp.router', docUrl: ROUTERS_REST },
  // repositories.create repositoryId "This ID should be unique in the connection." — 저장소는 연결 아래다 (D119)
  'gcp:cloudbuild_connection': { id: 'gcp:cloudbuild_connection', provider: 'gcp', displayName: 'Cloud Build connection', parent: 'gcp:project_location', ruleId: 'gcp.cloudbuild_connection', docUrl: CB_REPOSITORIES_CREATE },
  // 안내서 "When you create a table in BigQuery, the table name must be unique per dataset." — 테이블 · 뷰는 데이터세트 아래다 (D132)
  'gcp:bigquery_dataset': { id: 'gcp:bigquery_dataset', provider: 'gcp', displayName: 'BigQuery dataset', parent: 'gcp:project', ruleId: 'gcp.bigquery_dataset', docUrl: BQ_TABLE_NAMING },
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
  rule({ id: 'gcp.spanner_database', displayName: 'Spanner Database', slug: 'spdb', minLength: 2, maxLength: 30, pattern: /^[a-z][a-z0-9_-]{0,28}[a-z0-9]$/, scope: 'gcp:spanner_instance', entity: 'spanner.instances.databases', category: 'database', docUrl: 'https://cloud.google.com/spanner/docs/reference/rest/v1/projects.instances.databases/create' }),
  // Backup.name "Values are of the form projects/<project>/instances/<instance>/backups/[a-z][a-z0-9_\-]*[a-z0-9] The final segment of the name must be between 2 and 60 characters in length."
  rule({ id: 'gcp.spanner_backup', displayName: 'Spanner Backup', slug: 'bkp', minLength: 2, maxLength: 60, pattern: /^[a-z][a-z0-9_-]{0,58}[a-z0-9]$/, scope: 'gcp:spanner_instance', entity: 'spanner.instances.backups', category: 'database', docUrl: 'https://cloud.google.com/spanner/docs/reference/rest/v1/projects.instances.backups' }),

  // ── GKE ──
  // schemas.Cluster.properties.name "The name must be unique within this project and location (e.g. zone or region), and can be up to 40 characters with the following restrictions: * Lowercase letters, numbers, and hyphens only. * Must start with a letter. * Must end with a number or a letter."
  rule({ id: 'gcp.gke_cluster', displayName: 'GKE Cluster', slug: 'gke', minLength: 1, maxLength: 40, pattern: /^[a-z](?:[a-z0-9-]{0,38}[a-z0-9])?$/, scope: 'gcp:project_location', entity: 'container.clusters', category: 'containers', docUrl: 'https://www.googleapis.com/discovery/v1/apis/container/v1/rest' }),

  // ── Artifact Registry ──
  // 저장소 (D80) — 안내서 · REST 참조 · gcloud 어디에도 길이 · 문자 문장이 없다("Required. The repository id to use for this repository."). 유일 범위만 있다:
  // 안내서 "For each repository location in a project, repository names must be unique." gcloud 는 선언형이라 클라이언트 검증이 없다 — 서버 응답만 근거다.
  // 2026-10-12 탐침(repositories.create, 본문 format FORMAT_UNSPECIFIED — 이름 검사가 format 검사보다 먼저다): Abc · a_b · a.b · a- · -a · 1abc · 64자 · 100자는
  // `Invalid repository ID: "<id>"`, a · a1 · a-1 · a--b · 49 · 50 · 63자는 format 오류(이름 통과). 63자는 DOCKER 로 실제로 만들고 지웠다. 서버 규칙 = RFC1035 꼴 1-63
  rule({ id: 'gcp.artifact_registry_repository', displayName: 'Artifact Registry Repository', slug: 'ar', minLength: 1, maxLength: 63, pattern: RFC1035,
    scope: 'gcp:project_location', entity: 'artifactregistry.repositories', category: 'containers', docUrl: AR_CREATE_REPOS, evidence: AR_REPOSITORY_EVIDENCE, notes: [OBSERVED] }),
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

  // ── Cloud Run (D65) ──
  // REST v2 services.create serviceId "It must begin with letter, and cannot end with hyphen; must contain fewer than 50 characters."
  // 배포 안내서 (https://docs.cloud.google.com/run/docs/deploying) "Service names must be 49 characters or less and must be unique per region and project."
  // 두 쪽 모두 문자 집합을 적지 않는다 — 보조 출처: Cloud Service Mesh 의 Cloud Run API 참조 CloudRunBackend.service
  // (https://docs.cloud.google.com/service-mesh/v1.28/docs/cloud-run-api-reference#gcpbackend-api) "CloudRun service name. Must be between 1 and 49 characters, follow a specific pattern, and consist only of lowercase letters, hyphens, and numbers."
  // 「a specific pattern」은 적혀 있지 않아 RFC 1035 꼴(소문자로 시작 · 영숫자로 끝)로 잡는다 — 한 글자 a 도 통과(적힌 최소 1)
  rule({ id: 'gcp.run_service', displayName: 'Cloud Run Service', slug: 'run', minLength: 1, maxLength: 49, pattern: /^[a-z]([a-z0-9-]*[a-z0-9])?$/,
    scope: 'gcp:project_location', entity: 'run.services', category: 'compute', docUrl: 'https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services/create',
    uniquenessDocUrl: 'https://docs.cloud.google.com/run/docs/deploying', notes: [SECONDARY] }),

  // Job (D80) — REST v2 jobs.create jobId 는 "The unique identifier for the Job." 뿐이고 안내서는 "After you submit the form, you can't edit the name of the job." ·
  // "The sum of job name and token length must be fewer than 63 characters." 만 적는다. 서버 응답(validateOnly, 2026-10-12) "only lowercase, digits, and hyphens;
  // must begin with letter, cannot end with hyphen. Must be no longer than 63 characters." — Abc · a_b · a.b · a- · -a · 1abc · 64 · 100자 거부, a · a--b · 49 · 50 · 63자 통과.
  // gcloud(SDK 588.0.0)의 클라이언트 검증 정규식은 숫자로 시작하는 이름도 받지만 서버가 1abc 를 거부한다 — 좁은 서버 쪽을 따른다
  rule({ id: 'gcp.run_job', displayName: 'Cloud Run Job', slug: 'crj', minLength: 1, maxLength: 63, pattern: RFC1035,
    scope: 'gcp:project_location', entity: 'run.jobs', category: 'compute', docUrl: RUN_CREATE_JOBS, evidence: RUN_JOB_EVIDENCE, notes: [OBSERVED] }),

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
  // 위치 (D79) — 기본 secret 은 위치가 없다(projects/*/secrets, 자동 복제)라 지역 토큰이 빈다. 같은 API 의 지역 secret(projects/*/locations/*/secrets ·
  // secrets.create parent "in the format `projects/*` or `projects/*/locations/*`")을 마법사 pick 에서 고르면 프로젝트 지역 토큰이 든다
  rule({ id: 'gcp.secret', displayName: 'Secret Manager Secret', slug: 'secret', minLength: 1, maxLength: 255, pattern: /^[A-Za-z0-9_-]{1,255}$/, defaultLocation: 'global',
    allowed: 'alnum-hyphen-underscore', caseRule: 'any', startsWithLetter: false, endsWithAlnum: false, scope: 'gcp:project', entity: 'secretmanager.secrets', category: 'security', docUrl: 'https://www.googleapis.com/discovery/v1/apis/secretmanager/v1/rest' }),

  // ── 작은 스택에 쓰는 규칙 11개 (D72 · 원문 2026-10-11) ──
  // Cloud SQL 안내서 "The maximum length of the database name is 64 characters." (MySQL · PostgreSQL 같은 문장, SQL Server 128) ·
  // "For more information on other criteria for this name, see Schema Object Names." — 나머지는 엔진 문서다(SQL_IDENT).
  // PostgreSQL "By default, NAMEDATALEN is 64 so the maximum identifier length is 63 bytes." — 셋의 가장 짧은 값 63
  rule({ id: 'gcp.cloud_sql_database', displayName: 'Cloud SQL Database', slug: 'db', minLength: 1, maxLength: 63, pattern: SQL_IDENT(63), ...UNDERSCORE,
    scope: 'gcp:cloud_sql_instance', entity: 'sqladmin.databases', category: 'database', docUrl: SQL_DOCS, notes: [NARROWER, SCOPE] }),
  // "Username length limits are the same for Cloud SQL as for on-premises MySQL; 32 characters for MySQL 8.0 and later, 16 characters for earlier versions."
  // PostgreSQL · SQL Server 안내서는 「엔진과 같다」 — 식별자 63 · 128. 세 엔진의 교집합 32 (MySQL 8.0 미만의 16 은 담지 않는다 — docs/rule-verification.md)
  // 시스템 사용자 "You can't delete, modify, or assign database roles to these users." (MySQL · PostgreSQL users 안내서의 목록) — 같은 이름은 만들 수 없다
  // PostgreSQL 9.6 릴리스 노트 (https://www.postgresql.org/docs/9.6/release-9-6.html) "Treat role names beginning with pg_ as reserved" · "User creation of such role names is now disallowed."
  rule({ id: 'gcp.cloud_sql_user', displayName: 'Cloud SQL User', slug: 'user', minLength: 1, maxLength: 32, pattern: SQL_IDENT(32), ...UNDERSCORE, template: ROLE,
    forbidden: { prefixes: ['pg_'], exact: ['root', 'cloudsqlreplica', 'cloudsqlimport', 'cloudsqlexport', 'cloudsqloneshot', 'cloudsqlapplier', 'cloudsqlobservabilityadmin', 'cloudiamgroup',
      'cloudsqlreadonly', 'cloudsqlreplicaindex', 'cloudsqladmin', 'cloudsqlagent', 'cloudsqlconnpooladmin', 'cloudsqlimportexport', 'cloudsqllogical', 'cloudsqlobservability',
      'cloudsqliamgroup', 'cloudsqlinactiveuser', 'cloudsqliamgroupserviceaccount', 'cloudsqliamgroupuser', 'cloudsqliamserviceaccount', 'cloudsqlsuperuser', 'sqlserver'] },
    scope: 'gcp:cloud_sql_instance', entity: 'sqladmin.users', category: 'database', docUrl: SQL_USERS, notes: [NARROWER, SCOPE] }),
  // Router.nats[].name "Unique name of this Nat service. The name must be 1-63 characters long and comply with RFC1035." —
  // 같은 쪽 Router.name 이 RFC1035 를 "[a-z]([-a-z0-9]*[a-z0-9])?" 로 적는다. 라우터 안의 칸이라 라우터 범위에 둔다
  rule({ id: 'gcp.router_nat', displayName: 'Cloud NAT', slug: 'nat', minLength: 1, maxLength: 63, pattern: RFC1035, scope: 'gcp:router', entity: 'compute.routers.nats', category: 'networking', docUrl: ROUTERS_REST }),
  // Pub/Sub "Not begin with the string goog" · "Start with a letter" · "Contain between 3 and 255 characters" ·
  // "Contain only the following characters: Letters [A-Za-z], numbers [0-9], dashes -, underscores _, periods ., tildes ~, plus signs +, and percent signs %" —
  // "projects/project-identifier/collection/ID" 꼴이라 프로젝트 안 유일. 생성은 영숫자 · - · _ 만 쓴다
  rule({ id: 'gcp.pubsub_topic', displayName: 'Pub/Sub Topic', slug: 'topic', minLength: 3, maxLength: 255, pattern: PUBSUB_ID, forbidden: { prefixes: ['goog'] },
    allowed: 'alnum-hyphen-underscore', caseRule: 'any', endsWithAlnum: false, template: UNPLACED, scope: 'gcp:project', entity: 'pubsub.topics', category: 'management', docUrl: PUBSUB_NAMES }),
  // (topic 과 같은 절)
  rule({ id: 'gcp.pubsub_subscription', displayName: 'Pub/Sub Subscription', slug: 'sub', minLength: 3, maxLength: 255, pattern: PUBSUB_ID, forbidden: { prefixes: ['goog'] },
    allowed: 'alnum-hyphen-underscore', caseRule: 'any', endsWithAlnum: false, template: UNPLACED, scope: 'gcp:project', entity: 'pubsub.subscriptions', category: 'management', docUrl: PUBSUB_NAMES }),
  // BuildTrigger.name "User-assigned name of the trigger. Must be unique within the project. Trigger names must meet the following requirements:
  // They must contain only alphanumeric characters and dashes. They can be 1-64 characters long. They must begin and end with an alphanumeric character."
  rule({ id: 'gcp.cloudbuild_trigger', displayName: 'Cloud Build Trigger', slug: 'trigger', minLength: 1, maxLength: 64, pattern: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?$/,
    allowed: 'alnum-hyphen', caseRule: 'any', startsWithLetter: false, scope: 'gcp:project', entity: 'cloudbuild.triggers', category: 'management',
    docUrl: 'https://docs.cloud.google.com/build/docs/api/reference/rest/v1/projects.locations.triggers#BuildTrigger.FIELDS.name' }),
  // Cloud Build 2세대 연결 (D118 · D119) — connections.create connectionId "Names must be unique per-project per-location. Allows alphanumeric characters and any of -._~%!$&'()*+,;=@."
  // 길이 문장은 없다(evidence). 서버는 1-200 을 만들지만 ID + 지역 이름이 181 자를 넘으면 읽지도 지우지도 못한다(D118 은 158).
  // 저장소 만들기는 연결 + 저장소 + 지역 이름 ≤ 141 — 가장 긴 지역 이름 23 자를 빼면 118 자를 연결 · 저장소가 반씩(59) 쓴다 (D119).
  // 안내서 "Your connection cannot exist globally." — 지역 토큰을 둔다. 검사는 문서의 넓은 글자, 생성은 소문자 · 숫자 · 하이픈
  rule({ id: 'gcp.cloudbuild_connection', displayName: 'Cloud Build Connection', slug: 'conn', minLength: 1, maxLength: 59, pattern: /^[A-Za-z0-9._~%!$&'()*+,;=@-]{1,59}$/,
    startsWithLetter: false, endsWithAlnum: false, scope: 'gcp:project_location', entity: 'cloudbuild.connections', category: 'management',
    docUrl: CB_CONNECTIONS_CREATE, evidence: CB_CONNECTION_EVIDENCE, notes: [OBSERVED, NARROWER] }),
  // Cloud Build 2세대 저장소 (D119) — repositories.create repositoryId "This ID should be unique in the connection. Allows alphanumeric characters and any of -._~%!$&'()*+,;=@."
  // 길이는 연결과 같은 만들기 한계를 반씩 나눈 59(evidence). 위치는 부모 연결의 것이다 — 지역 토큰이 없다(D77)
  rule({ id: 'gcp.cloudbuild_repository', displayName: 'Cloud Build Repository', slug: 'repo', minLength: 1, maxLength: 59, pattern: /^[A-Za-z0-9._~%!$&'()*+,;=@-]{1,59}$/,
    startsWithLetter: false, endsWithAlnum: false, scope: 'gcp:cloudbuild_connection', entity: 'cloudbuild.connections.repositories', category: 'management',
    docUrl: CB_REPOSITORIES_CREATE, evidence: CB_REPOSITORY_EVIDENCE, notes: [OBSERVED, NARROWER] }),
  // ManagedZone.name "User assigned name for this resource. Must be unique within the project. The name must be 1-63 characters long, must begin with a letter,
  // end with a letter or digit, and only contain lowercase letters, digits or dashes."
  rule({ id: 'gcp.dns_managed_zone', displayName: 'Cloud DNS Managed Zone', slug: 'dns', minLength: 1, maxLength: 63, pattern: RFC1035, template: UNPLACED, scope: 'gcp:project', entity: 'dns.managedZones', category: 'networking',
    docUrl: 'https://docs.cloud.google.com/dns/docs/reference/rest/v1/managedZones#ManagedZone.FIELDS.name' }),
  // Job.name "JOB_ID can contain only letters ([A-Za-z]), numbers ([0-9]), hyphens (-), or underscores (_). The maximum length is 500 characters." —
  // 최소 길이 문장이 없어 1 로 둔다. 범위: 안내서 "In the Name field, provide a name for the job that is unique to the project."
  rule({ id: 'gcp.scheduler_job', displayName: 'Cloud Scheduler Job', slug: 'cron', minLength: 1, maxLength: 500, pattern: /^[A-Za-z0-9_-]{1,500}$/,
    allowed: 'alnum-hyphen-underscore', caseRule: 'any', startsWithLetter: false, endsWithAlnum: false, scope: 'gcp:project', entity: 'cloudscheduler.jobs', category: 'management',
    docUrl: 'https://docs.cloud.google.com/scheduler/docs/reference/rest/v1/projects.locations.jobs#Job.FIELDS.name', uniquenessDocUrl: 'https://docs.cloud.google.com/scheduler/docs/creating#create' }),
  // DatasetReference.datasetId "The ID must contain only letters (a-z, A-Z), numbers (0-9), or underscores (_). The maximum length is 1,024 characters." ·
  // 안내서 "the dataset name must be unique for each project" · "Dataset names cannot contain spaces or special characters such as -, &, @, or %." —
  // 하이픈이 없어 밑줄로 잇는다(D72). 최소 길이 문장이 없어 1. 밑줄로 시작하면 숨김 데이터세트다 — 생성은 system 으로 시작한다
  rule({ id: 'gcp.bigquery_dataset', displayName: 'BigQuery Dataset', slug: 'bq', minLength: 1, maxLength: 1024, pattern: /^[A-Za-z0-9_]{1,1024}$/, ...UNDERSCORE,
    // 지역 자리 (D78) — 리전 · 멀티 리전(us · eu) 코드
    caseRule: 'any', startsWithLetter: false, template: ['system', 'purpose', 'env', 'region', 'slug'], scope: 'gcp:project', entity: 'bigquery.datasets', category: 'database',
    docUrl: 'https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/datasets#DatasetReference.FIELDS.dataset_id', uniquenessDocUrl: 'https://docs.cloud.google.com/bigquery/docs/datasets#dataset-naming' }),
  // 테이블 · 뷰 (D132) — TableReference.tableId "The ID can contain Unicode characters in category L (letter), M (mark), N (number), Pc (connector, including underscore),
  // Pd (dash), and Zs (space). … The maximum length is 1,024 characters." · 안내서 "the table name must be unique per dataset." · "Contain characters with a total of up to 1,024 UTF-8 bytes."
  // 두 원문의 길이 단위가 다르다(글자 · 바이트). 엔진은 글자 수로 세므로 글자 수와 바이트 수가 같은 ASCII 부분 — 영숫자 · 밑줄(Pc) · 하이픈(Pd) · 공백(Zs) — 만 받는다(NARROWER).
  // 뷰도 tables.insert 로 만들고 같은 tableId 를 쓴다. 생성은 데이터세트와 같이 밑줄로 잇는다(SQL 에서 따옴표 없이 부른다). 위치는 부모 데이터세트의 것이다 — 지역 토큰이 없다(D77)
  rule({ id: 'gcp.bigquery_table', displayName: 'BigQuery Table', slug: 'tbl', minLength: 1, maxLength: 1024, pattern: /^[A-Za-z0-9_ -]{1,1024}$/, ...UNDERSCORE,
    caseRule: 'any', startsWithLetter: false, scope: 'gcp:bigquery_dataset', entity: 'bigquery.tables', category: 'database',
    docUrl: BQ_TABLE_ID, uniquenessDocUrl: BQ_TABLE_NAMING, notes: [NARROWER] }),
  // instances.create instanceId "Must contain only lowercase letters, numbers, and hyphens. Must start with a letter. Must be between 1-40 characters.
  // Must end with a number or a letter. Must be unique within the customer project / location"
  rule({ id: 'gcp.redis_instance', displayName: 'Memorystore for Redis Instance', slug: 'redis', minLength: 1, maxLength: 40, pattern: /^[a-z](?:[a-z0-9-]{0,38}[a-z0-9])?$/,
    scope: 'gcp:project_location', entity: 'redis.instances', category: 'database',
    docUrl: 'https://docs.cloud.google.com/memorystore/docs/redis/reference/rest/v1/projects.locations.instances/create#body.QUERY_PARAMETERS.instance_id' }),
  // Queue.name "QUEUE_ID can contain letters ([A-Za-z]), numbers ([0-9]), or hyphens (-). The maximum length is 100 characters." —
  // 최소 길이 문장이 없어 1. "Queue names consist of three parts: a project ID, a location, and a queue ID." — 유일 범위 문장은 없다(notes)
  rule({ id: 'gcp.tasks_queue', displayName: 'Cloud Tasks Queue', slug: 'queue', minLength: 1, maxLength: 100, pattern: /^[A-Za-z0-9-]{1,100}$/,
    allowed: 'alnum-hyphen', caseRule: 'any', startsWithLetter: false, endsWithAlnum: false, scope: 'gcp:project_location', entity: 'cloudtasks.queues', category: 'management',
    docUrl: 'https://docs.cloud.google.com/tasks/docs/reference/rest/v2/projects.locations.queues#Queue.FIELDS.name', notes: [SCOPE] }),
];

export const GCP_MANUAL_RULES: Record<string, ResourceRule> = Object.fromEntries(RULES.map((r) => [r.id, r]));
