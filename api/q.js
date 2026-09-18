/* dump.yanikroesti.ch/q/<slug> — the resolver behind every hosted QR code.

   GET  /q/<slug>  (rewritten to /api/q?slug=<slug>) — a real scan
   POST /api/q     — the second half of a handshake, or a password unlock

   Every scan goes to the qr_hit RPC in Supabase with coarse location from
   Vercel's geo headers and a parsed user agent. The IP only travels as part of
   a salted hash (visitor counting) and is never stored. Link-preview bots get a
   neutral page and are never counted, and codes with a scan limit need a
   browser handshake first — so a messenger preview can't burn a one-time code. */

const SB_URL = 'https://ljkdibnkifzwydhqkzxt.supabase.co';
/* publishable key: meant for browsers, every table sits behind RLS */
const SB_KEY = 'sb_publishable_1vEjb3RhVFo54KZM948PCA_A_9SpAgQ';

const SLUG = /^[A-Za-z0-9_-]{3,40}$/;
const BOT = /(bot\b|bot\/|crawl|spider|slurp|facebookexternalhit|facebookcatalog|whatsapp|telegrambot|slackbot|twitterbot|discordbot|linkedinbot|skypeuripreview|embedly|iframely|pinterest|redditbot|applebot|bingpreview|vkshare|w3c_validator|preview|curl\/|wget|python-requests|python-urllib|go-http-client|headlesschrome|node-fetch|axios|okhttp|java\/|libwww|httpclient|googleother|google-inspectiontool|mediapartners|yandex|baiduspider|duckduckbot|petalbot|semrush|ahrefs|bytespider|gptbot|claudebot|ccbot|amazonbot)/i;

const NO_STORE = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer'
};

function parseUA(ua) {
  const s = ua || '';
  let os = 'other';
  if (/iPhone|iPad|iPod/i.test(s)) os = 'ios';
  else if (/Android/i.test(s)) os = 'android';
  else if (/Windows/i.test(s)) os = 'windows';
  else if (/CrOS/i.test(s)) os = 'chromeos';
  else if (/Mac OS X|Macintosh/i.test(s)) os = 'macos';
  else if (/Linux/i.test(s)) os = 'linux';
  let device = 'desktop';
  if (/iPad|Tablet/i.test(s) || (/Android/i.test(s) && !/Mobile/i.test(s))) device = 'tablet';
  else if (/Mobi|iPhone|iPod/i.test(s)) device = 'mobile';
  const browsers = [
    [/Instagram/i, 'Instagram'], [/FBAN|FBAV|FB_IAB/i, 'Facebook'], [/Snapchat/i, 'Snapchat'],
    [/TikTok|musical_ly|BytedanceWebview/i, 'TikTok'], [/LinkedInApp/i, 'LinkedIn'],
    [/MicroMessenger/i, 'WeChat'], [/SamsungBrowser/i, 'Samsung Internet'], [/EdgA?\/|EdgiOS|Edg\//i, 'Edge'],
    [/OPR\/|Opera/i, 'Opera'], [/Firefox|FxiOS/i, 'Firefox'], [/CriOS|Chrome\//i, 'Chrome'],
    [/Version\/.*Safari|Safari\//i, 'Safari']
  ];
  let browser = 'other';
  for (const [re, name] of browsers) {
    if (re.test(s)) { browser = name; break; }
  }
  return { os, device, browser };
}

function meta(request, mode) {
  const h = request.headers;
  const ua = h.get('user-agent') || '';
  const p = parseUA(ua);
  let city = h.get('x-vercel-ip-city') || '';
  try { city = decodeURIComponent(city); } catch (e) { /* keep raw */ }
  return {
    mode,
    ua,
    ip: (h.get('x-real-ip') || (h.get('x-forwarded-for') || '').split(',')[0] || '').trim(),
    country: h.get('x-vercel-ip-country') || '',
    region: h.get('x-vercel-ip-country-region') || '',
    city,
    os: p.os,
    device: p.device,
    browser: p.browser,
    lang: ((h.get('accept-language') || '').split(',')[0] || '').trim().toLowerCase().slice(0, 8),
    referer: (h.get('referer') || '').slice(0, 300)
  };
}

async function rpc(fn, body) {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`${fn} answered ${res.status}`);
  return res.json();
}

/* where the visitor goes next, for every answer the database can give */
function nextFor(res, slug, origin) {
  if (res.status === 'redirect') return res.url;
  if (res.status === 'page') return `${origin}/scan.html?s=${encodeURIComponent(slug)}#${res.token}`;
  const q = new URLSearchParams({ s: slug, e: res.status || 'error' });
  if (res.title) q.set('t', String(res.title).slice(0, 80));
  if (res.starts_at) q.set('at', res.starts_at);
  if (res.expires_at) q.set('at', res.expires_at);
  return `${origin}/scan.html?${q}`;
}

const redirect = (location, status = 302) =>
  new Response(null, { status, headers: { ...NO_STORE, Location: location } });

const json = obj =>
  new Response(JSON.stringify(obj), { status: 200, headers: { ...NO_STORE, 'Content-Type': 'application/json; charset=utf-8' } });

const html = (body, status = 200) =>
  new Response(body, { status, headers: { ...NO_STORE, 'Content-Type': 'text/html; charset=utf-8' } });

/* link previews (WhatsApp, iMessage, Slack…) see this and nothing is counted */
function botPage() {
  return html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex">
<title>QR code · dump.yanikroesti.ch</title>
<meta property="og:title" content="QR code">
<meta property="og:description" content="Open this link on your phone to see what's behind the code.">
<meta property="og:site_name" content="dump.yanikroesti.ch"></head>
<body><p>Open this link on your phone.</p></body></html>`);
}

/* codes with a scan limit: only a real browser that runs this script (or
   presses the button) gets counted — preview fetchers never do either */
function handshake(slug) {
  return html(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Opening…</title>
<style>html,body{margin:0;height:100%;background:#0d0d0d;color:#f0f0f0;font:15px/1.5 ui-monospace,Menlo,Consolas,monospace}
main{min-height:100%;display:grid;place-items:center;text-align:center;padding:24px;box-sizing:border-box}
p{color:#9a9a93;letter-spacing:.2em;text-transform:uppercase;font-size:12px}
button{background:#e8ff00;color:#000;border:0;padding:15px 24px;font:800 15px/1 system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;cursor:pointer}</style></head>
<body><main><form method="post" action="/api/q"><input type="hidden" name="slug" value="${slug}">
<p>opening…</p><noscript><button type="submit">Open</button></noscript></form></main>
<script>
fetch('/api/q',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:${JSON.stringify(slug)}})})
.then(function(r){return r.json()})
.then(function(j){if(j&&j.next){location.replace(j.next)}else{document.forms[0].submit()}})
.catch(function(){document.forms[0].submit()});
</script></body></html>`);
}

export async function GET(request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const slug = (url.searchParams.get('slug') || '').trim();
  if (!SLUG.test(slug)) return redirect(`${origin}/scan.html?e=notfound`);

  const ua = request.headers.get('user-agent') || '';
  const purpose = request.headers.get('sec-purpose') || request.headers.get('purpose') || '';
  if (!ua || BOT.test(ua) || /prefetch|prerender/i.test(purpose)) return botPage();

  let res;
  try {
    res = await rpc('qr_hit', { p_slug: slug, p_meta: meta(request, 'get') });
  } catch (e) {
    return redirect(`${origin}/scan.html?s=${encodeURIComponent(slug)}&e=error`);
  }
  if (res.status === 'confirm') return handshake(slug);
  return redirect(nextFor(res, slug, origin));
}

export async function HEAD() {
  return new Response(null, { status: 200, headers: NO_STORE });
}

export async function POST(request) {
  const url = new URL(request.url);
  const type = request.headers.get('content-type') || '';
  const wantsJSON = type.includes('application/json');
  let body = {};
  try {
    if (wantsJSON) body = await request.json();
    else body = Object.fromEntries((await request.formData()).entries());
  } catch (e) { body = {}; }

  const slug = String(body.slug || '').trim();
  if (!SLUG.test(slug)) {
    const next = `${url.origin}/scan.html?e=notfound`;
    return wantsJSON ? json({ status: 'notfound', next }) : redirect(next, 303);
  }

  let res;
  try {
    res = body.password != null
      ? await rpc('qr_unlock', { p_slug: slug, p_password: String(body.password), p_meta: meta(request, 'confirm') })
      : await rpc('qr_hit', { p_slug: slug, p_meta: meta(request, 'confirm') });
  } catch (e) {
    res = { status: 'error' };
  }
  const next = nextFor(res, slug, url.origin);
  return wantsJSON ? json({ status: res.status, next }) : redirect(next, 303);
}
