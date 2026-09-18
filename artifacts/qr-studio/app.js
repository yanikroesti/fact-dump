/* QR Studio · app.js
   The Create tab: picking a content type, filling the form, designing the code,
   exporting it, and publishing the hosted ones as editable short links. */
(function () {
  'use strict';
  const QS = (window.QS = window.QS || {});
  const U = QS.util, E = QS.engine, UI = QS.ui;
  const { el, qs, qsa, toast } = UI;

  const PREVIEW_SLUG = 'xxxxxxx';
  const state = {
    tab: 'create',
    typeId: 'url',
    hosted: false,
    forms: {},
    design: E.normalizeDesign({}),
    dynamic: newDynamic(),
    payload: { text: '' },
    scene: null,
    error: null,
    exportOpts: { format: 'png', px: 1024, mm: 40, transparent: false, filename: '' },
    lastCheck: null,
    touched: {}
  };

  function newDynamic() {
    return {
      enabled: false, id: null, slug: '', title: '', folder: '', note: '',
      password: '', passwordSet: false, active: true, startsAt: '', expiresAt: '', maxScans: '',
      rules: { device: {}, geo: [], lang: [], time: { tz: 'Europe/Zurich', slots: [] }, ab: [], schedule: [] }
    };
  }
  const allTypes = () => [...QS.formats.TYPES, ...QS.pages.TYPES];
  const typeById = id => allTypes().find(t => t.id === id);
  const valuesFor = id => (state.forms[id] = state.forms[id] || {});
  const isHosted = id => !!(QS.pages.byId(id));

  /* ───────────────────────── boot ───────────────────────── */
  async function init() {
    await E.ensureQrLib();
    buildTypePicker();
    wireTabs();
    renderDesignPanel();
    renderExportPanel();
    bindOwnerChip();
    QS.cloud.ready().catch(() => { });
    QS.cloud.onChange(() => {
      paintOwnerChip();
      if (state.tab === 'codes' || state.tab === 'stats' || state.tab === 'files') QS.panels.render(state.tab);
      renderDynamicPanel();
    });
    await restoreFromLink();
    /* a first visit shows a real code straight away instead of an empty box */
    if (state.typeId === 'url' && !valuesFor('url').url) valuesFor('url').url = 'https://dump.yanikroesti.ch';
    selectType(state.typeId, true);
    window.addEventListener('beforeunload', savePrefs);
  }

  function wireTabs() {
    qsa('#tabs .tab').forEach(btn => btn.addEventListener('click', () => setTab(btn.dataset.tab)));
    if (location.hash.startsWith('#tab=')) state.tab = location.hash.slice(5);
    setTab(state.tab);
  }
  function setTab(name) {
    state.tab = name;
    qsa('#tabs .tab').forEach(b => {
      const on = b.dataset.tab === name;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
    qsa('.tab-panel').forEach(p => p.classList.toggle('on', p.id === 'tab-' + name));
    if (name !== 'create' && QS.panels) QS.panels.render(name);
    if (history.replaceState) history.replaceState(null, '', name === 'create' ? location.pathname : '#tab=' + name);
  }

  /* ───────────────────────── type picker ───────────────────────── */
  function buildTypePicker() {
    const groups = [...QS.formats.GROUPS, 'Hosted'];
    const chips = qs('#typeGroups');
    chips.innerHTML = '';
    groups.forEach(g => {
      chips.appendChild(el('button', {
        class: 'chip' + (g === 'Basics' ? ' on' : ''), type: 'button', text: g.toLowerCase(),
        dataset: { group: g },
        onclick: () => {
          qsa('#typeGroups .chip').forEach(c => c.classList.toggle('on', c.dataset.group === g));
          paintTypeGrid(g);
        }
      }));
    });
    paintTypeGrid('Basics');
  }
  function paintTypeGrid(group) {
    const grid = qs('#typeGrid');
    grid.innerHTML = '';
    allTypes().filter(t => t.group === group).forEach(t => {
      const btn = el('button', {
        class: 'type' + (t.id === state.typeId ? ' on' : '') + (t.hosted ? ' hosted' : ''), type: 'button',
        dataset: { type: t.id }, title: t.desc || t.name,
        onclick: () => selectType(t.id)
      }, [
        el('span', { class: 'type-ico', html: QS.icons.preview(t.icon || 'link', 20) }),
        el('span', { class: 'type-name', text: t.name }),
        t.hosted ? el('span', { class: 'type-lock', text: 'login', title: 'Needs the owner login' }) : null
      ]);
      grid.appendChild(btn);
    });
    QS.icons.hydrate(grid);
  }

  function selectType(id, silent) {
    const type = typeById(id);
    if (!type) return;
    state.typeId = id;
    state.hosted = isHosted(id);
    if (!silent) state.dynamic = newDynamic();
    state.dynamic.enabled = state.hosted || state.dynamic.enabled;
    qsa('#typeGroups .chip').forEach(c => c.classList.toggle('on', c.dataset.group === type.group));
    paintTypeGrid(type.group);
    qs('#typeDesc').textContent = type.desc || '';
    renderContentForm();
    renderDynamicPanel();
    scheduleRender();
  }

  function renderContentForm() {
    const type = typeById(state.typeId);
    const host = qs('#contentForm');
    const values = valuesFor(state.typeId);
    UI.renderForm(host, type.fields || [], values, () => {
      state.touched[state.typeId] = true;
      scheduleRender();
    }, { typeId: state.typeId });
  }

  /* ───────────────────────── payload + preview ───────────────────────── */
  function buildPayload() {
    state.error = null;
    const values = valuesFor(state.typeId);
    try {
      if (state.hosted) {
        const built = QS.pages.build(state.typeId, values);
        state.hostedBuild = built;
        const slug = state.dynamic.slug || PREVIEW_SLUG;
        state.payload = { text: QS.cloud.shortURL(slug) };
        if (!state.dynamic.title) state.dynamic.title = built.title || '';
      } else {
        const built = QS.formats.build(state.typeId, values);
        state.staticBuild = built;
        if (state.dynamic.enabled) {
          const slug = state.dynamic.slug || PREVIEW_SLUG;
          state.payload = { text: QS.cloud.shortURL(slug), swiss: false };
        } else {
          state.payload = { text: built.text, swiss: !!built.swiss, forceEC: built.forceEC };
        }
        if (built.logo && !state.design.logo.src && !state.logoTouched) suggestLogo(built.logo);
      }
    } catch (err) {
      state.error = err.message || String(err);
      state.payload = { text: '' };
    }
  }

  let suggestedLogo = null;
  async function suggestLogo(hint) {
    if (!hint || suggestedLogo === hint.icon) return;
    suggestedLogo = hint.icon;
    const box = qs('#logoSuggest');
    if (!box) return;
    box.innerHTML = '';
    box.appendChild(el('button', {
      class: 'btn ghost small', type: 'button', text: 'Add the matching logo',
      onclick: async () => {
        await applyIconLogo(hint.icon, hint.color);
        box.innerHTML = '';
      }
    }));
  }
  async function applyIconLogo(slug, color) {
    try {
      const icon = await QS.icons.get(slug);
      state.design.logo = Object.assign({}, state.design.logo, {
        kind: 'icon', src: icon.d, viewBox: icon.viewBox, icon: slug,
        iconColor: color || icon.color || '#000000', ar: 1,
        plate: state.design.logo.plate === 'none' ? 'circle' : state.design.logo.plate,
        plateColor: state.design.logo.plateColor || '#ffffff'
      });
      state.logoTouched = true;
      renderDesignPanel();
      scheduleRender();
    } catch (e) {
      toast('Could not load that logo', 'error');
    }
  }

  const scheduleRender = U.debounce(() => renderPreview(), 180);

  async function renderPreview() {
    buildPayload();
    const box = qs('#previewBox');
    const errBox = qs('#previewError');
    if (state.error || !state.payload.text) {
      const untouched = !state.touched[state.typeId];
      box.innerHTML = '<div class="preview-empty">—</div>';
      errBox.textContent = untouched ? 'Fill in the form and the code appears here.' : (state.error || 'Fill in the form to see the code.');
      errBox.classList.toggle('hint', untouched);
      errBox.classList.add('on');
      qs('#metaBox').innerHTML = '';
      qs('#checkChip').className = 'check-chip';
      qs('#checkChip').textContent = '';
      return;
    }
    errBox.classList.remove('on');
    try {
      await E.ready(state.design);
      const scene = E.compose(state.payload, state.design, {});
      state.scene = scene;
      box.innerHTML = E.toSVG(scene, { px: 720, id: 'pv' + Date.now().toString(36) });
      renderMeta(scene.info);
      runScanCheck();
      renderPagePreview();
    } catch (err) {
      state.scene = null;
      box.innerHTML = '<div class="preview-empty">—</div>';
      errBox.textContent = err.message || String(err);
      errBox.classList.add('on');
    }
  }

  function renderMeta(info) {
    const pct = Math.min(100, Math.round((info.bytes / info.capacity) * 100));
    qs('#metaBox').innerHTML =
      `<div class="meta-grid">
        <div><span>version</span><b>${info.version} · ${info.modules}×${info.modules}</b></div>
        <div><span>correction</span><b>${info.ec}</b></div>
        <div><span>contrast</span><b>${info.contrast.toFixed(1)}:1</b></div>
        <div><span>min print</span><b>${info.minPrintMM} mm</b></div>
      </div>
      <div class="capacity" title="${info.bytes} of ${info.capacity} bytes used">
        <span class="cap-bar"><i style="width:${pct}%"></i></span>
        <span class="cap-text">${info.bytes} / ${info.capacity} bytes</span>
      </div>` +
      (info.warnings.length ? `<ul class="warn-list">${info.warnings.map(w => `<li>${U.esc(w)}</li>`).join('')}</ul>` : '');
  }

  const runScanCheck = U.debounce(async () => {
    const chip = qs('#checkChip');
    if (!state.scene) return;
    chip.className = 'check-chip busy';
    chip.textContent = 'checking…';
    try {
      const res = await E.scanCheck(state.scene, state.payload.text);
      state.lastCheck = res;
      chip.className = 'check-chip ' + (res.ok ? 'ok' : 'bad');
      chip.textContent = res.ok ? '✓ reads back correctly' : '⚠ our test decoder failed — simplify the design';
      chip.title = res.ok
        ? 'The finished design was rendered and read back successfully.'
        : 'Phones may still manage it, but raise the contrast, the error correction or shrink the logo.';
    } catch (e) {
      chip.className = 'check-chip';
      chip.textContent = '';
    }
  }, 420);

  function renderPagePreview() {
    const host = qs('#pagePreview');
    if (!state.hosted || !state.hostedBuild || state.hostedBuild.kind !== 'page') {
      host.classList.add('hidden');
      return;
    }
    host.classList.remove('hidden');
    const screen = qs('#pageScreen');
    QS.pageRender.render(screen, state.hostedBuild.page, {});
  }

  /* ───────────────────────── design panel ───────────────────────── */
  function section(title, open) {
    const det = el('details', { class: 'design-section', open: !!open }, [el('summary', { text: title })]);
    const body = el('div', { class: 'design-body' });
    det.appendChild(body);
    return { det, body };
  }
  function slider(label, value, min, max, step, onInput, fmt) {
    const out = el('span', { class: 'slider-val', text: fmt ? fmt(value) : String(value) });
    const input = el('input', {
      type: 'range', class: 'range', min, max, step, value,
      oninput: e => {
        const v = Number(e.target.value);
        out.textContent = fmt ? fmt(v) : String(v);
        onInput(v);
      }
    });
    return el('div', { class: 'field w-half' }, [
      el('label', { class: 'field-label' }, [document.createTextNode(label), out]),
      input
    ]);
  }
  function colorField(label, value, onPick, width) {
    const picker = el('input', { type: 'color', class: 'color-input', value: value || '#000000', oninput: e => { text.value = e.target.value; onPick(e.target.value); } });
    const text = el('input', {
      type: 'text', class: 'input hex', value: value || '#000000', spellcheck: false,
      oninput: e => { if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(e.target.value.trim())) { picker.value = e.target.value.trim(); onPick(e.target.value.trim()); } }
    });
    return el('div', { class: 'field w-' + (width || 'half') }, [
      el('label', { class: 'field-label', text: label }),
      el('div', { class: 'color-field' }, [picker, text])
    ]);
  }
  function selectField(label, options, value, onPick, width) {
    const sel = el('select', { class: 'input', onchange: e => onPick(e.target.value) });
    options.forEach(o => sel.appendChild(el('option', { value: o.v, text: o.l })));
    sel.value = value;
    return el('div', { class: 'field w-' + (width || 'half') }, [el('label', { class: 'field-label', text: label }), sel]);
  }
  const grid = children => el('div', { class: 'field-grid' }, children.filter(Boolean));

  function renderDesignPanel() {
    const host = qs('#designPanel');
    host.innerHTML = '';
    const d = state.design;

    /* presets */
    const presetRow = el('div', { class: 'preset-row' });
    E.PRESETS.forEach(p => {
      const btn = el('button', { class: 'preset', type: 'button', title: p.name, onclick: () => applyPreset(p) });
      btn.appendChild(el('span', { class: 'preset-thumb', html: presetThumb(p) }));
      btn.appendChild(el('span', { class: 'preset-name', text: p.name }));
      presetRow.appendChild(btn);
    });
    host.appendChild(el('div', { class: 'design-presets' }, [el('div', { class: 'label-row', text: 'templates' }), presetRow]));

    /* pattern */
    const pat = section('Pattern & corners', true);
    pat.body.appendChild(el('div', { class: 'label-row', text: 'modules' }));
    pat.body.appendChild(stylePicker(E.DOT_STYLES, d.dots.style, 'dots', v => { d.dots.style = v; renderDesignPanel(); scheduleRender(); }));
    pat.body.appendChild(el('div', { class: 'label-row', text: 'corner frames' }));
    pat.body.appendChild(stylePicker(E.EYE_FRAMES, d.eyes.frame, 'frame', v => { d.eyes.frame = v; renderDesignPanel(); scheduleRender(); }));
    pat.body.appendChild(el('div', { class: 'label-row', text: 'corner centres' }));
    pat.body.appendChild(stylePicker(E.EYE_BALLS, d.eyes.ball, 'ball', v => { d.eyes.ball = v; renderDesignPanel(); scheduleRender(); }));
    pat.body.appendChild(grid([
      slider('Module size', d.dots.scale, 0.5, 1, 0.02, v => { d.dots.scale = v; scheduleRender(); }, v => Math.round(v * 100) + '%'),
      selectField('Shape', [{ v: 'square', l: 'Square' }, { v: 'circle', l: 'Round' }], d.shape, v => { d.shape = v; scheduleRender(); })
    ]));
    host.appendChild(pat.det);

    /* colours */
    const col = section('Colours', true);
    const fillOpts = [{ v: 'solid', l: 'Solid' }, { v: 'linear', l: 'Gradient' }, { v: 'radial', l: 'Radial gradient' }, { v: 'image', l: 'Photo fill' }];
    col.body.appendChild(grid([
      selectField('Code fill', fillOpts, d.fill.type, v => { d.fill.type = v; renderDesignPanel(); scheduleRender(); }),
      d.fill.type === 'solid' ? colorField('Colour', d.fill.color, v => { d.fill.color = v; scheduleRender(); }) : null,
      d.fill.type === 'linear' || d.fill.type === 'radial' ? colorField('From', d.fill.stops[0], v => { d.fill.stops[0] = v; scheduleRender(); }) : null,
      d.fill.type === 'linear' || d.fill.type === 'radial' ? colorField('To', d.fill.stops[1], v => { d.fill.stops[1] = v; scheduleRender(); }) : null,
      d.fill.type === 'linear' ? slider('Angle', d.fill.angle, 0, 360, 5, v => { d.fill.angle = v; scheduleRender(); }, v => v + '°') : null
    ]));
    if (d.fill.type === 'image') {
      col.body.appendChild(imageField('Photo', d.fill.image, src => { d.fill.image = src; scheduleRender(); }));
      col.body.appendChild(grid([slider('Darken photo', d.fill.darken, 0, 0.8, 0.05, v => { d.fill.darken = v; scheduleRender(); }, v => Math.round(v * 100) + '%')]));
    }
    const bgOpts = [{ v: 'solid', l: 'Solid' }, { v: 'transparent', l: 'Transparent' }, { v: 'linear', l: 'Gradient' }, { v: 'radial', l: 'Radial gradient' }, { v: 'image', l: 'Photo' }];
    col.body.appendChild(el('div', { class: 'label-row', text: 'background' }));
    col.body.appendChild(grid([
      selectField('Background', bgOpts, d.bg.type, v => { d.bg.type = v; renderDesignPanel(); scheduleRender(); }),
      d.bg.type === 'solid' ? colorField('Colour', d.bg.color, v => { d.bg.color = v; scheduleRender(); }) : null,
      d.bg.type === 'linear' || d.bg.type === 'radial' ? colorField('From', d.bg.stops[0], v => { d.bg.stops[0] = v; scheduleRender(); }) : null,
      d.bg.type === 'linear' || d.bg.type === 'radial' ? colorField('To', d.bg.stops[1], v => { d.bg.stops[1] = v; scheduleRender(); }) : null,
      slider('Rounded corners', d.bg.radius, 0, 0.5, 0.01, v => { d.bg.radius = v; scheduleRender(); }, v => Math.round(v * 200) + '%')
    ]));
    if (d.bg.type === 'image') {
      col.body.appendChild(imageField('Background photo', d.bg.image, src => { d.bg.image = src; scheduleRender(); }));
      col.body.appendChild(grid([
        slider('Wash over photo', d.bg.overlay, 0, 1, 0.05, v => { d.bg.overlay = v; scheduleRender(); }, v => Math.round(v * 100) + '%'),
        colorField('Wash colour', d.bg.color, v => { d.bg.color = v; scheduleRender(); })
      ]));
    }
    const custom = !!(d.eyes.frameColor || d.eyes.ballColor);
    col.body.appendChild(grid([
      el('div', { class: 'field w-half' }, [
        el('label', { class: 'check' }, [
          el('input', {
            type: 'checkbox', checked: custom,
            onchange: e => {
              if (e.target.checked) { d.eyes.frameColor = d.fill.color; d.eyes.ballColor = d.fill.color; }
              else { d.eyes.frameColor = null; d.eyes.ballColor = null; }
              renderDesignPanel();
              scheduleRender();
            }
          }),
          el('span', { text: 'Separate corner colours' })
        ])
      ]),
      custom ? colorField('Corner frame', d.eyes.frameColor || d.fill.color, v => { d.eyes.frameColor = v; scheduleRender(); }) : null,
      custom ? colorField('Corner centre', d.eyes.ballColor || d.fill.color, v => { d.eyes.ballColor = v; scheduleRender(); }) : null
    ]));
    host.appendChild(col.det);

    /* logo */
    const logo = section('Logo', !!(d.logo.src));
    const kindOpts = [{ v: 'none', l: 'No logo' }, { v: 'icon', l: 'Icon library' }, { v: 'image', l: 'Own image' }];
    const currentKind = d.logo.src ? (d.logo.kind === 'icon' ? 'icon' : 'image') : 'none';
    logo.body.appendChild(grid([
      selectField('Source', kindOpts, currentKind, v => {
        state.logoTouched = true;
        if (v === 'none') d.logo = Object.assign({}, d.logo, { src: null, kind: null, icon: null });
        else if (v === 'icon') d.logo = Object.assign({}, d.logo, { kind: 'icon', src: d.logo.kind === 'icon' ? d.logo.src : null });
        else d.logo = Object.assign({}, d.logo, { kind: 'image', src: d.logo.kind === 'image' ? d.logo.src : null });
        renderDesignPanel();
        scheduleRender();
      })
    ]));
    logo.body.appendChild(el('div', { id: 'logoSuggest', class: 'logo-suggest' }));
    if (currentKind === 'icon') {
      const picker = el('div', { class: 'icon-picker' });
      QS.icons.list().forEach(slug => {
        picker.appendChild(el('button', {
          class: 'icon-btn-big' + (d.logo.icon === slug ? ' on' : ''), type: 'button', title: slug,
          html: QS.icons.preview(slug, 22), onclick: () => applyIconLogo(slug, d.logo.iconColor)
        }));
      });
      QS.icons.BRANDS.forEach(b => {
        picker.appendChild(el('button', {
          class: 'icon-btn-big' + (d.logo.icon === b.slug ? ' on' : ''), type: 'button', title: b.name,
          html: QS.icons.preview(b.slug, 22), onclick: () => applyIconLogo(b.slug, b.color)
        }));
      });
      logo.body.appendChild(picker);
      QS.icons.hydrate(picker);
      logo.body.appendChild(grid([colorField('Icon colour', d.logo.iconColor, v => { d.logo.iconColor = v; scheduleRender(); })]));
    } else if (currentKind === 'image') {
      logo.body.appendChild(imageField('Logo image', d.logo.kind === 'image' ? d.logo.src : null, (src, ar) => {
        d.logo = Object.assign({}, d.logo, { kind: 'image', src, ar: ar || 1 });
        state.logoTouched = true;
        scheduleRender();
      }));
    }
    if (currentKind !== 'none') {
      logo.body.appendChild(grid([
        slider('Size', d.logo.size, 0.08, 0.4, 0.01, v => { d.logo.size = v; scheduleRender(); }, v => Math.round(v * 100) + '%'),
        slider('Padding', d.logo.margin, 0, 3, 0.2, v => { d.logo.margin = v; scheduleRender(); }, v => v.toFixed(1)),
        selectField('Plate behind', [{ v: 'none', l: 'None' }, { v: 'square', l: 'Square' }, { v: 'rounded', l: 'Rounded' }, { v: 'circle', l: 'Circle' }], d.logo.plate, v => { d.logo.plate = v; renderDesignPanel(); scheduleRender(); }),
        d.logo.plate !== 'none' ? colorField('Plate colour', d.logo.plateColor, v => { d.logo.plateColor = v; scheduleRender(); }) : null,
        el('div', { class: 'field w-half' }, [el('label', { class: 'check' }, [
          el('input', { type: 'checkbox', checked: d.logo.excavate !== false, onchange: e => { d.logo.excavate = e.target.checked; scheduleRender(); } }),
          el('span', { text: 'Clear the modules behind it' })
        ])])
      ]));
    }
    host.appendChild(logo.det);

    /* frame */
    const fr = section('Frame & call to action', d.frame.style !== 'none');
    const frameRow = el('div', { class: 'frame-picker' });
    E.FRAMES.forEach(f => {
      frameRow.appendChild(el('button', {
        class: 'frame-opt' + (d.frame.style === f.id ? ' on' : ''), type: 'button', text: f.name,
        onclick: () => { d.frame.style = f.id; renderDesignPanel(); scheduleRender(); }
      }));
    });
    fr.body.appendChild(frameRow);
    if (d.frame.style !== 'none') {
      fr.body.appendChild(grid([
        el('div', { class: 'field w-full' }, [
          el('label', { class: 'field-label', text: 'Text' }),
          el('input', { class: 'input', value: d.frame.text, oninput: e => { d.frame.text = e.target.value; scheduleRender(); } })
        ]),
        d.frame.style === 'ring' ? el('div', { class: 'field w-full' }, [
          el('label', { class: 'field-label', text: 'Text along the bottom' }),
          el('input', { class: 'input', value: d.frame.text2 || '', oninput: e => { d.frame.text2 = e.target.value; scheduleRender(); } })
        ]) : null,
        selectField('Font', Object.entries(E.FONTS).map(([v, f]) => ({ v, l: f.name })), d.frame.font, v => { d.frame.font = v; E.primeFont(v).then(scheduleRender); scheduleRender(); }),
        colorField('Frame colour', d.frame.color, v => { d.frame.color = v; scheduleRender(); }),
        colorField('Text colour', d.frame.textColor, v => { d.frame.textColor = v; scheduleRender(); }),
        colorField('Panel behind code', d.frame.panel, v => { d.frame.panel = v; scheduleRender(); }),
        slider('Letter spacing', d.frame.tracking, 0, 0.4, 0.01, v => { d.frame.tracking = v; scheduleRender(); }, v => v.toFixed(2)),
        slider('Corner radius', d.frame.radius, 0, 1, 0.05, v => { d.frame.radius = v; scheduleRender(); }, v => Math.round(v * 100) + '%')
      ]));
    }
    host.appendChild(fr.det);

    /* advanced */
    const adv = section('Scanning & size', false);
    adv.body.appendChild(grid([
      selectField('Error correction', [
        { v: 'auto', l: 'Automatic' }, { v: 'L', l: 'L · 7%' }, { v: 'M', l: 'M · 15%' },
        { v: 'Q', l: 'Q · 25%' }, { v: 'H', l: 'H · 30% (logo safe)' }
      ], d.ec, v => { d.ec = v; scheduleRender(); }),
      slider('Quiet zone', d.margin, 0, 10, 1, v => { d.margin = v; scheduleRender(); }, v => v + ' mod'),
      selectField('Minimum version', [{ v: '0', l: 'Automatic' }, ...Array.from({ length: 40 }, (_, i) => ({ v: String(i + 1), l: 'Version ' + (i + 1) }))], String(d.minVersion), v => { d.minVersion = Number(v); scheduleRender(); })
    ]));
    adv.body.appendChild(el('p', { class: 'field-help', text: 'Higher correction survives logos and dirt; a larger quiet zone helps cheap scanners. The check next to the preview tells you if it still reads.' }));
    host.appendChild(adv.det);

    const tools = el('div', { class: 'design-tools' }, [
      el('button', { class: 'btn ghost small', type: 'button', text: 'Random design', onclick: randomDesign }),
      el('button', { class: 'btn ghost small', type: 'button', text: 'Reset', onclick: () => { state.design = E.normalizeDesign({}); state.logoTouched = false; renderDesignPanel(); scheduleRender(); } }),
      el('button', { class: 'btn ghost small', type: 'button', text: 'Save as template', onclick: saveTemplate }),
      el('button', { class: 'btn ghost small', type: 'button', text: 'Copy design link', onclick: copyShareLink })
    ]);
    host.appendChild(tools);
    renderTemplates(host);
  }

  function stylePicker(list, current, kind, onPick) {
    const wrap = el('div', { class: 'style-picker' });
    list.forEach(item => {
      wrap.appendChild(el('button', {
        class: 'style-opt' + (item.id === current ? ' on' : ''), type: 'button', title: item.name,
        html: E.sampleSVG(kind, item.id, { color: 'currentColor', size: 34 }),
        onclick: () => onPick(item.id)
      }));
    });
    return wrap;
  }

  function presetThumb(preset) {
    try {
      const design = E.deepMerge(E.normalizeDesign({}), preset.design || {});
      const scene = E.compose({ text: 'https://dump.yanikroesti.ch' }, design, {});
      return E.toSVG(scene, { px: 62, id: 'pr' + preset.id });
    } catch (e) { return ''; }
  }
  function applyPreset(preset) {
    state.design = E.deepMerge(E.normalizeDesign({}), preset.design || {});
    state.logoTouched = false;
    renderDesignPanel();
    scheduleRender();
  }
  function randomDesign() {
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const hue = Math.floor(Math.random() * 360);
    const dark = `hsl(${hue} 70% 28%)`;
    const light = `hsl(${(hue + 40) % 360} 80% 45%)`;
    state.design = E.deepMerge(E.normalizeDesign({}), {
      dots: { style: pick(E.DOT_STYLES).id },
      eyes: { frame: pick(E.EYE_FRAMES).id, ball: pick(E.EYE_BALLS).id },
      fill: { type: pick(['solid', 'linear', 'radial']), color: hexOf(dark), stops: [hexOf(dark), hexOf(light)], angle: Math.floor(Math.random() * 360) },
      bg: { type: 'solid', color: '#ffffff', radius: Math.random() < 0.4 ? 0.1 : 0 }
    });
    renderDesignPanel();
    scheduleRender();
  }
  function hexOf(cssColor) {
    const probe = document.createElement('span');
    probe.style.color = cssColor;
    document.body.appendChild(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(rgb);
    return m ? U.hex({ r: +m[1], g: +m[2], b: +m[3] }) : '#222222';
  }

  function imageField(label, current, onPick) {
    const wrap = el('div', { class: 'field w-full' }, [el('label', { class: 'field-label', text: label })]);
    const drop = el('label', { class: 'upload-drop small' }, [el('span', { class: 'upload-hint', text: 'Choose an image (stays in your browser)' })]);
    const input = el('input', { type: 'file', class: 'sr-only', accept: 'image/*' });
    drop.appendChild(input);
    const preview = el('div', { class: 'img-preview' });
    const paint = src => {
      preview.innerHTML = '';
      if (src) {
        preview.appendChild(el('img', { src, alt: '' }));
        preview.appendChild(el('button', { class: 'icon-btn', type: 'button', html: '✕', title: 'Remove', onclick: () => { onPick(null); paint(null); } }));
      }
    };
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const small = await U.shrinkImage(file, { max: 640, quality: 0.9 });
        const dataURL = small.dataURL || (await U.readFile(file));
        const img = await U.loadImage(dataURL);
        onPick(dataURL, img.naturalWidth / img.naturalHeight);
        paint(dataURL);
      } catch (e) {
        toast('Could not read that image', 'error');
      }
      input.value = '';
    });
    wrap.append(drop, preview);
    paint(current);
    return wrap;
  }

  /* templates stored in this browser */
  function renderTemplates(host) {
    const saved = U.store.get('qrstudio.templates', []);
    if (!saved.length) return;
    const row = el('div', { class: 'preset-row' });
    saved.forEach((tpl, i) => {
      const btn = el('button', { class: 'preset', type: 'button', title: tpl.name, onclick: () => { state.design = E.normalizeDesign(tpl.design); renderDesignPanel(); scheduleRender(); } });
      btn.appendChild(el('span', { class: 'preset-thumb', html: presetThumb({ id: 'tpl' + i, design: tpl.design }) }));
      btn.appendChild(el('span', { class: 'preset-name', text: tpl.name }));
      btn.addEventListener('contextmenu', ev => {
        ev.preventDefault();
        saved.splice(i, 1);
        U.store.set('qrstudio.templates', saved);
        renderDesignPanel();
        toast('Template removed');
      });
      row.appendChild(btn);
    });
    host.appendChild(el('div', { class: 'design-presets' }, [el('div', { class: 'label-row', text: 'my templates · right-click to remove' }), row]));
  }
  function saveTemplate() {
    const name = prompt('Name for this design?');
    if (!name) return;
    const saved = U.store.get('qrstudio.templates', []);
    saved.unshift({ name: name.slice(0, 40), design: QS.cloud.slimDesign(state.design) });
    U.store.set('qrstudio.templates', saved.slice(0, 24));
    renderDesignPanel();
    toast('Design saved as template');
  }
  async function copyShareLink() {
    const payload = { t: state.typeId, v: valuesFor(state.typeId), d: QS.cloud.slimDesign(state.design) };
    const packed = await U.packState(payload);
    const link = location.origin + location.pathname + '#d=' + packed;
    if (link.length > 8000) return toast('This design is too big for a link (try without a photo)', 'error');
    const ok = await U.copyText(link);
    toast(ok ? 'Link copied — it rebuilds this exact code' : 'Could not copy');
  }
  async function restoreFromLink() {
    const m = /#d=([^&]+)/.exec(location.hash);
    if (!m) {
      const prefs = U.store.get('qrstudio.prefs', null);
      if (prefs && prefs.design) state.design = E.normalizeDesign(prefs.design);
      if (prefs && prefs.typeId && typeById(prefs.typeId)) state.typeId = prefs.typeId;
      if (prefs && prefs.exportOpts) Object.assign(state.exportOpts, prefs.exportOpts);
      return;
    }
    try {
      const data = await U.unpackState(m[1]);
      if (data && data.t && typeById(data.t)) {
        state.typeId = data.t;
        state.forms[data.t] = data.v || {};
        if (data.d) state.design = E.normalizeDesign(data.d);
        toast('Design loaded from the link');
      }
    } catch (e) { /* ignore a broken link */ }
  }
  function savePrefs() {
    U.store.set('qrstudio.prefs', {
      typeId: state.typeId,
      design: QS.cloud.slimDesign(state.design),
      exportOpts: state.exportOpts
    });
  }

  /* ───────────────────────── export ───────────────────────── */
  function renderExportPanel() {
    const host = qs('#exportPanel');
    host.innerHTML = '';
    const o = state.exportOpts;
    host.appendChild(grid([
      selectField('Format', [
        { v: 'png', l: 'PNG' }, { v: 'jpeg', l: 'JPEG' }, { v: 'webp', l: 'WEBP' },
        { v: 'svg', l: 'SVG (vector)' }, { v: 'pdf', l: 'PDF (vector)' }, { v: 'eps', l: 'EPS (print shops)' }
      ], o.format, v => { o.format = v; renderExportPanel(); }),
      ['png', 'jpeg', 'webp'].includes(o.format)
        ? selectField('Size', [256, 512, 1024, 2048, 4096].map(p => ({ v: String(p), l: p + ' px' })), String(o.px), v => { o.px = Number(v); })
        : selectField('Print size', [20, 30, 40, 50, 80, 100, 150, 200].map(mm => ({ v: String(mm), l: mm + ' mm' })), String(o.mm), v => { o.mm = Number(v); }),
      o.format === 'png' ? el('div', { class: 'field w-half' }, [el('label', { class: 'check' }, [
        el('input', { type: 'checkbox', checked: o.transparent, onchange: e => { o.transparent = e.target.checked; } }),
        el('span', { text: 'Transparent background' })
      ])]) : null,
      el('div', { class: 'field w-half' }, [
        el('label', { class: 'field-label', text: 'File name' }),
        el('input', { class: 'input', placeholder: 'qr-code', value: o.filename, oninput: e => { o.filename = e.target.value; } })
      ])
    ]));

    const actions = el('div', { class: 'export-actions' }, [
      el('button', { class: 'btn primary', type: 'button', text: 'Download', onclick: doDownload }),
      el('button', { class: 'btn ghost', type: 'button', text: 'Copy image', onclick: doCopy }),
      navigator.share ? el('button', { class: 'btn ghost', type: 'button', text: 'Share', onclick: doShare }) : null,
      el('button', { class: 'btn ghost', type: 'button', text: 'Print', onclick: doPrint }),
      el('button', { class: 'btn ghost', type: 'button', text: 'Print sheet', onclick: doSheet }),
      state.typeId === 'swissqr' ? el('button', { class: 'btn ghost', type: 'button', text: 'Payment slip (PDF)', onclick: doSlip }) : null
    ]);
    host.appendChild(actions);
    host.appendChild(el('p', { class: 'field-help', text: 'SVG, PDF and EPS stay sharp at any size — that is what print shops want. EPS flattens gradients and drops photo logos.' }));
  }

  const fileBase = () => U.slugify(state.exportOpts.filename || state.dynamic.title || typeById(state.typeId).name, 'qr-code');

  async function currentScene() {
    await E.ready(state.design);
    buildPayload();
    if (state.error) throw new Error(state.error);
    return E.compose(state.payload, state.design, {});
  }

  async function doDownload() {
    try {
      const scene = await currentScene();
      const o = state.exportOpts;
      const name = fileBase();
      if (o.format === 'svg') {
        const svg = E.toSVG(scene, { px: 1000, mm: o.mm, id: 'ex', title: state.payload.text.slice(0, 80) });
        U.download(new Blob([svg], { type: 'image/svg+xml' }), name + '.svg');
      } else if (o.format === 'pdf') {
        const blob = await E.toPDF(scene, { mm: o.mm, title: name });
        U.download(blob, name + '.pdf');
      } else if (o.format === 'eps') {
        const { eps, notes } = E.toEPS(scene, { mm: o.mm, title: name });
        U.download(new Blob([eps], { type: 'application/postscript' }), name + '.eps');
        if (notes.length) toast(notes.join(' · '));
      } else {
        const type = 'image/' + o.format;
        const blob = await E.rasterize(scene, {
          px: o.px, type,
          background: o.format === 'png' && o.transparent ? null : '#ffffff'
        });
        U.download(blob, name + '.' + (o.format === 'jpeg' ? 'jpg' : o.format));
      }
      saveHistory();
      toast('Downloaded');
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  async function doCopy() {
    try {
      const scene = await currentScene();
      const blob = await E.rasterize(scene, { px: 1024, type: 'image/png', background: '#ffffff' });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('Image copied');
    } catch (err) {
      toast('Clipboard images are not allowed here — use Download', 'error');
    }
  }
  async function doShare() {
    try {
      const scene = await currentScene();
      const blob = await E.rasterize(scene, { px: 1024, type: 'image/png', background: '#ffffff' });
      const file = new File([blob], fileBase() + '.png', { type: 'image/png' });
      await navigator.share({ files: [file], title: 'QR code' });
    } catch (err) {
      if (err && err.name !== 'AbortError') toast('Sharing did not work here', 'error');
    }
  }
  async function doPrint() {
    try {
      const scene = await currentScene();
      const svg = E.toSVG(scene, { mm: state.exportOpts.mm, id: 'pr' });
      const w = window.open('', '_blank');
      if (!w) return toast('Allow pop-ups to print', 'error');
      w.document.write(`<!doctype html><title>QR code</title><style>body{margin:0;display:grid;place-items:center;min-height:100vh}@page{margin:12mm}</style>${svg}<script>window.onload=()=>window.print()<\/script>`);
      w.document.close();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  async function doSheet() {
    try {
      const scene = await currentScene();
      const count = Number(prompt('How many copies on the sheet?', '24') || 0);
      if (!count) return;
      const blob = await QS.panels.sheetPDF([{ scene, label: state.dynamic.title || '' }], { copies: count, mm: state.exportOpts.mm });
      U.download(blob, fileBase() + '-sheet.pdf');
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  async function doSlip() {
    try {
      const blob = await QS.swissbill.slipPDF(valuesFor('swissqr'), { lang: valuesFor('swissqr').lang || 'de' });
      U.download(blob, 'qr-rechnung.pdf');
      toast('Payment slip ready');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function saveHistory() {
    if (!state.payload.text) return;
    const list = U.store.get('qrstudio.history', []);
    const entry = {
      at: new Date().toISOString(),
      typeId: state.typeId,
      title: state.dynamic.title || typeById(state.typeId).name,
      text: state.payload.text.slice(0, 1200),
      values: valuesFor(state.typeId),
      design: QS.cloud.slimDesign(state.design),
      slug: state.dynamic.slug || null
    };
    if (list[0] && list[0].text === entry.text && list[0].typeId === entry.typeId) list[0] = entry;
    else list.unshift(entry);
    U.store.set('qrstudio.history', list.slice(0, 60));
  }

  /* ───────────────────────── dynamic / hosted ───────────────────────── */
  function renderDynamicPanel() {
    const card = qs('#dynamicCard');
    const host = qs('#dynamicPanel');
    const d = state.dynamic;
    host.innerHTML = '';
    const showCard = state.hosted || state.typeId === 'url' || d.enabled;
    card.classList.toggle('hidden', !showCard);
    if (!showCard) return;

    if (!state.hosted) {
      host.appendChild(el('label', { class: 'check big' }, [
        el('input', {
          type: 'checkbox', checked: d.enabled,
          onchange: e => { d.enabled = e.target.checked; renderDynamicPanel(); scheduleRender(); }
        }),
        el('span', { text: 'Make it a short link I can edit later (with scan statistics)' })
      ]));
      if (!d.enabled) return;
    }

    if (!QS.cloud.state.owner) {
      host.appendChild(el('div', { class: 'notice' }, [
        el('p', { text: 'Short links, uploads and statistics belong to the owner of this studio.' }),
        el('button', { class: 'btn primary', type: 'button', text: 'Log in with an e-mail code', onclick: () => loginModal() })
      ]));
      return;
    }

    const values = { ...d };
    host.appendChild(grid([
      el('div', { class: 'field w-half' }, [
        el('label', { class: 'field-label', text: 'Name (only you see it)' }),
        el('input', { class: 'input', value: d.title, oninput: e => { d.title = e.target.value; } })
      ]),
      el('div', { class: 'field w-half' }, [
        el('label', { class: 'field-label', text: 'Short link' }),
        el('div', { class: 'row-inline' }, [
          el('span', { class: 'prefix', text: 'dump.yanikroesti.ch/q/' }),
          el('input', { class: 'input mono', placeholder: 'auto', value: d.slug, oninput: e => { d.slug = e.target.value.trim(); } })
        ])
      ]),
      el('div', { class: 'field w-third' }, [
        el('label', { class: 'field-label', text: 'Folder' }),
        el('input', { class: 'input', value: d.folder, oninput: e => { d.folder = e.target.value; } })
      ]),
      el('div', { class: 'field w-third' }, [
        el('label', { class: 'field-label', text: 'Active from' }),
        el('input', { class: 'input', type: 'datetime-local', value: d.startsAt, oninput: e => { d.startsAt = e.target.value; } })
      ]),
      el('div', { class: 'field w-third' }, [
        el('label', { class: 'field-label', text: 'Expires' }),
        el('input', { class: 'input', type: 'datetime-local', value: d.expiresAt, oninput: e => { d.expiresAt = e.target.value; } })
      ]),
      el('div', { class: 'field w-third' }, [
        el('label', { class: 'field-label', text: 'Scan limit' }),
        el('input', { class: 'input', type: 'number', min: '1', placeholder: 'unlimited', value: d.maxScans, oninput: e => { d.maxScans = e.target.value; } })
      ]),
      el('div', { class: 'field w-third' }, [
        el('label', { class: 'field-label', text: 'Password' }),
        el('input', { class: 'input', type: 'text', placeholder: d.passwordSet ? '•••• (set)' : 'none', value: d.password, oninput: e => { d.password = e.target.value; } })
      ]),
      el('div', { class: 'field w-third' }, [
        el('label', { class: 'check' }, [
          el('input', { type: 'checkbox', checked: d.active, onchange: e => { d.active = e.target.checked; } }),
          el('span', { text: 'Active' })
        ])
      ]),
      el('div', { class: 'field w-full' }, [
        el('label', { class: 'check' }, [
          el('input', {
            type: 'checkbox', checked: String(d.maxScans) === '1',
            onchange: e => { d.maxScans = e.target.checked ? '1' : ''; renderDynamicPanel(); }
          }),
          el('span', { text: 'One-time code — works for a single scan, then shows "already used"' })
        ])
      ])
    ]));

    if (!state.hosted || state.hostedBuild && state.hostedBuild.kind === 'url') {
      host.appendChild(routingPanel(d));
    }

    const publishRow = el('div', { class: 'export-actions' }, [
      el('button', { class: 'btn primary', type: 'button', text: d.id ? 'Save changes' : 'Publish & get the link', onclick: publish }),
      d.id ? el('button', { class: 'btn ghost', type: 'button', text: 'Open link', onclick: () => window.open(QS.cloud.shortURL(d.slug), '_blank', 'noopener') }) : null,
      d.id ? el('button', { class: 'btn ghost', type: 'button', text: 'Copy link', onclick: async () => toast(await U.copyText(QS.cloud.shortURL(d.slug)) ? 'Link copied' : 'Could not copy') }) : null,
      el('button', { class: 'btn ghost', type: 'button', text: 'Make a batch of one-time codes', onclick: batchModal })
    ]);
    host.appendChild(publishRow);
    if (d.id) host.appendChild(el('p', { class: 'field-help', text: 'Published. The printed code stays the same — change the content here any time.' }));
  }

  function routingPanel(d) {
    const det = el('details', { class: 'design-section' }, [el('summary', { text: 'Smart routing (send different people to different links)' })]);
    const body = el('div', { class: 'design-body' });
    det.appendChild(body);
    const r = d.rules;
    body.appendChild(grid([
      el('div', { class: 'field w-third' }, [el('label', { class: 'field-label', text: 'iPhone / iPad' }), el('input', { class: 'input', placeholder: 'https://…', value: r.device.ios || '', oninput: e => { r.device.ios = e.target.value.trim(); } })]),
      el('div', { class: 'field w-third' }, [el('label', { class: 'field-label', text: 'Android' }), el('input', { class: 'input', placeholder: 'https://…', value: r.device.android || '', oninput: e => { r.device.android = e.target.value.trim(); } })]),
      el('div', { class: 'field w-third' }, [el('label', { class: 'field-label', text: 'Computer' }), el('input', { class: 'input', placeholder: 'https://…', value: r.device.desktop || '', oninput: e => { r.device.desktop = e.target.value.trim(); } })])
    ]));
    body.appendChild(listEditor('By country', r.geo, ['countries', 'url'], ['CH, DE', 'https://…'], row => ({
      countries: String(row.countries || '').toUpperCase().split(/[,\s]+/).filter(Boolean),
      url: row.url
    })));
    body.appendChild(listEditor('By phone language', r.lang, ['langs', 'url'], ['de, fr', 'https://…'], row => ({
      langs: String(row.langs || '').toLowerCase().split(/[,\s]+/).filter(Boolean),
      url: row.url
    })));
    body.appendChild(listEditor('A/B split (weights)', r.ab, ['weight', 'url'], ['50', 'https://…'], row => ({ weight: Number(row.weight) || 1, url: row.url })));
    body.appendChild(listEditor('Switch at a date', r.schedule, ['from', 'url'], ['2026-12-01T08:00', 'https://…'], row => ({
      from: row.from ? new Date(row.from).toISOString() : '', url: row.url
    }), 'datetime-local'));
    body.appendChild(el('p', { class: 'field-help', text: 'Order: date switch → time of day → country → language → device → A/B. The first rule that matches wins.' }));
    return det;
  }

  function listEditor(label, arr, keys, placeholders, mapRow, inputType) {
    const wrap = el('div', { class: 'field w-full' }, [el('label', { class: 'field-label', text: label })]);
    const list = el('div', { class: 'mini-list' });
    const paint = () => {
      list.innerHTML = '';
      arr.forEach((item, i) => {
        const a = el('input', {
          class: 'input small', type: inputType || 'text', placeholder: placeholders[0],
          value: Array.isArray(item[keys[0]]) ? item[keys[0]].join(', ') : (item[keys[0]] ? (inputType === 'datetime-local' ? U.toLocalInput(item[keys[0]]) : item[keys[0]]) : ''),
          oninput: e => { arr[i] = mapRow(Object.assign({}, rowValues(i), { [keys[0]]: e.target.value })); }
        });
        const b = el('input', {
          class: 'input small grow', placeholder: placeholders[1], value: item[keys[1]] || '',
          oninput: e => { arr[i] = mapRow(Object.assign({}, rowValues(i), { [keys[1]]: e.target.value })); }
        });
        const rowValues = idx => ({
          [keys[0]]: Array.isArray(arr[idx][keys[0]]) ? arr[idx][keys[0]].join(',') : arr[idx][keys[0]],
          [keys[1]]: arr[idx][keys[1]]
        });
        const del = el('button', { class: 'icon-btn', type: 'button', html: '✕', onclick: () => { arr.splice(i, 1); paint(); } });
        list.appendChild(el('div', { class: 'mini-row' }, [a, b, del]));
      });
    };
    paint();
    wrap.appendChild(list);
    wrap.appendChild(el('button', { class: 'btn ghost small', type: 'button', text: 'Add rule', onclick: () => { arr.push({}); paint(); } }));
    return wrap;
  }

  function dynamicPayload() {
    const d = state.dynamic;
    const base = {
      title: d.title || '',
      slug: d.slug || undefined,
      folder: d.folder || '',
      note: d.note || '',
      active: d.active,
      starts_at: d.startsAt ? U.fromLocalInput(d.startsAt) : null,
      expires_at: d.expiresAt ? U.fromLocalInput(d.expiresAt) : null,
      max_scans: d.maxScans ? Number(d.maxScans) : null,
      design: QS.cloud.slimDesign(state.design)
    };
    if (d.password) base.password = d.password;
    if (state.hosted) {
      const built = QS.pages.build(state.typeId, valuesFor(state.typeId));
      base.title = base.title || built.title;
      if (built.kind === 'url') { base.kind = 'url'; base.target = built.target; base.rules = cleanRules(d.rules); }
      else { base.kind = 'page'; base.page = built.page; }
    } else {
      const built = QS.formats.build(state.typeId, valuesFor(state.typeId));
      base.kind = 'url';
      base.target = built.text;
      base.rules = cleanRules(d.rules);
      base.title = base.title || built.text.slice(0, 60);
    }
    if (d.id) base.id = d.id;
    return base;
  }
  function cleanRules(r) {
    const out = {};
    const dev = {};
    ['ios', 'android', 'desktop'].forEach(k => { if (r.device && r.device[k]) dev[k] = r.device[k]; });
    if (Object.keys(dev).length) out.device = dev;
    const arr = (list, keep) => (list || []).filter(keep);
    const geo = arr(r.geo, x => x && x.url && x.countries && x.countries.length);
    if (geo.length) out.geo = geo;
    const lang = arr(r.lang, x => x && x.url && x.langs && x.langs.length);
    if (lang.length) out.lang = lang;
    const ab = arr(r.ab, x => x && x.url);
    if (ab.length) out.ab = ab;
    const sched = arr(r.schedule, x => x && x.url && x.from);
    if (sched.length) out.schedule = sched;
    if (r.time && r.time.slots && r.time.slots.length) out.time = r.time;
    return out;
  }

  async function publish() {
    if (!QS.cloud.state.owner) return loginModal();
    try {
      const data = dynamicPayload();
      const saved = await QS.cloud.save(data);
      state.dynamic.id = saved.id;
      state.dynamic.slug = saved.slug;
      state.dynamic.passwordSet = saved.has_password;
      state.dynamic.password = '';
      renderDynamicPanel();
      scheduleRender();
      saveHistory();
      toast('Live at ' + QS.cloud.shortURL(saved.slug));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function batchModal() {
    if (!QS.cloud.state.owner) return loginModal();
    const body = el('div');
    const values = { count: 10, label: state.dynamic.title || 'Batch' };
    UI.renderForm(body, [
      { k: 'label', label: 'Batch name', type: 'text', w: 'half' },
      { k: 'count', label: 'How many codes', type: 'number', w: 'half' },
      { k: 'note', label: 'Each code works once and then shows "already used". Tickets, vouchers, giveaways.', type: 'note' }
    ], values, () => { });
    UI.modal({
      title: 'Batch of one-time codes',
      body,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Create', primary: true, onClick: async close => {
            try {
              const data = dynamicPayload();
              delete data.id;
              const res = await QS.cloud.batchCreate(data, Math.max(1, Math.min(1000, Number(values.count) || 1)), values.label);
              close();
              toast(`${res.codes.length} codes created`);
              setTab('codes');
              QS.panels.render('codes');
            } catch (err) {
              toast(err.message, 'error');
            }
          }
        }
      ]
    });
  }

  /* load an existing code back into the editor */
  function loadCode(code) {
    state.dynamic = Object.assign(newDynamic(), {
      enabled: true, id: code.id, slug: code.slug, title: code.title, folder: code.folder,
      note: code.note, active: code.active, passwordSet: code.has_password,
      startsAt: U.toLocalInput(code.starts_at), expiresAt: U.toLocalInput(code.expires_at),
      maxScans: code.max_scans || '', rules: Object.assign(newDynamic().rules, code.rules || {})
    });
    if (code.design) state.design = E.normalizeDesign(code.design);
    if (code.kind === 'url') {
      state.typeId = 'dyn-url';
      state.hosted = true;
      state.forms['dyn-url'] = { target: code.target };
    } else {
      const pageType = (code.page && code.page.type) || 'custom';
      const known = QS.pages.TYPES.find(t => t.id === pageType || (pageType === 'event' && t.id === 'eventpage'));
      state.typeId = known ? known.id : 'custom';
      state.hosted = true;
      toast('Content loaded — the page fields are rebuilt from what you typed when you published, so check them before saving.');
    }
    setTab('create');
    selectType(state.typeId, true);
    renderDynamicPanel();
    scheduleRender();
  }

  /* ───────────────────────── owner login ───────────────────────── */
  function bindOwnerChip() {
    qs('#ownerBtn').addEventListener('click', () => {
      if (QS.cloud.state.owner) {
        UI.modal({
          title: 'Owner',
          body: el('p', { class: 'modal-text', text: 'Logged in as ' + QS.cloud.state.email }),
          actions: [{ label: 'Close' }, { label: 'Log out', primary: true, onClick: async close => { await QS.cloud.signOut(); close(); toast('Logged out'); } }]
        });
      } else loginModal();
    });
    paintOwnerChip();
  }
  function paintOwnerChip() {
    const btn = qs('#ownerBtn');
    const owner = QS.cloud.state.owner;
    btn.className = 'owner-chip' + (owner ? ' on' : '');
    btn.textContent = owner ? '● owner' : '○ log in';
    btn.title = owner ? QS.cloud.state.email : 'Log in to publish short links, upload files and see statistics';
  }
  function requireLogin(message) {
    toast(message || 'Log in first', 'error');
    loginModal();
  }
  function loginModal() {
    const wrap = el('div');
    const email = U.store.get('qrstudio.email', '');
    const step1 = el('div', { class: 'login-step' }, [
      el('p', { class: 'modal-text', text: 'A six-digit code is mailed to the owner address.' }),
      el('input', { class: 'input', id: 'loginEmail', type: 'email', placeholder: 'you@example.com', value: email })
    ]);
    const step2 = el('div', { class: 'login-step hidden' }, [
      el('p', { class: 'modal-text', text: 'Enter the code from the e-mail.' }),
      el('input', { class: 'input mono big', id: 'loginCode', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '000000', maxlength: 8 })
    ]);
    const note = el('p', { class: 'field-help' });
    wrap.append(step1, step2, note);
    let sent = false;
    const m = UI.modal({
      title: 'Owner login',
      body: wrap,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Send code', primary: true, onClick: async (close) => {
            const btn = qs('#modal .modal-foot .btn.primary');
            const mail = qs('#loginEmail').value.trim();
            if (!sent) {
              btn.disabled = true;
              btn.textContent = 'Sending…';
              const res = await QS.cloud.sendCode(mail);
              btn.disabled = false;
              if (!res.ok) { note.textContent = res.error; btn.textContent = 'Send code'; return; }
              sent = true;
              step1.classList.add('hidden');
              step2.classList.remove('hidden');
              note.textContent = 'Code sent. It is valid for a few minutes.';
              btn.textContent = 'Log in';
              qs('#loginCode').focus();
              return;
            }
            btn.disabled = true;
            const res = await QS.cloud.verifyCode(mail, qs('#loginCode').value);
            btn.disabled = false;
            if (!res.ok) { note.textContent = res.error; return; }
            close();
            toast('Logged in');
            paintOwnerChip();
            renderDynamicPanel();
          }
        }
      ]
    });
    return m;
  }

  QS.app = {
    state, init, setTab, selectType, loadCode, requireLogin, loginModal, scheduleRender,
    renderDynamicPanel, currentScene, saveHistory, valuesFor, typeById, fileBase,
    applyDesign(design) { state.design = E.normalizeDesign(design); renderDesignPanel(); scheduleRender(); },
    applyValues(typeId, values) { state.forms[typeId] = values || {}; selectType(typeId, true); }
  };

  document.addEventListener('DOMContentLoaded', () => {
    QS.app.init().catch(err => {
      console.error(err);
      toast('Something went wrong while starting up', 'error');
    });
  });
})();
