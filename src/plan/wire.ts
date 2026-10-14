// 계획 파일 (D100) — 마법사 모델(WizardPlan)과 POST /v1/wizard 요청 본문(wire) 사이의 변환을 한 곳에 둔다.
// API(schemas.ts)는 wire → 모델 pick 을, 화면(planFile.ts)은 모델 → wire(Save plan)를 여기서 쓴다.
// core 도 api 도 들여오지 않는다 — 자기 타입만 둔다(구조 타입이라 core 의 WizardPlan 이 그대로 들어온다).
// core 밖에 두는 까닭: src/core 를 고치면 규칙 버전이 바뀌어 rules_version 을 고정한 호출자가 409 를 받는다 (D27). 경계는 src/plan/boundary.test.ts

/** 계획 파일 · 요청 본문의 상한 — API 의 MAX_BODY_BYTES(src/api/v1.ts)와 같다(limits.test 가 둘을 대어 본다).
 *  이름 200개 최악 계획의 압축 본문이 약 26 KB 라 32 KiB 면 웹에서 되는 계획은 API 로도 된다 */
export const PLAN_MAX_BODY_BYTES = 32 * 1024;

/** 모델 경로의 이름 → 요청 본문의 이름 (§5-5 표) — 표에 없는 글자는 같다 */
export const WIRE_PATH_NAMES: Readonly<Record<string, string>> = { projectPicks: 'project_picks', ruleId: 'rule', projectIdSuffix: 'project_id_suffix' };

// ── 모델 쪽 (구조 타입 — core 의 WizardPlan · Pick · WizardSlot 과 같은 꼴) ──
export interface PlanAttach { boot?: true; data?: readonly string[]; ip?: true; ipi?: true }
export interface PlanSlot { id: string; seq: string; attach?: PlanAttach }
export interface PlanPick {
  preset: string | null; ruleId?: string; tier?: string; role?: string; kind?: string;
  ha?: boolean | null; serverless?: string | null; instances?: readonly PlanSlot[]; location?: string;
}
export interface PlanModel {
  provider: string;
  project: { owner: string; system: string; env: string; region: string };
  projectPicks: readonly PlanPick[];
  services: readonly { purpose: string; picks: readonly PlanPick[] }[];
  projectIdSuffix?: string;
}

// ── wire 쪽 (openapi WizardRequest · public/plan.schema.json) ──
export interface WireAttach { boot?: true; data?: string[]; ip?: true; ipi?: true }
export interface WireSlot { id: string; seq: string; attach?: WireAttach }
export interface WirePick {
  preset: string | null; rule?: string; tier?: string; role?: string; kind?: string;
  ha?: true; serverless?: string; location?: string; instances?: WireSlot[];
}
/** 계획 파일 = 요청 본문 + rules_version(늘) + environments(둘 이상일 때만 — API 는 읽지 않는다) */
export interface PlanFile {
  provider: string;
  project: { owner: string; system: string; env: string; region: string };
  project_id_suffix?: string;
  project_picks: WirePick[];
  services: { purpose: string; picks: WirePick[] }[];
  rules_version: string;
  environments?: string[];
}

function toWireAttach(a: PlanAttach | undefined): WireAttach | undefined {
  if (!a) return undefined;
  const out: WireAttach = {};
  if (a.boot === true) out.boot = true;
  if (a.data && a.data.length > 0) out.data = [...a.data];
  if (a.ip === true) out.ip = true;
  if (a.ipi === true) out.ipi = true;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 모델 pick → wire pick. 프리셋이면 rule 을 싣지 않는다(프리셋은 규칙을 데이터가 정한다 — hash 의 pr/ru 와 같다). 꺼진 ha · serverless 는 싣지 않는다 */
export function toWirePick(p: PlanPick): WirePick {
  const out: WirePick = { preset: p.preset };
  if (p.preset === null && p.ruleId !== undefined) out.rule = p.ruleId;
  if (p.tier !== undefined) out.tier = p.tier;
  if (p.role !== undefined) out.role = p.role;
  if (p.kind !== undefined) out.kind = p.kind;
  if (p.ha === true) out.ha = true;
  if (typeof p.serverless === 'string') out.serverless = p.serverless;
  if (p.location !== undefined) out.location = p.location;
  if (p.instances !== undefined) {
    out.instances = p.instances.map((s) => {
      const a = toWireAttach(s.attach);
      return { id: s.id, seq: s.seq, ...(a ? { attach: a } : {}) };
    });
  }
  return out;
}

/** 모델 → 계획 파일. envs 는 화면의 환경 목록(D82) — 둘 이상일 때만 environments 를 싣는다(하나면 파일이 요청 본문과 글자까지 같다 · rules_version 제외) */
export function toWirePlan(plan: PlanModel, envs: readonly string[], rulesVersion: string): PlanFile {
  const out: PlanFile = {
    provider: plan.provider,
    project: { owner: plan.project.owner, system: plan.project.system, env: plan.project.env, region: plan.project.region },
    ...(plan.projectIdSuffix === undefined ? {} : { project_id_suffix: plan.projectIdSuffix }),
    project_picks: plan.projectPicks.map(toWirePick),
    services: plan.services.map((s) => ({ purpose: s.purpose, picks: s.picks.map(toWirePick) })),
    rules_version: rulesVersion,
  };
  if (envs.length > 1) out.environments = [...envs];
  return out;
}

/** 사람이 읽는 파일 — 들여쓰기 2칸 · 끝 줄바꿈 */
export function planFileText(file: PlanFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** 보낼 때의 바이트 수 — 압축 직렬화(들여쓰기 없음)의 UTF-8 바이트. 상한(PLAN_MAX_BODY_BYTES)과 대는 값이다 */
export function compactBytes(body: unknown): number {
  return new TextEncoder().encode(JSON.stringify(body)).length;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 요청 본문 pick → 모델 Pick — 아는 칸만 옮긴다(rule → ruleId). preset 이 없으면 custom(null). 객체가 아니면 그대로 넘겨 validatePlan 이 거부한다 */
export function toModelPick(p: unknown): unknown {
  if (!isRecord(p)) return p;
  const out: Record<string, unknown> = { preset: p.preset === undefined ? null : p.preset };
  if (p.rule !== undefined) out.ruleId = p.rule;
  for (const k of ['tier', 'role', 'kind', 'ha', 'serverless', 'instances', 'location']) if (p[k] !== undefined) out[k] = p[k];
  return out;
}
