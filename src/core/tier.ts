// 용도 토큰의 예약어 (D60) — tier 로 쓸 수 없는 글자. 입력 검사(마법사 모델)가 이 목록으로 거부한다.
// tier 는 약어 · 종류 토큰 바로 뒤에 오므로(…-{slug}[-{kind}]-{tier}-{seq}) 약어 · 종류 토큰과 같은 글자면
// tier 가 없는 옛 이름과 글자가 같아질 수 있다. 지역 코드 · 환경 값은 읽는 사람이 그 뜻으로 먼저 읽는다 (D47 ⑶ ⑷ 와 같은 기준)
import { GCP_CATALOG } from './rules/gcp-catalog';
import { REGIONS } from './regions-data';
import { ENV_VALUES } from './normalize';

/** 0.1.0 전의 환경 표준값 — 지금은 prod 의 별칭이다 (D48) */
const LEGACY_ENV = ['prd'];

/** 약어(catalog 행) · 종류 토큰 · 환경 값 · GCP 리전 · 존 코드 — 모두 규칙 · 지역 표에서 만든다 */
export const RESERVED_TIERS: ReadonlySet<string> = new Set([
  ...GCP_CATALOG.map((r) => r.slug.value),
  ...GCP_CATALOG.flatMap((r) => Object.values(r.kind?.tokens ?? {})),
  ...ENV_VALUES, ...LEGACY_ENV,
  ...REGIONS.gcp.flatMap((r) => [r.code, ...r.zones.map((z) => z.code)]),
].filter((w): w is string => typeof w === 'string' && w !== ''));
