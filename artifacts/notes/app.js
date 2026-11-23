// Desktop Note on the web (notes.swisslock.net). Same tabs as the Windows note, synced through the easel
// Supabase project: table notes_tabs (one row per tab), RPC notes_push (optimistic concurrency on rev),
// bucket notes-files (<user id>/<file name> for pictures from the note's attachments folder).
// Everything is kept in localStorage first, so the page works offline and syncs when it's back online.
(() => {
  'use strict';
  const SB_URL = 'https://vcglqoqtcsiqfjutizib.supabase.co';
  const SB_KEY = 'sb_publishable_fbTatnQ1Dpu9uhTWI0hMEA_1FizA6MU';
  const STORE = 'notes.state.v1';
  const BUCKET = 'notes-files';
  // A line that is just a picture: "attachments/<name>" (cloud form) or a Windows path into ...\attachments\.
  const IMG_LINE = /^[ \t]*"?(?:attachments\/|[A-Za-z]:\\[^\r\n"]*\\attachments\\)([^\\/\r\n"]+\.(?:png|jpe?g|gif|bmp|tiff?|webp))"?[ \t]*$/gim;
  const $ = (id) => document.getElementById(id);
  const device = deviceName();

  let sb = null, uid = null;
  let S = load();
  let syncing = false, again = false, pushTimer = 0, lastOk = 0, lastErr = '';
  const urls = new Map(); // picture name -> {url, at}

  // ---------- local state ----------
  function blank() { return { uid: null, lastSeq: 0, active: null, tabs: {} }; }
  function load() {
    try { const s = JSON.parse(localStorage.getItem(STORE)); if (s && s.tabs) return s; } catch (e) { /* empty */ }
    return blank();
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(S)); }
    catch (e) { lastErr = 'Storage full on this device'; }
  }
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  function deviceName() {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'web iPhone';
    if (/iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'web iPad';
    if (/Android/.test(ua)) return 'web Android';
    if (/Linux/.test(ua)) return 'web Linux';
    if (/Windows/.test(ua)) return 'web Windows';
    if (/Mac/.test(ua)) return 'web Mac';
    return 'web';
  }
  function fromRow(r) {
    return { id: r.id, body: r.body, code: !!r.code, images_off: !!r.images_off, sort: Number(r.sort) || 0,
      deleted: !!r.deleted, rev: r.rev, dirty: false };
  }
  function visible() {
    return Object.values(S.tabs).filter((t) => !t.deleted)
      .sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));
  }
  function active() {
    let t = S.tabs[S.active];
    if (!t || t.deleted) { t = visible()[0] || null; S.active = t ? t.id : null; }
    return t;
  }
  function newTab(body, opts) {
    const tabs = visible();
    const t = { id: uuid(), body: body || '', code: false, images_off: false,
      sort: tabs.length ? tabs[tabs.length - 1].sort + 1 : 0, deleted: false, rev: 0, dirty: !!body, ...opts };
    S.tabs[t.id] = t;
    return t;
  }
  function titleOf(text) {
    for (const line of text.split(/\r?\n|\r/)) {
      const l = line.trim();
      if (l) return l.length > 40 ? l.slice(0, 40) : l;
    }
    return '';
  }
  function stamp() {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}. ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // ---------- rendering ----------
  const editor = $('editor');
  let shownId = null;

  function render(force) {
    if (uid && !visible().length) { S.active = newTab('').id; force = true; } // every tab was closed elsewhere
    const t = active();
    const bar = $('tabs');
    bar.textContent = '';
    for (const tab of visible()) {
      const b = document.createElement('button');
      b.className = 'tab' + (tab === t ? ' active' : '') + (tab.dirty ? ' dirty' : '');
      b.textContent = titleOf(tab.body) || 'New tab';
      b.onclick = () => { S.active = tab.id; save(); render(true); editor.focus(); };
      bar.appendChild(b);
      if (tab === t) requestAnimationFrame(() => b.scrollIntoView({ inline: 'nearest', block: 'nearest' }));
    }
    if (!t) { editor.value = ''; shownId = null; renderImages(null); renderStatus(); return; }
    if (force || shownId !== t.id || editor.value !== t.body) {
      if (shownId === t.id && document.activeElement === editor) {
        // remote update of the tab being looked at: keep the caret near where it was
        const pos = editor.selectionStart, top = editor.scrollTop;
        editor.value = t.body;
        editor.selectionStart = editor.selectionEnd = Math.min(pos, t.body.length);
        editor.scrollTop = top;
      } else {
        editor.value = t.body;
        if (shownId !== t.id) editor.scrollTop = 0;
      }
      shownId = t.id;
    }
    editor.classList.toggle('code', t.code);
    editor.wrap = t.code ? 'off' : 'soft';
    renderImages(t);
    renderStatus();
  }

  function renderStatus() {
    const el = $('status');
    const dirty = Object.values(S.tabs).some((t) => t.dirty);
    el.className = '';
    if (!sb || !uid) el.textContent = 'Not signed in: changes stay on this device';
    else if (!navigator.onLine) el.textContent = dirty ? 'Offline: changes saved here, will sync later' : 'Offline';
    else if (lastErr) { el.textContent = 'Sync problem: ' + lastErr; el.className = 'warn'; }
    else if (syncing) el.textContent = 'Syncing…';
    else if (dirty) el.textContent = 'Saving…';
    else if (lastOk) el.textContent = 'Synced ' + new Date(lastOk).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    else el.textContent = '';
    const t = S.tabs[S.active];
    let right = '';
    if (t && t.code) {
      const before = editor.value.slice(0, editor.selectionStart);
      right = `Ln ${before.split('\n').length}, Col ${before.length - before.lastIndexOf('\n')}`;
    } else if (t) right = `${(t.body.match(/\S+/g) || []).length} words`;
    $('stat2').textContent = right;
  }

  function imageNames(body) {
    const out = [];
    IMG_LINE.lastIndex = 0;
    let m;
    while ((m = IMG_LINE.exec(body))) if (!out.includes(m[1])) out.push(m[1]);
    return out;
  }

  async function renderImages(t) {
    const box = $('images');
    const names = t && !t.images_off ? imageNames(t.body) : [];
    const key = names.join('|');
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.textContent = '';
    if (!names.length) return;
    if (sb && uid && navigator.onLine) {
      const need = names.filter((n) => !urls.has(n) || Date.now() - urls.get(n).at > 50 * 60 * 1000);
      if (need.length) {
        const { data } = await sb.storage.from(BUCKET).createSignedUrls(need.map((n) => `${uid}/${n}`), 3600);
        for (const d of data || []) {
          const n = (d.path || '').split('/').pop();
          if (d.signedUrl) urls.set(n, { url: d.signedUrl, at: Date.now() });
        }
      }
    }
    if (box.dataset.key !== key) return;
    for (const n of names) {
      const u = urls.get(n);
      if (u) {
        const a = document.createElement('a');
        a.href = u.url; a.target = '_blank'; a.rel = 'noopener';
        const img = document.createElement('img');
        img.src = u.url; img.alt = n; img.loading = 'lazy';
        a.appendChild(img); box.appendChild(a);
      } else {
        const d = document.createElement('div');
        d.className = 'missing'; d.textContent = navigator.onLine ? 'Picture not synced yet' : 'Picture (offline)';
        box.appendChild(d);
        box.dataset.key = ''; // try again on the next render (after each sync)
      }
    }
  }

  // ---------- editing ----------
  editor.addEventListener('input', () => {
    let t = active();
    if (!t) { t = newTab(''); S.active = t.id; shownId = t.id; }
    const was = titleOf(t.body);
    t.body = editor.value;
    t.dirty = true;
    save();
    if (titleOf(t.body) !== was) render(false); else { renderStatus(); renderImages(t); }
    schedulePush(1200);
  });
  editor.addEventListener('keydown', (e) => {
    const t = active();
    if (e.key === 'Tab' && t && t.code && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      document.execCommand('insertText', false, '\t');
    }
  });
  editor.addEventListener('keyup', renderStatus);
  editor.addEventListener('click', renderStatus);

  $('addTab').onclick = () => {
    const t = newTab('');
    S.active = t.id; save(); render(true); editor.focus();
  };

  const menu = $('menu');
  $('menuBtn').onclick = (e) => {
    e.stopPropagation();
    const t = active();
    menu.querySelector('[data-act=code]').classList.toggle('on', !!(t && t.code));
    menu.querySelector('[data-act=images]').classList.toggle('on', !!(t && !t.images_off));
    menu.hidden = !menu.hidden;
  };
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.hidden = true; });
  menu.addEventListener('click', async (e) => {
    const act = e.target.dataset && e.target.dataset.act;
    if (!act) return;
    menu.hidden = true;
    const t = active();
    if (act === 'sync') return sync();
    if (act === 'signout') return signOut();
    if (!t) return;
    if (act === 'code') { t.code = !t.code; t.dirty = true; }
    else if (act === 'images') { t.images_off = !t.images_off; t.dirty = true; }
    else if (act === 'copy') { try { await navigator.clipboard.writeText(t.body); flash('Copied'); } catch (err) { flash('Copy failed'); } return; }
    else if (act === 'photo') { $('photoInput').click(); return; }
    else if (act === 'left' || act === 'right') {
      const tabs = visible(), i = tabs.indexOf(t), j = act === 'left' ? i - 1 : i + 1;
      if (j < 0 || j >= tabs.length) return;
      const o = tabs[j], s = t.sort;
      t.sort = o.sort; o.sort = s;
      if (t.sort === o.sort) t.sort += act === 'left' ? -0.5 : 0.5;
      t.dirty = o.dirty = true;
    } else if (act === 'close') {
      if (visible().length < 2) { flash('The last tab stays'); return; }
      if (t.body.trim() && !confirm(`Close “${titleOf(t.body)}” and remove its text?\n(The Windows note keeps a copy in its trash folder.)`)) return;
      if (t.rev === 0) delete S.tabs[t.id]; else { t.deleted = true; t.dirty = true; }
      S.active = null;
    }
    save(); render(true); schedulePush(300);
  });

  $('photoInput').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!sb || !uid || !navigator.onLine) { flash('Pictures need a connection'); return; }
    const ext = ((file.name.match(/\.(png|jpe?g|gif|bmp|tiff?|webp)$/i) || [])[1] || (file.type.split('/')[1] || 'png')).toLowerCase().replace('jpeg', 'jpg');
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    const name = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${uuid().replace(/-/g, '')}.${ext}`;
    flash('Uploading picture…');
    const { error } = await sb.storage.from(BUCKET).upload(`${uid}/${name}`, file, { contentType: file.type || 'image/png', upsert: false });
    if (error) { flash('Upload failed: ' + error.message); return; }
    let t = active();
    if (!t) { t = newTab(''); S.active = t.id; }
    const pos = shownId === t.id ? editor.selectionEnd : t.body.length;
    const before = t.body.slice(0, pos), after = t.body.slice(pos);
    const line = (before && !before.endsWith('\n') ? '\n' : '') + 'attachments/' + name + '\n';
    t.body = before + line + after;
    t.dirty = true;
    save(); render(true); schedulePush(300);
  });

  let flashTimer = 0;
  function flash(text) {
    const el = $('status');
    el.textContent = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(renderStatus, 2500);
  }

  // ---------- sync ----------
  function schedulePush(ms) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(sync, ms);
  }

  // Server moved on while this device also changed the tab: the server version wins in the tab,
  // this device's text is kept as a new "Conflict copy" tab. Nothing is lost.
  function conflict(t, row) {
    if (!t.deleted && t.body !== row.body && t.body.trim()) {
      newTab(`Conflict copy (${device}, ${stamp()})\n${t.body}`, { code: t.code, images_off: t.images_off, dirty: true });
    }
    Object.assign(t, fromRow(row));
  }

  async function push() {
    const dirty = Object.values(S.tabs).filter((t) => t.dirty);
    if (!dirty.length) return;
    const sent = dirty.map((t) => ({ id: t.id, base_rev: t.rev || 0, body: t.body, code: t.code,
      images_off: t.images_off, sort: t.sort, deleted: t.deleted, device }));
    const { data, error } = await sb.rpc('notes_push', { p_items: sent });
    if (error) throw error;
    for (const r of data || []) {
      const t = S.tabs[r.id], s = sent.find((x) => x.id === r.id);
      if (!t || !s) continue;
      if (r.status === 'ok') {
        t.rev = r.row.rev;
        if (t.body === s.body && t.code === s.code && t.images_off === s.images_off
            && t.sort === s.sort && t.deleted === s.deleted) t.dirty = false;
        if (t.deleted && !t.dirty) delete S.tabs[t.id];
      } else conflict(t, r.row);
    }
    save();
  }

  async function pull() {
    for (;;) {
      const from = Math.max(0, S.lastSeq - 20); // small overlap: a write may commit with a lower seq
      const { data, error } = await sb.from('notes_tabs')
        .select('id,body,code,images_off,sort,deleted,rev,seq')
        .gt('seq', from).order('seq').limit(500);
      if (error) throw error;
      let max = S.lastSeq;
      for (const row of data) {
        max = Math.max(max, row.seq);
        const t = S.tabs[row.id];
        if (!t) { if (!row.deleted) S.tabs[row.id] = fromRow(row); continue; }
        if (row.rev <= t.rev) continue;
        if (t.dirty) conflict(t, row); else Object.assign(t, fromRow(row));
        if (t.deleted && !t.dirty) delete S.tabs[t.id];
      }
      // a never-used empty tab made before the first pull just disappears
      if (visible().length > 1)
        for (const t of Object.values(S.tabs)) if (t.rev === 0 && !t.dirty && !t.body && t.id !== S.active) delete S.tabs[t.id];
      const more = data.length === 500 && max > S.lastSeq;
      S.lastSeq = max;
      save();
      if (!more) break;
    }
  }

  async function sync() {
    if (!sb || !uid || !navigator.onLine) { renderStatus(); return; }
    if (syncing) { again = true; return; }
    syncing = true;
    renderStatus();
    try {
      await push();
      await pull();
      lastOk = Date.now(); lastErr = '';
    } catch (e) {
      lastErr = (e && (e.message || e.error_description)) || String(e);
      if (/JWT|token|not allowed/i.test(lastErr)) await checkSession();
    }
    syncing = false;
    render(false);
    if (again) { again = false; schedulePush(200); }
  }

  // ---------- sign-in ----------
  async function checkSession() {
    const { data } = await sb.auth.getSession();
    if (!data.session) { uid = null; showLogin('Signed out. Please sign in again.'); }
  }

  function showLogin(msg) {
    $('app').hidden = true;
    $('login').hidden = false;
    $('loginMsg').textContent = msg || '';
  }
  function showApp() {
    $('login').hidden = true;
    $('app').hidden = false;
    if (!visible().length) { const t = newTab(''); S.active = t.id; }
    render(true);
  }

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!sb) { $('loginMsg').textContent = 'No connection.'; return; }
    $('loginMsg').textContent = '';
    const { data, error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
    $('password').value = '';
    if (error) { $('loginMsg').textContent = error.message; return; }
    adopt(data.session);
  });

  function adopt(session) {
    uid = session.user.id;
    if (S.uid && S.uid !== uid) S = blank(); // another account's notes never mix in
    S.uid = uid;
    save();
    showApp();
    sync();
  }

  async function signOut() {
    if (Object.values(S.tabs).some((t) => t.dirty)) {
      if (!confirm('Some changes are not synced yet and would be lost on this device. Sign out anyway?')) return;
    }
    try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { /* offline */ }
    S = blank(); save(); uid = null;
    showLogin('');
  }

  async function boot() {
    if (window.supabase) {
      sb = window.supabase.createClient(SB_URL, SB_KEY, {
        auth: { storageKey: 'notes.auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      });
      const { data } = await sb.auth.getSession();
      if (data.session) return adopt(data.session);
    }
    if (S.uid) { showApp(); return; } // offline with notes from before: work locally
    showLogin(window.supabase ? '' : 'No connection.');
  }

  setInterval(() => { if (!document.hidden) sync(); }, 15000);
  document.addEventListener('visibilitychange', () => sync());
  window.addEventListener('online', () => sync());
  window.addEventListener('offline', renderStatus);
  window.addEventListener('focus', () => sync());

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('notes-sw.js', { scope: './notes' }).catch(() => {});
  boot();
})();
