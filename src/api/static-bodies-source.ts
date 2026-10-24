// /llms.txt · /catalog.json 본문을 만드는 하나뿐인 자리 (D17 · D46) — scripts/gen-static-bodies.mjs 가 빌드 전에 불러 static-bodies.ts 에 상수로 쓴다.
// Worker(index.ts)는 이 파일을 들여오지 않는다 — 들여오면 llms.ts 의 규칙 탐침 · 표 조립이 isolate 마다 기동 때 다시 돈다(CPU 조사 2026-10-24)
import { RULES } from '../core/constraints';
import { ENABLED_PROVIDERS } from '../core/types';
import { VERSION } from '../version';
import { buildLlmsText } from './llms';
import { buildCatalogJson } from './catalog';

/** 지금 규칙 · 켜진 CSP · 버전으로 만든 두 본문 — static-bodies.test 가 커밋된 상수와 글자까지 대어 본다 */
export function staticBodies(): { llms: string; catalog: string } {
  return { llms: buildLlmsText(Object.values(RULES), VERSION), catalog: buildCatalogJson(ENABLED_PROVIDERS, VERSION) };
}
