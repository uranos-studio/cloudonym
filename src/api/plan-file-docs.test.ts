// 계획 파일 상한 (D100) — 문서가 손으로 적은 숫자를 상수와 묶는다. 링크 상한이 바뀌면 이 시험이 문서를 고치라고 알린다
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLAN_FILE_MAX_BYTES } from '../components/planFile';

const shown = PLAN_FILE_MAX_BYTES.toLocaleString('en-US');

describe('계획 파일 상한 숫자', () => {
  it.each(['docs/web-ui.md', 'CHANGELOG.md', 'docs/decisions.md'])('%s 의 숫자가 PLAN_FILE_MAX_BYTES 와 같다', (file) => {
    const all = readFileSync(join(import.meta.dirname, '..', '..', file), 'utf8');
    // CHANGELOG 은 지금 항목(Unreleased · 0.2.0)만 — 지난 릴리스 항목은 낸 그대로 두고 다시 쓰지 않는다
    const past = file === 'CHANGELOG.md' ? all.search(/^## \[0\.1\./m) : -1;
    const text = past >= 0 ? all.slice(0, past) : all;
    const numbers = [...text.matchAll(/\b1\d{2},\d{3}\b/g)].map((m) => m[0]).filter((n) => n.startsWith('17'));
    expect(numbers.length).toBeGreaterThan(0);
    for (const n of numbers) expect(n).toBe(shown);
  });
});
