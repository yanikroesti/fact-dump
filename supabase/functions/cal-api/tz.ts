// Wall-clock <-> instant conversion for one IANA zone, using only Intl (works in Deno and Node).
// Repeating events are defined in Europe/Zurich wall time so "every Monday 08:00" survives DST.

export const TZ = "Europe/Zurich";

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export type Wall = { y: number; mo: number; d: number; h: number; mi: number; s: number };

export function toWall(t: Date, tz = TZ): Wall {
  const p = fmt(tz).formatToParts(t);
  const g = (k: string) => Number(p.find((x) => x.type === k)!.value);
  return { y: g("year"), mo: g("month"), d: g("day"), h: g("hour") % 24, mi: g("minute"), s: g("second") };
}

// minutes east of UTC at that instant
export function offsetMin(t: Date, tz = TZ): number {
  const w = toWall(t, tz);
  return Math.round((Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(t.getTime() / 1000) * 1000) / 60000);
}

export function fromWall(w: Wall, tz = TZ): Date {
  const guess = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  let t = guess - offsetMin(new Date(guess), tz) * 60000;
  const off2 = offsetMin(new Date(t), tz);
  t = guess - off2 * 60000;
  return new Date(t);
}

const p2 = (n: number) => String(n).padStart(2, "0");
export const ymd = (w: { y: number; mo: number; d: number }) => `${w.y}${p2(w.mo)}${p2(w.d)}`;
export const ymdDash = (w: { y: number; mo: number; d: number }) => `${w.y}-${p2(w.mo)}-${p2(w.d)}`;
export const hms = (w: Wall) => `${p2(w.h)}${p2(w.mi)}${p2(w.s)}`;

// all-day events are stored as 00:00 UTC of their date
export const utcDate = (t: Date) => ({ y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() });
