// @ts-check
// 부를 서버 고르기 (D121) — --server → CLOUDONYM_SERVER → 설정 파일의 server → DEFAULT_SERVER(운영 배포).
// 운영 URL 은 저장소 전체에서 이 파일의 DEFAULT_SERVER 와 README 의 「Try it」 링크(2026-10-23 승인) 두 곳에만 있다 — cli/server.test.mjs 가 git ls-files 로 센다.
// 셀프호스팅 · 포크는 설정 파일 한 줄({ "server": "https://…" })이나 환경변수로 덮는다
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 아무것도 설정하지 않으면 부르는 서버 — 공개 배포 (D121) */
export const DEFAULT_SERVER = 'https://cloudonym.uranos.dev';

/**
 * 설정 파일 자리 — 윈도우 %APPDATA%\cloudonym\config.json · 그 밖 $XDG_CONFIG_HOME/cloudonym/config.json(없으면 ~/.config/cloudonym/config.json).
 * 환경변수가 없으면 null(설정 파일 없음). 홈 디렉터리는 env 로만 찾는다 — 시험은 env 를 넣어 실제 홈을 만지지 않는다
 * @param {Record<string, string | undefined>} env @param {string} [platform]
 * @returns {string | null}
 */
export function configPathOf(env, platform = process.platform) {
  if (platform === 'win32') return env.APPDATA ? join(env.APPDATA, 'cloudonym', 'config.json') : null;
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, 'cloudonym', 'config.json');
  if (env.HOME) return join(env.HOME, '.config', 'cloudonym', 'config.json');
  return null;
}

/**
 * origin + 경로(끝의 / 를 뗀다)로 조립한다 — 쿼리 · fragment 가 있으면 API 경로가 그 뒤에 붙으므로 거부하고,
 * 사용자 이름 · 암호가 든 URL 은 오류 문장 · 「Cannot reach」 줄에 그대로 찍히므로 거부한다.
 * 거부 문장에는 받은 URL 을 넣지 않는다 — 쿼리의 토큰 · 해석되지 않는 URL 의 자격이 stderr 로 나가므로, 무엇이 틀렸는지만 말한다
 * @param {string} raw
 * @returns {{ server: string } | { error: string }}
 */
export function checkServerUrl(raw) {
  /** @type {URL} */
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { error: 'The server URL is not a valid URL (it is not repeated here, in case it carries a secret).' };
  }
  if (u.username !== '' || u.password !== '') return { error: 'The server URL must not carry a user name or password.' };
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'The server URL must start with http:// or https://.' };
  if (u.search !== '' || u.hash !== '') return { error: 'The server URL must not have a query or fragment.' };
  return { server: `${u.origin}${u.pathname.replace(/\/+$/, '')}` };
}

/**
 * 설정 파일의 server — 없으면 {} · JSON 객체가 아니거나 server 가 문자열이 아니면 경고 한 줄(파일 하나가 도구 전체를 막지 않게 기본값으로 간다).
 * server 가 문자열인데 쓸 수 없는 URL 이면 그것은 오류다 — 셀프호스팅을 뜻한 사람의 요청이 조용히 공개 배포로 가면 안 된다
 * @param {string} path @param {(p: string) => string} [read]
 * @returns {{ server?: string, warning?: string }}
 */
export function readConfigServer(path, read = (p) => readFileSync(p, 'utf-8')) {
  let text;
  try {
    text = read(path);
  } catch (e) {
    if (typeof e === 'object' && e !== null && /** @type {{ code?: unknown }} */ (e).code === 'ENOENT') return {};
    return { warning: `Ignoring the config file ${path}: ${e instanceof Error ? e.message : String(e)}` };
  }
  /** @type {unknown} */
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return { warning: `Ignoring the config file ${path}: it is not JSON.` };
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return { warning: `Ignoring the config file ${path}: it is not a JSON object.` };
  const server = /** @type {Record<string, unknown>} */ (doc).server;
  if (server === undefined) return {};
  if (typeof server !== 'string' || server === '') return { warning: `Ignoring "server" in the config file ${path}: it is not a non-empty string.` };
  return { server };
}

/**
 * 서버를 고른다 — 순위 넷: --server → CLOUDONYM_SERVER(빈 값은 없는 것) → 설정 파일 → DEFAULT_SERVER.
 * source 는 --version 이 보이는 출처 · warnings 는 설정 파일을 건너뛴 까닭(stderr 한 줄씩)
 * @param {string | undefined} flag @param {Record<string, string | undefined>} env
 * @param {{ configPath?: string | null, read?: (p: string) => string }} [o]
 * @returns {{ server: string, source: string, warnings: string[] } | { error: string }}
 */
export function serverOf(flag, env, o = {}) {
  if (flag !== undefined) {
    if (flag === '') return { error: '--server is empty.' };
    const r = checkServerUrl(flag);
    return 'error' in r ? r : { ...r, source: '--server', warnings: [] };
  }
  const fromEnv = env.CLOUDONYM_SERVER;
  if (fromEnv !== undefined && fromEnv !== '') {
    const r = checkServerUrl(fromEnv);
    return 'error' in r ? { error: `CLOUDONYM_SERVER: ${r.error}` } : { ...r, source: 'CLOUDONYM_SERVER', warnings: [] };
  }
  /** @type {string[]} */
  const warnings = [];
  if (o.configPath) {
    const c = readConfigServer(o.configPath, o.read);
    if (c.warning) warnings.push(`${c.warning} Using the default server.`);
    if (c.server !== undefined) {
      const r = checkServerUrl(c.server);
      return 'error' in r ? { error: `The config file ${o.configPath}: ${r.error}` } : { ...r, source: `config ${o.configPath}`, warnings };
    }
  }
  return { server: DEFAULT_SERVER, source: 'default', warnings };
}
