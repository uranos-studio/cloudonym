// @ts-check
// cloudonym CLI (D102 · D121) — 엔진을 들이지 않고 API 만 부른다: 웹 · API · CLI 가 같은 규칙 버전에서 같은 이름을 낸다. 서버는 server.mjs 가 고른다(기본은 공개 배포).
// 명령: init · add · names · validate. 물을 것 · 풀 것(프리셋 · 규칙 · 입력 종류 · 상한)은 /catalog.json(D101)에서 읽는다 — 규칙을 여기 복제하지 않는다.
// 경계: cli/ 의 import 는 node: 와 cli/ 안뿐이다(cli/boundary.test.mjs)
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, USER_AGENT, CLI_VERSION, MAX_TIMEOUT_MS, MAX_WAIT_SECONDS } from './http.mjs';
import { serverOf, configPathOf } from './server.mjs';
import {
  PlanError, readPlan, writeJson, environmentsOf, bodyFor, appendSlots, namesPathFor, readNamesFile, kstTime, isRecord, nextSeq, nextSlotId, planLists,
} from './plan.mjs';
import { nameTable, nameTsv, tsvHead } from './table.mjs';
import { guideNew, guideAdd } from './guide.mjs';
import { closest } from './suggest.mjs';
import { completionScript, SHELLS } from './completion.mjs';
import { menuOrder } from './menu.mjs';

export { nextSeq, nextSlotId, USER_AGENT, CLI_VERSION };

/**
 * 종료 코드 — 0 성공 · 1 이름이 FAIL 이거나 add 가 기존 이름 · 판정을 바꾼다 · 2 계획 · 보관 파일 · 인자 거부(400 · 413), 파일을 못 읽거나 못 씀, 읽은 뒤 바뀜 ·
 * 3 규칙 버전 불일치(409) · 4 못 닿음 · 429 · 5xx · 해석할 수 없는 응답 · 64 사용법 · 70 내부 오류.
 * 이 표는 USAGE · README(영어 · 한국어) · D102 와 같아야 한다 — cli/main.test.mjs 가 넷을 대어 본다
 */
export const EXIT = { OK: 0, FAIL: 1, INPUT: 2, VERSION: 3, UNAVAILABLE: 4, USAGE: 64, INTERNAL: 70 };

/** @typedef {import('./http.mjs').FetchFn} FetchFn */
/** @typedef {import('./http.mjs').ApiResult} ApiResult */
/** @typedef {import('./plan.mjs').PlanFile} PlanFile */
/** @typedef {import('./plan.mjs').Pick} Pick */
/**
 * configPath: 설정 파일 자리(null 이면 읽지 않는다) — 주지 않으면 env 의 XDG_CONFIG_HOME · HOME · APPDATA 로 찾는다(server.mjs configPathOf).
 * tty: stdin · stdout 이 터미널인가 — 기본은 둘 다 아니다(묻지 않고 표 대신 줄). 진입점(cloudonym.mjs)만 실제 값을 넘긴다.
 * stdin · write: 묻는 흐름의 입력과 줄바꿈 없는 출력(물음). 시험은 스트림을 넣어 터미널 없이 흐름을 돌린다
 * @typedef {{ fetchFn: FetchFn, env: Record<string, string | undefined>, stdout: (s: string) => void, stderr: (s: string) => void, cwd: string, sleep: (ms: number) => Promise<void>, now: () => Date, configPath: string | null, tty: { stdin: boolean, stdout: boolean }, stdin: NodeJS.ReadableStream, write: (s: string) => void }} Deps
 */

export const DEFAULT_FILE = 'cloudonym.plan.json';

const USAGE = `Usage: cloudonym [command] [options]

On a terminal, cloudonym with no command asks what you are building, then saves the plan and its names
(if ${DEFAULT_FILE} is already there, it shows the names). Scripts and agents use the commands below.

Commands
  new       [--force]                                                   asks the questions (terminal only), saves the plan and names files
  init      --owner O --system S --env E[,E2…] --region R [--suffix X]   new plan file (rules_version from the server)
            [--provider P]                                              P is gcp (default), aws or azure; one plan file is one provider
  init      --from <plan.json>                                          copy a plan saved from the web (Save plan); also new --from
  add       <preset | rule id | resource> (--service <purpose> | --project)
            [--count N] [--kind K] [--tier T] [--role R] [--ha] [--serverless <rule>] [--location L] [--pick '<json>'] [--dry-run]
            appends a pick (or numbered servers to the same pick); writes the file only if every existing name and verdict stays the same
  add       (no arguments, on a terminal)                               asks what to add, then checks and writes the same way
  names     [--new] [--repin] [--no-write]                              names for every environment of the plan
  validate                                                              0 when every name is valid and matches the names file
  completion <bash|zsh|fish>                                            prints a shell completion script, e.g. source <(cloudonym completion zsh)

Options
  -f, --file <plan>    plan file (default ${DEFAULT_FILE}); names are kept next to it in <plan>.names.json
  --server <origin>    the Cloudonym deployment to call; else CLOUDONYM_SERVER, else "server" in the config file
                       (~/.config/cloudonym/config.json), else the public deployment. --version shows which
  --env <e>            one environment of the plan only
  -o, --output <fmt>   table (people), json or tsv (scripts; header, then env, what, name, check — and key with --keys).
                       Default: table on a terminal, else name  key lines. json and tsv never ask
  --json               the same as --output json
  --no-input           never ask (also CLOUDONYM_NO_INPUT=1); where a question would be needed, exit 64 and name the flags to pass
  --provider <p>       init and new: the cloud of the new plan (gcp, aws or azure); later commands read it from the plan file
  --keys               on a terminal, show each name's key in the table
  --wait               on 429, wait Retry-After (at most ${MAX_WAIT_SECONDS} s) and retry; once per command
  --timeout <ms>       per request (default 15000, at most ${MAX_TIMEOUT_MS})
  --no-write           names: write neither the plan nor the names file (with --repin, rules_version is not updated)

add checks every environment of the plan; --env only narrows what it prints.
Saving holds <plan>.lock (next to the file) from the last check to the replace; while it exists another command does not write (exit 2).
If no cloudonym command is running, a left-over lock is from one that stopped: delete it. If the file is saved but its lock cannot be removed, the command says so, names the lock and exits 2.

Exit codes: 0 ok · 1 a name FAILs or add would change existing names or verdicts · 2 plan, names file or arguments rejected (400, 413), a file cannot be read or written, it changed while the command ran, or its lock could not be removed after saving · 3 rules_version differs (409) · 4 server unreachable, 429, 5xx or an answer that cannot be interpreted · 64 usage · 70 internal error`;

const OPTIONS = /** @type {const} */ ({
  file: { type: 'string', short: 'f' }, server: { type: 'string' }, env: { type: 'string' }, json: { type: 'boolean' }, wait: { type: 'boolean' },
  timeout: { type: 'string' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' },
  owner: { type: 'string' }, system: { type: 'string' }, region: { type: 'string' }, suffix: { type: 'string' }, from: { type: 'string' }, force: { type: 'boolean' },
  service: { type: 'string' }, project: { type: 'boolean' }, count: { type: 'string' }, kind: { type: 'string' }, tier: { type: 'string' }, role: { type: 'string' },
  ha: { type: 'boolean' }, serverless: { type: 'string' }, location: { type: 'string' }, pick: { type: 'string' }, 'dry-run': { type: 'boolean' },
  new: { type: 'boolean' }, repin: { type: 'boolean' }, 'no-write': { type: 'boolean' }, keys: { type: 'boolean' },
  output: { type: 'string', short: 'o' }, 'no-input': { type: 'boolean' }, provider: { type: 'string' },
});

/** 명령 표 — 오타 제안 · 셸 완성이 이것을 쓴다 */
export const COMMANDS = /** @type {const} */ (['new', 'init', 'add', 'names', 'validate', 'completion', 'help']);
/** --output 이 받는 값 */
export const OUTPUTS = /** @type {const} */ (['table', 'json', 'tsv']);
/** --provider 가 받는 값 — 계획 파일 최상위 provider 와 같다. 켜졌는지는 서버가 정한다(400 request.provider_not_enabled) */
export const PROVIDERS = /** @type {const} */ (['gcp', 'aws', 'azure']);

/** 사용법 오류 — 종료 코드 64. short 면 사용법 전체 대신 --help 를 가리키는 한 줄만 덧붙인다 */
export class UsageError extends Error {
  /** @param {string} message @param {{ short?: boolean }} [o] */
  constructor(message, o = {}) { super(message); this.short = o.short === true; }
}

/**
 * @param {string[]} argv
 * @param {Partial<Deps>} [given]
 * @returns {Promise<number>}
 */
export async function main(argv, given = {}) {
  /** @type {Deps} */
  const d = {
    fetchFn: given.fetchFn ?? /** @type {FetchFn} */ (/** @type {unknown} */ (globalThis.fetch)),
    env: given.env ?? process.env,
    stdout: given.stdout ?? ((s) => { process.stdout.write(`${s}\n`); }),
    stderr: given.stderr ?? ((s) => { process.stderr.write(`${s}\n`); }),
    cwd: given.cwd ?? process.cwd(),
    sleep: given.sleep ?? ((ms) => new Promise((r) => { setTimeout(r, ms); })),
    now: given.now ?? (() => new Date()),
    configPath: given.configPath === undefined ? configPathOf(given.env ?? process.env) : given.configPath,
    tty: given.tty ?? { stdin: false, stdout: false },
    stdin: given.stdin ?? process.stdin,
    write: given.write ?? ((s) => { process.stdout.write(s); }),
  };
  try {
    let parsed;
    try {
      parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 모르는 플래그 — 가까운 플래그를 제안한다
      const bad = /Unknown option '(-{1,2})([^']+)'/.exec(msg);
      // 짧은 플래그(-H)는 짧은 플래그 표에서(대소문자만 다르면 그것), 긴 플래그는 긴 이름에서 찾는다
      const shortOf = (/** @type {string} */ x) => Object.values(OPTIONS).map((o) => /** @type {{ short?: string }} */ (o).short).find((c) => c !== undefined && c.toLowerCase() === x.toLowerCase());
      const near = !bad ? [] : bad[1] === '-' ? (shortOf(/** @type {string} */ (bad[2])) ? [`-${shortOf(/** @type {string} */ (bad[2]))}`] : [])
        : closest(/** @type {string} */ (bad[2]), Object.keys(OPTIONS)).slice(0, 2).map((k) => `--${k}`);
      throw new UsageError(bad && near.length > 0 ? `Unknown option '${bad[1]}${bad[2]}'. Did you mean ${near.join(' or ')}?` : msg, { short: bad !== null });
    }
    const { values: v, positionals } = parsed;
    if (v.version) {
      // stdout 은 한 줄 그대로(파이프로 받는 스크립트가 안 깨진다) — 부를 서버와 출처는 stderr 에 (D121)
      d.stdout(USER_AGENT);
      const picked = serverOf(v.server, d.env, { configPath: d.configPath });
      if ('error' in picked) d.stderr(`server: not usable — ${picked.error}`);
      else { for (const w of picked.warnings) d.stderr(w); d.stderr(`server ${picked.server} (${picked.source})`); }
      return EXIT.OK;
    }
    const [cmd, ...rest] = positionals;
    const ctx = new Ctx(d, v);
    // --no-input 인데 명령 없이 — 계획이 있으면 이름을 보이고(묻지 않는다), 없으면 물을 수 없으니 무엇을 넘길지 알리고 64
    if (cmd === undefined && !v.help && ctx.noInput()) {
      if (existsSync(ctx.file)) return await names(ctx, []);
      throw new UsageError(`Nothing is asked with --no-input (or CLOUDONYM_NO_INPUT). Make a plan with: cloudonym init --owner O --system S --env E --region R [--provider P], then cloudonym add <preset> --service <purpose>; with a plan, cloudonym names.`, { short: true });
    }
    // 터미널에서 명령 없이 — 계획이 없으면 묻고, 있으면 이름 표를 보인다. 파이프 · CI 에서는 지금처럼 사용법과 64 (D121)
    if (cmd === undefined && !v.help && ctx.canAsk()) {
      if (!existsSync(ctx.file)) return await guideNew(ctx);
      const code = await names(ctx, []);
      if (code === EXIT.OK || code === EXIT.FAIL) d.stdout(`\nAdd more: ${ctx.command('add')} · Check before applying: ${ctx.command('validate')}`);
      return code;
    }
    if (v.help || cmd === undefined || cmd === 'help') { d.stdout(USAGE); return cmd === undefined && !v.help ? EXIT.USAGE : EXIT.OK; }
    switch (cmd) {
      case 'new': return await newPlan(ctx, rest);
      case 'init': return await init(ctx, rest);
      case 'add': return await add(ctx, rest);
      case 'names': return await names(ctx, rest);
      case 'validate': return await validate(ctx, rest);
      case 'completion': return completion(ctx, rest);
      default: {
        const near = closest(cmd, COMMANDS);
        throw new UsageError(`Unknown command: ${cmd}.${near.length > 0 ? ` Did you mean ${near.slice(0, 2).join(' or ')}?` : ''}`, { short: true });
      }
    }
  } catch (e) {
    if (e instanceof UsageError) { d.stderr(e.short ? `${e.message}\nRun "cloudonym --help" for the commands and options.` : `${e.message}\n\n${USAGE}`); return EXIT.USAGE; }
    if (e instanceof PlanError) { d.stderr(e.message); return EXIT.INPUT; }
    // 뜻밖의 예외 — 스택 대신 한 줄 · 「이름 FAIL」(1)과 겹치지 않는 코드
    try { d.stderr(`Internal error: ${e instanceof Error ? e.message : String(e)}`); } catch { /* stderr 도 닫혔으면 코드만 */ }
    return EXIT.INTERNAL;
  }
}

/** @typedef {ReturnType<typeof parseArgs<{ options: typeof OPTIONS, allowPositionals: true, strict: true }>>['values']} Values */

export class Ctx {
  /** @param {Deps} d @param {Values} v */
  constructor(d, v) {
    this.d = d;
    this.v = v;
    this.file = resolve(d.cwd, v.file ?? DEFAULT_FILE);
    /** 문장에 쓰는 이름 — 받은 그대로(절대 경로로 바꾸지 않는다) */
    this.shown = v.file ?? DEFAULT_FILE;
    /** /catalog.json 의 providers.<provider> — 표의 What 칸을 찾을 때. 읽지 않았으면 undefined @type {any} */
    this.cat = undefined;
    /** @type {string | undefined} */
    this.server = undefined;
    if (v.output !== undefined && !OUTPUTS.includes(/** @type {any} */ (v.output))) throw new UsageError(`--output must be ${OUTPUTS.join(', ')}: ${v.output}`);
    if (v.json && v.output !== undefined && v.output !== 'json') throw new UsageError(`--json is --output json; it cannot be used with --output ${v.output}.`);
    /** 출력 꼴 — 'auto' 는 터미널이면 표, 아니면 「이름  키」 줄 @type {'auto' | 'table' | 'json' | 'tsv'} */
    this.format = v.json ? 'json' : /** @type {'table' | 'json' | 'tsv' | undefined} */ (v.output) ?? 'auto';
  }

  /** 묻지 말라는 스위치 — --no-input 또는 CLOUDONYM_NO_INPUT(빈 값 · 0 · false 가 아니면 켜짐) */
  noInput() {
    const e = String(this.d.env.CLOUDONYM_NO_INPUT ?? '').trim().toLowerCase();
    return this.v['no-input'] === true || (e !== '' && e !== '0' && e !== 'false' && e !== 'no');
  }

  /** 물어도 되는가 — stdin · stdout 이 둘 다 터미널이고, 기계 출력(json · tsv)이 아니고, --no-input 이 아닐 때만 (설계 §5 원칙 ②) */
  canAsk() {
    return this.d.tty.stdin && this.d.tty.stdout && this.format !== 'json' && this.format !== 'tsv' && !this.noInput();
  }

  /** 사람 표로 보이는가 — --output table 이거나, 따로 정하지 않았고 stdout 이 터미널일 때. 파이프로 받는 출력은 지금 꼴 그대로 (설계 §6) */
  table() {
    return this.format === 'table' || (this.format === 'auto' && this.d.tty.stdout);
  }

  /** --output json(--json) */
  json() { return this.format === 'json'; }

  /** --output tsv */
  tsv() { return this.format === 'tsv'; }

  /** 다음 할 일에 적는 명령 — -f 를 받았으면 그것도 @param {string} cmd */
  command(cmd) {
    return `cloudonym ${cmd}${this.v.file === undefined ? '' : ` -f ${this.v.file}`}`;
  }

  /** 서버 클라이언트 — 고른 서버를 쓸 수 없으면 사용법 오류(64). 설정 파일을 건너뛰었으면 그 까닭을 stderr 에 */
  client() {
    const picked = serverOf(this.v.server, this.d.env, { configPath: this.d.configPath });
    if ('error' in picked) throw new UsageError(picked.error);
    for (const w of picked.warnings) this.d.stderr(w);
    const timeout = this.v.timeout === undefined ? 15000 : Number(this.v.timeout);
    if (!Number.isInteger(timeout) || timeout <= 0 || timeout > MAX_TIMEOUT_MS) throw new UsageError(`--timeout must be 1–${MAX_TIMEOUT_MS} milliseconds: ${this.v.timeout}`);
    this.server = picked.server;
    return createClient({ server: picked.server, fetchFn: this.d.fetchFn, timeoutMs: timeout, wait: this.v.wait === true, sleep: this.d.sleep, log: this.d.stderr, now: this.d.now });
  }

  /** 실패한 응답을 한 덩어리 문장과 종료 코드로 @param {ApiResult} r @param {string} [label] @returns {number} */
  report(r, label) {
    const at = label ? `[${label}] ` : '';
    const say = (/** @type {string} */ s) => this.d.stderr(`${at}${s}`);
    if (r.kind === 'ok') return EXIT.OK;
    if (r.kind === 'unreachable') { say(`Cannot reach ${this.server}: ${r.message}`); return EXIT.UNAVAILABLE; }
    if (r.kind === 'malformed') { say(`Cannot interpret the server's answer (${r.status}): ${r.message}. Is ${this.server} a Cloudonym deployment?`); return EXIT.UNAVAILABLE; }
    const errors = Array.isArray(r.body?.errors) ? r.body.errors : [];
    if (r.status === 429) {
      say(`Rate limited (429): the server allows a limited number of requests per IP. Retry after ${r.retryAfter ?? 60} s${this.v.wait ? '' : ' (--wait waits once and retries)'}.`);
      return EXIT.UNAVAILABLE;
    }
    if (r.status === 409 && errors[0]?.code === 'request.rules_version_mismatch') {
      const p = errors[0].params ?? {};
      say(`The plan was made with rules ${p.requested}; the server's rules are ${p.current}. Names may differ. Run "cloudonym names --repin" to see what changes and update rules_version in the plan file.`);
      return EXIT.VERSION;
    }
    // 다시 보내도 같다 — 계획이 상한보다 크다(2)
    if (r.status === 413) { say(`Request body too large (413): at most ${errors[0]?.params?.max_bytes ?? '?'} bytes. Split the plan.`); return EXIT.INPUT; }
    if (r.status === 400 && errors[0]?.code === 'request.provider_not_enabled') {
      say(notEnabled(errors[0].params?.provider, r.body?.supported));
      return EXIT.INPUT;
    }
    if (r.status === 400) {
      say('The server rejected the plan (400):');
      for (const e of errors) say(`  ${e.field ? `${e.field}: ` : ''}${e.message ?? e.code}`);
      if (errors.some((/** @type {any} */ e) => e.code === 'wizard.duplicate_pick')) {
        say('  Two picks would get the same names: the server counts the resource type, the kind token, the tier and the role (location, HA and server numbers do not make a separate pick). Give the new one its own --tier, or add servers to the existing pick.');
      }
      if (Array.isArray(r.body?.supported)) say(`  supported: ${r.body.supported.join(', ')}`);
      return EXIT.INPUT;
    }
    say(`The server answered ${r.status}${errors[0] ? `: ${errors[0].message ?? errors[0].code}` : ''}.`);
    return EXIT.UNAVAILABLE;
  }
}

/**
 * 켜지지 않은 provider 한 줄 — 400 request.provider_not_enabled 의 supported, 또는 /catalog.json 의 providers 키
 * @param {unknown} provider @param {unknown} supported
 */
export function notEnabled(provider, supported) {
  const list = Array.isArray(supported) && supported.length > 0 ? supported.join(', ') : undefined;
  return `${String(provider)} is not enabled on this server yet${list ? ` (this server supports ${list})` : ''}. One plan file is one provider: make a plan with --provider ${list ? (/** @type {string[]} */ (supported))[0] : 'gcp'}.`;
}

// ── 응답 → 이름 목록 (웹 JSON 내보내기 wizardExport.ts 의 names · invalid 와 같은 칸) ──

/** @param {any} it */
export function exportName(it) {
  /** @type {Record<string, unknown>} */
  const out = { key: it.key, namespace: it.namespace ?? '', resource_type: it.resource_type };
  for (const k of ['level', 'tier', 'seq', 'role', 'kind', 'parent', 'attach']) if (it[k] !== undefined) out[k] = it[k];
  out.name = it.name;
  return out;
}

/**
 * POST /v1/wizard 의 2xx 본문에서 data.<provider> 를 꺼낸다 — items 가 { key, name, valid } 의 비지 않은 배열이 아니면 undefined.
 * 비지 않음: 응답은 늘 프로젝트 ID 항목으로 시작한다(README · llms.txt 의 응답 꼴). 빈 Map 을 「이름 0개 · 바뀐 것 없음」으로 읽으면 add 가 확인 없이 쓰고 validate 가 0 을 낸다
 * @param {any} body @param {string} provider
 * @returns {{ valid: boolean, items: any[] } | undefined}
 */
export function wizardData(body, provider) {
  const data = isRecord(body?.data) ? body.data[provider] : undefined;
  if (!isRecord(data) || !Array.isArray(data.items) || data.items.length === 0) return undefined;
  const items = /** @type {unknown[]} */ (data.items);
  if (!items.every((it) => isRecord(it) && typeof it.key === 'string' && typeof it.name === 'string' && typeof it.valid === 'boolean')) return undefined;
  return { valid: data.valid === true, items };
}

/**
 * 2xx 인데 data.<provider>.items 꼴이 아니면 malformed 로 바꾼다 — 보고(report)가 exit 4 와 「해석할 수 없다」를 낸다
 * @param {ApiResult} r @param {string} provider @returns {ApiResult}
 */
export function checkWizard(r, provider) {
  if (r.kind !== 'ok' || wizardData(r.body, provider)) return r;
  return { kind: 'malformed', status: r.status, message: `no data.${provider}.items list of names in the body` };
}

/** 200 본문 하나 → { valid, names, invalid } — checkWizard 를 거친 본문만 @param {any} body @param {string} provider */
export function exportEnv(body, provider) {
  const data = wizardData(body, provider);
  const items = data?.items ?? [];
  return {
    valid: data?.valid === true,
    names: items.filter((/** @type {any} */ it) => it.valid).map(exportName),
    invalid: items.filter((/** @type {any} */ it) => !it.valid).map((/** @type {any} */ it) => ({
      key: it.key, name: it.name, codes: [...new Set((it.violations ?? []).map((/** @type {any} */ x) => x.code))],
      messages: (it.violations ?? []).map((/** @type {any} */ x) => x.message),
    })),
  };
}

/**
 * 키 → 이름 · 판정. codes 는 위반 코드(정렬) — FAIL 로 남아도 위반이 바뀌면(예: 새 name.conflict) 판정이 바뀐 것이다
 * @param {any} body @param {string} provider @returns {Map<string, { name: string, valid: boolean, codes: string, item: any }>}
 */
function itemsByKey(body, provider) {
  const items = wizardData(body, provider)?.items ?? [];
  return new Map(items.map((/** @type {any} */ it) => [it.key, {
    name: it.name, valid: it.valid === true, item: it,
    codes: [...new Set((Array.isArray(it.violations) ? it.violations : []).map((/** @type {any} */ x) => String(x?.code)))].sort().join(','),
  }]));
}

/** 종료 코드는 가장 큰 값 — 환경 하나가 실패해도 나머지를 다 보낸다 @param {number[]} codes */
export const worst = (codes) => codes.reduce((a, b) => Math.max(a, b), EXIT.OK);

/** 환경마다 POST /v1/wizard @param {ReturnType<Ctx['client']>} client @param {PlanFile} plan @param {string[]} envs */
async function sendAll(client, plan, envs) {
  /** @type {{ env: string, r: ApiResult }[]} */
  const out = [];
  for (const env of envs) out.push({ env, r: checkWizard(await client.post('/v1/wizard', bodyFor(plan, env)), plan.provider) });
  return out;
}

// ── new ──

/**
 * new — 터미널에서 묻는 흐름(guide.mjs). --from 이나 init 의 플래그를 받으면 init 과 같다. 터미널이 아니면 init 을 쓰라고 알리고 64
 * @param {Ctx} ctx @param {string[]} rest
 */
async function newPlan(ctx, rest) {
  const { v } = ctx;
  if (rest.length > 0) throw new UsageError(`new takes no positional arguments: ${rest.join(' ')}`);
  if (v.from !== undefined || ['owner', 'system', 'env', 'region'].some((k) => v[/** @type {'owner'} */ (k)] !== undefined)) return init(ctx, rest);
  if (!ctx.canAsk()) throw new UsageError('new asks questions, so it needs a terminal (and no --json, --output json|tsv or --no-input). In scripts use: cloudonym init --owner O --system S --env E --region R [--provider P], then cloudonym add <preset> --service <purpose>.', { short: true });
  return guideNew(ctx);
}

// ── init ──

/** @param {Ctx} ctx @param {string[]} rest */
async function init(ctx, rest) {
  const { v, d } = ctx;
  if (rest.length > 0) throw new UsageError(`init takes no positional arguments: ${rest.join(' ')}`);
  if (existsSync(ctx.file) && !v.force) { d.stderr(`${ctx.shown} already exists (pass --force to replace it).`); return EXIT.INPUT; }
  // --force 가 아니면 「없던 파일」을 쓴다 — 그 사이 누가 만들었으면 쓰지 않는다
  const expect = v.force ? undefined : null;
  if (v.from !== undefined) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v.from) || v.from.includes('#')) {
      throw new UsageError('--from takes a plan file, not a share link (links are not read yet). Open the link in the browser, press Save plan, then run: cloudonym new --from <the saved file>');
    }
    const { plan } = readPlan(resolve(d.cwd, v.from));
    // 계획 파일 하나 = provider 하나 — --provider 가 파일과 다르면 쓰지 않는다(파일의 provider 를 조용히 덮지도 버리지도 않는다)
    if (v.provider !== undefined && providerOf(v.provider) !== plan.provider) throw new UsageError(`--provider ${v.provider} does not match the provider of ${v.from} (${plan.provider}); one plan file is one provider.`);
    const envs = environmentsOf(plan);
    /** @type {PlanFile} */
    const out = { ...plan };
    delete out.environments;
    if (envs.length > 1) out.environments = envs;
    writeJson(ctx.file, out, expect);
    d.stderr(`Wrote ${ctx.shown}${plan.rules_version ? ` (rules ${plan.rules_version})` : ' (no rules_version: requests are not pinned)'}.`);
    printWritten(ctx, plan.provider, plan.rules_version, envs);
    return EXIT.OK;
  }
  const missing = ['owner', 'system', 'env', 'region'].filter((k) => v[/** @type {'owner'} */ (k)] === undefined);
  if (missing.length > 0) throw new UsageError(`init needs --${missing.join(', --')} (or --from <plan.json>).`);
  const provider = providerOf(v.provider);
  const envs = [...new Set(String(v.env).split(',').map((s) => s.trim()).filter((s) => s !== ''))];
  if (envs.length === 0) throw new UsageError('--env is empty.');
  const client = ctx.client();
  const r = await client.get('/v1/health');
  if (r.kind !== 'ok') return ctx.report(r);
  const rules = r.body?.version?.rules;
  if (typeof rules !== 'string') { d.stderr('The server did not say its rules version (GET /v1/health).'); return EXIT.UNAVAILABLE; }
  // --provider 를 받았으면 서버가 그 provider 를 켰는지 먼저 본다 — 켜지지 않은 계획 파일을 쓰고 나중 명령에서 막히지 않게(기본 gcp 는 묻지 않는다)
  if (v.provider !== undefined) {
    const c = await client.get('/catalog.json');
    if (c.kind !== 'ok') return ctx.report(c);
    const enabled = isRecord(c.body?.providers) ? Object.keys(c.body.providers) : [];
    if (!enabled.includes(provider)) { d.stderr(notEnabled(provider, enabled)); return EXIT.INPUT; }
  }
  /** @type {PlanFile} */
  const plan = {
    provider,
    project: { owner: String(v.owner), system: String(v.system), env: /** @type {string} */ (envs[0]), region: String(v.region) },
    ...(v.suffix === undefined ? {} : { project_id_suffix: v.suffix }),
    project_picks: [], services: [], rules_version: rules,
    ...(envs.length > 1 ? { environments: envs } : {}),
  };
  writeJson(ctx.file, plan, expect);
  d.stderr(`Wrote ${ctx.shown} (rules ${rules}). Add resources with "cloudonym add".`);
  printWritten(ctx, provider, rules, envs);
  return EXIT.OK;
}

/** init 이 쓴 계획의 요약 — -o json · tsv 일 때만 stdout 에 @param {Ctx} ctx @param {string} provider @param {string | undefined} rules @param {string[]} envs */
function printWritten(ctx, provider, rules, envs) {
  if (ctx.json()) ctx.d.stdout(JSON.stringify({ file: ctx.shown, provider, rules_version: rules ?? null, environments: envs }, null, 2));
  else if (ctx.tsv()) { ctx.d.stdout('file\tprovider\trules_version\tenvironments'); ctx.d.stdout([ctx.shown, provider, rules ?? '', envs.join(',')].join('\t')); }
}

/** --provider 값 — 없으면 gcp. 표에 없는 값은 64(가까운 값을 제안) @param {string | undefined} given @returns {string} */
export function providerOf(given) {
  if (given === undefined) return 'gcp';
  const p = given.toLowerCase();
  if (PROVIDERS.includes(/** @type {any} */ (p))) return p;
  const near = closest(p, PROVIDERS);
  throw new UsageError(`--provider must be ${PROVIDERS.join(', ')}: ${given}.${near.length > 0 ? ` Did you mean ${near[0]}?` : ''}`);
}

// ── names ──

/** @param {Ctx} ctx @param {string[]} rest */
async function names(ctx, rest) {
  const { v, d } = ctx;
  if (rest.length > 0) throw new UsageError(`names takes no positional arguments: ${rest.join(' ')}`);
  const read = readPlan(ctx.file);
  let plan = read.plan;
  const shownEnvs = environmentsOf(plan, v.env);
  // --repin 은 계획 전체의 rules_version 을 고치므로 --env 와 무관하게 모든 환경을 본다 (--env 는 출력만 거른다)
  const envs = v.repin ? environmentsOf(plan) : shownEnvs;
  const namesPath = namesPathFor(ctx.file);
  const { doc: stored, digest: storedDigest } = readNamesFile(namesPath, namesPathFor(ctx.shown));
  const client = ctx.client();
  // 표의 What 칸은 /catalog.json 에서 찾는다 — 못 읽으면 resource_type 으로 보인다(이름 · 판정은 그대로)
  if (ctx.table() || ctx.tsv()) { const c = await client.get('/catalog.json'); ctx.cat = c.kind === 'ok' ? c.body?.providers?.[plan.provider] : undefined; }
  let results = await sendAll(client, plan, envs);

  // --repin — 409 의 current 로 rules_version 을 고쳐 다시 보낸다. 보관 파일과 키마다 대어 바뀐 이름을 보인다 (D27: 핀은 호출자가 쥔다)
  const mismatch = results.find(({ r }) => r.kind === 'http' && r.status === 409);
  let repinned = false;
  if (v.repin && mismatch && mismatch.r.kind === 'http') {
    const current = mismatch.r.body?.errors?.[0]?.params?.current;
    if (typeof current !== 'string') return ctx.report(mismatch.r);
    plan = { ...plan, rules_version: current };
    results = await sendAll(client, plan, envs);
    repinned = true;
  }

  const codes = results.map(({ env, r }) => ctx.report(r, envs.length > 1 ? env : undefined));
  // 보관 이름은 모든 환경이 닿지 않을 때만 보인다 — 429 · 5xx · 413 · 해석할 수 없는 응답이면 보이지 않는다
  if (results.every(({ r }) => r.kind === 'unreachable') && stored) {
    d.stderr(`Showing the stored names from ${namesPathFor(ctx.shown)} (received ${stored.received_at}, rules ${stored.rules_version}); they are not fresh.`);
    if (ctx.table() || ctx.tsv()) {
      /** @type {Record<string, TableRow[]>} */
      const kept = {};
      for (const [env, e] of Object.entries(stored.environments)) kept[env] = [...(/** @type {any} */ (e).names ?? []).map((/** @type {any} */ item) => ({ item, valid: true })), ...(/** @type {any} */ (e).invalid ?? []).map((/** @type {any} */ item) => ({ item, valid: false, messages: item.messages }))];
      printTable(ctx, kept, shownEnvs, undefined, plan.provider);
    } else printNames(ctx, stored.environments, shownEnvs, undefined, undefined, plan.provider);
    return EXIT.UNAVAILABLE;
  }

  /** @type {Record<string, ReturnType<typeof exportEnv>>} */
  const fresh = {};
  /** 표 줄 — 서버가 낸 순서 그대로(PASS · FAIL 섞어서) @type {Record<string, TableRow[]>} */
  const rows = {};
  for (const { env, r } of results) if (r.kind === 'ok') { fresh[env] = exportEnv(r.body, plan.provider); rows[env] = tableRows(r.body, plan.provider); }
  const okCount = Object.keys(fresh).length;
  const version = results.find(({ r }) => r.kind === 'ok')?.r;
  const ver = version && version.kind === 'ok' ? version.body.version : undefined;

  if (repinned && stored) {
    for (const env of Object.keys(fresh)) {
      const before = new Map((stored.environments[env]?.names ?? []).map((/** @type {any} */ n) => [n.key, n.name]));
      const changed = /** @type {any[]} */ (fresh[env]?.names ?? []).filter((n) => before.has(n.key) && before.get(n.key) !== n.name);
      for (const n of changed) d.stderr(`[${env}] changed ${n.key}: ${before.get(n.key)} -> ${n.name}`);
      if (changed.length === 0) d.stderr(`[${env}] no stored name changes under rules ${plan.rules_version}.`);
    }
  }

  if (okCount > 0 && (ctx.table() || ctx.tsv())) printTable(ctx, rows, shownEnvs, v.new ? stored : undefined, plan.provider);
  else if (okCount > 0) printNames(ctx, fresh, shownEnvs, v.new ? stored : undefined, ver, plan.provider);
  const allOk = okCount === envs.length;
  // --no-write 는 두 파일 모두 막는다 — 계획의 rules_version 도 보관 파일도 쓰지 않는다
  if (allOk && repinned && v['no-write']) d.stderr(`Not written (--no-write): ${ctx.shown} keeps rules_version ${read.plan.rules_version}; the server has ${plan.rules_version}.`);
  if (allOk && repinned && !v['no-write']) { writeJson(ctx.file, plan, read.digest); d.stderr(`Updated rules_version in ${ctx.shown} to ${plan.rules_version}.`); }
  if (allOk && !v['no-write']) {
    const prev = stored && stored.rules_version === ver?.rules ? stored.environments : {};
    writeJson(namesPath, { received_at: kstTime(d.now()), rules_version: ver?.rules, environments: { ...prev, ...fresh } }, storedDigest);
  }
  const anyInvalid = Object.values(fresh).some((e) => !e.valid);
  return worst([...codes, anyInvalid ? EXIT.FAIL : EXIT.OK]);
}

/**
 * @param {Ctx} ctx @param {Record<string, any>} byEnv @param {string[]} envs @param {any} onlyNewAgainst 보관 파일 — 주면 거기 없는 키만
 * @param {any} version @param {string} provider 계획 파일의 provider
 */
function printNames(ctx, byEnv, envs, onlyNewAgainst, version, provider) {
  const { d } = ctx;
  /** @param {string} env @param {any[]} list */
  const filter = (env, list) => {
    if (!onlyNewAgainst) return list;
    const known = new Set((onlyNewAgainst.environments[env]?.names ?? []).map((/** @type {any} */ n) => n.key));
    return list.filter((n) => !known.has(n.key));
  };
  const shown = envs.filter((e) => byEnv[e] !== undefined);
  if (ctx.json()) {
    /** @type {Record<string, unknown>} */
    const environments = {};
    for (const env of shown) environments[env] = { valid: byEnv[env].valid, names: filter(env, byEnv[env].names), invalid: filter(env, byEnv[env].invalid ?? []) };
    d.stdout(JSON.stringify({ ...(version ? { version } : {}), provider, environments }, null, 2));
    return;
  }
  for (const env of shown) {
    if (shown.length > 1) d.stdout(`# ${env}`);
    for (const n of filter(env, byEnv[env].names)) d.stdout(`${n.name}  ${n.key}`);
    for (const n of filter(env, byEnv[env].invalid ?? [])) d.stdout(`FAIL ${n.key}  ${n.name ?? ''}  ${(n.codes ?? []).join(',')}`);
  }
}

/** scope · uniqueness: 응답 항목의 유일 범위(있을 때만) — 표의 Unique in 칸. 보관 파일 · --json 의 이름 칸(exportName)에는 넣지 않는다 @typedef {{ item: any, valid: boolean, messages?: string[], scope?: string, uniqueness?: string }} TableRow */

/** 응답 항목의 유일 범위 — 문자열일 때만 @param {any} it */
const scopeOf = (it) => ({ ...(typeof it.scope === 'string' ? { scope: it.scope } : {}), ...(typeof it.uniqueness === 'string' ? { uniqueness: it.uniqueness } : {}) });

/** 2xx 본문 → 표 줄(서버 순서) @param {any} body @param {string} provider @returns {TableRow[]} */
export function tableRows(body, provider) {
  return (wizardData(body, provider)?.items ?? []).map((/** @type {any} */ it) => ({
    item: exportName(it), valid: it.valid === true, messages: (Array.isArray(it.violations) ? it.violations : []).map((/** @type {any} */ x) => String(x?.message ?? x?.code)), ...scopeOf(it),
  }));
}

/**
 * 사람 표 — 환경이 여럿이면 환경 제목. onlyNewAgainst 를 주면 보관 파일에 없는 키만. --output tsv 면 머리 줄 하나 + 환경 칸이 붙은 줄
 * @param {Ctx} ctx @param {Record<string, TableRow[]>} byEnv @param {string[]} envs @param {any} onlyNewAgainst @param {string} provider 계획 파일의 provider
 */
export function printTable(ctx, byEnv, envs, onlyNewAgainst, provider) {
  const shown = envs.filter((e) => byEnv[e] !== undefined);
  if (ctx.tsv()) ctx.d.stdout(tsvHead(ctx.v.keys === true));
  shown.forEach((env, i) => {
    // 보관 파일이 아는 키 — names 와 invalid 둘 다(printNames 와 같다)
    const kept = onlyNewAgainst?.environments?.[env];
    const known = new Set(onlyNewAgainst ? [...(kept?.names ?? []), ...(kept?.invalid ?? [])].map((/** @type {any} */ n) => n.key) : []);
    const list = (byEnv[env] ?? []).filter((r) => !known.has(r.item.key));
    if (ctx.tsv()) { for (const line of nameTsv(env, list, ctx.cat, provider, ctx.v.keys === true)) ctx.d.stdout(line); return; }
    // --new 로 새 것이 없으면 머리만 있는 표를 내지 않는다
    if (onlyNewAgainst && list.length === 0) return;
    if (shown.length > 1) ctx.d.stdout(`${i > 0 ? '\n' : ''}# ${env}`);
    for (const line of nameTable(list, ctx.cat, provider, ctx.v.keys === true)) ctx.d.stdout(line);
  });
}

// ── validate ──

/** @param {Ctx} ctx @param {string[]} rest */
async function validate(ctx, rest) {
  const { v, d } = ctx;
  if (rest.length > 0) throw new UsageError(`validate takes no positional arguments: ${rest.join(' ')}`);
  const { plan } = readPlan(ctx.file);
  const envs = environmentsOf(plan, v.env);
  const stored = readNamesFile(namesPathFor(ctx.file), namesPathFor(ctx.shown)).doc;
  const client = ctx.client();
  const results = await sendAll(client, plan, envs);
  const codes = results.map(({ env, r }) => ctx.report(r, envs.length > 1 ? env : undefined));
  for (const { env, r } of results) {
    if (r.kind !== 'ok') continue;
    const items = itemsByKey(r.body, plan.provider);
    const bad = [...items.entries()].filter(([, it]) => !it.valid);
    for (const [key, it] of bad) d.stderr(`[${env}] FAIL ${key}  ${it.name}  ${(it.item.violations ?? []).map((/** @type {any} */ x) => x.message).join(' ')}`);
    const changed = (stored?.environments?.[env]?.names ?? []).filter((/** @type {any} */ n) => items.get(n.key)?.name !== n.name);
    for (const n of changed) d.stderr(`[${env}] differs from the names file: ${n.key}: ${n.name} -> ${items.get(n.key)?.name ?? '(no longer in the plan)'}`);
    if (bad.length > 0 || changed.length > 0) codes.push(EXIT.FAIL);
    else d.stdout(`OK ${env}: ${items.size} names valid${stored?.environments?.[env] ? ', same as the names file' : ''}.`);
  }
  return worst(codes);
}

// ── add ──

/** @param {any} catalog @param {string} provider */
export function catalogOf(catalog, provider) {
  const p = catalog?.providers?.[provider];
  if (!isRecord(p) || !Array.isArray(p.rows) || !Array.isArray(p.presets) || !isRecord(p.limits)) return undefined;
  return /** @type {{ rows: any[], presets: any[], limits: Record<string, any> }} */ (/** @type {unknown} */ (p));
}

/**
 * 첫 인자 풀이 — 규칙 id(점이 있으면) → 프리셋 id → `<provider>.<arg>` 규칙 → 행 별칭 · 축약어(규칙이 하나인 행만)
 * @param {string} arg @param {string} provider @param {{ rows: any[], presets: any[] }} cat
 * @returns {{ preset?: any, rule: string } | { error: string }}
 */
export function resolveTarget(arg, provider, cat) {
  const ruleIds = new Set(cat.rows.flatMap((r) => Object.keys(r.rules)));
  if (arg.includes('.')) return ruleIds.has(arg) ? { rule: arg } : { error: `Unknown rule id: ${arg}.${hint(arg, cat)}` };
  const preset = cat.presets.find((p) => p.id === arg);
  if (preset) return { preset, rule: preset.rule };
  if (ruleIds.has(`${provider}.${arg}`)) return { rule: `${provider}.${arg}` };
  const low = arg.toLowerCase();
  const rows = cat.rows.filter((r) => (r.aliases ?? []).some((/** @type {string} */ a) => a.toLowerCase() === low) || r.slug?.value === low);
  if (rows.length === 1 && Object.keys(rows[0].rules).length === 1) return { rule: /** @type {string} */ (Object.keys(rows[0].rules)[0]) };
  if (rows.length > 0) return { error: `${arg} matches several rules; pass one rule id: ${rows.flatMap((r) => Object.keys(r.rules)).join(', ')}.` };
  return { error: `Not a preset, rule or resource: ${arg}.${hint(arg, cat)}` };
}

/**
 * 비슷한 후보 셋 — 편집 거리로 가까운 것(오타: dbb → db, cloud_sql_instnce → gcp.cloud_sql_instance) 먼저, 그다음 부분 문자열로 든 것
 * @param {string} arg @param {{ rows: any[], presets: any[] }} cat
 */
function hint(arg, cat) {
  const low = arg.toLowerCase().replace(/^[a-z]+\./, '');
  // 「gcp.」 처럼 뗀 뒤 남는 글자가 없으면 무엇이든 든다 — 제안하지 않는다
  if (low === '') return '';
  const all = [...cat.presets.map((p) => p.id), ...cat.rows.flatMap((r) => Object.keys(r.rules))];
  // 규칙 id 는 provider 를 뗀 글자로도 잰다 — 사람은 「cloud_sql_instnce」처럼 앞을 빼고 친다. 같은 글자가 둘이면(프리셋 id 와 규칙) 둘 다
  const bare = all.map((id) => id.replace(/^[a-z]+\./, ''));
  const near1 = new Set(closest(low, bare));
  const byDistance = all.filter((_, i) => near1.has(/** @type {string} */ (bare[i])));
  const bySubstring = all.filter((id) => id.toLowerCase().includes(low));
  const near = [...new Set([...byDistance, ...bySubstring])].slice(0, 3);
  return near.length > 0 ? ` Did you mean: ${near.join(', ')}?` : '';
}

/**
 * 「add 15」 — 번호는 묻는 흐름의 메뉴 번호다. 그 번호가 메뉴의 무엇인지(그 자리의 프리셋 id)와 id 를 찾는 길을 알린다
 * @param {Ctx} ctx @param {string} arg @param {{ presets: any[] } | undefined} cat
 */
function menuNumberHint(ctx, arg, cat) {
  const { v } = ctx;
  const lines = [`${arg} is a menu number: numbers work only in the questions of "cloudonym add" with no arguments on a terminal. Here, pass a preset id, a rule id or a resource name.`];
  if (cat) {
    // 번호는 인자 없는 add · new 가 보이는 메뉴 그대로 — 프로젝트 공용 먼저(--service 를 받았어도 사람이 본 번호는 이 순서다)
    const { ordered } = menuOrder(cat.presets, { project: true, service: !v.project });
    const at = ordered[Number(arg) - 1];
    if (at) lines.push(`In that menu ${arg} is ${at.label} — preset ${at.id}: cloudonym add ${at.id} ${at.level === 'project' ? '--project' : `--service ${v.service ?? '<purpose>'}`}`);
    lines.push(`Preset ids: ${ordered.slice(0, 6).map((p) => p.id).join(', ')}${ordered.length > 6 ? ', …' : ''} (all of them: "presets" in /catalog.json, or the "Wizard presets" section of /llms.txt).`);
  }
  return lines.join('\n');
}

/** 규칙의 catalog 칸 @param {{ rows: any[] }} cat @param {string} id @returns {any} */
export function ruleSpec(cat, id) {
  for (const r of cat.rows) if (id in r.rules) return r.rules[id];
  return undefined;
}

/**
 * 종류 값이 이름에 드는 토큰 — /catalog.json 의 표(행 kind.tokens · omitValues, 규칙 kinds.default)를 찾아 읽기만 한다.
 * 기본값 · omitValues · 종류 없음은 같은 이름이 되므로 '' 이다. 표에 없는 값은 그 값 그대로(서버가 400 으로 알린다)
 * @param {{ rows: any[] }} cat @param {string | undefined} rule @param {unknown} kind
 */
function kindTokenIn(cat, rule, kind) {
  if (kind === undefined) return '';
  if (typeof kind !== 'string') return `?${JSON.stringify(kind)}`;
  const row = rule === undefined ? undefined : cat.rows.find((r) => rule in r.rules);
  const kinds = row?.rules?.[/** @type {string} */ (rule)]?.kinds;
  const table = row?.kind;
  if (!isRecord(kinds) || !isRecord(table) || !isRecord(table.tokens)) return `?${kind}`;
  if (kind === kinds.default || (Array.isArray(table.omitValues) && table.omitValues.includes(kind))) return '';
  const token = table.tokens[kind];
  return typeof token === 'string' ? token : token === null ? '' : `?${kind}`;
}

/**
 * 「같은 pick」 — 서버의 wizard.duplicate_pick 이 세는 칸과 같게: 규칙 · 종류 토큰 · tier · role.
 * 위치 · HA · 번호는 세지 않는다(서버도 세지 않는다 — 다르게 세면 새 pick 을 만들어 서버가 400 으로 막는다)
 * @param {Pick} p @param {{ rows: any[], presets: any[] }} cat
 */
export function pickIdentity(p, cat) {
  const preset = p.preset === null || p.preset === undefined ? undefined : cat.presets.find((x) => x.id === p.preset);
  const rule = preset ? (typeof p.serverless === 'string' && (preset.serverless ?? []).includes(p.serverless) ? p.serverless : preset.rule) : p.rule;
  const kind = p.kind === undefined ? preset?.kind : p.kind;
  return [rule, kindTokenIn(cat, rule, kind), p.tier ?? preset?.tier ?? '', p.role ?? ''].join('|');
}

/** @param {Ctx} ctx @param {string[]} rest */
async function add(ctx, rest) {
  const { v, d } = ctx;
  if (v.service !== undefined && v.project) throw new UsageError('Pass either --service <purpose> or --project, not both.');
  // 터미널에서 대상 없이 — 무엇을 더할지 묻는다(guide.mjs). 확인 · 저장은 아래 commitAdd 그대로 (D121)
  if (rest.length === 0 && v.pick === undefined && ctx.canAsk()) return guideAdd(ctx);
  // --no-input 인데 더할 것이 없다 — --service · --project 를 받았어도 물을 수 없다
  if (rest.length === 0 && v.pick === undefined && ctx.noInput()) {
    throw new UsageError('add asks what to add only on a terminal without --no-input. Pass what to add: cloudonym add <preset | rule id | resource> --service <purpose> (or --project), or --pick \'<json>\'.', { short: true });
  }
  // 메뉴 번호(add 15) — 프리셋 목록을 읽어 그 번호가 무엇인지 알린다. 종료 코드는 전과 같다(대상 자리가 비었으면 64 · 아니면 2)
  if (rest.length === 1 && /^\d+$/.test(/** @type {string} */ (rest[0])) && v.pick === undefined) {
    /** @type {any} */
    let cat;
    /** @type {string | undefined} */
    let planError;
    try {
      const { plan } = readPlan(ctx.file);
      const c = await ctx.client().get('/catalog.json');
      cat = c.kind === 'ok' ? catalogOf(c.body, plan.provider) : undefined;
    } catch (e) { if (!(e instanceof PlanError)) throw e; planError = e.message; }
    d.stderr(menuNumberHint(ctx, /** @type {string} */ (rest[0]), cat));
    // 계획 파일을 못 읽었으면 그 까닭도 알린다(숨기지 않는다) — 종료 코드는 그대로
    if (planError !== undefined) d.stderr(planError);
    return v.service === undefined && !v.project ? EXIT.USAGE : EXIT.INPUT;
  }
  if (v.service === undefined && !v.project) {
    throw new UsageError('add needs --service <purpose> or --project.');
  }
  if (v.pick === undefined && rest.length !== 1) throw new UsageError('add takes one preset, rule id or resource name (or --pick \'<json>\').');
  if (v.pick !== undefined && rest.length > 0) throw new UsageError('Pass either a resource name or --pick, not both.');
  const { plan, digest } = readPlan(ctx.file);
  // 편집할 목록 — 생략은 빈 목록(API 와 같다) · 틀린 구조는 여기서 2 (고치다 예외로 70 이 되지 않게)
  const lists = planLists(plan);
  // 확인은 늘 계획의 모든 환경으로 한다 — 파일은 모든 환경에 쓰이므로. --env 는 출력만 거른다(목록에 없으면 2 — 서버에 보내기 전에 본다)
  environmentsOf(plan, v.env);
  const client = ctx.client();

  const catRes = await client.get('/catalog.json');
  if (catRes.kind !== 'ok') return ctx.report(catRes);
  const cat = catalogOf(catRes.body, plan.provider);
  if (!cat) {
    const enabled = isRecord(catRes.body?.providers) ? Object.keys(catRes.body.providers) : [];
    d.stderr(enabled.includes(plan.provider) ? `The server's /catalog.json has no wizard data for ${plan.provider}.` : notEnabled(plan.provider, enabled));
    return EXIT.INPUT;
  }
  // 표 · tsv 의 What · Unique in 칸 — 같은 응답의 그 provider 칸
  ctx.cat = catRes.body.providers[plan.provider];
  const catRules = catRes.body?.version?.rules;
  if (plan.rules_version !== undefined && catRules !== undefined && catRules !== plan.rules_version) d.stderr(`Note: the plan was made with rules ${plan.rules_version}; the server has ${catRules}.`);

  // 덧붙일 자리 — 없는 서비스면 끝에 새로 만든다
  const services = lists.services.map((s) => ({ ...s, picks: [...s.picks] }));
  const target = v.project ? [...lists.project_picks] : undefined;
  let svc = v.service === undefined ? undefined : services.find((s) => s.purpose === v.service);
  if (v.service !== undefined && !svc) { svc = { purpose: v.service, picks: [] }; services.push(svc); }
  const list = target ?? /** @type {{ picks: Pick[] }} */ (svc).picks;

  let summary;
  if (v.pick !== undefined) {
    /** @type {unknown} */
    let p;
    try { p = JSON.parse(v.pick); } catch { throw new UsageError('--pick is not JSON.'); }
    if (!isRecord(p)) throw new UsageError('--pick must be one JSON object (a pick of POST /v1/wizard).');
    list.push(/** @type {Pick} */ (/** @type {unknown} */ (p)));
    summary = 'the pick from --pick';
  } else {
    const found = resolveTarget(/** @type {string} */ (rest[0]), plan.provider, cat);
    if ('error' in found) { d.stderr(found.error); return EXIT.INPUT; }
    const ruleId = found.preset && v.serverless !== undefined ? v.serverless : found.rule;
    const spec = ruleSpec(cat, ruleId);
    if (!spec) { d.stderr(`Unknown rule: ${ruleId}.`); return EXIT.INPUT; }
    /** @type {Pick} */
    const pick = found.preset ? { preset: found.preset.id } : { preset: null, rule: found.rule };
    if (v.tier !== undefined) pick.tier = v.tier;
    if (v.role !== undefined) pick.role = v.role;
    if (v.kind !== undefined) pick.kind = v.kind;
    if (v.ha) pick.ha = true;
    if (v.serverless !== undefined) pick.serverless = v.serverless;
    if (v.location !== undefined) pick.location = v.location;
    let count;
    if (v.count !== undefined) {
      count = Number(v.count);
      const max = Number(cat.limits.max_count ?? 99);
      if (!Number.isInteger(count) || count < 1 || count > max) throw new UsageError(`--count must be 1–${max}: ${v.count}`);
      if (spec.input !== 'count') { d.stderr(`${ruleId} is not numbered; it takes no --count.`); return EXIT.INPUT; }
    }
    const id = pickIdentity(pick, cat);
    const at = list.findIndex((p) => pickIdentity(p, cat) === id);
    if (at >= 0) {
      const old = /** @type {Pick} */ (list[at]);
      // 위치만 다른 pick 은 서버가 같은 pick 으로 센다(같은 이름) — 덧붙이면 요청한 위치가 조용히 버려지므로 멈춘다
      if (v.location !== undefined && v.location !== old.location) {
        d.stderr(`The plan already has ${ruleId} there${old.location === undefined ? '' : ` (location ${old.location})`}; a different location does not make a separate pick, because the names would be the same. Give it its own --tier.`);
        return EXIT.INPUT;
      }
      if (spec.input !== 'count') { d.stderr(`The plan already has ${ruleId} there; it is not numbered, so there is nothing to add.`); return EXIT.INPUT; }
      if (v.ha && old.ha !== true) d.stderr(`Note: --ha is ignored: the servers are added to the existing ${ruleId} pick, which keeps its own settings.`);
      // 같은 pick — 그 pick 의 슬롯 끝에 다음 빈 번호로 덧붙인다. 기존 슬롯 · 다른 칸은 그대로 (D86 의 Add number 와 같다)
      list[at] = { ...old, instances: appendSlots(old.instances ?? [], count ?? 1) };
      summary = `${count ?? 1} more numbered ${ruleId}`;
    } else {
      if (spec.input === 'count') pick.instances = appendSlots([], count ?? (v.ha && found.preset?.ha ? found.preset.ha.min_instances : 1));
      list.push(pick);
      summary = ruleId;
    }
  }
  /** @type {PlanFile} */
  const next = { ...plan, project_picks: target ?? [...lists.project_picks], services };
  const where = v.project ? 'the project' : `service ${v.service}`;
  return commitAdd(ctx, { plan, digest, lists, next, summary, where, client, provider: plan.provider });
}

/**
 * add 의 확인과 저장 — 지금 파일 그대로(기준)와 덧붙인 뒤(next)를 계획의 모든 환경에서 보낸다. 기존 키의 이름 · 판정(위반 코드 포함)이
 * 하나라도 바뀌거나 새 이름이 FAIL 이면 쓰지 않는다(exit 1). 묻는 흐름(guideAdd)도 이 길로 합류한다
 * @param {Ctx} ctx
 * @param {{ plan: PlanFile, digest: string, lists: ReturnType<typeof planLists>, next: PlanFile, summary: string, where: string, client: ReturnType<Ctx['client']>, provider: string }} o
 * @returns {Promise<number>}
 */
export async function commitAdd(ctx, o) {
  const { v, d } = ctx;
  const { plan, digest, lists, next, summary, where, client } = o;
  const shownEnvs = environmentsOf(plan, v.env);
  const envs = environmentsOf(plan);
  const hadPicks = lists.project_picks.length > 0 || lists.services.some((s) => s.picks.length > 0);
  const codes = [];
  /** @type {Record<string, any[]>} */
  const added = {};
  /** @type {Record<string, TableRow[]>} */
  const addedRows = {};
  let blocked = false;
  for (const env of envs) {
    const label = envs.length > 1 ? env : undefined;
    /** @type {ReturnType<typeof itemsByKey>} */
    let before = new Map();
    if (hadPicks) {
      const b = checkWizard(await client.post('/v1/wizard', bodyFor(plan, env)), plan.provider);
      if (b.kind !== 'ok') {
        if (b.kind === 'http' && b.status === 400) d.stderr(`${label ? `[${label}] ` : ''}The plan file is rejected as it stands; fix it before adding.`);
        codes.push(ctx.report(b, label));
        continue;
      }
      before = itemsByKey(b.body, plan.provider);
    }
    const a = checkWizard(await client.post('/v1/wizard', bodyFor(next, env)), plan.provider);
    if (a.kind !== 'ok') { codes.push(ctx.report(a, label)); continue; }
    const after = itemsByKey(a.body, plan.provider);
    const changed = [...before.entries()].filter(([k, x]) => {
      const now = after.get(k);
      return now?.name !== x.name || now.valid !== x.valid || now.codes !== x.codes;
    });
    const fresh = [...after.entries()].filter(([k]) => !before.has(k));
    const badNew = fresh.filter(([, x]) => !x.valid);
    const at = label ? `[${label}] ` : '';
    for (const [k, x] of changed) {
      const now = after.get(k);
      d.stderr(`${at}would change ${k}: ${x.name} ${x.valid ? 'PASS' : 'FAIL'} -> ${now ? `${now.name} ${now.valid ? 'PASS' : 'FAIL'}` : '(gone)'}${now && !now.valid ? `  ${(now.item.violations ?? []).map((/** @type {any} */ y) => y.message).join(' ')}` : ''}`);
    }
    for (const [k, x] of badNew) d.stderr(`${at}new name FAILs ${k}: ${x.name}  ${(x.item.violations ?? []).map((/** @type {any} */ y) => y.message).join(' ')}`);
    if (changed.length > 0 || badNew.length > 0) { blocked = true; codes.push(EXIT.FAIL); continue; }
    added[env] = fresh.map(([, x]) => exportName(x.item));
    addedRows[env] = fresh.map(([, x]) => ({ item: exportName(x.item), valid: x.valid, ...scopeOf(x.item) }));
  }
  const code = worst(codes);
  if (code !== EXIT.OK || blocked) { d.stderr(`Not written: ${ctx.shown} is unchanged.`); return code; }

  if (ctx.json()) d.stdout(JSON.stringify({ environments: Object.fromEntries(shownEnvs.map((e) => [e, { names: added[e] ?? [] }])) }, null, 2));
  else if (ctx.table() || ctx.tsv()) printTable(ctx, addedRows, shownEnvs, undefined, o.provider);
  else {
    for (const env of shownEnvs) {
      if (shownEnvs.length > 1) d.stdout(`# ${env}`);
      for (const n of added[env] ?? []) d.stdout(`${n.name}  ${n.key}`);
    }
  }
  const newCount = Object.values(added).reduce((sum, list) => sum + list.length, 0);
  const checked = envs.length > 1 ? ` (checked in ${envs.join(', ')})` : '';
  if (v['dry-run']) { d.stderr(`Dry run: ${summary} would add ${newCount} name(s) to ${where}${checked}; ${ctx.shown} is unchanged.`); return EXIT.OK; }
  writeJson(ctx.file, next, digest);
  d.stderr(`Added ${summary} to ${where} in ${ctx.shown}: ${newCount} new name(s)${checked}; existing names unchanged.`);
  return EXIT.OK;
}

// ── completion ──

/** 값을 받는 플래그의 후보 — 파일 자리 · 고정 목록 */
const COMPLETION_HINTS = { files: ['file', 'from'], values: { output: OUTPUTS, provider: PROVIDERS } };

/** cloudonym completion <bash|zsh|fish> — 서버 · 계획 파일 없이 stdout 에 스크립트 @param {Ctx} ctx @param {string[]} rest */
function completion(ctx, rest) {
  const [shell, ...more] = rest;
  if (shell === undefined || more.length > 0 || !SHELLS.includes(/** @type {any} */ (shell))) {
    const near = shell === undefined ? [] : closest(shell, SHELLS);
    throw new UsageError(`completion takes one shell: ${SHELLS.join(', ')}${shell === undefined ? '' : ` (got ${rest.join(' ')})`}.${near.length > 0 ? ` Did you mean ${near[0]}?` : ''}`, { short: true });
  }
  ctx.d.stdout(completionScript(/** @type {'bash' | 'zsh' | 'fish'} */ (shell), COMMANDS, /** @type {any} */ (OPTIONS), COMPLETION_HINTS).replace(/\n$/, ''));
  return EXIT.OK;
}
