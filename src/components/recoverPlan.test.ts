// 링크 · 계획 파일의 복구 (§5-5 · D100) — 한 번에 여러 자리를 고치는 복구가 하나씩 고치는 복구와 같은 결과를 내는가 · 최악 입력이 화면을 멈추지 않는가
import { describe, it, expect } from 'vitest';
import { decodeWizardObject, decodeWizardState, recoverPlan, HASH_KEY, MAX_RECOVER_NAMES, MAX_RECOVER_PICKS, type WizardNotices } from './urlState';
import { openPlanFile, PLAN_FILE_MAX_BYTES } from './planFile';
import { MAX_NAMES } from '../core/selection';
import { MAX_PICKS_PER_SERVICE, MAX_SERVICES, type WizardPlan } from '../core/wizard/plan';

const NOTICES = (): WizardNotices => ({ dropped: 0, haOff: 0, serverlessOff: 0, trimmed: 0, discarded: false });
const PROJECT = { owner: 'platform', system: 'billing', env: 'prod', region: 'ane3' };

/** 시드가 같으면 같은 수열 — mulberry32 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 틀린 값이 섞인 모델 — 모르는 프리셋 · 틀린 슬롯 id · seq · 중복 · 틀린 attach · data · HA · 서버리스 · tier · 위치 · 중복 pick · 빈 서비스 · 같은 서비스 이름 · 상한 넘는 pick */
function junkPlan(seed: number): WizardPlan {
  const r = rng(seed);
  const one = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const slot = () => {
    const s: Record<string, unknown> = { id: one(['1', '2', '3', 'x', 'TOOLONGID', 7]), seq: one(['01', '02', '03', 'zz', '01', 1]) };
    if (r() < 0.3) s.attach = one<unknown>([{ boot: true }, { boot: true, data: ['01', 'zz', '01'] }, { ip: true, ipi: true }, { foo: 1 }, 'x', { data: [] }, { data: ['01', '02'] }]);
    return s;
  };
  const pick = () => {
    const p: Record<string, unknown> = { preset: one<string | null>(['web', 'was', 'bastion', 'file', 'db', 'object', 'sa', 'secret', 'vpc', 'subnet', 'firewall', 'nope', null]) };
    if (p.preset === null) p.ruleId = one(['gcp.compute_instance', 'gcp.storage_bucket', 'gcp.cloud_function', 'gcp.nope']);
    if (r() < 0.3) p.ha = one<unknown>([true, true, 'x']);
    if (r() < 0.2) p.serverless = one(['gcp.run_service', 'gcp.cloud_function', 'gcp.vpc_network']);
    if (r() < 0.3) p.tier = one(['web', 'was', 'ab', 'BAD!']);
    if (r() < 0.15) p.kind = one(['POSTGRES', 'MYSQL', 'NOPE']);
    if (r() < 0.15) p.location = one(['us', 'regional', 'nowhere']);
    if (r() < 0.15) p.role = one(['db', 'app', 'Bad Role']);
    if (r() < 0.8) p.instances = Array.from({ length: Math.floor(r() * 5) }, slot);
    return p;
  };
  const picks = (max: number) => Array.from({ length: Math.floor(r() * max) }, pick);
  return {
    provider: 'gcp', project: { ...PROJECT },
    projectPicks: picks(r() < 0.1 ? 45 : 6) as never,
    services: Array.from({ length: Math.floor(r() * 5) }, () => ({ purpose: one(['shop', 'pay', 'shop', 'admin', '', 'project']), picks: picks(r() < 0.1 ? 45 : 8) as never })),
  };
}

describe('복구 — 한 번에 여러 자리를 고쳐도 하나씩 고친 것과 같다', () => {
  it('틀린 값이 섞인 모델 600개 — 남은 계획 · 안내 수가 글자까지 같다', () => {
    let recovered = 0;
    let fixedSome = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const a = junkPlan(seed);
      const b = structuredClone(a);
      const na = NOTICES();
      const nb = NOTICES();
      const batch = recoverPlan(a, na);
      const single = recoverPlan(b, nb, 'single');
      expect(JSON.stringify(batch), `seed ${seed}`).toBe(JSON.stringify(single));
      expect(na, `seed ${seed}`).toEqual(nb);
      if (batch) recovered++;
      if (batch && na.dropped + na.haOff + na.serverlessOff + na.trimmed > 0) fixedSome++;
    }
    // 생성기가 실제로 고칠 거리를 만드는지 — 대부분 버려지기만 하면 이 시험은 아무것도 보지 않는다
    expect(recovered).toBeGreaterThan(150);
    expect(fixedSome).toBeGreaterThan(100);
  }, 60_000);
});

/** 짧은 꼴 w 를 hash 로 */
const hashOf = (w: unknown): string => {
  let bin = '';
  for (const b of new TextEncoder().encode(JSON.stringify({ ...PROJECT, w }))) bin += String.fromCharCode(b);
  return `#${HASH_KEY}=${btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
};
const services = (per: number, mk: (j: number) => unknown) => ({ pp: [], s: Array.from({ length: MAX_SERVICES }, (_, i) => ({ n: `s${i}`, p: Array.from({ length: per }, (_, j) => mk(j)) })) });
const ms = (fn: () => unknown): number => {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
};

/** 최악 입력의 시간 예산 — 이 기계(M1 Pro)에서 잰 값의 3배 이상을 둔다. 고치기 전에는 같은 입력이 1.2 s(서비스 pick 200 · 틀린 곳 여럿) · 4.9 s(틀린 슬롯 7,800 · 링크) · 9.2 s(같은 슬롯 11,000 · 파일)였다 */
const BUDGET_MS = 500;

describe('복구의 시간 — 최악 입력이 화면을 멈추지 않는다', () => {
  it('상한 둘은 이름 상한에서 나온다', () => {
    expect(MAX_RECOVER_PICKS).toBe(2 * MAX_NAMES);
    expect(MAX_RECOVER_NAMES).toBe(2 * MAX_NAMES);
    expect(MAX_RECOVER_PICKS).toBeLessThan((MAX_SERVICES + 1) * MAX_PICKS_PER_SERVICE);
  });

  it('pick 이 상한을 넘으면 복구하지 않고 버린다(discarded) — 링크 · 파일 같다', () => {
    const over = hashOf({ pp: Array.from({ length: MAX_RECOVER_PICKS + 1 }, () => ({ pr: 'nope' })) });
    expect(decodeWizardState(over)!.notices).toEqual({ ...NOTICES(), discarded: true });
    // 상한 꼭 맞으면 복구한다 — 서비스 안 pick 이 넘치면 앞 40개만(trimmed)
    const at = hashOf({ pp: [{ pr: 'vpc', i: [{ id: '1', q: '01' }] }], s: [{ n: 'shop', p: Array.from({ length: MAX_RECOVER_PICKS - 1 }, (_, j) => ({ pr: 'object', t: `t${String(j).padStart(3, '0')}` })) }] });
    const d = decodeWizardState(at)!;
    expect(d.notices.discarded).toBe(false);
    expect(d.notices.trimmed).toBe(MAX_RECOVER_PICKS - 1 - MAX_PICKS_PER_SERVICE);
  });

  it('슬롯 · 딸린 data 가 상한을 넘으면 버린다 — 파일도 같은 길이다', () => {
    const slots = (n: number) => Array.from({ length: n }, (_, k) => ({ id: `${k}`, q: 'zz' }));
    expect(decodeWizardState(hashOf({ pp: [{ pr: 'vpc', i: slots(MAX_RECOVER_NAMES + 1) }] }))!.notices).toEqual({ ...NOTICES(), discarded: true });
    // data 도 센다 — 슬롯 하나에 data 가 넘쳐도
    const withData = [{ id: '1', q: '01', a: { d: Array.from({ length: MAX_RECOVER_NAMES }, () => '01') } }];
    expect(decodeWizardState(hashOf({ s: [{ n: 'shop', p: [{ pr: 'file', i: withData }] }] }))!.notices.discarded).toBe(true);
    const file = { provider: 'gcp', project: PROJECT, project_picks: [{ preset: 'vpc', instances: Array.from({ length: MAX_RECOVER_NAMES + 1 }, (_, k) => ({ id: `${k}`, seq: 'zz' })) }] };
    expect(openPlanFile(JSON.stringify(file))!.notices).toEqual({ ...NOTICES(), discarded: true });
  });

  it(`상한 안의 최악 — 서비스 pick 200 · pick 마다 틀린 곳 넷 / 틀린 슬롯 400 / 틀린 pick 400 / 같은 pick 400 이 각각 ${BUDGET_MS} ms 안`, () => {
    const cases: Record<string, unknown> = {
      multi: services(10, (j) => ({ pr: 'web', t: `t${String.fromCharCode(97 + (j % 26))}`, h: 1, sv: 'gcp.vpc_network', i: [{ id: 'x', q: 'zz' }, { id: 'y', q: '01', a: { ip: 1, b: 7 } }] })),
      slots: { pp: [{ pr: 'vpc', i: Array.from({ length: MAX_RECOVER_NAMES }, (_, k) => ({ id: `${k}`, q: 'zz' })) }] },
      picksBadSlot: services(MAX_RECOVER_PICKS / MAX_SERVICES, () => ({ pr: 'bastion', i: [{ id: 'x', q: 'zz' }] })),
      duplicates: services(MAX_RECOVER_PICKS / MAX_SERVICES, () => ({ pr: 'object' })),
    };
    for (const [name, w] of Object.entries(cases)) {
      const h = hashOf(w);
      expect(decodeWizardState(h), name).toBeDefined();
      expect(ms(() => decodeWizardState(h)), name).toBeLessThan(BUDGET_MS);
    }
  }, 30_000);

  it(`파일 상한 꼭 맞는 최악 파일(틀린 슬롯으로 채움)도 ${BUDGET_MS} ms 안 — 상한을 넘는 파일은 읽지 않는다`, () => {
    const make = (n: number) => JSON.stringify({ provider: 'gcp', project: PROJECT, project_picks: [{ preset: 'vpc', instances: Array.from({ length: n }, () => ({ id: 'x', seq: 'zz' })) }], services: [] });
    // 상한까지 채운다 — 슬롯 하나는 22바이트
    let n = Math.floor((PLAN_FILE_MAX_BYTES - make(0).length) / 22);
    while (new TextEncoder().encode(make(n + 1)).length <= PLAN_FILE_MAX_BYTES) n++;
    const text = make(n);
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(PLAN_FILE_MAX_BYTES);
    expect(new TextEncoder().encode(make(n + 1)).length).toBeGreaterThan(PLAN_FILE_MAX_BYTES);
    expect(openPlanFile(text)!.notices.discarded).toBe(true);
    expect(ms(() => openPlanFile(text))).toBeLessThan(BUDGET_MS);
    expect(openPlanFile(make(n + 1))).toBeUndefined();
  }, 30_000);

  it('decodeWizardObject 가 상한 판정을 한다 — 파일 · 링크가 같이 지나는 자리', () => {
    const raw = { ...PROJECT, w: { pp: Array.from({ length: MAX_RECOVER_PICKS + 1 }, () => ({ pr: 'nope' })) } };
    expect(decodeWizardObject(raw)!.notices.discarded).toBe(true);
  });
});
