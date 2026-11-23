#!/usr/bin/env python3
"""生成 grepo 的工具栏图标。

几何取自页面内的 .brand-logo-mark（viewBox 0 0 22 22）：
  圆角方块 + 三条白色横线 + 右下圆点。
方块用墨黑，圆点用钴蓝 —— 与页面标记同源，黑色为主、蓝色保留。

用法：/usr/bin/python3 scripts/make-icons.py
"""

from PIL import Image, ImageDraw
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "extension", "assets", "icons")

INK = (23, 24, 26, 255)        # --text
BLUE = (31, 78, 216, 255)      # --accent
WHITE = (255, 255, 255, 255)

SS = 16  # 超采样倍数

# viewBox 内的几何（单位 = 22 分之一定位）
VB = 22.0
RECT = (1.0, 1.0, 21.0, 21.0)   # x0, y0, x1, y1
RADIUS = 5.5
RULES = [
    (6.0, 7.1, 16.0, 7.1),
    (6.0, 11.0, 16.0, 11.0),
    (6.0, 14.9, 11.4, 14.9),
]
# 16px 下三条线会糊成一团，简化成两条并加粗
RULES_SMALL = [
    (6.2, 8.0, 15.8, 8.0),
    (6.2, 14.0, 11.0, 14.0),
]
RULE_W_SMALL = 2.0
RULE_W = 1.6
DOT = (15.6, 14.9, 1.55)


def draw(size):
    px = size * SS
    k = px / VB
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def s(v):
        return v * k

    d.rounded_rectangle(
        [s(RECT[0]), s(RECT[1]), s(RECT[2]), s(RECT[3])],
        radius=s(RADIUS),
        fill=INK,
    )

    if size <= 16:
        rules, w = RULES_SMALL, RULE_W_SMALL
    else:
        rules = RULES
        w = RULE_W if size > 32 else RULE_W * 1.15

    for x0, y0, x1, y1 in rules:
        d.line(
            [s(x0), s(y0), s(x1), s(y1)],
            fill=WHITE,
            width=max(1, round(s(w))),
        )
        # 圆头
        r = s(w) / 2
        for cx, cy in ((x0, y0), (x1, y1)):
            d.ellipse([s(cx) - r, s(cy) - r, s(cx) + r, s(cy) + r], fill=WHITE)

    cx, cy, rr = DOT
    d.ellipse(
        [s(cx) - s(rr), s(cy) - s(rr), s(cx) + s(rr), s(cy) + s(rr)],
        fill=BLUE,
    )

    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    for size in (16, 32, 48, 128):
        icon = draw(size)
        path = os.path.join(OUT, f"{size}.png")
        icon.save(path, "PNG", optimize=True)
        print(f"{path}  {os.path.getsize(path)} 字节")


if __name__ == "__main__":
    main()
