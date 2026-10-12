// 마법사 결과 → Terraform `locals` 블록 (D69). toTerraformLocals(평평한 변수)와 다른 함수다 — 이름은 구조 키를 맵 키로 하는 맵 하나,
// 라벨은 이름공간별 맵 하나. 맵 키 = 항목 key 그대로라 식별자 변환이 항등이다(구조 키가 단사면 맵 키도 단사)
import { serviceNamespace, type ProjectResult, type ProjectSelection } from '../core/engine';
import { labelsFor } from '../core/labels';
import type { LabelSet, Provider } from '../core/types';
import { fillUi, format, type Catalog } from '../messages/catalog';
import { en } from '../messages/en';
import type { Version } from '../version';
import { hclString } from './terraform';

/** 이름공간별 라벨 — 'project' 는 프로젝트 문맥(purpose 없음), 서비스는 정제된 purpose 가 키다(항목의 namespace 와 같은 값) */
export function wizardLabels(sel: ProjectSelection, provider: Provider): Record<string, LabelSet> {
  const out: Record<string, LabelSet> = { project: labelsFor(sel.project, provider) };
  for (const svc of sel.services) out[serviceNamespace(svc.purpose)] = labelsFor({ ...sel.project, purpose: svc.purpose }, provider);
  return out;
}

/**
 * `<provider>_names = { "<key>" = "<name>" … }` + `<provider>_labels_by_namespace = { "<namespace>" = { … } … }`.
 * valid:false 항목(축소 실패 · 충돌 · 부모가 무효인 자식)은 맵 밖 `# INVALID: <provider>_names["<key>"] — 이유` 주석이다 — 무효한 이름을 값으로 내주지 않는다.
 * 라벨 위반이 있는 이름공간도 맵 밖 `# INVALID:` 주석이다. version 을 넘기면 머리 주석 두 줄 (D26 · D28)
 */
export function wizardTerraform(result: ProjectResult, labels: Readonly<Record<string, LabelSet>>, version?: Version, catalog: Catalog = en): string {
  const p = result.provider;
  const reasons = (ms: LabelSet['violations']) => ms.map((m) => format(m, catalog)).join(' · ');
  const lines: string[] = version
    ? [`# ${fillUi(catalog, 'terraform_header_version', version)}`, `# ${fillUi(catalog, 'terraform_header_pass')}`]
    : [];
  lines.push('locals {', `  ${p}_names = {`);
  for (const i of result.items) if (i.valid) lines.push(`    ${hclString(i.key)} = ${hclString(i.name)}`);
  lines.push('  }');
  for (const i of result.items) if (!i.valid) lines.push(`  # INVALID: ${p}_names[${hclString(i.key)}] — ${reasons(i.violations)}`);

  const spaces = Object.entries(labels);
  if (spaces.length > 0) {
    lines.push(`  ${p}_labels_by_namespace = {`);
    for (const [ns, set] of spaces) {
      if (set.violations.length > 0) continue;
      lines.push(`    ${hclString(ns)} = {`);
      for (const [k, v] of Object.entries(set.labels)) lines.push(`      ${k} = ${hclString(v)}`);
      lines.push('    }');
    }
    lines.push('  }');
    for (const [ns, set] of spaces) if (set.violations.length > 0) lines.push(`  # INVALID: ${p}_labels_by_namespace[${hclString(ns)}] — ${reasons(set.violations)}`);
  }
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

/**
 * 환경 여럿 (D82) — `<provider>_names_by_env = { "<env>" = { "<key>" = "<name>" … } … }` +
 * `<provider>_labels_by_env = { "<env>" = { "<namespace>" = { … } … } … }`. 무효 이름 · 라벨 위반은 위와 같이 맵 밖 `# INVALID:` 주석이다
 */
export function wizardTerraformByEnv(
  entries: readonly { env: string; result: ProjectResult; labels: Readonly<Record<string, LabelSet>> }[], version?: Version, catalog: Catalog = en,
): string {
  const p = entries[0]?.result.provider ?? 'gcp';
  const reasons = (ms: LabelSet['violations']) => ms.map((m) => format(m, catalog)).join(' · ');
  const lines: string[] = version
    ? [`# ${fillUi(catalog, 'terraform_header_version', version)}`, `# ${fillUi(catalog, 'terraform_header_pass')}`]
    : [];
  lines.push('locals {', `  ${p}_names_by_env = {`);
  for (const e of entries) {
    lines.push(`    ${hclString(e.env)} = {`);
    for (const i of e.result.items) if (i.valid) lines.push(`      ${hclString(i.key)} = ${hclString(i.name)}`);
    lines.push('    }');
  }
  lines.push('  }');
  for (const e of entries) {
    for (const i of e.result.items) if (!i.valid) lines.push(`  # INVALID: ${p}_names_by_env[${hclString(e.env)}][${hclString(i.key)}] — ${reasons(i.violations)}`);
  }
  if (entries.some((e) => Object.keys(e.labels).length > 0)) {
    lines.push(`  ${p}_labels_by_env = {`);
    for (const e of entries) {
      lines.push(`    ${hclString(e.env)} = {`);
      for (const [ns, set] of Object.entries(e.labels)) {
        if (set.violations.length > 0) continue;
        lines.push(`      ${hclString(ns)} = {`);
        for (const [k, v] of Object.entries(set.labels)) lines.push(`        ${k} = ${hclString(v)}`);
        lines.push('      }');
      }
      lines.push('    }');
    }
    lines.push('  }');
    for (const e of entries) {
      for (const [ns, set] of Object.entries(e.labels)) if (set.violations.length > 0) lines.push(`  # INVALID: ${p}_labels_by_env[${hclString(e.env)}][${hclString(ns)}] — ${reasons(set.violations)}`);
    }
  }
  lines.push('}');
  return `${lines.join('\n')}\n`;
}
