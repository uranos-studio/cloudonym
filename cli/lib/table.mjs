// @ts-check
// 사람에게 보이는 이름 표 (D121 · 설계 §6) — What · Name · Check 세 칸(--keys 면 Key 칸 하나 더). 터미널에서만 쓴다 — 파이프 · --json 의 출력 꼴은 그대로다.
// What 은 /catalog.json 에서 찾는다: 프리셋 label → 행 displayName → resource_type. 딸린 것은 부모 줄 아래 들여 써서 attach 칸으로 보인다
import { isRecord } from './plan.mjs';

/** 딸린 것의 사람 이름 — 화면 글자일 뿐 규칙이 아니다. 표에 없는 종류는 자식 행 이름으로 */
const ATTACH_LABEL = /** @type {Record<string, string>} */ ({ boot: 'boot disk', data: 'data disk', ip: 'static external IP address', ipi: 'static internal IP address' });

/** 묻는 글자로도 쓴다 — 질문은 「… — boot disk?」 · 「… — data disks?」 @param {{ attach: string, child?: string }} row @param {any} [cat] */
export function attachLabel(row, cat) {
  return ATTACH_LABEL[row.attach] ?? `${row.attach} (${rowName(cat, row.child) ?? row.child ?? row.attach})`;
}

/** 규칙 id 의 행 이름 @param {any} cat @param {string | undefined} rule */
function rowName(cat, rule) {
  if (!rule || !cat || !Array.isArray(cat.rows)) return undefined;
  const row = cat.rows.find((/** @type {any} */ r) => isRecord(r?.rules) && rule in r.rules);
  return typeof row?.displayName === 'string' ? row.displayName : undefined;
}

/**
 * 항목 하나의 프리셋 — 규칙(provider.resource_type) · 자리(프로젝트 공용인가) · tier(프리셋 tier 또는 tier_choices 안)가 맞는 첫 프리셋
 * @param {any} item @param {any} cat @param {string} provider
 */
function presetOf(item, cat, provider) {
  if (!cat || !Array.isArray(cat.presets)) return undefined;
  const rule = `${provider}.${item.resource_type}`;
  const level = item.level === 'project' ? 'project' : 'service';
  const tier = item.tier ?? null;
  return cat.presets.find((/** @type {any} */ p) => p.rule === rule && (p.level ?? 'service') === level
    && ((p.tier ?? null) === tier || (Array.isArray(p.tier_choices) && p.tier_choices.includes(tier))));
}

/**
 * 표의 What 칸 — 「Web server 01 (shop)」 · 딸린 것은 「  boot disk」 · 「  data disk 01」
 * @param {any} item exportName 꼴(key · namespace · resource_type · level · tier · seq · role · attach) @param {any} cat @param {string} provider
 */
export function whatOf(item, cat, provider) {
  if (typeof item.attach === 'string') return `  ${attachLabel({ attach: item.attach, child: `${provider}.${item.resource_type}` }, cat)}${item.seq ? ` ${item.seq}` : ''}`;
  const label = presetOf(item, cat, provider)?.label ?? rowName(cat, `${provider}.${item.resource_type}`) ?? item.resource_type ?? item.key;
  const ns = item.namespace && item.namespace !== 'project' ? ` (${item.namespace})` : '';
  return `${label}${item.seq ? ` ${item.seq}` : ''}${item.role ? ` ${item.role}` : ''}${ns}`;
}

/**
 * 표 줄 — 열은 padEnd 로 맞추고 사이는 두 칸. 마지막 칸은 채우지 않는다
 * @param {{ item: any, valid: boolean, messages?: string[] }[]} rows @param {any} cat @param {string} provider @param {boolean} keys
 * @returns {string[]}
 */
export function nameTable(rows, cat, provider, keys) {
  const head = keys ? ['What', 'Name', 'Check', 'Key'] : ['What', 'Name', 'Check'];
  const body = rows.map(({ item, valid, messages }) => {
    const check = valid ? 'PASS' : `FAIL${messages && messages.length > 0 ? ` — ${messages.join(' ')}` : ''}`;
    const cells = [whatOf(item, cat, provider), String(item.name ?? ''), check];
    if (keys) cells.push(String(item.key));
    return cells;
  });
  const all = [head, ...body];
  // FAIL 문장은 길다 — Check 칸 너비는 PASS/FAIL 글자만으로 잰다(Key 칸이 그 뒤에 와도 줄이 무너지지 않게)
  const widths = head.map((_, c) => Math.max(...all.map((r) => (c === 2 ? (r[2] ?? '').split(' — ')[0] ?? '' : r[c] ?? '').length)));
  return all.map((r) => r.map((cell, c) => (c === r.length - 1 ? cell : cell.padEnd(widths[c] ?? 0))).join('  ').trimEnd());
}
