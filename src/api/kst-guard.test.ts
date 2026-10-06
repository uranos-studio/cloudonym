import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// UTC 로 새는 호출 — workerd 의 로컬 시간대는 UTC 라 getHours() · toLocaleDateString() 도 UTC 다. 시각은 telemetry.ts 의 kstStamp 로만 만든다
const FORBIDDEN = /\.(toISOString|toJSON|toUTCString|toDateString|toLocale(Date|Time)?String|get(Date|Day|Hours|Month|FullYear))\(/;

describe('src/api/ KST 위반 검사 — toISOString · toJSON · 로컬 시간대 게터 금지', () => {
  const dir = import.meta.dirname;
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

  it(`대상 소스가 7개 이상 있다 (현재 ${files.length}개)`, () => expect(files.length).toBeGreaterThanOrEqual(7));
  it('검사식이 위반을 실제로 잡는다 (검사기 자체 시험)', () => {
    for (const bad of ['const t = new Date().toISOString();', 'JSON.stringify(x.toJSON())', 'd.toUTCString()', 'd.toLocaleDateString()', 'd.toLocaleString()', 'd.getHours()', 'd.getDate()', 'd.getFullYear()']) {
      expect(FORBIDDEN.test(bad), bad).toBe(true);
    }
    for (const ok of ['kstStamp(now).time', 'kv.get(key)', 'c.req.header("user-agent")', 'KST.formatToParts(now)']) {
      expect(FORBIDDEN.test(ok), ok).toBe(false);
    }
  });
  it('어느 소스에도 없다', () => {
    const hits = files.filter((f) => FORBIDDEN.test(readFileSync(join(dir, f), 'utf-8')));
    expect(hits).toEqual([]);
  });
});
