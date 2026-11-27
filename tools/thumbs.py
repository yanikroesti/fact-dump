"""Capture preview thumbnails for dump/.

Reads every project link (`f:` / `"f":`) and every shortcut link
(`data-shot="..."`) from index.html, screenshots each page at 1280x800 and
stores a 640x400 WebP in thumbs/<slug>.webp (dark colour scheme) and
thumbs/light/<slug>.webp (light colour scheme, used by the light theme). Local pages are served from this
repo, external ones (schule.yanikroesti.ch …) are fetched live.

    python tools/thumbs.py            # only missing thumbnails
    python tools/thumbs.py --all      # re-capture everything
    python tools/thumbs.py chess      # only slugs containing "chess"
    python tools/thumbs.py --import DIR
        # login-only shortcuts (data-manual): turn hand-made shots
        # DIR/<slug>.png (dark) and DIR/<slug>.light.png into thumbnails

Shortcut cards marked `data-manual` sit behind a login, so a capture here
would only show the login screen. Their screenshots come from the session
that owns the app (signed in, sample data, nothing personal) and are never
overwritten by a normal run.

Needs: pip install playwright pillow && python -m playwright install chromium
The slug rule must match thumbSlug() in index.html.
"""
import functools
import http.server
import io
import re
import sys
import threading
from pathlib import Path
from urllib.parse import quote

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "thumbs"
PORT = 4471


def slug(f: str) -> str:
    f = f.split("?")[0].split("#")[0].rstrip("/")
    last = f.split("/")[-1]
    last = re.sub(r"\.html?$", "", last, flags=re.I)
    s = re.sub(r"[^a-z0-9]+", "-", last.lower()).strip("-")
    return s or "page"


def targets():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    seen, out = set(), []
    for m in re.finditer(r'"?\bf"?\s*:\s*"([^"]+)"', html):
        out.append(m.group(1))
    for m in re.finditer(r'data-shot="([^"]+)"', html):
        out.append(m.group(1))
    shots = set(m.group(1) for m in re.finditer(r'data-shot="([^"]+)"', html))
    manual = set(m.group(1) for m in re.finditer(r'data-shot="([^"]+)"[^>]*\bdata-manual\b', html))
    res = []
    for f in out:
        s = slug(f)
        if s in seen or f in manual:
            continue
        seen.add(s)
        res.append((s, f, f in shots))
    return res


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def save_thumb(img, path):
    img = img.convert("RGB")
    w, h = img.size
    if abs(w / h - 1.6) > 0.01:          # crop to 16:10 from the top
        if w / h > 1.6:
            nw = round(h * 1.6)
            img = img.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
        else:
            img = img.crop((0, 0, w, round(w / 1.6)))
    img = img.resize((640, 400), Image.LANCZOS)
    img.save(path, "WEBP", quality=74, method=6)


def import_dir(src: Path):
    for f in sorted(src.iterdir()):
        m = re.fullmatch(r"([a-z0-9-]+)(\.light)?\.(png|webp|jpe?g)", f.name, re.I)
        if not m:
            continue
        folder = OUT / "light" if m.group(2) else OUT
        folder.mkdir(parents=True, exist_ok=True)
        save_thumb(Image.open(f), folder / f"{m.group(1).lower()}.webp")
        print("ok  ", "light" if m.group(2) else "dark", m.group(1))


def main():
    if "--import" in sys.argv:
        import_dir(Path(sys.argv[sys.argv.index("--import") + 1]))
        return
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    redo = "--all" in sys.argv
    OUT.mkdir(exist_ok=True)
    srv = http.server.ThreadingHTTPServer(
        ("127.0.0.1", PORT), functools.partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    todo = []
    for scheme, folder in (("dark", OUT), ("light", OUT / "light")):
        folder.mkdir(parents=True, exist_ok=True)
        for s, f, shot in targets():
            if args and not any(a in s for a in args):
                continue
            if not redo and not args and (folder / f"{s}.webp").exists():
                continue
            todo.append((scheme, folder, s, f, shot))
    print(f"{len(todo)} to capture")

    with sync_playwright() as p:
        br = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl"])
        for scheme, folder, s, f, shot in todo:
            # shortcut cards are mostly small login forms: a narrower window
            # makes them readable at card size
            vw, vh = (960, 600) if shot else (1280, 800)
            ctx = br.new_context(viewport={"width": vw, "height": vh},
                                 device_scale_factor=1, color_scheme=scheme,
                                 locale="de-CH")
            url = f if f.startswith("http") else f"http://127.0.0.1:{PORT}/{quote(f)}"
            page = ctx.new_page()
            page.on("dialog", lambda d: d.dismiss())
            try:
                page.goto(url, wait_until="load", timeout=30000)
                try:
                    page.wait_for_load_state("networkidle", timeout=8000)
                except Exception:
                    pass
                page.wait_for_timeout(2200)
                png = page.screenshot(type="png")
                save_thumb(Image.open(io.BytesIO(png)), folder / f"{s}.webp")
                print("ok  ", scheme, s)
            except Exception as e:
                print("FAIL", scheme, s, str(e).splitlines()[0][:120])
            finally:
                ctx.close()
        br.close()
    srv.shutdown()


if __name__ == "__main__":
    main()
