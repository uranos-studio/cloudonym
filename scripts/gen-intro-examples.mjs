// 소개 상자의 예시 한 줄 (D107) — 엔진으로 만들어 src/components/introExamples.json 에 쓴다. 화면은 그 JSON 만 읽는다.
// 빌드 전에 돈다(package.json 의 prebuild). 손으로 고치지 않는다 — src/components/introExamples.test.ts 가 엔진 결과와 같은지 본다.
// 엔진은 확장자 없는 TS import 를 쓰므로 Node 가 직접 못 연다 — Vite 의 runnerImport 로 연다. configFile:false 는 Cloudflare 플러그인을 띄우지 않으려는 것이다
// 쓰는 법: node scripts/gen-intro-examples.mjs   (npm run intro-examples · npm run build 가 먼저 부른다)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { runnerImport } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'src/components/introExamples.json');

const { module } = await runnerImport(join(root, 'src/components/introExampleModel.ts'), { configFile: false, root, logLevel: 'error' });
const example = module.buildIntroExample();
// 유효하지 않은 이름을 「PASS」로 내보내지 않는다 — 하나라도 valid:false 면 빌드를 멈춘다
const bad = example.rows.filter((r) => r.valid !== true);
if (bad.length > 0) {
  console.error(`intro example: names are not valid: ${bad.map((r) => r.name).join(', ')}`);
  process.exit(1);
}
const text = `${JSON.stringify(example, null, 2)}\n`;
let before = '';
try {
  before = readFileSync(out, 'utf-8');
} catch {
  // 처음 만든다
}
if (before !== text) {
  writeFileSync(out, text);
  console.log(`intro example: wrote ${out.slice(root.length + 1)} (rules ${example.rules})`);
}
