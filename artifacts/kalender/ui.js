// Small DOM helpers: h() element builder, stacked sheets (bottom sheet on phones, dialog on desktop),
// toasts and confirm/choice prompts. The phone back button closes the top sheet.

import { t } from './i18n.js';

export function h(spec, attrs, ...children) {
  const [, tag = 'div', rest = ''] = spec.match(/^([a-z0-9]+)?(.*)$/i);
  const el = document.createElement(tag || 'div');
  for (const m of rest.matchAll(/([.#])([\w-]+)/g)) {
    if (m[1] === '.') el.classList.add(m[2]); else el.id = m[2];
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [p, val] of Object.entries(v)) {
        if (p.startsWith('--')) el.style.setProperty(p, val); else el.style[p] = val;
      }
    }
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

export const icon = (name) => h('span.ic', { 'aria-hidden': 'true', html: ICONS[name] || '' });
const ICONS = {
  bell: '<svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  repeat: '<svg viewBox="0 0 24 24"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/></svg>',
  sync: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  filter: '<svg viewBox="0 0 24 24"><path d="M3 5h18l-7 8.5V19l-4 2v-7.5z"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/></svg>',
};

// ---- sheets ----
const stack = [];
let popGuard = false;
window.addEventListener('popstate', () => {
  if (popGuard) { popGuard = false; return; }
  const top = stack[stack.length - 1];
  if (top) top.close(true);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && stack.length) stack[stack.length - 1].close();
});

export function sheet({ title, body, className = '', onClose, actions }) {
  const root = document.getElementById('sheets');
  const head = h('header.sheet-head',
    h('h2', title || ''),
    actions || null,
    h('button.icon-btn.sheet-x', { type: 'button', 'aria-label': t('close'), onclick: () => api.close() }, icon('x')));
  const content = h('div.sheet-body');
  const panel = h(`section.sheet${className ? '.' + className.split(' ').join('.') : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '' }, head, content);
  const scrim = h('div.scrim', { onclick: () => api.close() });
  const wrap = h('div.sheet-wrap', scrim, panel);
  root.append(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  history.pushState({ sheet: stack.length + 1 }, '');
  const api = {
    el: panel, body: content,
    setTitle: (s) => { head.querySelector('h2').textContent = s; },
    set: (...nodes) => { content.replaceChildren(...nodes.flat(Infinity).filter(Boolean)); },
    close(fromPop) {
      const i = stack.indexOf(api);
      if (i < 0) return;
      stack.splice(i, 1);
      wrap.classList.remove('open');
      setTimeout(() => wrap.remove(), 220);
      if (!fromPop) { popGuard = true; history.back(); }
      onClose?.();
    },
  };
  stack.push(api);
  if (body) api.set(body);
  setTimeout(() => panel.querySelector('[autofocus]')?.focus(), 60);
  return api;
}
export const closeAll = () => { while (stack.length) stack[stack.length - 1].close(); };
export const topSheet = () => stack[stack.length - 1];

// ---- toast ----
let toastTimer;
export function toast(msg, kind = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, kind === 'err' ? 5000 : 2600);
}
export const errToast = (e) => toast(t(String(e?.message || e)) || t('error'), 'err');

// ---- prompts ----
// resolve after the sheet's history entry is gone, so a sheet opened next gets a clean back-button entry
const settle = (resolve, v) => setTimeout(() => resolve(v), 80);
export function confirmBox(text, okLabel = t('ok'), danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const s = sheet({
      title: '', className: 'small',
      onClose: () => { if (!done) resolve(false); },
      body: [
        h('p.prompt', text),
        h('div.row.end',
          h('button.btn.ghost', { type: 'button', onclick: () => s.close() }, t('cancel')),
          h(`button.btn${danger ? '.danger' : '.primary'}`, { type: 'button', onclick: () => { done = true; s.close(); settle(resolve, true); } }, okLabel)),
      ],
    });
  });
}

export function choose(title, options) {
  return new Promise((resolve) => {
    let done = false;
    const s = sheet({
      title, className: 'small',
      onClose: () => { if (!done) resolve(null); },
      body: h('div.choices', options.map((o) => h(`button.btn.block${o.danger ? '.danger-soft' : ''}`, {
        type: 'button', onclick: () => { done = true; s.close(); settle(resolve, o.value); },
      }, o.label))),
    });
  });
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast(t('copied')); }
  catch { window.prompt(t('copy'), text); }
}
export async function shareText(text) {
  if (navigator.share) { try { await navigator.share({ text }); return; } catch { /* cancelled */ } }
  await copyText(text);
}
