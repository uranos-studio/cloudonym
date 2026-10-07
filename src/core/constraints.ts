// CSP 리소스 이름 규칙 표 (D9 · D14 · D18 · D19 · D20)
// 값은 CSP 공식 문서로 대조했다 — 표는 docs/rule-verification.md, 고친 것은 docs/decisions.md.
// pattern · forbidden · 길이 = CSP 물리 규칙(검증), allowed = 우리가 생성할 때 쓰는 문자 집합.
// 표 자체는 provider 별 파일(rules/gcp.ts · rules/aws.ts · rules/azure.ts)에 있고 여기서 합친다.
import type { Provider, ResourceRule } from './types';
import { lookup } from './dict';
import { NO_INVISIBLE } from './invisible.mjs';
import { GCP_RULES } from './rules/gcp';
import { AWS_RULES } from './rules/aws';
import { AZURE_RULES_TABLE } from './rules/azure';

export { AWS_NAME_TAG } from './rules/aws';
export { WINDOWS_COMPUTER_NAME_DOC_URL, AZURE_RESERVED_DOC_URL } from './rules/azure';

/** 키 순서 = GCP · AWS · Azure — 분할 전 한 표의 순서와 같다(rulesFor · 트리 · 기준선이 이 순서를 쓴다) */
export const RULES: Record<string, ResourceRule> = { ...GCP_RULES, ...AWS_RULES, ...AZURE_RULES_TABLE };

/** 태그 · 라벨의 키 · 값 길이 한도 (문서로 대조했다)
 *  Azure 스토리지 계정만 키 128 — 엔진의 태그 키는 고정 다섯(11자 이하)이라 적용하지 않는다 (docs/decisions.md) */
const LABEL_LIMITS_AWS_DOC = 'https://docs.aws.amazon.com/tag-editor/latest/userguide/best-practices-and-strats.html#tag-conventions';

export const LABEL_LIMITS: Record<Provider, { key: number; value: number; docUrl: string }> = {
  aws: { key: 128, value: 256, docUrl: LABEL_LIMITS_AWS_DOC },
  azure: { key: 512, value: 256, docUrl: 'https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/tag-resources#limitations' },
  gcp: { key: 63, value: 63, docUrl: 'https://docs.cloud.google.com/resource-manager/docs/labels-overview#requirements' },
};

/** AWS 태그 값에 쓸 수 있는 문자 — 문서: "letters, numbers, spaces representable in UTF-8, and the following characters: _ . : / = + - @".
 *  AWS API 가 공개하는 TagValue 패턴(`^([\p{L}\p{Z}\p{N}_.:/=+\-@]*)$`)과 같다. 서비스마다 다를 수 있고(EC2 는 더 넓다) 여기서는 일반 규칙을 따른다 — 무효를 유효로 내지 않는 쪽 (docs/decisions.md 2026-09-29)
 *  docUrl: https://docs.aws.amazon.com/tag-editor/latest/userguide/best-practices-and-strats.html#tag-conventions (LABEL_LIMITS.aws.docUrl 과 같은 쪽) */
export const AWS_TAG_VALUE = new RegExp(String.raw`${NO_INVISIBLE}^[\p{L}\p{Z}\p{N}_.:/=+\-@]*$`, 'u');
export const AWS_TAG_VALUE_DOC_URL = LABEL_LIMITS_AWS_DOC;

export function rulesFor(provider: Provider): ResourceRule[] {
  return Object.values(RULES).filter((r) => r.provider === provider);
}

export function getRule(provider: Provider, resourceType: string): ResourceRule | undefined {
  return lookup(RULES, `${provider}.${resourceType}`);
}
