// cli/lib/server.mjs 의 선언 — src 의 계약 시험(src/api/cli-contract.test.ts)이 .mjs 를 들여올 때 쓴다(main.d.mts 와 같은 꼴)
export const DEFAULT_SERVER: string;
export function configPathOf(env: Record<string, string | undefined>, platform?: string): string | null;
export function checkServerUrl(raw: string): { server: string } | { error: string };
export function readConfigServer(path: string, read?: (p: string) => string): { server?: string; warning?: string };
export function serverOf(flag: string | undefined, env: Record<string, string | undefined>, o?: { configPath?: string | null; read?: (p: string) => string }): { server: string; source: string; warnings: string[] } | { error: string };
