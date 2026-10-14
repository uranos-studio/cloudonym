// 계획 파일 시험의 계획 (D100) — 화면 시험(planFile.test)과 API 시험(plan-file.test)이 같이 쓴다
import type { WizardPlan } from '../../core/wizard/plan';

export const PLAN_PROJECT = { owner: 'platform', system: 'billing', env: 'prod', region: 'asia-northeast3-a' };

/** 칸 대응표(설계 §2-4)의 줄을 전부 쓰는 계획 — 프리셋 · custom rule · tier · role · kind · ha · serverless 둘 · location(멀티 리전 · regional) · 슬롯 · 딸린 것 넷 · 접미사 */
export const FULL_PLAN: WizardPlan = {
  provider: 'gcp', project: PLAN_PROJECT, projectIdSuffix: 'core',
  projectPicks: [
    { preset: 'vpc', instances: [{ id: '1', seq: '01' }] },
    { preset: 'subnet', instances: [{ id: '1', seq: '01' }, { id: '2', seq: '03' }] },
    { preset: 'firewall', tier: 'web', instances: [{ id: '1', seq: '01' }] },
  ],
  services: [
    { purpose: 'shop', picks: [
      { preset: 'web', ha: true, instances: [{ id: '1', seq: '01', attach: { boot: true, data: ['01', '02'], ip: true, ipi: true } }, { id: '2', seq: '02', attach: { boot: true } }] },
      { preset: 'db', kind: 'POSTGRES', instances: [{ id: '1', seq: '01' }] },
      { preset: 'object', location: 'US' },
      { preset: 'sa', role: 'db' },
      { preset: null, ruleId: 'gcp.cloud_function', instances: [{ id: 'a', seq: '07' }] },
    ] },
    { purpose: 'pay', picks: [
      { preset: 'was', serverless: 'gcp.run_service', instances: [{ id: '1', seq: '01' }] },
      { preset: 'web', serverless: 'gcp.cloud_function', instances: [{ id: '1', seq: '01' }] },
      { preset: 'secret', location: 'regional', instances: [{ id: '1', seq: '01' }] },
    ] },
  ],
};
