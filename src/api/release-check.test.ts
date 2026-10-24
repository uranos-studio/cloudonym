// scripts/release-check.sh 의 점검 헤더 (D99) — 셸 시험 틀이 없어 글자로 센다. 비밀값은 어느 출력 줄에도 나오지 않는다
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TELEMETRY_SKIP_HEADER } from './telemetry';

const path = join(import.meta.dirname, '../../scripts/release-check.sh');
const script = readFileSync(path, 'utf-8');
const lines = script.split('\n');
const VAR = 'CLOUDONYM_TELEMETRY_SKIP_TOKEN';

describe('release-check.sh — 점검 요청은 세지 않는다', () => {
  it('bash -n 통과', () => {
    expect(() => execFileSync('bash', ['-n', path])).not.toThrow();
  });
  it('헤더 이름은 telemetry.ts 의 상수와 같다', () => {
    expect(script).toContain(`${TELEMETRY_SKIP_HEADER}: `);
  });
  it('헤더는 fetch() 와 요청 제한 묶음(--next 마다) 둘 다에 달린다', () => {
    const fetchLine = lines.find((l) => l.includes('curl -sS --max-time 20'));
    expect(fetchLine).toContain('"${skip_args[@]}"');
    const burstLine = lines.find((l) => l.startsWith('    rl_args+=(-X POST'));
    expect(burstLine).toContain('"${skip_args[@]}"');
    const healthLine = lines.find((l) => l.includes('rl_args+=(') && l.includes('/v1/health'));
    expect(healthLine).toContain('"${skip_args[@]}"');
  });
  it('환경변수 값은 ${VAR:-} 로만 펼치고, 출력하는 줄(echo · info · pass · fail)에서는 펼치지 않는다 · printf 는 0600 파일로만', () => {
    const expansions = lines.filter((l) => l.includes(`$${VAR}`) || l.includes(`\${${VAR}`));
    expect(expansions.length).toBeGreaterThan(0);
    for (const l of expansions) {
      expect(l, l).not.toMatch(new RegExp(`\\$${VAR}|\\$\\{${VAR}\\}`));
      expect(l, l).not.toMatch(/\b(echo|info|pass|fail)\b/);
      if (/\bprintf\b/.test(l)) expect(l, l).toMatch(/umask 077 .*> "\$\{work\}\/skip-header"\)$/);
    }
    // 값을 담는 배열 · 파일도 출력 줄에 나오지 않고, 값은 명령줄이 아니라 -H @파일 로 넘긴다
    for (const l of lines.filter((x) => /\b(echo|info|pass|fail)\b/.test(x))) expect(l, l).not.toMatch(/skip_args|skip-header/);
    expect(script).toContain('skip_args=(-H "@${work}/skip-header")');
  });
  it('변수가 없으면 경고하고 계속한다 — 실제로 돌려 본다(연결 실패여도 경고는 먼저 나온다)', () => {
    const env = { ...process.env };
    delete env[VAR];
    let out = '';
    try {
      execFileSync('bash', [path, '--skip-ratelimit', 'http://127.0.0.1:9'], { env, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      out = String((e as { stdout?: string }).stdout ?? '');
    }
    expect(out).toMatch(/WARN .*counted/);
    const secret = 'do-not-print-this-value-123';
    let withVar = '';
    try {
      execFileSync('bash', [path, '--skip-ratelimit', 'http://127.0.0.1:9'], { env: { ...env, [VAR]: secret }, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string };
      withVar = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }
    expect(withVar).not.toContain(secret);
    expect(withVar).not.toMatch(/WARN .*counted/);
    expect(withVar).toContain('INFO  telemetry skip header sent — not counted only if it matches the Worker secret');
  }, 60_000);
});

import { PAGES } from '../site/pages';

describe('release-check.sh — 화면 경로 목록이 경로 표(PAGES)와 같다 (D106 · D129)', () => {
  it('head 점검 경로 · sitemap 기대 목록 · URL 수가 PAGES 순서 그대로', () => {
    const loop = /^for route in ([^;]+); do$/m.exec(script);
    expect(loop?.[1]?.split(' ')).toEqual(PAGES.map((p) => p.path));
    const want = /^ {2}want="([^"]+)"$/m.exec(script);
    expect(want?.[1]).toBe(PAGES.map((p) => `\${base}${p.path} `).join(''));
    expect(script).toContain(`(application/xml, ${PAGES.length} URLs)`);
  });
});
