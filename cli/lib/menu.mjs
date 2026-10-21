// @ts-check
// 부품 메뉴의 순서와 묶음 — 묻는 흐름(guide.mjs)과 「add <번호>」 안내(main.mjs)가 같은 번호를 쓴다.
// 번호는 늘 같은 평평한 순서다(프로젝트 공용 먼저, 그다음 서비스 부품 · 각각 /catalog.json presets 순서). 묶음은 /catalog.json 행의 category 에서 온다 — 여기서 외우는 분류는 없다

/**
 * 메뉴에 보일 프리셋 — 번호 n 은 1 부터
 * @param {any[]} presets @param {{ project: boolean, service: boolean }} show
 * @returns {{ project: any[], service: any[], ordered: any[] }}
 */
export function menuOrder(presets, show) {
  const project = show.project ? presets.filter((p) => p.level === 'project') : [];
  const service = show.service ? presets.filter((p) => p.level !== 'project') : [];
  return { project, service, ordered: [...project, ...service] };
}

/** 분류 이름을 화면 글자로 — 「networking」 → 「Networking」 @param {string} s */
const title = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * 묶음 — 프로젝트 공용은 한 묶음, 서비스 부품은 그 규칙 행의 category 로(없으면 preset.group · 그도 없으면 Other). 묶음 순서는 처음 나온 순서
 * @param {{ project: any[], service: any[] }} menu @param {any[]} rows /catalog.json 의 rows
 * @returns {{ label: string, items: { n: number, preset: any }[] }[]}
 */
export function menuGroups(menu, rows) {
  /** @type {Map<string, { n: number, preset: any }[]>} */
  const groups = new Map();
  const put = (/** @type {string} */ label, /** @type {{ n: number, preset: any }} */ it) => { const g = groups.get(label) ?? []; g.push(it); groups.set(label, g); };
  menu.project.forEach((preset, i) => put('Shared by the project', { n: i + 1, preset }));
  menu.service.forEach((preset, i) => {
    const row = rows.find((r) => r?.rules && typeof r.rules === 'object' && preset.rule in r.rules);
    const cat = typeof row?.category === 'string' ? row.category : typeof preset.group === 'string' ? preset.group : 'other';
    put(title(cat), { n: menu.project.length + i + 1, preset });
  });
  return [...groups.entries()].map(([label, items]) => ({ label, items }));
}

/**
 * 글자로 거르기 — label · id · 규칙 id 에 든 것(대소문자 무시)
 * @param {{ n: number, preset: any }[]} items @param {string} text
 */
export function filterItems(items, text) {
  const f = text.toLowerCase();
  // 규칙 id 는 provider 앞머리(gcp.)를 떼고 본다 — 떼지 않으면 g · c · p · . 이 모든 부품에 든다
  const rule = (/** @type {unknown} */ r) => (typeof r === 'string' ? r.replace(/^[a-z]+\./, '') : undefined);
  return items.filter(({ preset }) => [preset.label, preset.id, rule(preset.rule)].some((x) => typeof x === 'string' && x.toLowerCase().includes(f)));
}
