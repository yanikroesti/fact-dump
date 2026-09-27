/* Easel — element factories: lines, shapes, frames, text + effects, icons, QR codes, charts,
   photo filters, crop and background removal. */
(() => {
const EZ = window.EZ;
const { $, h } = EZ;

/* ═════ Line with arrowheads (custom fabric class, keeps heads undistorted while scaling) ═════ */
fabric.EzLine = fabric.util.createClass(fabric.Object, {
  type: 'ezLine',
  objectCaching: false,
  startHead: 'none', endHead: 'none', dash: 'solid',
  initialize(opts = {}) {
    this.callSuper('initialize', { stroke: '#1b1a24', strokeWidth: 6, width: 300, height: 6, fill: '', ...opts });
    this.syncHeight();
  },
  syncHeight() { this.height = Math.max(this.strokeWidth, 2); this.strokeWidth = this.strokeWidth; },
  _set(k, v) { this.callSuper('_set', k, v); if (k === 'strokeWidth') this.height = Math.max(v, 2); return this; },
  headSize() { return this.strokeWidth * 2.6 + 8; },
  _render(ctx) {
    const sx = this.scaleX || 1, sy = this.scaleY || 1;
    ctx.save();
    ctx.scale(1 / sx, 1 / sy);
    const L = this.width * sx / 2, sw = this.strokeWidth, hs = this.headSize();
    ctx.lineWidth = sw;
    ctx.strokeStyle = this.stroke;
    ctx.fillStyle = this.stroke;
    ctx.lineCap = this.dash === 'dotted' ? 'round' : 'round';
    ctx.lineJoin = 'round';
    const trim = t => (t === 'triangle' ? hs * 0.8 : t === 'circle' ? hs * 0.35 : 0);
    if (this.dash === 'dashed') ctx.setLineDash([sw * 2.6, sw * 2]);
    if (this.dash === 'dotted') ctx.setLineDash([0.001, sw * 2]);
    ctx.beginPath();
    ctx.moveTo(-L + trim(this.startHead), 0);
    ctx.lineTo(L - trim(this.endHead), 0);
    ctx.stroke();
    ctx.setLineDash([]);
    this.drawHead(ctx, -L, -1, this.startHead, hs, sw);
    this.drawHead(ctx, L, 1, this.endHead, hs, sw);
    ctx.restore();
  },
  drawHead(ctx, x, dir, t, hs) {
    if (!t || t === 'none') return;
    ctx.beginPath();
    if (t === 'arrow') { ctx.moveTo(x - dir * hs, -hs * 0.7); ctx.lineTo(x, 0); ctx.lineTo(x - dir * hs, hs * 0.7); ctx.stroke(); }
    else if (t === 'triangle') { ctx.moveTo(x - dir * hs, -hs * 0.62); ctx.lineTo(x, 0); ctx.lineTo(x - dir * hs, hs * 0.62); ctx.closePath(); ctx.fill(); }
    else if (t === 'circle') { ctx.arc(x - dir * hs * 0.35, 0, hs * 0.38, 0, Math.PI * 2); ctx.fill(); }
    else if (t === 'bar') { ctx.moveTo(x, -hs * 0.6); ctx.lineTo(x, hs * 0.6); ctx.stroke(); }
  },
  toObject(props) {
    return fabric.util.object.extend(this.callSuper('toObject', props), { startHead: this.startHead, endHead: this.endHead, dash: this.dash });
  },
  _toSVG() {
    const sx = this.scaleX || 1, sy = this.scaleY || 1, L = this.width * sx / 2, sw = this.strokeWidth, hs = this.headSize();
    const c = this.stroke;
    const dash = this.dash === 'dashed' ? `stroke-dasharray="${sw * 2.6} ${sw * 2}"` : this.dash === 'dotted' ? `stroke-dasharray="0.001 ${sw * 2}"` : '';
    const head = (x, dir, t) => {
      if (t === 'arrow') return `<polyline points="${x - dir * hs},${-hs * .7} ${x},0 ${x - dir * hs},${hs * .7}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
      if (t === 'triangle') return `<polygon points="${x - dir * hs},${-hs * .62} ${x},0 ${x - dir * hs},${hs * .62}" fill="${c}"/>`;
      if (t === 'circle') return `<circle cx="${x - dir * hs * .35}" cy="0" r="${hs * .38}" fill="${c}"/>`;
      if (t === 'bar') return `<line x1="${x}" y1="${-hs * .6}" x2="${x}" y2="${hs * .6}" stroke="${c}" stroke-width="${sw}" stroke-linecap="round"/>`;
      return '';
    };
    return [`<g transform="scale(${1 / sx} ${1 / sy})">`,
      `<line x1="${-L}" y1="0" x2="${L}" y2="0" stroke="${c}" stroke-width="${sw}" stroke-linecap="round" ${dash}/>`,
      head(-L, -1, this.startHead), head(L, 1, this.endHead), '</g>'];
  },
});
fabric.EzLine.fromObject = (o, cb) => fabric.Object._fromObject('EzLine', o, cb);

/* ═════ Shapes ═════ */
const SHAPE_FILL = '#b9b5c9';
const P = (d) => k => new fabric.Path(d, { fill: SHAPE_FILL, scaleX: 2 * k, scaleY: 2 * k });
EZ.SHAPES = [
  { id: 'rect', label: 'Square', make: k => new fabric.Rect({ width: 220 * k, height: 220 * k, fill: SHAPE_FILL }) },
  { id: 'rounded', label: 'Rounded square', make: k => new fabric.Rect({ width: 220 * k, height: 220 * k, rx: 36 * k, ry: 36 * k, fill: SHAPE_FILL }) },
  { id: 'circle', label: 'Circle', make: k => new fabric.Ellipse({ rx: 110 * k, ry: 110 * k, fill: SHAPE_FILL }) },
  { id: 'triangle', label: 'Triangle', make: k => new fabric.Triangle({ width: 230 * k, height: 200 * k, fill: SHAPE_FILL }) },
  { id: 'diamond', label: 'Diamond', d: 'M50 0 L100 50 L50 100 L0 50 Z' },
  { id: 'pentagon', label: 'Pentagon', d: 'M50 0 L100 38 L81 100 L19 100 L0 38 Z' },
  { id: 'hexagon', label: 'Hexagon', d: 'M25 0 L75 0 L100 50 L75 100 L25 100 L0 50 Z' },
  { id: 'star', label: 'Star', d: 'M50 0 L62 35 L99 36 L69 58 L80 94 L50 72 L20 94 L31 58 L1 36 L38 35 Z' },
  { id: 'burst', label: 'Burst', d: 'M50 0 L59 20 L79 9 L77 32 L100 34 L84 50 L100 66 L77 68 L79 91 L59 80 L50 100 L41 80 L21 91 L23 68 L0 66 L16 50 L0 34 L23 32 L21 9 L41 20 Z' },
  { id: 'heart', label: 'Heart', d: 'M50 92 C20 70 2 52 2 30 C2 14 14 3 28 3 C38 3 45 9 50 17 C55 9 62 3 72 3 C86 3 98 14 98 30 C98 52 80 70 50 92 Z' },
  { id: 'arrowR', label: 'Arrow', d: 'M0 32 L58 32 L58 8 L100 50 L58 92 L58 68 L0 68 Z' },
  { id: 'chevron', label: 'Chevron', d: 'M0 0 L60 0 L100 50 L60 100 L0 100 L40 50 Z' },
  { id: 'plus', label: 'Cross', d: 'M35 0 L65 0 L65 35 L100 35 L100 65 L65 65 L65 100 L35 100 L35 65 L0 65 L0 35 L35 35 Z' },
  { id: 'bubble', label: 'Speech bubble', d: 'M12 0 L88 0 C95 0 100 5 100 12 L100 62 C100 69 95 74 88 74 L40 74 L18 96 L22 74 L12 74 C5 74 0 69 0 62 L0 12 C0 5 5 0 12 0 Z' },
  { id: 'cloud', label: 'Cloud', d: 'M26 82 C11 82 0 71 0 57 C0 44 10 34 23 33 C25 17 38 5 54 5 C68 5 80 14 84 27 C94 30 100 40 100 52 C100 68 88 82 72 82 Z' },
  { id: 'arch', label: 'Arch', d: 'M0 100 L0 46 C0 20 22 0 50 0 C78 0 100 20 100 46 L100 100 Z' },
  { id: 'half', label: 'Half circle', d: 'M0 50 A50 50 0 0 1 100 50 Z' },
  { id: 'para', label: 'Parallelogram', d: 'M25 0 L100 0 L75 100 L0 100 Z' },
  { id: 'blob', label: 'Blob', d: 'M71 8 C88 16 99 36 96 56 C93 77 76 95 54 97 C31 99 9 86 4 64 C-1 42 10 18 30 8 C43 1 58 2 71 8 Z' },
  { id: 'ring', label: 'Ring', make: k => new fabric.Circle({ radius: 100 * k, fill: '', stroke: SHAPE_FILL, strokeWidth: 26 * k, strokeUniform: true }) },
  { id: 'frameRect', label: 'Outline square', make: k => new fabric.Rect({ width: 220 * k, height: 220 * k, fill: '', stroke: '#1b1a24', strokeWidth: 6 * k, strokeUniform: true }) },
];
EZ.SHAPES.forEach(s => { if (!s.make && s.d) s.make = P(s.d); });
EZ.LINES = [
  { id: 'line', label: 'Line', o: {} },
  { id: 'dashed', label: 'Dashed line', o: { dash: 'dashed' } },
  { id: 'dotted', label: 'Dotted line', o: { dash: 'dotted' } },
  { id: 'arrow', label: 'Arrow', o: { endHead: 'arrow' } },
  { id: 'arrow2', label: 'Solid arrow', o: { endHead: 'triangle' } },
  { id: 'double', label: 'Double arrow', o: { startHead: 'triangle', endHead: 'triangle' } },
  { id: 'dotline', label: 'Connector', o: { startHead: 'circle', endHead: 'circle' } },
];
// Tiny SVG previews for panel tiles
EZ.shapePreview = s => {
  if (s.d) return `<svg viewBox="-4 -4 108 108"><path d="${s.d}" fill="${SHAPE_FILL}"/></svg>`;
  return {
    rect: '<svg viewBox="0 0 100 100"><rect x="4" y="4" width="92" height="92" fill="#b9b5c9"/></svg>',
    rounded: '<svg viewBox="0 0 100 100"><rect x="4" y="4" width="92" height="92" rx="16" fill="#b9b5c9"/></svg>',
    circle: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="#b9b5c9"/></svg>',
    triangle: '<svg viewBox="0 0 100 100"><path d="M50 6 L96 92 L4 92 Z" fill="#b9b5c9"/></svg>',
    ring: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="38" fill="none" stroke="#b9b5c9" stroke-width="14"/></svg>',
    frameRect: '<svg viewBox="0 0 100 100"><rect x="8" y="8" width="84" height="84" fill="none" stroke="#1b1a24" stroke-width="5"/></svg>',
  }[s.id] || '';
};
EZ.linePreview = l => {
  const o = l.o, dash = o.dash === 'dashed' ? 'stroke-dasharray="10 7"' : o.dash === 'dotted' ? 'stroke-dasharray="0.1 9"' : '';
  const hd = (x, dir, t) => t === 'arrow' ? `<polyline points="${x - dir * 16},38 ${x},50 ${x - dir * 16},62" fill="none" stroke="#1b1a24" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`
    : t === 'triangle' ? `<polygon points="${x - dir * 18},39 ${x},50 ${x - dir * 18},61" fill="#1b1a24"/>` : t === 'circle' ? `<circle cx="${x - dir * 5}" cy="50" r="7" fill="#1b1a24"/>` : '';
  return `<svg viewBox="0 0 100 100"><line x1="10" y1="50" x2="90" y2="50" stroke="#1b1a24" stroke-width="5" stroke-linecap="round" ${dash}/>${hd(10, -1, o.startHead)}${hd(90, 1, o.endHead)}</svg>`;
};

EZ.addShape = (id, at) => {
  const k = EZ.k();
  const line = EZ.LINES.find(l => l.id === id);
  if (line) {
    const o = new fabric.EzLine({ width: 360 * k, strokeWidth: Math.max(2, Math.round(6 * k)), ezType: 'line', ...line.o });
    return EZ.add(o, { at, fit: 0.8 });
  }
  const s = EZ.SHAPES.find(x => x.id === id) || EZ.SHAPES[0];
  const o = s.make(k);
  o.set({ ezType: 'shape', ezData: { shape: s.id }, strokeUniform: true });
  return EZ.add(o, { at, fit: 0.8 });
};

/* ═════ Frames (image placeholders with a mask) ═════ */
EZ.FRAMES = [
  { id: 'square', mask: 'none', w: 1, h: 1 },
  { id: 'rounded', mask: 'rounded', w: 1, h: 1, r: 0.12 },
  { id: 'circle', mask: 'circle', w: 1, h: 1 },
  { id: 'portrait', mask: 'rounded', w: 3, h: 4, r: 0.06 },
  { id: 'landscape', mask: 'none', w: 16, h: 9 },
  { id: 'arch', mask: 'arch', w: 3, h: 4 },
  { id: 'heart', mask: 'heart', w: 1, h: 0.92 },
  { id: 'star', mask: 'star', w: 1, h: 0.96 },
  { id: 'hexagon', mask: 'hexagon', w: 1, h: 0.92 },
  { id: 'blob', mask: 'blob', w: 1, h: 1 },
  { id: 'diamond', mask: 'diamond', w: 1, h: 1 },
  { id: 'triangle', mask: 'triangle', w: 1, h: 0.9 },
];
const placeholder = (w, hh) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hh}" viewBox="0 0 ${w} ${hh}"><rect width="${w}" height="${hh}" fill="#dedbe7"/>` +
  `<g transform="translate(${w / 2 - 36} ${hh / 2 - 30}) scale(3)" fill="none" stroke="#a9a5b9" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="1" width="22" height="18" rx="2.5"/><circle cx="8" cy="7.5" r="2"/><path d="M23 14 l-5.5-5.5 L6 20"/></g></svg>`);
EZ.addFrame = (id, at) => new Promise(res => {
  const f = EZ.FRAMES.find(x => x.id === id) || EZ.FRAMES[0];
  const base = 400, w = Math.round(base * Math.min(1, f.w / f.h)), hh = Math.round(base * Math.min(1, f.h / f.w));
  fabric.Image.fromURL(placeholder(w, hh), img => {
    img.set({ ezType: 'frame', ezData: { frame: f.id, filled: false } });
    const k = EZ.k() * 1.1;
    img.scale(k);
    EZ.applyMask(img, f.mask, f.r ? f.r * Math.min(w, hh) * k : 0);
    EZ.add(img, { at, fit: 0.7 });
    res(img);
  });
});
EZ.framePreview = f => {
  const d = EZ.MASK_PATHS[f.mask];
  const w = 80 * Math.min(1, f.w / f.h), hh = 80 * Math.min(1, f.h / f.w), x = 50 - w / 2, y = 50 - hh / 2;
  const fill = '#cfcbdc';
  if (f.mask === 'circle') return `<svg viewBox="0 0 100 100"><ellipse cx="50" cy="50" rx="${w / 2}" ry="${hh / 2}" fill="${fill}"/></svg>`;
  if (d) return `<svg viewBox="0 0 100 100"><g transform="translate(${x} ${y}) scale(${w / 100} ${hh / 100})"><path d="${d}" fill="${fill}"/></g></svg>`;
  return `<svg viewBox="0 0 100 100"><rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="${f.r ? f.r * Math.min(w, hh) : 0}" fill="${fill}"/></svg>`;
};

/* ═════ Text ═════ */
EZ.TEXT_PRESETS = {
  heading: { text: 'Add a heading', fontSize: 84, fontWeight: 800, fontFamily: 'Inter' },
  subheading: { text: 'Add a subheading', fontSize: 46, fontWeight: 700, fontFamily: 'Inter' },
  body: { text: 'Add a little bit of body text', fontSize: 28, fontWeight: 400, fontFamily: 'Inter' },
};
EZ.makeText = async (text, style = {}) => {
  const { text: _ignored, noScale, ...st } = style;
  const k = noScale ? 1 : EZ.k();
  const fs = (st.fontSize || 28) * k;
  const t = new fabric.Textbox(text, {
    fontFamily: 'Inter', fill: '#1b1a24', textAlign: 'center', lineHeight: 1.18, charSpacing: 0,
    splitByGrapheme: false, ezType: 'text', ...st, width: EZ.W() * 0.9, fontSize: fs,
  });
  await EZ.loadFont(t.fontFamily, t.fontWeight, t.fontStyle);
  t.initDimensions();
  const w = Math.min(EZ.W() * 0.9, Math.max(fs * 2, t.calcTextWidth() + 4));
  t.set('width', st.width ? st.width * k : w);
  t.initDimensions();
  return t;
};
EZ.addTextPreset = async (kind, text, at) => {
  const p = EZ.TEXT_PRESETS[kind] || EZ.TEXT_PRESETS.body;
  const t = await EZ.makeText(text || p.text, p);
  EZ.add(t, { at, fit: 0.95 });
  return t;
};
// Font pairings: each is a stack of text lines added together.
EZ.COMBOS = [
  { name: 'Launch', lines: [{ t: 'SUMMER', f: 'Bebas Neue', s: 120, w: 400, c: '#1b1a24', cs: 80 }, { t: 'collection 2026', f: 'Dancing Script', s: 54, w: 700, c: '#ff5c35' }] },
  { name: 'Editorial', lines: [{ t: 'The quiet art', f: 'Playfair Display', s: 72, w: 700, c: '#1b1a24', i: 1 }, { t: 'OF DOING LESS', f: 'Montserrat', s: 24, w: 700, c: '#6c6a7d', cs: 400 }] },
  { name: 'Sale', lines: [{ t: '50% OFF', f: 'Anton', s: 130, w: 400, c: '#ff3131' }, { t: 'THIS WEEKEND ONLY', f: 'Poppins', s: 26, w: 700, c: '#1b1a24', cs: 250 }] },
  { name: 'Hello', lines: [{ t: 'hello', f: 'Pacifico', s: 110, w: 400, c: '#8c52ff' }, { t: 'nice to meet you', f: 'Quicksand', s: 30, w: 700, c: '#1b1a24' }] },
  { name: 'Retro', lines: [{ t: 'GAME ON', f: 'Press Start 2P', s: 56, w: 400, c: '#1b1a24' }, { t: 'Level up every day', f: 'Space Mono', s: 26, w: 400, c: '#0097b2' }] },
  { name: 'Notes', lines: [{ t: 'Chapter 4', f: 'Caveat', s: 50, w: 700, c: '#5271ff' }, { t: 'Telekommunikation', f: 'Fraunces', s: 64, w: 900, c: '#1b1a24' }] },
  { name: 'Bold', lines: [{ t: 'MAKE IT', f: 'Archivo Black', s: 90, w: 400, c: '#1b1a24' }, { t: 'HAPPEN', f: 'Archivo Black', s: 90, w: 400, c: '#ff5c35' }] },
  { name: 'Wedding', lines: [{ t: 'Anna & Luca', f: 'Great Vibes', s: 96, w: 400, c: '#8b4513' }, { t: 'SAVE THE DATE · 12.06.2027', f: 'Cormorant Garamond', s: 28, w: 700, c: '#545454', cs: 200 }] },
];
EZ.addCombo = async (combo, at) => {
  const k = EZ.k();
  const items = [];
  for (const l of combo.lines) {
    items.push(await EZ.makeText(l.t, { fontFamily: l.f, fontSize: l.s, fontWeight: l.w, fill: l.c, fontStyle: l.i ? 'italic' : 'normal', charSpacing: l.cs || 0 }));
  }
  const c = at || EZ.viewCenter();
  const gap = 8 * k;
  const total = items.reduce((s, t) => s + t.height, 0) + gap * (items.length - 1);
  let y = c.y - total / 2;
  const cv = EZ.cv;
  cv.discardActiveObject();
  for (const t of items) { t.set({ left: c.x - t.width / 2, top: y }); y += t.height + gap; cv.add(t); t.setCoords(); }
  cv.setActiveObject(new fabric.ActiveSelection(items, { canvas: cv }));
  cv.requestRenderAll();
};

// Text effects (Canva-style). effect = {type, color, amount}
EZ.EFFECTS = [
  { id: 'none', label: 'None' }, { id: 'shadow', label: 'Shadow' }, { id: 'lift', label: 'Lift' },
  { id: 'hollow', label: 'Hollow' }, { id: 'outline', label: 'Outline' }, { id: 'echo', label: 'Echo' },
  { id: 'neon', label: 'Neon' }, { id: 'highlight', label: 'Highlight' }, { id: 'glitch', label: 'Glitch' },
];
EZ.applyEffect = (o, type, opts = {}) => {
  const prev = o.effect || { type: 'none' };
  // restore the real fill if we are leaving "hollow"
  if (prev.type === 'hollow' && prev.fill) o.set('fill', prev.fill);
  const fill = typeof o.fill === 'string' ? o.fill : '#1b1a24';
  const fs = o.fontSize;
  const amount = opts.amount ?? (prev.type === type ? prev.amount : 50);
  const a = amount / 100;
  const color = opts.color ?? (prev.type === type ? prev.color : null);
  o.set({ shadow: null, stroke: null, strokeWidth: 0, textBackgroundColor: '', paintFirst: 'fill' });
  const eff = { type, amount };
  switch (type) {
    case 'shadow':
      eff.color = color || '#000000';
      o.set('shadow', new fabric.Shadow({ color: new fabric.Color(eff.color).setAlpha(0.45).toRgba(), blur: fs * 0.12 * a * 2, offsetX: fs * 0.06 * a * 2, offsetY: fs * 0.06 * a * 2 }));
      break;
    case 'lift':
      o.set('shadow', new fabric.Shadow({ color: `rgba(0,0,0,${0.15 + 0.35 * a})`, blur: fs * 0.35, offsetX: 0, offsetY: fs * 0.08 }));
      break;
    case 'hollow':
      eff.fill = fill;
      o.set({ fill: 'rgba(0,0,0,0)', stroke: fill, strokeWidth: Math.max(1, fs * 0.02 + fs * 0.04 * a) });
      break;
    case 'outline':
      eff.color = color || '#ffffff';
      o.set({ stroke: eff.color, strokeWidth: Math.max(1, fs * 0.2 * a), paintFirst: 'stroke', strokeLineJoin: 'round' });
      break;
    case 'echo':
      eff.color = color || fill;
      o.set('shadow', new fabric.Shadow({ color: new fabric.Color(eff.color).setAlpha(0.5).toRgba(), blur: 0, offsetX: fs * 0.08 * a * 1.5, offsetY: fs * 0.08 * a * 1.5 }));
      break;
    case 'neon':
      eff.color = color || fill;
      o.set('shadow', new fabric.Shadow({ color: eff.color, blur: fs * (0.2 + 0.6 * a), offsetX: 0, offsetY: 0 }));
      break;
    case 'highlight':
      eff.color = color || '#ffde59';
      o.set('textBackgroundColor', eff.color);
      break;
    case 'glitch':
      eff.color = color || '#0cc0df';
      o.set('shadow', new fabric.Shadow({ color: eff.color, blur: 0, offsetX: -fs * 0.05 * a * 1.6, offsetY: 0 }));
      o.set({ stroke: '#ff3fa4', strokeWidth: Math.max(1, fs * 0.012), paintFirst: 'stroke' });
      break;
  }
  o.effect = type === 'none' ? null : eff;
  o.dirty = true;
  EZ.cv.requestRenderAll();
};

/* ═════ Icons, stickers, logos via Iconify ═════ */
EZ.fetchIconSvg = async id => {
  await EZ.loadIcons([id]);
  const svg = EZ.iconSvg(id);
  if (!svg) throw new Error('icon not found: ' + id);
  return svg;
};
const svgToObject = svg => new Promise(res => fabric.loadSVGFromString(svg, (objs, opts) => res(objs?.length ? fabric.util.groupSVGElements(objs, opts) : null)));
EZ.addIcon = async (id, { mono = true, color, at } = {}) => {
  try {
    let svg = await EZ.fetchIconSvg(id);
    if (mono) svg = svg.replace(/currentColor/g, color || '#1b1a24');
    const o = await svgToObject(svg);
    if (!o) throw new Error('empty svg');
    o.set({ ezType: mono ? 'icon' : 'sticker', ezData: { icon: id, mono } });
    const target = 200 * EZ.k();
    o.scale(target / Math.max(o.width, o.height));
    EZ.add(o, { at, fit: 0.6 });
    return o;
  } catch (e) { console.warn(e); EZ.toast('Could not load that graphic', { err: true }); }
};
EZ.iconColor = o => {
  const parts = o.type === 'group' ? o.getObjects() : [o];
  for (const p of parts) { if (typeof p.fill === 'string' && p.fill) return p.fill; if (p.stroke) return p.stroke; }
  return '#1b1a24';
};
EZ.setIconColor = (o, c) => {
  const parts = o.type === 'group' ? o.getObjects() : [o];
  for (const p of parts) {
    if (typeof p.fill === 'string' && p.fill && p.fill !== 'none') p.set('fill', c);
    if (p.stroke && p.stroke !== 'none') p.set('stroke', c);
  }
  o.dirty = true;
  EZ.cv.requestRenderAll();
};

/* ═════ Rebuildable elements: QR codes + charts ═════ */
// Replace `old` with a freshly built object of the same visual size, position and stacking.
EZ.swapSpecial = (old, fresh) => {
  const cv = EZ.cv;
  const idx = cv.getObjects().indexOf(old);
  const targetW = old.getScaledWidth();
  fresh.scale(targetW / fresh.width);
  fresh.set({ angle: old.angle, opacity: old.opacity, flipX: old.flipX, flipY: old.flipY, shadow: old.shadow, id: old.id, locked: old.locked });
  fresh.setPositionByOrigin(old.getCenterPoint(), 'center', 'center');
  cv.remove(old);
  cv.insertAt(fresh, idx);
  cv.setActiveObject(fresh);
  fresh.setCoords();
  cv.requestRenderAll();
  EZ.commit();
  return fresh;
};

EZ.makeQR = (d) => {
  const data = { text: 'https://dump.yanikroesti.ch', fg: '#1b1a24', bg: '#ffffff', style: 'square', ecc: 'M', ...d };
  const qr = qrcode(0, data.ecc);
  qr.addData(unescape(encodeURIComponent(data.text || ' ')));
  qr.make();
  const n = qr.getModuleCount(), m = 2, S = 400, c = S / (n + m * 2);
  const inFinder = (r, col) => (r < 7 && col < 7) || (r < 7 && col >= n - 7) || (r >= n - 7 && col < 7);
  let path = '';
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) {
    if (!qr.isDark(r, col)) continue;
    const x = (col + m) * c, y = (r + m) * c;
    if (data.style === 'dots' && !inFinder(r, col)) {
      const rr = c * 0.46, cx = x + c / 2, cy = y + c / 2;
      path += `M${cx - rr} ${cy} a${rr} ${rr} 0 1 0 ${rr * 2} 0 a${rr} ${rr} 0 1 0 ${-rr * 2} 0 `;
    } else path += `M${x} ${y} h${c + 0.3} v${c + 0.3} h${-(c + 0.3)} Z `;
  }
  const bg = new fabric.Rect({ width: S, height: S, fill: data.bg || 'rgba(0,0,0,0)', left: 0, top: 0, rx: data.style === 'dots' ? c : 0, ry: data.style === 'dots' ? c : 0 });
  const p = new fabric.Path(path, { fill: data.fg, left: m * c, top: m * c });
  const g = new fabric.Group([bg, p], { ezType: 'qr', ezData: data, objectCaching: true });
  return g;
};
EZ.addQR = (d, at) => { const g = EZ.makeQR(d); g.scale(320 * EZ.k() / g.width); EZ.add(g, { at, fit: 0.6 }); return g; };

EZ.CHART_COLORS = ['#ff5c35', '#8c52ff', '#0cc0df', '#ffbd59', '#00bf63', '#ff66c4', '#5271ff', '#545454'];
EZ.makeChart = (d) => {
  const data = {
    type: 'column', title: '', font: 'Inter', text: '#1b1a24', colors: EZ.CHART_COLORS.slice(), mono: false, values: true,
    rows: [['Mon', 12], ['Tue', 19], ['Wed', 8], ['Thu', 15], ['Fri', 22]], ...d,
  };
  const rows = data.rows.filter(r => r[0] !== '' || r[1] !== '').map(r => [String(r[0] ?? ''), Number(r[1]) || 0]);
  const W = 640, Hh = 420, objs = [];
  const col = i => data.mono ? data.colors[0] : data.colors[i % data.colors.length];
  const txt = (s, o) => new fabric.Text(String(s), { fontFamily: data.font, fill: data.text, fontSize: 18, ...o });
  const fmt = v => Math.abs(v) >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'k' : String(+v.toFixed(2));
  objs.push(new fabric.Rect({ left: 0, top: 0, width: W, height: Hh, fill: 'rgba(0,0,0,0)', strokeWidth: 0 }));
  let top = 10;
  if (data.title) { objs.push(txt(data.title, { left: W / 2, top: 6, originX: 'center', fontSize: 26, fontWeight: 700 })); top = 50; }
  const max = Math.max(1, ...rows.map(r => r[1]));
  const nice = (() => { const p = 10 ** Math.floor(Math.log10(max)); const f = max / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; })();
  if (data.type === 'pie' || data.type === 'donut') {
    const total = rows.reduce((s, r) => s + Math.max(0, r[1]), 0) || 1;
    const cx = 200, cy = top + (Hh - top) / 2, R = Math.min(180, (Hh - top) / 2 - 10), ri = data.type === 'donut' ? R * 0.58 : 0;
    let a0 = -Math.PI / 2;
    rows.forEach((r, i) => {
      const v = Math.max(0, r[1]); if (!v) return;
      let a1 = a0 + v / total * Math.PI * 2;
      if (a1 - a0 >= Math.PI * 2 - 1e-6) a1 = a0 + Math.PI * 2 - 1e-4;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (rad, a) => `${cx + rad * Math.cos(a)} ${cy + rad * Math.sin(a)}`;
      const d = ri
        ? `M${p(R, a0)} A${R} ${R} 0 ${large} 1 ${p(R, a1)} L${p(ri, a1)} A${ri} ${ri} 0 ${large} 0 ${p(ri, a0)} Z`
        : `M${cx} ${cy} L${p(R, a0)} A${R} ${R} 0 ${large} 1 ${p(R, a1)} Z`;
      objs.push(new fabric.Path(d, { fill: col(i), stroke: '#ffffff', strokeWidth: 2 }));
      a0 = a1;
    });
    rows.forEach((r, i) => {
      const y = top + 20 + i * 34;
      if (y > Hh - 20) return;
      objs.push(new fabric.Rect({ left: 420, top: y, width: 18, height: 18, rx: 4, ry: 4, fill: col(i) }));
      objs.push(txt(`${r[0]}${data.values ? '  ' + Math.round(Math.max(0, r[1]) / total * 100) + '%' : ''}`, { left: 448, top: y - 1, fontSize: 18 }));
    });
  } else if (data.type === 'bar') {
    const x0 = 130, x1 = W - 50, y0 = top + 6, bh = (Hh - y0 - 10) / Math.max(1, rows.length);
    rows.forEach((r, i) => {
      const w = Math.max(0, r[1]) / nice * (x1 - x0), y = y0 + i * bh + bh * 0.18;
      objs.push(txt(r[0], { left: x0 - 12, top: y + bh * 0.32 - 10, originX: 'right', fontSize: 17 }));
      objs.push(new fabric.Rect({ left: x0, top: y, width: Math.max(1, w), height: bh * 0.64, rx: 5, ry: 5, fill: col(i) }));
      if (data.values) objs.push(txt(fmt(r[1]), { left: x0 + w + 8, top: y + bh * 0.32 - 10, fontSize: 16, fontWeight: 700 }));
    });
  } else {
    const x0 = 56, x1 = W - 16, y0 = top + 14, y1 = Hh - 40;
    for (let g = 0; g <= 4; g++) {
      const y = y1 - (y1 - y0) * g / 4;
      objs.push(new fabric.Line([x0, y, x1, y], { stroke: g ? 'rgba(0,0,0,.1)' : 'rgba(0,0,0,.35)', strokeWidth: 1 }));
      objs.push(txt(fmt(nice * g / 4), { left: x0 - 10, top: y - 9, originX: 'right', fontSize: 14, fill: data.text, opacity: 0.6 }));
    }
    const n = Math.max(1, rows.length), step = (x1 - x0) / n;
    const pts = rows.map((r, i) => ({ x: x0 + step * (i + 0.5), y: y1 - Math.max(0, r[1]) / nice * (y1 - y0) }));
    rows.forEach((r, i) => objs.push(txt(r[0], { left: pts[i].x, top: y1 + 10, originX: 'center', fontSize: 16 })));
    if (data.type === 'line') {
      if (pts.length > 1) objs.push(new fabric.Polyline(pts, { fill: '', stroke: col(0), strokeWidth: 4, strokeLineJoin: 'round', strokeLineCap: 'round' }));
      pts.forEach((p, i) => {
        objs.push(new fabric.Circle({ left: p.x, top: p.y, radius: 7, originX: 'center', originY: 'center', fill: '#fff', stroke: col(0), strokeWidth: 4 }));
        if (data.values) objs.push(txt(fmt(rows[i][1]), { left: p.x, top: p.y - 32, originX: 'center', fontSize: 15, fontWeight: 700 }));
      });
    } else {
      const bw = step * 0.62;
      rows.forEach((r, i) => {
        const hgt = Math.max(1, Math.max(0, r[1]) / nice * (y1 - y0));
        objs.push(new fabric.Rect({ left: pts[i].x - bw / 2, top: y1 - hgt, width: bw, height: hgt, fill: col(i), rx: 5, ry: 5 }));
        if (data.values) objs.push(txt(fmt(r[1]), { left: pts[i].x, top: y1 - hgt - 24, originX: 'center', fontSize: 15, fontWeight: 700 }));
      });
    }
  }
  const g = new fabric.Group(objs, { ezType: 'chart', ezData: data });
  return g;
};
EZ.addChart = async (d, at) => {
  await EZ.loadFont(d?.font || 'Inter', 700);
  const g = EZ.makeChart(d);
  g.scale(560 * EZ.k() / g.width);
  EZ.add(g, { at, fit: 0.8 });
  return g;
};

/* ═════ Photo filters ═════ */
const F = fabric.Image.filters;
EZ.PHOTO_PRESETS = [
  { id: 'none', label: 'Original', make: () => [] },
  { id: 'bw', label: 'B&W', make: () => [new F.Grayscale()] },
  { id: 'noir', label: 'Noir', make: () => [new F.Grayscale(), new F.Contrast({ contrast: 0.3 })] },
  { id: 'sepia', label: 'Sepia', make: () => [new F.Sepia()] },
  { id: 'vintage', label: 'Vintage', make: () => [new F.Vintage()] },
  { id: 'polaroid', label: 'Polaroid', make: () => [new F.Polaroid()] },
  { id: 'kodachrome', label: 'Kodak', make: () => [new F.Kodachrome()] },
  { id: 'technicolor', label: 'Techni', make: () => [new F.Technicolor()] },
  { id: 'vivid', label: 'Vivid', make: () => [new F.Saturation({ saturation: 0.35 }), new F.Contrast({ contrast: 0.1 })] },
  { id: 'warm', label: 'Warm', make: () => [new F.ColorMatrix({ matrix: [1.08, 0, 0, 0, 0.03, 0, 1.0, 0, 0, 0.01, 0, 0, 0.88, 0, 0, 0, 0, 0, 1, 0] })] },
  { id: 'cool', label: 'Cool', make: () => [new F.ColorMatrix({ matrix: [0.9, 0, 0, 0, 0, 0, 1.0, 0, 0, 0.01, 0, 0, 1.1, 0, 0.04, 0, 0, 0, 1, 0] })] },
  { id: 'fade', label: 'Fade', make: () => [new F.Contrast({ contrast: -0.2 }), new F.Brightness({ brightness: 0.06 }), new F.Saturation({ saturation: -0.25 })] },
];
EZ.ADJUST = [
  { id: 'brightness', label: 'Brightness', min: -100, max: 100, make: v => new F.Brightness({ brightness: v / 250 }) },
  { id: 'contrast', label: 'Contrast', min: -100, max: 100, make: v => new F.Contrast({ contrast: v / 180 }) },
  { id: 'saturation', label: 'Saturation', min: -100, max: 100, make: v => new F.Saturation({ saturation: v / 100 }) },
  { id: 'vibrance', label: 'Vibrance', min: -100, max: 100, make: v => new F.Vibrance({ vibrance: v / 100 }) },
  { id: 'hue', label: 'Hue', min: -100, max: 100, make: v => new F.HueRotation({ rotation: v / 100 }) },
  { id: 'blur', label: 'Blur', min: 0, max: 100, make: v => new F.Blur({ blur: v / 300 }) },
  { id: 'pixelate', label: 'Pixelate', min: 0, max: 100, make: v => new F.Pixelate({ blocksize: 1 + Math.round(v / 4) }) },
];
EZ.photoSettings = o => ({ preset: 'none', adj: {}, ...(o.ezData?.photo || {}) });
EZ.setPhoto = (o, patch) => {
  const s = EZ.photoSettings(o);
  const next = { ...s, ...patch, adj: { ...s.adj, ...(patch.adj || {}) } };
  o.ezData = { ...(o.ezData || {}), photo: next };
  const list = [...(EZ.PHOTO_PRESETS.find(p => p.id === next.preset)?.make() || [])];
  for (const a of EZ.ADJUST) { const v = next.adj[a.id]; if (v) list.push(a.make(v)); }
  o.filters = list;
  o.applyFilters();
  EZ.cv.requestRenderAll();
};

/* ═════ Crop ═════ */
EZ.cropImage = o => {
  if (!o || o.type !== 'image') return;
  const el = EZ.origEl(o);
  const NW = el.naturalWidth || el.width, NH = el.naturalHeight || el.height;
  let src;
  try { src = el.src || el.toDataURL(); } catch { src = el.src; }
  let box = { x: o.cropX || 0, y: o.cropY || 0, w: o.width, h: o.height };
  let ratio = null;
  EZ.modal((m, close) => {
    m.style.width = 'min(760px, 100%)';
    const wrap = h('div', { class: 'crop-wrap' });
    const base = h('img', { src, crossOrigin: o.crossOrigin || undefined, draggable: false });
    const cb = h('div', { class: 'crop-box' });
    const inner = h('img', { src, crossOrigin: o.crossOrigin || undefined, draggable: false });
    cb.append(inner);
    const handles = ['nw', 'ne', 'sw', 'se'].map(k => { const hd = h('div', { class: 'crop-h', 'data-k': k }); return hd; });
    wrap.append(base, cb, ...handles);
    let s = 1; // display px per natural px
    const layout = () => {
      s = base.clientWidth / NW;
      Object.assign(cb.style, { left: box.x * s + 'px', top: box.y * s + 'px', width: box.w * s + 'px', height: box.h * s + 'px' });
      Object.assign(inner.style, { left: -box.x * s + 'px', top: -box.y * s + 'px', width: NW * s + 'px', height: NH * s + 'px' });
      const pos = { nw: [box.x, box.y], ne: [box.x + box.w, box.y], sw: [box.x, box.y + box.h], se: [box.x + box.w, box.y + box.h] };
      handles.forEach(hd => { const [x, y] = pos[hd.dataset.k]; hd.style.left = (x * s - 7) + 'px'; hd.style.top = (y * s - 7) + 'px'; });
    };
    base.onload = layout;
    const fitRatio = r => {
      ratio = r;
      if (!r) return layout();
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      let w = box.w, hh = w / r;
      if (hh > NH) { hh = NH; w = hh * r; }
      if (w > NW) { w = NW; hh = w / r; }
      box = { x: EZ.clamp(cx - w / 2, 0, NW - w), y: EZ.clamp(cy - hh / 2, 0, NH - hh), w, h: hh };
      layout();
    };
    let drag = null;
    wrap.addEventListener('pointerdown', e => {
      const k = e.target.dataset?.k || (cb.contains(e.target) || e.target === cb ? 'move' : null);
      if (!k) return;
      e.preventDefault(); wrap.setPointerCapture(e.pointerId);
      drag = { k, x: e.clientX, y: e.clientY, b: { ...box } };
    });
    wrap.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = (e.clientX - drag.x) / s, dy = (e.clientY - drag.y) / s, b = drag.b, min = 20;
      if (drag.k === 'move') { box.x = EZ.clamp(b.x + dx, 0, NW - b.w); box.y = EZ.clamp(b.y + dy, 0, NH - b.h); }
      else {
        let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
        if (drag.k.includes('w')) x0 = EZ.clamp(x0 + dx, 0, x1 - min);
        if (drag.k.includes('e')) x1 = EZ.clamp(x1 + dx, x0 + min, NW);
        if (drag.k.includes('n')) y0 = EZ.clamp(y0 + dy, 0, y1 - min);
        if (drag.k.includes('s')) y1 = EZ.clamp(y1 + dy, y0 + min, NH);
        if (ratio) {
          const w = x1 - x0; let hh = w / ratio;
          if (drag.k.includes('n')) { y0 = y1 - hh; if (y0 < 0) { y0 = 0; hh = y1; x1 = drag.k.includes('w') ? x1 : x0 + hh * ratio; x0 = drag.k.includes('w') ? x1 - hh * ratio : x0; } }
          else { y1 = y0 + hh; if (y1 > NH) { y1 = NH; hh = NH - y0; if (drag.k.includes('w')) x0 = x1 - hh * ratio; else x1 = x0 + hh * ratio; } }
        }
        box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      }
      layout();
    });
    wrap.addEventListener('pointerup', () => { drag = null; });
    const ratios = [['Free', null], ['Original', NW / NH], ['1:1', 1], ['4:5', 0.8], ['3:2', 1.5], ['16:9', 16 / 9], ['9:16', 9 / 16]];
    const seg = h('div', { class: 'seg', style: { marginTop: '12px' } });
    ratios.forEach(([l, r], i) => seg.append(h('button', { class: i ? '' : 'on', onclick: e => { EZ.$$('button', seg).forEach(b => b.classList.remove('on')); e.currentTarget.classList.add('on'); fitRatio(r); } }, l)));
    m.append(h('h3', {}, 'Crop'), h('p', {}, 'Drag the box or its corners.'), wrap, seg,
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => { box = { x: 0, y: 0, w: NW, h: NH }; layout(); } }, 'Reset'),
        h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'),
        h('button', { class: 'btn pri', onclick: () => close(true) }, 'Apply')));
    requestAnimationFrame(layout);
  }).then(ok => {
    if (!ok) return;
    const c = o.getCenterPoint();
    o.set({ cropX: Math.round(box.x), cropY: Math.round(box.y), width: Math.round(box.w), height: Math.round(box.h) });
    o.setPositionByOrigin(c, 'center', 'center');
    if (o.filters?.length) o.applyFilters();
    EZ.applyMask(o);
    o.setCoords(); o.dirty = true;
    EZ.cv.requestRenderAll(); EZ.commit(); EZ.renderProps?.();
  });
};

/* ═════ Background removal (RMBG-1.4, same model as the Background Remover tool) ═════ */
let bgMod = null;
EZ.removeImageBg = async o => {
  if (!o || o.type !== 'image') return;
  const busy = EZ.busy('Preparing background removal…', 'runs on your device, nothing is uploaded');
  try {
    bgMod = bgMod || await import(new URL('easel/bgremove.js', location.href).href);
    const el = EZ.origEl(o);
    const out = await bgMod.removeBackground(el, (t, s, pct) => busy.set(t, s, pct));
    busy.set('Saving result…', '');
    const blob = await new Promise(r => out.toBlob(r, 'image/png'));
    const { url } = await EZ.addAsset(blob, { w: out.width, h: out.height, upload: false, name: 'cutout' });
    await new Promise(res => fabric.util.loadImage(url, img => {
      const nw = img.naturalWidth, onw = el.naturalWidth || el.width;
      const k = nw / onw; // same size unless the source was capped
      o.setElement(img, { width: o.width * k, height: o.height * k, cropX: (o.cropX || 0) * k, cropY: (o.cropY || 0) * k });
      o.set({ scaleX: o.scaleX / k, scaleY: o.scaleY / k, crossOrigin: null });
      o.ezData = { ...(o.ezData || {}), cutout: true };
      if (o.filters?.length) o.applyFilters();
      EZ.applyMask(o);
      o.setCoords(); o.dirty = true;
      res();
    }));
    EZ.cv.requestRenderAll(); EZ.commit(); EZ.renderProps?.();
    busy.close();
    EZ.toast('Background removed', { icon: 'wand-sparkles' });
  } catch (e) {
    console.error(e);
    busy.close();
    EZ.toast('Background removal failed: ' + (e?.message || e), { err: true, ms: 5000 });
  }
};
})();
