// 리소스에 붙일 표준 태그 · 라벨 — 한도는 constraints.ts 의 LABEL_LIMITS 가 정본이다 (원장 판정 M4)
import type { LabelSet, NamingContext, Provider } from './types';
import { LABEL_LIMITS } from './constraints';

/** GCP 라벨 값 규격 (D21) — \p{L} 이라 한글(Lo)도 남는다 */
const GCP_VALUE_STRIP = /[^\p{L}\p{N}_-]/gu;

export function labelsFor(ctx: NamingContext, provider: Provider): LabelSet {
  const base: Record<string, string> = {
    owner: ctx.owner, system: ctx.system, purpose: ctx.purpose, environment: ctx.env, managed_by: 'cloudonym',
  };
  const max = LABEL_LIMITS[provider].value;
  const labels: Record<string, string> = {};
  const violations: string[] = [];
  const transformed: string[] = [];
  // 키는 우리가 정한 다섯이라 검사하지 않는다 — 값만 본다
  for (const [key, before] of Object.entries(base)) {
    const value = provider === 'gcp' ? before.toLowerCase().replace(GCP_VALUE_STRIP, '') : before;
    if (value !== before) transformed.push(`${key}: ${before}→${value}`);
    // 자르지 않는다 (TC-AWS-02) — 한도 초과는 이유로 알린다
    if (value.length > max) violations.push(`${key} 값 ${value.length}자 — 최대 ${max}자`);
    labels[key] = value;
  }
  return { labels, violations, transformed };
}
