/* QR Studio · swissbill.js
   The printable payment part of a Swiss QR-bill: receipt 62 × 105 mm, payment
   part 148 × 105 mm, 5 mm margins, Arial/Helvetica only, headings bold and 2 pt
   smaller than their values — as laid down in the Swiss Implementation
   Guidelines for the QR-bill (v2.4, chapters 3.3–3.6). */
(function () {
  'use strict';
  const QS = (window.QS = window.QS || {});
  const U = QS.util;
  const H = () => QS.formats.helpers;

  const PT = 0.3527777778;                 /* one point in millimetres */
  const esc = s => U.esc(s);

  const LANG = {
    de: {
      receipt: 'Empfangsschein', payment: 'Zahlteil', account: 'Konto / Zahlbar an',
      reference: 'Referenz', additional: 'Zusätzliche Informationen',
      payableBy: 'Zahlbar durch', payableByBlank: 'Zahlbar durch (Name/Adresse)',
      currency: 'Währung', amount: 'Betrag', acceptance: 'Annahmestelle',
      separate: 'Vor der Einzahlung abzutrennen'
    },
    fr: {
      receipt: 'Récépissé', payment: 'Section paiement', account: 'Compte / Payable à',
      reference: 'Référence', additional: 'Informations supplémentaires',
      payableBy: 'Payable par', payableByBlank: 'Payable par (nom/adresse)',
      currency: 'Monnaie', amount: 'Montant', acceptance: 'Point de dépôt',
      separate: 'A détacher avant le versement'
    },
    it: {
      receipt: 'Ricevuta', payment: 'Sezione pagamento', account: 'Conto / Pagabile a',
      reference: 'Riferimento', additional: 'Informazioni supplementari',
      payableBy: 'Pagabile da', payableByBlank: 'Pagabile da (nome/indirizzo)',
      currency: 'Valuta', amount: 'Importo', acceptance: 'Punto di accettazione',
      separate: 'Da staccare prima del versamento'
    },
    en: {
      receipt: 'Receipt', payment: 'Payment part', account: 'Account / Payable to',
      reference: 'Reference', additional: 'Additional information',
      payableBy: 'Payable by', payableByBlank: 'Payable by (name/address)',
      currency: 'Currency', amount: 'Amount', acceptance: 'Acceptance point',
      separate: 'Separate before paying in'
    }
  };

  /* text measuring in millimetres, using the same family the slip prints in */
  let mctx = null;
  function measure(text, sizeMM, bold) {
    if (!mctx) mctx = document.createElement('canvas').getContext('2d');
    mctx.font = `${bold ? 'bold ' : ''}100px Arial, Helvetica, sans-serif`;
    return (mctx.measureText(String(text)).width / 100) * sizeMM;
  }
  function wrap(text, sizeMM, bold, maxMM) {
    const words = String(text == null ? '' : text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (measure(test, sizeMM, bold) > maxMM && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }
  const money = a => {
    const n = Number(a);
    if (!isFinite(n)) return '';
    const [i, f] = n.toFixed(2).split('.');
    return i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + '.' + f;
  };

  /* address block as the standard wants it: name, street + number, zip town */
  function addressLines(v, p) {
    const out = [];
    if (v[p + 'Name']) out.push(v[p + 'Name']);
    const street = [v[p + 'Street'], v[p + 'No']].filter(x => String(x || '').trim()).join(' ');
    if (street) out.push(street);
    const country = String(v[p + 'Country'] || '').toUpperCase();
    const town = [v[p + 'Zip'], v[p + 'Town']].filter(x => String(x || '').trim()).join(' ');
    if (town) out.push((country && country !== 'CH' ? country + '-' : '') + town);
    return out;
  }

  /* one SVG, 210 × 105 mm, ready to print or to place at the bottom of an A4 */
  function slipSVG(values, opts = {}) {
    const L = LANG[opts.lang || values.lang || 'de'] || LANG.de;
    const built = QS.formats.build('swissqr', values);         /* validates, throws on bad input */
    const scene = QS.engine.compose({ text: built.text, swiss: true, forceEC: 'M' }, {
      margin: 0, ec: 'M', dots: { style: 'square' }, eyes: { frame: 'square', ball: 'square' },
      fill: { type: 'solid', color: '#000000' }, bg: { type: 'solid', color: '#ffffff' },
      frame: { style: 'none' }, logo: { src: null, icon: null }
    });
    const qrFragment = QS.engine.toFragment(scene, { id: U.uid('sb') });
    const qrScale = 46 / scene.W;

    const out = [];
    const t = (x, y, str, size, bold, anchor) => {
      if (str == null || str === '') return;
      out.push(`<text x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${(size).toFixed(2)}"` +
        (bold ? ' font-weight="bold"' : '') + (anchor ? ` text-anchor="${anchor}"` : '') +
        ` fill="#000">${esc(str)}</text>`);
    };
    /* heading + wrapped value block; returns the y after the block */
    const block = (x, y, heading, lines, hSize, vSize, width) => {
      t(x, y, heading, hSize, true);
      let yy = y + hSize * 1.25;
      for (const raw of lines) {
        for (const line of wrap(raw, vSize, false, width)) {
          t(x, yy, line, vSize, false);
          yy += vSize * 1.18;
        }
      }
      return yy + vSize * 0.5;
    };
    const cornerBox = (x, y, w, h) => {
      const a = Math.min(3, w / 4, h / 2);
      const s = 0.75 * PT;
      const seg = (x1, y1, x2, y2) => out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="${s}"/>`);
      seg(x, y, x + a, y); seg(x, y, x, y + a);
      seg(x + w - a, y, x + w, y); seg(x + w, y, x + w, y + a);
      seg(x, y + h - a, x, y + h); seg(x, y + h, x + a, y + h);
      seg(x + w, y + h - a, x + w, y + h); seg(x + w - a, y + h, x + w, y + h);
    };

    const iban = H().ibanFormat(values.iban);
    const refType = built.meta.refType;
    const refText = refType === 'QRR' ? H().qrrFormat(built.meta.ref)
      : refType === 'SCOR' ? H().scorFormat(built.meta.ref) : '';
    const creditor = addressLines(values, 'c');
    const debtor = addressLines(values, 'd');
    const amount = built.meta.amount ? money(built.meta.amount) : '';
    const ccy = built.meta.ccy;
    const message = [values.message, values.billing].filter(x => String(x || '').trim()).join('\n');

    /* sizes in millimetres: 11 pt title, 6/8 pt on the receipt, 8/10 pt on the payment part */
    const T11 = 11 * PT, T6 = 6 * PT, T8 = 8 * PT, T10 = 10 * PT;

    /* ── receipt (0 … 62 mm) ── */
    t(5, 5 + T11, L.receipt, T11, true);
    let y = 17;
    y = block(5, y, L.account, [iban, ...creditor], T6, T8, 52);
    if (refText) y = block(5, y, L.reference, [refText], T6, T8, 52);
    if (debtor.length) {
      y = block(5, y, L.payableBy, debtor, T6, T8, 52);
    } else {
      t(5, y, L.payableByBlank, T6, true);
      cornerBox(5, y + 2, 52, 20);
      y += 24;
    }
    t(5, 71, L.currency, T6, true);
    t(20, 71, L.amount, T6, true);
    t(5, 74.5, ccy, T8, false);
    if (amount) t(20, 74.5, amount, T8, false);
    else cornerBox(20, 68.5, 30, 10);
    t(57, 86, L.acceptance, T6, true, 'end');

    /* ── payment part (62 … 210 mm) ── */
    t(67, 5 + T11, L.payment, T11, true);
    out.push(`<g transform="translate(67 17) scale(${qrScale})">${qrFragment}</g>`);
    t(67, 71, L.currency, T8, true);
    t(87, 71, L.amount, T8, true);
    t(67, 75.5, ccy, T10, false);
    if (amount) t(87, 75.5, amount, T10, false);
    else cornerBox(87, 68, 40, 15);

    let yy = 10;
    yy = block(118, yy, L.account, [iban, ...creditor], T8, T10, 87);
    if (refText) yy = block(118, yy, L.reference, [refText], T8, T10, 87);
    if (message) yy = block(118, yy, L.additional, message.split('\n'), T8, T10, 87);
    if (debtor.length) {
      yy = block(118, yy, L.payableBy, debtor, T8, T10, 87);
    } else {
      t(118, yy, L.payableByBlank, T8, true);
      cornerBox(118, yy + 2, 65, 25);
      yy += 29;
    }
    if (values.alt1) t(67, 95, values.alt1, 7 * PT, false);
    if (values.alt2) t(67, 98.5, values.alt2, 7 * PT, false);

    /* separation lines with the scissors hint, drawn outside the payment part */
    const cut = opts.withCutLines === false ? '' :
      `<line x1="0" y1="0" x2="210" y2="0" stroke="#000" stroke-width="${0.5 * PT}" stroke-dasharray="2 2"/>` +
      `<line x1="62" y1="0" x2="62" y2="105" stroke="#000" stroke-width="${0.5 * PT}" stroke-dasharray="2 2"/>` +
      `<text x="105" y="-1.5" font-family="Arial, Helvetica, sans-serif" font-size="${(7 * PT).toFixed(2)}" text-anchor="middle" fill="#000">${esc(L.separate)}</text>`;

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -4 210 109" width="210mm" height="109mm">` +
      `<rect x="0" y="-4" width="210" height="109" fill="#ffffff"/>` + cut + out.join('') + `</svg>`;
  }

  async function slipPDF(values, opts = {}) {
    const svg = slipSVG(values, opts);
    await U.loadScript(QS.CDN.jspdf);
    await U.loadScript(QS.CDN.svg2pdf);
    const jsPDFCtor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    const a4 = opts.a4 !== false;
    const doc = new jsPDFCtor({ unit: 'mm', format: a4 ? 'a4' : [210, 109], orientation: a4 ? 'portrait' : 'landscape' });
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-10000px;top:0;opacity:0';
    holder.innerHTML = svg;
    document.body.appendChild(holder);
    try {
      const el = holder.querySelector('svg');
      const y = a4 ? 297 - 105 : 4;                 /* the slip sits at the foot of the page */
      if (typeof doc.svg === 'function') await doc.svg(el, { x: 0, y: y - 4, width: 210, height: 109 });
      else await window.svg2pdf.svg2pdf(el, doc, { x: 0, y: y - 4, width: 210, height: 109 });
      doc.setProperties({ title: 'QR-bill' });
      return doc.output('blob');
    } finally {
      holder.remove();
    }
  }

  QS.swissbill = { slipSVG, slipPDF, LANG, money };
})();
