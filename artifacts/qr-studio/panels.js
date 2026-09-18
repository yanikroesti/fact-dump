/* QR Studio · panels.js
   The tabs beside the editor: your codes, statistics, stored files, the scanner,
   bulk generation and the local history. Also the two batch outputs everything
   else reuses — a ZIP of images and a printable A4 sheet. */
(function () {
  'use strict';
  const QS = (window.QS = window.QS || {});
  const U = QS.util, E = QS.engine, UI = QS.ui;
  const { el, qs, qsa, toast } = UI;

  const cache = { codes: null, batches: null, stats: {}, files: null };
  const statsState = { ids: [], days: 30 };

  function render(tab) {
    if (tab === 'codes') return codes();
    if (tab === 'stats') return stats();
    if (tab === 'files') return files();
    if (tab === 'scan') return scan();
    if (tab === 'bulk') return bulk();
    if (tab === 'history') return history();
  }

  const needOwner = host => {
    if (QS.cloud.state.owner) return false;
    host.innerHTML = '';
    host.appendChild(el('div', { class: 'notice big' }, [
      el('h2', { text: 'Owner area' }),
      el('p', { text: 'Short links, uploads and scan statistics live behind the owner login. Everything else in the studio works without it.' }),
      el('button', { class: 'btn primary', type: 'button', text: 'Log in with an e-mail code', onclick: () => QS.app.loginModal() })
    ]));
    return true;
  };

  const statusOf = c => {
    if (!c.active) return { k: 'paused', l: 'paused' };
    if (c.starts_at && new Date(c.starts_at) > new Date()) return { k: 'scheduled', l: 'scheduled' };
    if (c.expires_at && new Date(c.expires_at) <= new Date()) return { k: 'expired', l: 'expired' };
    if (c.max_scans && c.scan_count >= c.max_scans) return { k: 'used', l: c.max_scans === 1 ? 'used' : 'limit reached' };
    return { k: 'live', l: 'live' };
  };

  /* ───────────────────────── your codes ───────────────────────── */
  async function codes() {
    const host = qs('#tab-codes');
    if (needOwner(host)) return;
    host.innerHTML = '<p class="loading">Loading your codes…</p>';
    let data;
    try {
      data = await QS.cloud.list();
    } catch (err) {
      host.innerHTML = '';
      host.appendChild(el('p', { class: 'error-text', text: err.message }));
      return;
    }
    cache.codes = data.codes || [];
    cache.batches = data.batches || [];
    paintCodes(host);
  }

  function paintCodes(host) {
    host.innerHTML = '';
    const filters = { q: '', folder: '', status: '' };
    const folders = [...new Set(cache.codes.map(c => c.folder).filter(Boolean))];

    const bar = el('div', { class: 'filter-row' }, [
      el('input', { class: 'input', placeholder: 'Search title or link…', oninput: e => { filters.q = e.target.value.toLowerCase(); paintList(); } }),
      (() => {
        const s = el('select', { class: 'input', onchange: e => { filters.folder = e.target.value; paintList(); } });
        s.appendChild(el('option', { value: '', text: 'all folders' }));
        folders.forEach(f => s.appendChild(el('option', { value: f, text: f })));
        return s;
      })(),
      (() => {
        const s = el('select', { class: 'input', onchange: e => { filters.status = e.target.value; paintList(); } });
        [['', 'any status'], ['live', 'live'], ['paused', 'paused'], ['scheduled', 'scheduled'], ['expired', 'expired'], ['used', 'used up']]
          .forEach(([v, l]) => s.appendChild(el('option', { value: v, text: l })));
        return s;
      })(),
      el('button', { class: 'btn ghost small', type: 'button', text: 'Reload', onclick: () => codes() })
    ]);
    host.appendChild(bar);

    const listBox = el('div', { class: 'code-list' });
    host.appendChild(listBox);

    function paintList() {
      listBox.innerHTML = '';
      const rows = cache.codes.filter(c => {
        if (filters.folder && c.folder !== filters.folder) return false;
        if (filters.status && statusOf(c).k !== filters.status) return false;
        if (filters.q && !((c.title || '') + ' ' + c.slug + ' ' + (c.target || '')).toLowerCase().includes(filters.q)) return false;
        return true;
      });
      if (!rows.length && !cache.batches.length) {
        listBox.appendChild(el('p', { class: 'empty', text: 'No short links yet. Build one in Create — switch on "Make it a short link".' }));
        return;
      }
      rows.forEach(c => listBox.appendChild(codeRow(c)));
      cache.batches.forEach(b => listBox.appendChild(batchRow(b)));
    }
    paintList();
  }

  function codeRow(c) {
    const st = statusOf(c);
    const kindLabel = c.kind === 'url' ? 'link' : ((c.page && c.page.type) || 'page');
    const row = el('div', { class: 'code-row' }, [
      el('div', { class: 'code-main' }, [
        el('div', { class: 'code-title' }, [
          el('span', { text: c.title || c.slug }),
          el('span', { class: 'pill ' + st.k, text: st.l }),
          c.has_password ? el('span', { class: 'pill lock', text: 'password' }) : null,
          c.max_scans ? el('span', { class: 'pill', text: c.max_scans === 1 ? 'one-time' : 'max ' + c.max_scans }) : null
        ]),
        el('div', { class: 'code-sub' }, [
          el('a', { class: 'mono link', href: QS.cloud.shortURL(c.slug), target: '_blank', rel: 'noopener', text: '/q/' + c.slug }),
          el('span', { class: 'dot', text: '·' }),
          el('span', { text: kindLabel }),
          c.folder ? el('span', { class: 'dot', text: '·' }) : null,
          c.folder ? el('span', { text: c.folder }) : null,
          el('span', { class: 'dot', text: '·' }),
          el('span', { text: 'created ' + U.ago(c.created_at) })
        ])
      ]),
      el('div', { class: 'code-stats' }, [
        el('b', { text: String(c.scans_total || 0) }),
        el('span', { text: 'scans' }),
        el('i', { text: (c.scans_7d || 0) + ' in 7 d' })
      ]),
      el('div', { class: 'code-actions' }, [
        el('button', { class: 'btn ghost small', type: 'button', text: 'Stats', onclick: () => { statsState.ids = [c.id]; QS.app.setTab('stats'); } }),
        el('button', { class: 'btn ghost small', type: 'button', text: 'Edit', onclick: () => QS.app.loadCode(c) }),
        el('button', { class: 'btn ghost small', type: 'button', text: 'QR', onclick: () => downloadCodeImage(c) }),
        el('button', { class: 'btn ghost small', type: 'button', text: 'Copy', onclick: async () => toast(await U.copyText(QS.cloud.shortURL(c.slug)) ? 'Link copied' : 'Could not copy') }),
        el('button', {
          class: 'btn ghost small', type: 'button', text: c.active ? 'Pause' : 'Resume',
          onclick: async () => {
            try { await QS.cloud.save({ id: c.id, active: !c.active }); toast(c.active ? 'Paused' : 'Live again'); codes(); }
            catch (e) { toast(e.message, 'error'); }
          }
        }),
        c.max_scans ? el('button', {
          class: 'btn ghost small', type: 'button', text: 'Reset',
          onclick: async () => { try { await QS.cloud.reset([c.id]); toast('Scan count reset'); codes(); } catch (e) { toast(e.message, 'error'); } }
        }) : null,
        el('button', {
          class: 'btn ghost small danger', type: 'button', text: 'Delete',
          onclick: async () => {
            if (!(await UI.confirm('Delete this code?', 'The printed code stops working immediately. Scan history goes with it.'))) return;
            try { await QS.cloud.remove([c.id]); toast('Deleted'); codes(); } catch (e) { toast(e.message, 'error'); }
          }
        })
      ])
    ]);
    return row;
  }

  function batchRow(b) {
    const tpl = b.template || {};
    return el('div', { class: 'code-row batch' }, [
      el('div', { class: 'code-main' }, [
        el('div', { class: 'code-title' }, [
          el('span', { text: b.label || 'Batch' }),
          el('span', { class: 'pill', text: b.count + ' one-time codes' }),
          el('span', { class: 'pill ' + (b.used >= b.count ? 'used' : 'live'), text: b.used + ' used' })
        ]),
        el('div', { class: 'code-sub' }, [el('span', { text: 'created ' + U.ago(b.created_at) })])
      ]),
      el('div', { class: 'code-stats' }, [
        el('b', { text: String(b.scanned || 0) }),
        el('span', { text: 'scanned' })
      ]),
      el('div', { class: 'code-actions' }, [
        el('button', { class: 'btn ghost small', type: 'button', text: 'Open', onclick: () => openBatch(b) }),
        el('button', { class: 'btn ghost small', type: 'button', text: 'ZIP', onclick: () => exportBatch(b, 'zip') }),
        el('button', { class: 'btn ghost small', type: 'button', text: 'Sheet', onclick: () => exportBatch(b, 'sheet') }),
        el('button', { class: 'btn ghost small', type: 'button', text: 'CSV', onclick: () => exportBatch(b, 'csv') }),
        el('button', {
          class: 'btn ghost small danger', type: 'button', text: 'Delete',
          onclick: async () => {
            if (!(await UI.confirm('Delete the whole batch?', `All ${b.count} codes stop working.`))) return;
            const list = await QS.cloud.batchCodes(b.batch_id);
            await QS.cloud.remove(list.map(x => x.id));
            toast('Batch deleted');
            codes();
          }
        })
      ])
    ]);
  }

  async function openBatch(b) {
    const list = await QS.cloud.batchCodes(b.batch_id);
    const body = el('div', { class: 'batch-list' });
    list.forEach(c => {
      body.appendChild(el('div', { class: 'batch-item' }, [
        el('span', { class: 'mono', text: '#' + c.batch_no }),
        el('a', { class: 'mono link', href: QS.cloud.shortURL(c.slug), target: '_blank', rel: 'noopener', text: '/q/' + c.slug }),
        el('span', { class: 'pill ' + (c.scan_count ? 'used' : 'live'), text: c.scan_count ? 'used ' + U.ago(c.first_scan_at) : 'unused' }),
        el('button', {
          class: 'btn ghost small', type: 'button', text: 'Reset',
          onclick: async () => { await QS.cloud.reset([c.id]); toast('Reset'); }
        })
      ]));
    });
    UI.modal({ title: b.label || 'Batch', wide: true, body });
  }

  async function exportBatch(b, how) {
    try {
      const list = await QS.cloud.batchCodes(b.batch_id);
      const design = (b.template && b.template.design) || QS.app.state.design;
      if (how === 'csv') {
        const csv = U.toCSV(list.map(c => [c.batch_no, c.slug, QS.cloud.shortURL(c.slug), c.scan_count ? 'used' : 'unused', c.first_scan_at || '']),
          ['no', 'slug', 'link', 'status', 'first scan']);
        U.download(new Blob([csv], { type: 'text/csv' }), U.slugify(b.label, 'batch') + '.csv');
        return;
      }
      toast('Rendering ' + list.length + ' codes…');
      const items = [];
      for (const c of list) {
        const scene = E.compose({ text: QS.cloud.shortURL(c.slug) }, design, {});
        items.push({ scene, label: '#' + c.batch_no, name: c.slug });
      }
      if (how === 'zip') U.download(await zipCodes(items, { format: 'png', px: 1024 }), U.slugify(b.label, 'batch') + '.zip');
      else U.download(await sheetPDF(items, { mm: 40 }), U.slugify(b.label, 'batch') + '-sheet.pdf');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function downloadCodeImage(c) {
    try {
      await E.ready(c.design || {});
      const scene = E.compose({ text: QS.cloud.shortURL(c.slug) }, c.design || QS.app.state.design, {});
      const blob = await E.rasterize(scene, { px: 1024, type: 'image/png', background: '#ffffff' });
      U.download(blob, U.slugify(c.title || c.slug, 'qr') + '.png');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  /* ───────────────────────── statistics ───────────────────────── */
  async function stats() {
    const host = qs('#tab-stats');
    if (needOwner(host)) return;
    if (!cache.codes) {
      try { const d = await QS.cloud.list(); cache.codes = d.codes || []; cache.batches = d.batches || []; } catch (e) { /* ignore */ }
    }
    host.innerHTML = '<p class="loading">Loading statistics…</p>';
    let data;
    try {
      data = await QS.cloud.stats(statsState.ids, statsState.days);
    } catch (err) {
      host.innerHTML = '';
      host.appendChild(el('p', { class: 'error-text', text: err.message }));
      return;
    }
    host.innerHTML = '';

    /* one filter row above everything it scopes */
    const codeSel = el('select', { class: 'input', onchange: e => { statsState.ids = e.target.value ? [e.target.value] : []; stats(); } });
    codeSel.appendChild(el('option', { value: '', text: 'all codes' }));
    (cache.codes || []).forEach(c => codeSel.appendChild(el('option', { value: c.id, text: (c.title || c.slug) })));
    codeSel.value = statsState.ids[0] || '';
    const rangeSel = el('select', { class: 'input', onchange: e => { statsState.days = Number(e.target.value); stats(); } });
    [[7, 'last 7 days'], [30, 'last 30 days'], [90, 'last 90 days'], [365, 'last year']].forEach(([v, l]) => rangeSel.appendChild(el('option', { value: v, text: l })));
    rangeSel.value = String(statsState.days);
    host.appendChild(el('div', { class: 'filter-row' }, [
      codeSel, rangeSel,
      el('button', { class: 'btn ghost small', type: 'button', text: 'Export CSV', onclick: exportCSV }),
      el('button', { class: 'btn ghost small', type: 'button', text: 'Reload', onclick: () => stats() })
    ]));

    /* KPI row */
    const spark = (data.daily || []).map(d => d.n);
    host.appendChild(el('div', { class: 'kpi-row' }, [
      kpi('Scans in this period', data.period, U.esc(''), QS.charts.sparkline(spark)),
      kpi('Unique visitors', data.unique),
      kpi('Today', data.today),
      kpi('All time', data.total),
      kpi('Blocked / expired', data.blocked)
    ]));

    host.appendChild(chartCard('Scans per day', c => QS.charts.columns(c, {
      rows: (data.daily || []).map(d => ({
        label: U.dateTime(d.d, { day: '2-digit', month: 'short', year: 'numeric' }),
        short: String(d.d).slice(5), value: d.n, extra: d.u
      })),
      unit: 'scans', extraUnit: 'unique'
    }), () => ({
      headers: ['Day', 'Scans', 'Unique'],
      rows: (data.daily || []).map(d => [d.d, d.n, d.u])
    })));

    host.appendChild(chartCard('When people scan', c => QS.charts.heat(c, { cells: data.heat || [] }), () => ({
      headers: ['Weekday', 'Hour', 'Scans'],
      rows: (data.heat || []).map(([d, h, n]) => [['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d - 1], h + ':00', n])
    })));

    const grid2 = el('div', { class: 'stat-grid' });
    const flag = code => {
      if (!code || code.length !== 2 || code === '??') return '';
      return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1f1a5 + c.charCodeAt(0)));
    };
    grid2.appendChild(chartCard('Countries', c => QS.charts.bars(c, { rows: (data.country || []).map(x => ({ label: x.k, value: x.n, icon: flag(x.k) })), share: true }), () => tableFrom(data.country)));
    grid2.appendChild(chartCard('Cities', c => QS.charts.bars(c, { rows: (data.city || []).map(x => ({ label: x.k, value: x.n })) }), () => tableFrom(data.city)));
    grid2.appendChild(chartCard('Systems', c => QS.charts.bars(c, { rows: (data.os || []).map(x => ({ label: x.k, value: x.n })), share: true }), () => tableFrom(data.os)));
    grid2.appendChild(chartCard('Devices', c => QS.charts.bars(c, { rows: (data.device || []).map(x => ({ label: x.k, value: x.n })), share: true }), () => tableFrom(data.device)));
    grid2.appendChild(chartCard('Browsers', c => QS.charts.bars(c, { rows: (data.browser || []).map(x => ({ label: x.k, value: x.n })) }), () => tableFrom(data.browser)));
    grid2.appendChild(chartCard('Languages', c => QS.charts.bars(c, { rows: (data.lang || []).map(x => ({ label: x.k, value: x.n })) }), () => tableFrom(data.lang)));
    host.appendChild(grid2);

    if ((data.served || []).length > 1) {
      host.appendChild(chartCard('Where they were sent (A/B & routing)', c => QS.charts.bars(c, {
        rows: data.served.map(x => ({ label: x.k, value: x.n })), share: true
      }), () => tableFrom(data.served)));
    }
    if ((data.outcome || []).some(o => o.k !== 'ok')) {
      host.appendChild(chartCard('Outcomes', c => QS.charts.bars(c, {
        rows: data.outcome.map(x => ({ label: outcomeLabel(x.k), value: x.n })),
        emphasis: r => r.label === 'opened'
      }), () => ({ headers: ['Outcome', 'Count'], rows: (data.outcome || []).map(o => [outcomeLabel(o.k), o.n]) })));
    }

    if (data.feedback && data.feedback.count) {
      const fb = data.feedback;
      const card = el('section', { class: 'card' }, [
        el('div', { class: 'card-head' }, [el('h2', { text: 'Feedback' }), el('span', { class: 'muted', text: fb.count + ' answers · ⌀ ' + (fb.avg || '—') })])
      ]);
      const list = el('div', { class: 'feedback-list' });
      (fb.items || []).forEach(f => {
        list.appendChild(el('div', { class: 'feedback-item' }, [
          el('span', { class: 'stars', text: '★'.repeat(f.rating || 0) + '☆'.repeat(5 - (f.rating || 0)) }),
          el('p', { text: f.comment || '' }),
          el('span', { class: 'muted small', text: U.dateTime(f.at) + (f.contact ? ' · ' + f.contact : '') })
        ]));
      });
      card.appendChild(list);
      host.appendChild(card);
    }

    const recent = el('section', { class: 'card' }, [el('div', { class: 'card-head' }, [el('h2', { text: 'Recent scans' })])]);
    const tableBox = el('div');
    QS.charts.table(tableBox, {
      headers: ['When', 'Code', 'Place', 'Device', 'Outcome'],
      rows: (data.recent || []).slice(0, 60).map(s => [
        U.dateTime(s.at),
        codeName(s.code_id),
        [s.city, s.country].filter(Boolean).join(', ') || '—',
        [s.os, s.device, s.browser].filter(Boolean).join(' · ') || '—',
        outcomeLabel(s.outcome)
      ])
    });
    recent.appendChild(tableBox);
    host.appendChild(recent);
  }

  const codeName = id => {
    const c = (cache.codes || []).find(x => x.id === id);
    return c ? (c.title || c.slug) : '—';
  };
  const outcomeLabel = k => ({
    ok: 'opened', paused: 'paused', expired: 'expired', used: 'already used',
    limit: 'limit reached', notyet: 'not started yet', badpass: 'wrong password'
  }[k] || k);
  const tableFrom = rows => ({ headers: ['Value', 'Scans'], rows: (rows || []).map(r => [r.k, r.n]) });

  function kpi(label, value, sub, sparkHTML) {
    return el('div', { class: 'kpi' }, [
      el('span', { class: 'kpi-label', text: label }),
      el('b', { class: 'kpi-value', text: Number(value || 0).toLocaleString() }),
      sparkHTML ? el('span', { class: 'kpi-spark', html: sparkHTML }) : null
    ]);
  }
  /* every chart ships with a table twin */
  function chartCard(title, draw, tableData) {
    const card = el('section', { class: 'card chart-card' });
    const plot = el('div', { class: 'chart-plot' });
    const tableBox = el('div', { class: 'chart-table hidden' });
    let shown = false;
    const toggle = el('button', {
      class: 'btn ghost small', type: 'button', text: 'Table',
      onclick: () => {
        shown = !shown;
        plot.classList.toggle('hidden', shown);
        tableBox.classList.toggle('hidden', !shown);
        toggle.textContent = shown ? 'Chart' : 'Table';
        if (shown && !tableBox.dataset.done) {
          QS.charts.table(tableBox, tableData());
          tableBox.dataset.done = '1';
        }
      }
    });
    card.appendChild(el('div', { class: 'card-head' }, [el('h2', { text: title }), toggle]));
    card.append(plot, tableBox);
    setTimeout(() => draw(plot), 0);
    return card;
  }

  async function exportCSV() {
    try {
      const rows = await QS.cloud.exportScans(statsState.ids);
      const csv = U.toCSV(rows.map(r => [r.at, r.slug, r.title, r.outcome, r.country, r.city, r.os, r.device, r.browser, r.lang, r.served]),
        ['time', 'slug', 'title', 'outcome', 'country', 'city', 'os', 'device', 'browser', 'language', 'sent to']);
      U.download(new Blob([csv], { type: 'text/csv' }), 'qr-scans.csv');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  /* ───────────────────────── files ───────────────────────── */
  async function files() {
    const host = qs('#tab-files');
    if (needOwner(host)) return;
    host.innerHTML = '<p class="loading">Loading files…</p>';
    let data;
    try {
      data = await QS.cloud.files();
    } catch (err) {
      host.innerHTML = '';
      host.appendChild(el('p', { class: 'error-text', text: err.message }));
      return;
    }
    cache.files = data;
    host.innerHTML = '';
    const pct = Math.min(100, (data.used / data.limit) * 100);
    host.appendChild(el('section', { class: 'card' }, [
      el('div', { class: 'card-head' }, [el('h2', { text: 'Storage' }), el('span', { class: 'muted', text: U.bytesHuman(data.used) + ' of ' + U.bytesHuman(data.limit) })]),
      el('div', { class: 'capacity' }, [el('span', { class: 'cap-bar' }, [el('i', { style: 'width:' + pct.toFixed(1) + '%' })])]),
      el('p', { class: 'field-help', text: 'Files uploaded for hosted codes. Anything a code still uses shows a count — deleting those breaks the code.' })
    ]));
    const list = el('div', { class: 'file-list' });
    (data.files || []).forEach(f => {
      list.appendChild(el('div', { class: 'file-row' }, [
        /^image\//.test(f.mime || '') ? el('img', { class: 'file-thumb', src: QS.cloud.publicURL(f.path), alt: '', loading: 'lazy' }) : el('span', { class: 'file-thumb mono', text: (f.mime || '').split('/')[1] || 'file' }),
        el('div', { class: 'file-main' }, [
          el('a', { class: 'link', href: QS.cloud.publicURL(f.path), target: '_blank', rel: 'noopener', text: f.path.split('/').pop() }),
          el('div', { class: 'muted small', text: `${U.bytesHuman(f.size)} · ${U.dateTime(f.at)} · used by ${f.used_by} code${f.used_by === 1 ? '' : 's'}` })
        ]),
        el('button', { class: 'btn ghost small', type: 'button', text: 'Copy link', onclick: async () => toast(await U.copyText(QS.cloud.publicURL(f.path)) ? 'Link copied' : 'Could not copy') }),
        el('button', {
          class: 'btn ghost small danger', type: 'button', text: 'Delete',
          onclick: async () => {
            const warn = f.used_by ? 'This file is still used by ' + f.used_by + ' code(s) — they will show a broken file.' : 'This cannot be undone.';
            if (!(await UI.confirm('Delete this file?', warn))) return;
            try { await QS.cloud.deleteFiles([f.path]); toast('Deleted'); files(); } catch (e) { toast(e.message, 'error'); }
          }
        })
      ]));
    });
    if (!(data.files || []).length) list.appendChild(el('p', { class: 'empty', text: 'Nothing uploaded yet.' }));
    host.appendChild(list);
  }

  /* ───────────────────────── scanner ───────────────────────── */
  let camera = { stream: null, raf: 0, detector: null };
  function scan() {
    const host = qs('#tab-scan');
    if (host.dataset.built) return;
    host.dataset.built = '1';
    host.innerHTML = '';
    const video = el('video', { class: 'scan-video', playsinline: true, muted: true });
    const canvas = el('canvas', { class: 'sr-only' });
    const result = el('div', { class: 'scan-result' });
    const startBtn = el('button', { class: 'btn primary', type: 'button', text: 'Start camera', onclick: () => toggleCamera(video, canvas, result, startBtn) });
    const fileInput = el('input', { type: 'file', class: 'sr-only', accept: 'image/*' });
    const pickBtn = el('button', { class: 'btn ghost', type: 'button', text: 'Read an image file', onclick: () => fileInput.click() });
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!f) return;
      try {
        const dataURL = await U.readFile(f);
        const img = await U.loadImage(dataURL);
        const cv = document.createElement('canvas');
        const scale = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
        cv.width = Math.round(img.naturalWidth * scale);
        cv.height = Math.round(img.naturalHeight * scale);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        const text = await decodeCanvas(cv);
        if (text) showScan(result, text);
        else toast('No QR code found in that image', 'error');
      } catch (e) { toast('Could not read that image', 'error'); }
    });
    host.append(
      el('section', { class: 'card' }, [
        el('div', { class: 'card-head' }, [el('h2', { text: 'Read a code' }), el('span', { class: 'muted', text: 'camera, file or paste' })]),
        el('div', { class: 'scan-tools' }, [startBtn, pickBtn, fileInput]),
        video, canvas, result
      ])
    );
    document.addEventListener('paste', async ev => {
      if (QS.app.state.tab !== 'scan') return;
      const item = [...(ev.clipboardData ? ev.clipboardData.items : [])].find(i => i.type.startsWith('image/'));
      if (!item) return;
      const blob = item.getAsFile();
      const img = await U.loadImage(await U.blobToDataURL(blob));
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      cv.getContext('2d').drawImage(img, 0, 0);
      const text = await decodeCanvas(cv);
      if (text) showScan(result, text);
      else toast('No QR code in the pasted image', 'error');
    });
  }

  async function decodeCanvas(cv) {
    if ('BarcodeDetector' in window) {
      try {
        if (!camera.detector) camera.detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        const found = await camera.detector.detect(cv);
        if (found && found[0]) return found[0].rawValue;
      } catch (e) { /* fall through to jsQR */ }
    }
    if (!window.jsQR) await U.loadScript(QS.CDN.jsqr);
    const ctx = cv.getContext('2d');
    const data = ctx.getImageData(0, 0, cv.width, cv.height);
    const res = window.jsQR(data.data, data.width, data.height, { inversionAttempts: 'attemptBoth' });
    return res ? res.data : null;
  }

  async function toggleCamera(video, canvas, result, btn) {
    if (camera.stream) {
      camera.stream.getTracks().forEach(t => t.stop());
      cancelAnimationFrame(camera.raf);
      camera.stream = null;
      video.classList.remove('on');
      btn.textContent = 'Start camera';
      return;
    }
    try {
      camera.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
      video.srcObject = camera.stream;
      await video.play();
      video.classList.add('on');
      btn.textContent = 'Stop camera';
      const tick = async () => {
        if (!camera.stream) return;
        if (video.videoWidth) {
          const scale = Math.min(1, 720 / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
          const text = await decodeCanvas(canvas);
          if (text) {
            showScan(result, text);
            toggleCamera(video, canvas, result, btn);
            return;
          }
        }
        camera.raf = requestAnimationFrame(() => setTimeout(tick, 110));
      };
      tick();
    } catch (err) {
      toast('No camera access — use "Read an image file" instead', 'error');
    }
  }

  function showScan(host, text) {
    const parsed = QS.formats.parse(text);
    host.innerHTML = '';
    const card = el('div', { class: 'scan-card' }, [
      el('div', { class: 'card-head' }, [el('h2', { text: parsed.label }), el('span', { class: 'muted', text: text.length + ' characters' })])
    ]);
    if (parsed.fields && parsed.fields.length) {
      const dl = el('div', { class: 'scan-fields' });
      parsed.fields.filter(f => f.value).forEach(f => {
        dl.appendChild(el('div', { class: 'scan-field' }, [
          el('span', { class: 'muted small', text: f.label }),
          el('span', { text: f.value })
        ]));
      });
      card.appendChild(dl);
    }
    card.appendChild(el('pre', { class: 'scan-raw', text: text }));
    const actions = el('div', { class: 'export-actions' }, [
      el('button', { class: 'btn ghost small', type: 'button', text: 'Copy', onclick: async () => toast(await U.copyText(text) ? 'Copied' : 'Could not copy') }),
      /^https?:\/\//i.test(text) ? el('button', {
        class: 'btn ghost small', type: 'button', text: 'Open link',
        onclick: async () => {
          if (await UI.confirm('Open this link?', text, 'Open')) window.open(text, '_blank', 'noopener');
        }
      }) : null,
      el('button', {
        class: 'btn primary small', type: 'button', text: 'Edit & restyle',
        onclick: () => {
          QS.app.applyValues(parsed.typeId || 'text', parsed.values || { text });
          toast('Loaded into the editor');
        }
      })
    ]);
    card.appendChild(actions);
    host.appendChild(card);
  }

  /* ───────────────────────── bulk ───────────────────────── */
  function bulk() {
    const host = qs('#tab-bulk');
    if (host.dataset.built) return;
    host.dataset.built = '1';
    host.innerHTML = '';
    const values = { mode: 'lines', text: '', template: '', format: 'png', px: 1024, sheet: false, dynamic: false, label: '' };
    const form = el('div');
    const out = el('div', { class: 'bulk-out' });
    UI.renderForm(form, [
      { k: 'mode', label: 'Input', type: 'select', w: 'half', options: [{ v: 'lines', l: 'One code per line' }, { v: 'csv', l: 'CSV with a header row' }] },
      { k: 'text', label: 'Lines', type: 'textarea', rows: 7, w: 'full', ph: 'https://example.com/a\nhttps://example.com/b', show: v => v.mode === 'lines' },
      { k: 'csv', label: 'CSV', type: 'textarea', rows: 7, w: 'full', ph: 'name,url\nShop,https://example.com', show: v => v.mode === 'csv' },
      { k: 'template', label: 'Template', type: 'text', w: 'full', ph: 'https://example.com/{id}', show: v => v.mode === 'csv', help: 'Use {column} to build each code. Leave empty to use the first column as it is.' },
      { k: 'labelCol', label: 'Label under the code', type: 'text', w: 'half', ph: '{name}', show: v => v.mode === 'csv' },
      { k: 'format', label: 'Image format', type: 'select', w: 'third', options: [{ v: 'png', l: 'PNG' }, { v: 'svg', l: 'SVG' }] },
      { k: 'px', label: 'PNG size', type: 'select', w: 'third', options: [512, 1024, 2048].map(p => ({ v: String(p), l: p + ' px' })), show: v => v.format === 'png' },
      { k: 'dynamic', label: 'Create them as editable short links (owner only)', type: 'checkbox', w: 'full' }
    ], values, () => { });
    const actions = el('div', { class: 'export-actions' }, [
      el('button', { class: 'btn primary', type: 'button', text: 'Generate ZIP', onclick: () => runBulk(values, out, 'zip') }),
      el('button', { class: 'btn ghost', type: 'button', text: 'Print sheet (PDF)', onclick: () => runBulk(values, out, 'sheet') })
    ]);
    host.append(el('section', { class: 'card' }, [
      el('div', { class: 'card-head' }, [el('h2', { text: 'Many codes at once' }), el('span', { class: 'muted', text: 'the current design is used for all of them' })]),
      form, actions, out
    ]));
  }

  async function runBulk(values, out, how) {
    out.innerHTML = '';
    const design = QS.app.state.design;
    let rows = [];
    try {
      if (values.mode === 'lines') {
        rows = String(values.text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(text => ({ text, label: '' }));
      } else {
        const table = U.parseCSV(values.csv || '');
        if (table.length < 2) throw new Error('Paste a CSV with a header row and at least one line.');
        const headers = table[0].map(h => h.trim());
        rows = table.slice(1).map(cells => {
          const rec = {};
          headers.forEach((h, i) => (rec[h] = (cells[i] || '').trim()));
          const fill = tpl => String(tpl || '').replace(/\{([^}]+)\}/g, (_, k) => rec[k.trim()] || '');
          return {
            text: values.template ? fill(values.template) : (cells[0] || '').trim(),
            label: values.labelCol ? fill(values.labelCol) : '',
            name: U.slugify(values.labelCol ? fill(values.labelCol) : (cells[0] || ''), 'code')
          };
        }).filter(r => r.text);
      }
      if (!rows.length) throw new Error('Nothing to generate.');
      if (rows.length > 1000) throw new Error('That is more than 1000 codes — split the list.');

      const progress = el('p', { class: 'field-help', text: 'Rendering 0 / ' + rows.length });
      out.appendChild(progress);
      await E.ready(design);

      if (values.dynamic) {
        if (!QS.cloud.state.owner) throw new Error('Log in first to create short links.');
        for (let i = 0; i < rows.length; i++) {
          const saved = await QS.cloud.save({
            kind: 'url', target: rows[i].text, title: rows[i].label || rows[i].text.slice(0, 60),
            folder: 'bulk', design: QS.cloud.slimDesign(design)
          });
          rows[i].text = QS.cloud.shortURL(saved.slug);
          rows[i].name = saved.slug;
          progress.textContent = `Creating short links ${i + 1} / ${rows.length}`;
        }
      }

      const items = [];
      for (let i = 0; i < rows.length; i++) {
        items.push({ scene: E.compose({ text: rows[i].text }, design, {}), label: rows[i].label, name: rows[i].name || ('code-' + (i + 1)) });
        if (i % 10 === 0) progress.textContent = `Rendering ${i + 1} / ${rows.length}`;
      }
      progress.textContent = how === 'zip' ? 'Packing the ZIP…' : 'Building the PDF…';
      const blob = how === 'zip'
        ? await zipCodes(items, { format: values.format, px: Number(values.px) || 1024 })
        : await sheetPDF(items, { mm: 40 });
      U.download(blob, how === 'zip' ? 'qr-codes.zip' : 'qr-sheet.pdf');
      progress.textContent = `Done — ${items.length} codes.`;
      const csv = U.toCSV(items.map((it, i) => [it.name, rows[i].text, it.label]), ['file', 'content', 'label']);
      out.appendChild(el('button', {
        class: 'btn ghost small', type: 'button', text: 'Download the list as CSV',
        onclick: () => U.download(new Blob([csv], { type: 'text/csv' }), 'qr-codes.csv')
      }));
    } catch (err) {
      out.innerHTML = '';
      out.appendChild(el('p', { class: 'error-text', text: err.message }));
    }
  }

  async function zipCodes(items, { format = 'png', px = 1024 } = {}) {
    await U.loadScript(QS.CDN.jszip);
    const zip = new window.JSZip();
    for (let i = 0; i < items.length; i++) {
      const name = (items[i].name || 'code-' + (i + 1)).slice(0, 60);
      if (format === 'svg') {
        zip.file(name + '.svg', E.toSVG(items[i].scene, { px, id: 'z' + i }));
      } else {
        const blob = await E.rasterize(items[i].scene, { px, type: 'image/png', background: '#ffffff' });
        zip.file(name + '.png', blob);
      }
    }
    return zip.generateAsync({ type: 'blob' });
  }

  /* A4 grid of codes, optionally many copies of one code */
  async function sheetPDF(items, { mm = 40, copies = 0, gap = 6, margin = 12 } = {}) {
    await U.loadScript(QS.CDN.jspdf);
    const jsPDFCtor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    const doc = new jsPDFCtor({ unit: 'mm', format: 'a4' });
    const list = copies ? Array.from({ length: copies }, () => items[0]) : items;
    const labelH = list.some(i => i.label) ? 5 : 0;
    const cellW = mm, cellH = mm + labelH;
    const cols = Math.max(1, Math.floor((210 - 2 * margin + gap) / (cellW + gap)));
    const rowsPerPage = Math.max(1, Math.floor((297 - 2 * margin + gap) / (cellH + gap)));
    const perPage = cols * rowsPerPage;
    const pngCache = new Map();
    for (let i = 0; i < list.length; i++) {
      if (i && i % perPage === 0) doc.addPage();
      const idx = i % perPage;
      const col = idx % cols, row = Math.floor(idx / cols);
      const x = margin + col * (cellW + gap);
      const y = margin + row * (cellH + gap);
      const item = list[i];
      let png = pngCache.get(item.scene);
      if (!png) {
        const blob = await E.rasterize(item.scene, { px: Math.round((mm / 25.4) * 300), type: 'image/png', background: '#ffffff' });
        png = await U.blobToDataURL(blob);
        pngCache.set(item.scene, png);
      }
      doc.addImage(png, 'PNG', x, y, cellW, cellW * (item.scene.H / item.scene.W));
      if (item.label) {
        doc.setFontSize(8);
        doc.text(String(item.label).slice(0, 30), x + cellW / 2, y + cellW * (item.scene.H / item.scene.W) + 3.6, { align: 'center' });
      }
    }
    return doc.output('blob');
  }

  /* ───────────────────────── history ───────────────────────── */
  function history() {
    const host = qs('#tab-history');
    host.innerHTML = '';
    const list = U.store.get('qrstudio.history', []);
    host.appendChild(el('div', { class: 'filter-row' }, [
      el('span', { class: 'muted', text: list.length + ' codes kept in this browser' }),
      el('button', {
        class: 'btn ghost small', type: 'button', text: 'Export JSON',
        onclick: () => U.download(new Blob([JSON.stringify({ history: list, templates: U.store.get('qrstudio.templates', []) }, null, 2)], { type: 'application/json' }), 'qr-studio-backup.json')
      }),
      (() => {
        const input = el('input', { type: 'file', class: 'sr-only', accept: 'application/json' });
        input.addEventListener('change', async () => {
          const f = input.files && input.files[0];
          input.value = '';
          if (!f) return;
          try {
            const data = JSON.parse(await U.readFile(f, 'text'));
            if (Array.isArray(data.history)) U.store.set('qrstudio.history', data.history.slice(0, 60));
            if (Array.isArray(data.templates)) U.store.set('qrstudio.templates', data.templates.slice(0, 24));
            toast('Imported');
            history();
          } catch (e) { toast('That file could not be read', 'error'); }
        });
        const btn = el('button', { class: 'btn ghost small', type: 'button', text: 'Import', onclick: () => input.click() });
        return el('span', {}, [btn, input]);
      })(),
      el('button', {
        class: 'btn ghost small danger', type: 'button', text: 'Clear',
        onclick: async () => {
          if (!(await UI.confirm('Clear the history?', 'Only this browser is affected.'))) return;
          U.store.set('qrstudio.history', []);
          history();
        }
      })
    ]));
    if (!list.length) {
      host.appendChild(el('p', { class: 'empty', text: 'Codes you download or publish show up here.' }));
      return;
    }
    const grid = el('div', { class: 'history-grid' });
    list.forEach((entry, i) => {
      let thumb = '';
      try {
        const scene = E.compose({ text: entry.text }, E.normalizeDesign(entry.design || {}), {});
        thumb = E.toSVG(scene, { px: 92, id: 'h' + i });
      } catch (e) { thumb = ''; }
      grid.appendChild(el('div', { class: 'history-card' }, [
        el('div', { class: 'history-thumb', html: thumb }),
        el('div', { class: 'history-main' }, [
          el('b', { text: entry.title || entry.typeId }),
          el('span', { class: 'muted small', text: U.ago(entry.at) }),
          el('span', { class: 'history-text mono', text: (entry.text || '').slice(0, 90) })
        ]),
        el('div', { class: 'history-actions' }, [
          el('button', {
            class: 'btn ghost small', type: 'button', text: 'Load',
            onclick: () => {
              QS.app.applyDesign(entry.design || {});
              QS.app.applyValues(entry.typeId, entry.values || {});
              QS.app.setTab('create');
            }
          }),
          el('button', {
            class: 'btn ghost small', type: 'button', text: 'PNG',
            onclick: async () => {
              try {
                const scene = E.compose({ text: entry.text }, E.normalizeDesign(entry.design || {}), {});
                U.download(await E.rasterize(scene, { px: 1024, type: 'image/png', background: '#ffffff' }), U.slugify(entry.title, 'qr') + '.png');
              } catch (e) { toast(e.message, 'error'); }
            }
          }),
          el('button', {
            class: 'btn ghost small danger', type: 'button', text: '✕',
            onclick: () => { list.splice(i, 1); U.store.set('qrstudio.history', list); history(); }
          })
        ])
      ]));
    });
    host.appendChild(grid);
  }

  QS.panels = { render, sheetPDF, zipCodes, statsState };
})();
