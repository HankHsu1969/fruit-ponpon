import sys, json
import numpy as np
from PIL import Image
from scipy import ndimage
d = sys.argv[1]
CUT = int(sys.argv[2])
im = Image.open(f"{d}/mascot_full.png").convert("RGBA")
a = np.asarray(im)
ys, xs = np.nonzero(a[..., 3] > 128)
x0, y0 = xs.min(), ys.min()
crop = a[y0:y0 + CUT, x0:xs.max() + 1].copy().astype(np.float32)
rgb = crop[..., :3]; al = crop[..., 3] / 255.0
mn = rgb.min(axis=2); mx = rgb.max(axis=2)
# 剩下被籃子提把圍住的白色區域：現在碰到底邊了，再 flood-fill 一次
near_white = (al > 0.5) & (mn >= 222) & ((mx - mn) <= 30)
lab, n = ndimage.label(near_white)
bottom_ids = np.unique(lab[-1, :][lab[-1, :] > 0])
bg = np.isin(lab, bottom_ids)
band = ndimage.binary_dilation(bg, iterations=3) & ~bg & (al > 0)
al[bg] = 0
ab = np.clip((255.0 - mn) / (255.0 - 45.0), 0, 1)
al[band] = np.minimum(al[band], ab[band])
# 移除提把殘段：只保留最大的連通區塊
fg = al > 0.05
flab, fn = ndimage.label(fg)
sizes = ndimage.sum(fg, flab, range(1, fn + 1))
keep = flab == (1 + int(np.argmax(sizes)))
al[~keep] = 0
a3 = al[..., None]
F = np.where(a3 > 0.05, (rgb - (1 - a3) * 255.0) / np.maximum(a3, 1e-3), rgb)
out = np.dstack([np.clip(F, 0, 255), al * 255]).astype(np.uint8)
img = Image.fromarray(out)
bb = img.getbbox(); img = img.crop(bb)
H = 300; s = H / img.height
img = img.resize((round(img.width * s), H), Image.LANCZOS)
img.save(f"{d}/mascot.png", optimize=True)
# 腳的位置（抓水果的點）
al2 = np.asarray(img)[..., 3] > 128
rows = np.nonzero(al2.any(axis=1))[0]
yb = rows[-1]
band_rows = al2[max(0, yb - 12):yb + 1]
xs2 = np.nonzero(band_rows.any(axis=0))[0]
meta = dict(w=img.width, h=img.height, hx=round(float((xs2.min() + xs2.max()) / 2), 1), hy=float(yb))
json.dump(meta, open(f"{d}/mascot_meta.json", "w"))
print(meta)
bg = Image.new("RGBA", img.size, (60, 90, 140, 255)); bg.alpha_composite(img); bg.save(f"{d}/mascot_preview.png")
