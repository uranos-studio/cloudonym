"""화면 시험 — Playwright(Python) 로 네 단계 화면(D42)의 시나리오 ⑴~⒆ · ⒇~㉖ · ㉙ 를 재고 스크린샷을 남긴다.
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
OUT.mkdir(parents=True, exist_ok=True)

# ⑴ 의 입력 — 기본값(platform · billing · trade · asia-northeast3-a)과 달라야 시험이 공허하지 않다. SA 원본 40자 → region 생략 → owner 생략 (엔진 실측)
# region 은 hash 에 싣는 꼴(존 코드 — urlState.encodeState)이다. 폼에서는 리전 콤보박스와 존 select 둘로 나뉜다(REGION_FORM)
INPUT = {'owner': 'devops', 'system': 'payments', 'purpose': 'ledger', 'env': 'prod', 'region': 'euw1b'}
# 같은 탭 공유 URL 이동의 입력 — INPUT 과 다섯 값이 모두 다르다
OTHER = {'owner': 'infra', 'system': 'billing', 'purpose': 'batch', 'env': 'stg', 'region': 'ane1c'}
# hash 의 지역 코드 → 폼의 (리전 · 존) — 존이 없으면 ''(존 select 의 none)
REGION_FORM = {'euw1b': ('europe-west1', 'europe-west1-b'), 'euw1': ('europe-west1', ''), 'ane1c': ('asia-northeast1', 'asia-northeast1-c'),
               'ane3a': ('asia-northeast3', 'asia-northeast3-a')}
# 첫 화면 · 깨진 hash · 꺼진 CSP 링크의 문맥 (R0 · D55)
DEFAULT = {'owner': 'platform', 'system': 'billing', 'purpose': 'trade', 'env': 'prod', 'region': 'ane3a'}
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
  for (const sel of document.querySelectorAll('#field-env, #field-zone')) {
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


# 존 select 는 지금 리전의 존만 든다 — 표의 모든 존 글자(RegionPicker 의 「a — ane3a」 꼴)를 같은 상자 · 같은 글꼴로 잰다
ZONE_FIT_JS = '''(labels) => {
  const sel = document.getElementById('field-zone');
  const cs = getComputedStyle(sel);
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = cs.font;
  const avail = sel.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 24;
  return labels.map((t) => [t, ctx.measureText(t).width]).filter(([, w]) => w > avail).map(([t, w]) => `field-zone 「${t}」 ${w.toFixed(1)}px > ${avail.toFixed(1)}px`);
}'''


def zone_labels(page):
    """/llms.txt 지역 표(GCP)의 모든 존 → 존 select 의 글자"""
    text = page.request.get(BASE + '/llms.txt').text()
    zones = re.findall(r'`((?:[a-z]+-)+[a-z]+[0-9]+-([a-z]))` `([a-z0-9]+)`', text)
    assert len(zones) > 100, len(zones)  # 공허하지 않다
    return sorted({f'{letter} — {code}' for _, letter, code in zones})


def assert_selects_fit(page, width):
    clipped = page.evaluate(SELECT_FIT_JS) + page.evaluate(ZONE_FIT_JS, ZONE_LABELS)
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


def pick_region(page, region, zone):
    """② 지역 — 콤보박스에 리전 이름을 쳐서 그 항목을 누르고, 존은 늘 명시한다(리전을 바꾸면 같은 글자의 존을 이어 받으므로)"""
    page.fill('#field-region', region)
    page.click(f'[data-region-option="{region}"]')
    page.select_option('#field-zone', zone)


def fill_five(page, ctx):
    for key in ('owner', 'system', 'purpose'):
        page.fill(f'#field-{key}', ctx[key])
    page.select_option('#field-env', ctx['env'])
    pick_region(page, *REGION_FORM[ctx['region']])


def expect_ctx(page, ctx):
    """폼이 문맥(hash 꼴)을 보이는가 — 지역은 리전 칸 · 존 칸 둘로 본다"""
    for key in ('owner', 'system', 'purpose', 'env'):
        expect(page.locator(f'#field-{key}')).to_have_value(ctx[key])
    region, zone = REGION_FORM[ctx['region']]
    expect(page.locator('#field-region')).to_have_value(region)
    expect(page.locator('#field-zone')).to_have_value(zone)


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


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    errors = []

    # ── ⑴ 첫 방문 — 버튼 셋 중 둘(AWS · Azure)은 꺼진 「Coming soon」 · 켜진 GCP 가 자동 선택 · 다섯 입력 · SA 를 골라 축약 안내 · 비콘 수 ──
    ctx1 = browser.new_context(viewport={'width': 1280, 'height': 900})
    ctx1.grant_permissions(['clipboard-read', 'clipboard-write'], origin=BASE)
    page = ctx1.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    sent = events_of(page)
    goto_ready(page, BASE + '/')
    VERSION = page.request.get(BASE + '/v1/health').json()['version']
    ZONE_LABELS = zone_labels(page)
    RULES = VERSION['rules']
    assert RULES != OLD_RULES, RULES
    expect(page.locator('h1')).to_have_text('Cloudonym')
    assert page.evaluate('document.documentElement.lang') == 'en'
    # 버튼은 셋 다 그린다 — 켜진 것이 하나(GCP)라 첫 그리기 때 그것이 골라지고 트리가 바로 보인다 (D45 · 오너 결정 C1)
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
    expect(sa.locator('[data-steps]')).to_contain_text("Shortened — Dropped optional token 'region' · Dropped optional token 'owner' (originally 40 characters)")
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
    expect(page.locator('article[data-key="compute_instance_03"] [data-name]')).to_have_text('payments-ledger-prod-euw1b-gce-03')
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

    # ── ⑸ 내보내기 셋 + 태그 JSON · 이름 복사 · 공유 URL ──
    page.click('[data-copy="terraform"]')
    hcl = page.evaluate('navigator.clipboard.readText()')
    head = hcl.split('\n')
    assert head[0] == f"# Generated by Cloudonym — engine {VERSION['engine']} · rules {RULES}", head[:3]
    assert head[1].startswith('# PASS means') and head[2] == 'locals {', head[:3]
    assert '  # gcp\n  gcp_project_id = "devops-payments-ledger-prod"\n  gcp_storage_bucket = "devops-payments-ledger-prod-gcs"\n  gcp_service_account_db = "payments-ledger-prod-sa-db"\n  gcp_compute_instance_01 = "payments-ledger-prod-euw1b-gce-01"\n  gcp_compute_instance_02 = "payments-ledger-prod-euw1b-gce-02"\n' in hcl, hcl
    assert '  gcp_labels = {\n' in hcl and 'INVALID' not in hcl and 'azure' not in hcl and 'aws' not in hcl, hcl
    page.click('[data-copy="names-json"]')
    names = json.loads(page.evaluate('navigator.clipboard.readText()'))
    assert names['version'] == VERSION and names['provider'] == 'gcp' and names['context'] == {**{k: INPUT[k] for k in ('owner', 'system', 'purpose', 'env')}, 'region': 'euw1', 'zone': 'euw1b'}, names
    assert [n['key'] for n in names['names']] == ['project_id', 'storage_bucket', 'service_account_db', 'compute_instance_01', 'compute_instance_02'], names['names']
    assert names['names'][3] == {'key': 'compute_instance_01', 'resource_type': 'compute_instance', 'seq': '01', 'scope': 'gcp:project', 'name': 'payments-ledger-prod-euw1b-gce-01'}, names['names'][3]
    assert names['invalid'] == [], names['invalid']
    expect(page.locator('[data-copy="all-names"]')).to_have_text('Copy all names')
    page.click('[data-copy="all-names"]')
    assert page.evaluate('navigator.clipboard.readText()') == 'devops-payments-ledger-prod\ndevops-payments-ledger-prod-gcs\npayments-ledger-prod-sa-db\npayments-ledger-prod-euw1b-gce-01\npayments-ledger-prod-euw1b-gce-02'
    page.click('[data-copy="tags-json"]')
    copied_tags = json.loads(page.evaluate('navigator.clipboard.readText()'))
    assert copied_tags == {'version': VERSION, 'labels': {'gcp': {'owner': 'devops', 'system': 'payments', 'purpose': 'ledger', 'environment': 'prod', 'managed_by': 'cloudonym'}}}, copied_tags
    page.click(f'{VM1} [data-copy="name:compute_instance_01"]')
    assert page.evaluate('navigator.clipboard.readText()') == 'payments-ledger-prod-euw1b-gce-01'
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
    expect(page2.locator(f'{VM1} [data-name]')).to_have_text('payments-ledger-prod-euw1b-gce-01')
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
    expect(page.locator('article[data-key="compute_instance_03"] [data-name]')).to_have_text('billing-batch-stg-ane1c-gce-03')
    page.wait_for_timeout(1300)
    assert sent.count('ui_generate') == generated_before, f'hash 이동 복원이 ui_generate 를 셌다: {sent}'
    assert page.evaluate('location.hash') == other_hash, (page.evaluate('location.hash'), other_hash)
    page.evaluate("() => { location.hash = '#state=!!!'; }")
    page.wait_for_function('h => location.hash === h', arg=other_hash)
    expect(page.locator('#field-owner')).to_have_value(OTHER['owner'])
    page.evaluate('h => { location.hash = h; }', '#' + share_url.split('#', 1)[1])
    expect(page.locator(f'{VM1} [data-name]')).to_have_text('payments-ledger-prod-euw1b-gce-01')

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
    expect(page.locator(f'{VM1} [data-name]')).to_have_text('payments-ledger-prod-euw1b-gce-01')

    # ── ⑶ 깨진 hash 로 열어도 화면이 뜨고 기본값으로 간다 — 켜진 CSP(GCP)가 자동 선택 ──
    for broken in ('#state=!!!', '#state=' + 'eyJvd25lciI6NDJ9', '#state=', '#state=W10'):  # !!! · {"owner":42} · 빈 값 · []
        ctx3 = browser.new_context(viewport={'width': 1280, 'height': 900})
        page3 = ctx3.new_page()
        page3.on('pageerror', lambda e: errors.append(str(e)))
        goto_ready(page3, BASE + '/' + broken)
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
    expect(page4.locator(f'{VM1} [data-name]')).to_have_text('payments-ledger-prod-euw1b-gce-01')
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
    goto_ready(page8, BASE + '/' + old_hash)
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

    # ── ⒁ 옛 링크(다섯 키만) → 문맥이 열리고 켜진 CSP(GCP)가 자동 선택 · hash 를 덮어쓰지 않는다 ──
    v1_hash = state_hash(INPUT)
    goto_ready(page8, BASE + '/?' + v1_hash)  # 경로를 바꿔 새로 불러온다
    goto_ready(page8, BASE + '/' + v1_hash)
    expect_ctx(page8, INPUT)
    expect(page8.locator('[role="radio"][aria-checked="true"]')).to_have_count(1)
    expect(page8.locator('[data-cloud="gcp"]')).to_have_attribute('aria-checked', 'true')
    expect(page8.locator('[data-tree]')).to_have_count(1)
    page8.wait_for_timeout(300)
    assert page8.evaluate('location.hash') == v1_hash, page8.evaluate('location.hash')

    # ── ⒂ 모르는 type · 종류가 안 맞는 값이 든 링크 → 그 항목만 버리고 한 줄 안내 ──
    odd = state_hash(INPUT, RULES, 'gcp', {'no_such_type': 1, 'compute_instance': 2, 'service_account': 1})
    goto_ready(page8, BASE + '/?x' + odd)
    goto_ready(page8, BASE + '/' + odd)
    expect(page8.locator('[data-selection-dropped]')).to_have_text('This link had 2 resource selections that do not fit the current rules or limits; they were left out.')
    expect(page8.locator('article[data-key]')).to_have_count(2)
    expect(page8.locator('[data-selected-count]')).to_have_text('1 selected')
    row(page8, 'storage_bucket').locator('input[data-row-check]').check()  # 사용자가 선택을 바꾸면 안내를 지운다
    expect(page8.locator('[data-selection-dropped]')).to_have_count(0)

    # ── ⒄ 지금 버전 링크로 연 뒤 개수 +1 → −1 — 주소창 hash 가 화면의 선택을 따라간다(링크 상태가 남아 hash 쓰기를 막으면 안 된다) ──
    linked = state_hash(INPUT, RULES, 'gcp', {'compute_instance': 2})
    goto_ready(page8, BASE + '/?y' + linked)
    goto_ready(page8, BASE + '/' + linked)
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
    goto_ready(page18, BASE + '/' + full)
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
    goto_ready(page19, BASE + '/?fixture=rules500' + state_hash(INPUT, RULES, 'gcp', sel200))
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
    goto_ready(page16, BASE + '/?fixture=conflict' + state_hash(INPUT, RULES, 'gcp', {'test_conflict_a': 1, 'test_conflict_b': 1, 'project_id': 1}))
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
    goto_ready(pr, BASE + '/' + state_hash(INPUT, RULES, 'gcp'))
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

    # ㉕ 존 가드 — 존이 없으면 고르지 않은 존 행은 체크 불가 + 안내 · 존을 고르면 체크할 수 있다
    disk = row_key(pr, 'gcp.disk')
    disk_box = disk.locator('input[data-row-check]')
    disk.locator('[data-scope-select]').select_option('gcp:project_zone')
    expect(disk_box).to_be_enabled()
    pr.select_option('#field-zone', '')
    wait_for(lambda: hash_state(pr.url)['region'], 'euw1', '존 none → 리전 코드')
    expect(pr.locator('[data-zone-hint]')).to_have_text('Zonal resources (VMs, disks) need a zone')
    expect(disk_box).to_be_disabled()
    expect(disk.locator('[data-zone-required]')).to_have_text('Pick a zone in ② to name zonal resources')
    expect(disk_box).to_have_attribute('aria-describedby', disk.locator('[data-zone-required]').get_attribute('id'))
    expect(row_key(pr, 'gcp.compute_instance').locator('input[data-row-check]')).to_be_disabled()  # 단일 존 행도 같다
    pr.select_option('#field-zone', 'europe-west1-c')
    expect(disk_box).to_be_enabled()
    expect(disk.locator('[data-zone-required]')).to_have_count(0)
    expect(pr.locator('[data-zone-hint]')).to_have_count(0)
    pr.select_option('#field-zone', 'europe-west1-b')

    # ㉕-2 VM 2 를 고른 뒤 존을 none 으로 → 선택 유지 · 카드 둘 FAIL(name.zone_required) · 존을 다시 고르면 PASS · 체크 해제는 된다
    vm_box = vmr.locator('input[data-row-check]')
    vm_box.check()
    vmr.locator('[data-inc]').click()
    expect(vmr.locator('[data-count]')).to_have_text('2')
    want = api([{'type': 'compute_instance', 'count': 2}])
    for k in ('compute_instance_01', 'compute_instance_02'):
        expect(card(k)).to_have_attribute('data-valid', 'true')
        expect(card(k).locator('[data-name]')).to_have_text(want[k]['name'])
    pr.select_option('#field-zone', '')
    no_zone = api([{'type': 'compute_instance', 'count': 2}], region='euw1')
    assert all(no_zone[k]['violations'][0]['code'] == 'name.zone_required' for k in ('compute_instance_01', 'compute_instance_02')), no_zone
    expect(vm_box).to_be_checked()
    expect(vm_box).to_be_enabled()  # 고른 행은 체크 해제만 된다
    expect(vmr.locator('[data-zone-required]')).to_have_text('Pick a zone in ② to name zonal resources')
    expect(vmr.locator('[data-count]')).to_have_text('2')
    for k in ('compute_instance_01', 'compute_instance_02'):
        expect(card(k)).to_have_attribute('data-valid', 'false')
        expect(card(k).locator('[data-violations]')).to_contain_text("This resource is zonal: put a zone (zone name or zone code), not a region, in region (got 'euw1')")
        expect(card(k).locator('button[data-copy]')).to_be_disabled()
    pr.click('[data-copy="names-json"]')
    inv = json.loads(pr.evaluate('navigator.clipboard.readText()'))['invalid']
    assert {'key': 'compute_instance_01', 'codes': ['name.zone_required']} in inv and {'key': 'compute_instance_02', 'codes': ['name.zone_required']} in inv, inv
    pr.select_option('#field-zone', 'europe-west1-b')
    for k in ('compute_instance_01', 'compute_instance_02'):
        expect(card(k)).to_have_attribute('data-valid', 'true')
        expect(card(k).locator('[data-name]')).to_have_text(want[k]['name'])
    expect(vmr.locator('[data-zone-required]')).to_have_count(0)
    pr.select_option('#field-zone', '')
    expect(card('compute_instance_01')).to_have_attribute('data-valid', 'false')
    vm_box.uncheck()
    expect(vm_box).not_to_be_checked()
    expect(card('compute_instance_01')).to_have_count(0)
    expect(vm_box).to_be_disabled()  # 끈 뒤에는 존이 없어 다시 고를 수 없다
    pr.select_option('#field-zone', 'europe-west1-b')
    expect(vm_box).to_be_enabled()

    # ㉖ 지역 콤보박스 — 열기 · 리전 이름 · 위치 · 코드로 거르기 · 없음 안내 · Escape 는 검색어를 버린다 · 방향키 + Enter 로 고르면 같은 글자의 존을 잇는다
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
    region_box.fill('zzz-none')
    expect(pr.locator('[data-region-empty]')).to_have_text('No region matches — type a region name, a city or a code')
    pr.keyboard.press('Escape')
    expect(region_box).to_have_attribute('aria-expanded', 'false')
    expect(region_box).to_have_value('europe-west1')
    expect(pr.locator('#field-zone')).to_have_value('europe-west1-b')
    region_box.fill('asia-northeast')  # 리전 이름
    names_shown = pr.eval_on_selector_all('[data-region-option]', 'els => els.map(e => e.dataset.regionOption)')
    assert len(names_shown) >= 2 and all(v.startswith('asia-northeast') for v in names_shown), names_shown
    pr.keyboard.press('ArrowDown')
    expect(region_box).to_have_attribute('aria-activedescendant', pr.locator(f'[data-region-option="{names_shown[1]}"]').get_attribute('id'))
    pr.keyboard.press('Enter')
    expect(region_box).to_have_attribute('aria-expanded', 'false')
    expect(region_box).to_have_value(names_shown[1])
    expect(pr.locator('#field-zone')).to_have_value(names_shown[1] + '-b')  # europe-west1-b 의 b 를 잇는다
    wait_for(lambda: hash_state(pr.url)['region'], {'asia-northeast2': 'ane2b', 'asia-northeast3': 'ane3b'}.get(names_shown[1]), '콤보박스로 고른 지역')
    region_box.fill('seoul')
    pr.keyboard.press('Enter')
    expect(region_box).to_have_value('asia-northeast3')
    expect(pr.locator('[data-region-summary]')).to_have_text('Seoul, South Korea · ane3b')
    no_hangul(pr)
    ctxR.close()

    # ── ㉙ 꺼진 CSP(Azure) 로 만든 링크 → GCP 로 열리고 지역은 예시로 · 선택은 비운다 · 자유 입력 셋과 환경은 그대로 · 안내 한 줄 · 선택을 바꾸면 안내가 사라진다 (D55) ──
    ctx20 = browser.new_context(viewport={'width': 1280, 'height': 900})
    page20 = ctx20.new_page()
    page20.on('pageerror', lambda e: errors.append(str(e)))
    az_link = state_hash({**INPUT, 'region': 'koreacentral'}, RULES, 'azure', {'virtual_machine': 2, 'resource_group': 1})  # Azure 가 풀 수 있는 지역이라야 이 분기다
    goto_ready(page20, BASE + '/' + az_link)
    expect(page20.locator('[data-cloud="gcp"]')).to_have_attribute('aria-checked', 'true')
    expect(page20.locator('[data-cloud="azure"]')).to_have_attribute('aria-checked', 'false')
    expect(page20.locator('[data-provider-unavailable]')).to_have_text('This link was made for Azure, which is not available yet — the region was reset to the example and the selection was cleared.')
    expect(page20.locator('[data-selection-dropped]')).to_have_count(0)  # 안내는 한 줄 — 버린 선택은 위 문장이 말한다
    reset = {**INPUT, 'region': DEFAULT['region']}
    expect_ctx(page20, reset)  # 자유 입력 셋 · 환경은 링크 그대로, 지역은 예시 asia-northeast3-a
    expect(page20.locator('[data-selected-count]')).to_have_text('0 selected')
    expect(page20.locator('article[data-key]')).to_have_count(0)
    no_hangul(page20)
    check(page20, 'project_id')
    expect(page20.locator('[data-provider-unavailable]')).to_have_count(0)
    page20.wait_for_function('h => location.hash !== h', arg=az_link)
    assert hash_state(page20.url) == {**reset, 'v': RULES, 'p': 'gcp', 'r': {'project_id': 1}}, hash_state(page20.url)
    ctx20.close()
    browser.close()

    assert errors == [], errors
    print('OK — 시나리오 ⑴~⒆ · ⒇~㉖ · ㉕-2 · ㉙ 통과 · 비콘', sent, '· 스크린샷', sorted(p.name for p in OUT.glob('*.png')))
