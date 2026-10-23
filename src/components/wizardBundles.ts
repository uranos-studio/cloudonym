// 마법사 카드의 화면 상태 (D93) — 순수 함수. 카드는 pick 에 표시를 남기지 않는다: 더하면 프리셋 pick 이 되고, 화면은 있는 부품에서 카드를 되읽는다.
// 그래서 hash v4 · POST /v1/wizard · 항목 키 · 중복 키는 카드를 모르고, 링크 · API 로 만든 계획도 같은 카드 줄로 보인다.
// 되읽기 규칙 — 가족 lb 의 카드는 서비스에 앞쪽(url · thps · fwd) 중 하나와 그 카드의 백엔드 부품(web · ig · hc · bs / run · neg / object · bb) 중 하나가 있을 때 후보이고(https-lb 는 늘 후보),
// 후보 가운데 빠진 부품이 가장 적은 카드 하나(동률은 표 순서)를 보인다.
// 가족 밖의 카드(vm-app)는 필수 서비스 부품이 다 있을 때 보인다(web · db 칩만 켠 흔한 서비스에 「미완성 카드」를 띄우지 않는다) — 그때 프로젝트 공용 부품이 빠졌으면 미완성이다.
// 다만 함께 쓰지 않는 서비스 pick 하나라도 앞의 카드(LB 카드가 먼저)가 차지했으면 보이지 않는다(D115) — 서비스 계정 · Artifact Registry 저장소 · 시크릿 · Cloud SQL 은
// 카드 여럿이 함께 쓴다(SHAREABLE_PARTS). 완성은 필수 부품(서비스 · 프로젝트 공용)이 다 있을 때다
import { MAX_PICKS_PER_SERVICE, expandPlan, validatePlan, type WizardPlan } from '../core/wizard/plan';
import { generateProject } from '../core/engine';
import { BUNDLES, bundleById, partIsProject, partKey, type Bundle, type BundleBackend, type BundlePart } from '../core/wizard/bundles';
import { addPresetPick, findPreset } from './wizardState';
import { fillUi, type UiKey } from '../messages/catalog';
import { en } from '../messages/en';

/** 한 서비스 안에서 카드 여럿이 함께 쓰는 부품 (D115) — 같은 이름 하나를 여러 카드가 가리켜도 각 카드가 맞게 돈다:
 *  서비스 계정은 여러 리소스가 실행 주체로 쓰고, Artifact Registry 저장소는 이미지를 여럿 담고, 시크릿은 여러 곳이 읽고, Cloud SQL 인스턴스는 데이터베이스 · 접속자를 여럿 받고,
 *  bastion 은 서비스의 VM 어디로든 들어가는 관문 하나다(D116).
 *  같은 종류를 서로 다른 일에 쓰는 부품은 함께 쓰지 않고 tier 를 단 다른 프리셋으로 둔다(D116 — worker · raw · ingest · intweb · intwas · appdata).
 *  LB 부품(URL 맵의 기본 백엔드가 하나다 — 가족 lb)은 서비스에 하나다.
 *  화면만의 판정이라 src/core 가 아니라 여기에 둔다 */
export const SHAREABLE_PARTS: ReadonlySet<string> = new Set(['sa', 'ar', 'secret', 'db', 'bastion']);

/** 가족 lb 의 앞쪽 — 이 중 하나가 있어야 로드 밸런서 카드가 후보다(주소 · 인증서만 있는 서비스에 「미완성 LB」를 띄우지 않는다) */
const LB_ANCHORS = ['url', 'thps', 'fwd'];
/** LB 앞쪽 부품 — https-lb 의 필수 부품이 곧 앞쪽이다(주소 · URL 맵 · 인증서 · 프록시 · 전달 규칙 · 80 → 443) */
const LB_FRONT = new Set((bundleById('https-lb')?.parts ?? []).map(partKey));

/** 서비스에서 되읽은 카드 하나 */
export interface CardMatch {
  bundle: Bundle;
  /** 필수 부품 전부(고른 백엔드 포함) — 화면의 점검표 순서 */
  parts: BundlePart[];
  /** 빠진 필수 부품 */
  missing: BundlePart[];
  /** 백엔드를 고르는 카드(https-lb)인데 서비스에 백엔드가 없다 */
  noBackend: boolean;
  complete: boolean;
  /** 이 카드가 쓰는 서비스 pick 자리 — 함께 쓰는 부품(SHAREABLE_PARTS)도 든다. 목록은 첫 카드 아래에 한 번 보인다(serviceLayout.owned) */
  picks: number[];
  /** picks 가운데 함께 쓰지 않는 것 — 다른 카드와 겹치면 안 된다 */
  own: number[];
}

function has(plan: WizardPlan, service: number, p: BundlePart): boolean {
  return findPreset(plan, partIsProject(p) ? null : service, p.preset, p.tier, p.role) >= 0;
}
function presentIn(plan: WizardPlan, service: number, id: string): boolean {
  return findPreset(plan, service, id) >= 0;
}

/** 카드의 백엔드 — 서비스에 needs 가 있는 첫 백엔드. 없으면 undefined */
export function backendFor(plan: WizardPlan, service: number, b: Bundle): BundleBackend | undefined {
  return b.backends?.find((x) => presentIn(plan, service, x.needs));
}

/** 카드의 필수 부품 — 백엔드를 고르는 카드는 그 백엔드(needs 와 parts)까지 */
export function requiredParts(plan: WizardPlan, service: number, b: Bundle): BundlePart[] {
  const backend = backendFor(plan, service, b);
  return backend ? [{ preset: backend.needs }, ...b.parts, ...backend.parts] : [...b.parts];
}

function matchOf(plan: WizardPlan, service: number, b: Bundle): CardMatch {
  const parts = requiredParts(plan, service, b);
  const missing = parts.filter((p) => !has(plan, service, p));
  const noBackend = b.backends !== undefined && backendFor(plan, service, b) === undefined;
  const svc = parts.filter((p) => !partIsProject(p));
  const at = (xs: BundlePart[]) => xs.map((p) => findPreset(plan, service, p.preset, p.tier, p.role)).filter((i) => i >= 0);
  return { bundle: b, parts, missing, noBackend, complete: missing.length === 0 && !noBackend, picks: at(svc), own: at(svc.filter((p) => !SHAREABLE_PARTS.has(p.preset))) };
}

/** 서비스의 카드 (D93) — 표 순서. 가족 lb 는 하나 */
export function cardsIn(plan: WizardPlan, service: number): CardMatch[] {
  if (!plan.services[service]) return [];
  const out: CardMatch[] = [];
  if (LB_ANCHORS.some((id) => presentIn(plan, service, id))) {
    // 빠진 수가 적은 카드가 이긴다 — 같으면 표 순서
    const score = (m: CardMatch) => m.missing.length;
    const fixed = BUNDLES.filter((x) => x.family === 'lb' && x.backends === undefined);
    // 백엔드가 정해진 카드(website · serverless-web · static-site)는 그 카드에만 드는 앞쪽 밖 서비스 부품(web · ig · hc / run · neg / object · bb) 중 하나가 있어야 후보다 —
    // 점검표에서 부품을 빼도 같은 카드가 「미완성」으로 남는다. 두 카드 이상에 드는 부품(bs)은 어느 카드인지 말해 주지 않으므로 세지 않는다
    const sharedCount = new Map<string, number>();
    for (const b of fixed) for (const k of new Set(b.parts.filter((p) => !partIsProject(p)).map(partKey))) sharedCount.set(k, (sharedCount.get(k) ?? 0) + 1);
    const own = (b: (typeof BUNDLES)[number], most: number) => b.parts.some((p) => !partIsProject(p) && !LB_FRONT.has(partKey(p)) && (sharedCount.get(partKey(p)) ?? 0) <= most && has(plan, service, p));
    // 한 카드에만 드는 부품이 없으면 두 카드에 드는 부품(hc — website · website-mig, D127)으로 고르고 빠진 수로 가린다. 셋 이상에 드는 bs 는 세지 않는다
    const unique = fixed.filter((b) => own(b, 1));
    const candidates = unique.length > 0 ? unique : fixed.filter((b) => own(b, 2));
    // 그런 카드가 하나라도 있으면 https-lb(백엔드 없음)는 비교하지 않는다 — 부품을 둘 빼도 카드가 바뀌지 않는다
    const pool = candidates.length > 0 ? candidates : BUNDLES.filter((x) => x.family === 'lb' && x.backends !== undefined);
    let best: CardMatch | undefined;
    for (const b of pool) {
      const m = matchOf(plan, service, b);
      if (!best || score(m) < score(best)) best = m;
    }
    if (best) out.push(best);
  }
  // 다른 카드가 이미 차지한 「함께 쓰지 않는」 서비스 pick 이 든 카드는 후보가 아니다 — LB 카드가 먼저, 나머지는 표 순서로 차지한다(D115 — 함께 쓰는 부품은 세지 않는다).
  // website + 선택 was · db 에 vm-app 이 함께 뜨면 그 Remove 가 web 은 남기고 Website 의 선택(was · db)을 지운다 — web 이 겹쳐 vm-app 은 뜨지 않는다
  const taken = new Set(out.flatMap((m) => m.own));
  for (const b of BUNDLES.filter((x) => x.family === undefined)) {
    const m = matchOf(plan, service, b);
    if (!m.missing.every(partIsProject) || m.own.some((j) => taken.has(j))) continue;
    out.push(m);
    for (const j of m.own) taken.add(j);
  }
  return out.sort((a, b) => BUNDLES.indexOf(a.bundle) - BUNDLES.indexOf(b.bundle));
}

/** 서비스의 카드 하나 — 없으면 undefined */
export function cardIn(plan: WizardPlan, service: number, id: string): CardMatch | undefined {
  return cardsIn(plan, service).find((m) => m.bundle.id === id);
}

/** 서비스 pick 자리의 배치 — owned: 목록에서 그 pick 을 보이는 카드(두 카드가 함께 쓰면 표 순서로 앞 카드 아래 한 번) ·
 *  claims: 그 pick 을 필수 부품으로 쓰는 카드 전부(D115) · loose: 카드가 쓰지 않는 pick — 목록이 카드 줄 뒤에 하나씩 보인다 */
export function serviceLayout(plan: WizardPlan, service: number): { cards: CardMatch[]; owned: Map<number, string>; claims: Map<number, string[]>; loose: number[] } {
  const cards = cardsIn(plan, service);
  const owned = new Map<number, string>();
  const claims = new Map<number, string[]>();
  for (const c of cards) {
    for (const j of c.picks) {
      if (!owned.has(j)) owned.set(j, c.bundle.id);
      claims.set(j, [...(claims.get(j) ?? []), c.bundle.id]);
    }
  }
  const loose = (plan.services[service]?.picks ?? []).map((_, j) => j).filter((j) => !owned.has(j));
  return { cards, owned, claims, loose };
}

/** pick 자리마다 그것을 쓰는 카드 (D115) — 필수 부품으로 쓰는 카드(claims)와 켜진 선택으로 쓰는 카드. 표 순서 */
function usersOf(plan: WizardPlan, service: number): Map<number, string[]> {
  const { cards, claims } = serviceLayout(plan, service);
  const out = new Map<number, string[]>();
  const add = (j: number, id: string) => { const xs = out.get(j) ?? []; if (!xs.includes(id)) out.set(j, [...xs, id]); };
  for (const c of cards) {
    for (const j of c.picks) add(j, c.bundle.id);
    for (const o of c.bundle.options) {
      if (!optionOnWith(plan, service, o.parts, c.bundle.id, claims)) continue;
      for (const p of o.parts) if (!partIsProject(p)) add(findPreset(plan, service, p.preset, p.tier, p.role), c.bundle.id);
    }
  }
  return out;
}

/** 서비스 부품 하나를 쓰는 카드 (D115) — 필수 부품 · 켜진 선택 둘 다. except 카드는 뺀다. 프로젝트 공용 부품 · 없는 부품은 빈 목록 */
export function partUsers(plan: WizardPlan, service: number, part: BundlePart, except?: string): string[] {
  if (partIsProject(part)) return [];
  const i = findPreset(plan, service, part.preset, part.tier, part.role);
  if (i < 0) return [];
  return (usersOf(plan, service).get(i) ?? []).filter((id) => id !== except);
}

/** 켜진 선택이 쓰는 「함께 쓰지 않는」 서비스 pick — 카드마다. 다른 카드가 그 pick 을 필수로 가져가면 선택이 말없이 다른 카드의 것이 된다 */
function optionPicks(plan: WizardPlan, service: number, cards: readonly CardMatch[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const c of cards) {
    for (const o of c.bundle.options) {
      if (!optionOn(plan, service, o.parts, c.bundle.id)) continue;
      for (const p of o.parts) {
        if (partIsProject(p) || SHAREABLE_PARTS.has(p.preset)) continue;
        const i = findPreset(plan, service, p.preset, p.tier, p.role);
        if (i >= 0) out.set(i, c.bundle.id);
      }
    }
  }
  return out;
}

/** 카드를 더할 때 새로 생기는 부품 — 이미 있는 것은 건너뛴다(같은 부품이 둘이면 중복 키 — D86) */
export function partsToAdd(plan: WizardPlan, service: number, id: string, options: Readonly<Record<string, boolean>>): BundlePart[] {
  const b = bundleById(id);
  if (!b) return [];
  const want = [...requiredParts(plan, service, b), ...b.options.filter((o) => options[o.id] ?? o.on).flatMap((o) => o.parts)];
  const seen = new Set<string>();
  return want.filter((p) => {
    const k = `${partIsProject(p) ? 'p' : 's'}|${partKey(p)}`;
    if (seen.has(k) || has(plan, service, p)) return false;
    seen.add(k);
    return true;
  });
}

/** 부품을 더하면 생기는 문제 — full: 서비스나 프로젝트 공용의 pick 이 상한(40)을 넘는다 · duplicate: 새 pick 이 이미 있는 pick 과 중복 키(D86)가 같다.
 *  중복은 엔진(validatePlan)에 묻는다 — has() 는 프리셋 id 만 보므로 Custom 으로 더한 같은 규칙(gcp.global_address 등)을 모른다. 문제가 없으면 undefined */
export function addProblem(plan: WizardPlan, service: number, parts: readonly BundlePart[]): 'full' | 'duplicate' | undefined {
  const svcLen = plan.services[service]?.picks.length ?? 0;
  const prjLen = plan.projectPicks.length;
  if (svcLen + parts.filter((p) => !partIsProject(p)).length > MAX_PICKS_PER_SERVICE || prjLen + parts.filter(partIsProject).length > MAX_PICKS_PER_SERVICE) return 'full';
  if (parts.length === 0) return undefined;
  const check = validatePlan(applyParts(plan, service, parts));
  if (check.ok) return undefined;
  // 새로 붙은 pick 자리에 걸린 중복만 센다 — 원래 있던 오류는 이 동작의 탓이 아니다
  const fresh = (path: string | undefined): boolean => {
    const s = /^services\[(\d+)\]\.picks\[(\d+)\]$/.exec(path ?? '');
    if (s) return Number(s[1]) === service && Number(s[2]) >= svcLen;
    const p = /^projectPicks\[(\d+)\]$/.exec(path ?? '');
    return p !== null && Number(p[1]) >= prjLen;
  };
  return check.errors.some((e) => e.code === 'wizard.duplicate_pick' && fresh(e.path)) ? 'duplicate' : undefined;
}

/** 카드를 더할 수 없는 까닭 — 같은 가족의 카드가 이미 있다(lb) · 상한을 넘는다(full) · 이미 있는 pick 과 이름이 겹친다(duplicate) ·
 *  overlap(D115) — 함께 쓰지 않는 부품이 겹친다: 더해도 그 카드로 되읽히지 않거나 · 있던 카드가 사라지거나 · 다른 카드의 켜진 선택을 가져가거나 · 켜려는 선택이 다른 카드의 것이다.
 *  더할 수 있으면 undefined */
export function cardBlocked(plan: WizardPlan, service: number, id: string, options: Readonly<Record<string, boolean>>): 'family' | 'full' | 'duplicate' | 'overlap' | 'present' | undefined {
  const b = bundleById(id);
  if (!b || !plan.services[service]) return 'present';
  const cards = cardsIn(plan, service);
  if (cards.some((c) => c.bundle.id === id && c.complete)) return 'present';
  // 백엔드가 없는 https-lb 는 막지 않는다 — 그 안내가 「백엔드를 더하라」이고, 백엔드를 더해 줄 카드가 website · serverless-web · static-site 다
  if (b.family !== undefined && cards.some((c) => c.bundle.family === b.family && c.bundle.id !== id && !c.noBackend)) return 'family';
  const add = partsToAdd(plan, service, id, options);
  const problem = addProblem(plan, service, add);
  if (problem !== undefined) return problem;
  // 다른 카드의 켜진 선택이 쓰는 pick(예: Data warehouse 의 예약 적재 cron)을 이 카드가 필수로 가져가면 그 선택이 말없이 바뀐다
  const optionTaken = optionPicks(plan, service, cards);
  const mine = matchOf(plan, service, b);
  if (mine.own.some((j) => optionTaken.has(j) && optionTaken.get(j) !== id)) return 'overlap';
  const after = cardsIn(applyParts(plan, service, add), service);
  const shown = (x: Bundle) => after.some((c) => c.bundle.id === x.id || (x.family !== undefined && c.bundle.family === x.family));
  // 더한 뒤에도 카드 줄이 없으면 부품만 흩어진다 — 단추를 끄고 까닭을 보인다. LB 카드는 같은 가족의 카드로 되읽히면 된다(https-lb + web → website)
  if (!shown(b)) return 'overlap';
  // 있던 카드가 사라지면 안 된다(vm-app 에 website · event-pipeline 에 https-lb) — 같은 가족끼리 바뀌는 것(백엔드 없는 https-lb → website)만 된다
  if (!cards.every((c) => shown(c.bundle))) return 'overlap';
  // 켜려는 선택이 다른 카드의 것이면(Batch job 의 cron) 더해도 선택이 꺼진 채다 — 고른 대로 되지 않는다
  if (b.options.some((o) => (options[o.id] ?? o.on) && !optionOn(applyParts(plan, service, add), service, o.parts, id))) return 'overlap';
  return undefined;
}

function applyParts(plan: WizardPlan, service: number, parts: readonly BundlePart[]): WizardPlan {
  return parts.reduce((p, part) => addPresetPick(p, partIsProject(part) ? null : service, part.preset, part.tier, part.role), plan);
}

/** 카드를 더한다 (D93) — 부품마다 addPresetPick(칩과 같은 pick) · 이미 있는 것은 건너뛴다 · 프로젝트 공용 부품(방화벽 · PSA)은 projectPicks 로.
 *  더할 수 없으면(cardBlocked) 모델을 그대로 돌려준다 — 일부만 더해 미완성 카드를 만들지 않는다 */
export function addBundle(plan: WizardPlan, service: number, id: string, options: Readonly<Record<string, boolean>> = {}): WizardPlan {
  // 미완성 카드를 채우는 것(빠진 부품 더하기)도 같은 함수다 — 같은 카드는 가족 검사에 걸리지 않는다
  if (cardBlocked(plan, service, id, options) !== undefined) return plan;
  return applyParts(plan, service, partsToAdd(plan, service, id, options));
}

/** 「Add missing parts」 — 빠진 필수 부품만 더한다(선택은 전부 끈 채). 판정(fillBlocked)과 동작이 같은 선택을 쓴다 */
function fillOptions(id: string): Record<string, boolean> {
  return Object.fromEntries((bundleById(id)?.options ?? []).map((o) => [o.id, false]));
}
export function fillBlocked(plan: WizardPlan, service: number, id: string): ReturnType<typeof cardBlocked> {
  return cardBlocked(plan, service, id, fillOptions(id));
}
export function fillMissing(plan: WizardPlan, service: number, id: string): WizardPlan {
  return addBundle(plan, service, id, fillOptions(id));
}

/** 카드를 지운다 — 그 카드만 쓰는 서비스 pick 만(선택 부품 · 다른 카드도 쓰는 pick(D115 — 함께 쓰는 서비스 계정 등) · 프로젝트 공용 부품은 남긴다 — 방화벽은 다른 서비스가 쓸 수 있다) */
export function removeBundle(plan: WizardPlan, service: number, id: string): WizardPlan {
  const { claims } = serviceLayout(plan, service);
  const users = usersOf(plan, service);
  // 이 카드가 필수로 쓰고 · 다른 카드는 필수로도 켜진 선택으로도 쓰지 않는 pick 만 — 함께 쓰던 서비스 계정은 남는다
  const gone = (j: number) => (claims.get(j) ?? []).includes(id) && (users.get(j) ?? []).every((u) => u === id);
  if (!(plan.services[service]?.picks ?? []).some((_, j) => gone(j))) return plan;
  return { ...plan, services: plan.services.map((s, i) => (i === service ? { ...s, picks: s.picks.filter((_, j) => !gone(j)) } : s)) };
}

/** 부품 하나를 켤 수 없는 까닭 — 상한 · 이름 겹침(addProblem). 이미 있으면 undefined */
export function partBlocked(plan: WizardPlan, service: number, part: BundlePart): 'full' | 'duplicate' | undefined {
  return has(plan, service, part) ? undefined : addProblem(plan, service, [part]);
}

/** 선택을 켤 수 없는 까닭 — 빠진 부품(공용 포함)을 한꺼번에 더할 때의 상한 · 이름 겹침 · overlap(D115 — 함께 쓰지 않는 부품을 다른 카드가 쓴다).
 *  켜져 있으면 undefined(끄는 것은 막지 않는다) */
export function optionBlocked(plan: WizardPlan, service: number, parts: readonly BundlePart[], card?: string): 'full' | 'duplicate' | 'overlap' | undefined {
  if (optionOn(plan, service, parts, card)) return undefined;
  if (card !== undefined && parts.some((p) => !SHAREABLE_PARTS.has(p.preset) && partUsers(plan, service, p, card).length > 0)) return 'overlap';
  return addProblem(plan, service, parts.filter((p) => !has(plan, service, p)));
}

/** 부품 하나를 켜고 끈다 — 점검표의 체크 상자. 끄면 그 pick 을 뗀다(카드는 미완성으로 보인다), 켜면 칩과 같은 pick 을 더한다(상한 · 이름 겹침이면 그대로).
 *  프로젝트 공용 부품(방화벽 · PSA)은 끄지 않는다 — 다른 서비스의 카드가 쓸 수 있다. 지우는 곳은 네트워크다.
 *  card 의 점검표에서 끄면 다른 카드도 쓰는 부품(D115)은 끄지 않는다 — card 없이 부르면 카드 둘 이상이 쓰는 부품을 끄지 않는다 */
export function setPart(plan: WizardPlan, service: number, part: BundlePart, on: boolean, card?: string): WizardPlan {
  const at = partIsProject(part) ? null : service;
  const i = findPreset(plan, at, part.preset, part.tier, part.role);
  if (on) return i >= 0 || partBlocked(plan, service, part) !== undefined ? plan : addPresetPick(plan, at, part.preset, part.tier, part.role);
  if (i < 0 || at === null) return plan;
  const users = partUsers(plan, service, part);
  if (card !== undefined ? users.some((u) => u !== card) : users.length > 1) return plan;
  return { ...plan, services: plan.services.map((s, k) => (k === service ? { ...s, picks: s.picks.filter((_, j) => j !== i) } : s)) };
}

/** 선택 하나가 켜져 있는가 — 선택의 서비스 부품이 다 있으면 켜짐. card 를 주면 함께 쓰지 않는 부품을 다른 카드가 필수로 쓰고 있을 때 꺼짐이다(D115 —
 *  Batch job 의 Cloud Scheduler 작업은 Data warehouse 의 예약 적재가 아니다) */
export function optionOn(plan: WizardPlan, service: number, part: readonly BundlePart[], card?: string): boolean {
  if (card !== undefined) return optionOnWith(plan, service, part, card, serviceLayout(plan, service).claims);
  const own = part.filter((p) => !partIsProject(p));
  return own.length > 0 && own.every((p) => has(plan, service, p));
}
function optionOnWith(plan: WizardPlan, service: number, part: readonly BundlePart[], card: string, claims: ReadonlyMap<number, readonly string[]>): boolean {
  const own = part.filter((p) => !partIsProject(p));
  if (own.length === 0 || !own.every((p) => has(plan, service, p))) return false;
  return own.every((p) => SHAREABLE_PARTS.has(p.preset) || (claims.get(findPreset(plan, service, p.preset, p.tier, p.role)) ?? []).every((id) => id === card));
}

/** 선택을 켜고 끈다 — 켜면 그 부품(프로젝트 공용 포함)을 한꺼번에 더하고(optionBlocked 면 그대로 — 방화벽만 빠진 Bastion 을 만들지 않는다), 끄면 서비스 부품만 뗀다(공용 부품은 남긴다).
 *  card 를 주면 다른 카드도 쓰는 부품은 끄지 않는다(D115) */
export function setOption(plan: WizardPlan, service: number, parts: readonly BundlePart[], on: boolean, card?: string): WizardPlan {
  if (on) {
    if (optionBlocked(plan, service, parts, card) !== undefined) return plan;
    const miss = parts.filter((p) => !has(plan, service, p));
    return miss.length === 0 ? plan : applyParts(plan, service, miss);
  }
  return parts.filter((p) => !partIsProject(p)).reduce((p, part) => setPart(p, service, part, false, card), plan);
}

/** 부품이 있는가 — 점검표 */
export function partPresent(plan: WizardPlan, service: number, part: BundlePart): boolean {
  return has(plan, service, part);
}

/** Website (autoscaling) 카드의 기본 인스턴스 이름 예시 — 그룹이 만드는 VM 이름의 앞부분(표시 전용 · 이름 목록 · hash · 내보내기에 싣지 않는다).
 *  이 서비스에 Web server 칩(web) 하나만 둔 계획을 따로 만들어 엔진(expandPlan → generateProject)으로 이름을 받고, 슬롯 번호(seq)만 뗀다.
 *  MIG 이름을 고쳐 쓰지 않는다 — Website 카드의 `-gce-web-01` 과 같은 길로 만든다. 문맥이 틀려 이름을 못 만들면 undefined */
export function migBaseName(plan: WizardPlan, service: number): string | undefined {
  const svc = plan.services[service];
  if (!svc) return undefined;
  const probe = addPresetPick({ ...plan, projectPicks: [], services: [{ ...svc, picks: [] }] }, 0, 'web');
  if (!validatePlan(probe).ok) return undefined;
  const seq = probe.services[0]?.picks[0]?.instances?.[0]?.seq;
  if (seq === undefined) return undefined;
  const item = generateProject(expandPlan(probe), 'gcp').items.find((i) => i.key.startsWith('service/'));
  if (!item?.valid || !item.name.endsWith(`-${seq}`)) return undefined;
  return item.name.slice(0, -(seq.length + 1));
}

/** 설정 안내 한 줄 — website-mig 는 이 서비스의 기본 인스턴스 이름 예시(migBaseName)를 넣는다. 못 만들면 일반 문장 */
export function setupNote(plan: WizardPlan, service: number, key: string, text: UiKey): string {
  if (key === 'website-mig') {
    const name = migBaseName(plan, service);
    if (name !== undefined) return fillUi(en, 'wizard_card_setup_mig_named', { name });
  }
  return en.ui[text];
}
