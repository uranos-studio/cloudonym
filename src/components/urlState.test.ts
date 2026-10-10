import { describe, it, expect } from 'vitest';
import { decodeState as decodeEnabled, encodeState, shareUrl, MAX_HASH_CHARS, MAX_FIELD_CHARS } from './urlState';
import { MAX_FIELD_CHARS as API_MAX_FIELD_CHARS } from '../api/schemas';
import { PROVIDERS, type NamingContext, type ResourceRule } from '../core/types';
import { MAX_CONTEXT_CHARS } from '../core/engine';
import { MAX_REGION_CHARS } from '../core/regions';

// region global — 세 CSP 표 모두가 받는 값이라 p 가 무엇이든 그대로 풀린다 (D49). CSP 별 지역은 별칭 시험이 본다
const ctx: NamingContext = { owner: 'infra', system: 'billing', purpose: 'trade', env: 'prod', region: 'global' };
const b64 = (v: unknown) => btoa(JSON.stringify(v));
/** 디코더 자체의 시험 — 세 CSP 가 모두 켜진 것으로 푼다. 켜진 CSP 에 따른 동작(D45 · D55)은 맨 아래 절이 기본값(decodeEnabled)으로 본다 */
const decodeState = (hash: string, rules?: readonly ResourceRule[]) => decodeEnabled(hash, rules, PROVIDERS);
/** 문맥만 — v 를 보지 않는 시험용 */
const ctxOf = (hash: string) => decodeState(hash)?.context;

describe('encodeState — Base64url', () => {
  it('왕복이 같다 · 출력에 + / = 가 없다', () => {
    const encoded = encodeState(ctx);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(ctxOf(`#state=${encoded}`)).toEqual(ctx);
  });
  it('한글 owner 도 왕복이 같다 (UTF-8 · btoa 의 Latin1 한계를 넘는다)', () => {
    const ko: NamingContext = { ...ctx, owner: '홍길동' };
    expect(ctxOf(`#state=${encodeState(ko)}`)).toEqual(ko);
  });
  it('필드 순서가 달라도 같은 문자열 — 다섯 필드만 고정 순서로 담는다', () => {
    const shuffled = { region: 'global', env: 'prod', purpose: 'trade', system: 'billing', owner: 'infra', extra: 'x' } as unknown as NamingContext;
    expect(encodeState(shuffled)).toBe(encodeState(ctx));
  });
});

describe('decodeState — 깨진 hash 는 전부 undefined', () => {
  it.each([
    ['#state=!!!', 'Base64 가 아니다'],
    [`#state=${btoa('{not json')}`, 'JSON 이 아니다'],
    [`#state=${b64('billing')}`, 'JSON 이 객체가 아니다(문자열)'],
    [`#state=${b64(['a'])}`, 'JSON 이 배열이다'],
    [`#state=${b64(null)}`, 'JSON 이 null 이다'],
    [`#state=${b64({ owner: 'infra', system: 'billing', purpose: 'trade', env: 'prod' })}`, 'region 이 빠졌다'],
    [`#state=${b64({ ...ctx, owner: 42 })}`, '값이 숫자다'],
    [`#state=${b64({ ...ctx, env: 'qa' })}`, 'env 가 지원 밖이다'],
    ['', '빈 hash'],
    ['#other=abc', '다른 키'],
    ['#state=', '값이 비었다'],
  ])('%s → undefined (%s)', (hash) => {
    expect(ctxOf(hash)).toBeUndefined();
  });
  it('① 예시처럼 표준 Base64(패딩 없음 · + /)도 받는다', () => {
    const std = btoa(JSON.stringify(ctx)).replace(/=+$/, '');
    expect(ctxOf(`#state=${std}`)).toEqual(ctx);
    // 표준 Base64 의 + 와 / 가 들어가는 값
    const plus: NamingContext = { ...ctx, owner: '>>>???' };
    const stdPlus = btoa(JSON.stringify(plus));
    expect(stdPlus).toMatch(/[+/]/);
    expect(ctxOf(`state=${stdPlus}`)).toEqual(plus);
  });
  it('별칭은 parseContext 가 정규화한다 — production · asia-northeast3 → prod · ane3', () => {
    expect(ctxOf(`#state=${b64({ ...ctx, env: 'production', region: 'asia-northeast3' })}`)).toEqual({ ...ctx, region: 'ane3' });
  });
});

describe('지역 자리 (D50 revised · D55) — hash 의 region 은 늘 리전 코드', () => {
  it('zone 이 있어도 region 키에는 리전 코드를 싣는다 — 존은 이름에 들지 않으니 링크에도 싣지 않는다', () => {
    const z: NamingContext = { ...ctx, region: 'ane3', zone: 'ane3a' };
    const encoded = encodeState(z);
    expect(JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')))).toMatchObject({ region: 'ane3' });
    expect(JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')))).not.toHaveProperty('zone');
    expect(encoded).toBe(encodeState({ ...ctx, region: 'ane3' }));
    expect(decodeEnabled(`#state=${encoded}`)?.context).toEqual({ ...ctx, region: 'ane3' });
  });
  it('뼈대의 지역 자리는 MAX_REGION_CHARS(6) — 가장 긴 지역 코드 · global 과 같다', () => {
    expect(MAX_REGION_CHARS).toBe(6);
    expect('global'.length).toBeLessThanOrEqual(MAX_REGION_CHARS);
  });
});

describe('shareUrl', () => {
  it('base 뒤에 #state= 를 붙인다 · 그 URL 의 hash 가 다시 풀린다', () => {
    const url = shareUrl(ctx, 'http://localhost:5173/');
    expect(url.startsWith('http://localhost:5173/#state=')).toBe(true);
    expect(ctxOf(new URL(url).hash)).toEqual(ctx);
  });
});

describe('decodeState 길이 상한', () => {
  const at = (s: string): NamingContext => ({ owner: s, system: s, purpose: s, env: 'prod', region: 'global' });
  /** 가장 긴 v — N 두 자리 */
  const V = '2099-12-31.99';
  const hashOf = (c: NamingContext) => `#${'state'}=${encodeState(c, V)}`;
  it('필드 상한은 API 와 같은 1024 · 자유 입력 셋은 core 의 MAX_CONTEXT_CHARS(64)', () => {
    expect(MAX_FIELD_CHARS).toBe(API_MAX_FIELD_CHARS);
    expect(MAX_CONTEXT_CHARS).toBe(64);
  });
  it.each(['owner', 'system', 'purpose'])('자유 입력 %s 가 64자를 넘으면 undefined(기본값) · 딱 64자는 받는다', (f) => {
    expect(ctxOf(`#state=${b64({ ...ctx, [f]: 'a'.repeat(MAX_CONTEXT_CHARS + 1) })}`)).toBeUndefined();
    expect((ctxOf(`#state=${b64({ ...ctx, [f]: 'a'.repeat(MAX_CONTEXT_CHARS) })}`) as Record<string, string> | undefined)?.[f]).toBe('a'.repeat(MAX_CONTEXT_CHARS));
  });
  it('env 는 1024자까지 받는다(앞뒤 공백은 정본 값으로) · 넘으면 undefined', () => {
    expect(ctxOf(`#state=${b64({ ...ctx, env: `prod${' '.repeat(1020)}` })}`)?.env).toBe('prod');
    expect(ctxOf(`#state=${b64({ ...ctx, env: `prod${' '.repeat(1021)}` })}`)).toBeUndefined();
  });
  it.each([
    ['ASCII 64자 × 3', 'a'.repeat(64)],
    ['한글(UTF-8 3바이트) 64자 × 3', '가'.repeat(64)],
    ['보조 평면(UTF-8 4바이트 · UTF-16 2단위) 32자 × 3', '😀'.repeat(32)],
    ['제어 문자(JSON 이 \\uXXXX 6바이트로 적는다) 64자 × 3', '\u0001'.repeat(64)],
  ])('필드마다 상한까지 채운 문맥도 왕복한다 — %s', (_label, s) => {
    const c = at(s);
    const h = hashOf(c);
    expect(h.length).toBeLessThanOrEqual(MAX_HASH_CHARS);
    expect(ctxOf(h)).toEqual(c);
  });
  it('선택 없는 최악 문맥(필드당 6바이트 × 64 × 3 · region global · v 13자)은 1661자 — v2 상한(선택 포함 · 아래 절) 안이다', () => {
    const worst = at('\u0001'.repeat(64));
    const url = hashOf(worst);
    expect(url.length).toBe(1661); // 88 + 1152 = 1240 바이트 → Base64url(패딩 없음) 1654자 + `#state=` 7자
    expect(url.length).toBeLessThan(MAX_HASH_CHARS);
    expect(decodeState(url)).toEqual({ context: worst, rulesVersion: V });
  });
  it('상한을 한 글자라도 넘으면 내용이 멀쩡해도 디코딩하지 않고 undefined', () => {
    // 문맥이 읽지 않는 키(x · 수 배열)로 길이만 늘린다 — 상한 바로 아래는 풀리고(검사기 자체 시험), 처음으로 넘는 길이는 풀리지 않는다
    const hashWith = (n: number) => `#state=${b64({ ...ctx, x: new Array(n).fill(1) })}`;
    let n = 0;
    while (hashWith(n + 1).length <= MAX_HASH_CHARS) n++;
    expect(hashWith(n).length).toBeLessThanOrEqual(MAX_HASH_CHARS);
    expect(ctxOf(hashWith(n))).toEqual(ctx);
    expect(hashWith(n + 1).length).toBeGreaterThan(MAX_HASH_CHARS);
    expect(ctxOf(hashWith(n + 1))).toBeUndefined();
    const big = `#state=${encodeState(ctx)}${'A'.repeat(MAX_HASH_CHARS)}`;
    expect(ctxOf(big)).toBeUndefined();
  });
});

describe('규칙 버전 v (D26 · D27 ⑵)', () => {
  it('v 는 마지막 키로 붙고 왕복한다', () => {
    const encoded = encodeState(ctx, '2026-09-29.1');
    const json = new TextDecoder().decode(Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (encoded.length % 4)) % 4)), (c) => c.charCodeAt(0)));
    expect(Object.keys(JSON.parse(json) as object)).toEqual(['owner', 'system', 'purpose', 'env', 'region', 'v']);
    expect(decodeState(`#state=${encoded}`)).toEqual({ context: ctx, rulesVersion: '2026-09-29.1' });
  });
  it('v 가 없는 옛 hash 도 열린다 — rulesVersion 없음', () => {
    expect(decodeState(`#state=${encodeState(ctx)}`)).toEqual({ context: ctx });
  });
  it.each([['2026-09-29'], ['v1'], ['2026-9-29.1'], ['2026-09-29.1 '], ['2026-09-29.100'], [''], [42], [null]])('꼴이 틀린 v(%j)는 무시한다 — 문맥은 그대로 열린다', (v) => {
    const decoded = decodeState(`#state=${b64({ ...ctx, v })}`);
    expect(decoded).toEqual({ context: ctx });
  });
  it('shareUrl 은 넘긴 버전을 담는다', () => {
    const url = shareUrl(ctx, 'http://localhost:5173/', '2026-09-29.1');
    expect(decodeState(new URL(url).hash)?.rulesVersion).toBe('2026-09-29.1');
  });
});

// ─── hash v2 — p · r (D42) ───────────────────────────
import { validateSelection, MAX_ITEMS, MAX_NAMES } from '../core/selection';
import { rulesFor } from '../core/constraints';
import { MAX_RESOURCE_TYPE_CHARS, MAX_ROLE_CHARS } from './urlState';

const V2 = '2026-10-06.4';
const sel = (provider: 'aws' | 'gcp' | 'azure', raw: unknown[], rules?: readonly ResourceRule[]) => {
  const r = validateSelection(provider, raw, rules);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.items;
};
/** 풀린 선택을 비교하기 쉬운 꼴로 */
const flat = (items: { rule: ResourceRule; count: number; role?: string }[] | undefined) => (items ?? []).map((i) => [i.rule.resourceType, i.count, i.role ?? null]);
const jsonOf = (encoded: string) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (encoded.length % 4)) % 4)), (c) => c.charCodeAt(0)))) as Record<string, unknown>;

describe('hash v2 — p · r 왕복 (D42)', () => {
  it('p · r 은 v 뒤에 붙고 왕복한다 — r 값 꼴 셋: count 규칙은 수 · role 규칙은 역할 문자열 · 입력 없는 규칙은 1', () => {
    const items = sel('azure', [{ type: 'virtual_machine', count: 2 }, { type: 'managed_identity', role: 'db' }, { type: 'resource_group' }]);
    const encoded = encodeState(ctx, V2, { provider: 'azure', selection: items });
    const json = jsonOf(encoded);
    expect(Object.keys(json)).toEqual(['owner', 'system', 'purpose', 'env', 'region', 'v', 'p', 'r']);
    expect(json.p).toBe('azure');
    expect(json.r).toEqual({ virtual_machine: 2, managed_identity: 'db', resource_group: 1 });
    const back = decodeState(`#state=${encoded}`);
    expect(back?.provider).toBe('azure');
    expect(flat(back?.selection)).toEqual([['virtual_machine', 2, null], ['managed_identity', 1, 'db'], ['resource_group', 1, null]]);
    expect(back?.dropped).toBeUndefined();
  });
  it('역할을 주지 않은 role 항목도 기본 역할을 문자열로 적는다 — 선택을 표시해야 하므로 생략하지 않는다', () => {
    const items = sel('azure', [{ type: 'managed_identity' }]);
    expect(jsonOf(encodeState(ctx, V2, { provider: 'azure', selection: items })).r).toEqual({ managed_identity: 'sync' });
  });
  it('provider 가 없으면 p · r 키가 없다 · 선택이 비면 r 키가 없다 — 옛 링크와 같은 문자열', () => {
    expect(encodeState(ctx, V2, {})).toBe(encodeState(ctx, V2));
    expect(Object.keys(jsonOf(encodeState(ctx, V2, { provider: 'gcp', selection: [] })))).toEqual(['owner', 'system', 'purpose', 'env', 'region', 'v', 'p']);
  });
  it('옛 다섯 키 링크(v · p · r 없음)도 열린다 — provider · 선택 없음', () => {
    expect(decodeState(`#state=${b64(ctx)}`)).toEqual({ context: ctx });
  });
  it.each([['AWS'], ['oci'], [1], [null]])('p 가 셋 밖(%j)이면 없는 것으로 — 문맥은 열린다 · r 은 판정할 수 없어 버린다', (p) => {
    const d = decodeState(`#state=${b64({ ...ctx, p, r: { vpc: 1 } })}`);
    expect(d?.context).toEqual(ctx);
    expect(d?.provider).toBeUndefined();
    expect(d?.selection).toBeUndefined();
    expect(d?.dropped).toBe(1);
  });
});

describe('hash v2 — 디코더가 걸린 항목만 버린다', () => {
  const open = (r: unknown, p = 'azure') => decodeState(`#state=${b64({ ...ctx, v: V2, p, r })}`);
  it('모르는 type 은 버리고 나머지는 연다', () => {
    const d = open({ virtual_machine: 3, no_such_type: 1 });
    expect(flat(d?.selection)).toEqual([['virtual_machine', 3, null]]);
    expect(d?.dropped).toBe(1);
  });
  it('종류가 안 맞는 값 — count 규칙에 문자열 · role 규칙에 수 · 입력 없는 규칙에 2 · 범위 밖 수 · 소수 · 객체', () => {
    const d = open({ virtual_machine: 'db', managed_identity: 2, resource_group: 2, subnet: 100, virtual_network: 1.5, storage_account: { n: 1 }, key_vault: 1 });
    expect(flat(d?.selection)).toEqual([['key_vault', 1, null]]);
    expect(d?.dropped).toBe(6);
  });
  it('role 규칙에 1 이 와도 기본 역할로 읽지 않고 버린다 — 겹침 꼴(r 에 1 · o 에 역할)은 둘 다 남지 않는다', () => {
    const d = decodeState(`#state=${b64({ ...ctx, v: V2, p: 'azure', r: { managed_identity: 1 }, o: { managed_identity: 'db' } })}`);
    expect(d?.selection).toBeUndefined();
    expect(d?.dropped).toBe(1);
  });
  it('역할 꼴이 틀리면 버린다 (대문자 · 17자)', () => {
    expect(open({ managed_identity: 'Sync' })?.dropped).toBe(1);
    expect(open({ managed_identity: 'a'.repeat(MAX_ROLE_CHARS + 1) })?.dropped).toBe(1);
    expect(flat(open({ managed_identity: 'a'.repeat(MAX_ROLE_CHARS) })?.selection)).toEqual([['managed_identity', 1, 'a'.repeat(MAX_ROLE_CHARS)]]);
  });
  it('r 이 객체가 아니면 통째로 버린다 (한 건) · 빈 객체는 선택 없음', () => {
    expect(open(['virtual_machine'])?.dropped).toBe(1);
    expect(open('x')?.dropped).toBe(1);
    expect(open({})).toEqual({ context: ctx, rulesVersion: V2, provider: 'azure' });
  });
  it('Σ count 가 200 을 넘으면 끝에서부터 뺀다 — 앞의 항목은 남는다', () => {
    const d = open({ virtual_machine: 99, virtual_machine_windows: 99, subnet: 3, key_vault: 1 });
    expect(flat(d?.selection)).toEqual([['virtual_machine', 99, null], ['virtual_machine_windows', 99, null]]);
    expect(d?.dropped).toBe(2);
    expect(MAX_NAMES).toBe(200);
  });
  it('201번째 항목부터 버린다 — 돌려준 목록은 앞 200개', () => {
    const vm = rulesFor('azure').find((r) => r.resourceType === 'key_vault')!;
    const rules = Array.from({ length: 205 }, (_, i) => ({ ...vm, id: `azure.fx_${i}`, resourceType: `fx_${i}` }));
    const r = Object.fromEntries(rules.map((x) => [x.resourceType, 1]));
    const d = decodeState(`#state=${b64({ ...ctx, p: 'azure', r })}`, rules);
    expect(d?.selection).toHaveLength(MAX_ITEMS);
    expect(d?.selection?.[199]?.rule.resourceType).toBe('fx_199');
    expect(d?.dropped).toBe(5);
  });
});

describe('hash v2 — 최대 상태 왕복과 상한', () => {
  // 시험 전용 role 규칙 200개 · resourceType 40자 · 역할 16자 · 자유 필드 셋 최악 JSON 문자 64자
  const mi = rulesFor('azure').find((r) => r.resourceType === 'managed_identity')!;
  const rules: ResourceRule[] = Array.from({ length: MAX_ITEMS }, (_, i) => {
    const type = `${'t'.repeat(MAX_RESOURCE_TYPE_CHARS - 3)}${String(i).padStart(3, '0')}`;
    return { ...mi, id: `azure.${type}`, resourceType: type };
  });
  const worst: NamingContext = { owner: '\u0001'.repeat(MAX_CONTEXT_CHARS), system: '\u0001'.repeat(MAX_CONTEXT_CHARS), purpose: '\u0001'.repeat(MAX_CONTEXT_CHARS), env: 'prod', region: 'global' };
  const items = sel('azure', rules.map((r) => ({ type: r.resourceType, role: 'r'.repeat(MAX_ROLE_CHARS) })), rules);
  const V = '2099-12-31.99';

  it('상수 둘은 core 의 판정과 맞다 — 규칙 표의 resourceType 은 40자 이하 · 역할 꼴은 16자까지', () => {
    expect(MAX_RESOURCE_TYPE_CHARS).toBe(40);
    for (const p of ['aws', 'gcp', 'azure'] as const) for (const r of rulesFor(p)) expect(r.resourceType.length).toBeLessThanOrEqual(MAX_RESOURCE_TYPE_CHARS);
    expect(validateSelection('azure', [{ type: 'managed_identity', role: 'r'.repeat(MAX_ROLE_CHARS) }]).ok).toBe(true);
    expect(validateSelection('azure', [{ type: 'managed_identity', role: 'r'.repeat(MAX_ROLE_CHARS + 1) }]).ok).toBe(false);
  });
  it('encoder 가 만드는 역할 최대 상태가 왕복하고, 그 표준 Base64(패딩 포함) 길이는 18219 — 종류 항(D55)이 더해진 MAX_HASH_CHARS 안이다', () => {
    const encoded = encodeState(worst, V, { provider: 'azure', selection: items });
    const hash = `#state=${encoded}`;
    expect(hash.length).toBeLessThanOrEqual(MAX_HASH_CHARS);
    const bytes = new TextEncoder().encode(JSON.stringify(jsonOf(encoded)));
    const padded = `#state=${btoa(String.fromCharCode(...bytes))}`;
    expect(padded.length).toBe(18219);
    expect(padded.length).toBeLessThan(MAX_HASH_CHARS);
    const back = decodeState(hash, rules);
    expect(back?.context).toEqual(worst);
    expect(back?.rulesVersion).toBe(V);
    expect(flat(back?.selection)).toEqual(flat(items));
    expect(back?.dropped).toBeUndefined();
    expect(decodeState(padded, rules)?.selection).toHaveLength(MAX_ITEMS);
  });
});

describe('켜진 CSP (D45 · D55) — 기본 디코더는 켜진 것만 연다', () => {
  const vm = (n: number) => ({ virtual_machine: n, resource_group: 1, managed_identity: 'db' });
  // 꺼진 CSP 링크는 지역을 예시(R0)로 바꾼다 — 그 CSP 의 지역 코드는 켜진 CSP 로 옮길 수 없다 (D55 ③)
  const reset: NamingContext = { ...ctx, region: 'ane3' };
  it('p 가 꺼진 CSP(azure)면 선택을 전부 버리고 켜진 GCP 로 푼다 · 버린 수 · 원래 CSP 를 돌려준다(안내용) · 지역은 예시로', () => {
    const d = decodeEnabled(`#state=${b64({ ...ctx, v: V2, p: 'azure', r: vm(2) })}`);
    expect(d).toEqual({ context: reset, rulesVersion: V2, provider: 'gcp', dropped: 3, unavailable: 'azure' });
  });
  it('p 가 꺼진 CSP 이고 r 이 없으면 버린 것 없이 GCP · 안내는 낸다', () => {
    expect(decodeEnabled(`#state=${b64({ ...ctx, p: 'aws' })}`)).toEqual({ context: reset, provider: 'gcp', unavailable: 'aws' });
  });
  it('p 가 꺼진 CSP 이고 r 이 객체가 아니면 한 건을 버린다', () => {
    expect(decodeEnabled(`#state=${b64({ ...ctx, p: 'aws', r: 'x' })}`)).toEqual({ context: reset, provider: 'gcp', dropped: 1, unavailable: 'aws' });
  });
  it('D55 ①~⑤ — p azure · region krc · r: 자유 입력 셋과 env 는 그대로 · region 은 asia-northeast3 · r 전부 버림 · gcp · 안내', () => {
    const d = decodeEnabled(`#state=${b64({ owner: 'infra', system: 'ledger', purpose: 'batch', env: 'production', region: 'krc', v: V2, p: 'azure', r: vm(1) })}`);
    expect(d).toEqual({
      context: { owner: 'infra', system: 'ledger', purpose: 'batch', env: 'prod', region: 'ane3' },
      rulesVersion: V2, provider: 'gcp', dropped: 3, unavailable: 'azure',
    });
  });
  it('D55 ② — 꺼진 CSP 의 표로도 풀리지 않는 링크는 열지 않는다(옛 kr · 다른 CSP 의 지역 · 깨진 owner)', () => {
    expect(decodeEnabled(`#state=${b64({ ...ctx, region: 'kr', p: 'azure', r: vm(1) })}`)).toBeUndefined();
    expect(decodeEnabled(`#state=${b64({ ...ctx, region: 'asia-northeast3', p: 'azure' })}`)).toBeUndefined();
    expect(decodeEnabled(`#state=${b64({ ...ctx, owner: '', region: 'krc', p: 'azure' })}`)).toBeUndefined();
    // 검사기 자체 — 같은 링크가 azure 지역이면 열린다
    expect(decodeEnabled(`#state=${b64({ ...ctx, region: 'krc', p: 'azure' })}`)?.context).toEqual(reset);
  });
  it('p 가 켜진 CSP(gcp)면 그대로 연다 — 안내 없음', () => {
    const d = decodeEnabled(`#state=${b64({ ...ctx, p: 'gcp', r: { compute_instance: 2, project_id: 1 } })}`);
    expect(d?.provider).toBe('gcp');
    expect(flat(d?.selection)).toEqual([['compute_instance', 2, null], ['project_id', 1, null]]);
    expect(d?.unavailable).toBeUndefined();
    expect(d?.dropped).toBeUndefined();
  });
  it('p 가 없으면(옛 다섯 키 링크) 켜진 CSP 하나로 푼다 — 안내 없음', () => {
    expect(decodeEnabled(`#state=${b64(ctx)}`)).toEqual({ context: ctx, provider: 'gcp' });
  });
  it.each([['AWS'], ['oci'], [1], [null]])('p 가 셋 밖(%j)이면 없는 것으로 — 켜진 CSP 하나로 풀고 r 은 버린다 · 안내 없음', (p) => {
    const d = decodeEnabled(`#state=${b64({ ...ctx, p, r: { vpc: 1 } })}`);
    expect(d).toEqual({ context: ctx, provider: 'gcp', dropped: 1 });
  });
  it('켜진 목록을 넘기면 그것을 따른다 — 둘 이상 켜졌으면 p 없는 링크는 CSP 를 고르지 않는다', () => {
    expect(decodeEnabled(`#state=${b64(ctx)}`, undefined, ['gcp', 'aws'])).toEqual({ context: ctx });
    expect(decodeEnabled(`#state=${b64({ ...ctx, p: 'azure', r: vm(1) })}`, undefined, ['gcp', 'aws'])).toEqual({ context: reset, dropped: 3, unavailable: 'azure' });
  });
});

// ─── hash v3 — 종류 (D52 · D55) ───────────────────────────
import { MAX_KIND_VALUE_CHARS } from '../core/catalog';
import { inputKind } from '../core/tree';

describe('hash v3 — r 의 종류 값 "n:값이름" (D55)', () => {
  const gctx: NamingContext = { owner: 'platform', system: 'payments', purpose: 'ledger', env: 'prod', region: 'ane3' };
  const openG = (r: unknown, rules?: readonly ResourceRule[]) => decodeState(`#state=${b64({ ...gctx, v: V2, p: 'gcp', r })}`, rules);
  const kinds = (items: { rule: ResourceRule; count: number; kind?: string }[] | undefined) => (items ?? []).map((i) => [i.rule.resourceType, i.count, i.kind ?? null]);

  it('count 규칙에 종류를 고르면 "2:POSTGRES" — 왕복한다', () => {
    const items = sel('gcp', [{ type: 'cloud_sql_instance', count: 2, kind: 'POSTGRES' }, { type: 'subnet', count: 3 }]);
    const encoded = encodeState(gctx, V2, { provider: 'gcp', selection: items });
    expect(jsonOf(encoded).r).toEqual({ cloud_sql_instance: '2:POSTGRES', subnet: 3 });
    const back = decodeState(`#state=${encoded}`);
    expect(kinds(back?.selection)).toEqual([['cloud_sql_instance', 2, 'POSTGRES'], ['subnet', 3, null]]);
    expect(back?.dropped).toBeUndefined();
  });
  it('값 이름은 소문자 · 붙임표도 된다 — "1:snapshot-schedule" 왕복', () => {
    const items = sel('gcp', [{ type: 'resource_policy', count: 1, kind: 'snapshot-schedule' }]);
    const encoded = encodeState(gctx, V2, { provider: 'gcp', selection: items });
    expect(jsonOf(encoded).r).toEqual({ resource_policy: '1:snapshot-schedule' });
    expect(kinds(decodeState(`#state=${encoded}`)?.selection)).toEqual([['resource_policy', 1, 'snapshot-schedule']]);
  });
  it('종류를 고르지 않은 항목은 지금처럼 수 하나 — 옛 링크와 같은 꼴', () => {
    const items = sel('gcp', [{ type: 'cloud_sql_instance', count: 2 }]);
    expect(jsonOf(encodeState(gctx, V2, { provider: 'gcp', selection: items })).r).toEqual({ cloud_sql_instance: 2 });
  });
  it.each([['2:'], [':POSTGRES'], ['02:POSTGRES'], ['100:POSTGRES'], ['2:POSTGRES:x'], ['2:POST GRES'], [`2:${'A'.repeat(MAX_KIND_VALUE_CHARS + 1)}`]])('꼴이 틀린 값 %j 은 버린다', (v) => {
    const d = openG({ cloud_sql_instance: v, subnet: 1 });
    expect(kinds(d?.selection)).toEqual([['subnet', 1, null]]);
    expect(d?.dropped).toBe(1);
  });
  it('토큰("2:pg")은 값 이름이 아니라 버린다 · 허용 밖 값 · 종류 표가 없는 규칙의 종류도 버린다', () => {
    const d = openG({ cloud_sql_instance: '2:pg', subnet: '1:INTERNAL', vpc_network: '1:PRIVATE', firewall_rule: '1:EGRESS' });
    expect(kinds(d?.selection)).toEqual([['firewall_rule', 1, 'EGRESS']]);
    expect(d?.dropped).toBe(3);
  });
  it('필수 종류(리소스 정책)에 종류가 없으면 버린다', () => {
    const d = openG({ resource_policy: 1, subnet: 1 });
    expect(kinds(d?.selection)).toEqual([['subnet', 1, null]]);
    expect(d?.dropped).toBe(1);
  });
  it('입력 없는 규칙은 1 또는 "1:값이름" — 시험 전용 종류 표로 왕복한다', () => {
    const rg = rulesFor('azure').find((r) => r.resourceType === 'resource_group')!;
    expect(inputKind(rg)).toBe('none');
    const kinded: ResourceRule = { ...rg, kinds: { rule: 'only-when-chosen', default: null, allowed: ['shared-hub'], tokens: { 'shared-hub': 'hub' }, omitValues: [] } };
    const rules = [...rulesFor('azure').filter((r) => r !== rg), kinded];
    const items = sel('azure', [{ type: 'resource_group', kind: 'shared-hub' }], rules);
    const encoded = encodeState(ctx, V2, { provider: 'azure', selection: items });
    expect(jsonOf(encoded).r).toEqual({ resource_group: '1:shared-hub' });
    expect(kinds(decodeState(`#state=${encoded}`, rules)?.selection)).toEqual([['resource_group', 1, 'shared-hub']]);
    expect(jsonOf(encodeState(ctx, V2, { provider: 'azure', selection: sel('azure', [{ type: 'resource_group' }], rules) })).r).toEqual({ resource_group: 1 });
  });
  it('role 규칙에 "n:값" 이 오면 역할로 읽지 않고 버린다', () => {
    const d = decodeState(`#state=${b64({ ...ctx, v: V2, p: 'azure', r: { managed_identity: '1:db', key_vault: 1 } })}`);
    expect(flat(d?.selection)).toEqual([['key_vault', 1, null]]);
    expect(d?.dropped).toBe(1);
  });
  it('MAX_KIND_VALUE_CHARS 는 규칙 표의 가장 긴 값 이름과 같다', () => {
    const longest = Math.max(...(['aws', 'gcp', 'azure'] as const).flatMap((p) => rulesFor(p).flatMap((r) => r.kinds?.allowed ?? [])).map((v) => v.length));
    expect(MAX_KIND_VALUE_CHARS).toBe(longest);
  });
});

describe('hash v3 — 상한식에 종류 항(D55)', () => {
  // 시험 전용 count 규칙 200개 · resourceType 40자 · 값 이름 MAX_KIND_VALUE_CHARS 자 — Σ count 200 이라 항목마다 count 1 이 최대다
  const neg = rulesFor('gcp').find((r) => r.resourceType === 'network_endpoint_group')!;
  const longest = neg.kinds!.allowed.find((v) => v.length === MAX_KIND_VALUE_CHARS)!;
  const rules: ResourceRule[] = Array.from({ length: MAX_ITEMS }, (_, i) => {
    const type = `${'t'.repeat(MAX_RESOURCE_TYPE_CHARS - 3)}${String(i).padStart(3, '0')}`;
    return { ...neg, id: `gcp.${type}`, resourceType: type };
  });
  const worst: NamingContext = { owner: '\u0001'.repeat(MAX_CONTEXT_CHARS), system: '\u0001'.repeat(MAX_CONTEXT_CHARS), purpose: '\u0001'.repeat(MAX_CONTEXT_CHARS), env: 'prod', region: 'global' };
  const items = sel('gcp', rules.map((r) => ({ type: r.resourceType, count: 1, kind: longest })), rules);

  it('MAX_HASH_CHARS 는 상한식(항목 최악 = 수 · 역할 · "99:<값이름>" 중 큰 쪽)의 값이다', () => {
    const item = Math.max(`"${'t'.repeat(40)}":99,`.length, `"${'t'.repeat(40)}":"${'r'.repeat(16)}",`.length, `"${'t'.repeat(40)}":"99:${'k'.repeat(MAX_KIND_VALUE_CHARS)}",`.length);
    expect(item).toBe(76);
    const skeleton = JSON.stringify({ owner: '', system: '', purpose: '', env: 'prod', region: 'r'.repeat(MAX_REGION_CHARS), v: '0000-00-00.00', p: 'azure', r: {} }).length;
    const bytes = skeleton + 3 * MAX_CONTEXT_CHARS * 6 + MAX_ITEMS * item - 1;
    expect(MAX_HASH_CHARS).toBe('#state='.length + Math.ceil(bytes / 3) * 4);
    expect(MAX_HASH_CHARS).toBe(21951);
  });
  it('종류를 단 최대 선택(값 이름 27자 × 200)이 왕복하고 상한 안이다', () => {
    const encoded = encodeState(worst, '2099-12-31.99', { provider: 'gcp', selection: items });
    const hash = `#state=${encoded}`;
    const bytes = new TextEncoder().encode(JSON.stringify(jsonOf(encoded)));
    const padded = `#state=${btoa(String.fromCharCode(...bytes))}`;
    // 이룰 수 있는 최대 — 항목마다 `"<40>":"1:<27>",` 75 바이트(식의 `99` 보다 1 바이트 짧다) · p 는 `gcp`(식은 `azure`)
    expect(padded.length).toBe(21683);
    expect(padded.length).toBeLessThanOrEqual(MAX_HASH_CHARS);
    const back = decodeState(padded, rules);
    expect(back?.selection).toHaveLength(MAX_ITEMS);
    expect(back?.selection?.every((i) => i.kind === longest)).toBe(true);
    expect(back?.dropped).toBeUndefined();
    expect(decodeState(hash, rules)?.selection).toHaveLength(MAX_ITEMS);
  });
});

import { MAX_COUNT } from '../core/selection';

describe('hash — 한 행의 키가 둘이면 catalog 규칙 순서의 첫 것만 (D53)', () => {
  const hashOf = (r: Record<string, unknown>) => `#state=${b64({ ...ctx, region: 'ane3', v: V2, p: 'gcp', r })}`;
  it('address:1 + global_address:2 → address 만 · dropped 1', () => {
    const d = decodeState(hashOf({ address: 1, global_address: 2 }))!;
    expect(d.selection?.map((i) => [i.rule.resourceType, i.count])).toEqual([['address', 1]]);
    expect(d.dropped).toBe(1);
  });
  it('hash 의 키 순서가 거꾸로여도 catalog 순서의 첫 것(address)이 남는다', () => {
    const d = decodeState(hashOf({ global_address: 2, address: 1 }))!;
    expect(d.selection?.map((i) => i.rule.resourceType)).toEqual(['address']);
    expect(d.dropped).toBe(1);
  });
  it('세 규칙 행(NEG) — 셋 다 오면 하나만 · 다른 행은 그대로', () => {
    const d = decodeState(hashOf({ region_network_endpoint_group: 1, global_network_endpoint_group: 1, network_endpoint_group: 1, compute_instance: 2 }))!;
    expect(d.selection?.map((i) => i.rule.resourceType).sort()).toEqual(['compute_instance', 'network_endpoint_group']);
    expect(d.dropped).toBe(2);
  });
  it('검사기 — 한 행에 키 하나면 아무것도 버리지 않는다', () => {
    const d = decodeState(hashOf({ global_address: 2, compute_instance: 1 }))!;
    expect(d.selection).toHaveLength(2);
    expect(d.dropped).toBeUndefined();
  });
});

describe('hash — 종류 값의 수 자리는 MAX_COUNT 와 맞다', () => {
  const hashOf = (v: string) => `#state=${b64({ ...ctx, region: 'ane3', v: V2, p: 'gcp', r: { cloud_sql_instance: v } })}`;
  it(`1 · ${MAX_COUNT} 는 받고 0 · ${MAX_COUNT + 1} 은 버린다`, () => {
    expect(MAX_COUNT).toBeLessThan(100); // 정규식 [1-9]\d? 가 두 자리까지만 받는다 — 상한이 세 자리가 되면 이 시험과 정규식을 함께 고친다
    expect(decodeState(hashOf('1:POSTGRES'))!.selection?.[0]?.count).toBe(1);
    expect(decodeState(hashOf(`${MAX_COUNT}:POSTGRES`))!.selection?.[0]?.count).toBe(MAX_COUNT);
    expect(decodeState(hashOf('0:POSTGRES'))!.dropped).toBe(1);
    expect(decodeState(hashOf(`${MAX_COUNT + 1}:POSTGRES`))!.dropped).toBe(1);
  });
});

// ─── hash v4 — 마법사 모델 w (D67) ───
import { decodeWizardState, encodeWizardState, hashKind, wizardToHash, MAX_WIZARD_HASH_CHARS, MAX_ANY_HASH_CHARS, SERVERLESS_SHORT, type DecodedWizard } from './urlState';
import { validatePlan, MAX_PICKS_PER_SERVICE, type Pick as WPick, type WizardPlan, type WizardSlot } from '../core/wizard/plan';
import { PRESETS } from '../core/wizard/presets';
import { toWirePath } from '../api/schemas';

const WP = { owner: 'platform', system: 'billing', env: 'prod', region: 'ane3' };
/** 계획의 표본 요청 — 프로젝트 네트워크 넷 · shop(web VM + boot · data 01 · ip, Cloud SQL) · pay(web HA 서버 둘 · boot 둘) */
const W_SAMPLE: WizardPlan = {
  provider: 'gcp',
  project: WP,
  projectPicks: [
    { preset: 'vpc', instances: [{ id: 'a', seq: '01' }] },
    { preset: 'subnet', instances: [{ id: 'b', seq: '01' }] },
    { preset: 'firewall', tier: 'ssh', instances: [{ id: 'c', seq: '01' }] },
    { preset: 'firewall', tier: 'web', instances: [{ id: 'd', seq: '01' }] },
  ],
  services: [
    { purpose: 'shop', picks: [
      { preset: 'web', instances: [{ id: 'e', seq: '01', attach: { boot: true, data: ['01'], ip: true } }] },
      { preset: 'db', kind: 'POSTGRES', instances: [{ id: 'f', seq: '01' }] },
    ] },
    { purpose: 'pay', picks: [
      { preset: 'web', ha: true, instances: [{ id: 'g', seq: '01', attach: { boot: true } }, { id: 'h', seq: '02', attach: { boot: true } }] },
    ] },
  ],
};
const WV = '2099-12-31.99';
/** 검사를 건너뛰고 모델을 그대로 hash 로 — 깨진 링크를 만든다 */
const rawWizardHash = (plan: unknown, extra: Record<string, unknown> = {}) =>
  `#state=${btoa(unescape(encodeURIComponent(JSON.stringify({ ...WP, v: WV, ...extra, w: wizardToHash(plan as WizardPlan) }))))}`;
const decodeW = (plan: unknown): DecodedWizard => {
  const d = decodeWizardState(rawWizardHash(plan));
  if (!d) throw new Error('undefined');
  return d;
};
const one = (...picks: WPick[]): WizardPlan => ({ provider: 'gcp', project: WP, projectPicks: [], services: [{ purpose: 'shop', picks }] });
const slotsW = (n: number): WizardSlot[] => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, seq: String(i + 1).padStart(2, '0') }));

describe('hash v4 — 마법사 w 왕복 (D67)', () => {
  it('계획 표본 전체가 모델 → hash → 모델로 deep-equal 이다 (preset · kind · ha · 슬롯 id · seq · attach)', () => {
    const enc = encodeWizardState(W_SAMPLE, WV)!;
    expect(enc).toBeDefined();
    const back = decodeWizardState(`#state=${enc}`)!;
    expect(back.plan).toEqual(W_SAMPLE);
    expect(back.rulesVersion).toBe(WV);
    expect(back.notices).toEqual({ dropped: 0, haOff: 0, serverlessOff: 0, trimmed: 0, discarded: false });
    // 같은 키 — 다시 인코딩해도 같은 문자열
    expect(encodeWizardState(back.plan!, WV)).toBe(enc);
  });
  it('custom pick(ruleId · tier · role) · serverless 짧은 값도 왕복한다', () => {
    const plan = one(
      { preset: null, ruleId: 'gcp.compute_instance', tier: 'batch', instances: [{ id: '1', seq: '03', attach: { ipi: true } }] },
      { preset: null, ruleId: 'gcp.service_account', role: 'worker' },
      { preset: 'was', serverless: 'gcp.run_service', instances: [{ id: 'z', seq: '01' }] },
      { preset: 'object' },
    );
    expect(validatePlan(plan)).toEqual({ ok: true });
    const enc = encodeWizardState(plan)!;
    const json = JSON.parse(atob(enc.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (enc.length % 4)) % 4)));
    expect(json.w.s[0].p[0]).toEqual({ ru: 'gcp.compute_instance', t: 'batch', i: [{ id: '1', q: '03', a: { ipi: 1 } }] });
    expect(json.w.s[0].p[2].sv).toBe('run');
    expect(decodeWizardState(`#state=${enc}`)!.plan).toEqual(plan);
  });
  it('w 가 있는 hash 에는 최상위 purpose 가 없다 · 키 순서 owner system env region v w', () => {
    const enc = encodeWizardState(W_SAMPLE, WV)!;
    const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(enc.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (enc.length % 4)) % 4)), (c) => c.charCodeAt(0))));
    expect(Object.keys(json)).toEqual(['owner', 'system', 'env', 'region', 'v', 'w']);
    expect('purpose' in json).toBe(false);
  });
  it('존을 넣은 지역은 리전 코드로 실린다 — 존은 이름에 없다', () => {
    const enc = encodeWizardState({ ...W_SAMPLE, project: { ...WP, region: 'asia-northeast3-a' } })!;
    expect(decodeWizardState(`#state=${enc}`)!.project.region).toBe('ane3');
  });
  it('인코더는 validatePlan 을 지나지 못한 모델을 싣지 않는다', () => {
    expect(encodeWizardState(one({ preset: 'web', instances: [{ id: 'a', seq: 'ab' }] }))).toBeUndefined();
    expect(encodeWizardState({ ...W_SAMPLE, projectPicks: [], services: [] })).toBeUndefined();
  });
  it('SERVERLESS_SHORT 는 프리셋의 serverless 규칙 id 전부를 덮는다', () => {
    const ids = new Set(PRESETS.flatMap((p) => p.serverless?.ruleIds ?? []));
    expect(new Set(Object.values(SERVERLESS_SHORT))).toEqual(ids);
  });
});

describe('hash v4 — 걸린 자리만 버린다 (§5-5 path)', () => {
  const web: WPick = { preset: 'web', instances: [{ id: 'a', seq: '01', attach: { boot: true, data: ['01'] } }] };
  it("서비스 shop 의 둘째 pick(was · role:'worker')만 지워지고 첫째 web pick 과 딸린 것은 그대로", () => {
    const plan = one(web, { preset: 'was', role: 'worker', instances: [{ id: 'b', seq: '01' }] });
    const r = validatePlan(plan);
    expect(r.ok ? [] : r.errors.map((e) => [e.code, e.path])).toContainEqual(['selection.role_not_supported', 'services[0].picks[1]']);
    const d = decodeW(plan);
    expect(d.plan!.services[0]!.picks).toEqual([web]);
    expect(d.notices.dropped).toBe(1);
  });
  it("둘째 슬롯만 틀리면(seq 'ab') 그 슬롯만 지워진다", () => {
    const d = decodeW(one({ preset: 'was', instances: [{ id: 'a', seq: '01', attach: { boot: true } }, { id: 'b', seq: 'ab' }] }));
    expect(d.plan!.services[0]!.picks[0]!.instances).toEqual([{ id: 'a', seq: '01', attach: { boot: true } }]);
  });
  it("web · ha:true · 슬롯 [a 01 boot, b 'ab'] → b 만 지워지고 ha 는 꺼지며 a 와 boot 는 그대로 · 안내", () => {
    const d = decodeW(one({ preset: 'web', ha: true, instances: [{ id: 'a', seq: '01', attach: { boot: true } }, { id: 'b', seq: 'ab' }] }));
    expect(d.plan!.services[0]!.picks).toEqual([{ preset: 'web', instances: [{ id: 'a', seq: '01', attach: { boot: true } }] }]);
    expect(d.notices).toMatchObject({ dropped: 1, haOff: 1 });
  });
  it('pick 의 슬롯이 하나뿐이고 그게 틀리면 pick 이 지워지고 서비스의 다른 pick 은 그대로', () => {
    const d = decodeW(one(web, { preset: 'was', instances: [{ id: 'b', seq: '7' }] }));
    expect(d.plan!.services[0]!.picks).toEqual([web]);
  });
  it("디스크만 틀리면 — data:['00'] 이면 data 키만 사라지고 VM · boot · IP 그대로 / ['01','00'] → ['01']", () => {
    const a = decodeW(one({ preset: 'web', instances: [{ id: 'a', seq: '01', attach: { boot: true, data: ['00'], ip: true } }] }));
    expect(a.plan!.services[0]!.picks[0]!.instances).toEqual([{ id: 'a', seq: '01', attach: { boot: true, ip: true } }]);
    const b = decodeW(one({ preset: 'web', instances: [{ id: 'a', seq: '01', attach: { boot: true, data: ['01', '00'], ip: true } }] }));
    expect(b.plan!.services[0]!.picks[0]!.instances).toEqual([{ id: 'a', seq: '01', attach: { boot: true, data: ['01'], ip: true } }]);
  });
  it('프로젝트 공용 VM 의 디스크 — 디코더 path projectPicks[0].instances[0].attach.data[1] · API field project_picks[0].instances[0].attach.data[1]', () => {
    const plan: WizardPlan = { provider: 'gcp', project: WP, services: [],
      projectPicks: [{ preset: null, ruleId: 'gcp.compute_instance', instances: [{ id: 'a', seq: '01', attach: { data: ['01', 'x'] } }] }] };
    const r = validatePlan(plan);
    const paths = r.ok ? [] : r.errors.map((e) => e.path);
    expect(paths).toContain('projectPicks[0].instances[0].attach.data[1]');
    expect(toWirePath('projectPicks[0].instances[0].attach.data[1]')).toBe('project_picks[0].instances[0].attach.data[1]');
  });
  it('처음부터 ha:true + 슬롯 하나인 링크 → ha 만 꺼지고 서버 · boot 그대로', () => {
    const d = decodeW(one({ preset: 'web', ha: true, instances: [{ id: 'a', seq: '01', attach: { boot: true } }] }));
    expect(d.plan!.services[0]!.picks).toEqual([{ preset: 'web', instances: [{ id: 'a', seq: '01', attach: { boot: true } }] }]);
    expect(d.notices).toMatchObject({ dropped: 0, haOff: 1 });
  });
  it('플래그 복구 ⓪ — bastion · ha:true · 서버 둘(boot · IP) → ha 만 꺼지고 서버 둘 · boot · IP 전부 그대로', () => {
    const slots = [{ id: 'a', seq: '01', attach: { boot: true as const, ip: true as const } }, { id: 'b', seq: '02' }];
    const d = decodeW(one({ preset: 'bastion', ha: true, instances: slots }));
    expect(d.plan!.services[0]!.picks).toEqual([{ preset: 'bastion', instances: slots }]);
    expect(d.notices).toMatchObject({ dropped: 0, haOff: 1 });
  });
  it('web + serverless + ha → ha 만 꺼진다 · sv 가 데이터 밖이면 sv 만 지워진다', () => {
    const a = decodeW(one({ preset: 'web', serverless: 'gcp.cloud_function', ha: true, instances: slotsW(2) }));
    expect(a.plan!.services[0]!.picks).toEqual([{ preset: 'web', serverless: 'gcp.cloud_function', instances: slotsW(2) }]);
    const b = decodeW(one({ preset: 'web', serverless: 'xyz', instances: slotsW(1) }));
    expect(b.plan!.services[0]!.picks).toEqual([{ preset: 'web', instances: slotsW(1) }]);
    expect(b.notices).toMatchObject({ serverlessOff: 1, dropped: 0 });
  });
  it('디코더 순서 — purpose "   " 인 서비스 + 정상 서비스 → 빈 서비스만 지워지고 나머지가 열린다', () => {
    const d = decodeW({ provider: 'gcp', project: WP, projectPicks: [], services: [{ purpose: '   ', picks: [web] }, { purpose: 'pay', picks: [web] }] });
    expect(d.plan!.services).toEqual([{ purpose: 'pay', picks: [web] }]);
    expect(d.notices.dropped).toBe(1);
  });
  it('pick 상한 초과 — 프로젝트 공용 21 → 앞 20 만 남고 서비스는 그대로 / 서비스 쪽도 같다', () => {
    const fw = (i: number): WPick => ({ preset: 'firewall', tier: `x${String(i).padStart(2, '0')}`, instances: [{ id: 'a', seq: '01' }] });
    const vm = (i: number): WPick => ({ preset: null, ruleId: 'gcp.compute_instance', tier: `x${String(i).padStart(2, '0')}`, instances: [{ id: 'a', seq: '01' }] });
    const many = Array.from({ length: MAX_PICKS_PER_SERVICE + 1 }, (_, i) => fw(i));
    const a = decodeW({ provider: 'gcp', project: WP, projectPicks: many, services: [{ purpose: 'shop', picks: [web] }] });
    expect(a.plan!.projectPicks).toEqual(many.slice(0, MAX_PICKS_PER_SERVICE));
    expect(a.plan!.services).toEqual([{ purpose: 'shop', picks: [web] }]);
    expect(a.notices.trimmed).toBe(1);
    const svcPicks = Array.from({ length: MAX_PICKS_PER_SERVICE + 1 }, (_, i) => vm(i));
    const b = decodeW({ provider: 'gcp', project: WP, projectPicks: [fw(0)], services: [{ purpose: 'shop', picks: svcPicks }] });
    expect(b.plan!.services[0]!.picks).toEqual(svcPicks.slice(0, MAX_PICKS_PER_SERVICE));
    expect(b.plan!.projectPicks).toEqual([fw(0)]);
  });
  it('표 밖의 키 — pick 에 있으면 그 pick 만 · 슬롯에 있으면 그 슬롯만 버린다 · w 최상위면 w 전체', () => {
    const raw = (w: unknown) => decodeWizardState(`#state=${btoa(JSON.stringify({ ...WP, w }))}`)!;
    const p = raw({ s: [{ n: 'shop', p: [{ pr: 'web', i: [{ id: 'a', q: '01' }] }, { pr: 'was', zz: 1, i: [{ id: 'a', q: '01' }] }] }] });
    expect(p.plan!.services[0]!.picks).toEqual([{ preset: 'web', instances: [{ id: 'a', seq: '01' }] }]);
    const s = raw({ s: [{ n: 'shop', p: [{ pr: 'web', i: [{ id: 'a', q: '01' }, { id: 'b', q: '02', zone: 'x' }] }] }] });
    expect(s.plan!.services[0]!.picks[0]!.instances).toEqual([{ id: 'a', seq: '01' }]);
    expect(raw({ s: [], x: 1 }).notices.discarded).toBe(true);
  });
});

describe('hash v4 — 모델 전체 오류 · 옛 링크 · 깨진 링크', () => {
  it('projectPicks:[] · services:[] → wizard.empty → w 전체를 버리고 안내(문맥은 연다)', () => {
    const d = decodeW({ provider: 'gcp', project: WP, projectPicks: [], services: [] });
    expect(d.plan).toBeUndefined();
    expect(d.notices.discarded).toBe(true);
    expect(d.project).toEqual(WP);
  });
  it('이름 201개 모델 → wizard.too_many_names → w 전체를 버리고 안내 · 그 hash 는 길이 상한 안이다', () => {
    const vm = (tier: string, n: number): WPick => ({ preset: null, ruleId: 'gcp.compute_instance', tier, instances: slotsW(n) });
    const plan = one(vm('tone', 67), vm('ttwo', 67), vm('tthree', 66));
    const r = validatePlan(plan);
    expect(r.ok ? [] : r.errors.map((e) => e.code)).toEqual(['wizard.too_many_names']);
    const h = rawWizardHash(plan);
    expect(h.length).toBeLessThanOrEqual(MAX_WIZARD_HASH_CHARS);
    const d = decodeWizardState(h)!;
    expect(d.plan).toBeUndefined();
    expect(d.notices.discarded).toBe(true);
  });
  it('w + r 은 깨진 링크 · 문맥 넷이 안 풀리면 깨진 링크', () => {
    expect(decodeWizardState(rawWizardHash(W_SAMPLE, { r: { disk: 1 } }))).toBeUndefined();
    expect(decodeWizardState(rawWizardHash(W_SAMPLE, { env: 'nope' }))).toBeUndefined();
  });
  it('옛 v3 · 다섯 키 hash 는 그대로 트리로 열린다 — hashKind tree · decodeState 가 연다 · 마법사 디코더는 열지 않는다', () => {
    const v3 = `#state=${encodeState(ctx, WV, { provider: 'gcp', selection: [] })}`;
    const five = `#state=${btoa(JSON.stringify({ owner: 'infra', system: 'billing', purpose: 'trade', env: 'prod', region: 'ane3' }))}`;
    const withR = `#state=${btoa(JSON.stringify({ owner: 'infra', system: 'billing', purpose: 'trade', env: 'prod', region: 'ane3', v: WV, p: 'gcp', r: { compute_instance: 2 } }))}`;
    for (const h of [v3, five, withR]) {
      expect(hashKind(h)).toBe('tree');
      expect(decodeEnabled(h)).toBeDefined();
      expect(decodeWizardState(h)).toBeUndefined();
    }
    expect(decodeEnabled(withR)?.selection?.[0]?.count).toBe(2);
    const w = `#state=${encodeWizardState(W_SAMPLE, WV)}`;
    expect(hashKind(w)).toBe('wizard');
    expect(decodeEnabled(w)).toBeUndefined();
    expect(hashKind('')).toBe('none');
    expect(hashKind('#state=%%%')).toBe('broken');
    expect(hashKind('#state=bm90IGpzb24')).toBe('broken');
  });
});

/** 서비스 20 · 자유 입력 최악 · 이름 195 인 모델의 hash 길이 (잰 값) */
const MEASURED_NEAR_MAX = 18146;
describe('hash v4 — 길이 상한 (이름 수로 닫힌 식)', () => {
  it('MAX_WIZARD_HASH_CHARS 를 잰다 · MAX_ANY_HASH_CHARS 는 v3 · v4 중 큰 쪽', () => {
    expect(MAX_WIZARD_HASH_CHARS).toBe(120495);
    expect(MAX_ANY_HASH_CHARS).toBe(Math.max(MAX_HASH_CHARS, MAX_WIZARD_HASH_CHARS));
  });
  it('최대에 가까운 모델(서비스 20 · 자유 입력 최악 64자 · 이름 200)이 왕복하고 상한 안이다', () => {
    const worst = '\u0001'.repeat(MAX_CONTEXT_CHARS);
    const svc = (i: number, n: number) => ({
      purpose: `${String(i).padStart(2, '0')}${'\u0001'.repeat(MAX_CONTEXT_CHARS - 2)}`,
      picks: [{ preset: null, ruleId: 'gcp.compute_instance', tier: 'abcdefghijklmnop', instances: Array.from({ length: n }, (_, k) => ({ id: `abcdef${String(k).padStart(2, '0')}`, seq: String(k + 1).padStart(2, '0'), attach: { boot: true as const } })) }] as WPick[],
    });
    // 이름 = 1 + 서비스마다 (VM n + boot n) — 19 × 10 + 1 × 4 + 1 = 195
    const plan: WizardPlan = { provider: 'gcp', project: { ...WP, owner: worst, system: worst }, projectPicks: [], services: Array.from({ length: 20 }, (_, i) => svc(i, i === 19 ? 2 : 5)) };
    expect(validatePlan(plan)).toEqual({ ok: true });
    const enc = encodeWizardState(plan, WV);
    expect(enc).toBeDefined();
    const h = `#state=${enc}`;
    // 잰 값 — Base64url(패딩 없음) 길이
    expect(h.length).toBe(MEASURED_NEAR_MAX);
    expect(h.length).toBeLessThanOrEqual(MAX_WIZARD_HASH_CHARS);
    expect(decodeWizardState(h)!.plan).toEqual(plan);
  });
  it('상한을 넘는 hash 는 풀지 않는다', () => {
    const big = `#state=${encodeWizardState(W_SAMPLE)}${'A'.repeat(MAX_WIZARD_HASH_CHARS)}`;
    expect(decodeWizardState(big)).toBeUndefined();
  });
});
