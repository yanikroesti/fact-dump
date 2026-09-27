/* Easel — editor core: fabric canvas, pages, history, snapping, zoom/pan, clipboard, keyboard */
(() => {
const EZ = window.EZ;
const { $, h } = EZ;
const ACC = EZ.ACCENT;

// Extra properties that must survive toJSON / clone.
EZ.PROPS = ['id', 'name', 'ezType', 'ezData', 'ezMask', 'ezRadius', 'effect', 'locked',
  'selectable', 'evented', 'hasControls', 'lockMovementX', 'lockMovementY', 'lockScalingX',
  'lockScalingY', 'lockRotation', 'editable'];

// fabric 5.3: a Textbox loaded from JSON without `styles` ends up with styles = undefined and then
// crashes in toObject → stylesToArray. Treat missing styles as empty.
{
  const s2a = fabric.util.stylesToArray;
  fabric.util.stylesToArray = (styles, text) => s2a(styles || {}, text);
  const tInit = fabric.Text.prototype._set;
  fabric.Text.prototype._set = function (k, v) { return tInit.call(this, k, k === 'styles' && !v ? {} : v); };
}

/* ── fabric look & feel ── */
Object.assign(fabric.Object.prototype, {
  transparentCorners: false, cornerColor: '#ffffff', cornerStrokeColor: 'rgba(0,0,0,.28)',
  borderColor: ACC, cornerStyle: 'circle', cornerSize: 11, touchCornerSize: 28,
  borderScaleFactor: 1.6, padding: 0, borderOpacityWhenMoving: .6,
});
fabric.textureSize = 4096;
fabric.Textbox.prototype.cursorColor = ACC;
fabric.Textbox.prototype.selectionColor = 'rgba(255,92,53,.22)';
fabric.Textbox.prototype.editingBorderColor = ACC;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
const pill = horizontal => function (ctx, left, top, _s, obj) {
  const w = horizontal ? 20 : 7, hh = horizontal ? 7 : 20;
  ctx.save(); ctx.translate(left, top); ctx.rotate(fabric.util.degreesToRadians(obj.angle));
  roundRect(ctx, -w / 2, -hh / 2, w, hh, 3.5);
  ctx.shadowColor = 'rgba(0,0,0,.28)'; ctx.shadowBlur = 3; ctx.fillStyle = '#fff'; ctx.fill();
  ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
};
function renderRotate(ctx, left, top) {
  ctx.save(); ctx.translate(left, top);
  ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2);
  ctx.shadowColor = 'rgba(0,0,0,.28)'; ctx.shadowBlur = 4; ctx.fillStyle = '#fff'; ctx.fill(); ctx.shadowBlur = 0;
  ctx.strokeStyle = '#1b1a24'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(0, 0, 5, -Math.PI * .1, Math.PI * 1.45); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(4.2, -5.6); ctx.lineTo(5.4, -1.6); ctx.lineTo(1.4, -2.2); ctx.stroke();
  ctx.restore();
}
for (const ctrls of [fabric.Object.prototype.controls, fabric.Textbox.prototype.controls]) {
  if (!ctrls) continue;
  if (ctrls.ml) ctrls.ml.render = pill(false);
  if (ctrls.mr) ctrls.mr.render = pill(false);
  if (ctrls.mt) ctrls.mt.render = pill(true);
  if (ctrls.mb) ctrls.mb.render = pill(true);
  if (ctrls.mtr) Object.assign(ctrls.mtr, { y: 0.5, offsetY: 32, withConnection: false, render: renderRotate, cursorStyle: 'grab', sizeX: 24, sizeY: 24 });
}

/* ── state ── */
let cv = null;
EZ.doc = null;
EZ.pageIndex = 0;
const view = EZ.view = { z: 1, x: 0, y: 0, fit: true };
let loading = false, restoring = false;
let guides = [], hover = null;
let spaceDown = false, panning = null;

EZ.W = () => EZ.doc?.w || 1080;
EZ.H = () => EZ.doc?.h || 1080;
EZ.k = () => Math.sqrt(EZ.W() * EZ.H()) / 1080; // text/element scale for this page size
// the unfiltered source element of a fabric.Image (fabric 5 has no getOriginalElement())
EZ.origEl = o => o._originalElement || o.getElement();
const isBg = o => !!o && (o.name === '__bg' || o.name === '__bgimg');
EZ.isBg = isBg;
EZ.userObjects = () => (cv ? cv.getObjects().filter(o => !isBg(o)) : []);
EZ.active = () => cv?.getActiveObject() || null;
EZ.bgRect = () => cv?.getObjects().find(o => o.name === '__bg');
EZ.bgImage = () => cv?.getObjects().find(o => o.name === '__bgimg');

/* ── init ── */
EZ.initEditor = () => {
  cv = EZ.cv = new fabric.Canvas('c', {
    preserveObjectStacking: true, controlsAboveOverlay: true, stopContextMenu: true, fireRightClick: true,
    fireMiddleClick: true, targetFindTolerance: 6, selectionColor: 'rgba(255,92,53,.07)',
    selectionBorderColor: ACC, selectionLineWidth: 1, uniformScaling: true, snapAngle: 45, snapThreshold: 4,
    enableRetinaScaling: true, imageSmoothingEnabled: true,
  });
  const stage = $('#stage');
  new ResizeObserver(() => {
    cv.setDimensions({ width: stage.clientWidth, height: stage.clientHeight });
    if (view.fit) EZ.fit(); else applyView();
  }).observe(stage);

  cv.on('object:added', e => { decorate(e.target); if (!loading && !restoring) EZ.commit(); });
  cv.on('object:removed', () => { if (!loading && !restoring) EZ.commit(); });
  cv.on('object:modified', e => { normalize(e.target); EZ.commit(); EZ.renderProps?.(); });
  cv.on('text:changed', () => EZ.commit());
  cv.on('text:editing:exited', e => {
    const t = e.target;
    if (t && !t.text.trim()) { cv.remove(t); cv.requestRenderAll(); }
  });
  cv.on('selection:created', onSel);
  cv.on('selection:updated', onSel);
  cv.on('selection:cleared', onSel);
  cv.on('object:moving', snap);
  cv.on('object:scaling', e => { liveScale(e.target); showMeasure(e); });
  cv.on('object:resizing', showMeasure);
  cv.on('object:rotating', showMeasure);
  cv.on('mouse:up', () => { if (guides.length) { guides = []; cv.requestRenderAll(); } hideMeasure(); panning = null; });
  cv.on('mouse:over', e => { if (e.target && !isBg(e.target) && !cv.isDrawingMode) { hover = e.target; cv.requestRenderAll(); } });
  cv.on('mouse:out', () => { if (hover) { hover = null; cv.requestRenderAll(); } });
  cv.on('mouse:dblclick', e => {
    const t = e.target;
    if (t?.type === 'image' && !isBg(t)) {
      if (t.ezType === 'frame' && !t.ezData?.filled) EZ.openPanel?.('photos');
      else EZ.cropImage(t);
    }
  });
  cv.on('path:created', e => {
    e.path.set({ ezType: 'draw', id: EZ.uid(), strokeLineCap: 'round', strokeLineJoin: 'round' });
    EZ.commit();
  });
  cv.on('mouse:down', e => {
    if (e.e.button === 2 || e.button === 3) { // right click
      const t = e.target;
      if (t && !isBg(t)) {
        const a = cv.getActiveObject();
        if (!(a && (a === t || (a.type === 'activeSelection' && a.contains(t))))) cv.setActiveObject(t);
      } else cv.discardActiveObject();
      cv.requestRenderAll();
      EZ.contextMenu?.(e.e);
      return;
    }
    if (spaceDown || e.e.button === 1) { panning = { x: e.e.clientX, y: e.e.clientY }; cv.setCursor('grabbing'); }
  });
  cv.on('mouse:move', e => {
    if (!panning) return;
    view.x += e.e.clientX - panning.x; view.y += e.e.clientY - panning.y;
    panning = { x: e.e.clientX, y: e.e.clientY };
    view.fit = false; applyView();
  });
  cv.on('mouse:wheel', opt => {
    const e = opt.e; e.preventDefault(); e.stopPropagation();
    if (e.ctrlKey || e.metaKey) {
      const r = cv.upperCanvasEl.getBoundingClientRect();
      EZ.zoomAt(view.z * Math.pow(0.9985, e.deltaY * (e.deltaMode ? 30 : 1)), e.clientX - r.left, e.clientY - r.top);
    } else {
      const k = e.deltaMode ? 30 : 1;
      view.x -= (e.shiftKey ? e.deltaY : e.deltaX) * k;
      view.y -= (e.shiftKey ? 0 : e.deltaY) * k;
      view.fit = false; applyView();
    }
  });
  cv.on('after:render', drawOverlay);

  setupDrop(stage);
  setupKeys();
};

function onSel() {
  if (hover && cv.getActiveObject() === hover) hover = null;
  EZ.renderProps?.();
  EZ.refreshPanel?.('layers');
}

/* ── per-object setup ── */
function decorate(o) {
  if (!o) return;
  if (isBg(o)) {
    o.set({ selectable: false, evented: false, hasControls: false, hoverCursor: 'default', lockMovementX: true, lockMovementY: true });
    return;
  }
  if (!o.id) o.id = EZ.uid();
  if (o.type === 'textbox') o.setControlsVisibility({ mt: false, mb: false });
  if (o.type === 'image' || ['icon', 'qr', 'chart', 'group', 'sticker'].includes(o.ezType) || o.type === 'group')
    o.setControlsVisibility({ mt: false, mb: false, ml: false, mr: false });
  if (o.ezType === 'line') o.setControlsVisibility({ mt: false, mb: false, tl: false, tr: false, bl: false, br: false });
  applyLock(o);
}
EZ.decorate = decorate;
function applyLock(o) {
  const v = !!o.locked;
  o.set({ lockMovementX: v, lockMovementY: v, lockScalingX: v, lockScalingY: v, lockRotation: v, hasControls: !v });
  if (o.type === 'textbox') o.editable = !v;
}
EZ.setLocked = (o, v) => { o.locked = v; applyLock(o); cv.requestRenderAll(); EZ.commit(); EZ.renderProps?.(); };

// Bake corner-scaling of text into font size (like Canva) and keep image corner radii round.
function normalize(o) {
  if (!o) return;
  if (o.type === 'textbox' && (Math.abs(o.scaleX - 1) > 1e-3 || Math.abs(o.scaleY - 1) > 1e-3)) {
    const s = o.scaleX;
    o.set({
      fontSize: EZ.round(o.fontSize * s, 1), width: o.width * s, scaleX: 1, scaleY: 1,
      strokeWidth: (o.strokeWidth || 0) * s,
    });
    if (o.shadow) o.shadow = new fabric.Shadow({ ...o.shadow.toObject(), blur: o.shadow.blur * s, offsetX: o.shadow.offsetX * s, offsetY: o.shadow.offsetY * s });
    o.initDimensions(); o.setCoords();
  }
  liveScale(o);
}
function liveScale(o) {
  if (o?.clipPath && o.clipPath.type === 'rect' && o.type === 'image') {
    const r = o.ezRadius || 0;
    o.clipPath.set({ rx: r / o.scaleX, ry: r / o.scaleY });
    o.dirty = true;
  }
}

/* ── background ── */
EZ.ensureBg = () => {
  const W = EZ.W(), H = EZ.H();
  let r = EZ.bgRect();
  if (!r) {
    r = new fabric.Rect({ name: '__bg', fill: '#ffffff' });
    const was = loading; loading = true; cv.insertAt(r, 0); loading = was;
  }
  r.set({ left: 0, top: 0, width: W, height: H, scaleX: 1, scaleY: 1, angle: 0, strokeWidth: 0, originX: 'left', originY: 'top' });
  decorate(r);
  cv.moveTo(r, 0);
  const bi = EZ.bgImage();
  if (bi) {
    const s = Math.max(W / bi.width, H / bi.height);
    bi.set({ originX: 'center', originY: 'center', left: W / 2, top: H / 2, scaleX: s, scaleY: s, angle: 0 });
    decorate(bi);
    cv.moveTo(bi, 1);
  }
  r.setCoords();
};
EZ.makeFill = (spec) => {
  if (!spec || typeof spec === 'string') return spec;
  const [a, b] = spec.gradient;
  return new fabric.Gradient(spec.type === 'radial'
    ? { type: 'radial', gradientUnits: 'percentage', coords: { x1: .5, y1: .5, r1: 0, x2: .5, y2: .5, r2: .75 }, colorStops: [{ offset: 0, color: a }, { offset: 1, color: b }] }
    : { type: 'linear', gradientUnits: 'percentage', coords: { x1: 0, y1: 0, x2: 1, y2: 1 }, colorStops: [{ offset: 0, color: a }, { offset: 1, color: b }] });
};
EZ.setBackground = spec => {
  EZ.ensureBg();
  EZ.bgRect().set('fill', EZ.makeFill(spec) ?? '#ffffff');
  if (typeof spec === 'string') EZ.pushRecent(spec);
  cv.requestRenderAll(); EZ.commit(); EZ.renderProps?.();
};
EZ.setBackgroundImage = (src, crossOrigin) => new Promise(res => {
  fabric.Image.fromURL(src, img => {
    if (!img || !img.width) { EZ.toast('Could not load that image', { err: true }); return res(null); }
    const old = EZ.bgImage();
    if (old) cv.remove(old);
    img.set({ name: '__bgimg', crossOrigin: crossOrigin || null });
    cv.insertAt(img, 1);
    EZ.ensureBg(); cv.requestRenderAll(); EZ.commit(); EZ.refreshPanel?.('background');
    res(img);
  }, { crossOrigin });
});
EZ.removeBackgroundImage = () => { const b = EZ.bgImage(); if (b) { cv.remove(b); cv.requestRenderAll(); EZ.refreshPanel?.('background'); } };

/* ── view ── */
function applyView() {
  if (!cv) return;
  const sw = cv.getWidth(), sh = cv.getHeight(), W = EZ.W() * view.z, H = EZ.H() * view.z;
  // keep at least a corner of the page reachable
  view.x = EZ.clamp(view.x, Math.min(40, sw - W - 40) - W + 120, Math.max(sw - 120, 40));
  view.y = EZ.clamp(view.y, Math.min(40, sh - H - 40) - H + 120, Math.max(sh - 120, 40));
  cv.setViewportTransform([view.z, 0, 0, view.z, view.x, view.y]);
  const sh2 = $('#pageShadow');
  Object.assign(sh2.style, { left: view.x + 'px', top: view.y + 'px', width: W + 'px', height: H + 'px' });
  EZ.onZoom?.(view.z);
}
EZ.applyView = applyView;
EZ.fit = () => {
  if (!cv) return;
  const sw = cv.getWidth(), sh = cv.getHeight(), pad = sw < 600 ? 20 : 56;
  view.z = Math.max(0.02, Math.min((sw - pad * 2) / EZ.W(), (sh - pad * 2) / EZ.H()));
  view.x = (sw - EZ.W() * view.z) / 2;
  view.y = (sh - EZ.H() * view.z) / 2;
  view.fit = true;
  applyView();
};
EZ.zoomAt = (z, px, py) => {
  z = EZ.clamp(z, 0.02, 10);
  const k = z / view.z;
  view.x = px - (px - view.x) * k;
  view.y = py - (py - view.y) * k;
  view.z = z; view.fit = false;
  applyView();
};
EZ.zoomBy = f => EZ.zoomAt(view.z * f, cv.getWidth() / 2, cv.getHeight() / 2);
EZ.zoomTo = z => EZ.zoomAt(z, cv.getWidth() / 2, cv.getHeight() / 2);
// page-space point at the middle of what is visible (clamped to the page)
EZ.viewCenter = () => ({
  x: EZ.clamp((cv.getWidth() / 2 - view.x) / view.z, 0, EZ.W()),
  y: EZ.clamp((cv.getHeight() / 2 - view.y) / view.z, 0, EZ.H()),
});
EZ.clientToPage = (cx, cy) => {
  const r = cv.upperCanvasEl.getBoundingClientRect();
  return { x: (cx - r.left - view.x) / view.z, y: (cy - r.top - view.y) / view.z };
};

/* ── overlays: hover outline + smart guides ── */
function drawOverlay({ ctx }) {
  const a = cv.getActiveObject();
  const showHover = hover && hover.canvas === cv && hover !== a && !(a?.type === 'activeSelection' && a.contains(hover)) && !hover.isEditing;
  if (!showHover && !guides.length) return;
  ctx.save();
  const v = cv.viewportTransform;
  ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
  const lw = 1 / view.z;
  if (showHover) {
    const c = hover.aCoords;
    if (c) {
      ctx.strokeStyle = ACC; ctx.lineWidth = 2 * lw;
      ctx.beginPath(); ctx.moveTo(c.tl.x, c.tl.y); ctx.lineTo(c.tr.x, c.tr.y); ctx.lineTo(c.br.x, c.br.y); ctx.lineTo(c.bl.x, c.bl.y); ctx.closePath(); ctx.stroke();
    }
  }
  for (const g of guides) {
    ctx.strokeStyle = g.page ? '#ff2fa0' : ACC; ctx.lineWidth = 1.2 * lw;
    ctx.setLineDash(g.page ? [] : [5 * lw, 4 * lw]);
    ctx.beginPath(); ctx.moveTo(g.x1, g.y1); ctx.lineTo(g.x2, g.y2); ctx.stroke();
  }
  ctx.restore();
}
function snap(e) {
  const t = e.target;
  guides = [];
  if (!t || e.e?.altKey) return;
  const th = 7 / view.z, W = EZ.W(), H = EZ.H();
  let b = t.getBoundingRect(true, true);
  const others = EZ.userObjects().filter(o => o !== t && o.visible && !(t.type === 'activeSelection' && t.contains(o)));
  const xs = [{ v: 0, page: 1 }, { v: W / 2, page: 1 }, { v: W, page: 1 }];
  const ys = [{ v: 0, page: 1 }, { v: H / 2, page: 1 }, { v: H, page: 1 }];
  for (const o of others) {
    const r = o.getBoundingRect(true, true);
    xs.push({ v: r.left, r }, { v: r.left + r.width / 2, r }, { v: r.left + r.width, r });
    ys.push({ v: r.top, r }, { v: r.top + r.height / 2, r }, { v: r.top + r.height, r });
  }
  const best = (cands, own) => {
    let bst = null;
    for (const c of cands) for (const p of own) {
      const d = c.v - p;
      if (Math.abs(d) < th && (!bst || Math.abs(d) < Math.abs(bst.d) - 1e-6)) bst = { d, c };
    }
    return bst;
  };
  const bx = best(xs, [b.left, b.left + b.width / 2, b.left + b.width]);
  const by = best(ys, [b.top, b.top + b.height / 2, b.top + b.height]);
  if (bx) t.left += bx.d;
  if (by) t.top += by.d;
  if (bx || by) { t.setCoords(); b = t.getBoundingRect(true, true); }
  if (bx) {
    const r = bx.c.r;
    guides.push(bx.c.page ? { x1: bx.c.v, y1: 0, x2: bx.c.v, y2: H, page: 1 }
      : { x1: bx.c.v, y1: Math.min(r.top, b.top), x2: bx.c.v, y2: Math.max(r.top + r.height, b.top + b.height) });
  }
  if (by) {
    const r = by.c.r;
    guides.push(by.c.page ? { x1: 0, y1: by.c.v, x2: W, y2: by.c.v, page: 1 }
      : { x1: Math.min(r.left, b.left), y1: by.c.v, x2: Math.max(r.left + r.width, b.left + b.width), y2: by.c.v });
  }
}

/* ── measure tooltip ── */
function showMeasure(e) {
  const t = e.target, m = $('#measure');
  if (!t || !e.e) return;
  const r = $('#stage').getBoundingClientRect();
  const txt = e.transform?.action === 'rotate' || e.e.type === 'rotating'
    ? Math.round(((t.angle % 360) + 360) % 360) + '°'
    : `w ${Math.round(t.getScaledWidth())}  h ${Math.round(t.getScaledHeight())}`;
  m.textContent = (cv._currentTransform?.action === 'rotate') ? Math.round(((t.angle % 360) + 360) % 360) + '°' : txt;
  m.style.display = 'block';
  const p = e.e.touches?.[0] || e.e;
  m.style.left = (p.clientX - r.left + 16) + 'px';
  m.style.top = (p.clientY - r.top + 18) + 'px';
}
function hideMeasure() { $('#measure').style.display = 'none'; }

/* ── adding things ── */
// Adds an object, shrinking it to at most `fit` of the page and centring it on `at` (page coords).
EZ.add = (o, { at, fit = 0.6, select = true, keepSize = false } = {}) => {
  const W = EZ.W(), H = EZ.H();
  if (!keepSize) {
    const sw = o.getScaledWidth(), sh = o.getScaledHeight();
    const k = Math.min(1, (W * fit) / sw, (H * fit) / sh);
    if (k < 1) o.scale((o.scaleX || 1) * k);
  }
  const c = at || EZ.viewCenter();
  o.setPositionByOrigin(new fabric.Point(c.x, c.y), 'center', 'center');
  o.setCoords();
  if (EZ.isDrawing()) EZ.setDraw(null);
  if (innerWidth <= 700) EZ.closePanel?.(); // the bottom sheet would cover the result on phones
  cv.add(o);
  if (select) cv.setActiveObject(o);
  cv.requestRenderAll();
  return o;
};
EZ.addImage = (src, { crossOrigin = null, at, fit = 0.6, ezData } = {}) => new Promise(res => {
  // Dropping onto an empty or filled frame fills it instead.
  if (at) {
    const frame = frameAt(at);
    if (frame) { EZ.fillFrame(frame, src, { crossOrigin, ezData }).then(() => res(frame)); return; }
  } else {
    const a = cv.getActiveObject();
    if (a?.ezType === 'frame') { EZ.fillFrame(a, src, { crossOrigin, ezData }).then(() => res(a)); return; }
  }
  fabric.Image.fromURL(src, (img, err) => {
    if (err || !img || !img.width) { EZ.toast('Could not load that image', { err: true }); return res(null); }
    img.set({ crossOrigin, ezData: ezData || null });
    EZ.add(img, { at, fit });
    res(img);
  }, { crossOrigin });
});
function frameAt(p) {
  const objs = EZ.userObjects().slice().reverse();
  return objs.find(o => o.ezType === 'frame' && o.visible && o.containsPoint(new fabric.Point(p.x, p.y), null, true)) || null;
}
EZ.frameAt = frameAt;

// Swap an image's source, cover-fitting the new picture into the object's current box.
EZ.replaceImage = (o, src, { crossOrigin = null, ezData } = {}) => new Promise(res => {
  const dw = o.getScaledWidth(), dh = o.getScaledHeight(), c = o.getCenterPoint();
  fabric.util.loadImage(src, img => {
    if (!img) { EZ.toast('Could not load that image', { err: true }); return res(false); }
    const nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height;
    const s = Math.max(dw / nw, dh / nh);
    const cw = dw / s, ch = dh / s;
    o.setElement(img, { width: cw, height: ch, cropX: (nw - cw) / 2, cropY: (nh - ch) / 2 });
    o.set({ scaleX: s, scaleY: s, crossOrigin });
    if (ezData !== undefined) o.ezData = { ...(o.ezData || {}), ...ezData };
    o.setPositionByOrigin(c, 'center', 'center');
    if (o.filters?.length) o.applyFilters();
    EZ.applyMask(o);
    o.setCoords(); o.dirty = true;
    cv.requestRenderAll(); EZ.commit(); EZ.renderProps?.();
    res(true);
  }, null, crossOrigin);
});
EZ.fillFrame = (frame, src, opts = {}) => EZ.replaceImage(frame, src, { ...opts, ezData: { ...(opts.ezData || {}), filled: true } })
  .then(ok => { if (ok) cv.setActiveObject(frame); return ok; });

/* ── image masks (frames, rounded corners) ── */
EZ.MASK_PATHS = {
  heart: 'M50 88 C20 66 4 50 4 30 C4 15 16 5 29 5 C38 5 45 10 50 18 C55 10 62 5 71 5 C84 5 96 15 96 30 C96 50 80 66 50 88 Z',
  star: 'M50 3 L62 36 L97 37 L69 58 L80 93 L50 72 L20 93 L31 58 L3 37 L38 36 Z',
  hexagon: 'M25 4 L75 4 L99 50 L75 96 L25 96 L1 50 Z',
  triangle: 'M50 4 L97 94 L3 94 Z',
  arch: 'M4 100 L4 46 C4 20 25 2 50 2 C75 2 96 20 96 46 L96 100 Z',
  blob: 'M71 8 C88 16 99 36 96 56 C93 77 76 95 54 97 C31 99 9 86 4 64 C-1 42 10 18 30 8 C43 1 58 2 71 8 Z',
  diamond: 'M50 2 L98 50 L50 98 L2 50 Z',
};
EZ.applyMask = (o, kind = o.ezMask || 'none', radius = o.ezRadius || 0) => {
  o.ezMask = kind; o.ezRadius = radius;
  const w = o.width, hh = o.height;
  if (kind === 'none' && !radius) o.clipPath = null;
  else if (kind === 'none' || kind === 'rounded') {
    o.clipPath = new fabric.Rect({ width: w, height: hh, rx: radius / o.scaleX, ry: radius / o.scaleY, originX: 'center', originY: 'center' });
  } else if (kind === 'circle') {
    o.clipPath = new fabric.Ellipse({ rx: w / 2, ry: hh / 2, originX: 'center', originY: 'center' });
  } else if (EZ.MASK_PATHS[kind]) {
    const p = new fabric.Path(EZ.MASK_PATHS[kind], { originX: 'center', originY: 'center', strokeWidth: 0 });
    p.set({ left: 0, top: 0, scaleX: w / p.width, scaleY: hh / p.height });
    o.clipPath = p;
  }
  o.dirty = true;
  cv?.requestRenderAll();
};

/* ── history (per page) ── */
const hist = new Map();
const H = () => {
  const id = EZ.doc.pages[EZ.pageIndex].id;
  if (!hist.has(id)) hist.set(id, { stack: [], idx: -1 });
  return hist.get(id);
};
EZ.pageJSON = () => cv.toJSON(EZ.PROPS);
const snapshot = () => JSON.stringify(EZ.pageJSON());
function seedHistory() {
  const hh = H();
  if (!hh.stack.length) { hh.stack = [snapshot()]; hh.idx = 0; }
  EZ.onHistory?.();
}
const hasPage = () => !!EZ.doc?.pages[EZ.pageIndex];
EZ.commit = EZ.debounce(() => {
  if (!hasPage() || loading || restoring) return;
  const hh = H(), s = snapshot();
  if (hh.stack[hh.idx] === s) return;
  hh.stack = hh.stack.slice(0, hh.idx + 1);
  hh.stack.push(s);
  if (hh.stack.length > 80) hh.stack.shift();
  hh.idx = hh.stack.length - 1;
  EZ.changed();
}, 220);
EZ.canUndo = () => hasPage() && H().idx > 0;
EZ.canRedo = () => hasPage() && H().idx < H().stack.length - 1;
async function restore(s) {
  restoring = true;
  cv.discardActiveObject();
  await new Promise(r => cv.loadFromJSON(s, r));
  EZ.ensureBg();
  cv.getObjects().forEach(decorate);
  restoring = false;
  cv.requestRenderAll();
  EZ.changed();
}
EZ.undo = async () => { if (!hasPage()) return; EZ.commit.flush(); const hh = H(); if (hh.idx <= 0) return; hh.idx--; await restore(hh.stack[hh.idx]); };
EZ.redo = async () => { if (!hasPage()) return; EZ.commit.cancel(); const hh = H(); if (hh.idx >= hh.stack.length - 1) return; hh.idx++; await restore(hh.stack[hh.idx]); };

// Called after every committed change.
EZ.changed = () => {
  EZ.dirty = true;
  EZ.onHistory?.();
  EZ.autosave?.();
  EZ.queueThumb();
  EZ.refreshPanel?.('layers');
};

/* ── pages ── */
EZ.blankPage = (fill = '#ffffff') => ({ id: 'p' + EZ.uid(), json: { version: fabric.version, objects: [{ type: 'rect', name: '__bg', left: 0, top: 0, width: EZ.W(), height: EZ.H(), fill, strokeWidth: 0 }] } });
EZ.storePage = () => { if (hasPage() && cv) EZ.doc.pages[EZ.pageIndex].json = EZ.pageJSON(); };
EZ.loadJSON = async json => {
  await EZ.ensureAssets(EZ.assetIdsIn(typeof json === 'string' ? json : JSON.stringify(json)));
  await EZ.loadFontsIn(typeof json === 'string' ? JSON.parse(json) : json);
  loading = true;
  cv.discardActiveObject();
  await new Promise(r => cv.loadFromJSON(json, r));
  EZ.ensureBg();
  cv.getObjects().forEach(decorate);
  loading = false;
  cv.requestRenderAll();
};
EZ.gotoPage = async (i, { force = false } = {}) => {
  if (!EZ.doc) return;
  i = EZ.clamp(i, 0, EZ.doc.pages.length - 1);
  if (i === EZ.pageIndex && !force) return;
  EZ.commit.flush();
  if (!force) EZ.storePage();
  EZ.setDraw(null);
  EZ.pageIndex = i;
  await EZ.loadJSON(EZ.doc.pages[i].json);
  seedHistory();
  EZ.renderPages?.();
  EZ.renderProps?.();
  EZ.refreshPanel?.('layers');
  EZ.refreshPanel?.('background');
};
EZ.addPage = async (json, at = EZ.pageIndex + 1) => {
  EZ.storePage();
  const p = json ? { id: 'p' + EZ.uid(), json } : EZ.blankPage();
  EZ.doc.pages.splice(at, 0, p);
  EZ.pageIndex = -1; // force reload
  await EZ.gotoPage(at, { force: true });
  EZ.changed();
  setTimeout(() => $('#pages .pg.on')?.scrollIntoView({ inline: 'nearest', behavior: 'smooth' }), 50);
};
EZ.duplicatePage = async i => {
  EZ.storePage();
  const src = EZ.doc.pages[i];
  await EZ.addPage(JSON.parse(JSON.stringify(src.json)), i + 1);
};
EZ.deletePage = async i => {
  if (EZ.doc.pages.length < 2) { EZ.toast('A design needs at least one page'); return; }
  EZ.storePage();
  const p = EZ.doc.pages[i];
  const n = (p.json.objects || []).filter(o => !isBg(o)).length;
  if (n && !(await EZ.confirm('Delete page ' + (i + 1) + '?', `It has ${n} element${n > 1 ? 's' : ''}. This can't be undone.`, 'Delete', true))) return;
  EZ.doc.pages.splice(i, 1);
  hist.delete(p.id);
  const next = Math.min(i, EZ.doc.pages.length - 1);
  EZ.pageIndex = -1;
  await EZ.gotoPage(next, { force: true });
  EZ.changed();
};
EZ.movePage = async (from, to) => {
  if (from === to) return;
  EZ.storePage();
  const cur = EZ.doc.pages[EZ.pageIndex];
  const [p] = EZ.doc.pages.splice(from, 1);
  EZ.doc.pages.splice(to, 0, p);
  EZ.pageIndex = EZ.doc.pages.indexOf(cur);
  EZ.renderPages?.();
  EZ.changed();
};

/* ── rendering pages to images (thumbnails + export) ── */
EZ.renderPage = async (json, { multiplier = 1, format = 'png', quality = 0.92, transparent = false, asCanvas = false, w = EZ.W(), h: hh = EZ.H() } = {}) => {
  await EZ.ensureAssets(EZ.assetIdsIn(JSON.stringify(json)));
  await EZ.loadFontsIn(json);
  const el = document.createElement('canvas');
  const sc = new fabric.StaticCanvas(el, { width: w, height: hh, enableRetinaScaling: false, renderOnAddRemove: false });
  await new Promise(r => sc.loadFromJSON(json, r));
  sc.getObjects().forEach(o => {
    if (o.name === '__bg') { o.set({ width: w, height: hh, left: 0, top: 0 }); if (transparent) o.visible = false; }
    if (o.name === '__bgimg') { const s = Math.max(w / o.width, hh / o.height); o.set({ originX: 'center', originY: 'center', left: w / 2, top: hh / 2, scaleX: s, scaleY: s }); }
  });
  if (format === 'jpeg' && transparent) sc.backgroundColor = '#fff';
  sc.renderAll();
  let out;
  if (asCanvas) out = sc.toCanvasElement(multiplier);
  else out = sc.toDataURL({ format, quality, multiplier, enableRetinaScaling: false });
  sc.dispose();
  return out;
};
EZ.pageThumb = async (json, maxSide = 220, w = EZ.W(), hh = EZ.H()) => {
  const m = maxSide / Math.max(w, hh);
  try { return await EZ.renderPage(json, { multiplier: m, format: 'jpeg', quality: 0.78, w, h: hh }); }
  catch (e) { console.warn('thumb failed', e); return ''; }
};
// Scale a page's content from one page size to another ("fit" keeps everything visible, centred).
EZ.scaleJSON = (json, fw, fh, tw, th) => {
  const out = JSON.parse(JSON.stringify(json));
  const s = Math.min(tw / fw, th / fh), ox = (tw - fw * s) / 2, oy = (th - fh * s) / 2;
  for (const o of out.objects || []) {
    if (o.name === '__bg') { Object.assign(o, { left: 0, top: 0, width: tw, height: th }); continue; }
    if (o.name === '__bgimg') continue;
    o.left = (o.left || 0) * s + ox;
    o.top = (o.top || 0) * s + oy;
    if (o.type === 'textbox') { o.fontSize *= s; o.width *= s; if (o.strokeWidth) o.strokeWidth *= s; if (o.shadow) { o.shadow.blur *= s; o.shadow.offsetX *= s; o.shadow.offsetY *= s; } }
    else if (o.type === 'ezLine') { o.width *= s * (o.scaleX || 1); o.scaleX = 1; o.strokeWidth *= s; }
    else { o.scaleX = (o.scaleX || 1) * s; o.scaleY = (o.scaleY || 1) * s; }
    if (o.ezRadius) o.ezRadius *= s;
  }
  return out;
};
EZ.queueThumb = EZ.debounce(async () => {
  if (!EZ.doc) return;
  const i = EZ.pageIndex, p = EZ.doc.pages[i];
  if (!p) return;
  p.thumb = await EZ.pageThumb(EZ.pageJSON());
  EZ.renderPages?.();
}, 700);

/* ── selection helpers ── */
EZ.selected = () => {
  const a = cv?.getActiveObject();
  if (!a) return [];
  return a.type === 'activeSelection' ? a.getObjects() : [a];
};
// Run fn on the selected objects with absolute coordinates, then reselect them.
EZ.withObjects = fn => {
  const a = cv.getActiveObject();
  if (!a) return;
  if (a.type === 'activeSelection') {
    const objs = a.getObjects();
    cv.discardActiveObject();
    fn(objs);
    objs.forEach(o => o.setCoords());
    cv.setActiveObject(new fabric.ActiveSelection(objs, { canvas: cv }));
  } else { fn([a]); a.setCoords(); }
  cv.requestRenderAll(); EZ.commit();
};
EZ.alignPage = how => {
  const a = cv.getActiveObject(); if (!a) return;
  const b = a.getBoundingRect(true, true), W = EZ.W(), H = EZ.H();
  const d = { left: [-b.left, 0], center: [W / 2 - (b.left + b.width / 2), 0], right: [W - (b.left + b.width), 0],
    top: [0, -b.top], middle: [0, H / 2 - (b.top + b.height / 2)], bottom: [0, H - (b.top + b.height)] }[how];
  a.set({ left: a.left + d[0], top: a.top + d[1] }); a.setCoords();
  cv.requestRenderAll(); EZ.commit();
};
EZ.alignSelection = how => EZ.withObjects(objs => {
  const rs = objs.map(o => o.getBoundingRect(true, true));
  const L = Math.min(...rs.map(r => r.left)), R = Math.max(...rs.map(r => r.left + r.width));
  const T = Math.min(...rs.map(r => r.top)), B = Math.max(...rs.map(r => r.top + r.height));
  objs.forEach((o, i) => {
    const r = rs[i];
    const d = { left: [L - r.left, 0], center: [(L + R) / 2 - (r.left + r.width / 2), 0], right: [R - r.left - r.width, 0],
      top: [0, T - r.top], middle: [0, (T + B) / 2 - (r.top + r.height / 2)], bottom: [0, B - r.top - r.height] }[how];
    o.set({ left: o.left + d[0], top: o.top + d[1] });
  });
});
EZ.distribute = axis => EZ.withObjects(objs => {
  if (objs.length < 3) return;
  const items = objs.map(o => ({ o, r: o.getBoundingRect(true, true) }));
  const k = axis === 'h' ? ['left', 'width'] : ['top', 'height'];
  items.sort((a, b) => a.r[k[0]] - b.r[k[0]]);
  const first = items[0].r, last = items[items.length - 1].r;
  const total = items.reduce((s, it) => s + it.r[k[1]], 0);
  const gap = ((last[k[0]] + last[k[1]]) - first[k[0]] - total) / (items.length - 1);
  let pos = first[k[0]];
  for (const it of items) { it.o.set(k[0], it.o[k[0]] + (pos - it.r[k[0]])); pos += it.r[k[1]] + gap; }
});
EZ.arrange = how => {
  const a = cv.getActiveObject(); if (!a) return;
  if (how === 'front') cv.bringToFront(a);
  else if (how === 'back') cv.sendToBack(a);
  else if (how === 'forward') cv.bringForward(a);
  else if (how === 'backward') {
    const bgN = cv.getObjects().filter(isBg).length;
    const objs = a.type === 'activeSelection' ? a.getObjects() : [a];
    if (Math.min(...objs.map(o => cv.getObjects().indexOf(o))) > bgN) cv.sendBackwards(a);
  }
  EZ.ensureBg();
  cv.requestRenderAll(); EZ.commit();
};
EZ.flip = axis => { EZ.selected().forEach(o => o.set(axis === 'x' ? 'flipX' : 'flipY', !o[axis === 'x' ? 'flipX' : 'flipY'])); cv.requestRenderAll(); EZ.commit(); };
EZ.group = () => {
  const a = cv.getActiveObject();
  if (a?.type !== 'activeSelection') return;
  const g = a.toGroup();
  g.set({ ezType: 'group', id: EZ.uid() });
  decorate(g);
  cv.requestRenderAll(); EZ.commit(); EZ.renderProps?.();
};
EZ.ungroup = () => {
  const a = cv.getActiveObject();
  if (a?.type !== 'group' || a.ezType !== 'group') return;
  a.toActiveSelection();
  cv.getActiveObject()?.getObjects().forEach(decorate);
  cv.requestRenderAll(); EZ.commit(); EZ.renderProps?.();
};
EZ.selectAll = () => {
  const objs = EZ.userObjects().filter(o => o.visible && !o.locked);
  cv.discardActiveObject();
  if (objs.length === 1) cv.setActiveObject(objs[0]);
  else if (objs.length) cv.setActiveObject(new fabric.ActiveSelection(objs, { canvas: cv }));
  cv.requestRenderAll();
};
EZ.del = () => {
  const objs = EZ.selected().filter(o => !o.locked);
  if (!objs.length) return;
  cv.discardActiveObject();
  objs.forEach(o => cv.remove(o));
  cv.requestRenderAll();
};

/* ── clipboard ── */
let clip = null, clipStamp = '';
const clone = o => new Promise(r => o.clone(r, EZ.PROPS));
async function pasteFrom(src, offset = 20) {
  const c = await clone(src);
  cv.discardActiveObject();
  c.set({ left: c.left + offset, top: c.top + offset, evented: true });
  if (c.type === 'activeSelection') {
    c.canvas = cv;
    c.forEachObject(o => { o.id = EZ.uid(); o.locked = false; cv.add(o); });
    c.setCoords();
  } else { c.id = EZ.uid(); c.locked = false; cv.add(c); }
  cv.setActiveObject(c);
  cv.requestRenderAll();
  return c;
}
EZ.copy = async () => {
  const a = cv.getActiveObject(); if (!a) return false;
  clip = await clone(a);
  clipStamp = '[easel ' + EZ.uid() + ']';
  try { await navigator.clipboard.writeText(clipStamp); } catch {}
  return true;
};
EZ.cut = async () => { if (await EZ.copy()) EZ.del(); };
EZ.paste = async () => { if (!clip) return; await pasteFrom(clip); clip.left += 20; clip.top += 20; };
EZ.duplicate = async () => { const a = cv.getActiveObject(); if (!a) return; await pasteFrom(a, 24); };
EZ.hasClip = () => !!clip;

// copy / paste style
let styleClip = null;
const STYLE_KEYS = ['fill', 'stroke', 'strokeWidth', 'strokeDashArray', 'opacity', 'shadow', 'fontFamily', 'fontSize', 'fontWeight',
  'fontStyle', 'underline', 'linethrough', 'textAlign', 'charSpacing', 'lineHeight', 'textBackgroundColor', 'effect', 'rx', 'ry', 'paintFirst'];
EZ.copyStyle = () => {
  const a = cv.getActiveObject(); if (!a || a.type === 'activeSelection') return;
  styleClip = {};
  for (const k of STYLE_KEYS) if (a[k] !== undefined) styleClip[k] = a[k]?.toObject ? a[k].toObject() : (a[k] && typeof a[k] === 'object' ? JSON.parse(JSON.stringify(a[k])) : a[k]);
  if (a.type === 'image') styleClip.__filters = a.filters.map(f => f.toObject());
  EZ.toast('Style copied — select something and paste it', { icon: 'paintbrush' });
};
EZ.pasteStyle = async () => {
  if (!styleClip) return;
  for (const o of EZ.selected()) {
    for (const [k, v] of Object.entries(styleClip)) {
      if (k === '__filters') continue;
      if (!(k in o) || v === undefined) continue;
      if (o.type !== 'textbox' && ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'underline', 'linethrough', 'textAlign', 'charSpacing', 'lineHeight', 'textBackgroundColor'].includes(k)) continue;
      if (o.type === 'image' && ['fill', 'stroke', 'strokeWidth'].includes(k)) continue;
      if (k === 'shadow') o.set('shadow', v ? new fabric.Shadow(v) : null);
      else if (k === 'fill' && v && v.colorStops) o.set('fill', new fabric.Gradient(v));
      else o.set(k, v);
    }
    if (o.type === 'image' && styleClip.__filters) {
      o.filters = await new Promise(r => fabric.util.enlivenObjects(styleClip.__filters.map(f => ({ ...f, type: f.type })), r, 'fabric.Image.filters'));
      o.applyFilters();
    }
    if (o.type === 'textbox') { await EZ.loadFont(o.fontFamily, o.fontWeight, o.fontStyle); o.initDimensions(); }
  }
  cv.requestRenderAll(); EZ.commit(); EZ.renderProps?.();
};
EZ.hasStyle = () => !!styleClip;

/* ── drawing ── */
let drawCfg = null;
EZ.isDrawing = () => !!cv?.isDrawingMode;
EZ.setDraw = cfg => {
  if (!cv) return;
  drawCfg = cfg;
  if (!cfg) {
    cv.isDrawingMode = false;
    $('#drawHud').style.display = 'none';
    EZ.onDrawChange?.();
    return;
  }
  cv.discardActiveObject();
  const b = new fabric.PencilBrush(cv);
  b.width = cfg.width;
  b.color = cfg.alpha < 1 ? new fabric.Color(cfg.color).setAlpha(cfg.alpha).toRgba() : cfg.color;
  b.strokeLineCap = cfg.tool === 'highlighter' ? 'square' : 'round';
  b.decimate = 2.5;
  cv.freeDrawingBrush = b;
  cv.isDrawingMode = true;
  $('#drawHud').style.display = 'flex';
  cv.requestRenderAll();
  EZ.onDrawChange?.();
};
EZ.drawConfig = () => drawCfg;

/* ── drag & drop onto the stage ── */
function setupDrop(stage) {
  let depth = 0;
  stage.addEventListener('dragenter', e => { e.preventDefault(); depth++; stage.classList.add('drop-over'); });
  stage.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; stage.classList.remove('drop-over'); } });
  stage.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  stage.addEventListener('drop', async e => {
    e.preventDefault(); depth = 0; stage.classList.remove('drop-over');
    const at = EZ.clientToPage(e.clientX, e.clientY);
    const item = e.dataTransfer.getData('application/x-easel');
    if (item) { EZ.insertItem?.(JSON.parse(item), at); return; }
    const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
    if (files.length) { EZ.uploadFiles?.(files, at); return; }
    const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (/^https?:\/\/\S+\.(png|jpe?g|webp|gif|svg)(\?\S*)?$/i.test(url || '')) EZ.addImage(url, { crossOrigin: 'anonymous', at });
  });
}

/* ── keyboard ── */
function setupKeys() {
  document.addEventListener('keydown', e => {
    if (!EZ.doc || !$('#home').classList.contains('hidden')) return;
    if (document.querySelector('.modal-bg')) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key;
    if (mod && !e.altKey && ['b', 'i', 'u'].includes(k.toLowerCase()) && cv.getActiveObject()?.type === 'textbox' && !document.activeElement?.matches('input:not([type=range]), select')) {
      e.preventDefault(); EZ.toggleText?.(k.toLowerCase()); return;
    }
    if (EZ.isTyping()) {
      if (k === 'Escape') { const a = cv.getActiveObject(); if (a?.isEditing) { a.exitEditing(); cv.requestRenderAll(); } else document.activeElement?.blur(); }
      if (mod && k.toLowerCase() === 's') { e.preventDefault(); EZ.saveNow?.(true); }
      return;
    }
    if (k === ' ' && !spaceDown) { spaceDown = true; cv.skipTargetFind = true; cv.selection = false; cv.defaultCursor = 'grab'; cv.setCursor('grab'); e.preventDefault(); return; }
    const a = cv.getActiveObject();
    const lower = k.toLowerCase();
    const run = (fn) => { e.preventDefault(); fn(); };
    if (mod) {
      if (lower === 'z' && !e.shiftKey) return run(EZ.undo);
      if ((lower === 'z' && e.shiftKey) || lower === 'y') return run(EZ.redo);
      if (lower === 'c') { if (a) run(EZ.copy); return; }
      if (lower === 'x') { if (a) run(EZ.cut); return; }
      if (lower === 'd') return run(EZ.duplicate);
      if (lower === 'g' && e.shiftKey) return run(EZ.ungroup);
      if (lower === 'g') return run(EZ.group);
      if (lower === 'a') return run(EZ.selectAll);
      if (lower === 's') return run(() => EZ.saveNow?.(true));
      if (lower === 'l' && a) return run(() => EZ.selected().forEach(o => EZ.setLocked(o, !o.locked)));
      if (k === ']') return run(() => EZ.arrange(e.altKey ? 'front' : 'forward'));
      if (k === '[') return run(() => EZ.arrange(e.altKey ? 'back' : 'backward'));
      if (k === '=' || k === '+') return run(() => EZ.zoomBy(1.2));
      if (k === '-') return run(() => EZ.zoomBy(1 / 1.2));
      if (k === '0') return run(EZ.fit);
      if (e.altKey && lower === 'c') return run(EZ.copyStyle);
      if (e.altKey && lower === 'v') return run(EZ.pasteStyle);
      return;
    }
    if (k === 'Delete' || k === 'Backspace') { if (a) run(EZ.del); return; }
    if (k === 'Escape') {
      if (EZ.isDrawing()) return run(() => EZ.setDraw(null));
      EZ.closePop(); cv.discardActiveObject(); cv.requestRenderAll(); return;
    }
    if (k.startsWith('Arrow') && a) {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      if (a.lockMovementX) return;
      if (k === 'ArrowLeft') a.left -= d; if (k === 'ArrowRight') a.left += d;
      if (k === 'ArrowUp') a.top -= d; if (k === 'ArrowDown') a.top += d;
      a.setCoords(); cv.requestRenderAll(); EZ.commit();
      return;
    }
    if (k === 'PageDown') return run(() => EZ.gotoPage(EZ.pageIndex + 1));
    if (k === 'PageUp') return run(() => EZ.gotoPage(EZ.pageIndex - 1));
    if (k === 'Enter' && a?.type === 'textbox' && !a.locked) { e.preventDefault(); a.enterEditing(); a.selectAll(); cv.requestRenderAll(); return; }
    if (k === '?') return run(() => EZ.showShortcuts?.());
    if (!e.altKey) {
      if (lower === 't') return run(() => EZ.addTextPreset?.('body'));
      if (lower === 'r') return run(() => EZ.addShape?.('rect'));
      if (lower === 'c') return run(() => EZ.addShape?.('circle'));
      if (lower === 'l') return run(() => EZ.addShape?.('line'));
    }
  });
  document.addEventListener('keyup', e => {
    if (e.key === ' ' && spaceDown) { spaceDown = false; cv.skipTargetFind = false; cv.selection = true; cv.defaultCursor = 'default'; cv.setCursor('default'); }
  });
  document.addEventListener('paste', async e => {
    if (!EZ.doc || EZ.isTyping() || !$('#home').classList.contains('hidden')) return;
    const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); EZ.uploadFiles?.(files); return; }
    const text = e.clipboardData?.getData('text/plain') || '';
    if (clip && (!text || text === clipStamp)) { e.preventDefault(); EZ.paste(); return; }
    if (text && text.length < 4000) { e.preventDefault(); EZ.addTextPreset?.('body', text.trim()); }
  });
}
})();
