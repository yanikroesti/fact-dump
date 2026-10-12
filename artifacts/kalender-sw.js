// Zäme service worker: shows push notifications and opens the calendar when one is tapped.
// No offline caching on purpose: the calendar must always show the current state.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: 'Zäme', body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || 'Zäme', {
    body: data.body || '',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    icon: 'kalender/icon-192.png',
    badge: 'kalender/badge-72.png',
    data: { url: data.url || 'kalender.html' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || 'kalender.html', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.includes('/kalender')) {
        await w.focus();
        w.postMessage({ type: 'open', url });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
