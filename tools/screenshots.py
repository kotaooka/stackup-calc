# README 用スクリーンショット（docs/images/*.png）を撮り直す
#
# Google Fonts が読めない環境で撮ると日本語フォントが当たらず、中国語字形などの代替フォントで写る。
# これを防ぐため、Google Fonts への要求を fontsource のローカルファイルに差し替え、
# 読み込みを確認してから撮影する（読めていなければ中断）。
#
# 準備（任意の作業フォルダで）:
#   npm pack @fontsource/biz-udpgothic @fontsource/ibm-plex-mono
#   上の2つの .tgz を展開（tar -xzf <ファイル> --one-top-level）
#   pip install playwright && python -m playwright install chromium
# 実行（先に python tools/build.py で docs/index.html を作っておく）:
#   python tools/screenshots.py <フォント展開先フォルダ>
#   （Chromium の場所を指定する場合は環境変数 CHROME_PATH）
import os, pathlib, sys
from playwright.sync_api import sync_playwright

REPO = pathlib.Path(__file__).resolve().parent.parent
FONTS = pathlib.Path(sys.argv[1])
OUT = REPO / "docs/images"
OUT.mkdir(parents=True, exist_ok=True)

PKGS = {
    "biz": ("biz-udpgothic", ["400", "700"]),
    "mono": ("ibm-plex-mono", ["500"]),
}
DIRS, CSS = {}, ""
for tag, (name, weights) in PKGS.items():
    files = next(FONTS.glob(f"fontsource-{name}-*/package/files"))
    DIRS[tag] = files
    for w in weights:
        CSS += (files.parent / f"{w}.css").read_text(encoding="utf-8").replace("./files/", f"https://fonts.gstatic.com/local/{tag}/")


# Google Fonts の CSS を fontsource の CSS（unicode-range 分割済み）に差し替え、ローカルのファイルを返す
def route_fonts(route):
    url = route.request.url
    if "fonts.googleapis.com" in url:
        route.fulfill(status=200, content_type="text/css", body=CSS)
    elif "fonts.gstatic.com/local/" in url:
        tag, name = url.split("/local/", 1)[1].split("/", 1)
        ctype = "font/woff2" if name.endswith("woff2") else "font/woff"
        route.fulfill(status=200, content_type=ctype, body=(DIRS[tag] / name).read_bytes(),
                      headers={"Access-Control-Allow-Origin": "*"})
    else:
        route.continue_()


def settle(p):
    # モンテカルロ（別スレッド）の計算が終わるのを待つ
    p.wait_for_function("!document.querySelector('.pending')", timeout=60000)
    p.wait_for_timeout(400)
    p.evaluate("document.fonts.ready")


def shot(p, selector, name):
    el = p.locator(selector).first
    el.scroll_into_view_if_needed()
    settle(p)
    el.screenshot(path=str(OUT / name))


with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None)
    # 毎回新しい状態（保存された入力なし＝例題）で開く。ダーク・1440×900・1.5 倍
    c = b.new_context(service_workers="block", viewport={"width": 1440, "height": 900},
                      device_scale_factor=1.5, color_scheme="dark")
    p = c.new_page()
    p.route("**/*", route_fonts)
    p.goto((REPO / "docs/index.html").as_uri())
    p.wait_for_load_state("networkidle")
    ok = p.evaluate("""async () => { await document.fonts.ready;
        return [document.fonts.check("15px 'BIZ UDPGothic'", "寄与項目"),
                document.fonts.check("500 15px 'IBM Plex Mono'", "0.05")]; }""")
    assert all(ok), f"フォント未読込: {ok}"
    # 部分撮影に固定ヘッダーが写り込まないよう、全体を撮ったあとは固定を外す
    settle(p)
    p.screenshot(path=str(OUT / "overview.png"))
    p.add_style_tag(content="header.top{position:static!important}")

    shot(p, "#sec-bfig", "block.png")
    shot(p, "#sec-dfig0", "dist.png")
    shot(p, "#sec-contrib", "contrib.png")
    shot(p, "#sec-alloc", "alloc.png")

    # ケースの比較：例題を「対策前」で保存し、締結の遊び（穴 +0.05→+0.02、軸 −0.05→−0.02）を詰めて「対策後」を保存
    p.fill("#caseName", "対策前")
    p.click("#caseSave")
    for k, v in (("hup", "0.02"), ("flo", "-0.02")):
        inp = p.locator("#items .it").nth(5).locator(f"input[data-k='{k}']")
        inp.fill(v)
        inp.dispatch_event("input")
        inp.dispatch_event("change")
    settle(p)
    p.fill("#caseName", "対策後（遊びを詰める）")
    p.click("#caseSave")
    shot(p, "#sec-cases", "cases.png")

    # 2次元ベクトルループ（例題）
    p.click("#tab2d")
    shot(p, "#sec-vfig", "vecfig.png")
    c.close()
    b.close()
print("docs/images/*.png を書き出した")
