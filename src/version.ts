// 결과에 싣는 버전 (D26) — engine 은 package.json 의 version, rules 는 규칙 버전(src/core/revision.ts).
// package.json 을 들여오지 않고 값만 적는다 — 들여오면 파일 전체(devDependencies 이름까지)가 Worker · 브라우저 번들에 실린다.
// 두 값이 같은지는 src/api/version.test.ts 가 본다 — package.json 의 version 을 올리면 여기도 같이 올린다
import { RULES_REVISION } from './core/revision';

export const ENGINE_VERSION = '0.1.9';

export const VERSION = { engine: ENGINE_VERSION, rules: RULES_REVISION } as const;
export type Version = { engine: string; rules: string };
