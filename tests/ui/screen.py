"""화면 시험 — Playwright(Python) 로 시나리오 ⑴~⑼를 재고 스크린샷을 남긴다 (개발 3단계 Task 3-4 · 문구 코드화 T5).

화면 문구는 영어 사전(src/messages/en.ts)이 정본이다 — 아래 기대 문자열은 그 사전의 문장이다.
스크린샷에는 중립 예시 값만 쓴다(INPUT · OTHER · 기호만 든 system).

실행(저장소 루트) — 터미널 둘:
  ① npm run dev -- --port 5199 --strictPort
  ② uv run --python 3.12 --with "playwright==1.63.0" python tests/ui/screen.py http://localhost:5199 docs/screenshots

①이 뜬 뒤(`curl -s http://localhost:5199/v1/health` → {"ok":true}) ②를 돌리고, 끝나면 ①을 멈춘다.
서버를 띄우고 내리는 일을 한 번에 하려면 Anthropic webapp-testing 스킬의 with_server.py 를 쓸 수 있다
(`python3 path/to/with_server.py --server "npm run dev -- --port 5199 --strictPort" --port 5199 -- <② 명령>`).

playwright 는 1.63.0 으로 고정한다 — 다른 버전은 맞는 Chromium 을 새로 받아야 한다(`uv run --with "playwright==1.63.0" playwright install chromium`).
단언이 하나라도 틀리면 non-zero 로 끝난다(실패를 성공으로 보고하지 않는다).
"""
import base64
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import Error, expect, sync_playwright

BASE = sys.argv[1].rstrip('/')
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)

# ⑴ 의 입력 — 기본값(platform · billing · trade)과 달라야 시험이 공허하지 않다. SA 원본 37자 → region 생략 → owner 생략 (엔진 실측)
INPUT = {'owner': 'devops', 'system': 'payments', 'purpose': 'ledger', 'env': 'prd', 'region': 'kr'}
SA = '[data-rule="gcp.service_account"]'
# 같은 탭 공유 URL 이동(I-2)의 입력 — INPUT 과 다섯 값이 모두 다르다
OTHER = {'owner': 'infra', 'system': 'billing', 'purpose': 'batch', 'env': 'stg', 'region': 'jp'}


# 옛 규칙 버전 — 지금 버전(/v1/health 의 version.rules)과 다른, 꼴이 맞는 값 (D27 ⑵)
OLD_RULES = '2000-01-01.1'


def state_hash(ctx, v=None):
    """encodeState 와 같은 꼴 — 고정 순서 JSON(공백 없음) · v 는 마지막 키 · UTF-8 · Base64url · 패딩 없음"""
    body = {k: ctx[k] for k in ('owner', 'system', 'purpose', 'env', 'region')}
    if v is not None:
        body['v'] = v
    raw = json.dumps(body, separators=(',', ':'), ensure_ascii=False)
    return '#state=' + base64.urlsafe_b64encode(raw.encode()).rstrip(b'=').decode()


def hash_state(hash_or_url):
    """`…#state=…` → JSON 객체 (시험이 v 를 읽는다)"""
    enc = hash_or_url.split('#state=', 1)[1]
    return json.loads(base64.urlsafe_b64decode(enc + '=' * (-len(enc) % 4)).decode())


# select 의 선택지 글자가 상자 안에 다 들어가는가 — select 는 scrollWidth 가 넘침을 드러내지 않아 글자 폭을 canvas 로 잰다
# 쓸 수 있는 폭 = clientWidth - 좌우 padding - 화살표 몫 24px
SELECT_FIT_JS = '''() => {
  const ctx = document.createElement('canvas').getContext('2d');
  const out = [];
  for (const sel of document.querySelectorAll('#field-env, #field-region')) {
    const cs = getComputedStyle(sel);
    ctx.font = cs.font;
    const avail = sel.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 24;
    for (const o of sel.options) {
      const w = ctx.measureText(o.text).width;
      if (w > avail) out.push(`${sel.id} 「${o.text}」 ${w.toFixed(1)}px > ${avail.toFixed(1)}px`);
    }
  }
  return out;
}'''


def assert_selects_fit(page, width):
    clipped = page.evaluate(SELECT_FIT_JS)
    assert clipped == [], f'폭 {width}px 에서 select 글자가 잘린다: {clipped}'


def goto_ready(page, url):
    """dev 서버는 포트가 열린 뒤에도 잠깐 연결을 끊는다 — 60초 안에서 다시 시도한다"""
    deadline = time.time() + 60
    while True:
        try:
            page.goto(url, wait_until='networkidle')
            return
        except Error:
            if time.time() > deadline:
                raise
            time.sleep(1)


def events_of(page):
    """POST /v1/events 본문을 모은다 — D17 의 「1회 · 디바운스」 증거"""
    sent = []
    page.on('request', lambda r: sent.append(json.loads(r.post_data or '{}').get('event')) if r.url.endswith('/v1/events') and r.method == 'POST' else None)
    return sent


def fill_five(page, ctx):
    for key in ('owner', 'system', 'purpose'):
        page.fill(f'#field-{key}', ctx[key])
    page.select_option('#field-env', ctx['env'])
    page.select_option('#field-region', ctx['region'])


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    errors = []

    # ── ⑴ 다섯 입력 → GCP SA 카드에 축약 안내 · 비콘 수 · 키보드 탭 · 스크린샷 ──
    ctx1 = browser.new_context(viewport={'width': 1280, 'height': 900})
    ctx1.grant_permissions(['clipboard-read', 'clipboard-write'], origin=BASE)
    page = ctx1.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    sent = events_of(page)
    goto_ready(page, BASE + '/')
    VERSION = page.request.get(BASE + '/v1/health').json()['version']
    RULES = VERSION['rules']
    assert RULES != OLD_RULES, RULES
    expect(page.locator('h1')).to_have_text('Cloudonym')
    assert page.evaluate('document.documentElement.lang') == 'en'
    # PASS 뜻 한 줄(D28) · 버전 꼬리말(D26) · 링크가 없으면 규칙 버전 안내도 없다
    expect(page.locator('[data-pass-meaning]')).to_contain_text('It does not mean the name is available')
    expect(page.locator('[data-pass-meaning]')).to_contain_text('Generated names are not guaranteed unique')
    expect(page.locator('[data-version]')).to_have_text(f"Engine {VERSION['engine']} · rules {RULES}")
    expect(page.locator('[data-rules-mismatch]')).to_have_count(0)
    fill_five(page, INPUT)
    sa = page.locator(SA)
    expect(sa.locator('[data-name]')).to_have_text('payments-ledger-prd-sa-sync')
    expect(sa.locator('[data-steps]')).to_contain_text("Shortened — Dropped optional token 'region' · Dropped optional token 'owner' (originally 37 characters)")
    expect(sa).to_have_attribute('data-valid', 'true')
    expect(sa).to_contain_text('PASS')
    expect(page.locator('[data-rule="azure.storage_account"] [data-name]')).to_have_text('stpaymentsledgerprd')
    page.wait_for_timeout(1500)  # 디바운스 1초 뒤에 ui_generate 가 한 번
    assert sent.count('ui_visit') == 1, f'ui_visit 이 {sent.count("ui_visit")}회 — StrictMode 이중 effect 를 sessionStorage 가드가 막아야 한다: {sent}'
    assert sent.count('ui_generate') == 1, f'ui_generate 가 {sent.count("ui_generate")}회 — 다섯 입력을 1초 디바운스로 한 번이어야 한다: {sent}'
    # 키보드 탭 — 선택된 탭에 포커스 → ArrowRight → 다음 탭이 선택되고 패널이 그 CSP 만 보인다
    page.locator('[role="tab"][aria-selected="true"]').focus()
    page.keyboard.press('ArrowRight')
    expect(page.locator('#tab-aws')).to_have_attribute('aria-selected', 'true')
    expect(page.locator('#tab-aws')).to_be_focused()
    expect(page.locator('[data-provider]')).to_have_count(1)
    page.keyboard.press('ArrowLeft')
    expect(page.locator('#tab-all')).to_have_attribute('aria-selected', 'true')
    expect(page.locator('[data-provider]')).to_have_count(3)
    assert_selects_fit(page, 1280)
    page.screenshot(path=str(OUT / '01-desktop-light.png'), full_page=True)
    share_url = page.url
    assert '#state=' in share_url, share_url
    assert hash_state(share_url).get('v') == RULES, hash_state(share_url)
    # 화면에 시스템 문구 한글 0 — 입력이 ASCII 라 보이는 글자에 한글이 있으면 시스템 문구다
    body_text = page.inner_text('body')
    assert not any('\uac00' <= ch <= '\ud7a3' or '\u3131' <= ch <= '\u318e' for ch in body_text), body_text

    # ── ⑸ Terraform 복사 → 클립보드가 locals { 로 시작 · 태그 JSON · 이름 복사 ──
    page.click('[data-copy="terraform"]')
    hcl = page.evaluate('navigator.clipboard.readText()')
    # 첫 줄 주석 둘 — 엔진 · 규칙 버전과 PASS 뜻 (D26) — 그 다음 locals {
    head = hcl.split('\n')
    assert head[0] == f"# Generated by Cloudonym — engine {VERSION['engine']} · rules {RULES}", head[:3]
    assert head[1].startswith('# PASS means') and head[2] == 'locals {', head[:3]
    assert '  gcp_service_account = "payments-ledger-prd-sa-sync"\n' in hcl, hcl
    assert '  gcp_labels = {\n' in hcl and 'INVALID' not in hcl, hcl
    page.click('[data-copy="tags-json"]')
    copied_tags = json.loads(page.evaluate('navigator.clipboard.readText()'))
    # { version, labels } 로 감싼다 (D26)
    assert copied_tags['version'] == VERSION, copied_tags['version']
    tags = copied_tags['labels']
    assert tags['gcp'] == {'owner': 'devops', 'system': 'payments', 'purpose': 'ledger', 'environment': 'prd', 'managed_by': 'cloudonym'}, tags
    assert set(tags) == {'aws', 'gcp', 'azure'}, list(tags)
    page.click(f'{SA} [data-copy="name:gcp.service_account"]')
    assert page.evaluate('navigator.clipboard.readText()') == 'payments-ledger-prd-sa-sync'
    # 공유 URL 복사 — 버튼이 넣는 값이 지금 주소와 같다
    page.click('[data-copy="share-url"]')
    copied_url = page.evaluate('navigator.clipboard.readText()')
    assert copied_url == share_url, (copied_url, share_url)

    # ── ⑵ 공유 URL 을 새 탭(새 컨텍스트 = 빈 sessionStorage)에 붙이면 같은 입력이 복원된다 ──
    ctx2 = browser.new_context(viewport={'width': 1280, 'height': 900})
    page2 = ctx2.new_page()
    page2.on('pageerror', lambda e: errors.append(str(e)))
    sent2 = events_of(page2)
    goto_ready(page2, copied_url)
    for key, val in INPUT.items():
        expect(page2.locator(f'#field-{key}')).to_have_value(val)
    expect(page2.locator(f'{SA} [data-name]')).to_have_text('payments-ledger-prd-sa-sync')
    page2.wait_for_timeout(1300)
    assert sent2 == ['ui_visit'], f'복원 로드는 ui_visit 1회뿐이어야 한다(첫 화면은 ui_generate 를 세지 않는다): {sent2}'
    ctx2.close()

    # ── ⑹ 같은 탭에서 공유 URL 로 이동(hash 만 바뀐다) → 폼이 따라온다 · ui_generate 를 세지 않는다 · 깨진 hash 는 지금 상태로 되돌린다 (I-2) ──
    generated_before = sent.count('ui_generate')
    other_hash = state_hash(OTHER)
    page.evaluate('h => { location.hash = h; }', other_hash)
    for key, val in OTHER.items():
        expect(page.locator(f'#field-{key}')).to_have_value(val)
    expect(page.locator(f'{SA} [data-name]')).not_to_have_text('payments-ledger-prd-sa-sync')
    page.wait_for_timeout(1300)
    assert sent.count('ui_generate') == generated_before, f'hash 이동 복원이 ui_generate 를 셌다: {sent}'
    assert page.evaluate('location.hash') == other_hash, (page.evaluate('location.hash'), other_hash)
    page.evaluate("() => { location.hash = '#state=!!!'; }")
    page.wait_for_function('h => location.hash === h', arg=other_hash)
    expect(page.locator('#field-owner')).to_have_value(OTHER['owner'])
    fill_five(page, INPUT)
    expect(sa.locator('[data-name]')).to_have_text('payments-ledger-prd-sa-sync')

    # ── ⑺ 라벨 한도 위반(GCP 63자) → 태그 JSON 복사 비활성 + 이유 문구 · Terraform 은 INVALID 주석으로 복사된다 (I-1) ──
    page.fill('#field-owner', 'o' * 70)
    expect(page.locator('[data-copy="tags-json"]')).to_be_disabled()
    expect(page.locator('[data-json-blocked]')).to_be_visible()
    expect(page.locator('[data-copy="terraform"]')).to_be_enabled()
    page.fill('#field-owner', INPUT['owner'])
    expect(page.locator('[data-copy="tags-json"]')).to_be_enabled()
    expect(page.locator('[data-json-blocked]')).to_have_count(0)

    # ── ⑶ 깨진 hash 로 열어도 화면이 뜨고 기본값으로 간다 (Review Focus 4) ──
    for broken in ('#state=!!!', '#state=' + 'eyJvd25lciI6NDJ9', '#state=', '#state=W10'):  # !!! · {"owner":42} · 빈 값 · []
        ctx3 = browser.new_context(viewport={'width': 1280, 'height': 900})
        page3 = ctx3.new_page()
        page3.on('pageerror', lambda e: errors.append(str(e)))
        goto_ready(page3, BASE + '/' + broken)
        expect(page3.locator('h1')).to_have_text('Cloudonym')
        expect(page3.locator('#field-owner')).to_have_value('platform')
        expect(page3.locator('[data-rule="gcp.service_account"] [data-name]')).to_have_text('billing-trade-prd-sa-sync')
        # 깨진 hash 는 기본 상태의 hash 로 바뀐다 — 다시 공유해도 깨진 값이 퍼지지 않는다
        assert page3.evaluate('location.hash').startswith('#state=eyJ'), page3.evaluate('location.hash')
        ctx3.close()

    # ── ⑷ 정제 뒤 빈 토큰 → FAIL 카드 · 복사 버튼 비활성 · Terraform 은 INVALID 주석 ──
    # 한글 입력(매매)도 같은 FAIL 이다 — 먼저 확인하고, 공개 스크린샷은 기호만 든 ASCII 입력(###)으로 찍는다
    page.fill('#field-system', '매매')
    expect(sa).to_have_attribute('data-valid', 'false')
    expect(sa.locator('[data-violations]')).to_contain_text("Required token 'system' is empty after normalisation")
    page.fill('#field-system', '###')
    expect(sa).to_have_attribute('data-valid', 'false')
    expect(sa).to_contain_text('FAIL')
    expect(sa.locator('[data-violations]')).to_contain_text("Required token 'system' is empty after normalisation")
    expect(sa.locator('[data-name]')).to_have_text('—')
    # 정제 뒤 빈 값의 변환 줄(「'system' normalised from '###' to ''」)은 숨긴다 — 위반 이유가 이미 말한다 (M-2)
    expect(sa.locator('[data-steps]')).to_have_count(0)
    assert 'normalised from' not in sa.inner_text(), sa.inner_text()
    expect(sa.locator('button[data-copy]')).to_be_disabled()
    expect(page.locator('[data-provider="gcp"] [data-pass-count]')).to_have_text('0/7 PASS')
    page.click('[data-copy="terraform"]')
    hcl_bad = page.evaluate('navigator.clipboard.readText()')
    assert "  # INVALID: gcp_service_account — Required token 'system' is empty after normalisation\n" in hcl_bad, hcl_bad
    assert 'gcp_service_account =' not in hcl_bad
    sa.scroll_into_view_if_needed()
    page.screenshot(path=str(OUT / '04-fail-card.png'), full_page=False)

    # ── 폭 360px · 다크 모드 스크린샷 (가로 스크롤 없음) ──
    page.fill('#field-system', INPUT['system'])
    page.set_viewport_size({'width': 360, 'height': 800})
    page.wait_for_timeout(300)
    assert page.evaluate('document.documentElement.scrollWidth') <= 360, page.evaluate('document.documentElement.scrollWidth')
    assert_selects_fit(page, 360)
    page.screenshot(path=str(OUT / '02-mobile-360.png'), full_page=True)
    ctx1.close()

    dark = browser.new_context(viewport={'width': 1280, 'height': 900}, color_scheme='dark')
    page4 = dark.new_page()
    goto_ready(page4, share_url)
    expect(page4.locator(f'{SA} [data-name]')).to_have_text('payments-ledger-prd-sa-sync')
    bg = page4.evaluate('getComputedStyle(document.body).backgroundColor')
    assert bg not in ('rgb(255, 255, 255)', 'rgba(0, 0, 0, 0)'), f'다크 모드 배경이 아니다: {bg}'
    page4.screenshot(path=str(OUT / '03-desktop-dark.png'), full_page=True)
    dark.close()

    # ── ⑻ 옛 v 링크 → 안내 · 새로고침해도 안내와 옛 v 가 남는다 · Share URL 은 지금 버전 · 폼을 고치면 안내가 사라지고 v 가 지금 버전 (D27 ⑵) ──
    ctx8 = browser.new_context(viewport={'width': 1280, 'height': 900})
    ctx8.grant_permissions(['clipboard-read', 'clipboard-write'], origin=BASE)
    page8 = ctx8.new_page()
    page8.on('pageerror', lambda e: errors.append(str(e)))
    old_hash = state_hash(INPUT, OLD_RULES)
    goto_ready(page8, BASE + '/' + old_hash)
    notice = page8.locator('[data-rules-mismatch]')
    expect(notice).to_have_text(f'This link was made with rules {OLD_RULES}; the current rules are {RULES}. Names may differ.')
    for key, val in INPUT.items():
        expect(page8.locator(f'#field-{key}')).to_have_value(val)
    page8.wait_for_timeout(300)
    assert page8.evaluate('location.hash') == old_hash, page8.evaluate('location.hash')
    page8.reload(wait_until='networkidle')
    expect(notice).to_be_visible()
    assert page8.evaluate('location.hash') == old_hash, page8.evaluate('location.hash')
    page8.click('[data-copy="share-url"]')
    shared = page8.evaluate('navigator.clipboard.readText()')
    assert hash_state(shared) == {**INPUT, 'v': RULES}, hash_state(shared)
    assert page8.evaluate('location.hash') == old_hash, '공유 버튼이 주소창의 옛 v 를 바꾸면 안 된다'
    page8.fill('#field-purpose', 'batch')
    expect(notice).to_have_count(0)
    page8.wait_for_function('h => location.hash !== h', arg=old_hash)
    assert hash_state(page8.url) == {**INPUT, 'purpose': 'batch', 'v': RULES}, hash_state(page8.url)

    # ── ⑼ 같은 탭에서 옛 v hash 로 이동 → 안내가 보이고 폼이 따라온다 ──
    other_old = state_hash(OTHER, OLD_RULES)
    page8.evaluate('h => { location.hash = h; }', other_old)
    expect(notice).to_be_visible()
    for key, val in OTHER.items():
        expect(page8.locator(f'#field-{key}')).to_have_value(val)
    page8.wait_for_timeout(300)
    assert page8.evaluate('location.hash') == other_old, page8.evaluate('location.hash')
    ctx8.close()
    browser.close()

    assert errors == [], errors
    print('OK — 시나리오 ⑴~⑼ 통과 · 비콘', sent, '· 스크린샷', sorted(p.name for p in OUT.glob('*.png')))
