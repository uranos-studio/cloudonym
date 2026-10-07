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

describe('지역 자리 (D50 · D55) — hash 의 region 은 존 코드(있으면) 아니면 리전 코드', () => {
  it('zone 이 있으면 region 키에 존 코드를 싣고, 풀면 리전 · 존이 둘 다 돌아온다', () => {
    const z: NamingContext = { ...ctx, region: 'ane3', zone: 'ane3a' };
    const encoded = encodeState(z);
    expect(JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')))).toMatchObject({ region: 'ane3a' });
    expect(JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')))).not.toHaveProperty('zone');
    expect(decodeEnabled(`#state=${encoded}`)?.context).toEqual(z);
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
  it('encoder 가 만드는 최대 상태가 왕복하고, 그 표준 Base64(패딩 포함) 길이가 MAX_HASH_CHARS 와 같다', () => {
    const encoded = encodeState(worst, V, { provider: 'azure', selection: items });
    const hash = `#state=${encoded}`;
    expect(hash.length).toBeLessThanOrEqual(MAX_HASH_CHARS);
    const bytes = new TextEncoder().encode(JSON.stringify(jsonOf(encoded)));
    const padded = `#state=${btoa(String.fromCharCode(...bytes))}`;
    expect(padded.length).toBe(MAX_HASH_CHARS);
    expect(MAX_HASH_CHARS).toBe(18219);
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
  const reset: NamingContext = { ...ctx, region: 'ane3', zone: 'ane3a' };
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
  it('D55 ①~⑤ — p azure · region krc · r: 자유 입력 셋과 env 는 그대로 · region 은 asia-northeast3-a · r 전부 버림 · gcp · 안내', () => {
    const d = decodeEnabled(`#state=${b64({ owner: 'infra', system: 'ledger', purpose: 'batch', env: 'production', region: 'krc', v: V2, p: 'azure', r: vm(1) })}`);
    expect(d).toEqual({
      context: { owner: 'infra', system: 'ledger', purpose: 'batch', env: 'prod', region: 'ane3', zone: 'ane3a' },
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
