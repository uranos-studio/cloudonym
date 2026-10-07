import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE_VERSION, VERSION } from '../version';
import { RULES_REVISION } from '../core/revision';

describe('버전 (D26)', () => {
  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'package.json'), 'utf-8')) as { version: string };
  it('engine 은 package.json 의 version 이다', () => {
    expect(VERSION.engine).toBe(pkg.version);
    expect(VERSION.engine).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it('rules 는 RULES_REVISION 이다', () => {
    expect(VERSION.rules).toBe(RULES_REVISION);
  });
  it('CHANGELOG.md 에 이 엔진 버전의 머리 하나와 그 릴리스의 규칙 버전 줄이 있다 (D58)', () => {
    const log = readFileSync(join(import.meta.dirname, '..', '..', 'CHANGELOG.md'), 'utf-8');
    const heads = log.split('\n').filter((l) => l.startsWith(`## [${ENGINE_VERSION}]`));
    expect(heads).toHaveLength(1);
    expect(log).toContain(`Rules revision for this release: ${RULES_REVISION}.`);
  });
});
