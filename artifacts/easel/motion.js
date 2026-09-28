/* Easel — stage 3: element animations, page timing + transitions, present mode, and
   MP4 / GIF export. Every frame is rendered deterministically from the page JSON, so the
   preview, the presentation and the exported video all show exactly the same motion.

   Data: an element's animation is `obj.anim = {type, dur, delay}` (ms). Page settings live on
   the page background rect as `ezData.page = {dur, trans}` so they travel with the page JSON
   everywhere (saves, sync, versions, templates). */
(() => {
const EZ = window.EZ;
const { $, $$, h, icon } = EZ;

EZ.PROPS.push('anim');

EZ.ANIMS = [
  { id: 'none', label: 'None' },
  { id: 'fade', label: 'Fade' },
  { id: 'rise', label: 'Rise' },
  { id: 'drop', label: 'Drop' },
  { id: 'slideL', label: 'Slide left' },
  { id: 'slideR', label: 'Slide right' },
  { id: 'pop', label: 'Pop' },
  { id: 'zoom', label: 'Zoom out' },
  { id: 'spin', label: 'Spin' },
  { id: 'wipe', label: 'Wipe' },
  { id: 'type', label: 'Typewriter', textOnly: true },
];
const easeOut = p => 1 - Math.pow(1 - p, 3);
const easeBack = p => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };

/* ── page timing ── */
const DEFAULT_DUR = 4000, TAIL = 1800, FADE = 500;
const pageSettings = json => (json.objects || []).find(o => o.name === '__bg')?.ezData?.page || {};
const animEnd = objs => Math.max(0, ...objs.map(o => (o.anim && o.anim.type !== 'none') ? (o.anim.delay || 0) + (o.anim.dur || 600) : 0));
EZ.pageDuration = json => {
  const s = pageSettings(json);
  if (s.dur) return s.dur;
  const end = animEnd(json.objects || []);
  return end ? Math.max(3000, end + TAIL) : DEFAULT_DUR;
};
EZ.pageTransition = json => pageSettings(json).trans || 'fade';
EZ.setPageSettings = patch => {
  const bg = EZ.bgRect(); if (!bg) return;
  const cur = bg.ezData?.page || {};
  bg.ezData = { ...(bg.ezData || {}), page: { ...cur, ...patch } };
  EZ.commit();
};

/* ── a page prepared for playback at a given scale ── */
class Stage {
  static async create(json, W, H, z) {
    await EZ.ensureAssets(EZ.assetIdsIn(JSON.stringify(json)));
    await EZ.loadFontsIn(json);
    const s = new Stage();
    s.el = document.createElement('canvas');
    s.sc = new fabric.StaticCanvas(s.el, { width: Math.round(W * z), height: Math.round(H * z), enableRetinaScaling: false, renderOnAddRemove: false });
    await new Promise(r => s.sc.loadFromJSON(json, r));
    s.sc.setZoom(z);
    s.W = W; s.H = H;
    s.dur = EZ.pageDuration(json);
    s.trans = EZ.pageTransition(json);
    s.items = [];
    for (const o of s.sc.getObjects()) {
      if (o.name === '__bg') o.set({ left: 0, top: 0, width: W, height: H });
      if (o.name === '__bgimg') { const k = Math.max(W / o.width, H / o.height); o.set({ originX: 'center', originY: 'center', left: W / 2, top: H / 2, scaleX: k, scaleY: k }); }
      if (!o.anim || o.anim.type === 'none' || EZ.isBg(o)) continue;
      s.items.push({ o, b: { left: o.left, top: o.top, opacity: o.opacity ?? 1, scaleX: o.scaleX, scaleY: o.scaleY, angle: o.angle, text: o.text, clip: o.clipPath, center: o.getCenterPoint() } });
    }
    return s;
  }
  renderAt(t) {
    const D = 0.06 * Math.max(this.W, this.H), S = 0.18 * this.W;
    for (const { o, b } of this.items) {
      const a = o.anim;
      const raw = EZ.clamp((t - (a.delay || 0)) / Math.max(1, a.dur || 600), 0, 1);
      const p = easeOut(raw);
      let op = raw, dx = 0, dy = 0, sc = 1, ang = 0;
      switch (a.type) {
        case 'fade': break;
        case 'rise': dy = (1 - p) * D; break;
        case 'drop': dy = -(1 - p) * D; break;
        case 'slideL': dx = (1 - p) * S; break;
        case 'slideR': dx = -(1 - p) * S; break;
        case 'pop': sc = 0.35 + 0.65 * easeBack(raw); op = Math.min(1, raw * 3); break;
        case 'zoom': sc = 1 + 0.45 * (1 - p); break;
        case 'spin': ang = -150 * (1 - p); sc = 0.5 + 0.5 * p; break;
        case 'wipe': op = raw > 0 ? 1 : 0; break;
        case 'type': op = raw > 0 ? 1 : 0; break;
      }
      o.set({ opacity: b.opacity * op, left: b.left + dx, top: b.top + dy });
      if (sc !== 1 || ang || o.scaleX !== b.scaleX || o.angle !== b.angle) {
        o.set({ scaleX: b.scaleX * sc, scaleY: b.scaleY * sc, angle: b.angle + ang });
        o.setPositionByOrigin(new fabric.Point(b.center.x + dx, b.center.y + dy), 'center', 'center');
      }
      if (a.type === 'wipe') {
        if (raw < 1) {
          o.clipPath = new fabric.Rect({ originX: 'left', originY: 'top', left: -o.width / 2 - 2, top: -o.height / 2 - 2, width: (o.width + 4) * p, height: o.height + 4 });
        } else o.clipPath = b.clip;
        o.dirty = true;
      }
      if (a.type === 'type' && typeof b.text === 'string') {
        const n = Math.round(b.text.length * raw);
        if (o.text.length !== n) { o.set('text', b.text.slice(0, n)); o.initDimensions?.(); o.dirty = true; }
      }
    }
    this.sc.renderAll();
    return this.el;
  }
  dispose() { this.sc.dispose(); }
}
EZ.Stage = Stage;

// Timeline over several pages, with cross-fades that overlap the end of a page.
function timeline(stages) {
  const segs = [];
  let t = 0;
  stages.forEach((s, i) => {
    segs.push({ s, start: t, end: t + s.dur });
    const fade = i < stages.length - 1 && s.trans === 'fade' ? FADE : 0;
    t += s.dur - fade;
  });
  const total = segs.length ? segs[segs.length - 1].end : 0;
  return { segs, total };
}
function drawFrame(ctx, tl, t, w, h) {
  const act = tl.segs.filter(g => t >= g.start && t < g.end);
  if (!act.length) act.push(tl.segs[tl.segs.length - 1]);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  act.forEach((g, i) => {
    const el = g.s.renderAt(t - g.start);
    ctx.globalAlpha = i === 0 ? 1 : EZ.clamp((t - g.start) / FADE, 0, 1);
    ctx.drawImage(el, 0, 0, w, h);
  });
  ctx.globalAlpha = 1;
}

/* ═════ present mode (and single-page preview) ═════ */
EZ.present = async (start = EZ.pageIndex, { single = false } = {}) => {
  if (!EZ.doc) return;
  EZ.commit.flush(); EZ.storePage();
  EZ.setDraw(null); EZ.closePop();
  const doc = EZ.doc, W = doc.w, H = doc.h;
  const ov = h('div', { id: 'present', class: single ? 'preview' : '' });
  const stageBox = h('div', { class: 'pr-stage' });
  const counter = h('span', { class: 'pr-count' });
  let auto = false;
  const autoBtn = h('button', { class: 'pr-btn', title: 'Play automatically' }, icon('play', 'sm'), h('span', {}, 'Autoplay'));
  const bar = h('div', { class: 'pr-bar' },
    single ? h('span', { class: 'pr-count' }, 'Preview') : counter,
    h('span', { style: { flex: 1 } }),
    single ? null : h('button', { class: 'pr-btn', title: 'Previous (←)', onclick: () => go(idx - 1) }, icon('chevron-left', 'sm')),
    single ? null : h('button', { class: 'pr-btn', title: 'Next (→ / Space)', onclick: () => go(idx + 1) }, icon('chevron-right', 'sm')),
    single ? null : autoBtn,
    h('button', { class: 'pr-btn', title: 'Replay page', onclick: () => go(idx, true) }, icon('rotate-ccw', 'sm')),
    h('button', { class: 'pr-btn', title: 'Close (Esc)', onclick: () => close() }, icon('x', 'sm')));
  ov.append(stageBox, bar);
  document.body.append(ov);
  if (!single && ov.requestFullscreen) { try { await ov.requestFullscreen(); } catch {} }

  const dpr = Math.min(2, devicePixelRatio || 1);
  const fit = () => Math.min((ov.clientWidth - (single ? 80 : 0)) / W, (ov.clientHeight - (single ? 140 : 56)) / H);
  const cache = new Map();
  const stageFor = i => {
    if (!cache.has(i)) cache.set(i, Stage.create(doc.pages[i].json, W, H, fit() * dpr));
    return cache.get(i);
  };
  let idx = -1, raf = 0, t0 = 0, cur = null, advanceTimer = 0, closed = false;
  async function go(i, replay) {
    if (single) i = start;
    if (i < 0 || i >= doc.pages.length) { if (i >= doc.pages.length && !single) end(); return; }
    if (i === idx && !replay) return;
    idx = i;
    counter.textContent = `${i + 1} / ${doc.pages.length}`;
    cancelAnimationFrame(raf); clearTimeout(advanceTimer);
    const s = await stageFor(i);
    if (closed || idx !== i) return;
    stageFor(i + 1 < doc.pages.length ? i + 1 : i); // preload the next page
    const z = fit();
    const c = s.el;
    c.className = 'pr-canvas';
    Object.assign(c.style, { width: W * z + 'px', height: H * z + 'px' });
    const prev = cur;
    cur = c;
    if (prev && prev !== c) { prev.classList.add('out'); setTimeout(() => { if (prev !== cur) prev.remove(); }, 350); }
    if (prev !== c) c.classList.add('out');
    stageBox.append(c);
    void c.offsetWidth; // flush styles so the fade-in transition runs
    c.classList.remove('out');
    t0 = performance.now();
    const tick = now => {
      const t = now - t0;
      s.renderAt(t);
      if (t < s.dur + 50) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    if (auto) advanceTimer = setTimeout(() => go(idx + 1), s.dur);
  }
  function end() {
    if (auto) { auto = false; autoBtn.classList.remove('on'); }
    EZ.toast('End of presentation — Esc to exit');
  }
  autoBtn.onclick = () => { auto = !auto; autoBtn.classList.toggle('on', auto); if (auto) go(idx, true); else clearTimeout(advanceTimer); };
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (single) return;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); go(idx + 1); }
    if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); go(idx - 1); }
    if (e.key === 'Home') go(0);
    if (e.key === 'End') go(doc.pages.length - 1);
  };
  stageBox.addEventListener('click', e => { if (single) return; (e.clientX < innerWidth / 3 ? go(idx - 1) : go(idx + 1)); });
  let hideT = 0;
  const wake = () => { ov.classList.remove('idle'); clearTimeout(hideT); hideT = setTimeout(() => ov.classList.add('idle'), 2200); };
  ov.addEventListener('pointermove', wake); wake();
  const onFs = () => { if (!document.fullscreenElement && !single && !closed) close(); };
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('fullscreenchange', onFs);
  function close() {
    if (closed) return; closed = true;
    cancelAnimationFrame(raf); clearTimeout(advanceTimer); clearTimeout(hideT);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('fullscreenchange', onFs);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    ov.remove();
    cache.forEach(p => p.then(s => s.dispose()).catch(() => {}));
  }
  go(start);
};

/* ═════ animate panel ═════ */
const ANIM_PREVIEW = {
  none: '', fade: 'ez-a-fade', rise: 'ez-a-rise', drop: 'ez-a-drop', slideL: 'ez-a-slideL', slideR: 'ez-a-slideR',
  pop: 'ez-a-pop', zoom: 'ez-a-zoom', spin: 'ez-a-spin', wipe: 'ez-a-wipe', type: 'ez-a-type',
};
EZ.registerPanel?.('animate', 'Animate', body => {
  const sel = EZ.selected();
  const cv = EZ.cv;
  const tiles = (current, onPick, textOk) => {
    const g = h('div', { class: 'grid g3' });
    for (const a of EZ.ANIMS) {
      if (a.textOnly && !textOk) continue;
      const on = (current || 'none') === a.id;
      const demo = h('span', { class: 'ez-demo ' + ANIM_PREVIEW[a.id] }, a.id === 'type' ? 'Abc' : '');
      const t = h('button', { class: 'tile', style: { aspectRatio: '1.15', flexDirection: 'column', gap: '6px', display: 'flex', borderColor: on ? 'var(--accent)' : '', background: on ? 'var(--accent-bg)' : '' }, onclick: () => onPick(a.id) },
        demo, h('small', { style: { fontWeight: 600, fontSize: '11px' } }, a.label));
      t.addEventListener('mouseenter', () => { demo.classList.remove('run'); void demo.offsetWidth; demo.classList.add('run'); });
      g.append(t);
    }
    return g;
  };
  const slider = (label, value, min, max, step, fmt, onInput) => {
    const r = h('input', { type: 'range', min, max, step, value });
    const v = h('span', {}, fmt(value));
    r.addEventListener('input', () => { v.textContent = fmt(+r.value); onInput(+r.value); });
    r.addEventListener('change', () => EZ.commit());
    return h('div', { class: 'field' }, h('label', {}, label, v), r);
  };
  const secs = v => (v / 1000).toFixed(1) + ' s';
  const previewBtns = h('div', { class: 'grid g2', style: { marginTop: '6px' } },
    h('button', { class: 'big-btn', onclick: () => EZ.present(EZ.pageIndex, { single: true }) }, icon('play', 'sm'), 'Preview page'),
    h('button', { class: 'big-btn soft', onclick: () => EZ.present(0) }, icon('monitor-play', 'sm'), 'Present'));

  if (sel.length) {
    const first = sel[0].anim || { type: 'none', dur: 600, delay: 0 };
    const textOk = sel.every(o => o.type === 'textbox');
    const set = patch => { sel.forEach(o => { o.anim = { type: 'none', dur: 600, delay: 0, ...(o.anim || {}), ...patch }; if (o.anim.type === 'none') delete o.anim; }); };
    body.append(h('div', { class: 'sec-title' }, sel.length > 1 ? `${sel.length} elements` : 'This element'),
      tiles(first.type, id => { set({ type: id }); EZ.commit(); EZ.refreshPanel('animate'); EZ.renderPages?.(); }, textOk));
    if (first.type && first.type !== 'none') {
      body.append(h('div', { class: 'sec-title' }, 'Timing'),
        slider('Duration', first.dur || 600, 200, 3000, 100, secs, v => set({ dur: v })),
        slider('Starts after', first.delay || 0, 0, 8000, 100, secs, v => set({ delay: v })));
    }
    body.append(h('p', { class: 'hint' }, 'Tip: give elements increasing “starts after” times so they appear one after another.'));
    body.append(previewBtns);
    return;
  }
  // nothing selected → whole page
  const objs = EZ.userObjects();
  const bg = EZ.bgRect();
  const ps = bg?.ezData?.page || {};
  body.append(h('div', { class: 'sec-title' }, 'Animate the whole page'),
    h('p', { class: 'hint', style: { margin: '-4px 0 8px' } }, 'Applies one style to every element, one after another from top to bottom. Select a single element to fine-tune it.'),
    tiles(null, id => {
      const order = objs.slice().sort((a, b) => (a.getBoundingRect(true, true).top - b.getBoundingRect(true, true).top) || (a.left - b.left));
      order.forEach((o, i) => {
        if (id === 'none') { delete o.anim; return; }
        const type = id === 'type' && o.type !== 'textbox' ? 'fade' : id;
        o.anim = { type, dur: 600, delay: i * 150 };
      });
      EZ.commit(); EZ.refreshPanel('animate');
      if (id !== 'none') EZ.present(EZ.pageIndex, { single: true });
    }, true));
  const animated = objs.filter(o => o.anim).length;
  body.append(h('div', { class: 'sec-title' }, 'Page', h('span', { class: 'hint' }, `${animated} of ${objs.length} elements animated`)));
  const autoDur = EZ.pageDuration({ objects: [{ name: '__bg', ezData: { page: {} } }, ...objs.map(o => ({ anim: o.anim }))] });
  const autoChk = h('input', { type: 'checkbox', checked: !ps.dur });
  const durField = slider('Page duration', ps.dur || autoDur, 1000, 30000, 500, secs, v => { EZ.setPageSettings({ dur: v }); autoChk.checked = false; });
  autoChk.addEventListener('change', () => { EZ.setPageSettings({ dur: autoChk.checked ? null : (ps.dur || autoDur) }); EZ.refreshPanel('animate'); });
  body.append(h('label', { class: 'row', style: { fontWeight: 600, fontSize: '12.5px', marginBottom: '8px' } }, autoChk, `Automatic (${secs(autoDur)} — animations + a short pause)`), durField);
  const seg = h('div', { class: 'seg', style: { marginBottom: '12px' } });
  [['fade', 'Fade'], ['none', 'Cut']].forEach(([id, l]) => seg.append(h('button', { class: (ps.trans || 'fade') === id ? 'on' : '', onclick: () => { EZ.setPageSettings({ trans: id }); EZ.refreshPanel('animate'); } }, l)));
  body.append(h('div', { class: 'lbl' }, 'Transition to the next page'), seg);
  if (animated) body.append(h('button', { class: 'big-btn soft', style: { marginBottom: '8px', height: '36px' }, onclick: () => { objs.forEach(o => delete o.anim); EZ.commit(); EZ.refreshPanel('animate'); } }, icon('x', 'sm'), 'Remove all animations'));
  body.append(previewBtns);
  body.append(h('p', { class: 'hint', style: { marginTop: '12px' } }, 'Animations play in Present mode and in MP4 / GIF downloads. Static downloads (PNG, PDF) show the finished page.'));
});

/* ═════ MP4 / GIF export ═════ */
const MP4_LIB = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/build/mp4-muxer.min.js';
const GIF_LIB = 'https://cdn.jsdelivr.net/npm/gifenc@1.0.3/dist/gifenc.esm.js';
const loadScript = src => new Promise((res, rej) => { if ([...document.scripts].some(s => s.src === src)) return res(); const s = document.createElement('script'); s.src = src; s.crossOrigin = 'anonymous'; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.append(s); });
const even = n => Math.max(2, Math.round(n / 2) * 2);

EZ.motionLength = pages => {
  let t = 0;
  pages.forEach((i, k) => { const j = EZ.doc.pages[i].json; t += EZ.pageDuration(j) - (k < pages.length - 1 && EZ.pageTransition(j) === 'fade' ? FADE : 0); });
  return t;
};

EZ.exportMotion = async (st, pages, name, busy) => {
  const W = EZ.W(), H = EZ.H();
  const long = st.type === 'gif' ? st.gifSize : st.res;
  const z = long / Math.max(W, H);
  const ow = even(W * z), oh = even(H * z);
  const fps = st.type === 'gif' ? st.gifFps : st.fps;
  busy.set('Preparing pages…', '', 0);
  const stages = [];
  for (const i of pages) stages.push(await Stage.create(EZ.doc.pages[i].json, W, H, ow / W));
  const tl = timeline(stages);
  const frames = Math.max(1, Math.ceil(tl.total / 1000 * fps));
  const comp = document.createElement('canvas'); comp.width = ow; comp.height = oh;
  const ctx = comp.getContext('2d', { willReadFrequently: st.type === 'gif' });
  const pct = i => i / frames * 100;
  try {
    if (st.type === 'gif') {
      const { GIFEncoder, quantize, applyPalette } = await import(GIF_LIB);
      const gif = GIFEncoder();
      for (let i = 0; i < frames; i++) {
        drawFrame(ctx, tl, i * 1000 / fps, ow, oh);
        const data = ctx.getImageData(0, 0, ow, oh).data;
        const palette = quantize(data, 256);
        gif.writeFrame(applyPalette(data, palette), ow, oh, { palette, delay: Math.round(1000 / fps) });
        if (i % 4 === 0) { busy.set('Making GIF…', `frame ${i + 1} of ${frames}`, pct(i)); await EZ.sleep(0); }
      }
      gif.finish();
      EZ.download(new Blob([gif.bytes()], { type: 'image/gif' }), name + '.gif');
      EZ.toast(`GIF downloaded (${(tl.total / 1000).toFixed(1)} s)`, { icon: 'check' });
      return;
    }
    if (window.VideoEncoder) {
      await loadScript(MP4_LIB);
      let codec = null;
      for (const c of ['avc1.640034', 'avc1.640028', 'avc1.4d0028', 'avc1.42002a', 'avc1.42001f']) {
        try { const s = await VideoEncoder.isConfigSupported({ codec: c, width: ow, height: oh, bitrate: 8e6, framerate: fps }); if (s.supported) { codec = c; break; } } catch {}
      }
      if (codec) {
        const muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: 'avc', width: ow, height: oh, frameRate: fps }, fastStart: 'in-memory' });
        let encErr = null;
        const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { encErr = e; } });
        enc.configure({ codec, width: ow, height: oh, bitrate: Math.min(16e6, Math.round(ow * oh * fps * 0.12)), framerate: fps, latencyMode: 'quality' });
        for (let i = 0; i < frames; i++) {
          if (encErr) throw encErr;
          drawFrame(ctx, tl, i * 1000 / fps, ow, oh);
          const frame = new VideoFrame(comp, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
          enc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
          frame.close();
          while (enc.encodeQueueSize > 8) await EZ.sleep(2);
          if (i % 5 === 0) { busy.set('Rendering video…', `frame ${i + 1} of ${frames}`, pct(i)); await EZ.sleep(0); }
        }
        busy.set('Finishing video…', '', 100);
        await enc.flush();
        if (encErr) throw encErr;
        muxer.finalize();
        enc.close();
        EZ.download(new Blob([muxer.target.buffer], { type: 'video/mp4' }), name + '.mp4');
        EZ.toast(`MP4 downloaded (${(tl.total / 1000).toFixed(1)} s, ${ow}×${oh})`, { icon: 'check' });
        return;
      }
    }
    // Fallback: record in real time (WebM) where WebCodecs H.264 isn't available.
    if (!window.MediaRecorder || !comp.captureStream) throw new Error('This browser cannot make videos — try Chrome or Edge.');
    const mime = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(comp.captureStream(fps), { mimeType: mime, videoBitsPerSecond: 8e6 });
    const chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    const done = new Promise(r => { rec.onstop = r; });
    rec.start();
    const t0 = performance.now();
    await new Promise(resolve => {
      const tick = () => {
        const t = performance.now() - t0;
        drawFrame(ctx, tl, Math.min(t, tl.total), ow, oh);
        busy.set('Recording video (real time)…', `${(t / 1000).toFixed(1)} / ${(tl.total / 1000).toFixed(1)} s`, t / tl.total * 100);
        if (t < tl.total) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });
    rec.stop(); await done;
    const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
    EZ.download(new Blob(chunks, { type: mime.split(';')[0] }), `${name}.${ext}`);
    EZ.toast(`${ext.toUpperCase()} downloaded`, { icon: 'check' });
  } finally {
    stages.forEach(s => s.dispose());
  }
};
})();
