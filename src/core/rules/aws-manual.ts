// 손으로 넣은 AWS 규칙 (D43) — CloudFormation 리소스 스키마에 pattern · maxLength 가 없어 생성기가 보류한 타입을
// 각 서비스 API 참조(Create* · Put* · Register*)에서 다시 읽고 옮겼다. 거기에 값이 없으면 데이터형 쪽 · 사용자 안내서 · 스키마 설명.
// 행마다 위 주석이 근거 URL 과 원문 인용이다. 유일 범위를 적은 문장이 없는 행은 note.scope_unconfirmed 를 싣는다.
// rules/aws.ts 가 손 규칙 · 들인 행과 합친다.
import type { CoreMessage } from '../messages';
import type { ResourceRule, RuleEvidence, Token } from '../types';
import type { ScopeDef } from '../scopes';
import { NO_INVISIBLE } from '../invisible.mjs';

const SCOPE: CoreMessage = { code: 'note.scope_unconfirmed' };
const ADVISORY_WARNED: CoreMessage = { code: 'note.advisory_rule_warned' };
const SECONDARY: CoreMessage = { code: 'note.secondary_source' };
/** 문서보다 서버가 좁다 — 실요청에서 거부된 값으로 좁힌다 (D140) */
const NARROWER: CoreMessage = { code: 'note.server_narrower_than_doc' };
const OBSERVED: CoreMessage = { code: 'note.observed_server_rule' };
const NARROWED_SOURCE: CoreMessage = { code: 'note.narrower_source_used' };

const PLACED: Token[] = ['system', 'purpose', 'env', 'region', 'slug', 'seq'];
/** 계정 범위(IAM)는 지역이 없다 */
const ACCOUNT: Token[] = ['system', 'purpose', 'env', 'slug', 'seq'];
const CFN_SCHEMA = 'https://schema.cloudformation.us-east-1.amazonaws.com/CloudformationSchema.zip';

const ELB_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,30}[A-Za-z0-9])?$/;
const DYNAMODB_NAME = /^[a-zA-Z0-9_.-]{3,255}$/;
const ECS_NAME = /^[A-Za-z0-9_-]{1,255}$/;
const IAM_128 = /^[\w+=,.@-]{1,128}$/;
/** CloudWatch Logs "Pattern: [^:*]*" — 「이 글자만 빼고 전부」 꼴이라 보이지 않는 글자까지 받는다. 앞보기로 뺀다(좁히는 쪽 · invisible.mjs) */
const LOGS_NAME = new RegExp(`${NO_INVISIBLE}^[^:*]{1,512}$`, 'u');
/** RDS 프록시 · 통합 식별자 — API 참조 "Pattern: [a-zA-Z](?:-?[a-zA-Z0-9]+)*" 를 이름 전체에 건다(길이는 maxLength).
 *  원문 꼴은 `-?` 가 빠지면 영숫자 토막을 여러 방법으로 쪼갤 수 있어 「aaa…!」 에서 갈래가 2^n 이다(26자에 수십 ms · 63자는 끝나지 않는다).
 *  같은 집합의 선형 꼴 — 글자로 시작 · 하이픈은 하나씩 영숫자 사이에만 — 로 맞춘다(길이 1~7 조합 전부로 같음을 확인 · redos.test.ts) */
/** Step Functions 이름 (D142) — 원문의 금지 문자 목록을 「이것 빼고」 꼴로. 백틱은 \x60 로 적는다. 보이지 않는 글자는 앞보기로 뺀다 */
const SFN_NAME = new RegExp(String.raw`${NO_INVISIBLE}^[^\s<>{}\[\]?*"#%\\^|~\x60$&,;:/]{1,80}$`, 'u');
/** Glue 이름 (D142) — 원문 Pattern 은 XML 이 받는 글자 전부다. 보이지 않는 글자 · U+FFFE · U+FFFF 를 뺀다(좁히는 쪽) */
const GLUE_NAME = new RegExp(String.raw`${NO_INVISIBLE}^[^\uFFFE\uFFFF]{1,255}$`, 'u');
/** Cognito 이름 (D142) — 원문 Pattern [\w\s+=,.@-]+ 의 \s 는 탭 · 줄바꿈 · 보이지 않는 공백까지 받는다. 앞보기로 뺀다(좁히는 쪽) */
const COGNITO_NAME = new RegExp(String.raw`${NO_INVISIBLE}^[\w\s+=,.@-]{1,128}$`, 'u');
const RDS_IDENT = /^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*$/;

type Spec = Pick<ResourceRule, 'id' | 'displayName' | 'slug' | 'minLength' | 'maxLength' | 'pattern' | 'scope' | 'entity' | 'category' | 'docUrl'>
  & Partial<Pick<ResourceRule, 'forbidden' | 'noConsecutiveSeparator' | 'allowed' | 'caseRule' | 'startsWithLetter' | 'endsWithAlnum' | 'notes' | 'uniquenessDocUrl' | 'advice' | 'evidence' | 'separator' | 'uniqueness'>>;

/** 기본 — 영숫자 · 하이픈 · 밑줄로 생성, 대소문자 허용, 시작 · 끝 규칙 없음 */
function rule(s: Spec): ResourceRule {
  const template = s.scope === 'aws:account' ? ACCOUNT : PLACED;
  return {
    provider: 'aws', resourceType: s.id.slice('aws.'.length),
    allowed: 'alnum-hyphen-underscore', separator: '-', caseRule: 'any', startsWithLetter: false, endsWithAlnum: false,
    template, optional: template.includes('region') ? ['region'] : [], uniqueness: 'csp',
    ...s,
  };
}

/** 부모 리소스 범위 — 원문이 「이 안에서 유일하다」고 적은 부모 */
export type AwsManualScopeId = 'aws:ecs_cluster' | 'aws:log_group' | 'aws:scheduler_schedule_group' | 'aws:cognito_user_pool' | 'aws:glue_database';
export const AWS_MANUAL_SCOPES: Record<AwsManualScopeId, ScopeDef> = {
  // CreateService "Service names must be unique within a cluster"
  'aws:ecs_cluster': { id: 'aws:ecs_cluster', provider: 'aws', displayName: 'ECS cluster', parent: 'aws:region', ruleId: 'aws.ecs_cluster', docUrl: 'https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_CreateService.html' },
  // CreateLogStream "Log stream names must be unique within the log group."
  'aws:log_group': { id: 'aws:log_group', provider: 'aws', displayName: 'Log group', parent: 'aws:region', ruleId: 'aws.logs_log_group', docUrl: 'https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_CreateLogStream.html' },
  // CreateSchedule GroupName "The name of the schedule group to associate with this schedule. If you omit this, the default schedule group is used." (D142)
  'aws:scheduler_schedule_group': { id: 'aws:scheduler_schedule_group', provider: 'aws', displayName: 'Schedule group', parent: 'aws:region', ruleId: 'aws.scheduler_schedule_group', docUrl: 'https://docs.aws.amazon.com/scheduler/latest/APIReference/API_CreateSchedule.html' },
  // CreateUserPoolClient UserPoolId "The ID of the user pool where you want to create a user pool client." (D142)
  'aws:cognito_user_pool': { id: 'aws:cognito_user_pool', provider: 'aws', displayName: 'Cognito user pool', parent: 'aws:region', ruleId: 'aws.cognito_user_pool', docUrl: 'https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_CreateUserPoolClient.html' },
  // CreateTable DatabaseName "The catalog database in which to create the new table." (D142)
  'aws:glue_database': { id: 'aws:glue_database', provider: 'aws', displayName: 'Glue database', parent: 'aws:region', ruleId: 'aws.glue_database', docUrl: 'https://docs.aws.amazon.com/glue/latest/webapi/API_CreateTable.html' },
};

/** Lambda 용량 공급자 (D140) — API 참조는 140자라 적지만 서버는 64자에서 끊는다 */
const LAMBDA_CP_EVIDENCE: readonly RuleEvidence[] = [
  { kind: 'api_error', source: 'Lambda CreateCapacityProvider in ap-northeast-2 (AWS CLI 2.38.5)', date: '2026-10-25',
    quote: 'InvalidParameterValueException: Capacity provider name must have length less than or equal to 64: <name> — for 65 and 140 characters; 64 characters, Ab, a_b, 1a, -a, a- and a--b passed the name check and stopped at the operator role permission check; a.b answered "Member must satisfy regular expression pattern"' },
];

const EVENTS_EVENT_BUS_EVIDENCE: readonly RuleEvidence[] = [{ kind: 'api_error', source: "EventBridge CreateEventBus in ap-northeast-2 (AWS CLI 2.38.5)", date: '2026-10-25', quote: "ValidationException: EventBus name starting with 'aws.' is not valid. — for aws.<name>; a/b answers \"Event bus name must not contain '/'\"; default answers ResourceAlreadyExistsException; 256 characters, a leading digit or hyphen, a--b and a.b were created and deleted" }];
const SCHEDULER_SCHEDULE_GROUP_EVIDENCE: readonly RuleEvidence[] = [{ kind: 'api_error', source: "EventBridge Scheduler CreateScheduleGroup in ap-northeast-2 (AWS CLI 2.38.5)", date: '2026-10-25', quote: "ValidationException: This operation cannot be performed on schedule group default. — 64 characters, a leading digit or hyphen, a--b and a.b were created and deleted; 65 characters and a space answer the pattern" }];
const ATHENA_WORKGROUP_EVIDENCE: readonly RuleEvidence[] = [{ kind: 'api_error', source: "Athena CreateWorkGroup in ap-northeast-2 (AWS CLI 2.38.5)", date: '2026-10-25', quote: "InvalidRequestException: primary workGroup could not be created — 128 characters, a leading digit or hyphen and a.b were created and deleted; 129 characters and a space answer the pattern" }];
const ATHENA_DATA_CATALOG_EVIDENCE: readonly RuleEvidence[] = [{ kind: 'api_error', source: "Athena CreateDataCatalog in ap-northeast-2 (AWS CLI 2.38.5)", date: '2026-10-25', quote: "InvalidRequestException: DataCatalog name AwsDataCatalog is reserved. — 127 and 128 characters were created; 129, 160, 200, 230, 250, 255 and 256 characters, a.b and a space answer \"DataCatalog name … is invalid\"" }];
const BATCH_COMPUTE_ENVIRONMENT_EVIDENCE: readonly RuleEvidence[] = [{ kind: 'api_error', source: "Batch CreateComputeEnvironment in ap-northeast-2 (AWS CLI 2.38.5)", date: '2026-10-25', quote: "ClientException: Compute Environment name should match a valid pattern — for -a…, a.b, a space and 129 characters; 128 characters, a leading digit, a trailing hyphen and a--b passed the name check (stopped at ServiceRole is required)" }];
const BATCH_JOB_QUEUE_EVIDENCE: readonly RuleEvidence[] = [{ kind: 'api_error', source: "Batch CreateJobQueue in ap-northeast-2 (AWS CLI 2.38.5)", date: '2026-10-25', quote: "ClientException: Job Queue name should match a valid pattern — for -a…, a.b, a space and 129 characters; 128 characters, a leading digit, a trailing hyphen and a--b passed the name check (stopped at the compute environment check)" }];
const BATCH_JOB_DEFINITION_EVIDENCE: readonly RuleEvidence[] = [{ kind: 'api_error', source: "Batch RegisterJobDefinition in ap-northeast-2 (AWS CLI 2.38.5)", date: '2026-10-25', quote: "ClientException: Job definition name should match a valid pattern — for -a…, a.b, a space and 129 characters; 128 characters, a leading digit, a trailing hyphen and a--b were registered and deregistered" }];
const APPSYNC_GRAPHQL_API_EVIDENCE: readonly RuleEvidence[] = [{ kind: 'api_error', source: "AppSync CreateGraphqlApi in ap-northeast-2 (AWS CLI 2.38.5)", date: '2026-10-25', quote: "BadRequestException: The GraphQL API name is invalid. — for 513, 1024 and 65536 characters; 512 characters, a space, Hangul, a/b, a:b, a#b and U+0001 were created and deleted; a second API with the same name was created" }];

const RULES: ResourceRule[] = [
  // ── EC2 ──
  // LaunchTemplate 데이터형 "launchTemplateName — The name of the launch template. … Length Constraints: Minimum length of 3. Maximum length of 128. Pattern: [a-zA-Z0-9\(\)\.\-/_]+"
  // 요청(CreateLaunchTemplate)에는 "A name for the launch template." 뿐이다
  rule({ id: 'aws.ec2_launch_template', displayName: 'EC2 Launch Template', slug: 'lt', minLength: 3, maxLength: 128, pattern: /^[a-zA-Z0-9()./_-]{3,128}$/,
    scope: 'aws:region', entity: 'AWS::EC2::LaunchTemplate', category: 'compute', docUrl: 'https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_LaunchTemplate.html', notes: [SECONDARY, SCOPE] }),

  // ── Elastic Load Balancing ──
  // "This name must be unique within your set of load balancers for the region, must have a maximum of 32 characters, must contain only alphanumeric characters or hyphens, and cannot begin or end with a hyphen."
  rule({ id: 'aws.elb_load_balancer', displayName: 'ElasticLoadBalancing Load Balancer', slug: 'clb', minLength: 1, maxLength: 32, pattern: ELB_NAME, allowed: 'alnum-hyphen', endsWithAlnum: true,
    scope: 'aws:region', entity: 'AWS::ElasticLoadBalancing::LoadBalancer', category: 'networking', docUrl: 'https://docs.aws.amazon.com/elasticloadbalancing/2012-06-01/APIReference/API_CreateLoadBalancer.html' }),
  // "This name must be unique per region per account, can have a maximum of 32 characters, must contain only alphanumeric characters or hyphens, must not begin or end with a hyphen, and must not begin with "internal-"."
  rule({ id: 'aws.elbv2_load_balancer', displayName: 'ElasticLoadBalancingV2 Load Balancer', slug: 'lb', minLength: 1, maxLength: 32, pattern: ELB_NAME, allowed: 'alnum-hyphen', endsWithAlnum: true,
    forbidden: { prefixes: ['internal-'] }, scope: 'aws:region', entity: 'AWS::ElasticLoadBalancingV2::LoadBalancer', category: 'networking', docUrl: 'https://docs.aws.amazon.com/elasticloadbalancing/latest/APIReference/API_CreateLoadBalancer.html' }),
  // "This name must be unique per region per account, can have a maximum of 32 characters, must contain only alphanumeric characters or hyphens, and must not begin or end with a hyphen."
  rule({ id: 'aws.elbv2_target_group', displayName: 'ElasticLoadBalancingV2 Target Group', slug: 'tg', minLength: 1, maxLength: 32, pattern: ELB_NAME, allowed: 'alnum-hyphen', endsWithAlnum: true,
    scope: 'aws:region', entity: 'AWS::ElasticLoadBalancingV2::TargetGroup', category: 'networking', docUrl: 'https://docs.aws.amazon.com/elasticloadbalancing/latest/APIReference/API_CreateTargetGroup.html' }),
  // "This name must be unique per region and can't be changed after creation. … Length Constraints: Minimum length of 1. Maximum length of 32. Pattern: ^([a-zA-Z0-9]+-)*[a-zA-Z0-9]+$"
  rule({ id: 'aws.elbv2_trust_store', displayName: 'ElasticLoadBalancingV2 Trust Store', slug: 'ts', minLength: 1, maxLength: 32, pattern: /^([a-zA-Z0-9]+-)*[a-zA-Z0-9]+$/, allowed: 'alnum-hyphen', endsWithAlnum: true, noConsecutiveSeparator: true,
    scope: 'aws:region', entity: 'AWS::ElasticLoadBalancingV2::TrustStore', category: 'networking', docUrl: 'https://docs.aws.amazon.com/elasticloadbalancing/latest/APIReference/API_CreateTrustStore.html' }),

  // ── S3 ──
  // StorageLensGroup "Contains the name of the Storage Lens group. … Length Constraints: Minimum length of 1. Maximum length of 64. Pattern: [a-zA-Z0-9\-\_]+"
  rule({ id: 'aws.s3_storage_lens_group', displayName: 'S3 Storage Lens Group', slug: 'slg', minLength: 1, maxLength: 64, pattern: /^[a-zA-Z0-9_-]{1,64}$/,
    scope: 'aws:region', entity: 'AWS::S3::StorageLensGroup', category: 'storage', docUrl: 'https://docs.aws.amazon.com/AmazonS3/latest/API/API_control_StorageLensGroup.html', notes: [SCOPE] }),

  // ── DynamoDB ──
  // "All names must be encoded using UTF-8, and are case-sensitive. Table names and index names must be between 3 and 255 characters long, and can contain only the following characters: a-z A-Z 0-9 _ (underscore) - (dash) . (dot)"
  // CreateTable "In an AWS account, table names must be unique within each Region."
  rule({ id: 'aws.dynamodb_global_table', displayName: 'DynamoDB Global Table', slug: 'gt', minLength: 3, maxLength: 255, pattern: DYNAMODB_NAME,
    scope: 'aws:region', entity: 'AWS::DynamoDB::GlobalTable', category: 'database', docUrl: 'https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.NamingRulesDataTypes.html', uniquenessDocUrl: 'https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_CreateTable.html' }),
  rule({ id: 'aws.dynamodb_table', displayName: 'DynamoDB Table', slug: 'tbl', minLength: 3, maxLength: 255, pattern: DYNAMODB_NAME,
    scope: 'aws:region', entity: 'AWS::DynamoDB::Table', category: 'database', docUrl: 'https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.NamingRulesDataTypes.html', uniquenessDocUrl: 'https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_CreateTable.html' }),

  // ── ElastiCache — "This parameter is stored as a lowercase string." 대문자는 받아 소문자로 저장한다(rds_instance 와 같은 꼴) ──
  // "A name must contain from 1 to 50 alphanumeric characters or hyphens. The first character must be a letter. A name cannot end with a hyphen or contain two consecutive hyphens."
  rule({ id: 'aws.elasticache_cache_cluster', displayName: 'ElastiCache Cache Cluster', slug: 'cc', minLength: 1, maxLength: 50, pattern: /^[A-Za-z](?:[A-Za-z0-9-]{0,48}[A-Za-z0-9])?$/, noConsecutiveSeparator: true,
    allowed: 'lower-digit-hyphen', startsWithLetter: true, endsWithAlnum: true, scope: 'aws:region', entity: 'AWS::ElastiCache::CacheCluster', category: 'database', docUrl: 'https://docs.aws.amazon.com/AmazonElastiCache/latest/APIReference/API_CreateCacheCluster.html', notes: [SCOPE] }),
  // "A name must contain from 1 to 40 alphanumeric characters or hyphens. The first character must be a letter. A name cannot end with a hyphen or contain two consecutive hyphens."
  rule({ id: 'aws.elasticache_replication_group', displayName: 'ElastiCache Replication Group', slug: 'rg', minLength: 1, maxLength: 40, pattern: /^[A-Za-z](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?$/, noConsecutiveSeparator: true,
    allowed: 'lower-digit-hyphen', startsWithLetter: true, endsWithAlnum: true, scope: 'aws:region', entity: 'AWS::ElastiCache::ReplicationGroup', category: 'database', docUrl: 'https://docs.aws.amazon.com/AmazonElastiCache/latest/APIReference/API_CreateReplicationGroup.html', notes: [SCOPE] }),
  // "This value is stored as a lowercase string. Constraints: Must contain no more than 255 alphanumeric characters or hyphens."
  rule({ id: 'aws.elasticache_subnet_group', displayName: 'ElastiCache Subnet Group', slug: 'sng', minLength: 1, maxLength: 255, pattern: /^[A-Za-z0-9-]{1,255}$/, allowed: 'lower-digit-hyphen',
    scope: 'aws:region', entity: 'AWS::ElastiCache::SubnetGroup', category: 'database', docUrl: 'https://docs.aws.amazon.com/AmazonElastiCache/latest/APIReference/API_CreateCacheSubnetGroup.html', notes: [SCOPE] }),

  // ── RDS ──
  // "This value is stored as a lowercase string. Constraints: Must contain no more than 255 letters, numbers, periods, underscores, spaces, or hyphens. Must not be default. First character must be a letter."
  rule({ id: 'aws.rds_db_subnet_group', displayName: 'RDS DB Subnet Group', slug: 'sng', minLength: 1, maxLength: 255, pattern: /^[A-Za-z][A-Za-z0-9._ -]{0,254}$/, allowed: 'lower-digit-hyphen', startsWithLetter: true,
    forbidden: { exact: ['default'], ignoreCase: true }, scope: 'aws:region', entity: 'AWS::RDS::DBSubnetGroup', category: 'database', docUrl: 'https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_CreateDBSubnetGroup.html', notes: [SCOPE] }),
  // "Must be 1 to 255 letters, numbers, or hyphens First character must be a letter Can't end with a hyphen or contain two consecutive hyphens"
  rule({ id: 'aws.rds_option_group', displayName: 'RDS Option Group', slug: 'og', minLength: 1, maxLength: 255, pattern: /^[A-Za-z](?:[A-Za-z0-9-]{0,253}[A-Za-z0-9])?$/, noConsecutiveSeparator: true,
    allowed: 'lower-digit-hyphen', startsWithLetter: true, endsWithAlnum: true, scope: 'aws:region', entity: 'AWS::RDS::OptionGroup', category: 'database', docUrl: 'https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_CreateOptionGroup.html', notes: [SCOPE] }),

  // CreateDBParameterGroup "Must be 1 to 255 letters, numbers, or hyphens. First character must be a letter Can't end with a hyphen or contain two consecutive hyphens … This value is stored as a lowercase string."
  rule({ id: 'aws.rds_db_parameter_group', displayName: 'RDS DB Parameter Group', slug: 'pg', minLength: 1, maxLength: 255, pattern: /^[A-Za-z](?:[A-Za-z0-9-]{0,253}[A-Za-z0-9])?$/, noConsecutiveSeparator: true,
    allowed: 'lower-digit-hyphen', startsWithLetter: true, endsWithAlnum: true, scope: 'aws:region', entity: 'AWS::RDS::DBParameterGroup', category: 'database', docUrl: 'https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_CreateDBParameterGroup.html', notes: [SCOPE] }),
  // CreateDBProxy "This name must be unique for all proxies owned by your AWS account in the specified AWS Region. An identifier must begin with a letter and must contain only ASCII letters, digits, and hyphens; it can't end with a hyphen or contain two consecutive hyphens. … Minimum length of 1. Maximum length of 63. Pattern: [a-zA-Z](?:-?[a-zA-Z0-9]+)*"
  // 스키마는 [0-z]* 64자 — API 참조가 좁다
  rule({ id: 'aws.rds_db_proxy', displayName: 'RDS DB Proxy', slug: 'prx', minLength: 1, maxLength: 63, pattern: RDS_IDENT, noConsecutiveSeparator: true,
    allowed: 'alnum-hyphen', startsWithLetter: true, endsWithAlnum: true, scope: 'aws:region', entity: 'AWS::RDS::DBProxy', category: 'database', docUrl: 'https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_CreateDBProxy.html' }),
  // CreateDBProxyEndpoint "Minimum length of 1. Maximum length of 63. Pattern: [a-zA-Z](?:-?[a-zA-Z0-9]+)*" — 유일 범위 문장 없음(프록시 아래지만 범위 노드가 없어 지역에 둔다)
  rule({ id: 'aws.rds_db_proxy_endpoint', displayName: 'RDS DB Proxy Endpoint', slug: 'pe', minLength: 1, maxLength: 63, pattern: RDS_IDENT, noConsecutiveSeparator: true,
    allowed: 'alnum-hyphen', startsWithLetter: true, endsWithAlnum: true, scope: 'aws:region', entity: 'AWS::RDS::DBProxyEndpoint', category: 'database', docUrl: 'https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_CreateDBProxyEndpoint.html', notes: [SCOPE] }),
  // CreateIntegration "Minimum length of 1. Maximum length of 63. Pattern: [a-zA-Z](?:-?[a-zA-Z0-9]+)*" — 스키마는 64자 · 유일 범위 문장 없음
  rule({ id: 'aws.rds_integration', displayName: 'RDS Integration', slug: 'int', minLength: 1, maxLength: 63, pattern: RDS_IDENT, noConsecutiveSeparator: true,
    allowed: 'alnum-hyphen', startsWithLetter: true, endsWithAlnum: true, scope: 'aws:region', entity: 'AWS::RDS::Integration', category: 'database', docUrl: 'https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_CreateIntegration.html', notes: [SCOPE] }),
  // CreateBlueGreenDeployment BlueGreenDeploymentName "Constraints: Can't be the same as an existing blue/green deployment name in the same account and AWS Region. … Minimum length of 1. Maximum length of 60. Pattern: [a-zA-Z](?:-?[a-zA-Z0-9]+)*"
  // CloudFormation AWS::RDS::Deployment 의 같은 속성도 1~60 · ^[a-zA-Z](?:-?[a-zA-Z0-9]+)*$ — 두 문서가 같다 (D131)
  rule({ id: 'aws.rds_deployment', displayName: 'RDS Blue/Green Deployment', slug: 'bgd', minLength: 1, maxLength: 60, pattern: RDS_IDENT, noConsecutiveSeparator: true,
    allowed: 'alnum-hyphen', startsWithLetter: true, endsWithAlnum: true, scope: 'aws:region', entity: 'AWS::RDS::Deployment', category: 'database', docUrl: 'https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_CreateBlueGreenDeployment.html' }),

  // ── ECS ──
  // "Up to 255 characters are allowed. They include letters (both upper and lowercase letters), numbers, underscores (_), and hyphens (-). The name can't be prefixed with "aws", "ecs", or "fargate"."
  // 금지 접두를 대소문자 없이 본다 (보수적 · D20)
  rule({ id: 'aws.ecs_capacity_provider', displayName: 'ECS Capacity Provider', slug: 'cp', minLength: 1, maxLength: 255, pattern: ECS_NAME,
    forbidden: { prefixes: ['aws', 'ecs', 'fargate'], ignoreCase: true }, scope: 'aws:region', entity: 'AWS::ECS::CapacityProvider', category: 'containers', docUrl: 'https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_CreateCapacityProvider.html', notes: [SCOPE] }),
  // "Up to 255 letters (uppercase and lowercase), numbers, underscores, and hyphens are allowed."
  rule({ id: 'aws.ecs_cluster', displayName: 'ECS Cluster', slug: 'ecs', minLength: 1, maxLength: 255, pattern: ECS_NAME,
    scope: 'aws:region', entity: 'AWS::ECS::Cluster', category: 'containers', docUrl: 'https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_CreateCluster.html', notes: [SCOPE] }),
  // CreateDaemon (같은 문장)
  rule({ id: 'aws.ecs_daemon', displayName: 'ECS Daemon', slug: 'dmn', minLength: 1, maxLength: 255, pattern: ECS_NAME,
    scope: 'aws:region', entity: 'AWS::ECS::Daemon', category: 'containers', docUrl: 'https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_CreateDaemon.html', notes: [SCOPE] }),
  // "This family is used as a name for your daemon task definition. Up to 255 letters (uppercase and lowercase), numbers, underscores, and hyphens are allowed."
  rule({ id: 'aws.ecs_daemon_task_definition', displayName: 'ECS Daemon Task Definition', slug: 'dtd', minLength: 1, maxLength: 255, pattern: ECS_NAME,
    scope: 'aws:region', entity: 'AWS::ECS::DaemonTaskDefinition', category: 'containers', docUrl: 'https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_RegisterDaemonTaskDefinition.html', notes: [SCOPE] }),
  // "This name must be unique within the specified cluster and can contain up to 255 letters (uppercase and lowercase), numbers, underscores, and hyphens."
  rule({ id: 'aws.ecs_express_gateway_service', displayName: 'ECS Express Gateway Service', slug: 'egs', minLength: 1, maxLength: 255, pattern: ECS_NAME,
    scope: 'aws:ecs_cluster', entity: 'AWS::ECS::ExpressGatewayService', category: 'containers', docUrl: 'https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_CreateExpressGatewayService.html' }),
  // "Up to 255 letters (uppercase and lowercase), numbers, underscores, and hyphens are allowed. Service names must be unique within a cluster"
  rule({ id: 'aws.ecs_service', displayName: 'ECS Service', slug: 'svc', minLength: 1, maxLength: 255, pattern: ECS_NAME,
    scope: 'aws:ecs_cluster', entity: 'AWS::ECS::Service', category: 'containers', docUrl: 'https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_CreateService.html' }),
  // "The family is used as a name for your task definition. Up to 255 letters (uppercase and lowercase), numbers, underscores, and hyphens are allowed."
  rule({ id: 'aws.ecs_task_definition', displayName: 'ECS Task Definition', slug: 'td', minLength: 1, maxLength: 255, pattern: ECS_NAME,
    scope: 'aws:region', entity: 'AWS::ECS::TaskDefinition', category: 'containers', docUrl: 'https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_RegisterTaskDefinition.html', notes: [SCOPE] }),

  // ── EKS ──
  // 사용자 안내서 "The node group name can't be longer than 63 characters. It must start with a letter or digit, but can also include hyphens and underscores for the remaining characters."
  rule({ id: 'aws.eks_nodegroup', displayName: 'EKS Nodegroup', slug: 'ng', minLength: 1, maxLength: 63, pattern: /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/,
    scope: 'aws:region', entity: 'AWS::EKS::Nodegroup', category: 'containers', docUrl: 'https://docs.aws.amazon.com/eks/latest/userguide/create-managed-node-group.html', notes: [SCOPE] }),

  // ── API Gateway ──
  // "Stage names can only contain alphanumeric characters, hyphens, and underscores. Maximum length is 128 characters."
  rule({ id: 'aws.apigw_stage', displayName: 'ApiGateway Stage', slug: 'stage', minLength: 1, maxLength: 128, pattern: /^[A-Za-z0-9_-]{1,128}$/,
    scope: 'aws:region', entity: 'AWS::ApiGateway::Stage', category: 'compute', docUrl: 'https://docs.aws.amazon.com/apigateway/latest/api/API_CreateStage.html', notes: [SCOPE] }),
  // 스키마 aws-apigatewayv2-stage.json 설명 "Stage names can contain only alphanumeric characters, hyphens, and underscores, or be $default. Maximum length is 128 characters."
  rule({ id: 'aws.apigwv2_stage', displayName: 'ApiGatewayV2 Stage', slug: 'stage', minLength: 1, maxLength: 128, pattern: /^(?:\$default|[A-Za-z0-9_-]{1,128})$/,
    scope: 'aws:region', entity: 'AWS::ApiGatewayV2::Stage', category: 'compute', docUrl: CFN_SCHEMA, notes: [SCOPE] }),

  // ── Lambda ──
  // CreateAlias "Length Constraints: Minimum length of 1. Maximum length of 128. Pattern: (?!^[0-9]+$)([a-zA-Z0-9-_]+)"
  rule({ id: 'aws.lambda_alias', displayName: 'Lambda Alias', slug: 'alias', minLength: 1, maxLength: 128, pattern: /^(?![0-9]+$)[A-Za-z0-9_-]{1,128}$/,
    scope: 'aws:region', entity: 'AWS::Lambda::Alias', category: 'compute', docUrl: 'https://docs.aws.amazon.com/lambda/latest/api/API_CreateAlias.html', notes: [SCOPE] }),
  // CreateFunction "The length constraint applies only to the full ARN. If you specify only the function name, it is limited to 64 characters in length." · 이름 토막 `[a-zA-Z0-9-_]+`
  rule({ id: 'aws.lambda_function', displayName: 'Lambda Function', slug: 'fn', minLength: 1, maxLength: 64, pattern: /^[A-Za-z0-9_-]{1,64}$/,
    scope: 'aws:region', entity: 'AWS::Lambda::Function', category: 'compute', docUrl: 'https://docs.aws.amazon.com/lambda/latest/api/API_CreateFunction.html', notes: [SCOPE] }),
  // 스키마 definitions.Name "A unique name for the network connector within your account and Region. Must be 1 to 64 alphanumeric characters, hyphens, or underscores."
  rule({ id: 'aws.lambda_network_connector', displayName: 'Lambda Network Connector', slug: 'nc', minLength: 1, maxLength: 64, pattern: /^[A-Za-z0-9_-]{1,64}$/,
    scope: 'aws:region', entity: 'AWS::Lambda::NetworkConnector', category: 'compute', docUrl: CFN_SCHEMA }),
  // CreateCapacityProvider CapacityProviderName "Minimum length of 1. Maximum length of 140. Pattern: (arn:aws…:capacity-provider:[a-zA-Z0-9-_]+)|[a-zA-Z0-9-_]+"
  // ARN 갈래는 기존 공급자를 가리키는 값이다 — 이름 갈래만 쓴다 · 유일 범위 문장 없음
  // 2026-10-25 실요청(D140): 65자 · 140자는 "Capacity provider name must have length less than or equal to 64", 64자는 이름 검사를 지나 역할 권한 검사까지 갔다 — 서버 한도 64
  rule({ id: 'aws.lambda_capacity_provider', displayName: 'Lambda Capacity Provider', slug: 'cp', minLength: 1, maxLength: 64, pattern: /^[A-Za-z0-9_-]{1,64}$/,
    scope: 'aws:region', entity: 'AWS::Lambda::CapacityProvider', category: 'compute', docUrl: 'https://docs.aws.amazon.com/lambda/latest/api/API_CreateCapacityProvider.html',
    evidence: LAMBDA_CP_EVIDENCE, notes: [NARROWER, SCOPE] }),

  // ── IAM — "IAM user, group, role, and policy names must be unique within the account. Names are not distinguished by case." ──
  // CreateGroup "Length Constraints: Minimum length of 1. Maximum length of 128. Pattern: [\w+=,.@-]+"
  rule({ id: 'aws.iam_group', displayName: 'IAM Group', slug: 'grp', minLength: 1, maxLength: 128, pattern: IAM_128,
    scope: 'aws:account', entity: 'AWS::IAM::Group', category: 'identity', docUrl: 'https://docs.aws.amazon.com/IAM/latest/APIReference/API_CreateGroup.html' }),
  // PutGroupPolicy (같은 길이 · pattern) — 범위 문장 없음
  rule({ id: 'aws.iam_group_policy', displayName: 'IAM Group Policy', slug: 'gp', minLength: 1, maxLength: 128, pattern: IAM_128,
    scope: 'aws:account', entity: 'AWS::IAM::GroupPolicy', category: 'identity', docUrl: 'https://docs.aws.amazon.com/IAM/latest/APIReference/API_PutGroupPolicy.html', notes: [SCOPE] }),
  // CreateInstanceProfile (같은 길이 · pattern) — 범위 문장 없음
  rule({ id: 'aws.iam_instance_profile', displayName: 'IAM Instance Profile', slug: 'ip', minLength: 1, maxLength: 128, pattern: IAM_128,
    scope: 'aws:account', entity: 'AWS::IAM::InstanceProfile', category: 'identity', docUrl: 'https://docs.aws.amazon.com/IAM/latest/APIReference/API_CreateInstanceProfile.html', notes: [SCOPE] }),
  // AWS::IAM::Policy 는 사용자 · 그룹 · 역할에 붙이는 인라인 정책이다 — PutUserPolicy · PutGroupPolicy · PutRolePolicy PolicyName
  // "Minimum length of 1. Maximum length of 128. Pattern: [\w+=,.@-]+" — 범위 문장 없음
  rule({ id: 'aws.iam_policy', displayName: 'IAM Policy (inline)', slug: 'pol', minLength: 1, maxLength: 128, pattern: IAM_128,
    scope: 'aws:account', entity: 'AWS::IAM::Policy', category: 'identity', docUrl: 'https://docs.aws.amazon.com/IAM/latest/APIReference/API_PutUserPolicy.html', notes: [SCOPE] }),
  // CreatePolicy (같은 길이 · pattern)
  rule({ id: 'aws.iam_managed_policy', displayName: 'IAM Managed Policy', slug: 'pol', minLength: 1, maxLength: 128, pattern: IAM_128,
    scope: 'aws:account', entity: 'AWS::IAM::ManagedPolicy', category: 'identity', docUrl: 'https://docs.aws.amazon.com/IAM/latest/APIReference/API_CreatePolicy.html' }),
  // PutRolePolicy (같은 길이 · pattern) — 범위 문장 없음
  rule({ id: 'aws.iam_role_policy', displayName: 'IAM Role Policy', slug: 'rp', minLength: 1, maxLength: 128, pattern: IAM_128,
    scope: 'aws:account', entity: 'AWS::IAM::RolePolicy', category: 'identity', docUrl: 'https://docs.aws.amazon.com/IAM/latest/APIReference/API_PutRolePolicy.html', notes: [SCOPE] }),
  // CreateUser "Minimum length of 1. Maximum length of 64. Pattern: [\w+=,.@-]+"
  rule({ id: 'aws.iam_user', displayName: 'IAM User', slug: 'usr', minLength: 1, maxLength: 64, pattern: /^[\w+=,.@-]{1,64}$/,
    scope: 'aws:account', entity: 'AWS::IAM::User', category: 'identity', docUrl: 'https://docs.aws.amazon.com/IAM/latest/APIReference/API_CreateUser.html' }),
  // PutUserPolicy (같은 길이 · pattern) — 범위 문장 없음
  rule({ id: 'aws.iam_user_policy', displayName: 'IAM User Policy', slug: 'up', minLength: 1, maxLength: 128, pattern: IAM_128,
    scope: 'aws:account', entity: 'AWS::IAM::UserPolicy', category: 'identity', docUrl: 'https://docs.aws.amazon.com/IAM/latest/APIReference/API_PutUserPolicy.html', notes: [SCOPE] }),

  // ── Secrets Manager ──
  // "The secret name can contain ASCII letters, numbers, and the following characters: /_+=.@- Do not end your secret name with a hyphen followed by six characters. … Length Constraints: Minimum length of 1. Maximum length of 512."
  // 끝 규칙은 원문이 권고다("If you do so, you risk confusion and unexpected results when searching for a secret by partial ARN") — 거부하지 않고 경고한다 (D112)
  rule({ id: 'aws.secretsmanager_secret', displayName: 'SecretsManager Secret', slug: 'secret', minLength: 1, maxLength: 512, pattern: /^[A-Za-z0-9/_+=.@-]{1,512}$/,
    advice: [{ pattern: /-[A-Za-z0-9/_+=.@-]{6}$/, warning: { code: 'warning.arn_suffix_lookalike' } }],
    scope: 'aws:region', entity: 'AWS::SecretsManager::Secret', category: 'security', docUrl: 'https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_CreateSecret.html', notes: [ADVISORY_WARNED, SCOPE] }),

  // ── CloudWatch Logs ──
  // "Log stream names must be unique within the log group. … Length Constraints: Minimum length of 1. Maximum length of 512. Pattern: [^:*]*"
  rule({ id: 'aws.logs_log_stream', displayName: 'Logs Log Stream', slug: 'ls', minLength: 1, maxLength: 512, pattern: LOGS_NAME,
    scope: 'aws:log_group', entity: 'AWS::Logs::LogStream', category: 'management', docUrl: 'https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_CreateLogStream.html' }),
  // PutSubscriptionFilter "Length Constraints: Minimum length of 1. Maximum length of 512. Pattern: [^:*]*" — 로그 그룹에 딸리지만 범위 문장은 없다
  rule({ id: 'aws.logs_subscription_filter', displayName: 'Logs Subscription Filter', slug: 'sf', minLength: 1, maxLength: 512, pattern: LOGS_NAME,
    scope: 'aws:log_group', entity: 'AWS::Logs::SubscriptionFilter', category: 'management', docUrl: 'https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_PutSubscriptionFilter.html', notes: [SCOPE] }),
  // ════ 2026-10-25 추가 (D142) — 자주 쓰는 서비스 47종. 각 서비스 API 참조의 길이 · Pattern · 문장을 옮기고, 같은 날 실제 API 에 이름을 보내 대어 봤다(docs/rule-verification.md) ════
  // CreateQueue QueueName "A queue name can have up to 80 characters. Valid values: alphanumeric characters, hyphens ( - ), and underscores ( _ ). A FIFO queue name must end with the .fifo suffix." — 서버: 81자 · . · : · 공백 거부, .fifo 를 붙인 80자(FIFO) 생성
  rule({ id: 'aws.sqs_queue', displayName: 'SQS Queue', slug: 'sqs', minLength: 1, maxLength: 80, pattern: /^(?:[A-Za-z0-9_-]{1,80}|[A-Za-z0-9_-]{1,75}\.fifo)$/, scope: 'aws:region', entity: 'AWS::SQS::Queue', category: 'compute', docUrl: 'https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_CreateQueue.html' }),
  // CreateTopic Name "Topic names must be made up of only uppercase and lowercase ASCII letters, numbers, underscores, and hyphens, and must be between 1 and 256 characters long. For a FIFO … the name must end with the .fifo suffix."
  rule({ id: 'aws.sns_topic', displayName: 'SNS Topic', slug: 'sns', minLength: 1, maxLength: 256, pattern: /^(?:[A-Za-z0-9_-]{1,256}|[A-Za-z0-9_-]{1,251}\.fifo)$/, scope: 'aws:region', entity: 'AWS::SNS::Topic', category: 'compute', docUrl: 'https://docs.aws.amazon.com/sns/latest/api/API_CreateTopic.html' }),
  // CreateStateMachine name "Minimum length of 1. Maximum length of 80." · "A name must not contain: white space, brackets < > { } [ ], wildcard characters ? *, special characters " # % \ ^ | ~ ` $ & , ; : /, control characters (U+0000-001F, U+007F-009F, U+FFFE-FFFF), surrogates (U+D800-DFFF)" — 보이지 않는 글자는 함께 뺀다(좁히는 쪽)
  rule({ id: 'aws.stepfunctions_state_machine', displayName: 'Step Functions State Machine', slug: 'sfn', minLength: 1, maxLength: 80, pattern: SFN_NAME, scope: 'aws:region', entity: 'AWS::StepFunctions::StateMachine', category: 'compute', docUrl: 'https://docs.aws.amazon.com/step-functions/latest/apireference/API_CreateStateMachine.html' }),
  // CreateActivity name — 위와 같은 금지 문자 · 1~80 · "This name must be unique for your Amazon Web Services account and region."
  rule({ id: 'aws.stepfunctions_activity', displayName: 'Step Functions Activity', slug: 'act', minLength: 1, maxLength: 80, pattern: SFN_NAME, scope: 'aws:region', entity: 'AWS::StepFunctions::Activity', category: 'compute', docUrl: 'https://docs.aws.amazon.com/step-functions/latest/apireference/API_CreateActivity.html' }),
  // CreateEventBus Name "Length Constraints: Minimum length of 1. Maximum length of 256. Pattern: [/\.\-_A-Za-z0-9]+" · "Custom event bus names can't contain the / character" · "You can't use the name default for a custom event bus" — 서버: aws. 로 시작하면 거부("EventBus name starting with 'aws.' is not valid")
  rule({ id: 'aws.events_event_bus', displayName: 'EventBridge Event Bus', slug: 'bus', minLength: 1, maxLength: 256, pattern: /^[.\-_A-Za-z0-9]{1,256}$/, forbidden: { prefixes: ['aws.'], exact: ['default'] }, scope: 'aws:region', entity: 'AWS::Events::EventBus', category: 'compute', docUrl: 'https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_CreateEventBus.html', evidence: EVENTS_EVENT_BUS_EVIDENCE, notes: [NARROWER] }),
  // PutRule Name "Length Constraints: Minimum length of 1. Maximum length of 64. Pattern: [\.\-_A-Za-z0-9]+" — 버스마다 유일한지 원문에 없다
  rule({ id: 'aws.events_rule', displayName: 'EventBridge Rule', slug: 'evr', minLength: 1, maxLength: 64, pattern: /^[.\-_A-Za-z0-9]{1,64}$/, scope: 'aws:region', entity: 'AWS::Events::Rule', category: 'compute', docUrl: 'https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_PutRule.html', notes: [SCOPE] }),
  // CreateArchive ArchiveName "Minimum length of 1. Maximum length of 48. Pattern: [\.\-_A-Za-z0-9]+"
  rule({ id: 'aws.events_archive', displayName: 'EventBridge Archive', slug: 'arc', minLength: 1, maxLength: 48, pattern: /^[.\-_A-Za-z0-9]{1,48}$/, scope: 'aws:region', entity: 'AWS::Events::Archive', category: 'compute', docUrl: 'https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_CreateArchive.html', notes: [SCOPE] }),
  // CreateConnection Name "Minimum length of 1. Maximum length of 64. Pattern: [\.\-_A-Za-z0-9]+"
  rule({ id: 'aws.events_connection', displayName: 'EventBridge Connection', slug: 'conn', minLength: 1, maxLength: 64, pattern: /^[.\-_A-Za-z0-9]{1,64}$/, scope: 'aws:region', entity: 'AWS::Events::Connection', category: 'compute', docUrl: 'https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_CreateConnection.html', notes: [SCOPE] }),
  // CreateApiDestination Name "Minimum length of 1. Maximum length of 64. Pattern: [\.\-_A-Za-z0-9]+"
  rule({ id: 'aws.events_api_destination', displayName: 'EventBridge API Destination', slug: 'apid', minLength: 1, maxLength: 64, pattern: /^[.\-_A-Za-z0-9]{1,64}$/, scope: 'aws:region', entity: 'AWS::Events::ApiDestination', category: 'compute', docUrl: 'https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_CreateApiDestination.html', notes: [SCOPE] }),
  // CreateSchedule Name "Minimum length of 1. Maximum length of 64. Pattern: ^[0-9a-zA-Z-_.]+$" — 일정은 일정 그룹 아래다(GroupName)
  rule({ id: 'aws.scheduler_schedule', displayName: 'EventBridge Scheduler Schedule', slug: 'sch', minLength: 1, maxLength: 64, pattern: /^[0-9a-zA-Z_.-]{1,64}$/, scope: 'aws:scheduler_schedule_group', entity: 'AWS::Scheduler::Schedule', category: 'compute', docUrl: 'https://docs.aws.amazon.com/scheduler/latest/APIReference/API_CreateSchedule.html', notes: [SCOPE] }),
  // CreateScheduleGroup Name "Minimum length of 1. Maximum length of 64. Pattern: ^[0-9a-zA-Z-_.]+$" — 서버: default 는 "This operation cannot be performed on schedule group default."
  rule({ id: 'aws.scheduler_schedule_group', displayName: 'EventBridge Scheduler Schedule Group', slug: 'schg', minLength: 1, maxLength: 64, pattern: /^[0-9a-zA-Z_.-]{1,64}$/, forbidden: { exact: ['default'] }, scope: 'aws:region', entity: 'AWS::Scheduler::ScheduleGroup', category: 'compute', docUrl: 'https://docs.aws.amazon.com/scheduler/latest/APIReference/API_CreateScheduleGroup.html', evidence: SCHEDULER_SCHEDULE_GROUP_EVIDENCE, notes: [NARROWER, SCOPE] }),
  // CreateStream StreamName "Minimum length of 1. Maximum length of 128. Pattern: [a-zA-Z0-9_.-]+" · "The stream name is scoped to the Amazon Web Services account … It is also scoped by Amazon Web Services Region."
  rule({ id: 'aws.kinesis_stream', displayName: 'Kinesis Data Stream', slug: 'kds', minLength: 1, maxLength: 128, pattern: /^[a-zA-Z0-9_.-]{1,128}$/, scope: 'aws:region', entity: 'AWS::Kinesis::Stream', category: 'database', docUrl: 'https://docs.aws.amazon.com/kinesis/latest/APIReference/API_CreateStream.html' }),
  // CreateDeliveryStream DeliveryStreamName "Minimum length of 1. Maximum length of 64. Pattern: [a-zA-Z0-9._-]+" · "This name must be unique per Amazon Web Services account in the same Amazon Web Services Region."
  rule({ id: 'aws.firehose_delivery_stream', displayName: 'Firehose Stream', slug: 'fh', minLength: 1, maxLength: 64, pattern: /^[a-zA-Z0-9_.-]{1,64}$/, scope: 'aws:region', entity: 'AWS::KinesisFirehose::DeliveryStream', category: 'database', docUrl: 'https://docs.aws.amazon.com/firehose/latest/APIReference/API_CreateDeliveryStream.html' }),
  // CreateUserPool PoolName "Minimum length of 1. Maximum length of 128. Pattern: [\w\s+=,.@-]+" — 이름이 유일하지 않다: 같은 이름의 두 번째 풀이 만들어졌다(2026-10-25)
  rule({ id: 'aws.cognito_user_pool', displayName: 'Cognito User Pool', slug: 'cup', minLength: 1, maxLength: 128, pattern: COGNITO_NAME, scope: 'aws:region', entity: 'AWS::Cognito::UserPool', category: 'identity', docUrl: 'https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_CreateUserPool.html', uniqueness: 'none' }),
  // CreateUserPoolClient ClientName "Minimum length of 1. Maximum length of 128. Pattern: [\w\s+=,.@-]+" — 같은 풀에 같은 이름의 두 번째 클라이언트가 만들어졌다
  rule({ id: 'aws.cognito_user_pool_client', displayName: 'Cognito User Pool Client', slug: 'cupc', minLength: 1, maxLength: 128, pattern: COGNITO_NAME, scope: 'aws:cognito_user_pool', entity: 'AWS::Cognito::UserPoolClient', category: 'identity', docUrl: 'https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_CreateUserPoolClient.html', uniqueness: 'none' }),
  // CreateIdentityPool IdentityPoolName "Minimum length of 1. Maximum length of 128. Pattern: [\w\s+=,.@-]+" — 같은 이름의 두 번째 풀이 만들어졌다
  rule({ id: 'aws.cognito_identity_pool', displayName: 'Cognito Identity Pool', slug: 'cip', minLength: 1, maxLength: 128, pattern: COGNITO_NAME, scope: 'aws:region', entity: 'AWS::Cognito::IdentityPool', category: 'identity', docUrl: 'https://docs.aws.amazon.com/cognitoidentity/latest/APIReference/API_CreateIdentityPool.html', uniqueness: 'none' }),
  // PutMetricAlarm AlarmName "Minimum length of 1. Maximum length of 255." · "This name must be unique within the Region. The name must contain only UTF-8 characters, and can't contain ASCII control characters" — 보이지 않는 글자는 함께 뺀다(좁히는 쪽)
  rule({ id: 'aws.cloudwatch_alarm', displayName: 'CloudWatch Alarm', slug: 'alarm', minLength: 1, maxLength: 255, pattern: new RegExp(`${NO_INVISIBLE}^.{1,255}$`, 'u'), scope: 'aws:region', entity: 'AWS::CloudWatch::Alarm', category: 'management', docUrl: 'https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_PutMetricAlarm.html' }),
  // PutCompositeAlarm AlarmName "Minimum length of 1. Maximum length of 255." · "This name must be unique within the Region." — 글자 문장이 없어 지표 경보와 같은 규칙(서버: 제어 문자 거부)
  rule({ id: 'aws.cloudwatch_composite_alarm', displayName: 'CloudWatch Composite Alarm', slug: 'calarm', minLength: 1, maxLength: 255, pattern: new RegExp(`${NO_INVISIBLE}^.{1,255}$`, 'u'), scope: 'aws:region', entity: 'AWS::CloudWatch::CompositeAlarm', category: 'management', docUrl: 'https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_PutCompositeAlarm.html' }),
  // PutDashboard DashboardName "The maximum length is 255, and valid characters are A-Z, a-z, 0-9, \"-\", and \"_\"." — 대시보드는 지역이 없다(계정 전역)
  rule({ id: 'aws.cloudwatch_dashboard', displayName: 'CloudWatch Dashboard', slug: 'dash', minLength: 1, maxLength: 255, pattern: /^[A-Za-z0-9_-]{1,255}$/, scope: 'aws:account', entity: 'AWS::CloudWatch::Dashboard', category: 'management', docUrl: 'https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_PutDashboard.html', notes: [SCOPE] }),
  // PutParameter Name "A parameter name must be unique within an Amazon Web Services Region" · "can't be prefixed with aws or ssm (case-insensitive)" · "only the following symbols and letters: a-zA-Z0-9_.-" · "/" 는 계층 · "Parameter hierarchies are limited to a maximum depth of fifteen levels." · "The reported maximum length of 2048 characters for a parameter name includes 1037 characters that are reserved for internal use" → 1011
  rule({ id: 'aws.ssm_parameter', displayName: 'SSM Parameter', slug: 'param', minLength: 1, maxLength: 1011, pattern: /^(?:\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+){0,14}|[A-Za-z0-9_.-]+)$/, forbidden: { prefixes: ['aws', 'ssm', '/aws', '/ssm'], ignoreCase: true }, scope: 'aws:region', entity: 'AWS::SSM::Parameter', category: 'management', docUrl: 'https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_PutParameter.html' }),
  // CreateDocument Name "Pattern: ^[a-zA-Z0-9_\-.]{3,128}$" · "You can't use the following strings as document name prefixes … aws amazon amzn AWSEC2 AWSConfigRemediation AWSSupport" — 셋을 대소문자 없이 뺀다(나머지 셋은 aws 로 시작한다). 서버는 aws- · amazon · amzn 으로 시작하는 이름만 거부했다(awsx · AWSEC2x 는 생성) — 규칙이 더 좁다
  rule({ id: 'aws.ssm_document', displayName: 'SSM Document', slug: 'ssmdoc', minLength: 3, maxLength: 128, pattern: /^[a-zA-Z0-9_.-]{3,128}$/, forbidden: { prefixes: ['aws', 'amazon', 'amzn'], ignoreCase: true }, scope: 'aws:region', entity: 'AWS::SSM::Document', category: 'management', docUrl: 'https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_CreateDocument.html', notes: [SCOPE] }),
  // CreateMaintenanceWindow Name "Minimum length of 3. Maximum length of 128. Pattern: ^[a-zA-Z0-9_\-.]{3,128}$"
  rule({ id: 'aws.ssm_maintenance_window', displayName: 'SSM Maintenance Window', slug: 'mw', minLength: 3, maxLength: 128, pattern: /^[a-zA-Z0-9_.-]{3,128}$/, scope: 'aws:region', entity: 'AWS::SSM::MaintenanceWindow', category: 'management', docUrl: 'https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_CreateMaintenanceWindow.html', notes: [SCOPE] }),
  // CreateBackupVault BackupVaultName "Pattern: ^[a-zA-Z0-9\-\_]{2,50}$" · 설명 "They consist of letters, numbers, and hyphens." · "unique to the account … and the Amazon Web Services Region" — 두 원문이 밑줄에서 갈려 좁은 쪽(밑줄 없음)을 쓴다(D20)
  rule({ id: 'aws.backup_vault', displayName: 'Backup Vault', slug: 'bkv', minLength: 2, maxLength: 50, pattern: /^[A-Za-z0-9-]{2,50}$/, scope: 'aws:region', entity: 'AWS::Backup::BackupVault', category: 'storage', docUrl: 'https://docs.aws.amazon.com/aws-backup/latest/devguide/API_CreateBackupVault.html', notes: [NARROWED_SOURCE] }),
  // BackupPlanInput BackupPlanName "The display name of a backup plan. Must contain 1 to 50 alphanumeric or '-_.' characters." — 서버는 51자 · : 도 받았다(규칙이 더 좁다)
  rule({ id: 'aws.backup_plan', displayName: 'Backup Plan', slug: 'bkp', minLength: 1, maxLength: 50, pattern: /^[A-Za-z0-9_.-]{1,50}$/, scope: 'aws:region', entity: 'AWS::Backup::BackupPlan', category: 'storage', docUrl: 'https://docs.aws.amazon.com/aws-backup/latest/devguide/API_BackupPlanInput.html', notes: [SCOPE] }),
  // CreateFramework FrameworkName "The name must be between 1 and 256 characters, starting with a letter, and consisting of letters (a-z, A-Z), numbers (0-9), and underscores (_)."
  rule({ id: 'aws.backup_framework', displayName: 'Backup Audit Framework', slug: 'bkf', minLength: 1, maxLength: 256, pattern: /^[a-zA-Z][_a-zA-Z0-9]{0,255}$/, allowed: 'lower-digit-underscore', separator: '_', caseRule: 'lower', startsWithLetter: true, scope: 'aws:region', entity: 'AWS::Backup::Framework', category: 'management', docUrl: 'https://docs.aws.amazon.com/aws-backup/latest/devguide/API_CreateFramework.html', notes: [SCOPE] }),
  // CreateReportPlan ReportPlanName — 같은 문장(1~256 · 글자로 시작 · 영숫자와 밑줄)
  rule({ id: 'aws.backup_report_plan', displayName: 'Backup Report Plan', slug: 'bkr', minLength: 1, maxLength: 256, pattern: /^[a-zA-Z][_a-zA-Z0-9]{0,255}$/, allowed: 'lower-digit-underscore', separator: '_', caseRule: 'lower', startsWithLetter: true, scope: 'aws:region', entity: 'AWS::Backup::ReportPlan', category: 'management', docUrl: 'https://docs.aws.amazon.com/aws-backup/latest/devguide/API_CreateReportPlan.html', notes: [SCOPE] }),
  // CreateDomain DomainName "Minimum length of 3. Maximum length of 28. Pattern: [a-z][a-z0-9\-]+" · "Domain names are unique across the domains owned by an account within an Amazon Web Services Region."
  rule({ id: 'aws.opensearch_domain', displayName: 'OpenSearch Domain', slug: 'os', minLength: 3, maxLength: 28, pattern: /^[a-z][a-z0-9-]{2,27}$/, allowed: 'lower-digit-hyphen', caseRule: 'lower', startsWithLetter: true, scope: 'aws:region', entity: 'AWS::OpenSearchService::Domain', category: 'database', docUrl: 'https://docs.aws.amazon.com/opensearch-service/latest/APIReference/API_CreateDomain.html' }),
  // CreateJob Name "Length Constraints: Minimum length of 1. Maximum length of 255. Pattern: [\u0020-\uD7FF\uE000-\uFFFD\uD800\uDC00-\uDBFF\uDFFF\t]*" · "It must be unique in your account." — 보이지 않는 글자는 함께 뺀다(좁히는 쪽)
  rule({ id: 'aws.glue_job', displayName: 'Glue Job', slug: 'gluejob', minLength: 1, maxLength: 255, pattern: GLUE_NAME, scope: 'aws:region', entity: 'AWS::Glue::Job', category: 'database', docUrl: 'https://docs.aws.amazon.com/glue/latest/webapi/API_CreateJob.html' }),
  // CreateCrawler Name — 같은 길이 · Pattern
  rule({ id: 'aws.glue_crawler', displayName: 'Glue Crawler', slug: 'crawler', minLength: 1, maxLength: 255, pattern: GLUE_NAME, scope: 'aws:region', entity: 'AWS::Glue::Crawler', category: 'database', docUrl: 'https://docs.aws.amazon.com/glue/latest/webapi/API_CreateCrawler.html', notes: [SCOPE] }),
  // DatabaseInput Name — 같은 길이 · Pattern · "For Hive compatibility, this is folded to lowercase when it is stored."
  rule({ id: 'aws.glue_database', displayName: 'Glue Database', slug: 'gluedb', minLength: 1, maxLength: 255, pattern: GLUE_NAME, scope: 'aws:region', entity: 'AWS::Glue::Database', category: 'database', docUrl: 'https://docs.aws.amazon.com/glue/latest/webapi/API_DatabaseInput.html', notes: [SCOPE] }),
  // TableInput Name — 같은 길이 · Pattern · 소문자로 접는다. 서버: 다른 데이터베이스에 같은 이름 생성 · 같은 데이터베이스의 T 는 t 뒤 "Table already exists."
  rule({ id: 'aws.glue_table', displayName: 'Glue Table', slug: 'gluetbl', minLength: 1, maxLength: 255, pattern: GLUE_NAME, scope: 'aws:glue_database', entity: 'AWS::Glue::Table', category: 'database', docUrl: 'https://docs.aws.amazon.com/glue/latest/webapi/API_TableInput.html' }),
  // ConnectionInput Name — 같은 길이 · Pattern. 서버는 256자 연결도 만들었지만 DeleteConnection 이 255자를 넘는 이름을 거부해 지울 수 없다 — 255 를 지킨다
  rule({ id: 'aws.glue_connection', displayName: 'Glue Connection', slug: 'glueconn', minLength: 1, maxLength: 255, pattern: GLUE_NAME, scope: 'aws:region', entity: 'AWS::Glue::Connection', category: 'database', docUrl: 'https://docs.aws.amazon.com/glue/latest/webapi/API_ConnectionInput.html', notes: [SCOPE, { code: 'note.delete_limit_255' }] }),
  // CreateTrigger Name — 같은 길이 · Pattern
  rule({ id: 'aws.glue_trigger', displayName: 'Glue Trigger', slug: 'gluetrg', minLength: 1, maxLength: 255, pattern: GLUE_NAME, scope: 'aws:region', entity: 'AWS::Glue::Trigger', category: 'database', docUrl: 'https://docs.aws.amazon.com/glue/latest/webapi/API_CreateTrigger.html', notes: [SCOPE] }),
  // CreateWorkflow Name — 같은 길이 · Pattern · "It should be unique within your account."
  rule({ id: 'aws.glue_workflow', displayName: 'Glue Workflow', slug: 'gluewf', minLength: 1, maxLength: 255, pattern: GLUE_NAME, scope: 'aws:region', entity: 'AWS::Glue::Workflow', category: 'database', docUrl: 'https://docs.aws.amazon.com/glue/latest/webapi/API_CreateWorkflow.html' }),
  // CreateWorkGroup Name "Pattern: [a-zA-Z0-9._-]{1,128}" — 서버: primary 는 "primary workGroup could not be created"
  rule({ id: 'aws.athena_workgroup', displayName: 'Athena Workgroup', slug: 'wg', minLength: 1, maxLength: 128, pattern: /^[a-zA-Z0-9._-]{1,128}$/, forbidden: { exact: ['primary'] }, scope: 'aws:region', entity: 'AWS::Athena::WorkGroup', category: 'database', docUrl: 'https://docs.aws.amazon.com/athena/latest/APIReference/API_CreateWorkGroup.html', evidence: ATHENA_WORKGROUP_EVIDENCE, notes: [NARROWER, SCOPE] }),
  // CreateDataCatalog Name "The catalog name must be unique for the Amazon Web Services account and can use a maximum of 127 alphanumeric, underscore, at sign, or hyphen characters." — 서버는 128자까지 만들고 129자부터 거부, AwsDataCatalog 는 "is reserved". FEDERATED 는 41자(원문)
  rule({ id: 'aws.athena_data_catalog', displayName: 'Athena Data Catalog', slug: 'dc', minLength: 1, maxLength: 127, pattern: /^[A-Za-z0-9_@-]{1,127}$/, forbidden: { exact: ['awsdatacatalog'], ignoreCase: true }, scope: 'aws:account', entity: 'AWS::Athena::DataCatalog', category: 'database', docUrl: 'https://docs.aws.amazon.com/athena/latest/APIReference/API_CreateDataCatalog.html', evidence: ATHENA_DATA_CATALOG_EVIDENCE, notes: [NARROWER] }),
  // CreateProject name "Length Constraints: Minimum length of 2. Maximum length of 150. Pattern: [A-Za-z0-9][A-Za-z0-9\-_]{1,149}"
  rule({ id: 'aws.codebuild_project', displayName: 'CodeBuild Project', slug: 'cb', minLength: 2, maxLength: 150, pattern: /^[A-Za-z0-9][A-Za-z0-9_-]{1,149}$/, scope: 'aws:region', entity: 'AWS::CodeBuild::Project', category: 'management', docUrl: 'https://docs.aws.amazon.com/codebuild/latest/APIReference/API_CreateProject.html', notes: [SCOPE] }),
  // PipelineDeclaration name "Length Constraints: Minimum length of 1. Maximum length of 100. Pattern: [A-Za-z0-9.@\-_]+"
  rule({ id: 'aws.codepipeline_pipeline', displayName: 'CodePipeline Pipeline', slug: 'pipe', minLength: 1, maxLength: 100, pattern: /^[A-Za-z0-9.@_-]{1,100}$/, scope: 'aws:region', entity: 'AWS::CodePipeline::Pipeline', category: 'management', docUrl: 'https://docs.aws.amazon.com/codepipeline/latest/APIReference/API_PipelineDeclaration.html', notes: [SCOPE] }),
  // CreateComputeEnvironment computeEnvironmentName "It can be up to 128 characters long. It can contain uppercase and lowercase letters, numbers, hyphens (-), and underscores (_)." — 서버는 앞 하이픈을 거부("should match a valid pattern") — 첫 글자는 영숫자
  rule({ id: 'aws.batch_compute_environment', displayName: 'Batch Compute Environment', slug: 'ce', minLength: 1, maxLength: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/, scope: 'aws:region', entity: 'AWS::Batch::ComputeEnvironment', category: 'compute', docUrl: 'https://docs.aws.amazon.com/batch/latest/APIReference/API_CreateComputeEnvironment.html', evidence: BATCH_COMPUTE_ENVIRONMENT_EVIDENCE, notes: [NARROWER, SCOPE] }),
  // CreateJobQueue jobQueueName "It can be up to 128 letters long. It can contain uppercase and lowercase letters, numbers, hyphens (-), and underscores (_)." — 서버: 앞 하이픈 거부
  rule({ id: 'aws.batch_job_queue', displayName: 'Batch Job Queue', slug: 'jq', minLength: 1, maxLength: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/, scope: 'aws:region', entity: 'AWS::Batch::JobQueue', category: 'compute', docUrl: 'https://docs.aws.amazon.com/batch/latest/APIReference/API_CreateJobQueue.html', evidence: BATCH_JOB_QUEUE_EVIDENCE, notes: [NARROWER, SCOPE] }),
  // RegisterJobDefinition jobDefinitionName "It can be up to 128 letters long. It can contain uppercase and lowercase letters, numbers, hyphens (-), and underscores (_)." — 서버: 앞 하이픈 거부
  rule({ id: 'aws.batch_job_definition', displayName: 'Batch Job Definition', slug: 'jd', minLength: 1, maxLength: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/, scope: 'aws:region', entity: 'AWS::Batch::JobDefinition', category: 'compute', docUrl: 'https://docs.aws.amazon.com/batch/latest/APIReference/API_RegisterJobDefinition.html', evidence: BATCH_JOB_DEFINITION_EVIDENCE, notes: [NARROWER, SCOPE] }),
  // CreateWebACL Name "Length Constraints: Minimum length of 1. Maximum length of 128. Pattern: ^[\w\-]+$" — 범위(REGIONAL · CLOUDFRONT)마다 따로다
  rule({ id: 'aws.wafv2_web_acl', displayName: 'WAF Web ACL', slug: 'waf', minLength: 1, maxLength: 128, pattern: /^[\w-]{1,128}$/, scope: 'aws:region', entity: 'AWS::WAFv2::WebACL', category: 'security', docUrl: 'https://docs.aws.amazon.com/waf/latest/APIReference/API_CreateWebACL.html', notes: [SCOPE] }),
  // CreateIPSet Name — 같은 길이 · Pattern
  rule({ id: 'aws.wafv2_ip_set', displayName: 'WAF IP Set', slug: 'ipset', minLength: 1, maxLength: 128, pattern: /^[\w-]{1,128}$/, scope: 'aws:region', entity: 'AWS::WAFv2::IPSet', category: 'security', docUrl: 'https://docs.aws.amazon.com/waf/latest/APIReference/API_CreateIPSet.html', notes: [SCOPE] }),
  // CreateRuleGroup Name — 같은 길이 · Pattern
  rule({ id: 'aws.wafv2_rule_group', displayName: 'WAF Rule Group', slug: 'wafrg', minLength: 1, maxLength: 128, pattern: /^[\w-]{1,128}$/, scope: 'aws:region', entity: 'AWS::WAFv2::RuleGroup', category: 'security', docUrl: 'https://docs.aws.amazon.com/waf/latest/APIReference/API_CreateRuleGroup.html', notes: [SCOPE] }),
  // CreateGraphqlApi name "A user-supplied name for the GraphqlApi." — 길이 · 글자 문장이 없다(D80). 서버: 512자 생성 · 513자 "The GraphQL API name is invalid" · 공백 · 한글 · / · : · # 생성. 같은 이름의 두 번째 API 도 만들어졌다
  rule({ id: 'aws.appsync_graphql_api', displayName: 'AppSync GraphQL API', slug: 'gql', minLength: 1, maxLength: 512, pattern: new RegExp(`${NO_INVISIBLE}^.{1,512}$`, 'u'), scope: 'aws:region', entity: 'AWS::AppSync::GraphQLApi', category: 'compute', docUrl: 'https://docs.aws.amazon.com/appsync/latest/APIReference/API_CreateGraphqlApi.html', uniqueness: 'none', evidence: APPSYNC_GRAPHQL_API_EVIDENCE, notes: [OBSERVED] }),
  // CreateFunction Name "Minimum length of 1. Maximum length of 64. Pattern: [a-zA-Z0-9-_]{1,64}" — CloudFront 는 전역이다
  rule({ id: 'aws.cloudfront_function', displayName: 'CloudFront Function', slug: 'cff', minLength: 1, maxLength: 64, pattern: /^[a-zA-Z0-9_-]{1,64}$/, scope: 'aws:account', entity: 'AWS::CloudFront::Function', category: 'networking', docUrl: 'https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_CreateFunction.html', notes: [SCOPE] }),
  // CreateKeyValueStore Name "The minimum length is 1 character and the maximum length is 64 characters." · Pattern [a-zA-Z0-9-_]{1,64}
  rule({ id: 'aws.cloudfront_key_value_store', displayName: 'CloudFront KeyValueStore', slug: 'kvs', minLength: 1, maxLength: 64, pattern: /^[a-zA-Z0-9_-]{1,64}$/, scope: 'aws:account', entity: 'AWS::CloudFront::KeyValueStore', category: 'networking', docUrl: 'https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_CreateKeyValueStore.html', notes: [SCOPE] }),
];

export const AWS_MANUAL_RULES: Record<string, ResourceRule> = Object.fromEntries(RULES.map((r) => [r.id, r]));
