// 이름 유일 범위 그래프 (D37) — 선언 데이터. constraints.ts 와 같은 자리.
// 행 하나 = 「이 안에서 이름이 유일하다」는 공식 문장이 있는 범위. 트리는 tree.ts 의 buildTree 가 이것과 RULES 에서 만든다 — 손으로 쓴 트리는 없다.
// 뿌리는 provider 마다 가장 넓은 유일 범위다(Azure global · GCP 전역 네임스페이스 · AWS 파티션) — 구독 · 프로젝트 · 계정 밖에서 유일한 이름이 있어서다.
// children 순서 = 이 표의 순서. 각 행 위 주석이 docUrl 쪽에서 옮긴 근거 문장이다.
import type { Provider } from './types';
import { AZURE_INTAKE_SCOPES, type AzureIntakeScopeId } from './rules/azure-intake';
import { GCP_INTAKE_SCOPES, type GcpIntakeScopeId } from './rules/gcp-intake';
import { GCP_MANUAL_SCOPES, type GcpManualScopeId } from './rules/gcp-manual';
import { AWS_MANUAL_SCOPES, type AwsManualScopeId } from './rules/aws-manual';
import { AZURE_MANUAL_SCOPES, type AzureManualScopeId } from './rules/azure-manual';

export type ScopeId =
  | AzureIntakeScopeId | 'azure:region' | 'azure:tenant' | GcpIntakeScopeId | GcpManualScopeId | AwsManualScopeId | AzureManualScopeId
  | 'aws:partition' | 'aws:account' | 'aws:region' | 'aws:vpc'
  | 'gcp:namespace' | 'gcp:project' | 'gcp:project_global' | 'gcp:project_region' | 'gcp:project_zone'
  | 'azure:global' | 'azure:subscription' | 'azure:resource_group' | 'azure:virtual_network' | 'azure:managed_cluster';

export interface ScopeDef {
  id: ScopeId;
  provider: Provider;
  displayName: string;
  parent?: ScopeId;   // 없으면 뿌리
  ruleId?: string;    // 이 범위 자체를 이름 짓는 규칙 (RG · VNet · VPC · project) — 그 규칙의 scope 는 이 범위의 parent 다
  docUrl: string;     // 이 범위가 「이름이 유일한 단위」라는 공식 문장이 있는 쪽
}

const AZURE_RULES = 'https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules';
/** Compute 디스커버리 문서 — insert.path 가 global/… · regions/{region}/… · zones/{zone}/… 로 범위를 준다 */
const GCP_COMPUTE_DISCOVERY = 'https://www.googleapis.com/discovery/v1/apis/compute/v1/rest';

export const SCOPES: Record<ScopeId, ScopeDef> = {
  // ─── Azure — resource-name-rules 표의 Scope 열 ─────────────
  // storageAccounts · vaults · Microsoft.Sql servers 행 Scope global
  'azure:global': { id: 'azure:global', provider: 'azure', displayName: 'Global', docUrl: `${AZURE_RULES}#microsoftstorage` },
  // resourcegroups 행 Scope subscription
  'azure:subscription': { id: 'azure:subscription', provider: 'azure', displayName: 'Subscription', parent: 'azure:global', docUrl: `${AZURE_RULES}#microsoftresources` },
  // virtualMachines · disks · networkInterfaces · publicIPAddresses · networkSecurityGroups · virtualNetworks · userAssignedIdentities 행 Scope resource group
  'azure:resource_group': { id: 'azure:resource_group', provider: 'azure', displayName: 'Resource group', parent: 'azure:subscription', ruleId: 'azure.resource_group', docUrl: AZURE_RULES },
  // virtualnetworks / subnets 행 Scope virtual network
  'azure:virtual_network': { id: 'azure:virtual_network', provider: 'azure', displayName: 'Virtual network', parent: 'azure:resource_group', ruleId: 'azure.virtual_network', docUrl: `${AZURE_RULES}#microsoftnetwork` },
  // batchAccounts 행 Scope Region · EventGrid topics · PowerBI workspaceCollections 등 행 Scope region — 구독 안에서 지역마다 유일로 읽는다 (Scope 열의 정의 문장은 쪽에 없다)
  'azure:region': { id: 'azure:region', provider: 'azure', displayName: 'Region', parent: 'azure:subscription', docUrl: `${AZURE_RULES}#microsoftbatch` },
  // managementgroups 행 Scope tenant — 구독은 테넌트 아래에 있지만 구독 노드를 옮기지 않으려 전역 바로 아래 형제로 둔다
  'azure:tenant': { id: 'azure:tenant', provider: 'azure', displayName: 'Tenant', parent: 'azure:global', docUrl: `${AZURE_RULES}#microsoftmanagement` },
  // managedClusters / agentPools 행 Scope managed cluster — AKS 클러스터 규칙은 아직 없어 ruleId 가 없다
  'azure:managed_cluster': { id: 'azure:managed_cluster', provider: 'azure', displayName: 'Managed cluster', parent: 'azure:resource_group', ruleId: 'azure.container_service_managed_clusters', docUrl: `${AZURE_RULES}#microsoftcontainerservice` },
  // 부모 리소스 범위 — 표의 Scope 칸이 부모 리소스 이름인 행(service · namespace · factory …). 생성 파일 rules/azure-intake.ts
  ...AZURE_INTAKE_SCOPES,
  // 손으로 넣은 규칙의 부모 리소스 범위 — rules/azure-manual.ts
  ...AZURE_MANUAL_SCOPES,

  // ─── GCP ───────────────────────────────────────────────
  // "Project ID: A globally unique identifier for your project." · 버킷 "Every bucket name must be globally unique."
  'gcp:namespace': { id: 'gcp:namespace', provider: 'gcp', displayName: 'Global namespace', docUrl: 'https://docs.cloud.google.com/resource-manager/docs/creating-managing-projects#identifiers' },
  // "In general, resource names must be unique within a location within a project." · ZonalOnly 가 아니면 VM 이름은 프로젝트 안 유일
  'gcp:project': { id: 'gcp:project', provider: 'gcp', displayName: 'Project', parent: 'gcp:namespace', ruleId: 'gcp.project_id', docUrl: 'https://docs.cloud.google.com/compute/docs/naming-resources' },
  // insert.path projects/{project}/global/networks · global/firewalls
  'gcp:project_global': { id: 'gcp:project_global', provider: 'gcp', displayName: 'Global', parent: 'gcp:project', docUrl: GCP_COMPUTE_DISCOVERY },
  // regions/{region}/subnetworks
  'gcp:project_region': { id: 'gcp:project_region', provider: 'gcp', displayName: 'Region', parent: 'gcp:project', docUrl: GCP_COMPUTE_DISCOVERY },
  // zones/{zone}/disks · zones/{zone}/instances
  'gcp:project_zone': { id: 'gcp:project_zone', provider: 'gcp', displayName: 'Zone', parent: 'gcp:project', docUrl: GCP_COMPUTE_DISCOVERY },
  // KMS 생성 메서드 설명 "It must be unique within a location" · "It must be unique within a KeyRing". 생성 파일 rules/gcp-intake.ts
  ...GCP_INTAKE_SCOPES,
  // 손으로 넣은 규칙의 부모 리소스 범위 — rules/gcp-manual.ts
  ...GCP_MANUAL_SCOPES,

  // ─── AWS ───────────────────────────────────────────────
  // "each bucket name must be unique across all AWS accounts in all the AWS Regions within a partition."
  'aws:partition': { id: 'aws:partition', provider: 'aws', displayName: 'Partition', docUrl: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html' },
  // "Within your account, a friendly name for a user, user group, role, or policy must be unique."
  'aws:account': { id: 'aws:account', provider: 'aws', displayName: 'Account', parent: 'aws:partition', docUrl: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html' },
  // RDS "Must be unique for all DB instances per AWS account, per AWS Region."
  'aws:region': { id: 'aws:region', provider: 'aws', displayName: 'Region', parent: 'aws:account', docUrl: 'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Limits.html' },
  // 보안 그룹 "Names are case-insensitive and must be unique within the VPC." — Name 태그 리소스는 유일 범위가 없고 포함 관계로만 여기 놓인다 (D38)
  // 손으로 넣은 규칙의 부모 리소스 범위(ECS 클러스터 · 로그 그룹) — rules/aws-manual.ts
  ...AWS_MANUAL_SCOPES,
  'aws:vpc': { id: 'aws:vpc', provider: 'aws', displayName: 'VPC', parent: 'aws:region', ruleId: 'aws.vpc', docUrl: 'https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateSecurityGroup.html' },
};
