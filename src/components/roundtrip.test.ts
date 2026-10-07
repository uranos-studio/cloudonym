// 화면 수준 왕복 (D50 · D55 · codex #6) — 폼의 지역 입력 → parseContext → encodeState → (주소창) → openHash → 폼 → parseContext → generateMany.
// App 이 하는 순서를 그대로 밟는다: 첫 로드 · 새로고침 · 같은 탭 hash 이동은 모두 openHash 를 지난다
import { describe, it, expect } from 'vitest';
import { generateMany, parseContext } from '../core/engine';
import { getRule } from '../core/constraints';
import { canonicalRegion } from '../core/regions';
import { ENABLED_PROVIDERS, type NamingContext, type Provider } from '../core/types';
import type { SelectionItem } from '../core/selection';
import { decodeState, encodeState } from './urlState';
import { openHash } from './openHash';
import { DEFAULT_FORM, EXAMPLE_REGION, formOf, type FormContext } from './formContext';
import { VERSION } from '../version';

const disk = (): SelectionItem[] => [{ rule: getRule('gcp', 'disk')!, count: 1 }];
const vmAndVpc = (): SelectionItem[] => [{ rule: getRule('gcp', 'compute_instance')!, count: 1 }, { rule: getRule('gcp', 'vpc_network')!, count: 1 }];

/** 폼 → 문맥 (App 의 parsed) */
function ctxOf(form: FormContext, provider: Provider = 'gcp'): NamingContext {
  const parsed = parseContext(form, provider);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.context;
}
/** 지금 화면 상태의 hash (App 의 stateKey → 주소창) */
const hashOf = (ctx: NamingContext, selection: SelectionItem[]) => `#state=${encodeState(ctx, VERSION.rules, { provider: 'gcp', selection })}`;
const names = (ctx: NamingContext, items: SelectionItem[]) => generateMany(ctx, 'gcp', items).items.map((i) => i.name);

describe('첫 화면 예시 (R0) — 존 이름이라 존 행도 처음부터 이름이 나온다', () => {
  it('EXAMPLE_REGION 은 asia-northeast3-a 이고 켜진 CSP 모두에서 풀린다', () => {
    expect(EXAMPLE_REGION).toBe('asia-northeast3-a');
    expect(DEFAULT_FORM).toEqual({ owner: 'platform', system: 'billing', purpose: 'trade', env: 'prod', region: EXAMPLE_REGION });
    for (const p of ENABLED_PROVIDERS) expect(parseContext(DEFAULT_FORM, p).ok, p).toBe(true);
  });
  it('기본 문맥 · disk → billing-trade-prod-ane3a-disk-01 (disk 템플릿에 owner 가 없다)', () => {
    expect(names(ctxOf(DEFAULT_FORM), disk())).toEqual(['billing-trade-prod-ane3a-disk-01']);
  });
});

describe('공유 · 새로고침 왕복에서 존이 남는다 (D50 · codex #6)', () => {
  it('asia-northeast3-a → parseContext → encodeState → openHash → 폼 → parseContext → disk 이름이 같다', () => {
    const ctx = ctxOf({ ...DEFAULT_FORM, region: 'asia-northeast3-a' });
    expect(ctx).toMatchObject({ region: 'ane3', zone: 'ane3a' });
    const hash = hashOf(ctx, disk());
    const opened = openHash(hash, undefined)!;
    // 폼은 지역 입력 문자열을 든다 — 정규화된 문맥(region: ane3)으로 덮지 않는다
    expect(opened.form.region).toBe('ane3a');
    expect(opened.form).not.toHaveProperty('zone');
    const again = ctxOf(opened.form);
    expect(again).toEqual(ctx);
    expect(names(again, opened.selection)).toEqual(['billing-trade-prod-ane3a-disk-01']);
    // 다시 공유해도 같은 hash — 링크 상태가 유지된다
    expect(hashOf(again, opened.selection)).toBe(hash);
  });
  it('hash 의 region 은 존 코드(있으면) · 리전 코드 · global', () => {
    const body = (form: FormContext) => JSON.parse(atob(encodeState(ctxOf(form)).replace(/-/g, '+').replace(/_/g, '/'))) as { region: string };
    expect(body({ ...DEFAULT_FORM, region: 'asia-northeast3-a' }).region).toBe('ane3a');
    expect(body({ ...DEFAULT_FORM, region: 'asia-northeast3' }).region).toBe('ane3');
    expect(body({ ...DEFAULT_FORM, region: 'global' }).region).toBe('global');
  });
  it('리전만 넣은 링크는 리전만 남는다 — 존 행은 name.zone_required · 리전 행 · global 행은 그대로', () => {
    const ctx = ctxOf({ ...DEFAULT_FORM, region: 'asia-northeast3' });
    const opened = openHash(hashOf(ctx, vmAndVpc()), undefined)!;
    expect(opened.form.region).toBe('ane3');
    const r = generateMany(ctxOf(opened.form), 'gcp', opened.selection);
    expect(r.items.map((i) => [i.name, i.valid, i.violations.map((v) => v.code)])).toEqual([
      ['', false, ['name.zone_required']],
      ['billing-trade-prod-vpc-01', true, []],
    ]);
  });
  it('같은 탭 hash 이동 — 둘째 링크의 존이 그대로 열리고, 비콘 key 는 다시 그린 문맥의 key 와 같다(ui_generate 를 세지 않는다)', () => {
    const a = openHash(hashOf(ctxOf({ ...DEFAULT_FORM, region: 'asia-northeast3-a' }), disk()), undefined)!;
    const b = openHash(hashOf(ctxOf({ ...DEFAULT_FORM, owner: 'infra', region: 'asia-northeast3-c' }), disk()), undefined)!;
    expect([a.form.region, b.form.region]).toEqual(['ane3a', 'ane3c']);
    expect(names(ctxOf(b.form), b.selection)).toEqual(['billing-trade-prod-ane3c-disk-01']);
    // App 은 hashchange 때 lastSentKey 를 이 값으로 맞추고, 다시 그린 뒤의 contextKey 는 폼을 파싱한 문맥으로 만든다 — 둘이 같아야 한다
    for (const o of [a, b]) expect(encodeState(o.context, VERSION.rules)).toBe(encodeState(ctxOf(o.form), VERSION.rules));
  });
  it('존 코드가 가장 긴(6자) 리전도 왕복한다 — ause1a', () => {
    expect(canonicalRegion('australia-southeast1-a', 'gcp')).toEqual({ region: 'ause1', zone: 'ause1a' });
    const ctx = ctxOf({ ...DEFAULT_FORM, region: 'australia-southeast1-a' });
    const opened = openHash(hashOf(ctx, disk()), undefined)!;
    expect(names(ctxOf(opened.form), opened.selection)).toEqual(['billing-trade-prod-ause1a-disk-01']);
  });
  it('formOf — 문맥의 존 코드가 있으면 그것, 없으면 리전 코드', () => {
    expect(formOf({ owner: 'a', system: 'b', purpose: 'c', env: 'prod', region: 'ane3', zone: 'ane3a' })).toEqual({ owner: 'a', system: 'b', purpose: 'c', env: 'prod', region: 'ane3a' });
    expect(formOf({ owner: 'a', system: 'b', purpose: 'c', env: 'dev', region: 'global' }).region).toBe('global');
  });
});

describe('옛 링크', () => {
  it('옛 kr 링크는 통째로 안 열린다 — 공개 전이라 허용 (D55)', () => {
    const old = `#state=${btoa(JSON.stringify({ ...DEFAULT_FORM, region: 'kr', v: '2026-10-07.2', p: 'gcp', r: { disk: 1 } }))}`;
    expect(decodeState(old)).toBeUndefined();
    expect(openHash(old, undefined)).toBeUndefined();
  });
});

describe('꺼진 CSP 링크 (D55 ①~⑤) — 공유 → 열기 → 재파싱 왕복', () => {
  const azureLink = `#state=${btoa(JSON.stringify({ owner: 'infra', system: 'ledger', purpose: 'batch', env: 'production', region: 'krc', v: '2026-10-06.4', p: 'azure', r: { virtual_machine: 2, resource_group: 1 } }))}`;
  it('자유 입력 셋 · 환경은 남고 지역은 예시로 · 선택은 비고 · 켜진 CSP · 안내', () => {
    const o = openHash(azureLink, undefined)!;
    expect(o.form).toEqual({ owner: 'infra', system: 'ledger', purpose: 'batch', env: 'prod', region: 'ane3a' });
    expect(o.provider).toBe('gcp');
    expect(o.picked.size).toBe(0);
    expect(o.selection).toEqual([]);
    expect(o.unavailable).toBe('azure');
    expect(o.dropped).toBe(2);
    expect(names(ctxOf(o.form), disk())).toEqual(['ledger-batch-prod-ane3a-disk-01']);
  });
  it('그 상태를 공유해 다시 열면 같은 문맥 · 안내 없음', () => {
    const o = openHash(azureLink, undefined)!;
    const again = openHash(hashOf(ctxOf(o.form), []), undefined)!;
    expect(again.form).toEqual(o.form);
    expect(again.unavailable).toBeUndefined();
  });
});

import { buildTree } from '../core/tree';
import { toItems } from './selection';
import { hashToWrite, mismatchedLinkVersion } from './linkRevision';

describe('기본값 종류를 적은 손 링크(「2:MYSQL」) — 상태는 종류 없음 · 링크 상태(D27 ⑵)는 그대로', () => {
  it('옛 v 링크를 열면 picked 에 kind 가 없고, App 의 stateKey 가 링크 key 와 같아 hash 를 덮지 않고 버전 안내가 남는다', () => {
    const old = '2026-09-01.1';
    const hash = `#state=${btoa(JSON.stringify({ owner: 'infra', system: 'billing', purpose: 'trade', env: 'prod', region: 'ane3a', v: old, p: 'gcp', r: { cloud_sql_instance: '2:MYSQL' } }))}`;
    const o = openHash(hash, undefined)!;
    expect(o.picked.get('cloud_sql_instance')).toEqual({ count: 2 });
    // App 이 첫 그리기에서 만드는 key — 폼을 다시 파싱한 문맥 · 트리 순서의 선택
    const stateKey = encodeState(ctxOf(o.form), VERSION.rules, { provider: 'gcp', selection: toItems(buildTree('gcp'), o.picked) });
    expect(stateKey).toBe(o.link.key);
    expect(hashToWrite(stateKey, o.link)).toBeUndefined();
    expect(mismatchedLinkVersion(stateKey, o.link, VERSION.rules)).toBe(old);
  });
});
