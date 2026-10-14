// @ts-check
// 계획 파일 (D100) 다루기 — 읽기 · 쓰기 · 환경마다 보낼 본문 · 다음 빈 번호 · 이름 보관 파일 (D102).
// 이름 규칙은 여기 없다 — 판정은 전부 서버(POST /v1/wizard)가 한다. 여기 있는 것은 「JSON 을 어떻게 고치는가」뿐이다
import { readFileSync, renameSync, openSync, writeSync, fsyncSync, closeSync, chmodSync, statSync, lstatSync, realpathSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';

/** @typedef {{ id: string, seq: string, attach?: Record<string, unknown> }} Slot */
/** @typedef {{ preset: string | null, rule?: string, tier?: string, role?: string, kind?: string, ha?: boolean, serverless?: string, location?: string, instances?: Slot[] }} Pick */
/** @typedef {{ provider: string, project: { owner: string, system: string, env: string, region: string }, project_id_suffix?: string, project_picks: Pick[], services: { purpose: string, picks: Pick[] }[], rules_version?: string, environments?: string[] }} PlanFile */

/** 계획 · 보관 파일을 읽거나 쓰지 못함 · 꼴이 틀림 · 읽은 뒤 바뀜 — 종료 코드 2 로 이어진다 */
export class PlanError extends Error {}

/** 내용 해시 — 읽은 글과 쓰기 직전의 파일이 같은지 대어 본다 @param {string} text */
const digestOf = (text) => createHash('sha256').update(text).digest('hex');

/** @param {unknown} e */
const errMessage = (e) => (e instanceof Error ? e.message : String(e));

/** @param {unknown} e */
const isMissing = (e) => isRecord(e) && e.code === 'ENOENT';

/** @param {unknown} v @returns {v is Record<string, unknown>} */
export const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 계획 파일을 읽는다 — JSON 이고 provider · project 객체가 있으면 받는다. 나머지 꼴은 서버가 본다(400).
 * digest 는 읽은 글의 해시 — 쓸 때 writeJson 에 넘기면 그 사이 파일이 바뀌었는지 본다
 * @param {string} path
 * @returns {{ plan: PlanFile, digest: string }}
 */
export function readPlan(path) {
  let text;
  try {
    text = readFileSync(path, 'utf-8');
  } catch (e) {
    throw new PlanError(`Cannot read the plan file ${path}: ${errMessage(e)}`);
  }
  /** @type {unknown} */
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new PlanError(`${path} is not JSON.`);
  }
  if (!isRecord(doc) || typeof doc.provider !== 'string' || !isRecord(doc.project)) throw new PlanError(`${path} is not a plan file (it needs "provider" and a "project" object).`);
  return { plan: /** @type {PlanFile} */ (/** @type {unknown} */ (doc)), digest: digestOf(text) };
}

/** 사람이 읽는 파일 — 들여쓰기 2칸 · 끝 줄바꿈 (웹 Save plan 과 같다)
 * @param {unknown} doc */
export function planText(doc) {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** 잠금 파일의 자리 — 대상 파일(심볼릭 링크면 그 대상) 옆 `<대상>.lock` @param {string} target */
export const lockPathFor = (target) => `${target}.lock`;

/**
 * 시험 전용 주입점 — 운영 호출(main.mjs)은 넘기지 않으므로 기본에서 꺼져 있다. 환경변수는 읽지 않는다.
 * fs: 잠금 · 임시 파일에 쓰는 함수 일부를 바꿔 끼운다(오류 주입) · afterCheck: 지금 내용 재검사 직후, 임시 파일을 만들기 전에 부른다(끼어들기 순서 시험)
 * @typedef {{ fs?: Partial<FsLike>, afterCheck?: () => void }} WriteHooks
 */
/** @typedef {{ openSync: typeof openSync, closeSync: typeof closeSync, writeSync: typeof writeSync, fsyncSync: typeof fsyncSync, chmodSync: typeof chmodSync, renameSync: typeof renameSync, unlinkSync: typeof unlinkSync, readFileSync: typeof readFileSync }} FsLike */
/** @type {Readonly<FsLike>} */
const FS = Object.freeze({ openSync, closeSync, writeSync, fsyncSync, chmodSync, renameSync, unlinkSync, readFileSync });

/**
 * 파일을 통째로 바꾼다 — 같은 폴더의 임시 파일에 쓰고 fsync 한 뒤 옮긴다(쓰다 끊겨도 반쪽 파일이 남지 않는다).
 * 심볼릭 링크면 링크를 두고 대상 파일을 바꾼다 · 있던 파일의 권한을 그대로 둔다 · 실패하면 이번 호출이 만든 임시 파일만 지운다.
 * 잠금: 지금 내용 확인부터 옮기기까지 `<대상>.lock` 을 배타적으로(O_EXCL) 만들어 쥐고 끝나면 지운다 — 두 명령이 같은 원본을 읽고
 * 함께 저장해도 뒤의 것은 「잠겨 있다」로 멈춘다. 잠금이 이미 있으면 기다리지 않고 PlanError(2). 오래된 잠금(명령이 죽어 남은 것)은
 * 저절로 지우지 않는다 — 살아 있는 명령의 잠금과 구별할 수 없으므로, 도는 명령이 없음을 확인한 사람이 지운다(문장이 그 경로를 알린다).
 * 잠금을 만든 순간부터 「쥐었다」로 치고, 그 뒤의 실패(잠금 닫기 포함)에도 잠금을 지운다. 저장은 됐는데 잠금을 못 지우면
 * PlanError(2) — 저장됐다는 것과 지울 잠금 경로를 함께 알린다(그대로 두면 다음 저장이 전부 exit 2 다)
 * expect: 문자열이면 지금 파일 내용의 해시가 그것이어야 한다 · null 이면 파일이 없어야 한다 · undefined 면 보지 않는다
 * @param {string} path @param {unknown} doc @param {string | null} [expect] @param {WriteHooks} [hooks]
 */
export function writeJson(path, doc, expect, hooks) {
  /** @type {FsLike} */
  const fs = { ...FS, ...hooks?.fs };
  let target = path;
  /** @type {number | undefined} */
  let mode;
  try {
    if (lstatSync(path).isSymbolicLink()) target = realpathSync(path);
    mode = statSync(target).mode & 0o7777;
  } catch (e) {
    if (!isMissing(e)) throw new PlanError(`Cannot write ${path}: ${errMessage(e)}`);
  }
  const lock = lockPathFor(target);
  let lockFd;
  try {
    lockFd = fs.openSync(lock, 'wx', 0o600);
  } catch (e) {
    if (isRecord(e) && e.code === 'EEXIST') {
      throw new PlanError(`Not written: ${path} is locked by another cloudonym command (${lock}). Run the command again when it has finished; if no cloudonym command is running, the lock was left by one that stopped — delete ${lock} and run again.`);
    }
    throw new PlanError(`Cannot write ${path}: cannot create the lock ${lock}: ${errMessage(e)}`);
  }
  // 여기서부터 잠금은 이번 호출의 것이다 — 아래 어디서 실패해도 잠금을 지운 뒤에 그 오류를 던진다
  try {
    try {
      fs.closeSync(lockFd);
    } catch (e) {
      throw new PlanError(`Cannot write ${path}: cannot close the lock ${lock}: ${errMessage(e)}`);
    }
    replaceLocked(path, target, mode, doc, expect, fs, hooks?.afterCheck);
  } catch (e) {
    // 저장 전 실패 — 원래 오류를 던진다. 잠금도 못 지웠으면 그 경로를 덧붙인다(원래 오류를 덮지 않는다)
    try {
      fs.unlinkSync(lock);
    } catch (u) {
      if (e instanceof PlanError && !isMissing(u)) throw new PlanError(`${e.message} The lock ${lock} could not be removed either (${errMessage(u)}): delete it before the next cloudonym command.`);
    }
    throw e;
  }
  // 저장은 됐다 — 잠금을 못 지우면 알린다(이미 없으면 지울 것도 없다)
  try {
    fs.unlinkSync(lock);
  } catch (e) {
    if (!isMissing(e)) throw new PlanError(`${path} is written, but its lock ${lock} could not be removed: ${errMessage(e)}. Delete ${lock} before the next cloudonym command; until then every save of ${path} stops with exit 2.`);
  }
}

/**
 * 잠금을 쥔 채 — 지금 내용을 대어 보고 임시 파일을 써서 옮긴다
 * @param {string} path @param {string} target @param {number | undefined} mode @param {unknown} doc @param {string | null | undefined} expect
 * @param {FsLike} io @param {(() => void) | undefined} afterCheck
 */
function replaceLocked(path, target, mode, doc, expect, io, afterCheck) {
  if (expect !== undefined) {
    /** @type {string | null} */
    let now = null;
    try {
      now = digestOf(io.readFileSync(target, 'utf-8'));
    } catch (e) {
      if (!isMissing(e)) throw new PlanError(`Cannot write ${path}: ${errMessage(e)}`);
    }
    if (now !== expect) throw new PlanError(`Not written: ${path} changed since it was read (another program or session wrote it). Run the command again.`);
  }
  afterCheck?.();
  const tmp = `${target}.tmp-${process.pid}`;
  // 이번 호출이 만든 임시 파일만 지운다 — 배타적 열기가 EEXIST 로 실패했으면 그 파일은 남의 것이다
  let created = false;
  let moved = false;
  try {
    const fd = io.openSync(tmp, 'wx', mode ?? 0o666);
    created = true;
    try {
      io.writeSync(fd, planText(doc));
      io.fsyncSync(fd);
    } finally {
      io.closeSync(fd);
    }
    // umask 가 깎은 권한을 되돌린다 — 있던 파일과 같게
    if (mode !== undefined) io.chmodSync(tmp, mode);
    io.renameSync(tmp, target);
    moved = true;
    // 옮긴 것(디렉터리 항목)도 디스크에 — 지원하지 않는 파일 시스템이면 넘어간다
    try {
      const dfd = io.openSync(dirname(target), 'r');
      try { io.fsyncSync(dfd); } finally { io.closeSync(dfd); }
    } catch {
      // 디렉터리 fsync 는 최선만 한다
    }
  } catch (e) {
    throw new PlanError(`Cannot write ${path}: ${errMessage(e)}`);
  } finally {
    if (created && !moved) {
      try { io.unlinkSync(tmp); } catch { /* 이미 없으면 지울 것도 없다 */ }
    }
  }
}

/** 목록 칸 — 없으면 빈 목록(API 의 schemas.ts listOf 와 같다) · 배열이 아니면 PlanError @param {unknown} v @param {string} field @returns {unknown[]} */
function listField(v, field) {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new PlanError(`The plan file is not valid: '${field}' must be an array. Fix it before adding.`);
  return v;
}

/**
 * 편집할 목록 — project_picks · services · 서비스마다 picks 를 API 파서와 같은 규칙으로 편다: 생략은 빈 목록,
 * 배열이 아닌 목록 · 객체가 아닌 서비스 · pick · 배열이 아닌 instances 는 고치기 전에 PlanError(2)
 * @param {PlanFile} plan
 * @returns {{ project_picks: Pick[], services: { purpose: string, picks: Pick[] }[] }}
 */
export function planLists(plan) {
  /** @param {unknown} p @param {string} at @returns {Pick} */
  const pickOf = (p, at) => {
    if (!isRecord(p)) throw new PlanError(`The plan file is not valid: '${at}' must be an object. Fix it before adding.`);
    if (p.instances !== undefined && (!Array.isArray(p.instances) || !p.instances.every(isRecord))) throw new PlanError(`The plan file is not valid: '${at}.instances' must be an array of objects. Fix it before adding.`);
    return /** @type {Pick} */ (/** @type {unknown} */ (p));
  };
  const project_picks = listField(plan.project_picks, 'project_picks').map((p, j) => pickOf(p, `project_picks[${j}]`));
  const services = listField(plan.services, 'services').map((s, i) => {
    if (!isRecord(s)) throw new PlanError(`The plan file is not valid: 'services[${i}]' must be an object. Fix it before adding.`);
    return { ...s, purpose: /** @type {string} */ (s.purpose), picks: listField(s.picks, `services[${i}].picks`).map((p, j) => pickOf(p, `services[${i}].picks[${j}]`)) };
  });
  return { project_picks, services };
}

/**
 * 계산할 환경 — environments 가 있으면 project.env 를 첫째로 합친 중복 없는 목록, 없으면 project.env 하나 (D82).
 * only 를 주면 그 하나만(목록에 없으면 PlanError)
 * @param {PlanFile} plan @param {string} [only]
 * @returns {string[]}
 */
export function environmentsOf(plan, only) {
  const list = [plan.project.env];
  if (Array.isArray(plan.environments)) for (const e of plan.environments) if (typeof e === 'string' && !list.includes(e)) list.push(e);
  if (only === undefined) return list;
  if (!list.includes(only)) throw new PlanError(`Environment ${only} is not in the plan (${list.join(', ')}).`);
  return [only];
}

/**
 * 환경 하나의 요청 본문 — environments 를 떼고 project.env 만 바꾼다. 압축 직렬화는 보내는 쪽이 한다
 * @param {PlanFile} plan @param {string} env
 * @returns {Record<string, unknown>}
 */
export function bodyFor(plan, env) {
  const { environments: _e, ...body } = plan;
  return { ...body, project: { ...plan.project, env } };
}

const SEQ = /^(0[1-9]|[1-9][0-9])$/;
const MAX_SEQ = 99;

/**
 * 다음 빈 번호 — 쓴 번호 중 가장 큰 것 + 1. 99 를 쓰고 있으면 비어 있는 가장 작은 번호. 다 찼으면 undefined.
 * 화면의 nextSeq(src/components/wizardState.ts)와 같은 답을 내는지 cli/fixtures/next-seq.json 으로 양쪽 시험이 센다 — 이름 규칙이 아니라 계획 편집 규칙이다
 * @param {readonly string[]} used
 * @returns {string | undefined}
 */
export function nextSeq(used) {
  const nums = used.filter((s) => SEQ.test(s)).map(Number);
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  if (max < MAX_SEQ) return String(max + 1).padStart(2, '0');
  for (let i = 1; i <= MAX_SEQ; i++) {
    const s = String(i).padStart(2, '0');
    if (!used.includes(s)) return s;
  }
  return undefined;
}

/**
 * 다음 슬롯 id — pick 안에서 쓰지 않은 가장 작은 36진 수(`1` … `9` · `a` …)
 * @param {readonly string[]} used
 * @returns {string}
 */
export function nextSlotId(used) {
  for (let i = 1; ; i++) {
    const id = i.toString(36);
    if (!used.includes(id) && /^[a-z0-9]{1,8}$/.test(id)) return id;
  }
}

/**
 * 슬롯 n 개를 끝에 덧붙인 새 배열 — 기존 슬롯은 그대로(같은 객체)다
 * @param {readonly Slot[]} slots @param {number} n
 * @returns {Slot[]}
 */
export function appendSlots(slots, n) {
  const out = [...slots];
  for (let i = 0; i < n; i++) {
    const seq = nextSeq(out.map((s) => s.seq));
    if (seq === undefined) throw new PlanError('No free sequence number is left in this pick (01–99 are all used).');
    out.push({ id: nextSlotId(out.map((s) => s.id)), seq });
  }
  return out;
}

/** 이름 보관 파일의 자리 — `x.json` → `x.names.json`, 아니면 뒤에 `.names.json`
 * @param {string} planPath */
export function namesPathFor(planPath) {
  return planPath.endsWith('.json') ? `${planPath.slice(0, -'.json'.length)}.names.json` : `${planPath}.names.json`;
}

/**
 * 이름 보관 파일 — 없으면 doc 이 undefined · digest 가 null. 있는데 못 읽거나 꼴이 틀리면 PlanError(2):
 * 조용히 없는 것으로 치면 validate 가 비교를 건너뛰고 names 가 덮어쓴다
 * @param {string} path @param {string} shown 문장에 쓰는 이름
 * @returns {{ doc: any, digest: string | null }}
 */
export function readNamesFile(path, shown = path) {
  let text;
  try {
    text = readFileSync(path, 'utf-8');
  } catch (e) {
    if (isMissing(e)) return { doc: undefined, digest: null };
    throw new PlanError(`Cannot read the names file ${shown}: ${errMessage(e)}`);
  }
  /** @type {unknown} */
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    doc = undefined;
  }
  if (!isRecord(doc) || !isRecord(doc.environments)) {
    throw new PlanError(`The names file ${shown} is not a names file (JSON with an "environments" object). Move or delete it, then run "cloudonym names" to write it again.`);
  }
  return { doc, digest: digestOf(text) };
}

const KST = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/**
 * KST 타임스탬프 `2026-10-14T21:05:00+09:00` — 부분값으로 조립한다(서버 telemetry.ts 의 kstStamp 와 같은 꼴). UTC 의 toISOString 은 쓰지 않는다
 * @param {Date} now
 */
export function kstTime(now) {
  const parts = KST.formatToParts(now);
  /** @param {Intl.DateTimeFormatPartTypes} type */
  const get = (type) => {
    const v = parts.find((p) => p.type === type)?.value;
    if (!v) throw new Error(`KST time has no ${type} part`);
    return v;
  };
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}+09:00`;
}
