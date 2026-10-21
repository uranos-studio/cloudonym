// @ts-check
// 「혹시 이것?」 제안 — 편집 거리(Levenshtein). 의존성 없이 node 만 쓴다(경계: cli/boundary.test.mjs). 이름 규칙이 아니라 오타를 잡는 글자 비교다

/**
 * 두 글자열의 편집 거리 — 넣기 · 빼기 · 바꾸기 · 이웃 두 글자 맞바꾸기 한 번이 1(optimal string alignment). 맞바꾸기를 1로 세야 gpc → gcp 같은 흔한 오타가 가깝다
 * @param {string} a @param {string} b @returns {number}
 */
export function distance(a, b) {
  if (a === b) return 0;
  /** @type {number[][]} */
  const t = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  const at = (/** @type {number} */ i, /** @type {number} */ j) => /** @type {number} */ (/** @type {number[]} */ (t[i])[j]);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, at(i - 2, j - 2) + 1);
      /** @type {number[]} */ (t[i])[j] = d;
    }
  }
  return at(a.length, b.length);
}

/**
 * 가까운 후보 — 거리가 max 이하인 것만, 가까운 순(같으면 목록 순). 대소문자는 보지 않는다
 * max 를 주지 않으면 글자 수에 맞춘다: 4자 이하 1 · 그 밖 2 (짧은 말은 한 글자만 달라도 다른 말이다)
 * @param {string} word @param {readonly string[]} candidates @param {number} [max]
 * @returns {string[]}
 */
export function closest(word, candidates, max) {
  const w = word.toLowerCase();
  const limit = max ?? (w.length <= 4 ? 1 : 2);
  return candidates
    .map((c, i) => ({ c, i, d: distance(w, c.toLowerCase()) }))
    .filter((x) => x.d <= limit)
    .sort((x, y) => x.d - y.d || x.i - y.i)
    .map((x) => x.c);
}
