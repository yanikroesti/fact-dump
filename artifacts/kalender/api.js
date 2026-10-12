// Zäme — talking to Supabase (project "easel", tables cal_*) and the cal-api edge function.
// The publishable key is safe in the page: every table is behind RLS and all writes go through RPCs.

export const SB_URL = 'https://vcglqoqtcsiqfjutizib.supabase.co';
const KEY = 'sb_publishable_fbTatnQ1Dpu9uhTWI0hMEA_1FizA6MU';
export const FN = `${SB_URL}/functions/v1/cal-api`;
const AUTH_KEY = 'zaeme.auth';

export let sb = null;

export function init() {
  sb = window.supabase.createClient(SB_URL, KEY, {
    auth: { storageKey: AUTH_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return sb;
}

const check = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

// ---- auth ----
export async function session() { return (await sb.auth.getSession()).data.session; }
export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(/invalid/i.test(error.message) ? 'err_login' : error.message);
}
// local only: the same Supabase user may be signed in to Easel/systemzzz elsewhere
export const signOut = () => sb.auth.signOut({ scope: 'local' });

async function fn(path, body, { auth = true } = {}) {
  const headers = { 'content-type': 'application/json', apikey: KEY };
  if (auth) {
    const s = await session();
    if (s) headers.authorization = `Bearer ${s.access_token}`;
  }
  const r = await fetch(FN + path, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
export const join = (b) => fn('/join', b, { auth: false });
export const resetPassword = (b) => fn('/reset', b, { auth: false });
export const googleStart = () => fn('/google/start');
export const appleConnect = (apple_id, app_password) => fn('/apple/connect', { apple_id, app_password });
export const disconnect = (provider, member_id) => fn('/disconnect', { provider, member_id });
export const syncNow = (all = false) => fn('/sync', { all });
export const testPush = () => fn('/test-push');
export async function vapidKey() { return (await (await fetch(FN + '/vapid')).json()).key; }
export const feedUrl = (token) => `${FN}/ics/${token}.ics`;

// ---- reads ----
export const me = async () => check(await sb.rpc('cal_me'));
export async function loadAll() {
  const since = new Date(Date.now() - 1000 * 86400 * 120).toISOString();
  const [settings, members, categories, events, changes, conns] = await Promise.all([
    sb.from('cal_settings').select('*').eq('id', 1).single().then(check),
    sb.from('cal_members').select('id,name,role,color,lang,active,created_at').order('created_at').then(check),
    sb.from('cal_categories').select('*').order('sort').then(check),
    sb.from('cal_events').select('*').in('status', ['active', 'pending']).then(check),
    sb.from('cal_changes').select('*').or(`status.eq.pending,created_at.gte.${since}`).order('created_at', { ascending: false }).limit(400).then(check),
    // column grants: creds and sync state are not readable from the browser, so no select('*')
    sb.from('cal_connections').select('id,member_id,provider,account_label,calendar_id,status,last_error,last_sync_at,created_at').then(check),
  ]);
  return { settings, members, categories, events, changes, conns };
}
export async function eventHistory(eventId) {
  return check(await sb.from('cal_changes').select('*').eq('event_id', eventId).order('created_at', { ascending: false }).limit(30));
}

// ---- writes (all approval logic is in the database) ----
export const propose = async (kind, eventId, data, note) =>
  check(await sb.rpc('cal_propose', { p_kind: kind, p_event: eventId, p_data: data, p_note: note || null }));
export const decide = async (changeId, approve, reply) =>
  check(await sb.rpc('cal_decide', { p_change: changeId, p_approve: approve, p_reply: reply || null }));
export const withdraw = async (changeId) => check(await sb.rpc('cal_withdraw', { p_change: changeId }));
export const setMyLang = async (l) => check(await sb.rpc('cal_set_my_lang', { p_lang: l }));
export const newIcsToken = async () => check(await sb.rpc('cal_new_ics_token'));
export const savePush = async (endpoint, p256dh, auth) => check(await sb.rpc('cal_save_push', { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth }));
export const dropPush = async (endpoint) => check(await sb.rpc('cal_drop_push', { p_endpoint: endpoint }));

// ---- admin ----
export const admin = {
  members: async () => check(await sb.rpc('cal_admin_members')),
  codes: async () => check(await sb.rpc('cal_admin_codes')),
  makeCode: async (kind, name, role, member) => check(await sb.rpc('cal_make_code', { p_kind: kind, p_name: name || null, p_role: role || null, p_member: member || null })),
  updateSettings: async (patch) => check(await sb.from('cal_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1)),
  updateMember: async (id, patch) => check(await sb.from('cal_members').update(patch).eq('id', id)),
  saveCategory: async (c) => c.id
    ? check(await sb.from('cal_categories').update({ names: c.names, icon: c.icon, color: c.color, approval: c.approval, sort: c.sort, archived: c.archived }).eq('id', c.id))
    : check(await sb.from('cal_categories').insert({ names: c.names, icon: c.icon, color: c.color, approval: c.approval, sort: c.sort })),
  revert: async (changeId) => check(await sb.rpc('cal_revert', { p_change: changeId })),
  google: async () => check(await sb.rpc('cal_admin_google')),
  setGoogle: async (id, secret) => check(await sb.rpc('cal_admin_set_google', { p_client_id: id || null, p_client_secret: secret || null })),
};

// ---- live updates ----
export function subscribe(onChange) {
  let timer = null;
  const ping = () => { clearTimeout(timer); timer = setTimeout(onChange, 250); };
  return sb.channel('zaeme')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cal_events' }, ping)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cal_changes' }, ping)
    .subscribe();
}
