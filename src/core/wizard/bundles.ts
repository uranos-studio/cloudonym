// 카드 (D92 · D93) — 데이터. 카드 하나 = 프리셋 pick 여럿을 한 번에 더하는 표. 엔진 · validatePlan · expandPlan 은 카드를 모른다(프리셋과 같다 — D64).
// 카드로 더한 pick 은 칩으로 더한 pick 과 바이트까지 같다 — pick 에 카드 표시를 남기지 않는다. 화면은 있는 부품에서 카드를 되읽는다(D93).
// 부품의 자리는 프리셋의 level 이 정한다 — project 면 프로젝트 공용(projectPicks), service 면 그 서비스
import type { Provider } from '../types';
import { presetOf } from './presets';

/** 부품 하나 — 프리셋 id 와(방화벽처럼 tier 칩이 여럿인 프리셋이면) tier · (서비스 계정처럼 role 규칙이면) role (D126). role 이 없으면 기본 역할(sync) */
export interface BundlePart { preset: string; tier?: string; role?: string }
/** 선택 부품 — 켜면 parts 를 더한다. on 은 카드를 더할 때의 기본값 */
export interface BundleOption { id: string; label: string; on: boolean; parts: readonly BundlePart[] }
/** 백엔드 하나 (https-lb) — 서비스에 needs 프리셋이 있으면 이 백엔드의 parts 를 더한다 */
export interface BundleBackend { needs: string; parts: readonly BundlePart[] }
/** 부품끼리의 참조 (D92) — 내보내기가 블록을 그릴 때 쓸 변. from · to 는 partKey, 카드 밖(네트워크)은 'vpc'. evidence 는 그 인자의 공식 문서 */
export interface BundleRef { from: string; to: string; attr: string; evidence: string }
export interface Bundle {
  id: string;
  label: string;
  summary: string;
  /** 같은 가족의 카드는 한 서비스에 하나 — 공유 부품(ip · bs · url …)이 중복 키(D86)에 걸린다 */
  family?: 'lb';
  /** 필수 부품 — 하나라도 빠지면 카드는 미완성이다 */
  parts: readonly BundlePart[];
  /** 필수 백엔드 — 서비스에 있는 것으로 하나를 고른다(https-lb). 없으면 백엔드를 고르지 않는다 */
  backends?: readonly BundleBackend[];
  options: readonly BundleOption[];
  refs: readonly BundleRef[];
  /** 이 조합이 실제로 동작한 근거 — 실제 배포 시험(D91) · 공식 문서 URL */
  evidence: readonly string[];
  /** 이 조합 그대로 그 클라우드에 만들어 동작을 본 카드인가 (D91 · D96 · D141) — 아니면 「규칙은 확인함 · 묶음 적용은 아직」 */
  tested: boolean;
  /** 실배포 시험 기록 (D123) — tested 가 true 인 카드는 하나 이상. 기록에 없는 선택(뒤에 더한 것)은 시험되지 않은 것이다 */
  testedWith?: readonly TestedRecord[];
}
/** 실배포 시험 하나 (D123) — on: 날짜(KST) · options: 켠 선택 id · backend: 고른 백엔드(https-lb) · note: 덮지 않은 것 */
export interface TestedRecord { on: string; options: readonly string[]; backend?: string; note?: string }

/** 부품의 키 — 프리셋 id, tier 가 있으면 `firewall:lbhc`, role 이 있으면 `sa@build` (D126) */
export function partKey(p: BundlePart): string {
  return `${p.preset}${p.tier === undefined ? '' : `:${p.tier}`}${p.role === undefined ? '' : `@${p.role}`}`;
}

/** 부품이 프로젝트 공용 자리인가 — 그 CSP 프리셋 표의 level 로 정한다 (D141 — AWS 의 igw · rt 는 GCP 표에 없다) */
export function partIsProject(p: BundlePart, provider: Provider = 'gcp'): boolean {
  return presetOf(p.preset, provider)?.level === 'project';
}

const P = (preset: string, tier?: string, role?: string): BundlePart => ({ preset, ...(tier === undefined ? {} : { tier }), ...(role === undefined ? {} : { role }) });
// D126 — 역할별 서비스 계정(선택 · 기본 꺼짐). 필수 sa(기본 역할 sync)는 실행 계정으로 남고, 선택이 그 일만 하는 계정을 더한다
const roleOption = (role: string): BundleOption => ({ id: 'roles', label: 'Separate service accounts per role', on: false, parts: [P('sa', undefined, role)] });
const TF = 'https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/';

// HTTPS 로드 밸런서의 앞쪽 — 주소 · URL 맵 · 인증서 · HTTPS 프록시 · 443 전달 규칙과 80 → 443 전환(D91). 백엔드(VM · Cloud Run · 버킷)는 카드마다 다르다
const LB_FRONT: readonly BundlePart[] = [P('ip'), P('url'), P('cert'), P('thps'), P('fwd'), P('urlredir'), P('thp'), P('fwdredir')];
const LB_FRONT_REFS: readonly BundleRef[] = [
  { from: 'thps', to: 'url', attr: 'url_map', evidence: `${TF}compute_target_https_proxy` },
  { from: 'thps', to: 'cert', attr: 'ssl_certificates', evidence: `${TF}compute_target_https_proxy` },
  { from: 'fwd', to: 'ip', attr: 'ip_address', evidence: `${TF}compute_global_forwarding_rule` },
  { from: 'fwd', to: 'thps', attr: 'target', evidence: `${TF}compute_global_forwarding_rule` },
  { from: 'thp', to: 'urlredir', attr: 'url_map', evidence: `${TF}compute_target_http_proxy` },
  { from: 'fwdredir', to: 'ip', attr: 'ip_address', evidence: `${TF}compute_global_forwarding_rule` },
  { from: 'fwdredir', to: 'thp', attr: 'target', evidence: `${TF}compute_global_forwarding_rule` },
];
// 백엔드 셋 — VM 은 인스턴스 그룹 + 헬스 체크(+ 헬스 체크 대역을 받는 방화벽 lbhc), Cloud Run 은 서버리스 NEG(헬스 체크를 둘 수 없다), 버킷은 백엔드 버킷(backend service 없음)
const VM_BACKEND: readonly BundlePart[] = [P('ig'), P('hc'), P('bs')];
const VM_BACKEND_REFS: readonly BundleRef[] = [
  { from: 'ig', to: 'web', attr: 'instances', evidence: `${TF}compute_instance_group` },
  { from: 'bs', to: 'hc', attr: 'health_checks', evidence: `${TF}compute_backend_service` },
  { from: 'bs', to: 'ig', attr: 'backend.group', evidence: `${TF}compute_backend_service` },
  { from: 'url', to: 'bs', attr: 'default_service', evidence: `${TF}compute_url_map` },
  { from: 'firewall:lbhc', to: 'vpc', attr: 'network', evidence: `${TF}compute_firewall` },
  { from: 'firewall:web', to: 'vpc', attr: 'network', evidence: `${TF}compute_firewall` },
];
const RUN_BACKEND: readonly BundlePart[] = [P('neg'), P('bs')];
const RUN_BACKEND_REFS: readonly BundleRef[] = [
  { from: 'neg', to: 'run', attr: 'cloud_run.service', evidence: `${TF}compute_region_network_endpoint_group` },
  { from: 'bs', to: 'neg', attr: 'backend.group', evidence: `${TF}compute_backend_service` },
  { from: 'url', to: 'bs', attr: 'default_service', evidence: `${TF}compute_url_map` },
];
const BUCKET_BACKEND: readonly BundlePart[] = [P('bb')];
const BUCKET_BACKEND_REFS: readonly BundleRef[] = [
  { from: 'bb', to: 'object', attr: 'bucket_name', evidence: `${TF}compute_backend_bucket` },
  { from: 'url', to: 'bb', attr: 'default_service', evidence: `${TF}compute_url_map` },
];
// D127 — 관리형 인스턴스 그룹 백엔드: 백엔드 서비스가 MIG 를 가리키고 MIG 의 자동 복구가 헬스 체크를 쓴다
const MIG_BACKEND_REFS: readonly BundleRef[] = [
  { from: 'bs', to: 'mig', attr: 'backend.group', evidence: `${TF}compute_backend_service` },
  { from: 'bs', to: 'hc', attr: 'health_checks', evidence: `${TF}compute_backend_service` },
  { from: 'mig', to: 'hc', attr: 'auto_healing_policies.health_check', evidence: `${TF}compute_region_instance_group_manager` },
  { from: 'url', to: 'bs', attr: 'default_service', evidence: `${TF}compute_url_map` },
];
// 프로젝트 공용 방화벽 — web: 로드 밸런서(GFE 대역)에서 80 · 443 을 받는다 · lbhc: 헬스 체크 프로브 대역을 받는다. 없으면 백엔드가 늘 비정상이다 (D87 · D91)
const LB_FIREWALLS: readonly BundlePart[] = [P('firewall', 'web'), P('firewall', 'lbhc')];
const DB_OPTION: BundleOption = { id: 'db', label: 'Database (Cloud SQL)', on: true, parts: [P('db'), P('psa')] };
// D124 — 규칙은 있으나 고를 수 없던 것을 선택으로(전부 기본 꺼짐 — 옛 계획 · 링크의 이름이 바뀌지 않는다). 선택은 부품을 더할 수만 있다
const ARMOR_OPTION: BundleOption = { id: 'armor', label: 'Cloud Armor', on: false, parts: [P('waf')] };
const DB_USER_OPTION: BundleOption = { id: 'dbuser', label: 'Database name and user', on: false, parts: [P('sqldb'), P('sqluser')] };
const DB_USER_REFS: readonly BundleRef[] = [
  { from: 'sqldb', to: 'db', attr: 'instance', evidence: `${TF}sql_database` },
  { from: 'sqluser', to: 'db', attr: 'instance', evidence: `${TF}sql_user` },
];
const ARMOR_REF: BundleRef = { from: 'bs', to: 'waf', attr: 'security_policy', evidence: `${TF}compute_backend_service` };
export const FIRESTORE_DOC = 'https://docs.cloud.google.com/firestore/docs/manage-databases';
export const ARMOR_DOC = 'https://docs.cloud.google.com/armor/docs/security-policy-overview';
export const TASKS_DOC = 'https://docs.cloud.google.com/run/docs/triggering/using-tasks';
export const ROLES_DOC = 'https://docs.cloud.google.com/iam/docs/best-practices-service-accounts';
export const MIG_DOC = 'https://docs.cloud.google.com/compute/docs/instance-groups/creating-groups-of-managed-instances';
export const KMS_LOCATION_DOC = 'https://docs.cloud.google.com/storage/docs/encryption/using-customer-managed-keys';
const SERVERLESS_NEG_DOC = 'https://docs.cloud.google.com/load-balancing/docs/negs/serverless-neg-concepts';
// 이름이 없는 설정의 근거 (D96) — 공개 웹이 되려면 Cloud Run 은 익명 호출을 받아야 하고, 버킷은 공개 읽기와 기본 문서가 있어야 한다. 화면 점검표가 이 URL 을 안내 문장에 단다
export const RUN_PUBLIC_DOC = 'https://docs.cloud.google.com/run/docs/authenticating/public';
export const STATIC_SITE_DOC = 'https://docs.cloud.google.com/storage/docs/hosting-static-website';

// D114 — 서비스 부품 카드 다섯. 부품은 표에 이미 있는 규칙(D72)으로만 만든다 — 노드 풀 · Dataflow · Cloud Deploy · Eventarc 는 규칙이 없어 카드에 넣지 않는다.
// 사설 네트워크 카드는 두지 않는다 — 부품(VPC · 서브넷 · Cloud Router · Cloud NAT · 방화벽)이 전부 프로젝트 공용이라 서비스에서 되읽을 수 없고(모든 서비스에 뜬다),
// 첫 화면(D90)이 이미 그 넷을 켜고 방화벽은 tier 칩이다. 선택도 서비스 부품이 하나 이상이어야 한다 — 그래서 GKE 의 Cloud Router · NAT 는 선택이 아니라 네트워크 칸에 둔다
const DOCS = 'https://docs.cloud.google.com/';

/** 1차 카드 다섯 (D93) + D114 의 다섯 + D125 · D127 의 둘 — 순서가 갤러리 순서이고 되읽기의 동률 순서다 */
export const BUNDLES: readonly Bundle[] = [
  {
    id: 'website', label: 'Website', family: 'lb', tested: true, testedWith: [{ on: '2026-10-16', options: ['was', 'bastion'], note: 'Database option not covered here; the same preset was tested on vm-app' }],
    summary: 'A web server VM behind an HTTPS load balancer. HTTP is redirected to HTTPS.',
    parts: [P('web'), ...VM_BACKEND, ...LB_FRONT, ...LB_FIREWALLS],
    // D117 — App server 선택은 방화벽 internal 을 함께 켠다: web → was 는 네트워크 안의 통신이라 web(GFE 대역) 방화벽으로는 닿지 않는다(실배포 시험)
    options: [{ ...DB_OPTION }, { id: 'was', label: 'App server', on: false, parts: [P('was'), P('firewall', 'internal')] }, { id: 'bastion', label: 'Bastion', on: false, parts: [P('bastion'), P('firewall', 'ssh'), P('firewall', 'iap')] }, ARMOR_OPTION, DB_USER_OPTION],
    refs: [...VM_BACKEND_REFS, ...LB_FRONT_REFS, ARMOR_REF, ...DB_USER_REFS],
    evidence: ['D117', 'D91', `${TF}compute_backend_service`],
  },
  {
    id: 'serverless-web', label: 'Serverless web', family: 'lb', tested: true, testedWith: [{ on: '2026-10-16', options: ['sa', 'secret'], note: 'Database option not covered' }],
    summary: 'A Cloud Run service behind an HTTPS load balancer. No servers to manage.',
    parts: [P('run'), ...RUN_BACKEND, ...LB_FRONT],
    options: [{ ...DB_OPTION, on: false }, { id: 'sa', label: 'Service account', on: false, parts: [P('sa')] }, { id: 'secret', label: 'Secret', on: false, parts: [P('secret')] },
      { id: 'fs', label: 'Database (Firestore)', on: false, parts: [P('fs')] }, ARMOR_OPTION, DB_USER_OPTION],
    refs: [...RUN_BACKEND_REFS, ...LB_FRONT_REFS, ARMOR_REF, ...DB_USER_REFS],
    evidence: ['D117', 'D96', SERVERLESS_NEG_DOC, `${TF}compute_region_network_endpoint_group`, RUN_PUBLIC_DOC, FIRESTORE_DOC],
  },
  {
    id: 'static-site', label: 'Static site', family: 'lb', tested: true, testedWith: [{ on: '2026-10-16', options: [] }],
    summary: 'Files in a bucket, served through a backend bucket over HTTPS.',
    parts: [P('object'), ...BUCKET_BACKEND, ...LB_FRONT],
    // D124 결정 ② — 백엔드 버킷은 엣지 정책만 받는다(edge_security_policy) — 종류 CLOUD_ARMOR_EDGE 고정 프리셋 wafedge
    options: [{ id: 'armor', label: 'Cloud Armor (edge)', on: false, parts: [P('wafedge')] }],
    refs: [...BUCKET_BACKEND_REFS, ...LB_FRONT_REFS, { from: 'bb', to: 'wafedge', attr: 'edge_security_policy', evidence: `${TF}compute_backend_bucket` }],
    evidence: ['D117', 'D96', `${TF}compute_backend_bucket`, STATIC_SITE_DOC],
  },
  {
    // D127 — 선택은 부품을 더할 수만 있어 website 의 web · ig 를 뺄 수 없다 → 새 카드. 리전 MIG(가용성이 목적) · 인스턴스 이름은 MIG 가 짓는다(base_instance_name 은 안내)
    id: 'website-mig', label: 'Website (autoscaling)', family: 'lb', tested: true, testedWith: [{ on: '2026-10-23', options: [] }],
    summary: 'A regional managed instance group built from an instance template, with an autoscaler, behind an HTTPS load balancer. HTTP is redirected to HTTPS.',
    parts: [P('mig'), P('tpl'), P('as'), P('hc'), P('bs'), ...LB_FRONT, ...LB_FIREWALLS],
    options: [{ ...DB_OPTION, on: false }, { id: 'bastion', label: 'Bastion', on: false, parts: [P('bastion'), P('firewall', 'ssh'), P('firewall', 'iap')] }, ARMOR_OPTION],
    refs: [
      ...MIG_BACKEND_REFS, ...LB_FRONT_REFS, ARMOR_REF,
      { from: 'mig', to: 'tpl', attr: 'version.instance_template', evidence: `${TF}compute_region_instance_group_manager` },
      { from: 'as', to: 'mig', attr: 'target', evidence: `${TF}compute_region_autoscaler` },
      { from: 'tpl', to: 'vpc', attr: 'network_interface.network', evidence: `${TF}compute_instance_template` },
      { from: 'firewall:lbhc', to: 'vpc', attr: 'network', evidence: `${TF}compute_firewall` },
      { from: 'firewall:web', to: 'vpc', attr: 'network', evidence: `${TF}compute_firewall` },
    ],
    evidence: ['D127', 'D128', MIG_DOC, `${TF}compute_region_instance_group_manager`],
  },
  {
    id: 'vm-app', label: 'Internal app on VMs', tested: true, testedWith: [{ on: '2026-10-16', options: ['bastion', 'file', 'object'] }],
    summary: 'Web, app and database servers reachable only inside the network, with a bastion.',
    // D116 — 서버는 tier intweb · intwas(공개 Website 의 web · was 와 같은 서비스에 함께 둘 수 있게) · 버킷은 appdata(Static site 의 공개 버킷과 별개)
    // D117 — internal: 네트워크 안에서 intweb · intwas 의 서비스 포트를 받는다. 없으면 bastion 에서도 HTTP 가 막힌다(실배포 시험)
    parts: [P('intweb'), P('intwas'), P('db'), P('firewall', 'ssh'), P('firewall', 'icmp'), P('firewall', 'iap'), P('firewall', 'internal'), P('psa')],
    options: [{ id: 'bastion', label: 'Bastion', on: true, parts: [P('bastion')] }, { id: 'file', label: 'File server', on: false, parts: [P('file')] }, { id: 'object', label: 'Object storage', on: false, parts: [P('appdata')] }, DB_USER_OPTION],
    refs: [...DB_USER_REFS],
    evidence: ['D117', 'D91'],
  },
  {
    id: 'https-lb', label: 'HTTPS load balancer', family: 'lb', tested: true,
    // D128 — 이 카드의 계획으로 백엔드 셋을 각각 만들었다(run 은 10-16 · web · object 는 10-23). mig 백엔드는 Website (autoscaling) 카드로 시험했다
    testedWith: [{ on: '2026-10-16', options: [], backend: 'run' }, { on: '2026-10-23', options: [], backend: 'web' }, { on: '2026-10-23', options: [], backend: 'object' }],
    summary: 'An HTTPS load balancer in front of what this service already has: a web server, a Cloud Run service or a bucket.',
    parts: LB_FRONT,
    backends: [
      { needs: 'web', parts: [...VM_BACKEND, ...LB_FIREWALLS] },
      { needs: 'run', parts: RUN_BACKEND },
      { needs: 'object', parts: BUCKET_BACKEND },
      // D127 — 관리형 인스턴스 그룹. https-lb 는 있는 것만 감싼다 — 템플릿 · 자동 확장은 Website (autoscaling) 카드가 더한다
      { needs: 'mig', parts: [P('hc'), P('bs'), ...LB_FIREWALLS] },
    ],
    options: [],
    refs: [...LB_FRONT_REFS, ...VM_BACKEND_REFS, ...RUN_BACKEND_REFS, ...BUCKET_BACKEND_REFS, ...MIG_BACKEND_REFS],
    evidence: ['D91', 'D128', SERVERLESS_NEG_DOC],
  },
  {
    id: 'data-warehouse', label: 'Data warehouse (BigQuery)', tested: true, testedWith: [{ on: '2026-10-16', options: ['schedule'] }],
    summary: 'A landing bucket, a BigQuery dataset and a service account that loads it. Dataset names use underscores, not hyphens.',
    // D116 — 적재 버킷은 raw(Static site 의 공개 버킷과 별개) · 예약 적재는 ingest(Batch job 의 cron 과 별개)
    parts: [P('raw'), P('bq'), P('sa')],
    options: [{ id: 'schedule', label: 'Scheduled load (Cloud Scheduler)', on: false, parts: [P('ingest')] }, { id: 'kms', label: 'Encryption key (KMS)', on: false, parts: [P('ring'), P('key')] }, roleOption('cron')],
    refs: [
      { from: 'key', to: 'ring', attr: 'key_ring', evidence: `${TF}kms_crypto_key` },
      { from: 'raw', to: 'key', attr: 'encryption.default_kms_key_name', evidence: `${TF}storage_bucket` },
      { from: 'bq', to: 'key', attr: 'default_encryption_configuration.kms_key_name', evidence: `${TF}bigquery_dataset` },
      { from: 'ingest', to: 'sa@cron', attr: 'http_target.oauth_token.service_account_email', evidence: `${TF}cloud_scheduler_job` },
    ],
    evidence: ['D117', `${DOCS}bigquery/docs/datasets#dataset-naming`, `${DOCS}bigquery/docs/batch-loading-data`],
  },
  {
    id: 'gke', label: 'GKE cluster', tested: true, testedWith: [{ on: '2026-10-16', options: ['cache'], note: 'Autopilot cluster' }],
    summary: 'A GKE cluster on the VPC network, an Artifact Registry repository for its images and a service account for its nodes.',
    parts: [P('gke'), P('ar'), P('sa'), P('vpc'), P('subnet')],
    options: [{ id: 'cache', label: 'Cache (Memorystore for Redis)', on: false, parts: [P('redis')] }],
    refs: [
      { from: 'gke', to: 'vpc', attr: 'network', evidence: `${TF}container_cluster` },
      { from: 'gke', to: 'subnet', attr: 'subnetwork', evidence: `${TF}container_cluster` },
      { from: 'gke', to: 'sa', attr: 'node_config.service_account', evidence: `${TF}container_cluster` },
    ],
    evidence: ['D117', `${DOCS}kubernetes-engine/docs/how-to/service-accounts`, `${DOCS}artifact-registry/docs/integrate-gke`],
  },
  {
    id: 'event-pipeline', label: 'Event pipeline (Pub/Sub)', tested: true, testedWith: [{ on: '2026-10-16', options: [] }, { on: '2026-10-23', options: ['roles'], note: 'With CI/CD and Batch job in one service' }],
    summary: 'A Pub/Sub topic and subscription that push to a Cloud Run service, with a dead-letter topic for messages that keep failing.',
    // D116 — push 대상 Cloud Run 은 worker(공개 웹의 run 과 별개 — push 대상은 인증을 요구한다)
    // D117 — dlqsub: 데드레터 토픽의 구독. 없으면 넘어간 메시지가 사라진다(실배포 시험 · pubsub/docs/handling-failures)
    parts: [P('topic'), P('sub'), P('dlq'), P('dlqsub'), P('worker'), P('sa')],
    options: [roleOption('push')],
    refs: [
      { from: 'sub', to: 'topic', attr: 'topic', evidence: `${TF}pubsub_subscription` },
      { from: 'sub', to: 'dlq', attr: 'dead_letter_policy.dead_letter_topic', evidence: `${TF}pubsub_subscription` },
      { from: 'dlqsub', to: 'dlq', attr: 'topic', evidence: `${TF}pubsub_subscription` },
      { from: 'worker', to: 'sa', attr: 'template.service_account', evidence: `${TF}cloud_run_v2_service` },
      { from: 'sub', to: 'sa@push', attr: 'push_config.oidc_token.service_account_email', evidence: `${TF}pubsub_subscription` },
    ],
    evidence: ['D117', `${DOCS}run/docs/triggering/pubsub-push`, `${DOCS}pubsub/docs/handling-failures`],
  },
  {
    id: 'ci-cd', label: 'CI/CD (Cloud Build)', tested: true, testedWith: [{ on: '2026-10-16', options: ['secret'] }, { on: '2026-10-17', options: ['github'] }, { on: '2026-10-23', options: ['roles'], note: 'With Batch job and Event pipeline in one service' }],
    summary: 'A Cloud Build trigger that builds images into an Artifact Registry repository, running as its own service account.',
    parts: [P('ar'), P('build'), P('sa')],
    // D119 — GitHub 연결(2세대): 연결 conn 과 그 안의 저장소 repo 를 트리거가 가리킨다. 선택이다 — webhook · 1세대 GitHub 트리거는 이름 있는 연결 없이 된다
    options: [{ id: 'secret', label: 'Secret', on: false, parts: [P('secret')] }, { id: 'github', label: 'GitHub connection', on: false, parts: [P('conn'), P('repo')] }, roleOption('build')],
    refs: [
      { from: 'build', to: 'sa', attr: 'service_account', evidence: `${TF}cloudbuild_trigger` },
      { from: 'repo', to: 'conn', attr: 'parent_connection', evidence: `${TF}cloudbuildv2_repository` },
      { from: 'build', to: 'repo', attr: 'repository_event_config.repository', evidence: `${TF}cloudbuild_trigger` },
      { from: 'build', to: 'sa@build', attr: 'service_account', evidence: `${TF}cloudbuild_trigger` },
    ],
    evidence: ['D117', 'D119', `${DOCS}build/docs/build-push-docker-image`, `${DOCS}build/docs/securing-builds/configure-user-specified-service-accounts`, `${DOCS}build/docs/automating-builds/github/connect-repo-github`],
  },
  {
    id: 'batch-job', label: 'Batch job', tested: true, testedWith: [{ on: '2026-10-16', options: [] }, { on: '2026-10-23', options: ['roles'], note: 'With CI/CD and Event pipeline in one service' }],
    summary: 'A Cloud Run job started on a schedule by Cloud Scheduler, running as its own service account.',
    parts: [P('runjob'), P('cron'), P('sa')],
    options: [roleOption('cron')],
    refs: [
      { from: 'runjob', to: 'sa', attr: 'template.template.service_account', evidence: `${TF}cloud_run_v2_job` },
      { from: 'cron', to: 'sa', attr: 'http_target.oauth_token.service_account_email', evidence: `${TF}cloud_scheduler_job` },
      { from: 'cron', to: 'sa@cron', attr: 'http_target.oauth_token.service_account_email', evidence: `${TF}cloud_scheduler_job` },
    ],
    evidence: ['D117', `${DOCS}run/docs/execute/jobs-on-schedule`],
  },
  {
    // D125 — 처리 서비스는 handler(Pub/Sub 의 worker 와 같은 서비스에 함께 둔다 · D116). 넣는 쪽 API 서비스(run)는 선택 — 결정 ③: run 은 함께 쓰지 않으므로 Serverless web 과 한 서비스면 끈다
    id: 'task-queue', label: 'Async task queue', tested: true, testedWith: [{ on: '2026-10-23', options: ['api'] }],
    summary: 'A Cloud Tasks queue that calls a Cloud Run handler service with a service account token; an API service enqueues the tasks.',
    parts: [P('queue'), P('handler'), P('sa')],
    options: [
      { id: 'api', label: 'API service (Cloud Run)', on: true, parts: [P('run')] },
      { id: 'appdata', label: 'App bucket', on: false, parts: [P('appdata')] },
      { id: 'secret', label: 'Secret', on: false, parts: [P('secret')] },
      { id: 'fs', label: 'Database (Firestore)', on: false, parts: [P('fs')] },
      roleOption('push'),
    ],
    refs: [
      { from: 'queue', to: 'handler', attr: 'http_target.uri_override', evidence: `${TF}cloud_tasks_queue` },
      { from: 'queue', to: 'sa', attr: 'http_target.oidc_token.service_account_email', evidence: `${TF}cloud_tasks_queue` },
      { from: 'queue', to: 'sa@push', attr: 'http_target.oidc_token.service_account_email', evidence: `${TF}cloud_tasks_queue` },
      { from: 'handler', to: 'sa', attr: 'template.service_account', evidence: `${TF}cloud_run_v2_service` },
      { from: 'run', to: 'sa', attr: 'template.service_account', evidence: `${TF}cloud_run_v2_service` },
    ],
    evidence: ['D125', 'D128', TASKS_DOC, `${DOCS}tasks/docs/creating-http-target-tasks`, FIRESTORE_DOC],
  },
];

// ── AWS 카드 (D141) — GCP 표의 짝을 AWS 규칙 표로 옮겼다. 카드 id 는 hash 에 들지 않으므로(D93) GCP 와 같은 id 를 쓴다.
// 부품이 전부 규칙 표에 있는 일곱만 둔다 — Auto Scaling 그룹 · SQS · SNS · Scheduler · CodeBuild · Glue 규칙이 없어 website-mig · event-pipeline · task-queue · batch-job · ci-cd · data-warehouse 의 짝은 아직 없다.
// AWS 에서 tier 는 순번 규칙에만 붙고(compose.ts) S3 버킷은 순번이 없어 서비스에 하나다 — 버킷을 쓰는 카드는 static-site 하나이고 다른 카드는 버킷 선택을 두지 않는다
const ATF = 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/';
const ADOCS = 'https://docs.aws.amazon.com/';
// ALB 앞쪽 — 대상 그룹 · 로드 밸런서 · HTTPS 리스너 · 80 → 443 전환 리스너 · IAM 서버 인증서. 백엔드(EC2 · Lambda)는 카드마다 다르다
const ALB_FRONT: readonly BundlePart[] = [P('tg'), P('lb'), P('lis'), P('lisredir'), P('cert')];
const ALB_FRONT_REFS: readonly BundleRef[] = [
  { from: 'lis', to: 'lb', attr: 'load_balancer_arn', evidence: `${ATF}lb_listener` },
  { from: 'lis', to: 'tg', attr: 'default_action.target_group_arn', evidence: `${ATF}lb_listener` },
  { from: 'lis', to: 'cert', attr: 'certificate_arn', evidence: `${ATF}lb_listener` },
  { from: 'lisredir', to: 'lb', attr: 'load_balancer_arn', evidence: `${ATF}lb_listener` },
  { from: 'lb', to: 'firewall:web', attr: 'security_groups', evidence: `${ATF}lb` },
  { from: 'firewall:web', to: 'vpc', attr: 'vpc_id', evidence: `${ATF}security_group` },
];
// 백엔드 둘 — EC2 는 인스턴스 대상 + 인스턴스 보안 그룹(internal — ALB 그룹에서 오는 포트), Lambda 는 대상 종류 lambda + 실행 역할
const EC2_BACKEND: readonly BundlePart[] = [P('firewall', 'web'), P('firewall', 'internal')];
const EC2_BACKEND_REFS: readonly BundleRef[] = [
  { from: 'tg', to: 'web', attr: 'lb_target_group_attachment.target_id', evidence: `${ATF}lb_target_group_attachment` },
  { from: 'web', to: 'firewall:internal', attr: 'vpc_security_group_ids', evidence: `${ATF}instance` },
  { from: 'firewall:internal', to: 'vpc', attr: 'vpc_id', evidence: `${ATF}security_group` },
];
const LAMBDA_BACKEND: readonly BundlePart[] = [P('sa'), P('firewall', 'web')];
const LAMBDA_BACKEND_REFS: readonly BundleRef[] = [
  { from: 'tg', to: 'fn', attr: 'lb_target_group_attachment.target_id', evidence: `${ATF}lb_target_group_attachment` },
  { from: 'fn', to: 'sa', attr: 'role', evidence: `${ATF}lambda_function` },
];
const RDS_OPTION: BundleOption = { id: 'db', label: 'Database (RDS)', on: true, parts: [P('db'), P('sng')] };
const RDS_REF: BundleRef = { from: 'db', to: 'sng', attr: 'db_subnet_group_name', evidence: `${ATF}db_instance` };
const ROLE_OPTION: BundleOption = { id: 'role', label: 'IAM role and instance profile', on: false, parts: [P('sa'), P('prof')] };
const PROF_REF: BundleRef = { from: 'prof', to: 'sa', attr: 'role', evidence: `${ATF}iam_instance_profile` };
export const ALB_HTTPS_DOC = `${ADOCS}elasticloadbalancing/latest/application/create-https-listener.html`;
export const ALB_LAMBDA_DOC = `${ADOCS}elasticloadbalancing/latest/application/lambda-functions.html`;
export const S3_WEBSITE_DOC = `${ADOCS}AmazonS3/latest/userguide/WebsiteHosting.html`;
export const ECS_EXEC_ROLE_DOC = `${ADOCS}AmazonECS/latest/developerguide/task_execution_IAM_role.html`;
export const EKS_ROLES_DOC = `${ADOCS}eks/latest/userguide/cluster-iam-role.html`;
export const RDS_SUBNET_GROUP_DOC = `${ADOCS}AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html`;

/** AWS 카드 일곱 (D141) — 순서가 갤러리 순서이고 되읽기의 동률 순서다 */
export const AWS_BUNDLES: readonly Bundle[] = [
  {
    id: 'website', label: 'Website', family: 'lb', tested: true, testedWith: [{ on: '2026-10-25', options: ['was', 'bastion', 'role'], note: 'Database option not covered here; the same presets were tested on vm-app' }],
    summary: 'A web server behind an Application Load Balancer with an HTTPS listener. HTTP is redirected to HTTPS.',
    parts: [P('web'), ...ALB_FRONT, ...EC2_BACKEND],
    options: [{ ...RDS_OPTION }, { id: 'was', label: 'App server', on: false, parts: [P('was')] }, { id: 'bastion', label: 'Bastion', on: false, parts: [P('bastion'), P('firewall', 'ssh')] }, ROLE_OPTION],
    refs: [...ALB_FRONT_REFS, ...EC2_BACKEND_REFS, RDS_REF, PROF_REF, { from: 'web', to: 'prof', attr: 'iam_instance_profile', evidence: `${ATF}instance` }],
    evidence: ['D141', ALB_HTTPS_DOC, `${ATF}lb_target_group_attachment`],
  },
  {
    id: 'serverless-web', label: 'Serverless web', family: 'lb', tested: true, testedWith: [{ on: '2026-10-25', options: ['secret', 'ddb', 'lg'], note: 'Database option not covered' }],
    summary: 'A Lambda function behind an Application Load Balancer with an HTTPS listener. No servers to manage.',
    parts: [P('fn'), ...ALB_FRONT, ...LAMBDA_BACKEND],
    options: [{ ...RDS_OPTION, on: false }, { id: 'secret', label: 'Secret', on: false, parts: [P('secret')] }, { id: 'ddb', label: 'Database (DynamoDB)', on: false, parts: [P('ddb')] }, { id: 'lg', label: 'Log group', on: false, parts: [P('lg')] }],
    refs: [...ALB_FRONT_REFS, ...LAMBDA_BACKEND_REFS, RDS_REF, { from: 'fn', to: 'lg', attr: 'logging_config.log_group', evidence: `${ATF}lambda_function` }],
    evidence: ['D141', ALB_LAMBDA_DOC, `${ATF}lb_target_group`],
  },
  {
    // S3 정적 웹 호스팅은 버킷 하나로 돈다(HTTP 웹사이트 엔드포인트). HTTPS 를 주는 CloudFront 배포와 ACM 인증서는 이름이 없어 부품이 아니다 — 설정 안내로 둔다
    id: 'static-site', label: 'Static site', tested: true, testedWith: [{ on: '2026-10-25', options: ['kms'] }],
    summary: 'Files in a bucket with static website hosting, served from the bucket website endpoint. A CloudFront distribution adds HTTPS but has no name of its own.',
    parts: [P('object')],
    options: [{ id: 'kms', label: 'Encryption key (KMS)', on: false, parts: [P('kms')] }],
    refs: [{ from: 'object', to: 'kms', attr: 'server_side_encryption_configuration.rule.apply_server_side_encryption_by_default.kms_master_key_id', evidence: `${ATF}s3_bucket_server_side_encryption_configuration` }],
    evidence: ['D141', S3_WEBSITE_DOC],
  },
  {
    id: 'vm-app', label: 'Internal app on EC2', tested: true, testedWith: [{ on: '2026-10-25', options: ['bastion', 'file', 'role'] }],
    summary: 'Web, app and database servers reachable only inside the VPC, with a bastion.',
    // 보안 그룹 — ssh: bastion 의 22 · icmp: VPC 안 ping · internal: 서버끼리의 서비스 포트. S3 버킷 선택은 두지 않는다(AWS 버킷은 서비스에 하나 — Static site 카드와 겹친다)
    parts: [P('intweb'), P('intwas'), P('db'), P('sng'), P('firewall', 'ssh'), P('firewall', 'icmp'), P('firewall', 'internal')],
    options: [{ id: 'bastion', label: 'Bastion', on: true, parts: [P('bastion')] }, { id: 'file', label: 'File server', on: false, parts: [P('file')] }, ROLE_OPTION],
    refs: [RDS_REF, PROF_REF, { from: 'firewall:ssh', to: 'vpc', attr: 'vpc_id', evidence: `${ATF}security_group` }, { from: 'firewall:internal', to: 'vpc', attr: 'vpc_id', evidence: `${ATF}security_group` }],
    evidence: ['D141', RDS_SUBNET_GROUP_DOC],
  },
  {
    id: 'https-lb', label: 'HTTPS load balancer', family: 'lb', tested: true, testedWith: [{ on: '2026-10-25', options: [], backend: 'web', note: 'The fn backend has the same parts as the serverless-web card, which was built on its own' }],
    summary: 'An Application Load Balancer with an HTTPS listener in front of what this service already has: a web server or a Lambda function.',
    parts: ALB_FRONT,
    backends: [{ needs: 'web', parts: EC2_BACKEND }, { needs: 'fn', parts: LAMBDA_BACKEND }],
    options: [],
    refs: [...ALB_FRONT_REFS, ...EC2_BACKEND_REFS, ...LAMBDA_BACKEND_REFS],
    evidence: ['D141', ALB_HTTPS_DOC],
  },
  {
    // GCP 에 짝이 없는 AWS 카드 — Fargate 작업이 공개 IP 로 응답한다. ALB 는 붙이지 않는다(붙이면 lb 가족 — https-lb 카드를 같은 서비스에 더한다)
    id: 'ecs-service', label: 'ECS service (Fargate)', tested: true, testedWith: [{ on: '2026-10-25', options: ['roles'] }],
    summary: 'An ECS cluster running a Fargate service from a task definition, pulling images from an ECR repository, with a task execution role and a log group.',
    parts: [P('ecs'), P('svc'), P('td'), P('ecr'), P('sa'), P('lg'), P('firewall', 'web')],
    options: [{ id: 'secret', label: 'Secret', on: false, parts: [P('secret')] }, { id: 'ddb', label: 'Database (DynamoDB)', on: false, parts: [P('ddb')] }, { id: 'roles', label: 'Separate task role', on: false, parts: [P('sa', undefined, 'task')] }],
    refs: [
      { from: 'svc', to: 'ecs', attr: 'cluster', evidence: `${ATF}ecs_service` },
      { from: 'svc', to: 'td', attr: 'task_definition', evidence: `${ATF}ecs_service` },
      { from: 'svc', to: 'firewall:web', attr: 'network_configuration.security_groups', evidence: `${ATF}ecs_service` },
      { from: 'td', to: 'sa', attr: 'execution_role_arn', evidence: `${ATF}ecs_task_definition` },
      { from: 'td', to: 'sa@task', attr: 'task_role_arn', evidence: `${ATF}ecs_task_definition` },
      { from: 'td', to: 'lg', attr: 'container_definitions.logConfiguration.options.awslogs-group', evidence: `${ADOCS}AmazonECS/latest/developerguide/using_awslogs.html` },
      { from: 'td', to: 'ecr', attr: 'container_definitions.image', evidence: `${ADOCS}AmazonECS/latest/developerguide/task_definition_parameters.html` },
    ],
    evidence: ['D141', ECS_EXEC_ROLE_DOC],
  },
  {
    // 역할 둘 — 클러스터 역할 sa(sync) · 노드 역할 sa@node (D126 꼴). 서브넷 둘(AZ 둘)은 사용자가 슬롯을 더한다 — 설정 안내
    id: 'eks', label: 'EKS cluster', tested: true, testedWith: [{ on: '2026-10-25', options: [], note: 'Cache option not covered' }],
    summary: 'An EKS cluster with a managed node group on the VPC, an ECR repository for its images, and IAM roles for the cluster and its nodes.',
    parts: [P('eks'), P('ng'), P('ecr'), P('sa'), P('sa', undefined, 'node'), P('vpc'), P('subnet')],
    options: [{ id: 'cache', label: 'Cache (ElastiCache for Redis)', on: false, parts: [P('redis')] }],
    refs: [
      { from: 'eks', to: 'sa', attr: 'role_arn', evidence: `${ATF}eks_cluster` },
      { from: 'eks', to: 'subnet', attr: 'vpc_config.subnet_ids', evidence: `${ATF}eks_cluster` },
      { from: 'ng', to: 'eks', attr: 'cluster_name', evidence: `${ATF}eks_node_group` },
      { from: 'ng', to: 'sa@node', attr: 'node_role_arn', evidence: `${ATF}eks_node_group` },
      { from: 'ng', to: 'subnet', attr: 'subnet_ids', evidence: `${ATF}eks_node_group` },
    ],
    evidence: ['D141', EKS_ROLES_DOC],
  },
];

/** CSP 의 카드 표 — 마법사가 없는 CSP 는 빈 표 */
export function bundlesFor(provider: Provider): readonly Bundle[] {
  return provider === 'gcp' ? BUNDLES : provider === 'aws' ? AWS_BUNDLES : [];
}

export function bundleById(id: string, provider: Provider = 'gcp'): Bundle | undefined {
  return bundlesFor(provider).find((b) => b.id === id);
}
