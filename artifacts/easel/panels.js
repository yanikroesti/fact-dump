/* Easel — left rail + side panels */
(() => {
const EZ = window.EZ;
const { $, $$, h, icon } = EZ;

const RAIL = [
  ['templates', 'Design', 'layout-template'],
  ['elements', 'Elements', 'shapes'],
  ['text', 'Text', 'type'],
  ['uploads', 'Uploads', 'cloud-upload'],
  ['photos', 'Photos', 'image'],
  ['draw', 'Draw', 'pen-tool'],
  ['background', 'Background', 'palette'],
  ['layers', 'Layers', 'layers'],
];
const TITLES = {
  templates: 'Templates', elements: 'Elements', text: 'Text', uploads: 'Uploads', photos: 'Photos', draw: 'Draw',
  background: 'Background', layers: 'Position & layers', font: 'Font', effects: 'Effects', photo: 'Edit photo', qr: 'QR code', chart: 'Chart',
};
let current = null;
const state = { tplCat: 'all', tplQ: '', elQ: '', elKind: 'stickers', photoQ: '', photoSrc: 'picsum', fontQ: '' };

EZ.initPanels = () => {
  const rail = $('#rail');
  for (const [id, label, ic] of RAIL) {
    rail.append(h('button', { class: 'rail-btn', 'data-id': id, onclick: () => (current === id ? EZ.closePanel() : EZ.openPanel(id)) }, icon(ic), label));
  }
  $('#panelClose').onclick = () => EZ.closePanel();
};
EZ.openPanel = id => {
  if (current === 'draw' && id !== 'draw') EZ.setDraw(null);
  current = id;
  $('#panel').classList.remove('closed');
  $$('.rail-btn').forEach(b => b.classList.toggle('on', b.dataset.id === id));
  $('#panelTitle').textContent = TITLES[id] || '';
  $('#panelBody').scrollTop = 0;
  if (id === 'draw' && !EZ.isDrawing()) applyDraw(); // opening Draw picks up the pen
  render();
};
EZ.closePanel = () => {
  if (current === 'draw') EZ.setDraw(null);
  current = null;
  $('#panel').classList.add('closed');
  $$('.rail-btn').forEach(b => b.classList.remove('on'));
};
EZ.currentPanel = () => current;
EZ.refreshPanel = id => {
  if (!current || (id && id !== current)) return;
  if (document.activeElement && $('#panelBody').contains(document.activeElement) && document.activeElement.matches('input, textarea')) return;
  const st = $('#panelBody').scrollTop;
  render();
  $('#panelBody').scrollTop = st;
};
function render() {
  const body = $('#panelBody');
  body.innerHTML = '';
  const fn = PANELS[current];
  if (fn) fn(body);
}

/* drag helpers */
const draggable = (el, item) => {
  el.draggable = true;
  el.addEventListener('dragstart', e => { e.dataTransfer.setData('application/x-easel', JSON.stringify(item)); e.dataTransfer.effectAllowed = 'copy'; });
  return el;
};
EZ.insertItem = (it, at) => {
  switch (it.kind) {
    case 'shape': return EZ.addShape(it.id, at);
    case 'frame': return EZ.addFrame(it.id, at);
    case 'icon': return EZ.addIcon(it.id, { mono: it.mono, at });
    case 'photo': return EZ.addImage(it.url, { crossOrigin: 'anonymous', at, ezData: { credit: it.credit } });
    case 'asset': return EZ.addImage(EZ.assets.get(it.id), { at });
    case 'text': return EZ.addTextPreset(it.id, null, at);
    case 'combo': return EZ.addCombo(EZ.COMBOS[it.i], at);
    case 'chart': return EZ.addChart({ type: it.type }, at);
  }
};
const sec = (title, action) => h('div', { class: 'sec-title' }, title, action || null);
const tile = (inner, item, onclick, cls = '') => {
  const el = h('button', { class: 'tile ' + cls, onclick: onclick || (() => EZ.insertItem(item)), title: item?.title || '' });
  if (typeof inner === 'string') el.innerHTML = inner; else if (inner) el.append(inner);
  if (item) draggable(el, item);
  return el;
};

/* ═════ panels ═════ */
const PANELS = {};

/* ── templates ── */
PANELS.templates = body => {
  const q = h('input', { placeholder: 'Search templates', value: state.tplQ });
  q.addEventListener('input', () => { state.tplQ = q.value; list(); });
  body.append(h('div', { class: 'search' }, icon('search'), q));
  const chips = h('div', { class: 'chips' });
  for (const [id, label] of [['all', 'All'], ['social', 'Social'], ['slides', 'Slides'], ['print', 'Print'], ['school', 'School']]) {
    chips.append(h('button', { class: 'chip' + (state.tplCat === id ? ' on' : ''), onclick: () => { state.tplCat = id; EZ.refreshPanel('templates'); } }, label));
  }
  body.append(chips);
  const out = h('div');
  body.append(out);
  function list() {
    out.innerHTML = '';
    const ql = state.tplQ.toLowerCase();
    const all = EZ.TEMPLATES.filter(t => (state.tplCat === 'all' || t.cat === state.tplCat) && (!ql || (t.name + ' ' + t.cat).toLowerCase().includes(ql)));
    const same = t => Math.abs(t.w / t.h - EZ.W() / EZ.H()) < 0.01;
    const groups = [['For this size', all.filter(same)], ['Other sizes', all.filter(t => !same(t))]];
    for (const [title, items] of groups) {
      if (!items.length) continue;
      out.append(sec(title));
      const g = h('div', { class: 'tpl-grid' });
      items.forEach(t => g.append(tplCard(t, () => EZ.applyTemplate(t))));
      out.append(g);
    }
    if (!all.length) out.append(h('div', { class: 'empty' }, icon('search'), 'No templates match.'));
  }
  list();
};
function tplCard(t, onclick) {
  const th = h('div', { class: 'th' }, h('span', { class: 'spin' }));
  const el = h('button', { class: 'tpl', onclick }, th, h('div', { class: 'nm' }, t.name, h('small', {}, `${t.pages.length > 1 ? t.pages.length + ' pages · ' : ''}${t.mm ? t.mm.join(' × ') + ' mm' : t.w + ' × ' + t.h}`)));
  EZ.templateThumb(t).then(src => { th.innerHTML = ''; if (src) th.append(h('img', { src, alt: t.name })); }).catch(() => { th.innerHTML = ''; });
  return el;
}
EZ.tplCard = tplCard;
EZ.applyTemplate = async t => {
  const busy = EZ.busy('Loading template…');
  let pages;
  try { pages = await EZ.buildTemplate(t); } catch (e) { busy.close(); EZ.toast('Template failed to load', { err: true }); return; }
  busy.close();
  const same = Math.abs(t.w / t.h - EZ.W() / EZ.H()) < 0.01;
  if (!same) {
    const choice = await EZ.modal((m, close) => {
      m.append(h('h3', {}, t.name), h('p', {}, `This template is ${t.mm ? t.mm.join(' × ') + ' mm' : t.w + ' × ' + t.h + ' px'}, your design is ${EZ.W()} × ${EZ.H()} px.`),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: () => close('fit') }, 'Fit into this design'),
          h('button', { class: 'btn pri', onclick: () => close('new') }, 'Open as new design')));
    });
    if (!choice) return;
    if (choice === 'new') { EZ.createDesign({ name: t.name, w: t.w, h: t.h, mm: t.mm, pages }); return; }
  }
  const jsons = pages.map(p => (t.w === EZ.W() && t.h === EZ.H()) ? p : EZ.scaleJSON(p, t.w, t.h, EZ.W(), EZ.H()));
  const emptyPage = EZ.userObjects().length === 0;
  if (emptyPage) {
    EZ.doc.pages[EZ.pageIndex].json = jsons[0];
    await EZ.loadJSON(jsons[0]);
    EZ.commit();
    for (let i = 1; i < jsons.length; i++) await EZ.addPage(jsons[i], EZ.pageIndex + 1);
    if (jsons.length > 1) await EZ.gotoPage(EZ.pageIndex - (jsons.length - 1));
    EZ.renderPages?.(); EZ.renderProps?.();
    EZ.queueThumb();
  } else {
    const start = EZ.pageIndex + 1;
    for (let i = 0; i < jsons.length; i++) await EZ.addPage(jsons[i], start + i);
    await EZ.gotoPage(start);
    EZ.toast('Template added as a new page');
  }
};

/* ── elements ── */
const STICKERS = ['star', 'sparkles', 'fire', 'red-heart', 'party-popper', 'rocket', 'light-bulb', 'trophy', 'thumbs-up', 'check-mark-button',
  'warning', 'pushpin', 'books', 'graduation-cap', 'laptop', 'camera', 'sun', 'rainbow', 'balloon', 'wrapped-gift', 'birthday-cake', 'airplane',
  'globe-showing-europe-africa', 'money-bag', 'chart-increasing', 'hundred-points', 'smiling-face-with-sunglasses', 'face-with-tears-of-joy',
  'high-voltage', 'musical-notes', 'hot-beverage', 'pizza', 'four-leaf-clover', 'crown', 'gem-stone', 'megaphone', 'spiral-calendar',
  'alarm-clock', 'memo', 'magnifying-glass-tilted-left', 'puzzle-piece', 'glowing-star', 'cherry-blossom', 'sunflower', 'snowflake',
  'confetti-ball', 'clapping-hands', 'waving-hand', 'eyes', 'brain', 'backpack', 'pencil', 'triangular-ruler', 'test-tube', 'soccer-ball',
  'video-game', 'artist-palette', 'key', 'envelope', 'mobile-phone', 'cross-mark', 'red-question-mark', 'right-arrow', 'dizzy', 'collision',
  'rose', 'cactus', 'avocado', 'doughnut'].map(n => 'fluent-emoji-flat:' + n);
const ICONS = ['check', 'x', 'star', 'heart', 'arrow-right', 'phone', 'mail', 'map-pin', 'globe', 'calendar', 'clock', 'user', 'users',
  'instagram', 'youtube', 'facebook', 'linkedin', 'music', 'camera', 'shopping-bag', 'gift', 'zap', 'sun', 'moon', 'cloud', 'leaf',
  'coffee', 'book-open', 'graduation-cap', 'lightbulb', 'rocket', 'trophy', 'target', 'thumbs-up', 'message-circle', 'quote', 'sparkles',
  'flame', 'award', 'circle-check', 'badge-check', 'info', 'wifi', 'house', 'briefcase', 'pen-tool', 'palette', 'image'].map(n => 'lucide:' + n);
const SEARCH_SETS = {
  stickers: { label: 'Graphics', prefixes: 'fluent-emoji-flat,noto,twemoji,openmoji,streamline-emojis', mono: false },
  icons: { label: 'Icons', prefixes: 'lucide,ph,tabler,mdi,solar,material-symbols,ri', mono: true },
  logos: { label: 'Logos', prefixes: 'logos,skill-icons,devicon', mono: false },
};
// Tiles are filled once their icon set has been fetched (one batch request per set).
const iconTile = (id, mono) => {
  const img = h('img', { alt: id.split(':')[1] });
  const src = EZ.iconDataUrl(id, mono ? '#1b1a24' : null);
  if (src) img.src = src;
  else EZ.loadIcons([id]).then(() => { img.src = EZ.iconDataUrl(id, mono ? '#1b1a24' : null); });
  return tile(img, { kind: 'icon', id, mono, title: id.split(':')[1].replace(/-/g, ' ') }, null, 'pad');
};
const iconGrid = (ids, mono, cls = 'grid g5') => {
  const g = h('div', { class: cls });
  EZ.loadIcons(ids).then(() => ids.forEach(id => { if (EZ.iconSvg(id)) g.append(iconTile(id, mono)); }));
  return g;
};
PANELS.elements = body => {
  const q = h('input', { placeholder: 'Search icons, stickers, logos', value: state.elQ });
  const results = h('div');
  const browse = h('div');
  const run = EZ.debounce(() => { state.elQ = q.value.trim(); doSearch(); }, 350);
  q.addEventListener('input', run);
  q.addEventListener('keydown', e => { if (e.key === 'Enter') run.flush(); });
  body.append(h('div', { class: 'search' }, icon('search'), q), results, browse);

  async function doSearch() {
    results.innerHTML = '';
    browse.style.display = state.elQ ? 'none' : '';
    if (!state.elQ) return;
    const chips = h('div', { class: 'chips' });
    for (const [k, v] of Object.entries(SEARCH_SETS)) chips.append(h('button', { class: 'chip' + (state.elKind === k ? ' on' : ''), onclick: () => { state.elKind = k; doSearch(); } }, v.label));
    const grid = h('div', { class: 'grid g4' });
    results.append(chips, grid, h('p', { class: 'hint' }, 'Open-source icons via ', h('a', { href: 'https://iconify.design', target: '_blank', rel: 'noopener' }, 'Iconify'), '. Check each set’s licence before commercial use.'));
    grid.append(h('div', { class: 'empty', style: { gridColumn: '1/-1' } }, h('span', { class: 'spin' })));
    const set = SEARCH_SETS[state.elKind];
    try {
      const q = state.elQ;
      const r = await EZ.iconifyFetch(`/search?query=${encodeURIComponent(q)}&limit=96&prefixes=${set.prefixes}`);
      await EZ.loadIcons(r.icons || []);
      if (q !== state.elQ) return; // a newer search started meanwhile
      grid.innerHTML = '';
      const ids = (r.icons || []).filter(id => EZ.iconSvg(id));
      if (!ids.length) { grid.append(h('div', { class: 'empty', style: { gridColumn: '1/-1' } }, 'Nothing found. Try another word (English works best).')); return; }
      ids.forEach(id => {
        const pre = id.split(':')[0];
        const mono = set.mono && !r.collections?.[pre]?.palette;
        grid.append(iconTile(id, mono));
      });
    } catch { grid.innerHTML = ''; grid.append(h('div', { class: 'empty', style: { gridColumn: '1/-1' } }, 'Icon search is unavailable right now — try again in a minute.')); }
  }

  // browse view
  const showAll = state.showAllShapes;
  browse.append(sec('Shapes', h('button', { onclick: () => { state.showAllShapes = !showAll; EZ.refreshPanel('elements'); } }, showAll ? 'Less' : 'See all')));
  const sg = h('div', { class: 'grid g4' });
  EZ.SHAPES.slice(0, showAll ? 99 : 8).forEach(s => sg.append(tile(EZ.shapePreview(s), { kind: 'shape', id: s.id, title: s.label })));
  browse.append(sg);
  browse.append(sec('Lines & arrows'));
  const lg = h('div', { class: 'grid g4' });
  EZ.LINES.forEach(l => lg.append(tile(EZ.linePreview(l), { kind: 'shape', id: l.id, title: l.label })));
  browse.append(lg);
  browse.append(sec('Frames'), h('p', { class: 'hint', style: { margin: '-4px 0 8px' } }, 'Drop a photo onto a frame to fill it.'));
  const fg = h('div', { class: 'grid g4' });
  EZ.FRAMES.forEach(f => fg.append(tile(EZ.framePreview(f), { kind: 'frame', id: f.id, title: f.id + ' frame' })));
  browse.append(fg);
  browse.append(sec('Graphics', h('button', { onclick: () => { q.value = 'celebration'; state.elKind = 'stickers'; run.flush(); } }, 'Search more')));
  browse.append(iconGrid(STICKERS.slice(0, state.allStickers ? 99 : 30), false));
  if (!state.allStickers) browse.append(h('button', { class: 'big-btn soft', style: { marginTop: '8px', height: '34px' }, onclick: () => { state.allStickers = true; EZ.refreshPanel('elements'); } }, 'Show more'));
  browse.append(sec('Icons', h('button', { onclick: () => { q.value = 'arrow'; state.elKind = 'icons'; run.flush(); } }, 'Search more')));
  browse.append(iconGrid(ICONS, true));
  browse.append(sec('Charts'));
  const cg = h('div', { class: 'grid g5' });
  [['column', 'chart-column'], ['bar', 'chart-bar'], ['line', 'chart-line'], ['pie', 'chart-pie'], ['donut', 'circle']].forEach(([t, ic]) =>
    cg.append(tile(icon(ic, 'lg'), { kind: 'chart', type: t, title: t + ' chart' }, () => EZ.addChart({ type: t }).then(() => EZ.openPanel('chart')))));
  browse.append(cg);
  browse.append(sec('QR code'));
  browse.append(h('button', { class: 'big-btn soft', onclick: () => EZ.openPanel('qr') }, icon('qr-code'), 'Add a QR code'));
  if (state.elQ) doSearch();
};

/* ── text ── */
PANELS.text = body => {
  const k = 1;
  body.append(h('button', { class: 'big-btn', style: { marginBottom: '14px' }, onclick: () => EZ.addTextPreset('body') }, icon('type'), 'Add a text box'));
  body.append(sec('Default text styles'));
  const presets = [['heading', 'Add a heading', 26, 800], ['subheading', 'Add a subheading', 17, 700], ['body', 'Add a little bit of body text', 13, 400]];
  presets.forEach(([id, label, size, w]) => body.append(draggable(h('button', { class: 'txt-preset', style: { fontSize: size * k + 'px', fontWeight: w }, onclick: () => EZ.addTextPreset(id) }, label), { kind: 'text', id })));
  body.append(sec('Font combinations'));
  const g = h('div', { class: 'grid g2' });
  EZ.COMBOS.forEach((c, i) => {
    const el = h('button', { class: 'combo', onclick: () => EZ.addCombo(c) },
      ...c.lines.map(l => h('div', { style: { fontFamily: `'${l.f}'`, fontSize: Math.min(26, l.s * 0.2) + 'px', fontWeight: l.w, color: l.c, fontStyle: l.i ? 'italic' : 'normal', letterSpacing: (l.cs || 0) / 1000 + 'em', lineHeight: 1.05, whiteSpace: 'nowrap' } }, l.t)));
    g.append(draggable(el, { kind: 'combo', i }));
  });
  body.append(g);
  body.append(h('p', { class: 'hint', style: { marginTop: '14px' } }, 'Tip: press ', h('kbd', {}, 'T'), ' to add text. Double-click text to edit it; select a text box and use ', h('b', {}, 'Effects'), ' for shadows, outlines and neon.'));
};

/* ── uploads ── */
EZ.uploadFiles = async (files, at) => {
  const list = [...files].filter(f => f.type.startsWith('image/'));
  if (!list.length) return;
  const busy = list.length > 1 || list[0].size > 2e6 ? EZ.busy('Uploading…', `${list.length} image${list.length > 1 ? 's' : ''}`) : null;
  let i = 0;
  for (const f of list) {
    try {
      const a = await EZ.importImageBlob(f, { upload: true, name: f.name });
      await EZ.addImage(a.url, { at: at && { x: at.x + i * 30, y: at.y + i * 30 } });
    } catch (e) { EZ.toast(`${f.name}: ${e.message}`, { err: true }); }
    i++;
    busy?.set(null, `${i} / ${list.length}`, i / list.length * 100);
  }
  busy?.close();
  EZ.refreshPanel('uploads');
};
PANELS.uploads = async body => {
  const dz = h('div', { class: 'dropzone' }, icon('cloud-upload', 'lg'), h('div', { style: { margin: '8px 0 12px' } }, 'Drag images here or anywhere onto the page'),
    h('button', { class: 'big-btn', onclick: () => $('#fileIn').click() }, 'Upload files'));
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); EZ.uploadFiles(e.dataTransfer.files); });
  body.append(dz, h('p', { class: 'hint', style: { marginTop: '-4px' } }, 'Uploads are kept in this browser only. You can also paste images with ', h('kbd', {}, 'Ctrl'), ' ', h('kbd', {}, 'V'), '.'));
  const grid = h('div', { class: 'masonry', style: { marginTop: '12px' } });
  body.append(grid);
  const ups = await EZ.listUploads();
  if (!ups.length) { grid.replaceWith(h('div', { class: 'empty' }, icon('image'), 'No uploads yet.')); return; }
  for (const a of ups) {
    await EZ.ensureAssets([a.id]);
    const url = EZ.assets.get(a.id);
    const del = h('button', { class: 'lb', title: 'Remove from uploads', style: { position: 'absolute', top: '4px', right: '4px', background: 'rgba(255,255,255,.9)', borderRadius: '6px', padding: '3px', display: 'none' }, onclick: async e => {
      e.stopPropagation();
      if (!(await EZ.confirm('Remove this upload?', 'Designs that already use it keep working in this browser until you delete them.', 'Remove', true))) return;
      const rec = await EZ.db.get('assets', a.id);
      if (rec) { rec.upload = false; await EZ.db.put('assets', rec); }
      EZ.refreshPanel('uploads');
    } }, icon('x', 'sm'));
    const t = tile(h('img', { src: url, loading: 'lazy' }), { kind: 'asset', id: a.id, title: a.name }, null, 'photo');
    t.append(del);
    t.addEventListener('mouseenter', () => del.style.display = 'block');
    t.addEventListener('mouseleave', () => del.style.display = 'none');
    grid.append(t);
  }
};

/* ── photos ── */
const PHOTO_TOPICS = ['mountains', 'city', 'food', 'coffee', 'ocean', 'forest', 'flowers', 'people', 'office', 'school', 'animals', 'abstract', 'Zürich', 'night sky'];
const stripTags = s => { const d = document.createElement('div'); d.innerHTML = s || ''; return (d.textContent || '').trim(); };
let picsumPage = 1 + Math.floor(Math.random() * 20);
PANELS.photos = body => {
  const q = h('input', { placeholder: 'Search free photos (Wikimedia Commons)', value: state.photoQ });
  const out = h('div');
  const go = () => {
    state.photoQ = q.value.trim();
    $$('.chip', chips).forEach(c => c.classList.toggle('on', c.textContent === (state.photoQ || 'Featured')));
    load(true);
  };
  q.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  body.append(h('div', { class: 'search' }, icon('search'), q));
  const a = EZ.active();
  if (a?.ezType === 'frame' || a?.type === 'image') body.append(h('p', { class: 'hint', style: { background: 'var(--accent-bg)', padding: '8px 10px', borderRadius: '8px', color: 'var(--accent-ink)' } }, a.ezType === 'frame' ? 'Click a photo to put it into the selected frame.' : 'Click a photo to add it. Drop it onto a frame to fill the frame.'));
  const chips = h('div', { class: 'chips' });
  chips.append(h('button', { class: 'chip' + (!state.photoQ ? ' on' : ''), onclick: () => { q.value = ''; go(); } }, 'Featured'));
  PHOTO_TOPICS.forEach(t => chips.append(h('button', { class: 'chip' + (state.photoQ === t ? ' on' : ''), onclick: () => { q.value = t; go(); } }, t)));
  body.append(chips, out);
  let cont = null, busy = false;
  const grid = h('div', { class: 'masonry' });
  const more = h('button', { class: 'big-btn soft', style: { marginTop: '6px', height: '36px' }, onclick: () => load(false) }, 'Load more');
  out.append(grid, more, h('p', { class: 'hint', style: { marginTop: '10px' } }, 'Featured photos: Unsplash via Lorem Picsum. Search: Wikimedia Commons — mostly CC licences; hover a photo for the author and licence, and credit them where required.'));
  async function load(reset) {
    if (busy) return;
    busy = true;
    if (reset) { grid.innerHTML = ''; cont = null; }
    more.disabled = true; more.textContent = 'Loading…';
    try {
      if (!state.photoQ) {
        const list = await fetch(`https://picsum.photos/v2/list?page=${picsumPage++}&limit=24`).then(r => r.json());
        for (const p of list) {
          const th = Math.round(300 * p.height / p.width);
          const w = Math.min(1920, p.width), hh = Math.round(w * p.height / p.width);
          grid.append(photoTile(`https://picsum.photos/id/${p.id}/300/${th}`, `https://picsum.photos/id/${p.id}/${w}/${hh}`, `${p.author} · Unsplash`, 300, th));
        }
      } else {
        const params = new URLSearchParams({
          action: 'query', format: 'json', origin: '*', generator: 'search', gsrsearch: `filetype:bitmap ${state.photoQ}`,
          gsrnamespace: '6', gsrlimit: '24', prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: '400',
          iiextmetadatafilter: 'Artist|LicenseShortName',
        });
        if (cont) params.set('gsroffset', cont);
        const r = await fetch('https://commons.wikimedia.org/w/api.php?' + params).then(r => r.json());
        cont = r.continue?.gsroffset || null;
        const pages = Object.values(r.query?.pages || {}).sort((a, b) => a.index - b.index);
        if (!pages.length && reset) grid.append(h('div', { class: 'empty' }, 'No photos found.'));
        for (const p of pages) {
          const ii = p.imageinfo?.[0];
          if (!ii?.thumburl) continue;
          const thumb = ii.thumburl.split('?')[0];
          const big = ii.width > 1280 ? thumb.replace(/\/\d+px-/, '/1280px-') : ii.url;
          const md = ii.extmetadata || {};
          const credit = `${stripTags(md.Artist?.value) || 'Unknown'} · ${md.LicenseShortName?.value || 'Wikimedia'}`;
          grid.append(photoTile(thumb, big, credit, ii.thumbwidth, ii.thumbheight));
        }
      }
    } catch (e) { console.warn(e); if (reset) grid.append(h('div', { class: 'empty' }, 'Could not load photos — are you offline?')); }
    busy = false;
    more.disabled = !!state.photoQ && !cont;
    more.textContent = more.disabled ? 'No more results' : 'Load more';
  }
  load(true);
};
function photoTile(thumb, url, credit, w, hh) {
  const el = tile(h('img', { src: thumb, loading: 'lazy', alt: '', width: w, height: hh, style: { background: 'var(--paper3)' } }), { kind: 'photo', url, credit, title: credit }, null, 'photo');
  el.append(h('span', { class: 'credit' }, credit));
  return el;
}

/* ── draw ── */
const drawState = { tool: 'pen', color: '#1b1a24', size: 6 };
const TOOLS = { pen: { label: 'Pen', ic: 'pencil', alpha: 1, mult: 1 }, marker: { label: 'Marker', ic: 'paintbrush', alpha: 1, mult: 2.5 }, highlighter: { label: 'Highlighter', ic: 'highlighter', alpha: 0.35, mult: 5 } };
const applyDraw = () => EZ.setDraw({ tool: drawState.tool, color: drawState.color, width: drawState.size * TOOLS[drawState.tool].mult * Math.max(0.5, EZ.k()), alpha: TOOLS[drawState.tool].alpha });
PANELS.draw = body => {
  const seg = h('div', { class: 'seg', style: { marginBottom: '14px' } });
  for (const [id, t] of Object.entries(TOOLS)) seg.append(h('button', { class: drawState.tool === id ? 'on' : '', onclick: () => { drawState.tool = id; applyDraw(); EZ.refreshPanel('draw'); } }, icon(t.ic, 'sm'), t.label));
  body.append(seg);
  body.append(h('div', { class: 'lbl' }, 'Colour'));
  const sw = h('div', { class: 'swatches', style: { marginBottom: '14px' } });
  ['#1b1a24', '#ffffff', '#ff3131', '#ff5c35', '#ffde59', '#00bf63', '#0cc0df', '#5271ff', '#8c52ff', '#ff66c4', '#8b4513', '#737373', '#c1ff72'].forEach(c =>
    sw.append(h('button', { class: 'sw' + (drawState.color === c ? ' on' : ''), style: { background: c }, onclick: () => { drawState.color = c; applyDraw(); EZ.refreshPanel('draw'); } })));
  const custom = h('button', { class: 'sw add', title: 'Custom colour' }, icon('plus'));
  custom.onclick = () => EZ.colorPop(custom, drawState.color, (v, fin) => { if (v) { drawState.color = v; applyDraw(); if (fin) EZ.refreshPanel('draw'); } });
  sw.append(custom);
  body.append(sw);
  const range = h('input', { type: 'range', min: 1, max: 40, value: drawState.size });
  const val = h('span', {}, drawState.size);
  range.addEventListener('input', () => { drawState.size = +range.value; val.textContent = range.value; applyDraw(); });
  body.append(h('div', { class: 'field' }, h('label', {}, 'Size', val), range));
  const on = EZ.isDrawing();
  body.append(h('button', { class: 'big-btn' + (on ? ' soft' : ''), onclick: () => { if (EZ.isDrawing()) EZ.setDraw(null); else applyDraw(); EZ.refreshPanel('draw'); } }, icon(on ? 'mouse-pointer-2' : 'pen-tool'), on ? 'Stop drawing (Esc)' : 'Start drawing'));
  body.append(h('p', { class: 'hint', style: { marginTop: '12px' } }, 'Each stroke becomes its own element you can move, recolour or delete.'));
};
EZ.onDrawChange = () => { if (current === 'draw') EZ.refreshPanel('draw'); EZ.renderProps?.(); };

/* ── background ── */
PANELS.background = body => {
  const bg = EZ.bgRect();
  const fill = bg?.fill;
  const cur = h('button', { class: 'cb cb-color', style: { width: '44px', height: '44px' } }, h('i', { class: 'dot', style: { width: '34px', height: '34px', borderRadius: '9px', background: EZ.fillCss(fill) } }));
  cur.onclick = () => EZ.colorPop(cur, typeof fill === 'string' ? fill : null, (v) => EZ.setBackground(v), { gradients: true, title: 'Background colour' });
  body.append(sec('Background colour'), h('div', { class: 'row', style: { marginBottom: '12px' } }, cur, h('span', { class: 'hint' }, typeof fill === 'string' ? fill : 'Gradient')));
  const g = h('div', { class: 'swatches', style: { marginBottom: '8px' } });
  EZ.PALETTE.forEach(c => g.append(h('button', { class: 'sw sq' + (fill === c ? ' on' : ''), style: { background: c }, onclick: () => { EZ.setBackground(c); EZ.refreshPanel('background'); } })));
  body.append(g, sec('Gradients'));
  const gg = h('div', { class: 'swatches' });
  EZ.GRADIENTS.forEach(([a, b], i) => {
    const spec = { gradient: [a, b], type: i % 3 === 2 ? 'radial' : 'linear' };
    gg.append(h('button', { class: 'sw sq', style: { background: spec.type === 'radial' ? `radial-gradient(${a}, ${b})` : `linear-gradient(135deg, ${a}, ${b})` }, onclick: () => { EZ.setBackground(spec); EZ.refreshPanel('background'); } }));
  });
  body.append(gg);
  body.append(sec('Background image'));
  const bi = EZ.bgImage();
  if (bi) {
    let src = ''; try { src = EZ.origEl(bi).src; } catch {}
    body.append(h('div', { class: 'tile photo', style: { aspectRatio: EZ.W() / EZ.H(), marginBottom: '8px' } }, h('img', { src })),
      h('button', { class: 'big-btn soft', onclick: () => EZ.removeBackgroundImage() }, icon('trash-2'), 'Remove background image'));
  } else {
    body.append(h('p', { class: 'hint' }, 'Select any photo on the page and choose ', h('b', {}, 'Set as background'), ' in its menu (…), or upload one here.'),
      h('button', { class: 'big-btn soft', style: { marginTop: '8px' }, onclick: () => {
        const inp = h('input', { type: 'file', accept: 'image/*' });
        inp.onchange = async () => { const f = inp.files[0]; if (!f) return; const a = await EZ.importImageBlob(f, { upload: true, name: f.name }); await EZ.setBackgroundImage(a.url); };
        inp.click();
      } }, icon('image-plus'), 'Upload background image'));
  }
};

/* ── layers / position ── */
EZ.describe = o => {
  if (o.type === 'textbox') return { label: o.text.split('\n')[0].slice(0, 40) || 'Text', kind: 'Text', icon: 'type' };
  if (o.ezType === 'frame') return { label: o.ezData?.filled ? 'Photo in frame' : 'Empty frame', kind: 'Frame', icon: 'frame' };
  if (o.type === 'image') return { label: o.ezData?.cutout ? 'Cut-out photo' : 'Photo', kind: 'Image', icon: 'image' };
  if (o.ezType === 'icon' || o.ezType === 'sticker') return { label: (o.ezData?.icon || '').split(':')[1]?.replace(/-/g, ' ') || 'Graphic', kind: o.ezType === 'icon' ? 'Icon' : 'Graphic', icon: 'sparkles' };
  if (o.ezType === 'qr') return { label: o.ezData?.text?.slice(0, 40) || 'QR code', kind: 'QR code', icon: 'qr-code' };
  if (o.ezType === 'chart') return { label: (o.ezData?.title || o.ezData?.type || 'Chart'), kind: 'Chart', icon: 'chart-column' };
  if (o.type === 'ezLine') return { label: o.endHead !== 'none' ? 'Arrow' : 'Line', kind: 'Line', icon: 'move-horizontal' };
  if (o.ezType === 'draw' || (o.type === 'path' && !o.ezType)) return { label: 'Drawing', kind: 'Draw', icon: 'pen-tool' };
  if (o.type === 'group') return { label: `Group (${o.size()})`, kind: 'Group', icon: 'group' };
  const s = EZ.SHAPES.find(x => x.id === o.ezData?.shape);
  return { label: s?.label || (o.type === 'circle' || o.type === 'ellipse' ? 'Circle' : o.type === 'rect' ? 'Rectangle' : 'Shape'), kind: 'Shape', icon: 'square' };
};
PANELS.layers = body => {
  const cv = EZ.cv, sel = EZ.selected();
  const btn = (ic, label, fn, dis) => h('button', { class: 'cb', style: { justifyContent: 'flex-start', border: '1px solid var(--line)', height: '36px' }, disabled: !!dis, onclick: fn }, icon(ic), label);
  body.append(sec('Arrange'));
  const g = h('div', { class: 'grid g2' });
  g.append(btn('arrow-up', 'Forward', () => EZ.arrange('forward'), !sel.length), btn('arrow-down', 'Backward', () => EZ.arrange('backward'), !sel.length),
    btn('bring-to-front', 'To front', () => EZ.arrange('front'), !sel.length), btn('send-to-back', 'To back', () => EZ.arrange('back'), !sel.length));
  body.append(g);
  body.append(sec(sel.length > 1 ? 'Align elements' : 'Align to page'));
  const al = h('div', { class: 'grid g3' });
  const alignFn = how => sel.length > 1 ? EZ.alignSelection(how) : EZ.alignPage(how);
  [['align-start-vertical', 'Left', 'left'], ['align-center-vertical', 'Centre', 'center'], ['align-end-vertical', 'Right', 'right'],
    ['align-start-horizontal', 'Top', 'top'], ['align-center-horizontal', 'Middle', 'middle'], ['align-end-horizontal', 'Bottom', 'bottom']].forEach(([ic, l, how]) => al.append(btn(ic, l, () => alignFn(how), !sel.length)));
  body.append(al);
  if (sel.length > 2) {
    const d = h('div', { class: 'grid g2', style: { marginTop: '8px' } });
    d.append(btn('align-horizontal-distribute-center', 'Space horizontally', () => EZ.distribute('h')), btn('align-vertical-distribute-center', 'Space vertically', () => EZ.distribute('v')));
    body.append(d);
  }
  if (sel.length === 1) {
    const o = sel[0], b = o.getBoundingRect(true, true);
    const num = (label, val, set) => {
      const inp = h('input', { class: 'inp', type: 'number', value: Math.round(val) });
      inp.addEventListener('change', () => { set(+inp.value || 0); o.setCoords(); cv.requestRenderAll(); EZ.commit(); });
      return h('div', {}, h('div', { class: 'lbl' }, label), inp);
    };
    body.append(sec('Size & position'));
    const grid = h('div', { class: 'grid g2' });
    grid.append(
      num('Width', o.getScaledWidth(), v => { if (o.type === 'textbox') o.set('width', v / o.scaleX); else o.scaleToWidth(Math.max(1, v)); }),
      num('Height', o.getScaledHeight(), v => { if (o.type !== 'textbox') o.scaleToHeight(Math.max(1, v)); }),
      num('X', b.left, v => { o.left += v - b.left; }),
      num('Y', b.top, v => { o.top += v - b.top; }),
      num('Rotate °', o.angle, v => { o.rotate(v); }),
    );
    body.append(grid);
  }
  body.append(sec('Layers', h('span', { class: 'hint' }, 'drag to reorder')));
  const objs = EZ.userObjects().slice().reverse();
  if (!objs.length) { body.append(h('div', { class: 'empty' }, icon('layers'), 'This page is empty.')); return; }
  const list = h('div');
  let dragFrom = null;
  objs.forEach(o => {
    const d = EZ.describe(o);
    const on = sel.includes(o);
    const thumb = h('div', { class: 'lt' });
    try {
      if (o.type === 'textbox') thumb.append(icon('type', 'sm'));
      else thumb.style.backgroundImage = `url(${o.toDataURL({ multiplier: Math.min(1, 80 / Math.max(o.getScaledWidth(), o.getScaledHeight(), 1)) / EZ.view.z * EZ.view.z, format: 'png' })})`;
    } catch { thumb.append(icon(d.icon, 'sm')); }
    const row = h('div', { class: 'layer' + (on ? ' on' : '') + (o.visible ? '' : ' hid'), draggable: true },
      h('span', { class: 'grip' }, icon('grip-vertical', 'sm')), thumb,
      h('div', { class: 'ln' }, d.label, h('small', {}, d.kind)),
      h('button', { class: 'lb', title: o.visible ? 'Hide' : 'Show', onclick: e => { e.stopPropagation(); o.visible = !o.visible; if (!o.visible && cv.getActiveObject() === o) cv.discardActiveObject(); cv.requestRenderAll(); EZ.commit(); EZ.refreshPanel('layers'); } }, icon(o.visible ? 'eye' : 'eye-off', 'sm')),
      h('button', { class: 'lb', title: o.locked ? 'Unlock' : 'Lock', onclick: e => { e.stopPropagation(); EZ.setLocked(o, !o.locked); EZ.refreshPanel('layers'); } }, icon(o.locked ? 'lock' : 'lock-open', 'sm')));
    row.addEventListener('click', e => {
      if (!o.visible) return;
      if (e.shiftKey && cv.getActiveObject()) {
        const cur = EZ.selected();
        const set = cur.includes(o) ? cur.filter(x => x !== o) : [...cur, o];
        cv.discardActiveObject();
        if (set.length === 1) cv.setActiveObject(set[0]); else if (set.length) cv.setActiveObject(new fabric.ActiveSelection(set, { canvas: cv }));
      } else cv.setActiveObject(o);
      cv.requestRenderAll();
    });
    row.addEventListener('dragstart', e => { dragFrom = o; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'layer'); });
    row.addEventListener('dragover', e => { if (!dragFrom) return; e.preventDefault(); row.classList.add('drag-over'); });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation(); row.classList.remove('drag-over');
      if (!dragFrom || dragFrom === o) return;
      cv.discardActiveObject();
      const all = cv.getObjects();
      // insert above the target in stacking order (list is top-first)
      let idx = all.indexOf(o);
      if (all.indexOf(dragFrom) > idx) idx += 1;
      cv.moveTo(dragFrom, idx);
      EZ.ensureBg();
      cv.requestRenderAll(); EZ.commit(); dragFrom = null;
      EZ.refreshPanel('layers');
    });
    list.append(row);
  });
  body.append(list);
};

/* ── font picker ── */
PANELS.font = body => {
  const sel = EZ.selected().filter(o => o.type === 'textbox');
  const cur = sel[0]?.fontFamily;
  const q = h('input', { placeholder: 'Search fonts', value: state.fontQ });
  body.append(h('div', { class: 'search' }, icon('search'), q));
  const list = h('div');
  body.append(list);
  const draw = () => {
    list.innerHTML = '';
    const ql = q.value.toLowerCase();
    let lastCat = '';
    for (const [f, cat] of EZ.FONTS) {
      if (ql && !f.toLowerCase().includes(ql)) continue;
      if (cat !== lastCat) { list.append(sec(cat)); lastCat = cat; }
      list.append(h('button', {
        class: 'txt-preset', style: { fontFamily: `'${f}'`, fontSize: '17px', padding: '9px 12px', marginBottom: '4px', borderColor: f === cur ? 'var(--accent)' : '', background: f === cur ? 'var(--accent-bg)' : '' },
        onclick: async () => { await EZ.setTextProp('fontFamily', f); EZ.refreshPanel('font'); },
      }, f));
    }
  };
  q.addEventListener('input', () => { state.fontQ = q.value; draw(); });
  draw();
  if (!sel.length) body.prepend(h('p', { class: 'hint' }, 'Select a text box first.'));
};

/* ── text effects ── */
PANELS.effects = body => {
  const t = EZ.selected().find(o => o.type === 'textbox');
  if (!t) { body.append(h('div', { class: 'empty' }, icon('sparkles'), 'Select a text box to add effects.')); return; }
  const eff = t.effect || { type: 'none', amount: 50 };
  const prev = {
    none: {}, shadow: { textShadow: '2px 2px 3px rgba(0,0,0,.45)' }, lift: { textShadow: '0 4px 8px rgba(0,0,0,.35)' },
    hollow: { color: 'transparent', WebkitTextStroke: '1.5px #1b1a24' }, outline: { color: '#1b1a24', WebkitTextStroke: '5px #ff5c35', paintOrder: 'stroke fill' },
    echo: { textShadow: '4px 4px 0 rgba(27,26,36,.45)' }, neon: { color: '#ff66c4', textShadow: '0 0 6px #ff66c4, 0 0 12px #ff66c4' },
    highlight: { background: '#ffde59', padding: '0 4px' }, glitch: { textShadow: '-3px 0 #0cc0df', WebkitTextStroke: '0.5px #ff3fa4' },
  };
  const g = h('div', { class: 'grid g3' });
  EZ.EFFECTS.forEach(e => g.append(h('button', {
    class: 'tile', style: { aspectRatio: '1.1', flexDirection: 'column', gap: '4px', borderColor: eff.type === e.id ? 'var(--accent)' : '', background: eff.type === e.id ? 'var(--accent-bg)' : '' },
    onclick: () => { EZ.selected().filter(o => o.type === 'textbox').forEach(o => EZ.applyEffect(o, e.id)); EZ.commit(); EZ.refreshPanel('effects'); EZ.renderProps(); },
  }, h('span', { style: { fontFamily: 'Archivo Black', fontSize: '30px', color: '#1b1a24', ...prev[e.id] } }, 'Ag'), h('small', { style: { fontWeight: 600, fontSize: '11px' } }, e.label))));
  body.append(g);
  if (eff.type !== 'none') {
    body.append(sec('Settings'));
    if (!['lift', 'hollow', 'highlight'].includes(eff.type) || eff.type === 'highlight') {
      if (eff.type !== 'lift' && eff.type !== 'hollow') {
        const cbtn = h('button', { class: 'cb cb-color', style: { border: '1px solid var(--line)' } }, h('i', { class: 'dot', style: { background: eff.color || '#000' } }));
        cbtn.onclick = () => EZ.colorPop(cbtn, eff.color, (v, fin) => { if (!v) return; EZ.selected().filter(o => o.type === 'textbox').forEach(o => EZ.applyEffect(o, eff.type, { color: v })); if (fin) { EZ.commit(); EZ.refreshPanel('effects'); } });
        body.append(h('div', { class: 'row', style: { marginBottom: '12px' } }, cbtn, h('span', { class: 'lbl', style: { margin: 0 } }, 'Colour')));
      }
    }
    if (eff.type !== 'highlight') {
      const r = h('input', { type: 'range', min: 0, max: 100, value: eff.amount ?? 50 });
      const v = h('span', {}, eff.amount ?? 50);
      r.addEventListener('input', () => { v.textContent = r.value; EZ.selected().filter(o => o.type === 'textbox').forEach(o => EZ.applyEffect(o, eff.type, { amount: +r.value })); });
      r.addEventListener('change', () => EZ.commit());
      body.append(h('div', { class: 'field' }, h('label', {}, 'Intensity', v), r));
    }
  }
};

/* ── photo editing ── */
const CSS_PREVIEW = { none: '', bw: 'grayscale(1)', noir: 'grayscale(1) contrast(1.35)', sepia: 'sepia(1)', vintage: 'sepia(.5) contrast(1.1) saturate(.8)', polaroid: 'contrast(1.1) saturate(1.2) hue-rotate(-8deg)',
  kodachrome: 'contrast(1.15) saturate(1.3)', technicolor: 'saturate(1.7) contrast(1.1)', vivid: 'saturate(1.35) contrast(1.1)', warm: 'sepia(.25) saturate(1.2)', cool: 'hue-rotate(12deg) saturate(.9) brightness(1.03)', fade: 'contrast(.8) brightness(1.06) saturate(.75)' };
PANELS.photo = body => {
  const o = EZ.active();
  if (!o || o.type !== 'image') { body.append(h('div', { class: 'empty' }, icon('image'), 'Select a photo to edit it.')); return; }
  const s = EZ.photoSettings(o);
  let src = ''; try { src = EZ.origEl(o).src; } catch {}
  body.append(h('button', { class: 'big-btn', style: { marginBottom: '8px' }, onclick: () => EZ.removeImageBg(o) }, icon('wand-sparkles'), 'Remove background'),
    h('p', { class: 'hint', style: { marginBottom: '8px' } }, 'Runs on your device with the RMBG-1.4 model (about 44 MB, downloaded once). Nothing is uploaded.'));
  const row = h('div', { class: 'grid g3' });
  row.append(
    h('button', { class: 'cb', style: { border: '1px solid var(--line)' }, onclick: () => EZ.cropImage(o) }, icon('crop'), 'Crop'),
    h('button', { class: 'cb', style: { border: '1px solid var(--line)' }, onclick: () => EZ.flip('x') }, icon('flip-horizontal-2'), 'Flip'),
    h('button', { class: 'cb', style: { border: '1px solid var(--line)' }, onclick: () => EZ.replacePhotoDialog(o) }, icon('refresh-cw'), 'Replace'));
  body.append(row);
  body.append(sec('Filters'));
  const g = h('div', { class: 'grid g3' });
  EZ.PHOTO_PRESETS.forEach(p => {
    const on = s.preset === p.id;
    g.append(h('button', {
      class: 'tile photo', style: { aspectRatio: '1', borderColor: on ? 'var(--accent)' : '', boxShadow: on ? '0 0 0 2px var(--accent)' : '' },
      onclick: () => { EZ.setPhoto(o, { preset: p.id }); EZ.commit(); EZ.refreshPanel('photo'); },
    }, h('img', { src, style: { filter: CSS_PREVIEW[p.id] || '' }, crossOrigin: o.crossOrigin || undefined }), h('span', { class: 'credit', style: { opacity: 1, textAlign: 'center', fontWeight: 600 } }, p.label)));
  });
  body.append(g);
  body.append(sec('Adjust', h('button', { onclick: () => { EZ.setPhoto(o, { adj: Object.fromEntries(EZ.ADJUST.map(a => [a.id, 0])) }); EZ.commit(); EZ.refreshPanel('photo'); } }, 'Reset')));
  const apply = EZ.debounce((id, v) => EZ.setPhoto(o, { adj: { [id]: v } }), 60);
  EZ.ADJUST.forEach(a => {
    const val = s.adj[a.id] || 0;
    const r = h('input', { type: 'range', min: a.min, max: a.max, value: val });
    const v = h('span', {}, val);
    r.addEventListener('input', () => { v.textContent = r.value; apply(a.id, +r.value); });
    r.addEventListener('change', () => { apply.flush(a.id, +r.value); EZ.commit(); });
    r.addEventListener('dblclick', () => { r.value = 0; v.textContent = 0; apply.flush(a.id, 0); EZ.commit(); });
    body.append(h('div', { class: 'field' }, h('label', {}, a.label, v), r));
  });
  body.append(h('button', { class: 'big-btn soft', style: { marginTop: '6px' }, onclick: () => EZ.setAsBackground(o) }, icon('image'), 'Set as page background'));
};
EZ.replacePhotoDialog = o => {
  const inp = h('input', { type: 'file', accept: 'image/*' });
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    const a = await EZ.importImageBlob(f, { upload: true, name: f.name });
    await EZ.replaceImage(o, a.url, { ezData: o.ezType === 'frame' ? { filled: true } : undefined });
    EZ.refreshPanel('uploads');
  };
  inp.click();
};
EZ.setAsBackground = async o => {
  let src = o.getSrc();
  if (typeof src === 'string' && src.startsWith('asset:')) src = EZ.assets.get(src.slice(6));
  await EZ.setBackgroundImage(src, o.crossOrigin);
  EZ.cv.remove(o);
  EZ.cv.requestRenderAll();
};

/* ── QR code ── */
PANELS.qr = body => {
  const a = EZ.active();
  const editing = a?.ezType === 'qr';
  const d = { ...(editing ? a.ezData : { text: 'https://', fg: '#1b1a24', bg: '#ffffff', style: 'square', ecc: 'M' }) };
  const ta = h('textarea', { class: 'inp', rows: 3, placeholder: 'Website, text, phone number…' }, d.text);
  body.append(h('div', { class: 'field' }, h('label', {}, 'Content'), ta));
  const kinds = h('div', { class: 'chips' });
  [['Link', 'https://'], ['E-mail', 'mailto:name@example.ch'], ['Phone', 'tel:+41790000000'], ['Wi-Fi', 'WIFI:T:WPA;S:NetworkName;P:password;;']].forEach(([l, v]) =>
    kinds.append(h('button', { class: 'chip', onclick: () => { ta.value = v; ta.focus(); } }, l)));
  body.append(kinds);
  const colorBtn = (key, label) => {
    const b = h('button', { class: 'cb cb-color', style: { border: '1px solid var(--line)' } }, h('i', { class: 'dot', style: { background: d[key] || '#fff' } }));
    b.onclick = () => EZ.colorPop(b, d[key], (v, fin) => { d[key] = v || (key === 'bg' ? null : '#000000'); b.firstChild.style.background = d[key] || '#fff'; if (fin && editing) update(); }, { none: key === 'bg' });
    return h('div', { class: 'row' }, b, h('span', { class: 'lbl', style: { margin: 0 } }, label));
  };
  body.append(h('div', { class: 'grid g2', style: { marginBottom: '12px' } }, colorBtn('fg', 'Code'), colorBtn('bg', 'Background')));
  const seg = h('div', { class: 'seg', style: { marginBottom: '14px' } });
  [['square', 'Squares'], ['dots', 'Dots']].forEach(([id, l]) => seg.append(h('button', { class: d.style === id ? 'on' : '', onclick: e => { d.style = id; $$('button', seg).forEach(b => b.classList.remove('on')); e.currentTarget.classList.add('on'); if (editing) update(); } }, l)));
  body.append(seg);
  const update = () => {
    d.text = ta.value.trim();
    if (!d.text) { EZ.toast('Enter some content first'); return; }
    if (editing) { const cur = EZ.active(); if (cur?.ezType === 'qr') EZ.swapSpecial(cur, EZ.makeQR(d)); }
    else EZ.addQR(d);
    EZ.refreshPanel('qr');
  };
  body.append(h('button', { class: 'big-btn', onclick: update }, icon('qr-code'), editing ? 'Update QR code' : 'Add QR code'));
  body.append(h('p', { class: 'hint', style: { marginTop: '12px' } }, 'Keep good contrast (dark code on light background) and test with your phone before printing. For tracked, editable short links use ', h('a', { href: 'qr-generator.html', target: '_blank' }, 'QR Studio'), '.'));
};

/* ── chart ── */
PANELS.chart = body => {
  const a = EZ.active();
  const editing = a?.ezType === 'chart';
  const d = JSON.parse(JSON.stringify(editing ? a.ezData : { type: 'column', title: '', rows: [['Mon', 12], ['Tue', 19], ['Wed', 8], ['Thu', 15], ['Fri', 22]], text: '#1b1a24', colors: EZ.CHART_COLORS.slice(), mono: false, values: true, font: 'Inter' }));
  const push = EZ.debounce(async () => {
    if (!editing) return;
    const cur = EZ.active();
    if (cur?.ezType !== 'chart') return;
    await EZ.loadFont(d.font, 700);
    EZ.swapSpecial(cur, EZ.makeChart(d));
  }, 300);
  const seg = h('div', { class: 'seg', style: { marginBottom: '12px' } });
  [['column', 'chart-column'], ['bar', 'chart-bar'], ['line', 'chart-line'], ['pie', 'chart-pie'], ['donut', 'circle']].forEach(([t, ic]) =>
    seg.append(h('button', { class: d.type === t ? 'on' : '', title: t, onclick: e => { d.type = t; $$('button', seg).forEach(b => b.classList.remove('on')); e.currentTarget.classList.add('on'); push(); } }, icon(ic, 'sm'))));
  body.append(seg);
  const title = h('input', { class: 'inp', value: d.title || '', placeholder: 'Chart title (optional)' });
  title.addEventListener('input', () => { d.title = title.value; push(); });
  body.append(h('div', { class: 'field' }, h('label', {}, 'Title'), title));
  body.append(h('div', { class: 'lbl' }, 'Data'));
  const table = h('div');
  const drawRows = () => {
    table.innerHTML = '';
    d.rows.forEach((r, i) => {
      const l = h('input', { class: 'inp', value: r[0], placeholder: 'Label' });
      const v = h('input', { class: 'inp', type: 'number', value: r[1], style: { width: '90px', flex: 'none' } });
      l.addEventListener('input', () => { d.rows[i][0] = l.value; push(); });
      v.addEventListener('input', () => { d.rows[i][1] = +v.value; push(); });
      table.append(h('div', { class: 'row', style: { marginBottom: '6px' } },
        h('span', { style: { width: '10px', height: '28px', borderRadius: '3px', flex: 'none', background: d.mono ? d.colors[0] : d.colors[i % d.colors.length] } }), l, v,
        h('button', { class: 'lb', title: 'Remove row', onclick: () => { d.rows.splice(i, 1); drawRows(); push(); } }, icon('x', 'sm'))));
    });
  };
  drawRows();
  body.append(table, h('button', { class: 'big-btn soft', style: { height: '34px', marginBottom: '14px' }, onclick: () => { d.rows.push(['New', 10]); drawRows(); push(); } }, icon('plus', 'sm'), 'Add row'));
  const main = h('button', { class: 'cb cb-color', style: { border: '1px solid var(--line)' } }, h('i', { class: 'dot', style: { background: d.colors[0] } }));
  main.onclick = () => EZ.colorPop(main, d.colors[0], (v, fin) => { if (!v) return; d.colors[0] = v; main.firstChild.style.background = v; if (fin) { drawRows(); push(); } });
  const txt = h('button', { class: 'cb cb-color', style: { border: '1px solid var(--line)' } }, h('i', { class: 'dot', style: { background: d.text } }));
  txt.onclick = () => EZ.colorPop(txt, d.text, (v, fin) => { if (!v) return; d.text = v; txt.firstChild.style.background = v; if (fin) push(); });
  body.append(h('div', { class: 'grid g2', style: { marginBottom: '12px' } }, h('div', { class: 'row' }, main, h('span', { class: 'lbl', style: { margin: 0 } }, 'Main colour')), h('div', { class: 'row' }, txt, h('span', { class: 'lbl', style: { margin: 0 } }, 'Text'))));
  const chk = (label, key) => { const c = h('input', { type: 'checkbox', checked: !!d[key] }); c.addEventListener('change', () => { d[key] = c.checked; drawRows(); push(); }); return h('label', { class: 'row', style: { marginBottom: '8px', fontWeight: 600, fontSize: '12.5px' } }, c, label); };
  body.append(chk('One colour for all', 'mono'), chk('Show values', 'values'));
  const fontSel = h('select', { class: 'sel' }, ...EZ.FONTS.map(([f]) => h('option', { value: f, selected: f === d.font }, f)));
  fontSel.addEventListener('change', () => { d.font = fontSel.value; push(); });
  body.append(h('div', { class: 'field', style: { marginTop: '6px' } }, h('label', {}, 'Font'), fontSel));
  if (!editing) body.append(h('button', { class: 'big-btn', onclick: async () => { await EZ.addChart(d); EZ.refreshPanel('chart'); } }, icon('chart-column'), 'Add chart'));
};
})();
