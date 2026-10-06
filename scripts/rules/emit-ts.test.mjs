// 생성기 TS 리터럴 — 외부 원문의 따옴표 · 줄 바꿈 · 주석 닫기가 생성 코드로 새지 않는가
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sq, dq, idLit, intLit, boolLit, regexLit, metaToken, METHOD_RE } from './emit-ts.mjs';
import { renderTs as renderGcp } from './build-gcp-rules.mjs';
import { renderTs as renderAws } from './build-aws-rules.mjs';
import { renderTs as renderAzure } from './build-azure-rules.mjs';

/** 생성 코드 조각을 JS 로 읽어 값을 돌려준다 — 리터럴이 값 하나로 닫히는지 본다 */
const evalJs = (code) => new Function(`return (${code});`)();

const EVIL = [
  "it's", 'a\nb', 'a\r\nb', '*/ evil(); /*', "'); process.exit(1); ('", 'back\\slash', 'q"uote', `ls${String.fromCharCode(0x2028)}ps${String.fromCharCode(0x2029)}`, `nul${String.fromCharCode(0)}`, '${x}`',
];

test('sq — 특수 문자가 든 값도 한 줄 리터럴 하나로 닫히고 값이 같다', () => {
  for (const v of EVIL) {
    const lit = sq(v);
    assert.equal(evalJs(lit), v, JSON.stringify(v));
    assert.ok(!/[\n\r\u2028\u2029]/.test(lit), `줄 끝 문자가 리터럴에 그대로 있다: ${JSON.stringify(lit)}`);
    assert.ok(lit.startsWith("'") && lit.endsWith("'"));
  }
});
test('sq — 특수 문자가 없으면 예전 출력과 같다', () => {
  for (const v of ['azure.virtual_machine', 'https://learn.microsoft.com/a#b', 'Microsoft.Compute/virtualMachines', '']) assert.equal(sq(v), `'${v}'`);
  assert.throws(() => sq(1), /문자열이 아니다/);
});
test('dq — JSON.stringify 그대로이고 값이 같다', () => {
  for (const v of EVIL) assert.equal(evalJs(dq(v)), v);
});
test('idLit · METHOD_RE — 꼴이 아니면 멈춘다', () => {
  assert.equal(idLit('azure:apimanagement/service'), "'azure:apimanagement/service'");
  assert.equal(idLit('cloudkms.projects.locations.keyRings.create', METHOD_RE), "'cloudkms.projects.locations.keyRings.create'");
  for (const v of ["a'b", 'a\nb', 'A.b', 'a b', '', 1]) assert.throws(() => idLit(v), /식별자 꼴이 아니다/, String(v));
  for (const v of ["a'b", 'a\nb', 'a b', 'a/b']) assert.throws(() => idLit(v, METHOD_RE), /식별자 꼴이 아니다/, String(v));
});
test('intLit · boolLit', () => {
  assert.equal(intLit(63), '63');
  for (const v of ['1', 1.5, NaN, '1; evil()']) assert.throws(() => intLit(v), /정수가 아니다/);
  assert.equal(boolLit(false), 'false');
  assert.throws(() => boolLit('true'), /불리언이 아니다/);
});
test('regexLit — 클래스 안의 / 는 되고, 밖의 / · 줄 끝 문자 · 끝 역슬래시 · 컴파일 실패는 멈춘다', () => {
  assert.equal(regexLit('^[^<>*%&:\\\\?.+/\\p{Cc}]+$', 'u'), '/^[^<>*%&:\\\\?.+/\\p{Cc}]+$/u');
  assert.equal(regexLit('^a\\/b$'), '/^a\\/b$/');
  assert.equal(evalJs(regexLit('^[a/]+$')).test('a/a'), true);
  for (const v of ['a/b', '^a/ evil()', 'a\nb', '[a', 'a\\', '*/']) assert.throws(() => regexLit(v), Error, v);
  assert.throws(() => regexLit('a', 'gx'), /플래그/);
});
test('metaToken — 주석 한 줄 밖으로 나갈 수 있는 값은 멈춘다', () => {
  assert.equal(metaToken('4966c6cb088804bf367be4399949194a937c8cba'), '4966c6cb088804bf367be4399949194a937c8cba');
  assert.equal(metaToken('08/05/2026'), '08/05/2026');
  assert.equal(metaToken(20260922), '20260922');
  for (const v of ['x\nexport const evil = 1;', 'x */', 'a b']) assert.throws(() => metaToken(v), /출처 표지/);
});

/** 생성 결과의 `export const NAME … = [ … ];` 를 JS 로 읽는다 */
function arrayOf(ts, name) {
  const start = ts.indexOf(`export const ${name}`);
  const open = ts.indexOf('[\n', start);
  const close = ts.indexOf('\n];', open);
  return evalJs(ts.slice(open, close + 2));
}

test('gcp renderTs — 원문 문자열에 따옴표 · 줄 바꿈 · */ 가 있어도 행 하나 · 값 그대로', () => {
  const row = { id: 'gcp.x', displayName: EVIL[3], entity: EVIL[4], scope: 'gcp:project', method: 'compute.xs.insert', min: 1, max: 63, pattern: EVIL[1], chars: 'rfc1035', slug: 'x', category: 'compute', docUrl: `https://e.test/${EVIL[0]}`, uniquenessDocUrl: EVIL[2] };
  const ts = renderGcp({ rules: [row], scopes: [{ id: 'gcp:k', displayName: EVIL[0], parent: 'gcp:project', docUrl: EVIL[5] }] }, { computeRevision: '20260922', kmsRevision: '20261001' });
  assert.deepEqual(arrayOf(ts, 'GCP_INTAKE_ROWS'), [row]);
  assert.throws(() => renderGcp({ rules: [{ ...row, id: "gcp.x', evil: '1" }], scopes: [] }, { computeRevision: '1', kmsRevision: '1' }), /식별자/);
  assert.throws(() => renderGcp({ rules: [{ ...row, method: 'a\nb' }], scopes: [] }, { computeRevision: '1', kmsRevision: '1' }), /식별자/);
  assert.throws(() => renderGcp({ rules: [], scopes: [] }, { computeRevision: '1\nexport const x = 1;', kmsRevision: '1' }), /출처 표지/);
});
test('aws renderTs — 원문 문자열이 행 하나 · 값 그대로', () => {
  const gen = { allowed: 'any', separator: '-', caseRule: 'any', startsWithLetter: false, endsWithAlnum: false, noConsecutiveSeparator: false };
  const a = { kind: 'a', id: 'aws.x', displayName: EVIL[4], entity: EVIL[0], property: EVIL[3], scope: 'aws:region', category: 'compute', slug: 'x', min: 1, max: 64, schemaPattern: EVIL[1], gen, docUrl: EVIL[2] };
  const b = { kind: 'b', id: 'aws.y', displayName: EVIL[5], entity: EVIL[6], scope: 'aws:vpc', category: 'networking', slug: 'y', tag: 'ec2' };
  const rows = arrayOf(renderAws({ rules: [a, b] }), 'AWS_INTAKE_ROWS');
  const { gen: _g, ...aFlat } = a;
  assert.deepEqual(rows, [{ ...aFlat, ...gen }, b]);
  assert.throws(() => renderAws({ rules: [{ ...a, min: '1, evil: 1' }] }), /정수가 아니다/);
});
test('azure renderTs — 원문 문자열 · 정규식이 행 하나 · 값 그대로', () => {
  const gen = { allowed: 'any', separator: '-', caseRule: 'any', startsWithLetter: false, endsWithAlnum: false };
  const ts = renderAzure({
    rules: [{ id: 'azure.x', displayName: EVIL[3], entity: EVIL[4], scope: 'azure:global', row: { anchor: EVIL[0] }, min: 1, max: 9, cls: 'C01', slug: EVIL[2], category: 'compute', reserved: true }],
    scopes: [{ id: 'azure:a/b', displayName: EVIL[1], parent: 'azure:global', anchor: EVIL[5] }],
    charClasses: [[EVIL[4], { key: 'C01', pattern: '^[^/]+$', spec: {}, gen }]],
  }, { commit: 'abc', msDate: '08/05/2026' });
  assert.deepEqual(arrayOf(ts, 'AZURE_INTAKE_ROWS'), [{ id: 'azure.x', displayName: EVIL[3], entity: EVIL[4], scope: 'azure:global', anchor: EVIL[0], min: 1, max: 9, chars: 'C01', slug: EVIL[2], category: 'compute', reserved: true }]);
  assert.throws(() => renderAzure({ rules: [], scopes: [], charClasses: [['r', { key: 'C01', pattern: 'a/ evil', spec: {}, gen }]] }, { commit: 'a', msDate: 'b' }), /이스케이프 안 된/);
  assert.throws(() => renderAzure({ rules: [], scopes: [], charClasses: [['r', { key: 'C01; evil', pattern: 'a', spec: {}, gen }]] }, { commit: 'a', msDate: 'b' }), /문자 규칙 키/);
});
