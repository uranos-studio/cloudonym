// @ts-check
// 묻고 답하는 흐름 (D121 · 설계 §5) — 터미널에서만 돈다(main.mjs 의 Ctx.canAsk). 프리셋 id 를 몰라도 계획을 만든다.
// 질문의 선택지는 전부 서버 데이터(/catalog.json)다 — 환경 표준값 · 리전 · 프리셋 · 규칙의 input · kinds · tier_choices · ha · 딸린 것 · locations. 여기서 외우는 이름 · 값은 없다.
// 답은 init · add 가 만드는 것과 같은 계획 파일 꼴로 모은다(키 순서까지 — 같은 계획이면 바이트가 같다). 틀린 답은 서버의 400 field 로 그 질문만 다시 묻는다
import { existsSync } from 'node:fs';
import { NoAnswer, createPrompter } from './prompt.mjs';
import { readPlan, planLists, writeJson, bodyFor, appendSlots, namesPathFor, kstTime, isRecord, environmentsOf } from './plan.mjs';
import {
  EXIT, checkWizard, exportEnv, tableRows, printTable, catalogOf, ruleSpec, pickIdentity, commitAdd, worst, notEnabled, providerOf,
} from './main.mjs';
import { attachLabel } from './table.mjs';
import { menuOrder, menuGroups, filterItems } from './menu.mjs';

/** @typedef {import('./main.mjs').Ctx} Ctx */
/** @typedef {import('./prompt.mjs').Prompter} Prompter */
/** @typedef {import('./plan.mjs').Pick} Pick */
/** @typedef {import('./plan.mjs').PlanFile} PlanFile */
/** @typedef {import('./plan.mjs').Slot} Slot */

/** 첫 줄에 쓰는 사람 이름 — 화면 글자일 뿐이다. 표에 없으면 provider 값 그대로 */
const CLOUD_NAME = /** @type {Record<string, string>} */ ({ gcp: 'Google Cloud', aws: 'AWS', azure: 'Azure' });

/** 메뉴가 이보다 길면 분류부터 묻는다(2단) — 짧으면 지금처럼 번호 목록 하나 */
const FLAT_MENU_MAX = 12;

/**
 * 고른 부품 하나 — 프리셋 · 세부 답으로 만든 pick(instances 없이) · 개수 · 슬롯마다 딸린 것
 * asked: 답한 개수 — 고가용성 때문에 count 를 최소 대수로 올렸어도 원래 답(기존 pick 에 더할 때는 고가용성을 쓰지 않으므로 이것을 쓴다)
 * @typedef {{ preset: any, pick: Pick, count?: number, asked?: number, attach?: Record<string, unknown> }} Entry
 */

/**
 * 서버 데이터 — /catalog.json 의 그 provider 칸 + 맨 위 env_values(없을 수 있다: 그 칸을 싣기 전 배포) + 규칙 버전
 * @typedef {{ cat: { rows: any[], presets: any[], limits: Record<string, any>, regions: any[], attachments: any[] }, envValues?: string[], rules?: string }} Server
 */

/** 묻는 도구 — 다 쓰면 close() 한다(stdin 을 놓아야 프로세스가 끝난다). 입력이 터미널이 아니면(시험의 주입 스트림) 답을 되울린다 @param {Ctx} ctx */
function prompterOf(ctx) {
  const input = /** @type {NodeJS.ReadableStream & { isTTY?: boolean }} */ (ctx.d.stdin);
  return createPrompter(input, ctx.d.write, input.isTTY !== true);
}

/** /catalog.json 을 읽는다 — 실패하면 종료 코드 @param {Ctx} ctx @param {ReturnType<Ctx['client']>} client @returns {Promise<any | number>} */
async function fetchCatalog(ctx, client) {
  const r = await client.get('/catalog.json');
  if (r.kind !== 'ok') return ctx.report(r);
  return r.body;
}

/**
 * /catalog.json 본문에서 그 provider 의 마법사 데이터 — 켜지지 않았거나 데이터가 없으면 종료 코드
 * @param {Ctx} ctx @param {any} body @param {string} provider @returns {Server | number}
 */
function serverFor(ctx, body, provider) {
  const p = catalogOf(body, provider);
  if (!p) {
    const enabled = isRecord(body?.providers) ? Object.keys(body.providers) : [];
    ctx.d.stderr(enabled.includes(provider) ? `The server's /catalog.json has no wizard data for ${provider}.` : notEnabled(provider, enabled));
    return EXIT.INPUT;
  }
  const raw = /** @type {any} */ (p);
  const cat = { ...p, regions: Array.isArray(raw.regions) ? raw.regions : [], attachments: Array.isArray(raw.attachments) ? raw.attachments : [] };
  const ev = body?.env_values;
  const envValues = Array.isArray(ev) && ev.length > 0 && ev.every((x) => typeof x === 'string') ? /** @type {string[]} */ (ev) : undefined;
  const rules = typeof body?.version?.rules === 'string' ? body.version.rules : undefined;
  ctx.cat = raw;
  return { cat, envValues, rules };
}

/** 묻는 흐름의 provider 후보 — 마법사 프리셋이 있는 provider 만(서버가 켠 순서) @param {any} body @returns {string[]} */
function wizardProviders(body) {
  const ps = isRecord(body?.providers) ? body.providers : {};
  return Object.keys(ps).filter((k) => Array.isArray(ps[k]?.presets) && ps[k].presets.length > 0);
}

// ── 질문 ──

/**
 * 환경 — env_values 가 있으면 번호 목록(번호 · 값 둘 다 받는다), 없으면 자유 입력(틀리면 서버 400 의 supported 로 다시 묻는다)
 * @param {Prompter} ask @param {string[] | undefined} values @returns {Promise<string[]>}
 */
async function askEnvs(ask, values) {
  for (;;) {
    const list = values ? ` [${values.map((x, i) => `${i + 1} ${x}`).join(' · ')}]` : ' (e.g. prod or prod,stg)';
    const a = await ask.line(`Environments, comma-separated${list}: `);
    const parts = [...new Set(a.split(/[\s,]+/).filter((x) => x !== ''))];
    if (parts.length === 0) { ask.say('  An answer is needed.'); continue; }
    if (!values) return parts;
    /** @type {string[]} */
    const out = [];
    for (const x of parts) {
      const v = /^\d+$/.test(x) ? values[Number(x) - 1] : values.find((y) => y === x.toLowerCase());
      if (v !== undefined && !out.includes(v)) out.push(v);
      else if (v === undefined) { out.length = 0; break; }
    }
    if (out.length > 0) return out;
    ask.say(`  Pick numbers from 1 to ${values.length} or the values listed.`);
  }
}

/**
 * 리전 — 글자로 좁힌다(region · code · label). 하나면 Enter 로 고른다 · 여럿이면 번호 · 정확한 region 이면 바로
 * @param {Prompter} ask @param {any[]} regions @returns {Promise<string>}
 */
async function askRegion(ask, regions) {
  let filter = await ask.line('Region (type part of a name or place to filter, e.g. seoul): ');
  for (;;) {
    const f = filter.toLowerCase();
    const exact = regions.find((r) => r.region === f);
    if (exact) return exact.region;
    const hits = regions.filter((r) => [r.region, r.code, r.label].some((x) => typeof x === 'string' && x.toLowerCase().includes(f)));
    if (hits.length === 0) { filter = await ask.line(`  No region matches "${filter}". Filter again: `); continue; }
    hits.forEach((r, i) => ask.say(`  ${String(i + 1).padStart(2)} ${r.region}${r.label ? ` — ${r.label}` : ''}`));
    const a = await ask.line(hits.length === 1 ? 'Pick [1]: ' : `Pick 1–${hits.length} (or type to filter again): `);
    if (a === '' && hits.length === 1) return hits[0].region;
    if (/^\d+$/.test(a) && Number(a) >= 1 && Number(a) <= hits.length) return hits[Number(a) - 1].region;
    filter = a;
  }
}

/**
 * 메뉴 줄 — 번호와 label 을 「 · 」로 잇고 폭 96 에서 감는다. bare 면 번호 없이 label 만(분류 줄 — label 에 글자가 들어 있다)
 * @param {Prompter} ask @param {string} title @param {{ n: number, label: string }[]} items @param {boolean} [bare]
 */
function menuGroup(ask, title, items, bare = false) {
  ask.say(`  ${title}`);
  let line = '';
  for (const it of items) {
    const cell = bare ? it.label : `${it.n} ${it.label}`;
    if (line !== '' && line.length + 3 + cell.length > 92) { ask.say(`    ${line}`); line = ''; }
    line = line === '' ? cell : `${line} · ${cell}`;
  }
  if (line !== '') ask.say(`    ${line}`);
}

/**
 * 번호 답 — 전부 1..max 의 번호면 그 번호들(중복 없이 작은 것 먼저), 번호이긴 한데 범위 밖이면 'range', 번호가 아니면 undefined(글자로 거른다)
 * @param {string} a @param {number} max @returns {number[] | 'range' | undefined}
 */
function numbersIn(a, max) {
  const parts = a.split(/[\s,]+/).filter((x) => x !== '');
  if (parts.length === 0 || !parts.every((x) => /^\d+$/.test(x))) return undefined;
  const nums = parts.map(Number);
  return nums.every((n) => n >= 1 && n <= max) ? [...new Set(nums)].sort((x, y) => x - y) : 'range';
}

/**
 * 부품 메뉴 — 번호는 늘 같은 평평한 순서다(프로젝트 공용 먼저 · menu.mjs). 번호 여럿을 한 번에 받고, 글자를 치면 거른다.
 * 프리셋이 FLAT_MENU_MAX 개보다 많으면 2단 — 먼저 분류(글자 a, b, …), 고른 분류 · 거른 결과에서 번호. 어느 자리에서나 아는 번호는 바로 받는다
 * @param {Prompter} ask @param {Server['cat']} cat @param {{ project: boolean, service: boolean }} show @returns {Promise<any[]>}
 */
async function askParts(ask, cat, show) {
  const menu = menuOrder(cat.presets, show);
  const { project, service, ordered } = menu;
  const max = ordered.length;
  const all = ordered.map((preset, i) => ({ n: i + 1, preset }));
  const example = project.length > 0 && service.length > 0 ? `1,${project.length + 1}` : '1,2';
  const pick = (/** @type {number[]} */ nums) => nums.map((n) => ordered[n - 1]);
  /** 2단일 때 분류 — 글자 하나는 분류 글자로 읽는다 @type {{ label: string, items: { n: number, preset: any }[] }[]} */
  const groups = max > FLAT_MENU_MAX ? menuGroups(menu, cat.rows) : [];
  const letter = (/** @type {number} */ i) => String.fromCharCode(97 + i);
  /** 글자 하나 → 분류(없는 글자면 'bad') · 2단이 아니거나 글자가 하나가 아니면 undefined @param {string} a @returns {{ n: number, preset: any }[] | 'bad' | undefined} */
  const groupOf = (a) => {
    if (groups.length === 0 || !/^[a-z]$/i.test(a)) return undefined;
    return groups[a.toLowerCase().charCodeAt(0) - 97]?.items ?? 'bad';
  };
  const badLetter = (/** @type {string} */ a) => ask.say(`  No group "${a}": pick a letter from a to ${letter(groups.length - 1)}, or type two or more letters to filter.`);
  /** 거른 결과 · 분류 하나를 보이고 고르게 한다 — Enter 면 null(분류로 돌아간다) @param {{ n: number, preset: any }[]} items @returns {Promise<any[] | null>} */
  const fromList = async (items) => {
    let list = items;
    for (;;) {
      menuGroup(ask, `${list.length} part${list.length === 1 ? '' : 's'}`, list.map(({ n, preset }) => ({ n, label: preset.label })));
      const a = await ask.line(`Pick one or more (e.g. ${list.slice(0, 2).map((x) => x.n).join(',')}), type to filter again, or Enter to go back: `);
      if (a === '') return null;
      const nums = numbersIn(a, max);
      if (Array.isArray(nums)) return pick(nums);
      if (nums === 'range') { ask.say(`  Pick one or more numbers from 1 to ${max}, separated by commas.`); continue; }
      const g = groupOf(a);
      if (g === 'bad') { badLetter(a); continue; }
      const hits = g ?? filterItems(all, a);
      if (hits.length === 0) { ask.say(`  No part matches "${a}".`); continue; }
      list = hits;
    }
  };

  ask.say('What are you building?');
  if (max <= FLAT_MENU_MAX) {
    if (project.length > 0) menuGroup(ask, 'Shared by the project', project.map((p, i) => ({ n: i + 1, label: p.label })));
    if (service.length > 0) menuGroup(ask, 'Parts of a service', service.map((p, i) => ({ n: project.length + i + 1, label: p.label })));
    for (;;) {
      const a = await ask.line(`Pick one or more (e.g. ${example}), or type to filter: `);
      const nums = numbersIn(a, max);
      if (Array.isArray(nums)) return pick(nums);
      if (nums === 'range' || a === '') { ask.say(`  Pick one or more numbers from 1 to ${max}, separated by commas.`); continue; }
      const hits = filterItems(all, a);
      if (hits.length === 0) { ask.say(`  No part matches "${a}".`); continue; }
      const got = await fromList(hits);
      if (got) return got;
    }
  }
  // 2단 — 분류 글자 · 거르기 · 아는 번호
  for (;;) {
    menuGroup(ask, `${max} parts in ${groups.length} groups`, groups.map((g, i) => ({ n: 0, label: `${letter(i)} ${g.label} (${g.items.length})` })), true);
    const a = await ask.line(`Pick a group letter, type part of a name to filter, or part numbers if you know them (e.g. ${example}): `);
    const nums = numbersIn(a, max);
    if (Array.isArray(nums)) return pick(nums);
    if (nums === 'range') { ask.say(`  Pick one or more numbers from 1 to ${max}, separated by commas.`); continue; }
    if (a === '') { ask.say('  Pick a group letter, or type to filter.'); continue; }
    const g = groupOf(a);
    if (g === 'bad') { badLetter(a); continue; }
    const items = g ?? filterItems(all, a);
    if (items.length === 0) { ask.say(`  No part matches "${a}".`); continue; }
    const got = await fromList(items);
    if (got) return got;
  }
}

/**
 * 부품 하나의 세부 — 앞 설계 §4-8 순서: 개수 → role → 종류 → tier → 고가용성 → 딸린 것 → 위치. 전부 catalog 칸이 있을 때만 묻는다.
 * pick 의 키 순서는 add 가 만드는 것과 같다(preset · tier · role · kind · ha · location) — 같은 계획이면 파일 바이트가 같다
 * @param {Prompter} ask @param {Server['cat']} cat @param {any} preset @returns {Promise<Entry>}
 */
async function askDetails(ask, cat, preset) {
  const label = String(preset.label ?? preset.id);
  const spec = ruleSpec(cat, preset.rule) ?? {};
  const max = Number(cat.limits.max_count ?? 99);
  /** @type {number | undefined} */
  let count;
  if (spec.input === 'count') count = await ask.number(`${label} — how many?`, { min: 1, max, def: 1 });
  /** @type {string | undefined} */
  let role;
  if (spec.input === 'role') role = await ask.text(`${label} — role (e.g. deploy)`);
  /** @type {string | undefined} */
  let kind;
  const kinds = spec.kinds;
  if (isRecord(kinds) && Array.isArray(kinds.allowed) && kinds.allowed.length > 0) {
    const def = typeof preset.kind === 'string' ? preset.kind : typeof kinds.default === 'string' ? kinds.default : undefined;
    const got = await ask.choose(`${label} — kind`, kinds.allowed, def === undefined ? {} : { def });
    if (got !== def) kind = got;
  }
  /** @type {string | undefined} */
  let tier;
  if (Array.isArray(preset.tier_choices) && preset.tier_choices.length > 0) {
    const def = typeof preset.tier === 'string' ? preset.tier : undefined;
    const got = await ask.choose(`${label} — which one`, preset.tier_choices, def === undefined ? {} : { def });
    if (got !== def) tier = got;
  }
  let ha = false;
  const asked = count;
  if (isRecord(preset.ha) && count !== undefined) {
    const min = Number(preset.ha.min_instances ?? 2);
    ha = await ask.yesNo(`${label} — high availability (at least ${min} servers)?`, false);
    if (ha && count < min) { ask.say(`  ${min} servers — the least for high availability.`); count = min; }
  }
  /** @type {Record<string, unknown> | undefined} */
  let attach;
  const rows = cat.attachments.filter((a) => a?.parent === preset.rule);
  if (rows.length > 0 && count !== undefined) {
    attach = {};
    const given = isRecord(preset.default_attach) ? preset.default_attach : {};
    for (const row of rows) {
      const what = attachLabel(row, cat);
      if (row.seq) {
        const def = Array.isArray(given[row.attach]) ? given[row.attach].length : 0;
        const n = await ask.number(`${label} — ${what}s?`, { min: 0, max: Number(cat.limits.max_data_disks ?? 9), def });
        if (n > 0) attach[row.attach] = Array.from({ length: n }, (_, i) => String(i + 1).padStart(2, '0'));
      } else if (await ask.yesNo(`${label} — ${what}?`, given[row.attach] === true)) attach[row.attach] = true;
    }
  }
  /** @type {string | undefined} */
  let location;
  if (Array.isArray(spec.locations) && spec.locations.length > 0) location = await ask.choose(`${label} — location`, spec.locations, { optional: 'in the region' });

  /** @type {Pick} */
  const pick = { preset: preset.id };
  if (tier !== undefined) pick.tier = tier;
  if (role !== undefined) pick.role = role;
  if (kind !== undefined) pick.kind = kind;
  if (ha) pick.ha = true;
  if (location !== undefined) pick.location = location;
  return { preset, pick, ...(count === undefined ? {} : { count, asked }), ...(attach && Object.keys(attach).length > 0 ? { attach } : {}) };
}

/** 슬롯 n 개(기본 e.count)를 덧붙이고 새 슬롯마다 딸린 것을 단다 — 기존 슬롯은 그대로 @param {Slot[]} slots @param {Entry} e @param {number} [n] */
function withSlots(slots, e, n = e.count ?? 1) {
  const out = appendSlots(slots, n);
  return out.map((s, i) => (i < slots.length || !e.attach ? s : { ...s, attach: structuredClone(e.attach) }));
}

/**
 * 고른 부품들을 pick 목록에 넣는다 — 같은 pick(서버의 중복 판정: 규칙 · 종류 토큰 · tier · role)이 있으면 번호 붙는 것은 그 pick 에 슬롯을 덧붙이고,
 * 아니면 건너뛴다(같은 이름이 된다). 돌려주는 at 은 각 Entry 가 놓인 자리(-1: 건너뜀) — 400 의 field 를 질문으로 되짚을 때 쓴다
 * @param {Pick[]} list @param {Entry[]} entries @param {Server['cat']} cat @param {Prompter} ask
 * @returns {{ list: Pick[], at: number[] }}
 */
function place(list, entries, cat, ask) {
  const out = [...list];
  const at = entries.map((e) => {
    const id = pickIdentity(e.pick, cat);
    const i = out.findIndex((p) => pickIdentity(p, cat) === id);
    if (i < 0) {
      out.push(e.count === undefined ? { ...e.pick } : { ...e.pick, instances: withSlots([], e) });
      return out.length - 1;
    }
    const old = /** @type {Pick} */ (out[i]);
    // add 와 같다 — 위치만 다른 pick 은 서버가 같은 pick 으로 세므로(같은 이름) 위치가 조용히 버려지지 않게 넣지 않는다
    if (e.pick.location !== old.location) { ask.say(`  ${e.preset.label} is already in the plan there${old.location === undefined ? '' : ` (location ${old.location})`}; a different location alone does not make a separate pick, because the names would be the same — not added.`); return -1; }
    if (e.count === undefined) { ask.say(`  ${e.preset.label} is already in the plan there — not added twice.`); return -1; }
    // 기존 pick 에 서버를 더한다 — 그 pick 의 설정(고가용성 등)은 그대로다. 다르게 답했으면 알린다(add 의 --ha 와 같다)
    const haIgnored = e.pick.ha === true && old.ha !== true;
    if (haIgnored) ask.say(`  Note: high availability is not changed — the servers are added to the ${e.preset.label} already in the plan, which keeps its own settings.`);
    out[i] = { ...old, instances: withSlots(old.instances ?? [], e, haIgnored ? e.asked : e.count) };
    return i;
  });
  return { list: out, at };
}

/**
 * 400 의 field → 다시 물을 것. 계획의 어디도 가리키지 않거나 묻는 흐름이 만들지 않은 자리면 null(다시 물어 고칠 수 없다)
 * @param {string | undefined} field @param {{ project: number[], service: number[], serviceIndex: number }} map
 * @returns {{ q: 'owner' | 'system' | 'env' | 'region' | 'purpose' } | { q: 'pick', side: 'project' | 'service', entry: number } | null}
 */
function target(field, map) {
  if (field === 'project.owner') return { q: 'owner' };
  if (field === 'project.system') return { q: 'system' };
  if (field === 'project.env') return { q: 'env' };
  if (field === 'project.region') return { q: 'region' };
  if (field === undefined) return null;
  const m = /^(?:project_picks|services\[(\d+)\]\.(picks|purpose))(?:\[(\d+)\])?/.exec(field);
  if (!m) return null;
  if (field.startsWith('project_picks')) {
    const j = /^project_picks\[(\d+)\]/.exec(field)?.[1];
    const entry = j === undefined ? -1 : map.project.indexOf(Number(j));
    return entry < 0 ? null : { q: 'pick', side: 'project', entry };
  }
  if (Number(m[1]) !== map.serviceIndex) return null;
  if (m[2] === 'purpose') return { q: 'purpose' };
  const entry = m[3] === undefined ? -1 : map.service.indexOf(Number(m[3]));
  return entry < 0 ? null : { q: 'pick', side: 'service', entry };
}

/** 400 문장을 보인다 @param {Prompter} ask @param {any[]} errors */
function showRejected(ask, errors) {
  ask.say('The server did not accept some answers:');
  for (const e of errors) ask.say(`  ${e.field ? `${e.field}: ` : ''}${e.message ?? e.code}`);
}

// ── new ──

/**
 * cloudonym new · 터미널에서 인자 없는 cloudonym — 묻고, 환경마다 POST /v1/wizard 로 확인하고, 계획 · 보관 파일을 쓰고, 표를 보인다
 * @param {Ctx} ctx @returns {Promise<number>}
 */
export async function guideNew(ctx) {
  const { d, v } = ctx;
  if (existsSync(ctx.file) && !v.force) {
    d.stderr(`${ctx.shown} already exists. Add to it with "${ctx.command('add')}", or pass --force to start over.`);
    return EXIT.INPUT;
  }
  // --provider 를 받았으면 그것 — 표에 없는 값은 서버에 묻기 전에 64
  const given = v.provider === undefined ? undefined : providerOf(v.provider);
  const client = ctx.client();
  const body = await fetchCatalog(ctx, client);
  if (typeof body === 'number') return body;
  // 받은 provider 가 켜져 있는지는 묻기 전에 본다 — 묻고 나서 막히지 않게
  if (given !== undefined) { const ok = serverFor(ctx, body, given); if (typeof ok === 'number') return ok; }
  // provider 를 받지 않았는데 마법사 프리셋이 있는 provider 가 없다 — 물을 것이 없으므로 health 전에 2
  else if (wizardProviders(body).length === 0) { d.stderr("The server's /catalog.json has no wizard presets for any provider; make a plan with cloudonym init instead."); return EXIT.INPUT; }
  const h = await client.get('/v1/health');
  if (h.kind !== 'ok') return ctx.report(h);
  const rules = h.body?.version?.rules;
  if (typeof rules !== 'string') { d.stderr('The server did not say its rules version (GET /v1/health).'); return EXIT.UNAVAILABLE; }

  const ask = prompterOf(ctx);
  try {
    // provider — 마법사 데이터가 있는 provider 가 여럿일 때만 묻는다(하나면 그것). 계획 파일 하나 = provider 하나
    const candidates = wizardProviders(body);
    const provider = given ?? (candidates.length > 1 ? (await ask.choose('Which cloud', candidates, { def: candidates[0] })) ?? 'gcp' : candidates[0] ?? 'gcp');
    const server = serverFor(ctx, body, provider);
    if (typeof server === 'number') return server;
    const { cat } = server;
    const cloud = CLOUD_NAME[provider] ?? provider;
    ask.say(`Cloudonym — names for ${provider === 'gcp' ? `a ${cloud} project` : cloud}. Rules ${rules}.`);
    const a = {
      owner: await ask.text('Who runs it? (team or organisation, e.g. platform)'),
      system: await ask.text('System name (e.g. payment)'),
      envs: await askEnvs(ask, server.envValues),
      region: await askRegion(ask, cat.regions),
      /** @type {string | undefined} */ purpose: undefined,
      /** @type {Entry[]} */ project: [],
      /** @type {Entry[]} */ service: [],
    };
    do {
      const chosen = await askParts(ask, cat, { project: true, service: true });
      for (const preset of chosen) {
        if (preset.level !== 'project' && a.purpose === undefined) a.purpose = await ask.text('What is the service called? (e.g. shop)');
        const e = await askDetails(ask, cat, preset);
        (preset.level === 'project' ? a.project : a.service).push(e);
      }
    } while (await ask.yesNo('Add more?', false));

    // 확인 — 환경마다 보낸다. 400 이면 그 질문만 다시 묻고 처음부터 다시 보낸다
    /** @type {PlanFile} */
    let plan;
    /** @type {{ env: string, r: import('./http.mjs').ApiResult }[]} */
    let results;
    for (;;) {
      const p = place([], a.project, cat, ask);
      const s = place([], a.service, cat, ask);
      plan = {
        provider,
        project: { owner: a.owner, system: a.system, env: /** @type {string} */ (a.envs[0]), region: a.region },
        project_picks: p.list, services: a.purpose === undefined ? [] : [{ purpose: a.purpose, picks: s.list }], rules_version: rules,
        ...(a.envs.length > 1 ? { environments: a.envs } : {}),
      };
      results = [];
      /** @type {any} */
      let rejected;
      for (const env of a.envs) {
        const r = checkWizard(await client.post('/v1/wizard', bodyFor(plan, env)), provider);
        if (r.kind === 'http' && r.status === 400) { rejected = { env, r }; break; }
        results.push({ env, r });
      }
      if (!rejected) break;
      const errors = Array.isArray(rejected.r.body?.errors) ? rejected.r.body.errors : [];
      const map = { project: p.at, service: s.at, serviceIndex: 0 };
      const todo = errors.map((/** @type {any} */ e) => target(e.field, map));
      if (errors.length === 0 || todo.some((/** @type {any} */ t) => t === null)) return ctx.report(rejected.r, a.envs.length > 1 ? rejected.env : undefined);
      showRejected(ask, errors);
      /** @type {Set<string>} */
      const done = new Set();
      for (const t of todo) {
        const key = JSON.stringify(t);
        if (done.has(key)) continue;
        done.add(key);
        if (t.q === 'owner') a.owner = await ask.text('Who runs it? (team or organisation, e.g. platform)');
        else if (t.q === 'system') a.system = await ask.text('System name (e.g. payment)');
        else if (t.q === 'env') a.envs = await askEnvs(ask, server.envValues);
        else if (t.q === 'region') a.region = await askRegion(ask, cat.regions);
        else if (t.q === 'purpose') a.purpose = await ask.text('What is the service called? (e.g. shop)');
        else {
          const list = t.side === 'project' ? a.project : a.service;
          const old = /** @type {Entry} */ (list[t.entry]);
          list[t.entry] = await askDetails(ask, cat, old.preset);
        }
      }
    }
    const codes = results.map(({ env, r }) => ctx.report(r, a.envs.length > 1 ? env : undefined));
    if (worst(codes) !== EXIT.OK) { d.stderr(`Not written: nothing was saved.`); return worst(codes); }

    // 저장 — 계획(없던 파일 · --force 면 덮는다) 다음 보관 파일. 표는 저장한 뒤에 보인다
    writeJson(ctx.file, plan, v.force ? undefined : null);
    /** @type {Record<string, ReturnType<typeof exportEnv>>} */
    const fresh = {};
    /** @type {Record<string, import('./main.mjs').TableRow[]>} */
    const rows = {};
    let version;
    for (const { env, r } of results) {
      if (r.kind !== 'ok') continue;
      fresh[env] = exportEnv(r.body, provider);
      rows[env] = tableRows(r.body, provider);
      version ??= r.body?.version;
    }
    // 보관 파일은 방금 쓴 계획에서 나온 것이다 — 계획만 지우고 다시 시작했으면 옛 보관 파일이 남아 있으니 내용을 대어 보지 않고 바꾼다
    writeJson(namesPathFor(ctx.file), { received_at: kstTime(d.now()), rules_version: version?.rules, environments: fresh });
    ask.say('');
    printTable(ctx, rows, a.envs, undefined, provider);
    return finish(ctx, rows, a.envs.length);
  } catch (e) {
    if (e instanceof NoAnswer) { d.stderr('No answer (the input closed): nothing was written.'); return EXIT.USAGE; }
    throw e;
  } finally {
    ask.close();
  }
}

/**
 * 요약 한 줄 · 다음 할 일 한 줄 — FAIL 이 있으면 1
 * @param {Ctx} ctx @param {Record<string, import('./main.mjs').TableRow[]>} rows @param {number} envCount
 */
function finish(ctx, rows, envCount) {
  const all = Object.values(rows).flat();
  const bad = all.filter((r) => !r.valid).length;
  const where = envCount > 1 ? ` in ${envCount} environments` : '';
  const verdict = bad === 0 ? 'all valid' : `${bad} FAIL`;
  ctx.d.stdout('');
  ctx.d.stdout(`${all.length} names${where} · ${verdict} · saved ${ctx.shown} and ${namesPathFor(ctx.shown)}`);
  ctx.d.stdout(`Add more: ${ctx.command('add')} · Check before applying: ${ctx.command('validate')} · Machines: ${ctx.command('names --json')}`);
  return bad === 0 ? EXIT.OK : EXIT.FAIL;
}

// ── add ──

/**
 * 인자 없는 cloudonym add(터미널) — 부품 메뉴 → (서비스 부품이면) 서비스 고르기 → 세부 → 확인 · 저장은 commitAdd(기존 이름 불변 검사) 그대로
 * --service 를 주면 그 서비스에 · --project 면 프로젝트 공용 부품만 묻는다
 * @param {Ctx} ctx @returns {Promise<number>}
 */
export async function guideAdd(ctx) {
  const { d, v } = ctx;
  const { plan, digest } = readPlan(ctx.file);
  const lists = planLists(plan);
  environmentsOf(plan, v.env);
  const client = ctx.client();
  const body = await fetchCatalog(ctx, client);
  if (typeof body === 'number') return body;
  const server = serverFor(ctx, body, plan.provider);
  if (typeof server === 'number') return server;
  const { cat } = server;
  if (plan.rules_version !== undefined && server.rules !== undefined && server.rules !== plan.rules_version) d.stderr(`Note: the plan was made with rules ${plan.rules_version}; the server has ${server.rules}.`);

  const ask = prompterOf(ctx);
  try {
    /** @type {Entry[]} */
    const project = [];
    /** @type {Entry[]} */
    const service = [];
    /** @type {string | undefined} */
    let purpose = v.service;
    do {
      const chosen = await askParts(ask, cat, { project: v.service === undefined, service: !v.project });
      for (const preset of chosen) {
        if (preset.level !== 'project' && purpose === undefined) purpose = await askService(ask, lists.services.map((s) => s.purpose));
        const e = await askDetails(ask, cat, preset);
        (preset.level === 'project' ? project : service).push(e);
      }
    } while (await ask.yesNo('Add more?', false));

    // 먼저 첫 환경으로 한 번 보내 본다 — 새 부품의 세부가 400 이면 그 질문만 다시 묻는다. 기존 계획의 자리가 틀렸으면 고칠 수 없으므로 add 처럼 멈춘다
    const env0 = /** @type {string} */ (environmentsOf(plan)[0]);
    for (;;) {
      const { next, map } = merged(plan, lists, project, service, purpose, cat, ask);
      const r = checkWizard(await client.post('/v1/wizard', bodyFor(next, env0)), plan.provider);
      if (!(r.kind === 'http' && r.status === 400)) {
        if (r.kind !== 'ok') return ctx.report(r);
        const parts = [...project, ...service].map((e) => e.preset.label);
        const where = [project.length > 0 ? 'the project' : '', service.length > 0 ? `service ${purpose}` : ''].filter((x) => x !== '').join(' and ');
        return await commitAdd(ctx, { plan, digest, lists, next, summary: parts.join(', '), where, client, provider: plan.provider });
      }
      const errors = Array.isArray(r.body?.errors) ? r.body.errors : [];
      const todo = errors.map((/** @type {any} */ e) => target(e.field, map));
      if (errors.length === 0 || todo.some((/** @type {any} */ t) => t === null || (t.q !== 'pick' && !(t.q === 'purpose' && map.newService)))) {
        d.stderr('The plan with these parts is rejected:');
        return ctx.report(r);
      }
      showRejected(ask, errors);
      /** @type {Set<string>} */
      const done = new Set();
      for (const t of todo) {
        const key = JSON.stringify(t);
        if (done.has(key) || t === null) continue;
        done.add(key);
        if (t.q === 'purpose') purpose = await ask.text('What is the new service called? (e.g. shop)');
        else if (t.q === 'pick') {
          const list = t.side === 'project' ? project : service;
          const old = /** @type {Entry} */ (list[t.entry]);
          list[t.entry] = await askDetails(ask, cat, old.preset);
        }
      }
    }
  } catch (e) {
    if (e instanceof NoAnswer) { d.stderr(`No answer (the input closed): ${ctx.shown} is unchanged.`); return EXIT.USAGE; }
    throw e;
  } finally {
    ask.close();
  }
}

/** 서비스 고르기 — 있는 서비스 번호 · 또는 새 이름 @param {Prompter} ask @param {string[]} existing @returns {Promise<string>} */
async function askService(ask, existing) {
  if (existing.length === 0) return ask.text('What is the service called? (e.g. shop)');
  const got = await ask.choose('Which service', [...existing, 'a new service'], { def: existing[0] });
  return got === 'a new service' || got === undefined ? ask.text('What is the new service called? (e.g. shop)') : got;
}

/**
 * 기존 계획 + 고른 부품 — add 와 같은 모양(project_picks · services 만 바꾼다). map 은 400 field → Entry 되짚기
 * @param {PlanFile} plan @param {ReturnType<typeof planLists>} lists @param {Entry[]} project @param {Entry[]} service @param {string | undefined} purpose
 * @param {Server['cat']} cat @param {Prompter} ask
 */
function merged(plan, lists, project, service, purpose, cat, ask) {
  const services = lists.services.map((s) => ({ ...s, picks: [...s.picks] }));
  let si = purpose === undefined ? -1 : services.findIndex((s) => s.purpose === purpose);
  const newService = purpose !== undefined && si < 0;
  if (newService && service.length > 0) { services.push({ purpose: /** @type {string} */ (purpose), picks: [] }); si = services.length - 1; }
  const p = place(lists.project_picks, project, cat, ask);
  const s = si >= 0 ? place(/** @type {any} */ (services[si]).picks, service, cat, ask) : { list: [], at: [] };
  if (si >= 0) /** @type {any} */ (services[si]).picks = s.list;
  /** @type {PlanFile} */
  const next = { ...plan, project_picks: p.list, services };
  return { next, map: { project: p.at, service: s.at, serviceIndex: si, newService } };
}
