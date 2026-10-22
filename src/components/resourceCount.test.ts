// 지원 리소스 수 — 숫자는 catalog · 규칙 표에서 센 값이고, CloudPicker 와 /about 이 그 값을 그린다
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import gcpCatalog from '../../catalog/gcp.json';
import { enabledResourceCounts, resourceCount } from './resourceCount';
import { CloudPicker } from './CloudPicker';
import { About } from './About';
import { treeRows } from '../core/tree';
import { rulesFor } from '../core/constraints';
import { ENABLED_PROVIDERS, PROVIDERS } from '../core/types';
import { en } from '../messages/en';
import { fillUi } from '../messages/catalog';
import { providerName } from './providerName';


describe('resourceCount', () => {
  it('규칙 표를 행으로 묶은 수와 같다', () => {
    for (const p of ENABLED_PROVIDERS) expect(resourceCount(p)).toBe(treeRows(rulesFor(p)).length);
  });
  it('GCP — catalog 행 + catalog 밖 규칙(하나가 행 하나)', () => {
    const inCatalog = new Set(gcpCatalog.rows.flatMap((r) => Object.keys(r.rules)));
    const outside = rulesFor('gcp').filter((r) => !inCatalog.has(r.id)).length;
    const used = new Set(gcpCatalog.rows.filter((r) => Object.keys(r.rules).some((id) => rulesFor('gcp').some((x) => x.id === id))).map((r) => r.key));
    expect(resourceCount('gcp')).toBe(used.size + outside);
    expect(resourceCount('gcp')).toBeGreaterThan(0);
  });
  it('켜진 CSP 만 센다', () => {
    expect(enabledResourceCounts().map((c) => c.provider)).toEqual([...ENABLED_PROVIDERS]);
  });
});

describe('화면', () => {
  beforeAll(() => { vi.stubGlobal('window', { location: { hash: '' } }); });
  afterAll(() => { vi.unstubAllGlobals(); });

  it('CloudPicker — 켜진 CSP 버튼에만 「N resources」', () => {
    const m = renderToStaticMarkup(createElement(CloudPicker, { value: undefined, onPick: () => {} }));
    expect(m.match(/data-resource-count/g)).toHaveLength(ENABLED_PROVIDERS.length);
    for (const p of ENABLED_PROVIDERS) expect(m).toContain(fillUi(en, 'cloud_resource_count', { count: resourceCount(p) }));
    expect(PROVIDERS.length).toBeGreaterThanOrEqual(ENABLED_PROVIDERS.length);
    expect(m).not.toMatch(/%|Pro\b/);
  });
  it('/about — 켜진 CSP 마다 한 문장', () => {
    const m = renderToStaticMarkup(createElement(About));
    expect(m.match(/data-about-resources=/g)).toHaveLength(ENABLED_PROVIDERS.length);
    for (const p of ENABLED_PROVIDERS) {
      expect(m).toContain(fillUi(en, 'about_resources_body', { cloud: providerName(p), count: resourceCount(p) }));
    }
  });
});
