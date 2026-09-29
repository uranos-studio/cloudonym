import { describe, it, expect } from 'vitest';
import { checkName } from './validate';
import { getRule, RULES } from './constraints';
const sa = getRule('gcp', 'service_account')!;
const st = getRule('azure', 'storage_account')!;
const s3 = getRule('aws', 's3_bucket')!;
const gcs = getRule('gcp', 'storage_bucket')!;
const kv = getRule('azure', 'key_vault')!;
const rds = getRule('aws', 'rds_instance')!;
const vm = getRule('gcp', 'compute_instance')!;
const rg = getRule('azure', 'resource_group')!;
const sql = getRule('azure', 'sql_server')!;
const aksLinux = getRule('azure', 'aks_nodepool_linux')!;

describe('checkName', () => {
  it('유효하면 빈 배열', () => expect(checkName('billing-trade-prd-sa-sync', sa)).toEqual([]));
  it('길이 초과 이유에 실제 길이와 최대가 들어간다 (34자) — pattern 위반은 겹쳐 말하지 않는다', () => {
    expect(checkName('acmex-billing-trade-prd-kr-sa-sync', sa)).toEqual([{ code: 'name.too_long', params: { actual: 34, max: 30 } }]);
  });
  it('숫자로 시작하는 GCP 이름은 첫 글자 위반 (Review Focus 2)', () => {
    expect(checkName('3tier-trade-prd-sa-sync', sa)).toEqual([{ code: 'name.first_not_letter' }]);
  });
  it('빈 이름은 하나의 이유만 (Review Focus 1)', () => expect(checkName('', st)).toEqual([{ code: 'name.empty' }]));
  it('Azure Storage 에 하이픈 → pattern 위반', () => {
    expect(checkName('st-web-prod', st)).toContainEqual({ code: 'name.pattern_mismatch', params: { pattern: '^[a-z0-9]{3,24}$' } });
  });
  it('끝이 하이픈이면 끝 글자 위반', () => expect(checkName('abc-', sa)).toContainEqual({ code: 'name.last_not_alnum' }));
  it('D14: 점이 든 S3 · 언더스코어 든 GCS · 대문자 RDS 는 CSP 가 허용하므로 유효', () => {
    expect(checkName('example.com', s3)).toEqual([]);
    expect(checkName('my_bucket', gcs)).toEqual([]);
    expect(checkName('Mydb', rds)).toEqual([]);
  });
  it('예약어 · 금지 접두사 · 접미사 (Review Focus 3 · D19)', () => {
    expect(checkName('sthree-example', s3)).toContainEqual({ code: 'name.forbidden_prefix', params: { value: 'sthree-' } });
    expect(checkName('demo--table-s3', s3)).toContainEqual({ code: 'name.forbidden_suffix', params: { value: '--table-s3' } });
    expect(checkName('goog-example', gcs)).toContainEqual({ code: 'name.forbidden_prefix', params: { value: 'goog' } });
    expect(checkName('my-g00gle-bucket', gcs)).toContainEqual({ code: 'name.forbidden_substring', params: { value: 'g00gle' } });
    expect(checkName('192.168.0.1', s3)).toContainEqual({ code: 'name.ipv4_form' });
  });
  it('연속 하이픈은 금지하는 규칙(Key Vault · RDS)에서만 위반 — GCP VM 의 a--b 는 유효', () => {
    expect(checkName('kv-a--b', kv)).toContainEqual({ code: 'name.consecutive_separator', params: { separator: '--' } });
    expect(checkName('a--b', rds)).toContainEqual({ code: 'name.consecutive_separator', params: { separator: '--' } });
    expect(checkName('a--b', vm)).toEqual([]);
  });
  it('Azure Resource Group: 한글 허용 · 끝 점 불가 · 끝 괄호는 허용', () => {
    expect(checkName('개발', rg)).toEqual([]);
    expect(checkName('rg.', rg)).toEqual([expect.objectContaining({ code: 'name.pattern_mismatch' })]);
    expect(checkName('rg_(1)', rg)).toEqual([]);
  });
  it('한 글자 이름을 허용하는 규칙(Azure SQL)은 a 가 유효', () => expect(checkName('a', sql)).toEqual([]));
  it('codex P1: Windows VM 은 숫자로만 된 이름이 pattern 위반 · Linux VM 은 유효', () => {
    const win = getRule('azure', 'virtual_machine_windows')!;
    const linux = getRule('azure', 'virtual_machine')!;
    expect(checkName('12345', win)).toEqual([expect.objectContaining({ code: 'name.pattern_mismatch' })]);
    expect(checkName('vm12345', win)).toEqual([]);
    expect(checkName('12345', linux)).toEqual([]);
  });

  // ─── Azure 예약어 (AZURE_RESERVED_DOC_URL) ───
  it('Azure 예약어: MICROSOFT · WINDOWS 는 이름 어디에 있어도 위반 (대소문자 무관)', () => {
    expect(checkName('microsoft123', st)).toEqual([{ code: 'name.forbidden_substring', params: { value: 'microsoft' } }]);
    expect(checkName('stwindowsprd', st)).toEqual([{ code: 'name.forbidden_substring', params: { value: 'windows' } }]);
    expect(checkName('kv-MicroSoft-prd', kv)).toEqual([{ code: 'name.forbidden_substring', params: { value: 'microsoft' } }]);
  });
  it('Azure 예약어: 단어(이름 전체 · 앞뒤가 영문이 아닌 조각)로 쓰면 위반', () => {
    expect(checkName('azure', st)).toEqual([{ code: 'name.forbidden_word', params: { value: 'azure' } }]);
    expect(checkName('azure123', st)).toEqual([{ code: 'name.forbidden_word', params: { value: 'azure' } }]);
    expect(checkName('kv-Azure-prd', kv)).toEqual([{ code: 'name.forbidden_word', params: { value: 'azure' } }]);
    expect(checkName('sql-xbox', sql)).toEqual([{ code: 'name.forbidden_word', params: { value: 'xbox' } }]);
    expect(checkName('o365', sql)).toEqual([{ code: 'name.forbidden_word', params: { value: 'o365' } }]);
  });
  it('Azure 예약어: 다른 단어 안에 든 예약어는 위반이 아니다 (단어만 금지)', () => {
    expect(checkName('myazurestore', st)).toEqual([]);
    expect(checkName('staccessprd', st)).toEqual([]);
  });
  it('Azure 예약어: LOGIN 은 앞에서만 위반', () => {
    expect(checkName('loginprd', st)).toEqual([{ code: 'name.forbidden_prefix', params: { value: 'login' } }]);
    expect(checkName('LOGIN-kv', kv)).toEqual([{ code: 'name.forbidden_prefix', params: { value: 'login' } }]);
    expect(checkName('stloginprd', st)).toEqual([]);
  });
  it('Azure 예약어: 평범한 이름은 그대로 유효', () => {
    expect(checkName('stbillingtradeprd', st)).toEqual([]);
    expect(checkName('kv-billing-prd', kv)).toEqual([]);
  });
  it('Azure 예약어: 공개 엔드포인트가 없는 규칙(리소스 그룹)에는 걸지 않는다', () => {
    expect(checkName('rg-azure-windows', rg)).toEqual([]);
  });
  it('Azure 예약어: VM · AKS 노드풀에도 건다 (보수적)', () => {
    expect(checkName('windows01', getRule('azure', 'virtual_machine_windows')!)).toEqual([{ code: 'name.forbidden_substring', params: { value: 'windows' } }]);
    expect(checkName('vm-azure-01', getRule('azure', 'virtual_machine')!)).toEqual([{ code: 'name.forbidden_word', params: { value: 'azure' } }]);
    expect(checkName('azure', aksLinux)).toEqual([{ code: 'name.forbidden_word', params: { value: 'azure' } }]);
    expect(checkName('azure', getRule('azure', 'aks_nodepool_windows')!)).toEqual([{ code: 'name.forbidden_word', params: { value: 'azure' } }]);
    expect(checkName('aksmanagedap', aksLinux)).toEqual([{ code: 'name.forbidden_exact', params: { value: 'aksmanagedap' } }]);
  });

  // ─── 원장 판정 M2 · forbidden 전 필드 ───
  it('S3 새 접미사 -an 은 위반', () => expect(checkName('x-an', s3)).toEqual([{ code: 'name.forbidden_suffix', params: { value: '-an' } }]));
  it('AKS Linux 노드풀 예약 이름 aksmanagedap 은 위반 (exact) — 그 이름을 포함할 뿐인 것은 아니다', () => {
    expect(checkName('aksmanagedap', aksLinux)).toEqual([{ code: 'name.forbidden_exact', params: { value: 'aksmanagedap' } }]);
    expect(checkName('aksmanaged', aksLinux)).toEqual([]);
  });
  it('M2: 첫 글자 검사는 대소문자를 보지 않는다 — 대소문자는 pattern 몫', () => {
    expect(checkName('Mydb', rds)).toEqual([]);
    expect(checkName('Abcdef', sa)).toEqual([{ code: 'name.pattern_mismatch', params: { pattern: '^[a-z][a-z0-9-]{4,28}[a-z0-9]$' } }]);
  });
  it('M2: startsWithLetter 가 false 인 규칙은 숫자 첫 글자를 첫 글자 위반으로 말하지 않는다', () => {
    expect(checkName('1bucket', s3)).toEqual([]);
    expect(checkName('1st', st)).toEqual([]);
  });

  // 플래그가 pattern 보다 엄격한데 pattern 이 조용히 다르게 말하는 규칙이 없어야 한다.
  // 탐침: 길이 L = min(max(minLength,3), maxLength) 의 'a' 몸통 — 몸통 자체는 pattern 을 통과해야 탐침이 뜻이 있다.
  it('RULES 전체: startsWithLetter 면 숫자 첫 글자를, endsWithAlnum 이면 끝 하이픈을 pattern 도 거부한다', () => {
    let checked = 0;
    for (const rule of Object.values(RULES)) {
      if (!rule.startsWithLetter && !rule.endsWithAlnum) continue;
      const len = Math.min(Math.max(rule.minLength, 3), rule.maxLength);
      const body = 'a'.repeat(len);
      expect(rule.pattern.test(body), `${rule.id} 탐침 몸통 ${body}`).toBe(true);
      if (rule.startsWithLetter) {
        const probe = '1' + body.slice(1);
        expect(rule.pattern.test(probe), `${rule.id} 숫자 첫 글자 ${probe}`).toBe(false);
        checked++;
      }
      if (rule.endsWithAlnum) {
        const probe = body.slice(0, -1) + '-';
        expect(rule.pattern.test(probe), `${rule.id} 끝 하이픈 ${probe}`).toBe(false);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
