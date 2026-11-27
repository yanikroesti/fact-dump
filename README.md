# dump/

**dump.yanikroesti.ch** — the junk drawer of yanikroesti.ch.

Little projects, research rabbit holes, school packs, tools, games and half-serious
experiments. Everything ends up here. 33 pages and counting.

## Structure

```
index.html      the overview page (vanilla HTML/CSS/JS, no build step)
artifacts/      one self-contained HTML page per project
thumbs/         preview screenshots (dark) — thumbs/light/ for the light theme
tools/thumbs.py captures missing screenshots (Playwright + Pillow)
CNAME           custom-domain binding for static hosting
```

Categories: **research · learning · tools · games · concepts**. The project list has four
views (index, grid, split, visual list); sorting **by category** switches to category shelves.
Light theme = cream paper with yellow highlighter, dark theme = black with lime; toggle in
the header, the choice is remembered per browser.

To add a page: drop the HTML file into `artifacts/`, add one entry to the `PAGES` array in
`index.html`, then run `python tools/thumbs.py` to capture its preview (dark + light).

Shortcut cards behind a login carry `data-manual`: `thumbs.py` skips them, because it would only see the
login screen. Their screenshots come from the session that owns the app (signed in, sample data, nothing
personal) as `<slug>.png` / `<slug>.light.png` and are converted with `python tools/thumbs.py --import <folder>`.

## Satellites

- [note.yanikroesti.com](https://note.yanikroesti.com) — NoteBox, moved to its own subdomain ([repo](https://github.com/yanikroesti/notebox))

---

Curated by Yanik Rösti. Redesign, motion & taxonomy by **Claude** (Fable 5, Anthropic) — 08.2026.
