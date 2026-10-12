// Minimal CalDAV client for iCloud (works with any CalDAV server that speaks basic auth).
// Sign-in uses an app-specific password (account.apple.com → Sign-In and Security), never the
// real Apple ID password. We create one calendar collection and only ever read/write inside it.

export const ICLOUD = "https://caldav.icloud.com/";

export class DavError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export type Creds = { u: string; p: string };

const NS = 'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:a="http://apple.com/ns/ical/"';

async function dav(creds: Creds, method: string, url: string, body?: string, headers: Record<string, string> = {}) {
  let target = url;
  for (let hop = 0; hop < 4; hop++) {
    const r = await fetch(target, {
      method,
      redirect: "manual",
      headers: {
        authorization: "Basic " + btoa(unescape(encodeURIComponent(`${creds.u}:${creds.p}`))),
        ...(body ? { "content-type": headers["content-type"] ?? "application/xml; charset=utf-8" } : {}),
        ...headers,
      },
      body,
    });
    if ([301, 302, 307, 308].includes(r.status) && r.headers.get("location")) {
      target = new URL(r.headers.get("location")!, target).toString();
      await r.body?.cancel();
      continue;
    }
    return { r, url: target };
  }
  throw new DavError(508, "too many redirects");
}

const decode = (s: string) =>
  s.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#13;|&#xD;/gi, "\r").replace(/&#10;|&#xA;/gi, "\n").replace(/&amp;/g, "&");

const tag = (name: string) => new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, "i");

type DavResponse = { href: string; props: string };

function responses(xml: string): DavResponse[] {
  const out: DavResponse[] = [];
  const re = /<(?:[\w-]+:)?response(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const href = decodeURIComponent(decode((m[1].match(tag("href"))?.[1] ?? "").trim()));
    // only props reported with a 2xx status
    const ok = [...m[1].matchAll(/<(?:[\w-]+:)?propstat(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?propstat>/gi)]
      .filter((p) => /HTTP\/1\.\d\s+2\d\d/.test(p[1])).map((p) => p[1]).join("");
    out.push({ href, props: ok || m[1] });
  }
  return out;
}

// servers differ on quoting ("abc" vs W/"abc"); compare bare values only
export const bareEtag = (e: string | null | undefined) => (e ?? "").replace(/^W\//, "").replace(/"/g, "").trim();

const prop = (props: string, name: string) => {
  const v = props.match(tag(name))?.[1];
  return v === undefined ? null : decode(v.trim());
};

async function check(res: { r: Response }, what: string) {
  if (res.r.status === 401 || res.r.status === 403) throw new DavError(401, "apple_auth");
  if (!res.r.ok && res.r.status !== 207) throw new DavError(res.r.status, `${what}: HTTP ${res.r.status}`);
  return await res.r.text();
}

// principal → calendar home (e.g. https://p52-caldav.icloud.com:443/123456/calendars/)
export async function discover(creds: Creds, base = ICLOUD) {
  const r1 = await dav(creds, "PROPFIND", base,
    `<?xml version="1.0"?><d:propfind ${NS}><d:prop><d:current-user-principal/></d:prop></d:propfind>`, { depth: "0" });
  const x1 = await check(r1, "principal");
  const principal = (responses(x1)[0]?.props.match(tag("current-user-principal"))?.[1] ?? "").match(tag("href"))?.[1];
  if (!principal) throw new DavError(500, "no principal");
  const pUrl = new URL(decode(principal.trim()), r1.url).toString();
  const r2 = await dav(creds, "PROPFIND", pUrl,
    `<?xml version="1.0"?><d:propfind ${NS}><d:prop><c:calendar-home-set/></d:prop></d:propfind>`, { depth: "0" });
  const x2 = await check(r2, "home");
  const home = (responses(x2)[0]?.props.match(tag("calendar-home-set"))?.[1] ?? "").match(tag("href"))?.[1];
  if (!home) throw new DavError(500, "no calendar home");
  const h = new URL(decode(home.trim()), r2.url).toString();
  return h.endsWith("/") ? h : h + "/";
}

export async function makeCalendar(creds: Creds, home: string, name: string, color = "#3B6EF5") {
  const url = `${home}${crypto.randomUUID().toUpperCase()}/`;
  const body = `<?xml version="1.0" encoding="utf-8"?><c:mkcalendar ${NS}><d:set><d:prop>` +
    `<d:displayname>${name.replace(/[<&>]/g, "")}</d:displayname>` +
    `<a:calendar-color>${color}FF</a:calendar-color>` +
    `<c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>` +
    `</d:prop></d:set></c:mkcalendar>`;
  const res = await dav(creds, "MKCALENDAR", url, body);
  if (res.r.status !== 201) await check(res, "mkcalendar");
  else await res.r.body?.cancel();
  return res.url;
}

export async function exists(creds: Creds, calUrl: string) {
  const res = await dav(creds, "PROPFIND", calUrl,
    `<?xml version="1.0"?><d:propfind ${NS}><d:prop><d:resourcetype/></d:prop></d:propfind>`, { depth: "0" });
  if (res.r.status === 404) { await res.r.body?.cancel(); return false; }
  await check(res, "calendar");
  return true;
}

export async function ctag(creds: Creds, calUrl: string) {
  const res = await dav(creds, "PROPFIND", calUrl,
    `<?xml version="1.0"?><d:propfind ${NS}><d:prop><cs:getctag/><d:sync-token/></d:prop></d:propfind>`, { depth: "0" });
  const x = await check(res, "ctag");
  const p = responses(x)[0]?.props ?? "";
  return prop(p, "getctag") ?? prop(p, "sync-token") ?? "";
}

// href (path) → etag for every event resource in the calendar
export async function listEtags(creds: Creds, calUrl: string) {
  const res = await dav(creds, "PROPFIND", calUrl,
    `<?xml version="1.0"?><d:propfind ${NS}><d:prop><d:getetag/><d:resourcetype/></d:prop></d:propfind>`, { depth: "1" });
  const x = await check(res, "list");
  const self = new URL(calUrl).pathname;
  const out = new Map<string, string>();
  for (const r of responses(x)) {
    const path = r.href.startsWith("http") ? new URL(r.href).pathname : r.href;
    if (path === self || path.endsWith("/")) continue;
    out.set(path, bareEtag(prop(r.props, "getetag")));
  }
  return out;
}

export async function multiget(creds: Creds, calUrl: string, paths: string[]) {
  const out: { path: string; etag: string; data: string }[] = [];
  for (let i = 0; i < paths.length; i += 40) {
    const chunk = paths.slice(i, i + 40);
    const body = `<?xml version="1.0" encoding="utf-8"?><c:calendar-multiget ${NS}><d:prop><d:getetag/><c:calendar-data/></d:prop>` +
      chunk.map((p) => `<d:href>${p.replace(/&/g, "&amp;")}</d:href>`).join("") + `</c:calendar-multiget>`;
    const res = await dav(creds, "REPORT", calUrl, body, { depth: "1" });
    const x = await check(res, "multiget");
    for (const r of responses(x)) {
      const data = prop(r.props, "calendar-data");
      if (!data) continue;
      const path = r.href.startsWith("http") ? new URL(r.href).pathname : r.href;
      out.push({ path, etag: bareEtag(prop(r.props, "getetag")), data });
    }
  }
  return out;
}

export async function putEvent(creds: Creds, calUrl: string, path: string, ics: string) {
  const url = new URL(path, calUrl).toString();
  const res = await dav(creds, "PUT", url, ics, { "content-type": "text/calendar; charset=utf-8" });
  if (!res.r.ok) await check(res, "put");
  await res.r.body?.cancel();
  let etag = res.r.headers.get("etag");
  if (!etag) {
    const p = await dav(creds, "PROPFIND", url,
      `<?xml version="1.0"?><d:propfind ${NS}><d:prop><d:getetag/></d:prop></d:propfind>`, { depth: "0" });
    etag = prop(responses(await check(p, "etag"))[0]?.props ?? "", "getetag");
  }
  return bareEtag(etag);
}

export async function deleteResource(creds: Creds, url: string) {
  const res = await dav(creds, "DELETE", url);
  await res.r.body?.cancel();
  if (!res.r.ok && res.r.status !== 404 && res.r.status !== 410) await check(res, "delete");
}
