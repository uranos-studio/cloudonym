"""트리 성능 측정 — 두 패스로 넷을 재고, 허용치를 넘으면 non-zero 로 끝난다.

패스 ① fixture — 시험 전용 규칙 500개(`?fixture=rules500`, DEV 빌드에서만) · GCP.
패스 ② 실제 규칙 — fixture 없이 켜진 CSP(화면 ① 에서 고를 수 있는 것) 중 트리 행이 가장 많은 CSP. 행 수는 적어 두지 않고 그 자리에서 잰다(규칙은 늘어난다).
켜진 CSP 는 화면의 버튼(꺼진 것은 disabled)에서 읽는다 — 꺼진 CSP 링크는 화면이 켜진 CSP 로 바꿔 열기 때문이다(D45 · D55).
조건: 헤드리스 Chromium · 이 기계 · Vite dev 서버(React 개발 빌드) · 항목마다 새로 불러온 페이지에서 5회 · 중앙값.
먼저 `[data-tree] [data-rule]` 이 기대한 행 수인지 단언한 뒤 잰다(공허한 측정을 막는다).
  ⑴ 첫 그리기 — 탐색 시작 → 트리 행 N 개가 DOM 에 생긴 시각 (performance.now 원점 = 탐색 시작)
  ⑵ 검색 한 글자 — 입력 → 걸러진 행이 반영된 첫 프레임
  ⑶ 전부 펼치기 — 「Expand all」 → N 행이 모두 보이는 첫 프레임
  ⑷ 이름 200개(상한까지) 선택 뒤 문맥 한 글자 수정 — 입력 → 카드 이름이 바뀐 첫 프레임
     fixture 는 앞 200개를 hash 로 고른다. 실제 규칙은 펼친 트리에서 상한에 닿을 때까지 체크해 그 hash 를 잡아 쓴다
허용치는 1,000 · 100 · 500 · 200 ms — 어느 패스든 중앙값이 하나라도 넘으면 JSON 을 적은 뒤 exit 1 이다.
`CLOUDONYM_PERF_SCALE`(기본 1)을 곱해 허용치를 줄이면 검사기가 실제로 실패하는지 볼 수 있다(예: 0.001).

실행(저장소 루트): ① npm run dev -- --host 127.0.0.1 --port 5199 --strictPort
               ② uv run --python 3.12 --with "playwright==1.63.0" python tests/ui/perf.py http://127.0.0.1:5199
"""
import base64
import json
import os
import statistics
import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip('/')
RUNS = 5
CTX = {'owner': 'platform', 'system': 'billing', 'purpose': 'trade', 'env': 'prd', 'region': 'kr'}
SCALE = float(os.environ.get('CLOUDONYM_PERF_SCALE', '1'))
LIMITS = {k: v * SCALE for k, v in {'first_render': 1000, 'search_one_char': 100, 'expand_all': 500, 'context_edit_200_names': 200}.items()}


def state_hash(provider, r=None):
    body = {**CTX, 'p': provider}
    if r:
        body['r'] = r
    raw = json.dumps(body, separators=(',', ':'))
    return '#state=' + base64.urlsafe_b64encode(raw.encode()).rstrip(b'=').decode()


# src/dev/fixtureRules.ts 의 입력 종류 순환 — i % 4: 0 · 1 count(VM) · 2 role(서비스 계정) · 3 none(버킷)
SELECT_200 = {f'fx500_{i:03d}': ('sync' if i % 4 == 2 else 1) for i in range(200)}

# 행 수 N 은 탐색마다 window.__rowsWant 로 넘긴다(init script 는 페이지마다 다시 돈다)
WATCH_ROWS = '''new MutationObserver((_, obs) => {
  const want = Number(sessionStorage.getItem('__rowsWant') || 0);
  if (want > 0 && document.querySelectorAll('[data-tree] [data-rule]').length >= want) { window.__tRows = performance.now(); obs.disconnect(); }
}).observe(document, { childList: true, subtree: true });'''

# 입력 → 조건이 처음 참인 프레임까지. React 의 제어 입력은 네이티브 setter + input 이벤트로 바꾼다
TIME_INPUT = '''async ([sel, value, cond]) => {
  const el = document.querySelector(sel);
  const check = new Function(cond);
  const t0 = performance.now();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  while (!check()) await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));
  return performance.now() - t0;
}'''
TIME_CLICK = '''async ([sel, cond]) => {
  const check = new Function(cond);
  const t0 = performance.now();
  document.querySelector(sel).click();
  while (!check()) await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));
  return performance.now() - t0;
}'''
# 펼친 트리에서 상한에 닿을 때까지 체크 — 체크 상자 하나마다 이벤트 하나(React 가 렌더를 마친 뒤 다음 것)
SELECT_TO_CAP = '''async () => {
  document.querySelector('[data-expand-all]').click();
  await new Promise((r) => requestAnimationFrame(r));
  for (;;) {
    const box = [...document.querySelectorAll('[data-tree] input[data-row-check]')].find((b) => !b.checked && !b.disabled);
    if (!box) break;
    box.click();
    await new Promise((r) => setTimeout(r, 0));
  }
  return location.hash;
}'''
ROWS = "document.querySelectorAll('[data-tree] [data-rule]')"
CARDS = "document.querySelectorAll('article[data-key]')"


def open_page(page, url, rows):
    page.evaluate('n => sessionStorage.setItem("__rowsWant", String(n))', rows)
    page.goto(url, wait_until='load')
    page.wait_for_function('window.__tRows !== undefined')
    assert page.locator('[data-tree] [data-rule]').count() == rows


def measure(page, query, provider, rows, selected_hash):
    """한 패스 — query 는 `fixture=rules500` 또는 빈 값. selected_hash 는 ⑷ 의 상태"""
    sep = f'{query}&' if query else ''
    res = {k: [] for k in LIMITS}
    for i in range(RUNS):
        # 같은 URL(hash 만 다름)은 다시 불러오지 않으므로 쿼리를 바꿔 매번 새로 연다
        open_page(page, BASE + f'/?{sep}run={i}' + state_hash(provider), rows)
        res['first_render'].append(page.evaluate('window.__tRows'))
        # ⑵ 검색 한 글자 — 「7」 이 든 행만 남는다(fixture) · 실제 규칙은 「a」
        ch = '7' if query else 'a'
        res['search_one_char'].append(page.evaluate(TIME_INPUT, ['[data-tree-search]', ch, f'return {ROWS}.length > 0 && {ROWS}.length < {rows}']))
        n = page.locator('[data-tree] [data-rule]').count()
        assert 0 < n < rows, n

    for i in range(RUNS):
        open_page(page, BASE + f'/?{sep}expand={i}' + state_hash(provider), rows)
        hidden = page.evaluate(f'[...{ROWS}].filter(e => !e.checkVisibility()).length')
        assert hidden > 0, '처음부터 다 보이면 펼치기를 잰 것이 아니다'
        res['expand_all'].append(page.evaluate(TIME_CLICK, ['[data-expand-all]', f'return [...{ROWS}].every(e => e.checkVisibility())']))

    cards = None
    for i in range(RUNS):
        open_page(page, BASE + f'/?{sep}edit={i}' + selected_hash, rows)
        page.wait_for_function(f'{CARDS}.length > 0')
        cards = page.locator('article[data-key]').count()
        summary = page.locator('[data-names-summary]').inner_text()
        assert f'· {cards} names' in summary, summary
        # system 은 VM · 관리 ID · Key Vault template 모두에 있다 — 실제 규칙도 system 이 든 카드 하나가 바뀌면 잰다
        res['context_edit_200_names'].append(page.evaluate(TIME_INPUT, ['#field-system', 'billingx', f"return [...{CARDS}].some(a => a.querySelector('[data-name]').textContent.includes('billingx'))"]))
    return res, cards


def summarize(res):
    out = {}
    for k, vs in res.items():
        med = statistics.median(vs)
        out[k] = {'median_ms': round(med, 1), 'runs_ms': [round(v, 1) for v in vs], 'limit_ms': LIMITS[k], 'within': med <= LIMITS[k]}
    return out


report = {}
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    ctx.add_init_script(WATCH_ROWS)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE + '/?fixture=rules500' + state_hash('gcp'), wait_until='networkidle')  # dev 서버의 변환 · 캐시 데우기 — 재지 않는다

    res, cards = measure(page, 'fixture=rules500', 'gcp', 500, state_hash('gcp', SELECT_200))
    assert cards == 200, cards
    report['fixture_rules500'] = {'provider': 'gcp', 'rows': 500, 'cards': cards, **summarize(res)}

    # 실제 규칙 — 켜진 CSP 마다 행 수를 재고 가장 큰 트리를 쓴다
    sizes = {}
    enabled = page.eval_on_selector_all('[role="radio"]:not([disabled])', 'els => els.map(e => e.dataset.cloud)')
    assert enabled, '켜진 CSP 가 없다'
    for prov in enabled:
        page.goto(BASE + f'/?size={prov}' + state_hash(prov), wait_until='networkidle')
        sizes[prov] = page.locator('[data-tree] [data-rule]').count()
    prov = max(sizes, key=sizes.get)
    rows = sizes[prov]
    assert rows > 0 and rows != 500, sizes
    page.goto(BASE + '/?pick=1' + state_hash(prov), wait_until='networkidle')
    picked_hash = page.evaluate(SELECT_TO_CAP)
    res, cards = measure(page, '', prov, rows, picked_hash)
    assert cards and cards >= 150, f'상한까지 고른 이름이 {cards} 개 — ⑷ 가 공허하다'
    report['real_rules'] = {'provider': prov, 'rows': rows, 'rows_by_provider': sizes, 'cards': cards, **summarize(res)}
    browser.close()
    assert errors == [], errors

print(json.dumps(report, indent=2))
over = [f'{pass_}.{k}' for pass_, r in report.items() for k, v in r.items() if isinstance(v, dict) and 'within' in v and not v['within']]
if over:
    print('허용치를 넘었다:', ', '.join(over), file=sys.stderr)
    sys.exit(1)
