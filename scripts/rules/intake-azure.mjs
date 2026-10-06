// Azure resource-name-rules 변환기 (D43) — GitHub 원문 마크다운의 표를 후보 JSON 으로 바꾼다.
// 개발 때만 돈다(번들 · CI 밖). constraints.ts 를 쓰지 않는다 — 사람이 행마다 pattern 을 정한다.
//
// 사용: node scripts/rules/intake-azure.mjs <resource-name-rules.md> [--html <게시 쪽 HTML>] [--out <json>]
//   원문: MicrosoftDocs/azure-docs 의 articles/azure-resource-manager/management/resource-name-rules.md
//   --html 을 주면 게시 쪽의 h2 id 와 앵커를 대어 맞지 않는 행에 anchorMissing: true 를 단다
//
// 「정형」은 원문 칸의 모양이 기계로 뽑을 수 있는 꼴이라는 뜻일 뿐 규칙이 맞다는 뜻이 아니다.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const AZURE_RULES_URL = 'https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules';
const HEADER = ['Entity', 'Scope', 'Length', 'Valid Characters'];

/** 게시 쪽 h2 id 를 만드는 규칙 — 소문자 · 영숫자와 공백 · 하이픈만 남기고 공백은 하이픈으로 */
export function anchorOf(heading) {
  return heading.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/\s+/g, '-');
}

/** 게시 쪽 HTML 의 h2 id 목록 */
export function h2IdsOf(html) {
  return [...html.matchAll(/<h2\b[^>]*\bid="([^"]*)"/g)].map((m) => m[1]);
}

/** `> | a | b |` 줄을 칸으로 나눈다 — 백틱 안의 | 는 칸 구분이 아니다 */
export function splitCells(line) {
  let s = line.replace(/^>\s?/, '').trim();
  if (!s.startsWith('|')) return null;
  s = s.slice(1);
  const cells = [];
  let cur = '';
  let inCode = false;
  for (const ch of s) {
    if (ch === '`') inCode = !inCode;
    if (ch === '|' && !inCode) {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim() !== '') cells.push(cur.trim());
  return cells;
}

const isSeparator = (cells) => cells.every((c) => /^:?-{3,}:?$/.test(c));
const isHeader = (cells) => cells.length === HEADER.length && cells.every((c, i) => c === HEADER[i]);

// ── 판정 ─────────────────────────────────────────────────────────────
// 정형 판정 규칙: Length 가 N 또는 N-M 이고, Valid Characters 를 <br> 로 나눈
// 토막마다 ① 문자 종류 나열 ② `Can't use: `…` or control characters` ③ 시작 · 끝 · 연속 하이픈의
// 정해진 문장 — 중 하나에 맞으면 정형. 「Must be `x`」 · 「Use one of」 · GUID · 「Must be in format」은 고정값.

const CHAR_KINDS = new Set([
  'alphanumerics', 'alphanumeric', 'alphnumeric', 'lowercase letters', 'letters', 'numbers', 'hyphens',
  'underscores', 'periods', 'parentheses', 'spaces', 'slashes', 'letters or numbers', 'lowercase letters or numbers',
]);

function isCharKindList(seg) {
  const s = seg.replace(/^Only /, '').replace(/ are valid\.?$/, '').replace(/\.$/, '').trim();
  const parts = s.split(/,\s*(?:and\s+|or\s+)?|\s+and\s+/).map((p) => p.trim().toLowerCase()).filter(Boolean);
  return parts.length > 0 && parts.every((p) => CHAR_KINDS.has(p));
}

const isForbiddenList = (seg) => /^Can't use: `[^`]+`(?: or (?:control characters|space))?\.?$/.test(seg);

const CLS = '(?:a |an )?(?:lowercase )?(?:letter|letters|alphanumerics?|alphnumeric|number|letter or number|letter, number, or underscore|alphanumeric or underscore|lowercase letter or number|lowercase letter)';
const EDGE_ITEM = '(?:a |an )?(?:hyphens?|period|space|underscore|number)';
const EDGE = `${EDGE_ITEM}(?:(?:, or |, | or )${EDGE_ITEM})*`;
const SENTENCES = [
  new RegExp(`^(?:start|end|start and end|must begin and end)(?: with)? ${CLS}(?:,? (?:and |;)?\\s*end(?: with)? ${CLS})?$`, 'i'),
  new RegExp(`^can't (?:start|end|start or end|start with or end)(?: with| in)? ${EDGE}$`, 'i'),
  /^(?:can't use|can't contain) consecutive hyphens$/i,
  /^consecutive hyphens (?:not allowed|aren't allowed)$/i,
  // 문자 종류 하나를 빼는 문장 — 나열과 함께 읽으면 정형이다
  /^(?:can't use (?:underscores|periods|spaces)|(?:underscores|periods|spaces) aren't supported)$/i,
];

function isEdgeSentences(seg) {
  const sentences = seg.split(/\.\s+|;\s*/).map((x) => x.replace(/\.$/, '').trim()).filter(Boolean);
  return sentences.length > 0 && sentences.every((x) => SENTENCES.some((re) => re.test(x)));
}

const FIXED = /^(?:Must be `|Must be a GUID|Must be a globally unique identifier|Use one of:|Must be in format:|Should always be|Only predefined values)/;

export function judge(lengthRaw, validRaw) {
  const reasons = [];
  const lengthOk = /^\d+(-\d+)?$/.test(lengthRaw);
  if (!lengthOk) reasons.push(`length: ${lengthRaw || '(빈칸)'}`);
  // 「Can't use:<br>`…`」 는 한 문장이다 — 줄바꿈을 먼저 잇는다
  const joined = validRaw.replace(/Can't use:\s*(?:<br\s*\/?>)+\s*/g, "Can't use: ");
  const segs = joined.split(/<br\s*\/?>/).map((x) => x.trim()).filter(Boolean);
  if (segs.length > 0 && FIXED.test(segs[0])) return { judgement: 'fixed', manual: [], reasons: [] };
  const bad = segs.filter((x) => !(isCharKindList(x) || isForbiddenList(x) || isEdgeSentences(x)));
  if (segs.length === 0) bad.push('(빈칸)');
  for (const b of bad) reasons.push(`characters: ${b}`);
  const manual = [];
  if (!lengthOk) manual.push('length');
  if (bad.length > 0) manual.push('characters');
  return { judgement: manual.length === 0 ? 'formal' : 'manual', manual, reasons };
}

function parseLength(raw) {
  const m = /^(\d+)(?:-(\d+))?$/.exec(raw);
  if (!m) return null;
  return { min: Number(m[1]), max: Number(m[2] ?? m[1]) };
}

/**
 * @param {string} md 원문 마크다운
 * @param {{ h2Ids?: string[] }} [opts] 게시 쪽 h2 id 목록 — 주면 앵커를 잰다
 */
export function parseAzureRules(md, opts = {}) {
  const ids = opts.h2Ids ? new Set(opts.h2Ids) : null;
  const msDate = /^ms\.date:\s*(\S+)/m.exec(md)?.[1] ?? null;
  const lines = md.split('\n');
  const rows = [];
  const providers = [];
  let current = null;
  let headerRows = 0;
  let inTable = false;
  lines.forEach((line, i) => {
    const h2 = /^## (.+?)\s*$/.exec(line);
    if (h2) {
      current = { heading: h2[1], provider: h2[1].replace(/\s*\(.*\)\s*$/, ''), anchor: anchorOf(h2[1]), rows: 0 };
      providers.push(current);
      inTable = false;
      return;
    }
    if (!/^>\s?\|/.test(line)) {
      inTable = false;
      return;
    }
    const cells = splitCells(line);
    if (isHeader(cells)) {
      if (!current) throw new Error(`${i + 1}행: 공급자(## ) 절 밖에 규칙 표가 있다`);
      headerRows += 1;
      inTable = true;
      return;
    }
    if (!inTable) return; // 머리줄 없는 인용 표(NOTE 등)는 규칙 표가 아니다
    if (isSeparator(cells)) return;
    if (cells.length !== HEADER.length) throw new Error(`${i + 1}행: 칸이 ${cells.length}개다(4개여야 한다) — ${line.slice(0, 80)}`);
    const [entityRaw, scope, lengthRaw, validCharactersRaw] = cells;
    const footnote = /\\\*$/.test(entityRaw);
    const entity = entityRaw.replace(/\\\*$/, '').replace(/\\(.)/g, '$1').trim();
    const j = judge(lengthRaw, validCharactersRaw);
    current.rows += 1;
    rows.push({
      key: `${current.provider}|${entity}`,
      provider: current.provider,
      providerHeading: current.heading,
      entity,
      entityRaw,
      footnote,
      scope,
      lengthRaw,
      length: parseLength(lengthRaw),
      validCharactersRaw,
      ...j,
      anchor: current.anchor,
      anchorMissing: ids ? !ids.has(current.anchor) : null,
      docUrl: `${AZURE_RULES_URL}#${current.anchor}`,
      line: i + 1,
    });
  });
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.key)) throw new Error(`${r.line}행: 공급자+Entity 중복 — ${r.key}`);
    seen.add(r.key);
  }
  const used = providers.filter((p) => p.rows > 0);
  const count = (f) => rows.filter(f).length;
  return {
    source: AZURE_RULES_URL,
    msDate,
    counts: {
      rows: rows.length,
      headerRows,
      providers: used.length,
      uniqueKeys: seen.size,
      anchors: new Set(used.map((p) => p.anchor)).size,
      anchorsMissing: ids ? used.filter((p) => !ids.has(p.anchor)).length : null,
      judgement: {
        formal: count((r) => r.judgement === 'formal'),
        fixed: count((r) => r.judgement === 'fixed'),
        manualCharacters: count((r) => r.manual.length === 1 && r.manual[0] === 'characters'),
        manualLength: count((r) => r.manual.length === 1 && r.manual[0] === 'length'),
        manualBoth: count((r) => r.manual.length === 2),
      },
    },
    providers: used.map(({ heading, provider, anchor, rows: n }) => ({ heading, provider, anchor, rows: n })),
    rows,
  };
}

function main(argv) {
  const args = [...argv];
  const take = (flag) => {
    const i = args.indexOf(flag);
    if (i < 0) return null;
    const [, v] = args.splice(i, 2);
    return v;
  };
  const htmlPath = take('--html');
  const out = take('--out');
  if (args.length !== 1) {
    console.error('사용: node scripts/rules/intake-azure.mjs <resource-name-rules.md> [--html <page.html>] [--out <json>]');
    return 2;
  }
  const h2Ids = htmlPath ? h2IdsOf(readFileSync(htmlPath, 'utf-8')) : undefined;
  const result = parseAzureRules(readFileSync(args[0], 'utf-8'), { h2Ids });
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (out) writeFileSync(out, json);
  else process.stdout.write(json);
  console.error(`Azure 후보 ${result.counts.rows}행 · 공급자 ${result.counts.providers} · 판정 ${JSON.stringify(result.counts.judgement)}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
