/* QR Studio · charts.js
   Small SVG charts for the statistics tab. One accent colour (the data is always
   one series), thin marks, hairline grid, hover tooltips on every mark, and a
   table twin for every chart so no value is locked behind a hover. */
(function () {
  'use strict';
  const QS = (window.QS = window.QS || {});
  const U = QS.util;

  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const theme = () => ({
    accent: css('--accent') || '#e8ff00',
    surface: css('--panel') || '#141414',
    ink: css('--text') || '#f0f0f0',
    muted: css('--muted-2') || '#9a9a93',
    grid: css('--border') || '#2a2a2a'
  });
  const fmtInt = n => Number(n || 0).toLocaleString();
  const esc = U.esc;

  function tooltip(container) {
    let tip = container.querySelector('.chart-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'chart-tip';
      tip.setAttribute('role', 'status');
      container.appendChild(tip);
    }
    return {
      show(html, x, y) {
        tip.innerHTML = html;
        tip.classList.add('on');
        const w = container.clientWidth;
        tip.style.left = Math.max(6, Math.min(w - tip.offsetWidth - 6, x - tip.offsetWidth / 2)) + 'px';
        tip.style.top = Math.max(0, y - tip.offsetHeight - 10) + 'px';
      },
      hide() { tip.classList.remove('on'); }
    };
  }

  /* ── daily columns: one series over time ── */
  function columns(container, opts) {
    const rows = opts.rows || [];
    const t = theme();
    const W = 720, H = opts.height || 190, padL = 34, padR = 8, padT = 12, padB = 24;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const max = Math.max(1, ...rows.map(r => r.value));
    const ticks = niceTicks(max, 3);
    const top = ticks[ticks.length - 1];
    const slot = plotW / Math.max(1, rows.length);
    const barW = Math.min(24, Math.max(2, slot - 2));
    const x = i => padL + slot * i + (slot - barW) / 2;
    const y = v => padT + plotH - (v / top) * plotH;

    let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="${esc(opts.label || 'Scans per day')}">`;
    ticks.forEach(v => {
      svg += `<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W - padR}" y2="${y(v).toFixed(1)}" stroke="${t.grid}" stroke-width="1"/>`;
      svg += `<text x="${padL - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end" fill="${t.muted}" font-size="10">${fmtInt(v)}</text>`;
    });
    rows.forEach((r, i) => {
      const h = Math.max(r.value > 0 ? 2 : 0, ((r.value / top) * plotH));
      if (h > 0) {
        const rad = Math.min(4, barW / 2, h);
        svg += `<path d="M${x(i)} ${(padT + plotH).toFixed(1)} V${(y(r.value) + rad).toFixed(1)} a${rad} ${rad} 0 0 1 ${rad} ${-rad} h${(barW - 2 * rad).toFixed(1)} a${rad} ${rad} 0 0 1 ${rad} ${rad} V${(padT + plotH).toFixed(1)} Z" fill="${t.accent}"/>`;
      }
    });
    /* labels: first, last and a few in between, never every column */
    const step = Math.max(1, Math.round(rows.length / 6));
    rows.forEach((r, i) => {
      if (i % step !== 0 && i !== rows.length - 1) return;
      svg += `<text x="${(x(i) + barW / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="${t.muted}" font-size="10">${esc(r.short || r.label)}</text>`;
    });
    svg += `<line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="${t.grid}" stroke-width="1"/>`;
    rows.forEach((r, i) => {
      svg += `<rect class="hit" data-i="${i}" x="${(padL + slot * i).toFixed(1)}" y="${padT}" width="${slot.toFixed(1)}" height="${plotH}" fill="transparent"/>`;
    });
    svg += '</svg>';
    container.innerHTML = svg;
    const tip = tooltip(container);
    const svgEl = container.querySelector('svg');
    svgEl.addEventListener('pointermove', ev => {
      const hit = ev.target.closest('.hit');
      if (!hit) return tip.hide();
      const r = rows[Number(hit.dataset.i)];
      const box = container.getBoundingClientRect();
      tip.show(`<b>${fmtInt(r.value)}</b> ${esc(opts.unit || 'scans')}` +
        (r.extra != null ? `<span class="tip-sub">${fmtInt(r.extra)} ${esc(opts.extraUnit || 'unique')}</span>` : '') +
        `<span class="tip-sub">${esc(r.label)}</span>`,
        ev.clientX - box.left, ev.clientY - box.top);
    });
    svgEl.addEventListener('pointerleave', tip.hide);
  }

  /* ── ranked horizontal bars ── */
  function bars(container, opts) {
    const rows = (opts.rows || []).slice(0, opts.limit || 10);
    if (!rows.length) {
      container.innerHTML = `<p class="chart-empty">${esc(opts.empty || 'No data yet.')}</p>`;
      return;
    }
    const t = theme();
    const max = Math.max(1, ...rows.map(r => r.value));
    const total = rows.reduce((a, r) => a + r.value, 0);
    let html = '<div class="bars">';
    rows.forEach(r => {
      const pct = (r.value / max) * 100;
      const dim = opts.emphasis ? !opts.emphasis(r) : false;
      html += `<div class="bar-row${dim ? ' dim' : ''}" title="${esc(r.label)}: ${fmtInt(r.value)}">` +
        `<span class="bar-label">${r.icon ? r.icon + ' ' : ''}${esc(r.label)}</span>` +
        `<span class="bar-track"><span class="bar-fill" style="width:${pct.toFixed(1)}%"></span></span>` +
        `<span class="bar-value">${fmtInt(r.value)}${opts.share && total ? ` <i>${Math.round((r.value / total) * 100)}%</i>` : ''}</span>` +
        `</div>`;
    });
    html += '</div>';
    container.innerHTML = html;
  }

  /* ── weekday × hour heatmap, one hue ── */
  function heat(container, opts) {
    const cells = opts.cells || [];
    const t = theme();
    const days = opts.dayNames || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
    let max = 0;
    cells.forEach(([d, h, n]) => {
      if (d >= 1 && d <= 7 && h >= 0 && h < 24) { grid[d - 1][h] = n; max = Math.max(max, n); }
    });
    const W = 720, cell = 26, labelW = 34, H = 7 * cell + 26;
    const cw = (W - labelW) / 24;
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="Scans by weekday and hour">`;
    for (let d = 0; d < 7; d++) {
      svg += `<text x="${labelW - 8}" y="${d * cell + cell / 2 + 4}" text-anchor="end" fill="${t.muted}" font-size="10">${esc(days[d])}</text>`;
      for (let h = 0; h < 24; h++) {
        const v = grid[d][h];
        const fill = v === 0 ? 'rgba(255,255,255,0.04)' : U.mix(t.surface, t.accent, 0.18 + 0.82 * (v / (max || 1)));
        svg += `<rect class="hit" data-d="${d}" data-h="${h}" data-v="${v}" x="${(labelW + h * cw + 1).toFixed(1)}" y="${d * cell + 1}" width="${(cw - 2).toFixed(1)}" height="${cell - 2}" rx="3" fill="${fill}"/>`;
      }
    }
    for (let h = 0; h < 24; h += 3) {
      svg += `<text x="${(labelW + h * cw + cw / 2).toFixed(1)}" y="${7 * cell + 16}" text-anchor="middle" fill="${t.muted}" font-size="10">${h}</text>`;
    }
    svg += '</svg>';
    container.innerHTML = svg +
      `<div class="heat-legend"><span>less</span>` +
      [0.18, 0.4, 0.6, 0.8, 1].map(s => `<i style="background:${U.mix(t.surface, t.accent, s)}"></i>`).join('') +
      `<span>more · max ${fmtInt(max)}</span></div>`;
    const tip = tooltip(container);
    const svgEl = container.querySelector('svg');
    svgEl.addEventListener('pointermove', ev => {
      const hit = ev.target.closest('.hit');
      if (!hit) return tip.hide();
      const box = container.getBoundingClientRect();
      tip.show(`<b>${fmtInt(hit.dataset.v)}</b> scans<span class="tip-sub">${esc(days[Number(hit.dataset.d)])} ${hit.dataset.h}:00</span>`,
        ev.clientX - box.left, ev.clientY - box.top);
    });
    svgEl.addEventListener('pointerleave', tip.hide);
  }

  /* ── the table twin of any chart ── */
  function table(container, opts) {
    const headers = opts.headers || [];
    const rows = opts.rows || [];
    let html = '<div class="table-wrap"><table class="data-table"><thead><tr>';
    headers.forEach(h => (html += `<th>${esc(h)}</th>`));
    html += '</tr></thead><tbody>';
    rows.forEach(r => {
      html += '<tr>' + r.map(c => `<td>${esc(c)}</td>`).join('') + '</tr>';
    });
    html += '</tbody></table></div>';
    container.innerHTML = html;
  }

  function sparkline(values, { width = 120, height = 28 } = {}) {
    const t = theme();
    const vals = values && values.length ? values : [0];
    const max = Math.max(1, ...vals);
    const step = width / Math.max(1, vals.length - 1);
    const pts = vals.map((v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * (height - 4) - 2).toFixed(1)}`);
    return `<svg viewBox="0 0 ${width} ${height}" class="spark" aria-hidden="true">` +
      `<polyline points="${pts.join(' ')}" fill="none" stroke="${t.accent}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }

  function niceTicks(max, count) {
    const raw = max / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const norm = raw / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    const out = [];
    for (let v = 0; v <= Math.ceil(max / step) * step + 0.0001; v += step) out.push(Math.round(v));
    return out.length > 1 ? out : [0, Math.max(1, max)];
  }

  QS.charts = { columns, bars, heat, table, sparkline, theme };
})();
