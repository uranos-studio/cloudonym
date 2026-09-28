import type { Allowed, Env, Region } from './types';
import { lookup } from './dict';

export const ENV_ALIASES: Record<string, Env> = {
  prd: 'prd', prod: 'prd', production: 'prd', real: 'prd', live: 'prd',
  stg: 'stg', stage: 'stg', staging: 'stg',
  dev: 'dev', develop: 'dev', development: 'dev',
  sbx: 'sbx', sandbox: 'sbx',
};
export const REGION_ALIASES: Record<string, Region> = {
  kr: 'kr', korea: 'kr', koreacentral: 'kr', 'asia-northeast3': 'kr', 'ap-northeast-2': 'kr',
  us: 'us', 'us-east-1': 'us', 'us-central1': 'us', eastus: 'us',
  jp: 'jp', japan: 'jp', 'ap-northeast-1': 'jp', 'asia-northeast1': 'jp', japaneast: 'jp',
  eu: 'eu', europe: 'eu', 'eu-west-1': 'eu', 'europe-west1': 'eu', westeurope: 'eu',
  global: 'global',
};

const STRIP: Record<Allowed, RegExp> = {
  'lower-digit': /[^a-z0-9]/g,
  'lower-digit-hyphen': /[^a-z0-9-]/g,
  'alnum-hyphen': /[^A-Za-z0-9-]/g,
  'alnum-hyphen-underscore': /[^A-Za-z0-9_-]/g,
  'alnum-hyphen-underscore-period-paren': /[^A-Za-z0-9_.()-]/g,
};

/** 한 토큰을 규칙의 허용 문자 집합으로 정제한다. 공백은 하이픈으로, 나머지 금지 문자는 지운다. */
export function normalizeToken(value: string, allowed: Allowed): { value: string; changed: boolean } {
  const lowered = allowed.startsWith('lower') ? value.toLowerCase() : value;
  let out = lowered.trim().replace(/\s+/g, '-').replace(STRIP[allowed], '');
  if (allowed !== 'lower-digit') out = out.replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  return { value: out, changed: out !== value };
}

export function canonicalEnv(raw: string): Env | undefined {
  return lookup(ENV_ALIASES, raw.trim().toLowerCase());
}
export function canonicalRegion(raw: string): Region | undefined {
  return lookup(REGION_ALIASES, raw.trim().toLowerCase());
}
