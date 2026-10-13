// 카드 (D92 · D93) — 데이터. 카드 하나 = 프리셋 pick 여럿을 한 번에 더하는 표. 엔진 · validatePlan · expandPlan 은 카드를 모른다(프리셋과 같다 — D64).
// 카드로 더한 pick 은 칩으로 더한 pick 과 바이트까지 같다 — pick 에 카드 표시를 남기지 않는다. 화면은 있는 부품에서 카드를 되읽는다(D93).
// 부품의 자리는 프리셋의 level 이 정한다 — project 면 프로젝트 공용(projectPicks), service 면 그 서비스
import { presetOf } from './presets';

/** 부품 하나 — 프리셋 id 와(방화벽처럼 tier 칩이 여럿인 프리셋이면) tier */
export interface BundlePart { preset: string; tier?: string }
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
  /** 이 조합 그대로 Google Cloud 에 만들어 동작을 본 카드인가 (D91) — 아니면 「규칙은 확인함 · 묶음 적용은 아직」 */
  tested: boolean;
}

/** 부품의 키 — 프리셋 id, tier 가 있으면 `firewall:lbhc` */
export function partKey(p: BundlePart): string {
  return p.tier === undefined ? p.preset : `${p.preset}:${p.tier}`;
}

/** 부품이 프로젝트 공용 자리인가 — 프리셋 level 로 정한다 */
export function partIsProject(p: BundlePart): boolean {
  return presetOf(p.preset)?.level === 'project';
}

const P = (preset: string, tier?: string): BundlePart => (tier === undefined ? { preset } : { preset, tier });
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
// 프로젝트 공용 방화벽 — web: 로드 밸런서(GFE 대역)에서 80 · 443 을 받는다 · lbhc: 헬스 체크 프로브 대역을 받는다. 없으면 백엔드가 늘 비정상이다 (D87 · D91)
const LB_FIREWALLS: readonly BundlePart[] = [P('firewall', 'web'), P('firewall', 'lbhc')];
const DB_OPTION: BundleOption = { id: 'db', label: 'Database (Cloud SQL)', on: true, parts: [P('db'), P('psa')] };
const SERVERLESS_NEG_DOC = 'https://docs.cloud.google.com/load-balancing/docs/negs/serverless-neg-concepts';

/** 1차 카드 다섯 (D93) — 순서가 갤러리 순서이고 되읽기의 동률 순서다 */
export const BUNDLES: readonly Bundle[] = [
  {
    id: 'website', label: 'Website', family: 'lb', tested: true,
    summary: 'A web server VM behind an HTTPS load balancer. HTTP is redirected to HTTPS.',
    parts: [P('web'), ...VM_BACKEND, ...LB_FRONT, ...LB_FIREWALLS],
    options: [{ ...DB_OPTION }, { id: 'was', label: 'App server', on: false, parts: [P('was')] }, { id: 'bastion', label: 'Bastion', on: false, parts: [P('bastion'), P('firewall', 'ssh'), P('firewall', 'iap')] }],
    refs: [...VM_BACKEND_REFS, ...LB_FRONT_REFS],
    evidence: ['D91', `${TF}compute_backend_service`],
  },
  {
    id: 'serverless-web', label: 'Serverless web', family: 'lb', tested: false,
    summary: 'A Cloud Run service behind an HTTPS load balancer. No servers to manage.',
    parts: [P('run'), ...RUN_BACKEND, ...LB_FRONT],
    options: [{ ...DB_OPTION, on: false }, { id: 'sa', label: 'Service account', on: false, parts: [P('sa')] }, { id: 'secret', label: 'Secret', on: false, parts: [P('secret')] }],
    refs: [...RUN_BACKEND_REFS, ...LB_FRONT_REFS],
    evidence: [SERVERLESS_NEG_DOC, `${TF}compute_region_network_endpoint_group`],
  },
  {
    id: 'static-site', label: 'Static site', family: 'lb', tested: false,
    summary: 'Files in a bucket, served through a backend bucket over HTTPS.',
    parts: [P('object'), ...BUCKET_BACKEND, ...LB_FRONT],
    options: [],
    refs: [...BUCKET_BACKEND_REFS, ...LB_FRONT_REFS],
    evidence: [`${TF}compute_backend_bucket`],
  },
  {
    id: 'vm-app', label: 'Internal app on VMs', tested: true,
    summary: 'Web, app and database servers reachable only inside the network, with a bastion.',
    parts: [P('web'), P('was'), P('db'), P('firewall', 'ssh'), P('firewall', 'icmp'), P('firewall', 'iap'), P('psa')],
    options: [{ id: 'bastion', label: 'Bastion', on: true, parts: [P('bastion')] }, { id: 'file', label: 'File server', on: false, parts: [P('file')] }, { id: 'object', label: 'Object storage', on: false, parts: [P('object')] }],
    refs: [],
    evidence: ['D91'],
  },
  {
    id: 'https-lb', label: 'HTTPS load balancer', family: 'lb', tested: false,
    summary: 'An HTTPS load balancer in front of what this service already has: a web server, a Cloud Run service or a bucket.',
    parts: LB_FRONT,
    backends: [
      { needs: 'web', parts: [...VM_BACKEND, ...LB_FIREWALLS] },
      { needs: 'run', parts: RUN_BACKEND },
      { needs: 'object', parts: BUCKET_BACKEND },
    ],
    options: [],
    refs: [...LB_FRONT_REFS, ...VM_BACKEND_REFS, ...RUN_BACKEND_REFS, ...BUCKET_BACKEND_REFS],
    evidence: ['D91', SERVERLESS_NEG_DOC],
  },
];

export function bundleById(id: string): Bundle | undefined {
  return BUNDLES.find((b) => b.id === id);
}
