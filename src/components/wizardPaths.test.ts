// 마법사 경로 표 (D129) — src/site/pages 는 아무것도 들여오지 않아 클라우드 둘을 글자로 적는다. 그 글자가 엔진의 마법사 provider 와 같은지 여기서 대어 본다
import { describe, it, expect } from 'vitest';
import { WIZARD_PATHS, wizardPath } from '../site/pages';
import { WIZARD_PROVIDERS } from '../core/wizard/plan';
import { ENABLED_PROVIDERS } from '../core/types';

describe('WIZARD_PATHS ↔ 엔진의 마법사 provider (D129)', () => {
  it('키가 WIZARD_PROVIDERS 와 같다 — 한쪽에만 클라우드가 늘면 깨진다', () => {
    expect(Object.keys(WIZARD_PATHS).sort()).toEqual([...WIZARD_PROVIDERS].sort());
  });
  it('켜진 CSP 중 마법사가 다루는 것마다 제 경로가 있다 — 뿌리 / 로 떨어지지 않는다', () => {
    const wizardEnabled = ENABLED_PROVIDERS.filter((p) => (WIZARD_PROVIDERS as readonly string[]).includes(p));
    expect(wizardEnabled.length).toBeGreaterThan(0);
    for (const p of wizardEnabled) expect(wizardPath(p), p).toBe(`/${p}`);
  });
});
