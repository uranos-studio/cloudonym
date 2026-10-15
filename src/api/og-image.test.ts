// 공유 미리보기 그림 (og:image) — 그림 크기가 머리 태그와 같고, 그림을 찍은 예시가 지금 소개 예시(엔진이 만든 것)와 같은가.
// 다르면 그림이 옛 이름을 보인다 — `uv run --python 3.12 --with "playwright==1.63.0" python scripts/og-image.py` 로 다시 찍는다
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OG_IMAGE } from './site';

const root = join(import.meta.dirname, '..', '..');

/** PNG 머리(IHDR)의 너비 · 높이 */
function pngSize(buf: Buffer): { width: number; height: number } {
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(buf.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('og:image', () => {
  it('public/og-image.png 가 있고 크기가 머리 태그의 값(1200×630)과 같다 · 5 MB 아래', () => {
    const buf = readFileSync(join(root, 'public', OG_IMAGE.path.slice(1)));
    expect(pngSize(buf)).toEqual({ width: OG_IMAGE.width, height: OG_IMAGE.height });
    expect(OG_IMAGE).toMatchObject({ width: 1200, height: 630 });
    expect(buf.length).toBeLessThan(5 * 1024 * 1024);
  });
  it('그림을 찍은 예시 = 지금 소개 예시 (값 넷 · 이름 셋)', () => {
    const stamp = JSON.parse(readFileSync(join(root, 'scripts/og-image.json'), 'utf-8')) as { input: string[]; names: string[] };
    const intro = JSON.parse(readFileSync(join(root, 'src/components/introExamples.json'), 'utf-8')) as { input: string[]; rows: { name: string }[] };
    expect(stamp).toEqual({ input: intro.input, names: intro.rows.map((r) => r.name) });
  });
});
