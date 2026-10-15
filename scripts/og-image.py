"""공유 미리보기 그림 public/og-image.png (1200×630) — og:image · twitter:image 가 가리킨다.

예시 값과 이름은 src/components/introExamples.json(엔진이 빌드 때 만든 것)에서 읽는다 — 손으로 이름을 적지 않는다.
예시 값이 바뀌면 이 스크립트를 다시 돌려 그림을 새로 찍는다. src/api/og-image.test.ts 가 그림 크기와
그림을 찍은 예시가 지금 JSON 과 같은지(scripts/og-image.json — public 에 두면 사이트에 실린다) 본다.

쓰는 법(저장소 뿌리에서):
  uv run --python 3.12 --with "playwright==1.63.0" python scripts/og-image.py
"""

import base64
import html
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
EXAMPLE = ROOT / "src/components/introExamples.json"
OUT_PNG = ROOT / "public/og-image.png"
OUT_STAMP = ROOT / "scripts/og-image.json"
MARK = ROOT / "public/favicon.svg"  # 제품 표시 — 파비콘 · 머리글과 같은 파일

TAGLINE = "Google Cloud resource names that pass the official naming rules"
FOOT = "Web tool · JSON API · llms.txt · Apache-2.0"


def page(example: dict) -> str:
    chips = "".join(f'<span class="chip">{html.escape(v)}</span>' for v in example["input"])
    rows = "".join(
        f'<div class="row"><span class="label">{html.escape(r["label"])}</span>'
        f'<code>{html.escape(r["name"])}</code><span class="pass">PASS</span></div>'
        for r in example["rows"]
    )
    mark = base64.b64encode(MARK.read_bytes()).decode()
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
* {{ box-sizing: border-box; margin: 0; }}
body {{ width: 1200px; height: 630px; font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
  background: linear-gradient(135deg, #eef2ff 0%, #ffffff 55%, #f4f4f5 100%); color: #18181b;
  padding: 64px 72px; display: flex; flex-direction: column; }}
.brand {{ display: flex; align-items: center; gap: 24px; }}
.brand img {{ width: 88px; height: 88px; }}
h1 {{ font-size: 76px; font-weight: 800; letter-spacing: -2px; color: #312e81; }}
.tag {{ margin-top: 12px; font-size: 32px; color: #3f3f46; }}
.card {{ margin-top: 40px; background: #fff; border: 1px solid #e4e4e7; border-radius: 20px;
  padding: 28px 32px; box-shadow: 0 10px 30px rgba(49, 46, 129, .08); }}
.in {{ display: flex; gap: 10px; align-items: center; font-size: 22px; color: #52525b; }}
.chip {{ font-family: ui-monospace, Menlo, monospace; background: #eef2ff; color: #3730a3;
  border-radius: 8px; padding: 4px 12px; }}
.arrow {{ color: #a1a1aa; margin: 0 4px; }}
.row {{ display: grid; grid-template-columns: 290px 1fr auto; align-items: center; margin-top: 16px; font-size: 24px; }}
.label {{ color: #52525b; }}
code {{ font-family: ui-monospace, Menlo, monospace; font-size: 26px; color: #18181b; }}
.pass {{ font-size: 18px; font-weight: 700; color: #166534; background: #dcfce7; border-radius: 999px; padding: 4px 14px; }}
.foot {{ margin-top: auto; font-size: 22px; color: #71717a; }}
</style></head><body>
<div class="brand"><img src="data:image/svg+xml;base64,{mark}" alt=""><h1>Cloudonym</h1></div>
<p class="tag">{html.escape(TAGLINE)}</p>
<div class="card"><div class="in">{chips}<span class="arrow">→</span></div>{rows}</div>
<p class="foot">{html.escape(FOOT)}</p>
</body></html>"""


def main() -> None:
    example = json.loads(EXAMPLE.read_text(encoding="utf-8"))
    if any(r.get("valid") is not True for r in example["rows"]):
        raise SystemExit("og-image: example has a name that is not valid")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        tab = browser.new_page(viewport={"width": 1200, "height": 630}, device_scale_factor=1)
        tab.set_content(page(example))
        tab.screenshot(path=str(OUT_PNG), full_page=False)
        browser.close()
    stamp = {"input": example["input"], "names": [r["name"] for r in example["rows"]]}
    OUT_STAMP.write_text(json.dumps(stamp, indent=2) + "\n", encoding="utf-8")
    print(f"og-image: wrote {OUT_PNG.relative_to(ROOT)} and {OUT_STAMP.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
