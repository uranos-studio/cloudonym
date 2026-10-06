// AWS 정형 행 → 규칙 데이터 생성기 (D43). 개발 때만 돈다(번들 · CI 밖).
//
// 사용:
//   node scripts/rules/build-aws-rules.mjs --measure <스키마 폴더> > anchors.json
//       CloudFormation 템플릿 참조 쪽을 받아 속성 앵커가 있는지 잰다(네트워크)
//   node scripts/rules/build-aws-rules.mjs <스키마 폴더> --anchors anchors.json
//       <스키마 폴더> = https://schema.cloudformation.us-east-1.amazonaws.com/CloudformationSchema.zip 을 푼 것
// 입력 판정 표: scripts/rules/aws-intake-targets.json — 18개 네임스페이스 298 타입의 a(물리 이름) · b(Name 태그뿐) · c · d
// 쓰는 파일:
//   src/core/rules/aws-intake.ts                     — 규칙 행
//   src/core/__fixtures__/aws-intake.json            — 원문(스키마) 행 스냅샷(전사 검사의 정답)
//   src/core/__fixtures__/rule-cases-aws-intake.json — 행마다 통과 · 실패 예
//   docs/aws-intake-held.md                          — 이번에 넣지 않은 행과 사유
//
// 원칙:
//   a — 스키마의 이름 속성에 pattern 과 maxLength 가 둘 다 있을 때만 정형. pattern 은 그대로 싣고 rules/aws.ts 가
//       ^(?:…)$ 로 감싼다(앵커 없는 스키마 pattern 을 이름 전체로 읽는다 — 좁히는 쪽 · D20). `\Z` 는 `$` 로 읽는다.
//       pattern 이 ARN 을 받거나 · 기호까지 덮는 범위(0-z)를 쓰거나 · 평범한 이름을 하나도 받지 않으면(고정 접두) 보류.
//   b — Name 태그. EC2 는 기존 aws.vpc 와 같은 규칙(아무 문자 1~256), 다른 서비스는 일반 태그 값 문자 규칙(좁다).
//   통과 · 실패 예는 a 행마다 사람이 pattern 을 읽고 적은 것(PHYSICAL_CASES)이다 — 정규식에서 뽑지 않는다.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { sq, dq, idLit, intLit, boolLit } from './emit-ts.mjs';
import { typeWords, typeSnake, abbreviateSnake, hasSingleLetterToken } from './naming.mjs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SCHEMA_URL = 'https://schema.cloudformation.us-east-1.amazonaws.com/CloudformationSchema.zip';
const CFN_REF = 'https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference';
const TARGETS = new URL('./aws-intake-targets.json', import.meta.url);

/** 이미 손으로 쓴 규칙 — 타입 → 규칙 id (entity 꼴이 달라 이름으로 잇는다. 전사 검사가 RULES 에 있는지 본다) */
export const EXISTING = {
  'AWS::S3::Bucket': 'aws.s3_bucket', 'AWS::IAM::Role': 'aws.iam_role', 'AWS::RDS::DBInstance': 'aws.rds_instance',
  'AWS::EC2::SecurityGroup': 'aws.security_group', 'AWS::EC2::KeyPair': 'aws.key_pair',
  'AWS::EC2::VPC': 'aws.vpc', 'AWS::EC2::Subnet': 'aws.subnet', 'AWS::EC2::Instance': 'aws.ec2_instance',
  'AWS::EC2::InternetGateway': 'aws.internet_gateway', 'AWS::EC2::RouteTable': 'aws.route_table', 'AWS::EC2::Volume': 'aws.ebs_volume',
};

/** 손으로 넣은 규칙(src/core/rules/aws-manual.ts · D43) — API 참조에서 다시 읽고 넣은 타입. 손 규칙처럼 건너뛴다 */
export const MANUAL = {
  'AWS::EC2::LaunchTemplate': 'aws.ec2_launch_template',
  'AWS::ElasticLoadBalancing::LoadBalancer': 'aws.elb_load_balancer',
  'AWS::ElasticLoadBalancingV2::LoadBalancer': 'aws.elbv2_load_balancer',
  'AWS::ElasticLoadBalancingV2::TargetGroup': 'aws.elbv2_target_group',
  'AWS::ElasticLoadBalancingV2::TrustStore': 'aws.elbv2_trust_store',
  'AWS::S3::StorageLensGroup': 'aws.s3_storage_lens_group',
  'AWS::DynamoDB::GlobalTable': 'aws.dynamodb_global_table',
  'AWS::DynamoDB::Table': 'aws.dynamodb_table',
  'AWS::ElastiCache::CacheCluster': 'aws.elasticache_cache_cluster',
  'AWS::ElastiCache::ReplicationGroup': 'aws.elasticache_replication_group',
  'AWS::ElastiCache::SubnetGroup': 'aws.elasticache_subnet_group',
  'AWS::RDS::DBSubnetGroup': 'aws.rds_db_subnet_group',
  'AWS::RDS::OptionGroup': 'aws.rds_option_group',
  'AWS::ECS::CapacityProvider': 'aws.ecs_capacity_provider',
  'AWS::ECS::Cluster': 'aws.ecs_cluster',
  'AWS::ECS::Daemon': 'aws.ecs_daemon',
  'AWS::ECS::DaemonTaskDefinition': 'aws.ecs_daemon_task_definition',
  'AWS::ECS::ExpressGatewayService': 'aws.ecs_express_gateway_service',
  'AWS::ECS::Service': 'aws.ecs_service',
  'AWS::ECS::TaskDefinition': 'aws.ecs_task_definition',
  'AWS::EKS::Nodegroup': 'aws.eks_nodegroup',
  'AWS::ApiGateway::Stage': 'aws.apigw_stage',
  'AWS::ApiGatewayV2::Stage': 'aws.apigwv2_stage',
  'AWS::Lambda::Alias': 'aws.lambda_alias',
  'AWS::Lambda::Function': 'aws.lambda_function',
  'AWS::Lambda::NetworkConnector': 'aws.lambda_network_connector',
  'AWS::IAM::Group': 'aws.iam_group',
  'AWS::IAM::GroupPolicy': 'aws.iam_group_policy',
  'AWS::IAM::InstanceProfile': 'aws.iam_instance_profile',
  'AWS::IAM::ManagedPolicy': 'aws.iam_managed_policy',
  'AWS::IAM::RolePolicy': 'aws.iam_role_policy',
  'AWS::IAM::User': 'aws.iam_user',
  'AWS::IAM::UserPolicy': 'aws.iam_user_policy',
  'AWS::SecretsManager::Secret': 'aws.secretsmanager_secret',
  'AWS::Logs::LogStream': 'aws.logs_log_stream',
  'AWS::Logs::SubscriptionFilter': 'aws.logs_subscription_filter',
};

/** 손으로 원문을 다시 읽고도 넣지 않은 타입 — 보류 사유를 이것으로 바꾼다 */
const NO_RULE = 'reviewed by hand — not imported (no length or character rule in the API reference or the resource schema)';
export const HAND_REVIEWED = {
  'AWS::ApiGateway::ApiKey': NO_RULE,
  'AWS::ApiGateway::Authorizer': NO_RULE,
  'AWS::ApiGateway::Model': 'reviewed by hand — unconfirmed (the API says "Must be alphanumeric." but states no maximum length)',
  'AWS::ApiGateway::RequestValidator': NO_RULE,
  'AWS::ApiGateway::RestApi': NO_RULE,
  'AWS::ApiGateway::UsagePlan': NO_RULE,
  'AWS::ApiGateway::VpcLink': NO_RULE,
  'AWS::ApiGatewayV2::Api': NO_RULE,
  'AWS::ApiGatewayV2::Authorizer': NO_RULE,
  'AWS::ApiGatewayV2::Model': 'reviewed by hand — unconfirmed (the API says "Must be alphanumeric." but states no maximum length)',
  'AWS::ApiGatewayV2::VpcLink': NO_RULE,
  'AWS::EC2::FpgaImage': NO_RULE,
  'AWS::EC2::InstanceEventWindow': NO_RULE,
  'AWS::EKS::Addon': 'reviewed by hand — not imported (fixed value: the name must match one returned by DescribeAddonVersions)',
  'AWS::EKS::FargateProfile': NO_RULE,
  'AWS::EKS::IdentityProviderConfig': NO_RULE,
  'AWS::ElastiCache::ServerlessCache': NO_RULE,
  'AWS::ElastiCache::Snapshot': NO_RULE,
  'AWS::Lambda::LayerVersion': 'reviewed by hand — unconfirmed (the maximum of 140 includes the ARN form; no limit is stated for the name alone)',
  'AWS::Logs::LogAnomalyDetector': 'reviewed by hand — not imported (the API states a minimum length of 1 only; no maximum and no character rule)',
  'AWS::RDS::DBProxyTargetGroup': 'reviewed by hand — not imported (fixed value: the schema allows only "default")',
};

/** a 행 통과 · 실패 예 — pattern · 길이를 사람이 읽고 적었다 */
const L = (n, c = 'a') => c.repeat(n);
export const PHYSICAL_CASES = {
  'AWS::ECR::PublicRepository': { valid: ['ab', 'team/app-1', 'my.repo_x'], invalid: ['a', 'Repo', '-repo', 'repo-', 'a//b', 're po'] },
  'AWS::ECR::Repository': { valid: ['ab', 'ns/app--x', 'a__b', 'my.repo'], invalid: ['a', 'App', 'repo-', '_repo', 'a/', 'a b'] },
  'AWS::EKS::Cluster': { valid: ['a', '1Cluster_prod-x'], invalid: ['-abc', '_abc', 'my.cluster', L(101)] },
  'AWS::ElastiCache::ServerlessCacheSnapshot': { valid: ['a', 'snap-01'], invalid: ['1snap', 'Snap', 'snap--x', 'snap-', 'snap_x', L(256)] },
  'AWS::IAM::SAMLProvider': { valid: ['a', 'My_Provider.v1-x'], invalid: ['my provider', 'a+b', L(129)] },
  'AWS::IAM::ServerCertificate': { valid: ['a', 'cert+=,.@-_X'], invalid: ['my cert', 'a/b', L(129)] },
  'AWS::IAM::VirtualMFADevice': { valid: ['mfa+=,.@-_X'], invalid: ['my mfa', 'a#b', L(227)] },
  'AWS::Lambda::MicrovmImage': { valid: ['Img-1_x'], invalid: ['img.1', 'img 1', L(65)] },
  'AWS::Logs::AccountPolicy': { valid: ['policy one/#1'], invalid: ['a:b', 'a*b', L(257)] },
  'AWS::Logs::DeliveryDestination': { valid: ['dest_1-x'], invalid: ['dest.1', 'dest 1', L(61)] },
  'AWS::Logs::DeliverySource': { valid: ['src_1-x'], invalid: ['src.1', 'src 1', L(61)] },
  'AWS::Logs::Destination': { valid: ['dest/one #1'], invalid: ['a:b', 'a*b', L(513)] },
  'AWS::Logs::Integration': { valid: ['int/#1.a-b_c'], invalid: ['int 1', 'int:1', L(51)] },
  'AWS::Logs::LogGroup': { valid: ['/aws/lambda/fn-1', 'my-log'], invalid: ['log group', 'log:1', L(513)] },
  'AWS::Logs::MetricFilter': { valid: ['filter one'], invalid: ['a:b', 'a*b', L(513)] },
  'AWS::Logs::ResourcePolicy': { valid: ['policy', 'a/b'], invalid: ['a/', '/a', 'a//b', 'a:b', 'a*b'] },
  'AWS::Logs::ScheduledQuery': { valid: ['q/#1.a-b_c'], invalid: ['q 1', 'q:1', L(256)] },
  'AWS::RDS::ClusterSnapshot': { valid: ['a', 'Snap-01'], invalid: ['1snap', 'snap--x', 'snap-', 'snap_x', L(64)] },
  'AWS::RDS::DBCluster': { valid: ['a', 'Db-01'], invalid: ['1db', 'db--x', 'db-', 'db_x', L(64)] },
  'AWS::RDS::DBClusterEndpoint': { valid: ['ep-1'], invalid: ['Ep', '1ep', 'ep--1', 'ep-', L(64)] },
  'AWS::RDS::DBSnapshot': { valid: ['Snap-01'], invalid: ['1snap', 'snap--x', 'snap-', L(256)] },
  'AWS::RDS::GlobalCluster': { valid: ['a', 'Global-01'], invalid: ['1g', 'g--x', 'g-', L(64)] },
  'AWS::S3::AccessPoint': { valid: ['ap1', 'my-ap-01'], invalid: ['ab', 'My-ap', '-ap1', 'ap1-', 'my_ap', L(51)] },
  'AWS::S3::MultiRegionAccessPoint': { valid: ['mrap', 'm-1'], invalid: ['ab', 'Mrap', '-mra', 'mra-', L(51)] },
};
/** Name 태그 예 — EC2 는 아무 문자 1~256, 다른 서비스는 일반 태그 값 문자 */
export const EC2_TAG_CASES = { valid: ['web server #1', 'a'], invalid: [L(257)] };
export const GENERAL_TAG_CASES = { valid: ['team-a_1 prod', 'a'], invalid: ['team#1', 'a,b', L(257)] };

// ── 판정 ──────────────────────────────────────────────────────────
/** 스키마 pattern → 이름 전체에 맞는 정규식 원문 (rules/aws.ts 와 같은 규칙) */
export const anchorPattern = (raw) => `^(?:${raw.replace(/\\Z$/, '$')})$`;

/** a 행: 정형이면 null, 아니면 보류 사유 */
export function physicalHold(prop) {
  if (!prop) return 'name property not found in the schema';
  if (prop.pattern === undefined && prop.maxLength === undefined) return 'manual: no pattern and no maxLength in the schema';
  if (prop.pattern === undefined) return 'schema gives a length but no pattern — allowed characters are not stated';
  if (prop.maxLength === undefined) return 'schema gives a pattern but no maxLength';
  if (/arn:/.test(prop.pattern)) return 'pattern also accepts an ARN — not a plain name';
  if (/0-z|A-z/.test(prop.pattern)) return 'character range `0-z` / `A-z` also covers punctuation (`:;<=>?@[\\]^_`) — the schema is looser than the API';
  const re = new RegExp(anchorPattern(prop.pattern));
  if (!['abcde', 'abc-de', 'abc_de', 'Abcde', 'a1bcd'].some((s) => re.test(s))) return 'pattern accepts no plain name (fixed literal prefix)';
  return null;
}

/** 생성 쪽 설정 — pattern 에 이름을 대어 본다 (생성용 문자 집합은 허용 집합의 부분집합이어야 한다) */
export function generationOf(raw) {
  const re = new RegExp(anchorPattern(raw));
  const hyphen = re.test('ab-cd');
  const lowerOnly = !re.test('abCde');
  const underscore = re.test('ab_cd');
  const allowed = !hyphen ? 'lower-digit' : lowerOnly ? 'lower-digit-hyphen' : underscore ? 'alnum-hyphen-underscore' : 'alnum-hyphen';
  return {
    allowed, separator: hyphen ? '-' : '', caseRule: lowerOnly || !hyphen ? 'lower' : 'any',
    startsWithLetter: !re.test('1bcde'), endsWithAlnum: hyphen && !re.test('abcd-'),
    noConsecutiveSeparator: hyphen && !re.test('ab--cd'),
  };
}

const words = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean);
const initials = (s) => words(s).map((w) => w[0].toLowerCase()).join('');
/** 약어 — GCP · Azure 들이기와 같은 규칙: 낱말이 둘 이상이면 머리글자, 하나면 앞 세 글자 */
export function slugOf(type) {
  const w = words(type).map((x) => x.toLowerCase());
  return w.length >= 2 ? w.map((x) => x[0]).join('') : w[0].slice(0, 3);
}
/** resourceType — 40자 이하 · AWS 안 유일 · 한 글자 토막 없음: ① 네임스페이스(소문자 · ELB · API Gateway 는 줄임)_타입
 *  ② 같은 것의 낱말 약어(naming.mjs WORD_ABBREVIATIONS) ③ 네임스페이스_타입 머리글자. 낱말은 naming.mjs typeWords(IPv4 · IoT 를 한 낱말로) */
const NS_SHORT = { ApiGateway: 'apigw', ApiGatewayV2: 'apigwv2', ElasticLoadBalancing: 'elb', ElasticLoadBalancingV2: 'elbv2' };
export function resourceTypeOf(ns, type, used) {
  const n = NS_SHORT[ns] ?? ns.toLowerCase();
  const c = [`${n}_${typeSnake(type)}`, `${n}_${abbreviateSnake(typeSnake(type))}`, `${n}_${initials(type)}`];
  return c.find((x) => x.length <= 40 && !used.has(x) && !hasSingleLetterToken(x)) ?? null;
}

/** 범위 — 스키마에는 유일 범위 칸이 없다. IAM 은 계정(전역 서비스), Multi-Region Access Point 도 계정, 나머지 리전.
 *  Name 태그는 포함 관계(D38): VpcId · SubnetId 속성이 있으면 VPC, 없으면 리전 */
export function scopeOf(kind, typeName, schema) {
  const ns = typeName.split('::')[1];
  if (ns === 'IAM' || typeName === 'AWS::S3::MultiRegionAccessPoint') return 'aws:account';
  if (kind === 'b' && placedInVpc(schema)) return 'aws:vpc';
  return 'aws:region';
}
/** 쓰기 가능한 VpcId · SubnetId 속성이 있는가 — readOnlyProperties(출력 값 · 예: VPC 자신의 VpcId)는 세지 않는다 */
export function placedInVpc(schema) {
  const ro = new Set(schema?.readOnlyProperties ?? []);
  return ['VpcId', 'SubnetId'].some((p) => p in (schema?.properties ?? {}) && !ro.has(`/properties/${p}`));
}

const lower = (s) => s.toLowerCase();
export const cfnDocUrl = (typeName, prop) => {
  const [, ns, type] = typeName.split('::');
  const page = `${CFN_REF}/aws-resource-${lower(ns)}-${lower(type)}.html`;
  return prop ? `${page}#cfn-${lower(ns)}-${lower(type)}-${lower(prop)}` : page;
};

export function readSchemas(dir) {
  const map = new Map();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const s = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
    if (typeof s.typeName === 'string') map.set(s.typeName, s);
  }
  return map;
}

// ── 전체 ──────────────────────────────────────────────────────────
export function build({ schemas, targets, anchors, existingTypes = [...Object.keys(EXISTING), ...Object.keys(MANUAL)], existingResourceTypes = [] }) {
  const rules = [];
  const held = [];
  const sourceRows = [];
  const used = new Set(existingResourceTypes);
  for (const [typeName, t] of Object.entries(targets.types)) {
    if (t.kind !== 'a' && t.kind !== 'b') continue;
    const schema = schemas.get(typeName);
    const prop = t.kind === 'a' ? schema?.properties?.[t.property] : undefined;
    const src = {
      typeName, kind: t.kind, property: t.property ?? null,
      minLength: prop?.minLength ?? null, maxLength: prop?.maxLength ?? null, pattern: prop?.pattern ?? null,
      hasVpcOrSubnet: placedInVpc(schema),
    };
    sourceRows.push(src);
    if (existingTypes.includes(typeName)) { src.existing = EXISTING[typeName] ?? MANUAL[typeName]; continue; }
    if (!schema) { held.push({ src, reason: 'type not in the schema archive' }); continue; }
    const [, ns, type] = typeName.split('::');
    if (t.kind === 'a') {
      const why = physicalHold(prop);
      if (why) { held.push({ src, reason: why }); continue; }
      const docUrl = anchors[typeName];
      if (!docUrl) { held.push({ src, reason: 'anchorMissing: property anchor not found on the CloudFormation reference page' }); continue; }
      const cases = PHYSICAL_CASES[typeName];
      if (!cases) throw new Error(`손 예가 없다: ${typeName} — PHYSICAL_CASES 에 pattern 을 읽고 적는다`);
      const resourceType = resourceTypeOf(ns, type, used);
      if (!resourceType) { held.push({ src, reason: 'no unique resource type of 40 characters or fewer' }); continue; }
      used.add(resourceType);
      rules.push({
        id: `aws.${resourceType}`, kind: 'a', typeName, property: t.property, displayName: `${ns} ${typeWords(type).join(' ')}`,
        entity: typeName, scope: scopeOf('a', typeName, schema), category: t.category, slug: slugOf(type),
        min: prop.minLength ?? 1, max: prop.maxLength, schemaPattern: prop.pattern, gen: generationOf(prop.pattern), docUrl, cases,
      });
    } else {
      const resourceType = resourceTypeOf(ns, type, used);
      if (!resourceType) { held.push({ src, reason: 'no unique resource type of 40 characters or fewer' }); continue; }
      used.add(resourceType);
      const ec2 = ns === 'EC2';
      rules.push({
        id: `aws.${resourceType}`, kind: 'b', typeName, displayName: `${ns} ${typeWords(type).join(' ')} (Name tag)`,
        entity: `${typeName}.NameTag`, scope: scopeOf('b', typeName, schema), category: t.category, slug: slugOf(type),
        tag: ec2 ? 'ec2' : 'general', cases: ec2 ? EC2_TAG_CASES : GENERAL_TAG_CASES,
      });
    }
  }
  for (const h of held) if (HAND_REVIEWED[h.src.typeName]) h.reason = HAND_REVIEWED[h.src.typeName];
  return { rules, held, sourceRows };
}

// ── 출력 ──────────────────────────────────────────────────────────
export function renderTs(result) {
  const out = [];
  out.push('// 생성 파일 — 손으로 고치지 않는다. scripts/rules/build-aws-rules.mjs 로 다시 만든다 (D43).');
  out.push('// 출처: CloudFormation 리소스 스키마(CloudformationSchema.zip) — a 행은 이름 속성의 pattern · minLength · maxLength 그대로,');
  out.push('// b 행은 Name 태그(EC2 는 aws.vpc 와 같은 규칙 · 다른 서비스는 일반 태그 값 문자). rules/aws.ts 가 규칙으로 편다.');
  out.push("import type { ResourceRule } from '../types';");
  out.push('');
  out.push("interface PhysicalRow { kind: 'a'; id: string; displayName: string; entity: string; property: string; scope: ResourceRule['scope']; category: ResourceRule['category']; slug: string; min: number; max: number; schemaPattern: string; allowed: ResourceRule['allowed']; separator: '' | '-'; caseRule: 'lower' | 'any'; startsWithLetter: boolean; endsWithAlnum: boolean; noConsecutiveSeparator: boolean; docUrl: string }");
  out.push("interface TagRow { kind: 'b'; id: string; displayName: string; entity: string; scope: ResourceRule['scope']; category: ResourceRule['category']; slug: string; tag: 'ec2' | 'general' }");
  out.push('');
  out.push('export const AWS_INTAKE_ROWS: (PhysicalRow | TagRow)[] = [');
  for (const r of result.rules) {
    if (r.kind === 'a') {
      const g = r.gen;
      out.push(`  { kind: 'a', id: ${idLit(r.id)}, displayName: ${dq(r.displayName)}, entity: ${sq(r.entity)}, property: ${sq(r.property)}, scope: ${idLit(r.scope)}, category: ${sq(r.category)}, slug: ${sq(r.slug)}, min: ${intLit(r.min)}, max: ${intLit(r.max)}, schemaPattern: ${dq(r.schemaPattern)}, allowed: ${sq(g.allowed)}, separator: ${sq(g.separator)}, caseRule: ${sq(g.caseRule)}, startsWithLetter: ${boolLit(g.startsWithLetter)}, endsWithAlnum: ${boolLit(g.endsWithAlnum)}, noConsecutiveSeparator: ${boolLit(g.noConsecutiveSeparator)}, docUrl: ${sq(r.docUrl)} },`);
    } else {
      out.push(`  { kind: 'b', id: ${idLit(r.id)}, displayName: ${dq(r.displayName)}, entity: ${sq(r.entity)}, scope: ${idLit(r.scope)}, category: ${sq(r.category)}, slug: ${sq(r.slug)}, tag: ${sq(r.tag)} },`);
    }
  }
  out.push('];');
  return `${out.join('\n')}\n`;
}

export function renderHeld(result) {
  const out = [];
  out.push('# AWS rules not imported yet');
  out.push('');
  out.push(`Source: [CloudFormation resource schemas](${SCHEMA_URL}) (no version marker; the hash of the fields used is in \`docs/rule-sources.lock.json\`). Generated by \`scripts/rules/build-aws-rules.mjs\` — do not edit by hand.`);
  out.push('');
  const a = result.rules.filter((r) => r.kind === 'a').length;
  out.push(`Imported: **${result.rules.length}** rules — ${a} physical names and ${result.rules.length - a} Name tags (plus the types covered by hand-written rules, including those added by hand). Held: **${result.held.length}** types, listed below with the reason.`);
  out.push('');
  out.push('## How the imported rows were mapped');
  out.push('');
  out.push('- **Scope** — the 18 namespaces are EC2, Lambda, ECR, ECS, EKS, RDS, DynamoDB, ElastiCache, Elastic Load Balancing (v1 and v2), API Gateway (v1 and v2), IAM, KMS, Secrets Manager, S3, EFS and CloudWatch Logs. Each type was classified by hand as having a name property (physical name), only a `Name` tag, no name, or an external value (DNS names).');
  out.push('- **Physical names** — imported only when the schema gives both a `pattern` and a `maxLength` for the name property. The pattern is kept verbatim and matched against the whole name (`^(?:…)$`; JSON Schema patterns are unanchored, the whole-name reading is narrower); `\\Z` is read as end of input. The schema has no field for the uniqueness scope, so IAM names and Multi-Region Access Points are placed at account scope and the rest at Region scope, with a note that the scope is not confirmed. `docUrl` is the property anchor on the CloudFormation template reference page (checked on 2026-10-06).');
  out.push('- **Name tags** — EC2 types use the existing EC2 `Name` tag rule (any characters, 1–256). Other services use the general tag-value characters (letters, numbers, spaces and `_ . : / = + - @`, 1–256), because S3, IAM, RDS and others reject more characters than EC2. A type whose schema has a writable `VpcId` or `SubnetId` property is placed under the VPC node, otherwise under the Region (placement only — tags are not unique).');
  out.push('- **Prefix (slug)** — the initials of the type name when it has two or more words (`NatGateway` → `ng`), otherwise its first three letters. Same rule as the Azure fallback.');
  out.push('- **Reviewed by hand** — the held types were read again in each service\'s API reference (and the user guide or schema description where the API page is silent). Types with a complete rule were added by hand in `src/core/rules/aws-manual.ts` with the source sentence quoted; the reason of the others starts with "reviewed by hand".');
  out.push('');
  out.push('## Held types');
  out.push('');
  out.push('| Type | Kind | Property | Length | Pattern | Reason |');
  out.push('|---|---|---|---|---|---|');
  const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/`/g, "'").replace(/\s+/g, ' ').trim();
  for (const { src, reason } of result.held) {
    const len = src.minLength === null && src.maxLength === null ? '' : `${src.minLength ?? ''}–${src.maxLength ?? ''}`;
    out.push(`| ${src.typeName} | ${src.kind === 'a' ? 'physical' : 'Name tag'} | ${cell(src.property)} | ${len} | ${src.pattern === null ? '' : `\`${cell(src.pattern)}\``} | ${cell(reason)} |`);
  }
  return `${out.join('\n')}\n`;
}

async function measure(schemas, targets) {
  const out = {};
  for (const [typeName, t] of Object.entries(targets.types)) {
    if (t.kind !== 'a' || EXISTING[typeName] || MANUAL[typeName] || physicalHold(schemas.get(typeName)?.properties?.[t.property])) continue;
    const url = cfnDocUrl(typeName, t.property);
    const [page, anchor] = url.split('#');
    const res = await fetch(page, { redirect: 'follow' });
    if (res.status === 200 && (await res.text()).includes(`id="${anchor}"`)) out[typeName] = url;
  }
  return out;
}

async function main(argv) {
  const args = [...argv];
  const take = (flag) => { const i = args.indexOf(flag); return i < 0 ? null : args.splice(i, 2)[1]; };
  const doMeasure = args.includes('--measure');
  if (doMeasure) args.splice(args.indexOf('--measure'), 1);
  const anchorsPath = take('--anchors');
  const existingTypesPath = take('--existing-resource-types');
  if (args.length !== 1) {
    console.error('사용: node scripts/rules/build-aws-rules.mjs [--measure] <스키마 폴더> [--anchors anchors.json] [--existing-resource-types types.json]');
    return 2;
  }
  const schemas = readSchemas(args[0]);
  const targets = JSON.parse(readFileSync(TARGETS, 'utf-8'));
  if (doMeasure) { process.stdout.write(`${JSON.stringify(await measure(schemas, targets), null, 1)}\n`); return 0; }
  const anchors = anchorsPath ? JSON.parse(readFileSync(anchorsPath, 'utf-8')) : {};
  const existingResourceTypes = existingTypesPath ? JSON.parse(readFileSync(existingTypesPath, 'utf-8')) : [];
  const result = build({ schemas, targets, anchors, existingResourceTypes });
  writeFileSync('src/core/rules/aws-intake.ts', renderTs(result));
  writeFileSync('docs/aws-intake-held.md', renderHeld(result));
  const snapshot = {
    source: SCHEMA_URL,
    license: 'Fields quoted from the AWS CloudFormation resource schemas for transcription tests.',
    rows: result.sourceRows.map(({ existing: _e, ...r }) => r),
  };
  writeFileSync('src/core/__fixtures__/aws-intake.json', `${JSON.stringify(snapshot, null, 1)}\n`);
  writeFileSync('src/core/__fixtures__/rule-cases-aws-intake.json', `${JSON.stringify(Object.fromEntries(result.rules.map((r) => [r.id, r.cases])), null, 1)}\n`);
  const a = result.rules.filter((r) => r.kind === 'a').length;
  console.error(`규칙 ${result.rules.length}(물리 ${a} · 태그 ${result.rules.length - a}) · 보류 ${result.held.length} · 원문 행 ${result.sourceRows.length}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main(process.argv.slice(2)));
