// Google Calendar: OAuth token refresh, REST calls, and mapping between Google events and ours.
// Each parent gets one secondary calendar that this app creates (scope calendar.app.created), so we
// never see or touch their other calendars.

import { type CalEvent, decorate, parseDt, undecorate } from "./ics.ts";
import { hms, toWall, TZ, utcDate, ymd, ymdDash } from "./tz.ts";

export const SCOPES = "openid email https://www.googleapis.com/auth/calendar.app.created";
const API = "https://www.googleapis.com/calendar/v3";

export class GoogleError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export async function exchangeCode(clientId: string, secret: string, code: string, redirect: string) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: secret, redirect_uri: redirect, grant_type: "authorization_code" }),
  });
  const j = await r.json();
  if (!r.ok) throw new GoogleError(r.status, j.error_description || j.error || "token exchange failed");
  let email = "";
  try { email = JSON.parse(atob(j.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).email ?? ""; } catch { /* label only */ }
  return { refresh: j.refresh_token as string | undefined, access: j.access_token as string, email };
}

export async function accessToken(clientId: string, secret: string, refresh: string) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, refresh_token: refresh, grant_type: "refresh_token" }),
  });
  const j = await r.json();
  // invalid_grant = the parent revoked access or the token expired: they must connect again
  if (!r.ok) throw new GoogleError(r.status, j.error === "invalid_grant" ? "google_reauth" : (j.error_description || j.error));
  return j.access_token as string;
}

export async function gapi(token: string, method: string, path: string, body?: unknown) {
  const r = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new GoogleError(r.status, j?.error?.message || `Google ${r.status}`);
  return j;
}

export async function createCalendar(token: string, name: string) {
  const c = await gapi(token, "POST", "/calendars", { summary: name, timeZone: TZ, description: "Zäme — Familienkalender" });
  return c.id as string;
}

function timeField(iso: string, allDay: boolean) {
  const t = new Date(iso);
  if (allDay) return { date: ymdDash(utcDate(t)) };
  return { dateTime: t.toISOString(), timeZone: TZ };
}

export function toGoogle(ev: CalEvent, lang: string, prefix: string) {
  const { summary, description } = decorate(ev, lang, prefix);
  const recurrence: string[] = [];
  if (ev.rrule) {
    recurrence.push(`RRULE:${ev.rrule}`);
    for (const x of ev.exdates ?? []) {
      const t = new Date(x);
      if (ev.all_day) recurrence.push(`EXDATE;VALUE=DATE:${ymd(utcDate(t))}`);
      else { const w = toWall(t); recurrence.push(`EXDATE;TZID=${TZ}:${ymd(w)}T${hms(w)}`); }
    }
  }
  return {
    summary,
    description,
    location: ev.location || "",
    start: timeField(ev.starts_at, ev.all_day),
    end: timeField(ev.ends_at, ev.all_day),
    recurrence: recurrence.length ? recurrence : undefined,
    status: ev.status === "pending" ? "tentative" : "confirmed",
    extendedProperties: { private: { zaeme_id: ev.id } },
  };
}

function htmlToText(s: string) {
  if (!/<[a-z][\s\S]*>/i.test(s)) return s;
  return s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li)>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

function readTime(f: { date?: string; dateTime?: string } | undefined): [string, boolean] {
  if (!f) return [new Date().toISOString(), false];
  if (f.date) return [new Date(f.date + "T00:00:00Z").toISOString(), true];
  return [new Date(f.dateTime!).toISOString(), false];
}

// deno-lint-ignore no-explicit-any
export function fromGoogle(item: any, prefix: string) {
  const [starts_at, all_day] = readTime(item.start);
  const [ends_at] = readTime(item.end);
  let rrule: string | null = null;
  const exdates: string[] = [];
  for (const line of (item.recurrence ?? []) as string[]) {
    if (/^RRULE:/i.test(line)) rrule = line.slice(6).trim();
    else if (/^EXDATE/i.test(line)) {
      const i = line.indexOf(":");
      const params: Record<string, string> = {};
      for (const p of line.slice(0, i).split(";").slice(1)) {
        const [k, v] = p.split("=");
        params[k.toUpperCase()] = v;
      }
      for (const v of line.slice(i + 1).split(",")) exdates.push(parseDt(v, params)[0]);
    }
  }
  const { title, notes } = undecorate(item.summary ?? "", htmlToText(item.description ?? ""), prefix);
  return { title, notes, location: item.location ?? "", all_day, starts_at, ends_at, rrule, exdates };
}

// the start of the occurrence a Google exception instance replaces
// deno-lint-ignore no-explicit-any
export function originalStart(item: any) {
  return readTime(item.originalStartTime)[0];
}
