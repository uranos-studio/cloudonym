// 엔진 결과 → Terraform `locals` 블록 문자열. 이름 규칙은 여기 없다 — 엔진 결과를 옮겨 적을 뿐이다 (L3)
import type { ManyResult } from '../core/engine';
import { PROVIDERS, type GenerateOutput, type LabelSet, type NameResult, type Provider } from '../core/types';
import { escapeInvisible, fillUi, format, type Catalog } from '../messages/catalog';
import { en } from '../messages/en';
import type { Version } from '../version';

/** CSP 가 부르는 이름대로 — AWS · Azure 는 tags, GCP 는 labels */
const LABEL_WORD: Record<Provider, string> = { aws: 'tags', gcp: 'labels', azure: 'tags' };

/** HCL 문자열 리터럴 — 역슬래시 · 따옴표 · 개행과 보간 시작(`${` · `%{`)을 이스케이프한다. 사용자 입력(owner 등)이 그대로 들어가는 자리라 반드시 거친다 */
export function hclString(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    // 치환 문자열의 `$$` 는 `$` 하나로 줄어든다 — 함수로 넘겨 글자 그대로 넣는다
    .replace(/\$\{/g, () => '$${')
    .replace(/%\{/g, () => '%%{');
  // 제어 문자 · 양방향 제어 · 폭 없는 문자는 \uXXXX 로 — 공유 URL 로 심은 값이 리뷰에서 보이는 것과 다른 순서로 렌더되지 않게 (Trojan Source).
  // 역슬래시 이스케이프 뒤에 둔다 — 여기서 넣은 역슬래시가 다시 두 겹이 되지 않는다. HCL 은 \uNNNN 을 받는다
  return `"${escapeInvisible(escaped)}"`;
}

/** locals 의 한 줄 — 키는 `${provider}_${key}` 로 적힌다 */
export interface TerraformEntry { key: string; result: NameResult }
export type TerraformNames = Partial<Record<Provider, readonly TerraformEntry[]>>;

/** generateMany 결과 → 항목 key 그대로(`virtual_machine_01` · `managed_identity_sync` · `resource_group`) — 충돌 항목은 valid:false 라 INVALID 다 (D41) */
export function manyEntries(many: ManyResult): TerraformNames {
  return { [many.provider]: many.items.map((i) => ({ key: i.key, result: i })) };
}

/** generate(세 CSP 전 리소스) 결과 → 항목 key = resourceType. 기준선 시험(core/baseline.test)이 옛 꼴 그대로 대어 보는 데 쓴다 */
export function outputEntries(out: GenerateOutput): TerraformNames {
  return Object.fromEntries(Object.entries(out).map(([p, names]) => [p, Object.entries(names ?? {}).map(([key, result]) => ({ key, result }))]));
}

/**
 * `valid:false` 인 항목은 값 없이 `# INVALID:` 주석으로만 나온다 — 무효한 이름을 변수로 내주지 않는다.
 * 라벨도 한도 위반이 있으면 블록 대신 `# INVALID:` 주석이다. provider 순서는 PROVIDERS, 리소스 순서는 넘긴 순서(엔진이 준 순서).
 * version 을 넘기면 `locals {` 앞에 엔진 · 규칙 버전과 PASS 의 뜻을 주석 두 줄로 적는다 (D26 · D28)
 */
export function toTerraformLocals(out: TerraformNames, labels: Partial<Record<Provider, LabelSet>>, catalog: Catalog = en, version?: Version): string {
  const reasons = (ms: LabelSet['violations']) => ms.map((m) => format(m, catalog)).join(' · ');
  const header = version
    ? [`# ${fillUi(catalog, 'terraform_header_version', version)}`, `# ${fillUi(catalog, 'terraform_header_pass')}`]
    : [];
  const lines: string[] = [...header, 'locals {'];
  for (const p of PROVIDERS) {
    const names = out[p];
    if (!names) continue;
    lines.push(`  # ${p}`);
    for (const { key: k, result: r } of names) {
      const key = `${p}_${k}`;
      if (r.valid) lines.push(`  ${key} = ${hclString(r.name)}`);
      else lines.push(`  # INVALID: ${key} — ${reasons(r.violations)}`);
    }
    const set = labels[p];
    if (set) {
      const key = `${p}_${LABEL_WORD[p]}`;
      if (set.violations.length > 0) {
        lines.push(`  # INVALID: ${key} — ${reasons(set.violations)}`);
      } else {
        lines.push(`  ${key} = {`);
        for (const [k, v] of Object.entries(set.labels)) lines.push(`    ${k} = ${hclString(v)}`);
        lines.push('  }');
      }
    }
    lines.push('');
  }
  while (lines[lines.length - 1] === '') lines.pop();
  lines.push('}');
  return `${lines.join('\n')}\n`;
}
