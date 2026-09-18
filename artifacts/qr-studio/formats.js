/* QR Studio · formats.js
   Every content type: the form it shows, the exact string it encodes, and the
   validation that stops a code from being printed wrong. Payment formats follow
   their specs (Swiss QR-bill IG 2.4, EPC069-12 v3.1, BIP21, EIP-681, Solana Pay). */
(function () {
  'use strict';
  const QS = (window.QS = window.QS || {});
  const U = QS.util;

  /* ── escaping helpers, one per format family ── */
  const vEsc = s => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const mEsc = s => String(s == null ? '' : s).replace(/([\\;:,])/g, '\\$1');
  const wEsc = s => String(s == null ? '' : s).replace(/([\\;,:"])/g, '\\$1');
  const iEsc = s => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const digits = s => String(s || '').replace(/[^\d]/g, '');
  const phone = s => String(s || '').replace(/[^\d+]/g, '');
  const trim = s => String(s == null ? '' : s).trim();
  const has = s => trim(s) !== '';

  function withScheme(url) {
    const v = trim(url);
    if (!v) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return v;
    return 'https://' + v.replace(/^\/+/, '');
  }
  function addParams(url, params) {
    const clean = Object.entries(params).filter(([, v]) => has(v));
    if (!clean.length) return url;
    const u = url + (url.includes('?') ? '&' : '?');
    return u + clean.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(trim(v))).join('&');
  }
  const fail = msg => { throw new Error(msg); };

  /* ── IBAN / reference maths (Swiss QR-bill + SEPA) ── */
  const ibanClean = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  function mod97(str) {
    let rem = 0;
    for (const ch of str) {
      const v = /[0-9]/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
      for (const d of v) rem = (rem * 10 + Number(d)) % 97;
    }
    return rem;
  }
  function ibanValid(iban) {
    const v = ibanClean(iban);
    if (v.length < 15 || v.length > 34 || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(v)) return false;
    return mod97(v.slice(4) + v.slice(0, 4)) === 1;
  }
  const ibanFormat = iban => ibanClean(iban).replace(/(.{4})/g, '$1 ').trim();
  /* Swiss QR-IBANs carry an institution id between 30000 and 31999 */
  function isQrIban(iban) {
    const v = ibanClean(iban);
    if (!/^(CH|LI)/.test(v) || v.length !== 21) return false;
    const iid = Number(v.slice(4, 9));
    return iid >= 30000 && iid <= 31999;
  }
  const MOD10 = [
    [0, 9, 4, 6, 8, 2, 7, 1, 3, 5], [9, 4, 6, 8, 2, 7, 1, 3, 5, 0], [4, 6, 8, 2, 7, 1, 3, 5, 0, 9],
    [6, 8, 2, 7, 1, 3, 5, 0, 9, 4], [8, 2, 7, 1, 3, 5, 0, 9, 4, 6], [2, 7, 1, 3, 5, 0, 9, 4, 6, 8],
    [7, 1, 3, 5, 0, 9, 4, 6, 8, 2], [1, 3, 5, 0, 9, 4, 6, 8, 2, 7], [3, 5, 0, 9, 4, 6, 8, 2, 7, 1],
    [5, 0, 9, 4, 6, 8, 2, 7, 1, 3]
  ];
  function mod10Check(numStr) {
    let carry = 0;
    for (const ch of String(numStr).replace(/\D/g, '')) carry = MOD10[carry][Number(ch)];
    return (10 - carry) % 10;
  }
  /* 27-digit QR reference: right-aligned, zero padded, check digit last */
  function qrrFrom(base) {
    const b = String(base || '').replace(/\D/g, '').slice(0, 26).padStart(26, '0');
    return b + mod10Check(b);
  }
  const qrrValid = ref => {
    const v = String(ref || '').replace(/\s/g, '');
    return /^\d{27}$/.test(v) && mod10Check(v.slice(0, 26)) === Number(v[26]);
  };
  const qrrFormat = ref => {
    const v = String(ref || '').replace(/\s/g, '');
    return v.length === 27 ? v.slice(0, 2) + ' ' + v.slice(2).replace(/(.{5})/g, '$1 ').trim() : v;
  };
  /* ISO 11649 creditor reference: RF + two check digits */
  function scorFrom(base) {
    const b = String(base || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 21);
    if (!b) return '';
    const check = 98 - mod97(b + 'RF00');
    return 'RF' + String(check).padStart(2, '0') + b;
  }
  const scorValid = ref => {
    const v = String(ref || '').toUpperCase().replace(/\s/g, '');
    return /^RF\d{2}[A-Z0-9]{1,21}$/.test(v) && mod97(v.slice(4) + v.slice(0, 4)) === 1;
  };
  const scorFormat = ref => String(ref || '').replace(/\s/g, '').replace(/(.{4})/g, '$1 ').trim();

  function amountStr(v) {
    const n = Number(String(v).replace(',', '.'));
    if (!isFinite(n) || n <= 0) return '';
    return n.toFixed(2);
  }

  /* Swiss QR codes only accept Latin-1/Latin Extended A plus a few extras */
  const SWISS_OK = /^[\u0020-\u007E\u00A0-\u00FF\u0100-\u017F\u0218\u0219\u021A\u021B\u20AC\r\n]*$/;

  /* ── builders ── */
  function buildVCard(v) {
    const first = trim(v.first), last = trim(v.last);
    if (!first && !last && !has(v.org)) fail('Give at least a name or a company.');
    const L = ['BEGIN:VCARD', 'VERSION:3.0'];
    L.push(`N:${vEsc(last)};${vEsc(first)};;${vEsc(v.prefix)};`);
    L.push(`FN:${vEsc([first, last].filter(Boolean).join(' ') || trim(v.org))}`);
    if (has(v.org)) L.push(`ORG:${vEsc(v.org)}${has(v.dept) ? ';' + vEsc(v.dept) : ''}`);
    if (has(v.title)) L.push(`TITLE:${vEsc(v.title)}`);
    if (has(v.mobile)) L.push(`TEL;TYPE=CELL:${phone(v.mobile)}`);
    if (has(v.work)) L.push(`TEL;TYPE=WORK,VOICE:${phone(v.work)}`);
    if (has(v.home)) L.push(`TEL;TYPE=HOME,VOICE:${phone(v.home)}`);
    if (has(v.email)) L.push(`EMAIL;TYPE=INTERNET:${vEsc(v.email)}`);
    if (has(v.email2)) L.push(`EMAIL;TYPE=INTERNET,WORK:${vEsc(v.email2)}`);
    if (has(v.website)) L.push(`URL:${vEsc(withScheme(v.website))}`);
    if (has(v.street) || has(v.city) || has(v.zip) || has(v.country)) {
      L.push(`ADR;TYPE=WORK:;;${vEsc(v.street)};${vEsc(v.city)};${vEsc(v.region)};${vEsc(v.zip)};${vEsc(v.country)}`);
    }
    if (has(v.bday)) L.push(`BDAY:${trim(v.bday)}`);
    if (has(v.note)) L.push(`NOTE:${vEsc(v.note)}`);
    L.push('END:VCARD');
    return L.join('\r\n');
  }
  function buildMeCard(v) {
    const parts = [];
    const name = [trim(v.last), trim(v.first)].filter(Boolean).join(',');
    if (name) parts.push('N:' + mEsc(name));
    [v.mobile, v.work, v.home].filter(has).forEach(t => parts.push('TEL:' + phone(t)));
    [v.email, v.email2].filter(has).forEach(e => parts.push('EMAIL:' + mEsc(e)));
    if (has(v.website)) parts.push('URL:' + mEsc(withScheme(v.website)));
    if (has(v.org)) parts.push('ORG:' + mEsc(v.org));
    const adr = [v.street, v.city, v.region, v.zip, v.country].map(x => mEsc(trim(x))).join(',');
    if (adr.replace(/,/g, '')) parts.push('ADR:' + adr);
    if (has(v.bday)) parts.push('BDAY:' + trim(v.bday).replace(/-/g, ''));
    if (has(v.note)) parts.push('NOTE:' + mEsc(v.note));
    return 'MECARD:' + parts.join(';') + ';;';
  }
  function icalStamp(local, allDay) {
    if (!local) return '';
    if (allDay) return String(local).slice(0, 10).replace(/-/g, '');
    const d = new Date(local);
    if (isNaN(d)) return '';
    const p = n => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  }
  function buildEvent(v) {
    if (!has(v.title)) fail('The event needs a title.');
    if (!has(v.start)) fail('Pick a start date.');
    const allDay = !!v.allDay;
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//QR Studio//dump.yanikroesti.ch//EN', 'BEGIN:VEVENT'];
    L.push('SUMMARY:' + iEsc(v.title));
    L.push(allDay ? 'DTSTART;VALUE=DATE:' + icalStamp(v.start, true) : 'DTSTART:' + icalStamp(v.start));
    if (has(v.end)) L.push(allDay ? 'DTEND;VALUE=DATE:' + icalStamp(v.end, true) : 'DTEND:' + icalStamp(v.end));
    if (has(v.location)) L.push('LOCATION:' + iEsc(v.location));
    if (has(v.description)) L.push('DESCRIPTION:' + iEsc(v.description));
    if (has(v.url)) L.push('URL:' + withScheme(v.url));
    if (has(v.repeat) && v.repeat !== 'none') L.push('RRULE:FREQ=' + trim(v.repeat).toUpperCase());
    if (has(v.alarm) && v.alarm !== 'none') {
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + iEsc(v.title), 'TRIGGER:-PT' + trim(v.alarm), 'END:VALARM');
    }
    L.push('END:VEVENT', 'END:VCALENDAR');
    return L.join('\n');
  }
  function buildWifi(v) {
    if (!has(v.ssid)) fail('The network name (SSID) is required.');
    const sec = v.security || 'WPA';
    const parts = ['WIFI:'];
    parts.push('T:' + (sec === 'none' ? 'nopass' : sec) + ';');
    parts.push('S:' + wEsc(v.ssid) + ';');
    if (sec !== 'none') parts.push('P:' + wEsc(v.password) + ';');
    if (sec === 'WPA2-EAP') {
      if (has(v.eap)) parts.push('E:' + wEsc(v.eap) + ';');
      if (has(v.identity)) parts.push('I:' + wEsc(v.identity) + ';');
      if (has(v.anon)) parts.push('A:' + wEsc(v.anon) + ';');
      if (has(v.phase2)) parts.push('PH2:' + wEsc(v.phase2) + ';');
    }
    if (v.hidden) parts.push('H:true;');
    return parts.join('') + ';';
  }
  function buildSwiss(v) {
    const iban = ibanClean(v.iban);
    if (!iban) fail('Enter the IBAN or QR-IBAN of the account.');
    if (!/^(CH|LI)/.test(iban)) fail('A Swiss QR-bill only accepts Swiss or Liechtenstein IBANs (CH…/LI…).');
    if (iban.length !== 21 || !ibanValid(iban)) fail('That IBAN is not valid — check the digits.');
    if (!has(v.cName)) fail('Enter the account holder (Payable to).');
    if (!has(v.cZip) || !has(v.cTown)) fail('Postcode and town of the account holder are required (structured address).');
    const qrIban = isQrIban(iban);
    let refType = v.refType || (qrIban ? 'QRR' : 'NON');
    if (qrIban && refType !== 'QRR') refType = 'QRR';
    if (!qrIban && refType === 'QRR') fail('A QR reference (QRR) only works with a QR-IBAN. Use SCOR or no reference.');
    let ref = trim(v.reference).replace(/\s/g, '');
    if (refType === 'QRR') {
      if (!ref) fail('This is a QR-IBAN, so a 27-digit QR reference is required.');
      if (/^\d{1,26}$/.test(ref)) ref = qrrFrom(ref);          /* complete it for them */
      if (!qrrValid(ref)) fail('The QR reference is not valid (27 digits with a modulo-10 check digit).');
    } else if (refType === 'SCOR') {
      if (ref && !/^RF/i.test(ref)) ref = scorFrom(ref);
      if (ref && !scorValid(ref)) fail('The creditor reference (ISO 11649) is not valid.');
    } else ref = '';
    const amount = has(v.amount) ? amountStr(v.amount) : '';
    if (has(v.amount) && !amount) fail('The amount must be a number between 0.01 and 999 999 999.99.');
    if (amount && Number(amount) > 999999999.99) fail('The amount is above the maximum of 999 999 999.99.');
    const ccy = (v.currency || 'CHF').toUpperCase();
    const msg = trim(v.message), bill = trim(v.billing);
    if ((msg + bill).length > 140) fail('Message and billing information together may not exceed 140 characters.');
    const dbtr = has(v.dName);
    if (dbtr && (!has(v.dZip) || !has(v.dTown))) fail('If you fill in the debtor, postcode and town are required too.');

    const L = [
      'SPC', '0200', '1', iban,
      'S', trim(v.cName), trim(v.cStreet), trim(v.cNo), trim(v.cZip), trim(v.cTown), (trim(v.cCountry) || 'CH').toUpperCase(),
      '', '', '', '', '', '', '',                       /* ultimate creditor: must stay empty */
      amount, ccy,
      dbtr ? 'S' : '', dbtr ? trim(v.dName) : '', dbtr ? trim(v.dStreet) : '', dbtr ? trim(v.dNo) : '',
      dbtr ? trim(v.dZip) : '', dbtr ? trim(v.dTown) : '', dbtr ? (trim(v.dCountry) || 'CH').toUpperCase() : '',
      refType, ref, msg, 'EPD'
    ];
    const alt = [trim(v.alt1), trim(v.alt2)].filter(Boolean);
    if (bill || alt.length) L.push(bill);
    alt.forEach(a => L.push(a));
    const text = L.join('\r\n');
    if (!SWISS_OK.test(text)) fail('Only Latin characters are allowed in a Swiss QR-bill (no emoji or special symbols).');
    if (text.length > 997) fail('The QR-bill content is longer than the 997 characters the standard allows.');
    return { text, forceEC: 'M', swiss: true, meta: { refType, ref, iban, amount, ccy } };
  }
  function buildEPC(v) {
    const iban = ibanClean(v.iban);
    if (!has(v.name)) fail('Enter the name of the beneficiary.');
    if (!ibanValid(iban)) fail('That IBAN is not valid.');
    const amount = has(v.amount) ? amountStr(v.amount) : '';
    if (has(v.amount) && !amount) fail('The amount must be a number.');
    const ref = trim(v.reference), text = trim(v.text);
    if (ref && text) fail('Use either a structured reference or a free text — not both.');
    if (ref && !scorValid(ref.replace(/\s/g, ''))) fail('A structured SEPA reference must be a valid RF creditor reference.');
    const lines = [
      'BCD', '002', '1', 'SCT',
      trim(v.bic).toUpperCase(),
      trim(v.name).slice(0, 70),
      iban,
      amount ? 'EUR' + amount : '',
      trim(v.purpose).toUpperCase().slice(0, 4),
      ref.replace(/\s/g, '').slice(0, 35),
      text.slice(0, 140),
      trim(v.note).slice(0, 70)
    ];
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    const out = lines.join('\n');
    if (new TextEncoder().encode(out).length > 331) fail('SEPA QR codes are limited to 331 bytes — shorten the text.');
    return { text: out, forceEC: 'M' };
  }
  /* decimal string → integer string in the smallest unit, without float drift */
  function toUnits(amount, decimals) {
    const s = String(amount).replace(',', '.').trim();
    if (!/^\d*(\.\d*)?$/.test(s) || s === '' || s === '.') return '';
    const [i, f = ''] = s.split('.');
    const frac = (f + '0'.repeat(decimals)).slice(0, decimals);
    return String(BigInt((i || '0') + frac));
  }
  const COINS = {
    btc: { name: 'Bitcoin', scheme: 'bitcoin', amountKey: 'amount', re: /^(bc1[a-z0-9]{20,80}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/ },
    ltc: { name: 'Litecoin', scheme: 'litecoin', amountKey: 'amount', re: /^(ltc1[a-z0-9]{20,80}|[LM3][a-km-zA-HJ-NP-Z1-9]{26,33})$/ },
    doge: { name: 'Dogecoin', scheme: 'dogecoin', amountKey: 'amount', re: /^D[5-9A-HJ-NP-U][1-9A-HJ-NP-Za-km-z]{32}$/ },
    bch: { name: 'Bitcoin Cash', scheme: 'bitcoincash', amountKey: 'amount', re: /^((bitcoincash:)?[qp][a-z0-9]{41}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/ },
    xmr: { name: 'Monero', scheme: 'monero', amountKey: 'tx_amount', re: /^4[0-9AB][1-9A-HJ-NP-Za-km-z]{93}$/ },
    eth: { name: 'Ethereum', scheme: 'ethereum', evm: true, re: /^0x[a-fA-F0-9]{40}$/ },
    sol: { name: 'Solana', scheme: 'solana', amountKey: 'amount', re: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ },
    ln: { name: 'Lightning invoice', scheme: 'lightning', raw: true }
  };
  function buildCrypto(v) {
    const coin = COINS[v.coin] || COINS.btc;
    const addr = trim(v.address);
    if (!addr) fail('Paste the wallet address.');
    if (coin.re && !coin.re.test(addr.replace(/^bitcoincash:/, ''))) {
      fail('That does not look like a valid ' + coin.name + ' address — double-check it.');
    }
    if (v.addressOnly) return { text: addr };
    if (coin.raw) return { text: (/^lightning:/i.test(addr) ? addr : 'lightning:' + addr) };
    if (coin.evm) {
      const chain = trim(v.chain) || '1';
      if (has(v.token)) {
        const dec = Number(v.tokenDecimals || 6);
        const units = has(v.amount) ? toUnits(v.amount, dec) : '';
        let url = `ethereum:${trim(v.token)}@${chain}/transfer?address=${addr}`;
        if (units) url += `&uint256=${units}`;
        return { text: url };
      }
      const wei = has(v.amount) ? toUnits(v.amount, 18) : '';
      let url = `ethereum:${addr}@${chain}`;
      if (wei) url += `?value=${wei}`;
      return { text: url };
    }
    const params = {};
    if (has(v.amount)) params[coin.amountKey] = String(v.amount).replace(',', '.');
    if (has(v.label)) params[coin.scheme === 'monero' ? 'recipient_name' : 'label'] = v.label;
    if (has(v.message)) params[coin.scheme === 'monero' ? 'tx_description' : 'message'] = v.message;
    if (coin.scheme === 'solana' && has(v.splToken)) params['spl-token'] = trim(v.splToken);
    return { text: addParams(`${coin.scheme}:${addr}`, params) };
  }

  const SOCIAL = {
    instagram: { name: 'Instagram', url: h => 'https://instagram.com/' + h.replace(/^@/, ''), icon: 'instagram', color: '#E4405F' },
    tiktok: { name: 'TikTok', url: h => 'https://www.tiktok.com/@' + h.replace(/^@/, ''), icon: 'tiktok', color: '#000000' },
    youtube: { name: 'YouTube', url: h => (/^(UC|@)/.test(h) ? 'https://youtube.com/' + (h[0] === '@' ? h : 'channel/' + h) : 'https://youtube.com/@' + h), icon: 'youtube', color: '#FF0000' },
    x: { name: 'X / Twitter', url: h => 'https://x.com/' + h.replace(/^@/, ''), icon: 'x', color: '#000000' },
    facebook: { name: 'Facebook', url: h => 'https://facebook.com/' + h, icon: 'facebook', color: '#0866FF' },
    linkedin: { name: 'LinkedIn', url: h => 'https://www.linkedin.com/in/' + h, icon: 'linkedin', color: '#0A66C2' },
    linkedincompany: { name: 'LinkedIn company', url: h => 'https://www.linkedin.com/company/' + h, icon: 'linkedin', color: '#0A66C2' },
    snapchat: { name: 'Snapchat', url: h => 'https://www.snapchat.com/add/' + h, icon: 'snapchat', color: '#FFFC00' },
    pinterest: { name: 'Pinterest', url: h => 'https://pinterest.com/' + h, icon: 'pinterest', color: '#BD081C' },
    threads: { name: 'Threads', url: h => 'https://www.threads.net/@' + h.replace(/^@/, ''), icon: 'threads', color: '#000000' },
    twitch: { name: 'Twitch', url: h => 'https://twitch.tv/' + h, icon: 'twitch', color: '#9146FF' },
    discord: { name: 'Discord invite', url: h => 'https://discord.gg/' + h.replace(/^.*discord\.gg\//, ''), icon: 'discord', color: '#5865F2' },
    reddit: { name: 'Reddit', url: h => (h.startsWith('r/') ? 'https://reddit.com/' + h : 'https://reddit.com/user/' + h), icon: 'reddit', color: '#FF4500' },
    github: { name: 'GitHub', url: h => 'https://github.com/' + h, icon: 'github', color: '#181717' },
    telegram: { name: 'Telegram', url: h => 'https://t.me/' + h.replace(/^@/, ''), icon: 'telegram', color: '#26A5E4' },
    signal: { name: 'Signal', url: h => 'https://signal.me/#p/' + phone(h), icon: 'signal', color: '#3A76F0' },
    threema: { name: 'Threema', url: h => 'https://threema.id/' + h.toUpperCase(), icon: 'threema', color: '#3FE669' },
    whatsappch: { name: 'WhatsApp channel', url: h => 'https://whatsapp.com/channel/' + h, icon: 'whatsapp', color: '#25D366' },
    spotify: { name: 'Spotify', url: h => (/^https?:/.test(h) ? h : 'https://open.spotify.com/user/' + h), icon: 'spotify', color: '#1DB954' },
    soundcloud: { name: 'SoundCloud', url: h => 'https://soundcloud.com/' + h, icon: 'soundcloud', color: '#FF5500' },
    bluesky: { name: 'Bluesky', url: h => 'https://bsky.app/profile/' + h.replace(/^@/, ''), icon: 'bluesky', color: '#0285FF' },
    mastodon: { name: 'Mastodon', url: h => { const m = /^@?([^@]+)@(.+)$/.exec(h.trim()); return m ? `https://${m[2]}/@${m[1]}` : withScheme(h); }, icon: 'mastodon', color: '#6364FF' },
    behance: { name: 'Behance', url: h => 'https://www.behance.net/' + h, icon: 'behance', color: '#1769FF' },
    dribbble: { name: 'Dribbble', url: h => 'https://dribbble.com/' + h, icon: 'dribbble', color: '#EA4C89' },
    vimeo: { name: 'Vimeo', url: h => 'https://vimeo.com/' + h, icon: 'vimeo', color: '#1AB7EA' },
    strava: { name: 'Strava', url: h => 'https://www.strava.com/athletes/' + h, icon: 'strava', color: '#FC4C02' },
    steam: { name: 'Steam', url: h => 'https://steamcommunity.com/id/' + h, icon: 'steam', color: '#000000' }
  };
  const PAYLINKS = {
    paypal: { name: 'PayPal.me', build: (u, a, c) => 'https://paypal.me/' + u.replace(/^@/, '') + (a ? '/' + a + (c || '') : ''), icon: 'paypal', color: '#003087' },
    revolut: { name: 'Revolut.me', build: u => 'https://revolut.me/' + u.replace(/^@/, ''), icon: 'revolut', color: '#000000' },
    venmo: { name: 'Venmo', build: (u, a) => addParams('https://venmo.com/' + u.replace(/^@/, ''), { txn: 'pay', amount: a }), icon: 'venmo', color: '#3D95CE' },
    cashapp: { name: 'Cash App', build: (u, a) => 'https://cash.app/$' + u.replace(/^\$/, '') + (a ? '/' + a : ''), icon: 'cashapp', color: '#00C244' },
    wise: { name: 'Wise', build: u => 'https://wise.com/pay/me/' + u, icon: 'wise', color: '#9FE870' },
    monzo: { name: 'Monzo', build: (u, a) => 'https://monzo.me/' + u + (a ? '/' + a : ''), icon: 'monzo', color: '#14233C' },
    bmc: { name: 'Buy Me a Coffee', build: u => 'https://buymeacoffee.com/' + u, icon: 'buymeacoffee', color: '#FFDD00' },
    kofi: { name: 'Ko-fi', build: u => 'https://ko-fi.com/' + u, icon: 'kofi', color: '#FF5E5B' }
  };

  /* ── the catalogue ── */
  const TYPES = [
    {
      id: 'url', name: 'Website', group: 'Basics', icon: 'link',
      desc: 'Any link. Add campaign tags, or turn it into a short link you can edit later.',
      fields: [
        { k: 'url', label: 'Link', type: 'url', ph: 'https://example.com', required: true, w: 'full' },
        { k: 'utm', label: 'Add campaign tags (UTM)', type: 'checkbox', w: 'full' },
        { k: 'utm_source', label: 'Source', type: 'text', ph: 'flyer', w: 'third', show: v => v.utm },
        { k: 'utm_medium', label: 'Medium', type: 'text', ph: 'print', w: 'third', show: v => v.utm },
        { k: 'utm_campaign', label: 'Campaign', type: 'text', ph: 'spring26', w: 'third', show: v => v.utm },
        { k: 'utm_term', label: 'Term', type: 'text', w: 'half', show: v => v.utm },
        { k: 'utm_content', label: 'Content', type: 'text', w: 'half', show: v => v.utm }
      ],
      build(v) {
        if (!has(v.url)) fail('Enter a link.');
        const base = withScheme(v.url);
        if (!/^https?:\/\/[^\s]+$/i.test(base)) fail('That link does not look right.');
        return { text: v.utm ? addParams(base, { utm_source: v.utm_source, utm_medium: v.utm_medium, utm_campaign: v.utm_campaign, utm_term: v.utm_term, utm_content: v.utm_content }) : base };
      }
    },
    {
      id: 'text', name: 'Plain text', group: 'Basics', icon: 'text',
      desc: 'Any text — a note, a serial number, a machine label.',
      fields: [{ k: 'text', label: 'Text', type: 'textarea', rows: 5, required: true, w: 'full' }],
      build: v => (has(v.text) ? { text: String(v.text) } : fail('Type something first.'))
    },
    {
      id: 'email', name: 'E-mail', group: 'Basics', icon: 'mail',
      desc: 'Opens a new mail with subject and text already filled in.',
      fields: [
        { k: 'to', label: 'To', type: 'email', ph: 'you@example.com', required: true, w: 'half' },
        { k: 'cc', label: 'Cc', type: 'text', w: 'half' },
        { k: 'subject', label: 'Subject', type: 'text', w: 'full' },
        { k: 'body', label: 'Message', type: 'textarea', rows: 4, w: 'full' }
      ],
      build(v) {
        if (!has(v.to)) fail('Enter the address it should mail to.');
        return { text: addParams('mailto:' + trim(v.to), { cc: v.cc, bcc: v.bcc, subject: v.subject, body: v.body }) };
      }
    },
    {
      id: 'phone', name: 'Phone call', group: 'Basics', icon: 'phone',
      desc: 'Starts a call to the number.',
      fields: [{ k: 'number', label: 'Phone number', type: 'tel', ph: '+41 79 123 45 67', required: true, w: 'half' }],
      build: v => (has(v.number) ? { text: 'tel:' + phone(v.number) } : fail('Enter a phone number.'))
    },
    {
      id: 'sms', name: 'SMS', group: 'Basics', icon: 'sms',
      desc: 'Opens a text message with the number and text ready to send.',
      fields: [
        { k: 'number', label: 'Phone number', type: 'tel', ph: '+41 79 123 45 67', required: true, w: 'half' },
        { k: 'message', label: 'Message', type: 'textarea', rows: 3, w: 'full' }
      ],
      build: v => (has(v.number) ? { text: 'SMSTO:' + phone(v.number) + ':' + trim(v.message) } : fail('Enter a phone number.'))
    },
    {
      id: 'whatsapp', name: 'WhatsApp', group: 'Basics', icon: 'whatsapp',
      desc: 'Opens a WhatsApp chat with your number, message pre-typed.',
      logo: { icon: 'whatsapp', color: '#25D366' },
      fields: [
        { k: 'number', label: 'Number with country code', type: 'tel', ph: '+41 79 123 45 67', required: true, w: 'half' },
        { k: 'message', label: 'Pre-filled message', type: 'textarea', rows: 3, w: 'full' }
      ],
      build(v) {
        const n = digits(v.number);
        if (!n) fail('Enter the number including country code.');
        return { text: addParams('https://wa.me/' + n, { text: v.message }) };
      }
    },
    {
      id: 'wifi', name: 'Wi-Fi', group: 'Basics', icon: 'wifi',
      desc: 'Phones join the network from the camera — no typing the password.',
      logo: { icon: 'wifi-glyph', color: '#000000' },
      fields: [
        { k: 'ssid', label: 'Network name (SSID)', type: 'text', required: true, w: 'half' },
        { k: 'security', label: 'Security', type: 'select', w: 'half', options: [
          { v: 'WPA', l: 'WPA / WPA2 / WPA3' }, { v: 'WEP', l: 'WEP (old)' },
          { v: 'none', l: 'Open network' }, { v: 'WPA2-EAP', l: 'WPA2-Enterprise (Android)' }] },
        { k: 'password', label: 'Password', type: 'text', w: 'half', show: v => (v.security || 'WPA') !== 'none' },
        { k: 'hidden', label: 'Hidden network', type: 'checkbox', w: 'half' },
        { k: 'eap', label: 'EAP method', type: 'select', w: 'third', show: v => v.security === 'WPA2-EAP', options: [{ v: 'PEAP', l: 'PEAP' }, { v: 'TTLS', l: 'TTLS' }, { v: 'TLS', l: 'TLS' }, { v: 'PWD', l: 'PWD' }] },
        { k: 'phase2', label: 'Phase 2', type: 'select', w: 'third', show: v => v.security === 'WPA2-EAP', options: [{ v: 'MSCHAPV2', l: 'MSCHAPV2' }, { v: 'PAP', l: 'PAP' }, { v: 'GTC', l: 'GTC' }] },
        { k: 'identity', label: 'Identity', type: 'text', w: 'third', show: v => v.security === 'WPA2-EAP' },
        { k: 'anon', label: 'Anonymous identity', type: 'text', w: 'third', show: v => v.security === 'WPA2-EAP' }
      ],
      build: v => ({ text: buildWifi(v) })
    },
    {
      id: 'location', name: 'Location', group: 'Basics', icon: 'pin',
      desc: 'A point on the map. Search an address or drop in coordinates.',
      fields: [
        { k: 'search', label: 'Find an address', type: 'geosearch', w: 'full', help: 'Searches OpenStreetMap and fills the coordinates.' },
        { k: 'lat', label: 'Latitude', type: 'text', ph: '46.6863', required: true, w: 'third' },
        { k: 'lng', label: 'Longitude', type: 'text', ph: '7.8632', required: true, w: 'third' },
        { k: 'label', label: 'Label', type: 'text', w: 'third' },
        { k: 'format', label: 'Opens with', type: 'select', w: 'half', options: [
          { v: 'gmaps', l: 'Google Maps (works everywhere)' }, { v: 'geo', l: 'geo: — the phone picks the app' },
          { v: 'apple', l: 'Apple Maps' }, { v: 'osm', l: 'OpenStreetMap' }] }
      ],
      build(v) {
        const lat = Number(String(v.lat).replace(',', '.')), lng = Number(String(v.lng).replace(',', '.'));
        if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) fail('Enter valid coordinates (or search an address).');
        const ll = `${lat},${lng}`;
        const f = v.format || 'gmaps';
        if (f === 'geo') return { text: `geo:${ll}` + (has(v.label) ? `?q=${encodeURIComponent(ll + ' (' + trim(v.label) + ')')}` : '') };
        if (f === 'apple') return { text: addParams('https://maps.apple.com/', { ll, q: v.label || 'Pin' }) };
        if (f === 'osm') return { text: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}` };
        return { text: addParams('https://maps.google.com/', { q: ll }) };
      }
    },
    {
      id: 'event', name: 'Calendar event', group: 'Basics', icon: 'calendar',
      desc: 'Adds the event straight into the phone calendar.',
      fields: [
        { k: 'title', label: 'Title', type: 'text', required: true, w: 'full' },
        { k: 'allDay', label: 'All day', type: 'checkbox', w: 'half' },
        { k: 'start', label: 'Starts', type: 'datetime', required: true, w: 'half' },
        { k: 'end', label: 'Ends', type: 'datetime', w: 'half' },
        { k: 'location', label: 'Location', type: 'text', w: 'full' },
        { k: 'description', label: 'Description', type: 'textarea', rows: 3, w: 'full' },
        { k: 'url', label: 'Link', type: 'url', w: 'half' },
        { k: 'repeat', label: 'Repeats', type: 'select', w: 'half', options: [{ v: 'none', l: 'Once' }, { v: 'daily', l: 'Daily' }, { v: 'weekly', l: 'Weekly' }, { v: 'monthly', l: 'Monthly' }, { v: 'yearly', l: 'Yearly' }] },
        { k: 'alarm', label: 'Reminder', type: 'select', w: 'half', options: [{ v: 'none', l: 'None' }, { v: '15M', l: '15 minutes before' }, { v: '1H', l: '1 hour before' }, { v: '1D', l: '1 day before' }] }
      ],
      build: v => ({ text: buildEvent(v) })
    },

    {
      id: 'vcard', name: 'Contact card', group: 'Contact', icon: 'contact',
      desc: 'Saves straight into the phone contacts (vCard or the shorter MeCard).',
      fields: [
        { k: 'format', label: 'Format', type: 'select', w: 'half', options: [{ v: 'vcard', l: 'vCard 3.0 (most compatible)' }, { v: 'mecard', l: 'MeCard (smaller code)' }] },
        { k: 'first', label: 'First name', type: 'text', w: 'half' },
        { k: 'last', label: 'Last name', type: 'text', w: 'half' },
        { k: 'org', label: 'Company', type: 'text', w: 'half' },
        { k: 'title', label: 'Job title', type: 'text', w: 'half' },
        { k: 'mobile', label: 'Mobile', type: 'tel', w: 'third' },
        { k: 'work', label: 'Work phone', type: 'tel', w: 'third' },
        { k: 'home', label: 'Home phone', type: 'tel', w: 'third' },
        { k: 'email', label: 'E-mail', type: 'email', w: 'half' },
        { k: 'email2', label: 'Second e-mail', type: 'email', w: 'half' },
        { k: 'website', label: 'Website', type: 'url', w: 'full' },
        { k: 'street', label: 'Street', type: 'text', w: 'half' },
        { k: 'zip', label: 'Postcode', type: 'text', w: 'third' },
        { k: 'city', label: 'Town', type: 'text', w: 'third' },
        { k: 'region', label: 'Region', type: 'text', w: 'third' },
        { k: 'country', label: 'Country', type: 'text', w: 'third' },
        { k: 'bday', label: 'Birthday', type: 'date', w: 'third' },
        { k: 'note', label: 'Note', type: 'textarea', rows: 2, w: 'full' }
      ],
      build: v => ({ text: v.format === 'mecard' ? buildMeCard(v) : buildVCard(v) })
    },
    {
      id: 'social', name: 'Social profile', group: 'Contact', icon: 'social',
      desc: 'Your handle on any platform — the matching logo is offered automatically.',
      fields: [
        { k: 'platform', label: 'Platform', type: 'select', w: 'half', options: Object.entries(SOCIAL).map(([v, s]) => ({ v, l: s.name })) },
        { k: 'handle', label: 'Handle or link', type: 'text', ph: 'yanikroesti', required: true, w: 'half' }
      ],
      build(v) {
        const s = SOCIAL[v.platform] || SOCIAL.instagram;
        const h = trim(v.handle);
        if (!h) fail('Enter your handle.');
        return { text: /^https?:\/\//i.test(h) ? h : s.url(h), logo: { icon: s.icon, color: s.color } };
      }
    },
    {
      id: 'review', name: 'Review link', group: 'Contact', icon: 'star',
      desc: 'Sends people straight to the review box.',
      fields: [
        { k: 'site', label: 'Platform', type: 'select', w: 'half', options: [
          { v: 'google', l: 'Google review' }, { v: 'trustpilot', l: 'Trustpilot' },
          { v: 'tripadvisor', l: 'Tripadvisor (paste link)' }, { v: 'yelp', l: 'Yelp' }] },
        { k: 'value', label: 'Place ID, domain or link', type: 'text', required: true, w: 'full', help: 'Google: the Place ID of the business. Trustpilot: your domain.' }
      ],
      build(v) {
        const val = trim(v.value);
        if (!val) fail('Enter the place ID or link.');
        if (/^https?:\/\//i.test(val)) return { text: val };
        if (v.site === 'trustpilot') return { text: 'https://www.trustpilot.com/evaluate/' + val };
        if (v.site === 'yelp') return { text: 'https://www.yelp.com/writeareview/biz/' + val };
        if (v.site === 'tripadvisor') fail('Paste the full Tripadvisor link for your place.');
        return { text: 'https://search.google.com/local/writereview?placeid=' + encodeURIComponent(val) };
      }
    },
    {
      id: 'meeting', name: 'Video meeting', group: 'Contact', icon: 'video',
      desc: 'Zoom, Meet, Teams, Webex or Jitsi — joins with one scan.',
      fields: [
        { k: 'service', label: 'Service', type: 'select', w: 'half', options: [
          { v: 'zoom', l: 'Zoom' }, { v: 'meet', l: 'Google Meet' }, { v: 'jitsi', l: 'Jitsi' }, { v: 'link', l: 'Paste a join link' }] },
        { k: 'id', label: 'Meeting ID / room / link', type: 'text', required: true, w: 'half' },
        { k: 'pwd', label: 'Passcode', type: 'text', w: 'half', show: v => v.service === 'zoom' }
      ],
      build(v) {
        const id = trim(v.id);
        if (!id) fail('Enter the meeting ID or link.');
        if (/^https?:\/\//i.test(id)) return { text: id };
        if (v.service === 'meet') return { text: 'https://meet.google.com/' + id };
        if (v.service === 'jitsi') return { text: 'https://meet.jit.si/' + encodeURIComponent(id) };
        if (v.service === 'zoom') return { text: addParams('https://zoom.us/j/' + digits(id), { pwd: v.pwd }) };
        fail('Paste the join link.');
      }
    },
    {
      id: 'applink', name: 'App store link', group: 'Contact', icon: 'app',
      desc: 'One store link. For a code that picks the right store per phone, use the hosted Smart app link.',
      fields: [
        { k: 'store', label: 'Store', type: 'select', w: 'half', options: [{ v: 'ios', l: 'Apple App Store' }, { v: 'android', l: 'Google Play' }] },
        { k: 'value', label: 'App id or link', type: 'text', required: true, w: 'half', ph: 'id6446901002 · ch.admin.bag.dp3t' }
      ],
      build(v) {
        const val = trim(v.value);
        if (!val) fail('Enter the app id or paste the store link.');
        if (/^https?:\/\//i.test(val)) return { text: val };
        return { text: v.store === 'android' ? 'https://play.google.com/store/apps/details?id=' + val : 'https://apps.apple.com/app/' + (val.startsWith('id') ? val : 'id' + digits(val)) };
      }
    },

    {
      id: 'swissqr', name: 'Swiss QR-bill', group: 'Payments', icon: 'swiss',
      desc: 'A real QR-Rechnung: validated IBAN and reference, Swiss cross, and a printable payment part.',
      fields: [
        { k: 'iban', label: 'IBAN or QR-IBAN', type: 'text', ph: 'CH93 0076 2011 6238 5295 7', required: true, w: 'full' },
        { k: 'cName', label: 'Payable to — name', type: 'text', required: true, w: 'full' },
        { k: 'cStreet', label: 'Street', type: 'text', w: 'half' },
        { k: 'cNo', label: 'No.', type: 'text', w: 'third' },
        { k: 'cZip', label: 'Postcode', type: 'text', required: true, w: 'third' },
        { k: 'cTown', label: 'Town', type: 'text', required: true, w: 'third' },
        { k: 'cCountry', label: 'Country', type: 'text', ph: 'CH', w: 'third' },
        { k: 'amount', label: 'Amount', type: 'text', ph: 'leave empty to fill in by hand', w: 'third' },
        { k: 'currency', label: 'Currency', type: 'select', w: 'third', options: [{ v: 'CHF', l: 'CHF' }, { v: 'EUR', l: 'EUR' }] },
        { k: 'refType', label: 'Reference type', type: 'select', w: 'third', options: [
          { v: 'NON', l: 'No reference' }, { v: 'QRR', l: 'QR reference (QR-IBAN)' }, { v: 'SCOR', l: 'Creditor reference RF' }] },
        { k: 'reference', label: 'Reference', type: 'text', w: 'full', help: 'Type the invoice number — the check digit is completed for you.' },
        { k: 'message', label: 'Message to the payer', type: 'text', w: 'full' },
        { k: 'billing', label: 'Billing information', type: 'text', w: 'full', group: 'More' },
        { k: 'dName', label: 'Payable by — name', type: 'text', w: 'full', group: 'More' },
        { k: 'dStreet', label: 'Street', type: 'text', w: 'half', group: 'More' },
        { k: 'dNo', label: 'No.', type: 'text', w: 'third', group: 'More' },
        { k: 'dZip', label: 'Postcode', type: 'text', w: 'third', group: 'More' },
        { k: 'dTown', label: 'Town', type: 'text', w: 'third', group: 'More' },
        { k: 'dCountry', label: 'Country', type: 'text', ph: 'CH', w: 'third', group: 'More' },
        { k: 'lang', label: 'Slip language', type: 'select', w: 'third', group: 'More', options: [
          { v: 'de', l: 'Deutsch' }, { v: 'fr', l: 'Français' }, { v: 'it', l: 'Italiano' }, { v: 'en', l: 'English' }] }
      ],
      build: v => buildSwiss(v)
    },
    {
      id: 'epc', name: 'SEPA payment (EUR)', group: 'Payments', icon: 'bank',
      desc: 'GiroCode / EPC QR — European banking apps fill in the transfer.',
      fields: [
        { k: 'name', label: 'Beneficiary', type: 'text', required: true, w: 'full' },
        { k: 'iban', label: 'IBAN', type: 'text', required: true, w: 'half' },
        { k: 'bic', label: 'BIC (optional)', type: 'text', w: 'half' },
        { k: 'amount', label: 'Amount in EUR', type: 'text', w: 'third' },
        { k: 'purpose', label: 'Purpose code', type: 'text', w: 'third', ph: 'GDDS' },
        { k: 'reference', label: 'Structured reference (RF…)', type: 'text', w: 'full' },
        { k: 'text', label: 'or free text', type: 'text', w: 'full' },
        { k: 'note', label: 'Note to the payer', type: 'text', w: 'full', group: 'More' }
      ],
      build: v => buildEPC(v)
    },
    {
      id: 'crypto', name: 'Crypto payment', group: 'Payments', icon: 'coin',
      desc: 'Wallet URIs that fill in address and amount: BTC, ETH, SOL, XMR, Lightning and more.',
      fields: [
        { k: 'coin', label: 'Coin', type: 'select', w: 'half', options: Object.entries(COINS).map(([v, c]) => ({ v, l: c.name })) },
        { k: 'address', label: 'Address or invoice', type: 'textarea', rows: 2, required: true, w: 'full' },
        { k: 'amount', label: 'Amount', type: 'text', w: 'third', show: v => v.coin !== 'ln' && !v.addressOnly },
        { k: 'chain', label: 'Chain id', type: 'text', ph: '1', w: 'third', show: v => v.coin === 'eth' },
        { k: 'token', label: 'Token contract (ERC-20)', type: 'text', w: 'full', show: v => v.coin === 'eth', group: 'More' },
        { k: 'tokenDecimals', label: 'Token decimals', type: 'number', ph: '6', w: 'third', show: v => v.coin === 'eth', group: 'More' },
        { k: 'splToken', label: 'SPL token mint', type: 'text', w: 'full', show: v => v.coin === 'sol', group: 'More' },
        { k: 'label', label: 'Label', type: 'text', w: 'half', show: v => !v.addressOnly },
        { k: 'message', label: 'Message', type: 'text', w: 'half', show: v => !v.addressOnly },
        { k: 'addressOnly', label: 'Address only (most compatible)', type: 'checkbox', w: 'full' }
      ],
      build: v => buildCrypto(v)
    },
    {
      id: 'paylink', name: 'Payment link', group: 'Payments', icon: 'card',
      desc: 'PayPal.me, Revolut, Twint links, Ko-fi and friends.',
      fields: [
        { k: 'provider', label: 'Provider', type: 'select', w: 'half', options: [...Object.entries(PAYLINKS).map(([v, p]) => ({ v, l: p.name })), { v: 'custom', l: 'Any payment link' }] },
        { k: 'user', label: 'Username or link', type: 'text', required: true, w: 'half' },
        { k: 'amount', label: 'Amount', type: 'text', w: 'third', show: v => ['paypal', 'venmo', 'cashapp', 'monzo'].includes(v.provider) },
        { k: 'currency', label: 'Currency', type: 'text', ph: 'CHF', w: 'third', show: v => v.provider === 'paypal' }
      ],
      build(v) {
        const user = trim(v.user);
        if (!user) fail('Enter your username or paste the link.');
        if (v.provider === 'custom' || /^https?:\/\//i.test(user)) return { text: withScheme(user) };
        const p = PAYLINKS[v.provider] || PAYLINKS.paypal;
        return { text: p.build(user, has(v.amount) ? String(v.amount).replace(',', '.') : '', trim(v.currency).toUpperCase()), logo: { icon: p.icon, color: p.color } };
      }
    },

    {
      id: 'otp', name: '2FA setup code', group: 'Tools', icon: 'shield',
      desc: 'An otpauth:// code that authenticator apps read to add an account.',
      fields: [
        { k: 'issuer', label: 'Service', type: 'text', ph: 'My app', required: true, w: 'half' },
        { k: 'account', label: 'Account', type: 'text', ph: 'you@example.com', required: true, w: 'half' },
        { k: 'secret', label: 'Secret (base32)', type: 'secret', required: true, w: 'full', help: 'Use the dice button to generate a fresh one.' },
        { k: 'algorithm', label: 'Algorithm', type: 'select', w: 'third', options: [{ v: 'SHA1', l: 'SHA1' }, { v: 'SHA256', l: 'SHA256' }, { v: 'SHA512', l: 'SHA512' }] },
        { k: 'digits', label: 'Digits', type: 'select', w: 'third', options: [{ v: '6', l: '6' }, { v: '8', l: '8' }] },
        { k: 'period', label: 'Period (s)', type: 'select', w: 'third', options: [{ v: '30', l: '30' }, { v: '60', l: '60' }] }
      ],
      build(v) {
        const secret = trim(v.secret).toUpperCase().replace(/\s/g, '');
        if (!/^[A-Z2-7]{16,}$/.test(secret)) fail('The secret must be base32 (A–Z and 2–7), at least 16 characters.');
        const label = encodeURIComponent(trim(v.issuer)) + ':' + encodeURIComponent(trim(v.account));
        return {
          text: addParams('otpauth://totp/' + label, {
            secret, issuer: trim(v.issuer), algorithm: v.algorithm || 'SHA1',
            digits: v.digits || '6', period: v.period || '30'
          })
        };
      }
    }
  ];

  /* ── reading a scanned code back into fields ── */
  function parse(text) {
    const t = String(text || '').trim();
    const out = { kind: 'text', label: 'Text', values: { text: t }, typeId: 'text', fields: [] };
    const F = (label, value) => ({ label, value });
    if (/^https?:\/\//i.test(t)) {
      out.kind = 'url'; out.label = 'Website'; out.typeId = 'url'; out.values = { url: t };
      out.fields = [F('Link', t)];
      try {
        const u = new URL(t);
        if (/^dump\.yanikroesti\.ch$/i.test(u.hostname) && /^\/q\//.test(u.pathname)) out.label = 'QR Studio short link';
      } catch (e) { /* ignore */ }
    } else if (/^WIFI:/i.test(t)) {
      const get = k => {
        const m = new RegExp(k + ':((?:\\\\.|[^;])*);', 'i').exec(t);
        return m ? m[1].replace(/\\(.)/g, '$1') : '';
      };
      out.kind = 'wifi'; out.label = 'Wi-Fi network'; out.typeId = 'wifi';
      out.values = { ssid: get('S'), password: get('P'), security: (get('T') || 'WPA').replace('nopass', 'none'), hidden: /H:true/i.test(t) };
      out.fields = [F('Network', out.values.ssid), F('Password', out.values.password), F('Security', get('T') || 'WPA')];
    } else if (/^BEGIN:VCARD/i.test(t)) {
      const line = k => {
        const m = new RegExp('^' + k + '[^:\\r\\n]*:(.*)$', 'im').exec(t);
        return m ? m[1].replace(/\\n/g, '\n').replace(/\\([,;\\])/g, '$1').trim() : '';
      };
      const n = line('N').split(';');
      out.kind = 'vcard'; out.label = 'Contact card'; out.typeId = 'vcard';
      out.values = {
        format: 'vcard', last: n[0] || '', first: n[1] || '', org: line('ORG').split(';')[0],
        title: line('TITLE'), mobile: line('TEL;TYPE=CELL') || line('TEL'), email: line('EMAIL'), website: line('URL'), note: line('NOTE')
      };
      out.fields = [F('Name', line('FN')), F('Company', out.values.org), F('Phone', out.values.mobile), F('E-mail', out.values.email), F('Website', out.values.website)];
    } else if (/^MECARD:/i.test(t)) {
      const get = k => { const m = new RegExp(k + ':((?:\\\\.|[^;])*);', 'i').exec(t); return m ? m[1].replace(/\\(.)/g, '$1') : ''; };
      const name = get('N').split(',');
      out.kind = 'vcard'; out.label = 'Contact (MeCard)'; out.typeId = 'vcard';
      out.values = { format: 'mecard', last: name[0] || '', first: name[1] || '', mobile: get('TEL'), email: get('EMAIL'), website: get('URL'), org: get('ORG') };
      out.fields = [F('Name', get('N')), F('Phone', get('TEL')), F('E-mail', get('EMAIL'))];
    } else if (/^SPC\r?\n/.test(t)) {
      const L = t.split(/\r?\n/);
      out.kind = 'swissqr'; out.label = 'Swiss QR-bill'; out.typeId = 'swissqr';
      out.values = {
        iban: L[3] || '', cName: L[5] || '', cStreet: L[6] || '', cNo: L[7] || '', cZip: L[8] || '', cTown: L[9] || '', cCountry: L[10] || 'CH',
        amount: L[18] || '', currency: L[19] || 'CHF', dName: L[21] || '', dStreet: L[22] || '', dNo: L[23] || '',
        dZip: L[24] || '', dTown: L[25] || '', dCountry: L[26] || '', refType: L[27] || 'NON', reference: L[28] || '', message: L[29] || ''
      };
      out.fields = [F('Account', ibanFormat(L[3] || '')), F('Payable to', L[5] || ''),
      F('Amount', (L[18] ? L[19] + ' ' + L[18] : 'open')), F('Reference', L[28] ? (L[27] === 'QRR' ? qrrFormat(L[28]) : scorFormat(L[28])) : '—'),
      F('Message', L[29] || '')];
    } else if (/^BCD\n/.test(t)) {
      const L = t.split('\n');
      out.kind = 'epc'; out.label = 'SEPA payment'; out.typeId = 'epc';
      out.values = { name: L[5] || '', iban: L[6] || '', bic: L[4] || '', amount: (L[7] || '').replace(/^EUR/, ''), reference: L[9] || '', text: L[10] || '' };
      out.fields = [F('Beneficiary', L[5] || ''), F('IBAN', ibanFormat(L[6] || '')), F('Amount', L[7] || 'open'), F('Reference', L[9] || L[10] || '')];
    } else if (/^mailto:/i.test(t)) {
      const u = new URL(t);
      out.kind = 'email'; out.label = 'E-mail'; out.typeId = 'email';
      out.values = { to: u.pathname, subject: u.searchParams.get('subject') || '', body: u.searchParams.get('body') || '' };
      out.fields = [F('To', u.pathname), F('Subject', out.values.subject), F('Message', out.values.body)];
    } else if (/^tel:/i.test(t)) {
      out.kind = 'phone'; out.label = 'Phone number'; out.typeId = 'phone';
      out.values = { number: t.slice(4) };
      out.fields = [F('Number', t.slice(4))];
    } else if (/^SMSTO:/i.test(t) || /^sms:/i.test(t)) {
      const rest = t.replace(/^SMSTO:/i, '').replace(/^sms:/i, '');
      const idx = rest.indexOf(':');
      out.kind = 'sms'; out.label = 'SMS'; out.typeId = 'sms';
      out.values = { number: idx > 0 ? rest.slice(0, idx) : rest, message: idx > 0 ? rest.slice(idx + 1) : '' };
      out.fields = [F('Number', out.values.number), F('Message', out.values.message)];
    } else if (/^geo:/i.test(t)) {
      const [lat, lng] = t.slice(4).split('?')[0].split(',');
      out.kind = 'location'; out.label = 'Location'; out.typeId = 'location';
      out.values = { lat, lng, format: 'geo' };
      out.fields = [F('Latitude', lat), F('Longitude', lng)];
    } else if (/^BEGIN:(VCALENDAR|VEVENT)/i.test(t)) {
      const line = k => { const m = new RegExp('^' + k + '[^:\\r\\n]*:(.*)$', 'im').exec(t); return m ? m[1].trim() : ''; };
      out.kind = 'event'; out.label = 'Calendar event'; out.typeId = 'event';
      out.fields = [F('Title', line('SUMMARY')), F('Starts', line('DTSTART')), F('Ends', line('DTEND')), F('Location', line('LOCATION'))];
      out.values = { title: line('SUMMARY'), location: line('LOCATION'), description: line('DESCRIPTION') };
    } else if (/^otpauth:/i.test(t)) {
      out.kind = 'otp'; out.label = '2FA setup code'; out.typeId = 'otp';
      out.fields = [F('Account', decodeURIComponent(t.split('?')[0].split('/').pop() || '')), F('Secret', 'hidden — treat this code as a password')];
      out.values = {};
    } else if (/^(bitcoin|ethereum|litecoin|dogecoin|bitcoincash|monero|solana|lightning):/i.test(t)) {
      out.kind = 'crypto'; out.label = 'Crypto payment'; out.typeId = 'crypto';
      const scheme = t.split(':')[0].toLowerCase();
      const addr = t.split(':')[1].split('?')[0];
      out.fields = [F('Network', scheme), F('Address', addr)];
      out.values = { coin: Object.keys(COINS).find(k => COINS[k].scheme === scheme) || 'btc', address: addr };
    }
    return out;
  }

  const byId = id => TYPES.find(t => t.id === id);
  function build(typeId, values) {
    const type = byId(typeId);
    if (!type) throw new Error('Unknown code type.');
    const res = type.build(values || {});
    return typeof res === 'string' ? { text: res } : res;
  }
  const GROUPS = ['Basics', 'Contact', 'Payments', 'Tools'];

  QS.formats = {
    TYPES, GROUPS, byId, build, parse, SOCIAL, PAYLINKS, COINS,
    helpers: {
      ibanValid, ibanClean, ibanFormat, isQrIban, qrrFrom, qrrValid, qrrFormat,
      scorFrom, scorValid, scorFormat, amountStr, buildVCard, buildMeCard, buildEvent,
      buildWifi, withScheme, addParams, vEsc, iEsc, phone, digits, mod97
    }
  };
})();
