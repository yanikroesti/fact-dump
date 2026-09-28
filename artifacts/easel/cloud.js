/* Easel — cloud (Supabase project "easel"): owner login by e-mail code, design sync across
   devices, images in storage, version history and share links. Visitors never load any of
   this unless they open a share link; their designs stay in their own browser. */
(() => {
const EZ = window.EZ;

const URL_ = 'https://vcglqoqtcsiqfjutizib.supabase.co';
/* publishable key — safe in the page by design; every table is behind RLS (owner only) */
const KEY = 'sb_publishable_fbTatnQ1Dpu9uhTWI0hMEA_1FizA6MU';
const BUCKET = 'easel-assets';
const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.min.js';
const AUTH_KEY = 'easel.auth';

EZ.ASSET_BASE = `${URL_}/storage/v1/object/public/${BUCKET}/`;

let client = null, clientP = null;
const state = { ready: false, email: '', owner: false, sync: 'idle' };
const listeners = new Set();
const emit = () => listeners.forEach(fn => { try { fn(state); } catch (e) { console.warn(e); } });

const loadScript = src => new Promise((res, rej) => {
  const s = document.createElement('script');
  s.src = src; s.crossOrigin = 'anonymous'; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src));
  document.head.append(s);
});

function init() {
  if (!clientP) {
    clientP = loadScript(LIB).then(async () => {
      client = window.supabase.createClient(URL_, KEY, {
        // implicit flow: the login link works even when opened in another browser than the one that asked for it
        auth: { storageKey: AUTH_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'implicit' },
      });
      client.auth.onAuthStateChange((_evt, session) => {
        state.email = session?.user?.email || '';
        if (!session && state.owner) { state.owner = false; emit(); }
      });
      const { data } = await client.auth.getSession();
      state.email = data?.session?.user?.email || '';
      if (data?.session) await refreshOwner();
      state.ready = true;
      emit();
      return client;
    });
    clientP.catch(() => { clientP = null; });
  }
  return clientP;
}
async function refreshOwner() {
  try { const { data, error } = await client.rpc('easel_me'); state.owner = !error && !!data?.owner; }
  catch { state.owner = false; }
  emit();
  return state.owner;
}
const hasSession = () => { try { return !!localStorage.getItem(AUTH_KEY); } catch { return false; } };

function authMessage(error) {
  const msg = String(error?.message || error || '');
  if (/not authorized/i.test(msg)) return 'Supabase only mails login codes to addresses on your Supabase team.';
  if (/Signups not allowed|user not found/i.test(msg)) return 'That address is not the owner address for Easel.';
  if (/rate limit|only request this after|too many/i.test(msg)) return 'Too many login e-mails requested — wait a few minutes and try again.';
  if (error?.code === 'email_address_invalid' || /email address .* is invalid/i.test(msg)) return 'Supabase rejected that e-mail address.';
  if (/expired|invalid/i.test(msg)) return 'That code is wrong or has expired. Ask for a new one.';
  if (/fetch|network/i.test(msg)) return 'No connection to the server.';
  return msg || 'Login failed.';
}
async function sendCode(email) {
  await init();
  const clean = String(email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return { ok: false, error: 'Enter a valid e-mail address.' };
  // The e-mail's "Log In" link comes back to this page (if the URL is allowed in Supabase) with the session in the hash.
  const { error } = await client.auth.signInWithOtp({ email: clean, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } });
  if (error) return { ok: false, error: authMessage(error) };
  try { localStorage.setItem('easel.email', clean); } catch {}
  return { ok: true };
}
async function finishSignIn() {
  if (!(await refreshOwner())) { await client.auth.signOut(); return { ok: false, error: 'Signed in, but this account is not the Easel owner.' }; }
  syncAll();
  return { ok: true };
}
// Accepts what the user pastes: the link from the e-mail, the address of the page the link
// opened (…#access_token=…), or a numeric code if the e-mail template ever contains one.
async function verifyCode(email, input) {
  await init();
  const raw = String(input || '').trim();
  const tokens = raw.match(/access_token=([^&\s]+)/) && raw.match(/refresh_token=([^&\s]+)/);
  if (tokens) {
    const access = decodeURIComponent(raw.match(/access_token=([^&\s]+)/)[1]);
    const refresh = decodeURIComponent(raw.match(/refresh_token=([^&\s]+)/)[1]);
    const { error } = await client.auth.setSession({ access_token: access, refresh_token: refresh });
    if (error) return { ok: false, error: authMessage(error) };
    return finishSignIn();
  }
  const link = raw.match(/[?&]token=([^&\s]+)/);
  if (link) {
    const type = (raw.match(/[?&]type=([a-z_]+)/) || [])[1] || 'magiclink';
    const { error } = await client.auth.verifyOtp({ token_hash: decodeURIComponent(link[1]), type });
    if (error) return { ok: false, error: /expired|invalid/i.test(error.message || '') ? 'That link was already used or has expired — ask for a new one.' : authMessage(error) };
    return finishSignIn();
  }
  const code = raw.replace(/\D/g, '');
  if (code.length < 6) return { ok: false, error: 'Paste the link from the e-mail (long-press “Log In” → copy link).' };
  const { error } = await client.auth.verifyOtp({ email: String(email || '').trim(), token: code, type: 'email' });
  if (error) return { ok: false, error: authMessage(error) };
  return finishSignIn();
}
// Password sign-in — no e-mail involved (Supabase's built-in mailer is too rate-limited to rely on).
async function signInPassword(email, password) {
  await init();
  const clean = String(email || '').trim();
  const { error } = await client.auth.signInWithPassword({ email: clean, password: String(password || '') });
  if (error) return { ok: false, error: /invalid login|credentials/i.test(error.message || '') ? 'E-mail or password is wrong. First time here? Use “Set a password”.' : authMessage(error) };
  try { localStorage.setItem('easel.email', clean); } catch {}
  return finishSignIn();
}
// First-time (or forgotten) password: a one-time setup code from the project owner's database.
async function setupPassword(email, code, password) {
  await init();
  const { data, error } = await client.rpc('easel_set_owner_password', { p_code: String(code || '').trim(), p_password: String(password || '') });
  if (error) return { ok: false, error: authMessage(error) };
  if (!data?.ok) return { ok: false, error: data?.error || 'Could not set the password.' };
  return signInPassword(email || data.email, password);
}
// Called at boot when the login link brought us back here with #access_token=… in the address.
async function consumeRedirect() {
  const hash = location.hash;
  const clean = () => history.replaceState(null, '', location.pathname + location.search);
  if (/error_description=/.test(hash)) {
    const msg = decodeURIComponent((hash.match(/error_description=([^&]+)/) || [])[1] || '').replace(/\+/g, ' ');
    clean();
    return { ok: false, error: /expired|invalid/i.test(msg) ? 'That login link was already used or has expired — ask for a new one.' : msg || 'Login failed.' };
  }
  if (!/access_token=/.test(hash)) return null;
  await init();
  const r = await verifyCode('', hash);
  clean();
  return r;
}
async function signOut() {
  await init();
  await client.auth.signOut();
  state.owner = false; state.email = ''; state.sync = 'idle';
  emit();
}

const check = ({ data, error }) => {
  if (error) {
    if (error.code === '42501' || /JWT|unauthori[sz]ed|permission/i.test(error.message || '')) { state.owner = false; emit(); throw new Error('Your session expired — sign in again.'); }
    throw new Error(error.message || 'Request failed');
  }
  return data;
};

/* ── assets ── */
async function uploadAssets(ids) {
  for (const id of ids) {
    const rec = await EZ.db.get('assets', id).catch(() => null);
    if (!rec?.blob || rec.cloud) continue;
    const { error } = await client.storage.from(BUCKET).upload(id, rec.blob, { contentType: rec.blob.type || 'image/png', upsert: true, cacheControl: '31536000' });
    if (error && !/exists|duplicate/i.test(error.message || '')) throw new Error('Image upload failed: ' + error.message);
    rec.cloud = true;
    await EZ.db.put('assets', rec);
  }
}

/* ── designs ── */
const strip = d => ({
  id: d.id, name: d.name || 'Untitled design', w: Math.round(d.w), h: Math.round(d.h), mm: d.mm || null,
  pages: d.pages.map(p => ({ id: p.id, json: p.json })), thumb: d.thumb || null,
  updated: Math.round(d.updated || Date.now()), created: Math.round(d.created || Date.now()), deleted_at: null,
});
const fromRow = r => ({ id: r.id, name: r.name, w: r.w, h: r.h, mm: r.mm, pages: r.pages || [], thumb: r.thumb, updated: +r.updated, created: +r.created, cloud: true });

async function push(d) {
  await init();
  if (!state.owner) return;
  await uploadAssets(EZ.assetIdsIn(JSON.stringify(d.pages)));
  check(await client.from('designs').upsert(strip(d)));
}
const pending = new Set();
const flush = EZ.debounce(async () => {
  if (!state.owner || !pending.size) return;
  const ids = [...pending]; pending.clear();
  setSync('syncing');
  try {
    for (const id of ids) {
      const d = EZ.doc?.id === id ? EZ.doc : await EZ.getDesign(id);
      if (d) await push(d);
    }
    setSync('ok');
  } catch (e) {
    console.warn('sync failed', e);
    ids.forEach(id => pending.add(id));
    setSync('error', e.message);
    setTimeout(() => flush(), 20000);
  }
}, 2500);
function setSync(s, msg) { state.sync = s; state.syncError = msg || ''; emit(); }
const queuePush = id => { if (!state.owner) return; pending.add(id); setSync('pending'); flush(); };

async function list() {
  await init();
  if (!state.owner) return [];
  return check(await client.from('designs').select('id,name,w,h,mm,thumb,updated,created,page_count').is('deleted_at', null).order('updated', { ascending: false }).limit(500));
}
async function pull(id) {
  await init();
  const rows = check(await client.from('designs').select('*').eq('id', id).is('deleted_at', null).limit(1));
  return rows?.[0] ? fromRow(rows[0]) : null;
}
// Returns the cloud copy when it is newer than the local one (edited on another device).
async function freshen(local) {
  if (!state.owner) return local;
  try {
    const rows = check(await client.from('designs').select('updated').eq('id', local.id).is('deleted_at', null).limit(1));
    if (rows?.[0] && +rows[0].updated > (local.updated || 0) + 500) {
      const d = await pull(local.id);
      if (d) { await EZ.putDesign(d); return d; }
    }
  } catch (e) { console.warn('freshen failed', e); }
  return local;
}
async function remove(id) {
  await init();
  if (!state.owner) return;
  check(await client.from('designs').update({ deleted_at: new Date().toISOString() }).eq('id', id));
}
// After signing in: upload every local design the cloud doesn't have (or has older).
async function syncAll() {
  if (!state.owner) return;
  try {
    const cloud = new Map((await list()).map(r => [r.id, +r.updated]));
    for (const d of await EZ.listDesigns()) if (!cloud.has(d.id) || cloud.get(d.id) < (d.updated || 0)) pending.add(d.id);
    if (pending.size) { setSync('pending'); flush.flush(); } else setSync('ok');
  } catch (e) { setSync('error', e.message); }
}

/* ── versions ── */
async function versions(designId) {
  await init();
  return check(await client.from('design_versions').select('id,created_at,label,auto,name,w,h,thumb').eq('design_id', designId).order('created_at', { ascending: false }).limit(100))
    .map(v => ({ id: v.id, at: Date.parse(v.created_at), label: v.label, auto: v.auto, name: v.name, w: v.w, h: v.h, thumb: v.thumb }));
}
async function saveVersion(d, label = null, auto = true) {
  await init();
  await push(d); // the version row references the design row
  const s = strip(d);
  check(await client.from('design_versions').insert({ design_id: d.id, label, auto, name: s.name, w: s.w, h: s.h, mm: s.mm, pages: s.pages, thumb: s.thumb }));
}
async function getVersion(id) {
  await init();
  const rows = check(await client.from('design_versions').select('*').eq('id', id).limit(1));
  const v = rows?.[0];
  return v ? { id: v.id, at: Date.parse(v.created_at), label: v.label, name: v.name, w: v.w, h: v.h, mm: v.mm, pages: v.pages, thumb: v.thumb } : null;
}

/* ── share links ── */
const token = () => { const a = new Uint8Array(18); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_'); };
async function shares(designId) {
  await init();
  return check(await client.from('shares').select('token,mode,created_at,views').eq('design_id', designId).order('created_at', { ascending: false }));
}
async function createShare(d, mode) {
  await init();
  await push(d);
  const t = token();
  check(await client.from('shares').insert({ token: t, design_id: d.id, mode }));
  return t;
}
async function deleteShare(t) { await init(); check(await client.from('shares').delete().eq('token', t)); }
async function getShare(t) { await init(); return check(await client.rpc('easel_get_share', { p_token: t })); }
const shareUrl = t => `${location.origin}${location.pathname}#s=${t}`;

EZ.cloud = {
  state, on: fn => { listeners.add(fn); return () => listeners.delete(fn); },
  init, hasSession, sendCode, verifyCode, consumeRedirect, signOut, signInPassword, setupPassword,
  queuePush, flush: () => flush.flush(), syncAll, list, pull, freshen, remove,
  versions, saveVersion, getVersion,
  shares, createShare, deleteShare, getShare, shareUrl,
};
})();
