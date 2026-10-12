// Dates for Zäme: Europe/Zurich wall time for repeating events, day keys, formatting, repeat presets.
// Timed events are stored as instants; all-day events as 00:00 UTC of their date (end exclusive).

import { locale } from './i18n.js';

export const TZ = 'Europe/Zurich';
const pad = (n) => String(n).padStart(2, '0');

const zf = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});
function toWall(t) {
  const p = zf.formatToParts(t);
  const g = (k) => Number(p.find((x) => x.type === k).value);
  return { y: g('year'), mo: g('month'), d: g('day'), h: g('hour') % 24, mi: g('minute'), s: g('second') };
}
function offsetMin(t) {
  const w = toWall(t);
  return Math.round((Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(t.getTime() / 1000) * 1000) / 60000);
}
// Zurich wall clock encoded as a UTC date ("floating"), the trick rrule.js needs to stay DST-correct
const floating = (t) => { const w = toWall(t); return new Date(Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s)); };
function unfloat(f) {
  const guess = f.getTime();
  let t = guess - offsetMin(new Date(guess)) * 60000;
  t = guess - offsetMin(new Date(t)) * 60000;
  return new Date(t);
}

// ---- day keys (local calendar days) ----
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const utcDayKey = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const keyToDate = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const todayKey = () => dayKey(new Date());

// ---- occurrences ----
let RR = null;
export function setRRule(lib) { RR = lib; }

/** all occurrences of event `ev` overlapping [from, to) as { ev, start, end, key } */
export function occurrences(ev, from, to) {
  const s = new Date(ev.starts_at), e = new Date(ev.ends_at);
  const dur = Math.max(0, e - s);
  const out = [];
  const push = (start) => {
    const end = new Date(start.getTime() + dur);
    if (end > from && start < to || (dur === 0 && start >= from && start < to)) {
      out.push({ ev, start, end, key: `${ev.id}:${start.getTime()}` });
    }
  };
  if (!ev.rrule || !RR) { push(s); return out; }
  const ex = new Set((ev.exdates || []).map((x) => new Date(x).getTime()));
  try {
    const opts = RR.RRule.parseString(ev.rrule);
    if (ev.all_day) {
      const rule = new RR.RRule({ ...opts, dtstart: s });
      for (const d of rule.between(new Date(from.getTime() - dur - 86400000), to, true)) if (!ex.has(d.getTime())) push(d);
    } else {
      const rule = new RR.RRule({ ...opts, dtstart: floating(s) });
      const a = floating(new Date(from.getTime() - dur - 3600000)), b = floating(new Date(to.getTime() + 3600000));
      for (const f of rule.between(a, b, true)) {
        const real = unfloat(f);
        if (!ex.has(real.getTime())) push(real);
      }
    }
  } catch (err) {
    console.warn('rrule', ev.rrule, err);
    push(s);
  }
  return out;
}

/** day keys an occurrence covers (all-day uses its UTC dates, timed uses local days) */
export function occDays(o) {
  const keys = [];
  if (o.ev.all_day) {
    for (let t = o.start.getTime(); t < Math.max(o.end.getTime(), o.start.getTime() + 1); t += 86400000) keys.push(utcDayKey(new Date(t)));
  } else {
    let d = startOfDay(o.start);
    const last = startOfDay(new Date(Math.max(o.start.getTime(), o.end.getTime() - 1)));
    while (d <= last) { keys.push(dayKey(d)); d = addDays(d, 1); }
  }
  return keys;
}

// ---- formatting ----
const fmt = (opts) => new Intl.DateTimeFormat(locale(), opts);
export const fTime = (d) => fmt({ hour: '2-digit', minute: '2-digit' }).format(d);
export const fDayLong = (d) => fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(d);
export const fDayShort = (d) => fmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(d);
export const fMonth = (d) => fmt({ month: 'long', year: 'numeric' }).format(d);
export const fWeekday = (d) => fmt({ weekday: 'narrow' }).format(d);
export const fWeekdayShort = (d) => fmt({ weekday: 'short' }).format(d);
export const fDateTime = (d) => fmt({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
export function fRelative(iso) {
  const diff = (new Date(iso) - Date.now()) / 60000;
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  if (Math.abs(diff) < 60) return rtf.format(Math.round(diff), 'minute');
  if (Math.abs(diff) < 1440) return rtf.format(Math.round(diff / 60), 'hour');
  return rtf.format(Math.round(diff / 1440), 'day');
}

/** human text for when an event (or one occurrence) happens */
export function fWhen(ev, start = new Date(ev.starts_at), end = new Date(ev.ends_at)) {
  if (ev.all_day) {
    const s = new Date(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
    const lastT = new Date(end.getTime() - 86400000);
    const l = new Date(lastT.getUTCFullYear(), lastT.getUTCMonth(), lastT.getUTCDate());
    return dayKey(s) === dayKey(l) ? fDayLong(s) : `${fDayShort(s)} – ${fDayShort(l)}`;
  }
  if (dayKey(start) === dayKey(end) || end - start === 0) return `${fDayLong(start)}, ${fTime(start)}–${fTime(end)}`;
  return `${fDayShort(start)} ${fTime(start)} – ${fDayShort(end)} ${fTime(end)}`;
}

// ---- repeat presets ----
export const PRESETS = ['none', 'daily', 'weekly', 'biweekly', 'monthly', 'yearly'];
const PRESET_RULE = {
  daily: 'FREQ=DAILY', weekly: 'FREQ=WEEKLY', biweekly: 'FREQ=WEEKLY;INTERVAL=2', monthly: 'FREQ=MONTHLY', yearly: 'FREQ=YEARLY',
};

export function parseRule(rrule) {
  if (!rrule) return { preset: 'none', until: '' };
  const parts = Object.fromEntries(rrule.split(';').map((p) => p.split('=')));
  let until = '';
  if (parts.UNTIL) {
    const m = parts.UNTIL.match(/^(\d{4})(\d{2})(\d{2})/);
    if (m) until = `${m[1]}-${m[2]}-${m[3]}`;
  }
  const core = rrule.split(';').filter((p) => !/^(UNTIL|WKST|BYDAY|BYMONTHDAY|BYMONTH)=/.test(p)).sort().join(';');
  const hasExtra = /COUNT=|BYSETPOS|BYHOUR|BYMINUTE/.test(rrule) || (parts.BYDAY && parts.BYDAY.includes(','));
  if (!hasExtra) {
    for (const [k, v] of Object.entries(PRESET_RULE)) if (core === v.split(';').sort().join(';')) return { preset: k, until };
  }
  return { preset: 'custom', until, raw: rrule };
}

export function buildRule(preset, until, allDay, raw) {
  if (preset === 'none') return null;
  if (preset === 'custom') return raw || null;
  let r = PRESET_RULE[preset];
  if (until) {
    const [y, m, d] = until.split('-');
    r += allDay ? `;UNTIL=${y}${m}${d}` : `;UNTIL=${unfloat(new Date(Date.UTC(+y, +m - 1, +d, 23, 59, 59))).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`;
  }
  return r;
}

// form <-> stored values
export const isoFromLocal = (date, time) => new Date(`${date}T${time || '00:00'}`).toISOString();
export const isoFromDay = (date) => new Date(`${date}T00:00:00Z`).toISOString();
export const localDate = (d) => dayKey(d);
export const localTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
