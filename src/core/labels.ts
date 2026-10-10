// 리소스에 붙일 표준 태그 · 라벨 — 한도는 constraints.ts 의 LABEL_LIMITS 가 정본이다
import type { LabelSet, NamingContext, ProjectContext, Provider } from './types';
import { AWS_TAG_VALUE, LABEL_LIMITS } from './constraints';
import type { CoreMessage } from './messages';
import { INVISIBLE_CLASS } from './invisible.mjs';

/** GCP 라벨 값 규격 (D21) — \p{L} 이라 한글(Lo)도 남는다. 한글 채움(U+3164 등 Lo)처럼 보이지 않는 글자는 지운다(invisible.mjs) */
const GCP_VALUE_STRIP = new RegExp(`[^\\p{L}\\p{N}_-]|[${INVISIBLE_CLASS}]`, 'gu');

/** 프로젝트 문맥(purpose 없음 · D63)이면 purpose 라벨이 없다 — 키 넷 */
export function labelsFor(ctx: NamingContext | ProjectContext, provider: Provider): LabelSet {
  const base: Record<string, string> = {
    owner: ctx.owner, system: ctx.system, ...('purpose' in ctx ? { purpose: ctx.purpose } : {}), environment: ctx.env, managed_by: 'cloudonym',
  };
  const max = LABEL_LIMITS[provider].value;
  const labels: Record<string, string> = {};
  const violations: CoreMessage[] = [];
  const transformed: CoreMessage[] = [];
  // 키는 우리가 정한 다섯이라 검사하지 않는다 — 값만 본다
  for (const [key, before] of Object.entries(base)) {
    const value = provider === 'gcp' ? before.toLowerCase().replace(GCP_VALUE_STRIP, '') : before;
    if (value !== before) transformed.push({ code: 'label.normalized', field: key, params: { from: before, to: value } });
    // 자르지 않는다 (TC-AWS-02) — 한도 초과는 이유로 알린다
    if (value.length > max) violations.push({ code: 'label.too_long', field: key, params: { actual: value.length, max } });
    // AWS 는 값의 문자 집합도 본다 — 자르거나 지우지 않고 이유로 알린다 (AWS_TAG_VALUE 의 docUrl)
    if (provider === 'aws' && !AWS_TAG_VALUE.test(value)) violations.push({ code: 'label.aws_invalid_chars', field: key });
    labels[key] = value;
  }
  return { labels, violations, transformed };
}
