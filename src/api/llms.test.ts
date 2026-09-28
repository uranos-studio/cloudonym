import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLlmsText, formulaOf } from './llms';
import { RULES } from '../core/constraints';
import { app } from './index';
import { req, fakeKv } from './test-support';

const rules = Object.values(RULES);
const text = buildLlmsText(rules);
const lines = text.split('\n');

describe('buildLlmsText — RULES 에서 만든다 (D9)', () => {
  it('첫 줄은 # Cloudonym', () => expect(lines[0]).toBe('# Cloudonym'));
  it('공식 줄이 규칙 수(24)만큼 있고 template 을 그대로 펼친다', () => {
    expect(lines.filter((l) => /^- `[a-z]+\.[a-z0-9_]+`: `/.test(l))).toHaveLength(rules.length);
    expect(rules).toHaveLength(24);
    expect(formulaOf(RULES['gcp.service_account']!)).toBe('<owner>-<system>-<purpose>-<env>-<region>-sa-<role>');
    expect(formulaOf(RULES['azure.storage_account']!)).toBe('st<system><purpose><env>');
    expect(text).toContain('- `gcp.service_account`: `<owner>-<system>-<purpose>-<env>-<region>-sa-<role>` · optional: region, owner');
  });
  it('제약 줄이 규칙 수만큼 있고 docUrl 이 전부 들어 있다', () => {
    expect(lines.filter((l) => /^- `[a-z]+\.[a-z0-9_]+` \(/.test(l))).toHaveLength(rules.length);
    for (const r of rules) expect(text, r.id).toContain(`docs: ${r.docUrl}`);
    expect(text).toContain('- `aws.s3_bucket` (S3 Bucket): 3-63 chars');
    expect(text).toContain('forbidden: prefixes xn-- sthree- amzn-s3-demo-');
  });
  it('허용값 절은 ENV_ALIASES · REGION_ALIASES 의 표준값과 별칭', () => {
    expect(text).toContain('- `prd` — aliases: prod, production, real, live');
    expect(text).toContain('- `kr` — aliases: korea, koreacentral, asia-northeast3, ap-northeast-2');
    expect(text).toContain('- `global`');
  });
  it('D19 문장이 있고 우리 도메인을 박지 않는다', () => {
    expect(text).toContain("does not replace the provider's final verdict");
    expect(text).not.toMatch(/cloudnaming|cloudonym\.(dev|io|ai|com)/);
    expect(text).toContain('`POST /v1/generate`');
  });
});

describe('GET /llms.txt — Worker 라우트 (D17)', () => {
  it('200 · text/plain; charset=utf-8 · Cache-Control · 첫 줄 · 카운터 llms_txt_accessed', async () => {
    const { kv, store } = fakeKv();
    const { res, promises } = await req(app, '/llms.txt', undefined, { CLOUDONYM_KV: kv });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain;\s*charset=utf-8$/i);
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400');
    expect((await res.text()).split('\n')[0]).toBe('# Cloudonym');
    expect(promises).toHaveLength(1);
    await promises[0];
    expect([...store.keys()][0]).toMatch(/^stats:llms_txt_accessed:/);
  });
  it('HEAD /llms.txt 도 같은 헤더 둘 (curl -I)', async () => {
    const { res } = await req(app, '/llms.txt', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/i);
  });
  it('wrangler.jsonc run_worker_first 에 /llms.txt 가 있다', () => {
    const cfg = readFileSync(join(import.meta.dirname, '../../wrangler.jsonc'), 'utf-8');
    expect(cfg).toMatch(/"run_worker_first"\s*:\s*\[[^\]]*"\/llms\.txt"/);
  });
  it('app.routes 는 정확히 다섯 경로 + cors 의 ALL /v1/* 하나 · /v1/v1 없음', () => {
    const routes = app.routes.map((r) => `${r.method} ${r.path}`);
    expect(routes.filter((r) => !r.startsWith('ALL ')).sort()).toEqual(['GET /llms.txt', 'GET /v1/health', 'POST /v1/events', 'POST /v1/generate', 'POST /v1/validate']);
    expect(routes.filter((r) => r.startsWith('ALL '))).toEqual(['ALL /v1/*']);
    expect(routes.some((r) => r.includes('/v1/v1'))).toBe(false);
  });
});
