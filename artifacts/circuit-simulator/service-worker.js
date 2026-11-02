// The app registers service-worker.js on load. Offline caching is not used on dump,
// so this worker only takes over and clears caches left by older copies.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
