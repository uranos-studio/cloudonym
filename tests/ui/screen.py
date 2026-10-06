"""화면 시험 — Playwright(Python) 로 네 단계 화면(D42)의 시나리오 ⑴~⒆을 재고 스크린샷을 남긴다 (개발 6단계 Task 4).

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
import sys
import time
from pathlib import Path

from playwright.sync_api import Error, expect, sync_playwright

BASE = sys.argv[1].rstrip('/')
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)

# ⑴ 의 입력 — 기본값(platform · billing · trade)과 달라야 시험이 공허하지 않다. SA 원본 37자 → region 생략 → owner 생략 (엔진 실측)
INPUT = {'owner': 'devops', 'system': 'payments', 'purpose': 'ledger', 'env': 'prd', 'region': 'kr'}
# 같은 탭 공유 URL 이동의 입력 — INPUT 과 다섯 값이 모두 다르다
OTHER = {'owner': 'infra', 'system': 'billing', 'purpose': 'batch', 'env': 'stg', 'region': 'jp'}
# ⑴ 에서 고르는 Azure 선택 — 트리 순서(Global → Subscription → Resource group)
PICK = {'storage_account': 1, 'resource_group': 1, 'managed_identity': 'db', 'virtual_machine': 2}

# 옛 규칙 버전 — 지금 버전(/v1/health 의 version.rules)과 다른, 꼴이 맞는 값 (D27 ⑵)
OLD_RULES = '2000-01-01.1'

SA_CARD = 'article[data-key="service_account_sync"]'
VM1 = 'article[data-key="virtual_machine_01"]'


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


def row(page, rtype):
    return page.locator(f'[data-tree] [data-type="{rtype}"]')


def check(page, rtype):
    row(page, rtype).locator('input[data-row-check]').check()


def tree_rows(page):
    return page.locator('[data-tree] [data-rule]')


def visible_types(page):
    return page.eval_on_selector_all('[data-tree] [data-rule]', 'els => els.filter(e => e.checkVisibility()).map(e => e.dataset.type)')


# 트리의 행 — 타입 · 분류 · entity · 보이는 글자 · 보이는가 · 범위 깊이(뿌리 = 0, 걸러진 트리에서도 조상 범위가 남으므로 같다)
ROWS_JS = '''els => els.map(e => {
  let depth = -1;
  for (let d = e.closest('details[data-scope]'); d; d = d.parentElement.closest('details[data-scope]')) depth++;
  return { type: e.dataset.type, category: e.dataset.ruleCategory, entity: e.dataset.entity, text: e.innerText, visible: e.checkVisibility(), depth };
})'''


def rows_info(page):
    return page.eval_on_selector_all('[data-tree] [data-rule]', ROWS_JS)


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

    # ── ⑴ 첫 방문 — CSP 기본값 없음 · 다섯 입력 · GCP 에서 SA 를 골라 축약 안내 · 비콘 수 ──
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
    # 첫 방문은 CSP 를 고르지 않는다(오너 결정) — 트리 대신 안내 · 선택된 라디오 없음
    expect(page.locator('[role="radio"][aria-checked="true"]')).to_have_count(0)
    expect(page.locator('[data-pick-cloud]')).to_have_text('Choose a cloud above to see its resources.')
    expect(page.locator('[data-tree]')).to_have_count(0)
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
    page.click('[data-cloud="gcp"]')
    expect(page.locator('[data-cloud="gcp"]')).to_have_attribute('aria-checked', 'true')
    expect(page.locator('[data-names-empty]')).to_have_text('Pick resources in step 3 to generate their names.')
    check(page, 'service_account')
    sa = page.locator(SA_CARD)
    expect(sa.locator('[data-name]')).to_have_text('payments-ledger-prd-sa-sync')
    expect(sa.locator('[data-steps]')).to_contain_text("Shortened — Dropped optional token 'region' · Dropped optional token 'owner' (originally 37 characters)")
    expect(sa).to_have_attribute('data-valid', 'true')
    expect(sa.locator('h4')).to_have_text('Service Account · sync')
    page.wait_for_timeout(1500)  # 디바운스 1초 뒤에 ui_generate 가 한 번
    assert sent.count('ui_visit') == 1, f'ui_visit 이 {sent.count("ui_visit")}회 — StrictMode 이중 effect 를 sessionStorage 가드가 막아야 한다: {sent}'
    assert sent.count('ui_generate') == 1, f'ui_generate 가 {sent.count("ui_generate")}회 — 다섯 입력을 1초 디바운스로 한 번 · CSP · 선택은 세지 않는다: {sent}'

    # ── ⑽ 단계 — CSP 를 바꾸면 선택이 지워진다 · 방향키는 포커스만 옮긴다(대화창 없음) · 스페이스로 고르면 바꾸기 전 확인 · 취소하면 그대로 ──
    dialogs = []
    record = lambda d: (dialogs.append(d.message), d.dismiss())
    page.on('dialog', record)
    page.locator('[data-cloud="gcp"]').focus()
    page.keyboard.press('ArrowRight')  # 수동 선택 라디오 그룹 — 포커스만 azure 로
    page.keyboard.press('ArrowRight')  # aws 로 (둘 다 대화창을 띄우지 않는다)
    page.keyboard.press('ArrowLeft')   # 다시 azure
    page.wait_for_timeout(200)
    assert dialogs == [], f'방향키가 확인 창을 띄웠다: {dialogs}'
    assert page.evaluate('document.activeElement.dataset.cloud') == 'azure'
    expect(page.locator('[data-cloud="gcp"]')).to_have_attribute('aria-checked', 'true')
    expect(page.locator('[data-cloud="azure"]')).to_have_attribute('aria-checked', 'false')
    # 탭 순서는 체크된 라디오가 받는다 — 포커스가 옮겨도 aria-checked · tabIndex 가 서로 맞다
    assert page.eval_on_selector_all('[role="radio"]', 'els => els.map(e => [e.dataset.cloud, e.tabIndex])') == [['aws', -1], ['gcp', 0], ['azure', -1]]
    page.keyboard.press('Space')  # 고른다 → 확인 창 → 취소
    page.wait_for_timeout(200)
    assert dialogs == ['Switching the cloud clears 1 selected resources. Continue?'], dialogs
    expect(page.locator('[data-cloud="gcp"]')).to_have_attribute('aria-checked', 'true')
    expect(page.locator('[data-selected-count]')).to_have_text('1 selected')
    page.remove_listener('dialog', record)
    page.once('dialog', lambda d: d.accept())
    page.keyboard.press('Enter')
    expect(page.locator('[data-cloud="azure"]')).to_have_attribute('aria-checked', 'true')
    expect(page.locator('[data-selected-count]')).to_have_text('0 selected')
    expect(page.locator('article[data-key]')).to_have_count(0)
    page.wait_for_timeout(1200)
    assert sent.count('ui_generate') == 1, f'CSP 전환이 ui_generate 를 셌다: {sent}'
    # 선택이 0개여도 Terraform 버튼으로 태그 블록만 담은 locals 를 복사한다
    expect(page.locator('[data-names-empty]')).to_have_text('Pick resources in step 3 to generate their names.')
    page.click('[data-copy="terraform"]')
    tags_only = page.evaluate('navigator.clipboard.readText()')
    assert '  # azure\n  azure_tags = {\n' in tags_only, tags_only
    assert '    owner = "devops"\n' in tags_only and tags_only.endswith('  }\n}\n'), tags_only
    assert 'azure_storage' not in tags_only and 'INVALID' not in tags_only, tags_only

    # ── ⑾ 개수 → 이름 끝 · seq 없는 규칙은 1 고정 · 역할 · 키보드 ──
    # 처음엔 뿌리 바로 아래 한 단계만 펼친다 — Resource group 안은 닫혀 있다
    # 기대값은 /llms.txt 의 트리 — 깊이 0 · 1 의 규칙이 전부 보이고 그보다 깊은 규칙은 하나도 보이지 않는다(규칙이 늘어도 뜻이 같다)
    AZ_TREE = llms_tree(page, 'azure')
    shallow = sorted(t for t, d in AZ_TREE if d <= 1)
    assert {'storage_account', 'key_vault', 'sql_server', 'resource_group'} <= set(shallow), shallow  # 앵커 — 이 시나리오가 쓰는 행
    assert sorted(visible_types(page)) == shallow, (visible_types(page), shallow)
    assert any(d >= 2 for _, d in AZ_TREE), '깊이 2 이상 규칙이 없으면 「처음엔 닫혀 있다」를 잰 것이 아니다'
    page.click('[data-expand-all]')
    ALL_ROWS = rows_info(page)
    # 펼친 트리 = /llms.txt 의 트리(타입 · 깊이) — 화면이 규칙을 빼거나 엉뚱한 범위에 그리면 여기서 걸린다
    assert sorted((r['type'], r['depth']) for r in ALL_ROWS) == sorted(AZ_TREE), (ALL_ROWS, AZ_TREE)
    assert all(r['visible'] for r in ALL_ROWS), [r['type'] for r in ALL_ROWS if not r['visible']]
    expect(row(page, 'subnet')).to_be_visible()
    for t in ('storage_account', 'resource_group', 'managed_identity', 'virtual_machine'):
        check(page, t)
    expect(row(page, 'resource_group').locator('[data-count-fixed]')).to_have_attribute('title', 'This resource has no sequence number, so it is always one')
    vm_row = row(page, 'virtual_machine')
    for _ in range(2):
        vm_row.locator('[data-inc]').click()
    expect(vm_row.locator('[data-count]')).to_have_text('3')
    expect(page.locator('article[data-key="virtual_machine_03"] [data-name]')).to_have_text('payments-ledger-prd-kr-vm-03')
    expect(page.locator('article[data-key="virtual_machine_03"] h4')).to_have_text('Virtual Machine (Linux) · 03')
    vm_row.locator('input[data-row-check]').focus()
    page.keyboard.press('-')
    expect(vm_row.locator('[data-count]')).to_have_text('2')
    expect(page.locator('article[data-key="virtual_machine_03"]')).to_have_count(0)
    shown = visible_types(page)
    page.keyboard.press('ArrowDown')  # 화면에 보이는 다음 행으로 — 기대값은 지금 보이는 행 순서에서 VM 바로 다음
    assert page.evaluate("document.activeElement.closest('[data-rule]')?.dataset.type") == shown[shown.index('virtual_machine') + 1], shown
    role_input = row(page, 'managed_identity').locator('[data-role-input]')
    expect(role_input).to_have_value('sync')
    role_input.fill('D')  # 꼴이 틀리면 반영하지 않고 aria-invalid
    expect(role_input).to_have_attribute('aria-invalid', 'true')
    expect(page.locator('article[data-key="managed_identity_sync"]')).to_have_count(1)
    # 무효인 동안 그 행에 「이전 역할로 생성됨」 안내 · blur 하면 칸이 마지막 유효 값으로 돌아간다
    mi_row = row(page, 'managed_identity')
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
    expect(page.locator('article[data-key="managed_identity_web"]')).to_have_count(1)
    role_input.fill('')
    expect(mi_row.locator('[data-role-stale]')).to_have_text('Not a valid role — names still use the previous role "web"')
    role_input.blur()
    expect(role_input).to_have_value('web')
    role_input.fill('db')
    expect(page.locator('article[data-key="managed_identity_db"] [data-name]')).to_have_text('payments-ledger-prd-id-db')
    expect(page.locator('[data-names-summary]')).to_have_text('4 resources · 5 names · 5/5 PASS')
    # 범위 경로 머리글 — 트리 순서
    assert page.locator('[data-scope-path]').all_inner_texts() == ['Global', 'Global › Subscription', 'Global › Subscription › Resource group'], page.locator('[data-scope-path]').all_inner_texts()
    assert hash_state(page.url) == {**INPUT, 'v': RULES, 'p': 'azure', 'r': PICK}, hash_state(page.url)
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
    assert '  # azure\n  azure_storage_account = "stpaymentsledgerprd"\n  azure_resource_group = "rg-payments-ledger-prd"\n  azure_managed_identity_db = "payments-ledger-prd-id-db"\n  azure_virtual_machine_01 = "payments-ledger-prd-kr-vm-01"\n  azure_virtual_machine_02 = "payments-ledger-prd-kr-vm-02"\n' in hcl, hcl
    assert '  azure_tags = {\n' in hcl and 'INVALID' not in hcl and 'gcp' not in hcl, hcl
    page.click('[data-copy="names-json"]')
    names = json.loads(page.evaluate('navigator.clipboard.readText()'))
    assert names['version'] == VERSION and names['provider'] == 'azure' and names['context'] == INPUT, names
    assert [n['key'] for n in names['names']] == ['storage_account', 'resource_group', 'managed_identity_db', 'virtual_machine_01', 'virtual_machine_02'], names['names']
    assert names['names'][3] == {'key': 'virtual_machine_01', 'resource_type': 'virtual_machine', 'seq': '01', 'scope': 'azure:resource_group', 'name': 'payments-ledger-prd-kr-vm-01'}, names['names'][3]
    assert names['invalid'] == [], names['invalid']
    expect(page.locator('[data-copy="all-names"]')).to_have_text('Copy all names')
    page.click('[data-copy="all-names"]')
    assert page.evaluate('navigator.clipboard.readText()') == 'stpaymentsledgerprd\nrg-payments-ledger-prd\npayments-ledger-prd-id-db\npayments-ledger-prd-kr-vm-01\npayments-ledger-prd-kr-vm-02'
    page.click('[data-copy="tags-json"]')
    copied_tags = json.loads(page.evaluate('navigator.clipboard.readText()'))
    assert copied_tags == {'version': VERSION, 'labels': {'azure': {'owner': 'devops', 'system': 'payments', 'purpose': 'ledger', 'environment': 'prd', 'managed_by': 'cloudonym'}}}, copied_tags
    page.click(f'{VM1} [data-copy="name:virtual_machine_01"]')
    assert page.evaluate('navigator.clipboard.readText()') == 'payments-ledger-prd-kr-vm-01'
    page.click('[data-copy="share-url"]')
    copied_url = page.evaluate('navigator.clipboard.readText()')
    assert copied_url == share_url, (copied_url, share_url)

    # ── ⑿ 검색 · 분류 칩 · 선택만 보기 ──
    search = page.locator('[data-tree-search]')
    search.fill('subnet')
    # 검색 일치(displayName · type · slug · entity 소문자 부분 일치)를 펼친 전체 행에서 따로 계산해 화면과 맞춘다
    hit = lambda r: 'subnet' in (r['type'] + ' ' + r['text'] + ' ' + r['entity']).lower()
    want = sorted(r['type'] for r in ALL_ROWS if hit(r))
    assert 'subnet' in want and len(want) < len(ALL_ROWS), want  # 공허하지 않다 — 일치가 있고 걸러지는 행도 있다
    expect(tree_rows(page)).to_have_count(len(want))
    assert sorted(visible_types(page)) == want, visible_types(page)  # 일치하는 행만 남고 그 조상은 펼친다
    # 걸러진 동안 범위 머리(summary)를 눌러도 접히지 않는다 — <details> DOM 과 React 상태가 어긋나지 않게
    page.locator('[data-tree] details[data-scope] > summary').first.click()
    assert page.eval_on_selector_all('[data-tree] details', 'els => els.every(e => e.open)'), '걸러진 트리의 details 가 닫혔다'
    assert sorted(visible_types(page)) == want, visible_types(page)
    search.fill('zzz-none')
    expect(page.locator('[data-search-empty]')).to_have_text('No resource matches. A resource missing from this list is not supported yet.')
    search.fill('')
    # 분류 칩 — 누르면 그 분류의 행만 전부 보인다 · 칩의 수 = 그 수 · 앵커 둘이 들어 있다
    net = sorted(r['type'] for r in ALL_ROWS if r['category'] == 'networking')
    assert {'subnet', 'virtual_network'} <= set(net) and len(net) < len(ALL_ROWS), net
    assert chip_count(page, 'networking') == len(net), (chip_count(page, 'networking'), net)
    page.click('button[data-category="networking"]')
    assert all(r['category'] == 'networking' for r in rows_info(page)), rows_info(page)
    assert sorted(visible_types(page)) == net, visible_types(page)
    page.click('button[data-category="all"]')
    page.check('[data-selected-only]')
    assert visible_types(page) == ['storage_account', 'resource_group', 'managed_identity', 'virtual_machine'], visible_types(page)
    page.uncheck('[data-selected-only]')
    expect(tree_rows(page)).to_have_count(len(AZ_TREE))
    assert chip_count(page, 'all') == len(AZ_TREE), chip_count(page, 'all')
    # 검색을 지운 뒤에도 뿌리 범위는 열려 있다(걸러진 동안 누른 summary 가 DOM 만 닫아 두지 않았다)
    assert page.eval_on_selector('[data-tree] details[data-scope]', 'e => e.open')
    page.click('[data-collapse-all]')  # 뿌리만 열어 두고 분류 묶음은 전부 접는다 — 깊이 0 의 규칙 중 묶음 밖 것만 보인다
    roots = sorted(t for t, d in AZ_TREE if d == 0)
    assert {'storage_account', 'key_vault', 'sql_server'} <= set(roots) and len(roots) < len(AZ_TREE), roots
    groups = page.eval_on_selector_all('[data-tree] details[data-group]', 'els => els.map(e => e.open)')
    assert len(groups) > 0 and not any(groups), groups  # 공허하지 않다 — 묶음이 있고 전부 닫혔다
    in_group = page.eval_on_selector_all('[data-tree] details[data-group] [data-rule]', 'els => els.map(e => e.dataset.type)')
    assert sorted(visible_types(page)) == sorted(t for t in roots if t not in in_group), (visible_types(page), roots, in_group)
    page.click('[data-expand-all]')

    # ── ⑵ 공유 URL 을 새 탭(새 컨텍스트 = 빈 sessionStorage)에 붙이면 문맥 · CSP · 선택이 복원된다 ──
    ctx2 = browser.new_context(viewport={'width': 1280, 'height': 900})
    page2 = ctx2.new_page()
    page2.on('pageerror', lambda e: errors.append(str(e)))
    sent2 = events_of(page2)
    goto_ready(page2, copied_url)
    for key, val in INPUT.items():
        expect(page2.locator(f'#field-{key}')).to_have_value(val)
    expect(page2.locator('[data-cloud="azure"]')).to_have_attribute('aria-checked', 'true')
    expect(page2.locator(f'{VM1} [data-name]')).to_have_text('payments-ledger-prd-kr-vm-01')
    expect(page2.locator('article[data-key]')).to_have_count(5)
    page2.wait_for_timeout(1300)
    assert sent2 == ['ui_visit'], f'복원 로드는 ui_visit 1회뿐이어야 한다(첫 화면은 ui_generate 를 세지 않는다): {sent2}'
    assert page2.url == copied_url, (page2.url, copied_url)
    ctx2.close()

    # ── ⑹ 같은 탭에서 공유 URL 로 이동(hash 만 바뀐다) → 상태가 따라온다 · ui_generate 를 세지 않는다 · 깨진 hash 는 지금 상태로 되돌린다 ──
    generated_before = sent.count('ui_generate')
    other_hash = state_hash(OTHER, RULES, 'gcp', {'compute_instance': 3})
    page.evaluate('h => { location.hash = h; }', other_hash)
    for key, val in OTHER.items():
        expect(page.locator(f'#field-{key}')).to_have_value(val)
    expect(page.locator('[data-cloud="gcp"]')).to_have_attribute('aria-checked', 'true')
    expect(page.locator('article[data-key="compute_instance_03"] [data-name]')).to_have_text('billing-batch-stg-jp-vm-03')
    page.wait_for_timeout(1300)
    assert sent.count('ui_generate') == generated_before, f'hash 이동 복원이 ui_generate 를 셌다: {sent}'
    assert page.evaluate('location.hash') == other_hash, (page.evaluate('location.hash'), other_hash)
    page.evaluate("() => { location.hash = '#state=!!!'; }")
    page.wait_for_function('h => location.hash === h', arg=other_hash)
    expect(page.locator('#field-owner')).to_have_value(OTHER['owner'])
    page.evaluate('h => { location.hash = h; }', '#' + share_url.split('#', 1)[1])
    expect(page.locator(f'{VM1} [data-name]')).to_have_text('payments-ledger-prd-kr-vm-01')

    # ── ⑺ 자유 입력은 64자에서 멈춘다 · 라벨 한도 위반(GCP 라벨 값 63자) → 태그 JSON 복사 비활성 + 이유 문구 · Terraform 은 INVALID 주석으로 복사된다 ──
    # Azure 태그 값 한도(256자)는 입력 상한(64자) 때문에 화면에서 닿지 않는다 — GCP 상태로 옮겨 본다
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
    expect(page.locator(f'{VM1} [data-name]')).to_have_text('payments-ledger-prd-kr-vm-01')

    # ── ⑶ 깨진 hash 로 열어도 화면이 뜨고 기본값으로 간다 — CSP 는 고르지 않은 상태 ──
    for broken in ('#state=!!!', '#state=' + 'eyJvd25lciI6NDJ9', '#state=', '#state=W10'):  # !!! · {"owner":42} · 빈 값 · []
        ctx3 = browser.new_context(viewport={'width': 1280, 'height': 900})
        page3 = ctx3.new_page()
        page3.on('pageerror', lambda e: errors.append(str(e)))
        goto_ready(page3, BASE + '/' + broken)
        expect(page3.locator('h1')).to_have_text('Cloudonym')
        expect(page3.locator('#field-owner')).to_have_value('platform')
        expect(page3.locator('[data-pick-cloud]')).to_be_visible()
        # 깨진 hash 는 기본 상태의 hash 로 바뀐다 — 다시 공유해도 깨진 값이 퍼지지 않는다
        assert hash_state(page3.evaluate('location.hash')) == {'owner': 'platform', 'system': 'billing', 'purpose': 'trade', 'env': 'prd', 'region': 'kr', 'v': RULES}, page3.evaluate('location.hash')
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
    assert "  # INVALID: azure_virtual_machine_01 — Required token 'system' is empty after normalisation\n" in hcl_bad, hcl_bad
    assert 'azure_virtual_machine_01 =' not in hcl_bad
    page.click('[data-copy="names-json"]')
    bad = json.loads(page.evaluate('navigator.clipboard.readText()'))
    assert bad['names'] == [] and {'key': 'virtual_machine_01', 'codes': ['name.token_empty']} in bad['invalid'], bad
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
    h = row(page, 'storage_account').evaluate('e => e.getBoundingClientRect().height')
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
    expect(page4.locator(f'{VM1} [data-name]')).to_have_text('payments-ledger-prd-kr-vm-01')
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
    old_hash = state_hash(INPUT, OLD_RULES, 'azure', {'virtual_machine': 2, 'resource_group': 1})
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
    assert hash_state(shared) == {**INPUT, 'v': RULES, 'p': 'azure', 'r': {'resource_group': 1, 'virtual_machine': 2}}, hash_state(shared)
    assert page8.evaluate('location.hash') == old_hash, '공유 버튼이 주소창의 옛 v 를 바꾸면 안 된다'
    # 선택을 바꿔도 링크의 옛 v 를 버린다
    row(page8, 'virtual_machine').locator('[data-inc]').click()
    expect(notice).to_have_count(0)
    page8.wait_for_function('h => location.hash !== h', arg=old_hash)
    assert hash_state(page8.url) == {**INPUT, 'v': RULES, 'p': 'azure', 'r': {'resource_group': 1, 'virtual_machine': 3}}, hash_state(page8.url)

    # ── ⑼ 같은 탭에서 옛 v hash 로 이동 → 안내가 보이고 폼이 따라온다 · 폼을 고치면 안내가 사라진다 ──
    other_old = state_hash(OTHER, OLD_RULES)
    page8.evaluate('h => { location.hash = h; }', other_old)
    expect(notice).to_be_visible()
    for key, val in OTHER.items():
        expect(page8.locator(f'#field-{key}')).to_have_value(val)
    page8.wait_for_timeout(300)
    assert page8.evaluate('location.hash') == other_old, page8.evaluate('location.hash')
    page8.fill('#field-purpose', 'ledger')
    expect(notice).to_have_count(0)

    # ── ⒁ 옛 링크(다섯 키만) → 문맥이 열리고 CSP 는 고르지 않은 상태 · hash 를 덮어쓰지 않는다 ──
    v1_hash = state_hash(INPUT)
    goto_ready(page8, BASE + '/?' + v1_hash)  # 경로를 바꿔 새로 불러온다
    goto_ready(page8, BASE + '/' + v1_hash)
    for key, val in INPUT.items():
        expect(page8.locator(f'#field-{key}')).to_have_value(val)
    expect(page8.locator('[role="radio"][aria-checked="true"]')).to_have_count(0)
    expect(page8.locator('[data-pick-cloud]')).to_be_visible()
    page8.wait_for_timeout(300)
    assert page8.evaluate('location.hash') == v1_hash, page8.evaluate('location.hash')

    # ── ⒂ 모르는 type · 종류가 안 맞는 값이 든 링크 → 그 항목만 버리고 한 줄 안내 ──
    odd = state_hash(INPUT, RULES, 'azure', {'no_such_type': 1, 'virtual_machine': 2, 'managed_identity': 1})
    goto_ready(page8, BASE + '/?x' + odd)
    goto_ready(page8, BASE + '/' + odd)
    expect(page8.locator('[data-selection-dropped]')).to_have_text('This link had 2 resource selections that do not fit the current rules or limits; they were left out.')
    expect(page8.locator('article[data-key]')).to_have_count(2)
    expect(page8.locator('[data-selected-count]')).to_have_text('1 selected')
    row(page8, 'key_vault').locator('input[data-row-check]').check()  # 사용자가 선택을 바꾸면 안내를 지운다
    expect(page8.locator('[data-selection-dropped]')).to_have_count(0)

    # ── ⒄ 지금 버전 링크로 연 뒤 개수 +1 → −1 — 주소창 hash 가 화면의 선택을 따라간다(링크 상태가 남아 hash 쓰기를 막으면 안 된다) ──
    linked = state_hash(INPUT, RULES, 'azure', {'virtual_machine': 2})
    goto_ready(page8, BASE + '/?y' + linked)
    goto_ready(page8, BASE + '/' + linked)
    vm8 = row(page8, 'virtual_machine')
    expect(vm8.locator('[data-count]')).to_have_text('2')
    vm8.locator('[data-inc]').click()
    expect(vm8.locator('[data-count]')).to_have_text('3')
    page8.wait_for_timeout(300)
    assert hash_state(page8.url)['r'] == {'virtual_machine': 3}, hash_state(page8.url)
    vm8.locator('[data-dec]').click()
    expect(vm8.locator('[data-count]')).to_have_text('2')
    page8.wait_for_timeout(300)
    assert hash_state(page8.url) == {**INPUT, 'v': RULES, 'p': 'azure', 'r': {'virtual_machine': 2}}, f'화면은 2 인데 주소창은 {hash_state(page8.url)}'
    ctx8.close()

    # ── ⒅ 문맥 한 칸을 비워도 주소창 hash 는 마지막 온전한 상태로 남는다 → 새로고침하면 CSP · 선택이 돌아온다 · 그동안 Share URL 은 없다 ──
    ctx18 = browser.new_context(viewport={'width': 1280, 'height': 900})
    page18 = ctx18.new_page()
    page18.on('pageerror', lambda e: errors.append(str(e)))
    full = state_hash(INPUT, RULES, 'azure', {'virtual_machine': 2})
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
    expect(page18.locator('[data-cloud="azure"]')).to_have_attribute('aria-checked', 'true')
    expect(row(page18, 'virtual_machine').locator('[data-count]')).to_have_text('2')
    expect(page18.locator('article[data-key]')).to_have_count(2)
    ctx18.close()

    # ── ⒆ 선택 상한(이름 200개)에서 ↓ 는 비활성 체크 상자를 건너뛴다 (?fixture=rules500) ──
    ctx19 = browser.new_context(viewport={'width': 1280, 'height': 900})
    page19 = ctx19.new_page()
    page19.on('pageerror', lambda e: errors.append(str(e)))
    sel200 = {f'fx500_{i:03d}': ('sync' if i % 4 == 2 else 1) for i in range(200)}  # src/dev/fixtureRules.ts 의 입력 종류 순환
    goto_ready(page19, BASE + '/?fixture=rules500' + state_hash(INPUT, RULES, 'azure', sel200))
    expect(page19.locator('[data-selected-count]')).to_have_text('200 selected')
    # 바로 다음 보이는 상자가 비활성이고 그 뒤에 활성 상자가 있는 체크된 행 — 기대값은 그 뒤 첫 활성 상자
    plan = page19.evaluate('''() => {
      const boxes = [...document.querySelectorAll('[data-tree] input[data-row-check]')].filter((b) => b.checkVisibility());
      for (let i = 0; i < boxes.length - 1; i++) {
        if (boxes[i].disabled || !boxes[i + 1].disabled) continue;
        const j = boxes.findIndex((b, k) => k > i && !b.disabled);
        if (j > 0) return { from: boxes[i].closest('[data-rule]').dataset.type, to: boxes[j].closest('[data-rule]').dataset.type, skipped: j - i - 1 };
      }
      return null;
    }''')
    assert plan and plan['skipped'] > 0, plan
    row(page19, plan['from']).locator('input[data-row-check]').focus()
    page19.keyboard.press('ArrowDown')
    assert page19.evaluate("document.activeElement.closest('[data-rule]')?.dataset.type") == plan['to'], plan
    page19.keyboard.press('ArrowUp')
    assert page19.evaluate("document.activeElement.closest('[data-rule]')?.dataset.type") == plan['from'], plan
    ctx19.close()

    # ── ⒃ 충돌 fixture(시험 전용 규칙 둘 · ?fixture=conflict) → 두 카드 FAIL · 충돌 줄 · Copy all names 의 skipped 수 (D41) ──
    ctx16 = browser.new_context(viewport={'width': 1280, 'height': 900})
    page16 = ctx16.new_page()
    page16.on('pageerror', lambda e: errors.append(str(e)))
    goto_ready(page16, BASE + '/?fixture=conflict' + state_hash(INPUT, RULES, 'azure', {'test_conflict_a': 1, 'test_conflict_b': 1, 'key_vault': 1}))
    for k in ('test_conflict_a_01', 'test_conflict_b_01'):
        card = page16.locator(f'article[data-key="{k}"]')
        expect(card).to_have_attribute('data-valid', 'false')
        expect(card.locator('[data-violations]')).to_contain_text('is used by more than one resource of the same kind')
    expect(page16.locator('article[data-key="key_vault"]')).to_have_attribute('data-valid', 'true')
    expect(page16.locator('[data-conflicts] li')).to_have_count(1)
    expect(page16.locator('[data-conflicts]')).to_contain_text('Name conflict — Name ')
    expect(page16.locator('[data-copy="all-names"]')).to_have_text('Copy all names · 2 invalid skipped')
    expect(page16.locator('[data-names-summary]')).to_have_text('3 resources · 3 names · 1/3 PASS')
    ctx16.close()
    browser.close()

    assert errors == [], errors
    print('OK — 시나리오 ⑴~⒆ 통과 · 비콘', sent, '· 스크린샷', sorted(p.name for p in OUT.glob('*.png')))
