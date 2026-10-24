// /llms.txt · /catalog.json 본문 상수 (D17 · D46) — src/api/static-bodies-source.ts 로 만들어 src/api/static-bodies.ts 에 쓴다.
// Worker 는 그 상수를 그대로 낸다 — 기동 때 본문을 만들지 않는다(라우트 · 카운터 · 요청 제한은 Worker 에 그대로 있다).
// 본문에 버전(engine · rules)이 들어 있다 — RULES_REVISION · package.json version · 규칙 · 문구를 바꾸면 다시 돌린다. 안 돌리면 src/api/static-bodies.test.ts 가 깨진다.
// 빌드 전에 돈다(package.json 의 prebuild). 손으로 고치지 않는다. 엔진은 확장자 없는 TS import 를 쓰므로 Vite 의 runnerImport 로 연다(gen-intro-examples.mjs 와 같다)
// 쓰는 법: node scripts/gen-static-bodies.mjs   (npm run static-bodies · npm run build 가 먼저 부른다)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { runnerImport } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'src/api/static-bodies.ts');

const { module } = await runnerImport(join(root, 'src/api/static-bodies-source.ts'), { configFile: false, root, logLevel: 'error' });
const { llms, catalog } = module.staticBodies();
// JSON.stringify 한 문자열은 그대로 JS 문자열 리터럴이다 — 읽으면 같은 글자가 된다(static-bodies.test 가 === 로 본다)
const text = [
  '// 생성 파일 — 손으로 고치지 않는다. scripts/gen-static-bodies.mjs 로 다시 만든다 (src/api/static-bodies-source.ts 의 결과).',
  '// /llms.txt · /catalog.json 본문 (D17 · D46) — Worker 가 기동 때 만들지 않도록 빌드 전에 상수로 박는다. static-bodies.test 가 지금 규칙으로 만든 것과 대어 본다',
  `export const LLMS_TEXT: string = ${JSON.stringify(llms)};`,
  `export const CATALOG_JSON: string = ${JSON.stringify(catalog)};`,
  '',
].join('\n');
let before = '';
try {
  before = readFileSync(out, 'utf-8');
} catch {
  // 처음 만든다
}
if (before !== text) {
  writeFileSync(out, text);
  console.log(`static bodies: wrote ${out.slice(root.length + 1)} (llms.txt ${llms.length} chars · catalog.json ${catalog.length} chars)`);
}
