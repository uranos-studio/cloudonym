import { describe, it, expect } from 'vitest';
import { app } from './index';
import { req, jsonPost, json } from './test-support';

const post = (body: unknown) => req(app, '/v1/validate', jsonPost(body));

describe('POST /v1/validate', () => {
  it('① 예시: 34자 SA → valid:false · 이유 · suggested_name', async () => {
    const { res } = await post({ provider: 'gcp', resource_type: 'service_account', name: 'acmex-billing-trade-prd-kr-sa-sync' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: false, violations: ['길이 34자 — 최대 30자'], suggested_name: 'billing-trade-prd-kr-sa-sync' });
  });
  it('유효한 이름 → { valid:true, violations:[] } — suggested_name 키가 없다', async () => {
    const body = await json((await post({ provider: 'aws', resource_type: 's3_bucket', name: 'acmex-billing-trade-prd-bucket' })).res);
    expect(body).toEqual({ valid: true, violations: [] });
    expect('suggested_name' in body).toBe(false);
  });
  it('정제만으로 되는 이름은 그 값을 제안한다 (TC-AZ-01)', async () => {
    const body = await json((await post({ provider: 'azure', resource_type: 'storage_account', name: 'st-web-prod' })).res);
    expect(body).toMatchObject({ valid: false, suggested_name: 'stwebprod' });
  });
  it('모르는 provider → 400 + supported 셋 (Review Focus 5)', async () => {
    const { res } = await post({ provider: 'oci', resource_type: 'bucket', name: 'x' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, errors: ['지원하지 않는 provider: oci'], supported: ['aws', 'gcp', 'azure'] });
  });
  it('모르는 resource_type → 400 + 그 provider 의 유형 목록', async () => {
    const { res } = await post({ provider: 'gcp', resource_type: 'nope', name: 'x' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false, errors: ['지원하지 않는 resource_type: nope'],
      supported: ['project_id', 'service_account', 'compute_instance', 'vpc_network', 'subnet', 'cloud_sql_instance', 'storage_bucket'],
    });
  });
  it('name 없음 → 400 · 본문이 JSON 이 아니면 400', async () => {
    expect((await post({ provider: 'gcp', resource_type: 'service_account' })).res.status).toBe(400);
    const { res } = await req(app, '/v1/validate', { method: 'POST', body: '{' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, errors: ['본문이 JSON 이 아니다'] });
  });
});
