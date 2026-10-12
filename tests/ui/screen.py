"""화면 시험 — Playwright(Python) 로 네 단계 트리 화면(D42)의 시나리오 ⑴~⒆ · ⒇~㉙ 와 마법사(D59 · D67 · D68 · D73 · D74 · D75 · D82 · D83 · D84~D90)의 ㉚~㊹ 를 재고 스크린샷을 남긴다.
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


def wizard_names(page, body):
    res = page.request.post(BASE + '/v1/wizard', data={'provider': 'gcp', 'project': W_PROJECT, **body})
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
    """목록의 줄을 눌러 고르고 그 설정 칸이 열릴 때까지 기다린다. 접힌 서비스의 pick 줄이면 서비스 줄을 먼저 누른다(고른 서비스는 펴진다)"""
    m = re.match(r'services\[(\d+)\]\.picks\[\d+\]$', path)
    if m and page.locator(f'[data-row-path="{path}"]').count() == 0:
        page.locator(f'[data-row-path="services[{m.group(1)}]"]').click()
    page.locator(f'[data-row-path="{path}"]').click()
    expect(page.locator(f'[data-settings][data-pick-path="{path}"]')).to_have_count(1)
    return settings(page)


def svc(page, i):
    """서비스 줄을 고른 설정 칸 — 이름 · 삭제 · 용도 칩"""
    return select(page, f'services[{i}]')


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
    goto_ready(page, BASE + '/')
    expect(page.locator('[data-wizard]')).to_be_visible()
    expect(page.locator('[data-tree]')).to_have_count(0)
    expect(page.locator('[data-nav-pick]')).to_have_attribute('href', '/pick')
    expect(page.get_by_text('Pick a cloud, then work down the list: project values, the shared network (a VPC, subnet, router and NAT are added to start — clear them if you do not need them), services with what runs in each, and shared extras. Select a row to edit it; the names update as you go.')).to_be_visible()
    expect(page.locator('[data-wizard-notice]')).to_have_count(0)
    # 세 칸 (D89) — 목록 · 설정 · 이름이 왼쪽부터 · 첫 선택은 Project · 목록은 tree
    boxes = [page.locator(s).bounding_box() for s in ('[data-wizard-list-column]', '[data-settings]', '[data-names-column]')]
    assert boxes[0]['x'] < boxes[1]['x'] < boxes[2]['x'] and abs(boxes[0]['y'] - boxes[2]['y']) < 2, boxes
    expect(page.locator('[data-wizard-list]')).to_have_attribute('role', 'tree')
    expect(settings(page)).to_have_attribute('data-pick-path', 'project')
    expect(page.locator('[data-row-path="project"]')).to_have_attribute('aria-selected', 'true')
    expect(page.locator('[data-row-path="services[0]"]')).to_have_attribute('aria-expanded', 'false')
    # 미리 채운 네트워크 넷 — 이름 다섯(ID + 넷) · 줄마다 그 pick 의 첫 이름 · 프로젝트 이름 카드는 수 · 이름 목록에 들지 않는다(D85)
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
    settings(page).locator('[data-purpose-chip="web"]').click()
    expect(settings(page).locator('[data-purpose-chip="web"]')).to_have_attribute('aria-pressed', 'true')
    # 칩 토글은 선택을 옮기지 않는다 — 서비스 줄이 그대로 · 새 pick 줄이 목록에 생긴다
    expect(settings(page)).to_have_attribute('data-pick-path', 'services[0]')
    expect(page.locator('[data-row-path="services[0].picks[0]"]')).to_have_attribute('data-row-pick', 'web')
    page.click('[data-add-service]')
    # Add service 는 새 서비스 줄을 고른다
    expect(settings(page)).to_have_attribute('data-pick-path', 'services[1]')
    settings(page).locator('[data-service-name]').fill('pay')
    settings(page).locator('[data-purpose-chip="web"]').click()
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
    expect(p40.locator('[data-env-chip="stg"]')).to_have_attribute('aria-pressed', 'true')
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

    # ── ㉝ custom 용도 — 트리를 모달로 열어 한 행을 고르고(새 줄이 선택된다) tier 를 db 로 → 거부 안내 · 이름 대신 「고칠 칸」 ──
    svc(page, 0).locator('[data-purpose-chip="custom"]').click()
    dialog = page.locator('[data-custom-dialog]')
    expect(dialog).to_be_visible()
    expect(dialog.get_by_text('Tick one row. It is added to this service with its own number rows.')).to_have_count(1)
    # 프로젝트 ID 는 늘 암묵 항목이라 모달 트리에 없다(고르면 이름이 전부 사라졌다) — 같은 프로젝트 범위의 서비스 계정 행은 있다
    expect(dialog.locator('[data-rule="gcp.service_account"]')).to_have_count(1)
    expect(dialog.locator('[data-rule="gcp.project_id"]')).to_have_count(0)
    # 행을 고르면 모달이 닫힌다 — check() 는 체크 상태를 기다리므로 click 으로 고른다
    row(page, 'compute_instance').locator('input[data-row-check]').click()
    expect(dialog).to_have_count(0)
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
    expect(p36.locator('[data-wizard-notice]')).to_have_text(['1 invalid item(s) in this link were left out.'])
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
    goto_ready(p38, BASE + '/')
    clear_network(p38)
    fill_project(p38)
    svc(p38, 0).locator('[data-service-name]').fill('shop')
    lb = svc(p38, 0).locator('[data-lb-parts]')
    expect(lb.locator('[data-purpose-chip]')).to_have_count(7)
    one = [{'id': '1', 'seq': '01'}]
    picks, project_picks = [], []
    expect(p38.locator('[data-copy="share-url"]')).to_have_count(0)
    expect(p38.locator('[data-share-reserve]')).to_have_count(1)
    height38 = doc_height(p38)
    for chip in ('run', 'sa', 'secret', 'gke', 'wip', 'ip', 'bs', 'hc', 'url', 'cert', 'thps', 'fwd'):
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
    assert len(want) == 1 + 12 + 2, want
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
    goto_ready(p39, BASE + '/')
    cloud = p39.locator('[data-wizard] [data-wizard-cloud]')
    expect(cloud.locator('#step-cloud')).to_have_text('Cloud')  # 번호 없음 — ①~⑦ 은 그대로
    expect(p39.locator('#wizard-project')).to_contain_text('1')
    expect(cloud.locator('[data-cloud="gcp"]')).to_have_attribute('aria-checked', 'true')
    expect(cloud.locator('[data-coming-soon]')).to_have_count(2)
    expect(cloud.locator('[data-cloud="aws"]')).to_be_disabled()
    expect(cloud.locator('[data-cloud="azure"]')).to_be_disabled()
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
    expect(dlg.get_by_text('Tick one row. It is added to the shared extra resources with its own number rows.')).to_have_count(1)
    expect(dlg.locator('[data-rule="gcp.vpc_network"]')).to_have_count(1)
    expect(dlg.locator('[data-rule="gcp.cloud_sql_database"]')).to_have_count(0)
    expect(dlg.locator('[data-rule="gcp.project_id"]')).to_have_count(0)
    row(p39, 'pubsub_topic').locator('input[data-row-check]').click()
    expect(dlg).to_have_count(0)
    expect(settings(p39)).to_have_attribute('data-pick-path', 'projectPicks[2]')
    expect(p39.locator('[data-settings] [data-pick-path^="projectPicks"][data-pick="custom"]')).to_have_count(1)
    # custom pick 은 「Shared extra resources」 줄 아래 · 프리셋 pick 은 ② 네트워크 줄 아래 (D84) — 고른 줄이 서비스 밖이라 서비스는 접혀 있다
    rows39 = p39.locator('[data-row-path]').evaluate_all('els => els.map(e => e.dataset.rowPath)')
    assert rows39 == ['project', 'network', 'projectPicks[0]', 'projectPicks[1]', 'services[0]', 'extras', 'projectPicks[2]'], rows39
    expect(p39.locator('#names article[data-key^="project/-/pubsub_topic/"]')).to_have_count(1)
    expect(p39.locator('#names article[data-key^="project/-/pubsub_topic/"]')).to_have_attribute('data-valid', 'true')
    no_hangul(p39)
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
    goto_ready(p42, BASE + '/')
    # 순서 — Cloud 줄이 세 칸 위 · 목록의 머리 줄은 ① Project → ② 네트워크 → ③ 서비스 → 공용 추가 리소스 · ⑦ 이름은 오른쪽 칸
    assert p42.locator('[data-wizard-cloud]').bounding_box()['y'] < p42.locator('[data-wizard-layout]').bounding_box()['y']
    heads = p42.locator('[data-row-path][aria-level="1"]').evaluate_all('els => els.map(e => e.dataset.rowPath)')
    assert heads == ['project', 'network', 'services[0]', 'extras'], heads
    expect(p42.locator('[data-names-column] #wizard-names')).to_contain_text('7')
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
    # 줄 이름 = 그 pick 의 이름 (네트워크 다섯)
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
    assert p42.evaluate("!!document.activeElement.closest('[data-settings]')")
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
    print('OK — 마법사 시나리오 ㉚~㊹ 통과')


def wizard_selection_focus(browser, errors):
    """㊸ 선택 · 펼침 · 포커스 (D89 독립 리뷰) — 서비스를 지운 뒤의 선택과 펼침 상태"""
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    goto_ready(pg, BASE + '/')
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

def names_counts(page):
    """이름 칸 머리의 요약 「N names · P/N PASS」 → (N, P)"""
    m = re.fullmatch(r'(\d+) names · (\d+)/\1 PASS', page.locator('[data-names-summary]').inner_text())
    assert m, page.locator('[data-names-summary]').inner_text()
    return int(m.group(1)), int(m.group(2))


def dialog_open(page, sel):
    return page.evaluate(f"document.querySelector('{sel}').open")


def no_hscroll(page, width, what):
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'{what} — {width}px 에서 가로 스크롤이 생긴다'


def wizard_narrow(browser, errors):
    """㊹ 좁은 화면 (D89) — 태블릿(768–1279)은 목록 · 설정 두 칸 + 이름 드로어, 폰(<768)은 한 칸 + 설정 바텀 시트 + 위 탭. 1280 은 세 칸 그대로.
    값은 중립 예시(devops · payments · shop · pay)다. 스크린샷 07 · 08 은 wizard_narrow_shots 가 새 창에서 찍는다"""
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    goto_ready(pg, BASE + '/')
    expect(pg.locator('[data-wizard-layout]')).to_have_attribute('data-wizard-layout', 'wide')
    expect(pg.locator('[data-names-handle]')).to_have_count(0)
    expect(pg.locator('[data-wizard-tabs]')).to_have_count(0)
    fill_project(pg)
    svc(pg, 0).locator('[data-purpose-chip="web"]').click()
    pg.click('[data-add-service]')
    settings(pg).locator('[data-service-name]').fill('pay')
    settings(pg).locator('[data-purpose-chip="db"]').click()
    select(pg, 'services[0].picks[0]')

    # ── 태블릿 768 — 두 칸(목록 왼쪽 · 설정 오른쪽) · 이름은 닫힌 드로어 · 손잡이의 수는 머리 요약과 같다 ──
    pg.set_viewport_size({'width': 768, 'height': 1024})
    expect(pg.locator('[data-wizard-layout]')).to_have_attribute('data-wizard-layout', 'tablet')
    lst, st = pg.locator('[data-wizard-list-column]').bounding_box(), settings(pg).bounding_box()
    assert lst['x'] < st['x'] and abs(lst['y'] - st['y']) < 2, (lst, st)
    assert not dialog_open(pg, '[data-names-drawer]')
    expect(settings(pg)).to_have_attribute('data-pick-path', 'services[0].picks[0]')  # 고른 줄은 배치가 바뀌어도 그대로
    handle = pg.locator('[data-names-handle]')
    expect(handle).to_be_visible()
    expect(handle).to_have_attribute('aria-expanded', 'false')
    n, ok = names_counts(pg)
    expect(pg.locator('[data-names-handle-summary]')).to_have_text(f'{n} · {ok}/{n}')
    # 손잡이는 설정 칸을 가리지 않는다(내용이 손잡이 왼쪽에서 끝난다)
    assert st['x'] + st['width'] <= handle.bounding_box()['x'], (st, handle.bounding_box())
    no_hscroll(pg, 768, '드로어 닫힘')
    # 손잡이를 누르면 오른쪽 가장자리에 폭 min(420px, 90vw) 드로어 · 포커스는 닫기 단추 · 머리 요약 · 내보내기가 보인다
    handle.click()
    assert dialog_open(pg, '[data-names-drawer]')
    box = pg.locator('[data-names-drawer]').bounding_box()
    assert box['width'] == 420 and box['x'] + box['width'] == 768 and box['height'] == 1024, box
    expect(pg.locator('[data-names-close]')).to_be_focused()
    expect(pg.locator('[data-names-drawer] [data-names-summary]')).to_have_text(f'{n} names · {ok}/{n} PASS')
    expect(pg.locator('[data-names-drawer] [data-copy="terraform"]')).to_be_visible()
    no_hscroll(pg, 768, '드로어 열림')
    # Esc 로 닫히고 포커스는 손잡이로
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
    # 손잡이의 수는 계획을 바꾸면 따라 바뀐다
    svc(pg, 1).locator('[data-purpose-chip="object"]').click()
    n2, ok2 = names_counts(pg)
    assert n2 == n + 1, (n, n2)
    expect(pg.locator('[data-names-handle-summary]')).to_have_text(f'{n2} · {ok2}/{n2}')
    svc(pg, 1).locator('[data-purpose-chip="object"]').click()
    expect(pg.locator('[data-names-handle-summary]')).to_have_text(f'{n} · {ok}/{n}')
    select(pg, 'services[0].picks[0]')  # shop 을 펴 둔다(폰에서 그 줄을 누른다)

    # ── 폰 360 — 한 칸 · 위 탭 [Plan] [Names N · x/y PASS] · 줄을 누르면 설정이 바텀 시트(70vh 안 · 자체 스크롤) ──
    pg.set_viewport_size({'width': 360, 'height': 800})
    expect(pg.locator('[data-wizard-layout]')).to_have_attribute('data-wizard-layout', 'phone')
    expect(pg.locator('[data-names-handle]')).to_have_count(0)
    tabs = pg.locator('[data-wizard-tab]')
    expect(tabs).to_have_text(['Plan', f'Names {n} · {ok}/{n} PASS'])
    expect(pg.locator('[data-wizard-tab="plan"]')).to_have_attribute('aria-selected', 'true')
    expect(pg.locator('[data-wizard-list-column]')).to_be_visible()
    expect(pg.locator('[data-names-column]')).to_be_hidden()
    assert not dialog_open(pg, '[data-settings-sheet]')
    no_hscroll(pg, 360, '시트 닫힘')
    pg.locator('[data-row-path="services[0].picks[0]"]').click()
    pg.wait_for_function("() => document.querySelector('[data-settings-sheet]').open")
    sheet = pg.locator('[data-settings-sheet]')
    sb = sheet.bounding_box()
    assert sb['width'] == 360 and abs(sb['y'] + sb['height'] - 800) <= 1 and sb['height'] <= 800 * 0.7 + 1, sb
    expect(pg.locator('#settings-sheet-title')).to_have_text('Web server')
    expect(sheet.locator('[data-settings]')).to_have_attribute('data-pick-path', 'services[0].picks[0]')
    open_attached(sheet.locator('li[data-slot]').nth(0))
    # 시트는 제 안에서 스크롤한다 — 딸린 것을 펴면 내용이 70vh 를 넘는다
    assert sheet.locator('[data-settings]').evaluate('e => e.scrollHeight > e.clientHeight'), sheet.locator('[data-settings]').evaluate('e => [e.scrollHeight, e.clientHeight]')
    no_hscroll(pg, 360, '시트 열림')
    # Esc 로 닫히고 포커스는 그 줄로
    sheet.locator('[data-settings] [data-ha]').focus()
    pg.keyboard.press('Escape')
    pg.wait_for_function("() => !document.querySelector('[data-settings-sheet]').open")
    expect(pg.locator('[data-row-path="services[0].picks[0]"]')).to_be_focused()
    # 닫기 단추로도 닫힌다 · Enter 로 열면 설정 칸 첫 컨트롤에 포커스
    pg.locator('[data-row-path="project"]').click()
    expect(pg.locator('#settings-sheet-title')).to_have_text('Project')
    sheet.locator('[data-overlay-close]').click()
    pg.wait_for_function("() => !document.querySelector('[data-settings-sheet]').open")
    expect(pg.locator('[data-row-path="project"]')).to_be_focused()
    pg.keyboard.press('Enter')
    pg.wait_for_function("() => document.querySelector('[data-settings-sheet]').open")
    expect(sheet.locator('#wizard-owner')).to_be_focused()
    pg.keyboard.press('Escape')
    pg.wait_for_function("() => !document.querySelector('[data-settings-sheet]').open")
    # ↑↓ 는 고르기만 하고 시트를 열지 않는다
    pg.keyboard.press('ArrowDown')
    expect(pg.locator('[data-row-path="network"]')).to_be_focused()
    assert not dialog_open(pg, '[data-settings-sheet]')
    # 탭 — Names 를 누르면 이름 칸 · 목록은 숨는다 · 머리 요약은 탭과 같다
    pg.click('[data-wizard-tab="names"]')
    expect(pg.locator('[data-wizard-tab="names"]')).to_have_attribute('aria-selected', 'true')
    expect(pg.locator('[data-names-column]')).to_be_visible()
    expect(pg.locator('[data-wizard-list-column]')).to_be_hidden()
    expect(pg.locator('[data-names-summary]')).to_have_text(f'{n} names · {ok}/{n} PASS')
    no_hscroll(pg, 360, 'Names 탭')
    pg.click('[data-wizard-tab="plan"]')
    expect(pg.locator('[data-wizard-list-column]')).to_be_visible()
    # 탭 키보드 — 고른 탭만 Tab 순서에 있고, → · Home 이 옮기면서 고른다 (D89 독립 리뷰)
    tab_plan, tab_names = pg.locator('[data-wizard-tab="plan"]'), pg.locator('[data-wizard-tab="names"]')
    expect(tab_plan).to_have_attribute('tabindex', '0')
    expect(tab_names).to_have_attribute('tabindex', '-1')
    tab_plan.focus()
    pg.keyboard.press('ArrowRight')
    expect(tab_names).to_be_focused()
    expect(tab_names).to_have_attribute('aria-selected', 'true')
    expect(pg.locator('[data-names-column]')).to_be_visible()
    pg.keyboard.press('Home')
    expect(tab_plan).to_be_focused()
    expect(pg.locator('[data-wizard-list-column]')).to_be_visible()
    # 연 시트는 폭을 바꿨다 돌아와도 저절로 다시 열리지 않는다 — 태블릿 드로어도 같다 (D89 독립 리뷰)
    pg.locator('[data-row-path="project"]').click()
    pg.wait_for_function("() => document.querySelector('[data-settings-sheet]').open")
    pg.set_viewport_size({'width': 768, 'height': 1024})
    pg.locator('[data-names-handle]').click()
    assert dialog_open(pg, '[data-names-drawer]')
    pg.set_viewport_size({'width': 360, 'height': 800})
    expect(pg.locator('[data-wizard-layout]')).to_have_attribute('data-wizard-layout', 'phone')
    assert not dialog_open(pg, '[data-settings-sheet]')
    pg.set_viewport_size({'width': 768, 'height': 1024})
    expect(pg.locator('[data-wizard-layout]')).to_have_attribute('data-wizard-layout', 'tablet')
    assert not dialog_open(pg, '[data-names-drawer]')
    expect(pg.locator('[data-names-handle]')).to_have_attribute('aria-expanded', 'false')
    pg.set_viewport_size({'width': 360, 'height': 800})
    # 390 에서도 시트 · 가로 스크롤 없음
    pg.set_viewport_size({'width': 390, 'height': 844})
    pg.locator('[data-row-path="services[1]"]').click()
    pg.wait_for_function("() => document.querySelector('[data-settings-sheet]').open")
    expect(pg.locator('#settings-sheet-title')).to_have_text('pay')
    no_hscroll(pg, 390, '시트 열림')
    pg.keyboard.press('Escape')
    pg.wait_for_function("() => !document.querySelector('[data-settings-sheet]').open")
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
    goto_ready(pg, BASE + '/')
    fill_project(pg)
    svc(pg, 0).locator('[data-purpose-chip="web"]').click()
    pg.click('[data-add-service]')
    settings(pg).locator('[data-service-name]').fill('pay')
    settings(pg).locator('[data-purpose-chip="db"]').click()
    select(pg, 'services[0].picks[0]')
    pg.set_viewport_size({'width': width, 'height': height})
    return ctx, pg


def wizard_narrow_shots(browser, errors):
    """07 태블릿 768 — 이름 드로어 열림 · 08 폰 360 — Web server 설정 시트 열림(딸린 것 펼침)"""
    ctx, pg = narrow_plan(browser, errors, 768, 1024)
    expect(pg.locator('[data-wizard-layout]')).to_have_attribute('data-wizard-layout', 'tablet')
    pg.click('[data-names-handle]')
    pg.wait_for_function("() => document.querySelector('[data-names-drawer]').open")
    wizard_shot(pg, '07-wizard-tablet.png')
    ctx.close()
    ctx, pg = narrow_plan(browser, errors, 360, 800)
    expect(pg.locator('[data-wizard-layout]')).to_have_attribute('data-wizard-layout', 'phone')
    pg.locator('[data-row-path="services[0].picks[0]"]').click()
    pg.wait_for_function("() => document.querySelector('[data-settings-sheet]').open")
    open_attached(pg.locator('[data-settings-sheet] li[data-slot]').nth(0))
    wizard_shot(pg, '08-wizard-phone.png')
    ctx.close()



with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
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
    assert page.eval_on_selector_all('[role="radio"]', 'els => els.map(e => e.dataset.cloud)') == ['aws', 'gcp', 'azure']
    expect(page.locator('[role="radio"][aria-checked="true"]')).to_have_count(1)
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
    assert page.eval_on_selector_all('[role="radio"]', 'els => els.map(e => [e.dataset.cloud, e.tabIndex])') == [['aws', -1], ['gcp', 0], ['azure', -1]]
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
    expect(page.locator('[data-share-warning]')).to_be_visible()  # 좁은 화면에서도 경고가 보이고 가로 스크롤을 만들지 않는다(위 scrollWidth)
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
    expect(page8.locator('[role="radio"][aria-checked="true"]')).to_have_count(1)
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
        res = pr.request.post(BASE + '/v1/names', data={'provider': 'gcp', 'context': {**INPUT, 'region': region}, 'resources': resources})
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
    for table_id, rows in {'abbreviations': 115, 'regions': 43, 'kinds': 19, 'env': 9, 'tokens': 10, 'attached': 4, 'presets': 11}.items():
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

