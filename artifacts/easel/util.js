/* Easel — shared helpers: DOM, popovers, modals, colours, presets, fonts */
window.EZ = window.EZ || {};
(() => {
const EZ = window.EZ;

EZ.ACCENT = '#ff5c35';

// fabric 5.3 sets ctx.textBaseline = 'alphabetical' (invalid → console spam); map it to 'alphabetic'.
(() => {
  const d = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'textBaseline');
  if (!d?.set) return;
  Object.defineProperty(CanvasRenderingContext2D.prototype, 'textBaseline', {
    configurable: true, get() { return d.get.call(this); }, set(v) { d.set.call(this, v === 'alphabetical' ? 'alphabetic' : v); },
  });
})();
EZ.$ = (s, r = document) => r.querySelector(s);
EZ.$$ = (s, r = document) => [...r.querySelectorAll(s)];
EZ.uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);
EZ.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
EZ.round = (v, d = 0) => { const k = 10 ** d; return Math.round(v * k) / k; };
EZ.sleep = ms => new Promise(r => setTimeout(r, ms));
EZ.debounce = (fn, ms) => {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
};
EZ.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// h('div', {class, style, onclick, ...}, ...children)
EZ.h = (tag, attrs, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
};
// UI icons come from the bundled Lucide subset (ui-icons.js) — no network requests.
EZ.icon = (name, cls = '') => {
  const body = EZ.UI_ICONS?.icons[name];
  const [w, hh] = EZ.UI_ICONS?.size || [24, 24];
  const t = document.createElement('template');
  t.innerHTML = `<svg class="ic ${cls}" viewBox="0 0 ${w} ${hh}" aria-hidden="true">${body || ''}</svg>`;
  if (!body) console.warn('missing UI icon', name);
  return t.content.firstChild;
};
EZ.hydrateIcons = (root = document) => {
  for (const el of root.querySelectorAll('i[data-ic]')) {
    const cls = [...el.classList].filter(c => c !== 'ic').join(' ');
    el.replaceWith(EZ.icon(el.dataset.ic, cls));
  }
};

/* ── Iconify API (icons, stickers, logos in the Elements panel) ──
   Uses the batch JSON endpoint (one request per icon set) and Iconify's official mirror hosts. */
const ICONIFY_HOSTS = ['https://api.iconify.design', 'https://api.simplesvg.com', 'https://api.unisvg.com'];
EZ.iconifyFetch = async path => {
  let err;
  for (const host of ICONIFY_HOSTS) {
    try { const r = await fetch(host + path); if (r.ok) return r.json(); err = new Error('HTTP ' + r.status); }
    catch (e) { err = e; }
  }
  throw err;
};
const iconData = new Map(), iconPending = new Map();
EZ.loadIcons = async ids => {
  const byPre = {};
  for (const id of new Set(ids)) {
    if (iconData.has(id) || iconPending.has(id)) continue;
    const [p, n] = id.split(':');
    (byPre[p] ||= []).push(n);
  }
  for (const [p, names] of Object.entries(byPre)) {
    for (let i = 0; i < names.length; i += 100) {
      const chunk = names.slice(i, i + 100);
      const job = EZ.iconifyFetch(`/${p}.json?icons=${chunk.join(',')}`).then(d => {
        for (const n of chunk) {
          let ic = d.icons?.[n];
          const alias = d.aliases?.[n];
          if (!ic && alias) ic = { ...d.icons?.[alias.parent], ...alias };
          if (!ic?.body) continue;
          iconData.set(`${p}:${n}`, { body: ic.body, left: ic.left ?? d.left ?? 0, top: ic.top ?? d.top ?? 0, width: ic.width ?? d.width ?? 16, height: ic.height ?? d.height ?? 16 });
        }
      }).finally(() => chunk.forEach(n => iconPending.delete(`${p}:${n}`)));
      chunk.forEach(n => iconPending.set(`${p}:${n}`, job));
    }
  }
  await Promise.allSettled(ids.map(id => iconPending.get(id)).filter(Boolean));
};
EZ.iconSvg = (id, color) => {
  const d = iconData.get(id);
  if (!d) return null;
  const body = color ? d.body.replace(/currentColor/g, color) : d.body;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${d.width}" height="${d.height}" viewBox="${d.left} ${d.top} ${d.width} ${d.height}">${body}</svg>`;
};
EZ.iconDataUrl = (id, color) => { const s = EZ.iconSvg(id, color); return s ? 'data:image/svg+xml;utf8,' + encodeURIComponent(s) : ''; };

/* ── toast ── */
EZ.toast = (msg, opts = {}) => {
  const el = EZ.h('div', { class: 'toast' + (opts.err ? ' err' : '') }, opts.icon ? EZ.icon(opts.icon, 'sm') : null, msg);
  EZ.$('#toasts').append(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = 0; setTimeout(() => el.remove(), 300); }, opts.ms || 2400);
};

/* ── busy overlay ── */
EZ.busy = (title, sub = '') => {
  let el = EZ.$('.busy');
  if (!el) {
    el = EZ.h('div', { class: 'busy' }, EZ.h('div', { class: 'card' }, EZ.h('b'), EZ.h('small'), EZ.h('div', { class: 'pbar indet' }, EZ.h('i'))));
    document.body.append(el);
  }
  EZ.$('b', el).textContent = title;
  EZ.$('small', el).textContent = sub;
  return {
    set(t, s, pct) {
      if (t != null) EZ.$('b', el).textContent = t;
      if (s != null) EZ.$('small', el).textContent = s;
      const bar = EZ.$('.pbar', el);
      if (pct == null) { bar.classList.add('indet'); EZ.$('i', bar).style.width = ''; }
      else { bar.classList.remove('indet'); EZ.$('i', bar).style.width = EZ.clamp(pct, 0, 100) + '%'; }
    },
    close() { el.remove(); },
  };
};

/* ── popover ── */
let openPop = null;
EZ.closePop = () => { if (openPop) { const p = openPop; openPop = null; p.el.remove(); p.onClose?.(); } };
// anchor: element or {x,y}; content: element; returns pop element
EZ.pop = (anchor, content, opts = {}) => {
  const same = openPop && openPop.anchor === anchor && anchor instanceof Element && !opts.keep;
  EZ.closePop();
  if (same && !opts.force) return null; // toggle
  const el = EZ.h('div', { class: 'pop' + (opts.cls ? ' ' + opts.cls : '') }, content);
  if (opts.width) el.style.width = opts.width + 'px';
  document.body.append(el);
  const place = () => {
    const pw = el.offsetWidth, ph = el.offsetHeight;
    let x, y;
    if (anchor instanceof Element) {
      const r = anchor.getBoundingClientRect();
      x = opts.align === 'right' ? r.right - pw : r.left;
      y = r.bottom + 6;
      if (y + ph > innerHeight - 8) y = Math.max(8, r.top - ph - 6);
    } else { x = anchor.x; y = anchor.y; if (y + ph > innerHeight - 8) y = Math.max(8, innerHeight - ph - 8); }
    x = EZ.clamp(x, 8, innerWidth - pw - 8);
    el.style.left = x + 'px'; el.style.top = y + 'px';
  };
  place();
  openPop = { el, anchor, onClose: opts.onClose, place };
  return el;
};
document.addEventListener('pointerdown', e => {
  if (!openPop) return;
  if (openPop.el.contains(e.target)) return;
  if (openPop.anchor instanceof Element && openPop.anchor.contains(e.target)) return;
  EZ.closePop();
}, true);
addEventListener('resize', () => EZ.closePop());

// menu: items [{label, icon, kbd, run, disabled} | '-']
EZ.menu = (anchor, items, opts = {}) => {
  const box = EZ.h('div');
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { box.append(EZ.h('hr')); continue; }
    box.append(EZ.h('button', {
      disabled: !!it.disabled,
      onclick: () => { EZ.closePop(); it.run(); },
    }, it.icon ? EZ.icon(it.icon) : EZ.h('i', { class: 'ic', style: { background: 'none' } }), it.label, it.kbd ? EZ.h('kbd', {}, it.kbd) : null));
  }
  return EZ.pop(anchor, box, { cls: 'menu', ...opts });
};

/* ── modal ── */
EZ.modal = (build, opts = {}) => new Promise(resolve => {
  const bg = EZ.h('div', { class: 'modal-bg' });
  const box = EZ.h('div', { class: 'modal' });
  if (opts.width) box.style.width = `min(${opts.width}px, 100%)`;
  bg.append(box);
  const close = v => { bg.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(undefined); } };
  document.addEventListener('keydown', onKey, true);
  bg.addEventListener('pointerdown', e => { if (e.target === bg) close(undefined); });
  build(box, close);
  document.body.append(bg);
  EZ.$('input, textarea, select', box)?.focus();
});
EZ.confirm = (title, text, okLabel = 'OK', danger = false) => EZ.modal((box, close) => {
  box.append(EZ.h('h3', {}, title), EZ.h('p', {}, text),
    EZ.h('div', { class: 'actions' },
      EZ.h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'),
      EZ.h('button', { class: 'btn ' + (danger ? 'danger' : 'pri'), onclick: () => close(true) }, okLabel)));
}).then(v => !!v);
EZ.prompt = (title, value = '', okLabel = 'Save') => EZ.modal((box, close) => {
  const inp = EZ.h('input', { class: 'inp', value });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') close(inp.value); });
  box.append(EZ.h('h3', {}, title), inp,
    EZ.h('div', { class: 'actions' },
      EZ.h('button', { class: 'btn', onclick: () => close(null) }, 'Cancel'),
      EZ.h('button', { class: 'btn pri', onclick: () => close(inp.value) }, okLabel)));
  setTimeout(() => inp.select(), 0);
});

/* ── colours ── */
EZ.PALETTE = [
  '#000000', '#545454', '#737373', '#a6a6a6', '#d9d9d9', '#ffffff', '#ff3131',
  '#ff5757', '#ff66c4', '#cb6ce6', '#8c52ff', '#5e17eb', '#0097b2', '#0cc0df',
  '#5ce1e6', '#38b6ff', '#5271ff', '#004aad', '#00bf63', '#7ed957', '#c1ff72',
  '#ffde59', '#ffbd59', '#ff914d', '#ff5c35', '#8b4513', '#1b1a24', '#f6efe6',
];
EZ.GRADIENTS = [
  ['#ff5c35', '#ffb03a'], ['#8c52ff', '#ff66c4'], ['#0cc0df', '#5e17eb'], ['#00bf63', '#c1ff72'],
  ['#ff3131', '#ff914d'], ['#1b1a24', '#5e17eb'], ['#ffde59', '#ff66c4'], ['#38b6ff', '#00bf63'],
  ['#000000', '#545454'], ['#f6efe6', '#ffbd59'], ['#5271ff', '#5ce1e6'], ['#ff66c4', '#ffde59'],
];
EZ.recentColors = (() => { try { return JSON.parse(localStorage.getItem('easel.recentColors') || '[]'); } catch { return []; } })();
EZ.pushRecent = c => {
  if (!c || typeof c !== 'string') return;
  c = c.toLowerCase();
  EZ.recentColors = [c, ...EZ.recentColors.filter(x => x !== c)].slice(0, 14);
  try { localStorage.setItem('easel.recentColors', JSON.stringify(EZ.recentColors)); } catch {}
};
EZ.toHex = c => {
  if (!c || typeof c !== 'string' || c === 'transparent') return '#000000';
  try { return '#' + new fabric.Color(c).toHex().toLowerCase(); } catch { return '#000000'; }
};
// CSS for a fabric fill (string or Gradient) — used for swatch previews
EZ.fillCss = f => {
  if (!f) return 'transparent';
  if (typeof f === 'string') return f;
  if (f.colorStops) {
    const stops = [...f.colorStops].sort((a, b) => a.offset - b.offset).map(s => `${s.color} ${Math.round(s.offset * 100)}%`).join(', ');
    return f.type === 'radial' ? `radial-gradient(${stops})` : `linear-gradient(135deg, ${stops})`;
  }
  return '#ccc';
};

// Colour popover. current: string|gradient, onPick(value, final) — value is a hex string or
// {gradient:[c1,c2], type:'linear'|'radial'}. opts: {gradients, none, title}
EZ.colorPop = (anchor, current, onPick, opts = {}) => {
  const box = EZ.h('div');
  const cur = typeof current === 'string' ? current.toLowerCase() : null;
  const sw = (c, extra = {}) => EZ.h('button', {
    class: 'sw' + (extra.sq ? ' sq' : '') + (cur && c.toLowerCase?.() === cur ? ' on' : ''),
    title: c, style: { background: c }, onclick: () => { EZ.pushRecent(c); onPick(c, true); EZ.closePop(); },
  });
  // custom picker
  const input = EZ.h('input', { type: 'color', value: EZ.toHex(cur || '#000000'), style: { position: 'absolute', opacity: 0, width: 0, height: 0 } });
  input.addEventListener('input', () => { onPick(input.value, false); hex.value = input.value; });
  input.addEventListener('change', () => { EZ.pushRecent(input.value); onPick(input.value, true); });
  const hex = EZ.h('input', { class: 'inp', value: cur && cur.startsWith('#') ? cur : EZ.toHex(cur), style: { width: '110px', fontFamily: 'monospace' } });
  hex.addEventListener('change', () => {
    let v = hex.value.trim(); if (!v.startsWith('#')) v = '#' + v;
    if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) { EZ.pushRecent(v); onPick(v, true); }
  });
  const eyedrop = window.EyeDropper ? EZ.h('button', { class: 'cb', title: 'Pick a colour from the screen', onclick: async () => {
    try { const r = await new EyeDropper().open(); hex.value = r.sRGBHex; EZ.pushRecent(r.sRGBHex); onPick(r.sRGBHex, true); } catch {}
  } }, EZ.icon('pipette')) : null;

  box.append(EZ.h('h4', {}, opts.title || 'Colour'));
  const top = EZ.h('div', { class: 'swatches' });
  top.append(EZ.h('button', { class: 'sw add', title: 'Custom colour', onclick: () => input.click() }, EZ.icon('plus')));
  if (opts.none) top.append(EZ.h('button', { class: 'sw none', title: 'None', onclick: () => { onPick(null, true); EZ.closePop(); } }));
  for (const c of EZ.recentColors.slice(0, opts.none ? 12 : 13)) top.append(sw(c));
  box.append(top, input);

  const doc = EZ.documentColors?.() || [];
  if (doc.length) {
    box.append(EZ.h('h4', {}, 'In this design'));
    const g = EZ.h('div', { class: 'swatches' });
    doc.slice(0, 14).forEach(c => g.append(sw(c)));
    box.append(g);
  }
  box.append(EZ.h('h4', {}, 'Default colours'));
  const g = EZ.h('div', { class: 'swatches' });
  EZ.PALETTE.forEach(c => g.append(sw(c)));
  box.append(g);
  if (opts.gradients) {
    box.append(EZ.h('h4', {}, 'Gradients'));
    const gg = EZ.h('div', { class: 'swatches' });
    EZ.GRADIENTS.forEach(([a, b], i) => gg.append(EZ.h('button', {
      class: 'sw', style: { background: i % 3 === 2 ? `radial-gradient(${a}, ${b})` : `linear-gradient(135deg, ${a}, ${b})` },
      onclick: () => { onPick({ gradient: [a, b], type: i % 3 === 2 ? 'radial' : 'linear' }, true); EZ.closePop(); },
    })));
    box.append(gg);
  }
  box.append(EZ.h('div', { class: 'row', style: { marginTop: '4px' } }, hex, eyedrop));
  return EZ.pop(anchor, box, { width: 268 });
};

/* ── design presets ── */
const mm = v => Math.round(v / 25.4 * 96);
EZ.mm = mm;
EZ.UNIT_PX = { px: 1, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };
EZ.PRESETS = [
  { id: 'ig-post', name: 'Instagram post', sub: '1080 × 1080', w: 1080, h: 1080, cat: 'social' },
  { id: 'ig-portrait', name: 'Portrait post', sub: '1080 × 1350', w: 1080, h: 1350, cat: 'social' },
  { id: 'story', name: 'Story / Reel', sub: '1080 × 1920', w: 1080, h: 1920, cat: 'social' },
  { id: 'yt', name: 'YouTube thumbnail', sub: '1280 × 720', w: 1280, h: 720, cat: 'social' },
  { id: 'x-post', name: 'X / LinkedIn post', sub: '1600 × 900', w: 1600, h: 900, cat: 'social' },
  { id: 'slides', name: 'Presentation', sub: '16:9 · 1920 × 1080', w: 1920, h: 1080, cat: 'slides' },
  { id: 'slides43', name: 'Presentation 4:3', sub: '1024 × 768', w: 1024, h: 768, cat: 'slides' },
  { id: 'a4', name: 'A4 document', sub: '210 × 297 mm', w: mm(210), h: mm(297), mm: [210, 297], cat: 'print' },
  { id: 'a4l', name: 'A4 landscape', sub: '297 × 210 mm', w: mm(297), h: mm(210), mm: [297, 210], cat: 'print' },
  { id: 'a5', name: 'A5 flyer', sub: '148 × 210 mm', w: mm(148), h: mm(210), mm: [148, 210], cat: 'print' },
  { id: 'a3', name: 'A3 poster', sub: '297 × 420 mm', w: mm(297), h: mm(420), mm: [297, 420], cat: 'print' },
  { id: 'card', name: 'Business card', sub: '85 × 55 mm', w: mm(85), h: mm(55), mm: [85, 55], cat: 'print' },
  { id: 'worksheet', name: 'Worksheet', sub: 'A4 · school', w: mm(210), h: mm(297), mm: [210, 297], cat: 'school' },
  { id: 'infographic', name: 'Infographic', sub: '800 × 2000', w: 800, h: 2000, cat: 'school' },
  { id: 'logo', name: 'Logo', sub: '500 × 500', w: 500, h: 500, cat: 'social' },
];

/* ── fonts (all loaded by the stylesheet in easel.html) ── */
EZ.FONTS = [
  // [family, category]
  ['Inter', 'Sans'], ['Poppins', 'Sans'], ['Montserrat', 'Sans'], ['Roboto', 'Sans'], ['Open Sans', 'Sans'],
  ['Lato', 'Sans'], ['Raleway', 'Sans'], ['Nunito', 'Sans'], ['Rubik', 'Sans'], ['Josefin Sans', 'Sans'],
  ['Space Grotesk', 'Sans'], ['Bricolage Grotesque', 'Sans'], ['Syne', 'Sans'], ['Quicksand', 'Sans'],
  ['Comfortaa', 'Sans'], ['Fredoka', 'Sans'],
  ['Oswald', 'Display'], ['Bebas Neue', 'Display'], ['Anton', 'Display'], ['Archivo Black', 'Display'],
  ['Abril Fatface', 'Display'], ['Alfa Slab One', 'Display'], ['Titan One', 'Display'], ['Righteous', 'Display'],
  ['Bungee', 'Display'], ['Luckiest Guy', 'Display'], ['Press Start 2P', 'Display'],
  ['Playfair Display', 'Serif'], ['Merriweather', 'Serif'], ['Lora', 'Serif'], ['Cormorant Garamond', 'Serif'],
  ['Fraunces', 'Serif'], ['DM Serif Display', 'Serif'],
  ['Pacifico', 'Script'], ['Lobster', 'Script'], ['Dancing Script', 'Script'], ['Great Vibes', 'Script'],
  ['Caveat', 'Handwriting'], ['Permanent Marker', 'Handwriting'], ['Shadows Into Light', 'Handwriting'],
  ['Space Mono', 'Mono'], ['IBM Plex Mono', 'Mono'],
];
const fontCache = new Map();
EZ.loadFont = (family, weight = 400, style = 'normal') => {
  if (!family) return Promise.resolve();
  const key = `${style} ${weight} ${family}`;
  if (!fontCache.has(key)) {
    fontCache.set(key, document.fonts.load(`${style} ${weight} 40px "${family}"`).catch(() => {}).then(() => {
      fabric.util.clearFabricFontCache(family);
    }));
  }
  return fontCache.get(key);
};
// Preload every font face referenced in serialized objects.
EZ.loadFontsIn = json => {
  const jobs = [];
  const walk = o => {
    if (!o) return;
    if (o.fontFamily) jobs.push(EZ.loadFont(o.fontFamily, o.fontWeight || 400, o.fontStyle || 'normal'));
    (o.objects || []).forEach(walk);
  };
  (json?.objects || []).forEach(walk);
  return Promise.all(jobs);
};

/* ── misc ── */
EZ.readFileAsDataURL = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
EZ.blobToDataURL = EZ.readFileAsDataURL;
EZ.dataURLtoBlob = async u => (await fetch(u)).blob();
EZ.download = (blob, name) => {
  const a = EZ.h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};
EZ.slug = s => (s || 'design').toLowerCase().replace(/[^a-z0-9äöüß]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'design';
EZ.timeAgo = t => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  if (s < 86400 * 7) return Math.floor(s / 86400) + ' d ago';
  return new Date(t).toLocaleDateString('de-CH');
};
EZ.isTyping = () => {
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) return true;
  const o = EZ.cv?.getActiveObject();
  return !!(o && o.isEditing);
};
})();
