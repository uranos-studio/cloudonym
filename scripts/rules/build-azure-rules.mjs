// Azure 정형 행 → 규칙 데이터 생성기 (D43). 개발 때만 돈다(번들 · CI 밖).
//
// 사용: node scripts/rules/build-azure-rules.mjs <intake.json> <resource-abbreviations.html>
//   <intake.json>  = intake-azure.mjs 의 출력(고정 커밋 원문으로 만든 것)
//   <…html>        = Microsoft CAF 약어 쪽(접두 약어 출처)
//   --existing <json> = 손으로 쓴 Azure 규칙 [{ "entity": "Microsoft.Network/virtualNetworks", "resourceType": "virtual_network" }, …]
//                       — rules/azure.ts 의 AZURE_HAND_RULES 와 rules/azure-manual.ts 의 손으로 넣은 행에서 entity · resourceType 을 뽑는다. 같은 Entity 는 건너뛰고 이름은 겹치지 않게 한다
//   --commit <sha>      = 원문 커밋(docs/rule-sources.lock.json 의 azure.commit)
// 쓰는 파일:
//   src/core/rules/azure-intake.ts                    — 문자 규칙 표(원문 → 정규식) · 범위 · 규칙 행
//   src/core/__fixtures__/azure-intake.json           — 원문 행 스냅샷(전사 검사의 정답)
//   src/core/__fixtures__/rule-cases-azure-intake.json — 행마다 생성한 통과 · 실패 예
//   docs/azure-intake-held.md                         — 이번에 넣지 않은 행과 사유
//
// 원칙: 원문 문장 하나하나를 아래 문법으로만 읽는다. 문법 밖 문장이 나오면 멈춘다(추측해 넓히지 않는다).
// 통과 · 실패 예는 정규식이 아니라 같은 문장 해석에서 문자열을 직접 짜서 만든다 — 정규식 조립 실수를 잡는다.
import { readFileSync, writeFileSync } from 'node:fs';
import { sq, dq, idLit, intLit, boolLit, regexLit, metaToken } from './emit-ts.mjs';
import { pathToFileURL } from 'node:url';
import { scopeIdsFromSources, syncScopeEnum } from './openapi-scopes.mjs';
import { typeSnake, abbreviateSnake, hasSingleLetterToken } from './naming.mjs';

export const AZURE_RULES_URL = 'https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules';
export const CAF_URL = 'https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations';

// ── 문자 규칙 해석 ──────────────────────────────────────────────────
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = LOWER.toUpperCase();
const DIGIT = '0123456789';
const ALNUM = LOWER + UPPER + DIGIT;

/** 문자 종류 낱말 → 문자 집합 */
const KIND = {
  alphanumerics: ALNUM, alphanumeric: ALNUM, alphnumeric: ALNUM, 'letters or numbers': ALNUM,
  'lowercase letters': LOWER, 'lowercase letters or numbers': LOWER + DIGIT,
  letters: LOWER + UPPER, numbers: DIGIT,
  hyphens: '-', underscores: '_', periods: '.', parentheses: '()', spaces: ' ', slashes: '/',
};
/** 시작 · 끝 문장의 문자 종류 */
const EDGE_CLASS = {
  'a letter': LOWER + UPPER, letter: LOWER + UPPER, letters: LOWER + UPPER,
  alphanumeric: ALNUM, alphanumerics: ALNUM, alphnumeric: ALNUM, 'an alphanumeric': ALNUM,
  'a letter or number': ALNUM, 'letter or number': ALNUM, 'a number': DIGIT, number: DIGIT,
  'letter, number, or underscore': `${ALNUM}_`, 'alphanumeric or underscore': `${ALNUM}_`,
  'lowercase letter or number': LOWER + DIGIT, 'a lowercase letter or number': LOWER + DIGIT,
  'lowercase letter': LOWER, 'a lowercase letter': LOWER,
};
const EDGE_ITEM = { hyphen: '-', hyphens: '-', 'a hyphen': '-', period: '.', 'a period': '.', space: ' ', 'a space': ' ', underscore: '_', number: DIGIT, 'a number': DIGIT };

const uniq = (s) => [...new Set(s)].join('');
const minus = (s, t) => [...s].filter((c) => !t.includes(c)).join('');

function parseKindList(seg) {
  const s = seg.replace(/^Only /, '').replace(/ are valid\.?$/, '').replace(/\.$/, '').trim();
  const parts = s.split(/,\s*(?:and\s+|or\s+)?|\s+and\s+/).map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0 || !parts.every((p) => p in KIND)) return null;
  return uniq(parts.map((p) => KIND[p]).join(''));
}

function parseForbidden(seg) {
  const m = /^Can't use: `([^`]+)`(?: or (control characters|space))?\.?$/.exec(seg);
  if (!m) return null;
  return { chars: uniq(m[1]), control: m[2] === 'control characters', space: m[2] === 'space' };
}

function edgeClass(phrase) {
  const p = phrase.trim().toLowerCase();
  if (!(p in EDGE_CLASS)) throw new Error(`시작 · 끝 문자 종류를 모른다: "${phrase}"`);
  return EDGE_CLASS[p];
}
function edgeItems(phrase) {
  const items = phrase.split(/, or |, | or /).map((x) => x.trim().toLowerCase());
  return uniq(items.map((x) => {
    if (!(x in EDGE_ITEM)) throw new Error(`시작 · 끝 금지 문자를 모른다: "${phrase}"`);
    return EDGE_ITEM[x];
  }).join(''));
}

/** 문장 하나를 spec 에 반영한다. 모르는 문장이면 던진다 */
function applySentence(spec, sentence) {
  const x = sentence.replace(/\.$/, '').trim();
  let m;
  if ((m = /^(?:can't use|can't contain) consecutive hyphens$/i.exec(x)) || /^consecutive hyphens (?:not allowed|aren't allowed)$/i.test(x)) {
    spec.noDoubleHyphen = true; return;
  }
  if ((m = /^can't use (underscores|periods|spaces)$/i.exec(x)) || (m = /^(underscores|periods|spaces) aren't supported$/i.exec(x))) {
    spec.exclude += KIND[m[1].toLowerCase()]; return;
  }
  if ((m = /^can't (start or end|start with or end|start|end)(?: with| in)? (.+)$/i.exec(x))) {
    const items = edgeItems(m[2]);
    const which = m[1].toLowerCase();
    if (which !== 'end') spec.notStart += items;
    if (which !== 'start') spec.notEnd += items;
    return;
  }
  // start with X(,| and| ;) end with Y · start and end with X · must begin and end with X · end with X
  if ((m = /^(start and end|must begin and end)(?: with)? (.+)$/i.exec(x))) {
    const c = edgeClass(m[2]); spec.start = c; spec.end = c; return;
  }
  if ((m = /^start(?: with)? (.+?)(?:,? (?:and |;)?\s*end(?: with)? (.+))?$/i.exec(x))) {
    spec.start = edgeClass(m[1]);
    if (m[2]) spec.end = edgeClass(m[2]);
    return;
  }
  if ((m = /^end(?: with)? (.+)$/i.exec(x))) { spec.end = edgeClass(m[1]); return; }
  throw new Error(`문장을 모른다: "${sentence}"`);
}

/**
 * Valid Characters 원문 → spec. 정형 판정(intake-azure.mjs judge)을 통과한 칸만 넣는다.
 * spec = { allow?: 허용 문자(나열형), deny?: { chars, control, space }(금지형), start, end, notStart, notEnd, noDoubleHyphen, exclude }
 */
export function parseCharacters(raw) {
  const joined = raw.replace(/Can't use:\s*(?:<br\s*\/?>)+\s*/g, "Can't use: ");
  const segs = joined.split(/<br\s*\/?>/).map((s) => s.trim()).filter(Boolean);
  const spec = { allow: null, deny: null, start: null, end: null, notStart: '', notEnd: '', noDoubleHyphen: false, exclude: '' };
  for (const seg of segs) {
    const kinds = parseKindList(seg);
    if (kinds !== null) {
      if (spec.allow !== null || spec.deny !== null) throw new Error(`문자 나열이 두 번: "${raw}"`);
      spec.allow = kinds;
      continue;
    }
    const deny = parseForbidden(seg);
    if (deny !== null) {
      if (spec.allow !== null || spec.deny !== null) throw new Error(`문자 나열이 두 번: "${raw}"`);
      spec.deny = deny;
      continue;
    }
    for (const s of seg.split(/\.\s+|;\s*/).map((t) => t.trim()).filter(Boolean)) applySentence(spec, s);
  }
  if (spec.allow === null && spec.deny === null) throw new Error(`허용 문자를 모른다: "${raw}"`);
  if (spec.allow !== null) spec.allow = minus(spec.allow, spec.exclude);
  if (spec.deny !== null) spec.deny = { ...spec.deny, chars: uniq(spec.deny.chars + spec.exclude) };
  return spec;
}

/** 「control characters」를 보수적으로 읽은 집합 — C0 · DEL · C1(\\p{Cc}) 에 ALM · 폭 없는 문자 · 양방향 제어 · BOM 을 더한다.
 *  src/core/display.ts INVISIBLE · rules/azure-manual.ts 의 손 규칙과 같은 집합이다(화면에서 다르게 보이는 이름을 막는다 — Trojan Source) */
export const INVISIBLE_CLASS = '\\p{Cc}\\u061C\\u200B-\\u200F\\u2028-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\uFEFF';
const INVISIBLE_RE = new RegExp(`[${INVISIBLE_CLASS}]`, 'u');

/** 이 문자를 쓸 수 있는가 (본문 기준) */
export function allows(spec, ch) {
  if (spec.allow !== null) return spec.allow.includes(ch);
  // 금지형은 원문이 「control characters」를 말하지 않아도 보이지 않는 문자를 막는다 — 이름에 쓸 까닭이 없고, 받으면 화면과 실제 이름이 달라진다(보수적)
  if (INVISIBLE_RE.test(ch)) return false;
  if (spec.deny.space && ch === ' ') return false;
  return !spec.deny.chars.includes(ch);
}

/** 클래스 안 글자 — \ ] ^ 만 이스케이프하고 '-' 는 맨 끝에 둔다(이스케이프 없이 글자로 읽힌다 · lint no-useless-escape) */
const escClass = (s) => [...s].filter((c) => c !== '-').map((c) => (/[\\\]^]/.test(c) ? `\\${c}` : c)).join('');
const dashLast = (s) => (s.includes('-') ? '-' : '');
/** 문자 집합을 짧은 클래스로 — a-z · A-Z · 0-9 는 범위로 */
function classBody(chars) {
  let s = chars;
  let out = '';
  for (const [all, r] of [[LOWER, 'a-z'], [UPPER, 'A-Z'], [DIGIT, '0-9']]) {
    if ([...all].every((c) => s.includes(c))) { out += r; s = minus(s, all); }
  }
  return out + escClass(s) + dashLast(s);
}

/** spec → 정규식 원문 (길이는 minLength · maxLength 가 따로 센다 — validate.ts) */
export function patternOf(spec) {
  const body = spec.allow !== null
    ? `[${classBody(spec.allow)}]`
    : `[^${escClass(spec.deny.chars)}${spec.deny.space ? ' ' : ''}${INVISIBLE_CLASS}${dashLast(spec.deny.chars)}]`;
  let p = '^';
  if (spec.noDoubleHyphen) p += '(?!.*--)';
  if (spec.start) p += `(?=[${classBody(spec.start)}])`;
  if (spec.notStart) p += `(?![${escClass(spec.notStart)}${dashLast(spec.notStart)}])`;
  p += `${body}+`;
  if (spec.end) p += `(?<=[${classBody(spec.end)}])`;
  if (spec.notEnd) p += `(?<![${escClass(spec.notEnd)}${dashLast(spec.notEnd)}])`;
  return `${p}$`;
}

const allLetters = (s) => s.length > 0 && [...s].every((c) => LOWER.includes(c) || UPPER.includes(c));
const allAlnum = (s) => s.length > 0 && [...s].every((c) => ALNUM.includes(c));

/** 생성 쪽 설정 — 우리가 이름을 지을 때 쓰는 문자 집합(allowed)은 허용 집합의 부분집합이어야 한다 */
export function generationOf(spec) {
  const lowerOnly = spec.allow !== null && ![...UPPER].some((c) => spec.allow.includes(c));
  const hyphen = allows(spec, '-') && !spec.notStart.includes('-') ? true : allows(spec, '-');
  const underscore = allows(spec, '_');
  let allowed; let separator;
  if (!hyphen) { allowed = 'lower-digit'; separator = ''; }
  else if (lowerOnly) { allowed = 'lower-digit-hyphen'; separator = '-'; }
  else if (underscore) { allowed = 'alnum-hyphen-underscore'; separator = '-'; }
  else { allowed = 'alnum-hyphen'; separator = '-'; }
  return {
    allowed, separator, caseRule: lowerOnly || allowed === 'lower-digit' ? 'lower' : 'any',
    startsWithLetter: spec.start !== null && allLetters(spec.start),
    endsWithAlnum: spec.end !== null && allAlnum(spec.end),
  };
}

// ── 통과 · 실패 예 — 정규식이 아니라 spec 에서 직접 짠다 ────────────
function pick(spec, prefs, extra = () => true) {
  for (const c of prefs) if (allows(spec, c) && extra(c)) return c;
  return null;
}
const okStart = (spec) => (c) => (!spec.start || spec.start.includes(c)) && !spec.notStart.includes(c);
const okEnd = (spec) => (c) => (!spec.end || spec.end.includes(c)) && !spec.notEnd.includes(c);

/** 길이 n 의 통과 예 — 첫 글자 · 가운데 · 끝 글자를 따로 고른다 */
function validOfLength(spec, n, middle) {
  const s = pick(spec, 'abc1A', okStart(spec));
  const e = pick(spec, 'z9Z', okEnd(spec));
  const fill = middle ?? pick(spec, 'xa1');
  if (s === null || e === null || fill === null) throw new Error('통과 예를 짤 수 없다');
  if (n === 1) {
    const one = pick(spec, 'abz19A', (c) => okStart(spec)(c) && okEnd(spec)(c));
    if (one === null) throw new Error('한 글자 통과 예를 짤 수 없다');
    return one;
  }
  if (n === 2) return s + e;
  return s + fill.repeat(n - 2) + e;
}

/** 금지 문자 하나 — 나열형이면 나열 밖 기호, 금지형이면 목록의 첫 글자 */
function bannedChar(spec) {
  if (spec.deny !== null) return [...spec.deny.chars].find((c) => c !== ' ') ?? spec.deny.chars[0];
  return [...'!@#$%^&*+=~'].find((c) => !allows(spec, c));
}

export function casesOf(spec, min, max) {
  const valid = new Set();
  const invalid = new Set();
  const base = Math.min(max, Math.max(min, 3));
  valid.add(validOfLength(spec, base));
  valid.add(validOfLength(spec, min));
  valid.add(validOfLength(spec, max));
  // 나열에 있는 기호를 가운데에 하나씩 — 클래스 조립 실수를 잡는다
  if (max >= 3 && spec.allow !== null) {
    for (const c of minus(spec.allow, ALNUM)) {
      if (c === '-' && spec.noDoubleHyphen) { valid.add(validOfLength(spec, Math.max(min, 3), '-')); continue; }
      valid.add(validOfLength(spec, Math.max(min, 3), c));
    }
  }
  // 길이 경계
  invalid.add(validOfLength(spec, Math.min(max, Math.max(min, 3))).padEnd(max + 1, pick(spec, 'xa1')));
  if (min > 1) invalid.add(validOfLength(spec, min - 1));
  // 금지 문자를 가운데에
  const bad = bannedChar(spec);
  if (bad !== undefined && max >= 3) {
    const v = validOfLength(spec, Math.max(min, 3));
    invalid.add(v[0] + bad + v.slice(2));
  }
  // 시작 · 끝 위반 — 본문에서는 쓸 수 있으나 그 자리에는 못 오는 글자
  const startBad = [...'-_.1aA ('].find((c) => allows(spec, c) && !okStart(spec)(c));
  if (startBad !== undefined && max >= 2) invalid.add(startBad + validOfLength(spec, Math.max(min, 3)).slice(1));
  const endBad = [...'-_.1aA )'].find((c) => allows(spec, c) && !okEnd(spec)(c));
  if (endBad !== undefined && max >= 2) { const v = validOfLength(spec, Math.max(min, 3)); invalid.add(v.slice(0, -1) + endBad); }
  if (spec.noDoubleHyphen && max >= 4) { const v = validOfLength(spec, Math.max(min, 4)); invalid.add(`${v[0]}--${v.slice(3)}`); }
  for (const v of valid) invalid.delete(v);
  return { valid: [...valid], invalid: [...invalid] };
}

// ── 범위 · 이름 · 약어 ────────────────────────────────────────────
const segsOf = (entity) => entity.replace(/^\/+/, '').split('/').map((s) => s.trim()).filter(Boolean);
const entityId = (row) => `${row.provider}/${segsOf(row.entity).join('/')}`;

/** 범위 칸 정규화 — 셋은 기존 범위, region 은 새 범위, 나머지는 부모 리소스 범위 · 판정 불가 */
export function scopeKind(text) {
  const t = text.replace(/<br\s*\/?>.*$/i, '').trim().toLowerCase();
  if (t === 'resource group') return 'azure:resource_group';
  if (t === 'resource group & region') return 'azure:resource_group'; // RG 와 지역을 함께 — RG 안 유일로 보수적으로 읽는다
  if (t === 'global') return 'azure:global';
  if (t === 'subscription') return 'azure:subscription';
  if (t === 'region' || t === 'azure region') return 'azure:region';
  if (t === 'tenant') return 'azure:tenant'; // managementgroups — 테넌트 안 유일
  // 구독 또는 RG 에 만들 수 있는 행 — 넓은 쪽(구독)에 둔다. 넓은 노드가 유일성 판정에서 보수적이다(policy* 손 규칙과 같은 읽기)
  if (t === 'subscription or resource group' || t === 'scope of assignment') return 'azure:subscription';
  if (['management groups, subscriptions, resource groups', 'resource'].includes(t)) return null;
  if (t.includes(';') || t.includes(' or ')) return null;
  return 'parent';
}

/** 이 범위 칸이 부모 리소스를 가리키지 않는데 경로 꼴인 예외 — 원문 행을 보고 정했다 */
const PARENT_OVERRIDE = {
  // 「subscription」은 Service Bus 토픽의 구독(topics/subscriptions)이다 — Azure 구독이 아니다
  'Microsoft.ServiceBus/namespaces/topics/subscriptions/rules': 'Microsoft.ServiceBus/namespaces/topics/subscriptions',
  // 경로가 아닌 Entity — 범위 칸이 부모를 이름으로 준다
  'Microsoft.Storage/queue': 'Microsoft.Storage/storageAccounts',
  'Microsoft.Storage/table': 'Microsoft.Storage/storageAccounts',
};
/** 이미 있는 범위를 다시 만들지 않는다 — 부모 Entity → 기존 범위 id */
const EXISTING_SCOPE_OF_PARENT = {
  'Microsoft.Network/virtualNetworks': 'azure:virtual_network',
  'Microsoft.ContainerService/managedClusters': 'azure:managed_cluster',
  // sites 행은 Scope 칸이 「global or per domain」이라 생성기가 범위를 못 만든다 — 손 규칙(azure-manual.ts)의 범위를 쓴다
  'Microsoft.Web/sites': 'azure:web/sites',
};

const snake = typeSnake; // naming.mjs — IoT · SignalR 같은 섞인 약어를 한 낱말로
const words = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[^A-Za-z0-9]+/g, ' ').trim().toLowerCase().split(' ').filter(Boolean);

/** 약어가 CAF 에 없을 때 — 끝 Entity 낱말이 둘 이상이면 머리글자, 하나면 앞 세 글자 (docs/azure-intake-held.md 에 적는다) */
export function fallbackSlug(entityPath) {
  const w = words(segsOf(entityPath).at(-1));
  return w.length >= 2 ? w.map((x) => x[0]).join('') : w[0].slice(0, 3);
}

export function cafAbbreviations(html) {
  const map = new Map();
  for (const m of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim());
    if (cells.length !== 3) continue;
    const [name, ns, abbr] = cells;
    if (/\(kind:/i.test(ns) || !/^[a-z0-9]+$/.test(abbr)) continue; // 종류별 약어는 행 하나에 못 맞춘다
    const key = ns.replace(/\s+/g, '').toLowerCase();
    const prev = map.get(key);
    // 같은 Entity 에 약어가 둘 이상(예: 내부 · 외부 부하 분산기 lbi · lbe)이면 행 하나에 못 맞춘다 — 쓰지 않는다
    if (prev && prev.abbr !== abbr) map.set(key, null);
    else if (prev === undefined) map.set(key, { name, abbr });
  }
  for (const [k, v] of map) if (v === null) map.delete(k);
  return map;
}

const initials = (snakeWord) => snakeWord.split('_').map((w) => w[0]).join('');

/** resourceType — 40자 이하 · Azure 안 유일(화면 hash 상한이 40 에 기댄다). 아래 후보 중 처음 맞는 것:
 *  ① 네임스페이스_경로 전체 ② 네임스페이스 머리글자_경로 ③ 네임스페이스_중간 머리글자_끝 ④ 경로 전체 ⑤ 중간 머리글자_끝 ⑥ 네임스페이스_전부 머리글자
 *  순서: ① ② ③ → ①의 낱말 약어(naming.mjs) → ②의 낱말 약어 → ④ ⑤ ⑥ → ④의 낱말 약어. 네임스페이스를 남기는 후보를 먼저 본다.
 *  한 글자 토막(`_a_`)이 생기는 후보는 고르지 않는다 — 한 낱말 머리글자는 한 글자다 */
export function resourceTypeOf(ns, segs, used) {
  const n = snake(ns.replace(/^Microsoft\./, '').replace(/^DBfor/, 'Dbfor'));
  const parts = segs.map(snake);
  const mid = [...parts.slice(0, -1).map(initials), parts.at(-1)];
  const base = [[n, ...parts], [initials(n), ...parts], [n, ...mid], parts, mid, [n, ...parts.slice(0, -1).map(initials), initials(parts.at(-1))]].map((c) => c.join('_'));
  const candidates = [base[0], base[1], base[2], abbreviateSnake(base[0]), abbreviateSnake(base[1]), base[3], base[4], base[5], abbreviateSnake(base[3])];
  return candidates.find((c) => c.length <= 40 && !used.has(c) && !hasSingleLetterToken(c)) ?? null;
}

const CATEGORY = [
  [/^Microsoft\.(Network|Cdn|NetworkCloud)$/, 'networking'],
  [/^Microsoft\.(Compute|Batch|AVS|DesktopVirtualization|Web|ServiceFabric|AppPlatform|Quantum|HDInsight|Databricks)$/, 'compute'],
  [/^Microsoft\.(Storage|StorageSync|StorSimple|NetApp|DataBox|DataLakeStore|ImportExport|FileShares|DataProtection|RecoveryServices)$/, 'storage'],
  [/^Microsoft\.(Sql|DBfor\w+|DocumentDB|Cache|Kusto|Synapse|AnalysisServices)$/, 'database'],
  [/^Microsoft\.(ManagedIdentity|Authorization)$/, 'identity'],
  [/^Microsoft\.(KeyVault|Security|ConfidentialLedger)$/, 'security'],
  [/^Microsoft\.(ContainerService|ContainerRegistry|ContainerInstance)$/, 'containers'],
];
const categoryOf = (ns) => CATEGORY.find(([re]) => re.test(ns))?.[1] ?? 'management';

// ── 전체 ──────────────────────────────────────────────────────────
/** 손으로 원문을 다시 읽고도 넣지 않은 행 (D43) — 보류 사유를 이것으로 바꾼다. 넣은 행은 --existing 으로 건너뛴다 */
const VERSION = 'reviewed by hand — not imported (version number: each segment is an int32, not a chosen name)';
const DNS_NAME = 'reviewed by hand — not imported (a domain name the user owns, not a generated name)';
const BLUEPRINT = 'reviewed by hand — unconfirmed (the Length cell is a single number, 90, and the same table uses a single number for an exact length — roleAssignments 36 — so the minimum is not settled; the Scope cell spans management groups, subscriptions and resource groups)';
const ASSESSMENT_KEY = 'reviewed by hand — not imported (the REST reference names the path segment "The Assessment Key - Unique key for the assessment type": a key of an assessment type, not a chosen resource name; "assessment type" names no row in the table)';
export const HAND_REVIEWED = {
  'Microsoft.Compute/galleries/applications/versions': VERSION,
  'Microsoft.Compute/galleries/images/versions': VERSION,
  'Microsoft.Network/dnsZones': DNS_NAME,
  'Microsoft.Network/privateDnsZones': DNS_NAME,
  'Microsoft.NetworkCloud/kubernetesClusters/features': 'reviewed by hand — not imported (only predefined values are valid)',
  'Microsoft.OperationsManagement/solutions': 'reviewed by hand — not imported (fixed form SolutionType(WorkspaceName))',
  'Microsoft.Resources/tagNames/tagValues': 'reviewed by hand — not imported (a tag value, not a resource name)',
  'Microsoft.Storage/blob': 'reviewed by hand — not imported (an object key inside a container, not an ARM resource name)',
  'Microsoft.MachineLearningServices/workspaces/datastores': 'reviewed by hand — unconfirmed (the table gives a maximum of 255 but no minimum length)',
  'Microsoft.Blueprint/blueprint': BLUEPRINT,
  'Microsoft.Blueprint/blueprintAssignments': BLUEPRINT,
  'Microsoft.Security/assessmentMetadata': ASSESSMENT_KEY,
  'Microsoft.Security/assessments': ASSESSMENT_KEY,
  'Microsoft.Security/sqlVulnerabilityAssessments/baselineRules': 'reviewed by hand — not imported (the name is the ID of an existing vulnerability-assessment rule: the REST reference path ends in baselineRules/{ruleId}, "The rule Id."; the parent sqlVulnerabilityAssessments/default has no row and no scope node)',
  'Microsoft.NetApp/netAppAccounts/buckets': 'reviewed by hand — unconfirmed (the minimum of 13 and the sentence about volumes look copied from the volumes row; not checked against the NetApp Files documentation)',
};

/** existing = 손으로 쓴 Azure 규칙 [{ entity, resourceType }] — 같은 Entity 는 건너뛰고 resourceType 은 겹치지 않게 */
export function build(intake, caf, existing) {
  const byEntity = new Map(intake.rows.map((r) => [entityId(r).toLowerCase(), r]));
  const existingEntities = new Set(existing.map((e) => e.entity.toLowerCase()));
  const held = [];
  const rules = [];
  const scopes = new Map(); // id → def
  const charClasses = new Map(); // raw → { key, pattern, spec }

  /** 부모 Entity 의 범위 노드 id — 없으면 만든다. 만들 수 없으면 null */
  const scopeForParent = (parentId, scopeText, childAnchor) => {
    const existingId = EXISTING_SCOPE_OF_PARENT[parentId];
    if (existingId) return existingId;
    const id = `azure:${parentId.replace(/^Microsoft\./, '').toLowerCase()}`;
    if (scopes.has(id)) return id;
    const prow = byEntity.get(parentId.toLowerCase());
    let parentScope;
    if (prow) {
      const k = scopeKind(prow.scope);
      parentScope = k === 'parent' ? scopeOfRow(prow) : k;
    } else {
      // 부모 행이 표에 없다 — 한 단계 위 부모의 범위 노드 아래에 둔다
      const segs = parentId.split('/');
      parentScope = segs.length > 2 ? scopeForParent(segs.slice(0, -1).join('/'), null, childAnchor) : null;
    }
    if (!parentScope) return null;
    scopes.set(id, { id, parent: parentScope, entity: parentId, displayName: scopeText ?? segsOf(parentId.split('/').slice(1).join('/')).at(-1), anchor: prow?.anchor ?? childAnchor });
    return id;
  };
  const scopeOfRow = (row) => {
    const k = scopeKind(row.scope);
    if (k !== 'parent') return k;
    const id = entityId(row);
    const parentId = PARENT_OVERRIDE[id] ?? (segsOf(row.entity).length >= 2 ? id.split('/').slice(0, -1).join('/') : null);
    if (!parentId) return null;
    return scopeForParent(parentId, row.scope.trim(), row.anchor);
  };

  const usedTypes = new Set(existing.map((e) => e.resourceType));
  for (const row of intake.rows) {
    const id = entityId(row);
    if (existingEntities.has(id.toLowerCase())) continue; // 이미 손으로 등록한 행
    if (row.judgement !== 'formal') { held.push({ row, reason: row.judgement === 'fixed' ? 'fixed value' : `manual: ${row.reasons.join(' · ')}` }); continue; }
    const scope = scopeOfRow(row);
    if (!scope) { held.push({ row, reason: `scope "${row.scope.replace(/<br\s*\/?>/g, ' ')}" does not map to a single scope node` }); continue; }
    let spec;
    try { spec = parseCharacters(row.validCharactersRaw); } catch (e) { held.push({ row, reason: `characters: ${e.message}` }); continue; }
    const ns = row.provider;
    const segs = segsOf(row.entity);
    const resourceType = resourceTypeOf(ns, segs, usedTypes);
    if (resourceType === null) { held.push({ row, reason: 'no resource type of 40 characters or fewer that is unique' }); continue; }
    usedTypes.add(resourceType);
    const cafHit = caf.get(id.replace(/\s+/g, '').toLowerCase());
    const gen = generationOf(spec);
    let slug = cafHit?.abbr ?? fallbackSlug(row.entity);
    if (gen.allowed === 'lower-digit' || gen.allowed === 'lower-digit-hyphen') slug = slug.toLowerCase();
    if (![...slug].every((c) => allows(spec, c))) slug = '';
    if (!charClasses.has(row.validCharactersRaw)) {
      charClasses.set(row.validCharactersRaw, { key: `C${String(charClasses.size + 1).padStart(2, '0')}`, pattern: patternOf(spec), spec, gen });
    }
    const cls = charClasses.get(row.validCharactersRaw);
    rules.push({
      row, id: `azure.${resourceType}`, resourceType, entity: id, scope, cls: cls.key,
      displayName: cafHit?.name ?? `${ns.replace(/^Microsoft\./, '')} ${segs.join(' / ')}`,
      slug, slugSource: cafHit ? 'caf' : 'derived', category: categoryOf(ns), min: row.length.min, max: row.length.max,
      reserved: scope === 'azure:global',
      cases: casesOf(spec, row.length.min, row.length.max),
    });
  }
  // 범위 노드의 ruleId — 부모 Entity 를 이번에 등록했으면 그 규칙
  const ruleByEntity = new Map(rules.map((r) => [r.entity.toLowerCase(), r]));
  for (const s of scopes.values()) {
    const r = ruleByEntity.get(s.entity.toLowerCase());
    s.ruleId = r && r.scope === s.parent ? r.id : undefined;
  }
  for (const h of held) { const why = HAND_REVIEWED[entityId(h.row)]; if (why) h.reason = why; }
  return { rules, held, scopes: [...scopes.values()], charClasses: [...charClasses.entries()] };
}

// ── 출력 ──────────────────────────────────────────────────────────
export function renderTs(result, meta) {
  const { rules, scopes, charClasses } = result;
  const L = [];
  L.push('// 생성 파일 — 손으로 고치지 않는다. scripts/rules/build-azure-rules.mjs 로 다시 만든다 (D43).');
  L.push(`// 출처: resource-name-rules 원문 커밋 ${metaToken(meta.commit)} (ms.date ${metaToken(meta.msDate)}) · 접두 약어는 Microsoft CAF 약어 쪽(없으면 docs/azure-intake-held.md 의 규칙).`);
  L.push('// 문자 규칙 표의 키는 원문 「Valid Characters」 칸 그대로다 — 원문 → 정규식이 리뷰 자리다. 길이는 minLength · maxLength 가 센다(validate.ts).');
  L.push("import type { Allowed, ResourceRule } from '../types';");
  L.push("import type { ScopeDef } from '../scopes';");
  L.push('');
  L.push('interface CharClass { raw: string; pattern: RegExp; allowed: Allowed; separator: \'\' | \'-\'; caseRule: \'lower\' | \'any\'; startsWithLetter: boolean; endsWithAlnum: boolean; noConsecutiveSeparator?: boolean }');
  L.push('');
  L.push('const CHARS: Record<string, CharClass> = {');
  for (const [raw, c] of charClasses) {
    const g = c.gen;
    const ncs = c.spec.noDoubleHyphen ? ', noConsecutiveSeparator: true' : '';
    // 금지형(Can't use …)은 INVISIBLE_CLASS(\p{Cc} 와 \u 범위)를 쓰려고 u 플래그 — 원문이 control characters 를 말하지 않아도 막는다(문서보다 넓게 · 보수적)
    const flags = c.pattern.includes('\\p{') ? 'u' : '';
    if (!/^C[0-9]+$/.test(c.key)) throw new Error(`문자 규칙 키 꼴이 아니다: ${c.key}`);
    L.push(`  ${c.key}: { raw: ${dq(raw)}, pattern: ${regexLit(c.pattern, flags)}, allowed: ${sq(g.allowed)}, separator: ${sq(g.separator)}, caseRule: ${sq(g.caseRule)}, startsWithLetter: ${boolLit(g.startsWithLetter)}, endsWithAlnum: ${boolLit(g.endsWithAlnum)}${ncs} },`);
  }
  L.push('};');
  L.push('');
  L.push(`export type AzureIntakeScopeId =\n${scopes.map((s) => `  | ${idLit(s.id)}`).join('\n')};`);
  L.push('');
  L.push('/** 부모 리소스 범위 — 표의 Scope 칸이 부모 리소스 이름이다. parent 는 부모 행의 Scope, ruleId 는 부모 규칙(이번에 등록했을 때만) */');
  L.push('export const AZURE_INTAKE_SCOPES: Record<AzureIntakeScopeId, ScopeDef> = {');
  for (const s of scopes) {
    const rid = s.ruleId ? `, ruleId: ${idLit(s.ruleId)}` : '';
    L.push(`  ${idLit(s.id)}: { id: ${idLit(s.id)}, provider: 'azure', displayName: ${dq(s.displayName)}, parent: ${idLit(s.parent)}${rid}, docUrl: ${sq(`${AZURE_RULES_URL}#${s.anchor}`)} },`);
  }
  L.push('};');
  L.push('');
  L.push('/** 행 — entity · scope · 길이 · 문자 규칙 키 · 약어 · 분류. reserved = 전역 이름(엔드포인트) 이라 예약어를 건다 */');
  L.push('interface Row { id: string; displayName: string; entity: string; scope: ResourceRule[\'scope\']; anchor: string; min: number; max: number; chars: keyof typeof CHARS; slug: string; category: ResourceRule[\'category\']; reserved?: boolean }');
  L.push('');
  L.push('export const AZURE_INTAKE_ROWS: Row[] = [');
  for (const r of rules) {
    L.push(`  { id: ${idLit(r.id)}, displayName: ${dq(r.displayName)}, entity: ${sq(r.entity)}, scope: ${idLit(r.scope)}, anchor: ${sq(r.row.anchor)}, min: ${intLit(r.min)}, max: ${intLit(r.max)}, chars: ${sq(r.cls)}, slug: ${sq(r.slug)}, category: ${sq(r.category)}${r.reserved ? ', reserved: true' : ''} },`);
  }
  L.push('];');
  L.push('');
  L.push('export { CHARS as AZURE_INTAKE_CHARS };');
  return `${L.join('\n')}\n`;
}

export function renderHeld(result, meta) {
  const L = [];
  L.push('# Azure rules not imported yet');
  L.push('');
  L.push(`Source: [resource-name-rules](${AZURE_RULES_URL}) (upstream commit \`${meta.commit}\`, ms.date ${meta.msDate}). Generated by \`scripts/rules/build-azure-rules.mjs\` — do not edit by hand.`);
  L.push('');
  L.push(`Imported: **${result.rules.length}** rows as rules (plus the rows covered by hand-written rules, including those added by hand). Held: **${result.held.length}** rows, listed below with the reason.`);
  L.push('');
  L.push('## How the imported rows were mapped');
  L.push('');
  L.push('- **Pattern** — each distinct *Valid Characters* cell is read with a fixed sentence grammar (character kinds, `Can\'t use:` lists, start/end sentences, consecutive hyphens). A sentence outside the grammar stops the generator; nothing is guessed. Lengths are checked by `minLength`/`maxLength`.');
  L.push('- **Scope** — `resource group` · `global` · `subscription` map to the existing scope nodes; `region` / `Azure region` map to a new `azure:region` node under the subscription; `resource group & region` is read as resource group (stricter). `tenant` maps to a new `azure:tenant` node under global; `subscription or resource group` and `scope of assignment` are placed at the subscription (the wider node is the conservative reading for uniqueness, as for the hand-written policy rules). Any other value names a parent resource (`service`, `namespace`, …): a scope node is created for the parent entity, placed under the parent row\'s own scope; App Service `sites` children use the hand-written `azure:web/sites` node.');
  L.push('- **Prefix (slug)** — the abbreviation from the Microsoft Cloud Adoption Framework [abbreviation list](' + CAF_URL + ') when the namespace/entity matches exactly (entries split by `kind` are skipped). Otherwise: the initials of the last entity segment when it has two or more words (`authorizationServers` → `as`), or its first three letters (`apis` → `api`). A slug the row\'s characters cannot hold is left empty.');
  L.push('- **Reserved words** — rows whose scope is `global` (names that become endpoints) get the Azure reserved-word check, like the existing storage account, key vault and SQL server rules.');
  L.push('- **Reviewed by hand** — the held rows were read again in the table and the pages it links. Rows with a complete rule were added by hand in `src/core/rules/azure-manual.ts` with the table text quoted; the reason of the others starts with "reviewed by hand".');
  L.push('');
  L.push('## Held rows');
  L.push('');
  L.push('| Provider | Entity | Scope | Length | Reason |');
  L.push('|---|---|---|---|---|');
  const cell = (s) => String(s).replace(/<br\s*\/?>/g, ' ').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  for (const { row, reason } of result.held) L.push(`| ${row.provider} | ${cell(row.entity)} | ${cell(row.scope)} | ${cell(row.lengthRaw)} | ${cell(reason)} |`);
  return `${L.join('\n')}\n`;
}

function main(argv) {
  if (argv.length < 2) {
    console.error('사용: node scripts/rules/build-azure-rules.mjs <intake.json> <resource-abbreviations.html> [--existing existing.json] [--commit sha]');
    return 2;
  }
  const intake = JSON.parse(readFileSync(argv[0], 'utf-8'));
  const caf = cafAbbreviations(readFileSync(argv[1], 'utf-8'));
  const take = (flag) => { const i = argv.indexOf(flag); return i < 0 ? null : argv[i + 1]; };
  const existing = take('--existing') ? JSON.parse(readFileSync(take('--existing'), 'utf-8')) : [];
  const meta = { commit: take('--commit') ?? 'unknown', msDate: intake.msDate };
  const result = build(intake, caf, existing);
  writeFileSync('src/core/rules/azure-intake.ts', renderTs(result, meta));
  writeFileSync('docs/azure-intake-held.md', renderHeld(result, meta));
  const snapshot = {
    source: AZURE_RULES_URL, commit: meta.commit, msDate: meta.msDate,
    license: 'Rows quoted from Microsoft Learn (azure-docs, CC BY 4.0) for transcription tests.',
    rows: intake.rows.map((r) => ({ entity: entityId(r), scope: r.scope, length: r.lengthRaw, characters: r.validCharactersRaw, judgement: r.judgement, anchor: r.anchor })),
  };
  writeFileSync('src/core/__fixtures__/azure-intake.json', `${JSON.stringify(snapshot, null, 1)}\n`);
  const cases = Object.fromEntries(result.rules.map((r) => [r.id, r.cases]));
  writeFileSync('src/core/__fixtures__/rule-cases-azure-intake.json', `${JSON.stringify(cases, null, 1)}\n`);
  // openapi.json 은 정적 파일이다 — NameItem.scope enum 을 전체 SCOPES(손 범위 포함)에 맞춘다. 방금 쓴 azure-intake.ts 를 다시 읽는다
  const api = syncScopeEnum(JSON.parse(readFileSync('public/openapi.json', 'utf-8')), scopeIdsFromSources((f) => readFileSync(f, 'utf-8')));
  writeFileSync('public/openapi.json', `${JSON.stringify(api, null, 2)}\n`);
  const bySlug = result.rules.filter((r) => r.slugSource === 'caf').length;
  console.error(`규칙 ${result.rules.length} · 보류 ${result.held.length} · 새 범위 ${result.scopes.length} · 문자 규칙 ${result.charClasses.length} · CAF 약어 ${bySlug}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
