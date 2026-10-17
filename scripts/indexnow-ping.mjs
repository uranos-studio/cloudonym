#!/usr/bin/env node
// IndexNow 알림 (D120) — 배포된 사이트의 sitemap.xml 에 있는 URL 을 api.indexnow.org 에 한 번에 알린다.
// 쓰임: node scripts/indexnow-ping.mjs <BASE> [KEY]
//   BASE — 배포 사이트의 origin(예: https://example.org). 도메인을 코드에 두지 않으므로 늘 인자로 받는다
//   KEY  — 없으면 wrangler.jsonc vars 의 INDEXNOW_KEY
// 응답 상태를 찍고, 2xx 가 아니면 0 이 아닌 값으로 끝난다
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ENDPOINT = 'https://api.indexnow.org/indexnow';

function fail(msg) {
  console.error(`indexnow-ping: ${msg}`);
  process.exit(1);
}

function keyFromWrangler() {
  const text = readFileSync(join(import.meta.dirname, '..', 'wrangler.jsonc'), 'utf-8');
  return /"INDEXNOW_KEY"\s*:\s*"([^"]*)"/.exec(text)?.[1];
}

const [baseArg, keyArg] = process.argv.slice(2);
if (!baseArg) fail('usage: node scripts/indexnow-ping.mjs <BASE> [KEY]');
let base;
try {
  base = new URL(baseArg);
} catch {
  fail(`not a URL: ${baseArg}`);
}
if (base.protocol !== 'https:' && base.protocol !== 'http:') fail(`not an http(s) URL: ${baseArg}`);
const origin = base.origin;
const key = keyArg ?? keyFromWrangler();
if (!key || !/^[A-Za-z0-9-]{8,128}$/.test(key)) fail('no valid key (argument or wrangler.jsonc vars INDEXNOW_KEY)');

const sitemapRes = await fetch(`${origin}/sitemap.xml`);
if (!sitemapRes.ok) fail(`GET ${origin}/sitemap.xml → ${sitemapRes.status}`);
const xml = await sitemapRes.text();
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const urlList = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => decode(m[1]));
if (urlList.length === 0) fail('sitemap.xml has no <loc>');
// IndexNow 는 host 와 다른 URL 을 거부한다 — 미리 걸러 실수를 알린다
const foreign = urlList.filter((u) => new URL(u).host !== base.host);
if (foreign.length > 0) fail(`sitemap URLs outside ${base.host}: ${foreign.join(', ')}`);

const body = { host: base.host, key, keyLocation: `${origin}/${key}.txt`, urlList };
const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
console.log(`POST ${ENDPOINT} — ${urlList.length} URLs → HTTP ${res.status}`);
if (res.status < 200 || res.status > 299) {
  const text = await res.text().catch(() => '');
  if (text) console.error(text.slice(0, 500));
  process.exit(1);
}
