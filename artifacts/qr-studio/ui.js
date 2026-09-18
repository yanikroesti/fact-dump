/* QR Studio · ui.js
   The generic bits of interface: toasts, modals, and one form renderer that
   turns the field descriptions in formats.js / pages.js into real inputs —
   including repeaters, uploads with progress, opening hours and address search. */
(function () {
  'use strict';
  const QS = (window.QS = window.QS || {});
  const U = QS.util;

  const qs = (sel, root) => (root || document).querySelector(sel);
  const qsa = (sel, root) => [...(root || document).querySelectorAll(sel)];
  function el(tag, props, children) {
    const n = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'html') n.innerHTML = v;
        else if (k === 'dataset') Object.assign(n.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k in n && k !== 'list' && k !== 'type' && k !== 'size') { try { n[k] = v; } catch (e) { n.setAttribute(k, v); } }
        else n.setAttribute(k, v);
      }
    }
    (Array.isArray(children) ? children : children != null ? [children] : []).forEach(c => {
      if (c == null) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  /* ── toast ── */
  let toastTimer = null;
  function toast(message, kind) {
    let box = qs('#toast');
    if (!box) {
      box = el('div', { id: 'toast' });
      document.body.appendChild(box);
    }
    box.className = 'on' + (kind ? ' ' + kind : '');
    box.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove('on'), kind === 'error' ? 6000 : 3200);
  }

  /* ── modal ── */
  function modal({ title, body, actions, wide, onClose }) {
    const host = qs('#modal') || document.body.appendChild(el('div', { id: 'modal' }));
    const close = () => {
      host.innerHTML = '';
      host.classList.remove('on');
      document.removeEventListener('keydown', onKey);
      if (onClose) onClose();
    };
    const onKey = ev => { if (ev.key === 'Escape') close(); };
    const content = el('div', { class: 'modal-card' + (wide ? ' wide' : '') }, [
      el('div', { class: 'modal-head' }, [
        el('h2', { text: title || '' }),
        el('button', { class: 'icon-btn', title: 'Close', onclick: close, html: '✕' })
      ]),
      el('div', { class: 'modal-body' })
    ]);
    const bodyBox = content.querySelector('.modal-body');
    if (typeof body === 'string') bodyBox.innerHTML = body;
    else if (body) bodyBox.appendChild(body);
    if (actions && actions.length) {
      const foot = el('div', { class: 'modal-foot' });
      actions.forEach(a => foot.appendChild(el('button', {
        class: 'btn ' + (a.primary ? 'primary' : 'ghost'),
        text: a.label,
        onclick: () => a.onClick ? a.onClick(close) : close()
      })));
      content.appendChild(foot);
    }
    host.innerHTML = '';
    host.appendChild(el('div', { class: 'modal-back', onclick: close }));
    host.appendChild(content);
    host.classList.add('on');
    document.addEventListener('keydown', onKey);
    const focusable = content.querySelector('input, textarea, button.primary, select');
    if (focusable) setTimeout(() => focusable.focus(), 40);
    return { close, body: bodyBox };
  }

  const confirm = (title, text, confirmLabel) => new Promise(resolve => {
    modal({
      title,
      body: el('p', { class: 'modal-text', text }),
      actions: [
        { label: 'Cancel', onClick: close => { close(); resolve(false); } },
        { label: confirmLabel || 'Delete', primary: true, onClick: close => { close(); resolve(true); } }
      ],
      onClose: () => resolve(false)
    });
  });

  /* ── segmented control ── */
  function segmented(container, options, value, onPick) {
    container.innerHTML = '';
    container.className = 'segmented';
    options.forEach(opt => {
      const b = el('button', {
        class: 'seg' + (opt.v === value ? ' on' : ''),
        type: 'button',
        text: opt.l,
        title: opt.title || opt.l,
        onclick: () => onPick(opt.v)
      });
      container.appendChild(b);
    });
  }

  const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  function randomSecret(len = 32) {
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    return [...bytes].map(b => BASE32[b % 32]).join('');
  }

  /* ── address search (OpenStreetMap Nominatim) ── */
  async function geocode(query) {
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=' + encodeURIComponent(query);
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('Address search is not answering right now.');
    return res.json();
  }

  /* ─────────────────────────── form renderer ───────────────────────────
     fields: the array from formats.js / pages.js
     values: object mutated in place
     onChange(key): called after every edit                                */
  function renderForm(container, fields, values, onChange, ctx) {
    container.innerHTML = '';
    const rows = [];
    const setters = new Map();
    const api = {
      set(key, value) {
        values[key] = value;
        const s = setters.get(key);
        if (s) s(value);
        refresh();
        onChange(key);
      },
      refresh: () => refresh()
    };

    const groups = new Map();
    const groupFor = name => {
      if (!name) return container;
      if (!groups.has(name)) {
        const det = el('details', { class: 'field-group' }, [el('summary', { text: name })]);
        const grid = el('div', { class: 'field-grid' });
        det.appendChild(grid);
        container.appendChild(det);
        groups.set(name, grid);
      }
      return groups.get(name);
    };
    const mainGrid = el('div', { class: 'field-grid' });
    container.appendChild(mainGrid);

    fields.forEach(field => {
      const host = field.group ? groupFor(field.group) : mainGrid;
      const row = buildField(field, values, api, onChange, ctx);
      if (!row) return;
      row.classList.add('w-' + (field.w || 'full'));
      host.appendChild(row);
      rows.push({ field, row });
      const input = row.querySelector('[data-key]');
      if (input) {
        setters.set(field.k, v => {
          if (input.type === 'checkbox') input.checked = !!v;
          else input.value = v == null ? '' : v;
        });
      }
    });

    function refresh() {
      rows.forEach(({ field, row }) => {
        if (typeof field.show === 'function') row.style.display = field.show(values) ? '' : 'none';
      });
    }
    refresh();
    return api;
  }

  function buildField(field, values, api, onChange, ctx) {
    const id = U.uid('f');
    const label = field.label ? el('label', { class: 'field-label', for: id, text: field.label }) : null;
    const help = field.help ? el('p', { class: 'field-help', text: field.help }) : null;
    const row = el('div', { class: 'field' });
    const fire = () => onChange(field.k);

    const simple = (node) => {
      if (label) row.appendChild(label);
      row.appendChild(node);
      if (help) row.appendChild(help);
      return row;
    };

    switch (field.type) {
      case 'textarea': {
        const ta = el('textarea', {
          id, class: 'input', rows: field.rows || 3, placeholder: field.ph || '',
          dataset: { key: field.k }, value: values[field.k] || '',
          oninput: e => { values[field.k] = e.target.value; fire(); }
        });
        return simple(ta);
      }
      case 'select': {
        const sel = el('select', {
          id, class: 'input', dataset: { key: field.k },
          onchange: e => { values[field.k] = e.target.value; api.refresh(); fire(); }
        });
        (field.options || []).forEach(o => sel.appendChild(el('option', { value: o.v, text: o.l })));
        sel.value = values[field.k] != null && values[field.k] !== '' ? values[field.k] : (field.options && field.options[0] ? field.options[0].v : '');
        values[field.k] = sel.value;
        return simple(sel);
      }
      case 'checkbox': {
        const wrap = el('label', { class: 'check' });
        const box = el('input', {
          id, type: 'checkbox', dataset: { key: field.k }, checked: !!values[field.k],
          onchange: e => { values[field.k] = e.target.checked; api.refresh(); fire(); }
        });
        wrap.appendChild(box);
        wrap.appendChild(el('span', { text: field.label }));
        row.appendChild(wrap);
        if (help) row.appendChild(help);
        return row;
      }
      case 'color': {
        const current = values[field.k] || field.default || '#e8ff00';
        values[field.k] = current;
        const wrap = el('div', { class: 'color-field' });
        const picker = el('input', {
          type: 'color', class: 'color-input', value: current, dataset: { key: field.k },
          oninput: e => { values[field.k] = e.target.value; text.value = e.target.value; fire(); }
        });
        const text = el('input', {
          type: 'text', class: 'input hex', value: current, spellcheck: false,
          oninput: e => {
            const v = e.target.value.trim();
            if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) { values[field.k] = v; picker.value = v; fire(); }
          }
        });
        wrap.append(picker, text);
        return simple(wrap);
      }
      case 'secret': {
        const wrap = el('div', { class: 'row-inline' });
        const input = el('input', {
          id, type: 'text', class: 'input mono', spellcheck: false, dataset: { key: field.k },
          value: values[field.k] || '', placeholder: field.ph || '',
          oninput: e => { values[field.k] = e.target.value; fire(); }
        });
        const gen = el('button', {
          class: 'btn ghost small', type: 'button', text: 'Generate',
          onclick: () => { const s = randomSecret(32); values[field.k] = s; input.value = s; fire(); }
        });
        wrap.append(input, gen);
        return simple(wrap);
      }
      case 'geosearch': {
        const wrap = el('div', { class: 'geo-search' });
        const input = el('input', { type: 'text', class: 'input', placeholder: 'Street, town…' });
        const btn = el('button', { class: 'btn ghost small', type: 'button', text: 'Search' });
        const here = el('button', { class: 'btn ghost small', type: 'button', text: 'My position' });
        const results = el('div', { class: 'geo-results' });
        const run = async () => {
          const q = input.value.trim();
          if (!q) return;
          results.innerHTML = '<p class="field-help">Searching…</p>';
          try {
            const list = await geocode(q);
            results.innerHTML = '';
            if (!list.length) { results.innerHTML = '<p class="field-help">Nothing found.</p>'; return; }
            list.forEach(hit => {
              results.appendChild(el('button', {
                class: 'geo-hit', type: 'button', text: hit.display_name,
                onclick: () => {
                  api.set('lat', Number(hit.lat).toFixed(6));
                  api.set('lng', Number(hit.lon).toFixed(6));
                  if ('address' in values || field.fillAddress) api.set('address', hit.display_name);
                  results.innerHTML = '';
                  toast('Coordinates filled in');
                }
              }));
            });
          } catch (e) {
            results.innerHTML = '<p class="field-help">' + U.esc(e.message) + '</p>';
          }
        };
        btn.addEventListener('click', run);
        input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); run(); } });
        here.addEventListener('click', () => {
          if (!navigator.geolocation) return toast('This browser has no location support', 'error');
          navigator.geolocation.getCurrentPosition(
            pos => {
              api.set('lat', pos.coords.latitude.toFixed(6));
              api.set('lng', pos.coords.longitude.toFixed(6));
              toast('Position filled in');
            },
            () => toast('Could not get your position', 'error'),
            { enableHighAccuracy: true, timeout: 8000 }
          );
        });
        wrap.append(input, btn, here, results);
        return simple(wrap);
      }
      case 'hours': {
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        const list = Array.isArray(values[field.k]) ? values[field.k] : days.map(() => ({ open: '', close: '', closed: false }));
        values[field.k] = list;
        const wrap = el('div', { class: 'hours-grid' });
        days.forEach((day, i) => {
          const d = list[i] || (list[i] = { open: '', close: '', closed: false });
          const line = el('div', { class: 'hours-row' });
          line.appendChild(el('span', { class: 'hours-day', text: day.slice(0, 3) }));
          const open = el('input', { type: 'time', class: 'input small', value: d.open || '', oninput: e => { d.open = e.target.value; fire(); } });
          const close = el('input', { type: 'time', class: 'input small', value: d.close || '', oninput: e => { d.close = e.target.value; fire(); } });
          const closed = el('label', { class: 'check small' }, [
            el('input', { type: 'checkbox', checked: !!d.closed, onchange: e => { d.closed = e.target.checked; open.disabled = close.disabled = d.closed; fire(); } }),
            el('span', { text: 'closed' })
          ]);
          open.disabled = close.disabled = !!d.closed;
          line.append(open, close, closed);
          wrap.appendChild(line);
        });
        return simple(wrap);
      }
      case 'upload':
      case 'uploads': {
        const multi = field.type === 'uploads';
        if (!values[field.k] && multi) values[field.k] = [];
        const wrap = el('div', { class: 'upload' });
        const listBox = el('div', { class: 'upload-list' });
        const drop = el('label', { class: 'upload-drop' }, [
          el('span', { class: 'upload-hint', text: multi ? 'Drop files here or choose' : 'Drop a file here or choose' })
        ]);
        const input = el('input', { type: 'file', class: 'sr-only', accept: field.accept || '*/*', multiple: multi });
        drop.appendChild(input);

        const paint = () => {
          listBox.innerHTML = '';
          const items = multi ? (values[field.k] || []) : (values[field.k] ? [values[field.k]] : []);
          items.forEach((item, idx) => {
            if (!item) return;
            const chip = el('div', { class: 'upload-item' });
            if (/^image\//.test(item.mime || '') && item.url) {
              chip.appendChild(el('img', { class: 'upload-thumb', src: item.url, alt: '' }));
            }
            chip.appendChild(el('span', { class: 'upload-name', text: item.name || 'file' }));
            chip.appendChild(el('span', { class: 'upload-size', text: U.bytesHuman(item.size) }));
            chip.appendChild(el('button', {
              class: 'icon-btn', type: 'button', title: 'Remove', html: '✕',
              onclick: () => {
                if (multi) values[field.k].splice(idx, 1);
                else values[field.k] = null;
                paint();
                fire();
              }
            }));
            listBox.appendChild(chip);
          });
        };

        const handle = async fileList => {
          const files = [...fileList];
          if (!files.length) return;
          if (!QS.cloud.state.owner) {
            QS.app.requireLogin('Uploads need the owner login.');
            return;
          }
          for (const file of files) {
            const prog = el('div', { class: 'upload-progress' }, [
              el('span', { class: 'upload-name', text: file.name }),
              el('span', { class: 'bar' }, [el('i')])
            ]);
            listBox.appendChild(prog);
            const bar = prog.querySelector('i');
            try {
              const res = await QS.cloud.upload(file, { onProgress: p => { bar.style.width = Math.round(p * 100) + '%'; } });
              if (multi) values[field.k].push(res);
              else values[field.k] = res;
              fire();
            } catch (err) {
              toast(err.message, 'error');
            } finally {
              prog.remove();
              paint();
            }
          }
        };

        input.addEventListener('change', () => { handle(input.files); input.value = ''; });
        drop.addEventListener('dragover', ev => { ev.preventDefault(); drop.classList.add('over'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('over'));
        drop.addEventListener('drop', ev => {
          ev.preventDefault();
          drop.classList.remove('over');
          handle(ev.dataTransfer.files);
        });
        wrap.append(drop, listBox);
        paint();
        return simple(wrap);
      }
      case 'repeat': {
        if (!Array.isArray(values[field.k])) values[field.k] = [];
        const wrap = el('div', { class: 'repeat' });
        const listBox = el('div', { class: 'repeat-list' });
        const addBtn = el('button', {
          class: 'btn ghost small', type: 'button', text: field.add || 'Add',
          onclick: () => {
            if (field.max && values[field.k].length >= field.max) return toast('That is the maximum here.', 'error');
            values[field.k].push({});
            paint();
            fire();
          }
        });
        const paint = () => {
          listBox.innerHTML = '';
          values[field.k].forEach((item, idx) => {
            const card = el('div', { class: 'repeat-item' });
            const head = el('div', { class: 'repeat-head' }, [
              el('span', { class: 'repeat-no', text: '#' + (idx + 1) }),
              el('div', { class: 'repeat-tools' }, [
                el('button', { class: 'icon-btn', type: 'button', title: 'Move up', html: '↑', onclick: () => { if (idx > 0) { const a = values[field.k]; [a[idx - 1], a[idx]] = [a[idx], a[idx - 1]]; paint(); fire(); } } }),
                el('button', { class: 'icon-btn', type: 'button', title: 'Move down', html: '↓', onclick: () => { const a = values[field.k]; if (idx < a.length - 1) { [a[idx + 1], a[idx]] = [a[idx], a[idx + 1]]; paint(); fire(); } } }),
                el('button', { class: 'icon-btn', type: 'button', title: 'Remove', html: '✕', onclick: () => { values[field.k].splice(idx, 1); paint(); fire(); } })
              ])
            ]);
            const body = el('div', { class: 'repeat-body' });
            card.append(head, body);
            listBox.appendChild(card);
            renderForm(body, field.fields, item, () => fire(), ctx);
          });
        };
        paint();
        if (label) row.appendChild(label);
        wrap.append(listBox, addBtn);
        row.appendChild(wrap);
        if (help) row.appendChild(help);
        return row;
      }
      case 'note': {
        row.appendChild(el('p', { class: 'field-note', text: field.label }));
        return row;
      }
      default: {
        const type = { url: 'url', email: 'email', tel: 'tel', number: 'number', date: 'date', time: 'time', datetime: 'datetime-local' }[field.type] || 'text';
        const input = el('input', {
          id, type, class: 'input', placeholder: field.ph || '', spellcheck: false,
          dataset: { key: field.k }, value: values[field.k] == null ? '' : values[field.k],
          maxlength: field.maxlength || null,
          oninput: e => { values[field.k] = e.target.value; fire(); }
        });
        return simple(input);
      }
    }
  }

  QS.ui = { el, qs, qsa, toast, modal, confirm, segmented, renderForm, geocode, randomSecret };
})();
