/* Easel — stage 2 UI: owner sign-in, version history, share links and the share viewer */
(() => {
const EZ = window.EZ;
const { $, $$, h, icon } = EZ;

const fmtDate = t => new Date(t).toLocaleString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const clone = d => JSON.parse(JSON.stringify(d));
const isOwner = () => !!EZ.cloud?.state.owner;

/* ── sign-in ── */
EZ.showLogin = () => EZ.modal((m, close) => {
  let email = ''; try { email = localStorage.getItem('easel.email') || ''; } catch {}
  const err = h('p', { style: { color: '#b3261e', margin: '8px 0 0', display: 'none' } });
  const fail = msg => { err.textContent = msg; err.style.display = ''; };
  const body = h('div');
  const step1 = () => {
    body.innerHTML = '';
    const inp = h('input', { class: 'inp', type: 'email', placeholder: 'you@example.ch', value: email, autocomplete: 'email' });
    const go = h('button', { class: 'btn pri', onclick: async () => {
      go.disabled = true; err.style.display = 'none';
      const r = await EZ.cloud.sendCode(inp.value);
      go.disabled = false;
      if (!r.ok) return fail(r.error);
      email = inp.value.trim(); step2();
    } }, 'Send code');
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') go.click(); });
    body.append(h('div', { class: 'lbl' }, 'Owner e-mail'), inp, err, h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => close() }, 'Cancel'), go));
    setTimeout(() => inp.focus(), 0);
  };
  const step2 = () => {
    body.innerHTML = '';
    const inp = h('input', { class: 'inp', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '123456', style: { fontSize: '20px', letterSpacing: '.2em', height: '46px', textAlign: 'center' } });
    const go = h('button', { class: 'btn pri', onclick: async () => {
      go.disabled = true; err.style.display = 'none';
      const r = await EZ.cloud.verifyCode(email, inp.value);
      go.disabled = false;
      if (!r.ok) return fail(r.error);
      close(true);
    } }, 'Sign in');
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') go.click(); });
    body.append(h('p', {}, `We sent a code to ${email}. It can take a minute to arrive.`), inp, err,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: step1 }, 'Back'), go));
    setTimeout(() => inp.focus(), 0);
  };
  m.append(h('h3', {}, 'Owner sign-in'), h('p', {}, 'Signing in syncs your designs across devices and unlocks share links and cloud version history. Everyone else can use Easel without an account — their work stays in their browser.'), body);
  step1();
}).then(ok => { if (ok) EZ.toast('Signed in — syncing your designs', { icon: 'cloud' }); });

EZ.accountMenu = anchor => {
  const st = EZ.cloud?.state || {};
  if (!st.owner) return EZ.showLogin();
  EZ.menu(anchor, [
    { label: st.email, icon: 'user', disabled: true, run() {} },
    '-',
    { label: 'Sync now', icon: 'refresh-cw', run: () => { EZ.cloud.syncAll(); } },
    { label: 'Sign out', icon: 'log-out', run: async () => { await EZ.cloud.signOut(); EZ.toast('Signed out — designs stay on this device'); } },
  ], { align: 'right' });
};

/* ── versions (cloud for the owner, this browser for everyone else) ── */
EZ.versions = {
  list: id => isOwner() ? EZ.cloud.versions(id) : EZ.localVersions.list(id),
  save: (d, label, auto) => isOwner() ? EZ.cloud.saveVersion(d, label, auto) : EZ.localVersions.save(d, label, auto),
  get: v => isOwner() ? EZ.cloud.getVersion(v.id) : EZ.localVersions.get(v.id),
};
const VERSION_EVERY = 10 * 60 * 1000;
const lastVersion = new Map();
// Called after every save: keeps an automatic version at most every 10 minutes of editing.
EZ.versionTick = async d => {
  const now = Date.now();
  if (!lastVersion.has(d.id)) {
    lastVersion.set(d.id, now); // block parallel ticks while we look
    try { const l = await EZ.versions.list(d.id); lastVersion.set(d.id, l[0]?.at || 0); } catch { return; }
  }
  if (now - lastVersion.get(d.id) < VERSION_EVERY) return;
  lastVersion.set(d.id, now);
  try { await EZ.versions.save(clone(d), null, true); } catch (e) { console.warn('auto version failed', e); lastVersion.set(d.id, 0); }
};
EZ.showVersions = () => EZ.modal(async (m, close) => {
  await EZ.saveNow();
  const d = EZ.doc;
  const list = h('div', { style: { maxHeight: '52vh', overflowY: 'auto', margin: '12px -4px 0', padding: '0 4px' } });
  const label = h('input', { class: 'inp', placeholder: 'Name this version, e.g. “sent to print”' });
  const saveBtn = h('button', { class: 'btn pri', onclick: async () => {
    saveBtn.disabled = true;
    try { await EZ.versions.save(clone(EZ.doc), label.value.trim() || 'Saved version', false); label.value = ''; lastVersion.set(d.id, Date.now()); await draw(); EZ.toast('Version saved', { icon: 'check' }); }
    catch (e) { EZ.toast('Could not save version: ' + e.message, { err: true }); }
    saveBtn.disabled = false;
  } }, icon('save', 'sm'), 'Save');
  async function draw() {
    list.innerHTML = '';
    list.append(h('div', { class: 'empty' }, h('span', { class: 'spin' })));
    let rows = [];
    try { rows = await EZ.versions.list(d.id); } catch (e) { list.innerHTML = ''; list.append(h('div', { class: 'empty' }, 'Could not load versions: ' + e.message)); return; }
    list.innerHTML = '';
    if (!rows.length) { list.append(h('div', { class: 'empty' }, icon('history'), 'No versions yet. Easel keeps one automatically every 10 minutes while you edit, or save one now.')); return; }
    for (const v of rows) {
      const busy = b => { $$('button', list).forEach(x => x.disabled = b); };
      list.append(h('div', { class: 'layer', style: { cursor: 'default' } },
        h('div', { class: 'lt', style: { width: '64px', height: '48px', backgroundImage: v.thumb ? `url(${v.thumb})` : '' } }),
        h('div', { class: 'ln' }, v.label || 'Auto-saved', h('small', {}, `${fmtDate(v.at)}${v.name && v.name !== d.name ? ' · ' + v.name : ''}`)),
        h('button', { class: 'btn', style: { height: '32px', padding: '0 10px' }, title: 'Open this version as a separate design', onclick: async () => {
          busy(true);
          try { const full = await EZ.versions.get(v); close(); await EZ.createDesign({ name: `${d.name} (${fmtDate(v.at)})`, w: full.w, h: full.h, mm: full.mm, pages: full.pages.map(p => p.json) }); }
          catch (e) { EZ.toast('Failed: ' + e.message, { err: true }); busy(false); }
        } }, 'Copy'),
        h('button', { class: 'btn pri', style: { height: '32px', padding: '0 12px' }, onclick: async () => {
          if (!(await EZ.confirm('Restore this version?', 'The current state is saved as a version first, so you can go back.', 'Restore'))) return;
          busy(true);
          try { await restore(v); close(); EZ.toast('Version restored', { icon: 'history' }); }
          catch (e) { EZ.toast('Restore failed: ' + e.message, { err: true }); busy(false); }
        } }, 'Restore')));
    }
  }
  m.append(h('h3', {}, 'Version history'),
    h('p', {}, isOwner() ? 'Stored in your Easel cloud — available on every device you sign in on.' : 'Stored in this browser. Sign in as the owner to keep versions in the cloud.'),
    h('div', { class: 'row' }, label, saveBtn), list,
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => close() }, 'Close')));
  label.addEventListener('keydown', e => { if (e.key === 'Enter') saveBtn.click(); });
  draw();
}, { width: 600 });
async function restore(v) {
  const full = await EZ.versions.get(v);
  if (!full?.pages) throw new Error('version not found');
  await EZ.saveNow();
  await EZ.versions.save(clone(EZ.doc), 'Before restore', false);
  const d = EZ.doc;
  Object.assign(d, { w: full.w || d.w, h: full.h || d.h, mm: full.mm ?? d.mm });
  // fresh page ids so old undo stacks don't apply to restored pages
  d.pages = full.pages.map(p => ({ id: 'p' + EZ.uid(), json: p.json }));
  EZ.pageIndex = -1;
  await EZ.gotoPage(0, { force: true });
  EZ.fit();
  EZ.changed();
  for (const p of d.pages) { p.thumb = await EZ.pageThumb(p.json); EZ.renderPages(); }
}

/* ── share links (owner) ── */
EZ.showShare = () => {
  if (!isOwner()) {
    return EZ.modal((m, close) => m.append(h('h3', {}, 'Share'),
      h('p', {}, 'Share links are stored in the owner’s Easel cloud. You can still send someone the design as a project file, or download it as PDF or PNG.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => { close(); EZ.showLogin(); } }, 'Owner sign-in'),
        h('button', { class: 'btn', onclick: () => { close(); EZ.exportProject(); } }, 'Project file'),
        h('button', { class: 'btn pri', onclick: () => { close(); EZ.showExport(); } }, 'Download'))));
  }
  return EZ.modal(async (m, close) => {
    await EZ.saveNow();
    const d = EZ.doc;
    const out = h('div');
    const kinds = {
      view: { title: 'View-only link', text: 'People can look through every page, but can’t change anything.', ic: 'eye' },
      template: { title: 'Template link', text: 'People get their own editable copy in their browser — your design stays untouched.', ic: 'copy' },
    };
    const linkRow = (s) => {
      const url = EZ.cloud.shareUrl(s.token);
      const inp = h('input', { class: 'inp', value: url, readOnly: true, style: { fontFamily: 'monospace', fontSize: '12px' } });
      inp.addEventListener('focus', () => inp.select());
      return h('div', { class: 'layer', style: { cursor: 'default', flexWrap: 'wrap' } },
        h('span', { class: 'lt', style: { width: '30px', height: '30px' } }, icon(kinds[s.mode].ic, 'sm')),
        h('div', { class: 'ln' }, kinds[s.mode].title, h('small', {}, `${fmtDate(Date.parse(s.created_at))} · ${s.views} view${s.views === 1 ? '' : 's'}`)),
        h('button', { class: 'lb', title: 'Copy link', onclick: async () => { try { await navigator.clipboard.writeText(url); EZ.toast('Link copied', { icon: 'check' }); } catch { inp.focus(); } } }, icon('copy', 'sm')),
        h('a', { class: 'lb', title: 'Open', href: url, target: '_blank', rel: 'noopener' }, icon('external-link', 'sm')),
        h('button', { class: 'lb', title: 'Delete link', onclick: async () => {
          if (!(await EZ.confirm('Delete this link?', 'Anyone who has it will no longer be able to open the design.', 'Delete', true))) return;
          try { await EZ.cloud.deleteShare(s.token); draw(); } catch (e) { EZ.toast(e.message, { err: true }); }
        } }, icon('trash-2', 'sm')),
        h('div', { style: { flexBasis: '100%', marginTop: '6px' } }, inp));
    };
    async function draw() {
      out.innerHTML = '';
      const g = h('div', { class: 'grid g2', style: { marginBottom: '14px' } });
      for (const [mode, k] of Object.entries(kinds)) {
        const b = h('button', { class: 'layer', style: { margin: 0, alignItems: 'flex-start' }, onclick: async () => {
          b.disabled = true;
          try { const t = await EZ.cloud.createShare(EZ.doc, mode); try { await navigator.clipboard.writeText(EZ.cloud.shareUrl(t)); EZ.toast('New link copied', { icon: 'link' }); } catch {} await draw(); }
          catch (e) { EZ.toast('Could not create link: ' + e.message, { err: true }); b.disabled = false; }
        } }, h('span', { class: 'lt', style: { width: '30px', height: '30px' } }, icon(k.ic, 'sm')), h('div', { class: 'ln', style: { whiteSpace: 'normal' } }, 'New ' + k.title.toLowerCase(), h('small', {}, k.text)));
        g.append(b);
      }
      out.append(g);
      let rows = [];
      try { rows = await EZ.cloud.shares(d.id); } catch (e) { out.append(h('div', { class: 'empty' }, e.message)); return; }
      if (rows.length) { out.append(h('div', { class: 'lbl' }, 'Active links')); rows.forEach(s => out.append(linkRow(s))); }
      else out.append(h('p', { class: 'hint' }, 'No links yet. Links always show the latest saved state of this design.'));
    }
    m.append(h('h3', {}, 'Share “' + d.name + '”'), h('p', {}, 'Anyone with a link can open it — no account needed.'), out,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => close() }, 'Done')));
    draw();
  }, { width: 600 });
};

/* ── share viewer (anyone with a link) ── */
EZ.showViewer = async token => {
  $('#home').classList.add('hidden');
  $('#app').classList.add('hidden');
  const v = h('div', { id: 'viewer' });
  document.body.append(v);
  const top = h('div', { class: 'home-top' },
    h('a', { class: 'brand', href: location.pathname }, h('span', { class: 'mark' }, icon('brush')), 'Easel'));
  const main = h('div', { class: 'viewer-main' }, h('div', { class: 'empty', style: { color: '#c9c7d6' } }, h('span', { class: 'spin' }), h('div', { style: { marginTop: '10px' } }, 'Opening shared design…')));
  v.append(top, main);
  let s;
  try { s = await EZ.cloud.getShare(token); } catch (e) { s = null; console.warn(e); }
  main.innerHTML = '';
  if (!s) {
    main.append(h('div', { class: 'empty', style: { color: '#c9c7d6' } }, icon('link'), 'This link doesn’t work any more — it may have been deleted.',
      h('div', { style: { marginTop: '14px' } }, h('a', { class: 'btn pri', href: location.pathname }, 'Open Easel'))));
    return;
  }
  document.title = `${s.name} — Easel`;
  top.append(h('div', { class: 'viewer-title' }, h('b', {}, s.name), h('small', {}, `${s.pages.length} page${s.pages.length > 1 ? 's' : ''} · shared ${s.mode === 'template' ? 'as a template' : 'view-only'}`)),
    h('span', { class: 'top-spacer' }));
  if (s.mode === 'template') {
    top.append(h('button', { class: 'btn-primary', onclick: async () => {
      v.remove();
      await EZ.createDesign({ name: s.name, w: s.w, h: s.h, mm: s.mm, pages: s.pages.map(p => p.json) });
      EZ.toast('Your own copy — it’s saved in this browser', { icon: 'copy', ms: 4000 });
    } }, icon('copy', 'sm'), h('span', { class: 'dl-txt' }, 'Use this template')));
  }
  // each page fits the window (scroll between pages, not within one)
  const width = Math.max(240, Math.min(960, innerWidth - 32, (innerHeight - 130) * s.w / s.h));
  for (const [i, p] of s.pages.entries()) {
    const box = h('div', { class: 'viewer-page', style: { aspectRatio: `${s.w} / ${s.h}`, width: width + 'px' } }, h('span', { class: 'spin' }));
    main.append(box, h('div', { class: 'viewer-num' }, `${i + 1} / ${s.pages.length}`));
    const m = Math.min(3, width * (devicePixelRatio || 1) / s.w);
    EZ.renderPage(p.json, { w: s.w, h: s.h, multiplier: m, format: 'png' })
      .then(src => { box.innerHTML = ''; box.append(h('img', { src, alt: `Page ${i + 1}` })); })
      .catch(() => { box.innerHTML = ''; box.append(h('div', { class: 'empty' }, 'Page could not be rendered')); });
  }
  main.append(h('p', { class: 'viewer-foot' }, 'Made with ', h('a', { href: location.pathname }, 'Easel'), ' — a free design tool on dump.yanikroesti.ch'));
};
})();
