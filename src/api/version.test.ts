import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VERSION } from '../version';
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
});
