/* QR Studio · cloud.js
   Everything that needs the owner logged in: the e-mail code login, short links
   that can be edited after printing, uploads, scan statistics and stored files.
   Anyone can use the rest of the studio without ever touching this file. */
(function () {
  'use strict';
  const QS = (window.QS = window.QS || {});
  const U = QS.util;

  const SUPABASE_URL = 'https://ljkdibnkifzwydhqkzxt.supabase.co';
  /* publishable key — safe in the page by design; every table is behind RLS */
  const SUPABASE_KEY = 'sb_publishable_1vEjb3RhVFo54KZM948PCA_A_9SpAgQ';
  const BUCKET = 'qr-media';
  const SHORT_BASE = 'https://dump.yanikroesti.ch/q/';
  const MAX_UPLOAD = 50 * 1024 * 1024;

  let client = null;
  let clientPromise = null;
  const state = { ready: false, email: '', owner: false, checking: false };
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => { try { fn(state); } catch (e) { /* ignore */ } });

  function ready() {
    if (!clientPromise) {
      clientPromise = U.loadScript(QS.CDN.supabase).then(async () => {
        client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
          auth: {
            storageKey: 'qrstudio.auth',
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false
          }
        });
        client.auth.onAuthStateChange((evt, session) => {
          state.email = (session && session.user && session.user.email) || '';
          if (!session) { state.owner = false; emit(); }
        });
        const { data } = await client.auth.getSession();
        state.email = (data && data.session && data.session.user && data.session.user.email) || '';
        state.ready = true;
        if (data && data.session) await refreshOwner();
        emit();
        return client;
      });
    }
    return clientPromise;
  }

  async function refreshOwner() {
    try {
      const { data, error } = await client.rpc('qr_me');
      state.owner = !error && !!(data && data.owner);
    } catch (e) {
      state.owner = false;
    }
    emit();
    return state.owner;
  }

  /* Supabase speaks in codes; people need sentences. */
  function authMessage(error) {
    const msg = String((error && error.message) || error || '');
    if (/not authorized/i.test(msg)) {
      return 'Supabase only mails login codes to addresses on your Supabase team. Add this address under Organisation → Team, or use the address your Supabase account uses.';
    }
    if (/Signups not allowed/i.test(msg)) return 'That address is not the owner address for this studio.';
    if (/rate limit|only request this after|too many/i.test(msg)) return 'Too many code requests — wait a minute and try again.';
    if (/expired|invalid/i.test(msg)) return 'That code is wrong or has expired. Ask for a new one.';
    if (/fetch|network/i.test(msg)) return 'No connection to the server.';
    return msg || 'Login failed.';
  }

  async function sendCode(email) {
    await ready();
    const clean = String(email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return { ok: false, error: 'Enter a valid e-mail address.' };
    const { error } = await client.auth.signInWithOtp({ email: clean, options: { shouldCreateUser: false } });
    if (error) return { ok: false, error: authMessage(error) };
    U.store.set('qrstudio.email', clean);
    return { ok: true };
  }

  async function verifyCode(email, token) {
    await ready();
    const code = String(token || '').replace(/\D/g, '');
    if (code.length < 6) return { ok: false, error: 'The code is six digits.' };
    const { error } = await client.auth.verifyOtp({ email: String(email || '').trim(), token: code, type: 'email' });
    if (error) return { ok: false, error: authMessage(error) };
    state.email = String(email || '').trim();
    const owner = await refreshOwner();
    if (!owner) return { ok: false, error: 'Signed in, but this account is not the studio owner.' };
    return { ok: true };
  }

  async function signOut() {
    await ready();
    await client.auth.signOut();
    state.owner = false;
    state.email = '';
    emit();
  }

  async function rpc(name, params) {
    await ready();
    const { data, error } = await client.rpc(name, params || {});
    if (error) {
      if (error.code === '42501' || /unauthorized/i.test(error.message || '')) {
        state.owner = false;
        emit();
        throw new Error('Your session expired — log in again.');
      }
      throw new Error(error.message || 'Request failed.');
    }
    return data;
  }

  /* ── codes ── */
  const list = () => rpc('qr_list');
  const batchCodes = batchId => rpc('qr_batch_codes', { p_batch_id: batchId });
  const save = data => rpc('qr_save', { p_data: data });
  const remove = ids => rpc('qr_delete', { p_ids: ids });
  const reset = ids => rpc('qr_reset', { p_ids: ids });
  const batchCreate = (data, count, label) => rpc('qr_batch_create', { p_data: data, p_count: count, p_label: label });
  const stats = (ids, days) => rpc('qr_stats', { p_ids: ids && ids.length ? ids : null, p_days: days || 30 });
  const exportScans = ids => rpc('qr_export', { p_ids: ids && ids.length ? ids : null });
  const files = () => rpc('qr_files');
  const shortURL = slug => SHORT_BASE + slug;

  /* ── uploads ── */
  function storagePath(name) {
    const d = new Date();
    const stamp = `${d.getFullYear()}${U.pad2(d.getMonth() + 1)}`;
    const safe = String(name || 'file').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'file';
    return `m/${stamp}/${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}/${safe}`;
  }
  const publicURL = path => `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;

  /* XHR rather than supabase-js so the progress bar is real */
  async function upload(file, { onProgress, optimise = true } = {}) {
    await ready();
    if (!state.owner) throw new Error('Log in first.');
    const { data } = await client.auth.getSession();
    const token = data && data.session && data.session.access_token;
    if (!token) throw new Error('Your session expired — log in again.');

    let body = file;
    if (optimise && /^image\//.test(file.type) && !/svg/.test(file.type)) {
      try {
        const small = await U.shrinkImage(file, { max: 2000, quality: 0.86 });
        if (small.blob && small.blob.size < file.size) body = small.blob;
      } catch (e) { /* keep the original */ }
    }
    if (body.size > MAX_UPLOAD) {
      throw new Error(`${file.name} is ${U.bytesHuman(body.size)} — the limit is 50 MB. For longer videos paste a YouTube or Drive link instead.`);
    }
    const path = storagePath(file.name);
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`);
      xhr.setRequestHeader('authorization', 'Bearer ' + token);
      xhr.setRequestHeader('apikey', SUPABASE_KEY);
      xhr.setRequestHeader('x-upsert', 'false');
      xhr.setRequestHeader('cache-control', 'max-age=31536000');
      if (file.type) xhr.setRequestHeader('content-type', file.type);
      xhr.upload.onprogress = e => { if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve();
        let msg = 'Upload failed (' + xhr.status + ')';
        try {
          const j = JSON.parse(xhr.responseText);
          if (/mime|content type/i.test(j.message || '')) msg = `${file.name}: that file type is not allowed.`;
          else if (/exceeded|maximum/i.test(j.message || '')) msg = `${file.name} is too large (50 MB limit).`;
          else if (j.message) msg = j.message;
        } catch (e) { /* keep default */ }
        reject(new Error(msg));
      };
      xhr.onerror = () => reject(new Error('Upload failed — check your connection.'));
      xhr.send(body);
    });
    return { url: publicURL(path), path, name: file.name, size: body.size, mime: file.type || 'application/octet-stream' };
  }

  async function deleteFiles(paths) {
    await ready();
    const { error } = await client.storage.from(BUCKET).remove(paths);
    if (error) throw new Error(error.message || 'Could not delete the file.');
    return true;
  }

  /* ── dynamic code helpers used by the UI ── */
  /* Strips a design down to what is safe to store next to a code. */
  function slimDesign(design) {
    const d = JSON.parse(JSON.stringify(design || {}));
    const big = s => typeof s === 'string' && s.startsWith('data:') && s.length > 60000;
    if (d.logo && big(d.logo.src)) { d.logo = Object.assign({}, d.logo, { src: null, kind: null }); }
    if (d.bg && big(d.bg.image)) { d.bg = Object.assign({}, d.bg, { image: null, type: d.bg.type === 'image' ? 'solid' : d.bg.type }); }
    if (d.fill && big(d.fill.image)) { d.fill = Object.assign({}, d.fill, { image: null, type: d.fill.type === 'image' ? 'solid' : d.fill.type }); }
    return d;
  }

  const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };

  QS.cloud = {
    SUPABASE_URL, SUPABASE_KEY, BUCKET, SHORT_BASE, MAX_UPLOAD,
    state, ready, onChange, sendCode, verifyCode, signOut, refreshOwner,
    list, save, remove, reset, batchCreate, batchCodes, stats, exportScans, files,
    upload, deleteFiles, publicURL, shortURL, slimDesign, rpc,
    get client() { return client; }
  };
})();
