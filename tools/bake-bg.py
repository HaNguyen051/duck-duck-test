#!/usr/bin/env python3
"""Nướng nền ao từ gói art "duck background" thành MỘT ảnh (images-bg/bg.webp).

Nguồn (không commit): ~/Downloads/duck background/
  download assets/bg/final-bg.png            tranh vòm cây 2912×1632 (AI)
  download assets/water/3-bg layer set/*.png  ảnh mặt nước Midjourney phủ 4 lần (soft light, hue, luminosity ×2), đã có mask
  download assets/water/1-bg-shade set 1/*.png 5 lớp tô tay (hard light, overlay ×2, color burn, screen) — PSD bật nhóm này HAI lần
Thứ tự và chế độ hoà trộn chép đúng từ bg-working file.psd (đọc bằng psd-tools, xem CLAUDE.md). Opacity lớp đã
được Photoshop nướng vào alpha của PNG xuất nên ở đây ghép ở 100 %. Hoà trộn trên giá trị sRGB (Photoshop mặc
định không bật "Blend RGB colors using gamma 1.0"), công thức theo W3C compositing-1 — chính là công thức Photoshop.

Dùng:  python3 tools/bake-bg.py "~/Downloads/duck background" images-bg/bg.webp [--size 2560x1440] [--check]
  --check: so với bản hợp nhất PSD (cần psd-tools) ở 1920×1080, in sai số trung bình.
"""
import argparse, os, sys, time
import numpy as np
from PIL import Image

# vị trí tranh trong PSD: smart object final-bg đặt scale 0,7552 lệch (−183, −152) → canvas 1920×1080 dùng vùng nguồn này
PAINT_SCALE, PAINT_OX, PAINT_OY = 2199 / 2912, -183, -152

def lum(c): return 0.3 * c[..., 0] + 0.59 * c[..., 1] + 0.11 * c[..., 2]
def clipcolor(c):
    l = lum(c)[..., None]; n = c.min(-1, keepdims=True); x = c.max(-1, keepdims=True)
    c = np.where(n < 0, l + (c - l) * l / np.maximum(l - n, 1e-6), c)
    c = np.where(x > 1, l + (c - l) * (1 - l) / np.maximum(x - l, 1e-6), c)
    return c
def setlum(c, l): return clipcolor(c + (l - lum(c))[..., None])
def sat(c): return c.max(-1) - c.min(-1)
def setsat(c, s):
    mx = c.max(-1, keepdims=True); mn = c.min(-1, keepdims=True); rng = mx - mn
    return np.where(rng > 1e-6, (c - mn) * s[..., None] / np.maximum(rng, 1e-6), 0.0)

def multiply(b, s): return b * s
def screen(b, s): return b + s - b * s
def hardlight(b, s): return np.where(s <= 0.5, multiply(b, 2 * s), screen(b, 2 * s - 1))
def overlay(b, s): return hardlight(s, b)
def colorburn(b, s):
    r = 1 - np.minimum(1, (1 - b) / np.maximum(s, 1e-6))
    r = np.where(s <= 0, 0.0, r)
    return np.where(b >= 1, 1.0, r)
def softlight(b, s):
    D = np.where(b <= 0.25, ((16 * b - 12) * b + 4) * b, np.sqrt(np.maximum(b, 0)))
    return np.where(s <= 0.5, b - (1 - 2 * s) * b * (1 - b), b + (2 * s - 1) * (D - b))
def hue(b, s): return setlum(setsat(s, sat(b)), lum(b))
def luminosity(b, s): return setlum(b, lum(s))
MODES = dict(multiply=multiply, screen=screen, hardlight=hardlight, overlay=overlay, colorburn=colorburn,
             softlight=softlight, hue=hue, luminosity=luminosity)

# (thư mục, file, chế độ) theo thứ tự vẽ từ DƯỚI lên, đúng như trong PSD
WATER = 'download assets/water/3-bg layer set/'
SHADE = 'download assets/water/1-bg-shade set 1/'
STACK = [
    (WATER, 'luminousity-100-100-4.png', 'luminosity'),
    (WATER, 'luminousity-100-100-3.png', 'luminosity'),
    (WATER, 'hue-100-100-2.png', 'hue'),
    (WATER, 'softlight-100-100-1.png', 'softlight'),
] + 2 * [
    (SHADE, '5-screen.png', 'screen'),
    (SHADE, '4-colorburn.png', 'colorburn'),
    (SHADE, '3-overlay.png', 'overlay'),
    (SHADE, '2-overlay.png', 'overlay'),
    (SHADE, '1-hardlight.png', 'hardlight'),
]

def bake(src, W, H):
    paint = Image.open(os.path.join(src, 'download assets/bg/final-bg.png')).convert('RGB')
    box = ((-PAINT_OX) / PAINT_SCALE, (-PAINT_OY) / PAINT_SCALE, (1920 - PAINT_OX) / PAINT_SCALE, (1080 - PAINT_OY) / PAINT_SCALE)
    base = np.asarray(paint.resize((W, H), Image.LANCZOS, box=box), dtype=np.float32) / 255
    for folder, name, mode in STACK:
        layer = Image.open(os.path.join(src, folder, name)).convert('RGBA')
        if layer.size != (W, H): layer = layer.resize((W, H), Image.BILINEAR)
        la = np.asarray(layer, dtype=np.float32) / 255
        s, a = la[..., :3], la[..., 3:4]
        base = base * (1 - a) + MODES[mode](base, s) * a
        print(f'  {mode:11s} {name}')
    return np.clip(base, 0, 1)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('out')
    ap.add_argument('--size', default='2560x1440'); ap.add_argument('--quality', type=int, default=88)
    ap.add_argument('--check', action='store_true')
    a = ap.parse_args()
    src = os.path.expanduser(a.src); W, H = map(int, a.size.lower().split('x'))
    t = time.time()
    img = bake(src, W, H)
    out = Image.fromarray((img * 255 + 0.5).astype(np.uint8))
    os.makedirs(os.path.dirname(a.out) or '.', exist_ok=True)
    out.save(a.out, quality=a.quality, method=6)
    print(f'ghi {a.out} {W}x{H} {os.path.getsize(a.out) / 1024:.0f} KB ({time.time() - t:.1f}s)')
    if a.check:
        from psd_tools import PSDImage
        psd = PSDImage.open(os.path.join(src, 'bg-working file.psd'))
        ref = psd.composite(layer_filter=lambda l: l.is_visible() and not l.name.startswith('Screenshot')).convert('RGB')
        mine = bake(src, 1920, 1080)
        r = np.asarray(ref, dtype=np.float32) / 255
        d = np.abs(mine - r)
        print(f'so với PSD (1920×1080): sai số trung bình {d.mean() * 255:.2f}/255, phân vị 99 {np.percentile(d, 99) * 255:.1f}/255, max {d.max() * 255:.0f}/255')
        ref.save(os.path.join(os.path.dirname(a.out) or '.', 'check-psd.png'))
        Image.fromarray((mine * 255 + 0.5).astype(np.uint8)).save(os.path.join(os.path.dirname(a.out) or '.', 'check-bake.png'))

if __name__ == '__main__':
    main()
