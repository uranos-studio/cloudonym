// 보이지 않는 글자 표본 — 시험 둘(invisible-chars · intake-hand)이 같이 쓴다. 정의(invisible.mjs)에서 뽑는다 — 손으로 고른 목록은 빈 곳을 남긴다
import { INVISIBLE_CLASS } from '../invisible.mjs';

export const INVISIBLE = new RegExp(`[${INVISIBLE_CLASS}]`, 'u');

/** 정의에 드는 코드 포인트의 연속 구간 — 서로게이트(U+D800-DFFF)는 글자가 아니라 건너뛴다 */
function rangesOf(): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let c = 0; c <= 0x10ffff; c++) {
    const hit = (c < 0xd800 || c > 0xdfff) && INVISIBLE.test(String.fromCodePoint(c));
    if (hit && start < 0) start = c;
    if (!hit && start >= 0) { out.push([start, c - 1]); start = -1; }
  }
  if (start >= 0) out.push([start, 0x10ffff]);
  return out;
}
export const RANGES = rangesOf();

/** 재검증이 든 낱글자 — 소프트 하이픈 · 한글 채움 넷 · 몽골 모음 구분 · 이체 선택자 · 결합 자소 결합 금지 · 태그 문자 —
 *  와 예전 대표(RLO · 폭 없는 공백 · DEL · C1 NEL · 아랍 글자 표시 · 방향 격리 · 단어 결합 · BOM · 줄 · 문단 구분) */
export const NAMED = [
  0x00ad, 0x3164, 0x115f, 0x1160, 0xffa0, 0x180e, 0xfe00, 0xfe0f, 0x034f, 0xe0001, 0xe0041, 0xe007f,
  0x202e, 0x200b, 0x007f, 0x0085, 0x061c, 0x2066, 0x2060, 0xfeff, 0x2028, 0x2029,
];
/** 표본 — 낱글자 + 정의의 구간마다 처음 · 끝 글자 */
export const SAMPLE = [...new Set([...NAMED, ...RANGES.flatMap(([a, b]) => [a, b])])].map((c) => String.fromCodePoint(c));
