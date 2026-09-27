/* Easel — boot: home screen, design lifecycle, autosave, page strip, zoom bar, top bar */
(() => {
const EZ = window.EZ;
const { $, $$, h, icon } = EZ;

/* ── design lifecycle ── */
EZ.createDesign = async ({ name = 'Untitled design', w, h: hh, mm = null, pages = null }) => {
  const doc = {
    id: 'd' + EZ.uid(), name, w: Math.round(w), h: Math.round(hh), mm,
    pages: [], created: Date.now(), updated: Date.now(),
  };
  EZ.doc = doc; // blankPage() reads the size from EZ.doc
  doc.pages = pages?.length ? pages.map(j => ({ id: 'p' + EZ.uid(), json: j })) : [EZ.blankPage()];
  await EZ.putDesign(doc).catch(() => {});
  await EZ.openDesign(doc);
};
EZ.openDesign = async doc => {
  EZ.doc = doc;
  $('#home').classList.add('hidden');
  $('#app').classList.remove('hidden');
  history.replaceState(null, '', '#d=' + doc.id);
  document.title = `${doc.name} — Easel`;
  $('#docTitle').value = doc.name;
  EZ.pageIndex = -1;
  await EZ.gotoPage(0, { force: true });
  EZ.fit();
  EZ.dirty = false;
  setSave('saved');
  EZ.renderPages(); EZ.renderProps(); EZ.onHistory();
  if (innerWidth > 700 && !EZ.currentPanel()) EZ.openPanel('templates');
  else if (EZ.currentPanel()) EZ.refreshPanel();
  // fill in missing page thumbnails
  for (const p of doc.pages) if (!p.thumb) { p.thumb = await EZ.pageThumb(p.json); EZ.renderPages(); }
};
EZ.saveNow = async (announce = false) => {
  const d = EZ.doc;
  if (!d) return;
  EZ.autosave.cancel();
  EZ.commit.flush();
  EZ.storePage();
  setSave('saving');
  d.updated = Date.now();
  d.thumb = d.pages[0].thumb || '';
  try {
    await EZ.putDesign(JSON.parse(JSON.stringify(d)));
    EZ.dirty = false;
    setSave('saved');
    if (announce) EZ.toast((await EZ.db.persistent()) ? 'Saved in this browser' : 'Saved for this session only — your browser blocks storage', { icon: 'check' });
  } catch (e) {
    console.error(e);
    setSave('error');
    EZ.toast('Could not save: ' + (e.message || e), { err: true });
  }
};
EZ.autosave = EZ.debounce(() => EZ.saveNow(false), 1500);
function setSave(s) {
  const el = $('#saveState');
  el.innerHTML = '';
  if (s === 'saving') el.append(h('span', { class: 'spin', style: { width: '12px', height: '12px', borderWidth: '2px' } }), 'Saving…');
  else if (s === 'saved') el.append(icon('cloud', 'sm'), 'Saved');
  else if (s === 'error') el.append(icon('x', 'sm'), 'Not saved');
}
const origChanged = EZ.changed;
EZ.changed = () => { origChanged(); setSave('saving'); };
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && EZ.dirty) EZ.saveNow(); });
addEventListener('beforeunload', e => { if (EZ.dirty) { EZ.saveNow(); e.preventDefault(); e.returnValue = ''; } });

EZ.copyDesign = async () => {
  await EZ.saveNow();
  const d = JSON.parse(JSON.stringify(EZ.doc));
  await EZ.createDesign({ name: d.name + ' (copy)', w: d.w, h: d.h, mm: d.mm, pages: d.pages.map(p => p.json) });
  EZ.toast('Copy created');
};
EZ.deleteCurrentDesign = async () => {
  if (!(await EZ.confirm('Delete this design?', `“${EZ.doc.name}” will be removed from this browser. This can’t be undone.`, 'Delete', true))) return;
  await EZ.deleteDesign(EZ.doc.id);
  EZ.doc = null;
  EZ.showHome();
};

/* ── home ── */
EZ.showHome = async () => {
  if (EZ.doc && EZ.dirty) await EZ.saveNow();
  EZ.setDraw?.(null);
  EZ.closePop();
  $('#app').classList.add('hidden');
  $('#home').classList.remove('hidden');
  history.replaceState(null, '', location.pathname + location.search);
  document.title = 'Easel — Design Studio';
  renderHome();
};
async function renderHome() {
  const pr = $('#homePresets');
  pr.innerHTML = '';
  for (const p of EZ.PRESETS) {
    const r = p.w / p.h, bw = r >= 1 ? 58 : 58 * r, bh = r >= 1 ? 58 / r : 58;
    pr.append(h('button', { class: 'preset', onclick: () => EZ.createDesign({ name: 'Untitled ' + p.name.toLowerCase(), w: p.w, h: p.h, mm: p.mm }) },
      h('span', { class: 'shape' }, h('i', { style: { width: bw + 'px', height: bh + 'px' } })), h('b', {}, p.name), h('small', {}, p.sub)));
  }
  const tp = $('#homeTpls');
  if (!tp.children.length) EZ.TEMPLATES.forEach(t => tp.append(EZ.tplCard(t, async () => {
    const busy = EZ.busy('Loading template…');
    try { const pages = await EZ.buildTemplate(t); busy.close(); await EZ.createDesign({ name: t.name, w: t.w, h: t.h, mm: t.mm, pages }); }
    catch (e) { busy.close(); EZ.toast('Template failed to load', { err: true }); }
  })));
  const list = await EZ.listDesigns();
  const box = $('#homeDesigns');
  box.innerHTML = '';
  $('#homeCount').textContent = list.length ? `${list.length} in this browser` : '';
  if (!list.length) { box.append(h('div', { class: 'empty', style: { gridColumn: '1/-1' } }, icon('layout-template'), 'Nothing yet — pick a size or a template above.')); return; }
  for (const d of list) {
    const more = h('button', { class: 'dmore', title: 'More' }, icon('ellipsis', 'sm'));
    more.onclick = e => {
      e.stopPropagation();
      EZ.menu(more, [
        { label: 'Open', icon: 'folder-open', run: () => EZ.openDesign(d) },
        { label: 'Rename', icon: 'type', run: async () => { const n = await EZ.prompt('Rename design', d.name); if (n?.trim()) { d.name = n.trim(); await EZ.putDesign(d); renderHome(); } } },
        { label: 'Make a copy', icon: 'copy', run: async () => { await EZ.putDesign({ ...JSON.parse(JSON.stringify(d)), id: 'd' + EZ.uid(), name: d.name + ' (copy)', created: Date.now(), updated: Date.now() }); renderHome(); } },
        '-',
        { label: 'Delete', icon: 'trash-2', run: async () => { if (await EZ.confirm('Delete this design?', `“${d.name}” will be removed from this browser.`, 'Delete', true)) { await EZ.deleteDesign(d.id); renderHome(); } } },
      ], { align: 'right' });
    };
    box.append(h('div', { class: 'dcard' },
      h('div', { class: 'dth', style: { backgroundImage: d.thumb ? `url(${d.thumb})` : '' }, onclick: () => EZ.openDesign(d) }),
      h('div', { class: 'dnm' }, h('b', {}, d.name), h('small', {}, `${d.pages.length} page${d.pages.length > 1 ? 's' : ''} · ${d.mm ? d.mm.join(' × ') + ' mm' : d.w + ' × ' + d.h} · ${EZ.timeAgo(d.updated)}`)),
      more));
  }
}

/* ── page strip ── */
let dragPage = null;
EZ.renderPages = () => {
  const box = $('#pages');
  if (!box || !EZ.doc) return;
  box.innerHTML = '';
  const th = innerWidth <= 700 ? 48 : 62;
  const tw = Math.min(140, Math.max(34, th * EZ.W() / EZ.H()));
  EZ.doc.pages.forEach((p, i) => {
    const pg = h('div', { class: 'pg' + (i === EZ.pageIndex ? ' on' : ''), draggable: true, title: `Page ${i + 1}` },
      h('div', { class: 'pth', style: { width: tw + 'px', height: th + 'px', backgroundImage: p.thumb ? `url(${p.thumb})` : '' } }),
      h('span', { class: 'pn' }, i + 1),
      h('div', { class: 'pm' },
        h('button', { title: 'Duplicate page', onclick: e => { e.stopPropagation(); EZ.duplicatePage(i); } }, icon('copy', 'sm')),
        h('button', { title: 'Delete page', onclick: e => { e.stopPropagation(); EZ.deletePage(i); } }, icon('trash-2', 'sm'))));
    pg.addEventListener('click', () => EZ.gotoPage(i));
    pg.addEventListener('dragstart', e => { dragPage = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'page'); });
    pg.addEventListener('dragover', e => { if (dragPage == null) return; e.preventDefault(); pg.classList.add('drag-over'); });
    pg.addEventListener('dragleave', () => pg.classList.remove('drag-over'));
    pg.addEventListener('drop', e => { e.preventDefault(); pg.classList.remove('drag-over'); if (dragPage != null) EZ.movePage(dragPage, i); dragPage = null; });
    pg.addEventListener('dragend', () => { dragPage = null; });
    box.append(pg);
  });
  box.append(h('button', { class: 'pg-add', title: 'Add page', style: { height: th + 'px', width: Math.min(tw, 62) + 'px' }, onclick: () => EZ.addPage() }, icon('plus')));
};

/* ── zoom bar + history buttons ── */
const ZMIN = 0.05, ZMAX = 8;
EZ.onZoom = z => {
  $('#zVal').textContent = Math.round(z * 100) + '%';
  $('#zRange').value = Math.round(Math.log(z / ZMIN) / Math.log(ZMAX / ZMIN) * 100);
};
EZ.onHistory = () => {
  $('#undoBtn').disabled = !EZ.canUndo();
  $('#redoBtn').disabled = !EZ.canRedo();
};

/* ── boot ── */
async function boot() {
  EZ.hydrateIcons();
  EZ.initEditor();
  EZ.initPanels();
  if (innerWidth <= 700) EZ.closePanel();

  $('#goHome').onclick = () => EZ.showHome();
  $('#fileBtn').onclick = e => EZ.fileMenu(e.currentTarget);
  $('#resizeBtn').onclick = () => EZ.showResize();
  $('#undoBtn').onclick = () => EZ.undo();
  $('#redoBtn').onclick = () => EZ.redo();
  $('#helpBtn').onclick = () => EZ.showShortcuts();
  $('#dlBtn').onclick = () => EZ.showExport();
  $('#drawDone').onclick = () => EZ.setDraw(null);
  const title = $('#docTitle');
  title.addEventListener('change', () => { if (!EZ.doc) return; EZ.doc.name = title.value.trim() || 'Untitled design'; title.value = EZ.doc.name; document.title = `${EZ.doc.name} — Easel`; EZ.saveNow(); });
  title.addEventListener('keydown', e => { if (e.key === 'Enter') title.blur(); });
  $('#zIn').onclick = () => EZ.zoomBy(1.25);
  $('#zOut').onclick = () => EZ.zoomBy(1 / 1.25);
  $('#zVal').onclick = () => EZ.fit();
  $('#zRange').addEventListener('input', e => EZ.zoomTo(ZMIN * Math.pow(ZMAX / ZMIN, e.target.value / 100)));
  $('#fileIn').addEventListener('change', e => { EZ.uploadFiles(e.target.files); e.target.value = ''; });
  $('#projIn').addEventListener('change', e => { const f = e.target.files[0]; if (f) EZ.importProject(f); e.target.value = ''; });
  $('#homeImport').onclick = () => $('#projIn').click();
  $('#cgo').onclick = () => {
    const f = EZ.UNIT_PX[$('#cu').value];
    const w = +$('#cw').value * f, hh = +$('#ch').value * f;
    if (!(w >= 16 && hh >= 16 && w <= 12000 && hh <= 12000)) { EZ.toast('Size must be between 16 and 12000 px', { err: true }); return; }
    const u = $('#cu').value;
    EZ.createDesign({ name: 'Untitled design', w, h: hh, mm: u === 'px' ? null : [+$('#cw').value * f / EZ.UNIT_PX.mm, +$('#ch').value * f / EZ.UNIT_PX.mm].map(v => EZ.round(v, 1)) });
  };
  // drop files onto the home screen → new design sized to the image
  $('#home').addEventListener('dragover', e => e.preventDefault());
  $('#home').addEventListener('drop', async e => {
    e.preventDefault();
    const f = [...e.dataTransfer.files].find(x => x.type.startsWith('image/'));
    const p = [...e.dataTransfer.files].find(x => /\.(easel|json)$/i.test(x.name));
    if (p) return EZ.importProject(p);
    if (!f) return;
    const a = await EZ.importImageBlob(f, { upload: true, name: f.name });
    await EZ.createDesign({ name: f.name.replace(/\.[^.]+$/, ''), w: a.w, h: a.h });
    await EZ.addImage(a.url, { fit: 1 });
  });

  const m = location.hash.match(/d=([\w]+)/);
  const doc = m ? await EZ.getDesign(m[1]).catch(() => null) : null;
  if (doc) await EZ.openDesign(doc);
  else EZ.showHome();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
