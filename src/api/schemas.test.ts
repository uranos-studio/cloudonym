import { describe, it, expect } from 'vitest';
import { parseEventBody, parseGenerateBody, parseNamesBody, parseValidateBody, parseWizardBody, toWirePath, UI_COPY_TARGETS } from './schemas';
import { WIZARD_WIRE_SAMPLE } from './test-support';
import { MAX_PICKS_PER_SERVICE, validatePlan } from '../core/wizard/plan';
import { rulesFor } from '../core/constraints';
import { RULES_REVISION } from '../core/revision';
import { ENABLED_PROVIDERS } from '../core/types';
import { REGIONS } from '../core/regions-data';

// 존 코드 — 이름에 들어가는 꼴 그대로라 바꾼 기록이 없다. 풀면 리전 코드 + 존 코드 (D49 · D50)
const ctx = { owner: 'infra', system: 'billing', purpose: 'trade', env: 'prod', region: 'ane3a' };
const parsedCtx = { ...ctx, region: 'ane3', zone: 'ane3a' };

describe('parseGenerateBody', () => {
  it('정상 — providers 는 중복을 없앤다', () => {
    const r = parseGenerateBody({ context: ctx, providers: ['gcp', 'gcp'] });
    // 존 코드는 리전 코드로 풀리고 그 기록이 남는다 — 존은 이름에 들지 않는다 (D50 revised)
    expect(r).toEqual({ ok: true, value: { contexts: { gcp: parsedCtx }, transformed: [{ code: 'context.normalized', field: 'region', params: { from: 'ane3a', to: 'ane3' } }], providers: ['gcp'] } });
  });
  it('providers 생략 → 켜진 것만 (D45)', () => {
    const r = parseGenerateBody({ context: ctx });
    expect(r.ok && r.value.providers).toEqual(['gcp']);
    expect(r.ok && r.value.providers).toEqual([...ENABLED_PROVIDERS]);
  });
  it('아는데 꺼진 provider → 400 request.provider_not_enabled · supported 는 켜진 것 (D45)', () => {
    expect(parseGenerateBody({ context: ctx, providers: ['aws'] }))
      .toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.provider_not_enabled', field: 'providers[0]', params: { provider: 'aws' } }], supported: ['gcp'] } });
    // 켜진 것과 섞여도 꺼진 자리마다 하나 · 모르는 값은 value_unsupported 그대로
    expect(parseGenerateBody({ context: ctx, providers: ['gcp', 'azure', 'oci', 'aws'] }))
      .toEqual({ ok: false, rejection: { status: 400, errors: [
        { code: 'request.provider_not_enabled', field: 'providers[1]', params: { provider: 'azure' } },
        { code: 'request.value_unsupported', field: 'providers[2]', params: { value: 'oci' } },
        { code: 'request.provider_not_enabled', field: 'providers[3]', params: { provider: 'aws' } },
      ], supported: ['gcp'] } });
  });
  it('객체가 아닌 본문 · context 없음 · context null → 400 본문', () => {
    expect(parseGenerateBody('x')).toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.body_not_object' }] } });
    expect(parseGenerateBody({})).toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.context_not_object' }] } });
    expect(parseGenerateBody({ context: null })).toMatchObject({ ok: false });
  });
  it('providers 배열 아님 · 빈 배열 · 모르는 값 → supported 는 켜진 것', () => {
    const supported = ['gcp'];
    expect(parseGenerateBody({ context: ctx, providers: 'gcp' })).toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.providers_not_array' }], supported } });
    expect(parseGenerateBody({ context: ctx, providers: [] })).toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.providers_empty' }], supported } });
    expect(parseGenerateBody({ context: ctx, providers: ['oci', 1] })).toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.value_unsupported', field: 'providers[0]', params: { value: 'oci' } }, { code: 'request.value_unsupported', field: 'providers[1]', params: { value: '1' } }], supported } });
  });
  it('parseContext 의 오류를 그대로 전달한다 (owner → region 순서)', () => {
    const r = parseGenerateBody({ context: { ...ctx, owner: '', region: 'mars' } });
    expect(r).toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'context.empty', field: 'owner' }, { code: 'context.value_unsupported', field: 'region', params: { value: 'mars', supported: REGIONS.gcp.map((x) => x.region) } }] } });
  });
});

describe('parseValidateBody', () => {
  it('정상', () => {
    expect(parseValidateBody({ provider: 'gcp', resource_type: 'service_account', name: 'x' }))
      .toEqual({ ok: true, value: { provider: 'gcp', resourceType: 'service_account', name: 'x' } });
  });
  it('모르는 provider · resource_type · 문자열 아닌 name → 400 + supported', () => {
    expect(parseValidateBody({ provider: 'oci', resource_type: 'x', name: 'x' }))
      .toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.value_unsupported', field: 'provider', params: { value: 'oci' } }], supported: ['gcp'] } });
    expect(parseValidateBody({ provider: 'gcp', resource_type: 'nope', name: 'x' }))
      .toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.value_unsupported', field: 'resource_type', params: { value: 'nope' } }], supported: rulesFor('gcp').map((r) => r.resourceType) } });
    expect(parseValidateBody({ provider: 'gcp', resource_type: 'project_id', name: 3 }))
      .toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.field_not_string', field: 'name' }] } });
  });
  it('아는데 꺼진 provider → 400 request.provider_not_enabled · supported 는 켜진 것 (D45)', () => {
    for (const provider of ['aws', 'azure']) {
      expect(parseValidateBody({ provider, resource_type: 's3_bucket', name: 'x' }))
        .toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.provider_not_enabled', field: 'provider', params: { provider } }], supported: ['gcp'] } });
    }
  });
});

describe('parseEventBody', () => {
  it('셋만 받는다 — 그 외 400 + supported', () => {
    for (const e of ['ui_visit', 'ui_generate']) expect(parseEventBody({ event: e })).toEqual({ ok: true, value: { event: e } });
    expect(parseEventBody({ event: 'ui_copy', target: 'terraform' })).toEqual({ ok: true, value: { event: 'ui_copy', target: 'terraform' } });
    expect(parseEventBody({ event: 'api_generate' }))
      .toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.value_unsupported', field: 'event', params: { value: 'api_generate' } }], supported: ['ui_visit', 'ui_generate', 'ui_copy'] } });
    expect(parseEventBody(null)).toMatchObject({ ok: false });
  });
  it('필드가 없으면 request.field_missing — 값 자리에 "undefined" 를 싣지 않는다', () => {
    expect(parseEventBody({}))
      .toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.field_missing', field: 'event' }], supported: ['ui_visit', 'ui_generate', 'ui_copy'] } });
    expect(parseValidateBody({ resource_type: 'project_id', name: 'x' }))
      .toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.field_missing', field: 'provider' }], supported: ['gcp'] } });
    expect(parseValidateBody({ provider: 'gcp', name: 'x' }))
      .toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.field_missing', field: 'resource_type' }], supported: rulesFor('gcp').map((r) => r.resourceType) } });
    // null 은 보낸 값이다 — 목록 밖 값으로 되돌려 싣는다
    expect(parseEventBody({ event: null }))
      .toMatchObject({ rejection: { errors: [{ code: 'request.value_unsupported', field: 'event', params: { value: 'null' } }] } });
  });
  it('ui_copy 의 target — 여섯 중 하나만 · 없거나 모르면 400 + supported 여섯 · 다른 이벤트의 target 은 버린다 (D56)', () => {
    expect(UI_COPY_TARGETS).toEqual(['share-url', 'name', 'all-names', 'names-json', 'terraform', 'tags-json']);
    for (const target of UI_COPY_TARGETS) expect(parseEventBody({ event: 'ui_copy', target })).toEqual({ ok: true, value: { event: 'ui_copy', target } });
    expect(parseEventBody({ event: 'ui_copy' }))
      .toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.field_missing', field: 'target' }], supported: [...UI_COPY_TARGETS] } });
    expect(parseEventBody({ event: 'ui_copy', target: 'name:gcp.project_id' }))
      .toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.value_unsupported', field: 'target', params: { value: 'name:gcp.project_id' } }], supported: [...UI_COPY_TARGETS] } });
    expect(parseEventBody({ event: 'ui_copy', target: 'x'.repeat(2000) })).toMatchObject({ ok: false, rejection: { status: 400, errors: [{ code: 'request.field_too_long', field: 'target' }] } });
    expect(parseEventBody({ event: 'ui_visit', target: 'terraform' })).toEqual({ ok: true, value: { event: 'ui_visit' } });
    expect(parseEventBody({ event: 'ui_generate', target: 'nonsense' })).toEqual({ ok: true, value: { event: 'ui_generate' } });
  });
});

describe('toString 이 호출 불가능한 객체 — 500 이 아니라 400', () => {
  const evil = { toString: 1 };
  it('provider · resource_type 자리 → ok:false', () => {
    const p = parseValidateBody({ provider: evil, resource_type: 'x', name: 'y' });
    expect(p).toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.value_unsupported', field: 'provider', params: { value: '{"toString":1}' } }], supported: ['gcp'] } });
    const r = parseValidateBody({ provider: 'gcp', resource_type: evil, name: 'y' });
    expect(r).toMatchObject({ ok: false, rejection: { status: 400, errors: [{ code: 'request.value_unsupported', field: 'resource_type', params: { value: '{"toString":1}' } }] } });
  });
  it('providers 원소 자리 → ok:false', () => {
    expect(parseGenerateBody({ context: ctx, providers: ['gcp', evil] }))
      .toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.value_unsupported', field: 'providers[1]', params: { value: '{"toString":1}' } }], supported: ['gcp'] } });
  });
  it('event 자리 → ok:false', () => {
    expect(parseEventBody({ event: evil }))
      .toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.value_unsupported', field: 'event', params: { value: '{"toString":1}' } }], supported: ['ui_visit', 'ui_generate', 'ui_copy'] } });
  });
  it('오류 params 에 넣는 값은 80자까지 — 긴 배열 원소를 되돌려 주지 않는다', () => {
    const r = parseGenerateBody({ context: ctx, providers: ['x'.repeat(500)] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection.errors[0]).toEqual({ code: 'request.value_unsupported', field: 'providers[0]', params: { value: `${'x'.repeat(80)}…` } });
  });
});

describe('rules_version (D27 ⑴)', () => {
  const current = RULES_REVISION;
  it('없거나 undefined 면 통과 · 지금 버전과 같으면 통과', () => {
    expect(parseGenerateBody({ context: ctx }).ok).toBe(true);
    expect(parseGenerateBody({ context: ctx, rules_version: current }).ok).toBe(true);
    expect(parseValidateBody({ provider: 'gcp', resource_type: 'service_account', name: 'x', rules_version: current }).ok).toBe(true);
  });
  it('다르면 409 · 빈 문자열도 다르므로 409', () => {
    for (const v of ['2026-09-15.1', '']) {
      expect(parseGenerateBody({ context: ctx, rules_version: v }))
        .toEqual({ ok: false, rejection: { status: 409, errors: [{ code: 'request.rules_version_mismatch', params: { requested: v, current } }] } });
    }
    expect(parseValidateBody({ provider: 'gcp', resource_type: 'service_account', name: 'x', rules_version: 'old' })).toMatchObject({ ok: false, rejection: { status: 409 } });
  });
  it('requested 는 다른 사용자 값처럼 80자로 자르고 보이지 않는 문자를 바꾼다', () => {
    const r = parseGenerateBody({ context: ctx, rules_version: 'y'.repeat(1024) });
    expect(r).toEqual({ ok: false, rejection: { status: 409, errors: [{ code: 'request.rules_version_mismatch', params: { requested: `${'y'.repeat(80)}…`, current } }] } });
    const rlo = String.fromCodePoint(0x202e);
    expect(parseGenerateBody({ context: ctx, rules_version: `a${rlo}b` })).toMatchObject({ rejection: { errors: [{ params: { requested: 'a\\u202Eb' } }] } });
  });
  it('문자열이 아니면(null · 숫자 · 객체) 400 · 1024자 넘으면 400', () => {
    for (const v of [null, 1, { a: 1 }]) {
      expect(parseGenerateBody({ context: ctx, rules_version: v }))
        .toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.field_not_string', field: 'rules_version' }] } });
    }
    expect(parseGenerateBody({ context: ctx, rules_version: 'x'.repeat(1025) }))
      .toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.field_too_long', field: 'rules_version', params: { max: 1024 } }] } });
  });
});

describe('parseNamesBody (D39)', () => {
  const ok = { provider: 'gcp', context: ctx, resources: [{ type: 'compute_instance', count: 2 }, { type: 'project_id' }] };
  it('정상 — provider · 정규화된 문맥 · 선택 항목(규칙 · count)', () => {
    const r = parseNamesBody(ok);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.provider).toBe('gcp');
    expect(r.value.context).toEqual(parsedCtx);
    expect(r.value.items.map((i) => [i.rule.id, i.count])).toEqual([['gcp.compute_instance', 2], ['gcp.project_id', 1]]);
  });
  it('아는데 꺼진 provider → 400 request.provider_not_enabled · supported 는 켜진 것 (D45)', () => {
    expect(parseNamesBody({ ...ok, provider: 'azure', resources: [{ type: 'virtual_machine' }] }))
      .toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.provider_not_enabled', field: 'provider', params: { provider: 'azure' } }], supported: ['gcp'] } });
  });
  it('provider 없음 → 400 request.field_missing · 모르는 값 → request.value_unsupported · supported 는 켜진 것', () => {
    const supported = ['gcp'];
    expect(parseNamesBody({ ...ok, provider: undefined }))
      .toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.field_missing', field: 'provider' }], supported } });
    expect(parseNamesBody({ ...ok, provider: 'oci' }))
      .toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.value_unsupported', field: 'provider', params: { value: 'oci' } }], supported } });
  });
  it('본문 · context 모양 오류는 generate 와 같다', () => {
    expect(parseNamesBody([1])).toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.body_not_object' }] } });
    expect(parseNamesBody({ ...ok, context: null })).toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.context_not_object' }] } });
  });
  it('resources 의 selection.* 오류를 core 코드 그대로 400 으로 — 모르는 type 이면 supported 는 그 provider 의 resource_type', () => {
    expect(parseNamesBody({ ...ok, resources: [] })).toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'selection.empty' }] } });
    expect(parseNamesBody({ ...ok, resources: 'vm' })).toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'selection.not_array' }] } });
    const types = rulesFor('gcp').map((r) => r.resourceType);
    expect(parseNamesBody({ ...ok, resources: [{ type: 'nope' }] }))
      .toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'selection.unknown_type', params: { index: 0, value: 'nope' } }], supported: types } });
    expect(parseNamesBody({ ...ok, resources: [{ type: 'storage_bucket', count: 2 }] }))
      .toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'selection.count_not_supported', params: { index: 0, type: 'storage_bucket' } }] } });
  });
  it('문맥 오류와 선택 오류는 함께 낸다 — 문맥 먼저', () => {
    const r = parseNamesBody({ ...ok, context: { ...ctx, env: 'preprod' }, resources: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection.errors.map((e) => e.code)).toEqual(['context.value_unsupported', 'selection.empty']);
  });
  it('되돌려 싣는 type · role 값은 80자까지 · 보이지 않는 문자는 \\uXXXX (8775326 방식)', () => {
    const long = parseNamesBody({ ...ok, resources: [{ type: 'x'.repeat(500) }] });
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.rejection.errors[0]).toMatchObject({ code: 'selection.unknown_type', params: { value: `${'x'.repeat(80)}…` } });
    const rlo = String.fromCodePoint(0x202e);
    const role = parseNamesBody({ ...ok, resources: [{ type: 'service_account', role: `d${rlo}b` }] });
    if (!role.ok) expect(role.rejection.errors[0]).toMatchObject({ code: 'selection.invalid_role', params: { value: 'd\\u202Eb' } });
    expect(role.ok).toBe(false);
  });
  it('type · role 문자열이 1024자를 넘으면 400 request.field_too_long (field 는 resources[i].type)', () => {
    expect(parseNamesBody({ ...ok, resources: [{ type: 'compute_instance' }, { type: 'x'.repeat(1025) }] }))
      .toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.field_too_long', field: 'resources[1].type', params: { max: 1024 } }] } });
  });
  it('kind 문자열이 1024자를 넘으면 400 request.field_too_long (field 는 resources[i].kind) — 엔진까지 가지 않는다', () => {
    expect(parseNamesBody({ ...ok, resources: [{ type: 'cloud_sql_instance', kind: 'K'.repeat(1025) }] }))
      .toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.field_too_long', field: 'resources[0].kind', params: { max: 1024 } }] } });
  });
  it('toString 이 호출 불가능한 type → 500 이 아니라 400 selection.unknown_type', () => {
    const r = parseNamesBody({ ...ok, resources: [{ type: { toString: 1 } }] });
    expect(r).toMatchObject({ ok: false, rejection: { status: 400, errors: [{ code: 'selection.unknown_type', params: { value: '{"toString":1}' } }] } });
  });
  it('rules_version 이 다르면 409', () => {
    expect(parseNamesBody({ ...ok, rules_version: 'old' })).toMatchObject({ ok: false, rejection: { status: 409, errors: [{ code: 'request.rules_version_mismatch' }] } });
    expect(parseNamesBody({ ...ok, rules_version: RULES_REVISION }).ok).toBe(true);
  });
});

describe('parseWizardBody (D66) — 모양은 API 가, 마법사 검사는 core validatePlan 이 본다', () => {
  const W = WIZARD_WIRE_SAMPLE;
  const errorsOf = (body: unknown) => {
    const r = parseWizardBody(body);
    return r.ok ? [] : r.rejection.errors;
  };
  const statusOf = (body: unknown) => {
    const r = parseWizardBody(body);
    return r.ok ? 200 : r.rejection.status;
  };
  const one = (pick: unknown) => ({ ...W, project_picks: [], services: [{ purpose: 'shop', picks: [pick] }] });

  it('표본 — 통과 · 프로젝트 문맥(purpose 없음) · 서비스 둘 · wire 이름(project_picks · rule)이 모델 이름으로 바뀐다', () => {
    const r = parseWizardBody(W);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.provider).toBe('gcp');
    expect(r.value.selection.project).toMatchObject({ owner: 'platform', system: 'billing', env: 'prod', region: 'ane3' });
    expect('purpose' in r.value.selection.project).toBe(false);
    expect(r.value.selection.projectItems).toHaveLength(4);
    expect(r.value.selection.services.map((s) => s.purpose)).toEqual(['shop', 'pay']);
    expect(r.value.pickCount).toBe(7);
    expect(r.value.transformed).toEqual([{ code: 'context.normalized', field: 'region', params: { from: 'asia-northeast3-a', to: 'ane3' } }]);
    expect(r.value.labelContexts.map((l) => l.namespace)).toEqual(['project', 'shop', 'pay']);
    const custom = parseWizardBody(one({ preset: null, rule: 'gcp.run_service', instances: [{ id: 'a', seq: '01' }] }));
    expect(custom.ok && custom.value.selection.services[0]!.items[0]!.rule.id).toBe('gcp.run_service');
  });

  it('본문 · provider · project 모양 — 400 · 꺼진 provider 는 provider_not_enabled · supported 는 켜진 것', () => {
    expect(errorsOf('x')).toEqual([{ code: 'request.body_not_object' }]);
    expect(parseWizardBody({ ...W, provider: 'aws' })).toEqual({ ok: false, rejection: { status: 400, errors: [{ code: 'request.provider_not_enabled', field: 'provider', params: { provider: 'aws' } }], supported: ['gcp'] } });
    expect(errorsOf({ ...W, provider: undefined })).toEqual([{ code: 'request.field_missing', field: 'provider' }]);
    expect(errorsOf({ ...W, provider: 'oci' })).toEqual([{ code: 'request.value_unsupported', field: 'provider', params: { value: 'oci' } }]);
    expect(errorsOf({ ...W, project: null })).toEqual([{ code: 'request.context_not_object' }]);
    expect(errorsOf({ ...W, project: 'x' })).toEqual([{ code: 'request.context_not_object' }]);
  });

  it('rules_version — 다르면 409 · 지금 값이면 통과 · 문자열 아님 400', () => {
    expect(parseWizardBody({ ...W, rules_version: 'old' })).toMatchObject({ ok: false, rejection: { status: 409, errors: [{ code: 'request.rules_version_mismatch' }] } });
    expect(parseWizardBody({ ...W, rules_version: RULES_REVISION }).ok).toBe(true);
    expect(statusOf({ ...W, rules_version: 1 })).toBe(400);
  });

  it('길이 상한 — owner · system · purpose 64 · env · region · pick 문자열 1024 → request.field_too_long (field 는 wire 경로)', () => {
    expect(errorsOf({ ...W, services: [{ purpose: 'p'.repeat(65), picks: [{ preset: 'web', instances: [{ id: 'a', seq: '01' }] }] }] }))
      .toEqual([{ code: 'request.field_too_long', field: 'services[0].purpose', params: { max: 64 } }]);
    expect(errorsOf({ ...W, project: { ...W.project, owner: 'o'.repeat(65), region: 'r'.repeat(1025) } })).toEqual([
      { code: 'request.field_too_long', field: 'project.owner', params: { max: 64 } },
      { code: 'request.field_too_long', field: 'project.region', params: { max: 1024 } },
    ]);
    expect(errorsOf({ ...W, project_picks: [{ preset: null, rule: 'x'.repeat(1025) }] })).toEqual([{ code: 'request.field_too_long', field: 'project_picks[0].rule', params: { max: 1024 } }]);
    expect(errorsOf(one({ preset: 'web', instances: [{ id: 'a', seq: '01', attach: { data: ['0'.repeat(1025)] } }] })))
      .toEqual([{ code: 'request.field_too_long', field: 'services[0].picks[0].instances[0].attach.data[0]', params: { max: 1024 } }]);
  });

  it('프로젝트 문맥 오류 — context.* 의 field 에 project. 접두', () => {
    expect(errorsOf({ ...W, project: { ...W.project, env: 'preprod' } })).toEqual([
      { code: 'context.value_unsupported', field: 'project.env', params: { value: 'preprod', supported: ['prod', 'stg', 'dev', 'sbx', 'qa', 'uat', 'test', 'perf', 'dr'] } },
    ]);
    expect(errorsOf({ ...W, project: { system: 'billing', env: 'prod', region: 'global' } })).toEqual([{ code: 'context.not_string', field: 'project.owner' }]);
  });

  it('모델 전체 오류는 field 가 없다 — wizard.empty · too_many_services · too_many_names · selection.not_array', () => {
    expect(errorsOf({ ...W, project_picks: [], services: [] })).toEqual([{ code: 'wizard.empty' }]);
    expect(errorsOf({ ...W, project_picks: undefined, services: undefined })).toEqual([{ code: 'wizard.empty' }]);
    const many = Array.from({ length: 21 }, (_, i) => ({ purpose: `s${i}`, picks: [{ preset: 'web', instances: [{ id: 'a', seq: '01' }] }] }));
    expect(errorsOf({ ...W, services: many })).toEqual([{ code: 'wizard.too_many_services', params: { max: 20, actual: 21 } }]);
    expect(errorsOf({ ...W, services: 'x' })).toEqual([{ code: 'selection.not_array' }]);
    expect(errorsOf({ ...W, project_picks: {} })).toEqual([{ code: 'selection.not_array' }]);
  });

  it('pick 상한 — 서비스는 field services[0] · 프로젝트 공용은 project_picks', () => {
    const picks = Array.from({ length: MAX_PICKS_PER_SERVICE + 1 }, (_, i) => ({ preset: 'firewall', tier: `t${i}`, instances: [{ id: 'a', seq: '01' }] }));
    expect(MAX_PICKS_PER_SERVICE).toBe(40);
    expect(errorsOf({ ...W, project_picks: [], services: [{ purpose: 'shop', picks }] }))
      .toContainEqual({ code: 'wizard.too_many_picks', field: 'services[0]', params: { index: 0, max: 40, actual: 41 } });
    expect(errorsOf({ ...W, project_picks: picks, services: [] }))
      .toContainEqual({ code: 'wizard.too_many_picks', field: 'project_picks', params: { index: -1, max: 40, actual: 41 } });
  });

  it('위치 오류 — field 는 toWirePath(모델 경로) · 프로젝트 공용 딸린 것의 두 표기', () => {
    const body = { ...W, services: [], project_picks: [{ preset: null, rule: 'gcp.compute_instance', instances: [{ id: 'a', seq: '01', attach: { data: ['01', '00'] } }] }] };
    // 모델 표기는 validatePlan 이 낸다 — 같은 입력을 모델로 넣어 path 를 본다
    const model = validatePlan({ provider: 'gcp', project: W.project, projectPicks: [{ preset: null, ruleId: 'gcp.compute_instance', instances: [{ id: 'a', seq: '01', attach: { data: ['01', '00'] } }] }], services: [] });
    expect(model.ok ? [] : model.errors.map((e) => e.path)).toEqual(['projectPicks[0].instances[0].attach.data[1]']);
    expect(errorsOf(body)).toEqual([{ code: 'wizard.invalid_data_seq', field: 'project_picks[0].instances[0].attach.data[1]', params: { index: 0, value: '00', pattern: '^(0[1-9]|[1-9][0-9])$' } }]);
    expect(toWirePath('projectPicks[0].instances[0].attach.data[1]')).toBe('project_picks[0].instances[0].attach.data[1]');
  });

  it('toWirePath — 표의 모든 줄 (바뀌는 둘 · 같은 글자 열여덟) · 모르는 글자 · 원형 속성은 그대로', () => {
    expect(toWirePath('projectPicks')).toBe('project_picks');
    expect(toWirePath('ruleId')).toBe('rule');
    for (const same of ['services', 'purpose', 'picks', 'preset', 'tier', 'role', 'kind', 'ha', 'serverless', 'instances', 'id', 'seq', 'attach', 'boot', 'data', 'ip', 'ipi']) {
      expect(toWirePath(same), same).toBe(same);
    }
    expect(toWirePath('services[1].picks[0].instances[1].attach.ipi')).toBe('services[1].picks[0].instances[1].attach.ipi');
    expect(toWirePath('constructor.toString')).toBe('constructor.toString');
  });

  it('selection.unknown_type — 되돌리는 값은 80자 · supported 는 gcp 규칙 id', () => {
    const r = parseWizardBody(one({ preset: null, rule: 'y'.repeat(500) }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.rejection.errors[0]).toMatchObject({ code: 'selection.unknown_type', field: 'services[0].picks[0]', params: { value: `${'y'.repeat(80)}…` } });
    expect(r.rejection.supported).toContain('gcp.compute_instance');
  });

  it('HA · seq · data 순번 — 400 과 그 code', () => {
    const codes = (pick: unknown) => errorsOf(one(pick)).map((e) => e.code);
    const two = [{ id: 'a', seq: '01' }, { id: 'b', seq: '02' }];
    expect(codes({ preset: 'web', serverless: 'gcp.cloud_function', ha: true, instances: two })).toEqual(['wizard.ha_not_supported']);
    expect(codes({ preset: 'bastion', ha: true, instances: two })).toEqual(['wizard.ha_not_supported']);
    expect(codes({ preset: null, rule: 'gcp.compute_instance', ha: true, instances: two })).toEqual(['wizard.ha_not_supported']);
    for (const seq of ['00', '7', '100', 'ab']) expect(codes({ preset: 'web', instances: [{ id: 'a', seq }] }), seq).toEqual(['wizard.invalid_seq']);
    expect(codes({ preset: 'web', instances: [{ id: 'a', seq: '01', attach: { data: ['00'] } }] })).toEqual(['wizard.invalid_data_seq']);
  });

  it('틀린 모양은 던지지 않고 400 — services:[null] · picks:x · attach:x · instances:x · pick null · slot null', () => {
    for (const body of [
      { ...W, services: [null] }, { ...W, services: [{ purpose: 'shop', picks: 'x' }] },
      one({ preset: 'web', instances: [{ id: 'a', seq: '01', attach: 'x' }] }), one({ preset: 'web', instances: 'x' }),
      one(null), one({ preset: 'web', instances: [null] }), { ...W, project_picks: [1] }, { ...W, services: [{ purpose: 3, picks: [] }] },
    ]) {
      expect(() => parseWizardBody(body)).not.toThrow();
      expect(statusOf(body), JSON.stringify(body).slice(0, 120)).toBe(400);
    }
  });

  it('/v1/names 는 마법사 필드(tier · instances · level · attach)를 모르는 필드로 무시한다 — 결과가 없을 때와 같다', () => {
    const base = { provider: 'gcp', context: ctx, resources: [{ type: 'compute_instance', count: 2 }] };
    const extra = { ...base, resources: [{ type: 'compute_instance', count: 2, tier: 'web', level: 'project', instances: [{ seq: '05' }], attach: { boot: true } }] };
    expect(parseNamesBody(extra)).toEqual(parseNamesBody(base));
  });
});
