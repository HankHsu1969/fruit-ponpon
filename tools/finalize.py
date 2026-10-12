import sys, json, shutil, os
from PIL import Image
sp, prj = sys.argv[1], sys.argv[2]
os.makedirs(f"{prj}/assets/fruits", exist_ok=True)
for n in ("bg_day", "bg_night"):
    im = Image.open(f"{sp}/raw/{n}.png").convert("RGB")
    im = im.resize((1920, round(im.height * 1920 / im.width)), Image.LANCZOS)
    im.save(f"{prj}/assets/{n}.jpg", quality=86, optimize=True, progressive=True)
for i in range(11):
    shutil.copy(f"{sp}/out/fruits/{i}.png", f"{prj}/assets/fruits/{i}.png")
shutil.copy(f"{sp}/out/mascot.png", f"{prj}/assets/mascot.png")
fav = Image.open(f"{sp}/out/fruits/10.png").convert("RGBA")
fav.thumbnail((128, 128), Image.LANCZOS)
fav.save(f"{prj}/assets/icon.png", optimize=True)
fm = json.load(open(f"{sp}/out/fruit_meta.json"))
mm = json.load(open(f"{sp}/out/mascot_meta.json"))
js = ("/* 自動產生：素材尺寸與水果本體圓心/半徑（像素） */\n"
      "window.SPRITE_META = " + json.dumps({"fruits": fm, "mascot": mm}) + ";\n")
open(f"{prj}/js/assets.js", "w", encoding="utf-8").write(js)
print("done")
