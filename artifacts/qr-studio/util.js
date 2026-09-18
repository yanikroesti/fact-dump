/* QR Studio · util.js — small helpers every other module leans on. */
(function () {
  'use strict';
  const QS = (window.QS = window.QS || {});

  const CDN = {
    qrcode: 'https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/dist/qrcode.js',
    jsqr: 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
    opentype: 'https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/dist/opentype.min.js',
    jspdf: 'https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js',
    svg2pdf: 'https://cdn.jsdelivr.net/npm/svg2pdf.js@2.8.1/dist/svg2pdf.umd.min.js',
    jszip: 'https://cdn.jsdelivr.net/npm/jszip@3.10.2/dist/jszip.min.js',
    supabase: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.min.js',
    icon: slug => `https://cdn.jsdelivr.net/npm/simple-icons@16.31.0/icons/${slug}.svg`
  };

  const scripts = new Map();
  /* One loader for every CDN dependency: each URL is fetched at most once and
     everything that asked for it waits on the same promise. */
  function loadScript(url) {
    if (!scripts.has(url)) {
      scripts.set(url, new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => { scripts.delete(url); reject(new Error('Could not load ' + url)); };
        document.head.appendChild(s);
      }));
    }
    return scripts.get(url);
  }

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function debounce(fn, ms) {
    let t;
    const wrapped = function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
    wrapped.cancel = () => clearTimeout(t);
    return wrapped;
  }

  function throttle(fn, ms) {
    let last = 0, timer = null, lastArgs;
    return function (...a) {
      lastArgs = a;
      const now = Date.now();
      if (now - last >= ms) { last = now; fn.apply(this, a); }
      else if (!timer) {
        timer = setTimeout(() => { timer = null; last = Date.now(); fn.apply(this, lastArgs); }, ms - (now - last));
      }
    };
  }

  const uid = (p = 'i') => p + Math.random().toString(36).slice(2, 9);

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  const readFile = (file, as = 'dataURL') => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error || new Error('Could not read the file'));
    if (as === 'text') fr.readAsText(file);
    else if (as === 'buffer') fr.readAsArrayBuffer(file);
    else fr.readAsDataURL(file);
  });

  const loadImage = src => new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load that image'));
    img.src = src;
  });

  /* Shrink big photos before they become logos or uploads: keeps QR designs
     under the size cap and uploads off the storage quota. */
  async function shrinkImage(file, { max = 1600, quality = 0.85, mime } = {}) {
    if (!/^image\//.test(file.type) || /svg|gif/.test(file.type)) return { blob: file, dataURL: null };
    const dataURL = await readFile(file);
    const img = await loadImage(dataURL);
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale === 1 && file.size < 400 * 1024) return { blob: file, dataURL, width: img.naturalWidth, height: img.naturalHeight };
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const out = mime || (/png/.test(file.type) ? 'image/png' : 'image/jpeg');
    const blob = await new Promise(res => cv.toBlob(res, out, quality));
    return { blob: blob || file, dataURL: cv.toDataURL(out, quality), width: w, height: h };
  }

  const blobToDataURL = blob => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });

  /* URL-safe base64 both ways, used for the "share this design" link. */
  function b64encode(bytes) {
    let s = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64decode(str) {
    const s = str.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '==='.slice((s.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function packState(obj) {
    const json = new TextEncoder().encode(JSON.stringify(obj));
    if (typeof CompressionStream === 'function') {
      try {
        const cs = new CompressionStream('deflate-raw');
        const buf = await new Response(new Blob([json]).stream().pipeThrough(cs)).arrayBuffer();
        return 'z' + b64encode(new Uint8Array(buf));
      } catch (e) { /* fall through to plain */ }
    }
    return 'p' + b64encode(json);
  }

  async function unpackState(str) {
    if (!str) return null;
    const mode = str[0], body = b64decode(str.slice(1));
    let bytes = body;
    if (mode === 'z') {
      const ds = new DecompressionStream('deflate-raw');
      const buf = await new Response(new Blob([body]).stream().pipeThrough(ds)).arrayBuffer();
      bytes = new Uint8Array(buf);
    } else if (mode !== 'p') return null;
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  /* localStorage that never throws — private mode just forgets. */
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
    },
    del(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }
  };

  /* ── colour maths (contrast checks, gradient mixing, theming) ── */
  function parseColor(c) {
    if (!c) return { r: 0, g: 0, b: 0, a: 1 };
    const s = String(c).trim();
    let m = /^#([0-9a-f]{3,8})$/i.exec(s);
    if (m) {
      let h = m[1];
      if (h.length === 3 || h.length === 4) h = h.split('').map(x => x + x).join('');
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
      };
    }
    m = /^rgba?\(([^)]+)\)$/i.exec(s);
    if (m) {
      const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      return { r: p[0] || 0, g: p[1] || 0, b: p[2] || 0, a: p.length > 3 ? p[3] : 1 };
    }
    return { r: 0, g: 0, b: 0, a: 1 };
  }
  const hex = ({ r, g, b }) => '#' + [r, g, b].map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
  function luminance(c) {
    const p = parseColor(c);
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(p.r) + 0.7152 * f(p.g) + 0.0722 * f(p.b);
  }
  function contrast(a, b) {
    const l1 = luminance(a), l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  function mix(a, b, t) {
    const x = parseColor(a), y = parseColor(b);
    return hex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
  }

  /* ── formatting ── */
  const pad2 = n => String(n).padStart(2, '0');
  function bytesHuman(n) {
    if (n == null) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }
  function dateTime(iso, opts) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleString(undefined, opts || { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function ago(iso) {
    if (!iso) return 'never';
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 2592000) return Math.floor(s / 86400) + ' d ago';
    return dateTime(iso, { day: '2-digit', month: 'short', year: 'numeric' });
  }
  /* datetime-local <-> ISO, keeping the browser's own timezone */
  function toLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  const fromLocalInput = v => (v ? new Date(v).toISOString() : null);

  function csvEscape(v) {
    const s = v == null ? '' : String(v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const toCSV = (rows, headers) => [headers.map(csvEscape).join(','), ...rows.map(r => r.map(csvEscape).join(','))].join('\r\n');

  /* Tolerant CSV reader: comma, semicolon or tab, quotes and CRLF all handled. */
  function parseCSV(text) {
    const src = String(text || '').replace(/^﻿/, '');
    const head = src.slice(0, src.indexOf('\n') > 0 ? src.indexOf('\n') : src.length);
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let q = false;
    for (const ch of head) {
      if (ch === '"') q = !q;
      else if (!q && counts[ch] != null) counts[ch]++;
    }
    const sep = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || ',';
    const rows = [];
    let row = [], cell = '', inQ = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (inQ) {
        if (ch === '"') {
          if (src[i + 1] === '"') { cell += '"'; i++; }
          else inQ = false;
        } else cell += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (ch !== '\r') cell += ch;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => String(c).trim() !== ''));
  }

  function slugify(s, fallback = 'qr') {
    const out = String(s || '').toLowerCase()
      .replace(/[äàáâã]/g, 'a').replace(/[öòóô]/g, 'o').replace(/[üùúû]/g, 'u')
      .replace(/[éèêë]/g, 'e').replace(/[ç]/g, 'c').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return out || fallback;
  }

  QS.CDN = CDN;
  QS.util = {
    loadScript, esc, debounce, throttle, uid, download, copyText, readFile, loadImage, shrinkImage,
    blobToDataURL, b64encode, b64decode, packState, unpackState, store,
    parseColor, hex, luminance, contrast, mix, bytesHuman, dateTime, ago, toLocalInput, fromLocalInput,
    toCSV, csvEscape, parseCSV, slugify, pad2
  };
})();
