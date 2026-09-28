import { lookup } from './dict';

export const SHORT_WORDS: Record<string, string> = {
  koreacentral: 'kc', korea: 'kr', northeast: 'ne', southeast: 'se',
  trade: 'trd', service: 'svc', management: 'mgmt', database: 'db', storage: 'st',
  application: 'app', frontend: 'fe', backend: 'be', analytics: 'anl', monitoring: 'mon',
};

export function shorten(word: string): string { return lookup(SHORT_WORDS, word) ?? word; }

/** ② 균등 예산: ⌊(L_max − 고정 − 구분자) / N⌋. L_unique 는 0 (D11). */
export function elementBudget(maxLength: number, fixed: number, separators: number, variableCount: number): number {
  if (variableCount <= 0) return 0;
  return Math.max(0, Math.floor((maxLength - fixed - separators) / variableCount));
}
