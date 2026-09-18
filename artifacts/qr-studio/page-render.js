/* QR Studio · page-render.js
   Turns a stored page (a list of blocks) into DOM. Used twice: by the landing
   page people reach after scanning, and by the live phone preview in the studio.
   Everything is built with createElement/textContent — content is data, never
   markup — and every link is checked against a scheme allow-list. */
(function () {
  'use strict';
  const QS = (window.QS = window.QS || {});

  const SAFE = /^(https?:|mailto:|tel:|sms:|smsto:|geo:|bitcoin:|ethereum:|lightning:)/i;
  const safeURL = u => {
    const s = String(u == null ? '' : u).trim();
    return SAFE.test(s) ? s : '';
  };
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null && text !== '') n.textContent = text;
    return n;
  };
  function linkNode(url, label, cls) {
    const href = safeURL(url);
    const a = el(href ? 'a' : 'span', cls, label);
    if (href) {
      a.href = href;
      if (/^https?:/i.test(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    }
    return a;
  }
  /* plain text with line breaks and bare links turned into anchors */
  function richText(text) {
    const wrap = el('div', 'qp-text');
    String(text == null ? '' : text).split(/\n{2,}/).forEach(para => {
      const p = el('p');
      para.split(/\n/).forEach((line, i) => {
        if (i) p.appendChild(document.createElement('br'));
        const re = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/g;
        let last = 0, m;
        while ((m = re.exec(line))) {
          if (m.index > last) p.appendChild(document.createTextNode(line.slice(last, m.index)));
          const url = m[0].startsWith('www.') ? 'https://' + m[0] : m[0];
          p.appendChild(linkNode(url, m[0], 'qp-inline-link'));
          last = m.index + m[0].length;
        }
        if (last < line.length) p.appendChild(document.createTextNode(line.slice(last)));
      });
      wrap.appendChild(p);
    });
    return wrap;
  }

  const DAY_NAMES = { en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], de: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] };
  const T = {
    en: {
      save: 'Save contact', share: 'Share', call: 'Call', mail: 'E-mail', web: 'Website', route: 'Directions',
      addCal: 'Add to calendar', gcal: 'Google Calendar', copy: 'Copy', copied: 'Copied', code: 'Code',
      reveal: 'Show code', download: 'Download', open: 'Open', openNow: 'Open now', closed: 'Closed',
      send: 'Send', thanks: 'Thank you!', rate: 'How did we do?', comment: 'Anything to add?',
      contact: 'Your e-mail (optional)', wifiPass: 'Password', ssid: 'Network', menu: 'Menu',
      validOnce: 'Single-use code', firstScan: 'First scan — valid', usedAt: 'Already used', hours: 'Opening hours',
      showMsg: 'Show message', burn: 'This message can only be opened once.'
    },
    de: {
      save: 'Kontakt speichern', share: 'Teilen', call: 'Anrufen', mail: 'E-Mail', web: 'Website', route: 'Route',
      addCal: 'Zum Kalender', gcal: 'Google Kalender', copy: 'Kopieren', copied: 'Kopiert', code: 'Code',
      reveal: 'Code anzeigen', download: 'Herunterladen', open: 'Öffnen', openNow: 'Jetzt offen', closed: 'Geschlossen',
      send: 'Senden', thanks: 'Danke!', rate: 'Wie war es?', comment: 'Noch etwas?',
      contact: 'Deine E-Mail (optional)', wifiPass: 'Passwort', ssid: 'Netzwerk', menu: 'Menü',
      validOnce: 'Einmal-Code', firstScan: 'Erster Scan — gültig', usedAt: 'Bereits benutzt', hours: 'Öffnungszeiten',
      showMsg: 'Nachricht anzeigen', burn: 'Diese Nachricht lässt sich nur einmal öffnen.'
    }
  };
  const lang = () => (/^de/i.test(navigator.language || '') ? 'de' : 'en');
  const t = k => (T[lang()] || T.en)[k] || T.en[k];

  function copyButton(value, label) {
    const b = el('button', 'qp-copy', label || t('copy'));
    b.type = 'button';
    b.addEventListener('click', async () => {
      const ok = await QS.util.copyText(value);
      b.textContent = ok ? t('copied') : value;
      setTimeout(() => (b.textContent = label || t('copy')), 1600);
    });
    return b;
  }

  /* ── one renderer per block type ── */
  const BLOCKS = {
    hero(b) {
      const wrap = el('header', 'qp-hero' + (b.cover ? ' has-cover' : ''));
      if (b.cover && safeURL(b.cover)) {
        const cover = el('div', 'qp-cover');
        cover.style.backgroundImage = `url("${encodeURI(b.cover)}")`;
        wrap.appendChild(cover);
      }
      if (b.avatar && safeURL(b.avatar)) {
        const av = el('div', 'qp-avatar');
        const img = el('img');
        img.src = b.avatar;
        img.alt = b.title || '';
        img.loading = 'eager';
        av.appendChild(img);
        wrap.appendChild(av);
      }
      if (b.title) wrap.appendChild(el('h1', 'qp-title', b.title));
      if (b.subtitle) wrap.appendChild(el('p', 'qp-subtitle', b.subtitle));
      if (b.tagline) wrap.appendChild(el('p', 'qp-tagline', b.tagline));
      return wrap;
    },
    heading: b => el('h2', 'qp-heading', b.text),
    text: b => richText(b.text),
    divider: () => el('hr', 'qp-divider'),
    buttons(b) {
      const wrap = el('div', 'qp-buttons');
      (b.items || []).forEach(item => {
        if (!item || !safeURL(item.url)) return;
        const a = linkNode(item.url, '', 'qp-btn' + (item.style === 'ghost' ? ' ghost' : ''));
        if (item.icon) {
          const ico = el('span', 'ico-async qp-btn-ico');
          ico.dataset.icon = item.icon;
          ico.dataset.color = 'currentColor';
          a.appendChild(ico);
        }
        a.appendChild(el('span', 'qp-btn-label', item.label || item.url));
        wrap.appendChild(a);
      });
      return wrap;
    },
    socials(b) {
      const wrap = el('div', 'qp-socials');
      (b.items || []).forEach(item => {
        if (!item || !safeURL(item.url)) return;
        const a = linkNode(item.url, '', 'qp-social');
        a.setAttribute('aria-label', item.label || item.platform || 'link');
        const ico = el('span', 'ico-async');
        ico.dataset.icon = item.icon || item.platform || 'link';
        ico.dataset.color = 'currentColor';
        a.appendChild(ico);
        wrap.appendChild(a);
      });
      return wrap;
    },
    contact(b) {
      const wrap = el('div', 'qp-contact');
      (b.rows || []).forEach(row => {
        if (!row || !row.value) return;
        const line = el('div', 'qp-row');
        const ico = el('span', 'ico-async qp-row-ico');
        ico.dataset.icon = row.icon || 'link';
        ico.dataset.color = 'currentColor';
        line.appendChild(ico);
        const body = el('div', 'qp-row-body');
        body.appendChild(el('span', 'qp-row-label', row.label || ''));
        const href = row.href ? safeURL(row.href) : '';
        body.appendChild(href ? linkNode(href, row.value, 'qp-row-value qp-link') : el('span', 'qp-row-value', row.value));
        line.appendChild(body);
        if (row.copy) line.appendChild(copyButton(row.value));
        wrap.appendChild(line);
      });
      return wrap;
    },
    vcard(b) {
      const wrap = el('div', 'qp-actions');
      const save = el('button', 'qp-btn primary', b.label || t('save'));
      save.type = 'button';
      save.addEventListener('click', () => {
        const blob = new Blob([String(b.vcf || '')], { type: 'text/vcard;charset=utf-8' });
        QS.util.download(blob, (b.filename || 'contact') + '.vcf');
      });
      wrap.appendChild(save);
      if (navigator.share) {
        const share = el('button', 'qp-btn ghost', t('share'));
        share.type = 'button';
        share.addEventListener('click', () => navigator.share({ title: document.title, url: location.href }).catch(() => { }));
        wrap.appendChild(share);
      }
      return wrap;
    },
    image(b) {
      if (!safeURL(b.src)) return document.createComment('');
      const fig = el('figure', 'qp-figure');
      const img = el('img');
      img.src = b.src;
      img.alt = b.alt || '';
      img.loading = 'lazy';
      fig.appendChild(img);
      if (b.caption) fig.appendChild(el('figcaption', null, b.caption));
      return fig;
    },
    gallery(b) {
      const items = (b.items || []).filter(i => i && safeURL(i.src));
      const wrap = el('div', 'qp-gallery' + (b.layout === 'row' ? ' row' : ''));
      items.forEach((item, i) => {
        const cell = el('button', 'qp-thumb');
        cell.type = 'button';
        const img = el('img');
        img.src = item.src;
        img.alt = item.caption || '';
        img.loading = 'lazy';
        cell.appendChild(img);
        cell.addEventListener('click', () => lightbox(items, i));
        wrap.appendChild(cell);
      });
      return wrap;
    },
    video(b) {
      const wrap = el('div', 'qp-media');
      const yt = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/.exec(String(b.src || ''));
      const vm = /vimeo\.com\/(?:video\/)?(\d+)/.exec(String(b.src || ''));
      if (yt || vm) {
        const frame = el('div', 'qp-embed');
        const iframe = document.createElement('iframe');
        iframe.src = yt ? `https://www.youtube-nocookie.com/embed/${yt[1]}` : `https://player.vimeo.com/video/${vm[1]}`;
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture; fullscreen';
        iframe.allowFullscreen = true;
        iframe.loading = 'lazy';
        iframe.title = b.title || 'Video';
        frame.appendChild(iframe);
        wrap.appendChild(frame);
      } else if (safeURL(b.src)) {
        const v = document.createElement('video');
        v.src = b.src;
        v.controls = true;
        v.playsInline = true;
        v.preload = 'metadata';
        if (b.poster && safeURL(b.poster)) v.poster = b.poster;
        v.className = 'qp-video';
        wrap.appendChild(v);
      }
      if (b.caption) wrap.appendChild(el('p', 'qp-caption', b.caption));
      return wrap;
    },
    audio(b) {
      const wrap = el('div', 'qp-audio');
      (b.tracks || []).forEach(tr => {
        if (!tr || !safeURL(tr.src)) return;
        const row = el('div', 'qp-track');
        if (tr.cover && safeURL(tr.cover)) {
          const img = el('img', 'qp-track-cover');
          img.src = tr.cover;
          img.alt = '';
          row.appendChild(img);
        }
        const body = el('div', 'qp-track-body');
        body.appendChild(el('div', 'qp-track-title', tr.title || 'Audio'));
        if (tr.artist) body.appendChild(el('div', 'qp-track-artist', tr.artist));
        const a = document.createElement('audio');
        a.src = tr.src;
        a.controls = true;
        a.preload = 'none';
        body.appendChild(a);
        row.appendChild(body);
        wrap.appendChild(row);
      });
      return wrap;
    },
    pdf(b) {
      const wrap = el('div', 'qp-file');
      if (!safeURL(b.src)) return wrap;
      const frame = el('div', 'qp-pdf');
      const obj = document.createElement('iframe');
      obj.src = b.src + '#view=FitH';
      obj.title = b.title || 'PDF';
      obj.loading = 'lazy';
      frame.appendChild(obj);
      wrap.appendChild(frame);
      const actions = el('div', 'qp-actions');
      actions.appendChild(linkNode(b.src, t('open'), 'qp-btn primary'));
      const dl = linkNode(b.src, t('download'), 'qp-btn ghost');
      if (dl.tagName === 'A') dl.setAttribute('download', '');
      actions.appendChild(dl);
      wrap.appendChild(actions);
      return wrap;
    },
    file(b) {
      const wrap = el('div', 'qp-files');
      (b.items || []).forEach(f => {
        if (!f || !safeURL(f.src)) return;
        const row = el('div', 'qp-file-row');
        const ico = el('span', 'ico-async qp-row-ico');
        ico.dataset.icon = 'file';
        ico.dataset.color = 'currentColor';
        row.appendChild(ico);
        const body = el('div', 'qp-row-body');
        body.appendChild(el('div', 'qp-row-value', f.name || 'File'));
        if (f.size) body.appendChild(el('div', 'qp-row-label', QS.util.bytesHuman(f.size)));
        row.appendChild(body);
        const dl = linkNode(f.src, t('download'), 'qp-btn ghost small');
        if (dl.tagName === 'A') dl.setAttribute('download', '');
        row.appendChild(dl);
        wrap.appendChild(row);
      });
      return wrap;
    },
    hours(b) {
      const wrap = el('div', 'qp-hours');
      wrap.appendChild(el('h2', 'qp-heading', b.title || t('hours')));
      const names = DAY_NAMES[lang()] || DAY_NAMES.en;
      const today = (new Date().getDay() + 6) % 7;
      (b.days || []).forEach((d, i) => {
        const row = el('div', 'qp-hours-row' + (i === today ? ' today' : ''));
        row.appendChild(el('span', 'qp-hours-day', names[i] || ''));
        row.appendChild(el('span', 'qp-hours-time', d && d.closed ? t('closed') : (d && d.open ? `${d.open} – ${d.close || ''}` : t('closed'))));
        wrap.appendChild(row);
      });
      if (b.note) wrap.appendChild(el('p', 'qp-note', b.note));
      return wrap;
    },
    map(b) {
      const wrap = el('div', 'qp-map');
      const lat = Number(b.lat), lng = Number(b.lng);
      if (isFinite(lat) && isFinite(lng)) {
        const d = 0.004;
        const frame = document.createElement('iframe');
        frame.className = 'qp-map-frame';
        frame.loading = 'lazy';
        frame.title = b.address || 'Map';
        frame.src = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - d}%2C${lat - d}%2C${lng + d}%2C${lat + d}&layer=mapnik&marker=${lat}%2C${lng}`;
        wrap.appendChild(frame);
      }
      if (b.address) wrap.appendChild(el('p', 'qp-address', b.address));
      const actions = el('div', 'qp-actions');
      const q = isFinite(lat) && isFinite(lng) ? `${lat},${lng}` : String(b.address || '');
      actions.appendChild(linkNode('https://maps.google.com/?q=' + encodeURIComponent(q), t('route'), 'qp-btn ghost small'));
      actions.appendChild(linkNode('https://maps.apple.com/?q=' + encodeURIComponent(q), 'Apple Maps', 'qp-btn ghost small'));
      wrap.appendChild(actions);
      return wrap;
    },
    menu(b) {
      const wrap = el('div', 'qp-menu');
      (b.sections || []).forEach(sec => {
        if (!sec) return;
        if (sec.name) wrap.appendChild(el('h2', 'qp-heading', sec.name));
        (sec.items || []).forEach(item => {
          if (!item || !item.name) return;
          const row = el('div', 'qp-menu-item');
          const body = el('div');
          body.appendChild(el('div', 'qp-menu-name', item.name));
          if (item.desc) body.appendChild(el('div', 'qp-menu-desc', item.desc));
          row.appendChild(body);
          if (item.price) row.appendChild(el('div', 'qp-menu-price', (b.currency ? b.currency + ' ' : '') + item.price));
          wrap.appendChild(row);
        });
      });
      return wrap;
    },
    coupon(b) {
      const wrap = el('div', 'qp-coupon');
      if (b.discount) wrap.appendChild(el('div', 'qp-coupon-value', b.discount));
      if (b.headline) wrap.appendChild(el('div', 'qp-coupon-head', b.headline));
      if (b.description) wrap.appendChild(richText(b.description));
      if (b.code) {
        const codeBox = el('div', 'qp-coupon-code');
        const val = el('span', 'qp-code-value', b.code);
        val.classList.add('hidden');
        const reveal = el('button', 'qp-btn primary', t('reveal'));
        reveal.type = 'button';
        reveal.addEventListener('click', () => {
          val.classList.remove('hidden');
          reveal.remove();
          codeBox.appendChild(copyButton(b.code));
        });
        codeBox.appendChild(el('span', 'qp-row-label', t('code')));
        codeBox.appendChild(val);
        codeBox.appendChild(reveal);
        wrap.appendChild(codeBox);
      }
      if (b.validUntil) wrap.appendChild(el('p', 'qp-note', b.validUntil));
      if (b.terms) wrap.appendChild(el('p', 'qp-terms', b.terms));
      if (b.url && safeURL(b.url)) wrap.appendChild(linkNode(b.url, b.urlLabel || t('open'), 'qp-btn ghost'));
      return wrap;
    },
    event(b) {
      const wrap = el('div', 'qp-event');
      const when = el('div', 'qp-event-when');
      if (b.startText) when.appendChild(el('div', 'qp-event-date', b.startText));
      if (b.endText) when.appendChild(el('div', 'qp-row-label', b.endText));
      wrap.appendChild(when);
      if (b.location) wrap.appendChild(el('div', 'qp-event-where', b.location));
      if (b.description) wrap.appendChild(richText(b.description));
      const actions = el('div', 'qp-actions');
      if (b.ics) {
        const add = el('button', 'qp-btn primary', t('addCal'));
        add.type = 'button';
        add.addEventListener('click', () => {
          const blob = new Blob([String(b.ics)], { type: 'text/calendar;charset=utf-8' });
          QS.util.download(blob, (b.filename || 'event') + '.ics');
        });
        actions.appendChild(add);
      }
      if (b.gcal && safeURL(b.gcal)) actions.appendChild(linkNode(b.gcal, t('gcal'), 'qp-btn ghost'));
      if (b.url && safeURL(b.url)) actions.appendChild(linkNode(b.url, b.urlLabel || t('open'), 'qp-btn ghost'));
      wrap.appendChild(actions);
      return wrap;
    },
    app(b) {
      const wrap = el('div', 'qp-actions column');
      if (b.ios && safeURL(b.ios)) wrap.appendChild(linkNode(b.ios, 'App Store', 'qp-btn primary'));
      if (b.android && safeURL(b.android)) wrap.appendChild(linkNode(b.android, 'Google Play', 'qp-btn primary'));
      if (b.other && safeURL(b.other)) wrap.appendChild(linkNode(b.other, b.otherLabel || t('open'), 'qp-btn ghost'));
      return wrap;
    },
    wifi(b) {
      const wrap = el('div', 'qp-contact');
      const row = (label, value) => {
        const line = el('div', 'qp-row');
        const body = el('div', 'qp-row-body');
        body.appendChild(el('span', 'qp-row-label', label));
        body.appendChild(el('span', 'qp-row-value', value));
        line.appendChild(body);
        line.appendChild(copyButton(value));
        wrap.appendChild(line);
      };
      if (b.ssid) row(t('ssid'), b.ssid);
      if (b.password) row(t('wifiPass'), b.password);
      return wrap;
    },
    message(b) {
      const wrap = el('div', 'qp-message');
      if (b.burn) wrap.appendChild(el('p', 'qp-note', t('burn')));
      const body = richText(b.text);
      if (b.hide) {
        body.classList.add('hidden');
        const show = el('button', 'qp-btn primary', t('showMsg'));
        show.type = 'button';
        show.addEventListener('click', () => { body.classList.remove('hidden'); show.remove(); });
        wrap.appendChild(show);
      }
      wrap.appendChild(body);
      return wrap;
    },
    feedback(b, ctx) {
      const wrap = el('form', 'qp-feedback');
      wrap.appendChild(el('h2', 'qp-heading', b.question || t('rate')));
      let rating = 0;
      const stars = el('div', 'qp-stars');
      const buttons = [];
      for (let i = 1; i <= 5; i++) {
        const s = el('button', 'qp-star');
        s.type = 'button';
        s.setAttribute('aria-label', String(i));
        s.innerHTML = '<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path d="M12 2.4l2.9 6 6.6.9-4.8 4.6 1.2 6.5-5.9-3.1-5.9 3.1 1.2-6.5L2.5 9.3l6.6-.9z" fill="currentColor"/></svg>';
        s.addEventListener('click', () => {
          rating = i;
          buttons.forEach((btn, idx) => btn.classList.toggle('on', idx < i));
        });
        buttons.push(s);
        stars.appendChild(s);
      }
      wrap.appendChild(stars);
      const comment = document.createElement('textarea');
      comment.className = 'qp-input';
      comment.rows = 3;
      comment.placeholder = b.commentLabel || t('comment');
      wrap.appendChild(comment);
      let contact = null;
      if (b.askContact) {
        contact = document.createElement('input');
        contact.className = 'qp-input';
        contact.type = 'email';
        contact.placeholder = b.contactLabel || t('contact');
        wrap.appendChild(contact);
      }
      const send = el('button', 'qp-btn primary', t('send'));
      send.type = 'submit';
      wrap.appendChild(send);
      const note = el('p', 'qp-note');
      wrap.appendChild(note);
      wrap.addEventListener('submit', async ev => {
        ev.preventDefault();
        if (!ctx || !ctx.submitFeedback) return;
        send.disabled = true;
        try {
          const res = await ctx.submitFeedback({ rating, comment: comment.value, contact: contact ? contact.value : '' });
          if (res && res.status === 'ok') {
            wrap.innerHTML = '';
            wrap.appendChild(el('h2', 'qp-heading', b.thanks || t('thanks')));
          } else {
            note.textContent = res && res.status === 'duplicate' ? t('thanks') : 'Could not send — scan the code again.';
            send.disabled = false;
          }
        } catch (e) {
          note.textContent = 'Could not send — check your connection.';
          send.disabled = false;
        }
      });
      return wrap;
    }
  };

  /* full-screen image viewer for galleries */
  function lightbox(items, index) {
    let i = index;
    const box = el('div', 'qp-lightbox');
    const img = el('img');
    const caption = el('div', 'qp-lightbox-cap');
    const show = () => {
      img.src = items[i].src;
      caption.textContent = items[i].caption || '';
    };
    const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = ev => {
      if (ev.key === 'Escape') close();
      if (ev.key === 'ArrowRight') { i = (i + 1) % items.length; show(); }
      if (ev.key === 'ArrowLeft') { i = (i - 1 + items.length) % items.length; show(); }
    };
    const prev = el('button', 'qp-lb-nav prev', '‹');
    const next = el('button', 'qp-lb-nav next', '›');
    prev.addEventListener('click', ev => { ev.stopPropagation(); i = (i - 1 + items.length) % items.length; show(); });
    next.addEventListener('click', ev => { ev.stopPropagation(); i = (i + 1) % items.length; show(); });
    box.append(img, caption, prev, next);
    box.addEventListener('click', ev => { if (ev.target === box || ev.target === img) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(box);
    show();
  }

  /* ── theme + page ── */
  function applyTheme(root, theme) {
    const th = theme || {};
    const accent = th.accent || '#e8ff00';
    const dark = th.mode !== 'light';
    root.style.setProperty('--qp-accent', accent);
    root.style.setProperty('--qp-accent-ink', QS.util.luminance(accent) > 0.45 ? '#0d0d0d' : '#ffffff');
    root.style.setProperty('--qp-bg', th.bg || (dark ? '#0d0d0d' : '#f6f6f4'));
    root.style.setProperty('--qp-panel', th.panel || (dark ? '#141414' : '#ffffff'));
    root.style.setProperty('--qp-ink', th.ink || (dark ? '#f0f0f0' : '#14140f'));
    root.style.setProperty('--qp-muted', dark ? '#9a9a93' : '#5c5c55');
    root.style.setProperty('--qp-line', dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)');
    root.dataset.mode = dark ? 'dark' : 'light';
    root.dataset.font = th.font || 'mono';
  }

  /* page = {theme, blocks:[…]}; ctx carries callbacks (feedback submit) */
  function render(target, page, ctx) {
    const root = typeof target === 'string' ? document.querySelector(target) : target;
    if (!root) return;
    root.innerHTML = '';
    root.classList.add('qp-root');
    applyTheme(root, (page && page.theme) || {});
    const main = el('div', 'qp-page');
    (page && page.blocks ? page.blocks : []).forEach(block => {
      if (!block || !block.t) return;
      const fn = BLOCKS[block.t];
      if (!fn) return;
      try {
        const node = fn(block, ctx || {});
        if (node) main.appendChild(node);
      } catch (e) { /* one broken block must not blank the page */ }
    });
    root.appendChild(main);
    if (QS.icons) QS.icons.hydrate(root);
    return root;
  }

  QS.pageRender = { render, applyTheme, BLOCKS, safeURL, richText, t, lang, lightbox };
})();
