// 빌드 산출물(dist/)에 package.json 의 devDependencies 이름이 실리지 않았는지 본다 — 시험 전용 도구(ajv 등)가 런타임 번들에 들어가면 실패한다.
// 따옴표로 감싼 이름(`"ajv"` · `'ajv'`)과 `devDependencies` 글자를 찾는다 — 짧은 식별자를 줄인 이름이 우연히 같은 경우를 오탐하지 않게.
// 시험 전용 fixture(src/dev · `?fixture=`)도 실리면 안 된다 — DEV 가드 밖으로 새면 그 글자(FIXTURE_MARKERS)가 번들에 남는다 (계획 §7-4).
// 쓰는 법: node scripts/check-bundle.mjs [dist 폴더] — 걸리면 exit 1
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] ?? 'dist';
const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
const names = Object.keys(pkg.devDependencies ?? {});
/** src/dev/fixtureRules.ts · core/__fixtures__/conflict.ts 에만 있는 글자 */
const FIXTURE_MARKERS = ['fx500_', 'Fixture resource', 'test_conflict_', 'Test Conflict'];

function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.js') ? [p] : [];
  });
}

const js = files(root);
if (js.length === 0) {
  console.error(`check-bundle: ${root} 에 .js 가 없다 — 빌드를 먼저 돌린다`);
  process.exit(1);
}
const hits = [];
for (const f of js) {
  const text = readFileSync(f, 'utf-8');
  if (text.includes('devDependencies')) hits.push(`${f}: devDependencies`);
  for (const n of names) if (text.includes(`"${n}"`) || text.includes(`'${n}'`)) hits.push(`${f}: ${n}`);
  for (const m of FIXTURE_MARKERS) if (text.includes(m)) hits.push(`${f}: fixture ${m}`);
}
if (hits.length > 0) {
  console.error(`check-bundle: devDependency 또는 시험 전용 fixture 가 번들에 실렸다\n${hits.join('\n')}`);
  process.exit(1);
}
console.log(`check-bundle: ok — ${js.length} files, devDependencies ${names.length} names, fixture markers ${FIXTURE_MARKERS.length}, 0 hits`);
