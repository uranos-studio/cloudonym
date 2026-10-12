import type { Allowed, Env } from './types';
import { lookup } from './dict';

/** 표 순서가 표준값 순서다 — parseContext 의 supported · 화면의 env 고르기 · llms.txt 가 이 순서를 쓴다.
 *  prd 는 0.1.0 전의 표준값이라 별칭으로 남긴다 (D48) */
export const ENV_ALIASES: Record<string, Env> = {
  prod: 'prod', prd: 'prod', production: 'prod', real: 'prod', live: 'prod',
  stg: 'stg', stage: 'stg', staging: 'stg',
  dev: 'dev', develop: 'dev', development: 'dev',
  sbx: 'sbx', sandbox: 'sbx',
  // D81 — 넷 다음에 붙인다(표준값 순서 · 오류의 supported 순서가 앞 넷은 그대로). 표준값은 4자 이하라 hash 상한식의 env 'prod' 가 그대로 최악이다
  qa: 'qa', quality: 'qa',
  uat: 'uat', acceptance: 'uat',
  test: 'test', testing: 'test', tst: 'test',
  perf: 'perf', performance: 'perf', load: 'perf',
  dr: 'dr', disaster: 'dr', recovery: 'dr',
};
/** env 표준값 — 별칭 표의 값을 표 순서대로 (prod · stg · dev · sbx · qa · uat · test · perf · dr) */
export const ENV_VALUES: readonly Env[] = [...new Set(Object.values(ENV_ALIASES))];

const STRIP: Record<Allowed, RegExp> = {
  'lower-digit': /[^a-z0-9]/g,
  'lower-digit-hyphen': /[^a-z0-9-]/g,
  'lower-digit-underscore': /[^a-z0-9_]/g,
  'alnum-hyphen': /[^A-Za-z0-9-]/g,
  'alnum-hyphen-underscore': /[^A-Za-z0-9_-]/g,
  'alnum-hyphen-underscore-period-paren': /[^A-Za-z0-9_.()-]/g,
};

/** 한 토큰을 규칙의 허용 문자 집합으로 정제한다. 공백은 하이픈으로, 나머지 금지 문자는 지운다.
 *  밑줄 집합(lower-digit-underscore)은 하이픈이 없다 — 공백 · 하이픈을 밑줄로 바꾸고 같은 방식으로 겹침 · 앞뒤를 정리한다 */
export function normalizeToken(value: string, allowed: Allowed): { value: string; changed: boolean } {
  const lowered = allowed.startsWith('lower') ? value.toLowerCase() : value;
  if (allowed === 'lower-digit-underscore') {
    const out = lowered.trim().replace(/[\s-]+/g, '_').replace(STRIP[allowed], '').replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '');
    return { value: out, changed: out !== value };
  }
  let out = lowered.trim().replace(/\s+/g, '-').replace(STRIP[allowed], '');
  if (allowed !== 'lower-digit') out = out.replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  return { value: out, changed: out !== value };
}

export function canonicalEnv(raw: string): Env | undefined {
  return lookup(ENV_ALIASES, raw.trim().toLowerCase());
}
