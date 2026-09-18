/* QR Studio · engine.js
   The module matrix comes from qrcode-generator. Everything after that is ours:
   module shapes, finder "eyes", gradients, logos, frames with real vector text,
   and every export (SVG, PNG/JPEG/WEBP, PDF, EPS) plus the decode self-test.

   Geometry is done in module units (1 unit = one QR module) and only scaled at
   export time, so the same scene can become a 96px thumbnail or a 46mm vector
   payment slip without rounding drift. */
(function () {
  'use strict';
  const QS = (window.QS = window.QS || {});
  const U = QS.util;

  const K = 0.5522847498;                 /* cubic control offset for a quarter circle */
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const num = n => {
    const v = Math.round(n * 1000) / 1000;
    return Object.is(v, -0) ? '0' : String(v);
  };
  function hash32(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ─────────────────────────── path builder ───────────────────────────
     Only M / L / C / Z are ever emitted, which keeps the SVG, PDF and
     PostScript writers trivial — no arc flags to translate. */
  class Path {
    constructor() { this.d = []; }
    M(x, y) { this.d.push(['M', x, y]); return this; }
    L(x, y) { this.d.push(['L', x, y]); return this; }
    C(a, b, c, d, e, f) { this.d.push(['C', a, b, c, d, e, f]); return this; }
    Z() { this.d.push(['Z']); return this; }
    get empty() { return this.d.length === 0; }
    add(other) { for (const op of other.d) this.d.push(op); return this; }
    rect(x, y, w, h) { return this.M(x, y).L(x + w, y).L(x + w, y + h).L(x, y + h).Z(); }
    /* radii clockwise from top-left; each is clamped to the box */
    rrect(x, y, w, h, tl, tr, br, bl) {
      const m = Math.min(w, h) / 2;
      tl = clamp(tl || 0, 0, m); tr = clamp(tr || 0, 0, m);
      br = clamp(br || 0, 0, m); bl = clamp(bl || 0, 0, m);
      this.M(x + tl, y).L(x + w - tr, y);
      if (tr) this.C(x + w - tr + tr * K, y, x + w, y + tr - tr * K, x + w, y + tr);
      this.L(x + w, y + h - br);
      if (br) this.C(x + w, y + h - br + br * K, x + w - br + br * K, y + h, x + w - br, y + h);
      this.L(x + bl, y + h);
      if (bl) this.C(x + bl - bl * K, y + h, x, y + h - bl + bl * K, x, y + h - bl);
      this.L(x, y + tl);
      if (tl) this.C(x, y + tl - tl * K, x + tl - tl * K, y, x + tl, y);
      return this.Z();
    }
    circle(cx, cy, r) {
      const k = r * K;
      return this.M(cx + r, cy)
        .C(cx + r, cy + k, cx + k, cy + r, cx, cy + r)
        .C(cx - k, cy + r, cx - r, cy + k, cx - r, cy)
        .C(cx - r, cy - k, cx - k, cy - r, cx, cy - r)
        .C(cx + k, cy - r, cx + r, cy - k, cx + r, cy).Z();
    }
    poly(points) {
      points.forEach((p, i) => (i ? this.L(p[0], p[1]) : this.M(p[0], p[1])));
      return this.Z();
    }
    /* concave corner piece: fills the sharp inner angle of an L of modules */
    fillet(x, y, r, corner) {
      if (corner === 'tl') return this.M(x, y).L(x + r, y).C(x + r - r * K, y, x, y + r - r * K, x, y + r).Z();
      if (corner === 'tr') return this.M(x + 1, y).L(x + 1, y + r).C(x + 1, y + r - r * K, x + 1 - r + r * K, y, x + 1 - r, y).Z();
      if (corner === 'br') return this.M(x + 1, y + 1).L(x + 1 - r, y + 1).C(x + 1 - r + r * K, y + 1, x + 1, y + 1 - r + r * K, x + 1, y + 1 - r).Z();
      return this.M(x, y + 1).L(x, y + 1 - r).C(x, y + 1 - r + r * K, x + r - r * K, y + 1, x + r, y + 1).Z();
    }
    map(fn) {
      const p = new Path();
      for (const op of this.d) {
        if (op[0] === 'Z') { p.d.push(['Z']); continue; }
        const out = [op[0]];
        for (let i = 1; i < op.length; i += 2) {
          const pt = fn(op[i], op[i + 1]);
          out.push(pt[0], pt[1]);
        }
        p.d.push(out);
      }
      return p;
    }
    translate(dx, dy) { return this.map((x, y) => [x + dx, y + dy]); }
    rotate(a, cx = 0, cy = 0) {
      const s = Math.sin(a), c = Math.cos(a);
      return this.map((x, y) => {
        const dx = x - cx, dy = y - cy;
        return [cx + dx * c - dy * s, cy + dx * s + dy * c];
      });
    }
    toSVG(scale = 1) {
      let out = '';
      for (const op of this.d) {
        if (op[0] === 'Z') { out += 'Z'; continue; }
        out += op[0];
        for (let i = 1; i < op.length; i += 2) out += (i > 1 ? ' ' : '') + num(op[i] * scale) + ' ' + num(op[i + 1] * scale);
      }
      return out;
    }
    /* PostScript, y flipped because EPS counts from the bottom left */
    toPS(scale, height) {
      const X = v => num(v * scale);
      const Y = v => num(height - v * scale);
      let out = '';
      for (const op of this.d) {
        if (op[0] === 'M') out += `${X(op[1])} ${Y(op[2])} m\n`;
        else if (op[0] === 'L') out += `${X(op[1])} ${Y(op[2])} l\n`;
        else if (op[0] === 'C') out += `${X(op[1])} ${Y(op[2])} ${X(op[3])} ${Y(op[4])} ${X(op[5])} ${Y(op[6])} c\n`;
        else out += 'h\n';
      }
      return out;
    }
  }

  /* ───────────────────────── the matrix ───────────────────────── */
  const EC_ORDER = ['L', 'M', 'Q', 'H'];
  /* data codewords per version (1-40) × EC level — used for the capacity meter */
  const DATA_CODEWORDS = [
    [19, 16, 13, 9], [34, 28, 22, 16], [55, 44, 34, 26], [80, 64, 48, 36], [108, 86, 62, 46],
    [136, 108, 76, 60], [156, 124, 88, 66], [194, 154, 110, 86], [232, 182, 132, 100], [274, 216, 154, 122],
    [324, 254, 180, 140], [370, 290, 206, 158], [428, 334, 244, 180], [461, 365, 261, 197], [523, 415, 295, 223],
    [589, 453, 325, 253], [647, 507, 367, 283], [721, 563, 397, 313], [795, 627, 445, 341], [861, 669, 485, 385],
    [932, 714, 512, 406], [1006, 782, 568, 442], [1094, 860, 614, 464], [1174, 914, 664, 514], [1276, 1000, 718, 538],
    [1370, 1062, 754, 596], [1468, 1128, 808, 628], [1531, 1193, 871, 661], [1631, 1267, 911, 701], [1735, 1373, 985, 745],
    [1843, 1455, 1033, 793], [1955, 1541, 1115, 845], [2071, 1631, 1171, 901], [2191, 1725, 1231, 961], [2306, 1812, 1286, 986],
    [2434, 1914, 1354, 1054], [2566, 1992, 1426, 1096], [2702, 2102, 1502, 1142], [2812, 2216, 1582, 1222], [2956, 2334, 1666, 1276]
  ];
  const byteCapacity = (version, ec) => {
    const cw = DATA_CODEWORDS[version - 1][EC_ORDER.indexOf(ec)];
    return Math.floor((cw * 8 - 4 - (version < 10 ? 8 : 16)) / 8);
  };

  const utf8Length = s => new TextEncoder().encode(s).length;

  function pickMode(text) {
    if (/^\d+$/.test(text)) return 'Numeric';
    if (/^[0-9A-Z $%*+\-./:]+$/.test(text)) return 'Alphanumeric';
    return 'Byte';
  }

  let qrReady = null;
  function ensureQrLib() {
    if (!qrReady) {
      qrReady = (window.qrcode ? Promise.resolve() : U.loadScript(QS.CDN.qrcode)).then(() => {
        window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs['UTF-8'];
      });
    }
    return qrReady;
  }

  /* Returns {n, dark(r,c), version, ec, mode, bytes, capacity}. Throws a
     readable message when the content simply does not fit in a QR code. */
  function matrix(text, { ec = 'M', minVersion = 0 } = {}) {
    if (!window.qrcode) throw new Error('The QR library is still loading — one moment.');
    const utf8 = window.qrcode.stringToBytesFuncs && window.qrcode.stringToBytesFuncs['UTF-8'];
    if (utf8 && window.qrcode.stringToBytes !== utf8) window.qrcode.stringToBytes = utf8;
    const mode = pickMode(text);
    let version = Math.max(0, Math.min(40, minVersion | 0));
    let qr = null, lastErr = null;
    for (let attempt = 0; attempt < 41; attempt++) {
      try {
        qr = window.qrcode(version, ec);
        qr.addData(text, mode);
        qr.make();
        break;
      } catch (e) {
        lastErr = e;
        qr = null;
        if (version === 0) break;            /* auto mode already tried every version */
        version++;
        if (version > 40) break;
      }
    }
    if (!qr) {
      const msg = String(lastErr && lastErr.message ? lastErr.message : lastErr || '');
      if (/overflow/i.test(msg)) {
        throw new Error('That is too much data for one QR code (max ' + byteCapacity(40, ec) +
          ' bytes at level ' + ec + '). Shorten it, drop the error-correction level, or use a short link.');
      }
      throw new Error(msg || 'Could not build the QR code.');
    }
    const n = qr.getModuleCount();
    const ver = (n - 17) / 4;
    const bytes = mode === 'Byte' ? utf8Length(text) : text.length;
    return {
      n, version: ver, ec, mode, bytes,
      capacity: byteCapacity(ver, ec),
      dark: (r, c) => (r >= 0 && c >= 0 && r < n && c < n ? qr.isDark(r, c) : false)
    };
  }

  /* ───────────────────────── style catalogues ───────────────────────── */
  const DOT_STYLES = [
    { id: 'square', name: 'Square' },
    { id: 'rounded', name: 'Rounded' },
    { id: 'soft', name: 'Soft' },
    { id: 'liquid', name: 'Liquid' },
    { id: 'dots', name: 'Dots' },
    { id: 'dots-sm', name: 'Small dots' },
    { id: 'bubbles', name: 'Bubbles' },
    { id: 'squares-sm', name: 'Tiles' },
    { id: 'classy', name: 'Classy' },
    { id: 'classy-rounded', name: 'Classy round' },
    { id: 'diamond', name: 'Diamond' },
    { id: 'vertical', name: 'Vertical bars' },
    { id: 'horizontal', name: 'Horizontal bars' },
    { id: 'plus', name: 'Cross' },
    { id: 'star', name: 'Star' },
    { id: 'heart', name: 'Heart' }
  ];
  const EYE_FRAMES = [
    { id: 'square', name: 'Square' }, { id: 'rounded', name: 'Rounded' },
    { id: 'extra-rounded', name: 'Extra round' }, { id: 'circle', name: 'Circle' },
    { id: 'leaf', name: 'Leaf' }, { id: 'drop', name: 'Drop' },
    { id: 'drop-in', name: 'Drop inward' }, { id: 'cut', name: 'Cut corners' },
    { id: 'dotted', name: 'Dotted' }
  ];
  const EYE_BALLS = [
    { id: 'square', name: 'Square' }, { id: 'rounded', name: 'Rounded' },
    { id: 'circle', name: 'Circle' }, { id: 'leaf', name: 'Leaf' },
    { id: 'drop', name: 'Drop' }, { id: 'diamond', name: 'Diamond' },
    { id: 'cut', name: 'Cut corners' }, { id: 'dots', name: 'Dots' },
    { id: 'plus', name: 'Cross' }, { id: 'star', name: 'Star' }
  ];
  const FRAMES = [
    { id: 'none', name: 'No frame', text: false },
    { id: 'box-bottom', name: 'Label below', text: true },
    { id: 'box-top', name: 'Label above', text: true },
    { id: 'card', name: 'Card', text: true },
    { id: 'bubble', name: 'Speech bubble', text: true },
    { id: 'banner', name: 'Banner', text: true },
    { id: 'corners', name: 'Corner marks', text: true },
    { id: 'ticket', name: 'Ticket', text: true },
    { id: 'polaroid', name: 'Polaroid', text: true },
    { id: 'ring', name: 'Ring', text: true }
  ];
  const FONTS = {
    barlow: { name: 'Barlow Condensed', css: "'Barlow Condensed', sans-serif", url: 'https://cdn.jsdelivr.net/npm/@fontsource/barlow-condensed@5.3.0/files/barlow-condensed-latin-800-normal.woff', weight: 800 },
    mono: { name: 'Share Tech Mono', css: "'Share Tech Mono', monospace", url: 'https://cdn.jsdelivr.net/npm/@fontsource/share-tech-mono@5.3.0/files/share-tech-mono-latin-400-normal.woff', weight: 400 },
    grotesk: { name: 'Space Grotesk', css: "'Space Grotesk', sans-serif", url: 'https://cdn.jsdelivr.net/npm/@fontsource/space-grotesk@5.3.0/files/space-grotesk-latin-700-normal.woff', weight: 700 },
    slab: { name: 'Roboto Slab', css: "'Roboto Slab', serif", url: 'https://cdn.jsdelivr.net/npm/@fontsource/roboto-slab@5.3.0/files/roboto-slab-latin-700-normal.woff', weight: 700 },
    script: { name: 'Pacifico', css: "'Pacifico', cursive", url: 'https://cdn.jsdelivr.net/npm/@fontsource/pacifico@5.3.0/files/pacifico-latin-400-normal.woff', weight: 400 }
  };

  const DEFAULT_DESIGN = {
    ec: 'auto',
    minVersion: 0,
    margin: 4,
    shape: 'square',
    dots: { style: 'square', scale: 1 },
    fill: { type: 'solid', color: '#000000', stops: ['#111111', '#7a7a7a'], angle: 45, image: null, darken: 0.15 },
    eyes: { frame: 'square', ball: 'square', frameColor: null, ballColor: null },
    bg: { type: 'solid', color: '#ffffff', stops: ['#ffffff', '#e8e8e8'], angle: 45, image: null, overlay: 0.7, radius: 0 },
    logo: { src: null, kind: null, icon: null, iconColor: '#000000', ar: 1, size: 0.22, margin: 0.6, excavate: true, plate: 'none', plateColor: '#ffffff', radius: 0 },
    frame: { style: 'none', text: 'SCAN ME', text2: '', font: 'barlow', color: '#000000', textColor: '#ffffff', panel: '#ffffff', tracking: 0.12, radius: 0.4 }
  };

  const PRESETS = [
    { id: 'classic', name: 'Classic', design: {} },
    {
      id: 'industrial', name: 'Industrial', design: {
        dots: { style: 'square' }, fill: { type: 'solid', color: '#0d0d0d' },
        bg: { type: 'solid', color: '#e8ff00' }, eyes: { frame: 'square', ball: 'square' },
        frame: { style: 'box-bottom', text: 'SCAN ME', color: '#0d0d0d', textColor: '#e8ff00', font: 'barlow' }
      }
    },
    {
      id: 'round', name: 'Soft dots', design: {
        dots: { style: 'dots', scale: 0.92 }, eyes: { frame: 'circle', ball: 'circle' },
        fill: { type: 'solid', color: '#14213d' }, bg: { type: 'solid', color: '#ffffff', radius: 0.12 }
      }
    },
    {
      id: 'sunset', name: 'Sunset', design: {
        dots: { style: 'rounded' }, eyes: { frame: 'extra-rounded', ball: 'rounded' },
        fill: { type: 'linear', stops: ['#ff4d00', '#b5179e'], angle: 45 },
        bg: { type: 'solid', color: '#ffffff', radius: 0.1 }
      }
    },
    {
      id: 'ocean', name: 'Ocean', design: {
        dots: { style: 'liquid' }, eyes: { frame: 'extra-rounded', ball: 'circle' },
        fill: { type: 'radial', stops: ['#0077b6', '#023047'] }, bg: { type: 'solid', color: '#f1faee' }
      }
    },
    {
      id: 'mint', name: 'Mint card', design: {
        dots: { style: 'classy-rounded' }, eyes: { frame: 'leaf', ball: 'leaf' },
        fill: { type: 'solid', color: '#1b4332' }, bg: { type: 'solid', color: '#d8f3dc', radius: 0.15 },
        frame: { style: 'card', text: 'SCAN ME', color: '#1b4332', textColor: '#d8f3dc', panel: '#d8f3dc', font: 'grotesk' }
      }
    },
    {
      id: 'ticket', name: 'Ticket', design: {
        dots: { style: 'square' }, eyes: { frame: 'square', ball: 'square' },
        fill: { type: 'solid', color: '#111111' }, bg: { type: 'solid', color: '#ffffff' },
        frame: { style: 'ticket', text: 'ADMIT ONE', color: '#e8ff00', textColor: '#0d0d0d', panel: '#ffffff', font: 'barlow' }
      }
    },
    {
      id: 'neon', name: 'Neon night', design: {
        dots: { style: 'dots-sm' }, eyes: { frame: 'dotted', ball: 'dots' },
        fill: { type: 'linear', stops: ['#e8ff00', '#00f5d4'], angle: 120 },
        bg: { type: 'solid', color: '#0d0d0d', radius: 0.08 }
      }
    },
    {
      id: 'polaroid', name: 'Polaroid', design: {
        dots: { style: 'rounded' }, eyes: { frame: 'rounded', ball: 'rounded' },
        fill: { type: 'solid', color: '#222222' }, bg: { type: 'solid', color: '#ffffff' },
        frame: { style: 'polaroid', text: 'scan me', color: '#ffffff', textColor: '#222222', panel: '#ffffff', font: 'script', tracking: 0 }
      }
    },
    {
      id: 'stamp', name: 'Ring stamp', design: {
        shape: 'circle', dots: { style: 'dots' }, eyes: { frame: 'circle', ball: 'circle' },
        fill: { type: 'solid', color: '#7f1d1d' }, bg: { type: 'solid', color: '#fff7ed' },
        frame: { style: 'ring', text: 'SCAN FOR MORE', text2: 'DUMP.YANIKROESTI.CH', color: '#7f1d1d', textColor: '#fff7ed', panel: '#fff7ed', font: 'barlow', tracking: 0.18 }
      }
    },
    {
      id: 'swiss', name: 'Swiss red', design: {
        dots: { style: 'square' }, eyes: { frame: 'square', ball: 'square' },
        fill: { type: 'solid', color: '#d52b1e' }, bg: { type: 'solid', color: '#ffffff' },
        frame: { style: 'corners', text: 'SCAN', color: '#d52b1e', textColor: '#d52b1e', font: 'barlow' }
      }
    },
    {
      id: 'mono-line', name: 'Line art', design: {
        dots: { style: 'vertical' }, eyes: { frame: 'rounded', ball: 'rounded' },
        fill: { type: 'solid', color: '#1d3557' }, bg: { type: 'solid', color: '#ffffff' }
      }
    }
  ];

  function deepMerge(base, over) {
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    for (const k of Object.keys(over || {})) {
      const v = over[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k])) {
        out[k] = deepMerge(base[k], v);
      } else if (v !== undefined) out[k] = v;
    }
    return out;
  }
  const normalizeDesign = d => deepMerge(DEFAULT_DESIGN, d || {});

  /* ───────────────────────── fonts → vector text ───────────────────────── */
  const fontCache = new Map();
  let otReady = null;
  function ensureOpentype() {
    if (!otReady) otReady = (window.opentype ? Promise.resolve() : U.loadScript(QS.CDN.opentype));
    return otReady;
  }
  function loadFont(key) {
    const def = FONTS[key] || FONTS.barlow;
    if (!fontCache.has(key)) {
      fontCache.set(key, ensureOpentype()
        .then(() => fetch(def.url))
        .then(r => { if (!r.ok) throw new Error('font ' + r.status); return r.arrayBuffer(); })
        .then(buf => window.opentype.parse(buf))
        .catch(err => { fontCache.delete(key); throw err; }));
    }
    return fontCache.get(key);
  }
  const fontOf = key => {
    const p = fontCache.get(key);
    return p && p.__font ? p.__font : null;
  };
  function primeFont(key) {
    const p = loadFont(key);
    if (!p.__hooked) {
      p.__hooked = true;
      p.then(f => { p.__font = f; }, () => {});
    }
    return p;
  }
  const fontsReady = keys => Promise.all(keys.map(k => primeFont(k).catch(() => null)));

  function otPath(font, str, size, tracking) {
    const glyphs = font.stringToGlyphs(String(str));
    const scale = size / font.unitsPerEm;
    const p = new Path();
    let x = 0;
    glyphs.forEach((g, i) => {
      const gp = g.getPath(x, 0, size);
      let cx = 0, cy = 0;
      for (const cmd of gp.commands) {
        if (cmd.type === 'M') { p.M(cmd.x, cmd.y); cx = cmd.x; cy = cmd.y; }
        else if (cmd.type === 'L') { p.L(cmd.x, cmd.y); cx = cmd.x; cy = cmd.y; }
        else if (cmd.type === 'C') { p.C(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y); cx = cmd.x; cy = cmd.y; }
        else if (cmd.type === 'Q') {
          p.C(cx + (2 / 3) * (cmd.x1 - cx), cy + (2 / 3) * (cmd.y1 - cy),
            cmd.x + (2 / 3) * (cmd.x1 - cmd.x), cmd.y + (2 / 3) * (cmd.y1 - cmd.y), cmd.x, cmd.y);
          cx = cmd.x; cy = cmd.y;
        } else if (cmd.type === 'Z') p.Z();
      }
      let adv = (g.advanceWidth || 0) * scale;
      const next = glyphs[i + 1];
      if (next) adv += (font.getKerningValue(g, next) || 0) * scale;
      x += adv + (i < glyphs.length - 1 ? tracking * size : 0);
    });
    return { path: p, width: x, capHeight: capHeightOf(font) * size };
  }
  function capHeightOf(font) {
    const os2 = font.tables && font.tables.os2;
    const cap = os2 && os2.sCapHeight ? os2.sCapHeight : (font.ascender * 0.72);
    return cap / font.unitsPerEm;
  }
  /* straight text, centred on (cx, cy), shrunk to fit maxWidth */
  function textShape(font, str, size, maxWidth, cx, cy, tracking) {
    let t = otPath(font, str, size, tracking);
    if (maxWidth && t.width > maxWidth) {
      t = otPath(font, str, size * (maxWidth / t.width), tracking);
    }
    return t.path.translate(cx - t.width / 2, cy + t.capHeight / 2);
  }
  /* text bent around a circle: top arc reads left→right, bottom arc too */
  function arcText(font, str, size, cx, cy, radius, tracking, bottom) {
    const glyphs = font.stringToGlyphs(String(str));
    const scale = size / font.unitsPerEm;
    const cap = capHeightOf(font) * size;
    const adv = glyphs.map((g, i) => (g.advanceWidth || 0) * scale + (i < glyphs.length - 1 ? tracking * size : 0));
    const total = adv.reduce((a, b) => a + b, 0);
    const rb = bottom ? radius + cap / 2 : radius - cap / 2;
    const out = new Path();
    let s = -total / 2;
    glyphs.forEach((g, i) => {
      const mid = s + adv[i] / 2;
      const theta = bottom ? Math.PI / 2 - mid / rb : -Math.PI / 2 + mid / rb;
      const phi = bottom ? theta - Math.PI / 2 : theta + Math.PI / 2;
      const gp = g.getPath(0, 0, size);
      const p = new Path();
      let px = 0, py = 0;
      for (const cmd of gp.commands) {
        if (cmd.type === 'M') { p.M(cmd.x, cmd.y); px = cmd.x; py = cmd.y; }
        else if (cmd.type === 'L') { p.L(cmd.x, cmd.y); px = cmd.x; py = cmd.y; }
        else if (cmd.type === 'C') { p.C(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y); px = cmd.x; py = cmd.y; }
        else if (cmd.type === 'Q') {
          p.C(px + (2 / 3) * (cmd.x1 - px), py + (2 / 3) * (cmd.y1 - py),
            cmd.x + (2 / 3) * (cmd.x1 - cmd.x), cmd.y + (2 / 3) * (cmd.y1 - cmd.y), cmd.x, cmd.y);
          px = cmd.x; py = cmd.y;
        } else if (cmd.type === 'Z') p.Z();
      }
      const centred = p.translate(-(g.advanceWidth || 0) * scale / 2, 0);
      out.add(centred.rotate(phi).translate(cx + rb * Math.cos(theta), cy + rb * Math.sin(theta)));
      s += adv[i];
    });
    return out;
  }

  /* ───────────────────────── paints ───────────────────────── */
  function paintSolid(color) { return { kind: 'solid', color }; }
  function paintFor(spec, box) {
    const { x, y, w, h } = box;
    if (!spec || spec.type === 'transparent') return null;
    if (spec.type === 'linear') {
      const a = ((spec.angle || 0) * Math.PI) / 180;
      const cx = x + w / 2, cy = y + h / 2, r = Math.max(w, h) / 2;
      return {
        kind: 'linear', stops: spec.stops || ['#000', '#666'],
        x1: cx - Math.cos(a) * r, y1: cy - Math.sin(a) * r,
        x2: cx + Math.cos(a) * r, y2: cy + Math.sin(a) * r
      };
    }
    if (spec.type === 'radial') {
      return { kind: 'radial', stops: spec.stops || ['#000', '#666'], cx: x + w / 2, cy: y + h / 2, r: Math.max(w, h) * 0.62 };
    }
    if (spec.type === 'image' && spec.image) {
      return { kind: 'pattern', href: spec.image, x, y, w, h, darken: spec.darken || 0 };
    }
    return paintSolid(spec.color || '#000000');
  }
  /* representative colour of a paint — for contrast checks and EPS */
  function paintColor(p, fallback) {
    if (!p) return fallback;
    if (p.kind === 'solid') return p.color;
    if (p.stops) return p.stops[p.stops.length - 1];
    return fallback;
  }

  /* ───────────────────────── module shapes ───────────────────────── */
  function dotPath(style, grid, n, ox, oy, scale, seed) {
    const p = new Path();
    const on = (r, c) => grid(r, c);
    const S = clamp(scale || 1, 0.4, 1);
    const rand = rng(seed);
    const randCache = new Map();
    const rnd = (r, c) => {
      const k = r * 1000 + c;
      if (!randCache.has(k)) randCache.set(k, rand());
      return randCache.get(k);
    };

    if (style === 'square' || style === 'squares-sm' || style === 'bubbles' ||
      style === 'dots' || style === 'dots-sm' || style === 'diamond' ||
      style === 'plus' || style === 'star' || style === 'heart') {
      if (style === 'square') {
        /* merge each row's runs into one rect — fewer nodes, no seams */
        for (let r = 0; r < n; r++) {
          let c = 0;
          while (c < n) {
            if (!on(r, c)) { c++; continue; }
            let e = c;
            while (e + 1 < n && on(r, e + 1)) e++;
            p.rect(ox + c, oy + r, e - c + 1, 1);
            c = e + 1;
          }
        }
        return p;
      }
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (!on(r, c)) continue;
          const x = ox + c, y = oy + r, cx = x + 0.5, cy = y + 0.5;
          if (style === 'dots') p.circle(cx, cy, 0.5 * S);
          else if (style === 'dots-sm') p.circle(cx, cy, 0.37 * S);
          else if (style === 'bubbles') p.circle(cx, cy, (0.3 + rnd(r, c) * 0.2) * S);
          else if (style === 'squares-sm') { const s = 0.74 * S; p.rrect(cx - s / 2, cy - s / 2, s, s, 0.08, 0.08, 0.08, 0.08); }
          else if (style === 'diamond') { const s = 0.54 * S; p.poly([[cx, cy - s], [cx + s, cy], [cx, cy + s], [cx - s, cy]]); }
          else if (style === 'plus') {
            const a = 0.18 * S, b = 0.5 * S;
            p.poly([[cx - a, cy - b], [cx + a, cy - b], [cx + a, cy - a], [cx + b, cy - a], [cx + b, cy + a],
            [cx + a, cy + a], [cx + a, cy + b], [cx - a, cy + b], [cx - a, cy + a], [cx - b, cy + a],
            [cx - b, cy - a], [cx - a, cy - a]]);
          } else if (style === 'star') {
            const R = 0.56 * S, r2 = 0.24 * S, pts = [];
            for (let i = 0; i < 10; i++) {
              const ang = -Math.PI / 2 + (i * Math.PI) / 5;
              const rr = i % 2 ? r2 : R;
              pts.push([cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr]);
            }
            p.poly(pts);
          } else if (style === 'heart') {
            const s = 0.52 * S;
            p.M(cx, cy + s * 0.9)
              .C(cx - s * 1.3, cy - s * 0.1, cx - s * 0.6, cy - s * 1.15, cx, cy - s * 0.38)
              .C(cx + s * 0.6, cy - s * 1.15, cx + s * 1.3, cy - s * 0.1, cx, cy + s * 0.9).Z();
          }
        }
      }
      return p;
    }

    if (style === 'vertical' || style === 'horizontal') {
      const w = 0.78 * S, gap = 0.06;
      if (style === 'vertical') {
        for (let c = 0; c < n; c++) {
          let r = 0;
          while (r < n) {
            if (!on(r, c)) { r++; continue; }
            let e = r;
            while (e + 1 < n && on(e + 1, c)) e++;
            const len = e - r + 1 - gap * 2;
            p.rrect(ox + c + (1 - w) / 2, oy + r + gap, w, len, w / 2, w / 2, w / 2, w / 2);
            r = e + 1;
          }
        }
      } else {
        for (let r = 0; r < n; r++) {
          let c = 0;
          while (c < n) {
            if (!on(r, c)) { c++; continue; }
            let e = c;
            while (e + 1 < n && on(r, e + 1)) e++;
            const len = e - c + 1 - gap * 2;
            p.rrect(ox + c + gap, oy + r + (1 - w) / 2, len, w, w / 2, w / 2, w / 2, w / 2);
            c = e + 1;
          }
        }
      }
      return p;
    }

    /* corner-aware styles: a corner is rounded when both of its sides are free */
    const R = style === 'soft' ? 0.25 : 0.5;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!on(r, c)) continue;
        const t = on(r - 1, c), b = on(r + 1, c), l = on(r, c - 1), rt = on(r, c + 1);
        const x = ox + c, y = oy + r;
        let tl = !t && !l, tr = !t && !rt, br = !b && !rt, bl = !b && !l;
        if (style === 'classy') p.rrect(x, y, 1, 1, tl ? 0.5 : 0, 0, br ? 0.5 : 0, 0);
        else if (style === 'classy-rounded') p.rrect(x, y, 1, 1, tl ? 0.5 : 0, tr ? 0.18 : 0, br ? 0.5 : 0, bl ? 0.18 : 0);
        else p.rrect(x, y, 1, 1, tl ? R : 0, tr ? R : 0, br ? R : 0, bl ? R : 0);
      }
    }
    if (style === 'liquid') {
      /* smooth the inner corners too, so runs flow into each other */
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (on(r, c)) continue;
          const x = ox + c, y = oy + r;
          if (on(r - 1, c) && on(r, c - 1) && on(r - 1, c - 1)) p.fillet(x, y, 0.5, 'tl');
          if (on(r - 1, c) && on(r, c + 1) && on(r - 1, c + 1)) p.fillet(x, y, 0.5, 'tr');
          if (on(r + 1, c) && on(r, c + 1) && on(r + 1, c + 1)) p.fillet(x, y, 0.5, 'br');
          if (on(r + 1, c) && on(r, c - 1) && on(r + 1, c - 1)) p.fillet(x, y, 0.5, 'bl');
        }
      }
    }
    return p;
  }

  /* corner radii mirrored so every eye points the same way relative to the code */
  function mirrorCorners([tl, tr, br, bl], pos) {
    if (pos === 'tr') return [tr, tl, bl, br];
    if (pos === 'bl') return [bl, br, tr, tl];
    return [tl, tr, br, bl];
  }
  function eyeFramePath(style, x, y, pos) {
    const p = new Path();
    const S = 7, I = 1;                       /* 7×7 ring, one module thick */
    const ring = (or_, ir) => {
      p.rrect(x, y, S, S, or_[0], or_[1], or_[2], or_[3]);
      p.rrect(x + I, y + I, S - 2 * I, S - 2 * I, ir[0], ir[1], ir[2], ir[3]);
    };
    if (style === 'circle') { p.circle(x + S / 2, y + S / 2, S / 2); p.circle(x + S / 2, y + S / 2, S / 2 - I); return p; }
    if (style === 'dotted') {
      for (let i = 0; i < S; i++) {
        p.circle(x + i + 0.5, y + 0.5, 0.42);
        p.circle(x + i + 0.5, y + S - 0.5, 0.42);
        if (i > 0 && i < S - 1) { p.circle(x + 0.5, y + i + 0.5, 0.42); p.circle(x + S - 0.5, y + i + 0.5, 0.42); }
      }
      return p;
    }
    if (style === 'cut') {
      const k = 1.6;
      p.poly([[x + k, y], [x + S - k, y], [x + S, y + k], [x + S, y + S - k], [x + S - k, y + S], [x + k, y + S], [x, y + S - k], [x, y + k]]);
      const k2 = 1.0;
      p.poly([[x + I + k2, y + I], [x + S - I - k2, y + I], [x + S - I, y + I + k2], [x + S - I, y + S - I - k2],
      [x + S - I - k2, y + S - I], [x + I + k2, y + S - I], [x + I, y + S - I - k2], [x + I, y + I + k2]]);
      return p;
    }
    if (style === 'rounded') { ring(mirrorCorners([1.8, 1.8, 1.8, 1.8], pos), mirrorCorners([1.1, 1.1, 1.1, 1.1], pos)); return p; }
    if (style === 'extra-rounded') { ring(mirrorCorners([2.8, 2.8, 2.8, 2.8], pos), mirrorCorners([2, 2, 2, 2], pos)); return p; }
    if (style === 'leaf') { ring(mirrorCorners([3.2, 0.4, 3.2, 0.4], pos), mirrorCorners([2.3, 0.3, 2.3, 0.3], pos)); return p; }
    if (style === 'drop') { ring(mirrorCorners([0.3, 3.2, 3.2, 3.2], pos), mirrorCorners([0.2, 2.3, 2.3, 2.3], pos)); return p; }
    if (style === 'drop-in') { ring(mirrorCorners([3.2, 3.2, 0.3, 3.2], pos), mirrorCorners([2.3, 2.3, 0.2, 2.3], pos)); return p; }
    ring([0, 0, 0, 0], [0, 0, 0, 0]);
    return p;
  }
  function eyeBallPath(style, x, y, pos) {
    const p = new Path();
    const bx = x + 2, by = y + 2, S = 3, cx = bx + 1.5, cy = by + 1.5;
    if (style === 'circle') return p.circle(cx, cy, 1.5);
    if (style === 'rounded') return p.rrect(bx, by, S, S, 0.9, 0.9, 0.9, 0.9);
    if (style === 'leaf') { const c = mirrorCorners([1.5, 0.25, 1.5, 0.25], pos); return p.rrect(bx, by, S, S, c[0], c[1], c[2], c[3]); }
    if (style === 'drop') { const c = mirrorCorners([0.2, 1.5, 1.5, 1.5], pos); return p.rrect(bx, by, S, S, c[0], c[1], c[2], c[3]); }
    if (style === 'diamond') return p.poly([[cx, cy - 1.6], [cx + 1.6, cy], [cx, cy + 1.6], [cx - 1.6, cy]]);
    if (style === 'cut') {
      const k = 0.8;
      return p.poly([[bx + k, by], [bx + S - k, by], [bx + S, by + k], [bx + S, by + S - k],
      [bx + S - k, by + S], [bx + k, by + S], [bx, by + S - k], [bx, by + k]]);
    }
    if (style === 'dots') {
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) p.circle(bx + c + 0.5, by + r + 0.5, 0.44);
      return p;
    }
    if (style === 'plus') {
      const a = 0.6, b = 1.5;
      return p.poly([[cx - a, cy - b], [cx + a, cy - b], [cx + a, cy - a], [cx + b, cy - a], [cx + b, cy + a],
      [cx + a, cy + a], [cx + a, cy + b], [cx - a, cy + b], [cx - a, cy + a], [cx - b, cy + a],
      [cx - b, cy - a], [cx - a, cy - a]]);
    }
    if (style === 'star') {
      const R = 1.7, r2 = 0.75, pts = [];
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? r2 : R;
        pts.push([cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr]);
      }
      return p.poly(pts);
    }
    return p.rect(bx, by, S, S);
  }

  /* the black-and-white Swiss cross that every QR-bill must carry */
  function swissCross(cx, cy, side) {
    const out = [];
    const white = new Path().rect(cx - side / 2, cy - side / 2, side, side);
    const b = side * 6 / 7;
    const black = new Path().rect(cx - b / 2, cy - b / 2, b, b);
    const arm = b * 6 / 32, len = b * 20 / 32;
    const cross = new Path()
      .rect(cx - arm / 2, cy - len / 2, arm, len)
      .rect(cx - len / 2, cy - arm / 2, len, arm);
    out.push({ k: 'path', path: white, paint: paintSolid('#ffffff') });
    out.push({ k: 'path', path: black, paint: paintSolid('#000000') });
    out.push({ k: 'path', path: cross, paint: paintSolid('#ffffff') });
    return out;
  }

  /* ───────────────────────── compose the scene ───────────────────────── */
  function compose(payload, designIn, opts = {}) {
    const design = normalizeDesign(designIn);
    const text = payload.text || '';
    const warnings = [];

    let ec = design.ec === 'auto' ? (design.logo && (design.logo.src || design.logo.icon) ? 'H' : 'M') : design.ec;
    if (payload.forceEC) ec = payload.forceEC;
    const mx = matrix(text, { ec, minVersion: design.minVersion });
    const n = mx.n;
    const m = clamp(design.margin, 0, 12);

    /* panel: the code plus its quiet zone (a circle when shape = circle) */
    const round = design.shape === 'circle';
    const gap = 2;
    const R = round ? (n / 2) * Math.SQRT2 + gap : 0;
    const panel = round ? 2 * R : n + 2 * m;
    const qx = round ? panel / 2 - n / 2 : m;
    const qy = qx;

    /* logo box + the modules it hides */
    const logo = design.logo || {};
    const hasLogo = !!(logo.src || logo.icon);
    const lsize = clamp(logo.size || 0.22, 0.05, 0.42) * n;
    const ar = logo.ar || 1;
    const lw = ar >= 1 ? lsize : lsize * ar;
    const lh = ar >= 1 ? lsize / ar : lsize;
    const lpad = hasLogo ? clamp(logo.margin || 0, 0, 4) : 0;
    const lbox = {
      x: qx + n / 2 - lw / 2 - lpad, y: qy + n / 2 - lh / 2 - lpad,
      w: lw + 2 * lpad, h: lh + 2 * lpad
    };

    const hidden = new Uint8Array(n * n);
    let hiddenCount = 0;
    if (hasLogo && logo.excavate !== false) {
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          const x0 = qx + c, y0 = qy + r;
          const hitsBox = x0 + 1 > lbox.x && x0 < lbox.x + lbox.w && y0 + 1 > lbox.y && y0 < lbox.y + lbox.h;
          const hits = logo.plate === 'circle'
            ? Math.hypot(x0 + 0.5 - (lbox.x + lbox.w / 2), y0 + 0.5 - (lbox.y + lbox.h / 2)) < Math.max(lbox.w, lbox.h) / 2 + 0.25
            : hitsBox;
          if (hits) { hidden[r * n + c] = 1; hiddenCount++; }
        }
      }
    }
    const inFinder = (r, c) => (r < 8 && c < 8) || (r < 8 && c >= n - 8) || (r >= n - 8 && c < 8);
    const isDot = (r, c) => r >= 0 && c >= 0 && r < n && c < n && mx.dark(r, c) && !inFinder(r, c) && !hidden[r * n + c];

    /* frame layout decides the canvas size and where the panel sits */
    const frame = design.frame || {};
    const fstyle = FRAMES.some(f => f.id === frame.style) ? frame.style : 'none';
    const hasText = fstyle !== 'none' && String(frame.text || '').trim() !== '';
    const L = layoutFrame(fstyle, panel, frame, hasText, round);
    const W = L.W, H = L.H, ox = L.px, oy = L.py;

    const layers = [];
    const qbox = { x: ox + qx, y: oy + qy, w: n, h: n };
    const fgPaint = paintFor(design.fill, qbox);
    const bgPaint = paintFor(design.bg, { x: ox, y: oy, w: panel, h: panel });

    /* 1 · frame body underneath everything */
    for (const layer of L.back(ox, oy)) layers.push(layer);

    /* 2 · panel background */
    if (bgPaint) {
      const p = new Path();
      if (round) p.circle(ox + panel / 2, oy + panel / 2, panel / 2);
      else {
        const rad = clamp(design.bg.radius || 0, 0, 0.5) * panel;
        p.rrect(ox, oy, panel, panel, rad, rad, rad, rad);
      }
      layers.push({ k: 'path', path: p, paint: bgPaint });
      if (design.bg.type === 'image' && design.bg.overlay > 0) {
        const wash = new Path();
        if (round) wash.circle(ox + panel / 2, oy + panel / 2, panel / 2);
        else wash.rect(ox, oy, panel, panel);
        layers.push({ k: 'path', path: wash, paint: paintSolid(design.bg.color || '#ffffff'), opacity: clamp(design.bg.overlay, 0, 1) });
      }
    }

    /* 3 · decorative fill for the round shape */
    if (round) {
      const rand = rng(hash32(text) ^ 0x9e3779b9);
      const p = new Path();
      const cx = ox + panel / 2, cy = oy + panel / 2;
      const cells = Math.ceil(panel) + 2;
      for (let r = -2; r < cells; r++) {
        for (let c = -2; c < cells; c++) {
          const x = ox + qx + c, y = oy + qy + r;
          const inside = c >= -1 && r >= -1 && c <= n && r <= n;      /* keep a clear ring around the code */
          if (inside) continue;
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
          if (Math.hypot(dx, dy) > panel / 2 - 0.7) continue;
          if (rand() > 0.42) continue;
          p.circle(x + 0.5, y + 0.5, 0.36);
        }
      }
      if (!p.empty) layers.push({ k: 'path', path: p, paint: fgPaint, opacity: 0.55 });
    }

    /* 4 · data modules */
    const dots = dotPath(design.dots.style, isDot, n, ox + qx, oy + qy, design.dots.scale, hash32(text));
    if (!dots.empty) layers.push({ k: 'path', path: dots, paint: fgPaint });

    /* 5 · the three finder eyes */
    const eyePositions = [
      { x: ox + qx, y: oy + qy, pos: 'tl' },
      { x: ox + qx + n - 7, y: oy + qy, pos: 'tr' },
      { x: ox + qx, y: oy + qy + n - 7, pos: 'bl' }
    ];
    const framePath = new Path(), ballPath = new Path();
    for (const e of eyePositions) {
      framePath.add(eyeFramePath(design.eyes.frame, e.x, e.y, e.pos));
      ballPath.add(eyeBallPath(design.eyes.ball, e.x, e.y, e.pos));
    }
    const eyeFramePaint = design.eyes.frameColor ? paintSolid(design.eyes.frameColor) : fgPaint;
    const eyeBallPaint = design.eyes.ballColor ? paintSolid(design.eyes.ballColor) : fgPaint;
    layers.push({ k: 'path', path: framePath, paint: eyeFramePaint, rule: 'evenodd' });
    layers.push({ k: 'path', path: ballPath, paint: eyeBallPaint });

    /* 6 · logo plate + logo */
    if (hasLogo) {
      if (logo.plate && logo.plate !== 'none') {
        const pp = new Path();
        if (logo.plate === 'circle') pp.circle(lbox.x + lbox.w / 2 + ox, lbox.y + lbox.h / 2 + oy, Math.max(lbox.w, lbox.h) / 2);
        else {
          const rad = logo.plate === 'rounded' ? Math.min(lbox.w, lbox.h) * 0.22 : 0;
          pp.rrect(ox + lbox.x, oy + lbox.y, lbox.w, lbox.h, rad, rad, rad, rad);
        }
        layers.push({ k: 'path', path: pp, paint: paintSolid(logo.plateColor || '#ffffff') });
      }
      const lx = ox + qx + n / 2 - lw / 2, ly = oy + qy + n / 2 - lh / 2;
      if (logo.kind === 'icon' && logo.src) {
        layers.push({
          k: 'icon', d: logo.src, x: lx, y: ly, w: lw, h: lh,
          color: logo.iconColor || '#000000', viewBox: logo.viewBox || 24
        });
      } else if (logo.src) {
        layers.push({ k: 'image', href: logo.src, x: lx, y: ly, w: lw, h: lh, radius: (logo.radius || 0) * Math.min(lw, lh) / 2 });
      }
    }

    /* 7 · Swiss cross for QR-bills */
    if (payload.swiss) {
      for (const layer of swissCross(ox + qx + n / 2, oy + qy + n / 2, (n * 7) / 46)) layers.push(layer);
    }

    /* 8 · frame decoration and its text */
    const textLayers = [];
    for (const layer of L.front(ox, oy)) layers.push(layer);
    if (hasText) {
      const font = fontOf(frame.font) ;
      const spec = L.textSpec;
      if (spec) {
        if (font) {
          if (spec.arc) {
            layers.push({
              k: 'path',
              path: arcText(font, frame.text, spec.size, spec.cx, spec.cy, spec.radius, frame.tracking || 0, false),
              paint: paintSolid(frame.textColor || '#ffffff')
            });
            if (String(frame.text2 || '').trim()) {
              layers.push({
                k: 'path',
                path: arcText(font, frame.text2, spec.size * 0.8, spec.cx, spec.cy, spec.radius, frame.tracking || 0, true),
                paint: paintSolid(frame.textColor || '#ffffff')
              });
            }
          } else {
            layers.push({
              k: 'path',
              path: textShape(font, frame.text, spec.size, spec.maxWidth, spec.cx, spec.cy, frame.tracking || 0),
              paint: paintSolid(frame.textColor || '#ffffff')
            });
          }
        } else {
          /* font still loading: readable placeholder that exports never see */
          textLayers.push(frame.font);
          layers.push({
            k: 'text', str: frame.text, x: spec.cx, y: spec.cy, size: spec.size * 0.82,
            font: (FONTS[frame.font] || FONTS.barlow).css, fill: frame.textColor || '#ffffff',
            tracking: frame.tracking || 0
          });
        }
      }
    }

    /* ── quality signals shown next to the preview ── */
    const fgColor = paintColor(fgPaint, '#000000');
    const bgColor = design.bg.type === 'transparent' ? '#ffffff' : paintColor(bgPaint, '#ffffff');
    const ratio = U.contrast(fgColor, bgColor);
    if (ratio < 3) warnings.push('Very low contrast between code and background — most phones will struggle.');
    else if (ratio < 5) warnings.push('Contrast is on the low side; test with your own camera before printing.');
    if (U.luminance(fgColor) > U.luminance(bgColor)) warnings.push('Light code on a dark background: some older scanners only read dark-on-light.');
    if (m < 2 && fstyle === 'none') warnings.push('Quiet zone below 2 modules — leave 4 for print.');
    const dataModules = n * n - 3 * 64;
    const coverage = hiddenCount / dataModules;
    const ecBudget = { L: 0.07, M: 0.15, Q: 0.25, H: 0.3 }[mx.ec];
    if (hasLogo && coverage > ecBudget * 0.6) {
      warnings.push('The logo covers ' + Math.round(coverage * 100) + '% of the code — raise error correction or shrink it.');
    }
    if (design.bg.type === 'transparent') warnings.push('Transparent background: only place it on a light, plain surface.');

    return {
      W, H, layers, round, panel, ox, oy, qx, qy, n,
      fontsPending: textLayers,
      payloadText: text,
      info: {
        version: mx.version, modules: n, ec: mx.ec, mode: mx.mode,
        bytes: mx.bytes, capacity: mx.capacity, margin: m,
        contrast: ratio, logoCoverage: hasLogo ? coverage : 0,
        minPrintMM: Math.max(20, Math.round((n + 2 * m) * 0.4)),
        warnings
      }
    };
  }

  /* ───────────────────────── frames ─────────────────────────
     Each style returns the canvas size, where the code panel sits, and two
     layer builders (behind and in front of the code) plus the text slot. */
  function layoutFrame(style, panel, frame, hasText, round) {
    const color = frame.color || '#000000';
    const panelColor = frame.panel || '#ffffff';
    const radius = clamp(frame.radius == null ? 0.4 : frame.radius, 0, 1);
    const none = { back: () => [], front: () => [], textSpec: null };

    if (style === 'none') return Object.assign({ W: panel, H: panel, px: 0, py: 0 }, none);

    if (style === 'box-bottom' || style === 'box-top') {
      const t = panel * 0.05;
      const band = hasText ? panel * 0.16 : 0;
      const W = panel + 2 * t, H = panel + 2 * t + band;
      const top = style === 'box-top' ? band : 0;
      const rad = radius * t * 2;
      return {
        W, H, px: t, py: t + top,
        back: (ox, oy) => [{ k: 'path', path: new Path().rrect(ox - t, oy - t - top, W, H, rad, rad, rad, rad), paint: paintSolid(color) }],
        front: () => [],
        textSpec: hasText ? {
          cx: W / 2, cy: style === 'box-top' ? t + band / 2 : panel + 2 * t + band / 2,
          size: band * 0.62, maxWidth: panel * 0.92
        } : null
      };
    }

    if (style === 'card') {
      const pad = panel * 0.07;
      const band = hasText ? panel * 0.17 : 0;
      const W = panel + 2 * pad, H = panel + 2 * pad + band;
      const rad = Math.max(panel * 0.06, radius * panel * 0.1);
      return {
        W, H, px: pad, py: pad,
        back: (ox, oy) => [
          { k: 'path', path: new Path().rrect(ox - pad, oy - pad, W, H, rad, rad, rad, rad), paint: paintSolid(color) },
          { k: 'path', path: new Path().rrect(ox, oy, panel, panel, rad * 0.6, rad * 0.6, rad * 0.6, rad * 0.6), paint: paintSolid(panelColor) }
        ],
        front: () => [],
        textSpec: hasText ? { cx: W / 2, cy: panel + 2 * pad + band * 0.45, size: band * 0.6, maxWidth: panel * 0.9 } : null
      };
    }

    if (style === 'bubble') {
      const t = panel * 0.035;
      const gap = panel * 0.05;
      const band = hasText ? panel * 0.19 : 0;
      const W = panel + 2 * t, H = panel + 2 * t + gap + band;
      const rad = Math.max(panel * 0.05, radius * panel * 0.08);
      return {
        W, H, px: t, py: t,
        back: (ox, oy) => [{ k: 'path', path: new Path().rrect(ox - t, oy - t, W, panel + 2 * t, rad, rad, rad, rad), paint: paintSolid(color) },
        { k: 'path', path: new Path().rrect(ox, oy, panel, panel, rad * 0.5, rad * 0.5, rad * 0.5, rad * 0.5), paint: paintSolid(panelColor) }],
        front: (ox, oy) => hasText ? [
          {
            k: 'path', paint: paintSolid(color),
            path: new Path()
              .rrect(ox - t, oy + panel + t + gap, W, band, rad, rad, rad, rad)
              .poly([[ox + W / 2 - t - band * 0.3, oy + panel + t + gap + 0.4],
              [ox + W / 2 - t, oy + panel + t + gap * 0.15],
              [ox + W / 2 - t + band * 0.3, oy + panel + t + gap + 0.4]])
          }
        ] : [],
        textSpec: hasText ? { cx: W / 2, cy: panel + 2 * t + gap + band / 2, size: band * 0.58, maxWidth: panel * 0.86 } : null
      };
    }

    if (style === 'banner') {
      const t = panel * 0.04;
      const band = hasText ? panel * 0.16 : 0;
      const over = hasText ? panel * 0.09 : 0;          /* how far the ribbon sticks out */
      const fold = band * 0.32;                           /* depth of the folded tails */
      const boxW = panel + 2 * t;
      const W = boxW + 2 * over, H = panel + 2 * t + band * 0.6 + fold;
      const rad = Math.max(panel * 0.04, radius * panel * 0.07);
      const by = panel + 2 * t - band * 0.4;              /* ribbon top, relative to the canvas */
      const shade = U.mix(color, '#000000', 0.38);
      return {
        W, H, px: over + t, py: t,
        back: (ox, oy) => {
          const x0 = ox - t;                               /* left edge of the framed box */
          const layers = [
            { k: 'path', path: new Path().rrect(x0, oy - t, boxW, panel + 2 * t, rad, rad, rad, rad), paint: paintSolid(color) },
            { k: 'path', path: new Path().rrect(ox, oy, panel, panel, rad * 0.5, rad * 0.5, rad * 0.5, rad * 0.5), paint: paintSolid(panelColor) }
          ];
          if (hasText) {
            const top = oy - t + by;
            /* folded tails sit behind the ribbon */
            layers.push({
              k: 'path', paint: paintSolid(shade),
              path: new Path()
                .poly([[x0 - over, top + fold], [x0 + over * 0.4, top + fold], [x0 + over * 0.4, top + band + fold], [x0 - over, top + band + fold], [x0 - over + over * 0.45, top + fold + band / 2]])
                .poly([[x0 + boxW - over * 0.4, top + fold], [x0 + boxW + over, top + fold], [x0 + boxW + over - over * 0.45, top + fold + band / 2], [x0 + boxW + over, top + band + fold], [x0 + boxW - over * 0.4, top + band + fold]])
            });
          }
          return layers;
        },
        front: (ox, oy) => {
          if (!hasText) return [];
          const x0 = ox - t, top = oy - t + by;
          return [{
            k: 'path', paint: paintSolid(color),
            path: new Path().poly([[x0 - over * 0.55, top], [x0 + boxW + over * 0.55, top], [x0 + boxW + over * 0.55, top + band], [x0 - over * 0.55, top + band]])
          }];
        },
        textSpec: hasText ? { cx: W / 2, cy: by + band / 2, size: band * 0.6, maxWidth: panel * 0.95 } : null
      };
    }

    if (style === 'corners') {
      const gap = panel * 0.045, arm = panel * 0.2, t = panel * 0.028;
      const band = hasText ? panel * 0.14 : 0;
      const pad = gap + t;
      const W = panel + 2 * pad, H = panel + 2 * pad + band;
      return {
        W, H, px: pad, py: pad,
        back: () => [],
        front: (ox, oy) => {
          const x0 = ox - gap, y0 = oy - gap, x1 = ox + panel + gap, y1 = oy + panel + gap;
          const p = new Path();
          const L_ = (ax, ay, dx, dy) => {
            p.rrect(ax + (dx < 0 ? -t : 0), ay + (dy < 0 ? -t : 0), dx ? arm : t, dy ? arm : t, t / 2, t / 2, t / 2, t / 2);
          };
          p.rrect(x0 - t, y0 - t, arm, t, t / 2, t / 2, t / 2, t / 2);
          p.rrect(x0 - t, y0 - t, t, arm, t / 2, t / 2, t / 2, t / 2);
          p.rrect(x1 - arm + t, y0 - t, arm, t, t / 2, t / 2, t / 2, t / 2);
          p.rrect(x1, y0 - t, t, arm, t / 2, t / 2, t / 2, t / 2);
          p.rrect(x0 - t, y1, arm, t, t / 2, t / 2, t / 2, t / 2);
          p.rrect(x0 - t, y1 - arm + t, t, arm, t / 2, t / 2, t / 2, t / 2);
          p.rrect(x1 - arm + t, y1, arm, t, t / 2, t / 2, t / 2, t / 2);
          p.rrect(x1, y1 - arm + t, t, arm, t / 2, t / 2, t / 2, t / 2);
          return [{ k: 'path', path: p, paint: paintSolid(color) }];
        },
        textSpec: hasText ? { cx: W / 2, cy: panel + 2 * pad + band * 0.55, size: band * 0.66, maxWidth: panel * 0.9 } : null
      };
    }

    if (style === 'ticket') {
      const pad = panel * 0.07;
      const band = hasText ? panel * 0.2 : 0;
      const W = panel + 2 * pad, H = panel + 2 * pad + band;
      const rad = panel * 0.05;
      const notch = panel * 0.05;
      const ny = panel + 2 * pad - band * 0.1;
      return {
        W, H, px: pad, py: pad,
        back: (ox, oy) => {
          const body = new Path().rrect(ox - pad, oy - pad, W, H, rad, rad, rad, rad);
          body.circle(ox - pad, oy - pad + ny, notch);
          body.circle(ox - pad + W, oy - pad + ny, notch);
          return [
            { k: 'path', path: body, paint: paintSolid(color), rule: 'evenodd' },
            { k: 'path', path: new Path().rrect(ox, oy, panel, panel, rad * 0.5, rad * 0.5, rad * 0.5, rad * 0.5), paint: paintSolid(panelColor) }
          ];
        },
        front: (ox, oy) => {
          const p = new Path();
          const dash = panel * 0.03, step = dash * 2, y = oy - pad + ny;
          for (let x = ox - pad + notch * 1.4; x < ox - pad + W - notch * 1.4; x += step) {
            p.rrect(x, y - dash * 0.16, dash, dash * 0.32, dash * 0.16, dash * 0.16, dash * 0.16, dash * 0.16);
          }
          return [{ k: 'path', path: p, paint: paintSolid(frame.textColor || '#ffffff'), opacity: 0.45 }];
        },
        textSpec: hasText ? { cx: W / 2, cy: panel + 2 * pad + band * 0.55, size: band * 0.52, maxWidth: panel * 0.86 } : null
      };
    }

    if (style === 'polaroid') {
      const pad = panel * 0.09;
      const band = hasText ? panel * 0.26 : panel * 0.14;
      const W = panel + 2 * pad, H = panel + pad + band;
      return {
        W, H, px: pad, py: pad,
        back: (ox, oy) => [
          { k: 'path', path: new Path().rect(ox - pad, oy - pad, W, H), paint: paintSolid(color || '#ffffff') }
        ],
        front: () => [],
        textSpec: hasText ? { cx: W / 2, cy: panel + pad + band * 0.55, size: band * 0.46, maxWidth: panel * 0.88 } : null
      };
    }

    if (style === 'ring') {
      /* a round panel already is a circle; a square one needs its corners inside */
      const inner = round ? panel / 2 + panel * 0.015 : (panel / 2) * Math.SQRT2 + panel * 0.02;
      const band = panel * 0.17;
      const outer = inner + band;
      const W = outer * 2, H = outer * 2;
      return {
        W, H, px: outer - panel / 2, py: outer - panel / 2,
        back: (ox, oy) => {
          const cx = ox + panel / 2, cy = oy + panel / 2;
          return [
            { k: 'path', path: new Path().circle(cx, cy, outer), paint: paintSolid(color) },
            { k: 'path', path: new Path().circle(cx, cy, inner), paint: paintSolid(panelColor) }
          ];
        },
        front: () => [],
        textSpec: hasText ? { arc: true, cx: W / 2, cy: H / 2, radius: inner + band / 2, size: band * 0.56 } : null
      };
    }

    return Object.assign({ W: panel, H: panel, px: 0, py: 0 }, none);
  }

  /* ───────────────────────── SVG writer ───────────────────────── */
  function toSVG(scene, opts = {}) {
    const id = opts.id || U.uid('q');
    const px = opts.px || 0;
    const defs = [];
    let dn = 0;
    const paintAttr = (paint, opacity) => {
      if (!paint) return 'fill="none"';
      let fill;
      if (paint.kind === 'solid') fill = paint.color;
      else {
        const gid = `${id}-p${dn++}`;
        if (paint.kind === 'linear') {
          defs.push(`<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${num(paint.x1)}" y1="${num(paint.y1)}" x2="${num(paint.x2)}" y2="${num(paint.y2)}">` +
            paint.stops.map((c, i) => `<stop offset="${paint.stops.length === 1 ? 1 : i / (paint.stops.length - 1)}" stop-color="${U.esc(c)}"/>`).join('') +
            `</linearGradient>`);
        } else if (paint.kind === 'radial') {
          defs.push(`<radialGradient id="${gid}" gradientUnits="userSpaceOnUse" cx="${num(paint.cx)}" cy="${num(paint.cy)}" r="${num(paint.r)}">` +
            paint.stops.map((c, i) => `<stop offset="${paint.stops.length === 1 ? 1 : i / (paint.stops.length - 1)}" stop-color="${U.esc(c)}"/>`).join('') +
            `</radialGradient>`);
        } else if (paint.kind === 'pattern') {
          defs.push(`<pattern id="${gid}" patternUnits="userSpaceOnUse" x="${num(paint.x)}" y="${num(paint.y)}" width="${num(paint.w)}" height="${num(paint.h)}">` +
            `<image href="${U.esc(paint.href)}" x="0" y="0" width="${num(paint.w)}" height="${num(paint.h)}" preserveAspectRatio="xMidYMid slice"/>` +
            (paint.darken ? `<rect width="${num(paint.w)}" height="${num(paint.h)}" fill="#000" fill-opacity="${num(paint.darken)}"/>` : '') +
            `</pattern>`);
        }
        fill = `url(#${gid})`;
      }
      return `fill="${U.esc(fill)}"` + (opacity != null && opacity < 1 ? ` fill-opacity="${num(opacity)}"` : '');
    };

    let body = '';
    for (const layer of scene.layers) {
      if (layer.k === 'path') {
        if (layer.path.empty) continue;
        body += `<path d="${layer.path.toSVG()}" ${paintAttr(layer.paint, layer.opacity)}` +
          (layer.rule === 'evenodd' ? ' fill-rule="evenodd"' : '') + '/>';
      } else if (layer.k === 'image') {
        let clip = '';
        if (layer.radius) {
          const cid = `${id}-c${dn++}`;
          defs.push(`<clipPath id="${cid}"><rect x="${num(layer.x)}" y="${num(layer.y)}" width="${num(layer.w)}" height="${num(layer.h)}" rx="${num(layer.radius)}"/></clipPath>`);
          clip = ` clip-path="url(#${cid})"`;
        }
        body += `<image href="${U.esc(layer.href)}" x="${num(layer.x)}" y="${num(layer.y)}" width="${num(layer.w)}" height="${num(layer.h)}" preserveAspectRatio="xMidYMid meet"${clip}/>`;
      } else if (layer.k === 'icon') {
        const s = Math.min(layer.w, layer.h) / (layer.viewBox || 24);
        body += `<g transform="translate(${num(layer.x + layer.w / 2 - (layer.viewBox * s) / 2)} ${num(layer.y + layer.h / 2 - (layer.viewBox * s) / 2)}) scale(${num(s)})">` +
          `<path d="${U.esc(layer.d)}" fill="${U.esc(layer.color)}" fill-rule="evenodd"/></g>`;
      } else if (layer.k === 'text') {
        body += `<text x="${num(layer.x)}" y="${num(layer.y)}" text-anchor="middle" dominant-baseline="central"` +
          ` font-family="${U.esc(layer.font)}" font-size="${num(layer.size)}" font-weight="800"` +
          ` letter-spacing="${num((layer.tracking || 0) * layer.size)}" fill="${U.esc(layer.fill)}">${U.esc(layer.str)}</text>`;
      }
    }

    const w = px || 1000;
    const h = px ? (px * scene.H) / scene.W : (1000 * scene.H) / scene.W;
    const size = opts.mm
      ? ` width="${num(opts.mm)}mm" height="${num((opts.mm * scene.H) / scene.W)}mm"`
      : ` width="${num(w)}" height="${num(h)}"`;
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"` +
      ` viewBox="0 0 ${num(scene.W)} ${num(scene.H)}"${size} shape-rendering="geometricPrecision">` +
      (opts.title ? `<title>${U.esc(opts.title)}</title>` : '') +
      (defs.length ? `<defs>${defs.join('')}</defs>` : '') + body + '</svg>';
  }

  /* ───────────────────────── EPS writer (solid colours) ───────────────────────── */
  function toEPS(scene, opts = {}) {
    const mm = opts.mm || 40;
    const ptW = (mm * 72) / 25.4;
    const scale = ptW / scene.W;
    const ptH = scene.H * scale;
    const notes = [];
    let body = '';
    const setColor = c => {
      const p = U.parseColor(c);
      return `${num(p.r / 255)} ${num(p.g / 255)} ${num(p.b / 255)} setrgbcolor\n`;
    };
    for (const layer of scene.layers) {
      if (layer.k === 'path') {
        if (layer.path.empty) continue;
        if (layer.paint && layer.paint.kind !== 'solid') notes.push('gradient/photo fills are flattened to one colour in EPS');
        const color = paintColor(layer.paint, '#000000');
        body += setColor(color) + 'newpath\n' + layer.path.toPS(scale, ptH) + (layer.rule === 'evenodd' ? 'eofill\n' : 'fill\n');
      } else if (layer.k === 'icon') {
        notes.push('icon logos are flattened into the EPS');
        const s = Math.min(layer.w, layer.h) / (layer.viewBox || 24);
        /* icon paths are SVG "d" strings: draw them as a filled box instead of
           silently dropping the logo */
        body += setColor(layer.color) + 'newpath\n' +
          new Path().rect(layer.x, layer.y, layer.w, layer.h).toPS(scale, ptH) + 'fill\n';
      } else if (layer.k === 'image') {
        notes.push('bitmap logos are left out of EPS — use PDF or SVG for those');
      }
    }
    const head = `%!PS-Adobe-3.0 EPSF-3.0\n%%Creator: QR Studio (dump.yanikroesti.ch)\n` +
      `%%Title: ${(opts.title || 'QR code').replace(/[()\\]/g, '')}\n` +
      `%%BoundingBox: 0 0 ${Math.ceil(ptW)} ${Math.ceil(ptH)}\n` +
      `%%HiResBoundingBox: 0 0 ${num(ptW)} ${num(ptH)}\n%%EndComments\n` +
      `/m {moveto} bind def /l {lineto} bind def /c {curveto} bind def /h {closepath} bind def\n`;
    return { eps: head + body + 'showpage\n%%EOF\n', notes: [...new Set(notes)] };
  }

  /* ───────────────────────── raster / PDF / decode ───────────────────────── */
  function svgToImage(svg) {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { resolve(img); setTimeout(() => URL.revokeObjectURL(url), 2000); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not render the code')); };
      img.src = url;
    });
  }

  async function toCanvas(scene, px, opts = {}) {
    const svg = toSVG(scene, { px, id: U.uid('r') });
    const img = await svgToImage(svg);
    const w = px, h = Math.round((px * scene.H) / scene.W);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    if (opts.background) { ctx.fillStyle = opts.background; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(img, 0, 0, w, h);
    return cv;
  }

  async function rasterize(scene, { px = 1024, type = 'image/png', quality = 0.95, background = null } = {}) {
    const cv = await toCanvas(scene, px, { background: background || (type === 'image/png' ? null : '#ffffff') });
    return new Promise(res => cv.toBlob(b => res(b), type, quality));
  }

  async function toPDF(scene, { mm = 50, title = 'QR code', page = 'fit' } = {}) {
    await U.loadScript(QS.CDN.jspdf);
    await U.loadScript(QS.CDN.svg2pdf);
    const jsPDFCtor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    const w = mm, h = (mm * scene.H) / scene.W;
    const size = page === 'a4' ? [210, 297] : [w, h];
    const doc = new jsPDFCtor({ unit: 'mm', format: size, orientation: size[0] > size[1] ? 'landscape' : 'portrait' });
    const x = page === 'a4' ? (210 - w) / 2 : 0;
    const y = page === 'a4' ? (297 - h) / 2 : 0;
    const svg = toSVG(scene, { px: 1000, id: U.uid('p') });
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-10000px;top:0;opacity:0';
    holder.innerHTML = svg;
    document.body.appendChild(holder);
    try {
      const el = holder.querySelector('svg');
      const conv = (window.svg2pdf && (window.svg2pdf.svg2pdf || window.svg2pdf)) || doc.svg;
      if (typeof doc.svg === 'function') await doc.svg(el, { x, y, width: w, height: h });
      else await conv(el, doc, { x, y, width: w, height: h });
      doc.setProperties({ title });
      return doc.output('blob');
    } finally {
      holder.remove();
    }
  }

  let jsqrReady = null;
  function ensureJsQR() {
    if (!jsqrReady) jsqrReady = (window.jsQR ? Promise.resolve() : U.loadScript(QS.CDN.jsqr));
    return jsqrReady;
  }

  /* Render the finished design and read it back — the honest scannability test.
     A phone camera never sees crisp vector edges: it sees a slightly soft image
     at a modest resolution. So the design is decoded a few ways — softened like
     a camera would, small, and crisp — and passes if any of them reads back the
     exact content. Dots and bars only decode once softened, just like on a phone. */
  async function scanCheck(scene, expected) {
    await ensureJsQR();
    const img = await svgToImage(toSVG(scene, { px: 640, id: U.uid('sc') }));
    const passes = [
      { px: 560, blur: 0.35 }, { px: 300, blur: 0.3 }, { px: 560, blur: 0 }, { px: 240, blur: 0 }
    ];
    let decoded = null;
    for (const pass of passes) {
      const cv = document.createElement('canvas');
      cv.width = pass.px;
      cv.height = Math.round((pass.px * scene.H) / scene.W);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cv.width, cv.height);
      const modulePx = pass.px / scene.W;
      if (pass.blur && 'filter' in ctx) {
        ctx.filter = `blur(${(modulePx * pass.blur).toFixed(2)}px)`;
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
      } else if (pass.blur) {
        /* no canvas filter (older Safari): soften by shrinking and growing back */
        const tiny = document.createElement('canvas');
        tiny.width = Math.max(40, Math.round(cv.width / (modulePx * pass.blur * 2.2)));
        tiny.height = Math.round((tiny.width * cv.height) / cv.width);
        tiny.getContext('2d').drawImage(img, 0, 0, tiny.width, tiny.height);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(tiny, 0, 0, cv.width, cv.height);
      } else {
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
      }
      const data = ctx.getImageData(0, 0, cv.width, cv.height);
      const res = window.jsQR(data.data, data.width, data.height, { inversionAttempts: 'attemptBoth' });
      if (res) decoded = res.data;
      if (res && res.data === expected) return { ok: true, decoded: res.data, pass };
    }
    if ('BarcodeDetector' in window) {
      try {
        const cv = document.createElement('canvas');
        cv.width = 560;
        cv.height = Math.round((560 * scene.H) / scene.W);
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        const found = await new window.BarcodeDetector({ formats: ['qr_code'] }).detect(cv);
        if (found && found[0] && found[0].rawValue === expected) return { ok: true, decoded: expected, pass: 'native' };
      } catch (e) { /* no native decoder */ }
    }
    return { ok: false, decoded };
  }

  /* ───────────────────────── public API ───────────────────────── */
  async function ready(design) {
    await ensureQrLib();
    const d = normalizeDesign(design);
    if (d.frame && d.frame.style !== 'none' && String(d.frame.text || '').trim()) await fontsReady([d.frame.font]);
  }

  /* tiny previews for the style pickers — a 5×5 patch or a single eye */
  const SAMPLE = [[1, 1, 0, 1, 1], [1, 0, 1, 0, 1], [0, 1, 1, 1, 0], [1, 0, 1, 0, 1], [1, 1, 0, 1, 1]];
  function sampleSVG(kind, style, opts = {}) {
    const color = opts.color || '#111111';
    const size = opts.size || 42;
    if (kind === 'dots') {
      const grid = (r, c) => (r >= 0 && c >= 0 && r < 5 && c < 5 ? !!SAMPLE[r][c] : false);
      const p = dotPath(style, grid, 5, 0, 0, opts.scale || 1, 4242);
      return `<svg viewBox="-0.3 -0.3 5.6 5.6" width="${size}" height="${size}" aria-hidden="true"><path d="${p.toSVG()}" fill="${color}"/></svg>`;
    }
    if (kind === 'frame') {
      const p = eyeFramePath(style, 0, 0, 'tl');
      return `<svg viewBox="-0.3 -0.3 7.6 7.6" width="${size}" height="${size}" aria-hidden="true"><path d="${p.toSVG()}" fill="${color}" fill-rule="evenodd"/></svg>`;
    }
    const p = eyeBallPath(style, 0, 0, 'tl');
    return `<svg viewBox="1.7 1.7 3.6 3.6" width="${size}" height="${size}" aria-hidden="true"><path d="${p.toSVG()}" fill="${color}"/></svg>`;
  }

  /* the same drawing without the <svg> wrapper, for embedding in a bigger document */
  function toFragment(scene, opts = {}) {
    const svg = toSVG(scene, opts);
    return svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  }

  QS.engine = {
    Path, DOT_STYLES, EYE_FRAMES, EYE_BALLS, FRAMES, FONTS, PRESETS, DEFAULT_DESIGN, toFragment,
    normalizeDesign, deepMerge, matrix, compose, toSVG, toEPS, toCanvas, rasterize, toPDF, sampleSVG,
    scanCheck, ready, ensureQrLib, primeFont, fontsReady, byteCapacity, paintSolid,
    svgToImage
  };
})();
