// 계획 파일 (D100) — Save plan 은 공유 링크와 같은 상태를 POST /v1/wizard 요청 본문 꼴로 내려주고, Open plan 은 그 파일을 링크와 같은 길로 연다.
// 저장 — 지금 hash(stateKey)를 풀어 그 모델로 파일을 만든다: 링크와 글자까지 같은 내용이다(region · location 은 코드).
// 열기 — 파일을 hash 의 짧은 꼴로 옮겨 decodeWizardObject 에 넘긴다: 복구(recoverPlan) · 안내(WizardNotices)가 링크와 같다.
//   모르는 키는 API(parseWizardBody · toModelPick)처럼 무시하고 센다 — 같은 파일이면 웹과 API 가 같은 pick · 같은 이름을 낸다(ignoredKeys · plan-file.test).
//   attach 안의 모르는 키만 예외다 — API 도 거부하므로(wizard.attach_not_object) 링크처럼 그 attach 를 버리고 센다
// 브라우저 일(Blob · input[type=file])은 Wizard.tsx 에 둔다 — 이 파일은 순수 함수라 시험이 node 에서 돈다
import { decodeWizardObject, decodeWizardState, encodeWizardState, HASH_KEY, MAX_WIZARD_JSON_BYTES, SERVERLESS_SHORT, type DecodedWizard } from './urlState';
import { initialPlan } from './wizardState';
import type { WizardPlan } from '../core/wizard/plan';
import type { Env } from '../core/types';
import { PLAN_MAX_BODY_BYTES, compactBytes, planFileText, toWirePlan, type PlanFile } from '../plan/wire';

/** 읽을 파일의 상한 — 마법사 hash 를 푼 JSON 의 최악 바이트(MAX_WIZARD_JSON_BYTES)와 같다: 링크가 열 수 있는 크기보다 큰 파일은 읽지 않는다.
 *  이름 200개 · 서비스 20개 · 자유 입력 최악인 계획의 들여쓴 파일도 이 안이다(planFile.test 가 잰다). 복구 시간은 urlState 의 크기 상한이 닫는다 */
export const PLAN_FILE_MAX_BYTES = MAX_WIZARD_JSON_BYTES;

export interface SavedPlan {
  file: PlanFile;
  /** 내려줄 글 — 들여쓰기 2칸 */
  text: string;
  /** 압축해서 보낼 때의 바이트 — API 상한과 댄다 */
  apiBytes: number;
  overApiLimit: boolean;
  /** cloudonym-plan-<system>-<env>.json */
  fileName: string;
}

/** 파일 이름 조각 — 소문자 · 숫자 · 하이픈만 */
const slug = (v: string): string => v.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'plan';

/** stateKey(encodeWizardState 의 값) → 계획 파일. 풀리지 않으면 undefined(화면은 Save plan 을 그리지 않는다) */
export function savePlan(stateKey: string, rulesVersion: string): SavedPlan | undefined {
  if (!stateKey) return undefined;
  const d = decodeWizardState(`#${HASH_KEY}=${stateKey}`);
  if (!d?.plan) return undefined;
  const envs = d.envs ?? [d.plan.project.env];
  const file = toWirePlan(d.plan, envs, rulesVersion);
  const apiBytes = compactBytes(file);
  return {
    file, text: planFileText(file), apiBytes, overApiLimit: apiBytes > PLAN_MAX_BODY_BYTES,
    fileName: `cloudonym-plan-${slug(d.plan.project.system)}-${slug(d.plan.project.env)}.json`,
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 무시한 키의 수 — API 가 읽지 않는 키(최상위 · project · 서비스 · pick · 슬롯) */
interface Ignored { n: number }
const countUnknown = (o: Record<string, unknown>, known: readonly string[], ig: Ignored): void => {
  ig.n += Object.keys(o).filter((k) => !known.includes(k)).length;
};

/** attach 안의 모르는 키는 `!` 를 붙여 옮긴다 — 짧은 꼴의 아는 키(b · d)와 우연히 같아도 그 뜻으로 읽히지 않고, 검사가 attach 를 거부해 링크처럼 버린다 */
const unknownAttachKeys = (o: Record<string, unknown>, known: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(Object.keys(o).filter((k) => !known.includes(k)).map((k) => [`!${k}`, o[k]]));

const FILE_KEYS = ['$schema', 'provider', 'project', 'project_id_suffix', 'project_picks', 'services', 'rules_version', 'environments'] as const;
const PROJECT_KEYS = ['owner', 'system', 'env', 'region'] as const;
const SERVICE_KEYS = ['purpose', 'picks'] as const;
const PICK_KEYS = ['preset', 'rule', 'tier', 'role', 'kind', 'ha', 'serverless', 'location', 'instances'] as const;
const SLOT_KEYS = ['id', 'seq', 'attach'] as const;

/** 목록 칸 — 없으면 없음(디코더가 빈 목록으로 본다), 배열이면 칸마다, 배열이 아니면 그대로(디코더 · validatePlan 이 거부한다) */
function list(v: unknown, map: (x: unknown) => unknown): unknown {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v.map(map) : v;
}

/** 켜짐 플래그 — true 는 1(짧은 꼴), 꺼짐(false · null)은 없음, 그 밖의 값은 그대로(검사가 거부한다) */
const flag = (v: unknown): unknown => (v === true ? 1 : v === false || v === null ? undefined : v);

function shortAttach(a: unknown): unknown {
  if (!isRecord(a)) return a;
  const out: Record<string, unknown> = { ...unknownAttachKeys(a, ['boot', 'data', 'ip', 'ipi']) };
  for (const [k, s] of [['boot', 'b'], ['ip', 'ip'], ['ipi', 'ipi']] as const) {
    const v = a[k] === undefined ? undefined : a[k] === true ? 1 : a[k];
    if (v !== undefined) out[s] = v;
  }
  if (a.data !== undefined) out.d = a.data;
  return out;
}

function shortSlot(s: unknown, ig: Ignored): unknown {
  if (!isRecord(s)) return s;
  countUnknown(s, SLOT_KEYS, ig);
  return { id: s.id, q: s.seq, ...(s.attach === undefined ? {} : { a: shortAttach(s.attach) }) };
}

function shortPick(p: unknown, ig: Ignored): unknown {
  if (!isRecord(p)) return p;
  countUnknown(p, PICK_KEYS, ig);
  const out: Record<string, unknown> = {};
  if (p.preset !== undefined && p.preset !== null) out.pr = p.preset;
  const copy: readonly (readonly [string, string])[] = [['rule', 'ru'], ['tier', 't'], ['role', 'ro'], ['kind', 'k'], ['location', 'l']];
  for (const [k, s] of copy) if (p[k] !== undefined) out[s] = p[k];
  const ha = flag(p.ha);
  if (ha !== undefined) out.h = ha;
  // 파일의 serverless 는 규칙 id 전체다 — hash 의 짧은 값(gcf · run)이 파일에 오면 API 처럼 받지 않는다(모르는 값으로 넘겨 검사가 끈다)
  if (typeof p.serverless === 'string') out.sv = Object.hasOwn(SERVERLESS_SHORT, p.serverless) ? `!${p.serverless}` : p.serverless;
  else if (p.serverless !== undefined && p.serverless !== null) out.sv = p.serverless;
  const slots = list(p.instances, (s) => shortSlot(s, ig));
  if (slots !== undefined) out.i = slots;
  return out;
}

function shortService(s: unknown, ig: Ignored): unknown {
  if (!isRecord(s)) return s;
  countUnknown(s, SERVICE_KEYS, ig);
  const picks = list(s.picks, (p) => shortPick(p, ig));
  return { n: s.purpose, ...(picks === undefined ? {} : { p: picks }) };
}

/** 연 계획 파일 — 링크를 연 결과에 무시한 키의 수를 더한다(화면이 한 줄 알린다) */
export interface OpenedPlan extends DecodedWizard {
  ignoredKeys: number;
}

/** 파일 글 → 마법사 상태. 너무 크거나 · JSON 이 아니거나 · 객체가 아니거나 · provider 가 gcp · aws 가 아니거나 · project 가 객체가 아니거나 ·
 *  프로젝트 값이 풀리지 않으면 undefined(화면은 계획을 그대로 두고 한 줄 알린다). 그 밖은 링크와 같이 고치고 센다 · 모르는 키는 무시하고 센다 */
export function openPlanFile(text: string): OpenedPlan | undefined {
  if (new TextEncoder().encode(text).length > PLAN_FILE_MAX_BYTES) return undefined;
  let f: unknown;
  try {
    f = JSON.parse(text);
  } catch {
    return undefined;
  }
  // provider — 마법사 CSP(gcp · aws) 만. aws 는 짧은 꼴의 c 로 옮긴다(링크와 같은 길)
  if (!isRecord(f) || (f.provider !== 'gcp' && f.provider !== 'aws') || !isRecord(f.project)) return undefined;
  const ig: Ignored = { n: 0 };
  countUnknown(f, FILE_KEYS, ig);
  countUnknown(f.project, PROJECT_KEYS, ig);
  const { owner, system, env, region } = f.project;
  const raw: Record<string, unknown> = { ...(f.provider === 'gcp' ? {} : { c: f.provider }), owner, system, env, region };
  if (f.rules_version !== undefined) raw.v = f.rules_version;
  if (Object.hasOwn(f, 'environments')) raw.e = f.environments;
  if (Object.hasOwn(f, 'project_id_suffix')) raw.x = f.project_id_suffix;
  const pp = list(f.project_picks, (p) => shortPick(p, ig));
  const ss = list(f.services, (s) => shortService(s, ig));
  raw.w = { ...(pp === undefined ? {} : { pp }), ...(ss === undefined ? {} : { s: ss }) };
  const d = decodeWizardObject(raw);
  return d && { ...d, ignoredKeys: ig.n };
}

/** Open plan 이 화면에 놓을 상태 — 연 결과 · 계획(버렸으면 프로젝트 넷만 든 빈 계획) · 환경 · 그 상태의 hash 키.
 *  key 는 화면의 stateKey 와 같은 값이다(Wizard 가 lastSent 로 둔다 — 파일을 연 것은 결과를 만든 것이 아니라 ui_generate 를 보내지 않는다. 링크를 열 때와 같다) */
export interface PlanFileState { opened: OpenedPlan; plan: WizardPlan; envs: Env[]; key: string }

/** 고른 파일을 읽어 연다 — 상한을 넘거나 · 읽지 못하거나(file.text() 거부) · 열리지 않으면 undefined(화면은 「열 수 없다」 한 줄) */
export async function readPlanFile(file: { size: number; text(): Promise<string> }, rulesVersion: string): Promise<PlanFileState | undefined> {
  if (file.size > PLAN_FILE_MAX_BYTES) return undefined;
  let text: string;
  try {
    text = await file.text();
  } catch {
    return undefined;
  }
  const opened = openPlanFile(text);
  if (!opened) return undefined;
  const plan = opened.plan ?? initialPlan(opened.project, opened.provider);
  const envs = opened.envs ?? [];
  return { opened, plan, envs, key: encodeWizardState(plan, rulesVersion, envs) ?? '' };
}
