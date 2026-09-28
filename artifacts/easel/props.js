/* Easel — contextual toolbar, context menu, text helpers, file menu, resize dialog */
(() => {
const EZ = window.EZ;
const { $, $$, h, icon } = EZ;

/* ── text helpers (whole box, or just the selected characters while editing) ── */
const texts = () => EZ.selected().filter(o => o.type === 'textbox');
EZ.setTextProp = async (prop, val) => {
  for (const t of texts()) {
    if (prop === 'fontFamily') await EZ.loadFont(val, t.fontWeight, t.fontStyle);
    if (prop === 'fontWeight' || prop === 'fontStyle') await EZ.loadFont(t.fontFamily, prop === 'fontWeight' ? val : t.fontWeight, prop === 'fontStyle' ? val : t.fontStyle);
    if (t.isEditing && t.selectionStart !== t.selectionEnd) {
      t.setSelectionStyles({ [prop]: val });
    } else {
      t.set(prop, val);
      if (t.styles && Object.keys(t.styles).length) t.removeStyle?.(prop);
      if (prop === 'fill' && t.effect?.type === 'hollow') { t.effect.fill = val; t.set({ fill: 'rgba(0,0,0,0)', stroke: val }); }
    }
    t.initDimensions(); t.setCoords(); t.dirty = true;
  }
  EZ.cv.requestRenderAll();
  EZ.commit();
};
const textVal = (t, prop) => {
  if (t.isEditing && t.selectionStart !== t.selectionEnd) {
    const s = t.getSelectionStyles(t.selectionStart, t.selectionEnd)[0] || {};
    if (s[prop] !== undefined) return s[prop];
  }
  if (prop === 'fill' && t.effect?.type === 'hollow') return t.effect.fill;
  return t[prop];
};
const isBold = t => (+textVal(t, 'fontWeight') || (textVal(t, 'fontWeight') === 'bold' ? 700 : 400)) >= 600;
EZ.toggleText = async which => {
  const t = texts()[0];
  if (!t) return;
  if (which === 'b') await EZ.setTextProp('fontWeight', isBold(t) ? 400 : 700);
  if (which === 'i') await EZ.setTextProp('fontStyle', textVal(t, 'fontStyle') === 'italic' ? 'normal' : 'italic');
  if (which === 'u') await EZ.setTextProp('underline', !textVal(t, 'underline'));
  EZ.renderProps();
};

/* ── small builders ── */
const cb = (ic, title, fn, opts = {}) => h('button', { class: 'cb' + (opts.on ? ' on' : ''), title, onclick: fn, disabled: !!opts.disabled }, typeof ic === 'string' ? icon(ic) : ic, opts.label || null);
const sep = () => h('span', { class: 'cb-sep' });
const colorBtn = (current, title, onPick, opts = {}) => {
  const b = h('button', { class: 'cb cb-color', title });
  if (opts.text) b.append(h('i', { class: 'bar' }, 'A', h('b', { style: { background: EZ.fillCss(current) } })));
  else if (opts.border) b.append(h('i', { class: 'dot', style: { background: '#fff', border: `4px solid ${current || '#ccc'}`, borderRadius: '5px' } }));
  else b.append(h('i', { class: 'dot', style: { background: EZ.fillCss(current) } }));
  b.onclick = () => EZ.colorPop(b, typeof current === 'string' ? current : null, (v, fin) => { onPick(v, fin); if (fin) { EZ.commit(); EZ.renderProps(); } }, opts);
  return b;
};
const numBox = (value, onSet, { step = 1, min = 1, max = 999, title } = {}) => {
  const inp = h('input', { value: EZ.round(value, 1), title, inputmode: 'decimal' });
  const set = v => { v = EZ.clamp(EZ.round(+v || 0, 1), min, max); inp.value = v; onSet(v); };
  inp.addEventListener('change', () => set(inp.value));
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { set(inp.value); inp.blur(); } if (e.key === 'ArrowUp') { e.preventDefault(); set(+inp.value + step); } if (e.key === 'ArrowDown') { e.preventDefault(); set(+inp.value - step); } });
  return h('span', { class: 'num' }, h('button', { title: 'Smaller', onclick: () => set(+inp.value - step) }, icon('minus', 'sm')), inp, h('button', { title: 'Bigger', onclick: () => set(+inp.value + step) }, icon('plus', 'sm')));
};
const sliderPop = (anchor, label, value, min, max, onInput, fmt = v => v) => {
  const r = h('input', { type: 'range', min, max, value, style: { width: '100%' } });
  const v = h('span', {}, fmt(value));
  r.addEventListener('input', () => { v.textContent = fmt(+r.value); onInput(+r.value); });
  r.addEventListener('change', () => EZ.commit());
  EZ.pop(anchor, h('div', { class: 'field', style: { margin: 0 } }, h('label', {}, label, v), r), { width: 240 });
};

/* ── toolbar ── */
EZ.renderProps = () => {
  const bar = $('#ctx');
  if (!bar || !EZ.doc) return;
  bar.innerHTML = '';
  const cv = EZ.cv, a = cv.getActiveObject();
  const add = (...els) => bar.append(...els.filter(Boolean));

  if (EZ.isDrawing()) {
    add(h('span', { class: 'ctx-label' }, 'Drawing mode'), cb('mouse-pointer-2', 'Stop drawing (Esc)', () => EZ.setDraw(null), { label: 'Done' }));
    return;
  }
  if (!a) {
    const bg = EZ.bgRect();
    add(colorBtn(bg?.fill, 'Background colour', v => EZ.setBackground(v), { gradients: true, title: 'Background colour' }),
      h('span', { class: 'ctx-label' }, 'Background'), sep(),
      cb('scaling', 'Resize design', () => EZ.showResize(), { label: 'Resize' }),
      cb('layout-template', 'Templates', () => EZ.openPanel('templates'), { label: 'Templates' }),
      h('span', { class: 'grow' }),
      h('span', { class: 'ctx-label' }, `Page ${EZ.pageIndex + 1} of ${EZ.doc.pages.length} · ${EZ.doc.mm ? EZ.doc.mm.join(' × ') + ' mm' : EZ.W() + ' × ' + EZ.H() + ' px'}`));
    return;
  }
  const multi = a.type === 'activeSelection';
  const objs = EZ.selected();
  const t = objs.find(o => o.type === 'textbox');
  const allText = objs.every(o => o.type === 'textbox');

  if (t && allText) {
    const fb = h('button', { class: 'cb font-btn', title: 'Font', onclick: () => EZ.openPanel('font') }, h('span', { style: { fontFamily: `'${textVal(t, 'fontFamily')}'` } }, textVal(t, 'fontFamily')), icon('chevron-down', 'sm'));
    add(fb, numBox(textVal(t, 'fontSize') * (t.scaleX || 1), v => EZ.setTextProp('fontSize', v / (t.scaleX || 1)), { title: 'Font size', max: 2000 }),
      colorBtn(textVal(t, 'fill'), 'Text colour', (v, fin) => { if (v) EZ.setTextProp('fill', v); }, { text: true, title: 'Text colour' }),
      cb('bold', 'Bold (Ctrl+B)', () => { EZ.setTextProp('fontWeight', isBold(t) ? 400 : 700).then(EZ.renderProps); }, { on: isBold(t) }),
      cb('italic', 'Italic (Ctrl+I)', () => { EZ.setTextProp('fontStyle', textVal(t, 'fontStyle') === 'italic' ? 'normal' : 'italic').then(EZ.renderProps); }, { on: textVal(t, 'fontStyle') === 'italic' }),
      cb('underline', 'Underline (Ctrl+U)', () => { EZ.setTextProp('underline', !textVal(t, 'underline')).then(EZ.renderProps); }, { on: !!textVal(t, 'underline') }),
      cb('strikethrough', 'Strikethrough', () => { EZ.setTextProp('linethrough', !textVal(t, 'linethrough')).then(EZ.renderProps); }, { on: !!textVal(t, 'linethrough') }),
    );
    const aligns = ['left', 'center', 'right', 'justify'];
    const alIcon = { left: 'text-align-start', center: 'text-align-center', right: 'text-align-end', justify: 'text-align-justify' };
    add(cb(alIcon[t.textAlign] || 'text-align-center', 'Alignment', () => { const n = aligns[(aligns.indexOf(t.textAlign) + 1) % 4]; texts().forEach(x => x.set('textAlign', n)); cv.requestRenderAll(); EZ.commit(); EZ.renderProps(); }));
    const caseBtn = cb('case-sensitive', 'Letter case', () => EZ.menu(caseBtn, [
      { label: 'UPPERCASE', run: () => textCase(s => s.toUpperCase()) },
      { label: 'lowercase', run: () => textCase(s => s.toLowerCase()) },
      { label: 'Title Case', run: () => textCase(s => s.toLowerCase().replace(/(^|\s|-)(\p{L})/gu, (m, a, b) => a + b.toUpperCase())) },
      { label: 'Sentence case', run: () => textCase(s => s.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (m, a, b) => a + b.toUpperCase())) },
    ]));
    const spBtn = cb('baseline', 'Spacing', () => {
      const ls = h('input', { type: 'range', min: -150, max: 800, value: t.charSpacing || 0 });
      const lh = h('input', { type: 'range', min: 50, max: 300, value: Math.round((t.lineHeight || 1.16) * 100) });
      const lv = h('span', {}, t.charSpacing || 0), hv = h('span', {}, (t.lineHeight || 1.16).toFixed(2));
      ls.addEventListener('input', () => { lv.textContent = ls.value; texts().forEach(x => { x.set('charSpacing', +ls.value); x.initDimensions(); }); cv.requestRenderAll(); });
      lh.addEventListener('input', () => { hv.textContent = (lh.value / 100).toFixed(2); texts().forEach(x => { x.set('lineHeight', lh.value / 100); x.initDimensions(); }); cv.requestRenderAll(); });
      ls.addEventListener('change', () => EZ.commit()); lh.addEventListener('change', () => EZ.commit());
      EZ.pop(spBtn, h('div', {}, h('div', { class: 'field' }, h('label', {}, 'Letter spacing', lv), ls), h('div', { class: 'field', style: { margin: 0 } }, h('label', {}, 'Line spacing', hv), lh)), { width: 250 });
    });
    add(caseBtn, spBtn, sep(), cb('sparkles', 'Text effects', () => EZ.openPanel('effects'), { label: 'Effects', on: !!t.effect }));
  } else if (!multi && a.type === 'image') {
    const frameEmpty = a.ezType === 'frame' && !a.ezData?.filled;
    if (frameEmpty) {
      add(cb('image', 'Choose a photo for this frame', () => EZ.openPanel('photos'), { label: 'Add photo' }),
        cb('cloud-upload', 'Upload into frame', () => EZ.replacePhotoDialog(a), { label: 'Upload' }));
    } else {
      add(cb('sliders-horizontal', 'Edit photo', () => EZ.openPanel('photo'), { label: 'Edit photo' }),
        cb('wand-sparkles', 'Remove background', () => EZ.removeImageBg(a), { label: 'BG remover', on: !!a.ezData?.cutout }),
        cb('crop', 'Crop (double-click)', () => EZ.cropImage(a), { label: 'Crop' }));
    }
    const flipBtn = cb('flip-horizontal-2', 'Flip', () => EZ.menu(flipBtn, [
      { label: 'Flip horizontal', icon: 'flip-horizontal-2', run: () => EZ.flip('x') },
      { label: 'Flip vertical', icon: 'flip-vertical-2', run: () => EZ.flip('y') }]), { label: 'Flip' });
    const shapeBtn = cb('frame', 'Shape & corners', () => {
      const box = h('div');
      const g = h('div', { class: 'grid g5', style: { marginBottom: '12px' } });
      [['none', 'Square'], ['circle', 'Circle'], ...Object.keys(EZ.MASK_PATHS).map(k => [k, k])].forEach(([k, l]) => {
        const f = { mask: k, w: 1, h: 1 };
        const tl = h('button', { class: 'tile', title: l, style: { borderColor: (a.ezMask || 'none') === k ? 'var(--accent)' : '' }, html: EZ.framePreview(f), onclick: () => { EZ.applyMask(a, k, k === 'none' ? a.ezRadius : 0); EZ.commit(); EZ.closePop(); } });
        g.append(tl);
      });
      const r = h('input', { type: 'range', min: 0, max: Math.round(Math.min(a.getScaledWidth(), a.getScaledHeight()) / 2), value: a.ezRadius || 0, style: { width: '100%' } });
      const v = h('span', {}, Math.round(a.ezRadius || 0));
      r.addEventListener('input', () => { v.textContent = r.value; EZ.applyMask(a, 'none', +r.value); });
      r.addEventListener('change', () => EZ.commit());
      box.append(h('h4', {}, 'Shape'), g, h('div', { class: 'field', style: { margin: 0 } }, h('label', {}, 'Corner rounding', v), r));
      EZ.pop(shapeBtn, box, { width: 270 });
    }, { label: 'Shape' });
    add(flipBtn, shapeBtn);
    if (!frameEmpty && a.ezType === 'frame') add(cb('refresh-cw', 'Replace photo', () => EZ.replacePhotoDialog(a), { label: 'Replace' }));
  } else if (!multi && a.type === 'ezLine') {
    add(colorBtn(a.stroke, 'Line colour', (v) => { if (v) { a.set('stroke', v); cv.requestRenderAll(); } }),
      numBox(a.strokeWidth, v => { a.set('strokeWidth', v); a.setCoords(); cv.requestRenderAll(); EZ.commit(); }, { title: 'Thickness', max: 200 }));
    const dashBtn = cb('square-dashed', 'Line style', () => EZ.menu(dashBtn, ['solid', 'dashed', 'dotted'].map(d => ({ label: d[0].toUpperCase() + d.slice(1), icon: a.dash === d ? 'check' : null, run: () => { a.set('dash', d); cv.requestRenderAll(); EZ.commit(); } }))));
    const heads = ['none', 'arrow', 'triangle', 'circle', 'bar'];
    const headBtn = (side, ic) => { const b = cb(ic, side === 'startHead' ? 'Line start' : 'Line end', () => EZ.menu(b, heads.map(hd => ({ label: hd === 'none' ? 'None' : hd[0].toUpperCase() + hd.slice(1), icon: a[side] === hd ? 'check' : null, run: () => { a.set(side, hd); cv.requestRenderAll(); EZ.commit(); EZ.renderProps(); } })))); return b; };
    add(dashBtn, headBtn('startHead', 'arrow-left'), headBtn('endHead', 'arrow-right'));
  } else if (!multi && (a.ezType === 'icon' || a.ezType === 'sticker')) {
    if (a.ezType === 'icon') add(colorBtn(EZ.iconColor(a), 'Icon colour', v => { if (v) EZ.setIconColor(a, v); }));
    add(cb('flip-horizontal-2', 'Flip horizontal', () => EZ.flip('x'), { label: 'Flip' }));
  } else if (!multi && a.ezType === 'qr') {
    add(cb('qr-code', 'Edit QR code', () => EZ.openPanel('qr'), { label: 'Edit QR code' }));
  } else if (!multi && a.ezType === 'chart') {
    add(cb('chart-column', 'Edit chart', () => EZ.openPanel('chart'), { label: 'Edit chart' }));
  } else if (!multi && a.type === 'group' && a.ezType === 'group') {
    add(cb('ungroup', 'Ungroup (Ctrl+Shift+G)', EZ.ungroup, { label: 'Ungroup' }));
  } else if (!multi && (a.ezType === 'draw' || (a.type === 'path' && !a.fill))) {
    add(colorBtn(a.stroke, 'Stroke colour', v => { if (v) { a.set('stroke', v); cv.requestRenderAll(); } }),
      numBox(a.strokeWidth, v => { a.set('strokeWidth', v); cv.requestRenderAll(); EZ.commit(); }, { title: 'Thickness', max: 300 }));
  } else if (!multi && a.type !== 'ezLine' && a.type !== 'group') {
    // shapes
    add(colorBtn(a.fill, 'Fill colour', v => { a.set('fill', v ? EZ.makeFill(v) : ''); cv.requestRenderAll(); }, { gradients: true, none: true, title: 'Fill' }));
    const borderBtn = h('button', { class: 'cb', title: 'Border' }, icon('square-dashed'), 'Border');
    borderBtn.onclick = () => {
      const box = h('div');
      const sc = h('button', { class: 'cb cb-color', style: { border: '1px solid var(--line)' } }, h('i', { class: 'dot', style: { background: a.stroke || '#fff' } }));
      sc.onclick = () => EZ.colorPop(sc, a.stroke, (v, fin) => { a.set({ stroke: v, strokeUniform: true }); if (v && !a.strokeWidth) a.set('strokeWidth', 4 * EZ.k()); sc.firstChild.style.background = v || '#fff'; cv.requestRenderAll(); if (fin) EZ.commit(); }, { none: true, keep: true });
      const w = h('input', { type: 'range', min: 0, max: 60, value: Math.round(a.strokeWidth || 0), style: { width: '100%' } });
      const wv = h('span', {}, Math.round(a.strokeWidth || 0));
      w.addEventListener('input', () => { wv.textContent = w.value; a.set({ strokeWidth: +w.value, strokeUniform: true }); if (!a.stroke) a.set('stroke', '#1b1a24'); cv.requestRenderAll(); });
      w.addEventListener('change', () => EZ.commit());
      const seg = h('div', { class: 'seg' });
      [['Solid', null], ['Dashed', 'dash'], ['Dotted', 'dot']].forEach(([l, k]) => seg.append(h('button', {
        class: (!a.strokeDashArray && !k) || (k === 'dash' && a.strokeDashArray?.[0] > 1) || (k === 'dot' && a.strokeDashArray?.[0] <= 1) ? 'on' : '',
        onclick: e => { const sw = a.strokeWidth || 4; a.set({ strokeDashArray: k === 'dash' ? [sw * 3, sw * 2] : k === 'dot' ? [0.01, sw * 2] : null, strokeLineCap: k === 'dot' ? 'round' : 'butt' }); $$('button', seg).forEach(b => b.classList.remove('on')); e.currentTarget.classList.add('on'); cv.requestRenderAll(); EZ.commit(); },
      }, l)));
      box.append(h('div', { class: 'row', style: { marginBottom: '12px' } }, sc, h('b', {}, 'Border colour')), h('div', { class: 'field' }, h('label', {}, 'Border weight', wv), w), seg);
      if (a.type === 'rect') {
        const r = h('input', { type: 'range', min: 0, max: Math.round(Math.min(a.width, a.height) / 2), value: Math.round(a.rx || 0), style: { width: '100%' } });
        const rv = h('span', {}, Math.round(a.rx || 0));
        r.addEventListener('input', () => { rv.textContent = r.value; a.set({ rx: +r.value, ry: +r.value }); cv.requestRenderAll(); });
        r.addEventListener('change', () => EZ.commit());
        box.append(h('div', { class: 'field', style: { margin: '12px 0 0' } }, h('label', {}, 'Corner rounding', rv), r));
      }
      EZ.pop(borderBtn, box, { width: 260 });
    };
    add(borderBtn);
  }
  if (multi) {
    add(h('span', { class: 'ctx-label' }, `${objs.length} selected`), cb('group', 'Group (Ctrl+G)', EZ.group, { label: 'Group' }));
    const alBtn = cb('align-center-horizontal', 'Align', () => EZ.menu(alBtn, [
      { label: 'Align left', icon: 'align-start-vertical', run: () => EZ.alignSelection('left') },
      { label: 'Align centre', icon: 'align-center-vertical', run: () => EZ.alignSelection('center') },
      { label: 'Align right', icon: 'align-end-vertical', run: () => EZ.alignSelection('right') },
      '-',
      { label: 'Align top', icon: 'align-start-horizontal', run: () => EZ.alignSelection('top') },
      { label: 'Align middle', icon: 'align-center-horizontal', run: () => EZ.alignSelection('middle') },
      { label: 'Align bottom', icon: 'align-end-horizontal', run: () => EZ.alignSelection('bottom') },
      '-',
      { label: 'Space evenly horizontally', icon: 'align-horizontal-distribute-center', disabled: objs.length < 3, run: () => EZ.distribute('h') },
      { label: 'Space evenly vertically', icon: 'align-vertical-distribute-center', disabled: objs.length < 3, run: () => EZ.distribute('v') },
    ]), { label: 'Align' });
    add(alBtn);
    if (objs.every(o => o.type === 'textbox')) add(cb('sparkles', 'Effects', () => EZ.openPanel('effects'), { label: 'Effects' }));
  }

  // common, right side
  add(h('span', { class: 'grow' }));
  add(cb('layers', 'Position & layers', () => EZ.openPanel('layers')));
  const opBtn = cb('blend', 'Transparency', () => sliderPop(opBtn, 'Transparency', Math.round((a.opacity ?? 1) * 100), 0, 100, v => { objs.forEach(o => o.set('opacity', v / 100)); cv.requestRenderAll(); }, v => v + '%'));
  add(opBtn);
  const locked = objs.every(o => o.locked);
  add(cb(locked ? 'lock' : 'lock-open', locked ? 'Unlock (Ctrl+L)' : 'Lock (Ctrl+L)', () => { objs.forEach(o => EZ.setLocked(o, !locked)); }, { on: locked }));
  add(cb('copy-plus', 'Duplicate (Ctrl+D)', EZ.duplicate), cb('trash-2', 'Delete (Del)', EZ.del, { disabled: locked }));
  const more = cb('ellipsis', 'More', () => EZ.menu(more, menuItems(), { align: 'right' }));
  add(more);
};
function textCase(fn) { texts().forEach(t => { t.set('text', fn(t.text)); t.initDimensions(); }); EZ.cv.requestRenderAll(); EZ.commit(); }

/* ── context / more menu ── */
function menuItems() {
  const a = EZ.active();
  const objs = EZ.selected();
  const img = objs.length === 1 && a?.type === 'image';
  return [
    { label: 'Copy', icon: 'copy', kbd: 'Ctrl+C', disabled: !a, run: EZ.copy },
    { label: 'Paste', icon: 'clipboard-paste', kbd: 'Ctrl+V', disabled: !EZ.hasClip(), run: EZ.paste },
    { label: 'Duplicate', icon: 'copy-plus', kbd: 'Ctrl+D', disabled: !a, run: EZ.duplicate },
    { label: 'Delete', icon: 'trash-2', kbd: 'Del', disabled: !a, run: EZ.del },
    '-',
    { label: 'Copy style', icon: 'paintbrush', kbd: 'Ctrl+Alt+C', disabled: !a || objs.length !== 1, run: EZ.copyStyle },
    { label: 'Paste style', icon: 'paintbrush-vertical', kbd: 'Ctrl+Alt+V', disabled: !a || !EZ.hasStyle(), run: EZ.pasteStyle },
    '-',
    { label: 'Bring forward', icon: 'arrow-up', kbd: 'Ctrl+]', disabled: !a, run: () => EZ.arrange('forward') },
    { label: 'Bring to front', icon: 'bring-to-front', kbd: 'Ctrl+Alt+]', disabled: !a, run: () => EZ.arrange('front') },
    { label: 'Send backward', icon: 'arrow-down', kbd: 'Ctrl+[', disabled: !a, run: () => EZ.arrange('backward') },
    { label: 'Send to back', icon: 'send-to-back', kbd: 'Ctrl+Alt+[', disabled: !a, run: () => EZ.arrange('back') },
    '-',
    objs.length > 1 && a?.type === 'activeSelection' ? { label: 'Group', icon: 'group', kbd: 'Ctrl+G', run: EZ.group } : null,
    a?.type === 'group' && a.ezType === 'group' ? { label: 'Ungroup', icon: 'ungroup', kbd: 'Ctrl+Shift+G', run: EZ.ungroup } : null,
    { label: objs.every(o => o.locked) && a ? 'Unlock' : 'Lock', icon: 'lock', kbd: 'Ctrl+L', disabled: !a, run: () => { const l = objs.every(o => o.locked); objs.forEach(o => EZ.setLocked(o, !l)); } },
    img ? { label: 'Set as background', icon: 'image', run: () => EZ.setAsBackground(a) } : null,
    img ? { label: 'Remove background', icon: 'wand-sparkles', run: () => EZ.removeImageBg(a) } : null,
    img ? { label: 'Download this image', icon: 'download', run: () => EZ.exportObject(a) } : null,
    !a ? { label: 'Select all', icon: 'mouse-pointer-2', kbd: 'Ctrl+A', run: EZ.selectAll } : null,
    !a ? { label: 'Page background…', icon: 'palette', run: () => EZ.openPanel('background') } : null,
  ];
}
EZ.contextMenu = e => {
  requestAnimationFrame(() => EZ.menu({ x: e.clientX, y: e.clientY }, menuItems()));
};

/* ── shortcuts ── */
EZ.showShortcuts = () => EZ.modal((m, close) => {
  const rows = [['Add text', 'T'], ['Add rectangle / circle / line', 'R · C · L'], ['Undo / redo', 'Ctrl+Z · Ctrl+Shift+Z'], ['Copy / paste / cut', 'Ctrl+C · V · X'],
    ['Duplicate', 'Ctrl+D'], ['Delete', 'Del'], ['Select all', 'Ctrl+A'], ['Group / ungroup', 'Ctrl+G · Ctrl+Shift+G'], ['Lock / unlock', 'Ctrl+L'],
    ['Forward / backward', 'Ctrl+] · Ctrl+['], ['Nudge (10 px with Shift)', 'Arrow keys'], ['Edit selected text', 'Enter'], ['Copy / paste style', 'Ctrl+Alt+C · V'],
    ['Zoom in / out / fit', 'Ctrl+ + · − · 0'], ['Zoom with mouse', 'Ctrl + wheel'], ['Pan', 'Space + drag · wheel'], ['Previous / next page', 'PgUp · PgDn'],
    ['Snap off while dragging', 'hold Alt'], ['Save now', 'Ctrl+S'], ['Deselect / stop drawing', 'Esc']];
  m.append(h('h3', {}, 'Keyboard shortcuts'), h('p', {}, 'Cmd instead of Ctrl on a Mac. ', h('a', { href: 'easel-guide.html', target: '_blank', style: { color: 'var(--accent-ink)' } }, 'Open the full guide →')),
    h('div', { class: 'keys' }, ...rows.flatMap(([a, b]) => [h('span', {}, a), h('span', {}, h('kbd', {}, b))])),
    h('div', { class: 'actions' }, h('button', { class: 'btn pri', onclick: () => close() }, 'Got it')));
}, { width: 520 });

/* ── resize ── */
EZ.showResize = () => EZ.modal((m, close) => {
  let sel = null;
  const w = h('input', { class: 'inp', type: 'number', value: EZ.W(), style: { width: '100px' } });
  const hh = h('input', { class: 'inp', type: 'number', value: EZ.H(), style: { width: '100px' } });
  const unit = h('select', { class: 'sel', style: { width: '80px' } }, ...['px', 'mm', 'cm', 'in'].map(u => h('option', {}, u)));
  const scale = h('input', { type: 'checkbox', checked: true });
  const grid = h('div', { class: 'grid g2', style: { maxHeight: '260px', overflowY: 'auto', marginBottom: '14px' } });
  EZ.PRESETS.forEach(p => grid.append(h('button', {
    class: 'layer', style: { margin: 0 },
    onclick: e => { sel = p; $$('.layer', grid).forEach(b => b.classList.remove('on')); e.currentTarget.classList.add('on'); unit.value = p.mm ? 'mm' : 'px'; w.value = p.mm ? p.mm[0] : p.w; hh.value = p.mm ? p.mm[1] : p.h; },
  }, h('div', { class: 'ln' }, p.name, h('small', {}, p.sub)))));
  [w, hh, unit].forEach(el => el.addEventListener('input', () => { sel = null; $$('.layer', grid).forEach(b => b.classList.remove('on')); }));
  const result = copy => {
    const u = unit.value, f = EZ.UNIT_PX[u];
    const W = Math.round(+w.value * f), H = Math.round(+hh.value * f);
    if (!(W >= 16 && H >= 16 && W <= 12000 && H <= 12000)) { EZ.toast('Size must be between 16 and 12000 px', { err: true }); return; }
    close({ W, H, mm: u === 'px' ? null : [+w.value * f / EZ.UNIT_PX.mm, +hh.value * f / EZ.UNIT_PX.mm].map(v => EZ.round(v, 1)), scale: scale.checked, copy });
  };
  m.append(h('h3', {}, 'Resize design'), h('p', {}, `Currently ${EZ.W()} × ${EZ.H()} px${EZ.doc.mm ? ' (' + EZ.doc.mm.join(' × ') + ' mm)' : ''}.`), grid,
    h('div', { class: 'row', style: { flexWrap: 'wrap' } }, w, h('span', {}, '×'), hh, unit),
    h('label', { class: 'row', style: { marginTop: '12px', fontWeight: 600 } }, scale, 'Scale the content to fit the new size'),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => close() }, 'Cancel'),
      h('button', { class: 'btn', onclick: () => result(true) }, 'Copy & resize'),
      h('button', { class: 'btn pri', onclick: () => result(false) }, 'Resize')));
}, { width: 520 }).then(r => r && EZ.resizeDesign(r));
EZ.resizeDesign = async ({ W, H, mm, scale, copy }) => {
  EZ.storePage();
  const d = EZ.doc;
  const pages = d.pages.map(p => ({ id: 'p' + EZ.uid(), json: scale ? EZ.scaleJSON(p.json, d.w, d.h, W, H) : EZ.scaleJSON(p.json, d.w, d.h, d.w, d.h) }));
  pages.forEach(p => { const bg = p.json.objects.find(o => o.name === '__bg'); if (bg) Object.assign(bg, { width: W, height: H }); });
  if (copy) { await EZ.createDesign({ name: d.name + ` (${mm ? mm.join('×') + ' mm' : W + '×' + H})`, w: W, h: H, mm, pages: pages.map(p => p.json) }); return; }
  d.w = W; d.h = H; d.mm = mm;
  d.pages = pages;
  EZ.pageIndex = -1;
  await EZ.gotoPage(0, { force: true });
  EZ.fit();
  EZ.changed();
  d.pages.forEach(async (p, i) => { p.thumb = await EZ.pageThumb(p.json); if (i === d.pages.length - 1) EZ.renderPages(); });
};

/* ── file menu ── */
EZ.fileMenu = anchor => EZ.menu(anchor, [
  { label: 'Create new design', icon: 'plus', run: () => EZ.showHome() },
  { label: 'Make a copy', icon: 'copy', run: () => EZ.copyDesign() },
  { label: 'Save now', icon: 'save', kbd: 'Ctrl+S', run: () => EZ.saveNow(true) },
  { label: 'Version history…', icon: 'history', run: () => EZ.showVersions() },
  { label: 'Share…', icon: 'share-2', run: () => EZ.showShare() },
  '-',
  { label: 'Download project file (.easel)', icon: 'file-down', run: () => EZ.exportProject() },
  { label: 'Open project file…', icon: 'folder-open', run: () => $('#projIn').click() },
  '-',
  { label: 'Resize design…', icon: 'scaling', run: () => EZ.showResize() },
  { label: 'Keyboard shortcuts', icon: 'keyboard', kbd: '?', run: () => EZ.showShortcuts() },
  { label: 'Guide', icon: 'book-open', run: () => window.open('easel-guide.html', '_blank', 'noopener') },
  EZ.cloud.state.owner
    ? { label: 'Sign out', icon: 'log-out', run: async () => { await EZ.cloud.signOut(); EZ.toast('Signed out — designs stay on this device'); } }
    : { label: 'Owner sign-in (sync)', icon: 'user', run: () => EZ.showLogin() },
  '-',
  { label: 'Delete this design', icon: 'trash-2', run: () => EZ.deleteCurrentDesign() },
]);
})();
