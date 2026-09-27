/* Easel — export: PNG / JPG (ZIP for several pages), PDF (standard + print with bleed and crop
   marks), SVG, single images, and .easel project files (design + embedded images). */
(() => {
const EZ = window.EZ;
const { $, $$, h, icon } = EZ;

const TYPES = [
  { id: 'png', label: 'PNG', sub: 'Best for graphics and anything with text. Supports transparency.', ic: 'file-image' },
  { id: 'jpg', label: 'JPG', sub: 'Smallest file, best for photos.', ic: 'file-image' },
  { id: 'pdf', label: 'PDF standard', sub: 'All pages in one document — slides, handouts, worksheets.', ic: 'file-text' },
  { id: 'pdfprint', label: 'PDF print', sub: 'High resolution with 3 mm bleed and crop marks, for a print shop.', ic: 'printer' },
  { id: 'svg', label: 'SVG', sub: 'Vector file of the page(s), for further editing.', ic: 'file-code' },
  { id: 'easel', label: 'Easel project', sub: 'The editable design incl. images — open it again in Easel on any device.', ic: 'save' },
];
let last = { type: 'png', mult: 2, quality: 90, transparent: false, pages: 'all', range: '', dpi: 300 };
try { last = { ...last, ...JSON.parse(localStorage.getItem('easel.export') || '{}') }; } catch {}

EZ.showExport = () => EZ.modal((m, close) => {
  const st = { ...last };
  const n = EZ.doc.pages.length;
  const body = h('div');
  const draw = () => {
    body.innerHTML = '';
    const list = h('div', { class: 'grid g2', style: { marginBottom: '14px' } });
    TYPES.forEach(t => list.append(h('button', {
      class: 'layer' + (st.type === t.id ? ' on' : ''), style: { margin: 0, alignItems: 'flex-start' },
      onclick: () => { st.type = t.id; draw(); },
    }, h('span', { class: 'lt', style: { width: '30px', height: '30px' } }, icon(t.ic, 'sm')), h('div', { class: 'ln', style: { whiteSpace: 'normal' } }, t.label, h('small', {}, t.sub)))));
    body.append(list);
    if (st.type === 'png' || st.type === 'jpg' || st.type === 'pdf') {
      const r = h('input', { type: 'range', min: 0.5, max: 4, step: 0.25, value: st.mult, style: { width: '100%' } });
      const v = h('span');
      const upd = () => { v.textContent = `${st.mult}×  ·  ${Math.round(EZ.W() * st.mult)} × ${Math.round(EZ.H() * st.mult)} px${EZ.doc.mm ? '  ·  ' + Math.round(96 * st.mult) + ' dpi' : ''}`; };
      r.addEventListener('input', () => { st.mult = +r.value; upd(); });
      upd();
      body.append(h('div', { class: 'field' }, h('label', {}, 'Size', v), r));
    }
    if (st.type === 'jpg' || st.type === 'pdf') {
      const q = h('input', { type: 'range', min: 40, max: 100, value: st.quality, style: { width: '100%' } });
      const qv = h('span', {}, st.quality + '%');
      q.addEventListener('input', () => { st.quality = +q.value; qv.textContent = q.value + '%'; });
      body.append(h('div', { class: 'field' }, h('label', {}, 'Quality', qv), q));
    }
    if (st.type === 'pdfprint') {
      const seg = h('div', { class: 'seg', style: { marginBottom: '12px' } });
      [[150, '150 dpi'], [300, '300 dpi']].forEach(([d, l]) => seg.append(h('button', { class: st.dpi === d ? 'on' : '', onclick: () => { st.dpi = d; draw(); } }, l)));
      body.append(h('div', { class: 'lbl' }, 'Resolution'), seg);
      if (!EZ.doc.mm) body.append(h('p', { class: 'hint' }, `This design is in pixels; it will be printed at ${EZ.round(EZ.W() / EZ.UNIT_PX.mm, 1)} × ${EZ.round(EZ.H() / EZ.UNIT_PX.mm, 1)} mm (96 px per inch).`));
    }
    if (st.type === 'png') {
      const c = h('input', { type: 'checkbox', checked: st.transparent });
      c.addEventListener('change', () => { st.transparent = c.checked; });
      body.append(h('label', { class: 'row', style: { marginBottom: '12px', fontWeight: 600 } }, c, 'Transparent background'));
    }
    if (st.type !== 'easel' && n > 1) {
      const seg = h('div', { class: 'seg' });
      [['all', `All pages (${n})`], ['current', `Current page (${EZ.pageIndex + 1})`], ['range', 'Pages…']].forEach(([id, l]) => seg.append(h('button', { class: st.pages === id ? 'on' : '', onclick: () => { st.pages = id; draw(); } }, l)));
      body.append(h('div', { class: 'lbl' }, 'Pages'), seg);
      if (st.pages === 'range') {
        const inp = h('input', { class: 'inp', value: st.range, placeholder: 'e.g. 1-3, 5', style: { marginTop: '8px' } });
        inp.addEventListener('input', () => { st.range = inp.value; });
        body.append(inp);
      }
      if ((st.type === 'png' || st.type === 'jpg' || st.type === 'svg') && st.pages !== 'current') body.append(h('p', { class: 'hint', style: { marginTop: '8px' } }, 'Several pages are downloaded as one ZIP file.'));
    }
  };
  draw();
  m.append(h('h3', {}, 'Download'), h('p', {}, 'Everything is rendered in your browser.'), body,
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => close() }, 'Cancel'),
      h('button', { class: 'btn pri', onclick: () => close(st) }, icon('download', 'sm'), 'Download')));
}, { width: 560 }).then(st => {
  if (!st) return;
  last = st;
  try { localStorage.setItem('easel.export', JSON.stringify(st)); } catch {}
  runExport(st);
});

function pageList(st) {
  const n = EZ.doc.pages.length;
  if (st.type === 'easel' || n === 1 || st.pages === 'all') return [...Array(n).keys()];
  if (st.pages === 'current') return [EZ.pageIndex];
  const out = new Set();
  for (const part of st.range.split(/[,;\s]+/)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = +m[1], b = m[2] ? +m[2] : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= n) out.add(i - 1);
  }
  return out.size ? [...out].sort((a, b) => a - b) : [EZ.pageIndex];
}

async function runExport(st) {
  EZ.commit.flush();
  EZ.storePage();
  const name = EZ.slug(EZ.doc.name);
  const pages = pageList(st);
  const busy = EZ.busy('Preparing download…', '', 0);
  try {
    if (st.type === 'easel') { busy.close(); return EZ.exportProject(); }
    if (st.type === 'png' || st.type === 'jpg') {
      const fmt = st.type === 'png' ? 'png' : 'jpeg';
      const blobs = [];
      for (const [k, i] of pages.entries()) {
        busy.set(`Rendering page ${i + 1}…`, `${k + 1} of ${pages.length}`, k / pages.length * 100);
        const url = await EZ.renderPage(EZ.doc.pages[i].json, { multiplier: st.mult, format: fmt, quality: st.quality / 100, transparent: st.type === 'png' && st.transparent });
        blobs.push({ name: `${name}${pages.length > 1 ? '-' + (i + 1) : ''}.${st.type}`, blob: await EZ.dataURLtoBlob(url) });
      }
      await deliver(blobs, name, busy);
    } else if (st.type === 'svg') {
      const files = [];
      for (const [k, i] of pages.entries()) {
        busy.set(`Building SVG ${i + 1}…`, '', k / pages.length * 100);
        files.push({ name: `${name}${pages.length > 1 ? '-' + (i + 1) : ''}.svg`, blob: new Blob([await pageSVG(EZ.doc.pages[i].json)], { type: 'image/svg+xml' }) });
      }
      await deliver(files, name, busy);
    } else if (st.type === 'pdf' || st.type === 'pdfprint') {
      await pdf(st, pages, name, busy);
    }
  } catch (e) {
    console.error(e);
    EZ.toast('Export failed: ' + (e?.message || e), { err: true, ms: 6000 });
  }
  busy.close();
}
async function deliver(files, name, busy) {
  if (files.length === 1) { EZ.download(files[0].blob, files[0].name); EZ.toast('Downloaded ' + files[0].name, { icon: 'check' }); return; }
  busy.set('Zipping…', '', 100);
  const zip = new JSZip();
  files.forEach(f => zip.file(f.name, f.blob));
  EZ.download(await zip.generateAsync({ type: 'blob' }), name + '.zip');
  EZ.toast(`Downloaded ${files.length} files as ZIP`, { icon: 'check' });
}

/* ── PDF ── */
async function pdf(st, pages, name, busy) {
  const { jsPDF } = window.jspdf;
  const print = st.type === 'pdfprint';
  const wmm = EZ.doc.mm ? EZ.doc.mm[0] : EZ.W() / EZ.UNIT_PX.mm;
  const hmm = EZ.doc.mm ? EZ.doc.mm[1] : EZ.H() / EZ.UNIT_PX.mm;
  const bleed = print ? 3 : 0, margin = print ? 12 : 0; // margin holds bleed + crop marks
  const pw = wmm + margin * 2, ph = hmm + margin * 2;
  const doc = new jsPDF({ unit: 'mm', format: [pw, ph], orientation: pw > ph ? 'l' : 'p', compress: true });
  const mult = print ? st.dpi / 96 * (EZ.doc.mm ? (wmm * EZ.UNIT_PX.mm) / EZ.W() : 1) : st.mult;
  for (const [k, i] of pages.entries()) {
    busy.set(`Rendering page ${i + 1}…`, `${k + 1} of ${pages.length}`, k / pages.length * 100);
    if (k > 0) doc.addPage([pw, ph], pw > ph ? 'l' : 'p');
    const canvas = await EZ.renderPage(EZ.doc.pages[i].json, { multiplier: mult, asCanvas: true });
    if (!print) {
      doc.addImage(canvas.toDataURL('image/jpeg', st.quality / 100), 'JPEG', 0, 0, pw, ph, undefined, 'FAST');
      continue;
    }
    // extend edges into the bleed so the background runs off the trim line
    const bpx = Math.round(bleed / wmm * canvas.width);
    const c = document.createElement('canvas');
    c.width = canvas.width + bpx * 2; c.height = canvas.height + bpx * 2;
    const x = c.getContext('2d'), W = canvas.width, H = canvas.height;
    x.drawImage(canvas, bpx, bpx);
    x.drawImage(canvas, 0, 0, W, 1, bpx, 0, W, bpx);
    x.drawImage(canvas, 0, H - 1, W, 1, bpx, bpx + H, W, bpx);
    x.drawImage(canvas, 0, 0, 1, H, 0, bpx, bpx, H);
    x.drawImage(canvas, W - 1, 0, 1, H, bpx + W, bpx, bpx, H);
    x.drawImage(canvas, 0, 0, 1, 1, 0, 0, bpx, bpx);
    x.drawImage(canvas, W - 1, 0, 1, 1, bpx + W, 0, bpx, bpx);
    x.drawImage(canvas, 0, H - 1, 1, 1, 0, bpx + H, bpx, bpx);
    x.drawImage(canvas, W - 1, H - 1, 1, 1, bpx + W, bpx + H, bpx, bpx);
    doc.addImage(c.toDataURL('image/jpeg', 0.95), 'JPEG', margin - bleed, margin - bleed, wmm + bleed * 2, hmm + bleed * 2, undefined, 'FAST');
    // crop marks
    doc.setDrawColor(0); doc.setLineWidth(0.25);
    const o = bleed + 1.5, L = 6, x0 = margin, y0 = margin, x1 = margin + wmm, y1 = margin + hmm;
    for (const [cx, cy, dx, dy] of [[x0, y0, -1, -1], [x1, y0, 1, -1], [x0, y1, -1, 1], [x1, y1, 1, 1]]) {
      doc.line(cx + dx * o, cy, cx + dx * (o + L), cy);
      doc.line(cx, cy + dy * o, cx, cy + dy * (o + L));
    }
    doc.setFontSize(6); doc.setTextColor(120);
    doc.text(`${EZ.doc.name} · page ${i + 1} · ${EZ.round(wmm, 1)} × ${EZ.round(hmm, 1)} mm + ${bleed} mm bleed`, margin, ph - 3);
  }
  busy.set('Saving PDF…', '', 100);
  EZ.download(doc.output('blob'), `${name}${print ? '-print' : ''}.pdf`);
  EZ.toast('PDF downloaded', { icon: 'check' });
}

/* ── SVG ── */
async function pageSVG(json) {
  await EZ.ensureAssets(EZ.assetIdsIn(JSON.stringify(json)));
  await EZ.loadFontsIn(json);
  const sc = new fabric.StaticCanvas(document.createElement('canvas'), { width: EZ.W(), height: EZ.H(), enableRetinaScaling: false });
  await new Promise(r => sc.loadFromJSON(json, r));
  let svg = sc.toSVG({ width: EZ.W(), height: EZ.H(), viewBox: { x: 0, y: 0, width: EZ.W(), height: EZ.H() } });
  sc.dispose();
  // inline stored images
  for (const id of EZ.assetIdsIn(svg)) {
    const b = await EZ.assetBlob(id);
    if (b) svg = svg.split('asset:' + id).join(await EZ.blobToDataURL(b));
  }
  const fams = new Set();
  const walk = o => { if (o.fontFamily) fams.add(o.fontFamily); (o.objects || []).forEach(walk); };
  (json.objects || []).forEach(walk);
  if (fams.size) svg = svg.replace('<defs>', `<defs>\n<style>${await embeddedFontCss([...fams])}</style>`);
  return svg;
}
// Inline the latin subsets of the used Google Fonts as data: URLs so the SVG renders anywhere.
const fontCssCache = new Map();
async function embeddedFontCss(families) {
  const parts = [];
  for (const fam of families) {
    if (!fontCssCache.has(fam)) fontCssCache.set(fam, (async () => {
      // reuse the exact @font-face rules the page already loaded
      const sheet = [...document.styleSheets].find(s => s.href?.startsWith('https://fonts.googleapis.com/'));
      let css = '';
      try {
        const txt = await fetch(sheet.href).then(r => r.text());
        const blocks = txt.split(/(?=\/\*\s*[\w-]+\s*\*\/)/);
        for (const b of blocks) {
          const subset = (b.match(/\/\*\s*([\w-]+)\s*\*\//) || [])[1];
          if (!['latin', 'latin-ext'].includes(subset) || !b.includes(`font-family: '${fam}'`)) continue;
          let rule = b.slice(b.indexOf('@font-face'));
          const url = (rule.match(/url\((https:[^)]+)\)/) || [])[1];
          if (!url) continue;
          const data = await fetch(url).then(r => r.blob()).then(EZ.blobToDataURL);
          css += rule.replace(url, data) + '\n';
        }
      } catch (e) { console.warn('font embed failed', fam, e); }
      return css;
    })());
    parts.push(await fontCssCache.get(fam));
  }
  return parts.join('');
}

/* ── single element ── */
EZ.exportObject = async o => {
  const m = o.type === 'image' ? Math.max(1, 1 / (o.scaleX || 1)) : 2;
  const url = o.toDataURL({ format: 'png', multiplier: m });
  EZ.download(await EZ.dataURLtoBlob(url), `${EZ.slug(EZ.doc.name)}-element.png`);
};

/* ── project files ── */
EZ.exportProject = async () => {
  EZ.commit.flush();
  EZ.storePage();
  const d = JSON.parse(JSON.stringify(EZ.doc));
  const assets = {};
  for (const id of EZ.assetIdsIn(JSON.stringify(d.pages))) {
    const b = await EZ.assetBlob(id);
    if (b) assets[id] = await EZ.blobToDataURL(b);
  }
  const file = { app: 'easel', version: 1, exported: new Date().toISOString(), doc: d, assets };
  EZ.download(new Blob([JSON.stringify(file)], { type: 'application/json' }), `${EZ.slug(d.name)}.easel`);
  EZ.toast('Project file downloaded', { icon: 'check' });
};
EZ.importProject = async file => {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'easel' || !data.doc?.pages) throw new Error('not an Easel project file');
    for (const [id, url] of Object.entries(data.assets || {})) {
      if (await EZ.db.get('assets', id).catch(() => null)) continue;
      const blob = await EZ.dataURLtoBlob(url);
      await EZ.db.put('assets', { id, blob, type: blob.type, upload: false, created: Date.now() });
    }
    const d = data.doc;
    await EZ.createDesign({ name: d.name, w: d.w, h: d.h, mm: d.mm, pages: d.pages.map(p => p.json) });
    EZ.toast('Opened ' + d.name, { icon: 'folder-open' });
  } catch (e) { EZ.toast('Could not open file: ' + e.message, { err: true, ms: 5000 }); }
};
})();
