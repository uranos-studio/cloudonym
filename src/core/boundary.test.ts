import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('src/core/ 모듈 경계 — import 는 ./ 로만', () => {
  // src/core/ 디렉터리의 모든 .ts 파일 (테스트 파일 제외)
  const coreDir = join(import.meta.dirname, '.');
  const files = readdirSync(coreDir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => join(coreDir, f));

  it(`대상 파일이 10개 이상 있다 (현재 ${files.length}개)`, () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  const allSpecifiers: string[] = [];

  files.forEach((file) => {
    const content = readFileSync(file, 'utf-8');
    
    // import/export 문에서 from '...' 또는 from "..." 패턴 추출
    // 예: import { x } from './foo'
    //     import './foo'
    //     export { x } from './foo'
    //     export * from './foo'
    const importRegex = /(?:import|export)(?:[^'"]*from)?\s+['"]([^'"]+)['"]/g;
    let match;
    
    while ((match = importRegex.exec(content)) !== null) {
      const specifier = match[1];
      allSpecifiers.push(specifier);
    }
  });

  it(`import/export 지정자가 하나 이상 찾아진다 (현재 ${allSpecifiers.length}개)`, () => {
    expect(allSpecifiers.length).toBeGreaterThan(0);
  });

  it('모든 import/export 지정자는 ./ 로 시작한다', () => {
    const violations = allSpecifiers.filter((s) => !s.startsWith('./'));
    
    if (violations.length > 0) {
      const details = violations
        .slice(0, 5)
        .map((s) => `  - '${s}'`)
        .join('\n');
      const more = violations.length > 5 ? `\n  ... 그 외 ${violations.length - 5}개` : '';
      expect.fail(
        `런타임 의존성/역방향 import 발견 (${violations.length}개):\n${details}${more}`
      );
    }
  });
});
