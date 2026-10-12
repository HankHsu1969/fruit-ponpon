"""白底去背：從邊界 flood-fill 近白色區域，邊緣做反預乘抗鋸齒。"""
import sys, json
import numpy as np
from PIL import Image
from scipy import ndimage

def cutout(path):
    im = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    mn = im.min(axis=2); mx = im.max(axis=2)
    near_white = (mn >= 226) & ((mx - mn) <= 28)
    lab, n = ndimage.label(near_white)
    border = np.concatenate([lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]])
    bg_ids = np.unique(border[border > 0])
    bg = np.isin(lab, bg_ids)
    band = ndimage.binary_dilation(bg, iterations=3) & ~bg
    alpha = np.where(bg, 0.0, 1.0)
    a_band = np.clip((255.0 - mn) / (255.0 - 45.0), 0, 1)
    alpha[band] = a_band[band]
    # 只保留主要物件（去掉零星雜點）
    fg = alpha > 0.02
    flab, fn = ndimage.label(fg)
    if fn > 1:
        sizes = ndimage.sum(fg, flab, range(1, fn + 1))
        keep = np.isin(flab, 1 + np.nonzero(sizes >= sizes.max() * 0.01)[0])
        alpha[~keep] = 0
    # 反預乘：C = a*F + (1-a)*255
    a3 = alpha[..., None]
    F = np.where(a3 > 0.05, (im - (1 - a3) * 255.0) / np.maximum(a3, 1e-3), im)
    F = np.clip(F, 0, 255)
    out = np.dstack([F, alpha * 255.0]).astype(np.uint8)
    return out

def body_circle(rgba):
    """用形態學開運算削掉葉子、梗、鱗片等細長突出物，再用面積與重心求本體圓。"""
    a = rgba[..., 3] > 128
    rough = np.sqrt(a.sum() / np.pi)
    k = 0.16 * rough
    eroded = ndimage.distance_transform_edt(a) > k
    opened = ndimage.distance_transform_edt(~eroded) <= k
    ys, xs = np.nonzero(opened)
    r = np.sqrt(opened.sum() / np.pi)
    return xs.mean(), ys.mean(), r, 0.0, 0.0

if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    R = [24, 31, 37, 43, 51, 58, 68, 80, 93, 110, 132]
    meta = []
    for i in range(11):
        rgba = cutout(f"{src}/{i}.png")
        cx, cy, r, cy_eq, cy_bot = body_circle(rgba)
        a = rgba[..., 3] > 8
        ys, xs = np.nonzero(a)
        x0 = min(xs.min(), cx - r) - 6; x1 = max(xs.max(), cx + r) + 6
        y0 = min(ys.min(), cy - r) - 6; y1 = max(ys.max(), cy + r) + 6
        x0, y0 = int(np.floor(x0)), int(np.floor(y0)); x1, y1 = int(np.ceil(x1)), int(np.ceil(y1))
        img = Image.fromarray(rgba).crop((x0, y0, x1, y1))
        target_r = min(260, max(96, R[i] * 2.2))
        s = target_r / r
        W, H = round(img.width * s), round(img.height * s)
        img = img.resize((W, H), Image.LANCZOS)
        img.save(f"{dst}/fruits/{i}.png", optimize=True)
        m = dict(w=W, h=H, cx=round((cx - x0) * s, 2), cy=round((cy - y0) * s, 2), r=round(r * s, 2))
        meta.append(m)
        print(i, m, "cy_eq-cy_bot=%.1f" % (cy_eq - cy_bot))
    with open(f"{dst}/fruit_meta.json", "w") as f:
        json.dump(meta, f)
    rgba = cutout(f"{src}/mascot.png")
    Image.fromarray(rgba).save(f"{dst}/mascot_full.png")
