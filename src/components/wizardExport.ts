// 마법사 이름 내보내기 (D69 · §7) — 엔진 결과(generateProject)를 옮겨 적을 뿐이다. 무효(충돌 · 부모가 무효인 자식 포함)는 names 에 넣지 않는다.
// 트리 화면의 내보내기(namesExport.ts)와 다른 꼴이다 — key 는 구조 키, 항목마다 이름공간 · 딸린 것이면 부모 키와 접미 종류
import type { ProjectResult } from '../core/engine';
import type { NamingContext, Provider } from '../core/types';
import type { WizardPlan } from '../core/wizard/plan';
import type { Version } from '../version';

export interface WizardExportedName {
  key: string; namespace: string; resource_type: string;
  level?: 'project'; tier?: string; seq?: string; role?: string; kind?: string;
  parent?: string; attach?: string;
  name: string;
}
export interface WizardExport {
  version: Version;
  provider: Provider;
  /** 문맥 넷 — 프로젝트 수준 항목의 문맥 */
  project: Omit<NamingContext, 'purpose'>;
  /** 서비스마다 문맥 다섯 */
  services: NamingContext[];
  names: WizardExportedName[];
  invalid: Array<{ key: string; codes: string[] }>;
}

/** project 는 풀린 문맥(리전 코드) — 부르는 쪽이 parseProjectContext 로 만든 값 */
export function toWizardExport(result: ProjectResult, project: Omit<NamingContext, 'purpose'>, plan: WizardPlan, version: Version): WizardExport {
  const names: WizardExportedName[] = [];
  const invalid: WizardExport['invalid'] = [];
  for (const it of result.items) {
    if (!it.valid) {
      invalid.push({ key: it.key, codes: [...new Set(it.violations.map((v) => v.code))] });
      continue;
    }
    names.push({
      key: it.key, namespace: it.namespace ?? '', resource_type: it.resourceType,
      ...(it.level === undefined ? {} : { level: it.level }),
      ...(it.tier === undefined ? {} : { tier: it.tier }),
      ...(it.seq === undefined ? {} : { seq: it.seq }),
      ...(it.role === undefined ? {} : { role: it.role }),
      ...(it.kind === undefined ? {} : { kind: it.kind }),
      ...(it.parent === undefined ? {} : { parent: it.parent }),
      ...(it.attach === undefined ? {} : { attach: it.attach }),
      name: it.name,
    });
  }
  const { owner, system, env, region } = project;
  return {
    version, provider: result.provider, project: { owner, system, env, region },
    services: plan.services.map((s) => ({ owner, system, purpose: s.purpose, env, region })),
    names, invalid,
  };
}

/** 환경 여럿 (D82) — 환경마다 위와 같은 꼴(version · provider 는 한 번만). 키 순서는 고른 순서(표준값 순서) */
export interface WizardExportByEnv {
  version: Version;
  provider: Provider;
  environments: Record<string, Omit<WizardExport, 'version' | 'provider'>>;
}
export function toWizardExportByEnv(
  entries: readonly { env: string; result: ProjectResult; project: Omit<NamingContext, 'purpose'>; plan: WizardPlan }[], version: Version,
): WizardExportByEnv {
  const environments: WizardExportByEnv['environments'] = {};
  for (const e of entries) {
    const { version: _v, provider: _p, ...rest } = toWizardExport(e.result, e.project, e.plan, version);
    environments[e.env] = rest;
  }
  return { version, provider: entries[0]?.result.provider ?? 'gcp', environments };
}
