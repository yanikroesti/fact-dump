// Zäme calendar views: day / week (time grid), month (spanning bars), year (overview), list.
// Plus the per-device category filter ("hide school holidays") and the toolbar that switches them.

import { catLabel, locale, t } from './i18n.js';
import * as D from './dates.js';
import { h, icon, sheet } from './ui.js';
import { category, evColor, member, occCard, openEditor, openEvent, state as S } from './app.js';

export const VIEWS = ['day', 'week', 'month', 'year', 'list'];
const HOUR = () => (matchMedia('(max-width: 699px)').matches ? 42 : 48);
const narrow = () => matchMedia('(max-width: 699px)').matches;

// ───────────── per-device preferences ─────────────

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
export function loadPrefs() {
  S.hidden = new Set(store.get('zaeme.hidden', []));
  const v = store.get('zaeme.view', null);
  S.view = VIEWS.includes(v) ? v : (narrow() ? 'month' : 'month');
}
const catKey = (ev) => ev.category_id || 'none';
const isVisible = (ev) => !S.hidden.has(catKey(ev));

// ───────────── occurrences ─────────────

function occList(from, to) {
  const out = [];
  for (const ev of S.events) if (isVisible(ev)) out.push(...D.occurrences(ev, from, to));
  return out;
}
function byDay(occs) {
  const m = new Map();
  for (const o of occs) for (const k of D.occDays(o)) { if (!m.has(k)) m.set(k, []); m.get(k).push(o); }
  for (const list of m.values()) list.sort((a, b) => (b.ev.all_day - a.ev.all_day) || (a.start - b.start) || a.ev.title.localeCompare(b.ev.title));
  return m;
}
const isSpan = (o) => o.ev.all_day || D.occDays(o).length > 1;

// lay occurrences of a run of days out in lanes: returns [{ o, s, e, lane, contL, contR }]
function lanes(occs, dayKeys) {
  const idx = new Map(dayKeys.map((k, i) => [k, i]));
  const segs = [];
  for (const o of occs) {
    const ks = D.occDays(o).filter((k) => idx.has(k));
    if (!ks.length) continue;
    const all = D.occDays(o);
    segs.push({ o, s: idx.get(ks[0]), e: idx.get(ks[ks.length - 1]), span: isSpan(o), contL: all[0] < dayKeys[0], contR: all[all.length - 1] > dayKeys[dayKeys.length - 1] });
  }
  segs.sort((a, b) => (b.span - a.span) || (a.s - b.s) || ((b.e - b.s) - (a.e - a.s)) || (a.o.start - b.o.start));
  const used = [];
  for (const g of segs) {
    let lane = 0;
    while (used[lane] && used[lane].slice(g.s, g.e + 1).some(Boolean)) lane++;
    used[lane] = used[lane] || Array(dayKeys.length).fill(false);
    for (let i = g.s; i <= g.e; i++) used[lane][i] = true;
    g.lane = lane;
  }
  return segs;
}

// ───────────── toolbar + navigation ─────────────

const anchor = () => D.keyToDate(S.selected);
function weekStart(d) {
  const ws = S.settings.week_start ?? 1;
  return D.addDays(D.startOfDay(d), -((d.getDay() - ws + 7) % 7));
}

export function toolbar(redraw) {
  const viewBtns = VIEWS.map((v) => h(`button.v-${v}`, { type: 'button', onclick: () => setView(v, redraw) }, t(`v_${v}`)));
  return h('nav.toolbar',
    h('div.nav-row',
      h('div.month-nav',
        h('button.icon-btn.nav-prev', { type: 'button', 'aria-label': '‹', onclick: () => shift(-1, redraw) }, icon('left')),
        h('h1#title'),
        h('button.icon-btn.nav-next', { type: 'button', 'aria-label': '›', onclick: () => shift(1, redraw) }, icon('right'))),
      h('div.tool-right',
        h('button.btn.small.ghost', { type: 'button', onclick: () => { S.selected = D.todayKey(); redraw(); } }, t('today')),
        h('button.btn.small.ghost.filter-btn', { type: 'button', 'aria-label': t('filter'), onclick: () => openFilter(redraw) }, icon('filter'), h('span.fcount')))),
    h('div.seg.views', viewBtns));
}

function setView(v, redraw) {
  S.view = v;
  store.set('zaeme.view', v);
  redraw();
}

function shift(n, redraw) {
  const a = anchor();
  let d;
  if (S.view === 'day') d = D.addDays(a, n);
  else if (S.view === 'week') d = D.addDays(a, 7 * n);
  else if (S.view === 'year') d = new Date(a.getFullYear() + n, a.getMonth(), Math.min(a.getDate(), 28));
  else {
    const last = new Date(a.getFullYear(), a.getMonth() + n + 1, 0).getDate();
    d = new Date(a.getFullYear(), a.getMonth() + n, Math.min(a.getDate(), last));
  }
  S.selected = D.dayKey(d);
  redraw();
}

function title() {
  const a = anchor();
  const f = (o) => new Intl.DateTimeFormat(locale(), o);
  if (S.view === 'day') return f(narrow() ? { weekday: 'short', day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).format(a);
  if (S.view === 'week') {
    const s = weekStart(a), e = D.addDays(s, 6);
    const fmt = f(narrow() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
    return fmt.formatRange ? fmt.formatRange(s, e) : `${fmt.format(s)} – ${fmt.format(e)}`;
  }
  if (S.view === 'year') return String(a.getFullYear());
  if (S.view === 'list') return t('v_list');
  return D.fMonth(a);
}

/** draw the toolbar state and the current view into #main */
export function drawMain() {
  const main = document.getElementById('main');
  if (!main) return;
  document.getElementById('title').textContent = title();
  for (const v of VIEWS) document.querySelector(`.views .v-${v}`)?.classList.toggle('on', S.view === v);
  document.querySelector('.month-nav').classList.toggle('list-mode', S.view === 'list');
  const n = S.hidden.size;
  const fb = document.querySelector('.filter-btn');
  fb.classList.toggle('active', n > 0);
  fb.querySelector('.fcount').textContent = n ? t('hidden_n', { n }) : '';
  main.className = `view-${S.view}`;
  const draw = { day: () => timeView(1), week: () => timeView(7), month: monthView, year: yearView, list: listView }[S.view];
  main.replaceChildren(...[draw()].flat(Infinity).filter(Boolean));
  if (S.view === 'day' || S.view === 'week') scrollGrid();
}
const redrawMain = () => drawMain();

// ───────────── month ─────────────

function monthView() {
  const a = anchor();
  const first = new Date(a.getFullYear(), a.getMonth(), 1);
  const start = weekStart(first);
  const last = new Date(a.getFullYear(), a.getMonth() + 1, 0);
  const weeks = Math.ceil(((last - start) / 86400000 + 1) / 7);
  const occs = occList(start, D.addDays(start, weeks * 7));
  const maxL = narrow() ? 3 : 4;
  const today = D.todayKey();

  const head = h('div.wk-head', Array.from({ length: 7 }, (_, i) => h('span', D.fWeekdayShort(D.addDays(start, i)))));
  const rows = [];
  for (let w = 0; w < weeks; w++) {
    const days = Array.from({ length: 7 }, (_, i) => D.addDays(start, w * 7 + i));
    const keys = days.map(D.dayKey);
    const segs = lanes(occs, keys);
    const more = Array(7).fill(0);
    for (const g of segs) if (g.lane >= maxL) for (let i = g.s; i <= g.e; i++) more[i]++;
    // phones: a week only takes the height its events need; desktop keeps even rows
    const used = segs.reduce((m, g) => Math.max(m, g.lane + 1), 0);
    const rowLanes = narrow() ? Math.max(1, Math.min(maxL, used)) : maxL;
    const hasMore = more.some(Boolean);
    rows.push(h(`div.week${hasMore ? '.has-more' : ''}`, { style: { '--lanes': rowLanes } },
      days.map((d, i) => h(`button.dcell${d.getMonth() !== first.getMonth() ? '.out' : ''}${keys[i] === today ? '.today' : ''}${keys[i] === S.selected ? '.sel' : ''}`, {
        type: 'button', style: { gridColumn: `${i + 1}` }, 'data-k': keys[i],
        'aria-label': D.fDayLong(d),
        onclick: () => selectDay(keys[i], d.getMonth() !== first.getMonth()),
        ondblclick: () => S.me.role !== 'viewer' && openEditor({ mode: 'new', date: keys[i] }),
      }, h('span.num', d.getDate()))),
      segs.filter((g) => g.lane < rowLanes).map((g) => bar(g)),
      more.map((n, i) => (n ? h('span.more', { style: { gridColumn: `${i + 1}`, gridRow: `${rowLanes + 2}` } }, t('more', { n })) : null))));
  }
  return [h('section.month-grid', head, h('div.weeks', rows)), dayPanel()];
}

function bar(g) {
  const ev = g.o.ev;
  const cls = ['bar', g.span ? 'span' : 'timed', ev.status === 'pending' && 'pending', g.contL && 'cl', g.contR && 'cr'].filter(Boolean).join('.');
  return h(`button.${cls}`, {
    type: 'button', tabindex: '-1',
    style: { gridColumn: `${g.s + 1} / ${g.e + 2}`, gridRow: `${g.lane + 2}`, '--c': evColor(ev) },
    title: ev.title,
    onclick: (e) => { e.stopPropagation(); openEvent(ev, g.o); },
  }, !g.span ? h('b', D.fTime(g.o.start)) : null, h('span', ev.title));
}

// selecting a day inside the shown month only swaps the highlight and the list below — no full redraw, no jump
function selectDay(k, otherMonth) {
  S.selected = k;
  if (otherMonth) { drawMain(); return; }
  document.querySelectorAll('.dcell.sel').forEach((c) => c.classList.remove('sel'));
  document.querySelector(`.dcell[data-k="${k}"]`)?.classList.add('sel');
  document.querySelector('.day-panel')?.replaceWith(dayPanel());
  revealPanel();
}

// on a phone the list sits under the grid: scroll just enough that its header shows, without jumping around
function revealPanel() {
  const p = document.querySelector('.day-panel');
  if (!p || !narrow()) return;
  const top = p.getBoundingClientRect().top;
  if (top > innerHeight - 180) window.scrollBy({ top: top - innerHeight + 260, behavior: 'smooth' });
}

function dayPanel() {
  const d = anchor();
  const list = byDay(occList(d, D.addDays(d, 1))).get(S.selected) || [];
  const step = (n) => {
    const nd = D.addDays(d, n);
    selectDay(D.dayKey(nd), nd.getMonth() !== d.getMonth());
  };
  return h('section.day-panel',
    h('div.dp-head',
      h('button.icon-btn', { type: 'button', 'aria-label': '‹', onclick: () => step(-1) }, icon('left')),
      h('h2', D.fDayLong(d)),
      h('button.icon-btn', { type: 'button', 'aria-label': '›', onclick: () => step(1) }, icon('right'))),
    list.length ? h('div.occ-list', list.map(occCard))
      : h('div.empty', h('p', t('no_events')),
        S.me.role !== 'viewer' ? h('button.btn.ghost', { type: 'button', onclick: () => openEditor({ mode: 'new', date: S.selected }) }, icon('plus'), t('add_event')) : null));
}

// ───────────── day + week (time grid) ─────────────

function timeView(n) {
  const days = n === 1 ? [anchor()] : Array.from({ length: 7 }, (_, i) => D.addDays(weekStart(anchor()), i));
  const keys = days.map(D.dayKey);
  const from = days[0], to = D.addDays(days[days.length - 1], 1);
  const occs = occList(from, to);
  const spans = occs.filter(isSpan), timed = occs.filter((o) => !isSpan(o));
  const today = D.todayKey();
  const H = HOUR();
  const cols = `var(--gutter) repeat(${n}, minmax(0, 1fr))`;

  const head = h('div.tg-head', { style: { gridTemplateColumns: cols } }, h('span'),
    days.map((d, i) => h(`button.tg-day${keys[i] === today ? '.today' : ''}${n === 1 ? '.single' : ''}`, {
      type: 'button', onclick: () => { S.selected = keys[i]; setView('day', redrawMain); },
    }, h('small', D.fWeekdayShort(d)), h('b', d.getDate()))));

  const segs = lanes(spans, keys);
  const nl = segs.reduce((m, g) => Math.max(m, g.lane + 1), 0);
  const allday = nl ? h('div.tg-allday', { style: { gridTemplateColumns: cols, gridTemplateRows: `repeat(${nl}, var(--lane-h))` } },
    h('span.tg-gut', { style: { gridRow: `1 / ${nl + 1}` } }, t('all_day')),
    segs.map((g) => {
      const el = bar(g);
      el.style.gridColumn = `${g.s + 2} / ${g.e + 3}`;
      el.style.gridRow = `${g.lane + 1}`;
      return el;
    })) : null;

  const hours = h('div.tg-hours', Array.from({ length: 24 }, (_, i) => h('span', { style: { top: `${i * H}px` } }, i ? `${String(i).padStart(2, '0')}:00` : '')));
  const columns = days.map((d, i) => {
    const dayStart = D.startOfDay(d).getTime(), dayEnd = D.addDays(d, 1).getTime();
    const items = timed.filter((o) => o.start.getTime() < dayEnd && Math.max(o.end.getTime(), o.start.getTime() + 1) > dayStart)
      .map((o) => ({ o, s: Math.max(o.start.getTime(), dayStart), e: Math.min(Math.max(o.end.getTime(), o.start.getTime() + 15 * 60000), dayEnd) }));
    layoutOverlaps(items);
    const col = h(`div.tg-col${keys[i] === today ? '.today' : ''}`, {
      style: { height: `${24 * H}px` },
      onclick: (e) => {
        if (e.target !== e.currentTarget || S.me.role === 'viewer') return;
        const hr = Math.min(23, Math.floor(e.offsetY / H));
        openEditor({ mode: 'new', date: keys[i], time: `${String(hr).padStart(2, '0')}:00` });
      },
    }, items.map((it) => {
      const ev = it.o.ev;
      const top = ((it.s - dayStart) / 3600000) * H, height = Math.max(18, ((it.e - it.s) / 3600000) * H - 2);
      const resp = member(ev.responsible), cat = category(ev.category_id);
      return h(`button.tev${ev.status === 'pending' ? '.pending' : ''}${height < 34 ? '.short' : ''}`, {
        type: 'button',
        style: { top: `${top}px`, height: `${height}px`, left: `calc(${(it.col / it.ncols) * 100}% + 1px)`, width: `calc(${100 / it.ncols}% - 3px)`, '--c': evColor(ev) },
        onclick: () => openEvent(ev, it.o),
      }, h('b', ev.title), h('small', `${D.fTime(it.o.start)}–${D.fTime(it.o.end)}`),
      n === 1 && (ev.location || resp || cat) ? h('small.tev-meta', [cat ? `${cat.icon} ${catLabel(cat)}` : '', resp?.name || '', ev.location || ''].filter(Boolean).join(' · ')) : null);
    }));
    if (keys[i] === today) {
      const now = new Date();
      col.append(h('span.now-line', { style: { top: `${((now - D.startOfDay(now)) / 3600000) * H}px` } }));
    }
    return col;
  });
  const grid = h('div.tg-grid', { style: { gridTemplateColumns: cols, '--hour': `${H}px` } }, hours, columns);
  return h(`section.timegrid${n === 1 ? '.one' : ''}`, head, allday, h('div.tg-scroll', grid));
}

// side-by-side columns for overlapping events (classic cluster layout)
function layoutOverlaps(items) {
  items.sort((a, b) => (a.s - b.s) || (b.e - a.e));
  let cluster = [], colsEnd = [], clusterEnd = -1;
  const close = () => { for (const it of cluster) it.ncols = colsEnd.length; cluster = []; colsEnd = []; };
  for (const it of items) {
    if (it.s >= clusterEnd && cluster.length) close();
    let c = colsEnd.findIndex((end) => end <= it.s);
    if (c < 0) { c = colsEnd.length; colsEnd.push(it.e); } else colsEnd[c] = it.e;
    it.col = c;
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  close();
}

function scrollGrid() {
  const sc = document.querySelector('.tg-scroll');
  if (!sc) return;
  const H = HOUR();
  const firstTimed = [...sc.querySelectorAll('.tev')].map((e) => parseFloat(e.style.top)).sort((a, b) => a - b)[0];
  const nowLine = sc.querySelector('.now-line');
  // today: a bit before now; otherwise just before the first event; otherwise 07:00
  const target = nowLine ? parseFloat(nowLine.style.top) - 2 * H : firstTimed != null ? firstTimed - H : 7 * H;
  sc.scrollTop = Math.max(0, target);
}

// ───────────── year ─────────────

function yearView() {
  const y = anchor().getFullYear();
  const from = new Date(y, 0, 1), to = new Date(y + 1, 0, 1);
  const map = byDay(occList(from, to));
  const today = D.todayKey();
  const ws = S.settings.week_start ?? 1;
  const usedCats = new Map();
  const months = Array.from({ length: 12 }, (_, m) => {
    const first = new Date(y, m, 1);
    const pad = (first.getDay() - ws + 7) % 7;
    const len = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < pad; i++) cells.push(h('span.yd.blank'));
    for (let d = 1; d <= len; d++) {
      const date = new Date(y, m, d), k = D.dayKey(date);
      const list = map.get(k) || [];
      const span = list.find(isSpan), timedN = list.filter((o) => !isSpan(o)).length;
      for (const o of list) usedCats.set(catKey(o.ev), o.ev);
      cells.push(h(`button.yd${k === today ? '.today' : ''}${span ? '.has-span' : ''}`, {
        type: 'button', style: span ? { '--c': evColor(span.ev) } : null,
        title: list.map((o) => o.ev.title).join('\n') || undefined,
        onclick: () => { S.selected = k; setView('day', redrawMain); },
      }, d, timedN ? h('i', { style: { '--c': evColor(list.find((o) => !isSpan(o)).ev) } }) : null));
    }
    return h('div.ymonth',
      h('button.ym-title', { type: 'button', onclick: () => { S.selected = D.dayKey(first); setView('month', redrawMain); } },
        new Intl.DateTimeFormat(locale(), { month: 'long' }).format(first)),
      h('div.ym-head', Array.from({ length: 7 }, (_, i) => h('span', D.fWeekday(D.addDays(weekStart(first), i))))),
      h('div.ym-grid', cells));
  });
  const legend = [...usedCats.values()].map((ev) => {
    const c = category(ev.category_id);
    return h('span.leg', { style: { '--c': evColor(ev) } }, c ? `${c.icon} ${catLabel(c)}` : t('no_category'));
  });
  return [h('section.year', months), legend.length ? h('div.legend', legend) : null];
}

// ───────────── list ─────────────

function listView() {
  const from = D.startOfDay(new Date());
  const map = byDay(occList(from, D.addDays(from, S.listDays)));
  const keys = [...map.keys()].filter((k) => k >= D.dayKey(from)).sort();
  const out = keys.map((k) => h('section.list-day',
    h('h3', { class: k === D.todayKey() ? 'is-today' : '' }, D.fDayLong(D.keyToDate(k))),
    h('div.occ-list', map.get(k).map(occCard))));
  return h('div.list-wrap', out.length ? out : h('div.empty', h('p', t('nothing_upcoming'))),
    h('button.btn.ghost.block', { type: 'button', onclick: () => { S.listDays += 60; drawMain(); } }, t('load_more')));
}

// ───────────── filter ─────────────

function openFilter(redraw) {
  const s = sheet({ title: t('filter'), className: 'small' });
  const draw = () => {
    const cats = S.categories.filter((c) => !c.archived || S.hidden.has(c.id));
    const row = (key, label, color) => h('label.switch.filter-row', { style: { '--c': color } },
      h('input', {
        type: 'checkbox', checked: !S.hidden.has(key),
        onchange: (e) => {
          if (e.target.checked) S.hidden.delete(key); else S.hidden.add(key);
          store.set('zaeme.hidden', [...S.hidden]);
          redraw(); draw();
        },
      }),
      h('i.swatch'), h('span', label));
    s.set(
      h('p.hint', t('filter_hint')),
      cats.map((c) => row(c.id, `${c.icon} ${catLabel(c)}`, c.color)),
      row('none', t('no_category'), '#94a3b8'),
      S.hidden.size ? h('button.btn.block.ghost', {
        type: 'button', onclick: () => { S.hidden.clear(); store.set('zaeme.hidden', []); redraw(); draw(); },
      }, t('show_all')) : null);
  };
  draw();
}
