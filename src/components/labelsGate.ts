// 태그 JSON 복사 차단 조건 — 보이는 provider 중 하나라도 라벨 한도 위반이 있으면 막는다 (「무효를 유효로 내지 않는다」)
import type { LabelSet, Provider } from '../core/types';

export function labelsJsonBlocked(providers: Provider[], labels: Partial<Record<Provider, LabelSet>>): boolean {
  return providers.some((p) => (labels[p]?.violations.length ?? 0) > 0);
}
