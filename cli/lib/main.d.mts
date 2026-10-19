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
}
export const EXIT: { OK: 0; FAIL: 1; INPUT: 2; VERSION: 3; UNAVAILABLE: 4; USAGE: 64; INTERNAL: 70 };
export const USER_AGENT: string;
export const CLI_VERSION: string;
export function main(argv: string[], deps?: Partial<Deps>): Promise<number>;
export function nextSeq(used: readonly string[]): string | undefined;
export function nextSlotId(used: readonly string[]): string;
export function resolveTarget(arg: string, provider: string, cat: { rows: any[]; presets: any[] }): { preset?: any; rule: string } | { error: string };
