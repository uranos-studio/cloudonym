// openapi.json NameItem.scope enum 을 전체 SCOPES(손 범위 + 들인 범위)에 맞춘다 — Azure · GCP 생성기가 함께 쓴다.
// SCOPES 는 TS 라 .mjs 에서 바로 들일 수 없다. 범위 정의 줄은 모두 `'<id>': { id: '<id>', …` 꼴이므로 그 줄을 소스에서 읽는다.
// 등식 「소스에서 읽은 id = openapi enum」은 openapi-scopes.test.mjs 가, 「openapi enum = Object.keys(SCOPES)」는 src/api/openapi.test.ts 가 단언한다.

/** 범위 정의가 있는 파일 — scopes.ts 와 그것이 펼쳐 넣는 손 · 들인 범위 표 */
export const SCOPE_SOURCES = [
  'src/core/scopes.ts',
  'src/core/rules/azure-intake.ts',
  'src/core/rules/azure-manual.ts',
  'src/core/rules/gcp-intake.ts',
  'src/core/rules/gcp-manual.ts',
  'src/core/rules/aws-manual.ts',
];

const DEF = /^\s*'((?:aws|gcp|azure):[^']+)': \{ id: '([^']+)'/gm;

/** 소스에서 범위 id 를 정의 순서대로 읽는다 — 키와 id 가 다르면 멈춘다 */
export function scopeIdsFromSources(read, files = SCOPE_SOURCES) {
  const ids = [];
  for (const f of files) {
    for (const m of read(f).matchAll(DEF)) {
      if (m[1] !== m[2]) throw new Error(`${f}: 범위 키 ${m[1]} 와 id ${m[2]} 가 다르다`);
      if (!ids.includes(m[1])) ids.push(m[1]);
    }
  }
  return ids;
}

/** enum 을 ids 에 맞춘다 — 남은 것은 순서를 지키고, 없어진 것은 빼고, 새 것은 뒤에 붙인다 */
export function syncScopeEnum(api, ids) {
  const scope = api.components.schemas.NameItem.properties.scope;
  const kept = scope.enum.filter((x) => ids.includes(x));
  scope.enum = [...kept, ...ids.filter((x) => !kept.includes(x))];
  return api;
}
