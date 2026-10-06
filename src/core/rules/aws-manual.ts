// 손으로 넣은 AWS 규칙 (D43) — CloudFormation 리소스 스키마에 pattern · maxLength 가 없어 생성기가 보류한 타입을
// 각 서비스 API 참조(Create* · Put* · Register*)에서 다시 읽고 옮겼다. 거기에 값이 없으면 데이터형 쪽 · 사용자 안내서 · 스키마 설명.
// 행마다 위 주석이 근거 URL 과 원문 인용이다. 유일 범위를 적은 문장이 없는 행은 note.scope_unconfirmed 를 싣는다.
// rules/aws.ts 가 손 규칙 · 들인 행과 합친다.
import type { CoreMessage } from '../messages';
import type { ResourceRule, Token } from '../types';
import type { ScopeDef } from '../scopes';

const SCOPE: CoreMessage = { code: 'note.scope_unconfirmed' };
const ADVISORY: CoreMessage = { code: 'note.advisory_rule_enforced' };
const SECONDARY: CoreMessage = { code: 'note.secondary_source' };

const PLACED: Token[] = ['system', 'purpose', 'env', 'region', 'slug', 'seq'];
/** 계정 범위(IAM)는 지역이 없다 */
const ACCOUNT: Token[] = ['system', 'purpose', 'env', 'slug', 'seq'];
const CFN_SCHEMA = 'https://schema.cloudformation.us-east-1.amazonaws.com/CloudformationSchema.zip';

const ELB_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,30}[A-Za-z0-9])?$/;
const DYNAMODB_NAME = /^[a-zA-Z0-9_.-]{3,255}$/;
const ECS_NAME = /^[A-Za-z0-9_-]{1,255}$/;
const IAM_128 = /^[\w+=,.@-]{1,128}$/;
const LOGS_NAME = /^[^:*]{1,512}$/;

type Spec = Pick<ResourceRule, 'id' | 'displayName' | 'slug' | 'minLength' | 'maxLength' | 'pattern' | 'scope' | 'entity' | 'category' | 'docUrl'>
  & Partial<Pick<ResourceRule, 'forbidden' | 'noConsecutiveSeparator' | 'allowed' | 'caseRule' | 'startsWithLetter' | 'endsWithAlnum' | 'notes' | 'uniquenessDocUrl'>>;

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
export type AwsManualScopeId = 'aws:ecs_cluster' | 'aws:log_group';
export const AWS_MANUAL_SCOPES: Record<AwsManualScopeId, ScopeDef> = {
  // CreateService "Service names must be unique within a cluster"
  'aws:ecs_cluster': { id: 'aws:ecs_cluster', provider: 'aws', displayName: 'ECS cluster', parent: 'aws:region', ruleId: 'aws.ecs_cluster', docUrl: 'https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_CreateService.html' },
  // CreateLogStream "Log stream names must be unique within the log group."
  'aws:log_group': { id: 'aws:log_group', provider: 'aws', displayName: 'Log group', parent: 'aws:region', ruleId: 'aws.logs_log_group', docUrl: 'https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_CreateLogStream.html' },
};

const RULES: ResourceRule[] = [
  // ── EC2 ──
  // LaunchTemplate 데이터형 "launchTemplateName — The name of the launch template. … Length Constraints: Minimum length of 3. Maximum length of 128. Pattern: [a-zA-Z0-9\(\)\.\-/_]+"
  // 요청(CreateLaunchTemplate)에는 "A name for the launch template." 뿐이다
  rule({ id: 'aws.ec2_launch_template', displayName: 'EC2 Launch Template', slug: 'lt', minLength: 3, maxLength: 128, pattern: /^[a-zA-Z0-9().\/_-]{3,128}$/,
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
  // 끝 규칙은 원문이 권고다 — 거부한다
  rule({ id: 'aws.secretsmanager_secret', displayName: 'SecretsManager Secret', slug: 'secret', minLength: 1, maxLength: 512, pattern: /^(?!.*-[A-Za-z0-9/_+=.@-]{6}$)[A-Za-z0-9/_+=.@-]{1,512}$/,
    scope: 'aws:region', entity: 'AWS::SecretsManager::Secret', category: 'security', docUrl: 'https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_CreateSecret.html', notes: [ADVISORY, SCOPE] }),

  // ── CloudWatch Logs ──
  // "Log stream names must be unique within the log group. … Length Constraints: Minimum length of 1. Maximum length of 512. Pattern: [^:*]*"
  rule({ id: 'aws.logs_log_stream', displayName: 'Logs Log Stream', slug: 'ls', minLength: 1, maxLength: 512, pattern: LOGS_NAME,
    scope: 'aws:log_group', entity: 'AWS::Logs::LogStream', category: 'management', docUrl: 'https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_CreateLogStream.html' }),
  // PutSubscriptionFilter "Length Constraints: Minimum length of 1. Maximum length of 512. Pattern: [^:*]*" — 로그 그룹에 딸리지만 범위 문장은 없다
  rule({ id: 'aws.logs_subscription_filter', displayName: 'Logs Subscription Filter', slug: 'sf', minLength: 1, maxLength: 512, pattern: LOGS_NAME,
    scope: 'aws:log_group', entity: 'AWS::Logs::SubscriptionFilter', category: 'management', docUrl: 'https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_PutSubscriptionFilter.html', notes: [SCOPE] }),
];

export const AWS_MANUAL_RULES: Record<string, ResourceRule> = Object.fromEntries(RULES.map((r) => [r.id, r]));
