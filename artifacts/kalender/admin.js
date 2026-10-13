// Zäme admin panel: approval rules per category, global settings, people + invites + password
// resets, every open suggestion, the activity log with undo, and the Google/iCloud sync setup.
// Loaded only for the admin (the database enforces it either way: RLS + cal_is_admin()).

import { catLabel, LANGS, t } from './i18n.js';
import * as api from './api.js';
import * as D from './dates.js';
import { changeCard, errText, reload, refresh, render, state as S } from './app.js';
import { confirmBox, copyText, h, icon, shareText, sheet, toast } from './ui.js';

const TABS = ['rules', 'people', 'queue', 'log', 'sync'];
let tab = 'rules';

export function openAdmin() {
  const s = sheet({ title: t('admin'), className: 'admin-sheet wide', onClose: () => render() });
  const bar = h('div.tabs');
  const body = h('div.tab-body');
  const show = async (name) => {
    tab = name;
    bar.replaceChildren(...TABS.map((k) => h(`button${k === tab ? '.on' : ''}`, { type: 'button', onclick: () => show(k) },
      t(`tab_${k}`), k === 'queue' && pending().length ? h('span.count', pending().length) : null)));
    body.replaceChildren(h('p.muted', t('loading')));
    try { body.replaceChildren(...[await VIEWS[name](() => show(name))].flat(Infinity).filter(Boolean)); }
    catch (e) { body.replaceChildren(h('p.form-msg', errText(e))); }
  };
  s.set(bar, body);
  show(tab);
}

const pending = () => S.changes.filter((c) => c.status === 'pending');
const fail = (e) => toast(errText(e), 'err');
const field = (label, ...inputs) => h('label.field', h('span', label), ...inputs);
const select = (value, options, onchange) => h('select', { onchange: (e) => onchange(e.target.value) },
  options.map(([v, label]) => h('option', { value: v, selected: String(v) === String(value) }, label)));
const toggle = (checked, label, onchange) => h('label.switch', h('input', { type: 'checkbox', checked, onchange: (e) => onchange(e.target.checked) }), h('span', label));
const APPROVALS = () => [['none', t('a_none')], ['partner', t('a_partner')], ['partner_or_admin', t('a_partner_or_admin')], ['admin', t('a_admin')]];

async function saveSetting(patch) {
  try {
    await api.admin.updateSettings(patch);
    Object.assign(S.settings, patch);
    toast(t('saved'));
  } catch (e) { fail(e); }
}

// ───────────── rules ─────────────

function rulesView(redraw) {
  const st = S.settings;
  const hours = [[null, t('never')], [4, t('hours_n', { n: 4 })], [12, t('hours_n', { n: 12 })], [24, t('hours_n', { n: 24 })],
    [48, t('hours_n', { n: 48 })], [72, t('days_n', { n: 3 })], [168, t('days_n', { n: 7 })]];
  if (st.auto_approve_hours && !hours.some(([v]) => v === st.auto_approve_hours)) hours.push([st.auto_approve_hours, t('hours_n', { n: st.auto_approve_hours })]);

  const general = h('div.card',
    h('h3', t('general')),
    h('div.grid2',
      field(t('cal_name'), h('input', { value: st.calendar_name, maxlength: '60', onchange: (e) => e.target.value.trim() && saveSetting({ calendar_name: e.target.value.trim() }) })),
      field(t('default_lang'), select(st.default_lang, LANGS.map((l) => [l.code, l.label]), (v) => saveSetting({ default_lang: v }))),
      field(t('default_approval'), select(st.default_approval, APPROVALS(), (v) => saveSetting({ default_approval: v }))),
      field(t('auto_approve'), select(st.auto_approve_hours ?? '', hours.map(([v, l]) => [v ?? '', l]), (v) => saveSetting({ auto_approve_hours: v === '' ? null : Number(v) }))),
      field(t('delete_policy'), select(st.delete_policy, [['anyone', t('dp_anyone')], ['creator', t('dp_creator')]], (v) => saveSetting({ delete_policy: v }))),
      field(t('week_start'), select(st.week_start, [[1, t('monday')], [0, t('sunday')]], (v) => saveSetting({ week_start: Number(v) }))),
      field(t('pending_prefix'), h('input', { value: st.pending_prefix, maxlength: '6', onchange: (e) => saveSetting({ pending_prefix: e.target.value }) }))),
    toggle(st.sync_pending, t('sync_pending'), (v) => saveSetting({ sync_pending: v })),
    toggle(st.admin_override, t('admin_override'), (v) => saveSetting({ admin_override: v })),
    toggle(st.notify_fyi, t('notify_fyi'), (v) => saveSetting({ notify_fyi: v })));

  const cats = h('div.cat-list', S.categories.map((c) => categoryCard(c)));
  return [
    general,
    h('div.card',
      h('h3', t('categories')),
      cats,
      h('button.btn.ghost', {
        type: 'button', onclick: async () => {
          try {
            await api.admin.saveCategory({ names: { de: 'Neu', en: 'New', vi: 'Mới' }, icon: '📌', color: '#64748b', approval: 'partner', sort: S.categories.length + 1 });
            await reload(); redraw();
          } catch (e) { fail(e); }
        },
      }, icon('plus'), t('add_category'))),
  ];
}

function categoryCard(c) {
  const draft = { ...c, names: { ...c.names } };
  let timer;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try { await api.admin.saveCategory(draft); Object.assign(c, draft); toast(t('saved')); refresh(); } catch (e) { fail(e); }
    }, 400);
  };
  const nameIn = (lang) => h('input', { value: draft.names[lang] || '', placeholder: lang.toUpperCase(), oninput: (e) => { draft.names[lang] = e.target.value; save(); } });
  const preview = h('span.cat-preview', { style: { '--c': draft.color } }, `${draft.icon} ${catLabel(draft)}`);
  return h(`div.cat-card${c.archived ? '.archived' : ''}`,
    h('div.cat-top',
      h('input.icon-in', { value: draft.icon, maxlength: '4', 'aria-label': t('icon'), oninput: (e) => { draft.icon = e.target.value; preview.textContent = `${draft.icon} ${catLabel(draft)}`; save(); } }),
      h('input.color-in', { type: 'color', value: draft.color, 'aria-label': t('color'), oninput: (e) => { draft.color = e.target.value; preview.style.setProperty('--c', draft.color); save(); } }),
      preview,
      h('button.btn.small.ghost', {
        type: 'button', onclick: async (e) => {
          draft.archived = !draft.archived; e.currentTarget.textContent = draft.archived ? t('unarchive') : t('archive');
          e.currentTarget.closest('.cat-card').classList.toggle('archived', draft.archived); save();
        },
      }, c.archived ? t('unarchive') : t('archive'))),
    h('div.grid3', field(t('name_de'), nameIn('de')), field(t('name_en'), nameIn('en')), field(t('name_vi'), nameIn('vi'))),
    field(t('approval'), select(draft.approval, APPROVALS(), (v) => { draft.approval = v; save(); })));
}

// ───────────── people ─────────────

function codeDialog(title, text, code) {
  sheet({
    title, className: 'small',
    body: [
      h('div.big-code', code),
      h('pre.share-text', text),
      h('div.row.end',
        h('button.btn', { type: 'button', onclick: () => copyText(text) }, t('copy')),
        h('button.btn.primary', { type: 'button', onclick: () => shareText(text) }, t('share'))),
    ],
  });
}

async function peopleView(redraw) {
  const [members, codes] = await Promise.all([api.admin.members(), api.admin.codes()]);
  // invites always point at the one address the family uses (logins and notifications are per address)
  const appUrl = /^(localhost|127\.)/.test(location.hostname) ? location.origin + location.pathname : 'https://calendar.swisslock.net/artifacts/kalender.html';
  const roleOpts = [['parent', t('r_parent')], ['viewer', t('r_viewer')], ['admin', t('r_admin')]];

  const cards = members.map((m) => {
    const self = m.id === S.me.id;
    const upd = async (patch) => {
      try { await api.admin.updateMember(m.id, patch); toast(t('saved')); await reload(); refresh(); } catch (e) { fail(e); }
    };
    return h(`div.member-card${m.active ? '' : '.inactive'}`,
      h('div.member-top',
        h('input.color-in', { type: 'color', value: m.color, onchange: (e) => upd({ color: e.target.value }) }),
        h('input.name-in', { value: m.name, maxlength: '40', onchange: (e) => e.target.value.trim() && upd({ name: e.target.value.trim() }) }),
        self ? h('span.tag', t('you')) : null),
      h('small.muted', m.email || ''),
      h('div.grid3',
        field(t('role'), self ? h('input', { value: t(`r_${m.role}`), disabled: true }) : select(m.role, roleOpts, (v) => upd({ role: v }))),
        field(t('language'), select(m.lang, LANGS.map((l) => [l.code, l.label]), (v) => upd({ lang: v }))),
        field(t('active'), self ? h('input', { value: t('active'), disabled: true })
          : select(m.active ? '1' : '0', [['1', t('active')], ['0', t('inactive')]], (v) => upd({ active: v === '1' })))),
      m.connections.length ? h('div.conn-mini', m.connections.map((c) => h(`span.pill${c.status === 'error' ? '.err' : ''}`,
        c.provider === 'google' ? 'Google' : 'Apple', ' · ', c.account_label || '', ' · ',
        c.status === 'error' ? `⚠ ${errText(c.last_error)}` : (c.last_sync_at ? D.fRelative(c.last_sync_at) : '…')))) : null,
      !self && m.email ? h('button.btn.small.ghost', {
        type: 'button', onclick: async () => {
          try {
            const code = await api.admin.makeCode('reset', null, null, m.id);
            codeDialog(t('reset_password'), t('reset_msg', { n: m.name, code, url: appUrl }), code);
          } catch (e) { fail(e); }
        },
      }, t('reset_password')) : null);
  });

  const name = h('input', { maxlength: '40', placeholder: 'Mama / Papa …' });
  const role = select('parent', [['parent', t('r_parent')], ['viewer', t('r_viewer')]], () => {});
  const invite = h('form.card', {
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        const code = await api.admin.makeCode('invite', name.value, role.value);
        const link = `${appUrl}#join=${code}`;
        codeDialog(t('invite_ready', { n: name.value || '…' }), t('invite_msg', { n: name.value || '', url: link, code }), code);
        name.value = '';
        redraw();
      } catch (er) { fail(er); }
    },
  }, h('h3', t('invite')), h('div.grid2', field(t('invite_name'), name), field(t('role'), role)),
  h('button.btn.primary', { type: 'submit' }, t('create_invite')));

  return [
    h('div.card', h('h3', t('members')), cards),
    invite,
    codes.length ? h('div.card', h('h3', t('open_codes')), codes.map((c) => h('div.code-row',
      h('span', c.kind === 'invite' ? `✉️ ${c.name || ''} (${t(`r_${c.role}`)})` : `🔑 ${members.find((m) => m.id === c.member_id)?.name || ''}`),
      h('small.muted', t('expires', { n: D.fDateTime(new Date(c.expires_at)) }))))) : null,
  ];
}

// ───────────── queue + log ─────────────

function queueView(redraw) {
  const list = pending();
  return [h('h3.section', t('all_pending')), list.length ? list.map((c) => changeCard(c, { compact: true, after: redraw })) : h('p.empty-line', t('nothing_to_decide'))];
}

function logView(redraw) {
  const list = S.changes.filter((c) => c.status !== 'pending').slice(0, 120);
  return [h('h3.section', t('activity')), list.map((c) => {
    const card = changeCard(c, { compact: true });
    if (['applied', 'approved', 'auto'].includes(c.status) && c.note !== 'revert') {
      card.append(h('div.row.end', h('button.btn.small.ghost', {
        type: 'button', onclick: async () => {
          if (!(await confirmBox(t('revert_q'), t('revert')))) return;
          try { await api.admin.revert(c.id); toast(t('reverted')); await reload(); refresh(); redraw(); } catch (e) { fail(e); }
        },
      }, '↶ ', t('revert'))));
    }
    return card;
  })];
}

// ───────────── sync ─────────────

async function syncView(redraw) {
  const [g, members] = await Promise.all([api.admin.google(), api.admin.members()]);
  const cid = h('input', { value: g?.client_id || '', placeholder: '….apps.googleusercontent.com', autocomplete: 'off' });
  const sec = h('input', { type: 'password', placeholder: g?.has_secret ? `•••••••• (${t('secret_saved')})` : 'GOCSPX-…', autocomplete: 'off' });
  const conns = members.flatMap((m) => m.connections.map((c) => ({ ...c, who: m.name })));
  return [
    h('div.card',
      h('h3', t('google_setup'), g?.client_id && g?.has_secret ? h('span.tag.okt', ' ✓') : null),
      h('ol.steps', t('google_steps').split(/\s(?=\d\.\s)/).map((x) => h('li', x.replace(/^\d\.\s/, '')))),
      h('div.copy-line', h('span.muted', t('redirect_uri')), h('code', g?.redirect_uri || ''), h('button.btn.small', { type: 'button', onclick: () => copyText(g?.redirect_uri || '') }, t('copy'))),
      h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          try { await api.admin.setGoogle(cid.value.trim(), sec.value.trim()); toast(t('saved')); redraw(); } catch (er) { fail(er); }
        },
      }, h('div.grid2', field(t('client_id'), cid), field(t('client_secret'), sec)), h('button.btn.primary', { type: 'submit' }, t('save_google')))),
    h('div.card',
      h('h3', t('connections')),
      conns.length ? conns.map((c) => h(`div.code-row${c.status === 'error' ? '.err' : ''}`,
        h('span', `${c.who} · ${c.provider === 'google' ? 'Google' : 'Apple'} · ${c.account_label || ''}`),
        h('small', c.status === 'error' ? `⚠ ${errText(c.last_error)}` : (c.last_sync_at ? D.fRelative(c.last_sync_at) : '…')))) : h('p.muted', t('none_yet')),
      h('button.btn', {
        type: 'button', onclick: async (e) => {
          e.currentTarget.disabled = true;
          try { await api.syncNow(true); toast(t('synced')); await reload(); redraw(); } catch (er) { fail(er); }
        },
      }, icon('sync'), t('sync_all'))),
  ];
}

const VIEWS = { rules: rulesView, people: peopleView, queue: queueView, log: logView, sync: syncView };
