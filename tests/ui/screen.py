"""화면 시험 — Playwright(Python) 로 네 단계 트리 화면(D42)의 시나리오 ⑴~⒆ · ⒇~㉙ 와 마법사(D59 · D67 · D68 · D73 · D74 · D75 · D82 · D83 · D84~D90 · D93)의 ㉚~㊼ ·
화면 모드(D94)의 ㊽, 첫 방문(D97)의 ㊾ ㊿, API 안내 화면(D98)의 (51), 계획 파일(D100)의 (52), 머리 More 메뉴(D104 · 폰은 D105)의 (53), 첫 방문 예시 · 이름 막대(D108)의 (54), /about 쪽 · 폰 막대의 짧은 글(D109)의 (55) 를 재고 스크린샷을 남긴다.
머리 밖에는 Share URL · Save plan · More · 화면 모드만 있다 — Open plan · 화면 전환 · Naming guide · API · llms.txt · About 은 More 메뉴 안이라 누르기 전에 open_more 로 연다(D104).
링크 없는 첫 화면은 예시 계획이다(D108) — goto_ready 가 「Clear」 를 눌러 D97 의 빈 첫 화면으로 시작하고(예시를 보는 시나리오만 sample=True),
예시 값으로 채운 첫 화면을 전제한 시나리오는 start_example 로 값 넷을 채우고 「Next」 를 눌러 시작한다.
켜진 CSP 는 GCP 하나다(D45) — AWS · Azure 버튼은 「Coming soon」 으로 꺼져 있고 GCP 가 자동으로 골라진다. 시나리오는 GCP 위에서 돈다.

화면 문구는 영어 사전(src/messages/en.ts)이 정본이다 — 아래 기대 문자열은 그 사전의 문장이다.
스크린샷에는 중립 예시 값만 쓴다(INPUT · OTHER · 기호만 든 system).
⒃ · ⒆ 는 시험 전용 fixture(`?fixture=conflict` · `?fixture=rules500`)를 쓴다 — DEV 빌드(npm run dev)에서만 열린다.

실행(저장소 루트) — 터미널 둘:
  ① npm run dev -- --host 127.0.0.1 --port 5199 --strictPort
  ② uv run --python 3.12 --with "playwright==1.63.0" python tests/ui/screen.py http://127.0.0.1:5199 docs/screenshots

①이 뜬 뒤(`curl -s http://127.0.0.1:5199/v1/health` → {"ok":true}) ②를 돌리고, 끝나면 ①을 멈춘다.
500행 성능 측정은 tests/ui/perf.py 다(같은 서버).

playwright 는 1.63.0 으로 고정한다 — 다른 버전은 맞는 Chromium 을 새로 받아야 한다(`uv run --with "playwright==1.63.0" playwright install chromium`).
단언이 하나라도 틀리면 non-zero 로 끝난다(실패를 성공으로 보고하지 않는다).
"""
import base64
import json
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import Error, expect, sync_playwright

BASE = sys.argv[1].rstrip('/')
OUT = Path(sys.argv[2])
# 트리 화면의 경로 (D68 · D76) — 뿌리 `/` 는 늘 마법사이고, 트리 꼴 hash 로 뿌리를 열면 `/pick` 으로 옮겨 간다(㊱)
TREE = '/pick'
OUT.mkdir(parents=True, exist_ok=True)

# ⑴ 의 입력 — 기본값(platform · billing · trade · asia-northeast3)과 달라야 시험이 공허하지 않다. SA 원본 40자 → region 생략 → owner 생략 (엔진 실측)
# region 은 hash 에 싣는 꼴(리전 코드 — urlState.encodeState)이다. 폼의 리전 콤보박스에는 리전 이름이 보인다(REGION_FORM) — 존은 이름에 들지 않는다(D50 revised)
INPUT = {'owner': 'devops', 'system': 'payments', 'purpose': 'ledger', 'env': 'prod', 'region': 'euw1'}
# 같은 탭 공유 URL 이동의 입력 — INPUT 과 다섯 값이 모두 다르다
OTHER = {'owner': 'infra', 'system': 'billing', 'purpose': 'batch', 'env': 'stg', 'region': 'ane1'}
# hash 의 지역 코드 → 폼의 리전 이름
REGION_FORM = {'euw1': 'europe-west1', 'ane1': 'asia-northeast1', 'ane3': 'asia-northeast3'}
# 첫 화면 · 깨진 hash · 꺼진 CSP 링크의 문맥 (R0 · D55)
DEFAULT = {'owner': 'platform', 'system': 'billing', 'purpose': 'trade', 'env': 'prod', 'region': 'ane3'}
# ⑾ 에서 고르는 GCP 선택 — 트리 순서(Global namespace → Project)
PICK = {'project_id': 1, 'storage_bucket': 1, 'service_account': 'db', 'compute_instance': 2}

# 옛 규칙 버전 — 지금 버전(/v1/health 의 version.rules)과 다른, 꼴이 맞는 값 (D27 ⑵)
OLD_RULES = '2000-01-01.1'

SA_CARD = 'article[data-key="service_account_sync"]'
VM1 = 'article[data-key="compute_instance_01"]'


def state_hash(ctx, v=None, p=None, r=None):
    """encodeState 와 같은 꼴 — 고정 순서 JSON(공백 없음) · v · p · r 순서 · UTF-8 · Base64url · 패딩 없음"""
    body = {k: ctx[k] for k in ('owner', 'system', 'purpose', 'env', 'region')}
    if v is not None:
        body['v'] = v
    if p is not None:
        body['p'] = p
        if r:
            body['r'] = r
    raw = json.dumps(body, separators=(',', ':'), ensure_ascii=False)
    return '#state=' + base64.urlsafe_b64encode(raw.encode()).rstrip(b'=').decode()


def hash_state(hash_or_url):
    """`…#state=…` → JSON 객체 (시험이 v · p · r 을 읽는다)"""
    enc = hash_or_url.split('#state=', 1)[1]
    return json.loads(base64.urlsafe_b64decode(enc + '=' * (-len(enc) % 4)).decode())


# select 의 선택지 글자가 상자 안에 다 들어가는가 — select 는 scrollWidth 가 넘침을 드러내지 않아 글자 폭을 canvas 로 잰다
# 쓸 수 있는 폭 = clientWidth - 좌우 padding - 화살표 몫 24px
SELECT_FIT_JS = '''() => {
  const ctx = document.createElement('canvas').getContext('2d');
  const out = [];
  for (const sel of document.querySelectorAll('#field-env')) {
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


def goto_ready(page, url, sample=False):
    """dev 서버는 포트가 열린 뒤에도 잠깐 연결을 끊는다 — 60초 안에서 다시 시도한다.
    링크 없이 뿌리를 열면 첫 화면은 예시 계획이다(D108) — 빈 첫 화면(D97)을 전제한 시나리오가 그대로 돌도록 「Clear」 를 눌러 빈 상태로 시작한다.
    예시 그대로를 보는 시나리오(D108 첫 방문 · 스크린샷)만 sample=True 로 연다"""
    deadline = time.time() + 60
    while True:
        try:
            page.goto(url, wait_until='networkidle')
            break
        except Error:
            if time.time() > deadline:
                raise
            time.sleep(1)
    if sample or '#' in url or url.split('?', 1)[0] != BASE + '/':
        return
    clear = page.locator('[data-sample-clear]')
    clear.click()
    expect(clear).to_have_count(0)
    expect(page.locator('#wizard-project')).to_be_focused()


def events_of(page):
    """POST /v1/events 본문을 모은다 — D17 의 「1회 · 디바운스」 증거"""
    sent = []
    page.on('request', lambda r: sent.append(json.loads(r.post_data or '{}').get('event')) if r.url.endswith('/v1/events') and r.method == 'POST' else None)
    return sent


def pick_region(page, region):
    """② 지역 — 콤보박스에 리전 이름을 쳐서 그 항목을 누른다"""
    page.fill('#field-region', region)
    page.click(f'[data-region-option="{region}"]')


def fill_five(page, ctx):
    for key in ('owner', 'system', 'purpose'):
        page.fill(f'#field-{key}', ctx[key])
    page.select_option('#field-env', ctx['env'])
    pick_region(page, REGION_FORM[ctx['region']])


def expect_ctx(page, ctx):
    """폼이 문맥(hash 꼴)을 보이는가 — 지역은 리전 칸의 리전 이름"""
    for key in ('owner', 'system', 'purpose', 'env'):
        expect(page.locator(f'#field-{key}')).to_have_value(ctx[key])
    expect(page.locator('#field-region')).to_have_value(REGION_FORM[ctx['region']])


def row(page, rtype):
    return page.locator(f'[data-tree] [data-type="{rtype}"]')


def check(page, rtype):
    row(page, rtype).locator('input[data-row-check]').check()


def row_key(page, key):
    """catalog 행 — 범위를 고르기 전 합친 행에는 data-type 이 없어 행 key 로 찾는다"""
    return page.locator(f'[data-tree] [data-row="{key}"]')


def tree_rows(page):
    return page.locator('[data-tree] [data-row]')


def visible_rows(page):
    return page.eval_on_selector_all('[data-tree] [data-row]', 'els => els.filter(e => e.checkVisibility()).map(e => e.dataset.row)')


# 트리의 행 — 행 key · 규칙 타입(합친 행은 범위를 고르기 전 없음) · 분류 · 보이는 글자 · 보이는가 · 범위 묶음 수 · 범위 깊이(뿌리 = 0, 걸러진 트리에서도 조상 범위가 남으므로 같다)
ROWS_JS = '''els => els.map(e => {
  let depth = -1;
  for (let d = e.closest('details[data-scope]'); d; d = d.parentElement.closest('details[data-scope]')) depth++;
  const scopes = e.querySelectorAll('[data-scope-select] option:not([value=""])').length;
  return { key: e.dataset.row, type: e.dataset.type, category: e.dataset.ruleCategory, text: e.innerText, visible: e.checkVisibility(), scopes, depth };
})'''


def rows_info(page):
    return page.eval_on_selector_all('[data-tree] [data-row]', ROWS_JS)


def llms_tree(page, provider):
    """/llms.txt 「Resource tree」의 한 CSP 절 → [(resource_type, 범위 깊이)] — 화면 밖에서 오는 규칙 목록(시험이 규칙 수를 적어 두지 않는다)"""
    text = page.request.get(BASE + '/llms.txt').text()
    sect = text.split('\n## Resource tree\n', 1)[1].split('\n## ', 1)[0]
    block = sect.split(f'\n### {provider.upper()}\n', 1)[1].split('\n### ', 1)[0]
    out = []
    for line in block.splitlines():
        stripped = line.lstrip(' ')
        if stripped.startswith(f'- `{provider}.'):  # 규칙 줄은 자기 범위 줄보다 두 칸 안쪽이다
            out.append((stripped.split('`')[1].split('.', 1)[1], (len(line) - len(stripped)) // 2 - 1))
    assert out, block
    return out


def chip_count(page, cat):
    """분류 칩 「Networking (2)」 의 괄호 안 수"""
    return int(page.locator(f'button[data-category="{cat}"]').inner_text().rsplit('(', 1)[1].rstrip(')'))


def shot(pg, name, full_page=True):
    """스크린샷 — 트리를 「선택만 보기」로 줄여 찍고 되돌린다. 펼친 트리 전체(수백 행)를 찍으면 README 에서 읽을 수 없다"""
    pg.check('[data-selected-only]')
    pg.evaluate('window.scrollTo(0, 0)')
    pg.screenshot(path=str(OUT / name), full_page=full_page)
    pg.uncheck('[data-selected-only]')


def no_hangul(page):
    body_text = page.inner_text('body')
    assert not any('가' <= ch <= '힣' or 'ㄱ' <= ch <= 'ㆎ' for ch in body_text), body_text


# ── 마법사 (D59 · D64 · D67 · D68 · D73 · D74 · D75 · D82 · D83 · D84~D90) — ㉚~㊹ ──
# 화면 값은 중립 예시다(공개 저장소). 기대 이름은 화면 밖(POST /v1/wizard — 같은 엔진)에서 받는다
W_PROJECT = {'owner': 'devops', 'system': 'payments', 'env': 'prod', 'region': 'asia-northeast3'}


def post_api(page, path, data):
    """화면 밖 API 호출 — 요청 제한(분당 60 — src/api/ratelimit.ts)에 걸리면 Retry-After 만큼 쉬고 다시 보낸다(세 번까지). 시험 한 번이 분당 60 을 넘는다"""
    for _ in range(3):
        res = page.request.post(BASE + path, data=data)
        if res.status != 429:
            return res
        time.sleep(int(res.headers.get('retry-after', '60')) + 1)
    return res


def wizard_names(page, body):
    res = post_api(page, '/v1/wizard', {'provider': 'gcp', 'project': W_PROJECT, **body})
    assert res.status == 200, res.text()
    return [(i['key'], i['name'], i['valid']) for i in res.json()['data']['gcp']['items']]


def screen_names(page):
    """⑥ 의 카드 — (key, 이름, PASS 여부)"""
    out = []
    for card in page.locator('#names article[data-key]').all():
        out.append((card.get_attribute('data-key'), card.locator('[data-name]').inner_text(), card.get_attribute('data-valid') == 'true'))
    return [(k, '' if n == '—' else n, v) for k, n, v in out]


def bucket_link(rules_version, purpose):
    """버킷 pick 하나 · 네트워크 없는(pp: []) 마법사 링크의 hash"""
    body = {'owner': 'example', 'system': 'billing', 'env': 'prod', 'region': 'ane3', 'v': rules_version, 'w': {'pp': [], 's': [{'n': purpose, 'p': [{'pr': 'object'}]}]}}
    return '#state=' + base64.urlsafe_b64encode(json.dumps(body, separators=(',', ':')).encode()).rstrip(b'=').decode()


def settings(page):
    """가운데 설정 칸 (D89) — 목록에서 고른 줄 하나의 설정"""
    return page.locator('[data-settings]')


def select(page, path):
    """목록의 줄을 눌러 고르고 그 설정 칸이 열릴 때까지 기다린다. 접힌 서비스의 pick 줄이면 서비스 줄을 먼저 누른다(고른 서비스는 펴진다).
    카드가 차지한 pick 은 카드 줄 아래 접혀 있다(D93) — 카드 줄을 눌러 점검표의 Edit 로 고른다. 네트워크 pick 은 네트워크 줄을 눌러야 보인다"""
    m = re.match(r'services\[(\d+)\]\.(?:picks\[\d+\]|card\.[a-z-]+)$', path)
    if m and page.locator(f'[data-row-path="{path}"]').count() == 0:
        page.locator(f'[data-row-path="services[{m.group(1)}]"]').click()
        if page.locator(f'[data-row-path="{path}"]').count() == 0:
            for card in page.locator(f'[data-row-path^="services[{m.group(1)}].card."]').evaluate_all('els => els.map(e => e.dataset.rowPath)'):
                page.locator(f'[data-row-path="{card}"]').click()
                edit = page.locator(f'[data-card-panel] [data-edit-path="{path}"]')
                if edit.count() > 0:
                    edit.click()
                    break
    if path.startswith('projectPicks[') and page.locator(f'[data-row-path="{path}"]').count() == 0:
        page.locator('[data-row-path="network"]').click()
    page.locator(f'[data-row-path="{path}"]').click()
    expect(page.locator(f'[data-settings][data-pick-path="{path}"]')).to_have_count(1)
    return settings(page)


def svc(page, i):
    """서비스 줄을 고른 설정 칸 — 이름 · 삭제 · 카드 갤러리 · 용도 칩(접힌 「Add more」 칸을 연다 — D93)"""
    return more(select(page, f'services[{i}]'))


def more(s):
    """설정 칸의 「Add more to this service」 칸을 연다 — 칩 · 로드 밸런서 부품 · Custom 이 그 안이다 (D93)"""
    d = s.locator('details[data-add-more]')
    if d.count() > 0 and d.get_attribute('open') is None:
        d.locator('summary').click()
    return s


def slot(page, path, k):
    """pick 줄을 고른 설정 칸의 서버 줄 k"""
    return select(page, path).locator('li[data-slot]').nth(k)


def open_attached(row_):
    d = row_.locator('details[data-attached]')
    if d.get_attribute('open') is None:
        d.locator('summary').click()


def clear_network(page):
    """「Clear network」 (D90) — 첫 화면에 미리 채운 네트워크 넷을 뗀다(칩 흐름을 빈 네트워크에서 재는 시나리오)"""
    select(page, 'network').locator('[data-clear-network]').click()
    expect(page.locator('[data-row-path^="projectPicks"]')).to_have_count(0)


def fill_project(page):
    s = select(page, 'project')
    s.locator('#wizard-owner').fill(W_PROJECT['owner'])
    s.locator('#wizard-system').fill(W_PROJECT['system'])


# 첫 방문 (D97) — 소개 두 문단 · 프로젝트 값 예시(placeholder) · 갈 곳
INTRO_EXAMPLE = ['demo-payment-prod', 'payment-shop-prod-ane3-run-01', 'payment-shop-prod-fwd-01']
# 첫 방문 예시 계획 (D108) — 입력 넷 · 서비스 shop 의 serverless-web 카드 · 네트워크 미리 채움 넷. 이름 열여섯이 전부 PASS (엔진 실측 · wizardSample.test)
SAMPLE = {'owner': 'demo', 'system': 'payment', 'env': 'prod', 'region': 'asia-northeast3'}
SAMPLE_NAMES = 16
INTRO_ORDER = 'Fill in the project values below and pick what you are building — you get names, JSON and Terraform locals. Naming guide'
NEED_PROJECT = 'Enter the project values first — owner, system, environment and region. The names appear here once they are valid.'
PENDING = 'Fill in owner, system, environment and region to continue.'
INTRO_KEY = 'cloudonym:intro_dismissed_v2'


def fill_example_project(page):
    """Project 설정의 네 값을 손으로 채운다 — 예시 값(DEFAULT · placeholder 와 같은 값). 첫 선택이 Project 라 설정 칸이 이미 열려 있다"""
    s = select(page, 'project')
    s.locator('#wizard-owner').fill(DEFAULT['owner'])
    s.locator('#wizard-system').fill(DEFAULT['system'])
    s.locator(f'[data-env-chip="{DEFAULT["env"]}"]').click()
    pick_region(page, REGION_FORM[DEFAULT['region']])


def start_example(page, query=''):
    """D97 전의 첫 화면을 만든다 — 링크 없이 열고(빈칸) 예시 값 넷을 채운 뒤 「Next」 → 첫 서비스(shop)의 카드 갤러리.
    네트워크 넷 미리 채움(D90)은 그대로라 이름 다섯 · 선택은 services[0] 이다. 첫 화면을 전제한 시나리오가 이것으로 시작한다"""
    goto_ready(page, BASE + '/' + query)
    expect(settings(page)).to_have_attribute('data-pick-path', 'project')
    fill_example_project(page)
    page.click('[data-project-next-button]')
    expect(settings(page)).to_have_attribute('data-pick-path', 'services[0]')
    expect(page.locator('[data-names-summary]')).to_have_text('5 names · 5/5 PASS')


def wizard_shot(page, name, full_page=False):
    """마법사 스크린샷 — 두 번 찍어도 같은 바이트가 나오게 움직이는 것을 멈춘다(새 줄 강조 1.2초 · hover · 포커스 고리 · 커서 · 전환)"""
    expect(page.locator('[data-flash="true"]')).to_have_count(0, timeout=3000)
    page.mouse.move(0, 0)
    page.evaluate('document.activeElement && document.activeElement.blur && document.activeElement.blur()')
    page.evaluate('window.scrollTo(0, 0)')
    page.wait_for_timeout(100)
    page.screenshot(path=str(OUT / name), full_page=full_page, animations='disabled', caret='hide')


def doc_height(page):
    return page.evaluate('document.documentElement.scrollHeight')


def wizard_scenarios(browser, rules_version, errors):
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=BASE)
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))

    # ── ㉚ 뿌리 · hash 없음 → 마법사. 첫 화면은 네트워크 넷이 미리 채워져 이름 다섯(D90) · Clear network 뒤에는 이름이 없다.
    #    서비스 둘 · 서버 1 은 boot + data 1 · 서버 2 는 boot 만 → 여섯 이름 ──
    goto_ready(page, BASE + '/', sample=True)
    expect(page.locator('[data-wizard]')).to_be_visible()
    expect(page.locator('[data-tree]')).to_have_count(0)
    expect(page.locator('[data-nav-pick]')).to_have_attribute('href', '/pick')
    # 첫 방문 소개 (D97) — 무엇인가 · 순서 두 문단(경고색이 아니다) · 공유 링크 경고는 소개에서 빠졌다 · 닫으면 이 브라우저에 기억한다(새 창에서도 닫힌 채 — 아래 ㊻)
    # 예시 한 줄이 먼저 (D107) — 엔진이 빌드 때 만든 이름 셋 · 전부 PASS
    expect(page.locator('[data-intro-example]')).to_be_visible()
    expect(page.locator('[data-intro-example-input]')).to_have_text('demo · payment · prod · asia-northeast3')
    expect(page.locator('[data-intro-example-name]')).to_have_text(INTRO_EXAMPLE)
    expect(page.locator('[data-intro-example-pass]')).to_have_count(3)
    expect(page.locator('[data-intro-text]')).to_have_text(INTRO_ORDER)
    expect(page.locator('[data-wizard-intro]')).not_to_contain_text('share link')
    expect(page.locator('[data-wizard-notice]')).to_have_count(0)
    # 머리의 공유 경고 줄은 마법사에서 Share 를 누를 때 보인다 (D93) — 누르기 전에는 없다
    expect(page.locator('[data-share-warning]')).to_have_count(0)
    # 예시를 걷고(D108 — Clear) 빈 첫 화면(D97)에서 이어 간다
    page.click('[data-sample-clear]')
    # 세 칸 (D89) — 목록 · 설정 · 이름이 왼쪽부터 · 목록은 tree
    boxes = [page.locator(s).bounding_box() for s in ('[data-wizard-list-column]', '[data-settings]', '[data-names-column]')]
    assert boxes[0]['x'] < boxes[1]['x'] < boxes[2]['x'] and abs(boxes[0]['y'] - boxes[2]['y']) < 2, boxes
    expect(page.locator('[data-wizard-list]')).to_have_attribute('role', 'tree')
    # 첫 선택은 Project 다 (D97) — 값 넷을 채우고 「Next」 를 누르면 첫 서비스(D93 「무엇을 만드나」 카드 갤러리) · 고른 서비스는 펴진다(아직 고른 것이 없어 자식 줄은 없다)
    expect(settings(page)).to_have_attribute('data-pick-path', 'project')
    fill_example_project(page)
    page.click('[data-project-next-button]')
    expect(settings(page)).to_have_attribute('data-pick-path', 'services[0]')
    expect(page.locator('[data-row-path="services[0]"]')).to_have_attribute('aria-selected', 'true')
    expect(page.locator('[data-row-path="services[0]"]')).to_have_attribute('aria-expanded', 'true')
    expect(settings(page).locator('[data-card-gallery] [data-card]')).to_have_count(10)
    # 미리 채운 네트워크 넷 — 네트워크는 한 줄로 접혀 있다(이름 수 · 부품 제목) · 줄을 누르면 pick 줄이 펴진다 (D93)
    expect(page.locator('[data-row-pick]')).to_have_count(0)
    expect(page.locator('[data-row-path="network"] [data-row-count]')).to_have_text('4 names')
    expect(page.locator('[data-row-path="network"] [data-network-summary]')).to_have_text('VPC network, Subnet, Cloud Router, Cloud NAT')
    select(page, 'network')
    # 이름 다섯(ID + 넷) · 줄마다 그 pick 의 첫 이름 · 프로젝트 이름 카드는 수 · 이름 목록에 들지 않는다(D85)
    expect(page.locator('[data-row-pick]')).to_have_count(4)
    assert page.locator('[data-row-pick]').evaluate_all('els => els.map(e => e.dataset.rowPick)') == ['vpc', 'subnet', 'router', 'nat']
    expect(page.locator('#names article[data-key]')).to_have_count(5)
    assert [k for k, _, _ in screen_names(page)] == ['project/-/project_id/-/-/-', 'project/-/vpc_network/-/-/01', 'project/-/subnet/-/-/01', 'project/-/router/-/-/01', 'project/-/router_nat/-/-/01'], screen_names(page)
    expect(page.locator('[data-names-summary]')).to_have_text('5 names · 5/5 PASS')
    assert page.locator('[data-row-pick] [data-row-name]').all_inner_texts() == [n for _, n, _ in screen_names(page)[1:]]
    expect(page.locator('[data-project-name-card]')).to_have_count(1)
    expect(page.locator('[data-project-name-card] [data-project-name-value]')).to_have_text('platform-billing-prod')
    expect(page.locator('[data-project-name-card]')).to_contain_text('not exported')
    clear_network(page)
    expect(page.locator('[data-names-empty]')).to_have_text('Nothing to name yet. Select a service and pick what runs in it, or add network or shared resources.')
    expect(page.locator('[data-project-name-card]')).to_have_count(0)
    fill_project(page)
    expect(page.locator('[data-project-id]')).to_have_text('devops-payments-prod')
    expect(page.locator('[data-common-parts] code')).to_have_text(['payments', 'prod', 'ane3'])
    svc(page, 0).locator('[data-service-name]').fill('shop')
    expect(settings(page).locator('[data-service-empty]')).to_have_count(1)
    more(settings(page)).locator('[data-purpose-chip="web"]').click()
    expect(settings(page).locator('[data-purpose-chip="web"]')).to_have_attribute('aria-pressed', 'true')
    # 칩 토글은 선택을 옮기지 않는다 — 서비스 줄이 그대로 · 새 pick 줄이 목록에 생긴다
    expect(settings(page)).to_have_attribute('data-pick-path', 'services[0]')
    expect(page.locator('[data-row-path="services[0].picks[0]"]')).to_have_attribute('data-row-pick', 'web')
    page.click('[data-add-service]')
    # Add service 는 새 서비스 줄을 고른다
    expect(settings(page)).to_have_attribute('data-pick-path', 'services[1]')
    settings(page).locator('[data-service-name]').fill('pay')
    more(settings(page)).locator('[data-purpose-chip="web"]').click()
    s1 = slot(page, 'services[0].picks[0]', 0)
    open_attached(s1)
    s1.locator('[data-attach="boot"]').check()
    s1.locator('[data-add-disk]').click()
    s2 = slot(page, 'services[1].picks[0]', 0)
    open_attached(s2)
    s2.locator('[data-attach="boot"]').check()
    expected = wizard_names(page, {'services': [
        {'purpose': 'shop', 'picks': [{'preset': 'web', 'instances': [{'id': '1', 'seq': '01', 'attach': {'boot': True, 'data': ['01']}}]}]},
        {'purpose': 'pay', 'picks': [{'preset': 'web', 'instances': [{'id': '1', 'seq': '01', 'attach': {'boot': True}}]}]},
    ]})
    assert len(expected) == 6, expected
    expect(page.locator('#names article[data-key]')).to_have_count(6)
    assert screen_names(page) == expected, (screen_names(page), expected)
    expect(page.locator('[data-names-summary]')).to_have_text('6 names · 6/6 PASS')
    # 줄 이름 — 첫 이름 + 나머지 수(딸린 이름) · 서비스 줄은 이름 수
    expect(page.locator('[data-row-path="services[1].picks[0]"] [data-row-name]')).to_have_text(expected[4][1] + ' +1')
    expect(page.locator('[data-row-path="services[1]"] [data-row-count]')).to_have_text('2 names')
    # 자식은 부모 아래 들여쓰기 · 「attached to」 줄 · 제목 VM Instance · web · 01
    expect(page.locator('#names [data-child]')).to_have_count(3)
    expect(page.locator('#names article[data-key="service/shop/compute_instance/-/web/01"] h4')).to_have_text('VM Instance · web · 01')
    expect(page.locator('#names article[data-key="service/shop/compute_instance/-/web/01/data/01"] [data-parent]')).to_contain_text('attached to')
    expect(page.locator('[data-names-group]')).to_have_count(3)
    no_hangul(page)
    # 06 — 디스크가 딸린 VM 줄(shop · Web server)을 고른 상태(B안 1-5). 고정 값만 찍는다: 강조가 꺼진 뒤 · 포인터는 구석 · 포커스 없음
    open_attached(slot(page, 'services[0].picks[0]', 0))
    wizard_shot(page, '06-wizard.png', full_page=True)

    # 내보내기 — JSON 은 구조 키 · Terraform 은 맵 하나 · 프로젝트 이름은 들지 않는다
    page.click('[data-copy="names-json"]')
    exported = json.loads(page.evaluate('navigator.clipboard.readText()'))
    assert [n['key'] for n in exported['names']] == [k for k, _, _ in expected], exported['names']
    assert exported['project'] == {'owner': 'devops', 'system': 'payments', 'env': 'prod', 'region': 'ane3'}, exported['project']
    page.click('[data-copy="terraform"]')
    hcl = page.evaluate('navigator.clipboard.readText()')
    assert '  gcp_names = {\n' in hcl and '"service/shop/compute_instance/-/web/01/data/01" = "' in hcl and 'gcp_labels_by_namespace' in hcl, hcl

    # ── ㊵ 환경 여럿 (D82) — stg 칩을 켜면 같은 계획을 env 마다 · 이름은 env 로 묶인다 · 내보내기는 env 맵 · 공유 링크의 e 가 왕복한다 · 끄면 그대로 ──
    select(page, 'project')
    expect(page.locator('[data-env-chip]')).to_have_count(9)
    expect(page.locator('[data-env-chip="prod"]')).to_have_attribute('aria-pressed', 'true')
    page.click('[data-env-chip="stg"]')
    expect(page.locator('[data-names-env]')).to_have_count(2)
    expect(page.locator('#names article[data-key]')).to_have_count(12)
    expect(page.locator('[data-names-summary]')).to_have_text('12 names · 12/12 PASS')
    expect(page.locator('[data-project-id]')).to_have_text(['devops-payments-prod', 'devops-payments-stg'])
    expect(page.locator('[data-project-name-card] [data-project-name-value]')).to_have_text(['devops-payments-prod', 'devops-payments-stg'])
    expect(page.locator('[data-names-env="stg"] h3').first).to_have_text('Environment stg · Staging')
    stg_names = [n for _, n, _ in wizard_names(page, {'project': {**W_PROJECT, 'env': 'stg'}, 'services': [
        {'purpose': 'shop', 'picks': [{'preset': 'web', 'instances': [{'id': '1', 'seq': '01', 'attach': {'boot': True, 'data': ['01']}}]}]},
        {'purpose': 'pay', 'picks': [{'preset': 'web', 'instances': [{'id': '1', 'seq': '01', 'attach': {'boot': True}}]}]},
    ]})]
    assert page.locator('[data-names-env="stg"] article[data-key] [data-name]').all_inner_texts() == stg_names, stg_names
    assert page.locator('[data-names-env="prod"] article[data-key] [data-name]').all_inner_texts() == [n for _, n, _ in expected]
    page.click('[data-copy="names-json"]')
    by_env = json.loads(page.evaluate('navigator.clipboard.readText()'))
    assert list(by_env['environments']) == ['prod', 'stg'] and by_env['environments']['stg']['project']['env'] == 'stg', by_env
    assert [n['name'] for n in by_env['environments']['stg']['names']] == stg_names
    page.click('[data-copy="terraform"]')
    hcl_env = page.evaluate('navigator.clipboard.readText()')
    assert '  gcp_names_by_env = {\n    "prod" = {\n' in hcl_env and '    "stg" = {\n' in hcl_env and 'gcp_labels_by_env' in hcl_env and '  gcp_names = {' not in hcl_env, hcl_env
    page.click('[data-copy="share-url"]')
    shared_env = page.evaluate('navigator.clipboard.readText()')
    assert hash_state(shared_env)['e'] == ['prod', 'stg'], hash_state(shared_env)
    ctx40 = browser.new_context(viewport={'width': 1280, 'height': 900})
    p40 = ctx40.new_page()
    p40.on('pageerror', lambda e: errors.append(str(e)))
    goto_ready(p40, shared_env)
    expect(p40.locator('[data-names-env]')).to_have_count(2)
    # 링크로 연 계획도 첫 선택은 첫 서비스다(D93) — 환경 칩은 Project 줄을 골라 본다
    expect(select(p40, 'project').locator('[data-env-chip="stg"]')).to_have_attribute('aria-pressed', 'true')
    assert p40.url == shared_env, (p40.url, shared_env)
    ctx40.close()
    page.click('[data-env-chip="prod"]')  # prod 를 끄면 stg 하나 — 모델의 env 가 stg
    expect(page.locator('[data-names-env]')).to_have_count(0)
    expect(page.locator('[data-project-id]')).to_have_text('devops-payments-stg')
    page.click('[data-env-chip="stg"]')  # 마지막 하나는 꺼지지 않는다
    expect(page.locator('[data-env-chip="stg"]')).to_have_attribute('aria-pressed', 'true')
    page.click('[data-env-chip="prod"]')
    page.click('[data-env-chip="stg"]')
    expect(page.locator('[data-env-chip][aria-pressed="true"]')).to_have_count(1)
    assert screen_names(page) == expected, (screen_names(page), expected)
    page.click('[data-copy="share-url"]')
    assert 'e' not in hash_state(page.evaluate('navigator.clipboard.readText()'))

    # ── ㉟ Share URL 왕복 — shop 에 서버 02 를 더하고(ip) 01 을 지운 뒤에도 02 의 이름 · 딸린 것이 그대로 ──
    shop_web = select(page, 'services[0].picks[0]')
    shop_web.locator('[data-add-slot]').click()
    s02 = slot(page, 'services[0].picks[0]', 1)
    open_attached(s02)
    s02.locator('[data-attach="ip"]').check()
    name02 = page.locator('#names article[data-key="service/shop/compute_instance/-/web/02"] [data-name]').inner_text()
    slot(page, 'services[0].picks[0]', 0).locator('[data-remove-slot]').click()
    expect(shop_web.locator('li[data-slot]')).to_have_count(1)
    expect(slot(page, 'services[0].picks[0]', 0)).to_have_attribute('data-seq', '02')
    expect(shop_web.locator('[data-renumber]')).to_be_visible()
    expect(page.locator('#names article[data-key="service/shop/compute_instance/-/web/02"] [data-name]')).to_have_text(name02)
    page.click('[data-copy="share-url"]')
    shared = page.evaluate('navigator.clipboard.readText()')
    assert shared.startswith(BASE + '/#state='), shared
    body = hash_state(shared)
    assert 'w' in body and 'purpose' not in body and body['v'] == rules_version, body
    before = screen_names(page)
    ctx35 = browser.new_context(viewport={'width': 1280, 'height': 900})
    p35 = ctx35.new_page()
    p35.on('pageerror', lambda e: errors.append(str(e)))
    goto_ready(p35, shared)
    expect(p35.locator('[data-wizard]')).to_be_visible()
    expect(p35.locator('#names article[data-key]')).to_have_count(len(before))
    assert screen_names(p35) == before, (screen_names(p35), before)
    # 링크에서 연 계획은 미리 채우지 않는다 (D90) — 네트워크 줄 없음
    expect(p35.locator('[data-row-path^="projectPicks"]')).to_have_count(0)
    expect(slot(p35, 'services[0].picks[0]', 0)).to_have_attribute('data-seq', '02')
    expect(slot(p35, 'services[0].picks[0]', 0).locator('[data-attached-summary]')).to_have_text('ip')
    assert p35.url == shared, (p35.url, shared)  # 링크로 연 그대로면 hash 를 다시 쓰지 않는다
    ctx35.close()

    # ── ㉛ HA 토글 → 서버 줄 둘 · 존 분산 안내 한 줄 · 줄 하나 지우면 HA 꺼짐 ──
    pay = select(page, 'services[1].picks[0]')
    pay.locator('[data-ha]').check()
    expect(pay.locator('li[data-slot]')).to_have_count(2)
    expect(pay.locator('[data-ha-hint]')).to_have_text('Two servers or more. Place the servers in different zones when you create them.')
    expect(page.locator('#names article[data-key="service/pay/compute_instance/-/web/02"]')).to_have_count(1)
    pay.locator('li[data-slot]').nth(1).locator('[data-remove-slot]').click()
    expect(pay.locator('[data-ha]')).not_to_be_checked()
    expect(pay.locator('[data-ha-hint]')).to_have_count(0)
    # Serverless 를 고르면 HA 토글이 숨고 이름이 Cloud Run 이 된다 · 끄면 돌아온다
    pay.locator('[data-serverless]').select_option('run')
    expect(pay.locator('[data-ha]')).to_have_count(0)
    expect(page.locator('#names article[data-key="service/pay/run_service/-/web/01"] [data-name]')).to_have_text('payments-pay-prod-ane3-run-web-01')
    pay.locator('[data-serverless]').select_option('')
    expect(pay.locator('[data-ha]')).to_have_count(1)

    # ── ㉜ db 칩에는 HA 토글이 없다 · 엔진 select 가 있다 ──
    svc(page, 1).locator('[data-purpose-chip="db"]').click()
    db = select(page, 'services[1].picks[1]')
    expect(db.locator('[data-pick="db"]')).to_have_count(1)
    expect(db.locator('[data-ha]')).to_have_count(0)
    expect(db.locator('[data-serverless]')).to_have_count(0)
    expect(db.locator('[data-kind]')).to_have_count(1)
    for j, chip in enumerate(('bastion', 'file', 'object'), start=2):
        svc(page, 1).locator(f'[data-purpose-chip="{chip}"]').click()
        expect(select(page, f'services[1].picks[{j}]').locator(f'[data-pick="{chip}"] [data-ha]')).to_have_count(0)
    expect(select(page, 'services[1].picks[3]').locator('[data-pick="file"] [data-attached-summary]')).to_have_text('data-01')

    # ── ㉝ custom 용도 — 트리를 모달로 열어 여러 행을 고르고(창은 열린 채) 하나는 풀고 「Done」 → 마지막에 더한 줄이 선택된다 (D95)
    #    → tier 를 db 로 → 거부 안내 · 이름 대신 「고칠 칸」 ──
    svc(page, 0).locator('[data-purpose-chip="custom"]').click()
    dialog = page.locator('[data-custom-dialog]')
    expect(dialog).to_be_visible()
    expect(dialog.get_by_text('Tick rows to add them to this service, each with its own number rows. Untick a row to remove it.')).to_have_count(1)
    # 프로젝트 ID · 프로젝트 이름은 Project 칸이 만들어 모달 트리에 없다(D95) — 같은 프로젝트 범위의 서비스 계정 행은 있다
    expect(dialog.locator('[data-rule="gcp.service_account"]')).to_have_count(1)
    expect(dialog.locator('[data-rule="gcp.project_id"]')).to_have_count(0)
    expect(dialog.locator('[data-rule="gcp.project_name"]')).to_have_count(0)
    # 처음에는 뿌리만 열리고 범위 · 분류가 모두 접혀 있다 (D95) — 검색어를 넣으면 맞는 것만 펼친다
    expect(dialog.locator('details[data-scope][open]')).to_have_count(1)
    expect(dialog.locator('details[data-group][open]')).to_have_count(0)
    expect(row(page, 'compute_instance')).not_to_be_visible()
    dialog.locator('[data-tree-search]').fill('compute_instance')
    expect(row(page, 'compute_instance')).to_be_visible()
    # 행을 골라도 모달은 열려 있다 — 체크된 채 보이고 다음 행을 고른다. 고른 줄은 닫을 때까지 그대로다
    row(page, 'compute_instance').locator('input[data-row-check]').check()
    expect(dialog).to_be_visible()
    expect(row(page, 'compute_instance').locator('input[data-row-check]')).to_be_checked()
    expect(settings(page)).to_have_attribute('data-pick-path', 'services[0]')
    dialog.locator('[data-tree-search]').fill('service_account')
    row(page, 'service_account').locator('input[data-row-check]').check()
    expect(page.locator('[data-row-path="services[0].picks[2]"]')).to_have_count(1)
    # 체크를 풀면 그 custom pick 이 지워진다
    row(page, 'service_account').locator('input[data-row-check]').uncheck()
    expect(page.locator('[data-row-path="services[0].picks[2]"]')).to_have_count(0)
    # 「Done」 — 닫고, 이 창에서 더한 것 가운데 남은 마지막 pick(VM)을 고른다
    dialog.locator('[data-custom-done]').click()
    expect(dialog).to_have_count(0)
    expect(settings(page)).to_have_attribute('data-pick-path', 'services[0].picks[1]')
    # 다시 열면 custom 으로 더한 VM 은 체크된 채 보이고 · 프리셋 칩(web)으로 더한 VM 은 트리 선택에 들지 않는다 · Esc 는 닫고 고른 줄을 그대로 둔다
    select(page, 'services[0]')
    svc(page, 0).locator('[data-purpose-chip="custom"]').click()
    expect(dialog).to_be_visible()
    expect(dialog.locator('[data-selected-count]')).to_have_text('1 selected')
    dialog.locator('[data-tree-search]').fill('compute_instance')
    expect(row(page, 'compute_instance').locator('input[data-row-check]')).to_be_checked()
    # 검색 칸의 Esc 는 브라우저가 먼저 검색어를 지운다 — 체크 상자에서 누른다
    row(page, 'compute_instance').locator('input[data-row-check]').focus()
    page.keyboard.press('Escape')
    expect(dialog).to_have_count(0)
    expect(settings(page)).to_have_attribute('data-pick-path', 'services[0]')
    select(page, 'services[0].picks[1]')
    expect(settings(page)).to_have_attribute('data-pick-path', 'services[0].picks[1]')
    custom = settings(page).locator('[data-pick="custom"]')
    expect(custom).to_have_count(1)
    custom.locator('[data-tier]').fill('db')
    expect(custom.locator('[data-wizard-error]')).to_contain_text("tier 'db' is reserved")
    expect(page.locator('[data-names-empty]')).to_have_text('Fix the marked fields to see names.')
    expect(page.locator('[data-copy="share-url"]')).to_have_count(0)  # 온전하지 않은 모델은 공유하지 않는다
    # 오류 배지 — 그 줄과 서비스 줄 · 줄 이름은 온전할 때만(—)
    expect(page.locator('[data-row-path="services[0].picks[1]"] [data-row-errors]')).to_have_text('!1')
    expect(page.locator('[data-row-path="services[0]"] [data-row-errors]')).to_have_text('!1')
    expect(page.locator('[data-row-path="services[0].picks[0]"] [data-row-name]')).to_have_text('—')
    # ── ㉞ 자식 넘침 — 부모는 63자에 맞췄지만 -data-01 이 붙으면 넘친다 → 그 자식 카드만 FAIL ──
    custom.locator('[data-tier]').fill('abcdefghijklmnop')
    svc(page, 0).locator('[data-service-name]').fill('b' * 20)
    crow = slot(page, 'services[0].picks[1]', 0)
    open_attached(crow)
    crow.locator('[data-add-disk]').click()
    child = page.locator('#names article[data-key$="/compute_instance/-/abcdefghijklmnop/01/data/01"]')
    expect(child).to_have_attribute('data-valid', 'false')
    expect(child.locator('[data-violations]')).to_contain_text('exceeds the limit')
    expect(page.locator('#names article[data-key$="/compute_instance/-/abcdefghijklmnop/01"]')).to_have_attribute('data-valid', 'true')
    no_hangul(page)

    # 폭 360px — 가로 스크롤 없음 (폰은 한 칸 · 위 탭 · 설정은 바텀 시트 — ㊹)
    page.set_viewport_size({'width': 360, 'height': 800})
    page.wait_for_timeout(200)
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), '마법사가 360px 에서 가로 스크롤이 생긴다'
    ctx.close()

    # ── ㊱ 트리 꼴 hash(v3 r · 다섯 키)로 뿌리를 열면 `/pick` 으로 옮겨 트리가 열린다 (D76) · 깨진 뿌리 hash 는 마법사 + 한 줄 안내 ──
    # ── ㊲ /pick#state=… 는 그 자리에서 트리 ──
    v3 = state_hash(INPUT, rules_version, 'gcp', {'compute_instance': 2})
    five = state_hash(INPUT)
    ctx36 = browser.new_context(viewport={'width': 1280, 'height': 900})
    ctx36.grant_permissions(['clipboard-read', 'clipboard-write'], origin=BASE)
    p36 = ctx36.new_page()
    p36.on('pageerror', lambda e: errors.append(str(e)))
    for path in ('/', '/pick'):
        for h in (v3, five):
            goto_ready(p36, BASE + '/pick?r' + h)
            goto_ready(p36, BASE + path + h)
            p36.wait_for_url(BASE + '/pick' + h)
            expect(p36.locator('[data-tree]')).to_have_count(1)
            expect(p36.locator('[data-wizard]')).to_have_count(0)
            expect_ctx(p36, INPUT)
            expect(p36.locator('[data-nav-wizard]')).to_have_attribute('href', '/')
            if h == v3:
                expect(p36.locator(f'{VM1} [data-name]')).to_have_text('payments-ledger-prod-euw1-gce-01')
                p36.click('[data-copy="share-url"]')
                tree_share = p36.evaluate('navigator.clipboard.readText()')
                assert tree_share.startswith(BASE + '/pick#state='), tree_share
                assert 'w' not in hash_state(tree_share), tree_share
    # query 도 실어 간다 — `/?x#트리` → `/pick?x#트리`
    goto_ready(p36, BASE + '/?keep' + v3)
    p36.wait_for_url(BASE + '/pick?keep' + v3)
    expect(p36.locator('[data-tree]')).to_have_count(1)
    # 같은 탭 — 트리에서 풀리지 않는 마법사 hash(문맥이 틀림)로 이동하면 트리에 남고 주소창이 되돌아간다
    goto_ready(p36, BASE + '/pick' + v3)
    bad_w = json.loads(json.dumps(hash_state(shared)))
    bad_w['env'] = 'nope'
    bad_w_hash = '#state=' + base64.urlsafe_b64encode(json.dumps(bad_w, separators=(',', ':')).encode()).rstrip(b'=').decode()
    p36.evaluate('h => { location.hash = h; }', bad_w_hash)
    p36.wait_for_function('h => location.hash === h', arg=v3)
    expect(p36.locator('[data-tree]')).to_have_count(1)
    expect(p36.locator('[data-wizard]')).to_have_count(0)
    # 같은 탭 — 마법사에서 트리 hash 로 이동하면 `/pick` 으로 옮겨 트리가 열린다
    goto_ready(p36, BASE + '/')
    expect(p36.locator('[data-wizard]')).to_be_visible()
    p36.evaluate('h => { location.hash = h; }', v3)
    p36.wait_for_url(BASE + '/pick' + v3)
    expect(p36.locator('[data-tree]')).to_have_count(1)
    expect(p36.locator('[data-wizard]')).to_have_count(0)
    expect(p36.locator(f'{VM1} [data-name]')).to_have_text('payments-ledger-prod-euw1-gce-01')
    # 깨진 뿌리 hash → 마법사 + 안내 한 줄 (조용히 버리지 않는다) · 링크에서 떨어진 경로라 네트워크를 미리 채우지 않는다 (D90)
    # {"owner":42} 는 JSON 이지만 decodeState 가 받지 않는다 → 트리가 아니라 마법사 + 안내 (검토 M-2)
    for broken in ('#state=!!!', '#state=W10', '#state=eyJvd25lciI6NDJ9'):
        goto_ready(p36, BASE + '/?b' + broken)
        goto_ready(p36, BASE + '/' + broken)
        expect(p36.locator('[data-wizard]')).to_be_visible()
        expect(p36.locator('[data-wizard-notice]')).to_have_text(['This link could not be opened — the wizard starts with example values.'])
        expect(p36.locator('[data-row-path^="projectPicks"]')).to_have_count(0)
    # 마법사 링크의 걸린 자리 — 디스크 순번 00 만 버리고 안내 한 줄
    bad = json.loads(json.dumps(body))
    bad['w']['s'][0]['p'][0]['i'][0]['a'] = {'b': 1, 'd': ['00']}
    raw = json.dumps(bad, separators=(',', ':'), ensure_ascii=False)
    bad_hash = '#state=' + base64.urlsafe_b64encode(raw.encode()).rstrip(b'=').decode()
    goto_ready(p36, BASE + '/?c' + bad_hash)
    goto_ready(p36, BASE + '/' + bad_hash)
    expect(p36.locator('[data-wizard-notice]')).to_have_text(['1 invalid item(s) in this link or file were left out.'])
    expect(slot(p36, 'services[0].picks[0]', 0).locator('[data-attached-summary]')).to_have_text('boot')
    # 같은 탭 hash 이동이 계획을 통째로 바꾸면 사라진 줄의 선택은 Project 로 (D89)
    select(p36, 'services[1].picks[0]')
    p36.evaluate('h => { location.hash = h; }', bucket_link(rules_version, 'onlyone'))
    expect(settings(p36)).to_have_attribute('data-pick-path', 'project')
    ctx36.close()

    # ── ㊳ D73 의 새 칩 — 하나씩 켜면 이름이 하나씩 늘고 화면 이름 = POST /v1/wizard · 로드 밸런서는 하위 줄 · 종류 라벨 · 역할 입력 · 360px ──
    #    리소스를 열넷 더해도 페이지 높이가 그대로다(세 칸이 칸마다 스크롤 — D89). 첫 칩 전에는 공유 단추와 그 경고 줄이 없지만 머리는 그 자리를 비워 둬 높이가 같다
    #    이름 칸을 끝까지 굴려도 머리(요약 · Copy all · JSON · Terraform)는 칸 위에 붙어 있다
    ctx38 = browser.new_context(viewport={'width': 1280, 'height': 900})
    p38 = ctx38.new_page()
    p38.on('pageerror', lambda e: errors.append(str(e)))
    start_example(p38)
    clear_network(p38)
    fill_project(p38)
    svc(p38, 0).locator('[data-service-name]').fill('shop')
    lb = svc(p38, 0).locator('[data-lb-parts]')
    expect(lb.locator('[data-purpose-chip]')).to_have_count(13)
    one = [{'id': '1', 'seq': '01'}]
    picks, project_picks = [], []
    expect(p38.locator('[data-copy="share-url"]')).to_have_count(0)
    expect(p38.locator('[data-share-reserve]')).to_have_count(1)
    height38 = doc_height(p38)
    for chip in ('run', 'sa', 'secret', 'gke', 'wip', 'ip', 'bs', 'hc', 'url', 'cert', 'thps', 'fwd', 'ig', 'urlredir', 'thp', 'fwdredir'):
        before38 = p38.locator('#names article[data-key]').count()
        svc(p38, 0).locator(f'[data-purpose-chip="{chip}"]').click()
        picks.append({'preset': chip} if chip == 'sa' else {'preset': chip, 'instances': one})
        want = wizard_names(p38, {'project_picks': project_picks, 'services': [{'purpose': 'shop', 'picks': picks}]})
        expect(p38.locator('#names article[data-key]')).to_have_count(before38 + (2 if before38 == 0 else 1))
        assert screen_names(p38) == want, (chip, screen_names(p38), want)
        assert all(v for _, _, v in want), want
    for chip in ('router', 'nat'):
        select(p38, 'network').locator(f'[data-project-chip="{chip}"]').click()
        project_picks.append({'preset': chip, 'instances': one})
        want = wizard_names(p38, {'project_picks': project_picks, 'services': [{'purpose': 'shop', 'picks': picks}]})
        assert screen_names(p38) == want, (chip, screen_names(p38), want)
    assert len(want) == 1 + 16 + 2, want
    assert doc_height(p38) == height38, ('리소스를 더하자 페이지가 길어졌다', height38, doc_height(p38))
    expect(p38.locator('[data-copy="share-url"]')).to_have_count(1)
    expect(p38.locator('[data-share-reserve]')).to_have_count(0)
    col38 = p38.locator('[data-names-column]')
    col38.evaluate('e => { e.scrollTop = e.scrollHeight; }')
    assert col38.evaluate('e => e.scrollTop') > 200, col38.evaluate('e => [e.scrollTop, e.scrollHeight, e.clientHeight]')
    head38, colbox38 = p38.locator('[data-names-head]').bounding_box(), col38.bounding_box()
    assert abs(head38['y'] - colbox38['y']) <= 2, (head38, colbox38)
    expect(p38.locator('[data-names-head] [data-copy="terraform"]')).to_be_in_viewport()
    expect(select(p38, 'services[0].picks[3]').locator('[data-pick="gke"] label[for$="-kind"]')).to_have_text('Kind of GKE Cluster')
    sa = select(p38, 'services[0].picks[1]')
    expect(sa.locator('[data-role]')).to_have_attribute('placeholder', 'sync')
    expect(sa.locator('li[data-slot]')).to_have_count(0)
    expect(p38.locator('#names article[data-key="service/shop/service_account/-/-/sync"] [data-name]')).to_have_text('payments-shop-prod-sa-sync')
    sa.locator('[data-role]').fill('deploy')
    expect(p38.locator('#names article[data-key="service/shop/service_account/-/-/deploy"] [data-name]')).to_have_text('payments-shop-prod-sa-deploy')
    expect(p38.locator('[data-row-path="services[0].picks[1]"] [data-row-name]')).to_have_text('payments-shop-prod-sa-deploy')
    # Secret 의 Location (D79) — 기본은 전역(지역 토큰 없음) · Regional 을 고르면 프로젝트 지역이 들고 API 와 같다 · 되돌리면 원래 이름
    sec = select(p38, 'services[0].picks[2]')
    sec_loc = sec.locator('[data-location]')
    sec_name = p38.locator('#names article[data-key="service/shop/secret/-/-/01"] [data-name]')
    expect(sec_loc).to_have_value('')
    expect(sec_loc.locator('option')).to_have_count(2)
    expect(sec_name).to_have_text('payments-shop-prod-secret-01')
    sec_loc.select_option('regional')
    expect(sec_name).to_have_text('payments-shop-prod-ane3-secret-01')
    picks38 = [({'preset': 'sa', 'role': 'deploy'} if q['preset'] == 'sa' else ({**q, 'location': 'regional'} if q['preset'] == 'secret' else q)) for q in picks]
    want38 = wizard_names(p38, {'project_picks': project_picks, 'services': [{'purpose': 'shop', 'picks': picks38}]})
    assert screen_names(p38) == want38, (screen_names(p38), want38)
    sec_loc.select_option('')
    expect(sec_name).to_have_text('payments-shop-prod-secret-01')
    no_hangul(p38)
    p38.set_viewport_size({'width': 360, 'height': 800})
    p38.wait_for_timeout(200)
    assert p38.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), '새 칩을 켠 마법사가 360px 에서 가로 스크롤이 생긴다'
    ctx38.close()

    # ── ㊴ D74 · D75 — 번호 없는 Cloud 줄 · VPC 하나 · 서브넷 번호 줄 · 버킷 둘(Duplicate + tier) · 프로젝트 공용 Custom ──
    ctx39 = browser.new_context(viewport={'width': 1280, 'height': 900})
    p39 = ctx39.new_page()
    p39.on('pageerror', lambda e: errors.append(str(e)))
    start_example(p39)
    # 클라우드는 머리의 배지다 (D93) — 켜진 것이 GCP 하나라 고르는 줄을 두지 않는다. 단계 번호(①~⑦)는 뗐다
    # 배지 둘 (83b0829) — 지금 쓰는 것(Google Cloud · 체크)과 예정인 것(점선)을 나눠 셋 다 되는 것처럼 읽히지 않게 한다 · 묶음의 이름이 둘을 함께 말한다
    cloud = p39.locator('header [data-wizard-cloud]')
    soon = p39.locator('header [data-wizard-cloud-soon]')
    expect(cloud).to_have_text('Google Cloud')
    expect(cloud.locator('svg')).to_have_count(1)
    expect(soon).to_have_text('AWS · Azure coming soon')
    assert soon.evaluate('e => getComputedStyle(e).borderTopStyle') == 'dashed'
    assert cloud.evaluate('e => getComputedStyle(e).borderTopStyle') == 'solid'
    expect(p39.locator('header [role="group"]:has([data-wizard-cloud])')).to_have_attribute('aria-label', 'Supported now: Google Cloud. Coming soon: AWS and Azure.')
    expect(p39.locator('header [role="group"]:has([data-wizard-cloud]) [data-wizard-cloud-soon]')).to_have_count(1)
    expect(p39.locator('[data-wizard] [data-cloud]')).to_have_count(0)
    expect(select(p39, 'project').locator('#wizard-project')).to_have_text(re.compile(r'^Project\b'))
    clear_network(p39)
    fill_project(p39)
    svc(p39, 0).locator('[data-service-name]').fill('shop')
    # VPC 는 줄 하나 · 더하기 · 다시 매기기 없음 · 서브넷의 번호 줄은 「Add number (same kind and tier)」(D86 · VM 은 「Add server」 그대로 — ㉟)
    net39 = select(p39, 'network')
    net39.locator('[data-project-chip="vpc"]').click()
    net39.locator('[data-project-chip="subnet"]').click()
    vpc = select(p39, 'projectPicks[0]').locator('[data-pick="vpc"]')
    expect(vpc.locator('li[data-slot]')).to_have_count(1)
    expect(vpc.locator('[data-add-slot]')).to_have_count(0)
    expect(vpc.locator('[data-renumber]')).to_have_count(0)
    vpc.locator('[data-slot-seq]').fill('03')
    expect(vpc.locator('[data-renumber]')).to_have_count(0)
    expect(select(p39, 'projectPicks[1]').locator('[data-pick="subnet"] [data-add-slot]')).to_have_text('Add number (same kind and tier)')
    assert p39.locator('text=Add instance').count() == 0
    # 프리셋이 tier 를 정하는 web 에는 tier 칸도 Duplicate 도 없다 — 패널이 있는 것을 먼저 본다
    svc(p39, 0).locator('[data-purpose-chip="web"]').click()
    web39 = select(p39, 'services[0].picks[0]').locator('[data-pick="web"]')
    expect(web39).to_have_count(1)
    expect(web39.locator('[data-remove-pick]')).to_have_count(1)
    expect(web39.locator('[data-duplicate-pick]')).to_have_count(0)
    expect(web39.locator('[data-tier]')).to_have_count(0)
    # 설정 칸의 Remove — 형제가 없으면 서비스 줄로
    web39.locator('[data-remove-pick]').click()
    expect(settings(p39)).to_have_attribute('data-pick-path', 'services[0]')
    expect(p39.locator('[data-row-pick="web"]')).to_have_count(0)
    # 버킷 둘 — Duplicate 는 바로 뒤에 넣고 그 줄을 고른다 · 복사본에 중복 오류 · tier 를 치면 이름 둘
    svc(p39, 0).locator('[data-purpose-chip="object"]').click()
    obj = select(p39, 'services[0].picks[0]')
    expect(obj.locator('[data-tier]')).to_have_count(1)
    obj.locator('[data-duplicate-pick]').click()
    expect(settings(p39)).to_have_attribute('data-pick-path', 'services[0].picks[1]')
    expect(p39.locator('[data-row-pick="object"]')).to_have_count(2)
    expect(settings(p39).locator('[data-wizard-error]')).to_contain_text('storage_bucket')
    expect(p39.locator('[data-names-empty]')).to_have_text('Fix the marked fields to see names.')
    select(p39, 'services[0].picks[0]').locator('[data-tier]').fill('uploads')
    select(p39, 'services[0].picks[1]').locator('[data-tier]').fill('backups')
    want39 = wizard_names(p39, {
        'project_picks': [{'preset': 'vpc', 'instances': [{'id': '1', 'seq': '03'}]}, {'preset': 'subnet', 'instances': [{'id': '1', 'seq': '01'}]}],
        'services': [{'purpose': 'shop', 'picks': [{'preset': 'object', 'tier': 'uploads'}, {'preset': 'object', 'tier': 'backups'}]}],
    })
    assert screen_names(p39) == want39, (screen_names(p39), want39)
    buckets = [n for k, n, _ in want39 if '/storage_bucket/' in k]
    assert buckets == ['devops-payments-shop-prod-ane3-gcs-uploads', 'devops-payments-shop-prod-ane3-gcs-backups'], buckets
    # 줄 제목은 tier 를 따라간다 · 줄 이름은 그 버킷
    expect(p39.locator('[data-row-pick="object"] [data-row-name]')).to_have_text(buckets)
    # 위치 (D78) — 버킷 pick 의 Location 고르기. 기본은 프로젝트 지역 · 멀티 리전을 고르면 그 코드가 이름에 들고 API 와 같다 · 되돌리면 원래 이름
    loc = select(p39, 'services[0].picks[0]').locator('[data-location]')
    expect(loc).to_have_value('')
    expect(loc.locator('option')).to_have_count(10)
    loc.select_option('us')
    expect(p39.locator('#names article[data-key="service/shop/storage_bucket/-/uploads/-"] [data-name]')).to_have_text('devops-payments-shop-prod-us-gcs-uploads')
    want39l = wizard_names(p39, {
        'project_picks': [{'preset': 'vpc', 'instances': [{'id': '1', 'seq': '03'}]}, {'preset': 'subnet', 'instances': [{'id': '1', 'seq': '01'}]}],
        'services': [{'purpose': 'shop', 'picks': [{'preset': 'object', 'tier': 'uploads', 'location': 'us'}, {'preset': 'object', 'tier': 'backups'}]}],
    })
    assert screen_names(p39) == want39l, (screen_names(p39), want39l)
    loc.select_option('')
    expect(p39.locator('#names article[data-key="service/shop/storage_bucket/-/uploads/-"] [data-name]')).to_have_text('devops-payments-shop-prod-ane3-gcs-uploads')
    # 공용 추가 리소스의 Custom (D84) — 트리는 프로젝트 수준 범위만(VPC 있음 · Cloud SQL 데이터베이스 없음 · 프로젝트 ID 없음)
    select(p39, 'extras').locator('[data-project-chip="custom"]').click()
    dlg = p39.locator('[data-custom-dialog]')
    expect(dlg).to_be_visible()
    expect(dlg.get_by_text('Tick rows to add them to the shared extra resources, each with its own number rows. Untick a row to remove it.')).to_have_count(1)
    expect(dlg.locator('[data-rule="gcp.project_name"]')).to_have_count(0)
    expect(dlg.locator('[data-rule="gcp.vpc_network"]')).to_have_count(1)
    expect(dlg.locator('[data-rule="gcp.cloud_sql_database"]')).to_have_count(0)
    expect(dlg.locator('[data-rule="gcp.project_id"]')).to_have_count(0)
    expect(dlg.locator('details[data-scope][open]')).to_have_count(1)
    # 같은 이름이 될 행은 체크할 수 없고 까닭을 보인다 — ② 네트워크의 VPC 칩과 같은 이름(D95 · duplicate_pick)
    dlg.locator('[data-tree-search]').fill('vpc_network')
    expect(row(p39, 'vpc_network').locator('input[data-row-check]')).to_be_disabled()
    expect(row(p39, 'vpc_network').locator('[data-add-blocked]')).to_have_text('A resource here already gets this name — remove it or change its tier first')
    dlg.locator('[data-tree-search]').fill('pubsub_topic')
    row(p39, 'pubsub_topic').locator('input[data-row-check]').check()
    dlg.locator('[data-custom-close]').click()
    expect(dlg).to_have_count(0)
    expect(settings(p39)).to_have_attribute('data-pick-path', 'projectPicks[2]')
    expect(p39.locator('[data-settings] [data-pick-path^="projectPicks"][data-pick="custom"]')).to_have_count(1)
    # custom pick 은 「Shared extra resources」 줄 아래 · 프리셋 pick 은 ② 네트워크 줄 아래 (D84) — 고른 줄이 서비스 밖이라 서비스는 접혀 있다
    # 네트워크 pick 줄은 네트워크를 고를 때만 펴진다(D93) — 여기서는 접혀 있다
    rows39 = p39.locator('[data-row-path]').evaluate_all('els => els.map(e => e.dataset.rowPath)')
    assert rows39 == ['project', 'network', 'services[0]', 'extras', 'projectPicks[2]'], rows39
    expect(p39.locator('#names article[data-key^="project/-/pubsub_topic/"]')).to_have_count(1)
    expect(p39.locator('#names article[data-key^="project/-/pubsub_topic/"]')).to_have_attribute('data-valid', 'true')
    no_hangul(p39)
    # 목록 상한(40) — 서비스에 pick 이 40 이면 Custom 창의 행을 체크할 수 없고 까닭을 보인다 (D95)
    full_body = {'owner': 'platform', 'system': 'billing', 'env': 'prod', 'region': 'ane3', 'v': rules_version,
                 'w': {'pp': [], 's': [{'n': 'shop', 'p': [{'ru': 'gcp.storage_bucket', 't': f't{i:02d}'} for i in range(40)]}]}}
    full_hash = '#state=' + base64.urlsafe_b64encode(json.dumps(full_body, separators=(',', ':')).encode()).rstrip(b'=').decode()
    goto_ready(p39, BASE + '/?v' + full_hash)
    goto_ready(p39, BASE + '/' + full_hash)
    svc(p39, 0).locator('[data-purpose-chip="custom"]').click()
    dlg.locator('[data-tree-search]').fill('compute_instance')
    expect(row(p39, 'compute_instance').locator('input[data-row-check]')).to_be_disabled()
    expect(row(p39, 'compute_instance').locator('[data-add-blocked]')).to_have_text('Up to 40 resources here — untick one or remove one to add another')
    # 이미 고른 행(버킷)은 풀 수 있다 — 풀면 그 규칙의 custom pick 이 모두 지워진다
    dlg.locator('[data-tree-search]').fill('storage_bucket')
    expect(row(p39, 'storage_bucket').locator('input[data-row-check]')).to_be_enabled()
    dlg.locator('[data-custom-done]').click()
    expect(dlg).to_have_count(0)
    # 모델은 VPC 여럿을 받는다(API 로 만든 계획 · 손으로 만든 링크) — 줄이 둘(01 · 03)이면 둘 다 보이고 더하기 단추도 보인다
    two_body = {'owner': 'platform', 'system': 'billing', 'env': 'prod', 'region': 'ane3', 'v': rules_version,
                'w': {'pp': [{'pr': 'vpc', 'i': [{'id': 'a', 'q': '01'}, {'id': 'b', 'q': '03'}]},
                             {'pr': 'subnet', 'i': [{'id': 'c', 'q': '01'}, {'id': 'd', 'q': '02'}]}], 's': []}}
    two_vpc = '#state=' + base64.urlsafe_b64encode(json.dumps(two_body, separators=(',', ':')).encode()).rstrip(b'=').decode()
    goto_ready(p39, BASE + '/?v' + two_vpc)
    goto_ready(p39, BASE + '/' + two_vpc)
    vpc2 = select(p39, 'projectPicks[0]')
    expect(vpc2.locator('li[data-slot]')).to_have_count(2)
    expect(vpc2.locator('[data-add-slot]')).to_have_count(1)
    keys = [k for k, _, _ in screen_names(p39)]
    assert keys == ['project/-/project_id/-/-/-', 'project/-/vpc_network/-/-/01', 'project/-/vpc_network/-/-/03', 'project/-/subnet/-/-/01', 'project/-/subnet/-/-/02'], keys
    ctx39.close()

    # ── ㊷ 3차 (D84~D88) — 화면 순서 · 프로젝트 이름 · ID 접미사 · Add subnet · 방화벽 직접 입력 · NAT 와 Router 는 따로 · psa 종류 칸 없음 · tier 입력 포커스 · 키보드(D89) ──
    ctx42 = browser.new_context(viewport={'width': 1280, 'height': 900})
    p42 = ctx42.new_page()
    p42.on('pageerror', lambda e: errors.append(str(e)))
    start_example(p42)
    # 순서 — 클라우드 배지가 세 칸 위 · 목록의 머리 줄은 Project → 네트워크 → 서비스 → 공용 추가 리소스 · 이름은 오른쪽 칸(번호 없음 — D93)
    assert p42.locator('[data-wizard-cloud]').bounding_box()['y'] < p42.locator('[data-wizard-layout]').bounding_box()['y']
    heads = p42.locator('[data-row-path][aria-level="1"]').evaluate_all('els => els.map(e => e.dataset.rowPath)')
    assert heads == ['project', 'network', 'services[0]', 'extras'], heads
    expect(p42.locator('[data-names-column] #wizard-names')).to_have_text('Names')
    clear_network(p42)
    fill_project(p42)
    svc(p42, 0).locator('[data-service-name]').fill('shop')
    # 프로젝트 이름은 ID 위 · 접미사는 ID 에만 · 예약어는 칸에 오류 · 빈 칸이면 원래 ID
    select(p42, 'project')
    expect(p42.locator('[data-project-preview] dt')).to_have_text(['Project name', 'Project ID', 'Every name carries'])
    expect(p42.locator('[data-project-name]')).to_have_text('devops-payments-prod')
    p42.fill('[data-project-id-suffix]', 'team1')
    expect(p42.locator('[data-project-id]')).to_have_text('devops-payments-prod-team1')
    expect(p42.locator('[data-project-name]')).to_have_text('devops-payments-prod')
    p42.fill('[data-project-id-suffix]', 'db')
    expect(p42.locator('#wizard-project-id-suffix-error')).to_contain_text("Project ID suffix 'db' is reserved")
    expect(p42.locator('[data-row-path="project"] [data-row-errors]')).to_have_text('!1')
    p42.fill('[data-project-id-suffix]', '')
    expect(p42.locator('[data-project-id]')).to_have_text('devops-payments-prod')
    expect(p42.locator('[data-project-id-notice]')).to_contain_text('Cloudonym cannot check whether this ID is free')
    # 서브넷 둘 — Add subnet 은 새 줄을 고른다 · 둘째는 따로 종류 · tier · 줄 제목 · 칩은 눌린 채 · tier 를 치는 동안 포커스가 남는다
    net42 = select(p42, 'network')
    net42.locator('[data-project-chip="subnet"]').click()
    net42.locator('[data-add-subnet]').click()
    expect(settings(p42)).to_have_attribute('data-pick-path', 'projectPicks[1]')
    expect(p42.locator('[data-row-pick="subnet"]')).to_have_count(2)
    settings(p42).locator('[data-kind]').select_option('REGIONAL_MANAGED_PROXY')
    t42 = settings(p42).locator('[data-tier]')
    t42.click()
    p42.keyboard.type('edge')
    expect(t42).to_have_value('edge')
    assert p42.evaluate("document.activeElement.hasAttribute('data-tier')")
    expect(p42.locator('[data-row-pick="subnet"] [data-row-title]')).to_have_text(['Subnet', 'Subnet · proxy · edge'])
    expect(select(p42, 'network').locator('[data-project-chip="subnet"]')).to_have_attribute('aria-pressed', 'true')
    # 서비스 pick 의 tier 칸도 포커스가 남는다
    svc(p42, 0).locator('[data-purpose-chip="object"]').click()
    ot = select(p42, 'services[0].picks[0]').locator('[data-tier]')
    ot.click()
    p42.keyboard.type('uploads')
    expect(ot).to_have_value('uploads')
    assert p42.evaluate("document.activeElement.hasAttribute('data-tier')")
    # 방화벽 — iap · lbhc 칩의 title · 직접 입력(예약어는 단추가 꺼진다 · 통과하면 규칙 하나 · 그 줄이 선택된다)
    net42 = select(p42, 'network')
    expect(net42.locator('[data-project-chip="firewall-iap"]')).to_have_attribute('title', re.compile('35.235.240.0/20'))
    expect(net42.locator('[data-project-chip="firewall-lbhc"]')).to_have_attribute('title', re.compile('35.191.0.0/16'))
    net42.locator('[data-firewall-tier]').fill('db')
    expect(net42.locator('[data-firewall-tier-add]')).to_be_disabled()
    net42.locator('[data-firewall-tier]').fill('app')
    net42.locator('[data-firewall-tier-add]').click()
    expect(settings(p42)).to_have_attribute('data-pick-path', 'projectPicks[2]')
    expect(settings(p42).locator('[data-pick="firewall"] h2')).to_have_text('Firewall rule · app')
    expect(select(p42, 'network').locator('[data-firewall-tier]')).to_have_value('')
    # NAT 와 Router 는 따로 켜고 끈다 · NAT 에 안내 한 줄 · 칩은 선택을 옮기지 않는다
    net42.locator('[data-project-chip="nat"]').click()
    expect(settings(p42)).to_have_attribute('data-pick-path', 'network')
    expect(net42.locator('[data-project-chip="router"]')).to_have_attribute('aria-pressed', 'false')
    expect(select(p42, 'projectPicks[3]').locator('[data-nat-hint]')).to_have_count(1)
    net42 = select(p42, 'network')
    net42.locator('[data-project-chip="router"]').click()
    net42.locator('[data-project-chip="router"]').click()
    expect(net42.locator('[data-project-chip="nat"]')).to_have_attribute('aria-pressed', 'true')
    # psa — 종류 칸 없음 (고정 INTERNAL)
    net42.locator('[data-project-chip="psa"]').click()
    expect(select(p42, 'projectPicks[4]').locator('[data-pick="psa"] [data-kind]')).to_have_count(0)
    one42 = [{'id': '1', 'seq': '01'}]
    want42 = wizard_names(p42, {
        'project_picks': [{'preset': 'subnet', 'instances': one42}, {'preset': 'subnet', 'kind': 'REGIONAL_MANAGED_PROXY', 'tier': 'edge', 'instances': one42},
                          {'preset': 'firewall', 'tier': 'app', 'instances': one42}, {'preset': 'nat', 'instances': one42}, {'preset': 'psa', 'instances': one42}],
        'services': [{'purpose': 'shop', 'picks': [{'preset': 'object', 'tier': 'uploads'}]}],
    })
    assert screen_names(p42) == want42, (screen_names(p42), want42)
    assert [n for _, n, _ in want42][1:6] == ['payments-prod-ane3-snet-01', 'payments-prod-ane3-snet-proxy-edge-01', 'payments-prod-fw-app-01', 'payments-prod-nat-01', 'payments-prod-ip-int-psa-01'], want42
    # 줄 이름 = 그 pick 의 이름 (네트워크 다섯 — 고른 줄이 네트워크 pick 이라 펴져 있다)
    select(p42, 'network')
    assert p42.locator('[data-row-path^="projectPicks"] [data-row-name]').all_inner_texts() == [n for _, n, _ in want42][1:6]
    # 서브넷 칩을 끄면 둘 다 떨어진다
    select(p42, 'network').locator('[data-project-chip="subnet"]').click()
    expect(p42.locator('[data-row-pick="subnet"]')).to_have_count(0)
    # 키보드 (D89) — ↑↓ 로 옮기면 선택이 따라간다 · Enter 는 설정 칸 첫 컨트롤로 · Esc 는 고른 줄로 · ←/→ 는 서비스 줄을 접고 편다
    focused = "document.activeElement.getAttribute('data-row-path')"
    p42.locator('[data-row-path="project"]').click()
    p42.keyboard.press('ArrowDown')
    expect(settings(p42)).to_have_attribute('data-pick-path', 'network')
    p42.wait_for_function(f"{focused} === 'network'")
    p42.keyboard.press('ArrowDown')
    expect(settings(p42)).to_have_attribute('data-pick-path', 'projectPicks[0]')
    expect(p42.locator('[data-row-path="projectPicks[0]"]')).to_have_attribute('aria-selected', 'true')
    p42.keyboard.press('ArrowUp')
    expect(settings(p42)).to_have_attribute('data-pick-path', 'network')
    p42.keyboard.press('Enter')
    p42.wait_for_function("!!document.activeElement.closest('[data-settings]')")
    p42.keyboard.press('Escape')
    p42.wait_for_function(f"{focused} === 'network'")
    p42.locator('[data-row-path="services[0]"]').click()
    expect(p42.locator('[data-row-path="services[0]"]')).to_have_attribute('aria-expanded', 'true')
    p42.keyboard.press('ArrowLeft')
    expect(p42.locator('[data-row-path="services[0]"]')).to_have_attribute('aria-expanded', 'false')
    expect(p42.locator('[data-row-path="services[0].picks[0]"]')).to_have_count(0)
    p42.keyboard.press('ArrowRight')
    expect(p42.locator('[data-row-path="services[0]"]')).to_have_attribute('aria-expanded', 'true')
    p42.keyboard.press('ArrowRight')
    expect(settings(p42)).to_have_attribute('data-pick-path', 'services[0].picks[0]')
    p42.wait_for_function(f"{focused} === 'services[0].picks[0]'")
    p42.keyboard.press('ArrowLeft')
    expect(settings(p42)).to_have_attribute('data-pick-path', 'services[0]')
    no_hangul(p42)
    ctx42.close()

    # ── ㊶ 버킷 「Check」 (D83) — 누를 때만 브라우저가 storage.googleapis.com 에 직접 묻는다 · 404 available · 401 taken · 실패 unknown · 이름은 Cloudonym 에 가지 않는다 ──
    ctx41 = browser.new_context(viewport={'width': 1280, 'height': 900})
    p41 = ctx41.new_page()
    p41.on('pageerror', lambda e: errors.append(str(e)))
    gcs_calls, own_calls = [], []
    p41.on('request', lambda r: gcs_calls.append(r.url) if r.url.startswith('https://storage.googleapis.com/') else (own_calls.append((r.url, r.post_data or '')) if r.url.startswith(BASE) else None))
    purpose = 'chk' + str(int(time.time()))[-7:]
    goto_ready(p41, BASE + '/' + bucket_link(rules_version, purpose))
    # 네트워크 없는 링크(pp: [])는 빈 채 연다 — 다시 채우지 않는다 (D90)
    expect(p41.locator('[data-row-path^="projectPicks"]')).to_have_count(0)
    card = p41.locator('#names article[data-rule="gcp.storage_bucket"]')
    expect(card).to_have_count(1)
    bucket_name = card.locator('[data-name]').inner_text()
    expect(card.locator('[data-check-bucket]')).to_have_text('Check')
    expect(card.locator('[data-bucket-verdict]')).to_have_text('Asks Cloud Storage directly from your browser; Cloudonym never sees the name.')
    expect(p41.locator('[data-check-bucket]')).to_have_count(1)  # 프로젝트 ID 카드에는 없다
    p41.wait_for_timeout(300)
    assert gcs_calls == [], gcs_calls  # 누르기 전에는 묻지 않는다
    card.locator('[data-check-bucket]').click()  # 실제 요청 — 없는 이름이라 404 · CORS 로 상태 코드를 읽는다
    expect(card.locator('[data-bucket-verdict="available"]')).to_have_text('Available — no bucket has this name right now.', timeout=15000)
    assert gcs_calls == [f'https://storage.googleapis.com/storage/v1/b/{bucket_name}?fields=name'], gcs_calls
    p41.route('https://storage.googleapis.com/storage/v1/b/**', lambda route: route.fulfill(status=401, headers={'access-control-allow-origin': BASE}, body='{}'))
    card.locator('[data-check-bucket]').click()
    expect(card.locator('[data-bucket-verdict="taken"]')).to_have_text('Taken — a bucket with this name already exists.')
    p41.unroute('https://storage.googleapis.com/storage/v1/b/**')
    p41.route('https://storage.googleapis.com/storage/v1/b/**', lambda route: route.abort())
    card.locator('[data-check-bucket]').click()
    expect(card.locator('[data-bucket-verdict="unknown"]')).to_have_text('Could not tell — the request failed. Try again later.')
    # 이름이 바뀌어도 카드가 그대로인 화면(/pick — 카드 키가 리소스 종류다)에서 — A → B → A 에서 옛 판정이 다시 보이지 않고,
    # A 를 묻는 중에 A → B → A 로 바꾸고 다시 물으면 새 응답(401 taken)이 먼저 · 옛 응답(404)이 나중에 와도 taken 이 남는다 (codex 리뷰)
    goto_ready(p41, BASE + TREE + state_hash({**INPUT, 'owner': 'example'}, rules_version, 'gcp', {'storage_bucket': 1}))
    pcard = p41.locator('article[data-rule="gcp.storage_bucket"]')
    expect(pcard).to_have_count(1)
    pname = pcard.locator('[data-name]').inner_text()
    pcard.locator('[data-check-bucket]').click()
    expect(pcard.locator('[data-bucket-verdict="unknown"]')).to_have_count(1)  # 위의 abort 경로가 그대로다
    p41.fill('#field-owner', 'examplb')
    expect(pcard.locator('[data-name]')).not_to_have_text(pname)
    p41.fill('#field-owner', 'example')
    expect(pcard.locator('[data-name]')).to_have_text(pname)
    expect(pcard.locator('[data-bucket-verdict]')).to_have_attribute('data-bucket-verdict', '')
    p41.unroute('https://storage.googleapis.com/storage/v1/b/**')
    held = []
    p41.route('https://storage.googleapis.com/storage/v1/b/**', lambda route: held.append(route))
    pcard.locator('[data-check-bucket]').click()
    expect(pcard.locator('[data-check-bucket]')).to_have_text('Checking…')
    p41.fill('#field-owner', 'examplb')
    p41.fill('#field-owner', 'example')
    expect(pcard.locator('[data-check-bucket]')).to_have_text('Check')
    pcard.locator('[data-check-bucket]').click()
    for _ in range(50):
        if len(held) == 2:
            break
        p41.wait_for_timeout(100)
    assert len(held) == 2, held
    held[1].fulfill(status=401, headers={'access-control-allow-origin': BASE}, body='{}')
    expect(pcard.locator('[data-bucket-verdict="taken"]')).to_have_count(1)
    old_req = held[0].request
    with p41.expect_event('requestfinished', predicate=lambda r: r == old_req):
        held[0].fulfill(status=404, headers={'access-control-allow-origin': BASE}, body='{}')
    # 옛 응답의 then(setState) 와 React 의 다시 그리기가 끝날 때까지 — 마이크로태스크 · 다음 프레임 · 매크로태스크를 지나게 한다
    p41.evaluate('() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 50)))')
    expect(pcard.locator('[data-bucket-verdict]')).to_have_attribute('data-bucket-verdict', 'taken')
    p41.unroute('https://storage.googleapis.com/storage/v1/b/**')
    p41.wait_for_timeout(1500)  # 디바운스된 비콘까지 기다린다
    leaked = [(u, d) for u, d in own_calls if any(w in u or w in d for w in (bucket_name, purpose, pname))]  # ui_generate 는 규칙 id 만 싣는다
    assert leaked == [], leaked
    no_hangul(p41)
    ctx41.close()
    wizard_selection_focus(browser, errors)
    wizard_narrow(browser, errors)
    wizard_cards(browser, errors)
    theme_modes(browser, errors)
    wizard_sample(browser, errors)
    wizard_first_visit(browser, rules_version, errors)
    api_doc(browser, errors)
    plan_file(browser, rules_version, errors)
    header_menu(browser, errors)
    about_page(browser, errors)
    print('OK — 마법사 시나리오 ㉚~㊼ · 화면 모드 ㊽ · 첫 방문 ㊾ ㊿ · API 안내 (51) · 계획 파일 (52) · More 메뉴 (53) · 첫 방문 예시 (54) · About (55) 통과')


def about_page(browser, errors):
    """(55) /about (D109) — 200 · 제목 · 절 머리 일곱 · 예시 세 줄 · 저장소 링크(평범한 a · github.com 요청 없음) · 1280 · 360 스크린샷 · 가로 스크롤 없음 ·
    /pick 의 More → About 이 상태 hash 를 싣고 간다 · 문서 쪽(More 메뉴 없음)은 푸터의 About · 모르는 하위 경로는 404"""
    for width, height, shot_name in ((1280, 900, 'about-1280.png'), (360, 800, 'about-360.png')):
        ctx = browser.new_context(viewport={'width': width, 'height': height})
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(str(e)))
        outside = []
        pg.on('request', lambda r: outside.append(r.url) if 'github.com' in r.url else None)
        resp = pg.goto(BASE + '/about', wait_until='networkidle')
        assert resp is not None and resp.status == 200, resp and resp.status
        assert pg.title() == 'Cloudonym — About', pg.title()
        expect(pg.locator('h1')).to_have_text('About')
        expect(pg.locator('[data-about] h2')).to_have_text(['What it is', 'What goes in and what comes out', 'What it checks and what it does not',
                                                           'Source and license', 'Project status', 'Versions', 'More pages'])
        expect(pg.locator('[data-about] [data-intro-example-row]')).to_have_count(3)
        expect(pg.locator('[data-about] [data-intro-example-pass]')).to_have_count(3)
        expect(pg.locator('[data-about-repo]')).to_have_attribute('href', 'https://github.com/uranos-studio/cloudonym')
        expect(pg.locator('[data-about-repo]')).to_have_text('github.com/uranos-studio/cloudonym')
        expect(pg.locator('[data-about-license]')).to_have_text('Cloudonym is licensed under the Apache License 2.0.')
        expect(pg.locator('[data-about-notice]')).to_contain_text('NOTICE file (Apache License 2.0, section 4)')
        expect(pg.locator('[data-about-status]')).to_contain_text('independent open-source project created and maintained by Sungjae Yun')
        expect(pg.locator('[data-about] [data-pass-meaning]')).to_contain_text('PASS / `valid: true` means')
        expect(pg.locator('[data-about] [data-nothing-created]')).to_contain_text('nothing is created in Google Cloud')
        expect(pg.locator('[data-about-version]')).to_contain_text(f'rules revision {RULES_OF(pg)}')
        expect(pg.locator('[data-about-links] a')).to_have_text(['Privacy', 'Naming guide', 'API', 'llms.txt'])
        expect(pg.locator('[data-footer-about]')).to_have_attribute('href', '/about')
        assert outside == [], outside  # 쪽을 여는 동안 github.com 에 요청이 없다
        no_hangul(pg)
        no_hscroll(pg, width, '/about')
        pg.mouse.move(0, 0)
        pg.screenshot(path=str(OUT / shot_name), full_page=True, animations='disabled', caret='hide')
        ctx.close()
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    link = state_hash(INPUT)
    goto_ready(pg, BASE + TREE + link)
    expect(pg.locator('header [data-nav-about]')).to_have_attribute('href', '/about' + link)
    open_more(pg)
    pg.locator('header [data-nav-about]').click()
    pg.wait_for_url(BASE + '/about' + link)
    expect(pg.locator('h1')).to_have_text('About')
    expect(pg.locator('[data-back-to-app]')).to_have_attribute('href', '/' + link)
    goto_ready(pg, BASE + '/privacy')
    expect(pg.locator('header [data-nav-more]')).to_have_count(0)
    pg.locator('[data-footer-about]').click()
    pg.wait_for_url(BASE + '/about')
    resp = pg.goto(BASE + '/about/x', wait_until='networkidle')
    assert resp is not None and resp.status == 404, resp and resp.status
    ctx.close()


def wizard_selection_focus(browser, errors):
    """㊸ 선택 · 펼침 · 포커스 (D89 독립 리뷰) — 서비스를 지운 뒤의 선택과 펼침 상태"""
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    start_example(pg)
    # 서비스 셋(A · B · C) — B 만 손으로 펴고 A 를 지우면 B 가 펴진 채 · C 는 접힌 채다(펼침이 자리 번호로 옮겨 붙지 않는다)
    pg.click('[data-add-service]')
    pg.click('[data-add-service]')
    pg.locator('[data-row-path="services[1]"] [data-row-toggle]').click()
    svc(pg, 0).locator('[data-remove-service]').click()
    expect(settings(pg)).to_have_attribute('data-pick-path', 'services[0]')
    expect(pg.locator('[data-row-path="services[0]"]')).to_have_attribute('aria-expanded', 'true')
    expect(pg.locator('[data-row-path="services[1]"]')).to_have_attribute('aria-expanded', 'false')
    # 마지막 서비스를 지우면 이전 서비스 · 하나 남은 것을 지우면 project
    svc(pg, 1).locator('[data-remove-service]').click()
    expect(settings(pg)).to_have_attribute('data-pick-path', 'services[0]')
    # Duplicate 는 원본 바로 뒤에 끼운다 — 강조되는 줄도 끝 줄이 아니라 끼운 줄이다.
    # 키보드로 눌러도 포커스가 새 설정 칸에 남아 Esc 로 그 줄에 돌아간다(칸이 새로 그려져도 body 로 떨어지지 않는다)
    select(pg, 'projectPicks[1]').locator('[data-duplicate-pick]').focus()
    pg.keyboard.press('Enter')
    expect(settings(pg)).to_have_attribute('data-pick-path', 'projectPicks[2]')
    assert pg.evaluate("!!document.activeElement.closest('[data-settings]')"), pg.evaluate('document.activeElement.outerHTML')
    pg.keyboard.press('Escape')
    expect(pg.locator('[data-row-path="projectPicks[2]"]')).to_be_focused()
    expect(pg.locator('[data-row-path="projectPicks[2]"]')).to_have_attribute('data-flash', 'true')
    expect(pg.locator('[data-row-path="projectPicks[4]"]')).to_have_attribute('data-flash', 'false')
    # 더한 뒤 1.2초 안에 값을 고쳐도 강조는 꺼진다(타이머가 계획이 아니라 강조에 묶인다)
    select(pg, 'network').locator('[data-add-subnet]').focus()
    pg.keyboard.press('Enter')
    expect(settings(pg)).to_have_attribute('data-pick-path', 'projectPicks[5]')
    assert pg.evaluate("!!document.activeElement.closest('[data-settings]')"), pg.evaluate('document.activeElement.outerHTML')
    settings(pg).locator('[data-tier]').fill('edge')
    expect(pg.locator('[data-flash="true"]')).to_have_count(0, timeout=3000)
    # 서비스 안의 pick 을 고른 채 서비스를 접으면 — 서비스 줄이 골라지고(포커스도) 접힌다
    svc(pg, 0).locator('[data-purpose-chip="web"]').click()
    select(pg, 'services[0].picks[0]')
    pg.locator('[data-row-path="services[0]"] [data-row-toggle]').click()
    expect(pg.locator('[data-row-path="services[0]"]')).to_have_attribute('aria-expanded', 'false')
    expect(settings(pg)).to_have_attribute('data-pick-path', 'services[0]')
    expect(pg.locator('[data-row-path="services[0]"]')).to_be_focused()
    no_hangul(pg)
    ctx.close()

# 카드 (D93) — website 카드가 더하는 pick. 방화벽 web · lbhc 와 db 의 psa 는 프로젝트 공용(네트워크)이다
ONE = [{'id': '1', 'seq': '01'}]
WEBSITE_SVC = ['web', 'ig', 'hc', 'bs', 'ip', 'url', 'cert', 'thps', 'fwd', 'urlredir', 'thp', 'fwdredir']
NETWORK4 = ['vpc', 'subnet', 'router', 'nat']


def preset_pick(pr, tier=None):
    """POST /v1/wizard 의 pick — 버킷 · 서비스 계정처럼 입력 없는 규칙이 아니면 서버 줄 하나(01)"""
    body = {'preset': pr, **({'tier': tier} if tier else {})}
    return body if pr in ('object', 'sa') else {**body, 'instances': ONE}


def wizard_cards(browser, errors):
    """㊺ 카드 (D93) — 비전문가 과제 ⑴(회사 홈페이지: 웹 서버 + DB + HTTPS → Terraform)를 카드로 · 클릭 수를 센다 · 화면 이름 = POST /v1/wizard ·
    부품을 빼면 미완성 · 빠진 부품 더하기 · 카드를 지워도 방화벽은 남는다 · 한 서비스에 LB 카드 하나 · 둘째 서비스의 같은 카드는 방화벽을 다시 더하지 않는다.
    ㊻ 첫 방문 안내 — 닫으면 새로 열어도 닫힌 채. ㊼ 카드 화면의 가로 스크롤 없음(360 · 390 · 768)"""
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=BASE)
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    start_example(pg)
    clicks = 0
    # 과제 ⑴ — 첫 화면은 서비스(shop)가 골라져 있고 갤러리가 보인다. 입력 셋(서비스 이름 · owner · system) + 클릭: Website Add · Project 줄 · Terraform
    expect(settings(pg)).to_have_attribute('data-pick-path', 'services[0]')
    pg.fill('[data-service-name]', 'site')
    card = settings(pg).locator('[data-card="website"]')
    expect(card.locator('[data-card-option="db"]')).to_be_checked()  # DB 는 기본으로 켜져 있다
    expect(card.locator('[data-card-names]')).to_have_text('16 names')
    expect(card.locator('[data-card-evidence]')).to_have_text('Built and tested on Google Cloud')
    card.locator('[data-card-add="website"]').click(); clicks += 1
    # 더하면 카드 줄이 골라지고 점검표가 열린다 — 완성 12/12 · 네트워크에 방화벽 web · lbhc
    expect(settings(pg)).to_have_attribute('data-pick-path', 'services[0].card.website')
    panel = settings(pg).locator('[data-card-panel="website"]')
    expect(panel.locator('h2 [data-card-state]')).to_have_text('complete · 12 of 12 parts')
    expect(panel.locator('[data-card-parts] [data-card-part]')).to_have_count(12)
    expect(panel.locator('[data-card-network] [data-card-part]')).to_have_count(2)
    expect(panel.locator('[data-card-setup]')).to_have_count(0)  # website 는 이름 없는 설정 안내가 없다 (D96)
    expect(pg.locator('[data-row-path="services[0].card.website"] [data-card-state]')).to_have_text('complete')
    pg.locator('[data-row-path="project"]').click(); clicks += 1
    pg.fill('#wizard-owner', 'acme')
    pg.fill('#wizard-system', 'homepage')
    panel = select(pg, 'services[0].card.website').locator('[data-card-panel="website"]')
    want = wizard_names(pg, {'project': {'owner': 'acme', 'system': 'homepage', 'env': 'prod', 'region': 'asia-northeast3'},
                             'project_picks': [preset_pick(x) for x in NETWORK4] + [preset_pick('firewall', 'web'), preset_pick('firewall', 'lbhc'), preset_pick('psa')],
                             'services': [{'purpose': 'site', 'picks': [preset_pick(x) for x in WEBSITE_SVC + ['db']]}]})
    assert len(want) == 1 + 7 + 13 and all(v for _, _, v in want), want
    assert screen_names(pg) == want, (screen_names(pg), want)
    expect(pg.locator('[data-names-summary]')).to_have_text('21 names · 21/21 PASS')
    # 점검표의 이름 = 엔진 이름 (그 줄의 첫 이름)
    names = {k: n for k, n, _ in want}
    expect(panel.locator('[data-card-part="hc"] [data-card-part-name]')).to_have_text(names['service/site/health_check/-/-/01'])
    expect(panel.locator('[data-card-part="firewall:lbhc"] [data-card-part-name]')).to_have_text(names['project/-/firewall_rule/-/lbhc/01'])
    pg.click('[data-copy="terraform"]'); clicks += 1
    hcl = pg.evaluate('navigator.clipboard.readText()')
    assert '"service/site/backend_service/-/-/01" = "' in hcl and '"project/-/firewall_rule/-/lbhc/01" = "' in hcl, hcl
    # 과제 ⑴ 의 클릭 수 — 전(칩 경로) 18 · 카드 경로는 아래 값 (review.md · plan.md 1절의 재측정)
    assert clicks == 3, clicks
    print('㊺ 과제 ⑴ 1280 — 클릭', clicks, '· 입력 3 · 이름', len(want))
    wizard_shot(pg, '09-wizard-card.png')

    # 부품을 빼면 미완성 — 빠진 부품 · LB 가 응답하지 않는다는 안내 · 목록 줄도 incomplete · 이름은 엔진이 그대로 낸다(카드를 모른다)
    panel.locator('[data-card-part="hc"] input').uncheck()
    expect(panel.locator('h2 [data-card-state]')).to_have_text('incomplete · 11 of 12 parts')
    expect(panel.locator('[data-card-warning]')).to_have_text('Missing: Health check. The load balancer does not serve without them.Add missing parts')
    expect(pg.locator('[data-row-path="services[0].card.website"] [data-card-state]')).to_have_text('incomplete')
    expect(pg.locator('[data-names-summary]')).to_have_text('20 names · 20/20 PASS')
    panel.locator('[data-card-fill]').click()
    expect(panel.locator('h2 [data-card-state]')).to_have_text('complete · 12 of 12 parts')
    # 네트워크의 lbhc 를 끄면 카드가 미완성으로 말한다 (D91 — 헬스 체크 대역을 받지 못하면 LB 가 응답하지 않는다)
    select(pg, 'network').locator('[data-project-chip="firewall-lbhc"]').click()
    pg.locator('[data-row-path="services[0]"] [data-row-toggle]').click()  # 네트워크를 고른 채 서비스를 손으로 편다
    expect(pg.locator('[data-row-path="services[0].card.website"] [data-card-state]')).to_have_text('incomplete')
    select(pg, 'services[0].card.website')
    expect(settings(pg).locator('[data-card-warning]')).to_contain_text('Missing: Firewall rule · lbhc.')
    settings(pg).locator('[data-card-fill]').click()
    expect(settings(pg).locator('h2 [data-card-state]')).to_have_text('complete · 12 of 12 parts')
    # 점검표의 Edit — 그 pick 줄이 골라지고 카드 줄 아래 부품 줄이 펴진다 · ← 는 카드 줄로
    cert_path = settings(pg).locator('[data-card-part-edit="cert"]').get_attribute('data-edit-path')
    settings(pg).locator('[data-card-part-edit="cert"]').click()
    expect(settings(pg)).to_have_attribute('data-pick-path', cert_path)
    expect(settings(pg).locator('[data-pick="cert"]')).to_have_count(1)
    expect(pg.locator('[data-row-path="services[0].card.website"]')).to_have_attribute('aria-expanded', 'true')
    expect(pg.locator(f'[data-row-path="{cert_path}"]')).to_have_attribute('aria-level', '3')
    pg.locator(f'[data-row-path="{cert_path}"]').focus()
    pg.keyboard.press('ArrowLeft')
    expect(settings(pg)).to_have_attribute('data-pick-path', 'services[0].card.website')
    expect(pg.locator(f'[data-row-path="{cert_path}"]')).to_have_count(0)
    # 한 서비스에 LB 카드는 하나 — 다른 LB 카드는 꺼지고 까닭을 말한다 · 이미 있는 카드는 Open
    gal = svc(pg, 0)
    expect(gal.locator('[data-card-add="serverless-web"]')).to_be_disabled()
    expect(gal.locator('[data-card="serverless-web"] [data-card-blocked]')).to_have_text('This service already has a load balancer. Add another service for a second one.')
    expect(gal.locator('[data-card-open="website"]')).to_have_count(1)
    # 칩은 「Add more」 접힌 칸 안 — 뜻이 앞, 약어가 뒤
    expect(gal.locator('details[data-add-more]')).to_have_attribute('open', '')
    expect(gal.locator('[data-purpose-chip="thps"]')).to_have_text('Target HTTPS proxythps')
    # 카드를 지우면 서비스 부품만 — DB(선택)와 네트워크(방화벽 · psa)는 남는다
    select(pg, 'services[0].card.website').locator('[data-card-remove]').click()
    expect(settings(pg)).to_have_attribute('data-pick-path', 'services[0]')
    expect(pg.locator('[data-row-path^="services[0].card."]')).to_have_count(0)
    assert pg.locator('[data-row-path^="services[0].picks"]').evaluate_all('els => els.map(e => e.dataset.rowPick)') == ['db']
    keys = [k for k, _, _ in screen_names(pg)]
    assert 'project/-/firewall_rule/-/web/01' in keys and 'project/-/firewall_rule/-/lbhc/01' in keys and 'project/-/global_address/int/psa/01' in keys, keys
    # 둘째 서비스에 같은 카드 — 방화벽은 다시 더하지 않는다(방화벽 하나가 둘을 받는다) · 이름 충돌 없음
    svc(pg, 0).locator('[data-card-add="website"]').click()
    before = pg.locator('#names article[data-key^="project/"]').count()
    pg.click('[data-add-service]')
    settings(pg).locator('[data-service-name]').fill('blog')
    settings(pg).locator('[data-card="website"] [data-card-option="db"]').uncheck()
    settings(pg).locator('[data-card-add="website"]').click()
    expect(settings(pg)).to_have_attribute('data-pick-path', 'services[1].card.website')
    expect(pg.locator('#names article[data-key^="project/"]')).to_have_count(before)
    expect(pg.locator('[data-conflicts]')).to_have_count(0)
    n, ok = names_counts(pg)
    assert n == ok, (n, ok)
    # https-lb — 백엔드가 없는 서비스에 더하면 「백엔드 없음」 · Cloud Run 을 켜면 Serverless web 으로 되읽힌다
    pg.click('[data-add-service]')
    settings(pg).locator('[data-service-name]').fill('edge')
    settings(pg).locator('[data-card-add="https-lb"]').click()
    expect(settings(pg).locator('[data-card-warning]')).to_have_text('No backend — add Website, Serverless web or Static site, or a Web server, Cloud Run service or Object storage chip. Internal servers, worker services and landing buckets stay private.')
    svc(pg, 2).locator('[data-purpose-chip="run"]').click()
    expect(pg.locator('[data-row-path^="services[2].card."]')).to_have_attribute('data-row-card', 'serverless-web')
    select(pg, 'services[2].card.serverless-web').locator('[data-card-fill]').click()
    expect(settings(pg).locator('h2 [data-card-state]')).to_have_text('complete · 11 of 11 parts')
    expect(settings(pg).locator('[data-card-part="hc"]')).to_have_count(0)  # 서버리스 NEG 에는 헬스 체크가 없다
    # 이름이 없는 설정 안내 (D96) — 점검표에만 · 공식 문서 링크 · 실제로 만들어 본 카드
    setup = settings(pg).locator('[data-card-setup="serverless-web"]')
    expect(setup).to_contain_text('the Cloud Run service must accept unauthenticated calls')
    expect(setup.locator('a')).to_have_attribute('href', 'https://docs.cloud.google.com/run/docs/authenticating/public')
    expect(settings(pg).locator('[data-card-sources]')).to_contain_text('Built and tested on Google Cloud')
    # 링크로 다시 열어도 같은 카드 줄 — 카드는 hash 에 없다(있는 부품에서 되읽는다)
    pg.click('[data-copy="share-url"]')
    expect(pg.locator('[data-share-warning]')).to_have_text('The share link and the address bar hold your input as Base64, which is not encrypted — anyone with the link can read owner, system, purpose and the other values. Do not enter sensitive values such as internal company or project names.')
    shared = pg.evaluate('navigator.clipboard.readText()')
    body = hash_state(shared)
    assert 'b' not in body['w'] and 'bundle' not in json.dumps(body), body
    before_names = screen_names(pg)
    ctx2 = browser.new_context(viewport={'width': 1280, 'height': 900})
    p2 = ctx2.new_page()
    p2.on('pageerror', lambda e: errors.append(str(e)))
    goto_ready(p2, shared)
    assert screen_names(p2) == before_names
    for i, cid in ((0, 'website'), (1, 'website'), (2, 'serverless-web')):
        p2.locator(f'[data-row-path="services[{i}]"]').click()
        expect(p2.locator(f'[data-row-path="services[{i}].card.{cid}"] [data-card-state]')).to_have_text('complete')
    ctx2.close()
    no_hangul(pg)
    # ㊼ 카드 화면 — 폭 셋에서 가로 스크롤 없음(갤러리 · 점검표 · 이름 칸)
    for w, h in ((768, 1024), (390, 844), (360, 800)):
        pg.set_viewport_size({'width': w, 'height': h})
        pg.wait_for_timeout(150)
        if w < 768:
            pg.click('[data-wizard-tab="plan"]')
        pg.locator('[data-row-path="services[0]"]').click()
        expect(settings(pg).locator('[data-card-gallery]')).to_be_visible()
        no_hscroll(pg, w, '카드 갤러리')
        if w < 768:
            pg.click('[data-wizard-tab="plan"]')  # 폰은 줄을 누르면 Edit 탭이 열린다 — 목록으로 돌아가 카드 줄을 누른다
        pg.locator('[data-row-path="services[0].card.website"]').click()
        expect(settings(pg).locator('[data-card-panel="website"]')).to_be_visible()
        no_hscroll(pg, w, '카드 점검표')
        if w < 768:
            pg.click('[data-wizard-tab="names"]')
            no_hscroll(pg, w, '이름 탭')
    ctx.close()

    # ㊻ 첫 방문 안내 — 닫으면 이 브라우저에 남는다(같은 창의 새 페이지에서 닫힌 채) · 저장소가 막힌 창은 늘 보인다
    c46 = browser.new_context(viewport={'width': 1280, 'height': 900})
    p46 = c46.new_page()
    p46.on('pageerror', lambda e: errors.append(str(e)))
    # 옛 소개를 닫은 브라우저(옛 키 cloudonym:intro_dismissed)도 새 소개를 한 번 본다 — 키가 _v2 로 바뀌었다 (D97)
    goto_ready(p46, BASE + '/privacy')
    p46.evaluate("localStorage.setItem('cloudonym:intro_dismissed', '1')")
    goto_ready(p46, BASE + '/')
    expect(p46.locator('[data-wizard-intro]')).to_have_count(1)
    p46.click('[data-intro-close]')
    expect(p46.locator('[data-wizard-intro]')).to_have_count(0)
    assert p46.evaluate(f"localStorage.getItem('{INTRO_KEY}')") == '1'
    goto_ready(p46, BASE + '/?again')
    expect(p46.locator('[data-wizard-intro]')).to_have_count(0)
    # More → About (D109) — /about 쪽으로 간다 · 「Show the intro on the home page again」 이 닫힘 기억을 지우고 첫 화면으로 데려간다(소개가 보인다)
    open_more(p46)
    p46.locator('header [data-nav-about]').click()
    p46.wait_for_url(BASE + '/about')
    expect(p46.locator('h1')).to_have_text('About')
    p46.locator('[data-about-intro-again]').click()
    p46.wait_for_url(BASE + '/')
    expect(p46.locator('[data-wizard-intro]')).to_have_count(1)
    expect(p46.locator('[data-intro-example]')).to_be_visible()
    assert p46.evaluate(f"localStorage.getItem('{INTRO_KEY}')") is None
    goto_ready(p46, BASE + '/?after-about')
    expect(p46.locator('[data-wizard-intro]')).to_have_count(1)
    c46.close()
    c46b = browser.new_context(viewport={'width': 1280, 'height': 900})
    c46b.add_init_script("Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } })")
    p46b = c46b.new_page()
    p46b.on('pageerror', lambda e: errors.append(str(e)))
    goto_ready(p46b, BASE + '/')
    expect(p46b.locator('[data-wizard-intro]')).to_have_count(1)
    p46b.click('[data-intro-close]')
    expect(p46b.locator('[data-wizard-intro]')).to_have_count(0)
    # 저장소가 막혀도 화면은 그대로 돈다 — 값을 채우면 이름 다섯 (D97 — 첫 화면은 빈칸이라 채운 뒤에 센다)
    expect(p46b.locator('[data-names-notice="need_project"]')).to_have_text(NEED_PROJECT)
    # PASS 문단은 이름이 나온 뒤에만 (D107) — 빈 이름 칸에는 없다
    expect(p46b.locator('[data-pass-meaning]')).to_have_count(0)
    fill_example_project(p46b)
    expect(p46b.locator('[data-names-summary]')).to_have_text('5 names · 5/5 PASS')
    expect(p46b.locator('[data-pass-meaning]')).to_be_visible()
    expect(p46b.locator('[data-nothing-created]')).to_contain_text('nothing is created')
    c46b.close()


def theme_modes(browser, errors):
    """㊽ 화면 모드 (D94) — Light · Dark · System. 고른 값이 기기 설정을 이기고 새로 고쳐도 남는다(첫 칠 전 적용 — 깜빡임 없음) · 모든 화면 · 공유 링크에는 없다 ·
    System 은 기기 설정을 따른다 · 막힌 저장소에서도 System 으로 정상"""
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900}, color_scheme='light')
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    goto_ready(pg, BASE + '/')
    dark = "document.documentElement.classList.contains('dark')"
    bg = 'getComputedStyle(document.body).backgroundColor'
    group = pg.locator('header [data-theme-toggle]')
    expect(group).to_have_attribute('role', 'radiogroup')
    expect(group).to_have_attribute('aria-label', 'Screen mode')
    expect(group.locator('[role="radio"]')).to_have_count(3)
    expect(group.locator('[data-theme-mode="system"]')).to_have_attribute('aria-checked', 'true')
    expect(group.locator('[data-theme-mode="light"]')).to_have_attribute('aria-label', 'Light')
    assert pg.evaluate(dark) is False
    light_bg = pg.evaluate(bg)
    group.locator('[data-theme-mode="dark"]').click()
    expect(group.locator('[data-theme-mode="dark"]')).to_have_attribute('aria-checked', 'true')
    assert pg.evaluate(dark) is True and pg.evaluate(bg) != light_bg
    assert pg.evaluate("localStorage.getItem('cloudonym:theme')") == 'dark'
    assert pg.evaluate("getComputedStyle(document.documentElement).colorScheme") == 'dark'
    # 새로 고쳐도 남는다 — 첫 칠 전에 적용되는지: 문서가 그려지기 전(DOMContentLoaded)에 이미 dark
    pg.add_init_script("document.addEventListener('DOMContentLoaded', () => { window.__darkAtLoad = document.documentElement.classList.contains('dark'); })")
    pg.reload()
    pg.wait_for_selector('[data-wizard-list]')
    assert pg.evaluate('window.__darkAtLoad') is True
    assert pg.evaluate(dark) is True
    # 공유 링크(hash)에는 모드가 없다
    assert 'theme' not in pg.evaluate('location.hash') and 'dark' not in json.dumps(hash_state(pg.url) if '#state=' in pg.url else {})
    # 모든 화면 — 트리 · 이름 안내 · 개인정보에도 같은 모드와 같은 고르기
    for path in ('/pick', '/docs/naming', '/privacy'):
        goto_ready(pg, BASE + path)
        assert pg.evaluate(dark) is True, path
        expect(pg.locator('[data-theme-toggle] [data-theme-mode="dark"]')).to_have_attribute('aria-checked', 'true')
    start_example(pg)
    pg.locator('[data-card-add="website"]').click()
    wizard_shot(pg, '10-wizard-dark.png')
    # 키보드 — 화살표로 옮기면서 고른다
    pg.locator('[data-theme-mode="dark"]').focus()
    pg.keyboard.press('ArrowLeft')
    expect(pg.locator('[data-theme-mode="light"]')).to_be_focused()
    expect(pg.locator('[data-theme-mode="light"]')).to_have_attribute('aria-checked', 'true')
    assert pg.evaluate(dark) is False
    assert pg.evaluate("getComputedStyle(document.documentElement).colorScheme") == 'light'
    # System — 키를 지우고 기기 설정을 따른다(바뀌면 따라간다)
    pg.locator('[data-theme-mode="system"]').click()
    assert pg.evaluate("localStorage.getItem('cloudonym:theme')") is None
    pg.emulate_media(color_scheme='dark')
    pg.wait_for_function(dark)
    pg.emulate_media(color_scheme='light')
    pg.wait_for_function(f'!({dark})')
    ctx.close()
    # 기기가 다크여도 Light 를 고르면 밝다 · 다시 열어도 밝다
    c2 = browser.new_context(viewport={'width': 1280, 'height': 900}, color_scheme='dark')
    p2 = c2.new_page()
    p2.on('pageerror', lambda e: errors.append(str(e)))
    goto_ready(p2, BASE + '/')
    assert p2.evaluate(dark) is True
    p2.locator('[data-theme-mode="light"]').click()
    assert p2.evaluate(dark) is False
    goto_ready(p2, BASE + '/privacy')
    assert p2.evaluate(dark) is False
    c2.close()
    # 막힌 저장소 — 고를 수 있고(이 탭에서만) 첫 화면은 System
    c3 = browser.new_context(viewport={'width': 1280, 'height': 900}, color_scheme='dark')
    c3.add_init_script("Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } })")
    p3 = c3.new_page()
    p3.on('pageerror', lambda e: errors.append(str(e)))
    goto_ready(p3, BASE + '/')
    assert p3.evaluate(dark) is True
    expect(p3.locator('[data-theme-mode="system"]')).to_have_attribute('aria-checked', 'true')
    p3.locator('[data-theme-mode="light"]').click()
    assert p3.evaluate(dark) is False
    c3.close()


def names_counts(page):
    """이름 칸 머리의 요약 「N names · P/N PASS」 → (N, P)"""
    m = re.fullmatch(r'(\d+) names · (\d+)/\1 PASS', page.locator('[data-names-summary]').inner_text())
    assert m, page.locator('[data-names-summary]').inner_text()
    return int(m.group(1)), int(m.group(2))


def dialog_open(page, sel):
    return page.evaluate(f"document.querySelector('{sel}').open")


def no_hscroll(page, width, what):
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'{what} — {width}px 에서 가로 스크롤이 생긴다'


def open_more(page):
    """머리의 More 메뉴를 연다 (D104) — 메뉴 안의 항목(data-nav-* · data-plan-open)을 누르기 전에 부른다"""
    page.click('header [data-nav-more]')
    expect(page.locator('header [data-nav-menu]')).to_be_visible()


def header_rows(page):
    """머리의 줄 — (머리 높이, 단추 줄이 로고 줄과 같은 줄인가, 단추 줄이 한 줄인가)"""
    hb = page.locator('header').bounding_box()
    nav = page.locator('header nav').bounding_box()
    brand = page.locator('header h1').bounding_box()
    # 단추마다 높이가 달라(화면 모드 묶음이 더 크다) 위끝이 다르다 — 모든 단추의 세로 범위가 겹치면 한 줄이다
    spans = page.eval_on_selector_all('header nav > *', 'els => els.filter(e => e.checkVisibility()).map(e => { const r = e.getBoundingClientRect(); return [r.top, r.bottom]; })')
    return hb['height'], nav['y'] < brand['y'] + brand['height'], max(t for t, _ in spans) < min(b for _, b in spans)


def wizard_narrow(browser, errors):
    """㊹ 좁은 화면 (D89 · D93) — 태블릿(768–1279)은 목록 · 설정 두 칸 + 이름 드로어, 폰(<768)은 한 칸 + 위 탭 셋(Plan · Edit · Names). 1280 은 세 칸 그대로.
    값은 중립 예시(devops · payments · shop · pay)다. 스크린샷 07 · 08 은 wizard_narrow_shots 가 새 창에서 찍는다"""
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    start_example(pg)
    expect(pg.locator('[data-wizard-layout]')).to_have_attribute('data-wizard-layout', 'wide')
    expect(pg.locator('[data-names-bar]')).to_have_count(0)  # 넓은 화면은 이름 칸이 늘 보인다 — 막대가 없다 (D108)
    expect(pg.locator('[data-wizard-tabs]')).to_have_count(0)
    fill_project(pg)
    svc(pg, 0).locator('[data-purpose-chip="web"]').click()
    pg.click('[data-add-service]')
    settings(pg).locator('[data-service-name]').fill('pay')
    more(settings(pg)).locator('[data-purpose-chip="db"]').click()
    select(pg, 'services[0].picks[0]')

    # ── 태블릿 768 — 두 칸(목록 왼쪽 · 설정 오른쪽) · 이름은 닫힌 드로어 · 아래 고정 막대(D108)의 수는 머리 요약과 같다 ──
    pg.set_viewport_size({'width': 768, 'height': 1024})
    expect(pg.locator('[data-wizard-layout]')).to_have_attribute('data-wizard-layout', 'tablet')
    lst, st = pg.locator('[data-wizard-list-column]').bounding_box(), settings(pg).bounding_box()
    assert lst['x'] < st['x'] and abs(lst['y'] - st['y']) < 2, (lst, st)
    assert not dialog_open(pg, '[data-names-drawer]')
    expect(settings(pg)).to_have_attribute('data-pick-path', 'services[0].picks[0]')  # 고른 줄은 배치가 바뀌어도 그대로
    handle = pg.locator('[data-names-bar]')
    expect(handle).to_be_visible()
    expect(handle).to_have_attribute('data-names-bar', 'names')
    expect(handle).to_have_attribute('aria-expanded', 'false')
    n, ok = names_counts(pg)
    expect(pg.locator('[data-names-bar-text]')).to_have_text(f'View {n} generated names (Terraform / JSON)')
    expect(pg.locator('[data-names-bar-summary]')).to_have_text(f'{ok}/{n} PASS')
    expect(handle).to_have_attribute('aria-label', f'View {n} generated names (Terraform / JSON) · {ok}/{n} PASS')  # 읽는 이름은 긴 글 + PASS 수 (D109)
    # 막대는 칸을 가리지 않는다 — 페이지를 끝까지 내리면 두 칸이 막대 위에서 끝난다 · 오른쪽 손잡이 몫의 여백(pr-14)이 없어 설정 칸이 오른쪽 여백 16px 에서 끝난다
    assert abs(st['x'] + st['width'] - (768 - 16)) <= 1, st
    pg.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
    hb = handle.bounding_box()
    for col in ('[data-wizard-list-column]', '[data-settings]'):
        b = pg.locator(col).bounding_box()
        assert b['y'] + b['height'] <= hb['y'], (col, b, hb)
    pg.evaluate('window.scrollTo(0, 0)')
    assert hb['height'] >= 44 and abs((hb['x'] + hb['width'] / 2) - 384) <= 1, hb  # 눌리기 쉬운 높이 · 가운데
    no_hscroll(pg, 768, '드로어 닫힘')
    # 막대를 누르면 오른쪽 가장자리에 폭 min(420px, 90vw) 드로어 · 포커스는 닫기 단추 · 머리 요약 · 내보내기가 보인다 · 막대는 숨는다
    handle.click()
    assert dialog_open(pg, '[data-names-drawer]')
    box = pg.locator('[data-names-drawer]').bounding_box()
    assert box['width'] == 420 and box['x'] + box['width'] == 768 and box['height'] == 1024, box
    expect(pg.locator('[data-names-close]')).to_be_focused()
    expect(handle).to_be_hidden()
    expect(pg.locator('[data-names-drawer] [data-names-summary]')).to_have_text(f'{n} names · {ok}/{n} PASS')
    expect(pg.locator('[data-names-drawer] [data-copy="terraform"]')).to_be_visible()
    no_hscroll(pg, 768, '드로어 열림')
    # Esc 로 닫히고 막대가 다시 보이며 포커스는 막대로
    pg.keyboard.press('Escape')
    pg.wait_for_function("() => !document.querySelector('[data-names-drawer]').open")
    expect(handle).to_be_focused()
    expect(handle).to_have_attribute('aria-expanded', 'false')
    # 닫기 단추 · 배경 누름으로도 닫힌다
    handle.click()
    pg.locator('[data-names-close]').click()
    pg.wait_for_function("() => !document.querySelector('[data-names-drawer]').open")
    handle.click()
    pg.mouse.click(40, 500)  # 드로어 밖(배경)
    pg.wait_for_function("() => !document.querySelector('[data-names-drawer]').open")
    # 막대의 수는 계획을 바꾸면 따라 바뀐다
    svc(pg, 1).locator('[data-purpose-chip="object"]').click()
    n2, ok2 = names_counts(pg)
    assert n2 == n + 1, (n, n2)
    expect(pg.locator('[data-names-bar-text]')).to_have_text(f'View {n2} generated names (Terraform / JSON)')
    expect(pg.locator('[data-names-bar-summary]')).to_have_text(f'{ok2}/{n2} PASS')
    svc(pg, 1).locator('[data-purpose-chip="object"]').click()
    expect(pg.locator('[data-names-bar-summary]')).to_have_text(f'{ok}/{n} PASS')
    select(pg, 'services[0].picks[0]')  # shop 을 펴 둔다(폰에서 그 줄을 누른다)

    # ── 폰 360 — 한 칸 · 위 탭 셋 [Plan] [Edit] [Names p/n] (D93 — 설정 바텀 시트를 걷어냈다: 카드 갤러리 · 점검표가 시트 70vh 보다 길다) ──
    #    줄을 누르면 Edit 탭이 그 줄의 설정을 연다 · Esc 는 Plan 탭의 그 줄로 · Add service 는 한 번에 새 서비스의 Edit 탭
    pg.set_viewport_size({'width': 360, 'height': 800})
    expect(pg.locator('[data-wizard-layout]')).to_have_attribute('data-wizard-layout', 'phone')
    expect(pg.locator('[data-settings-sheet]')).to_have_count(0)
    tabs = pg.locator('[data-wizard-tab]')
    expect(tabs).to_have_text(['Plan', 'Edit', f'Names {ok}/{n}'])
    # 이 창은 링크 없이 열려(첫 방문) 탭이 Edit 로 시작한다 (D97 — 폭을 줄여도 그 상태 그대로) · 링크로 연 창의 Plan 첫 탭은 wizard_first_visit 의 폰 쪽이 잰다
    expect(pg.locator('[data-wizard-tab="edit"]')).to_have_attribute('aria-selected', 'true')
    pg.click('[data-wizard-tab="plan"]')
    expect(pg.locator('[data-wizard-tab="plan"]')).to_have_attribute('aria-selected', 'true')
    expect(pg.locator('[data-wizard-list-column]')).to_be_visible()
    expect(settings(pg)).to_be_hidden()
    expect(pg.locator('[data-names-column]')).to_be_hidden()
    no_hscroll(pg, 360, 'Plan 탭')
    pg.locator('[data-row-path="services[0].picks[0]"]').click()
    expect(pg.locator('[data-wizard-tab="edit"]')).to_have_attribute('aria-selected', 'true')
    expect(settings(pg)).to_be_visible()
    expect(settings(pg)).to_have_attribute('data-pick-path', 'services[0].picks[0]')
    expect(settings(pg)).to_have_attribute('role', 'tabpanel')
    expect(pg.locator('[data-wizard-list-column]')).to_be_hidden()
    open_attached(settings(pg).locator('li[data-slot]').nth(0))
    no_hscroll(pg, 360, 'Edit 탭')
    # Esc 로 Plan 탭 · 포커스는 그 줄로
    settings(pg).locator('[data-ha]').focus()
    pg.keyboard.press('Escape')
    expect(pg.locator('[data-wizard-tab="plan"]')).to_have_attribute('aria-selected', 'true')
    expect(pg.locator('[data-row-path="services[0].picks[0]"]')).to_be_focused()
    # Enter 로 열면 설정 칸 첫 컨트롤에 포커스
    pg.locator('[data-row-path="project"]').click()
    expect(settings(pg)).to_have_attribute('data-pick-path', 'project')
    pg.keyboard.press('Escape')
    expect(pg.locator('[data-row-path="project"]')).to_be_focused()
    pg.keyboard.press('Enter')
    expect(pg.locator('[data-wizard-tab="edit"]')).to_have_attribute('aria-selected', 'true')
    expect(pg.locator('#wizard-owner')).to_be_focused()
    pg.keyboard.press('Escape')
    expect(pg.locator('[data-row-path="project"]')).to_be_focused()
    # ↑↓ 는 고르기만 하고 Plan 탭에 남는다
    pg.keyboard.press('ArrowDown')
    expect(pg.locator('[data-row-path="network"]')).to_be_focused()
    expect(pg.locator('[data-wizard-tab="plan"]')).to_have_attribute('aria-selected', 'true')
    # Add service — 한 번에 새 서비스의 Edit 탭 · 이름 칸에 포커스 (지운 뒤 계획은 그대로)
    pg.click('[data-add-service]')
    expect(pg.locator('[data-wizard-tab="edit"]')).to_have_attribute('aria-selected', 'true')
    expect(settings(pg)).to_have_attribute('data-pick-path', 'services[2]')
    expect(settings(pg).locator('[data-service-name]')).to_be_focused()
    expect(settings(pg).locator('[data-card-gallery] [data-card]')).to_have_count(10)
    no_hscroll(pg, 360, 'Edit 탭 · 카드 갤러리')
    settings(pg).locator('[data-remove-service]').click()
    expect(settings(pg)).to_have_attribute('data-pick-path', 'services[1]')
    # 아래 고정 막대 (D108) — Edit · Plan 탭에서 보이고, 누르면 Names 탭으로(포커스는 Names 탭 단추) · Names 탭에서는 숨는다 · 페이지 끝을 가리지 않는다(아래 여백)
    bar = pg.locator('[data-names-bar]')
    expect(bar).to_be_visible()
    expect(bar).to_have_attribute('aria-controls', 'wizard-panel-names')
    expect(pg.locator('[data-names-bar-text]')).to_have_text(f'View {n} names')  # 폰은 짧은 글 (D109)
    expect(bar).to_have_attribute('aria-label', f'View {n} names — View {n} generated names (Terraform / JSON) · {ok}/{n} PASS')  # 폰 — 보이는 글로 시작한다(WCAG 2.5.3)
    pg.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
    last = pg.locator('[data-settings]').bounding_box()
    hb = bar.bounding_box()
    assert last['y'] + last['height'] <= hb['y'], ('막대가 설정 칸의 끝을 가린다', last, hb)
    bar.click()
    expect(pg.locator('[data-wizard-tab="names"]')).to_have_attribute('aria-selected', 'true')
    expect(pg.locator('[data-wizard-tab="names"]')).to_be_focused()
    expect(pg.locator('[data-names-column]')).to_be_visible()
    expect(bar).to_be_hidden()
    pg.click('[data-wizard-tab="plan"]')
    expect(bar).to_be_visible()
    # 탭 — Names 를 누르면 이름 칸 · 목록은 숨는다 · 머리 요약은 탭과 같다
    pg.click('[data-wizard-tab="names"]')
    expect(pg.locator('[data-wizard-tab="names"]')).to_have_attribute('aria-selected', 'true')
    expect(pg.locator('[data-names-column]')).to_be_visible()
    expect(pg.locator('[data-wizard-list-column]')).to_be_hidden()
    expect(settings(pg)).to_be_hidden()
    expect(pg.locator('[data-names-summary]')).to_have_text(f'{n} names · {ok}/{n} PASS')
    no_hscroll(pg, 360, 'Names 탭')
    pg.click('[data-wizard-tab="plan"]')
    expect(pg.locator('[data-wizard-list-column]')).to_be_visible()
    # 탭 키보드 — 고른 탭만 Tab 순서에 있고, → · End · Home 이 옮기면서 고른다
    tab_plan, tab_edit, tab_names = pg.locator('[data-wizard-tab="plan"]'), pg.locator('[data-wizard-tab="edit"]'), pg.locator('[data-wizard-tab="names"]')
    expect(tab_plan).to_have_attribute('tabindex', '0')
    expect(tab_edit).to_have_attribute('tabindex', '-1')
    expect(tab_names).to_have_attribute('tabindex', '-1')
    tab_plan.focus()
    pg.keyboard.press('ArrowRight')
    expect(tab_edit).to_be_focused()
    expect(tab_edit).to_have_attribute('aria-selected', 'true')
    expect(settings(pg)).to_be_visible()
    pg.keyboard.press('End')
    expect(tab_names).to_be_focused()
    expect(pg.locator('[data-names-column]')).to_be_visible()
    pg.keyboard.press('ArrowRight')
    expect(tab_plan).to_be_focused()
    pg.keyboard.press('Home')
    expect(tab_plan).to_be_focused()
    expect(pg.locator('[data-wizard-list-column]')).to_be_visible()
    # 연 드로어는 폭을 바꿨다 돌아와도 저절로 다시 열리지 않는다 (D89 독립 리뷰)
    pg.set_viewport_size({'width': 768, 'height': 1024})
    pg.locator('[data-names-bar]').click()
    assert dialog_open(pg, '[data-names-drawer]')
    pg.set_viewport_size({'width': 360, 'height': 800})
    expect(pg.locator('[data-wizard-layout]')).to_have_attribute('data-wizard-layout', 'phone')
    pg.set_viewport_size({'width': 768, 'height': 1024})
    expect(pg.locator('[data-wizard-layout]')).to_have_attribute('data-wizard-layout', 'tablet')
    assert not dialog_open(pg, '[data-names-drawer]')
    expect(pg.locator('[data-names-bar]')).to_have_attribute('aria-expanded', 'false')
    # 390 에서도 Edit 탭 · 가로 스크롤 없음
    pg.set_viewport_size({'width': 390, 'height': 844})
    pg.click('[data-wizard-tab="plan"]')
    pg.locator('[data-row-path="services[1]"]').click()
    expect(settings(pg)).to_have_attribute('data-pick-path', 'services[1]')
    expect(settings(pg).locator('[data-service-name]')).to_have_value('pay')
    no_hscroll(pg, 390, 'Edit 탭')
    # 줄을 누르면 포커스가 Edit 칸으로 온다 — 누른 줄은 숨은 Plan 탭에 있어 거기 남으면 Esc 가 닿지 않는다
    expect(settings(pg)).to_be_focused()
    pg.keyboard.press('Escape')
    expect(pg.locator('[data-wizard-tab="plan"]')).to_have_attribute('aria-selected', 'true')
    # 다시 넓히면 세 칸 · 열린 창 없음
    pg.set_viewport_size({'width': 1280, 'height': 900})
    expect(pg.locator('[data-wizard-layout]')).to_have_attribute('data-wizard-layout', 'wide')
    expect(pg.locator('[data-names-column]')).to_be_visible()
    no_hangul(pg)
    ctx.close()


def narrow_plan(browser, errors, width, height):
    """07 · 08 의 계획 — 1280 에서 만들고(devops · payments · shop 의 web · pay 의 db) shop 의 Web server 를 고른 뒤 폭을 줄인다.
    스크린샷만을 위한 새 창이다: 시험 흐름의 앞 단계(스크롤 · 강조 · 포커스)가 그림에 남지 않아 두 번 찍어도 같은 바이트다"""
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    start_example(pg)
    fill_project(pg)
    svc(pg, 0).locator('[data-purpose-chip="web"]').click()
    pg.click('[data-add-service]')
    settings(pg).locator('[data-service-name]').fill('pay')
    more(settings(pg)).locator('[data-purpose-chip="db"]').click()
    select(pg, 'services[0].picks[0]')
    pg.set_viewport_size({'width': width, 'height': height})
    return ctx, pg


def wizard_sample(browser, errors):
    """(54) 첫 방문 예시 (D108) — 링크 없이 열면 예시 계획(demo · payment · prod · asia-northeast3 · shop 의 serverless-web 카드 · 네트워크 넷)이고
    이름 열여섯이 전부 PASS · Copy all · JSON · Terraform 이 바로 보인다 · Project 칸에 「Example」 표시와 Clear · 손대기 전에는 hash · Share · Save plan · 공유 경고가 없다 ·
    무엇이든 바꾸면 표시가 사라지고 hash 가 생긴다 · Clear 는 D97 의 빈 첫 화면 · 첫 방문 스크린샷 360 · 1024(태블릿 막대) · 1280"""
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    sent = events_of(pg)
    goto_ready(pg, BASE + '/', sample=True)
    s = settings(pg)
    expect(s).to_have_attribute('data-pick-path', 'project')
    expect(s.locator('[data-sample-marker]')).to_be_visible()
    expect(s.locator('[data-sample-badge]')).to_have_text('Example')
    expect(s.locator('[data-sample-clear]')).to_have_text('Clear')
    for key in ('owner', 'system'):
        expect(s.locator(f'#wizard-{key}')).to_have_value(SAMPLE[key])
    expect(s.locator('#field-region')).to_have_value(SAMPLE['region'])
    expect(s.locator('[data-env-chip][aria-pressed="true"]')).to_have_text([SAMPLE['env']])
    # 이름 — 전부 PASS · 내보내기 셋이 바로 보인다 · 소개의 세 이름이 화면 이름에 있다(소개와 화면이 같은 계획)
    expect(pg.locator('#names article[data-key]')).to_have_count(SAMPLE_NAMES)
    expect(pg.locator('[data-names-summary]')).to_have_text(f'{SAMPLE_NAMES} names · {SAMPLE_NAMES}/{SAMPLE_NAMES} PASS')
    names = screen_names(pg)
    assert all(v for _, _, v in names), [x for x in names if not x[2]]
    assert set(INTRO_EXAMPLE) <= {n for _, n, _ in names}, (INTRO_EXAMPLE, names)
    expect(pg.locator('#names article[data-valid="false"]')).to_have_count(0)
    for sel in ('[data-copy="all-names"]', '[data-copy="names-json"]', '[data-copy="terraform"]'):
        expect(pg.locator(sel)).to_be_visible()
    expect(pg.locator('[data-pass-meaning]')).to_be_visible()
    # 카드는 사용자가 더한 것과 같은 보통 pick — 목록에 serverless-web 카드 줄 하나
    expect(pg.locator('[data-row-path="services[0]"] [data-row-count]')).to_have_text('11 names')
    # 손대기 전에는 hash · Share URL · Save plan · 공유 경고가 없다(D97 의 문 그대로) · Project ID 요약 앞 정보 아이콘
    assert pg.evaluate('location.hash') == '', pg.url
    expect(pg.locator('[data-copy="share-url"], [data-plan-save]')).to_have_count(0)
    expect(pg.locator('[data-share-warning]')).to_have_count(0)
    expect(s.locator('[data-project-id-notice] summary svg[data-project-id-notice-icon]')).to_have_attribute('aria-hidden', 'true')
    # 넓은 화면에는 이름 막대가 없다
    expect(pg.locator('[data-names-bar]')).to_have_count(0)
    no_hangul(pg)
    shot_dir = OUT
    pg.mouse.move(0, 0)
    pg.screenshot(path=str(shot_dir / 'first-visit-1280.png'), animations='disabled', caret='hide')
    # 1024 — 태블릿: 아래 막대가 드로어를 연다 · 수가 머리 요약과 같다
    pg.set_viewport_size({'width': 1024, 'height': 768})
    expect(pg.locator('[data-wizard-layout]')).to_have_attribute('data-wizard-layout', 'tablet')
    expect(pg.locator('[data-names-bar-text]')).to_have_text(f'View {SAMPLE_NAMES} generated names (Terraform / JSON)')
    pg.mouse.move(0, 0)
    pg.screenshot(path=str(shot_dir / 'first-visit-1024.png'), animations='disabled', caret='hide')
    pg.click('[data-names-bar]')
    assert dialog_open(pg, '[data-names-drawer]')
    expect(pg.locator('[data-names-drawer] [data-names-summary]')).to_have_text(f'{SAMPLE_NAMES} names · {SAMPLE_NAMES}/{SAMPLE_NAMES} PASS')
    pg.keyboard.press('Escape')
    pg.wait_for_function("() => !document.querySelector('[data-names-drawer]').open")
    pg.set_viewport_size({'width': 1280, 'height': 900})
    # 무엇이든 바꾸면 사용자의 계획이다 — 표시 · Clear 가 사라지고 hash · Share URL 이 생긴다
    s.locator('#wizard-owner').fill('acme')
    expect(s.locator('[data-sample-marker]')).to_have_count(0)
    pg.wait_for_function("() => location.hash.startsWith('#state=')")
    assert hash_state(pg.url)['owner'] == 'acme', hash_state(pg.url)
    expect(pg.locator('[data-copy="share-url"]')).to_have_count(1)
    pg.wait_for_timeout(1500)
    assert sent.count('ui_generate') == 1, sent  # 첫 화면은 세지 않고 첫 수정 뒤에 한 번
    # 새로 열면 다시 예시 — Clear 는 D97 의 빈 첫 화면: 빈 값 · 카드 없음 · 이름 대신 안내 · hash · Share 없음 · 오류 없음 · 포커스는 Project 제목
    goto_ready(pg, BASE + '/', sample=True)
    expect(s.locator('[data-sample-marker]')).to_be_visible()
    s.locator('[data-sample-clear]').click()
    expect(s.locator('[data-sample-marker]')).to_have_count(0)
    expect(pg.locator('#wizard-project')).to_be_focused()
    for key in ('owner', 'system'):
        expect(s.locator(f'#wizard-{key}')).to_have_value('')
    expect(s.locator('#field-region')).to_have_value('')
    expect(s.locator('[data-env-chip][aria-pressed="true"]')).to_have_count(0)
    expect(s.locator('[aria-invalid="true"]')).to_have_count(0)
    expect(pg.locator('[data-names-notice="need_project"]')).to_have_text(NEED_PROJECT)
    expect(pg.locator('#names article[data-key]')).to_have_count(0)
    expect(pg.locator('[data-copy="all-names"], [data-copy="names-json"], [data-copy="terraform"]')).to_have_count(0)
    expect(pg.locator('[data-row-path^="services[0].picks"]')).to_have_count(0)  # 카드 · pick 없는 서비스 shop
    expect(pg.locator('[data-row-path="network"] [data-network-summary]')).to_have_text('VPC network, Subnet, Cloud Router, Cloud NAT')  # 네트워크 미리 채움(D90)은 남는다
    assert pg.evaluate('location.hash') == '', pg.url
    expect(pg.locator('[data-copy="share-url"], [data-plan-save]')).to_have_count(0)
    # 링크는 예전처럼 연다 — 예시 표시 없이 링크의 값
    goto_ready(pg, BASE + '/' + bucket_link(RULES_OF(pg), 'files'))
    expect(s.locator('[data-sample-marker]')).to_have_count(0)
    ctx.close()
    # 360 — 첫 탭은 Edit(Project · 「Example」) · 아래 막대가 Names 탭으로 간다
    c = browser.new_context(viewport={'width': 360, 'height': 800})
    p360 = c.new_page()
    p360.on('pageerror', lambda e: errors.append(str(e)))
    goto_ready(p360, BASE + '/', sample=True)
    expect(p360.locator('[data-wizard-tab="edit"]')).to_have_attribute('aria-selected', 'true')
    expect(settings(p360).locator('[data-sample-marker]')).to_be_visible()
    # 폰은 짧은 글 + PASS 칩이 한 줄 (D109) — 글 줄 상자가 하나 · 막대 높이가 최소 높이(48px) 그대로 · 칩과 글의 세로 자리가 겹친다
    expect(p360.locator('[data-names-bar-text]')).to_have_text(f'View {SAMPLE_NAMES} names')
    expect(p360.locator('[data-names-bar]')).to_have_attribute('aria-label', f'View {SAMPLE_NAMES} names — View {SAMPLE_NAMES} generated names (Terraform / JSON) · {SAMPLE_NAMES}/{SAMPLE_NAMES} PASS')  # 보이는 글로 시작한다(WCAG 2.5.3)
    assert p360.evaluate("document.querySelector('[data-names-bar-text]').getClientRects().length") == 1
    bar_box = p360.locator('[data-names-bar]').bounding_box()
    assert bar_box['height'] <= 48.5, bar_box
    tb, cb = p360.locator('[data-names-bar-text]').bounding_box(), p360.locator('[data-names-bar-summary]').bounding_box()
    assert cb['y'] < tb['y'] + tb['height'] and tb['y'] < cb['y'] + cb['height'], (tb, cb)
    no_hscroll(p360, 360, '첫 방문 예시')
    p360.mouse.move(0, 0)
    p360.screenshot(path=str(shot_dir / 'first-visit-360.png'), animations='disabled', caret='hide')
    p360.click('[data-names-bar]')
    expect(p360.locator('[data-wizard-tab="names"]')).to_have_attribute('aria-selected', 'true')
    expect(p360.locator('[data-names-bar]')).to_be_hidden()
    expect(p360.locator('[data-names-summary]')).to_have_text(f'{SAMPLE_NAMES} names · {SAMPLE_NAMES}/{SAMPLE_NAMES} PASS')
    c.close()


def RULES_OF(page):
    """지금 규칙 버전 — /v1/health"""
    return page.request.get(BASE + '/v1/health').json()['version']['rules']


def wizard_first_visit(browser, rules_version, errors):
    """㊾ 첫 방문 (D97) — 링크 없이 열면 프로젝트 값이 빈칸(예시는 placeholder) · 첫 선택 Project · 손대지 않은 칸에는 오류가 없다 ·
    칸을 떠나면 그 칸의 오류 · 환경 칩 묶음을 Tab 으로 지나치면 환경 오류 · 값이 맞기 전에는 이름 칸에 안내 한 줄뿐(내보내기 없음) · hash 를 쓰지 않는다 ·
    값이 맞아도 저절로 옮기지 않고 「Next」 → 첫 서비스의 카드 갤러리(포커스도) · 공유 경고는 Share 를 누를 때.
    ㊿ 폰 360 — 링크 없이 열면 첫 탭이 Edit(= Project 설정) · 링크로 열면 Plan"""
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=BASE)
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    goto_ready(pg, BASE + '/')
    s = settings(pg)
    # 빈칸 — 예시 값은 placeholder 로만 보인다 · 환경 칩은 하나도 눌려 있지 않다
    expect(s).to_have_attribute('data-pick-path', 'project')
    expect(pg.locator('[data-row-path="project"]')).to_have_attribute('aria-selected', 'true')
    for key, ph in (('owner', 'e.g. platform'), ('system', 'e.g. billing')):
        expect(s.locator(f'#wizard-{key}')).to_have_value('')
        expect(s.locator(f'#wizard-{key}')).to_have_attribute('placeholder', ph)
    expect(s.locator('#field-region')).to_have_value('')
    expect(s.locator('#field-region')).to_have_attribute('placeholder', 'e.g. asia-northeast3')
    expect(s.locator('[data-env-chip]')).to_have_count(9)
    expect(s.locator('[data-env-chip][aria-pressed="true"]')).to_have_count(0)
    # 손대지 않은 칸에는 빨간 오류가 없다 · Project 줄의 오류 수도 없다
    expect(s.locator('[aria-invalid="true"]')).to_have_count(0)
    expect(s.locator('#wizard-owner-error, #wizard-system-error, #wizard-envs-error')).to_have_count(0)
    expect(pg.locator('[data-row-path="project"] [data-row-errors]')).to_have_count(0)
    # 이름 칸 — 안내 한 줄만 · 이름 · 요약 · 내보내기(Copy all · JSON · Terraform)가 없다 · Next 대신 중립 안내
    expect(pg.locator('[data-names-notice]')).to_have_count(1)
    expect(pg.locator('[data-names-notice="need_project"]')).to_have_text(NEED_PROJECT)
    expect(pg.locator('#names article[data-key]')).to_have_count(0)
    expect(pg.locator('[data-names-summary]')).to_have_count(0)
    expect(pg.locator('[data-copy="all-names"], [data-copy="names-json"], [data-copy="terraform"]')).to_have_count(0)
    expect(s.locator('[data-project-pending]')).to_have_text(PENDING)
    expect(s.locator('[data-project-next-button]')).to_have_count(0)
    # hash 를 쓰지 않는다 — Share URL · Save plan 도 없다(공유 경고도 없다) · Open plan 은 늘 있다 (D100)
    assert pg.evaluate('location.hash') == '', pg.url
    expect(pg.locator('[data-copy="share-url"]')).to_have_count(0)
    expect(pg.locator('[data-plan-save]')).to_have_count(0)
    expect(pg.locator('[data-plan-open]')).to_have_count(1)
    expect(pg.locator('[data-share-warning]')).to_have_count(0)
    # 칸을 떠나면(blur) 그 칸만 오류 — 옆 칸(system)은 아직 조용하다 · Project 줄에 오류 수
    s.locator('#wizard-owner').focus()
    pg.keyboard.press('Tab')
    expect(s.locator('#wizard-owner-error')).to_have_count(1)
    expect(s.locator('#wizard-owner')).to_have_attribute('aria-invalid', 'true')
    expect(s.locator('#wizard-system-error')).to_have_count(0)
    expect(pg.locator('[data-row-path="project"] [data-row-errors]')).to_have_text('!1')
    expect(pg.locator('[data-names-notice="fix_errors"]')).to_have_count(1)
    # 환경 칩 묶음 — 칩 사이를 옮겨 다니는 동안은 조용하고, 묶음을 Tab 으로 빠져나가면 환경 오류 (아무 칩도 누르지 않았다)
    s.locator('[data-env-chip]').first.focus()
    for _ in range(8):
        pg.keyboard.press('Tab')
        expect(s.locator('#wizard-envs-error')).to_have_count(0)
    pg.keyboard.press('Tab')
    expect(s.locator('#field-region')).to_be_focused()
    expect(s.locator('#wizard-envs-error')).to_have_count(1)
    expect(s.locator('[data-env-chip][aria-pressed="true"]')).to_have_count(0)
    assert pg.evaluate('location.hash') == '', pg.url  # 건드리기만 해서는 hash 가 생기지 않는다
    # 값을 다 채우면 오류가 걷히고 이름이 나온다 — 그래도 선택은 Project 그대로(저절로 옮기지 않는다) · 이제 hash · Share URL · Save plan
    fill_example_project(pg)
    expect(s.locator('[aria-invalid="true"]')).to_have_count(0)
    expect(pg.locator('[data-row-path="project"] [data-row-errors]')).to_have_count(0)
    expect(pg.locator('[data-names-notice]')).to_have_count(0)
    expect(pg.locator('[data-names-summary]')).to_have_text('5 names · 5/5 PASS')
    expect(s).to_have_attribute('data-pick-path', 'project')
    expect(s.locator('[data-project-pending]')).to_have_count(0)
    expect(s.locator('[data-project-next] [data-project-next-button]')).to_have_text('Next: what are you building')
    pg.wait_for_function("() => location.hash.startsWith('#state=')")
    assert {k: hash_state(pg.url)[k] for k in ('owner', 'system', 'env', 'region')} == {k: DEFAULT[k] for k in ('owner', 'system', 'env', 'region')}, hash_state(pg.url)
    expect(pg.locator('[data-copy="share-url"]')).to_have_count(1)
    expect(pg.locator('[data-plan-save]')).to_have_count(1)
    expect(pg.locator('[data-share-warning]')).to_have_count(0)
    # Next → 첫 서비스(shop)의 카드 갤러리 · 포커스가 설정 칸으로 옮겨 간다
    s.locator('[data-project-next-button]').click()
    expect(s).to_have_attribute('data-pick-path', 'services[0]')
    expect(s.locator('[data-card-gallery] [data-card]')).to_have_count(10)
    pg.wait_for_function("!!document.activeElement.closest('[data-settings]')")
    # 공유 경고는 Share 를 누를 때 (D93 · D97)
    pg.click('[data-copy="share-url"]')
    expect(pg.locator('[data-share-warning]')).to_have_count(1)
    linked = pg.url
    no_hangul(pg)
    ctx.close()

    # ㊿ 폰 360 — 링크 없이 열면 Edit 탭(Project 설정) · 링크로 열면 Plan 탭
    c50 = browser.new_context(viewport={'width': 360, 'height': 800})
    p50 = c50.new_page()
    p50.on('pageerror', lambda e: errors.append(str(e)))
    goto_ready(p50, BASE + '/')
    expect(p50.locator('[data-wizard-layout]')).to_have_attribute('data-wizard-layout', 'phone')
    expect(p50.locator('[data-wizard-tab="edit"]')).to_have_attribute('aria-selected', 'true')
    expect(settings(p50)).to_be_visible()
    expect(settings(p50)).to_have_attribute('data-pick-path', 'project')
    expect(settings(p50).locator('#wizard-owner')).to_be_visible()
    expect(p50.locator('[data-wizard-list-column]')).to_be_hidden()
    no_hscroll(p50, 360, '첫 방문 Edit 탭')
    goto_ready(p50, linked.replace('#', '?link#', 1))
    expect(p50.locator('[data-wizard-tab="plan"]')).to_have_attribute('aria-selected', 'true')
    expect(p50.locator('[data-wizard-list-column]')).to_be_visible()
    expect(settings(p50)).to_be_hidden()
    c50.close()


def api_doc(browser, errors):
    """(51) /docs/api (D98) — 200 · 끝점 표가 /openapi.json 의 operation 전부 + 명세 밖 둘(내부용 POST /v1/events 표시) · curl 의 호스트는 이 화면의 출처 ·
    머리의 API 링크가 마법사 · 트리 둘 다에서 /docs/api 로 간다(hash 를 실어 간다) · 휴대폰 폭 가로 스크롤 없음"""
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    res = pg.goto(BASE + '/docs/api', wait_until='networkidle')
    assert res is not None and res.status == 200, res
    expect(pg.locator('h1')).to_have_text('API')
    spec = pg.request.get(BASE + '/openapi.json').json()
    ops = [(m.upper(), path) for path, item in spec['paths'].items() for m in item if m in ('get', 'post', 'put', 'patch', 'delete')]
    # 표 = 명세의 operation 전부 + 명세 밖 둘(/llms.txt 는 Worker 가 만들고 /openapi.json 은 명세 자신이다)
    rows = pg.locator('[data-api-endpoints] tbody tr')
    expect(rows).to_have_count(len(ops) + 2)
    for path_ in [p_ for _, p_ in ops] + ['/llms.txt', '/openapi.json']:
        assert rows.filter(has_text=path_).count() >= 1, path_
    expect(pg.locator('[data-api-endpoints] [data-internal]')).to_have_count(1)
    expect(pg.locator('[data-api-endpoints] tr:has([data-internal])')).to_contain_text('/v1/events')
    expect(pg.locator('[data-api-pending]')).to_have_count(0)
    curls = pg.locator('[data-api-example] [data-curl]').all_inner_texts()
    assert curls and all(BASE in c for c in curls), curls
    assert not any('/v1/events' in c for c in curls), curls
    expect(pg.locator('[data-api-409]')).to_contain_text('409')
    no_hangul(pg)
    # 머리 링크 — 마법사(첫 방문 · hash 없음)에서 눌러 간다 · 트리에서는 hash 를 실어 간다
    goto_ready(pg, BASE + '/')
    expect(pg.locator('header [data-nav-api]')).to_have_attribute('href', '/docs/api')
    open_more(pg)
    pg.click('header [data-nav-api]')
    pg.wait_for_url(BASE + '/docs/api')
    expect(rows).to_have_count(len(ops) + 2)
    tree_link = BASE + TREE + state_hash(INPUT)
    goto_ready(pg, tree_link)
    expect(pg.locator('[data-tree]')).to_have_count(1)
    expect(pg.locator('header [data-nav-api]')).to_have_attribute('href', '/docs/api' + state_hash(INPUT))
    open_more(pg)
    pg.click('header [data-nav-api]')
    pg.wait_for_url(re.compile(re.escape(BASE + '/docs/api') + r'(#.*)?$'))
    expect(pg.locator('h1')).to_have_text('API')
    pg.set_viewport_size({'width': 360, 'height': 800})
    no_hscroll(pg, 360, '/docs/api')
    ctx.close()


def plan_file(browser, rules_version, errors):
    """(52) 계획 파일 (D100) — Save plan → 새 창(빈 저장소)에서 Open plan → 같은 이름 · 같은 hash · 안내 없음.
    파일은 POST /v1/wizard 본문 그대로라 API 에 보내면 화면과 같은 이름이 온다 · 내려받을 때 공유 경고"""
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900}, accept_downloads=True)
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    start_example(pg)
    pg.locator('[data-card-add="website"]').click()
    fill_project(pg)
    pg.wait_for_function("() => location.hash.startsWith('#state=')")
    names = screen_names(pg)
    assert len(names) > 5 and all(v for _, _, v in names), names
    src_hash = pg.evaluate('location.hash')
    expect(pg.locator('[data-share-warning]')).to_have_count(0)
    with pg.expect_download() as dl:
        pg.click('[data-plan-save]')
    d = dl.value
    assert d.suggested_filename == 'cloudonym-plan-payments-prod.json', d.suggested_filename
    path = OUT / d.suggested_filename
    d.save_as(str(path))
    expect(pg.locator('[data-share-warning]')).to_have_count(1)
    text = path.read_text()
    body = json.loads(text)
    assert text.startswith('{\n  "'), text[:20]  # 두 칸 들여쓰기
    assert body['provider'] == 'gcp' and body['rules_version'] == rules_version, body
    assert body['project'] == {'owner': 'devops', 'system': 'payments', 'env': 'prod', 'region': 'ane3'}, body['project']  # 링크와 같은 꼴 — 지역은 코드
    assert 'environments' not in body, body  # 환경 하나면 요청 본문 그대로
    # 파일 = POST /v1/wizard 요청 본문 — 화면과 같은 이름
    res = post_api(pg, '/v1/wizard', body)
    assert res.status == 200, res.text()
    api = [(i['key'], i['name'], i['valid']) for i in res.json()['data']['gcp']['items']]
    assert api == names, (api, names)
    ctx.close()
    # 새 창 — Open plan 으로 연다(빈 첫 화면에서) → 같은 계획 · 같은 hash · 안내 없음
    c2 = browser.new_context(viewport={'width': 1280, 'height': 900})
    p2 = c2.new_page()
    p2.on('pageerror', lambda e: errors.append(str(e)))
    goto_ready(p2, BASE + '/')
    expect(p2.locator('[data-names-notice="need_project"]')).to_have_count(1)
    p2.set_input_files('[data-plan-file-input]', str(path))
    expect(p2.locator('#names article[data-key]')).to_have_count(len(names))
    assert screen_names(p2) == names, (screen_names(p2), names)
    p2.wait_for_function('h => location.hash === h', arg=src_hash)
    expect(p2.locator('[data-wizard-notice]')).to_have_count(0)
    expect(p2.locator('[data-rules-mismatch]')).to_have_count(0)
    # 다른 규칙 버전으로 저장된 파일 — 지금 규칙으로 열고 한 줄로 말한다
    old = OUT / 'cloudonym-plan-old-rules.json'
    old.write_text(json.dumps({**body, 'rules_version': OLD_RULES}, indent=2))
    p2.set_input_files('[data-plan-file-input]', str(old))
    expect(p2.locator('[data-wizard-notice]')).to_have_text([f'This file was saved with rules {OLD_RULES}; the current rules are {rules_version}. Names may differ.'])
    assert screen_names(p2) == names
    c2.close()


def header_menu(browser, errors):
    """(53) 머리 More 메뉴 (D104) — 밖에는 Share URL · Save plan · More · 화면 모드만 · 나머지 다섯(Open plan · Pick resources · Naming guide · API · llms.txt)은 메뉴 안.
    WAI-ARIA menu button — Enter · Space · ↓ 는 열고 첫 항목 · ↑ 는 열고 끝 항목 · ↑↓ 순환 · Home · End · Esc 는 닫고 단추로 · Tab 은 닫기만 · 바깥을 누르면 닫힌다.
    메뉴의 Open plan 이 파일 고르기 창을 연다(브라우저가 막지 않는다 — 고른 파일이 열린다) · 1280 에서 머리 한 줄 · 메뉴를 열어도 가로 스크롤 없음 · /pick 도 같은 원칙.
    폰(<768 · D105)은 밖의 단추를 전부 메뉴로 접는다 — Share URL · Save plan · 화면 모드(menuitemradio)도 메뉴 안 · 머리는 로고 줄 하나"""
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    start_example(pg)
    pg.wait_for_function("() => location.hash.startsWith('#state=')")
    linked = pg.url
    more, menu = pg.locator('header [data-nav-more]'), pg.locator('header [data-nav-menu]')
    items = menu.locator('[role="menuitem"]')
    # 밖의 단추 넷 · 메뉴 안 다섯(닫힌 채로 숨어 있다)
    for sel in ('[data-copy="share-url"]', '[data-plan-save]', '[data-nav-more]', '[data-theme-toggle]'):
        expect(pg.locator(f'header {sel}')).to_be_visible()
    for sel in ('[data-plan-open]', '[data-nav-pick]', '[data-nav-naming]', '[data-nav-api]', '[data-nav-llms]', '[data-nav-about]'):
        expect(menu.locator(sel)).to_be_hidden()
    expect(more).to_have_text('More')
    expect(more).to_have_attribute('aria-haspopup', 'menu')
    expect(more).to_have_attribute('aria-expanded', 'false')
    expect(more).to_have_attribute('aria-controls', menu.get_attribute('id'))
    expect(menu).to_have_attribute('role', 'menu')
    expect(menu).to_have_attribute('aria-labelledby', more.get_attribute('id'))
    expect(items).to_have_text(['Open plan', 'Pick resources', 'Naming guide', 'API', 'llms.txt', 'About'])  # About 은 /about 링크 (D109)
    for i in range(6):
        expect(items.nth(i)).to_have_attribute('tabindex', '-1')
    # 1280 — 머리 한 줄(단추 줄이 로고 줄 안에 · 단추 줄도 한 줄)
    h1280, same_row, one_row = header_rows(pg)
    assert same_row and one_row, ('1280 머리가 한 줄이 아니다', h1280, same_row, one_row)
    # 키보드 — Enter 로 열고 첫 항목 · ↓ · End · ↓(처음으로) · ↑(끝으로) · Home · Esc 는 닫고 단추로
    more.focus()
    pg.keyboard.press('Enter')
    expect(more).to_have_attribute('aria-expanded', 'true')
    expect(menu).to_be_visible()
    expect(items.nth(0)).to_be_focused()
    for key, at in (('ArrowDown', 1), ('End', 5), ('ArrowDown', 0), ('ArrowUp', 5), ('Home', 0), ('ArrowUp', 5)):
        pg.keyboard.press(key)
        expect(items.nth(at)).to_be_focused()
    pg.keyboard.press('Escape')
    expect(menu).to_be_hidden()
    expect(more).to_have_attribute('aria-expanded', 'false')
    expect(more).to_be_focused()
    # ↑ 는 열고 끝 항목 · Space · ↓ 는 첫 항목
    pg.keyboard.press('ArrowUp')
    expect(items.nth(5)).to_be_focused()
    pg.keyboard.press('Escape')
    for key in (' ', 'ArrowDown'):
        pg.keyboard.press(key)
        expect(items.nth(0)).to_be_focused()
        pg.keyboard.press('Escape')
        expect(more).to_be_focused()
    # Tab 은 닫기만 — 포커스는 메뉴 밖 다음 칸으로
    pg.keyboard.press('Enter')
    expect(items.nth(0)).to_be_focused()
    pg.keyboard.press('Tab')
    expect(menu).to_be_hidden()
    expect(more).to_have_attribute('aria-expanded', 'false')
    assert not pg.evaluate("!!document.activeElement.closest('[data-nav-menu]')")
    # 마우스 — 단추를 눌러 열고 다시 눌러 닫는다 · 바깥(제품 이름)을 누르면 닫힌다
    more.click()
    expect(menu).to_be_visible()
    more.click()
    expect(menu).to_be_hidden()
    more.click()
    expect(menu).to_be_visible()
    pg.click('header h1')
    expect(menu).to_be_hidden()
    # 메뉴를 열어도 머리 높이가 그대로다(메뉴는 위에 뜬다)
    more.click()
    assert header_rows(pg)[0] == h1280, (header_rows(pg), h1280)
    pg.keyboard.press('Escape')
    # 링크 항목 — 고르면 그 화면으로(상태 hash 를 실어 간다)
    open_more(pg)
    menu.locator('[data-nav-naming]').click()
    pg.wait_for_url(re.compile(re.escape(BASE + '/docs/naming') + r'#state=.+$'))
    ctx.close()

    # 메뉴의 Open plan — 같은 click 안에서 파일 고르기 창이 열리고(브라우저가 막지 않는다) 고른 파일이 열린다 · 메뉴는 닫히고 포커스는 단추로
    plan = OUT / 'cloudonym-plan-payments-prod.json'  # (52) 가 남긴 파일
    assert plan.exists(), plan
    c2 = browser.new_context(viewport={'width': 1280, 'height': 900})
    p2 = c2.new_page()
    p2.on('pageerror', lambda e: errors.append(str(e)))
    goto_ready(p2, BASE + '/')
    expect(p2.locator('#names article[data-key]')).to_have_count(0)
    open_more(p2)
    with p2.expect_file_chooser() as fc:
        p2.locator('header [data-plan-open]').click()
    expect(p2.locator('header [data-nav-menu]')).to_be_hidden()
    expect(p2.locator('header [data-nav-more]')).to_be_focused()
    fc.value.set_files(str(plan))
    p2.wait_for_function("() => location.hash.startsWith('#state=')")
    assert p2.locator('#names article[data-key]').count() > 5
    c2.close()

    # 폰 360 (D105) — 밖에는 More 하나(그림만 · 이름은 aria-label) · 소개 문구 없음 · 단추 줄이 로고 줄 안에.
    # 메뉴 = Share URL · Save plan · (D104 의 다섯) · 화면 모드 셋(menuitemradio) · 메뉴가 화면 안에 · 가로 스크롤 없음 · 바깥을 누르면 닫힌다
    c3 = browser.new_context(viewport={'width': 360, 'height': 800}, accept_downloads=True)
    c3.grant_permissions(['clipboard-read', 'clipboard-write'], origin=BASE)
    p3 = c3.new_page()
    p3.on('pageerror', lambda e: errors.append(str(e)))
    goto_ready(p3, linked)
    more3, menu3 = p3.locator('header [data-nav-more]'), p3.locator('header [data-nav-menu]')
    expect(more3.locator('span')).to_be_hidden()
    expect(more3).to_have_attribute('aria-label', 'More')
    expect(p3.locator('header [data-copy="share-url"], header [data-plan-save], header [data-theme-toggle], header [data-share-reserve], header [data-plan-save-reserve]')).to_have_count(0)
    expect(p3.locator('header p', has_text='Google Cloud resource names')).to_have_count(0)
    h360, same_row, one_row = header_rows(p3)
    assert same_row and one_row and h360 <= 110, ('360 머리가 로고 줄 하나가 아니다', h360, same_row, one_row)
    items3 = menu3.locator('[role="menuitem"], [role="menuitemradio"]')
    expect(items3).to_have_text(['Share URL', 'Save plan', 'Open plan', 'Pick resources', 'Naming guide', 'API', 'llms.txt', 'About', 'Light', 'Dark', 'System — follow the device setting'])
    expect(menu3.locator('[data-theme-menu]')).to_have_attribute('role', 'group')
    expect(menu3.locator('[data-theme-menu]')).to_have_attribute('aria-label', 'Screen mode')
    expect(menu3.locator('[data-theme-mode="system"]')).to_have_attribute('aria-checked', 'true')
    more3.click()
    expect(menu3).to_be_visible()
    expect(items3.nth(0)).to_be_focused()
    p3.keyboard.press('End')
    expect(items3.nth(10)).to_be_focused()
    p3.keyboard.press('ArrowDown')
    expect(items3.nth(0)).to_be_focused()
    box = menu3.bounding_box()
    assert box['x'] >= 0 and box['x'] + box['width'] <= 360 and box['y'] + box['height'] <= 800, box
    no_hscroll(p3, 360, 'More 메뉴를 연 머리')
    p3.mouse.click(180, 700)
    expect(menu3).to_be_hidden()
    # Share URL — 메뉴가 닫히고 복사 · 결과 줄 · 마법사의 공유 경고(D93) · 머리 높이는 결과 줄 하나만큼만
    expect(p3.locator('[data-share-warning]')).to_have_count(0)
    open_more(p3)
    menu3.locator('[data-menu-share]').click()
    expect(menu3).to_be_hidden()
    expect(more3).to_be_focused()
    assert p3.evaluate('navigator.clipboard.readText()') == linked, p3.evaluate('navigator.clipboard.readText()')
    expect(p3.locator('header [data-share-menu-status]')).to_have_text('Copied')
    expect(p3.locator('[data-share-warning]')).to_have_count(1)
    # Save plan — 같은 파일이 내려받아진다
    open_more(p3)
    with p3.expect_download() as dl3:
        menu3.locator('[data-menu-plan-save]').click()
    assert dl3.value.suggested_filename == 'cloudonym-plan-billing-prod.json', dl3.value.suggested_filename  # start_example 의 값
    # 화면 모드 — 고르면 바뀌고 메뉴가 닫힌다 · 체크가 옮겨 간다
    open_more(p3)
    menu3.locator('[data-theme-mode="dark"]').click()
    expect(menu3).to_be_hidden()
    assert p3.evaluate("document.documentElement.classList.contains('dark')") is True
    expect(menu3.locator('[data-theme-mode="dark"]')).to_have_attribute('aria-checked', 'true')
    expect(menu3.locator('[data-theme-mode="system"]')).to_have_attribute('aria-checked', 'false')
    open_more(p3)
    menu3.locator('[data-theme-mode="system"]').click()
    # 메뉴를 연 채 768 을 넘으면 항목이 바뀐다 — 메뉴는 닫히고 포커스는 More 단추로 (넓은 쪽 · 다시 폰 쪽 둘 다)
    for w in (768, 360):
        more3.click()
        p3.keyboard.press('End')
        p3.set_viewport_size({'width': w, 'height': 800})
        expect(menu3).to_be_hidden()
        expect(more3).to_be_focused()
    goto_ready(p3, BASE + '/')
    h360_first = header_rows(p3)[0]
    # 폰의 예시는 Cloud Run 한 줄 (D107 · D108)
    expect(p3.locator('[data-intro-example]')).to_be_visible()
    expect(p3.locator('[data-intro-example-name]')).to_have_text([INTRO_EXAMPLE[1]])
    expect(p3.locator('header [data-nav-menu] [role="menuitem"]')).to_have_text(['Open plan', 'Pick resources', 'Naming guide', 'API', 'llms.txt', 'About'])  # 링크 없는 첫 화면 — 공유 · 저장할 것이 없다
    c3.close()

    # /pick — 밖에는 Share URL · More · 화면 모드 · 메뉴는 Wizard · Naming guide · API · llms.txt · About (Open plan 은 마법사에만)
    c4 = browser.new_context(viewport={'width': 1280, 'height': 900})
    p4 = c4.new_page()
    p4.on('pageerror', lambda e: errors.append(str(e)))
    goto_ready(p4, BASE + TREE + state_hash(INPUT))
    expect(p4.locator('header [data-copy="share-url"]')).to_be_visible()
    expect(p4.locator('header [data-plan-save], header [data-plan-open]')).to_have_count(0)
    expect(p4.locator('header [data-nav-menu] [role="menuitem"]')).to_have_text(['Wizard', 'Naming guide', 'API', 'llms.txt', 'About'])  # About 은 /pick 에도 (D109)
    expect(p4.locator('header [data-nav-menu]')).to_be_hidden()
    pick1280, same_row, one_row = header_rows(p4)
    assert same_row and one_row, ('/pick 1280 단추 줄이 로고 줄에 없다', pick1280)
    open_more(p4)
    p4.locator('header [data-nav-wizard]').click()
    p4.wait_for_url(BASE + '/')  # 트리 hash 는 마법사로 실어 가지 않는다(href 가 / 이다)
    expect(p4.locator('[data-wizard]')).to_be_visible()
    # /pick 360 — 밖에는 More 하나 · 공유 경고는 메뉴의 Share URL 을 누른 뒤(마법사와 같은 규칙 · D105) · 메뉴에 Open plan 없음
    p4.set_viewport_size({'width': 360, 'height': 800})
    goto_ready(p4, BASE + TREE + state_hash(INPUT))
    pick360, same_row, one_row = header_rows(p4)
    assert same_row and one_row and pick360 <= 70, ('/pick 360 머리가 한 줄이 아니다', pick360)
    expect(p4.locator('[data-share-warning]')).to_have_count(0)
    expect(p4.locator('header [data-nav-menu] [role="menuitem"], header [data-nav-menu] [role="menuitemradio"]')).to_have_text(['Share URL', 'Wizard', 'Naming guide', 'API', 'llms.txt', 'About', 'Light', 'Dark', 'System — follow the device setting'])
    open_more(p4)
    p4.locator('header [data-menu-share]').click()
    expect(p4.locator('[data-share-warning]')).to_be_visible()
    no_hscroll(p4, 360, '/pick 공유 경고')
    c4.close()
    print(f'(53) 머리 높이 — 마법사 1280: {h1280}px · 360(링크): {h360}px · 360(첫 방문): {h360_first}px · /pick 1280: {pick1280}px · /pick 360: {pick360}px')


def wizard_narrow_shots(browser, errors):
    """07 태블릿 768 — 이름 드로어 열림 · 08 폰 360 — Edit 탭의 Web server 설정(딸린 것 펼침 — D93)"""
    ctx, pg = narrow_plan(browser, errors, 768, 1024)
    expect(pg.locator('[data-wizard-layout]')).to_have_attribute('data-wizard-layout', 'tablet')
    pg.click('[data-names-bar]')
    pg.wait_for_function("() => document.querySelector('[data-names-drawer]').open")
    wizard_shot(pg, '07-wizard-tablet.png')
    ctx.close()
    ctx, pg = narrow_plan(browser, errors, 360, 800)
    expect(pg.locator('[data-wizard-layout]')).to_have_attribute('data-wizard-layout', 'phone')
    pg.click('[data-wizard-tab="plan"]')  # 링크 없이 연 창이라 Edit 탭에서 시작한다 (D97) — 목록의 줄을 누르려면 Plan 탭으로
    pg.locator('[data-row-path="services[0].picks[0]"]').click()
    expect(pg.locator('[data-wizard-tab="edit"]')).to_have_attribute('aria-selected', 'true')
    open_attached(settings(pg).locator('li[data-slot]').nth(0))
    wizard_shot(pg, '08-wizard-phone.png')
    ctx.close()



with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    # 개발 서버는 화면 HTML 에 CSP 를 달지 않는다(D108 — Vite 의 인라인 preamble). 운영 응답의 CSP 는 src/api/site.test 가 잰다
    errors = []

    # ── ⑴ 첫 방문 — 버튼 셋 중 둘(AWS · Azure)은 꺼진 「Coming soon」 · 켜진 GCP 가 자동 선택 · 다섯 입력 · SA 를 골라 축약 안내 · 비콘 수 ──
    ctx1 = browser.new_context(viewport={'width': 1280, 'height': 900})
    ctx1.grant_permissions(['clipboard-read', 'clipboard-write'], origin=BASE)
    page = ctx1.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    sent = events_of(page)
    goto_ready(page, BASE + TREE)
    VERSION = page.request.get(BASE + '/v1/health').json()['version']
    RULES = VERSION['rules']
    assert RULES != OLD_RULES, RULES
    expect(page.locator('h1')).to_have_text('Cloudonym')
    assert page.evaluate('document.documentElement.lang') == 'en'
    # 버튼은 셋 다 그린다 — 켜진 것이 하나(GCP)라 첫 그리기 때 그것이 골라지고 트리가 바로 보인다 (D45)
    assert page.eval_on_selector_all('[role="radio"][data-cloud]', 'els => els.map(e => e.dataset.cloud)') == ['aws', 'gcp', 'azure']
    expect(page.locator('[role="radio"][data-cloud][aria-checked="true"]')).to_have_count(1)
    expect(page.locator('[data-cloud="gcp"]')).to_have_attribute('aria-checked', 'true')
    expect(page.locator('[data-cloud="gcp"]')).to_be_enabled()
    expect(page.locator('[data-pick-cloud]')).to_have_count(0)
    expect(page.locator('[data-tree]')).to_have_count(1)
    for cloud, tip in (('aws', 'AWS: planned for 0.2.0'), ('azure', 'Azure: planned for 0.3.0')):
        btn = page.locator(f'[data-cloud="{cloud}"]')
        expect(btn).to_be_disabled()
        expect(btn).to_have_attribute('aria-disabled', 'true')
        expect(btn).to_have_attribute('aria-checked', 'false')
        expect(btn).to_have_attribute('title', tip)
        expect(btn.locator('[data-coming-soon]')).to_have_text('Coming soon')
    expect(page.locator('[data-coming-soon]')).to_have_count(2)
    # PASS 뜻 한 줄(D28) · 버전 꼬리말(D26) · 링크가 없으면 규칙 버전 안내도 없다
    expect(page.locator('[data-pass-meaning]')).to_contain_text('It does not mean the name is available')
    expect(page.locator('[data-pass-meaning]')).to_contain_text('Generated names are not guaranteed unique')
    expect(page.locator('[data-version]')).to_have_text(f"Engine {VERSION['engine']} · rules {RULES}")
    expect(page.locator('[data-rules-mismatch]')).to_have_count(0)
    # 공유 URL 경고 — hash 는 Base64(암호화 아님)라 링크를 받은 사람이 입력값을 읽는다 · 버튼 툴팁 · 접근성 이름도 같은 사실
    expect(page.locator('[data-share-warning]')).to_have_text('The share link and the address bar hold your input as Base64, which is not encrypted — anyone with the link can read owner, system, purpose and the other values. Do not enter sensitive values such as internal company or project names.')
    expect(page.locator('[data-share-warning]')).to_be_visible()
    share_btn_label = 'Copy share URL — a link holding the current input in readable form (Base64, not encrypted)'
    expect(page.locator('[data-copy="share-url"]')).to_have_attribute('title', share_btn_label)
    expect(page.locator('[data-copy="share-url"]')).to_have_attribute('aria-label', share_btn_label)
    fill_five(page, INPUT)
    expect(page.locator('[data-names-empty]')).to_have_text('Pick resources in step 3 to generate their names.')
    check(page, 'service_account')
    sa = page.locator(SA_CARD)
    expect(sa.locator('[data-name]')).to_have_text('payments-ledger-prod-sa-sync')
    # 서비스 계정에는 owner · 지역이 없어 축소되지 않는다 (D77) — 축소 안내 문장은 ResultCard.test 가 정적 마크업으로 본다
    expect(sa.locator('[data-steps]')).to_have_count(0)
    expect(sa).to_have_attribute('data-valid', 'true')
    expect(sa.locator('h4')).to_have_text('Service Account · sync')
    page.wait_for_timeout(1500)  # 디바운스 1초 뒤에 ui_generate 가 한 번
    assert sent.count('ui_visit') == 1, f'ui_visit 이 {sent.count("ui_visit")}회 — StrictMode 이중 effect 를 sessionStorage 가드가 막아야 한다: {sent}'
    assert sent.count('ui_generate') == 1, f'ui_generate 가 {sent.count("ui_generate")}회 — 다섯 입력을 1초 디바운스로 한 번 · CSP · 선택은 세지 않는다: {sent}'

    # ── ⑽ 꺼진 CSP 는 눌리지 않는 예고다 — 클릭 · 방향키로 고를 수 없다 · 확인 창이 뜨지 않는다 · 선택은 그대로 ──
    dialogs = []
    record = lambda d: (dialogs.append(d.message), d.dismiss())
    page.on('dialog', record)
    page.locator('[data-cloud="azure"]').click(force=True)  # disabled 버튼 — 브라우저가 click 을 내지 않는다
    page.locator('[data-cloud="gcp"]').focus()
    for key in ('ArrowRight', 'ArrowLeft', 'End', 'Home'):  # 켜진 버튼이 하나라 포커스는 GCP 에 머문다
        page.keyboard.press(key)
        assert page.evaluate('document.activeElement.dataset.cloud') == 'gcp', key
    page.wait_for_timeout(200)
    assert dialogs == [], f'꺼진 CSP 가 확인 창을 띄웠다: {dialogs}'
    expect(page.locator('[data-cloud="gcp"]')).to_have_attribute('aria-checked', 'true')
    expect(page.locator('[data-cloud="azure"]')).to_have_attribute('aria-checked', 'false')
    expect(page.locator('[data-selected-count]')).to_have_text('1 selected')
    # 탭 순서는 체크된 라디오(GCP)가 받는다 — 꺼진 버튼은 -1
    assert page.eval_on_selector_all('[role="radio"][data-cloud]', 'els => els.map(e => [e.dataset.cloud, e.tabIndex])') == [['aws', -1], ['gcp', 0], ['azure', -1]]
    page.remove_listener('dialog', record)
    # 선택을 비운다 — 선택이 0개여도 Terraform 버튼으로 라벨 블록만 담은 locals 를 복사한다
    row(page, 'service_account').locator('input[data-row-check]').uncheck()
    expect(page.locator('[data-selected-count]')).to_have_text('0 selected')
    expect(page.locator('article[data-key]')).to_have_count(0)
    page.wait_for_timeout(1200)
    assert sent.count('ui_generate') == 1, f'선택 변경이 ui_generate 를 셌다: {sent}'
    expect(page.locator('[data-names-empty]')).to_have_text('Pick resources in step 3 to generate their names.')
    page.click('[data-copy="terraform"]')
    tags_only = page.evaluate('navigator.clipboard.readText()')
    assert '  # gcp\n  gcp_labels = {\n' in tags_only, tags_only
    assert '    owner = "devops"\n' in tags_only and tags_only.endswith('  }\n}\n'), tags_only
    assert 'gcp_project_id' not in tags_only and 'INVALID' not in tags_only, tags_only
    page.wait_for_timeout(300)  # 복사가 되면 ui_copy(target=terraform) 비콘 한 번 (D56)
    assert sent.count('ui_copy') == 1, f'ui_copy 가 {sent.count("ui_copy")}회 — Terraform 복사 한 번에 한 번: {sent}'

    # ── ⑾ 개수 → 이름 끝 · seq 없는 규칙은 1 고정 · 역할 · 키보드(↑ ↓ 는 체크할 수 없는 행을 건너뛴다) ──
    # 화면은 catalog 행 하나가 한 줄이다 — 범위만 다른 규칙 여럿은 한 행(합친 행)으로 묶여 범위 select 를 갖는다 (D53)
    # 기대값은 /llms.txt 의 규칙 트리 — 단일 행은 (타입 · 깊이)가 규칙과 같고, 합친 행의 범위 수를 더하면 규칙 수가 된다(규칙이 늘어도 뜻이 같다)
    GCP_TREE = llms_tree(page, 'gcp')
    INITIAL = rows_info(page)
    singles = [r for r in INITIAL if r['scopes'] == 0]
    merged = [r for r in INITIAL if r['scopes'] > 0]
    assert merged and all(r['type'] is None and r['scopes'] >= 2 for r in merged), merged  # 범위를 고르기 전 합친 행은 규칙을 가리키지 않는다
    assert set((r['type'], r['depth']) for r in singles) <= set(GCP_TREE), [r for r in singles if (r['type'], r['depth']) not in GCP_TREE]
    assert len(singles) + sum(r['scopes'] for r in merged) == len(GCP_TREE), (len(singles), sum(r['scopes'] for r in merged), len(GCP_TREE))
    assert {r['depth'] for r in merged} == {1}, {r['key']: r['depth'] for r in merged}  # 합친 행은 범위들의 공통 조상(Project)에 놓인다
    assert chip_count(page, 'all') == len(INITIAL), (chip_count(page, 'all'), len(INITIAL))
    # 처음엔 뿌리 바로 아래 한 단계만 펼친다 — 깊이 0 · 1 의 행이 전부 보이고 그보다 깊은 행은 하나도 보이지 않는다
    assert {'gcp.project_id', 'gcp.storage_bucket', 'gcp.service_account', 'gcp.compute_instance'} <= {r['key'] for r in INITIAL if r['depth'] <= 1}
    assert sorted(visible_rows(page)) == sorted(r['key'] for r in INITIAL if r['depth'] <= 1), visible_rows(page)
    assert any(r['depth'] >= 2 for r in INITIAL), '깊이 2 이상 행이 없으면 「처음엔 닫혀 있다」를 잰 것이 아니다'
    page.click('[data-expand-all]')
    ALL_ROWS = rows_info(page)
    assert all(r['visible'] for r in ALL_ROWS), [r['key'] for r in ALL_ROWS if not r['visible']]
    expect(row(page, 'subnet')).to_be_visible()
    for t in ('project_id', 'storage_bucket', 'service_account', 'compute_instance'):
        check(page, t)
    expect(row(page, 'project_id').locator('[data-count-fixed]')).to_have_attribute('title', 'This resource has no sequence number, so it is always one')
    vm_row = row(page, 'compute_instance')
    for _ in range(2):
        vm_row.locator('[data-inc]').click()
    expect(vm_row.locator('[data-count]')).to_have_text('3')
    expect(page.locator('article[data-key="compute_instance_03"] [data-name]')).to_have_text('payments-ledger-prod-euw1-gce-03')
    expect(page.locator('article[data-key="compute_instance_03"] h4')).to_have_text('VM Instance · 03')  # 카드 제목 = catalog 행 이름
    vm_row.locator('input[data-row-check]').focus()
    page.keyboard.press('-')
    expect(vm_row.locator('[data-count]')).to_have_text('2')
    expect(page.locator('article[data-key="compute_instance_03"]')).to_have_count(0)
    # ↓ 는 보이는 다음 행 중 체크 상자가 켜진 첫 행으로 — VM 바로 다음 행들은 범위를 고르지 않은 합친 행이라 체크 상자가 꺼져 있어 건너뛴다
    order = page.eval_on_selector_all('[data-tree] [data-row]', 'els => els.filter(e => e.checkVisibility()).map(e => [e.dataset.row, e.querySelector("input[data-row-check]").disabled])')
    i_vm = [k for k, _ in order].index('gcp.compute_instance')
    skipped = 0
    while order[i_vm + 1 + skipped][1]:
        skipped += 1
    assert skipped > 0, order[i_vm:i_vm + 4]  # 공허하지 않다 — 건너뛸 행이 실제로 있다
    page.keyboard.press('ArrowDown')
    assert page.evaluate("document.activeElement.closest('[data-row]')?.dataset.row") == order[i_vm + 1 + skipped][0], (order[i_vm:i_vm + skipped + 2], skipped)
    page.keyboard.press('ArrowUp')
    assert page.evaluate("document.activeElement.closest('[data-row]')?.dataset.row") == 'gcp.compute_instance'
    role_input = row(page, 'service_account').locator('[data-role-input]')
    expect(role_input).to_have_value('sync')
    role_input.fill('D')  # 꼴이 틀리면 반영하지 않고 aria-invalid
    expect(role_input).to_have_attribute('aria-invalid', 'true')
    expect(page.locator('article[data-key="service_account_sync"]')).to_have_count(1)
    # 무효인 동안 그 행에 「이전 역할로 생성됨」 안내 · blur 하면 칸이 마지막 유효 값으로 돌아간다
    mi_row = row(page, 'service_account')
    expect(mi_row.locator('[data-role-stale]')).to_have_text('Not a valid role — names still use the previous role "sync"')
    expect(role_input).to_have_attribute('aria-describedby', mi_row.locator('[data-role-stale]').get_attribute('id'))
    role_input.blur()
    expect(role_input).to_have_value('sync')
    expect(role_input).to_have_attribute('aria-invalid', 'false')
    expect(mi_row.locator('[data-role-stale]')).to_have_count(0)
    role_input.fill('Web')  # 대문자는 blur 때 소문자로 — 꼴에 맞으면 반영한다
    expect(mi_row.locator('[data-role-stale]')).to_be_visible()
    role_input.blur()
    expect(role_input).to_have_value('web')
    expect(page.locator('article[data-key="service_account_web"]')).to_have_count(1)
    role_input.fill('')
    expect(mi_row.locator('[data-role-stale]')).to_have_text('Not a valid role — names still use the previous role "web"')
    role_input.blur()
    expect(role_input).to_have_value('web')
    role_input.fill('db')
    expect(page.locator('article[data-key="service_account_db"] [data-name]')).to_have_text('payments-ledger-prod-sa-db')
    expect(page.locator('[data-names-summary]')).to_have_text('4 resources · 5 names · 5/5 PASS')
    # 범위 경로 머리글 — 트리 순서
    assert page.locator('[data-scope-path]').all_inner_texts() == ['Global namespace', 'Global namespace › Project'], page.locator('[data-scope-path]').all_inner_texts()
    assert hash_state(page.url) == {**INPUT, 'v': RULES, 'p': 'gcp', 'r': PICK}, hash_state(page.url)
    assert list(hash_state(page.url)['r']) == list(PICK), hash_state(page.url)  # r 순서 = 트리 순서
    assert_selects_fit(page, 1280)
    no_hangul(page)
    page.evaluate('window.scrollTo(0, 0)')
    shot(page, '01-desktop-light.png')
    share_url = page.url
    # 트리의 주소창 · Share URL 은 /pick 이다 (D68)
    assert share_url.startswith(BASE + TREE + '#state='), share_url

    # ── ⑸ 내보내기 셋 + 태그 JSON · 이름 복사 · 공유 URL ──
    page.click('[data-copy="terraform"]')
    hcl = page.evaluate('navigator.clipboard.readText()')
    head = hcl.split('\n')
    assert head[0] == f"# Generated by Cloudonym — engine {VERSION['engine']} · rules {RULES}", head[:3]
    assert head[1].startswith('# PASS means') and head[2] == 'locals {', head[:3]
    assert '  # gcp\n  gcp_project_id = "devops-payments-ledger-prod"\n  gcp_storage_bucket = "devops-payments-ledger-prod-euw1-gcs"\n  gcp_service_account_db = "payments-ledger-prod-sa-db"\n  gcp_compute_instance_01 = "payments-ledger-prod-euw1-gce-01"\n  gcp_compute_instance_02 = "payments-ledger-prod-euw1-gce-02"\n' in hcl, hcl
    assert '  gcp_labels = {\n' in hcl and 'INVALID' not in hcl and 'azure' not in hcl and 'aws' not in hcl, hcl
    page.click('[data-copy="names-json"]')
    names = json.loads(page.evaluate('navigator.clipboard.readText()'))
    assert names['version'] == VERSION and names['provider'] == 'gcp' and names['context'] == {**{k: INPUT[k] for k in ('owner', 'system', 'purpose', 'env')}, 'region': 'euw1'}, names
    assert [n['key'] for n in names['names']] == ['project_id', 'storage_bucket', 'service_account_db', 'compute_instance_01', 'compute_instance_02'], names['names']
    assert names['names'][3] == {'key': 'compute_instance_01', 'resource_type': 'compute_instance', 'seq': '01', 'scope': 'gcp:project', 'name': 'payments-ledger-prod-euw1-gce-01'}, names['names'][3]
    assert names['invalid'] == [], names['invalid']
    expect(page.locator('[data-copy="all-names"]')).to_have_text('Copy all names')
    page.click('[data-copy="all-names"]')
    assert page.evaluate('navigator.clipboard.readText()') == 'devops-payments-ledger-prod\ndevops-payments-ledger-prod-euw1-gcs\npayments-ledger-prod-sa-db\npayments-ledger-prod-euw1-gce-01\npayments-ledger-prod-euw1-gce-02'
    page.click('[data-copy="tags-json"]')
    copied_tags = json.loads(page.evaluate('navigator.clipboard.readText()'))
    assert copied_tags == {'version': VERSION, 'labels': {'gcp': {'owner': 'devops', 'system': 'payments', 'purpose': 'ledger', 'environment': 'prod', 'managed_by': 'cloudonym'}}}, copied_tags
    page.click(f'{VM1} [data-copy="name:compute_instance_01"]')
    assert page.evaluate('navigator.clipboard.readText()') == 'payments-ledger-prod-euw1-gce-01'
    page.click('[data-copy="share-url"]')
    copied_url = page.evaluate('navigator.clipboard.readText()')
    assert copied_url == share_url, (copied_url, share_url)

    # ── ⑿ 검색 · 분류 칩 · 선택만 보기 ──
    search = page.locator('[data-tree-search]')
    search.fill('subnet')
    # 검색 일치(행 이름 · key · 규칙의 타입 · slug · entity · 별칭)는 화면 밖에서 다 알 수 없다 — 앵커 하나가 걸리고, 걸러지는 행이 있고, 걸린 행은 전부 보인다
    want = sorted(page.eval_on_selector_all('[data-tree] [data-row]', 'els => els.map(e => e.dataset.row)'))
    assert 'gcp.subnet' in want and len(want) < len(ALL_ROWS), want  # 공허하지 않다 — 일치가 있고 걸러지는 행도 있다
    assert sorted(visible_rows(page)) == want, visible_rows(page)  # 일치하는 행만 남고 그 조상은 펼친다
    # 걸러진 동안에도 범위 머리(summary)를 누르면 접히고 다시 누르면 펼친다 — 늦게 오는 toggle 이벤트가 되돌리지 않는다
    page.locator('[data-tree] details[data-scope] > summary').first.click()
    page.wait_for_timeout(100)
    assert not page.eval_on_selector('[data-tree] details[data-scope]', 'e => e.open'), '걸러진 트리의 뿌리가 접히지 않았다'
    assert visible_rows(page) == [], visible_rows(page)
    page.locator('[data-tree] details[data-scope] > summary').first.click()
    page.wait_for_timeout(100)
    assert sorted(visible_rows(page)) == want, visible_rows(page)
    search.fill('zzz-none')
    expect(page.locator('[data-search-empty]')).to_have_text('No resource matches. A resource missing from this list is not supported yet.')
    search.fill('')
    # 분류 칩 — 누르면 그 분류의 행만 전부 보인다 · 칩의 수 = 그 행 수 · 앵커 둘이 들어 있다
    net = sorted(r['key'] for r in ALL_ROWS if r['category'] == 'networking')
    assert {'gcp.subnet', 'gcp.vpc_network', 'gcp.address'} <= set(net) and len(net) < len(ALL_ROWS), net
    assert chip_count(page, 'networking') == len(net), (chip_count(page, 'networking'), net)
    page.click('button[data-category="networking"]')
    assert all(r['category'] == 'networking' for r in rows_info(page)), rows_info(page)
    assert sorted(visible_rows(page)) == net, visible_rows(page)
    page.click('button[data-category="all"]')
    page.check('[data-selected-only]')
    assert visible_rows(page) == ['gcp.project_id', 'gcp.storage_bucket', 'gcp.service_account', 'gcp.compute_instance'], visible_rows(page)
    page.uncheck('[data-selected-only]')
    expect(tree_rows(page)).to_have_count(len(ALL_ROWS))
    assert chip_count(page, 'all') == len(ALL_ROWS), chip_count(page, 'all')
    # 검색을 지우면 필터 전 펼침으로 돌아간다 — 걸러진 동안 접고 편 것은 거르지 않은 보기에 남지 않는다
    assert page.eval_on_selector('[data-tree] details[data-scope]', 'e => e.open')
    page.click('[data-collapse-all]')  # 뿌리만 열어 두고 분류 묶음은 전부 접는다 — 깊이 0 의 행 중 묶음 밖 것만 보인다
    roots = sorted(r['key'] for r in ALL_ROWS if r['depth'] == 0)
    assert {'gcp.project_id', 'gcp.storage_bucket'} <= set(roots) and len(roots) < len(ALL_ROWS), roots
    groups = page.eval_on_selector_all('[data-tree] details[data-group]', 'els => els.map(e => e.open)')
    assert len(groups) > 0 and not any(groups), groups  # 공허하지 않다 — 묶음이 있고 전부 닫혔다
    in_group = page.eval_on_selector_all('[data-tree] details[data-group] [data-row]', 'els => els.map(e => e.dataset.row)')
    assert sorted(visible_rows(page)) == sorted(k for k in roots if k not in in_group), (visible_rows(page), roots, in_group)
    page.click('[data-expand-all]')

    # ── ⑿-2 걸러진 동안에도 모두 펼치기 · 모두 접기 · summary · 키보드가 걸러진 보기 안에서 돈다. 필터를 지우면 필터 전 펼침 ──
    # 판정은 즉시 한 번 · 100ms 뒤 한 번 — <details> 의 toggle 은 늦게 오므로 잘못 이어지면 「잠깐 맞고 되돌아간다」
    OPEN_MAP_JS = 'els => Object.fromEntries(els.map(e => [e.dataset.scope ?? e.dataset.group, e.open]))'
    open_map = lambda: page.eval_on_selector_all('[data-tree] details', OPEN_MAP_JS)
    open_count = lambda: sum(open_map().values())

    def settled(fn, want_value, label):
        assert fn() == want_value, (label, fn(), want_value)
        page.wait_for_timeout(100)
        assert fn() == want_value, (label + ' (100ms 뒤)', fn(), want_value)

    cdp = ctx1.new_cdp_session(page)

    def ax_matches_dom():
        """보이는 범위 머리마다 접근성 트리의 expanded(summary = DisclosureTriangle) 가 details.open 과 같다 — aria-expanded 를 따로 두지 않고 브라우저가 노출한다"""
        nodes = cdp.send('Accessibility.getFullAXTree')['nodes']
        ax = [next((x['value'].get('value') for x in n.get('properties', []) if x['name'] == 'expanded'), None)
              for n in nodes if n.get('role', {}).get('value') == 'DisclosureTriangle']
        dom = page.eval_on_selector_all('[data-tree] details', 'els => els.filter(e => e.querySelector(":scope > summary").checkVisibility()).map(e => e.open)')  # 접힌 범위 안의 머리는 접근성 트리에 없다
        assert len(ax) == len(dom) and ax == dom, (ax, dom)

    def header_counts_match():
        """범위 머리 (n) = 그 범위 안의 걸러진 행 수 — 접힌 범위도 몇 개가 걸렸는지 보인다"""
        pairs = page.eval_on_selector_all('[data-tree] details[data-scope]',
                                          'els => els.map(e => [e.querySelector(":scope > summary").textContent, e.querySelectorAll("[data-row]").length])')
        assert pairs and all(t.rstrip().endswith(f'({n})') for t, n in pairs), pairs

    # 필터 전 펼침을 기본과 다르게 만든다 — 모두 접기 뒤 Project 하나만 연다(복원을 재는 시험이 공허하지 않게)
    page.click('[data-collapse-all]')
    page.locator('[data-tree] details[data-scope="gcp:project"] > summary').click()
    page.wait_for_timeout(100)
    before = open_map()
    assert before['gcp:project'] and not before['gcp:project_region'], before
    for q in ('subnet', 'policy'):
        search.fill(q)
        n_all = len(open_map())
        assert n_all >= 3, (q, open_map())  # 공허하지 않다 — 걸러진 보기에도 접을 범위가 있다
        settled(open_count, n_all, f'{q} 처음엔 걸러진 결과를 모두 펼친다')
        header_counts_match()
        page.click('[data-collapse-all]')
        settled(open_count, 1, f'{q} 모두 접기 — 뿌리만 남는다')
        # 보이는 행은 뿌리(깊이 0)에 바로 놓이고 분류 묶음 밖인 걸린 행뿐이다
        at_root = page.eval_on_selector_all('[data-tree] [data-row]', 'els => els.filter(e => !e.closest("details[data-group]") && !e.parentElement.closest("details[data-scope]").parentElement.closest("details[data-scope]")).map(e => e.dataset.row)')
        assert sorted(visible_rows(page)) == sorted(at_root), (visible_rows(page), at_root)
        assert len(visible_rows(page)) < page.locator('[data-tree] [data-row]').count(), q  # 공허하지 않다 — 접혀 숨은 행이 있다
        header_counts_match()
        ax_matches_dom()
        page.click('[data-expand-all]')
        settled(open_count, n_all, f'{q} 모두 펼치기')
        assert visible_rows(page), visible_rows(page)
        ax_matches_dom()
    # 키보드 — summary 에 초점을 두고 Enter 로 접고 Space 로 편다 · 접힌 범위 머리에 걸린 수가 남는다
    deep = page.locator('[data-tree] details[data-scope]').last
    deep_id = deep.get_attribute('data-scope')
    deep.locator(':scope > summary').focus()
    page.keyboard.press('Enter')
    settled(lambda: open_map()[deep_id], False, 'Enter 로 접기')
    ax_matches_dom()
    header_counts_match()
    page.keyboard.press('Space')
    settled(lambda: open_map()[deep_id], True, 'Space 로 펴기')
    ax_matches_dom()
    search.fill('')
    settled(open_map, before, '검색을 지우면 필터 전 펼침')
    # 분류 칩도 같다 — 걸러진 보기 안에서 접고 펴고, 칩을 풀면 필터 전 펼침
    page.click('button[data-category="networking"]')
    n_net = len(open_map())
    assert n_net >= 3, open_map()
    settled(open_count, n_net, '칩 — 처음엔 모두 펼친다')
    page.click('[data-collapse-all]')
    settled(open_count, 1, '칩 — 모두 접기')
    page.click('[data-expand-all]')
    settled(open_count, n_net, '칩 — 모두 펼치기')
    page.click('button[data-category="all"]')
    settled(open_map, before, '칩을 풀면 필터 전 펼침')
    page.click('[data-expand-all]')

    # ── ⑵ 공유 URL 을 새 탭(새 컨텍스트 = 빈 sessionStorage)에 붙이면 문맥 · CSP · 선택이 복원된다 ──
    ctx2 = browser.new_context(viewport={'width': 1280, 'height': 900})
    page2 = ctx2.new_page()
    page2.on('pageerror', lambda e: errors.append(str(e)))
    sent2 = events_of(page2)
    goto_ready(page2, copied_url)
    expect_ctx(page2, INPUT)
    expect(page2.locator('[data-cloud="gcp"]')).to_have_attribute('aria-checked', 'true')
    expect(page2.locator(f'{VM1} [data-name]')).to_have_text('payments-ledger-prod-euw1-gce-01')
    expect(page2.locator('article[data-key]')).to_have_count(5)
    page2.wait_for_timeout(1300)
    assert sent2 == ['ui_visit'], f'복원 로드는 ui_visit 1회뿐이어야 한다(첫 화면은 ui_generate 를 세지 않는다): {sent2}'
    assert page2.url == copied_url, (page2.url, copied_url)
    ctx2.close()

    # ── ⑹ 같은 탭에서 공유 URL 로 이동(hash 만 바뀐다) → 상태가 따라온다 · ui_generate 를 세지 않는다 · 깨진 hash 는 지금 상태로 되돌린다 ──
    generated_before = sent.count('ui_generate')
    other_hash = state_hash(OTHER, RULES, 'gcp', {'compute_instance': 3})
    page.evaluate('h => { location.hash = h; }', other_hash)
    expect_ctx(page, OTHER)
    expect(page.locator('[data-cloud="gcp"]')).to_have_attribute('aria-checked', 'true')
    expect(page.locator('article[data-key="compute_instance_03"] [data-name]')).to_have_text('billing-batch-stg-ane1-gce-03')
    page.wait_for_timeout(1300)
    assert sent.count('ui_generate') == generated_before, f'hash 이동 복원이 ui_generate 를 셌다: {sent}'
    assert page.evaluate('location.hash') == other_hash, (page.evaluate('location.hash'), other_hash)
    page.evaluate("() => { location.hash = '#state=!!!'; }")
    page.wait_for_function('h => location.hash === h', arg=other_hash)
    expect(page.locator('#field-owner')).to_have_value(OTHER['owner'])
    page.evaluate('h => { location.hash = h; }', '#' + share_url.split('#', 1)[1])
    expect(page.locator(f'{VM1} [data-name]')).to_have_text('payments-ledger-prod-euw1-gce-01')

    # ── ⑺ 자유 입력은 64자에서 멈춘다 · 라벨 한도 위반(GCP 라벨 값 63자) → 태그 JSON 복사 비활성 + 이유 문구 · Terraform 은 INVALID 주석으로 복사된다 ──
    page.evaluate('h => { location.hash = h; }', other_hash)
    expect(page.locator('[data-cloud="gcp"]')).to_have_attribute('aria-checked', 'true')
    page.fill('#field-owner', 'o' * 300)
    expect(page.locator('#field-owner')).to_have_value('o' * 64)
    expect(page.locator('[data-copy="tags-json"]')).to_be_disabled()
    expect(page.locator('[data-json-blocked]')).to_be_visible()
    expect(page.locator('[data-copy="terraform"]')).to_be_enabled()
    page.click('[data-copy="terraform"]')
    assert '  # INVALID: gcp_labels' in page.evaluate('navigator.clipboard.readText()')
    page.fill('#field-owner', OTHER['owner'])
    expect(page.locator('[data-copy="tags-json"]')).to_be_enabled()
    expect(page.locator('[data-json-blocked]')).to_have_count(0)
    page.evaluate('h => { location.hash = h; }', '#' + share_url.split('#', 1)[1])
    expect(page.locator(f'{VM1} [data-name]')).to_have_text('payments-ledger-prod-euw1-gce-01')

    # ── ⑶ 깨진 hash 로 열어도 화면이 뜨고 기본값으로 간다 — 켜진 CSP(GCP)가 자동 선택 ──
    for broken in ('#state=!!!', '#state=' + 'eyJvd25lciI6NDJ9', '#state=', '#state=W10'):  # !!! · {"owner":42} · 빈 값 · []
        ctx3 = browser.new_context(viewport={'width': 1280, 'height': 900})
        page3 = ctx3.new_page()
        page3.on('pageerror', lambda e: errors.append(str(e)))
        goto_ready(page3, BASE + TREE + broken)
        expect(page3.locator('h1')).to_have_text('Cloudonym')
        expect(page3.locator('#field-owner')).to_have_value('platform')
        expect(page3.locator('[data-cloud="gcp"]')).to_have_attribute('aria-checked', 'true')
        expect(page3.locator('[data-pick-cloud]')).to_have_count(0)
        # 깨진 hash 는 기본 상태의 hash 로 바뀐다 — 다시 공유해도 깨진 값이 퍼지지 않는다
        assert hash_state(page3.evaluate('location.hash')) == {**DEFAULT, 'v': RULES, 'p': 'gcp'}, page3.evaluate('location.hash')
        ctx3.close()

    # ── ⑷ 정제 뒤 빈 토큰 → FAIL 카드 · 복사 버튼 비활성 · 내보내기 셋에서 빠진다 ──
    # 한글 입력(매매)도 같은 FAIL 이다 — 먼저 확인하고, 공개 스크린샷은 기호만 든 ASCII 입력(###)으로 찍는다
    vm1 = page.locator(VM1)
    page.fill('#field-system', '매매')
    expect(vm1).to_have_attribute('data-valid', 'false')
    expect(vm1.locator('[data-violations]')).to_contain_text("Required token 'system' is empty after normalisation")
    page.fill('#field-system', '###')
    expect(vm1).to_have_attribute('data-valid', 'false')
    expect(vm1).to_contain_text('FAIL')
    expect(vm1.locator('[data-name]')).to_have_text('—')
    # 정제 뒤 빈 값의 변환 줄(「'system' normalised from '###' to ''」)은 숨긴다 — 위반 이유가 이미 말한다
    expect(vm1.locator('[data-steps]')).to_have_count(0)
    expect(vm1.locator('button[data-copy]')).to_be_disabled()
    expect(page.locator('[data-names-summary]')).to_have_text('4 resources · 5 names · 0/5 PASS')
    expect(page.locator('[data-copy="all-names"]')).to_have_text('Copy all names · 5 invalid skipped')
    expect(page.locator('[data-copy="all-names"]')).to_be_disabled()
    page.click('[data-copy="terraform"]')
    hcl_bad = page.evaluate('navigator.clipboard.readText()')
    assert "  # INVALID: gcp_compute_instance_01 — Required token 'system' is empty after normalisation\n" in hcl_bad, hcl_bad
    assert 'gcp_compute_instance_01 =' not in hcl_bad
    page.click('[data-copy="names-json"]')
    bad = json.loads(page.evaluate('navigator.clipboard.readText()'))
    assert bad['names'] == [] and {'key': 'compute_instance_01', 'codes': ['name.token_empty']} in bad['invalid'], bad
    vm1.scroll_into_view_if_needed()
    page.screenshot(path=str(OUT / '04-fail-card.png'), full_page=False)

    # ── ⒀ 폭 360px — 가로 스크롤 없음 · 아래 고정 막대 · 누르면 ④ 로 · 스크린샷 ──
    page.fill('#field-system', INPUT['system'])
    page.set_viewport_size({'width': 360, 'height': 800})
    page.wait_for_timeout(300)
    assert page.evaluate('document.documentElement.scrollWidth') <= 360, page.evaluate('document.documentElement.scrollWidth')
    assert_selects_fit(page, 360)
    # 폰은 공유 경고를 메뉴의 Share URL 을 누른 뒤 보인다(D105) — 보여도 가로 스크롤을 만들지 않는다
    expect(page.locator('[data-share-warning]')).to_have_count(0)
    open_more(page)
    page.click('header [data-menu-share]')
    expect(page.locator('[data-share-warning]')).to_be_visible()
    assert page.evaluate('document.documentElement.scrollWidth') <= 360, page.evaluate('document.documentElement.scrollWidth')
    bar = page.locator('[data-sticky-bar]')
    expect(bar).to_be_visible()
    expect(bar).to_contain_text('4 resources · 5 names')
    page.evaluate('window.scrollTo(0, 0)')
    page.click('[data-sticky-jump]')
    page.wait_for_function("() => Math.abs(document.getElementById('names').getBoundingClientRect().top) < 40")
    # 행 높이 44px(터치) — 체크 상자가 든 행
    h = row(page, 'storage_bucket').evaluate('e => e.getBoundingClientRect().height')
    assert h >= 44, h
    page.evaluate('window.scrollTo(0, 0)')
    shot(page, '02-mobile-360.png')
    page.set_viewport_size({'width': 1280, 'height': 900})
    expect(bar).to_be_hidden()  # 넓은 화면에는 고정 막대가 없다
    ctx1.close()

    dark = browser.new_context(viewport={'width': 1280, 'height': 900}, color_scheme='dark')
    page4 = dark.new_page()
    page4.on('pageerror', lambda e: errors.append(str(e)))
    goto_ready(page4, share_url)
    expect(page4.locator(f'{VM1} [data-name]')).to_have_text('payments-ledger-prod-euw1-gce-01')
    bg = page4.evaluate('getComputedStyle(document.body).backgroundColor')
    assert bg not in ('rgb(255, 255, 255)', 'rgba(0, 0, 0, 0)'), f'다크 모드 배경이 아니다: {bg}'
    expect(page4.locator('[data-share-warning]')).to_be_visible()
    shot(page4, '03-desktop-dark.png')
    dark.close()

    # ── ⑻ 옛 v 링크 → 안내 · 새로고침해도 안내와 옛 v 가 남는다 · Share URL 은 지금 버전 · 폼을 고치면 안내가 사라지고 v 가 지금 버전 (D27 ⑵) ──
    ctx8 = browser.new_context(viewport={'width': 1280, 'height': 900})
    ctx8.grant_permissions(['clipboard-read', 'clipboard-write'], origin=BASE)
    page8 = ctx8.new_page()
    page8.on('pageerror', lambda e: errors.append(str(e)))
    # r 순서를 트리 순서와 다르게 — 같은 선택이면 링크를 연 직후 hash 를 덮어쓰지 않는다
    old_hash = state_hash(INPUT, OLD_RULES, 'gcp', {'compute_instance': 2, 'project_id': 1})
    goto_ready(page8, BASE + TREE + old_hash)
    notice = page8.locator('[data-rules-mismatch]')
    expect(notice).to_have_text(f'This link was made with rules {OLD_RULES}; the current rules are {RULES}. Names may differ.')
    expect_ctx(page8, INPUT)
    page8.wait_for_timeout(300)
    assert page8.evaluate('location.hash') == old_hash, page8.evaluate('location.hash')
    page8.reload(wait_until='networkidle')
    expect(notice).to_be_visible()
    assert page8.evaluate('location.hash') == old_hash, page8.evaluate('location.hash')
    page8.click('[data-copy="share-url"]')
    shared = page8.evaluate('navigator.clipboard.readText()')
    assert hash_state(shared) == {**INPUT, 'v': RULES, 'p': 'gcp', 'r': {'project_id': 1, 'compute_instance': 2}}, hash_state(shared)
    assert page8.evaluate('location.hash') == old_hash, '공유 버튼이 주소창의 옛 v 를 바꾸면 안 된다'
    # 선택을 바꿔도 링크의 옛 v 를 버린다
    row(page8, 'compute_instance').locator('[data-inc]').click()
    expect(notice).to_have_count(0)
    page8.wait_for_function('h => location.hash !== h', arg=old_hash)
    assert hash_state(page8.url) == {**INPUT, 'v': RULES, 'p': 'gcp', 'r': {'project_id': 1, 'compute_instance': 3}}, hash_state(page8.url)

    # ── ⑼ 같은 탭에서 옛 v hash 로 이동 → 안내가 보이고 폼이 따라온다 · 폼을 고치면 안내가 사라진다 ──
    other_old = state_hash(OTHER, OLD_RULES)
    page8.evaluate('h => { location.hash = h; }', other_old)
    expect(notice).to_be_visible()
    expect_ctx(page8, OTHER)
    page8.wait_for_timeout(300)
    assert page8.evaluate('location.hash') == other_old, page8.evaluate('location.hash')
    page8.fill('#field-purpose', 'ledger')
    expect(notice).to_have_count(0)

    # ── ⒁ 다섯 키만 든 링크 → 문맥이 열리고 켜진 CSP(GCP)가 자동 선택 · hash 를 덮어쓰지 않는다 ──
    v1_hash = state_hash(INPUT)
    goto_ready(page8, BASE + TREE + '?' + v1_hash)  # 경로를 바꿔 새로 불러온다
    goto_ready(page8, BASE + TREE + v1_hash)
    expect_ctx(page8, INPUT)
    expect(page8.locator('[role="radio"][data-cloud][aria-checked="true"]')).to_have_count(1)
    expect(page8.locator('[data-cloud="gcp"]')).to_have_attribute('aria-checked', 'true')
    expect(page8.locator('[data-tree]')).to_have_count(1)
    page8.wait_for_timeout(300)
    assert page8.evaluate('location.hash') == v1_hash, page8.evaluate('location.hash')

    # ── ⒂ 모르는 type · 종류가 안 맞는 값이 든 링크 → 그 항목만 버리고 한 줄 안내 ──
    odd = state_hash(INPUT, RULES, 'gcp', {'no_such_type': 1, 'compute_instance': 2, 'service_account': 1})
    goto_ready(page8, BASE + TREE + '?x' + odd)
    goto_ready(page8, BASE + TREE + odd)
    expect(page8.locator('[data-selection-dropped]')).to_have_text('This link had 2 resource selections that do not fit the current rules or limits; they were left out.')
    expect(page8.locator('article[data-key]')).to_have_count(2)
    expect(page8.locator('[data-selected-count]')).to_have_text('1 selected')
    row(page8, 'storage_bucket').locator('input[data-row-check]').check()  # 사용자가 선택을 바꾸면 안내를 지운다
    expect(page8.locator('[data-selection-dropped]')).to_have_count(0)

    # ── ⒄ 지금 버전 링크로 연 뒤 개수 +1 → −1 — 주소창 hash 가 화면의 선택을 따라간다(링크 상태가 남아 hash 쓰기를 막으면 안 된다) ──
    linked = state_hash(INPUT, RULES, 'gcp', {'compute_instance': 2})
    goto_ready(page8, BASE + TREE + '?y' + linked)
    goto_ready(page8, BASE + TREE + linked)
    vm8 = row(page8, 'compute_instance')
    expect(vm8.locator('[data-count]')).to_have_text('2')
    vm8.locator('[data-inc]').click()
    expect(vm8.locator('[data-count]')).to_have_text('3')
    page8.wait_for_timeout(300)
    assert hash_state(page8.url)['r'] == {'compute_instance': 3}, hash_state(page8.url)
    vm8.locator('[data-dec]').click()
    expect(vm8.locator('[data-count]')).to_have_text('2')
    page8.wait_for_timeout(300)
    assert hash_state(page8.url) == {**INPUT, 'v': RULES, 'p': 'gcp', 'r': {'compute_instance': 2}}, f'화면은 2 인데 주소창은 {hash_state(page8.url)}'
    ctx8.close()

    # ── ⒅ 문맥 한 칸을 비워도 주소창 hash 는 마지막 온전한 상태로 남는다 → 새로고침하면 CSP · 선택이 돌아온다 · 그동안 Share URL 은 없다 ──
    ctx18 = browser.new_context(viewport={'width': 1280, 'height': 900})
    page18 = ctx18.new_page()
    page18.on('pageerror', lambda e: errors.append(str(e)))
    full = state_hash(INPUT, RULES, 'gcp', {'compute_instance': 2})
    goto_ready(page18, BASE + TREE + full)
    expect(page18.locator('[data-copy="share-url"]')).to_have_count(1)
    page18.fill('#field-owner', '')
    expect(page18.locator('[data-names-empty]')).to_have_text('Fill in Owner · System · Purpose to generate names.')
    expect(page18.locator('[data-copy="share-url"]')).to_have_count(0)  # 낡은 값을 복사할 버튼이 없다
    page18.wait_for_timeout(300)
    assert page18.evaluate('location.hash') == full, page18.evaluate('location.hash')
    page18.evaluate("() => { location.hash = '#state=!!!'; }")  # 깨진 hash 로 이동 → 마지막 온전한 hash 로 되돌린다(지우지 않는다)
    page18.wait_for_function('h => location.hash === h', arg=full)
    page18.reload(wait_until='networkidle')
    expect(page18.locator('#field-owner')).to_have_value(INPUT['owner'])
    expect(page18.locator('[data-cloud="gcp"]')).to_have_attribute('aria-checked', 'true')
    expect(row(page18, 'compute_instance').locator('[data-count]')).to_have_text('2')
    expect(page18.locator('article[data-key]')).to_have_count(2)
    ctx18.close()

    # ── ⒆ 선택 상한(이름 200개)에서 ↓ 는 비활성 체크 상자를 건너뛴다 (?fixture=rules500) ──
    ctx19 = browser.new_context(viewport={'width': 1280, 'height': 900})
    page19 = ctx19.new_page()
    page19.on('pageerror', lambda e: errors.append(str(e)))
    sel200 = {f'fx500_{i:03d}': ('sync' if i % 4 == 2 else 1) for i in range(200)}  # src/dev/fixtureRules.ts 의 입력 종류 순환
    goto_ready(page19, BASE + TREE + '?fixture=rules500' + state_hash(INPUT, RULES, 'gcp', sel200))
    expect(page19.locator('[data-selected-count]')).to_have_text('200 selected')
    # 바로 다음 보이는 상자가 비활성이고 그 뒤에 활성 상자가 있는 체크된 행 — 기대값은 그 뒤 첫 활성 상자
    plan = page19.evaluate('''() => {
      const boxes = [...document.querySelectorAll('[data-tree] input[data-row-check]')].filter((b) => b.checkVisibility());
      for (let i = 0; i < boxes.length - 1; i++) {
        if (boxes[i].disabled || !boxes[i + 1].disabled) continue;
        const j = boxes.findIndex((b, k) => k > i && !b.disabled);
        if (j > 0) return { from: boxes[i].closest('[data-row]').dataset.type, to: boxes[j].closest('[data-row]').dataset.type, skipped: j - i - 1 };
      }
      return null;
    }''')
    assert plan and plan['skipped'] > 0, plan
    row(page19, plan['from']).locator('input[data-row-check]').focus()
    page19.keyboard.press('ArrowDown')
    assert page19.evaluate("document.activeElement.closest('[data-row]')?.dataset.type") == plan['to'], plan
    page19.keyboard.press('ArrowUp')
    assert page19.evaluate("document.activeElement.closest('[data-row]')?.dataset.type") == plan['from'], plan
    ctx19.close()

    # ── ⒃ 충돌 fixture(시험 전용 규칙 둘 · ?fixture=conflict) → 두 카드 FAIL · 충돌 줄 · Copy all names 의 skipped 수 (D41) ──
    ctx16 = browser.new_context(viewport={'width': 1280, 'height': 900})
    page16 = ctx16.new_page()
    page16.on('pageerror', lambda e: errors.append(str(e)))
    goto_ready(page16, BASE + TREE + '?fixture=conflict' + state_hash(INPUT, RULES, 'gcp', {'test_conflict_a': 1, 'test_conflict_b': 1, 'project_id': 1}))
    for k in ('test_conflict_a_01', 'test_conflict_b_01'):
        card = page16.locator(f'article[data-key="{k}"]')
        expect(card).to_have_attribute('data-valid', 'false')
        expect(card.locator('[data-violations]')).to_contain_text('is used by more than one resource of the same kind')
    expect(page16.locator('article[data-key="project_id"]')).to_have_attribute('data-valid', 'true')
    expect(page16.locator('[data-conflicts] li')).to_have_count(1)
    expect(page16.locator('[data-conflicts]')).to_contain_text('Name conflict — Name ')
    expect(page16.locator('[data-copy="all-names"]')).to_have_text('Copy all names · 2 invalid skipped')
    expect(page16.locator('[data-names-summary]')).to_have_text('3 resources · 3 names · 1/3 PASS')
    ctx16.close()

    # ── ⒇~㉖ 행 · 범위 · 종류 · (i) · 표지 · 존 가드 · 지역 콤보박스 (D49 · D50 · D53 · D54) ──
    # 이름 기대값은 화면 밖(/v1/names — 같은 엔진)에서 받는다. 화면 출력을 베끼지 않는다
    ctxR = browser.new_context(viewport={'width': 1280, 'height': 900})
    ctxR.grant_permissions(['clipboard-read', 'clipboard-write'], origin=BASE)
    pr = ctxR.new_page()
    pr.on('pageerror', lambda e: errors.append(str(e)))
    goto_ready(pr, BASE + TREE + state_hash(INPUT, RULES, 'gcp'))
    expect_ctx(pr, INPUT)
    pr.click('[data-expand-all]')

    def api(resources, region=INPUT['region']):
        res = post_api(pr, '/v1/names', {'provider': 'gcp', 'context': {**INPUT, 'region': region}, 'resources': resources})
        assert res.ok, res.text()
        return {i['key']: i for i in res.json()['data']['gcp']['items']}

    def card(key):
        return pr.locator(f'article[data-key="{key}"]')

    def wait_for(fn, want_value, label):
        """주소창 hash 는 렌더 뒤에 쓰인다 — 3초 안에 기대값이 되는지 본다"""
        deadline = time.time() + 3
        while fn() != want_value:
            assert time.time() < deadline, (label, fn(), want_value)
            pr.wait_for_timeout(50)

    r_of = lambda: hash_state(pr.url).get('r')

    # ⒇ 범위 고르기 — IP Address 는 Region · Global 두 규칙을 한 행에 묶는다. 고르기 전 체크 불가 · 고르면 그 규칙 · 바꾸면 hash r 의 키가 바뀐다
    ip = row_key(pr, 'gcp.address')
    ip_box = ip.locator('input[data-row-check]')
    expect(ip_box).to_be_disabled()
    expect(ip.locator('[data-scope-required]')).to_have_text('Choose a scope to select IP Address')
    expect(ip_box).to_have_attribute('aria-describedby', ip.locator('[data-scope-required]').get_attribute('id'))
    assert ip.get_attribute('data-type') is None
    assert ip.locator('[data-scope-select] option').evaluate_all('es => es.map(e => [e.value, e.text, e.disabled])') == [
        ['', 'scope…', True], ['gcp:project_region', 'Region', False], ['gcp:project_global', 'Global', False]]
    expect(ip.locator('[data-kind-select]')).to_have_count(0)  # 종류 목록은 고른 범위의 규칙에서 나온다 — 범위 전에는 없다
    ip_box.click(force=True)  # 꺼진 상자는 눌러도 고르지 않는다
    expect(pr.locator('[data-selected-count]')).to_have_text('0 selected')
    ip.locator('[data-scope-select]').select_option('gcp:project_global')
    expect(ip).to_have_attribute('data-type', 'global_address')
    expect(ip_box).to_be_enabled()
    expect(ip.locator('[data-scope-required]')).to_have_count(0)
    ip_box.check()
    want = api([{'type': 'global_address'}])
    expect(card('global_address_01').locator('[data-name]')).to_have_text(want['global_address_01']['name'])
    expect(card('global_address_01').locator('h4')).to_have_text('IP Address · 01')
    wait_for(r_of, {'global_address': 1}, '전역 범위')
    ip.locator('[data-scope-select]').select_option('gcp:project_region')
    expect(ip).to_have_attribute('data-type', 'address')
    expect(ip_box).to_be_checked()  # 범위를 바꿔도 선택은 남는다 — 키만 옮긴다
    expect(card('global_address_01')).to_have_count(0)
    want = api([{'type': 'address'}])
    expect(card('address_01').locator('[data-name]')).to_have_text(want['address_01']['name'])
    assert want['address_01']['name'].endswith('-euw1-ip-01'), want  # 리전 규칙이라 지역 토큰이 붙는다 — 전역 이름과 다르다
    wait_for(r_of, {'address': 1}, '리전 범위')

    # ㉑ 종류 고르기 → 이름 — 기본값(EXTERNAL)은 토큰이 없고 INTERNAL 을 고르면 카드 · 이름 · hash 에 종류가 붙는다
    kind = ip.locator('[data-kind-select]')
    expect(kind).to_have_value('')
    assert kind.locator('option').first.inner_text() == 'default (EXTERNAL)', kind.locator('option').all_inner_texts()
    assert 'INTERNAL' in kind.locator('option').all_inner_texts(), kind.locator('option').all_inner_texts()
    kind.select_option('INTERNAL')
    want = api([{'type': 'address', 'kind': 'INTERNAL'}])
    assert '-ip-int-' in want['address_01']['name'], want
    expect(card('address_01').locator('[data-name]')).to_have_text(want['address_01']['name'])
    expect(card('address_01').locator('h4')).to_have_text('IP Address · int · 01')
    wait_for(r_of, {'address': '1:INTERNAL'}, '종류')
    pr.click('[data-copy="names-json"]')
    exported = {n['key']: n for n in json.loads(pr.evaluate('navigator.clipboard.readText()'))['names']}
    assert exported['address_01'].get('kind') == 'INTERNAL' and exported['address_01']['name'] == want['address_01']['name'], exported
    # 범위를 바꿔 고른 종류가 새 범위에 없으면 버리고 한 줄 안내 — NEG 존 범위의 GCE_VM_IP 는 전역 범위에 없다
    neg = row_key(pr, 'gcp.network_endpoint_group')
    neg.locator('[data-scope-select]').select_option('gcp:project_zone')
    neg.locator('[data-kind-select]').select_option('GCE_VM_IP')
    neg.locator('input[data-row-check]').check()
    neg.locator('[data-scope-select]').select_option('gcp:project_global')
    expect(neg.locator('[data-kind-dropped]')).to_have_text('Kind GCE_VM_IP does not exist at Global scope; it was cleared.')
    assert 'GCE_VM_IP' not in neg.locator('[data-kind-select] option').all_inner_texts(), neg.locator('[data-kind-select] option').all_inner_texts()
    expect(neg.locator('[data-kind-select]')).to_have_value('')
    neg.locator('input[data-row-check]').uncheck()

    # ㉒ 종류가 필수인 행(Resource Policy) — 종류를 고르기 전 체크 불가 · 고르면 체크되고 이름에 종류 토큰
    rp = row_key(pr, 'gcp.resource_policy')
    rp_box = rp.locator('input[data-row-check]')
    expect(rp_box).to_be_disabled()
    expect(rp.locator('[data-kind-required]')).to_have_text('Choose a kind to select Resource Policy')
    first = rp.locator('[data-kind-select] option').first
    assert (first.get_attribute('value'), first.inner_text(), first.evaluate('e => e.disabled')) == ('', 'choose…', True)
    rp_box.click(force=True)
    expect(rp_box).not_to_be_checked()
    expect(card('resource_policy_01')).to_have_count(0)
    rp.locator('[data-kind-select]').select_option('snapshot-schedule')
    expect(rp_box).to_be_enabled()
    expect(rp.locator('[data-kind-required]')).to_have_count(0)
    rp_box.check()
    want = api([{'type': 'resource_policy', 'kind': 'snapshot-schedule'}])
    expect(card('resource_policy_01').locator('[data-name]')).to_have_text(want['resource_policy_01']['name'])
    expect(card('resource_policy_01').locator('h4')).to_have_text('Resource Policy · snap · 01')
    wait_for(r_of, {'address': '1:INTERNAL', 'resource_policy': '1:snapshot-schedule'}, '필수 종류')

    # ㉓ (i) 펼침 — 버튼 aria-expanded · 펼친 뒤에만 aria-controls · 설명 한 줄과 입력 위치
    vmr = row_key(pr, 'gcp.compute_instance')
    tog = vmr.locator('[data-info-toggle]')
    expect(tog).to_have_attribute('aria-label', 'About VM Instance')
    expect(tog).to_have_attribute('aria-expanded', 'false')
    assert tog.get_attribute('aria-controls') is None
    expect(vmr.locator('[data-info]')).to_have_count(0)
    tog.click()
    expect(tog).to_have_attribute('aria-expanded', 'true')
    expect(tog).to_have_attribute('aria-controls', vmr.locator('[data-info]').get_attribute('id'))
    expect(vmr.locator('[data-info]')).to_contain_text('A Compute Engine virtual machine')
    expect(vmr.locator('[data-enter-name-at]')).to_have_text('Enter the name at: gcloud compute instances create · google_compute_instance.name')
    tog.focus()
    pr.keyboard.press('Enter')  # 키보드로도 접힌다
    expect(tog).to_have_attribute('aria-expanded', 'false')
    expect(vmr.locator('[data-info]')).to_have_count(0)

    # ㉔ 표지 칩 · 「API only」 거르기 칩 — 기본은 꺼져 있고 그 행도 접지 않고 보인다. 켜면 그 행만 남는다
    chip = pr.locator('[data-api-only-filter]')
    api_rows = sorted(pr.eval_on_selector_all('[data-tree] [data-row]:has([data-badge="api-only"])', 'els => els.map(e => e.dataset.row)'))
    assert len(api_rows) == 3, api_rows
    expect(chip).to_have_text(f'API only ({len(api_rows)})')
    expect(chip).to_have_attribute('aria-pressed', 'false')
    assert set(api_rows) <= set(visible_rows(pr)), visible_rows(pr)
    badge = row_key(pr, api_rows[0]).locator('[data-badge="api-only"]')
    expect(badge).to_have_text('API only')
    expect(badge).to_have_attribute('title', 'No gcloud command or Terraform resource — create it through the API')
    expect(pr.locator('[data-badge="preview"]').first).to_have_text('Preview')
    n_rows = len(visible_rows(pr))
    chip.click()
    expect(chip).to_have_attribute('aria-pressed', 'true')
    assert sorted(visible_rows(pr)) == api_rows, visible_rows(pr)
    chip.click()
    expect(chip).to_have_attribute('aria-pressed', 'false')
    assert len(visible_rows(pr)) == n_rows, (len(visible_rows(pr)), n_rows)

    # ㉕ 존은 이름에 들지 않는다 (D50 revised) — 존 select · 존 안내가 없다 · 리전만으로 VM · 디스크 행을 체크할 수 있고 카드는 PASS(리전 코드)
    expect(pr.locator('#field-zone')).to_have_count(0)
    expect(pr.locator('[data-zone-hint]')).to_have_count(0)
    expect(pr.locator('[data-zone-required]')).to_have_count(0)
    disk = row_key(pr, 'gcp.disk')
    disk.locator('[data-scope-select]').select_option('gcp:project_zone')
    expect(disk.locator('input[data-row-check]')).to_be_enabled()
    vm_box = vmr.locator('input[data-row-check]')
    expect(vm_box).to_be_enabled()
    vm_box.check()
    vmr.locator('[data-inc]').click()
    expect(vmr.locator('[data-count]')).to_have_text('2')
    want = api([{'type': 'compute_instance', 'count': 2}])
    for k in ('compute_instance_01', 'compute_instance_02'):
        assert want[k]['valid'] and '-euw1-gce-' in want[k]['name'], want[k]
        expect(card(k)).to_have_attribute('data-valid', 'true')
        expect(card(k).locator('[data-name]')).to_have_text(want[k]['name'])
    vm_box.uncheck()
    expect(card('compute_instance_01')).to_have_count(0)
    expect(vm_box).to_be_enabled()

    # ㉖ 지역 콤보박스 — 열기 · 리전 이름 · 위치 · 코드 · 존 이름으로 거르기 · 없음 안내 · Escape 는 검색어를 버린다 · 방향키 + Enter 로 리전을 고른다
    region_box = pr.locator('#field-region')
    listbox = pr.locator('[role="listbox"]')
    expect(region_box).to_have_attribute('aria-expanded', 'false')
    expect(listbox).to_be_hidden()
    region_box.click()
    expect(region_box).to_have_attribute('aria-expanded', 'true')
    expect(listbox).to_be_visible()
    all_opts = pr.eval_on_selector_all('[data-region-option]', 'els => els.map(e => e.dataset.regionOption)')
    assert len(all_opts) == 44 and 'global' in all_opts and len(set(all_opts)) == 44, all_opts  # GCP 리전 43 + global
    opt_text = lambda: [' '.join(t.split()) for t in pr.locator('[data-region-option]').all_inner_texts()]
    region_box.fill('tokyo')  # 위치
    assert opt_text() == ['asia-northeast1 — Tokyo, Japan · ane1'], opt_text()
    region_box.fill('ane3')  # 코드
    assert opt_text() == ['asia-northeast3 — Seoul, South Korea · ane3'], opt_text()  # 대륙 꼬리 없이
    region_box.fill('asia-northeast3-b')  # 존 이름 — 그 리전 항목이 걸린다
    assert opt_text() == ['asia-northeast3 — Seoul, South Korea · ane3'], opt_text()
    region_box.fill('zzz-none')
    expect(pr.locator('[data-region-empty]')).to_have_text('No region matches — type a region name, a city or a code')
    pr.keyboard.press('Escape')
    expect(region_box).to_have_attribute('aria-expanded', 'false')
    expect(region_box).to_have_value('europe-west1')
    region_box.fill('asia-northeast')  # 리전 이름
    names_shown = pr.eval_on_selector_all('[data-region-option]', 'els => els.map(e => e.dataset.regionOption)')
    assert len(names_shown) >= 2 and all(v.startswith('asia-northeast') for v in names_shown), names_shown
    pr.keyboard.press('ArrowDown')
    expect(region_box).to_have_attribute('aria-activedescendant', pr.locator(f'[data-region-option="{names_shown[1]}"]').get_attribute('id'))
    pr.keyboard.press('Enter')
    expect(region_box).to_have_attribute('aria-expanded', 'false')
    expect(region_box).to_have_value(names_shown[1])
    wait_for(lambda: hash_state(pr.url)['region'], {'asia-northeast2': 'ane2', 'asia-northeast3': 'ane3'}.get(names_shown[1]), '콤보박스로 고른 지역')
    region_box.fill('seoul')
    pr.keyboard.press('Enter')
    expect(region_box).to_have_value('asia-northeast3')
    expect(pr.locator('[data-region-summary]')).to_have_text('Seoul, South Korea · ane3')
    no_hangul(pr)
    ctxR.close()

    # ── ㉗ /privacy — 200 · IP 문장(읽어서 제한 키로 넘기고 저장하지 않는다) · KV 366 · Axiom 은 데이터셋에 설정한 보존 · 계측 표 아홉 줄(api_wizard 포함) · 휴대폰 폭 (D56) ──
    ctx27 = browser.new_context(viewport={'width': 360, 'height': 800})
    page27 = ctx27.new_page()
    page27.on('pageerror', lambda e: errors.append(str(e)))
    goto_ready(page27, BASE + '/privacy')
    resp27 = page27.goto(BASE + '/privacy', wait_until='networkidle')
    assert resp27 is not None and resp27.status == 200, resp27 and resp27.status
    expect(page27.locator('h1')).to_have_text('Privacy')
    expect(page27.locator('[data-privacy-ip]')).to_have_text("Cloudonym reads the client IP address of each POST request to /v1/ and each GET request for /llms.txt or /catalog.json (the cf-connecting-ip header Cloudflare sets) only to pass it as the key of Cloudflare's rate-limiting binding (60 requests per 60 seconds); it is not stored in telemetry, KV or Axiom.")
    expect(page27.locator('[data-privacy-kv]')).to_have_text('KV daily counters expire 366 days after their last update.')
    expect(page27.locator('[data-privacy-axiom]')).to_contain_text('the retention configured on the Axiom dataset')
    expect(page27.locator('[data-privacy-never]')).to_contain_text('never collected')
    expect(page27.locator('[data-privacy-events] tr[data-event]')).to_have_count(9)
    expect(page27.locator('[data-privacy-events] tr[data-event="ui_copy"]')).to_contain_text('target')
    privacy_text = page27.inner_text('main')
    for sentence in re.split(r'(?<=\.)\s+', privacy_text):
        assert not (re.search(r'\bIP\b', sentence) and re.search(r'does not read|never reads|not read', sentence, re.I)), sentence
    assert page27.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), '360px 에서 가로 스크롤이 생긴다'
    no_hangul(page27)
    ctx27.close()

    # ── ㉘ /docs/naming — 200 · 절 열둘 · 표 행 수(약어 115(Cloud Run · D72 · D80 · 프로젝트 이름 D85 포함) · 리전 43 · 종류 토큰 19 · 환경 9 · 토큰 10 · 딸린 것 4 · 프리셋 묶음 11) · PASS 문장 · 휴대폰 폭 · 스크린샷 (D57) ──
    ctx28 = browser.new_context(viewport={'width': 360, 'height': 800})
    page28 = ctx28.new_page()
    page28.on('pageerror', lambda e: errors.append(str(e)))
    resp28 = page28.goto(BASE + '/docs/naming', wait_until='networkidle')
    assert resp28 is not None and resp28.status == 200, resp28 and resp28.status
    expect(page28.locator('h1')).to_have_text('Naming guide')
    expect(page28.locator('[data-naming-doc] > section')).to_have_count(12)
    for table_id, rows in {'abbreviations': 115, 'regions': 43, 'kinds': 19, 'env': 9, 'tokens': 10, 'attached': 4, 'presets': 24}.items():
        expect(page28.locator(f'[data-doc-table="{table_id}"] tbody tr')).to_have_count(rows)
    expect(page28.locator('[data-doc-table] caption')).to_have_count(page28.locator('[data-doc-table]').count())
    expect(page28.locator('[data-doc-list="shrink"] li')).to_have_count(3)
    expect(page28.locator('[data-doc-list="tiers"] li')).to_have_count(3)
    expect(page28.locator('[data-doc-table="formula"]')).to_contain_text('[-<tier>]-<seq>')
    expect(page28.locator('#doc-abbreviations h3')).to_have_text('Abbreviation principles')
    expect(page28.locator('[data-doc-list="abbreviations"] li')).to_have_count(4)
    expect(page28.locator('[data-footer-privacy]')).to_have_attribute('href', '/privacy')
    expect(page28.locator('[data-doc-paragraph="pass"]')).to_have_text(re.compile(r'^PASS / `valid: true` means the name satisfies'))
    expect(page28.locator('[data-doc-table="kinds"] tr[data-row="gcp.cloud_sql_instance"]')).to_contain_text('POSTGRES → pg')
    assert page28.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), '360px 에서 가로 스크롤이 생긴다'
    no_hangul(page28)
    # 상태 hash 를 싣고 오면 푸터 Privacy 링크도 그 hash 를 싣는다 (앱 푸터와 같은 꼴)
    link28 = state_hash(DEFAULT)
    page28.goto(BASE + '/docs/naming' + link28, wait_until='networkidle')
    page28.reload(wait_until='networkidle')
    expect(page28.locator('[data-footer-privacy]')).to_have_attribute('href', '/privacy' + link28)
    ctx28.close()
    ctx28d = browser.new_context(viewport={'width': 1280, 'height': 900})
    page28d = ctx28d.new_page()
    page28d.goto(BASE + '/docs/naming', wait_until='networkidle')
    page28d.screenshot(path=str(OUT / '05-naming-guide.png'))
    ctx28d.close()

    # ── ㉙ 꺼진 CSP(Azure) 로 만든 링크 → GCP 로 열리고 지역은 예시로 · 선택은 비운다 · 자유 입력 셋과 환경은 그대로 · 안내 한 줄 · 선택을 바꾸면 안내가 사라진다 (D55) ──
    ctx20 = browser.new_context(viewport={'width': 1280, 'height': 900})
    page20 = ctx20.new_page()
    page20.on('pageerror', lambda e: errors.append(str(e)))
    az_link = state_hash({**INPUT, 'region': 'koreacentral'}, RULES, 'azure', {'virtual_machine': 2, 'resource_group': 1})  # Azure 가 풀 수 있는 지역이라야 이 분기다
    goto_ready(page20, BASE + TREE + az_link)
    expect(page20.locator('[data-cloud="gcp"]')).to_have_attribute('aria-checked', 'true')
    expect(page20.locator('[data-cloud="azure"]')).to_have_attribute('aria-checked', 'false')
    expect(page20.locator('[data-provider-unavailable]')).to_have_text('This link was made for Azure, which is not available yet — the region was reset to the example and the selection was cleared.')
    expect(page20.locator('[data-selection-dropped]')).to_have_count(0)  # 안내는 한 줄 — 버린 선택은 위 문장이 말한다
    reset = {**INPUT, 'region': DEFAULT['region']}
    expect_ctx(page20, reset)  # 자유 입력 셋 · 환경은 링크 그대로, 지역은 예시 asia-northeast3
    expect(page20.locator('[data-selected-count]')).to_have_text('0 selected')
    expect(page20.locator('article[data-key]')).to_have_count(0)
    no_hangul(page20)
    check(page20, 'project_id')
    expect(page20.locator('[data-provider-unavailable]')).to_have_count(0)
    page20.wait_for_function('h => location.hash !== h', arg=az_link)
    assert hash_state(page20.url) == {**reset, 'v': RULES, 'p': 'gcp', 'r': {'project_id': 1}}, hash_state(page20.url)
    ctx20.close()

    wizard_scenarios(browser, RULES, errors)
    browser.close()
    # 07 · 08 — 반투명 배경(::backdrop) 아래의 둥근 테두리가 프로세스마다 가끔 다르게 그려진다(25회 중 2회, 실측).
    # 합성 단계를 그리기 전에 모두 돌리고 스크롤 스레드를 끈 브라우저에서 찍으면 같은 바이트다(25회 중 25회)
    shots = p.chromium.launch(headless=True, args=['--run-all-compositor-stages-before-draw', '--disable-threaded-scrolling'])
    wizard_narrow_shots(shots, errors)
    shots.close()

    assert errors == [], errors
    print('OK — 시나리오 ⑴~⒆ · ⒇~㉙ 통과 · 비콘', sent, '· 스크린샷', sorted(p.name for p in OUT.glob('*.png')))

