// iCalendar (RFC 5545) writer + tolerant reader, shared by the CalDAV sync (iCloud) and the read-only feed.

import { fromWall, hms, toWall, TZ, utcDate, ymd } from "./tz.ts";

export type CalEvent = {
  id: string;
  title: string;
  notes: string;
  location: string;
  all_day: boolean;
  starts_at: string;
  ends_at: string;
  rrule: string | null;
  exdates: string[];
  status?: string;
  rev?: number;
  category?: { names: Record<string, string>; icon: string } | null;
  responsible_name?: string | null;
};

export type Parsed = {
  uid: string;
  title: string;
  notes: string;
  location: string;
  all_day: boolean;
  starts_at: string;
  ends_at: string;
  rrule: string | null;
  exdates: string[];
  recurrence_id: string | null;
  cancelled: boolean;
};

// ---------- how our events look in someone else's calendar app ----------

const FOOTER = "\n\n— Zäme:";

export function catName(c: CalEvent["category"], lang: string) {
  if (!c) return "";
  return c.names?.[lang] || c.names?.de || c.names?.en || Object.values(c.names ?? {})[0] || "";
}

export function decorate(ev: CalEvent, lang: string, pendingPrefix: string) {
  const summary = (ev.status === "pending" ? pendingPrefix : "") + ev.title;
  const tags = [
    ev.category ? `${ev.category.icon} ${catName(ev.category, lang)}` : "",
    ev.responsible_name ? `👤 ${ev.responsible_name}` : "",
  ].filter(Boolean).join(" · ");
  const description = ev.notes ? ev.notes + (tags ? `${FOOTER} ${tags}` : "") : (tags ? `${FOOTER.trim()} ${tags}` : "");
  return { summary, description };
}

export function undecorate(summary: string, description: string, pendingPrefix: string) {
  let title = (summary ?? "").trim();
  const pre = pendingPrefix.trim();
  if (pre && title.startsWith(pre)) title = title.slice(pre.length).trim();
  let notes = description ?? "";
  const i = notes.indexOf(FOOTER.trim());
  if (i >= 0) notes = notes.slice(0, i);
  return { title: title || "(…)", notes: notes.replace(/\s+$/, "") };
}

// ---------- writer ----------

const esc = (s: string) =>
  String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

const enc = new TextEncoder();
function fold(line: string) {
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "", size = 0, limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > limit) { out.push(cur); cur = ""; size = 0; limit = 74; }
    cur += ch; size += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const utcStamp = (t: Date) => t.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

function dtLines(name: string, iso: string, allDay: boolean) {
  const t = new Date(iso);
  if (allDay) return `${name};VALUE=DATE:${ymd(utcDate(t))}`;
  const w = toWall(t);
  return `${name};TZID=${TZ}:${ymd(w)}T${hms(w)}`;
}

export const VTIMEZONE = [
  "BEGIN:VTIMEZONE", `TZID:${TZ}`,
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST", "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET", "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
  "END:VTIMEZONE",
];

export function veventLines(ev: CalEvent, lang: string, pendingPrefix: string): string[] {
  const { summary, description } = decorate(ev, lang, pendingPrefix);
  const L = [
    "BEGIN:VEVENT",
    `UID:${ev.id}`,
    `DTSTAMP:${utcStamp(new Date())}`,
    dtLines("DTSTART", ev.starts_at, ev.all_day),
    dtLines("DTEND", ev.ends_at, ev.all_day),
    `SUMMARY:${esc(summary)}`,
  ];
  if (description) L.push(`DESCRIPTION:${esc(description)}`);
  if (ev.location) L.push(`LOCATION:${esc(ev.location)}`);
  if (ev.rrule) {
    L.push(`RRULE:${ev.rrule}`);
    for (const x of ev.exdates ?? []) L.push(dtLines("EXDATE", x, ev.all_day));
  }
  if (ev.category) L.push(`CATEGORIES:${esc(catName(ev.category, lang))}`);
  if (ev.status === "pending") L.push("STATUS:TENTATIVE");
  L.push(`SEQUENCE:${ev.rev ?? 0}`, "END:VEVENT");
  return L;
}

export function buildCalendar(events: CalEvent[], lang: string, pendingPrefix: string, name?: string) {
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Zaeme//Familienkalender//DE", "CALSCALE:GREGORIAN"];
  if (name) L.push(`X-WR-CALNAME:${esc(name)}`, `X-WR-TIMEZONE:${TZ}`, "REFRESH-INTERVAL;VALUE=DURATION:PT15M", "X-PUBLISHED-TTL:PT15M");
  L.push(...VTIMEZONE);
  for (const ev of events) L.push(...veventLines(ev, lang, pendingPrefix));
  L.push("END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}

// ---------- reader ----------

type Prop = { name: string; params: Record<string, string>; value: string };

function unfold(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function parseLine(line: string): Prop | null {
  // NAME;P1=V1;P2="V:2":value  — colons inside quoted params are not the separator
  let i = 0, inQ = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (c === ":" && !inQ) break;
  }
  if (i >= line.length) return null;
  const head = line.slice(0, i), value = line.slice(i + 1);
  const parts = head.split(";");
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const k = p.indexOf("=");
    if (k > 0) params[p.slice(0, k).toUpperCase()] = p.slice(k + 1).replace(/^"|"$/g, "");
  }
  return { name: parts[0].toUpperCase(), params, value };
}

const unesc = (s: string) =>
  s.replace(/\\\\/g, "\u0000").replace(/\\[nN]/g, "\n").replace(/\\([;,])/g, "$1").replace(/\u0000/g, "\\");

function validTz(tz: string | undefined) {
  if (!tz) return null;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return null; }
}

// returns [iso, isDate]
export function parseDt(value: string, params: Record<string, string>): [string, boolean] {
  const v = value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return [new Date(v).toISOString(), false];
  const [, y, mo, d, h, mi, s, z] = m;
  if (params.VALUE === "DATE" || h === undefined) {
    return [new Date(Date.UTC(+y, +mo - 1, +d)).toISOString(), true];
  }
  if (z) return [new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0))).toISOString(), false];
  const tz = validTz(params.TZID) ?? TZ;
  return [fromWall({ y: +y, mo: +mo, d: +d, h: +h, mi: +mi, s: +(s ?? 0) }, tz).toISOString(), false];
}

function durationMs(v: string) {
  const m = v.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const [, sign, w, d, h, mi, s] = m;
  const ms = ((+(w ?? 0) * 7 + +(d ?? 0)) * 86400 + +(h ?? 0) * 3600 + +(mi ?? 0) * 60 + +(s ?? 0)) * 1000;
  return sign === "-" ? -ms : ms;
}

export function parseCalendar(text: string): Parsed[] {
  const out: Parsed[] = [];
  let cur: Prop[] | null = null, depth = 0;
  for (const line of unfold(text)) {
    if (!line) continue;
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === "BEGIN") {
      if (p.value.toUpperCase() === "VEVENT" && !cur) { cur = []; depth = 0; }
      else if (cur) depth++;   // VALARM inside an event
      continue;
    }
    if (p.name === "END") {
      if (cur && p.value.toUpperCase() === "VEVENT" && depth === 0) { out.push(toParsed(cur)); cur = null; }
      else if (cur) depth--;
      continue;
    }
    if (cur && depth === 0) cur.push(p);
  }
  return out;
}

function toParsed(props: Prop[]): Parsed {
  const get = (n: string) => props.find((p) => p.name === n);
  const ds = get("DTSTART");
  const [start, isDate] = ds ? parseDt(ds.value, ds.params) : [new Date().toISOString(), false];
  let end: string;
  const de = get("DTEND"), du = get("DURATION");
  if (de) end = parseDt(de.value, de.params)[0];
  else if (du) end = new Date(new Date(start).getTime() + durationMs(du.value)).toISOString();
  else end = isDate ? new Date(new Date(start).getTime() + 86400000).toISOString() : start;
  const exdates: string[] = [];
  for (const p of props.filter((x) => x.name === "EXDATE")) {
    for (const v of p.value.split(",")) if (v.trim()) exdates.push(parseDt(v, p.params)[0]);
  }
  const rid = get("RECURRENCE-ID");
  const rrule = get("RRULE")?.value?.trim() || null;
  return {
    uid: get("UID")?.value?.trim() ?? "",
    title: unesc(get("SUMMARY")?.value ?? ""),
    notes: unesc(get("DESCRIPTION")?.value ?? ""),
    location: unesc(get("LOCATION")?.value ?? ""),
    all_day: isDate,
    starts_at: start,
    ends_at: end < start ? start : end,
    rrule,
    exdates,
    recurrence_id: rid ? parseDt(rid.value, rid.params)[0] : null,
    cancelled: (get("STATUS")?.value ?? "").toUpperCase() === "CANCELLED",
  };
}
