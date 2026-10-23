// 마법사 프리셋 (D59 · D64) — 데이터. 용도 칩 하나 = 규칙 하나. 마법사 함수(validatePlan · expandPlan)는 프리셋을 따로 알지 않고 이 표를 읽는다.
// 프리셋을 늘릴 때는 같은 꼴의 행을 더한다. 「네트워크」 · 「로드 밸런서」는 화면의 묶음(group)이고 데이터에서는 pick 하나씩이다.
// 칩 하나는 이름 하나다. 여러 칩을 한 번에 더하는 카드는 따로 둔 표(bundles.ts · D92 · D93)이고, 카드로 더한 pick 은 칩으로 더한 pick 과 같다. Cloud NAT 와 Cloud Router 도 따로 켠다(안내 문구만 둔다)
import type { Attachments } from '../selection';

export interface Preset {
  /** pick 의 preset 값 */
  id: string;
  /** 화면 칩 문구 (영어) */
  label: string;
  /** 규칙 id — serverless 를 켜지 않았을 때의 규칙 */
  ruleId: string;
  /** 용도 토큰 — pick 이 tier 를 주지 않으면 이 값. null 이면 토큰 없음 */
  tier: string | null;
  /** 화면이 고를 수 있게 보이는 tier 칩(방화벽) — 첫 값이 기본. 없으면 tier 하나 */
  tierChoices?: readonly string[];
  /** 고정 종류 (D88) — pick 이 kind 를 주지 않으면 이 값이고, 다른 값을 주면 wizard.preset_kind_fixed. 없으면 pick 의 kind 그대로 */
  kind?: string;
  /** HA 토글 (D61) — 켜면 서버 슬롯이 minInstances 이상. null 이면 토글 없음 */
  ha: { minInstances: number } | null;
  /** 서버리스로 바꿀 수 있는 규칙 id (D65 · Q5 ⑵). null 이면 없음 */
  serverless: { ruleIds: readonly string[] } | null;
  /** 새 서버 줄의 초기 딸린 것 — 화면 초기값일 뿐이다. expandPlan 은 넣지 않는다(숨은 기본값 없음) */
  defaultAttach?: Attachments;
  /** 화면 자리 (D73) — project 는 프로젝트 공용 칸, service 는 서비스 칸 */
  level: 'project' | 'service';
  /** 화면 묶음 — 같은 group 의 프리셋을 한 줄(network · lb)로 모은다 */
  group?: string;
}

const VM = 'gcp.compute_instance';
const SERVERLESS = { ruleIds: ['gcp.cloud_function', 'gcp.run_service'] } as const;

const NONE = { tier: null, ha: null, serverless: null } as const;

export const PRESETS: readonly Preset[] = [
  { id: 'web', label: 'Web server', ruleId: VM, tier: 'web', ha: { minInstances: 2 }, serverless: SERVERLESS, level: 'service' },
  { id: 'was', label: 'App server', ruleId: VM, tier: 'was', ha: { minInstances: 2 }, serverless: SERVERLESS, level: 'service' },
  { id: 'bastion', label: 'Bastion', ruleId: VM, tier: 'bastion', ha: null, serverless: null, level: 'service' },
  // D116 — 내부 전용 웹 · 앱 서버(Internal app 카드). 공개 LB 뒤의 web · was 와 같은 서비스에 둘 수 있게 tier 를 따로 둔다
  { id: 'intweb', label: 'Internal web server', ruleId: VM, tier: 'intweb', ha: { minInstances: 2 }, serverless: null, level: 'service' },
  { id: 'intwas', label: 'Internal app server', ruleId: VM, tier: 'intwas', ha: { minInstances: 2 }, serverless: null, level: 'service' },
  { id: 'file', label: 'File server', ruleId: VM, tier: 'file', ha: null, serverless: null, defaultAttach: { data: ['01'] }, level: 'service' },
  { id: 'db', label: 'Database (Cloud SQL)', ruleId: 'gcp.cloud_sql_instance', ...NONE, level: 'service' },
  { id: 'object', label: 'Object storage', ruleId: 'gcp.storage_bucket', ...NONE, level: 'service' },
  // D73 — 용도 없는 Cloud Run 서비스(Serverless 선택지와 별개) · 서비스 계정(역할) · 시크릿 · GKE · Workload Identity pool(provider 는 Custom)
  { id: 'run', label: 'Cloud Run service', ruleId: 'gcp.run_service', ...NONE, level: 'service' },
  { id: 'sa', label: 'Service account', ruleId: 'gcp.service_account', ...NONE, level: 'service' },
  { id: 'secret', label: 'Secret', ruleId: 'gcp.secret', ...NONE, level: 'service' },
  { id: 'gke', label: 'GKE cluster', ruleId: 'gcp.gke_cluster', ...NONE, level: 'service' },
  { id: 'wip', label: 'Workload Identity pool', ruleId: 'gcp.iam_workload_identity_pool', ...NONE, level: 'service' },
  // D114 — 새 카드(bundles.ts)의 서비스 부품. 규칙은 이미 표에 있고(D72), 칩 하나 = 이름 하나다. dlq: 데드레터 토픽 — 위 topic 과 같은 규칙이라 tier dlq 로 가른다(urlredir 와 같은 꼴)
  { id: 'bq', label: 'BigQuery dataset', ruleId: 'gcp.bigquery_dataset', ...NONE, level: 'service' },
  { id: 'ar', label: 'Artifact Registry repository', ruleId: 'gcp.artifact_registry_repository', ...NONE, level: 'service' },
  { id: 'topic', label: 'Pub/Sub topic', ruleId: 'gcp.pubsub_topic', ...NONE, level: 'service' },
  { id: 'sub', label: 'Pub/Sub subscription', ruleId: 'gcp.pubsub_subscription', ...NONE, level: 'service' },
  { id: 'dlq', label: 'Dead-letter topic', ruleId: 'gcp.pubsub_topic', tier: 'dlq', ha: null, serverless: null, level: 'service' },
  // D117 — 데드레터 토픽의 구독. 구독이 없는 토픽에 넘어간 메시지는 사라진다(pubsub/docs/handling-failures) — 구독 규칙에 tier dlq
  { id: 'dlqsub', label: 'Dead-letter subscription', ruleId: 'gcp.pubsub_subscription', tier: 'dlq', ha: null, serverless: null, level: 'service' },
  { id: 'build', label: 'Cloud Build trigger', ruleId: 'gcp.cloudbuild_trigger', ...NONE, level: 'service' },
  // D119 — Cloud Build 2세대 연결(GitHub 등)과 그 안의 저장소. 서비스 자리다 — 프로젝트 자리 범위(PROJECT_SCOPES)에 위치 범위가 없다(D63)
  { id: 'conn', label: 'Cloud Build connection', ruleId: 'gcp.cloudbuild_connection', ...NONE, level: 'service' },
  { id: 'repo', label: 'Cloud Build repository', ruleId: 'gcp.cloudbuild_repository', ...NONE, level: 'service' },
  { id: 'cron', label: 'Cloud Scheduler job', ruleId: 'gcp.scheduler_job', ...NONE, level: 'service' },
  { id: 'runjob', label: 'Cloud Run job', ruleId: 'gcp.run_job', ...NONE, level: 'service' },
  { id: 'redis', label: 'Memorystore for Redis', ruleId: 'gcp.redis_instance', ...NONE, level: 'service' },
  // D116 — 한 서비스의 두 카드가 같은 종류의 리소스를 서로 다른 일에 쓸 때 둘째 것. 같은 규칙에 tier 를 달아 이름 · 중복 키가 나뉜다(dlq · urlredir 와 같은 꼴).
  // worker: Pub/Sub push 를 받는 비공개 Cloud Run(공개 웹의 run 과 별개) · raw: 적재 버킷(정적 사이트의 공개 버킷과 별개) · ingest: 예약 적재 작업(Batch job 의 cron 과 별개 — 작업 하나는 대상 하나) ·
  // appdata: 내부 앱의 버킷(intweb · intwas 는 위 서버형 옆에 둔다)
  { id: 'worker', label: 'Cloud Run worker service', ruleId: 'gcp.run_service', tier: 'worker', ha: null, serverless: null, level: 'service' },
  { id: 'raw', label: 'Landing bucket', ruleId: 'gcp.storage_bucket', tier: 'raw', ha: null, serverless: null, level: 'service' },
  { id: 'ingest', label: 'Scheduled load job', ruleId: 'gcp.scheduler_job', tier: 'ingest', ha: null, serverless: null, level: 'service' },
  { id: 'appdata', label: 'App bucket', ruleId: 'gcp.storage_bucket', tier: 'appdata', ha: null, serverless: null, level: 'service' },
  // D124 — 규칙은 있으나 마법사에서 고를 수 없던 것. 카드 선택(bundles.ts)과 칩으로 고른다. 위치 범위(project_location)라 프로젝트 자리에 둘 수 없어 서비스 자리다.
  // waf: Cloud Armor 정책(백엔드 서비스용 — 종류를 고정하지 않아 토큰 없음) · wafedge: 엣지 정책(백엔드 버킷용 — 종류 CLOUD_ARMOR_EDGE 고정 · D88) · sqldb · sqluser: Cloud SQL 인스턴스 안의 데이터베이스 · 사용자
  { id: 'queue', label: 'Cloud Tasks queue', ruleId: 'gcp.tasks_queue', ...NONE, level: 'service' },
  { id: 'fs', label: 'Firestore database', ruleId: 'gcp.firestore_database', ...NONE, level: 'service' },
  { id: 'ring', label: 'KMS key ring', ruleId: 'gcp.kms_key_ring', ...NONE, level: 'service' },
  { id: 'key', label: 'KMS crypto key', ruleId: 'gcp.kms_crypto_key', ...NONE, level: 'service' },
  { id: 'waf', label: 'Cloud Armor policy', ruleId: 'gcp.security_policy', ...NONE, level: 'service' },
  { id: 'wafedge', label: 'Cloud Armor edge policy', ruleId: 'gcp.security_policy', kind: 'CLOUD_ARMOR_EDGE', ...NONE, level: 'service' },
  { id: 'sqldb', label: 'Cloud SQL database', ruleId: 'gcp.cloud_sql_database', ...NONE, level: 'service' },
  { id: 'sqluser', label: 'Cloud SQL user', ruleId: 'gcp.cloud_sql_user', ...NONE, level: 'service' },
  // D125 — Cloud Tasks 가 부르는 Cloud Run 처리 서비스. Pub/Sub 의 worker 와 같은 서비스에 함께 둘 수 있게 tier handler (D116 꼴)
  { id: 'handler', label: 'Cloud Run task handler', ruleId: 'gcp.run_service', tier: 'handler', ha: null, serverless: null, level: 'service' },
  // D127 — Website (autoscaling) 카드: 인스턴스 템플릿 · 리전 관리형 인스턴스 그룹 · 리전 자동 확장
  { id: 'tpl', label: 'Instance template', ruleId: 'gcp.instance_template', ...NONE, level: 'service' },
  { id: 'mig', label: 'Managed instance group', ruleId: 'gcp.region_instance_group_manager', ...NONE, level: 'service' },
  { id: 'as', label: 'Autoscaler', ruleId: 'gcp.region_autoscaler', ...NONE, level: 'service' },
  // D73 — HTTPS 로드 밸런서 부품. 칩 하나 = 이름 하나 · 자동 연결 없음
  { id: 'ip', label: 'Global IP address', ruleId: 'gcp.global_address', ...NONE, level: 'service', group: 'lb' },
  { id: 'ig', label: 'Instance group', ruleId: 'gcp.instance_group', ...NONE, level: 'service', group: 'lb' },
  { id: 'bs', label: 'Backend service', ruleId: 'gcp.backend_service', ...NONE, level: 'service', group: 'lb' },
  { id: 'hc', label: 'Health check', ruleId: 'gcp.health_check', ...NONE, level: 'service', group: 'lb' },
  { id: 'url', label: 'URL map', ruleId: 'gcp.url_map', ...NONE, level: 'service', group: 'lb' },
  { id: 'cert', label: 'SSL certificate', ruleId: 'gcp.ssl_certificate', ...NONE, level: 'service', group: 'lb' },
  { id: 'thps', label: 'Target HTTPS proxy', ruleId: 'gcp.target_https_proxy', ...NONE, level: 'service', group: 'lb' },
  { id: 'fwd', label: 'Forwarding rule', ruleId: 'gcp.global_forwarding_rule', ...NONE, level: 'service', group: 'lb' },
  // HTTP → HTTPS 전환 (D91) — 80 포트로 들어온 요청을 HTTPS 로 돌려보내는 URL 맵 · HTTP 프록시 · 전달 규칙. 위 url · fwd 와 같은 규칙이라 tier redir 로 가른다
  { id: 'urlredir', label: 'Redirect URL map (HTTP to HTTPS)', ruleId: 'gcp.url_map', tier: 'redir', ha: null, serverless: null, level: 'service', group: 'lb' },
  { id: 'thp', label: 'Target HTTP proxy', ruleId: 'gcp.target_http_proxy', ...NONE, level: 'service', group: 'lb' },
  { id: 'fwdredir', label: 'Forwarding rule (HTTP, port 80)', ruleId: 'gcp.global_forwarding_rule', tier: 'redir', ha: null, serverless: null, level: 'service', group: 'lb' },
  // D93 — 카드(bundles.ts)의 백엔드 부품. neg: 서버리스 NEG(Cloud Run 을 로드 밸런서에 붙인다 — 종류 기본 SERVERLESS 는 토큰 없음) · bb: 백엔드 버킷(버킷을 붙인다)
  { id: 'neg', label: 'Serverless NEG', ruleId: 'gcp.region_network_endpoint_group', ...NONE, level: 'service', group: 'lb' },
  { id: 'bb', label: 'Backend bucket', ruleId: 'gcp.backend_bucket', ...NONE, level: 'service', group: 'lb' },
  { id: 'vpc', label: 'VPC network', ruleId: 'gcp.vpc_network', ...NONE, level: 'project', group: 'network' },
  { id: 'subnet', label: 'Subnet', ruleId: 'gcp.subnet', ...NONE, level: 'project', group: 'network' },
  // D87 — iap: IAP TCP forwarding 소스 35.235.240.0/20 을 받는 규칙 · lbhc: 로드 밸런서 health check 프로브 대역(35.191.0.0/16 등)을 받는 규칙 ·
  // D117 — internal: 네트워크 안의 서버끼리 서비스 포트(웹 · 앱)를 받는 규칙. 사용자 VPC 는 들어오는 것을 모두 막으므로 없으면 내부 서버에 닿지 않는다
  { id: 'firewall', label: 'Firewall rule', ruleId: 'gcp.firewall_rule', tier: 'ssh', tierChoices: ['ssh', 'web', 'icmp', 'iap', 'lbhc', 'internal'], ha: null, serverless: null, level: 'project', group: 'network' },
  { id: 'router', label: 'Cloud Router', ruleId: 'gcp.router', ...NONE, level: 'project', group: 'network' },
  { id: 'nat', label: 'Cloud NAT', ruleId: 'gcp.router_nat', ...NONE, level: 'project', group: 'network' },
  // D88 — Private services access 대역: 전역 내부 주소(--global --purpose=VPC_PEERING). purpose 는 종류 표(address_type)와 다른 API 필드라 kind 는 INTERNAL 로 고정한다
  { id: 'psa', label: 'Private services access range', ruleId: 'gcp.global_address', tier: 'psa', kind: 'INTERNAL', ha: null, serverless: null, level: 'project', group: 'network' },
  // D124 결정 ① — Cloud DNS 영역: 프로젝트 범위 · 지역 토큰 없음 · 보통 프로젝트에 하나라 네트워크 칸 칩이다
  { id: 'dns', label: 'Cloud DNS zone', ruleId: 'gcp.dns_managed_zone', ...NONE, level: 'project', group: 'network' },
];

export function presetOf(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** 프리셋이 쓰는 tier 글자 전부 — 겹침 시험이 이 값을 센다 */
export const PRESET_TIERS: readonly string[] = [...new Set(PRESETS.flatMap((p) => [...(p.tier === null ? [] : [p.tier]), ...(p.tierChoices ?? [])]))];
