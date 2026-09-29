// 결과에 싣는 버전 (D26) — engine 은 package.json 의 version, rules 는 규칙 버전(src/core/revision.ts)
import pkg from '../package.json' with { type: 'json' };
import { RULES_REVISION } from './core/revision';

export const VERSION = { engine: pkg.version, rules: RULES_REVISION } as const;
export type Version = { engine: string; rules: string };
