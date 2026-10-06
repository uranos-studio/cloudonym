// 이름 내보내기 (D41 · 계획 §7-5) — 엔진 결과를 옮겨 적을 뿐이다. 무효(충돌 포함)는 names 에 넣지 않는다 — 「무효를 유효로 내지 않는다」 (L3)
import type { ManyResult } from '../core/engine';
import type { SelectionItem } from '../core/selection';
import type { NamingContext, Provider, ScopeId } from '../core/types';
import type { Version } from '../version';

export interface ExportedName { key: string; resource_type: string; seq?: string; role?: string; scope: ScopeId; name: string }
export interface NamesExport {
  version: Version;
  provider: Provider;
  context: NamingContext;
  names: ExportedName[];
  invalid: Array<{ key: string; codes: string[] }>;
}

/** selection 은 결과를 만든 그 선택 — 규칙의 범위(scope)를 거기서 읽는다 */
export function toNamesExport(many: ManyResult, ctx: NamingContext, version: Version, selection: readonly SelectionItem[]): NamesExport {
  const scopeOf = new Map(selection.map((i) => [i.rule.id, i.rule.scope]));
  const names: ExportedName[] = [];
  const invalid: NamesExport['invalid'] = [];
  for (const it of many.items) {
    if (!it.valid) {
      invalid.push({ key: it.key, codes: [...new Set(it.violations.map((v) => v.code))] });
      continue;
    }
    const scope = scopeOf.get(it.ruleId);
    if (scope === undefined) throw new Error(`no rule ${it.ruleId} in the selection`);
    names.push({
      key: it.key, resource_type: it.resourceType,
      ...(it.seq === undefined ? {} : { seq: it.seq }),
      ...(it.role === undefined ? {} : { role: it.role }),
      scope, name: it.name,
    });
  }
  return { version, provider: many.provider, context: ctx, names, invalid };
}

/** 「Copy all names」 — 유효한 이름만 한 줄에 하나. 건너뛴 무효 수는 버튼 라벨에 싣는다 */
export function allNamesText(many: ManyResult): { text: string; skipped: number } {
  const valid = many.items.filter((i) => i.valid);
  return { text: valid.map((i) => i.name).join('\n'), skipped: many.items.length - valid.length };
}
