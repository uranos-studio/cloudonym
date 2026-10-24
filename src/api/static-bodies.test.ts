// /llms.txt · /catalog.json 본문 상수 (D17 · D46) — Worker 가 기동 때 본문을 만들지 않도록 빌드 전에 scripts/gen-static-bodies.mjs 가 만든다.
// 이 시험은 저장소에 든 상수가 지금 규칙 · 버전으로 빌더가 만드는 것과 글자까지 같은지 본다 — 규칙 · 버전 · 문구를 바꾸고 다시 만들지 않으면 여기서 깨진다
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOG_JSON, LLMS_TEXT } from './static-bodies';
import { buildLlmsText } from './llms';
import { buildCatalogJson } from './catalog';
import { RULES } from '../core/constraints';
import { ENABLED_PROVIDERS } from '../core/types';
import { VERSION } from '../version';
import { app } from './index';
import { req } from './test-support';

const HINT = '본문 상수가 낡았다 — node scripts/gen-static-bodies.mjs 로 다시 만든다 (npm run build 가 먼저 부른다)';

describe('빌드 때 만든 본문 상수 (D17 · D46)', () => {
  it('LLMS_TEXT 는 지금 규칙으로 만든 /llms.txt 본문과 같다', () => {
    expect(LLMS_TEXT === buildLlmsText(Object.values(RULES), VERSION), HINT).toBe(true);
  });

  it('CATALOG_JSON 은 지금 켜진 CSP 로 만든 /catalog.json 본문과 같다', () => {
    expect(CATALOG_JSON === buildCatalogJson(ENABLED_PROVIDERS, VERSION), HINT).toBe(true);
  });

  it('Worker 는 상수를 그대로 낸다 — GET 본문이 상수와 글자까지 같다', async () => {
    const { res: llms } = await req(app, '/llms.txt');
    expect(await llms.text()).toBe(LLMS_TEXT);
    const { res: catalog } = await req(app, '/catalog.json');
    expect(await catalog.text()).toBe(CATALOG_JSON);
  });

  it('Worker 엔트리는 빌더를 들여오지 않는다 — 기동 때 본문을 다시 만들지 않는다', () => {
    const src = readFileSync(join(import.meta.dirname, 'index.ts'), 'utf-8');
    expect(src).not.toMatch(/from '\.\/llms'|from '\.\/catalog'|buildLlmsText|buildCatalogJson/);
  });
});
