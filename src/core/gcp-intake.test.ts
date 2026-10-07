// 전사 검사 (D43) — 들인 GCP 행이 원문(디스커버리 문서)과 같은지 원문 스냅샷(__fixtures__/gcp-intake.json)에 대어 본다.
// 정답은 RULES 가 아니라 원문이다. 원문 행(compute insert 메서드 · KMS create 의 …Id 인자)은 셋 중 하나여야 한다:
// 손으로 쓴 규칙 · 들인 규칙 · 보류 목록(docs/gcp-intake-held.md).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rulesFor } from './constraints';
import { SCOPES } from './scopes';
import { GCP_INTAKE_ROWS, GCP_INTAKE_SCOPES } from './rules/gcp-intake';
import { GCP_BASE_RULES } from './rules/gcp';

interface SourceRow { api: string; method: string; resource?: string; schema?: string; path: string | null; pattern?: string | null; readOnly?: boolean; param?: string; description: string | null }
const SNAP = JSON.parse(readFileSync(join(import.meta.dirname, '__fixtures__', 'gcp-intake.json'), 'utf-8')) as { revisions: { computeRevision: string; kmsRevision: string }; rows: SourceRow[] };
const HELD = readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'gcp-intake-held.md'), 'utf-8');
const RFC1035 = '[a-z](?:[-a-z0-9]{0,61}[a-z0-9])?';

const rules = rulesFor('gcp');
const ruleByEntity = new Map(rules.map((r) => [r.entity, r]));
const intakeByMethod = new Map(GCP_INTAKE_ROWS.map((r) => [r.method, r]));
const heldMethods = new Set(HELD.split('\n').filter((l) => /^\| (compute|cloudkms) \| /.test(l)).map((l) => l.split(' | ')[1]!.trim()));
const entityOf = (s: SourceRow) => `compute.${s.resource}`;

/**
 * 지원 범위 — 12개 API(compute · storage · sqladmin · container · artifactregistry · run · cloudfunctions · iam · cloudkms ·
 * secretmanager · firestore · spanner)의 Cloud Asset Inventory 유형 116종(2026-10-06 조사). 값 = 그 유형을 덮는 규칙 entity ·
 * null = 규칙이 없어 보류 문서의 「Asset types with no rule」 표(보류 · 이름 없음 · 외부 값)에 있어야 한다.
 */
const C = (...r: string[]) => r.map((x) => `compute.${x}`);
const SUPPORT_SCOPE: [string, string[] | null][] = [
  ['compute.googleapis.com/Autoscaler', C('autoscalers', 'regionAutoscalers')],
  ['compute.googleapis.com/Commitment', C('regionCommitments')],
  ['compute.googleapis.com/Image', C('images')],
  ['compute.googleapis.com/Instance', C('instances')],
  ['compute.googleapis.com/InstanceGroup', C('instanceGroups')],
  ['compute.googleapis.com/InstanceGroupManager', C('instanceGroupManagers', 'regionInstanceGroupManagers')],
  ['compute.googleapis.com/InstanceTemplate', C('instanceTemplates', 'regionInstanceTemplates')],
  ['compute.googleapis.com/License', C('licenses')],
  ['compute.googleapis.com/MachineImage', C('machineImages')],
  ['compute.googleapis.com/NodeGroup', C('nodeGroups')],
  ['compute.googleapis.com/NodeTemplate', C('nodeTemplates')],
  ['compute.googleapis.com/Reservation', C('reservations')],
  ['compute.googleapis.com/ResourcePolicy', C('resourcePolicies')],
  ['compute.googleapis.com/InstanceSettings', null],
  ['compute.googleapis.com/Project', null],
  ['compute.googleapis.com/Address', C('addresses')],
  ['compute.googleapis.com/BackendBucket', C('backendBuckets', 'regionBackendBuckets')],
  ['compute.googleapis.com/BackendService', C('backendServices')],
  ['compute.googleapis.com/CrossSiteNetwork', C('crossSiteNetworks')],
  ['compute.googleapis.com/ExternalVpnGateway', C('externalVpnGateways')],
  ['compute.googleapis.com/Firewall', C('firewalls')],
  ['compute.googleapis.com/FirewallPolicy', null],
  ['compute.googleapis.com/ForwardingRule', C('forwardingRules')],
  ['compute.googleapis.com/GlobalAddress', C('globalAddresses')],
  ['compute.googleapis.com/GlobalForwardingRule', C('globalForwardingRules')],
  ['compute.googleapis.com/HealthCheck', C('healthChecks', 'regionHealthChecks')],
  ['compute.googleapis.com/HttpHealthCheck', C('httpHealthChecks')],
  ['compute.googleapis.com/HttpsHealthCheck', C('httpsHealthChecks')],
  ['compute.googleapis.com/Interconnect', C('interconnects')],
  ['compute.googleapis.com/InterconnectAttachment', C('interconnectAttachments')],
  ['compute.googleapis.com/Network', C('networks')],
  ['compute.googleapis.com/NetworkAttachment', C('networkAttachments')],
  ['compute.googleapis.com/NetworkEdgeSecurityService', C('networkEdgeSecurityServices')],
  ['compute.googleapis.com/NetworkEndpointGroup', C('networkEndpointGroups', 'regionNetworkEndpointGroups', 'globalNetworkEndpointGroups')],
  ['compute.googleapis.com/PacketMirroring', C('packetMirrorings')],
  ['compute.googleapis.com/PublicAdvertisedPrefix', C('publicAdvertisedPrefixes')],
  ['compute.googleapis.com/PublicDelegatedPrefix', C('publicDelegatedPrefixes', 'globalPublicDelegatedPrefixes')],
  ['compute.googleapis.com/RegionBackendService', C('regionBackendServices')],
  ['compute.googleapis.com/Route', C('routes')],
  ['compute.googleapis.com/Router', C('routers')],
  ['compute.googleapis.com/SecurityPolicy', C('securityPolicies', 'regionSecurityPolicies')],
  ['compute.googleapis.com/ServiceAttachment', C('serviceAttachments')],
  ['compute.googleapis.com/SslCertificate', C('sslCertificates', 'regionSslCertificates')],
  ['compute.googleapis.com/SslPolicy', C('sslPolicies', 'regionSslPolicies')],
  ['compute.googleapis.com/Subnetwork', C('subnetworks')],
  ['compute.googleapis.com/TargetGrpcProxy', C('targetGrpcProxies')],
  ['compute.googleapis.com/TargetHttpProxy', C('targetHttpProxies', 'regionTargetHttpProxies')],
  ['compute.googleapis.com/TargetHttpsProxy', C('targetHttpsProxies', 'regionTargetHttpsProxies')],
  ['compute.googleapis.com/TargetInstance', C('targetInstances')],
  ['compute.googleapis.com/TargetPool', C('targetPools')],
  ['compute.googleapis.com/TargetSslProxy', C('targetSslProxies')],
  ['compute.googleapis.com/TargetTcpProxy', C('targetTcpProxies', 'regionTargetTcpProxies')],
  ['compute.googleapis.com/TargetVpnGateway', C('targetVpnGateways')],
  ['compute.googleapis.com/UrlMap', C('urlMaps', 'regionUrlMaps')],
  ['compute.googleapis.com/VpnGateway', C('vpnGateways')],
  ['compute.googleapis.com/VpnTunnel', C('vpnTunnels')],
  ['compute.googleapis.com/WireGroup', null],
  ['compute.googleapis.com/Disk', C('disks')],
  ['compute.googleapis.com/InstantSnapshot', C('instantSnapshots', 'regionInstantSnapshots')],
  ['compute.googleapis.com/RegionDisk', C('regionDisks')],
  ['compute.googleapis.com/Snapshot', C('snapshots', 'regionSnapshots')],
  ['compute.googleapis.com/StoragePool', C('storagePools')],
  ['storage.googleapis.com/Bucket', ['storage.buckets']],
  ['firestore.googleapis.com/Database', ['firestore.databases']],
  ['spanner.googleapis.com/Backup', ['spanner.instances.backups']],
  ['spanner.googleapis.com/Database', ['spanner.instances.databases']],
  ['spanner.googleapis.com/Instance', ['spanner.instances']],
  ['spanner.googleapis.com/InstanceConfig', ['spanner.instanceConfigs']],
  ['spanner.googleapis.com/InstancePartition', ['spanner.instances.instancePartitions']],
  ['sqladmin.googleapis.com/Instance', ['sqladmin.instances']],
  ['firestore.googleapis.com/Backup', null],
  ['sqladmin.googleapis.com/Backup', null],
  ['sqladmin.googleapis.com/BackupRun', null],
  ['artifactregistry.googleapis.com/Repository', null],
  ['artifactregistry.googleapis.com/Rule', ['artifactregistry.repositories.rules']],
  ['container.googleapis.com/Cluster', ['container.clusters']],
  ['container.googleapis.com/NodePool', null],
  ['artifactregistry.googleapis.com/DockerImage', null],
  ['artifactregistry.googleapis.com/MavenArtifact', null],
  ['artifactregistry.googleapis.com/NpmPackage', null],
  ['artifactregistry.googleapis.com/PythonPackage', null],
  ['cloudfunctions.googleapis.com/CloudFunction', ['cloudfunctions.v1.functions']],
  ['cloudfunctions.googleapis.com/Function', ['cloudfunctions.v2.functions']],
  ['run.googleapis.com/Job', null],
  ['run.googleapis.com/Service', null],
  ['run.googleapis.com/WorkerPool', null],
  ['run.googleapis.com/Execution', null],
  ['run.googleapis.com/Revision', null],
  ['run.googleapis.com/DomainMapping', null],
  ['cloudkms.googleapis.com/CryptoKey', ['cloudkms.keyRings.cryptoKeys']],
  ['cloudkms.googleapis.com/EkmConnection', ['cloudkms.ekmConnections']],
  ['cloudkms.googleapis.com/ImportJob', ['cloudkms.keyRings.importJobs']],
  ['cloudkms.googleapis.com/KeyHandle', null],
  ['cloudkms.googleapis.com/KeyRing', ['cloudkms.keyRings']],
  ['iam.googleapis.com/OauthClient', ['iam.oauthClients']],
  ['iam.googleapis.com/OauthClientCredential', ['iam.oauthClients.credentials']],
  ['iam.googleapis.com/PolicyBinding', ['iam.policyBindings']],
  ['iam.googleapis.com/PolicyV2', ['iam.policies']],
  ['iam.googleapis.com/PrincipalAccessBoundaryPolicy', ['iam.principalAccessBoundaryPolicies']],
  ['iam.googleapis.com/Role', ['iam.roles']],
  ['iam.googleapis.com/ServiceAccount', ['iam.serviceAccounts']],
  ['iam.googleapis.com/WorkforcePool', ['iam.workforcePools']],
  ['iam.googleapis.com/WorkforcePoolProvider', ['iam.workforcePools.providers']],
  ['iam.googleapis.com/WorkforcePoolProviderKey', ['iam.workforcePools.providers.keys']],
  ['iam.googleapis.com/WorkloadIdentityPool', ['iam.workloadIdentityPools']],
  ['iam.googleapis.com/WorkloadIdentityPoolManagedIdentity', ['iam.workloadIdentityPools.namespaces.managedIdentities']],
  ['iam.googleapis.com/WorkloadIdentityPoolNamespace', ['iam.workloadIdentityPools.namespaces']],
  ['iam.googleapis.com/WorkloadIdentityPoolProvider', ['iam.workloadIdentityPools.providers']],
  ['iam.googleapis.com/WorkloadIdentityPoolProviderKey', ['iam.workloadIdentityPools.providers.keys']],
  ['secretmanager.googleapis.com/Secret', ['secretmanager.secrets']],
  ['cloudkms.googleapis.com/AutokeyConfig', null],
  ['cloudkms.googleapis.com/CryptoKeyVersion', null],
  ['cloudkms.googleapis.com/EkmConfig', null],
  ['cloudkms.googleapis.com/RetiredResource', null],
  ['iam.googleapis.com/ServiceAccountKey', null],
  ['secretmanager.googleapis.com/SecretVersion', null],
];

describe('들인 GCP 행 — 원문 스냅샷과 대조', () => {
  it('스냅샷 — compute insert 메서드 95 · revision 이 lock 과 같다', () => {
    expect(SNAP.rows.filter((r) => r.api === 'compute')).toHaveLength(95);
    const lock = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'rule-sources.lock.json'), 'utf-8'));
    expect(SNAP.revisions.computeRevision).toBe(lock.sources.gcp.marker.revision);
  });

  it('원문 행은 전부 손 규칙 · 들인 규칙 · 보류 가운데 정확히 하나다', () => {
    const bad: string[] = [];
    for (const s of SNAP.rows) {
      const hand = s.api === 'compute' && ruleByEntity.has(entityOf(s)) && !intakeByMethod.has(s.method);
      const n = Number(hand) + Number(intakeByMethod.has(s.method)) + Number(heldMethods.has(s.method));
      if (n !== 1) bad.push(`${s.method} (${n})`);
    }
    expect(bad).toEqual([]);
  });

  it.each(GCP_INTAKE_ROWS.map((r) => r.id))('%s — pattern · 길이 · 범위가 원문 행과 같다', (id) => {
    const row = GCP_INTAKE_ROWS.find((r) => r.id === id)!;
    const src = SNAP.rows.find((s) => s.method === row.method)!;
    expect(src, row.method).toBeDefined();
    const rule = rules.find((r) => r.id === id)!;
    if (src.api === 'compute') {
      expect(src.pattern).toBe(RFC1035);
      expect(src.readOnly).toBe(false);
      expect(row.pattern).toBe(src.pattern);
      expect(rule.entity).toBe(entityOf(src));
      expect([rule.minLength, rule.maxLength]).toEqual([1, 63]);
      const place = /^projects\/\{project\}\/(global|regions|zones)\//.exec(src.path ?? '')![1];
      expect(rule.scope).toBe({ global: 'gcp:project_global', regions: 'gcp:project_region', zones: 'gcp:project_zone' }[place!]);
      expect(rule.docUrl).toMatch(new RegExp(`/compute/docs/reference/rest/v1/${src.resource}(/insert#body\\.request_body|#${src.schema})\\.FIELDS\\.name$`));
    } else {
      // 설명 안 백틱 정규식 그대로 · 길이는 {min,max}
      expect(src.description).toContain(`regular expression \`${row.pattern}\``);
      expect(row.pattern).toMatch(new RegExp(`\\{${rule.minLength},${rule.maxLength}\\}$`));
      const within = /unique within an? (location|KeyRing)/.exec(src.description ?? '')![1];
      expect(rule.scope).toBe(within === 'location' ? 'gcp:project_location' : 'gcp:kms_key_ring');
      expect(rule.docUrl).toMatch(/^https:\/\/docs\.cloud\.google\.com\/kms\/docs\/reference\/rest\/v1\/projects\.locations\.[A-Za-z.]+\/create#query-parameters$/);
    }
    expect(rule.pattern.source).toBe(`^(?:${row.pattern})$`);
  });

  it('보류에 KMS 깨진 원문 · 조사 밖 행이 사유와 함께 있다 · 깨진 여섯 칸이 적혀 있다', () => {
    expect(HELD).toMatch(/cloudkms\.projects\.locations\.keyHandles\.create .*reviewed by hand — not imported \(/);
    expect(HELD.match(/^\| compute \| compute\.\w*[fF]irewallPolicies\.insert .*reviewed by hand — unconfirmed \(/gm)).toHaveLength(3);
    expect(HELD).toMatch(/singleTenantHsmInstances\.create .*outside the surveyed/);
    expect(HELD.match(/^\| (spanner|iam) v\d \| /gm)).toHaveLength(6);
  });

  it('새 범위 둘은 프로젝트 아래 · key ring 범위의 규칙은 location 범위에 놓인다', () => {
    expect(Object.keys(GCP_INTAKE_SCOPES)).toEqual(['gcp:project_location', 'gcp:kms_key_ring']);
    expect(SCOPES['gcp:project_location'].parent).toBe('gcp:project');
    expect(SCOPES['gcp:kms_key_ring'].parent).toBe('gcp:project_location');
    expect(rules.find((r) => r.id === 'gcp.kms_key_ring')!.scope).toBe('gcp:project_location');
  });

  it('지원 범위 116종 — 유형마다 규칙(entity)이 있거나 보류 문서 「Asset types with no rule」 표에 행이 있다', () => {
    expect(SUPPORT_SCOPE).toHaveLength(116);
    expect(new Set(SUPPORT_SCOPE.map(([t]) => t)).size).toBe(116);
    const tableTypes = new Set([...HELD.matchAll(/^\| `([a-z]+\.googleapis\.com\/[A-Za-z0-9]+)` \| (held|no name|external value) \| /gm)].map((m) => m[1]));
    const missing: string[] = [];
    for (const [type, entities] of SUPPORT_SCOPE) {
      if (entities === null) { if (!tableTypes.has(type)) missing.push(`${type} — 표에 행이 없다`); continue; }
      // entity 는 catalog 를 덮기 전 값(디스커버리 리소스 이름)으로 센다 — catalog 가 함수 1 · 2세대를 cloudfunctions.functions 하나로 묶는다(D47)
      for (const e of entities) if (!Object.values(GCP_BASE_RULES).some((r) => r.entity === e)) missing.push(`${type} — 규칙 ${e} 없음`);
      if (tableTypes.has(type)) missing.push(`${type} — 규칙이 있는데 표에도 있다`);
    }
    expect(missing).toEqual([]);
    // 표에는 지원 범위 밖 유형이 없다
    expect([...tableTypes].filter((t) => !SUPPORT_SCOPE.some(([s]) => s === t))).toEqual([]);
    expect(SUPPORT_SCOPE.filter(([, e]) => e === null)).toHaveLength(26);
  });

  it('resourceType 은 GCP 안에서 유일하고 40자 이하다', () => {
    const types = rules.map((r) => r.resourceType);
    expect(new Set(types).size).toBe(types.length);
    for (const t of types) expect(t.length, t).toBeLessThanOrEqual(40);
  });
});
