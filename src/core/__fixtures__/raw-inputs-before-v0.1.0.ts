// 옛 원시 입력 20개 — 0.1.0 이름 체계 변경 전(규칙 버전 2026-10-07.2) 기준선 입력(baseline-inputs.ts 의 BASELINE_CONTEXTS)을 그대로 얼린 사본.
// 기준선 입력은 엔진을 따라 표준값으로 옮겨 가지만(env prod …), 원시 입력 호환 시험(raw-compat.test.ts)은 옛 입력이 새 파서에서
// 어떻게 되는지를 보므로 이 사본을 쓴다. 고치지 않는다 — 0.1.0 마감 검토 뒤 시험과 함께 지운다
import type { RawContext } from '../types';

/** 한글 사용자 입력 표본 — 소스의 문자열 리터럴에 한글을 두지 않으려고(시스템 문구 한글 0 검사 대상이다) 코드 포인트로 쓴다 */
const HANGUL_OWNER = String.fromCodePoint(0xac1c, 0xbc1c);
const HANGUL_SYSTEM = String.fromCodePoint(0xb9e4, 0xb9e4); // 정제하면 빈 값이 된다

const BASE = { owner: 'platform', system: 'billing', purpose: 'trade', env: 'prd', region: 'kr' };

export const RAW_INPUTS_BEFORE: readonly { id: string; raw: RawContext }[] = [
  { id: 'base', raw: BASE },
  { id: 'hangul-owner', raw: { ...BASE, owner: HANGUL_OWNER } },
  { id: 'space-quote-combining-owner', raw: { ...BASE, owner: ' Team "A" café ' } },
  { id: 'alias-env-region', raw: { ...BASE, env: 'production', region: 'koreacentral' } },
  { id: 'reserved-windows', raw: { ...BASE, system: 'windows' } },
  { id: 'reserved-google', raw: { ...BASE, system: 'google' } },
  { id: 'reserved-azure', raw: { ...BASE, system: 'azure' } },
  { id: 'empty-after-normalize', raw: { ...BASE, system: HANGUL_SYSTEM } },
  { id: 'long-values', raw: { owner: 'platformengineering', system: 'paymentsettlement', purpose: 'reconciliation', env: 'dev', region: 'global' } },
  // 축소 실패 — Windows VM(15자)에서 예산 2 로 자르면 'a-' 가 한 글자가 된다 (name.cannot_fit)
  { id: 'shrink-fail', raw: { ...BASE, system: 'a-long', purpose: 'longpurpose' } },
  { id: 'digit-first-system', raw: { ...BASE, system: '3tier' } },
  { id: 'label-gcp-65', raw: { ...BASE, owner: 'o'.repeat(65) } },
  { id: 'label-aws-257', raw: { ...BASE, owner: 'o'.repeat(257) } },
  { id: 'label-aws-invalid-char', raw: { ...BASE, owner: 'team#1' } },
  { id: 'label-gcp-transform', raw: { ...BASE, owner: 'In.Fra' } },
  { id: 'parse-env-qa', raw: { ...BASE, env: 'qa' } },
  { id: 'parse-region-mars', raw: { ...BASE, region: 'mars' } },
  { id: 'parse-owner-empty', raw: { ...BASE, owner: '   ' } },
  { id: 'parse-owner-number', raw: { ...BASE, owner: 123 } },
  { id: 'parse-missing-all', raw: {} },
];
