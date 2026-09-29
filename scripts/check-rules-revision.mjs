// 규칙 버전 대조 (D26) — main 의 rules-fingerprint.json 과 작업 트리의 파일을 대어 본다.
// 지문이 바뀌었는데 revision 이 같거나, revision 이 바뀌었는데 지문이 같으면 exit 1.
// 사용: node scripts/check-rules-revision.mjs <main 의 파일 | 없으면 생략> <작업 트리의 파일>
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args.length === 1) {
  console.log('main 에 rules-fingerprint.json 이 아직 없다 — 첫 도입이라 통과');
  process.exit(0);
}
if (args.length !== 2) {
  console.error('사용: node scripts/check-rules-revision.mjs [base.json] head.json');
  process.exit(2);
}
const [base, head] = args.map((p) => JSON.parse(readFileSync(p, 'utf-8')));
const fingerprintChanged = base.fingerprint !== head.fingerprint;
const revisionChanged = base.revision !== head.revision;
if (fingerprintChanged && !revisionChanged) {
  console.error(`규칙 지문이 바뀌었는데 revision 이 ${head.revision} 그대로다 — src/core/revision.ts 의 RULES_REVISION 을 올린다`);
  process.exit(1);
}
if (revisionChanged && !fingerprintChanged) {
  console.error(`revision 이 ${base.revision} → ${head.revision} 로 바뀌었는데 지문이 같다 — 규칙이 바뀌지 않았으면 revision 을 올리지 않는다`);
  process.exit(1);
}
console.log(`규칙 버전 대조 통과 — revision ${head.revision}`);
