"""500행 트리 측정 (계획 §7-4 · §15 codex #7) — 시험 전용 규칙 500개(`?fixture=rules500`, DEV 빌드에서만)로 넷을 잰다.

조건: 헤드리스 Chromium · 이 기계 · Vite dev 서버(React 개발 빌드) · 항목마다 새로 불러온 페이지에서 5회 · 중앙값.
먼저 `[data-tree] [data-rule]` 이 500행인지 단언한 뒤 잰다(공허한 측정을 막는다).
  ⑴ 첫 그리기 — 탐색 시작 → 트리 행 500개가 DOM 에 생긴 시각 (performance.now 원점 = 탐색 시작)
  ⑵ 검색 한 글자 — 입력 → 걸러진 행이 반영된 첫 프레임
  ⑶ 전부 펼치기 — 「Expand all」 → 500행이 모두 보이는 첫 프레임
  ⑷ 이름 200개 선택 뒤 문맥 한 글자 수정 — 입력 → 카드 이름이 바뀐 첫 프레임
잠정 허용치는 1,000 · 100 · 500 · 200 ms(계획 §7-4) — 오너가 잰 값을 보고 정한다. 이 스크립트는 넘어도 실패로 끝나지 않고 잰 값만 적는다.

실행(저장소 루트): ① npm run dev -- --host 127.0.0.1 --port 5199 --strictPort
               ② uv run --python 3.12 --with "playwright==1.63.0" python tests/ui/perf.py http://127.0.0.1:5199
"""
import base64
import json
import statistics
import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip('/')
RUNS = 5
CTX = {'owner': 'platform', 'system': 'billing', 'purpose': 'trade', 'env': 'prd', 'region': 'kr'}
LIMITS = {'first_render': 1000, 'search_one_char': 100, 'expand_all': 500, 'context_edit_200_names': 200}


def state_hash(r=None):
    body = {**CTX, 'p': 'azure'}
    if r:
        body['r'] = r
    raw = json.dumps(body, separators=(',', ':'))
    return '#state=' + base64.urlsafe_b64encode(raw.encode()).rstrip(b'=').decode()


# src/dev/fixtureRules.ts 의 입력 종류 순환 — i % 4: 0 · 1 count(VM) · 2 role(관리 ID) · 3 none(Key Vault)
SELECT_200 = {f'fx500_{i:03d}': ('sync' if i % 4 == 2 else 1) for i in range(200)}

WATCH_500 = '''new MutationObserver((_, obs) => {
  if (document.querySelectorAll('[data-tree] [data-rule]').length >= 500) { window.__t500 = performance.now(); obs.disconnect(); }
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
ROWS = "document.querySelectorAll('[data-tree] [data-rule]')"

results = {k: [] for k in LIMITS}
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    ctx.add_init_script(WATCH_500)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    url = BASE + '/?fixture=rules500' + state_hash()
    page.goto(url, wait_until='networkidle')  # 첫 불러오기는 dev 서버의 변환 · 캐시 데우기 — 재지 않는다

    for _ in range(RUNS):
        # 같은 URL(hash 만 다름)은 다시 불러오지 않으므로 쿼리를 바꿔 매번 새로 연다
        page.goto(BASE + f'/?fixture=rules500&run={_}' + state_hash(), wait_until='load')
        page.wait_for_function('window.__t500 !== undefined')
        assert page.locator('[data-tree] [data-rule]').count() == 500
        results['first_render'].append(page.evaluate('window.__t500'))

        # ⑵ 검색 한 글자 — 「7」 이 든 행만 남는다
        results['search_one_char'].append(page.evaluate(TIME_INPUT, ['[data-tree-search]', '7', f'return {ROWS}.length > 0 && {ROWS}.length < 500']))
        n7 = page.locator('[data-tree] [data-rule]').count()
        assert 0 < n7 < 500, n7

    for _ in range(RUNS):
        page.goto(BASE + f'/?fixture=rules500&expand={_}' + state_hash(), wait_until='load')
        page.wait_for_function('window.__t500 !== undefined')
        assert page.locator('[data-tree] [data-rule]').count() == 500
        hidden = page.evaluate(f'[...{ROWS}].filter(e => !e.checkVisibility()).length')
        assert hidden > 0, '처음부터 다 보이면 펼치기를 잰 것이 아니다'
        results['expand_all'].append(page.evaluate(TIME_CLICK, ['[data-expand-all]', f'return [...{ROWS}].every(e => e.checkVisibility())']))

    for _ in range(RUNS):
        page.goto(BASE + f'/?fixture=rules500&edit={_}' + state_hash(SELECT_200), wait_until='load')
        page.wait_for_function('window.__t500 !== undefined')
        assert page.locator('[data-tree] [data-rule]').count() == 500
        page.wait_for_function("document.querySelectorAll('article[data-key]').length === 200")
        assert page.locator('[data-names-summary]').inner_text().startswith('200 resources · 200 names'), page.locator('[data-names-summary]').inner_text()
        # system 은 VM · 관리 ID · Key Vault template 모두에 있다
        results['context_edit_200_names'].append(page.evaluate(TIME_INPUT, ['#field-system', 'billingx', "return document.querySelector('article[data-key] [data-name]').textContent.includes('billingx')"]))
    browser.close()
    assert errors == [], errors

out = {}
for k, vs in results.items():
    med = statistics.median(vs)
    out[k] = {'median_ms': round(med, 1), 'runs_ms': [round(v, 1) for v in vs], 'provisional_limit_ms': LIMITS[k], 'within': med <= LIMITS[k]}
print(json.dumps(out, indent=2))
