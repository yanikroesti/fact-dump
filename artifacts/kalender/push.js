// Web push for Zäme. The service worker lives at /artifacts/kalender-sw.js with scope /artifacts/kalender
// (covers kalender.html and kalender/*). iPhones only allow push once Zäme is added to the home screen.

import * as api from './api.js';

const SW = 'kalender-sw.js';
const SCOPE = './kalender';

export const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const permission = () => (supported() ? Notification.permission : 'unsupported');

export async function register() {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register(SW, { scope: SCOPE }); }
  catch (e) { console.warn('sw', e); return null; }
}

export async function current() {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.getRegistration(SCOPE);
  return reg ? reg.pushManager.getSubscription() : null;
}

const keyBytes = (b64) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

export async function enable() {
  if (!supported()) throw new Error('push_unsupported');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('push_denied');
  await register();
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(await api.vapidKey()) });
  const j = sub.toJSON();
  await api.savePush(j.endpoint, j.keys.p256dh, j.keys.auth);
  return true;
}

export async function disable() {
  const sub = await current();
  if (!sub) return;
  try { await api.dropPush(sub.endpoint); } catch { /* row may be gone already */ }
  await sub.unsubscribe();
}
