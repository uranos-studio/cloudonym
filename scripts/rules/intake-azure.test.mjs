// intake-azure.mjs 시험 — 고정 표본(fixtures/azure-sample.md)으로 표 해석 · 판정 · 앵커를 본다.
// 실제 원문의 수(402 · 85)는 check-sources 가 lock 의 counts 로 지킨다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { parseAzureRules, anchorOf, splitCells, h2IdsOf, judge, AZURE_RULES_URL } from './intake-azure.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const md = readFileSync(join(here, 'fixtures/azure-sample.md'), 'utf-8');
const html = readFileSync(join(here, 'fixtures/azure-sample.html'), 'utf-8');

test('데이터 행만 센다 — 머리줄 · 구분줄 · 공급자 밖 인용 표는 행이 아니다', () => {
  const r = parseAzureRules(md);
  assert.equal(r.rows.length, 7);
  assert.equal(r.counts.rows, 7);
  assert.equal(r.counts.headerRows, 2);
  assert.equal(r.rows.filter((x) => x.entity === 'Entity' || /^-+$/.test(x.entity)).length, 0);
});

test('머리줄이 데이터 자리에 섞이면 행으로 세지 않고 headerRows 로 센다', () => {
  const mixed = md.replace(
    '> | defaults | servers | 7 |',
    '> | Entity | Scope | Length | Valid Characters |\n> | defaults | servers | 7 |',
  );
  const r = parseAzureRules(mixed);
  assert.equal(r.rows.length, 7);
  assert.equal(r.counts.headerRows, 3);
});

test('공급자는 행이 있는 h2 만 — Next steps 는 공급자가 아니다', () => {
  const r = parseAzureRules(md);
  assert.deepEqual(r.providers.map((p) => p.heading), ['Microsoft.Sample', 'Microsoft.Other (preview)']);
  assert.equal(r.counts.providers, 2);
});

test('같은 Entity(servers)를 네임스페이스로 구분한다 — 공급자+Entity 키가 행마다 고유하다', () => {
  const r = parseAzureRules(md);
  const servers = r.rows.filter((x) => x.entity === 'servers');
  assert.equal(servers.length, 2);
  assert.deepEqual(servers.map((x) => x.provider), ['Microsoft.Sample', 'Microsoft.Other']);
  assert.notEqual(servers[0].key, servers[1].key);
  assert.equal(r.counts.uniqueKeys, r.rows.length);
  assert.equal(new Set(r.rows.map((x) => x.key)).size, r.rows.length);
});

test('같은 공급자에 같은 Entity 가 두 번 나오면 실패한다', () => {
  const dup = md.replace('> | defaults | servers | 7 |', '> | servers | servers | 7 |');
  assert.throws(() => parseAzureRules(dup), /중복/);
});

test('코드 안의 | 는 칸 구분이 아니다 — 칸이 4개가 아니면 실패한다', () => {
  assert.deepEqual(splitCells('> | a | b | `x|y` | d |'), ['a', 'b', '`x|y`', 'd']);
  const bad = md.replace('> | defaults | servers | 7 |', '> | defaults | servers | 7 | extra |');
  assert.throws(() => parseAzureRules(bad), /칸/);
});

test('공급자 절 밖의 규칙 표 행은 실패한다', () => {
  const orphan = md.replace('# Sample naming rules\n', '# Sample naming rules\n\n> | Entity | Scope | Length | Valid Characters |\n> | --- | --- | --- | --- |\n> | x | y | 1-2 | z |\n');
  assert.throws(() => parseAzureRules(orphan), /공급자/);
});

test('원문 칸 · 길이 파싱 · Entity 각주 표시', () => {
  const r = parseAzureRules(md);
  const s = r.rows.find((x) => x.key === 'Microsoft.Sample|servers');
  assert.equal(s.scope, 'resource group');
  assert.equal(s.lengthRaw, '3-63');
  assert.deepEqual(s.length, { min: 3, max: 63 });
  assert.equal(s.validCharactersRaw, 'Lowercase letters and numbers<br><br>Start with a lowercase letter.');
  const d = r.rows.find((x) => x.key === 'Microsoft.Sample|defaults');
  assert.deepEqual(d.length, { min: 7, max: 7 });
  const st = r.rows.find((x) => x.entityRaw === 'stores\\*');
  assert.equal(st.entity, 'stores');
  assert.equal(st.footnote, true);
  const rep = r.rows.find((x) => x.entity === 'stores / replicas');
  assert.equal(rep.length, null);
});

test('정형 / 손 확인 / 고정값 판정과 이유', () => {
  const r = parseAzureRules(md);
  const j = Object.fromEntries(r.rows.map((x) => [x.key, x]));
  assert.equal(j['Microsoft.Sample|servers'].judgement, 'formal');
  assert.equal(j['Microsoft.Sample|servers / databases'].judgement, 'formal');
  assert.equal(j['Microsoft.Sample|defaults'].judgement, 'fixed');
  assert.equal(j['Microsoft.Other|servers'].judgement, 'formal');
  assert.equal(j['Microsoft.Other|stores'].judgement, 'manual');
  assert.deepEqual(j['Microsoft.Other|stores'].manual, ['characters']);
  assert.deepEqual(j['Microsoft.Other|stores / replicas'].manual, ['length']);
  assert.deepEqual(j['Microsoft.Other|machines'].manual, ['length', 'characters']);
  assert.ok(j['Microsoft.Other|machines'].reasons.length >= 2);
  assert.deepEqual(r.counts.judgement, { formal: 3, fixed: 1, manualCharacters: 1, manualLength: 1, manualBoth: 1 });
});

test('금지 문자 · 시작 문장의 여러 꼴을 정형으로 본다', () => {
  for (const v of [
    "Alphanumerics and hyphens<br><br>Can't use underscores.",
    'Alphanumerics and hyphens. <br><br>Start with alphanumeric.<br><br>Underscores aren\'t supported.',
    "Can't use:<br>`/` <br><br>Can't end with a space or period.",
    "Lowercase letters and numbers<br><br>Can't start with a number.",
    'Can\'t use:<br>`<>*&@:?+/\\,;=.|[]"` or space<br><br>Can\'t start with underscore, hyphen, or number. Can\'t end with underscore or hyphen.',
  ]) {
    assert.equal(judge('1-10', v).judgement, 'formal', v);
  }
  assert.equal(judge('1-10', "Can't contain `-ondemand`.").judgement, 'manual');
});

test('docUrl 은 게시 쪽 URL + 공급자 h2 앵커다', () => {
  assert.equal(anchorOf('Microsoft.Sample'), 'microsoftsample');
  assert.equal(anchorOf('Microsoft.ElasticSan (preview)'), 'microsoftelasticsan-preview');
  const r = parseAzureRules(md);
  const o = r.rows.find((x) => x.key === 'Microsoft.Other|servers');
  assert.equal(o.docUrl, `${AZURE_RULES_URL}#microsoftother-preview`);
  assert.equal(r.msDate, '01/02/2026');
});

test('게시 쪽 h2 id 와 대어 없는 앵커는 anchorMissing', () => {
  const ids = h2IdsOf(html);
  assert.deepEqual(ids, ['ms--in-this-article', 'microsoftsample', 'next-steps']);
  const r = parseAzureRules(md, { h2Ids: ids });
  assert.equal(r.rows.find((x) => x.provider === 'Microsoft.Sample').anchorMissing, false);
  assert.equal(r.rows.find((x) => x.provider === 'Microsoft.Other').anchorMissing, true);
  assert.equal(r.counts.anchors, 2);
  assert.equal(r.counts.anchorsMissing, 1);
  // h2 를 주지 않으면 재지 않았다는 뜻으로 null
  assert.equal(parseAzureRules(md).rows[0].anchorMissing, null);
});

test('CLI — 후보 JSON 을 쓴다', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'intake-azure-')), 'azure.json');
  const p = spawnSync(process.execPath, [join(here, 'intake-azure.mjs'), join(here, 'fixtures/azure-sample.md'), '--html', join(here, 'fixtures/azure-sample.html'), '--out', out], { encoding: 'utf-8' });
  assert.equal(p.status, 0, p.stderr);
  const j = JSON.parse(readFileSync(out, 'utf-8'));
  assert.equal(j.rows.length, 7);
  assert.equal(j.counts.anchorsMissing, 1);
});
