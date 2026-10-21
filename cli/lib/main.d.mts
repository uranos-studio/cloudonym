// cli/lib/main.mjs 의 선언 — src 의 계약 시험(src/api/cli-contract.test.ts)이 .mjs 를 들여올 때 쓴다(src/core/invisible.d.mts 와 같은 꼴)
export interface CliResponse { status: number; headers: { get(name: string): string | null }; text(): Promise<string> }
export type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<CliResponse>;
export interface Deps {
  fetchFn: FetchFn;
  env: Record<string, string | undefined>;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  cwd: string;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  configPath: string | null;
  tty: { stdin: boolean; stdout: boolean };
  stdin: NodeJS.ReadableStream;
  write: (s: string) => void;
}
export const EXIT: { OK: 0; FAIL: 1; INPUT: 2; VERSION: 3; UNAVAILABLE: 4; USAGE: 64; INTERNAL: 70 };
export const USER_AGENT: string;
export const CLI_VERSION: string;
export function main(argv: string[], deps?: Partial<Deps>): Promise<number>;
export function nextSeq(used: readonly string[]): string | undefined;
export function nextSlotId(used: readonly string[]): string;
export function resolveTarget(arg: string, provider: string, cat: { rows: any[]; presets: any[] }): { preset?: any; rule: string } | { error: string };

// 묻는 흐름(cli/lib/guide.mjs)이 main.mjs 에서 들여오는 것 (D121) — guide 의 타입 검사도 이 선언을 본다
export type ApiResult = { kind: 'ok'; status: number; body: any } | { kind: 'malformed'; status: number; message: string } | { kind: 'http'; status: number; body: any; retryAfter?: number } | { kind: 'unreachable'; message: string };
export interface Client { get(path: string): Promise<ApiResult>; post(path: string, body: unknown): Promise<ApiResult> }
export interface TableRow { item: any; valid: boolean; messages?: string[]; scope?: string; uniqueness?: string }
export const DEFAULT_FILE: string;
export class UsageError extends Error { constructor(message: string, o?: { short?: boolean }); short: boolean }
export const COMMANDS: readonly string[];
export const OUTPUTS: readonly ['table', 'json', 'tsv'];
export const PROVIDERS: readonly ['gcp', 'aws', 'azure'];
export function notEnabled(provider: unknown, supported: unknown): string;
export function providerOf(given: string | undefined): string;
export class Ctx {
  d: Deps;
  v: Record<string, any>;
  file: string;
  shown: string;
  cat: any;
  server: string | undefined;
  format: 'auto' | 'table' | 'json' | 'tsv';
  noInput(): boolean;
  canAsk(): boolean;
  table(): boolean;
  json(): boolean;
  tsv(): boolean;
  command(cmd: string): string;
  client(): Client;
  report(r: ApiResult, label?: string): number;
}
export function wizardData(body: any, provider: string): { valid: boolean; items: any[] } | undefined;
export function checkWizard(r: ApiResult, provider: string): ApiResult;
export function exportName(it: any): Record<string, unknown>;
export function exportEnv(body: any, provider: string): { valid: boolean; names: any[]; invalid: any[] };
export const worst: (codes: number[]) => number;
export function tableRows(body: any, provider: string): TableRow[];
export function printTable(ctx: Ctx, byEnv: Record<string, TableRow[]>, envs: string[], onlyNewAgainst: any, provider: string): void;
export function catalogOf(catalog: any, provider: string): { rows: any[]; presets: any[]; limits: Record<string, any> } | undefined;
export function ruleSpec(cat: { rows: any[] }, id: string): any;
export function pickIdentity(p: any, cat: { rows: any[]; presets: any[] }): string;
export function commitAdd(ctx: Ctx, o: { plan: any; digest: string; lists: { project_picks: any[]; services: { purpose: string; picks: any[] }[] }; next: any; summary: string; where: string; client: Client; provider: string }): Promise<number>;
