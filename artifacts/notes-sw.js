// Desktop Note web app: keeps the app shell cached so the notes open offline (the notes themselves live in
// localStorage). Data calls to Supabase always go to the network.
const CACHE = 'notes-v1';
const SHELL = [
  'notes.html', 'notes/app.js', 'notes/style.css', 'notes/manifest.webmanifest',
  'notes/icon-192.png', 'notes/apple-touch-icon.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.min.js',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('notes-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Network first for our own files (so updates show up at once), cache when offline.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const ours = url.origin === location.origin && /\/artifacts\/notes/.test(url.pathname);
  const lib = url.href.startsWith('https://cdn.jsdelivr.net/npm/@supabase/');
  if (!ours && !lib) return;
  if (lib) { e.respondWith(caches.match(req).then((r) => r || fetch(req))); return; }
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true })));
});
