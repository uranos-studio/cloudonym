// @ts-check
// 묻기 (D121 · 설계 §5 ⑥(a)) — 번호 목록과 한 줄 답. 의존성 없이 node:readline 만 쓴다(경계: cli/boundary.test.mjs).
// readline 은 terminal:false 로 연다 — 줄 편집 · 되울림 · Ctrl-C 는 터미널(cooked mode)이 맡는다. 답이 화면보다 먼저 와도(붙여 넣기 · 파이프) 줄은 버려지지 않는다(비동기 반복자가 쌓아 둔다)
import { createInterface } from 'node:readline';

/** 답을 더 받을 수 없음(입력이 닫힘 · Ctrl-D) — 아무것도 쓰지 않고 64 로 끝낸다 */
export class NoAnswer extends Error {}

/**
 * @param {NodeJS.ReadableStream} input
 * @param {(s: string) => void} write 줄바꿈 없이 그대로 쓴다
 * @param {boolean} echo 답을 되울린다 — 입력이 터미널이 아닐 때(시험의 주입 스트림). 터미널은 스스로 되울린다
 */
export function createPrompter(input, write, echo) {
  const rl = createInterface({ input, terminal: false, crlfDelay: Infinity });
  const lines = rl[Symbol.asyncIterator]();
  let closed = false;
  /** 물음 하나 → 앞뒤 공백을 뗀 답 @param {string} question */
  async function line(question) {
    write(question);
    const r = closed ? { done: true, value: undefined } : await lines.next();
    if (r.done) { write('\n'); throw new NoAnswer('no answer'); }
    const answer = String(r.value).trim();
    if (echo) write(`${answer}\n`);
    return answer;
  }
  /** 한 줄 알림 @param {string} s */
  const say = (s) => write(`${s}\n`);

  /**
   * 자유 입력 — 비면 다시 묻는다(def 가 있으면 그것)
   * @param {string} q @param {string} [def]
   */
  async function text(q, def) {
    for (;;) {
      const a = await line(def === undefined ? `${q}: ` : `${q} [${def}]: `);
      if (a !== '') return a;
      if (def !== undefined) return def;
      say('  An answer is needed.');
    }
  }

  /** 예/아니오 @param {string} q @param {boolean} def */
  async function yesNo(q, def) {
    for (;;) {
      const a = (await line(`${q} ${def ? '[Y/n]' : '[y/N]'}: `)).toLowerCase();
      if (a === '') return def;
      if (a === 'y' || a === 'yes') return true;
      if (a === 'n' || a === 'no') return false;
      say('  Answer y or n.');
    }
  }

  /** 정수 @param {string} q @param {{ min: number, max: number, def?: number }} o */
  async function number(q, o) {
    for (;;) {
      const a = await line(o.def === undefined ? `${q}: ` : `${q} [${o.def}]: `);
      if (a === '' && o.def !== undefined) return o.def;
      const n = Number(a);
      if (/^\d+$/.test(a) && n >= o.min && n <= o.max) return n;
      say(`  A whole number from ${o.min} to ${o.max}.`);
    }
  }

  /**
   * 목록에서 하나 — 번호나 값(대소문자 무시)으로. 값은 목록의 글자 그대로 돌려준다.
   * def 가 있으면 빈 답이 그것 · optional 이면 빈 답이 undefined(그 뜻을 괄호에 적는다)
   * @param {string} q @param {readonly string[]} values @param {{ def?: string, optional?: string }} [o]
   * @returns {Promise<string | undefined>}
   */
  async function choose(q, values, o = {}) {
    const list = values.map((x, i) => `${i + 1} ${x}`).join(' · ');
    const tail = o.def !== undefined ? ` [${o.def}]` : o.optional ? ` (Enter: ${o.optional})` : '';
    for (;;) {
      const a = await line(`${q} [${list}]${tail}: `);
      if (a === '') {
        if (o.def !== undefined) return o.def;
        if (o.optional) return undefined;
      }
      const byNumber = /^\d+$/.test(a) ? values[Number(a) - 1] : undefined;
      const byValue = values.find((x) => x.toLowerCase() === a.toLowerCase());
      const got = byNumber ?? byValue;
      if (got !== undefined) return got;
      say(`  Pick a number from 1 to ${values.length}, or one of the values.`);
    }
  }

  /**
   * 번호 여럿 — 쉼표 · 공백으로 나눈다. 중복 없이 목록 순서(작은 번호 먼저)로
   * @param {string} q @param {number} max
   * @returns {Promise<number[]>}
   */
  async function numbers(q, max) {
    for (;;) {
      const a = await line(q);
      const parts = a.split(/[\s,]+/).filter((x) => x !== '');
      const nums = parts.map(Number);
      if (parts.length > 0 && parts.every((x) => /^\d+$/.test(x)) && nums.every((n) => n >= 1 && n <= max)) return [...new Set(nums)].sort((x, y) => x - y);
      say(`  Pick one or more numbers from 1 to ${max}, separated by commas.`);
    }
  }

  return {
    line, say, text, yesNo, number, choose, numbers,
    close() { if (!closed) { closed = true; rl.close(); } },
  };
}

/** @typedef {ReturnType<typeof createPrompter>} Prompter */
