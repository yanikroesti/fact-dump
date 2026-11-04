import * as E from "./engine.js";

const { Phase } = E;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------------------------------------------------------------- storage (this phone only)

const store = {
  get(key, def) { try { const v = localStorage.getItem(key); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch { return false; } },
};
const settings = Object.assign({ personKg: 0, vehicleKg: 0, vehicle: "Velo", autoMode: false }, store.get("et.settings", {}));
let runs = store.get("et.runs", []);
const saveSettings = () => store.set("et.settings", settings);
const saveRuns = () => { if (!store.set("et.runs", runs)) toast("Speichern im Browser nicht möglich – CSV exportieren!"); };

// ---------------------------------------------------------------- GPS

const engine = new E.RunEngine();
engine.autoMode = settings.autoMode;
const gps = { watching: false, denied: false, error: "", acc: null, alt: null, lastFix: 0, hist: [], noAlt: false };
let savedResult = null;
let screen = settings.personKg > 0 ? "tacho" : "settings";
let detailId = null, detailFresh = false, compare = [], selected = [];

function startGps() {
  if (!("geolocation" in navigator)) { gps.error = "Dieser Browser hat kein GPS."; return; }
  if (gps.watching) return;
  gps.watching = true;
  navigator.geolocation.watchPosition(onFix, (err) => {
    if (err.code === 1) { gps.denied = true; gps.watching = false; gps.error = "Standort blockiert. In den Browser-Einstellungen für diese Seite erlauben."; }
    else gps.error = "Kein GPS-Signal (" + err.message + ")";
    update();
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
}

function onFix(p) {
  const now = performance.now();
  const c = p.coords;
  const fix = { t: now, lat: c.latitude, lon: c.longitude, speed: c.speed, acc: c.accuracy };
  const kmh = E.speedKmh(fix, gps.hist);
  gps.hist.push(fix); while (gps.hist.length && now - gps.hist[0].t > 6000) gps.hist.shift();
  gps.lastFix = now; gps.acc = c.accuracy; gps.alt = c.altitude; gps.error = "";
  gps.noAlt = c.altitude == null;
  const usable = c.accuracy != null && c.accuracy <= 25;
  engine.onGps(now, usable ? kmh : null, usable ? c.altitude : null);
  update();
}

if (navigator.permissions?.query) {
  navigator.permissions.query({ name: "geolocation" }).then((s) => { if (s.state === "granted") startGps(); }).catch(() => {});
}

// ---------------------------------------------------------------- wake lock

let wake = null;
async function keepAwake(on) {
  try {
    if (on && !wake && "wakeLock" in navigator && document.visibilityState === "visible") {
      wake = await navigator.wakeLock.request("screen");
      wake.addEventListener("release", () => { wake = null; });
    } else if (!on && wake) { await wake.release(); wake = null; }
  } catch { wake = null; }
}
document.addEventListener("visibilitychange", () => update());

// ---------------------------------------------------------------- seven-segment digits (SVG)

const MASK = { 0: 0b0111111, 1: 0b0000110, 2: 0b1011011, 3: 0b1001111, 4: 0b1100110, 5: 0b1101101, 6: 0b1111101, 7: 0b0000111, 8: 0b1111111, 9: 0b1101111, "-": 0b1000000 };

function segGeometry(h) {
  const w = h * 0.5, t = h * 0.12, g = t * 0.14, ht = t / 2;
  const hs = (x0, x1, yc) => [[x0, yc], [x0 + ht, yc - ht], [x1 - ht, yc - ht], [x1, yc], [x1 - ht, yc + ht], [x0 + ht, yc + ht]];
  const vs = (xc, y0, y1) => [[xc, y0], [xc + ht, y0 + ht], [xc + ht, y1 - ht], [xc, y1], [xc - ht, y1 - ht], [xc - ht, y0 + ht]];
  return [
    hs(ht + g, w - ht - g, ht), vs(w - ht, ht + g, h / 2 - g), vs(w - ht, h / 2 + g, h - ht - g),
    hs(ht + g, w - ht - g, h - ht), vs(ht, h / 2 + g, h - ht - g), vs(ht, ht + g, h / 2 - g), hs(ht + g, w - ht - g, h / 2),
  ];
}
const GEO = segGeometry(100);
const CELL = 62;

function parseCells(text) {
  const out = [];
  for (const ch of text) {
    if (ch === "." && out.length && !out[out.length - 1].dot) out[out.length - 1].dot = true;
    else out.push({ ch, dot: false });
  }
  return out;
}

/** Calls draw(points[], on) for every segment and decimal point of `text` right-aligned in `cells`. */
function eachSegment(text, cells, h, draw) {
  const parsed = parseCells(text).slice(-cells);
  const padN = cells - parsed.length, k = h / 100, cw = CELL * k;
  for (let i = 0; i < cells; i++) {
    const c = i < padN ? { ch: " ", dot: false } : parsed[i - padN];
    const m = MASK[c.ch] ?? 0, ox = i * cw;
    GEO.forEach((poly, s) => draw(poly.map(([x, y]) => [ox + x * k + (100 - y) * 0.07 * k, y * k]), (m >> s) & 1));
    const dx = ox + 53 * k, ds = 10 * k;
    draw([[dx, h - ds], [dx + ds, h - ds], [dx + ds, h], [dx, h]], c.dot);
  }
}

function seg(text, cells, heightPx) {
  let paths = "";
  eachSegment(text, cells, 100, (pts, on) => {
    paths += `<polygon points="${pts.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ")}" fill="${on ? "var(--ink)" : "var(--ghost)"}"/>`;
  });
  const w = cells * CELL + 10;
  return `<svg class="seg" viewBox="0 0 ${w} 100" style="height:${heightPx}px;max-width:100%" role="img" aria-label="${esc(text)}">${paths}</svg>`;
}

// ---------------------------------------------------------------- math as HTML

function mathHtml(items) {
  return items.map((it) => {
    if (it.t != null) return esc(it.t);
    if (it.sub != null) return `<sub>${esc(it.sub)}</sub>`;
    if (it.frac) return `<span class="frac"><span>${mathHtml(it.frac[0])}</span><span>${mathHtml(it.frac[1])}</span></span>`;
    if (it.sqrt) return `<span class="sqrt"><span class="rad">√</span><span class="body">${mathHtml(it.sqrt)}</span></span>`;
    return "";
  }).join("");
}

// ---------------------------------------------------------------- UI helpers

const btn = (id, label, cls = "", disabled = false, style = "") =>
  `<button class="btn ${cls}" id="${id}" ${disabled ? "disabled" : ""} style="${style}"><span>${label}</span></button>`;
const brand = (right) => `<div class="brand"><span>Energie-Tacho</span><span>${esc(right)}</span></div>`;
const kv = (k, v) => `<div class="kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
const etaTxt = (e) => (e.etaPercent == null ? "–" : E.num(e.etaPercent, 1) + " %");

let toastTimer;
function toast(msg) {
  let t = $(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.append(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

function on(id, fn) { const el = document.getElementById(id); if (el) el.onclick = fn; }

// ---------------------------------------------------------------- screens

function go(s) { screen = s; render(); }

function render() {
  const app = $("#app");
  if (screen === "tacho") app.innerHTML = tachoHtml();
  else if (screen === "history") app.innerHTML = historyHtml();
  else if (screen === "detail") app.innerHTML = detailHtml();
  else if (screen === "compare") app.innerHTML = compareHtml();
  else app.innerHTML = settingsHtml();
  bind();
  update();
}

function tachoHtml() {
  return `${brand("Modell ET-1 Web")}
  ${btn("start", "Start", "go huge")}
  <div class="lcd"><div class="glass">
    <div class="status"><span class="dot" id="gdot"></span><span id="gtxt"></span><span class="right" id="mode"></span></div>
    <div class="lab">SPD km/h</div>
    <div class="big" id="spd"></div>
    <div class="row"><div><div class="lab">MAX km/h</div><div id="max"></div></div>
      <div style="text-align:right"><div class="lab">ALT m (GPS)</div><div id="alt"></div></div></div>
    <div class="row"><div><div class="lab">H1 START m</div><div id="h1"></div></div>
      <div style="text-align:right"><div class="lab">ΔH m (GPS)</div><div id="dh"></div></div></div>
    <div class="phase" id="phase"></div>
    <div id="gpsbtn"></div>
  </div></div>
  <div class="keys">${btn("auto", "", "", false, "--h:56px;--fs:15px")}${btn("hist", "Fahrten", "", false, "--h:56px;--fs:15px")}${btn("mass", "Masse", "", false, "--h:56px;--fs:15px")}</div>
  ${btn("stop", "Stop", "stop huge")}`;
}

function bind() {
  if (screen === "tacho") {
    on("start", () => { engine.start(performance.now()); update(); });
    on("stop", () => { engine.stop(performance.now()); update(); });
    on("auto", () => { settings.autoMode = engine.autoMode = !engine.autoMode; saveSettings(); update(); });
    on("hist", () => { selected = []; go("history"); });
    on("mass", () => go("settings"));
  } else if (screen === "history") {
    document.querySelectorAll("[data-open]").forEach((el) => el.onclick = () => { detailId = +el.dataset.open; detailFresh = false; go("detail"); });
    document.querySelectorAll("[data-sel]").forEach((el) => el.onclick = () => {
      const id = +el.dataset.sel;
      if (selected.includes(id)) selected = selected.filter((x) => x !== id);
      else { selected.push(id); if (selected.length > 2) selected.shift(); }
      render();
    });
    on("cmp", () => { compare = [...selected]; go("compare"); });
    on("csv", exportCsv);
    on("back", () => go("tacho"));
  } else if (screen === "detail") {
    const r = runs.find((x) => x.id === detailId);
    const upd = (k) => (ev) => { r[k] = ev.target.value; saveRuns(); };
    const veh = $("#f-veh"), note = $("#f-note");
    if (veh) veh.oninput = upd("vehicle");
    if (note) note.oninput = upd("note");
    on("share", () => shareCard(r));
    on("del", (ev) => {
      const b = ev.currentTarget;
      if (b.dataset.armed) { runs = runs.filter((x) => x.id !== detailId); saveRuns(); leaveDetail(); }
      else { b.dataset.armed = "1"; b.firstChild.textContent = "Wirklich löschen?"; }
    });
    on("back", leaveDetail);
  } else if (screen === "compare") {
    on("back", () => go("history"));
  } else {
    const p = $("#f-person"), v = $("#f-vehicle"), l = $("#f-label");
    const parse = (s) => { const n = parseFloat(String(s).replace(",", ".")); return Number.isFinite(n) ? n : null; };
    const check = () => {
      const pk = parse(p.value), vk = parse(v.value);
      $("#total").textContent = E.num((pk ?? 0) + (vk ?? 0), 1) + " kg";
      $("#save").disabled = !(pk > 0 && vk != null && vk >= 0);
    };
    p.oninput = v.oninput = check; check();
    on("save", () => {
      settings.personKg = parse(p.value); settings.vehicleKg = parse(v.value);
      settings.vehicle = l.value.trim() || "Velo"; saveSettings(); go("tacho");
    });
  }
}

function leaveDetail() {
  if (detailFresh) { engine.reset(); detailFresh = false; go("tacho"); } else go("history");
}

function historyHtml() {
  const rows = runs.map((r) => {
    const e = E.runEnergy(r), sel = selected.includes(r.id);
    return `<div class="run ${sel ? "sel" : ""}">
      <div class="info" data-open="${r.id}"><b>${E.date(r.timeMs)}  ${esc(r.vehicle)}</b>
        <div>Δh ${E.num(r.dh, 1)} m  vmax ${E.num(r.vmaxKmh, 1)} km/h  η ${etaTxt(e)}</div>
        ${r.note ? `<div class="hint">${esc(r.note)}</div>` : ""}</div>
      <button class="vgl" data-sel="${r.id}" aria-pressed="${sel}">${sel ? "■" : "□"} VGL</button></div>`;
  }).join("");
  return `${brand(`Fahrten (${runs.length})`)}
  <div class="lcd"><div class="glass">
    <div class="lab soft">Antippen = Details · VGL = für Vergleich wählen (2)</div>
    ${rows || `<div>Noch keine Fahrten gespeichert. Oben START drücken, rollen lassen, unten STOP.</div>`}
    <div class="hint" style="margin-top:auto">Fahrten sind nur in diesem Browser gespeichert. Für die Doku: CSV exportieren.</div>
  </div></div>
  <div class="keys">${btn("cmp", "Vergleich", "", selected.length !== 2)}${btn("csv", "CSV", "", !runs.length)}</div>
  ${btn("back", "Zurück")}`;
}

function detailHtml() {
  const r = runs.find((x) => x.id === detailId);
  if (!r) { queueMicrotask(leaveDetail); return ""; }
  const e = E.runEnergy(r);
  const stepsHtml = E.steps(r).map((s) => `<div class="step"><div class="lab">${esc(s.title.toUpperCase().replace("M/S", "m/s"))}</div>
    ${s.lines.map((l) => `<div class="math">${mathHtml(l)}</div>`).join("")}
    ${s.note ? `<div class="note ${s.warn ? "warn" : ""}">${esc(s.note)}</div>` : ""}</div>`).join("");
  return `${brand(detailFresh ? "Neue Fahrt gespeichert" : "Fahrt")}
  <div class="lcd"><div class="glass">
    <b>${E.date(r.timeMs)}</b>
    <div class="row">
      <div><div class="lab">MAX km/h</div>${seg(E.num(r.vmaxKmh, 1), 4, 40)}</div>
      <div><div class="lab">ΔH m GPS</div>${seg(E.num(r.dh, 1), 4, 40)}</div>
      <div><div class="lab">η %</div>${seg(e.etaPercent == null ? "---" : E.num(e.etaPercent, 1), 4, 40)}</div>
    </div>
    ${e.impossible ? `<div class="warnbox">⚠ vmax ist grösser als ohne Verluste möglich (${E.num(e.vIdealKmh, 1)} km/h). Die Höhenmessung ist falsch – Fahrt wiederholen.</div>` : ""}
    ${e.heightInvalid ? `<div class="warnbox">⚠ Δh ist 0 oder negativ – kein Gefälle gemessen. Wirkungsgrad nicht berechenbar.</div>` : ""}
    ${kv("H1 START", E.num(r.h1, 1) + " m")}${kv("H2 ENDE", E.num(r.h2, 1) + " m")}${kv("QUELLE", "GPS (gemittelt)")}
    <label class="field"><span class="lab">FAHRZEUG</span><span class="box"><input id="f-veh" value="${esc(r.vehicle)}" autocomplete="off"></span></label>
    <label class="field"><span class="lab">NOTIZ (Z.B. GEDUCKT, REIFEN 3 BAR)</span><span class="box"><input id="f-note" value="${esc(r.note || "")}" autocomplete="off"></span></label>
    <div class="lab" style="margin-top:8px;font-size:14px">BERECHNUNG</div>
    ${stepsHtml}
    <div style="margin-top:12px">${btn("del", "Löschen", "del", false, "--h:52px;--fs:15px")}</div>
  </div></div>
  <div class="keys">${btn("share", "Bild teilen", "", false, "--h:64px;--fs:15px")}${btn("back", detailFresh ? "Neue Fahrt" : "Zurück", "go", false, "--h:64px;--fs:15px")}</div>`;
}

function compareHtml() {
  const [a, b] = compare.map((id) => runs.find((r) => r.id === id));
  if (!a || !b) { queueMicrotask(() => go("history")); return ""; }
  const [r1, r2] = a.timeMs <= b.timeMs ? [a, b] : [b, a];
  const e1 = E.runEnergy(r1), e2 = E.runEnergy(r2);
  const vi = (e) => (e.vIdealKmh == null ? "–" : E.num(e.vIdealKmh, 1) + " km/h");
  const rows = [
    ["DATUM", E.date(r1.timeMs), E.date(r2.timeMs)], ["FAHRZEUG", r1.vehicle, r2.vehicle],
    ["NOTIZ", r1.note || "–", r2.note || "–"], ["MASSE", E.num(e1.massKg, 1) + " kg", E.num(e2.massKg, 1) + " kg"],
    ["ΔH", E.num(r1.dh, 2) + " m", E.num(r2.dh, 2) + " m"], ["VMAX", E.num(r1.vmaxKmh, 1) + " km/h", E.num(r2.vmaxKmh, 1) + " km/h"],
    ["EPOT", E.joule(e1.epotJ) + " J", E.joule(e2.epotJ) + " J"], ["EKIN", E.joule(e1.ekinJ) + " J", E.joule(e2.ekinJ) + " J"],
    ["η", etaTxt(e1), etaTxt(e2)], ["V IDEAL", vi(e1), vi(e2)],
  ];
  let verdict = "";
  if (e1.etaPercent != null && e2.etaPercent != null) {
    const d = e2.etaPercent - e1.etaPercent;
    verdict = `η B − η A = ${E.signed(d, 1)} Prozentpunkte${d > 0 ? " → Fahrt B war effizienter." : d < 0 ? " → Fahrt A war effizienter." : ""}`;
  }
  return `${brand("Vergleich")}
  <div class="lcd"><div class="glass">
    <table class="cmp"><thead><tr><th></th><th>FAHRT A</th><th>FAHRT B</th></tr></thead>
    <tbody>${rows.map(([k, x, y]) => `<tr><th>${k}</th><td>${esc(x)}</td><td>${esc(y)}</td></tr>`).join("")}</tbody></table>
    <b style="margin-top:8px">${esc(verdict)}</b>
  </div></div>
  ${btn("back", "Zurück")}`;
}

function settingsHtml() {
  const v = (x) => (x > 0 ? E.num(x, 1) : "");
  return `${brand("Masse & Fahrzeug")}
  <div class="lcd"><div class="glass">
    <div>Einmal wägen, hier eintragen. Wird für jede neue Fahrt gespeichert.</div>
    <label class="field"><span class="lab">PERSON (MIT KLEIDUNG, HELM)</span><span class="box"><input id="f-person" inputmode="decimal" value="${v(settings.personKg)}" autocomplete="off"><span class="unit">kg</span></span></label>
    <label class="field"><span class="lab">FAHRZEUG</span><span class="box"><input id="f-vehicle" inputmode="decimal" value="${settings.vehicleKg > 0 || settings.personKg > 0 ? E.num(settings.vehicleKg, 1) : ""}" autocomplete="off"><span class="unit">kg</span></span></label>
    <label class="field"><span class="lab">FAHRZEUG-BEZEICHNUNG</span><span class="box"><input id="f-label" value="${esc(settings.vehicle)}" autocomplete="off"></span></label>
    <div class="kv"><span>GESAMTMASSE</span><b id="total"></b></div>
    <div class="lab" style="margin-top:10px">SENSOREN</div>
    <div class="hint">Die Web-Version misst Δh nur mit der GPS-Höhe (Browser haben keinen Zugriff auf das Barometer). Die Android-App kann das Barometer nutzen und ist genauer.</div>
    <div class="hint">AUTO-Modus: Start bei &gt; 3 km/h, Stopp nach 3 s Stillstand. START/STOP gehen immer.</div>
    <div class="hint">Kein Konto, keine Werbung. Fahrten bleiben in diesem Browser.</div>
  </div></div>
  ${btn("save", "Speichern", "go", true, "--h:68px;--fs:18px")}`;
}

// ---------------------------------------------------------------- live update (tacho)

function update() {
  const now = performance.now();
  engine.tick(now);

  const res = engine.result;
  if (engine.phase === Phase.DONE && res && res !== savedResult) {
    savedResult = res;
    const rec = {
      id: Date.now(), timeMs: Date.now() - (now - res.startTime), vehicle: settings.vehicle,
      personKg: settings.personKg, vehicleKg: settings.vehicleKg,
      h1: res.h1, h2: res.h2, dh: res.dh, vmaxKmh: res.vmaxKmh, note: "",
    };
    runs.unshift(rec); saveRuns();
    detailId = rec.id; detailFresh = true; go("detail");
    return;
  }

  keepAwake(engine.busy || (engine.autoMode && screen === "tacho" && engine.phase === Phase.IDLE));
  if (screen !== "tacho") return;

  const fresh = now - gps.lastFix < 3000;
  const ready = fresh && gps.acc != null && gps.acc <= 15;
  const busy = engine.busy;
  let gtxt;
  if (gps.error) gtxt = gps.denied ? "Kein GPS-Zugriff" : "Warte auf GPS …";
  else if (!gps.watching) gtxt = "GPS aus";
  else if (ready) gtxt = `GPS bereit ±${Math.round(gps.acc)} m`;
  else if (fresh && gps.acc != null) gtxt = `GPS ungenau ±${Math.round(gps.acc)} m`;
  else gtxt = "Warte auf GPS …";
  $("#gtxt").textContent = gtxt.toUpperCase().replace(/ M$/, " m");
  $("#gdot").classList.toggle("on", ready);
  $("#mode").textContent = engine.autoMode ? "AUTO" : "MAN";

  const set = (id, html) => { const el = $(id); if (el.dataset.v !== html) { el.innerHTML = html; el.dataset.v = html; } };
  set("#spd", seg(E.num(fresh ? engine.currentKmh : 0, 1), 4, 120));
  set("#max", seg(E.num(engine.maxKmh, 1), 4, 52));
  set("#alt", seg(gps.alt != null && fresh ? E.num(gps.alt, 0) : "----", 4, 52));
  set("#h1", seg(engine.h1 != null && busy ? E.num(engine.h1, 0) : "----", 4, 52));
  const active = engine.phase === Phase.RECORDING || engine.phase === Phase.STOP_AVG;
  set("#dh", seg(active && engine.h1 != null && gps.alt != null ? E.num(engine.h1 - gps.alt, 1) : "---", 4, 52));

  const av = engine.avg;
  const phaseTxt = {
    IDLE: engine.autoMode ? "Auto bereit: Losrollen startet die Messung" : "Oben hinstellen, START drücken",
    START_AVG: `Starthöhe mitteln … ${av.remainingS(now)} s (${av.count} Fixes) – still stehen`,
    RECORDING: "Los! Rollen lassen, nicht treten",
    STOP_AVG: `Endhöhe mitteln … ${av.remainingS(now)} s – still stehen`,
    DONE: "Fertig",
  }[engine.phase];
  $("#phase").textContent = phaseTxt.toUpperCase().replace(" S ", " s ").replace(" S (", " s (");

  const gb = $("#gpsbtn");
  let gbHtml = "";
  if (!gps.watching && !gps.denied) gbHtml = btn("gps", "GPS einschalten", "", false, "--h:56px;--fs:16px");
  else if (gps.error) gbHtml = `<div class="hint">${esc(gps.error)}</div>`;
  else if (gps.noAlt && fresh) gbHtml = `<div class="warnbox">Dieser Browser liefert keine Höhe. Chrome auf Android oder Safari auf dem iPhone verwenden.</div>`;
  if (gb.dataset.v !== gbHtml) { gb.innerHTML = gbHtml; gb.dataset.v = gbHtml; on("gps", () => { startGps(); update(); }); }

  const s = $("#start"), st = $("#stop");
  s.disabled = busy || !gps.watching;
  s.firstChild.textContent = engine.phase === Phase.START_AVG ? "Mitteln …" : busy ? "Läuft" : "Start";
  st.disabled = !(engine.phase === Phase.RECORDING || engine.phase === Phase.START_AVG);
  st.firstChild.textContent = engine.phase === Phase.STOP_AVG ? "Mitteln …" : "Stop";
  const a = $("#auto"); a.disabled = busy; a.firstChild.textContent = engine.autoMode ? "Auto ●" : "Auto ○";
  $("#hist").disabled = busy; $("#mass").disabled = busy;
}

setInterval(update, 250);

// ---------------------------------------------------------------- export

async function shareOrDownload(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast("Gespeichert: " + filename);
}

function exportCsv() {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  shareOrDownload(new Blob([E.csvBuild(runs)], { type: "text/csv" }), `energie-tacho_fahrten_${stamp}.csv`, "Energie-Tacho Fahrten");
}

/** PNG summary card: LCD values + all calculation steps, 1200 px wide (same layout as the Android app). */
function renderCard(r) {
  const W = 1200, pad = 60, ink = "#1c2418", soft = "#3a4430", warnC = "#8a1c10";
  const mathFont = (px) => `${px}px Roboto, "Helvetica Neue", Arial, sans-serif`;
  const monoB = (px) => `700 ${px}px ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace`;
  const st = E.steps(r), e = E.runEnergy(r);
  const c0 = document.createElement("canvas").getContext("2d");

  // math layout on canvas
  const SIZE = 40, AXIS = SIZE * 0.3, GAP = SIZE * 0.18;
  const measure = (ctx, items, size = SIZE) => {
    let w = 0, asc = size * 0.75, desc = size * 0.25;
    for (const it of items) { const b = measureOne(ctx, it, size); w += b.w; asc = Math.max(asc, b.asc); desc = Math.max(desc, b.desc); }
    return { w, asc, desc };
  };
  const measureOne = (ctx, it, size) => {
    if (it.t != null) { ctx.font = mathFont(size); return { w: ctx.measureText(it.t).width, asc: size * 0.75, desc: size * 0.25 }; }
    if (it.sub != null) { ctx.font = mathFont(size * 0.68); return { w: ctx.measureText(it.sub).width + size * 0.04, asc: size * 0.5, desc: size * 0.38 }; }
    if (it.frac) { const n = measure(ctx, it.frac[0], size), d = measure(ctx, it.frac[1], size);
      return { w: Math.max(n.w, d.w) + size * 0.5, asc: n.asc + n.desc + GAP + AXIS, desc: d.asc + d.desc + GAP - AXIS }; }
    const b = measure(ctx, it.sqrt, size); return { w: b.w + size * 0.75, asc: b.asc + GAP * 1.3, desc: b.desc };
  };
  const drawMath = (ctx, items, x, y, size = SIZE) => {
    for (const it of items) {
      const b = measureOne(ctx, it, size);
      ctx.fillStyle = ink; ctx.strokeStyle = ink; ctx.lineWidth = Math.max(2, size * 0.07);
      if (it.t != null) { ctx.font = mathFont(size); ctx.fillText(it.t, x, y); }
      else if (it.sub != null) { ctx.font = mathFont(size * 0.68); ctx.fillText(it.sub, x + size * 0.02, y + size * 0.22); }
      else if (it.frac) {
        const n = measure(ctx, it.frac[0], size), d = measure(ctx, it.frac[1], size), bar = y - AXIS;
        ctx.beginPath(); ctx.moveTo(x + size * 0.1, bar); ctx.lineTo(x + b.w - size * 0.1, bar); ctx.stroke();
        drawMath(ctx, it.frac[0], x + (b.w - n.w) / 2, bar - GAP - n.desc, size);
        drawMath(ctx, it.frac[1], x + (b.w - d.w) / 2, bar + GAP + d.asc, size);
      } else {
        const body = measure(ctx, it.sqrt, size), top = y - body.asc - GAP, rr = size * 0.6;
        ctx.beginPath(); ctx.moveTo(x + size * 0.05, y - size * 0.3); ctx.lineTo(x + rr * 0.35, y - size * 0.38);
        ctx.lineTo(x + rr * 0.62, y + body.desc * 0.6); ctx.lineTo(x + rr, top); ctx.lineTo(x + rr + body.w + size * 0.1, top); ctx.stroke();
        drawMath(ctx, it.sqrt, x + rr + size * 0.05, y, size);
      }
      x += b.w;
    }
  };
  const wrap = (ctx, text, maxW) => {
    const lines = []; let cur = "";
    for (const w of text.split(" ")) { const t = cur ? cur + " " + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur); return lines;
  };

  // height
  c0.font = mathFont(30);
  let H = 520;
  for (const s of st) { H += 70; for (const l of s.lines) { const b = measure(c0, l); H += b.asc + b.desc + 22; } if (s.note) H += wrap(c0, s.note, W - 2 * pad - 30).length * 40 + 10; H += 20; }
  H += 80;

  const cv = document.createElement("canvas"); cv.width = W; cv.height = Math.ceil(H);
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#2b2d2a"; ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#a9b497"); g.addColorStop(1, "#919c80");
  ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(30, 30, W - 60, H - 60, 26); ctx.fill();

  let y = 100;
  ctx.fillStyle = ink; ctx.font = monoB(46); ctx.fillText("ENERGIE-TACHO", pad, y);
  ctx.font = monoB(34); const dt = E.date(r.timeMs); ctx.fillText(dt, W - pad - ctx.measureText(dt).width, y);
  y += 50; ctx.fillStyle = soft; ctx.font = mathFont(30);
  ctx.fillText(`${r.vehicle || "Fahrzeug"}  ·  m = ${E.num(e.massKg, 1)} kg${r.note ? "  ·  " + r.note : ""}`, pad, y);
  y += 40;
  const vals = [["MAX km/h", E.num(r.vmaxKmh, 1)], ["ΔH m (GPS)", E.num(r.dh, 1)], ["η %", e.etaPercent == null ? "---" : E.num(e.etaPercent, 1)]];
  const colW = (W - 2 * pad) / 3, dh = 130, dw = 4 * CELL * dh / 100;
  vals.forEach(([lab, v], i) => {
    const x = pad + i * colW;
    ctx.fillStyle = ink; ctx.font = monoB(30); ctx.fillText(lab, x, y + 30);
    const ox = x + (colW - dw) / 2 - 10, oy = y + 60;
    eachSegment(v, 4, dh, (pts, lit) => {
      ctx.fillStyle = lit ? ink : "rgba(28,36,24,0.10)"; ctx.beginPath();
      pts.forEach(([px, py], k) => (k ? ctx.lineTo(ox + px, oy + py) : ctx.moveTo(ox + px, oy + py))); ctx.closePath(); ctx.fill();
    });
  });
  y += 240; ctx.fillStyle = ink; ctx.fillRect(pad, y, W - 2 * pad, 3); y += 30;

  for (const s of st) {
    y += 50; ctx.fillStyle = ink; ctx.font = monoB(34); ctx.fillText(s.title.toUpperCase().replace("M/S", "m/s"), pad, y); y += 20;
    for (const l of s.lines) { const b = measure(ctx, l); y += b.asc; drawMath(ctx, l, pad + 30, y); y += b.desc + 22; }
    if (s.note) {
      ctx.font = (s.warn ? "700 " : "") + mathFont(30); ctx.fillStyle = s.warn ? warnC : soft;
      for (const line of wrap(ctx, s.note, W - 2 * pad - 30)) { y += 36; ctx.fillText(line, pad + 30, y); }
      y += 14;
    }
    y += 20;
  }
  return cv;
}

function shareCard(r) {
  const cv = renderCard(r);
  const d = new Date(r.timeMs), p = (n) => String(n).padStart(2, "0");
  const name = `energie-tacho_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.png`;
  cv.toBlob((blob) => blob && shareOrDownload(blob, name, "Energie-Tacho Fahrt " + E.date(r.timeMs)), "image/png");
}

// test hook: lets the browser test feed simulated fixes (never used by the page itself)
window.__et = { engine, gps, onFix, renderCard, update, get runs() { return runs; } };

if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

render();
