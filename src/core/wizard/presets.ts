// 마법사 프리셋 (D59 · D64) — 데이터. 용도 칩 하나 = 규칙 하나. 마법사 함수(validatePlan · expandPlan)는 프리셋을 따로 알지 않고 이 표를 읽는다.
// 상용 저장소는 같은 꼴의 행을 더한다. 「네트워크」는 화면의 묶음 칩(group)이고 데이터에서는 pick 셋(vpc · subnet · firewall)이다
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
  /** HA 토글 (D61) — 켜면 서버 슬롯이 minInstances 이상. null 이면 토글 없음 */
  ha: { minInstances: number } | null;
  /** 서버리스로 바꿀 수 있는 규칙 id (D65 · Q5 ⑵). null 이면 없음 */
  serverless: { ruleIds: readonly string[] } | null;
  /** 새 서버 줄의 초기 딸린 것 — 화면 초기값일 뿐이다. expandPlan 은 넣지 않는다(숨은 기본값 없음) */
  defaultAttach?: Attachments;
  /** 화면 묶음 칩 — 같은 group 의 프리셋을 한 칩으로 더한다 */
  group?: string;
}

const VM = 'gcp.compute_instance';
const SERVERLESS = { ruleIds: ['gcp.cloud_function', 'gcp.run_service'] } as const;

export const PRESETS: readonly Preset[] = [
  { id: 'web', label: 'Web server', ruleId: VM, tier: 'web', ha: { minInstances: 2 }, serverless: SERVERLESS },
  { id: 'was', label: 'App server', ruleId: VM, tier: 'was', ha: { minInstances: 2 }, serverless: SERVERLESS },
  { id: 'bastion', label: 'Bastion', ruleId: VM, tier: 'bastion', ha: null, serverless: null },
  { id: 'file', label: 'File server', ruleId: VM, tier: 'file', ha: null, serverless: null, defaultAttach: { data: ['01'] } },
  { id: 'db', label: 'Database (Cloud SQL)', ruleId: 'gcp.cloud_sql_instance', tier: null, ha: null, serverless: null },
  { id: 'object', label: 'Object storage', ruleId: 'gcp.storage_bucket', tier: null, ha: null, serverless: null },
  { id: 'vpc', label: 'VPC network', ruleId: 'gcp.vpc_network', tier: null, ha: null, serverless: null, group: 'network' },
  { id: 'subnet', label: 'Subnet', ruleId: 'gcp.subnet', tier: null, ha: null, serverless: null, group: 'network' },
  { id: 'firewall', label: 'Firewall rule', ruleId: 'gcp.firewall_rule', tier: 'ssh', tierChoices: ['ssh', 'web', 'icmp'], ha: null, serverless: null, group: 'network' },
];

export function presetOf(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** 프리셋이 쓰는 tier 글자 전부 — 겹침 시험이 이 값을 센다 */
export const PRESET_TIERS: readonly string[] = [...new Set(PRESETS.flatMap((p) => [...(p.tier === null ? [] : [p.tier]), ...(p.tierChoices ?? [])]))];
