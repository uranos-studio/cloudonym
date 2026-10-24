// 리소스에 붙일 표준 태그 · 라벨 — 한도는 constraints.ts 의 LABEL_LIMITS 가 정본이다
import type { LabelSet, NamingContext, ProjectContext, Provider } from './types';
import { AWS_TAG_VALUE, LABEL_LIMITS } from './constraints';
import type { CoreMessage } from './messages';
import { INVISIBLE_CLASS } from './invisible.mjs';

/** GCP 라벨 값 규격 (D21) — \p{L} 이라 한글(Lo)도 남는다. 한글 채움(U+3164 등 Lo)처럼 보이지 않는 글자는 지운다(invisible.mjs) */
const GCP_VALUE_STRIP = new RegExp(`[^\\p{L}\\p{N}_-]|[${INVISIBLE_CLASS}]`, 'gu');

/** ASCII 빠른 길 — 아래 두 집합의 글자만 있으면 유니코드 정규식의 판정이 정해져 있다(a-z · A-Z 는 \p{L}, 0-9 는 \p{N}, 공백은 \p{Z},
 *  나머지는 두 정규식이 이름으로 받는 기호이고, 어느 글자도 보이지 않는 글자 집합에 들지 않는다). 그래서 그 정규식을 돌리지 않는다 —
 *  \p{…} 정규식은 isolate 의 첫 실행에 컴파일 비용이 커서 엔진 경로의 첫 요청마다 약 0.5 ms 를 더했다(CPU 조사 2026-10-24).
 *  판정이 유니코드 정규식만 쓴 결과와 같은지는 labels.test 가 ASCII 128자 전부와 유니코드 표본으로 대어 본다 */
const GCP_VALUE_ASCII = /^[a-z0-9_-]*$/;
const AWS_TAG_VALUE_ASCII = /^[A-Za-z0-9 _.:/=+\-@]*$/;

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
    const lowered = provider === 'gcp' ? before.toLowerCase() : before;
    const value = provider === 'gcp' && !GCP_VALUE_ASCII.test(lowered) ? lowered.replace(GCP_VALUE_STRIP, '') : lowered;
    if (value !== before) transformed.push({ code: 'label.normalized', field: key, params: { from: before, to: value } });
    // 자르지 않는다 (TC-AWS-02) — 한도 초과는 이유로 알린다
    if (value.length > max) violations.push({ code: 'label.too_long', field: key, params: { actual: value.length, max } });
    // AWS 는 값의 문자 집합도 본다 — 자르거나 지우지 않고 이유로 알린다 (AWS_TAG_VALUE 의 docUrl)
    if (provider === 'aws' && !AWS_TAG_VALUE_ASCII.test(value) && !AWS_TAG_VALUE.test(value)) violations.push({ code: 'label.aws_invalid_chars', field: key });
    labels[key] = value;
  }
  return { labels, violations, transformed };
}
