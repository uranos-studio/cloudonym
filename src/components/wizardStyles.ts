// 마법사 화면의 공용 클래스 · 표 (D89) — 목록 · 설정 · 이름 세 칸이 같이 쓴다. 컴포넌트가 아닌 값만 둔다(react-refresh)
import { buildTree } from '../core/tree';
import type { CoreMessage, Env, Provider, ResourceRule } from '../core/types';
import { treeRules } from './selection';
import { format } from '../messages/catalog';
import { en } from '../messages/en';

export const PANEL = 'rounded-xl border border-zinc-200 bg-white p-4 shadow-xs dark:border-zinc-800 dark:bg-zinc-900';
export const NOTICE = 'rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200';
export const LABEL = 'block text-sm font-medium text-zinc-800 dark:text-zinc-200';
export const HINT = 'text-xs text-zinc-600 dark:text-zinc-400';
export const CONTROL =
  'mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-500 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600 ' +
  'aria-invalid:border-rose-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-400 dark:focus-visible:outline-indigo-400';
export const SMALL_INPUT =
  'w-16 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-center font-mono text-sm text-zinc-900 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600 aria-invalid:border-rose-600 ' +
  'dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100';
export const BTN =
  'inline-flex min-h-9 items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 ' +
  'disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ' +
  'dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800';
/** 주 단추 — 카드 「Add」 · Project 의 「Next」 (D97) */
export const PRIMARY =
  'inline-flex min-h-9 items-center justify-center rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 ' +
  'disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ' +
  'dark:bg-indigo-500 dark:hover:bg-indigo-400 dark:focus-visible:outline-indigo-400';
export const ICON_BTN =
  'inline-flex size-9 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-rose-700 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:hover:bg-zinc-800 dark:hover:text-rose-300';
export const CHIP =
  'inline-flex min-h-9 items-center gap-1 rounded-full border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-40 ' +
  'aria-pressed:border-indigo-600 aria-pressed:bg-indigo-600 aria-pressed:text-white border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100 ' +
  'dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 dark:aria-pressed:border-indigo-500 dark:aria-pressed:bg-indigo-500';
export const ERR = 'text-xs text-rose-700 dark:text-rose-300';

export const ENV_NAMES: Record<Env, string> = { prod: 'Production', stg: 'Staging', dev: 'Development', sbx: 'Sandbox', qa: 'Quality assurance', uat: 'User acceptance', test: 'Test', perf: 'Performance', dr: 'Disaster recovery' };
/** 규칙 표 — 표시 이름 · 종류 표. 화면 안에서 한 번 만든다 */
/** 마법사 CSP(gcp · aws)의 규칙 — id 에 CSP 접두가 있어 한 표다 */
export const RULES = new Map<string, ResourceRule>((['gcp', 'aws'] as const).flatMap((p) => treeRules(buildTree(p))).map((r) => [r.id, r]));

/** 엔진 오류 문장 — 자리에 붙여 보이므로 `picks[0]: ` · `services[1]: ` 머리는 뗀다(API 문장은 그대로다) */
export function inline(e: CoreMessage): string {
  return format(e, en).replace(/^(?:picks|services)\[-?\d+\]: /, '');
}

/** 네트워크 칸의 CSP 별 문구 (0.2) — GCP 는 옛 문구 그대로, AWS 는 AWS 부품 이름 */
export function networkText(provider: Provider): { resourcesHint: string; firewallTiers: string } {
  return provider === 'aws'
    ? { resourcesHint: en.ui.wizard_project_resources_hint_aws, firewallTiers: en.ui.wizard_firewall_tiers_aws }
    : { resourcesHint: en.ui.wizard_project_resources_hint, firewallTiers: en.ui.wizard_firewall_tiers };
}

/** 마법사 머리글 — CSP 별 (0.2). GCP 는 옛 문구 그대로 */
export const headlineFor = (provider: Provider): string => (provider === 'aws' ? en.ui.headline_aws : en.ui.headline);
/** 이름 칸의 「만들지 않는다」 문장 — CSP 별 (0.2) */
export const nothingCreatedFor = (provider: Provider): string => (provider === 'aws' ? en.ui.wizard_nothing_created_aws : en.ui.wizard_nothing_created);
