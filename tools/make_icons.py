# アプリのアイコン（docs/icons/*.png）を作る。文字を使わないのでフォントは不要
#   pip install pillow
#   python tools/make_icons.py
import pathlib
from PIL import Image, ImageDraw

REPO = pathlib.Path(__file__).resolve().parent.parent
OUT = REPO / "docs/icons"
OUT.mkdir(parents=True, exist_ok=True)

ACCENT = (29, 92, 150)    # #1d5c96（QC Workbench の計算ツール共通のアクセント色）
WHITE = (255, 255, 255)
NARROW = (233, 168, 78)   # 狭める側の寸法（ダーク表示の --warn に近い色）
GAP = (87, 196, 131)      # すき間（--ok）
SS = 4                    # 縮小前の倍率（線をなめらかにするため大きく描いてから縮める）


def mix(c, t):
    """アクセント色と色 c を t の割合で混ぜる（塗りを不透明な色で作る）"""
    return tuple(round(a + (b - a) * t) for a, b in zip(ACCENT, c))


def motif(d, x0, y0, s):
    """積み上げブロック図：上段に広げる側の1本、下段に狭める側の3本とすき間"""
    lw = max(2, int(s * 0.028))
    r = s * 0.035
    h = s * 0.22
    top = y0 + s * 0.20
    bot = y0 + s * 0.52
    # 上段（広げる側）
    d.rounded_rectangle([x0, top, x0 + s, top + h], radius=r, fill=mix(WHITE, 0.22), outline=WHITE, width=lw)
    # 下段（狭める側）3本
    xs = [x0, x0 + s * 0.30, x0 + s * 0.55, x0 + s * 0.77]
    for a, b in zip(xs, xs[1:]):
        d.rounded_rectangle([a, bot, b - lw * 0.6, bot + h], radius=r, fill=mix(NARROW, 0.30), outline=NARROW, width=lw)
    # すき間（緑の破線枠）
    gx0, gx1 = xs[-1], x0 + s
    d.rectangle([gx0, bot, gx1, bot + h], fill=mix(GAP, 0.40))
    step = lw * 3
    y = bot
    while y < bot + h:
        d.line([(gx1, y), (gx1, min(y + step * 0.6, bot + h))], fill=GAP, width=lw)
        y += step
    # 規格線（上段の右端から下段まで）
    d.line([(gx1, top - s * 0.06), (gx1, bot + h + s * 0.06)], fill=WHITE, width=max(2, lw // 2))


def icon(size, maskable=False, apple=False):
    S = size * SS
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im, "RGBA")
    if maskable or apple:
        d.rectangle([0, 0, S, S], fill=ACCENT)
        pad = S * (0.20 if maskable else 0.14)
    else:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S * 0.19, fill=ACCENT)
        pad = S * 0.14
    motif(d, pad, pad, S - 2 * pad)
    return im.resize((size, size), Image.LANCZOS)


icon(192).save(OUT / "icon-192.png")
icon(512).save(OUT / "icon-512.png")
icon(512, maskable=True).save(OUT / "icon-maskable-512.png")
icon(180, apple=True).convert("RGB").save(OUT / "apple-touch-icon.png")
print("docs/icons/*.png を書き出した")
