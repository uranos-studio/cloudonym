import { describe, it, expect } from 'vitest';
import { app } from './index';
import { req, jsonPost, json } from './test-support';
import { VERSION } from '../version';
import { GCP_INTAKE_ROWS } from '../core/rules/gcp-intake';
import { GCP_MANUAL_RULES } from '../core/rules/gcp-manual';

const post = (body: unknown) => req(app, '/v1/validate', jsonPost(body));

describe('POST /v1/validate', () => {
  it('① 예시: 34자 SA → valid:false · 이유 · suggested_name', async () => {
    const { res } = await post({ provider: 'gcp', resource_type: 'service_account', name: 'infra-billing-trade-prd-kr-sa-sync' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      valid: false, version: VERSION,
      violations: [{ code: 'name.too_long', params: { actual: 34, max: 30 }, message: 'Name is 34 characters long; the maximum is 30' }],
      suggested_name: 'billing-trade-prd-kr-sa-sync',
    });
  });
  it('유효한 이름 → { valid:true, version, violations:[] } — suggested_name 키가 없다', async () => {
    const body = await json((await post({ provider: 'aws', resource_type: 's3_bucket', name: 'infra-billing-trade-prd-bucket' })).res);
    expect(body).toEqual({ valid: true, version: VERSION, violations: [] });
    expect('suggested_name' in body).toBe(false);
  });
  it('정제만으로 되는 이름은 그 값을 제안한다 (TC-AZ-01)', async () => {
    const body = await json((await post({ provider: 'azure', resource_type: 'storage_account', name: 'st-web-prod' })).res);
    expect(body).toMatchObject({ valid: false, suggested_name: 'stwebprod' });
  });
  it('모르는 provider → 400 + supported 셋 (Review Focus 5)', async () => {
    const { res } = await post({ provider: 'oci', resource_type: 'bucket', name: 'x' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, errors: [{ code: 'request.value_unsupported', field: 'provider', params: { value: 'oci' }, message: "Unsupported provider 'oci'" }], supported: ['aws', 'gcp', 'azure'] });
  });
  it('모르는 resource_type → 400 + 그 provider 의 유형 목록', async () => {
    const { res } = await post({ provider: 'gcp', resource_type: 'nope', name: 'x' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false, errors: [{ code: 'request.value_unsupported', field: 'resource_type', params: { value: 'nope' }, message: "Unsupported resource_type 'nope'" }],
      supported: ['project_id', 'service_account', 'compute_instance', 'vpc_network', 'subnet', 'cloud_sql_instance', 'storage_bucket', 'firewall_rule', 'disk', ...GCP_INTAKE_ROWS.map((r) => r.id.slice('gcp.'.length)), ...Object.keys(GCP_MANUAL_RULES).map((id) => id.slice('gcp.'.length))],
    });
  });
  it('name 없음 → 400 · 본문이 JSON 이 아니면 400', async () => {
    expect((await post({ provider: 'gcp', resource_type: 'service_account' })).res.status).toBe(400);
    const { res } = await req(app, '/v1/validate', { method: 'POST', body: '{' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, errors: [{ code: 'request.body_not_json', message: 'Request body is not JSON' }] });
  });
});
