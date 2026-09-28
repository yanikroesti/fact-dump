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
  document.getElementById('viewer')?.remove();
  if (EZ.cloud.state.owner) doc = await EZ.cloud.freshen(doc); // newer copy from another device?
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
    EZ.cloud.queuePush(d.id);
    EZ.versionTick?.(d);
    if (announce) {
      const where = EZ.cloud.state.owner ? 'Saved — syncing to your cloud' : (await EZ.db.persistent()) ? 'Saved in this browser' : 'Saved for this session only — your browser blocks storage';
      EZ.toast(where, { icon: 'check' });
    }
  } catch (e) {
    console.error(e);
    setSave('error');
    EZ.toast('Could not save: ' + (e.message || e), { err: true });
  }
};
EZ.autosave = EZ.debounce(() => EZ.saveNow(false), 1500);
// Save indicator: local save state first, then (for the owner) the cloud sync state.
let localSave = 'saved';
function setSave(s) { localSave = s; drawSave(); }
function drawSave() {
  const el = $('#saveState');
  el.innerHTML = '';
  el.classList.remove('err');
  el.title = '';
  const spin = () => h('span', { class: 'spin', style: { width: '12px', height: '12px', borderWidth: '2px' } });
  const c = EZ.cloud.state;
  if (localSave === 'saving') return el.append(spin(), 'Saving…');
  if (localSave === 'error') { el.classList.add('err'); return el.append(icon('x', 'sm'), 'Not saved'); }
  if (!c.owner) { el.title = 'Saved in this browser'; return el.append(icon('check', 'sm'), 'Saved'); }
  if (c.sync === 'pending' || c.sync === 'syncing') return el.append(spin(), 'Syncing…');
  if (c.sync === 'error') { el.classList.add('err'); el.title = c.syncError || ''; return el.append(icon('cloud-off', 'sm'), 'Saved on this device only'); }
  el.title = 'Saved and synced to your Easel cloud';
  el.append(icon('cloud', 'sm'), 'Synced');
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
  const cloud = EZ.cloud.state.owner;
  if (!(await EZ.confirm('Delete this design?', `“${EZ.doc.name}” will be removed from ${cloud ? 'this browser and your Easel cloud (share links stop working)' : 'this browser'}. This can’t be undone.`, 'Delete', true))) return;
  await removeDesign(EZ.doc.id);
  EZ.doc = null;
  EZ.dirty = false;
  EZ.showHome();
};
async function removeDesign(id) {
  await EZ.deleteDesign(id);
  await EZ.localVersions.removeAll(id).catch(() => {});
  if (EZ.cloud.state.owner) { try { await EZ.cloud.remove(id); } catch (e) { EZ.toast('Removed here, but the cloud copy could not be deleted: ' + e.message, { err: true }); } }
}

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
  const box = $('#homeDesigns');
  const owner = EZ.cloud.state.owner;
  let list = (await EZ.listDesigns()).map(d => ({ ...d, where: 'local' }));
  let cloudErr = '';
  if (owner) {
    try {
      const rows = await EZ.cloud.list();
      const local = new Map(list.map(d => [d.id, d]));
      for (const r of rows) {
        const l = local.get(r.id);
        if (l) { l.where = 'both'; if (+r.updated > (l.updated || 0) + 500) Object.assign(l, { name: r.name, thumb: r.thumb, updated: +r.updated, newer: true }); }
        else list.push({ id: r.id, name: r.name, w: r.w, h: r.h, mm: r.mm, thumb: r.thumb, updated: +r.updated, created: +r.created, pageCount: r.page_count, where: 'cloud' });
      }
      list.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    } catch (e) { cloudErr = e.message; }
  }
  box.innerHTML = '';
  $('#homeCount').textContent = list.length ? (owner ? `${list.length} · synced to your Easel cloud` : `${list.length} in this browser`) : '';
  if (cloudErr) box.append(h('div', { class: 'empty', style: { gridColumn: '1/-1', padding: '8px' } }, 'Cloud unavailable: ' + cloudErr));
  if (!list.length) { box.append(h('div', { class: 'empty', style: { gridColumn: '1/-1' } }, icon('layout-template'), 'Nothing yet — pick a size or a template above.')); return; }
  const open = async d => {
    if (d.where === 'cloud' || d.newer) {
      const busy = EZ.busy('Downloading design…');
      try { const full = await EZ.cloud.pull(d.id); if (!full) throw new Error('not found'); await EZ.putDesign(full); busy.close(); return EZ.openDesign(full); }
      catch (e) { busy.close(); EZ.toast('Could not load it: ' + e.message, { err: true }); return; }
    }
    EZ.openDesign(await EZ.getDesign(d.id));
  };
  for (const d of list) {
    const more = h('button', { class: 'dmore', title: 'More' }, icon('ellipsis', 'sm'));
    more.onclick = e => {
      e.stopPropagation();
      EZ.menu(more, [
        { label: 'Open', icon: 'folder-open', run: () => open(d) },
        { label: 'Rename', icon: 'type', disabled: d.where === 'cloud', run: async () => {
          const n = await EZ.prompt('Rename design', d.name);
          if (!n?.trim()) return;
          const full = await EZ.getDesign(d.id);
          full.name = n.trim(); full.updated = Date.now();
          await EZ.putDesign(full); EZ.cloud.queuePush(full.id); renderHome();
        } },
        { label: 'Make a copy', icon: 'copy', disabled: d.where === 'cloud', run: async () => {
          const full = await EZ.getDesign(d.id);
          const copy = { ...JSON.parse(JSON.stringify(full)), id: 'd' + EZ.uid(), name: full.name + ' (copy)', created: Date.now(), updated: Date.now() };
          await EZ.putDesign(copy); EZ.cloud.queuePush(copy.id); renderHome();
        } },
        '-',
        { label: 'Delete', icon: 'trash-2', run: async () => {
          if (!(await EZ.confirm('Delete this design?', `“${d.name}” will be removed from ${owner ? 'this browser and your Easel cloud' : 'this browser'}.`, 'Delete', true))) return;
          await removeDesign(d.id); renderHome();
        } },
      ], { align: 'right' });
    };
    const pages = d.pages ? d.pages.length : d.pageCount || 1;
    const badge = owner ? h('span', { title: d.where === 'cloud' ? 'Only in the cloud — opens after downloading' : d.where === 'both' ? 'Synced' : 'Not synced yet', style: { color: d.where === 'local' ? 'var(--mute)' : 'var(--good)', marginRight: '4px', verticalAlign: '-2px' } }, icon(d.where === 'local' ? 'cloud-off' : 'cloud', 'sm')) : null;
    box.append(h('div', { class: 'dcard' },
      h('div', { class: 'dth', style: { backgroundImage: d.thumb ? `url(${d.thumb})` : '' }, onclick: () => open(d) }),
      h('div', { class: 'dnm' }, h('b', {}, badge, d.name), h('small', {}, `${pages} page${pages > 1 ? 's' : ''} · ${d.mm ? d.mm.join(' × ') + ' mm' : d.w + ' × ' + d.h} · ${EZ.timeAgo(d.updated)}`)),
      more));
  }
}
EZ.renderHome = renderHome;

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

  // stage 2: cloud account, sharing, versions
  $('#shareBtn').onclick = () => EZ.showShare();
  $('#versionsBtn').onclick = () => EZ.showVersions();
  $('#acctBtn').onclick = e => EZ.accountMenu(e.currentTarget);
  $('#homeAcct').onclick = e => EZ.accountMenu(e.currentTarget);
  $('#panelX').onclick = () => EZ.closePanel();
  // phones: tapping the page closes the bottom sheet
  $('#stage').addEventListener('pointerdown', () => { if (innerWidth <= 700 && EZ.currentPanel() && EZ.currentPanel() !== 'draw') EZ.closePanel(); });
  let wasOwner = false;
  EZ.cloud.on(st => {
    drawSave();
    $('#acctBtn').classList.toggle('on', st.owner);
    $('#acctBtn').title = st.owner ? `Signed in as ${st.email}` : 'Owner sign-in';
    $('#homeAcct').lastChild.textContent = st.owner ? 'Synced' : 'Sign in';
    $('#homeAcct').firstChild.replaceWith(icon(st.owner ? 'cloud' : 'user', 'sm'));
    if (st.owner !== wasOwner) {
      wasOwner = st.owner;
      if (!$('#home').classList.contains('hidden')) renderHome();
      if (st.owner) EZ.cloud.syncAll();
    }
  });

  // back from the e-mail login link (#access_token=… or #error_description=…)
  if (/access_token=|error_description=/.test(location.hash)) {
    const r = await EZ.cloud.consumeRedirect().catch(e => ({ ok: false, error: e.message }));
    if (r?.ok) EZ.toast('Signed in — syncing your designs', { icon: 'cloud', ms: 3500 });
    else if (r) EZ.toast(r.error, { err: true, ms: 6000 });
  }
  const share = location.hash.match(/s=([\w-]+)/);
  if (share) return EZ.showViewer(share[1]);
  if (EZ.cloud.hasSession()) EZ.cloud.init().catch(e => console.warn('cloud init failed', e));
  const m = location.hash.match(/d=([\w]+)/);
  const doc = m ? await EZ.getDesign(m[1]).catch(() => null) : null;
  if (doc) await EZ.openDesign(doc);
  else EZ.showHome();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
