// Zäme — shared family calendar. Parents propose, the other parent (or the admin) confirms,
// depending on each category's rule. Everything that decides who must agree lives in the database
// (cal_propose / cal_decide); this file only shows it and mirrors the rule to explain it up front.

import { catLabel, getLang, LANGS, locale, setLang, t } from './i18n.js';
import * as api from './api.js';
import * as D from './dates.js';
import * as push from './push.js';
import { choose, closeAll, confirmBox, copyText, h, icon, sheet, toast } from './ui.js';
import { drawMain, loadPrefs, toolbar } from './views.js';

const S = {
  me: null, settings: null, members: [], categories: [], events: [], changes: [], conns: [],
  view: 'month', hidden: new Set(), selected: D.todayKey(), listDays: 60,
};
export const state = S;
const app = () => document.getElementById('app');

// ───────────── lookups + rules (mirror of the SQL) ─────────────

export const member = (id) => S.members.find((m) => m.id === id);
export const category = (id) => S.categories.find((c) => c.id === id);
const parents = () => S.members.filter((m) => m.active && m.role === 'parent');
const admins = () => S.members.filter((m) => m.active && m.role === 'admin');
const RANK = ['none', 'partner_or_admin', 'partner', 'admin'];

function ruleFor(oldCat, newCat, isCreate) {
  const d = S.settings.default_approval;
  const a = isCreate ? 'none' : (category(oldCat)?.approval ?? d);
  const b = category(newCat)?.approval ?? d;
  return RANK.indexOf(a) > RANK.indexOf(b) ? a : b;
}
function approvers(rule, proposerId = S.me.id) {
  const others = parents().filter((m) => m.id !== proposerId);
  if (rule === 'partner') return others;
  if (rule === 'admin') return admins();
  if (rule === 'partner_or_admin') return [...others, ...admins()];
  return [];
}
const names = (list) => {
  const n = list.map((m) => m.name);
  if (n.length <= 1) return n.join('');
  return new Intl.ListFormat(getLang() === 'vi' ? 'vi' : getLang(), { type: 'disjunction' }).format(n);
};
export function canDecide(c) {
  const m = S.me;
  if (!m || c.status !== 'pending' || m.role === 'viewer') return false;
  if (m.role === 'admin' && (S.settings.admin_override || ['admin', 'partner_or_admin'].includes(c.rule))) return true;
  if (c.proposed_by === m.id) return false;
  return m.role === 'parent' && ['partner', 'partner_or_admin'].includes(c.rule);
}
const pendingOf = (eventId) => S.changes.filter((c) => c.event_id === eventId && c.status === 'pending');
const toDecide = () => S.changes.filter(canDecide);
export const evColor = (ev) => category(ev.category_id)?.color || member(ev.responsible)?.color || '#3b6ef5';

export function errText(e) {
  const k = String(e?.message || e || '');
  for (const key of [`err_${k}`, k]) { const s = t(key); if (s !== key) return s; }
  if (/permission|jwt|not a member/i.test(k)) return t('not_member');
  return k || t('error');
}
const fail = (e) => toast(errText(e), 'err');

const logo = () => h('img.logo-mark', { src: 'kalender/logo.svg', alt: 'Zäme', width: 44, height: 44 });

// ───────────── boot ─────────────

export async function boot() {
  D.setRRule(window.rrule);
  api.init();
  push.register();
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type === 'open') { location.hash = new URL(e.data.url).hash; handleHash(); }
  });
  window.addEventListener('hashchange', handleHash);
  const s = await api.session();
  if (s) await enter(); else showLogin(hashParam('join') ? 'join' : 'login');
}

function hashParam(k) {
  return new URLSearchParams(location.hash.slice(1)).get(k);
}

async function enter() {
  app().replaceChildren(h('div.splash', logo(), h('p', t('loading'))));
  let r;
  try { r = await api.me(); } catch (e) { r = null; console.warn(e); }
  if (!r?.member) {
    await api.signOut();
    showLogin('login', t('not_member'));
    return;
  }
  S.me = r.member;
  setLang(S.me.lang);
  loadPrefs();
  try { await reload(); } catch (e) { fail(e); }
  render();
  api.subscribe(async () => { await reload(); refresh(); });
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && S.me) { await reload(); refresh(); }
  });
  handleHash();
}

async function reload() {
  Object.assign(S, await api.loadAll());
}

function handleHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (!S.me || ![...p.keys()].length) return;
  history.replaceState(null, '', location.pathname + location.search);
  const sync = p.get('sync');
  if (sync) {
    toast(t(sync), /ok$/.test(sync) ? '' : 'err');
    openSettings();
  }
  const c = p.get('c');
  if (c) {
    const ch = S.changes.find((x) => x.id === c);
    const ev = ch && S.events.find((e) => e.id === ch.event_id);
    if (ev) openEvent(ev); else openInbox();
  }
}

// ───────────── login / join / reset ─────────────

function showLogin(mode = 'login', message = '') {
  const code = hashParam('join') || '';
  const box = h('div.login-card');
  const langBar = h('div.lang-bar', LANGS.map((l) => h(`button.chip${getLang() === l.code ? '.on' : ''}`, {
    type: 'button', onclick: () => { setLang(l.code); showLogin(mode, message); },
  }, l.label)));
  const msg = h('p.form-msg', message);
  const say = (s, ok = false) => { msg.textContent = s; msg.classList.toggle('ok', ok); };
  const field = (label, input) => h('label.field', h('span', label), input);
  const busy = (btn, on) => { btn.disabled = on; btn.classList.toggle('busy', on); };

  let form;
  if (mode === 'login') {
    const email = h('input', { type: 'email', autocomplete: 'username', required: true, autofocus: true });
    const pw = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    const btn = h('button.btn.primary.block', { type: 'submit' }, t('sign_in'));
    form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); busy(btn, true); say('');
        try { await api.signIn(email.value, pw.value); await enter(); }
        catch (err) { say(errText(err)); busy(btn, false); }
      },
    }, field(t('email'), email), field(t('password'), pw), btn,
    h('div.login-links',
      h('button.link', { type: 'button', onclick: () => showLogin('join') }, t('have_invite')),
      h('button.link', { type: 'button', onclick: () => showLogin('reset') }, t('forgot'))));
  } else if (mode === 'join') {
    const c = h('input', { value: code, required: true, autocomplete: 'off', placeholder: 'ABCD-EFGH', style: { textTransform: 'uppercase' } });
    const name = h('input', { required: true, autocomplete: 'given-name', autofocus: !!code });
    const email = h('input', { type: 'email', required: true, autocomplete: 'username' });
    const pw = h('input', { type: 'password', required: true, minlength: '8', autocomplete: 'new-password' });
    const btn = h('button.btn.primary.block', { type: 'submit' }, t('create_account'));
    form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); busy(btn, true); say('');
        try {
          await api.join({ code: c.value, name: name.value, email: email.value, password: pw.value, lang: getLang() });
          await api.signIn(email.value, pw.value);
          history.replaceState(null, '', location.pathname);
          await enter();
          toast(t('welcome', { n: name.value }));
        } catch (err) { say(errText(err)); busy(btn, false); }
      },
    }, field(t('invite_code'), c), field(t('your_name'), name), field(t('email'), email), field(t('choose_password'), pw), btn,
    h('div.login-links', h('button.link', { type: 'button', onclick: () => showLogin('login') }, t('back_to_login'))));
  } else {
    const email = h('input', { type: 'email', required: true, autocomplete: 'username' });
    const c = h('input', { required: true, autocomplete: 'off', placeholder: 'ABCD-EFGH', style: { textTransform: 'uppercase' } });
    const pw = h('input', { type: 'password', required: true, minlength: '8', autocomplete: 'new-password' });
    const btn = h('button.btn.primary.block', { type: 'submit' }, t('set_password'));
    form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); busy(btn, true); say('');
        try {
          await api.resetPassword({ email: email.value, code: c.value, password: pw.value });
          showLogin('login', t('password_set'));
        } catch (err) { say(errText(err)); busy(btn, false); }
      },
    }, h('p.hint', t('reset_hint')), field(t('email'), email), field(t('reset_code'), c), field(t('new_password'), pw), btn,
    h('div.login-links', h('button.link', { type: 'button', onclick: () => showLogin('login') }, t('back_to_login'))));
  }
  box.append(h('div.brand.big', logo(), h('div', h('strong', 'Zäme'), h('small', t('app_sub')))), langBar, msg, form);
  app().replaceChildren(h('div.login', box));
  if (message && mode === 'login' && message === t('password_set')) msg.classList.add('ok');
}

// ───────────── main screen ─────────────

function render() {
  const shell = h('div.shell',
    h('header.top',
      h('div.brand', logo(), h('div', h('strong', 'Zäme'), h('small', S.settings.calendar_name || t('app_sub')))),
      h('div.top-actions',
        h('button.icon-btn.bell', { type: 'button', 'aria-label': t('inbox'), onclick: openInbox }, icon('bell'), h('span.badge#badge')),
        S.me.role === 'admin' ? h('button.icon-btn', { type: 'button', 'aria-label': t('admin'), onclick: () => import('./admin.js').then((m) => m.openAdmin()) }, icon('shield')) : null,
        h('button.avatar', { type: 'button', 'aria-label': t('settings'), onclick: openSettings, style: { background: S.me.color } }, (S.me.name || '?').slice(0, 1).toUpperCase()))),
    h('div#banner'),
    toolbar(refresh),
    h('main#main'),
    S.me.role !== 'viewer' ? h('button.fab', { type: 'button', 'aria-label': t('add_event'), onclick: () => openEditor({ mode: 'new', date: S.selected }) }, icon('plus'), h('span', t('add_event'))) : null,
  );
  app().replaceChildren(shell);
  refresh();
}

function refresh() {
  if (!document.getElementById('main')) return;
  const n = toDecide().length;
  const badge = document.getElementById('badge');
  badge.textContent = n ? String(n) : '';
  badge.hidden = !n;
  document.getElementById('banner').replaceChildren(n ? h('button.banner', { type: 'button', onclick: openInbox },
    h('span.pulse'), h('span', n === 1 ? t('inbox_banner_1') : t('inbox_banner_n', { n })), h('strong', t('look'), ' →')) : '');
  drawMain();
}

function statusLine(ev) {
  const pend = pendingOf(ev.id);
  if (!pend.length) return null;
  const c = pend[0];
  if (canDecide(c)) return h('span.tag.ask', '● ', t('to_decide'));
  if (c.proposed_by === S.me.id) return h('span.tag.wait', '⏳ ', t('waiting_for', { n: names(approvers(c.rule)) || '…' }));
  return h('span.tag.wait', '⏳ ', t('waiting'));
}

export function occCard(o) {
  const ev = o.ev;
  const cat = category(ev.category_id);
  const resp = member(ev.responsible);
  return h(`button.occ${ev.status === 'pending' ? '.pending' : ''}`, { type: 'button', style: { '--c': evColor(ev) }, onclick: () => openEvent(ev, o) },
    h('span.occ-time', occTime(o)),
    h('span.occ-main',
      h('strong', ev.title),
      h('span.occ-meta',
        cat ? h('span', `${cat.icon} ${catLabel(cat)}`) : null,
        resp ? h('span.who', { style: { '--m': resp.color } }, resp.name) : null,
        ev.location ? h('span', icon('pin'), ev.location) : null,
        ev.rrule ? h('span', icon('repeat')) : null),
      statusLine(ev)));
}

// left column of an event card: times, or "all day" plus the date range for multi-day items
function occTime(o) {
  const ev = o.ev;
  const days = D.occDays(o);
  const short = (k) => new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'numeric' }).format(D.keyToDate(k));
  if (ev.all_day) return days.length > 1 ? [h('small', t('all_day')), h('span.range', `${short(days[0])}–${short(days[days.length - 1])}`)] : h('small', t('all_day'));
  if (days.length > 1) return [h('span', D.fTime(o.start)), h('small', `${short(days[days.length - 1])} ${D.fTime(o.end)}`)];
  return [h('span', D.fTime(o.start)), h('small', D.fTime(o.end))];
}

// ───────────── event details ─────────────

function repeatText(rrule) {
  const p = D.parseRule(rrule);
  if (p.preset === 'none') return '';
  const base = t(`r_${p.preset}`);
  return p.until ? `${base} · ${t('end_date')} ${D.fDayShort(D.keyToDate(p.until))}` : base;
}

function evSummary(e) {
  if (!e) return '';
  return D.fWhen(e);
}

function diffRows(c) {
  const a = c.before, b = c.after;
  const rows = [];
  const row = (label, x, y) => rows.push(h('div.diff-row', h('span.dl', label), h('span.was', x || '—'), h('span.arrow', '→'), h('span.now', y || '—')));
  if (c.kind === 'update' && a && b) {
    if (a.title !== b.title) row(t('f_title'), a.title, b.title);
    const wa = D.fWhen(a), wb = D.fWhen(b);
    if (wa !== wb) row(t('f_time'), wa, wb);
    if ((a.location || '') !== (b.location || '')) row(t('f_location'), a.location, b.location);
    if (a.category_id !== b.category_id) row(t('f_category'), catLabel(category(a.category_id)), catLabel(category(b.category_id)));
    if (a.responsible !== b.responsible) row(t('f_responsible'), member(a.responsible)?.name, member(b.responsible)?.name);
    if ((a.rrule || '') !== (b.rrule || '')) row(t('f_repeat'), repeatText(a.rrule) || t('r_none'), repeatText(b.rrule) || t('r_none'));
    const exA = (a.exdates || []).length, exB = (b.exdates || []).length;
    if (exB > exA) {
      const added = (b.exdates || []).filter((x) => !(a.exdates || []).some((y) => +new Date(y) === +new Date(x)));
      added.forEach((x) => row(t('f_time'), D.fWhen({ ...a, starts_at: x, ends_at: new Date(+new Date(x) + (new Date(a.ends_at) - new Date(a.starts_at))).toISOString() }), t('k_delete')));
    }
    if ((a.notes || '') !== (b.notes || '')) row(t('f_notes'), a.notes, b.notes);
  } else if (c.kind === 'detach' && a && b) {
    const occEnd = new Date(+new Date(b.occurrence) + (new Date(a.ends_at) - new Date(a.starts_at))).toISOString();
    row(t('f_time'), D.fWhen({ ...a, starts_at: b.occurrence, ends_at: occEnd }), D.fWhen(b));
    if (a.title !== b.title) row(t('f_title'), a.title, b.title);
  } else if (c.kind === 'delete' && a) {
    rows.push(h('div.diff-row.del', h('span', evSummary(a)), a.rrule ? h('small', repeatText(a.rrule)) : null));
  } else if (c.kind === 'create' && b) {
    rows.push(h('div.diff-row.add', h('span', evSummary(b)), b.rrule ? h('small', repeatText(b.rrule)) : null));
  }
  return rows.length ? h('div.diff', rows) : null;
}

function decisionBlock(c, after) {
  const reply = h('textarea', { rows: 2, placeholder: t('reply_ph') });
  const go = async (ok, btn) => {
    btn.disabled = true;
    try {
      await api.decide(c.id, ok, reply.value);
      toast(ok ? t('s_approved') : t('s_rejected'));
      await reload(); refresh(); after?.();
    } catch (e) { fail(e); btn.disabled = false; }
  };
  return h('div.decide',
    reply,
    h('div.row',
      h('button.btn.danger-soft.grow', { type: 'button', onclick: (e) => go(false, e.currentTarget) }, '✗ ', t('decline')),
      h('button.btn.ok.grow', { type: 'button', onclick: (e) => go(true, e.currentTarget) }, '✓ ', t('accept'))));
}

export function changeCard(c, { compact = false, after } = {}) {
  const who = member(c.proposed_by);
  const decider = member(c.decided_by);
  const ev = S.events.find((e) => e.id === c.event_id);
  const title = (c.after || c.before || ev || {}).title || '';
  const head = h('div.cc-head',
    h(`span.kind.k-${c.kind}`, t(`k_${c.kind}`)),
    h('span.cc-who', who ? who.name : (c.source === 'admin' ? t('admin') : '?'), c.source === 'google' || c.source === 'apple' ? h('small', ' · ', t('from_phone', { p: c.source === 'google' ? 'Google' : 'Apple' })) : null),
    h(`span.status.s-${c.status}`, t(`s_${c.status}`)),
    h('span.cc-time', D.fRelative(c.created_at)));
  const body = [
    compact ? h('button.cc-title', { type: 'button', onclick: () => ev && openEvent(ev) }, title) : null,
    diffRows(c),
    c.note ? h('blockquote', h('small', who?.name || ''), c.note) : null,
    c.reply ? h('blockquote.reply', h('small', t('reply_from', { n: decider?.name || '' })), c.reply) : null,
  ];
  let foot = null;
  if (canDecide(c)) foot = decisionBlock(c, after);
  else if (c.status === 'pending' && c.proposed_by === S.me.id) {
    foot = h('div.row.between',
      h('span.muted', '⏳ ', t('waiting_for', { n: names(approvers(c.rule, c.proposed_by)) || '…' })),
      h('button.btn.small.ghost', {
        type: 'button', onclick: async () => {
          try { await api.withdraw(c.id); toast(t('s_withdrawn')); await reload(); refresh(); after?.(); } catch (e) { fail(e); }
        },
      }, t('withdraw')));
  } else if (c.status === 'pending') {
    foot = h('p.muted', '⏳ ', t('waiting_for', { n: names(approvers(c.rule, c.proposed_by)) || '…' }));
  }
  return h(`article.change.s-${c.status}`, head, body, foot);
}

export function openEvent(ev, occ) {
  ev = S.events.find((e) => e.id === ev.id) || ev;
  const start = occ?.start ?? new Date(ev.starts_at);
  const end = occ?.end ?? new Date(ev.ends_at);
  const cat = category(ev.category_id);
  const resp = member(ev.responsible);
  const s = sheet({ title: '', className: 'event-sheet' });
  const rerender = () => {
    const fresh = S.events.find((e) => e.id === ev.id);
    if (!fresh) { s.close(); return; }
    ev = fresh;
    draw();
  };
  const hist = h('div.history');
  const draw = () => {
    const pend = pendingOf(ev.id);
    const editable = S.me.role !== 'viewer' &&
      !(ev.status === 'pending' && pend[0]?.proposed_by !== S.me.id && S.me.role !== 'admin');
    s.set(
      h('div.ev-hero', { style: { '--c': evColor(ev) } },
        cat ? h('span.ev-cat', `${cat.icon} ${catLabel(cat)}`) : null,
        h('h2', ev.title),
        ev.status === 'pending' ? h('span.tag.wait', t('pending_new')) : null),
      pend.map((c) => changeCard(c, { after: rerender })),
      h('dl.facts',
        h('div', h('dt', icon('clock')), h('dd', D.fWhen(ev, start, end))),
        ev.rrule ? h('div', h('dt', icon('repeat')), h('dd', repeatText(ev.rrule) || ev.rrule)) : null,
        resp ? h('div', h('dt', icon('user')), h('dd', h('span.who', { style: { '--m': resp.color } }, resp.name))) : null,
        ev.location ? h('div', h('dt', icon('pin')), h('dd', ev.location, ' ', h('a', { href: `https://maps.google.com/?q=${encodeURIComponent(ev.location)}`, target: '_blank', rel: 'noopener' }, t('open_map')))) : null,
        ev.notes ? h('div', h('dt', icon('note')), h('dd.notes', ev.notes)) : null),
      member(ev.created_by) ? h('p.muted.small', t('created_by', { n: member(ev.created_by).name })) : null,
      editable ? h('div.row.actions',
        h('button.btn.danger-soft', { type: 'button', onclick: () => deleteFlow(ev, start, s) }, t('delete')),
        h('button.btn.primary.grow', { type: 'button', onclick: () => editFlow(ev, start, end, s) }, t('edit'))) : null,
      h('details.hist', { ontoggle: (e) => e.currentTarget.open && loadHistory() }, h('summary', t('history')), hist),
    );
  };
  const loadHistory = async () => {
    hist.replaceChildren(h('p.muted', t('loading')));
    try {
      const list = await api.eventHistory(ev.id);
      hist.replaceChildren(...list.map((c) => changeCard(c)));
    } catch (e) { hist.replaceChildren(h('p.muted', errText(e))); }
  };
  draw();
}

async function editFlow(ev, start, end, parentSheet) {
  let mode = 'series';
  if (ev.rrule && ev.status === 'active') {
    mode = await choose(t('which_edit'), [{ value: 'single', label: t('this_date') }, { value: 'series', label: t('whole_series') }]);
    if (!mode) return;
  }
  openEditor({ mode, ev, occStart: start, occEnd: end, onDone: () => parentSheet.close() });
}

async function deleteFlow(ev, start, parentSheet) {
  try {
    if (ev.rrule && ev.status === 'active') {
      const which = await choose(t('which_delete'), [
        { value: 'single', label: t('this_date') }, { value: 'series', label: t('whole_series'), danger: true }]);
      if (!which) return;
      if (which === 'single') {
        const r = await api.propose('update', ev.id, { exdates: [...(ev.exdates || []), start.toISOString()] });
        done(r, ev.category_id, ev.category_id);
        parentSheet.close();
        return;
      }
    } else if (!(await confirmBox(t('delete_q'), t('delete'), true))) return;
    const r = await api.propose('delete', ev.id, null);
    done(r, ev.category_id, ev.category_id);
    parentSheet.close();
  } catch (e) { fail(e); }
}

async function done(r, oldCat, newCat, isCreate) {
  if (r?.status === 'pending') toast(t('sent_for_ok', { n: names(approvers(ruleFor(oldCat, newCat, isCreate))) || '…' }));
  else toast(t('saved'));
  await reload();
  refresh();
}

// ───────────── editor ─────────────

export function openEditor({ mode, ev, date, time, occStart, occEnd, onDone }) {
  const isNew = mode === 'new';
  const single = mode === 'single';
  const now = new Date();
  let s0, e0;
  if (isNew) {
    const d = D.keyToDate(date || D.todayKey());
    const [hh, mm] = (time || '').split(':').map(Number);
    s0 = new Date(d.getFullYear(), d.getMonth(), d.getDate(), time ? hh : Math.min(now.getHours() + 1, 20), time ? mm : 0);
    e0 = new Date(s0.getTime() + 3600000);
  } else if (single) { s0 = occStart; e0 = occEnd; }
  else { s0 = new Date(ev.starts_at); e0 = new Date(ev.ends_at); }
  const allDay0 = ev?.all_day ?? false;
  const asDate = (d, allDay) => (allDay ? D.utcDayKey(d) : D.localDate(d));
  const endDateAllDay = (d) => D.utcDayKey(new Date(d.getTime() - 86400000));
  const rule0 = D.parseRule(ev?.rrule);

  const title = h('input', { value: ev?.title || '', required: true, maxlength: '200', placeholder: t('title_ph'), autofocus: isNew, autocomplete: 'off' });
  const allDay = h('input', { type: 'checkbox', checked: allDay0 });
  const sDate = h('input', { type: 'date', value: asDate(s0, allDay0), required: true });
  const sTime = h('input', { type: 'time', value: allDay0 ? '09:00' : D.localTime(s0), step: '300' });
  const eDate = h('input', { type: 'date', value: allDay0 ? endDateAllDay(e0) : D.localDate(e0), required: true });
  const eTime = h('input', { type: 'time', value: allDay0 ? '10:00' : D.localTime(e0), step: '300' });
  const repeat = h('select', [...D.PRESETS, ...(rule0.preset === 'custom' ? ['custom'] : [])].map((p) =>
    h('option', { value: p, selected: p === rule0.preset }, t(`r_${p}`))));
  const until = h('input', { type: 'date', value: rule0.until || '' });
  const loc = h('input', { value: ev?.location || '', placeholder: t('location_ph'), maxlength: '300' });
  const notes = h('textarea', { rows: 3 }, ev?.notes || '');
  const note = h('textarea', { rows: 2 });
  let catId = ev?.category_id ?? null;
  let respId = ev?.responsible ?? null;

  const catChips = h('div.chip-row');
  const drawCats = () => catChips.replaceChildren(
    ...S.categories.filter((c) => !c.archived || c.id === catId).map((c) => h(`button.chip${catId === c.id ? '.on' : ''}`, {
      type: 'button', style: { '--c': c.color }, onclick: () => { catId = catId === c.id ? null : c.id; drawCats(); updateRule(); },
    }, `${c.icon} ${catLabel(c)}`)));
  const respChips = h('div.chip-row');
  const drawResp = () => respChips.replaceChildren(
    h(`button.chip${!respId ? '.on' : ''}`, { type: 'button', onclick: () => { respId = null; drawResp(); } }, t('nobody')),
    ...S.members.filter((m) => m.active && m.role !== 'viewer' && (m.role === 'parent' || m.id === respId)).map((m) =>
      h(`button.chip${respId === m.id ? '.on' : ''}`, { type: 'button', style: { '--c': m.color }, onclick: () => { respId = m.id; drawResp(); } },
        h('i.dot', { style: { background: m.color } }), m.name)));

  const ruleBox = h('div.rule-hint');
  const noteField = h('label.field', h('span'), note);
  const submit = h('button.btn.primary.block', { type: 'submit' });
  const updateRule = () => {
    const rule = S.me.role === 'admin' ? 'none' : ruleFor(isNew ? null : ev.category_id, catId, isNew || ev?.status === 'pending');
    const who = approvers(rule);
    const needs = rule !== 'none';
    ruleBox.className = `rule-hint ${needs ? 'needs' : 'free'}`;
    ruleBox.replaceChildren(needs ? `⏳ ${t('needs_ok', { n: names(who) || '…' })}` : `✓ ${t('applies_now')}`);
    noteField.hidden = !needs;
    noteField.firstChild.textContent = t('message_ph', { n: names(who) || '…' });
    submit.textContent = needs ? t('submit_propose') : t('submit_save');
  };
  const syncAllDay = () => {
    sTime.hidden = eTime.hidden = allDay.checked;
  };
  allDay.addEventListener('change', syncAllDay);
  const syncRepeat = () => { untilField.hidden = repeat.value === 'none'; };
  repeat.addEventListener('change', syncRepeat);
  // keep the end after the start when the start moves
  let lastStart = sDate.value + 'T' + sTime.value;
  const onStart = () => {
    const prev = new Date(lastStart), next = new Date(sDate.value + 'T' + (sTime.value || '00:00'));
    const end = new Date(eDate.value + 'T' + (eTime.value || '00:00'));
    if (!isNaN(prev) && !isNaN(next) && !isNaN(end)) {
      const moved = new Date(end.getTime() + (next - prev));
      eDate.value = D.localDate(moved);
      if (!allDay.checked) eTime.value = D.localTime(moved);
    }
    lastStart = sDate.value + 'T' + sTime.value;
  };
  sDate.addEventListener('change', onStart);
  sTime.addEventListener('change', onStart);

  const field = (label, ...inputs) => h('label.field', h('span', label), ...inputs);
  const untilField = field(t('until'), until);

  const form = h('form.editor', {
    onsubmit: async (e) => {
      e.preventDefault();
      let starts, ends;
      if (allDay.checked) {
        starts = D.isoFromDay(sDate.value);
        const endDay = eDate.value < sDate.value ? sDate.value : eDate.value;
        ends = new Date(new Date(D.isoFromDay(endDay)).getTime() + 86400000).toISOString();
      } else {
        starts = D.isoFromLocal(sDate.value, sTime.value);
        ends = D.isoFromLocal(eDate.value, eTime.value);
        if (new Date(ends) < new Date(starts)) ends = new Date(new Date(starts).getTime() + 3600000).toISOString();
      }
      const data = {
        title: title.value.trim(), notes: notes.value, location: loc.value.trim(), all_day: allDay.checked,
        starts_at: starts, ends_at: ends, category_id: catId, responsible: respId,
      };
      if (!single) data.rrule = D.buildRule(repeat.value, until.value, allDay.checked, rule0.raw);
      submit.disabled = true;
      try {
        let r;
        if (isNew) r = await api.propose('create', null, data, note.value);
        else if (single) r = await api.propose('detach', ev.id, { ...data, occurrence: occStart.toISOString() }, note.value);
        else r = await api.propose('update', ev.id, data, note.value);
        s.close();
        onDone?.();
        await done(r, isNew ? null : ev.category_id, catId, isNew);
      } catch (err) { fail(err); submit.disabled = false; }
    },
  },
  field(t('title'), title),
  h('label.switch', allDay, h('span', t('all_day'))),
  h('div.grid2', field(t('start'), sDate, sTime), field(t('end'), eDate, eTime)),
  single ? null : h('div.grid2', field(t('repeat'), repeat), untilField),
  h('div.field', h('span', t('category')), catChips),
  h('div.field', h('span', t('responsible')), respChips),
  field(t('location'), loc),
  field(t('notes'), notes),
  ruleBox, noteField, submit);

  const s = sheet({ title: isNew ? t('new_event') : t('edit_event'), body: form, className: 'editor-sheet' });
  drawCats(); drawResp(); updateRule(); syncAllDay(); syncRepeat();
}

// ───────────── inbox ─────────────

export function openInbox() {
  const s = sheet({ title: t('inbox'), className: 'inbox-sheet' });
  const draw = () => {
    const mine = S.changes.filter((c) => c.status === 'pending' && c.proposed_by === S.me.id && !canDecide(c));
    const decide = toDecide();
    const recent = S.changes.filter((c) => c.status !== 'pending' && c.status !== 'superseded').slice(0, 25);
    s.set(
      h('h3.section', t('to_decide')),
      decide.length ? decide.map((c) => changeCard(c, { compact: true, after: draw })) : h('p.empty-line', t('nothing_to_decide')),
      mine.length ? [h('h3.section', t('my_pending')), mine.map((c) => changeCard(c, { compact: true, after: draw }))] : null,
      recent.length ? [h('h3.section', t('recent')), recent.map((c) => changeCard(c, { compact: true }))] : null,
    );
  };
  draw();
}

// ───────────── settings ─────────────

export function openSettings() {
  const s = sheet({ title: t('settings'), className: 'settings-sheet' });
  const draw = async () => {
    const myConn = (p) => S.conns.find((c) => c.member_id === S.me.id && c.provider === p);
    const sub = await push.current().catch(() => null);
    const feed = api.feedUrl(S.me.ics_token);
    s.set(
      h('div.me-card', h('span.avatar.lg', { style: { background: S.me.color } }, S.me.name.slice(0, 1).toUpperCase()),
        h('div', h('strong', S.me.name), h('small', t('signed_in_as', { n: S.me.email || '' })))),

      h('h3.section', t('language')),
      h('div.chip-row.lang', LANGS.map((l) => h(`button.chip${getLang() === l.code ? '.on' : ''}`, {
        type: 'button', onclick: async () => {
          setLang(l.code); S.me.lang = l.code;
          try { await api.setMyLang(l.code); } catch (e) { fail(e); }
          s.close(); render(); openSettings();
        },
      }, l.label))),

      h('h3.section', t('phone_cals')),
      h('p.hint', t('phone_cals_hint')),
      connCard('google', myConn('google'), draw),
      connCard('apple', myConn('apple'), draw),

      h('h3.section', t('notifications')),
      pushBlock(sub, draw),

      h('details.feed', h('summary', t('feed')),
        h('p.hint', t('feed_hint')),
        h('div.copy-line', h('code', feed), h('button.btn.small', { type: 'button', onclick: () => copyText(feed) }, t('copy'))),
        h('div.row.wrap',
          h('a.btn.small.ghost', { href: feed.replace(/^https:/, 'webcal:') }, t('feed_apple')),
          h('a.btn.small.ghost', { href: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feed.replace(/^https:/, 'webcal:'))}`, target: '_blank', rel: 'noopener' }, t('feed_google')),
          h('button.btn.small.ghost', {
            type: 'button', onclick: async () => {
              if (!(await confirmBox(t('new_link') + '?'))) return;
              try { S.me.ics_token = await api.newIcsToken(); draw(); } catch (e) { fail(e); }
            },
          }, t('new_link')))),

      S.me.role === 'admin' ? h('button.btn.block', { type: 'button', onclick: () => import('./admin.js').then((m) => m.openAdmin()) }, icon('shield'), t('admin_panel')) : null,
      h('button.btn.block.ghost.signout', {
        type: 'button', onclick: async () => { await push.disable().catch(() => {}); await api.signOut(); closeAll(); location.reload(); },
      }, t('sign_out')),
    );
  };
  draw();
}

function connCard(provider, conn, redraw) {
  const label = provider === 'google' ? t('google') : t('apple');
  const logo = provider === 'google' ? 'G' : '';
  if (conn) {
    const err = conn.status === 'error';
    return h(`div.conn${err ? '.err' : '.ok'}`,
      h('div.conn-head', h(`span.conn-logo.${provider}`, logo), h('div', h('strong', label),
        h('small', t('connected_as', { n: conn.account_label || '' })),
        h('small', err ? `⚠ ${errText(conn.last_error)}` : (conn.last_sync_at ? t('last_sync', { n: D.fRelative(conn.last_sync_at) }) : '…')),
        !err && conn.last_error ? h('small.muted', conn.last_error.slice(0, 140)) : null)),
      h('div.row.wrap',
        err && provider === 'google' ? h('button.btn.small.primary', { type: 'button', onclick: () => startGoogle() }, t('reconnect')) : null,
        h('button.btn.small', {
          type: 'button', onclick: async (e) => {
            e.currentTarget.disabled = true;
            try { await api.syncNow(); toast(t('synced')); await reload(); redraw(); } catch (er) { fail(er); }
          },
        }, icon('sync'), t('sync_now')),
        h('button.btn.small.ghost', {
          type: 'button', onclick: async () => {
            if (!(await confirmBox(t('disconnect_q', { n: S.settings.calendar_name }), t('disconnect'), true))) return;
            try { await api.disconnect(provider); await reload(); redraw(); } catch (er) { fail(er); }
          },
        }, t('disconnect'))));
  }
  if (provider === 'google') {
    return h('div.conn', h('div.conn-head', h('span.conn-logo.google', 'G'), h('div', h('strong', label))),
      h('button.btn.primary', { type: 'button', onclick: (e) => startGoogle(e.currentTarget) }, t('connect')));
  }
  const id = h('input', { type: 'email', value: S.me.email || '', autocomplete: 'off' });
  const pw = h('input', { autocomplete: 'off', placeholder: 'abcd-efgh-ijkl-mnop', spellcheck: false, autocapitalize: 'off' });
  const btn = h('button.btn.primary', { type: 'submit' }, t('connect'));
  return h('div.conn', h('div.conn-head', h('span.conn-logo.apple', ''), h('div', h('strong', label))),
    h('details.apple-form', h('summary.btn.primary', t('connect')),
      h('p.hint', t('apple_steps')),
      h('a.btn.small.ghost', { href: 'https://account.apple.com/account/manage', target: '_blank', rel: 'noopener' }, t('apple_open'), ' ↗'),
      h('form', {
        onsubmit: async (e) => {
          e.preventDefault(); btn.disabled = true; btn.classList.add('busy');
          try { await api.appleConnect(id.value, pw.value); toast(t('apple_ok')); await reload(); redraw(); }
          catch (er) { fail(er); btn.disabled = false; btn.classList.remove('busy'); }
        },
      }, h('label.field', h('span', t('apple_id')), id), h('label.field', h('span', t('app_password')), pw), btn)));
}

async function startGoogle(btn) {
  if (btn) btn.disabled = true;
  try { const { url } = await api.googleStart(); location.href = url; }
  catch (e) { fail(e); if (btn) btn.disabled = false; }
}

function pushBlock(sub, redraw) {
  if (push.isIOS() && !push.standalone()) return h('p.hint.box', '📱 ', t('push_ios'));
  if (!push.supported()) return h('p.hint', t('push_unsupported'));
  if (push.permission() === 'denied') return h('p.hint.box', t('push_denied'));
  if (sub) {
    return h('div.row.wrap', h('span.ok-line', '✓ ', t('push_on')),
      h('button.btn.small', { type: 'button', onclick: async () => { try { await api.testPush(); } catch (e) { fail(e); } } }, t('push_test')),
      h('button.btn.small.ghost', { type: 'button', onclick: async () => { await push.disable(); redraw(); } }, t('push_off')));
  }
  return h('div', h('p.hint', t('notif_hint')),
    h('button.btn.primary', {
      type: 'button', onclick: async (e) => {
        e.currentTarget.disabled = true;
        try { await push.enable(); await api.testPush().catch(() => {}); redraw(); } catch (er) { fail(er); redraw(); }
      },
    }, icon('bell'), t('enable_push')));
}

export { reload, refresh, render, fail, names, approvers };
