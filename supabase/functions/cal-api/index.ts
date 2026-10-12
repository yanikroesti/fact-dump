// Zäme — family calendar backend (Supabase project "easel", tables cal_*).
//
// Routes (all under /functions/v1/cal-api):
//   POST /join            invite code → new parent account          (public, code-gated)
//   POST /reset           reset code → new password                 (public, code-gated)
//   GET  /ics/<token>.ics read-only feed for any calendar app       (public, token-gated)
//   GET  /vapid           web-push public key                       (public)
//   POST /google/start    → Google consent URL                      (signed-in member)
//   GET  /google/callback Google redirects here                     (state is HMAC-signed)
//   POST /apple/connect   iCloud with an app-specific password      (signed-in member)
//   POST /disconnect      remove a phone-calendar link              (member / admin)
//   POST /sync            sync my calendars now                     (member; admin = all)
//   POST /test-push       test notification to my devices           (member)
//   POST /hook            DB trigger on cal_changes: notify + sync  (x-cal-key)
//   POST /cron            every 5 min: auto-approve + sync          (x-cal-key)
//
// verify_jwt is OFF because of the public, hook and Google routes; user routes check the JWT here.

import { createClient } from "jsr:@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.3";
import { buildCalendar, type CalEvent, parseCalendar, undecorate } from "./ics.ts";
import { accessToken, createCalendar, exchangeCode, fromGoogle, gapi, GoogleError, originalStart, SCOPES, toGoogle } from "./google.ts";
import * as dav from "./caldav.ts";
import { TZ } from "./tz.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SB_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const FN = "https://vcglqoqtcsiqfjutizib.supabase.co/functions/v1/cal-api";
const GOOGLE_REDIRECT = `${FN}/google/callback`;

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, apikey, x-client-info",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" } });

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

// ───────────── secrets / settings ─────────────

async function secrets(): Promise<Record<string, string>> {
  const { data } = await db.from("cal_secrets").select("key,value");
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
}
async function settings(): Promise<Row> {
  const { data } = await db.from("cal_settings").select("*").eq("id", 1).single();
  return data!;
}

// ───────────── crypto ─────────────

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (u: Uint8Array) => b64(u).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => unb64(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));

async function aes(S: Record<string, string>) {
  return await crypto.subtle.importKey("raw", unb64(S.enc_key), "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function seal(S: Record<string, string>, obj: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aes(S), new TextEncoder().encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return b64(out);
}
async function unseal(S: Record<string, string>, s: string) {
  const raw = unb64(s);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, await aes(S), raw.slice(12));
  return JSON.parse(new TextDecoder().decode(pt));
}
async function hmac(key: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg))));
}
async function sha256hex(s: string) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const normCode = (c: string) => String(c ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// ───────────── who is calling ─────────────

async function caller(req: Request): Promise<Row | null> {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data?.user) return null;
  const { data: m } = await db.from("cal_members").select("*").eq("user_id", data.user.id).eq("active", true).maybeSingle();
  return m ?? null;
}

// ───────────── sync ─────────────

type Ctx = { conn: Row; member: Row; S: Record<string, string>; set: Row; warn: string[] };

const T = (x: string) => new Date(x).getTime();
const normRule = (r: string | null) => (r ? r.replace(/^RRULE:/i, "").split(";").filter(Boolean).sort().join(";").toUpperCase() : null);
function sameEvent(ev: Row, d: Row) {
  const ex = (a: string[] | null) => (a ?? []).map(T).sort().join(",");
  return ev.title === d.title && (ev.notes ?? "").trimEnd() === (d.notes ?? "").trimEnd() &&
    (ev.location ?? "") === (d.location ?? "") && ev.all_day === d.all_day &&
    T(ev.starts_at) === T(d.starts_at) && T(ev.ends_at) === T(d.ends_at) &&
    normRule(ev.rrule) === normRule(d.rrule) && ex(ev.exdates) === ex(d.exdates);
}

async function getEvent(id: string) {
  const { data } = await db.from("cal_events").select("*").eq("id", id).maybeSingle();
  return data;
}

async function propose(ctx: Ctx, kind: string, eventId: string | null, data: Row | null) {
  const { data: r, error } = await db.rpc("cal_propose_as", {
    p_member: ctx.member.id, p_kind: kind, p_event: eventId, p_data: data, p_note: null,
    p_source: ctx.conn.provider, p_conn: ctx.conn.id,
  });
  if (error) throw new Error(error.message);
  return r as Row;
}

async function loadLinks(connId: string) {
  const { data } = await db.from("cal_links").select("*").eq("connection_id", connId);
  const all = data ?? [];
  return { all, byExt: new Map(all.map((l) => [l.external_id, l])) };
}
async function setLink(row: Row) {
  const { error } = await db.from("cal_links").upsert(row, { onConflict: "event_id,connection_id" });
  if (error) throw new Error("link: " + error.message);
}
async function patchLink(l: Row, patch: Row) {
  await db.from("cal_links").update(patch).eq("event_id", l.event_id).eq("connection_id", l.connection_id);
}

// the parent changed or removed one of our events in their own calendar app
async function externalDelete(ctx: Ctx, link: Row) {
  const ev = await getEvent(link.event_id);
  if (!ev || ev.status === "deleted" || ev.status === "rejected") return;
  try { await propose(ctx, "delete", ev.id, null); }
  catch (e) { ctx.warn.push(`delete ${ev.title}: ${(e as Error).message}`); }
}
async function externalUpdate(ctx: Ctx, link: Row, d: Row) {
  const ev = await getEvent(link.event_id);
  if (!ev || ev.status === "deleted" || ev.status === "rejected") return;
  if (sameEvent(ev, d)) return;
  try { await propose(ctx, "update", ev.id, d); }
  catch (e) {
    ctx.warn.push(`update ${ev.title}: ${(e as Error).message}`);
    await patchLink(link, { pushed_rev: 0 });   // put our version back on the phone
  }
}

async function pushPlan(ctx: Ctx, upsert: (p: Row) => Promise<{ id: string; etag: string }>, remove: (p: Row) => Promise<void>) {
  const { data: plan, error } = await db.rpc("cal_sync_plan", { p_conn: ctx.conn.id });
  if (error) throw new Error(error.message);
  for (const p of plan ?? []) {
    try {
      if (p.action === "upsert") {
        const r = await upsert(p);
        await setLink({ event_id: p.event_id, connection_id: ctx.conn.id, external_id: r.id, etag: r.etag, pushed_rev: p.event.rev, gone: false });
      } else {
        if (!p.gone) await remove(p);
        await db.from("cal_links").delete().eq("event_id", p.event_id).eq("connection_id", ctx.conn.id);
      }
    } catch (e) {
      if (e instanceof dav.DavError && e.status === 401) throw e;
      if (e instanceof GoogleError && (e.status === 401 || e.message === "google_reauth")) throw e;
      ctx.warn.push(`push: ${(e as Error).message}`);
    }
  }
}

async function runGoogle(ctx: Ctx) {
  const { S, conn, set } = ctx;
  if (!S.google_client_id || !S.google_client_secret) throw new Error("google_not_configured");
  const creds = await unseal(S, conn.creds_enc);
  const token = await accessToken(S.google_client_id, S.google_client_secret, creds.refresh);
  const cal = encodeURIComponent(conn.calendar_id);
  const prefix = set.pending_prefix;

  // pull: everything that changed since the last sync token
  let syncToken: string | null = conn.sync_token;
  let items: Row[] = [], next: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    items = []; next = null;
    let page: string | undefined;
    try {
      do {
        const q = new URLSearchParams({ maxResults: "2500" });
        if (syncToken) q.set("syncToken", syncToken); else q.set("showDeleted", "true");
        if (page) q.set("pageToken", page);
        const r = await gapi(token, "GET", `/calendars/${cal}/events?${q}`);
        items.push(...(r.items ?? []));
        page = r.nextPageToken;
        next = r.nextSyncToken ?? next;
      } while (page);
      break;
    } catch (e) {
      if (e instanceof GoogleError && e.status === 410 && syncToken) { syncToken = null; continue; }
      throw e;
    }
  }

  const L = await loadLinks(conn.id);
  for (const item of items) {
    try {
      if (item.recurringEventId) {
        // one occurrence of a series deleted on the phone → skip that date; edited single occurrences stay phone-only
        if (item.status !== "cancelled") continue;
        const ml = L.byExt.get(item.recurringEventId);
        if (!ml || ml.gone) continue;
        const ev = await getEvent(ml.event_id);
        if (!ev || ev.status !== "active") continue;
        const os = originalStart(item);
        if ((ev.exdates ?? []).some((x: string) => T(x) === T(os))) continue;
        await propose(ctx, "update", ev.id, { exdates: [...(ev.exdates ?? []), os] });
        continue;
      }
      const link = L.byExt.get(item.id);
      const zid = item.extendedProperties?.private?.zaeme_id;
      if (!link && zid) {
        if (await getEvent(zid)) {
          await setLink({ event_id: zid, connection_id: conn.id, external_id: item.id, etag: item.etag, pushed_rev: 0, gone: item.status === "cancelled" });
        }
        continue;
      }
      if (link && link.etag === item.etag) continue;
      if (item.status === "cancelled") {
        if (link && !link.gone) await externalDelete(ctx, link);
        if (link) await patchLink(link, { gone: true, etag: item.etag });
        continue;
      }
      const d = fromGoogle(item, prefix);
      if (link) {
        await externalUpdate(ctx, link, d);
        await patchLink(link, { etag: item.etag, gone: false });
        continue;
      }
      const r = await propose(ctx, "create", null, d);
      await setLink({ event_id: r.event_id, connection_id: conn.id, external_id: item.id, etag: item.etag, pushed_rev: 0, gone: false });
    } catch (e) {
      ctx.warn.push(`pull ${item.summary ?? item.id}: ${(e as Error).message}`);
    }
  }
  if (next) await db.from("cal_connections").update({ sync_token: next }).eq("id", conn.id);

  // push: whatever changed on our side
  const lang = ctx.member.lang;
  await pushPlan(ctx, async (p) => {
    const body = toGoogle(p.event as CalEvent, lang, prefix);
    if (p.external_id) {
      try {
        const r = await gapi(token, "PUT", `/calendars/${cal}/events/${encodeURIComponent(p.external_id)}`, body);
        return { id: r.id, etag: r.etag };
      } catch (e) {
        if (!(e instanceof GoogleError) || ![404, 410].includes(e.status)) throw e;
      }
    }
    const r = await gapi(token, "POST", `/calendars/${cal}/events`, body);
    return { id: r.id, etag: r.etag };
  }, async (p) => {
    try { await gapi(token, "DELETE", `/calendars/${cal}/events/${encodeURIComponent(p.external_id)}`); }
    catch (e) { if (!(e instanceof GoogleError) || ![404, 410].includes(e.status)) throw e; }
  });
}

async function runApple(ctx: Ctx) {
  const { S, conn, set } = ctx;
  const creds = await unseal(S, conn.creds_enc) as dav.Creds;
  const cal = conn.calendar_id as string;
  const calPath = new URL(cal).pathname;
  const prefix = set.pending_prefix;

  const ct = await dav.ctag(creds, cal);
  if (!ct || ct !== conn.sync_token) {
    const listing = await dav.listEtags(creds, cal);
    const L = await loadLinks(conn.id);
    for (const link of L.all) {
      if (!listing.has(link.external_id) && !link.gone) {
        await externalDelete(ctx, link);
        await patchLink(link, { gone: true });
      }
    }
    const changed = [...listing].filter(([path, etag]) => {
      const l = L.byExt.get(path);
      return !l || dav.bareEtag(l.etag) !== etag;
    }).map(([path]) => path);
    if (changed.length) {
      for (const r of await dav.multiget(creds, cal, changed)) {
        try {
          const evs = parseCalendar(r.data);
          const master = evs.find((e) => !e.recurrence_id) ?? evs[0];
          if (!master) continue;
          for (const o of evs) if (o.recurrence_id && o.cancelled) master.exdates.push(o.recurrence_id);
          const u = undecorate(master.title, master.notes, prefix);
          const d = {
            title: u.title, notes: u.notes, location: master.location, all_day: master.all_day,
            starts_at: master.starts_at, ends_at: master.ends_at, rrule: master.rrule, exdates: master.exdates,
          };
          const link = L.byExt.get(r.path);
          if (link) {
            if (master.cancelled) { if (!link.gone) await externalDelete(ctx, link); await patchLink(link, { gone: true, etag: r.etag }); }
            else { await externalUpdate(ctx, link, d); await patchLink(link, { etag: r.etag, gone: false }); }
            continue;
          }
          if (/^[0-9a-f-]{36}$/i.test(master.uid) && await getEvent(master.uid.toLowerCase())) {
            await setLink({ event_id: master.uid.toLowerCase(), connection_id: conn.id, external_id: r.path, etag: r.etag, pushed_rev: 0, gone: false });
            continue;
          }
          if (master.cancelled) continue;
          const cr = await propose(ctx, "create", null, d);
          await setLink({ event_id: cr.event_id, connection_id: conn.id, external_id: r.path, etag: r.etag, pushed_rev: 0, gone: false });
        } catch (e) {
          ctx.warn.push(`pull ${r.path}: ${(e as Error).message}`);
        }
      }
    }
    await db.from("cal_connections").update({ sync_token: ct }).eq("id", conn.id);
  }

  const lang = ctx.member.lang;
  await pushPlan(ctx, async (p) => {
    const path = p.external_id || `${calPath}${p.event.id}.ics`;
    const etag = await dav.putEvent(creds, cal, path, buildCalendar([p.event as CalEvent], lang, prefix));
    return { id: path, etag };
  }, async (p) => {
    await dav.deleteResource(creds, new URL(p.external_id, cal).toString());
  });
}

async function claim(id: string) {
  const { data } = await db.rpc("cal_claim", { p_conn: id });
  return data === true;
}

async function syncConn(id: string) {
  if (!(await claim(id))) return { id, busy: true };
  const warn: string[] = [];
  let held = true;
  try {
    for (let round = 0; round < 3; round++) {
      const { data: conn } = await db.from("cal_connections").select("*").eq("id", id).single();
      const { data: member } = await db.from("cal_members").select("*").eq("id", conn!.member_id).single();
      if (!member?.active) break;
      const ctx: Ctx = { conn: conn!, member, S: await secrets(), set: await settings(), warn };
      if (conn!.provider === "google") await runGoogle(ctx); else await runApple(ctx);
      const { data: again } = await db.rpc("cal_release", { p_conn: id });
      held = false;
      if (!again || round === 2 || !(await claim(id))) break;
      held = true;
    }
    await db.from("cal_connections").update({
      status: "ok", last_sync_at: new Date().toISOString(), last_error: warn.length ? warn.slice(0, 3).join(" | ").slice(0, 500) : null,
    }).eq("id", id);
    return { id, ok: true, warnings: warn.length };
  } catch (e) {
    const msg = e instanceof dav.DavError && e.status === 401 ? "apple_auth" : (e as Error).message;
    console.error("sync", id, msg);
    await db.from("cal_connections").update({ status: "error", last_error: msg.slice(0, 500), last_sync_at: new Date().toISOString() }).eq("id", id);
    return { id, ok: false, error: msg };
  } finally {
    if (held) await db.rpc("cal_release", { p_conn: id });
  }
}

async function syncAll(memberId?: string) {
  let q = db.from("cal_connections").select("id");
  if (memberId) q = q.eq("member_id", memberId);
  const { data } = await q;
  const out = [];
  for (const c of data ?? []) out.push(await syncConn(c.id));
  return out;
}

// ───────────── push notifications ─────────────

const MSG: Record<string, Record<string, string>> = {
  de: {
    ask_create: "{n} schlägt einen Termin vor", ask_update: "{n} möchte einen Termin ändern",
    ask_delete: "{n} möchte einen Termin absagen", ask_detach: "{n} möchte einen Termin verschieben",
    ask_changed: "{n} hat den Vorschlag angepasst",
    fyi_create: "{n} hat einen Termin eingetragen", fyi_update: "{n} hat einen Termin geändert",
    fyi_delete: "{n} hat einen Termin gelöscht", fyi_detach: "{n} hat einen Termin verschoben",
    approved: "{n} hat bestätigt ✓", rejected: "{n} hat abgelehnt ✗", auto: "Automatisch bestätigt ✓",
    test: "Benachrichtigungen funktionieren ✓", test_body: "So sieht es aus, wenn etwas zu bestätigen ist.",
  },
  en: {
    ask_create: "{n} suggests a new event", ask_update: "{n} wants to change an event",
    ask_delete: "{n} wants to cancel an event", ask_detach: "{n} wants to move one date",
    ask_changed: "{n} updated the suggestion",
    fyi_create: "{n} added an event", fyi_update: "{n} changed an event",
    fyi_delete: "{n} deleted an event", fyi_detach: "{n} moved one date",
    approved: "{n} accepted ✓", rejected: "{n} declined ✗", auto: "Confirmed automatically ✓",
    test: "Notifications work ✓", test_body: "This is how it looks when something needs your OK.",
  },
  vi: {
    ask_create: "{n} đề xuất một lịch hẹn mới", ask_update: "{n} muốn thay đổi một lịch hẹn",
    ask_delete: "{n} muốn hủy một lịch hẹn", ask_detach: "{n} muốn dời một ngày hẹn",
    ask_changed: "{n} đã sửa đề xuất",
    fyi_create: "{n} đã thêm một lịch hẹn", fyi_update: "{n} đã thay đổi một lịch hẹn",
    fyi_delete: "{n} đã xóa một lịch hẹn", fyi_detach: "{n} đã dời một ngày hẹn",
    approved: "{n} đã đồng ý ✓", rejected: "{n} đã từ chối ✗", auto: "Đã tự động xác nhận ✓",
    test: "Thông báo hoạt động ✓", test_body: "Đây là thông báo khi có việc cần bạn xác nhận.",
  },
};
const LOCALE: Record<string, string> = { de: "de-CH", en: "en-GB", vi: "vi-VN" };

function when(e: Row, lang: string) {
  const loc = LOCALE[lang] ?? "de-CH";
  if (e.all_day) {
    return new Intl.DateTimeFormat(loc, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(e.starts_at));
  }
  return new Intl.DateTimeFormat(loc, { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    .format(new Date(e.starts_at));
}

async function pushServer(S: Record<string, string>) {
  let jwk = S.vapid_private_jwk;
  if (!jwk) {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    jwk = JSON.stringify(await crypto.subtle.exportKey("jwk", kp.privateKey));
    await db.from("cal_secrets").upsert({ key: "vapid_private_jwk", value: jwk }, { onConflict: "key", ignoreDuplicates: true });
    jwk = (await secrets()).vapid_private_jwk;
  }
  const priv = JSON.parse(jwk);
  const pubJwk = { kty: priv.kty, crv: priv.crv, x: priv.x, y: priv.y };
  const raw = new Uint8Array([4, ...unb64url(priv.x), ...unb64url(priv.y)]);
  return {
    publicKey: b64url(raw),
    server: async () => {
      const vapidKeys = await webpush.importVapidKeys({ publicKey: pubJwk, privateKey: priv } as never, { extractable: false });
      return await webpush.ApplicationServer.new({ contactInformation: "https://dump.yanikroesti.ch", vapidKeys });
    },
  };
}

async function sendPush(S: Record<string, string>, memberIds: string[], build: (lang: string) => { title: string; body: string; tag: string; url: string }) {
  if (!memberIds.length) return 0;
  const { data: subs } = await db.from("cal_push_subs").select("*, m:cal_members(lang)").in("member_id", memberIds);
  if (!subs?.length) return 0;
  const server = await (await pushServer(S)).server();
  let sent = 0;
  for (const sub of subs) {
    try {
      const subscriber = server.subscribe({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } } as never);
      await subscriber.pushTextMessage(JSON.stringify(build(sub.m?.lang ?? "de")), {});
      sent++;
      if (sub.fail_count) await db.from("cal_push_subs").update({ fail_count: 0 }).eq("endpoint", sub.endpoint);
    } catch (e) {
      const msg = String(e);
      if (/404|410|gone/i.test(msg) || sub.fail_count >= 5) await db.from("cal_push_subs").delete().eq("endpoint", sub.endpoint);
      else await db.from("cal_push_subs").update({ fail_count: sub.fail_count + 1 }).eq("endpoint", sub.endpoint);
    }
  }
  return sent;
}

async function notifyChange(changeId: string, op: string) {
  const { data: c } = await db.from("cal_changes").select("*").eq("id", changeId).maybeSingle();
  if (!c) return 0;
  const S = await secrets(), set = await settings();
  const { data: members } = await db.from("cal_members").select("*").eq("active", true);
  const by = (id: string | null) => (members ?? []).find((m) => m.id === id);
  let targets: Row[] = [], key = "";
  if (c.status === "pending") {
    for (const m of members ?? []) {
      if (m.id === c.proposed_by) continue;
      if (m.role === "admin" && c.rule !== "admin") continue;   // the admin only hears about what only they can decide
      const { data: can } = await db.rpc("cal_can_decide", { p_member: m.id, p_change: c.id });
      if (can) targets.push(m);
    }
    key = op === "INSERT" ? `ask_${c.kind}` : "ask_changed";
  } else if (c.status === "applied" && op === "INSERT") {
    if (!set.notify_fyi || c.note === "revert") return 0;
    targets = (members ?? []).filter((m) => m.role === "parent" && m.id !== c.proposed_by);
    key = `fyi_${c.kind}`;
  } else if (["approved", "rejected", "auto"].includes(c.status) && op === "UPDATE") {
    const p = by(c.proposed_by);
    if (p && p.id !== c.decided_by) targets = [p];
    key = c.status;
  } else return 0;

  const who = c.status === "pending" || c.status === "applied" ? by(c.proposed_by) : by(c.decided_by);
  const ev = c.after ?? c.before ?? {};
  const extra = c.status === "pending" || c.status === "applied" ? c.note : c.reply;
  return await sendPush(S, targets.map((m) => m.id), (lang) => {
    const L = MSG[lang] ?? MSG.de;
    return {
      title: (L[key] ?? key).replace("{n}", who?.name ?? "Zäme"),
      body: `${ev.title ?? ""} · ${ev.starts_at ? when(ev, lang) : ""}${extra ? `\n„${extra}“` : ""}`,
      tag: `cal-${c.event_id}`,
      url: `${S.app_url}#c=${c.id}`,
    };
  });
}

// ───────────── routes ─────────────

const colors = ["#e8590c", "#1c7ed6", "#2b8a3e", "#ae3ec9", "#c2255c", "#0b7285"];
const LANGS = ["de", "en", "vi"];

async function route(req: Request, path: string): Promise<Response> {
  const S = await secrets();
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

  // --- machine routes ---
  if (path === "/hook" || path === "/cron") {
    if (req.headers.get("x-cal-key") !== S.hook_key) return json({ error: "unauthorized" }, 401);
    let notified = 0, auto = 0;
    if (path === "/hook" && body.change_id) {
      try { notified = await notifyChange(body.change_id, body.op); } catch (e) { console.error("notify", String(e)); }
    }
    if (path === "/cron") {
      const { data } = await db.rpc("cal_auto_approve");
      auto = data ?? 0;
    }
    const synced = await syncAll();
    return json({ ok: true, notified, auto, synced });
  }

  // --- public routes ---
  const ics = path.match(/^\/ics\/([a-f0-9]{20,})(?:\.ics)?$/);
  if (ics) {
    const { data: m } = await db.from("cal_members").select("*").eq("ics_token", ics[1]).eq("active", true).maybeSingle();
    if (!m) return new Response("not found", { status: 404 });
    const set = await settings();
    const { data: evs } = await db.from("cal_events")
      .select("*, category:cal_categories(names,icon), resp:cal_members!cal_events_responsible_fkey(name)")
      .in("status", set.sync_pending ? ["active", "pending"] : ["active"]);
    const list = (evs ?? []).map((e) => ({ ...e, responsible_name: e.resp?.name ?? null }));
    return new Response(buildCalendar(list as CalEvent[], m.lang, set.pending_prefix, set.calendar_name), {
      headers: { ...cors, "content-type": "text/calendar; charset=utf-8", "cache-control": "no-cache" },
    });
  }

  if (path === "/vapid") return json({ key: (await pushServer(S)).publicKey });

  if (path === "/join") {
    const code = normCode(body.code);
    const email = String(body.email ?? "").trim().toLowerCase();
    const name = String(body.name ?? "").trim().slice(0, 40);
    const password = String(body.password ?? "");
    const lang = LANGS.includes(body.lang) ? body.lang : "de";
    if (code.length !== 8) return json({ error: "bad_code" }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "bad_email" }, 400);
    if (password.length < 8) return json({ error: "short_password" }, 400);
    const { data: inv } = await db.from("cal_codes").select("*").eq("code_hash", await sha256hex(code))
      .eq("kind", "invite").is("used_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (!inv) return json({ error: "bad_code" }, 400);
    const finalName = name || inv.name || email.split("@")[0];
    const { data: created, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { app: "zaeme" } });
    if (error || !created?.user) {
      return json({ error: /already|exists|registered/i.test(error?.message ?? "") ? "email_taken" : (error?.message ?? "create_failed") }, 400);
    }
    const { data: used } = await db.from("cal_members").select("color");
    const color = colors.find((c) => !(used ?? []).some((u) => u.color === c)) ?? colors[0];
    const { error: mErr } = await db.from("cal_members").insert({ user_id: created.user.id, name: finalName, email, role: inv.role ?? "parent", lang, color });
    if (mErr) {
      await db.auth.admin.deleteUser(created.user.id);
      return json({ error: mErr.message }, 400);
    }
    await db.from("cal_codes").update({ used_at: new Date().toISOString() }).eq("id", inv.id);
    return json({ ok: true });
  }

  if (path === "/reset") {
    const code = normCode(body.code);
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    if (password.length < 8) return json({ error: "short_password" }, 400);
    const { data: rc } = await db.from("cal_codes").select("*").eq("code_hash", await sha256hex(code))
      .eq("kind", "reset").is("used_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (!rc) return json({ error: "bad_code" }, 400);
    const { data: m } = await db.from("cal_members").select("*").eq("id", rc.member_id).maybeSingle();
    if (!m?.user_id || (m.email ?? "").toLowerCase() !== email) return json({ error: "bad_code" }, 400);
    const { error } = await db.auth.admin.updateUserById(m.user_id, { password });
    if (error) return json({ error: error.message }, 400);
    await db.from("cal_codes").update({ used_at: new Date().toISOString() }).eq("id", rc.id);
    return json({ ok: true });
  }

  if (path === "/google/callback") {
    const u = new URL(req.url);
    const back = (msg: string) => Response.redirect(`${S.app_url}#sync=${encodeURIComponent(msg)}`, 302);
    if (u.searchParams.get("error")) return back("google_denied");
    const [payload, sig] = String(u.searchParams.get("state") ?? "").split(".");
    if (!payload || sig !== await hmac(S.hook_key, payload)) return back("google_state");
    const st = JSON.parse(new TextDecoder().decode(unb64url(payload)));
    if (st.exp < Date.now()) return back("google_state");
    try {
      const tok = await exchangeCode(S.google_client_id, S.google_client_secret, u.searchParams.get("code") ?? "", GOOGLE_REDIRECT);
      const { data: old } = await db.from("cal_connections").select("*").eq("member_id", st.m).eq("provider", "google").maybeSingle();
      let refresh = tok.refresh;
      if (!refresh && old?.creds_enc) refresh = (await unseal(S, old.creds_enc)).refresh;
      if (!refresh) return back("google_no_refresh");
      let calId: string | null = null;
      if (old?.calendar_id) {
        try { await gapi(tok.access, "GET", `/calendars/${encodeURIComponent(old.calendar_id)}`); calId = old.calendar_id; } catch { /* make a new one */ }
      }
      const set = await settings();
      if (!calId) calId = await createCalendar(tok.access, set.calendar_name);
      const row = {
        member_id: st.m, provider: "google", account_label: tok.email, calendar_id: calId,
        creds_enc: await seal(S, { refresh }), status: "ok", last_error: null,
        ...(old && old.calendar_id === calId ? {} : { sync_token: null }),
      };
      const { data: conn, error } = await db.from("cal_connections").upsert(row, { onConflict: "member_id,provider" }).select().single();
      if (error) throw new Error(error.message);
      if (old && old.calendar_id !== calId) await db.from("cal_links").delete().eq("connection_id", conn.id);
      await syncConn(conn.id);
      return back("google_ok");
    } catch (e) {
      console.error("google callback", String(e));
      return back("google_error");
    }
  }

  // --- signed-in member routes ---
  const me = await caller(req);
  if (!me) return json({ error: "unauthorized" }, 401);

  if (path === "/google/start") {
    if (!S.google_client_id || !S.google_client_secret) return json({ error: "google_not_configured" }, 400);
    const payload = b64url(new TextEncoder().encode(JSON.stringify({ m: me.id, exp: Date.now() + 15 * 60000 })));
    const state = `${payload}.${await hmac(S.hook_key, payload)}`;
    const q = new URLSearchParams({
      client_id: S.google_client_id, redirect_uri: GOOGLE_REDIRECT, response_type: "code", scope: SCOPES,
      access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
    });
    if (me.email) q.set("login_hint", me.email);
    return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${q}` });
  }

  if (path === "/apple/connect") {
    const u = String(body.apple_id ?? "").trim();
    const p = String(body.app_password ?? "").replace(/\s+/g, "");
    if (!u || !/^[a-z]{4}-?[a-z]{4}-?[a-z]{4}-?[a-z]{4}$/i.test(p)) return json({ error: "apple_format" }, 400);
    const creds = { u, p: p.length === 16 ? p.match(/.{4}/g)!.join("-") : p };
    try {
      const { data: old } = await db.from("cal_connections").select("*").eq("member_id", me.id).eq("provider", "apple").maybeSingle();
      const home = await dav.discover(creds);
      let cal: string | null = null;
      if (old?.calendar_id) { try { if (await dav.exists(creds, old.calendar_id)) cal = old.calendar_id; } catch { /* new one */ } }
      const set = await settings();
      if (!cal) cal = await dav.makeCalendar(creds, home, set.calendar_name, me.color.toUpperCase());
      const row = {
        member_id: me.id, provider: "apple", account_label: u, calendar_id: cal, creds_enc: await seal(S, creds),
        status: "ok", last_error: null, ...(old && old.calendar_id === cal ? {} : { sync_token: null }),
      };
      const { data: conn, error } = await db.from("cal_connections").upsert(row, { onConflict: "member_id,provider" }).select().single();
      if (error) throw new Error(error.message);
      if (old && old.calendar_id !== cal) await db.from("cal_links").delete().eq("connection_id", conn.id);
      const r = await syncConn(conn.id);
      return json({ ok: true, sync: r });
    } catch (e) {
      const msg = e instanceof dav.DavError && e.status === 401 ? "apple_auth" : (e as Error).message;
      return json({ error: msg }, 400);
    }
  }

  if (path === "/disconnect") {
    const memberId = me.role === "admin" && body.member_id ? body.member_id : me.id;
    const { data: conn } = await db.from("cal_connections").select("*").eq("member_id", memberId).eq("provider", body.provider).maybeSingle();
    if (!conn) return json({ ok: true });
    // remove the calendar we created, so the phone doesn't keep a frozen copy
    try {
      if (conn.provider === "google") {
        const c = await unseal(S, conn.creds_enc);
        const tok = await accessToken(S.google_client_id, S.google_client_secret, c.refresh);
        await gapi(tok, "DELETE", `/calendars/${encodeURIComponent(conn.calendar_id)}`);
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(c.refresh)}`, { method: "POST" }).catch(() => {});
      } else {
        await dav.deleteResource(await unseal(S, conn.creds_enc), conn.calendar_id);
      }
    } catch (e) { console.error("disconnect cleanup", String(e)); }
    await db.from("cal_connections").delete().eq("id", conn.id);
    return json({ ok: true });
  }

  if (path === "/sync") return json({ ok: true, synced: await syncAll(me.role === "admin" && body.all ? undefined : me.id) });

  if (path === "/test-push") {
    const sent = await sendPush(S, [me.id], (lang) => ({
      title: (MSG[lang] ?? MSG.de).test, body: (MSG[lang] ?? MSG.de).test_body, tag: "cal-test", url: S.app_url,
    }));
    return json({ ok: true, sent });
  }

  return json({ error: "not found" }, 404);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const path = new URL(req.url).pathname.replace(/^.*?\/cal-api/, "") || "/";
  try {
    return await route(req, path);
  } catch (e) {
    console.error(path, String(e));
    return json({ error: (e as Error).message }, 500);
  }
});
