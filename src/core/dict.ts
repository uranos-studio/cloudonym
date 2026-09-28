/** Record 조회 한 곳 — 상속 프로퍼티('constructor' 등)를 값으로 돌려주지 않는다 */
export function lookup<T>(dict: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(dict, key) ? dict[key] : undefined;
}
