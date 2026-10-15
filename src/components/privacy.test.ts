// /privacy 안내 (D56 · D57) — 렌더된 문장이 코드가 하는 일과 같은가. IP 는 「읽지 않는다」가 아니라 「읽어서 제한 키로 넘기고 저장하지 않는다」다.
// 안내의 숫자 · 표가 api 상수(META_KEYS · KV_TTL_SECONDS · RATE_LIMIT)와 같은지는 src/api/privacy-sync.test.ts 가 본다 — 이 폴더의 tsconfig 에는 Workers 타입이 없다
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Privacy } from './Privacy';
import { axiomRetentionText, PRIVACY_AXIOM_RETENTION_DAYS, PRIVACY_BUCKET_CHECK_ORIGIN, PRIVACY_EVENTS, PRIVACY_KV_RETENTION_DAYS, PRIVACY_RATE_LIMIT, PRIVACY_SKIP_HEADER, PRIVACY_WEB_ANALYTICS_DOCS, PRIVACY_WEB_ANALYTICS_ORIGIN } from './privacyModel';
import { VISIT_KEY } from './beacon';
import { INTRO_KEY, THEME_KEY } from './localPrefs';
import { COPY_TARGETS } from './copyTargets';
import { PRIVACY_CONTACT, PRIVACY_LAST_UPDATED } from './privacyModel';
import { SOURCE_REPOSITORY_URL } from './aboutModel';

/** 태그를 벗긴 본문 — 문장 검사는 사람이 읽는 글자로 한다 */
function pageText(): string {
  const html = renderToStaticMarkup(createElement(Privacy));
  return html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
/** 본문 지문 — FNV-1a 32비트. 이 폴더 tsconfig 에는 node 타입이 없어 node:crypto 를 쓰지 않는다 */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
const sentences = (text: string): string[] => text.split(/(?<=\.)\s+/);

describe('/privacy', () => {
  // DocPage 가 돌아가는 링크에 window.location.hash 를 싣는다 — node 에는 window 가 없다
  beforeAll(() => { vi.stubGlobal('window', { location: { hash: '' } }); });
  afterAll(() => { vi.unstubAllGlobals(); });

  it('IP 문장 — 「reads the client IP」 · 「not stored」 가 있고, IP 가 든 문장에 「읽지 않는다」 류가 없다', () => {
    const text = pageText();
    expect(text).toContain('reads the client IP');
    expect(text).toContain('not stored');
    expect(text).toContain('cf-connecting-ip');
    const withIp = sentences(text).filter((s) => /\bIP\b/.test(s));
    expect(withIp.length).toBeGreaterThan(0);
    for (const s of withIp) expect(s, s).not.toMatch(/does not read|never reads|not read/i);
    // 검사기 — 틀린 문장을 넣으면 잡는다
    expect(sentences('Cloudonym does not read the client IP. Fine.').filter((s) => /\bIP\b/.test(s)).some((s) => /does not read|never reads|not read/i.test(s))).toBe(true);
  });
  it('요청 제한 숫자 — 60 requests per 60 seconds', () => {
    expect(pageText()).toContain(`${PRIVACY_RATE_LIMIT.limit} requests per ${PRIVACY_RATE_LIMIT.period} seconds`);
    expect(pageText()).toContain('60 requests per 60 seconds');
  });
  it('보존 — KV 366일 · Axiom 은 데이터셋에 설정한 값', () => {
    expect(PRIVACY_KV_RETENTION_DAYS).toBe(366);
    const text = pageText();
    expect(text).toContain('expire 366 days');
    expect(text).toContain(axiomRetentionText(PRIVACY_AXIOM_RETENTION_DAYS));
    expect(PRIVACY_AXIOM_RETENTION_DAYS).toBe(30);   // Axiom 무료 플랜 최대 · 데이터셋 보존 30일 (2026-10-13 화면 실측)
    expect(text).toContain('Axiom records are kept for 30 days');
    expect(axiomRetentionText(30)).toBe('Axiom records are kept for 30 days, the retention configured on the Axiom dataset. The operator also copies these records regularly to its own storage and keeps each copy for two years; a copy holds the same fields as the record and nothing more.');
    expect(axiomRetentionText(null)).toContain('keeps each copy for two years');
    expect(axiomRetentionText(null)).toContain('retention configured on the Axiom dataset');
    expect(axiomRetentionText(null)).not.toMatch(/\d/);   // 정하지 않은 숫자를 지어내지 않는다
  });
  it('계측 표 — 이벤트 · 필드 · 복사 버튼 여섯 · 방문 가드 키가 다 보인다', () => {
    const text = pageText();
    for (const e of PRIVACY_EVENTS) {
      expect(text, e.event).toContain(e.event);
      for (const f of e.fields) expect(text, f).toContain(f);
    }
    for (const t of COPY_TARGETS) expect(text, t).toContain(t);
    expect(text).toContain(VISIT_KEY);
    expect(text).toContain(INTRO_KEY);
    expect(text).toContain(THEME_KEY);
  });
  it('KV 는 근사치 · 정확한 수는 Axiom · 운영자 점검 요청은 세지 않는다 (D99)', () => {
    const text = pageText();
    expect(text).toContain('The KV counters are approximate');
    expect(text).toContain('the Axiom records are the closer count (one record per event and no per-key write limit; a record that fails to send is lost)');
    expect(text).toContain(`${PRIVACY_SKIP_HEADER} header`);
    expect(text).toContain('neither counted nor sent to Axiom');
    expect(text).not.toMatch(/\{[a-z]\w*\}/);
  });
  it('모으지 않는 것 — 이름 · 다섯 값 · hash · UA 원문 · 쿠키 · 식별자 · never collected', () => {
    const text = pageText();
    expect(text).toContain('never collected');
    for (const w of ['owner', 'system', 'purpose', 'environment', 'region', 'URL hash', 'raw User-Agent', 'cookies', 'identifier']) expect(text, w).toContain(w);
  });
  it('마법사의 고른 리소스 종류 — 규칙 id 만 보내고 입력값은 보내지 않는다 (D71)', () => {
    const text = pageText();
    expect(text).toContain('chip_rules and custom_rules list the rule ids of the resource kinds picked in the wizard');
    expect(text).toContain('never the values you typed');
  });
  it('Workers Logs — 호스팅 제공자로서 요청 메타데이터를 처리할 수 있다 · 로그에는 본문 · 헤더를 쓰지 않는다(오류는 그대로 남는다)', () => {
    const text = pageText();
    expect(text).toContain('As the hosting provider, Cloudflare may process request metadata');
    expect(text).toContain('does not write request bodies or headers to its logs');
    // errors.ts 는 처리하지 못한 예외를 통째로 기록한다 — 시험이 덮지 못하는 「로그에 문맥값이 없다」 단정은 쓰지 않는다
    expect(text).not.toMatch(/carry no context values/);
  });
  it('IP 를 읽는 범위는 요청 제한이 도는 곳과 같다 — POST /v1/ · GET /llms.txt · GET /catalog.json', () => {
    const ip = sentences(pageText()).find((s) => s.includes('reads the client IP'))!;
    for (const w of ['POST request to /v1/', '/llms.txt', '/catalog.json']) expect(ip, w).toContain(w);
  });
  it('버킷 「Check」 — 누를 때만 브라우저가 Google 에 이름을 보내고 Cloudonym 을 거치지 않는다 (D83)', () => {
    const s = sentences(pageText()).find((x) => x.includes('Check button'))!;
    expect(s).toBeDefined();
    for (const w of ['when you click it, and only then', 'sends that bucket name directly to Google Cloud Storage', PRIVACY_BUCKET_CHECK_ORIGIN]) expect(s, w).toContain(w);
    expect(pageText()).toContain('The request does not pass through Cloudonym');
  });
  it('Cloudflare Web Analytics (D110) — 모든 쪽에 스크립트가 붙고 /cdn-cgi/rum 으로 Cloudflare 에 간다 · Cloudflare 문서가 적은 것만 말한다', () => {
    const text = pageText();
    for (const w of ['Web Analytics script', PRIVACY_WEB_ANALYTICS_ORIGIN, 'to every page', '/cdn-cgi/rum', 'does not reach Cloudonym', 'does not collect visitors\' personal data', 'cookies or localStorage', 'does not log query strings', '7 days']) expect(text, w).toContain(w);
    // 링크는 Cloudflare 공식 문서만
    const html = renderToStaticMarkup(createElement(Privacy));
    for (const d of PRIVACY_WEB_ANALYTICS_DOCS) {
      expect(d.href.startsWith('https://developers.cloudflare.com/web-analytics/'), d.href).toBe(true);
      expect(html).toContain(`href="${d.href}"`);
    }
    // 버킷 「Check」 문장은 그대로 남는다 — 브라우저가 Cloudflare 밖의 곳에 직접 묻는 것은 그것 하나다
    expect(text).toContain('The Check button next to a bucket name is the one exception');
  });
  it('AI 에이전트 요청은 ai_agent 일자 카운터에도 하나 더한다(telemetry.ts bump stats:ai_agent_hits)', () => {
    expect(pageText()).toContain('when the client class is ai_agent, one to a daily AI-agent counter as well');
  });
  it('연락 경로 — 질문은 공개 이슈 · 보안은 비공개 취약점 신고 · 이메일 없음', () => {
    const html = renderToStaticMarkup(createElement(Privacy));
    expect(PRIVACY_CONTACT.issues).toBe(`${SOURCE_REPOSITORY_URL}/issues`);
    expect(PRIVACY_CONTACT.security).toBe(`${SOURCE_REPOSITORY_URL}/security/advisories/new`);
    expect(html).toContain(`href="${PRIVACY_CONTACT.issues}"`);
    expect(html).toContain(`href="${PRIVACY_CONTACT.security}"`);
    expect(html).not.toMatch(/mailto:|@[a-z0-9-]+\.[a-z]{2,}/i);
  });
  it('마지막 수정일 — 본문이 바뀌면 지문이 깨진다. 날짜(PRIVACY_LAST_UPDATED)와 아래 지문을 같이 고친다', () => {
    expect(PRIVACY_LAST_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const text = pageText();
    expect(text).toContain(`Last updated: ${PRIVACY_LAST_UPDATED}`);
    const body = text.replace(`Last updated: ${PRIVACY_LAST_UPDATED}`, '');
    const fingerprint = fnv1a(body);
    expect(`${PRIVACY_LAST_UPDATED} ${fingerprint}`).toBe('2026-10-15 bd411c3b');
    // 검사기 — 한 글자만 바뀌어도 지문이 달라진다
    expect(fnv1a(`${body}.`)).not.toBe(fingerprint);
  });
});
