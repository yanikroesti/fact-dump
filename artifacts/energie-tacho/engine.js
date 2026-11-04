// Energie-Tacho web: pure logic (no DOM). Same rules as the Android app, tested in Node (web/test).

export const G = 9.81;

export const kmhToMs = (kmh) => kmh / 3.6;
export const msToKmh = (ms) => ms * 3.6;
export const epot = (m, h) => m * G * h;
export const ekin = (m, v) => 0.5 * m * v * v;
export const efficiency = (ek, ep) => (ep > 0 ? (ek / ep) * 100 : null);
export const idealSpeedMs = (h) => (h > 0 ? Math.sqrt(2 * G * h) : null);
export const round = (v, d) => { const f = 10 ** d; return Math.round(v * f) / f; };

export function energyOf(personKg, vehicleKg, heightM, vmaxKmh) {
  const m = personKg + vehicleKg;
  const v = kmhToMs(vmaxKmh);
  const ep = epot(m, heightM);
  const ek = ekin(m, v);
  const vi = idealSpeedMs(heightM);
  return {
    massKg: m, heightM, vmaxKmh, vmaxMs: v, epotJ: ep, ekinJ: ek,
    etaPercent: efficiency(ek, ep), vIdealMs: vi, vIdealKmh: vi == null ? null : msToKmh(vi),
    impossible: vi != null && v > vi,
    heightInvalid: heightM <= 0,
  };
}

/** Energy of a saved run, using Δh and vmax rounded as displayed (reproducible by hand). */
export const runEnergy = (r) => energyOf(r.personKg, r.vehicleKg, round(r.dh, 2), round(r.vmaxKmh, 1));

/** Distance in metres between two lat/lon points (haversine). */
export function distanceM(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Browsers sometimes give coords.speed = null. Then speed is computed from positions, over at least 2 s
 * (a single 1 s step would turn ±3 m position jitter into ±10 km/h). `history` = earlier fixes, oldest first.
 * Returns km/h or null.
 */
export function speedKmh(fix, history = []) {
  if (fix.speed != null && !Number.isNaN(fix.speed)) return fix.speed * 3.6;
  if (fix.acc != null && fix.acc > 10) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const p = history[i], dt = (fix.t - p.t) / 1000;
    if (dt >= 2 && dt <= 6) return (distanceM(p.lat, p.lon, fix.lat, fix.lon) / dt) * 3.6;
  }
  return null;
}

export class AltitudeAverager {
  constructor(windowMs = 4000, minFixes = 3, timeoutMs = 15000) {
    Object.assign(this, { windowMs, minFixes, timeoutMs, startMs: -1, gps: [] });
  }
  begin(now) { this.startMs = now; this.gps = []; }
  add(now, alt) { this.gps.push(alt); }
  get count() { return this.gps.length; }
  elapsed(now) { return this.startMs < 0 ? 0 : now - this.startMs; }
  remainingS(now) { return Math.ceil(Math.max(0, this.windowMs - this.elapsed(now)) / 1000); }
  isComplete(now) {
    const e = this.elapsed(now);
    return (e >= this.windowMs && this.gps.length >= this.minFixes) || e >= this.timeoutMs;
  }
  mean() { return this.gps.length ? this.gps.reduce((a, b) => a + b, 0) / this.gps.length : null; }
}

export const Phase = { IDLE: "IDLE", START_AVG: "START_AVG", RECORDING: "RECORDING", STOP_AVG: "STOP_AVG", DONE: "DONE" };

/**
 * Run state machine (GPS only: browsers have no barometer access).
 * Manual: start() → 4 s start-height averaging → RECORDING → stop() → 4 s end-height averaging → DONE.
 * Auto: while IDLE, the last 5 s are buffered. Auto arms only after 3 s standing (≤ 3 km/h incl. GPS jitter) (so walking the bike
 * back up does not start a run); then two fixes in a row above 3 km/h start the run with the buffered
 * (standing) heights as h1. 3 s below 1.5 km/h after having rolled stops it.
 */
export class RunEngine {
  constructor({ averagingMs = 4000, autoStartKmh = 3, stillKmh = 1.5, autoStopStillMs = 3000, bufferMs = 5000 } = {}) {
    Object.assign(this, { averagingMs, autoStartKmh, stillKmh, autoStopStillMs, bufferMs });
    this.phase = Phase.IDLE; this.autoMode = false;
    this.currentKmh = 0; this.maxKmh = 0; this.result = null; this.h1 = null;
    this.avg = new AltitudeAverager(averagingMs);
    this.stillSince = -1; this.idleStill = -1; this.armed = false; this.fastFixes = 0; this.buffer = []; this.startTime = 0; this.autoStarted = false;
  }

  get busy() { return [Phase.START_AVG, Phase.RECORDING, Phase.STOP_AVG].includes(this.phase); }

  start(now) {
    if (this.busy) return;
    Object.assign(this, { result: null, maxKmh: 0, h1: null, autoStarted: false, startTime: now });
    this.avg.begin(now);
    this.phase = Phase.START_AVG;
  }

  stop(now) {
    if (this.phase === Phase.RECORDING) this._beginStop(now);
    else if (this.phase === Phase.START_AVG) { this.h1 = this.avg.mean(); this._beginStop(now); }
  }

  reset() {
    Object.assign(this, { phase: Phase.IDLE, result: null, maxKmh: 0, buffer: [], fastFixes: 0, stillSince: -1, idleStill: -1, armed: false });
  }

  onGps(now, kmh, alt) {
    if (kmh != null) this.currentKmh = kmh;
    switch (this.phase) {
      case Phase.IDLE:
        this.buffer.push({ t: now, alt, kmh });
        while (this.buffer.length && now - this.buffer[0].t > this.bufferMs) this.buffer.shift();
        if (this.autoMode && kmh != null) {
          if (kmh <= this.autoStartKmh) {   // standing incl. GPS jitter; walking is 4–5 km/h
            if (this.idleStill < 0) this.idleStill = now;
            if (now - this.idleStill >= this.autoStopStillMs) this.armed = true;
          } else this.idleStill = -1;
          this.fastFixes = this.armed && kmh > this.autoStartKmh ? this.fastFixes + 1 : 0;
          if (this.fastFixes >= 2) this._autoStart(now, kmh);
        }
        break;
      case Phase.START_AVG:
        if (alt != null) this.avg.add(now, alt);
        this._track(kmh);
        break;
      case Phase.RECORDING:
        this._track(kmh);
        if (this.autoMode && this.maxKmh > this.autoStartKmh && kmh != null) {
          if (kmh < this.stillKmh) {
            if (this.stillSince < 0) { this.stillSince = now; this.avg.begin(now); }
            if (alt != null) this.avg.add(now, alt);
            if (now - this.stillSince >= this.autoStopStillMs) this.phase = Phase.STOP_AVG;
          } else this.stillSince = -1;
        }
        break;
      case Phase.STOP_AVG:
        if (alt != null) this.avg.add(now, alt);
        break;
    }
    this.tick(now);
  }

  tick(now) {
    if (this.phase === Phase.START_AVG && this.avg.isComplete(now)) {
      this.h1 = this.avg.mean(); this.phase = Phase.RECORDING; this.stillSince = -1;
    } else if (this.phase === Phase.STOP_AVG && this.avg.isComplete(now)) {
      const h2 = this.avg.mean();
      const h1 = this.h1;
      const dh = h1 != null && h2 != null ? h1 - h2 : 0;
      this.result = { startTime: this.startTime, endTime: now, h1: h1 ?? 0, h2: h2 ?? 0, dh, vmaxKmh: this.maxKmh, autoStarted: this.autoStarted };
      this.phase = Phase.DONE;
    }
  }

  _track(kmh) { if (kmh != null && kmh > this.maxKmh) this.maxKmh = kmh; }

  _autoStart(now, kmh) {
    const alts = this.buffer.filter((b) => (b.kmh ?? 0) <= this.autoStartKmh && b.alt != null).map((b) => b.alt);
    Object.assign(this, {
      result: null, maxKmh: kmh, autoStarted: true, startTime: now,
      h1: alts.length ? alts.reduce((a, b) => a + b, 0) / alts.length : null,
      buffer: [], fastFixes: 0, stillSince: -1, idleStill: -1, armed: false, phase: Phase.RECORDING,
    });
  }

  _beginStop(now) { this.avg.begin(now); this.stillSince = -1; this.phase = Phase.STOP_AVG; }
}

// ---------------------------------------------------------------- formatting

const THIN = " ";
export function num(v, d) {
  let s = v.toFixed(d);
  if (/^-0(\.0+)?$/.test(s)) s = s.slice(1);
  const neg = s.startsWith("-");
  if (neg) s = s.slice(1);
  let [i, f] = s.split(".");
  if (i.length > 4) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, THIN);
  return (neg ? "-" : "") + i + (f != null ? "." + f : "");
}
export const joule = (v) => num(Math.round(v), 0);
const pad = (n) => String(n).padStart(2, "0");
export function date(ms) {
  const d = new Date(ms);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const signed = (v, d) => (v > 0 ? "+" : "") + num(v, d);

// ---------------------------------------------------------------- CSV

export const CSV_HEADER = ["Datum", "Fahrzeug", "Person_kg", "Fahrzeug_kg", "Masse_kg", "h1_m", "h2_m", "dh_m", "dh_Quelle",
  "vmax_kmh", "vmax_ms", "Epot_J", "Ekin_J", "eta_Prozent", "v_ideal_kmh", "Notiz"];

export const csvEscape = (s) => (/[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
const f = (v, d) => (v == null ? "" : v.toFixed(d));

export function csvRow(r) {
  const e = runEnergy(r);
  return [date(r.timeMs), csvEscape(r.vehicle), f(r.personKg, 1), f(r.vehicleKg, 1), f(e.massKg, 1), f(r.h1, 1), f(r.h2, 1),
    f(r.dh, 2), "GPS", f(r.vmaxKmh, 1), f(e.vmaxMs, 2), f(e.epotJ, 0), f(e.ekinJ, 0), f(e.etaPercent, 1), f(e.vIdealKmh, 1),
    csvEscape(r.note || "")].join(";");
}

export const csvBuild = (runs) =>
  "﻿" + [CSV_HEADER.join(";"), ...[...runs].sort((a, b) => a.timeMs - b.timeMs).map(csvRow)].join("\r\n") + "\r\n";

// ---------------------------------------------------------------- calculation steps
// Math items: {t:"text"} | {sub:"x"} | {frac:[num[], den[]]} | {sqrt:[...]}

const T = (t) => ({ t }), S = (sub) => ({ sub }), F = (n, d) => ({ frac: [n, d] }), R = (b) => ({ sqrt: b });
const kg = (v) => num(v, 1) + " kg", m2 = (v) => num(v, 2) + " m", j = (v) => joule(v) + " J";
const EPOT = [T("E"), S("pot")], EKIN = [T("E"), S("kin")];

export function steps(r) {
  const e = runEnergy(r);
  const out = [];
  out.push({ title: "1  Masse", lines: [
    [T("m = m"), S("Person"), T(" + m"), S("Fahrzeug")],
    [T(`m = ${kg(r.personKg)} + ${kg(r.vehicleKg)}`)],
    [T(`m = ${kg(e.massKg)}`)],
  ] });
  out.push({ title: "2  Höhenunterschied", lines: [
    [T("Δh = h"), S("1"), T(" − h"), S("2")],
    [T(`Δh = ${m2(r.h1)} − ${m2(round(r.h1, 2) - round(r.dh, 2))}`)],
    [T(`Δh = ${m2(r.dh)}`)],
  ], note: "Quelle: GPS-Höhe, oben und unten je über ca. 4 s gemittelt" });
  out.push({ title: "3  Potentielle Energie (oben)", lines: [
    [...EPOT, T(" = m · g · Δh")],
    [...EPOT, T(` = ${kg(e.massKg)} · 9.81 m/s² · ${m2(r.dh)}`)],
    [...EPOT, T(` = ${j(e.epotJ)}`)],
  ] });
  out.push({ title: "4  Geschwindigkeit in m/s", lines: [
    [T("v = "), F([T("v"), S("km/h")], [T("3.6")])],
    [T("v = "), F([T(num(r.vmaxKmh, 1) + " km/h")], [T("3.6")])],
    [T(`v = ${num(e.vmaxMs, 3)} m/s`)],
  ] });
  out.push({ title: "5  Kinetische Energie (unten)", lines: [
    [...EKIN, T(" = "), F([T("m · v²")], [T("2")])],
    [...EKIN, T(" = "), F([T(`${kg(e.massKg)} · (${num(e.vmaxMs, 3)} m/s)²`)], [T("2")])],
    [...EKIN, T(` = ${j(e.ekinJ)}`)],
  ] });
  const eta = e.etaPercent;
  out.push({ title: "6  Wirkungsgrad", lines: [
    [T("η = "), F(EKIN, EPOT), T(" · 100 %")],
    eta != null ? [T("η = "), F([T(j(e.ekinJ))], [T(j(e.epotJ))]), T(" · 100 %")] : [T("η = nicht berechenbar (Δh ≤ 0)")],
    [T("η = " + (eta != null ? num(eta, 1) + " %" : "–"))],
  ], note: eta != null ? `Der Rest (${num(100 - eta, 1)} %) ging als Reibung, Luftwiderstand und Wärme verloren.` : null });
  if (e.vIdealMs != null) {
    out.push({ title: "7  Kontrolle: Geschwindigkeit ohne Verluste", lines: [
      [T("v"), S("ideal"), T(" = "), R([T("2 · g · Δh")])],
      [T("v"), S("ideal"), T(" = "), R([T(`2 · 9.81 m/s² · ${m2(r.dh)}`)])],
      [T("v"), S("ideal"), T(` = ${num(e.vIdealMs, 2)} m/s = ${num(e.vIdealKmh, 1)} km/h`)],
    ], note: e.impossible
      ? `ACHTUNG: gemessen ${num(r.vmaxKmh, 1)} km/h ist mehr als ohne Verluste möglich – die Höhenmessung stimmt nicht. Fahrt wiederholen.`
      : `OK: gemessen ${num(r.vmaxKmh, 1)} km/h < ${num(e.vIdealKmh, 1)} km/h`, warn: e.impossible });
  }
  return out;
}
