/* QR Studio · pages.js
   Hosted code types — the ones that need an account because they store files or
   a page. Each type describes its form and turns those values into the block
   list that page-render.js draws for whoever scans the code. */
(function () {
  'use strict';
  const QS = (window.QS = window.QS || {});
  const U = QS.util;
  const trim = s => String(s == null ? '' : s).trim();
  const has = s => trim(s) !== '';
  const fail = msg => { throw new Error(msg); };
  const fileURL = f => (f && (f.url || f.src)) || '';

  const THEME_FIELDS = [
    { k: 'accent', label: 'Accent colour', type: 'color', w: 'third', group: 'Look' },
    { k: 'mode', label: 'Background', type: 'select', w: 'third', group: 'Look', options: [{ v: 'dark', l: 'Dark' }, { v: 'light', l: 'Light' }] },
    { k: 'font', label: 'Font', type: 'select', w: 'third', group: 'Look', options: [{ v: 'mono', l: 'Technical mono' }, { v: 'sans', l: 'Clean sans' }, { v: 'display', l: 'Condensed display' }] }
  ];
  const theme = v => ({ accent: v.accent || '#e8ff00', mode: v.mode || 'dark', font: v.font || 'mono' });
  const hero = v => ({
    t: 'hero',
    title: trim(v.title) || trim(v.name),
    subtitle: trim(v.subtitle),
    tagline: trim(v.tagline),
    avatar: fileURL(v.avatar) || fileURL(v.photo) || fileURL(v.logo),
    cover: fileURL(v.cover)
  });
  const socialRows = list => ({
    t: 'socials',
    items: (list || []).filter(s => s && has(s.url)).map(s => ({
      url: QS.formats.helpers.withScheme(s.url),
      icon: s.icon || s.platform || 'link',
      label: s.label || s.platform
    }))
  });
  const buttonRows = list => ({
    t: 'buttons',
    items: (list || []).filter(b => b && has(b.url)).map(b => ({
      url: QS.formats.helpers.withScheme(b.url),
      label: trim(b.label) || trim(b.url),
      icon: b.icon || '',
      style: b.style || 'solid'
    }))
  });
  const socialField = (k, label) => ({
    k, label, type: 'repeat', w: 'full', add: 'Add profile', max: 14,
    fields: [
      { k: 'platform', label: 'Platform', type: 'select', w: 'half', options: Object.entries(QS.formats.SOCIAL).map(([v, s]) => ({ v, l: s.name })) },
      { k: 'url', label: 'Link or handle', type: 'text', w: 'half' }
    ]
  });
  function normaliseSocials(list) {
    return (list || []).map(s => {
      if (!s || !has(s.url)) return null;
      const def = QS.formats.SOCIAL[s.platform];
      const url = /^https?:\/\//i.test(trim(s.url)) ? trim(s.url) : (def ? def.url(trim(s.url)) : QS.formats.helpers.withScheme(s.url));
      return { url, icon: def ? def.icon : 'link', label: def ? def.name : 'Link' };
    }).filter(Boolean);
  }

  const TYPES = [
    {
      id: 'dyn-url', name: 'Short link', group: 'Hosted', icon: 'link', hosted: true, kind: 'url',
      desc: 'A short link you can re-point later, with scan statistics and smart routing.',
      fields: [
        { k: 'target', label: 'Destination link', type: 'url', ph: 'https://example.com', required: true, w: 'full' }
      ],
      build(v) {
        const url = QS.formats.helpers.withScheme(v.target);
        if (!/^https?:\/\//i.test(url)) fail('Enter the link this code should open.');
        return { kind: 'url', target: url, title: trim(v.title) || url };
      }
    },
    {
      id: 'file', name: 'File download', group: 'Hosted', icon: 'file', hosted: true, kind: 'page',
      desc: 'Any file — PDF, ZIP, Word, plans. People scan and download.',
      fields: [
        { k: 'title', label: 'Title', type: 'text', w: 'full' },
        { k: 'files', label: 'Files', type: 'uploads', w: 'full', accept: '*/*', required: true },
        { k: 'text', label: 'Description', type: 'textarea', rows: 3, w: 'full' },
        ...THEME_FIELDS
      ],
      build(v) {
        const items = (v.files || []).filter(f => fileURL(f)).map(f => ({ src: fileURL(f), name: f.name, size: f.size }));
        if (!items.length) fail('Upload at least one file.');
        const blocks = [hero(v)];
        if (has(v.text)) blocks.push({ t: 'text', text: v.text });
        blocks.push({ t: 'file', items });
        return { kind: 'page', page: { type: 'file', theme: theme(v), blocks }, title: trim(v.title) || items[0].name };
      }
    },
    {
      id: 'pdf', name: 'PDF', group: 'Hosted', icon: 'file', hosted: true, kind: 'page',
      desc: 'A PDF that opens right in the browser, with a download button.',
      fields: [
        { k: 'title', label: 'Title', type: 'text', w: 'full' },
        { k: 'file', label: 'PDF file', type: 'upload', accept: 'application/pdf', w: 'full', required: true },
        { k: 'text', label: 'Description', type: 'textarea', rows: 3, w: 'full' },
        ...THEME_FIELDS
      ],
      build(v) {
        const src = fileURL(v.file);
        if (!src) fail('Upload the PDF.');
        const blocks = [hero(v)];
        if (has(v.text)) blocks.push({ t: 'text', text: v.text });
        blocks.push({ t: 'pdf', src, title: trim(v.title) });
        return { kind: 'page', page: { type: 'pdf', theme: theme(v), blocks }, title: trim(v.title) || (v.file && v.file.name) || 'PDF' };
      }
    },
    {
      id: 'images', name: 'Photo gallery', group: 'Hosted', icon: 'image', hosted: true, kind: 'page',
      desc: 'Upload photos; the code opens a gallery with full-screen view.',
      fields: [
        { k: 'title', label: 'Title', type: 'text', w: 'full' },
        { k: 'images', label: 'Photos', type: 'uploads', accept: 'image/*', w: 'full', required: true, help: 'Large photos are shrunk automatically before upload.' },
        { k: 'text', label: 'Description', type: 'textarea', rows: 3, w: 'full' },
        { k: 'layout', label: 'Layout', type: 'select', w: 'half', options: [{ v: 'grid', l: 'Grid' }, { v: 'row', l: 'Single column' }] },
        ...THEME_FIELDS
      ],
      build(v) {
        const items = (v.images || []).filter(f => fileURL(f)).map(f => ({ src: fileURL(f), caption: f.caption || '' }));
        if (!items.length) fail('Upload at least one photo.');
        const blocks = [hero(v)];
        if (has(v.text)) blocks.push({ t: 'text', text: v.text });
        blocks.push({ t: 'gallery', items, layout: v.layout || 'grid' });
        return { kind: 'page', page: { type: 'images', theme: theme(v), blocks }, title: trim(v.title) || 'Photos' };
      }
    },
    {
      id: 'video', name: 'Video', group: 'Hosted', icon: 'play', hosted: true, kind: 'page',
      desc: 'Upload a clip (up to 50 MB) or paste a YouTube/Vimeo link.',
      fields: [
        { k: 'title', label: 'Title', type: 'text', w: 'full' },
        { k: 'source', label: 'Source', type: 'select', w: 'half', options: [{ v: 'upload', l: 'Upload a file' }, { v: 'link', l: 'YouTube / Vimeo / direct link' }] },
        { k: 'file', label: 'Video file', type: 'upload', accept: 'video/*', w: 'full', show: v => (v.source || 'upload') === 'upload' },
        { k: 'url', label: 'Video link', type: 'url', w: 'full', show: v => v.source === 'link' },
        { k: 'poster', label: 'Cover image', type: 'upload', accept: 'image/*', w: 'half', show: v => (v.source || 'upload') === 'upload' },
        { k: 'text', label: 'Description', type: 'textarea', rows: 3, w: 'full' },
        { k: 'ctaLabel', label: 'Button label', type: 'text', w: 'half', group: 'More' },
        { k: 'ctaUrl', label: 'Button link', type: 'url', w: 'half', group: 'More' },
        ...THEME_FIELDS
      ],
      build(v) {
        const src = (v.source === 'link') ? QS.formats.helpers.withScheme(v.url) : fileURL(v.file);
        if (!src) fail(v.source === 'link' ? 'Paste the video link.' : 'Upload the video file.');
        const blocks = [hero(v), { t: 'video', src, poster: fileURL(v.poster), title: trim(v.title) }];
        if (has(v.text)) blocks.push({ t: 'text', text: v.text });
        if (has(v.ctaUrl)) blocks.push(buttonRows([{ url: v.ctaUrl, label: v.ctaLabel || 'Open' }]));
        return { kind: 'page', page: { type: 'video', theme: theme(v), blocks }, title: trim(v.title) || 'Video' };
      }
    },
    {
      id: 'audio', name: 'Audio', group: 'Hosted', icon: 'music', hosted: true, kind: 'page',
      desc: 'MP3s with a player — audio guides, demos, a mixtape.',
      fields: [
        { k: 'title', label: 'Title', type: 'text', w: 'full' },
        { k: 'cover', label: 'Cover image', type: 'upload', accept: 'image/*', w: 'half' },
        {
          k: 'tracks', label: 'Tracks', type: 'repeat', w: 'full', add: 'Add track', max: 25, required: true,
          fields: [
            { k: 'file', label: 'Audio file', type: 'upload', accept: 'audio/*', w: 'full' },
            { k: 'title', label: 'Title', type: 'text', w: 'half' },
            { k: 'artist', label: 'Artist', type: 'text', w: 'half' }
          ]
        },
        { k: 'text', label: 'Description', type: 'textarea', rows: 3, w: 'full' },
        ...THEME_FIELDS
      ],
      build(v) {
        const tracks = (v.tracks || []).filter(t => fileURL(t.file)).map(t => ({
          src: fileURL(t.file), title: trim(t.title) || (t.file && t.file.name) || 'Track', artist: trim(t.artist), cover: fileURL(v.cover)
        }));
        if (!tracks.length) fail('Add at least one audio file.');
        const blocks = [hero(v), { t: 'audio', tracks }];
        if (has(v.text)) blocks.push({ t: 'text', text: v.text });
        return { kind: 'page', page: { type: 'audio', theme: theme(v), blocks }, title: trim(v.title) || tracks[0].title };
      }
    },
    {
      id: 'vcardplus', name: 'Digital business card', group: 'Hosted', icon: 'contact', hosted: true, kind: 'page',
      desc: 'A profile page with photo, every contact detail and a "save contact" button.',
      fields: [
        { k: 'photo', label: 'Photo', type: 'upload', accept: 'image/*', w: 'half' },
        { k: 'cover', label: 'Cover image', type: 'upload', accept: 'image/*', w: 'half' },
        { k: 'first', label: 'First name', type: 'text', w: 'half' },
        { k: 'last', label: 'Last name', type: 'text', w: 'half' },
        { k: 'title', label: 'Job title', type: 'text', w: 'half' },
        { k: 'org', label: 'Company', type: 'text', w: 'half' },
        { k: 'tagline', label: 'One-liner', type: 'text', w: 'full' },
        { k: 'mobile', label: 'Mobile', type: 'tel', w: 'third' },
        { k: 'work', label: 'Work phone', type: 'tel', w: 'third' },
        { k: 'email', label: 'E-mail', type: 'email', w: 'third' },
        { k: 'website', label: 'Website', type: 'url', w: 'full' },
        { k: 'street', label: 'Street', type: 'text', w: 'half' },
        { k: 'zip', label: 'Postcode', type: 'text', w: 'third' },
        { k: 'city', label: 'Town', type: 'text', w: 'third' },
        { k: 'country', label: 'Country', type: 'text', w: 'third' },
        { k: 'note', label: 'About', type: 'textarea', rows: 3, w: 'full' },
        socialField('socials', 'Social profiles'),
        ...THEME_FIELDS
      ],
      build(v) {
        const name = [trim(v.first), trim(v.last)].filter(Boolean).join(' ');
        if (!name && !has(v.org)) fail('Give at least a name or a company.');
        const vcf = QS.formats.helpers.buildVCard(v);
        const rows = [];
        if (has(v.mobile)) rows.push({ icon: 'phone', label: 'Mobile', value: trim(v.mobile), href: 'tel:' + QS.formats.helpers.phone(v.mobile) });
        if (has(v.work)) rows.push({ icon: 'phone', label: 'Work', value: trim(v.work), href: 'tel:' + QS.formats.helpers.phone(v.work) });
        if (has(v.email)) rows.push({ icon: 'mail', label: 'E-mail', value: trim(v.email), href: 'mailto:' + trim(v.email) });
        if (has(v.website)) rows.push({ icon: 'link', label: 'Website', value: trim(v.website), href: QS.formats.helpers.withScheme(v.website) });
        const address = [trim(v.street), [trim(v.zip), trim(v.city)].filter(Boolean).join(' '), trim(v.country)].filter(Boolean).join(', ');
        if (address) rows.push({ icon: 'pin', label: 'Address', value: address, href: 'https://maps.google.com/?q=' + encodeURIComponent(address) });
        const blocks = [
          { t: 'hero', title: name || trim(v.org), subtitle: [trim(v.title), trim(v.org)].filter(Boolean).join(' · '), tagline: trim(v.tagline), avatar: fileURL(v.photo), cover: fileURL(v.cover) },
          { t: 'vcard', vcf, filename: U.slugify(name || v.org, 'contact') },
          { t: 'contact', rows }
        ];
        if (has(v.note)) blocks.push({ t: 'text', text: v.note });
        const socials = normaliseSocials(v.socials);
        if (socials.length) blocks.push({ t: 'socials', items: socials });
        return { kind: 'page', page: { type: 'vcardplus', theme: theme(v), blocks }, title: name || trim(v.org) };
      }
    },
    {
      id: 'links', name: 'Link page', group: 'Hosted', icon: 'link', hosted: true, kind: 'page',
      desc: 'One code, every link — the "link in bio" page.',
      fields: [
        { k: 'avatar', label: 'Picture', type: 'upload', accept: 'image/*', w: 'half' },
        { k: 'title', label: 'Name', type: 'text', w: 'half', required: true },
        { k: 'subtitle', label: 'Subtitle', type: 'text', w: 'full' },
        { k: 'text', label: 'Bio', type: 'textarea', rows: 3, w: 'full' },
        {
          k: 'links', label: 'Links', type: 'repeat', w: 'full', add: 'Add link', max: 25, required: true,
          fields: [
            { k: 'label', label: 'Label', type: 'text', w: 'half' },
            { k: 'url', label: 'Link', type: 'url', w: 'half' }
          ]
        },
        socialField('socials', 'Social icons'),
        ...THEME_FIELDS
      ],
      build(v) {
        const buttons = buttonRows(v.links);
        if (!buttons.items.length) fail('Add at least one link.');
        const blocks = [hero(v)];
        if (has(v.text)) blocks.push({ t: 'text', text: v.text });
        blocks.push(buttons);
        const socials = normaliseSocials(v.socials);
        if (socials.length) blocks.push({ t: 'socials', items: socials });
        return { kind: 'page', page: { type: 'links', theme: theme(v), blocks }, title: trim(v.title) || 'Links' };
      }
    },
    {
      id: 'business', name: 'Business page', group: 'Hosted', icon: 'shop', hosted: true, kind: 'page',
      desc: 'Opening hours, address, phone, links — the little page a shop needs.',
      fields: [
        { k: 'logo', label: 'Logo', type: 'upload', accept: 'image/*', w: 'half' },
        { k: 'cover', label: 'Cover image', type: 'upload', accept: 'image/*', w: 'half' },
        { k: 'title', label: 'Name', type: 'text', w: 'full', required: true },
        { k: 'subtitle', label: 'What you do', type: 'text', w: 'full' },
        { k: 'text', label: 'About', type: 'textarea', rows: 4, w: 'full' },
        { k: 'phone', label: 'Phone', type: 'tel', w: 'third' },
        { k: 'email', label: 'E-mail', type: 'email', w: 'third' },
        { k: 'website', label: 'Website', type: 'url', w: 'third' },
        { k: 'address', label: 'Address', type: 'text', w: 'full' },
        { k: 'lat', label: 'Latitude', type: 'text', w: 'third', group: 'Map' },
        { k: 'lng', label: 'Longitude', type: 'text', w: 'third', group: 'Map' },
        { k: 'geo', label: 'Find the address', type: 'geosearch', w: 'full', group: 'Map' },
        { k: 'hours', label: 'Opening hours', type: 'hours', w: 'full', group: 'Hours' },
        { k: 'hoursNote', label: 'Note on hours', type: 'text', w: 'full', group: 'Hours' },
        socialField('socials', 'Social profiles'),
        ...THEME_FIELDS
      ],
      build(v) {
        if (!has(v.title)) fail('Enter the name of the business.');
        const rows = [];
        if (has(v.phone)) rows.push({ icon: 'phone', label: 'Phone', value: trim(v.phone), href: 'tel:' + QS.formats.helpers.phone(v.phone) });
        if (has(v.email)) rows.push({ icon: 'mail', label: 'E-mail', value: trim(v.email), href: 'mailto:' + trim(v.email) });
        if (has(v.website)) rows.push({ icon: 'link', label: 'Website', value: trim(v.website), href: QS.formats.helpers.withScheme(v.website) });
        const blocks = [hero(v)];
        if (has(v.text)) blocks.push({ t: 'text', text: v.text });
        if (rows.length) blocks.push({ t: 'contact', rows });
        if (Array.isArray(v.hours) && v.hours.some(d => d && (d.open || d.closed))) {
          blocks.push({ t: 'hours', days: v.hours, note: trim(v.hoursNote) });
        }
        if (has(v.address) || (has(v.lat) && has(v.lng))) {
          blocks.push({ t: 'map', address: trim(v.address), lat: Number(v.lat), lng: Number(v.lng) });
        }
        const socials = normaliseSocials(v.socials);
        if (socials.length) blocks.push({ t: 'socials', items: socials });
        return { kind: 'page', page: { type: 'business', theme: theme(v), blocks }, title: trim(v.title) };
      }
    },
    {
      id: 'menu', name: 'Menu', group: 'Hosted', icon: 'shop', hosted: true, kind: 'page',
      desc: 'A menu or price list people read on their phone. Change prices any time.',
      fields: [
        { k: 'title', label: 'Name', type: 'text', w: 'half', required: true },
        { k: 'subtitle', label: 'Subtitle', type: 'text', w: 'half' },
        { k: 'cover', label: 'Cover image', type: 'upload', accept: 'image/*', w: 'half' },
        { k: 'currency', label: 'Currency', type: 'text', ph: 'CHF', w: 'third' },
        {
          k: 'sections', label: 'Sections', type: 'repeat', w: 'full', add: 'Add section', max: 20, required: true,
          fields: [
            { k: 'name', label: 'Section', type: 'text', w: 'full' },
            {
              k: 'items', label: 'Items', type: 'repeat', w: 'full', add: 'Add item', max: 60,
              fields: [
                { k: 'name', label: 'Name', type: 'text', w: 'half' },
                { k: 'price', label: 'Price', type: 'text', w: 'third' },
                { k: 'desc', label: 'Description', type: 'text', w: 'full' }
              ]
            }
          ]
        },
        ...THEME_FIELDS
      ],
      build(v) {
        const sections = (v.sections || []).map(s => ({
          name: trim(s.name),
          items: (s.items || []).filter(i => i && has(i.name)).map(i => ({ name: trim(i.name), price: trim(i.price), desc: trim(i.desc) }))
        })).filter(s => s.name || s.items.length);
        if (!sections.length) fail('Add at least one item.');
        const blocks = [hero(v), { t: 'menu', sections, currency: trim(v.currency) }];
        return { kind: 'page', page: { type: 'menu', theme: theme(v), blocks }, title: trim(v.title) || 'Menu' };
      }
    },
    {
      id: 'coupon', name: 'Coupon', group: 'Hosted', icon: 'ticket', hosted: true, kind: 'page',
      desc: 'A discount with a code to reveal. Pair it with a scan limit for one-time use.',
      fields: [
        { k: 'title', label: 'Headline', type: 'text', w: 'full', required: true },
        { k: 'discount', label: 'The offer', type: 'text', ph: '20% OFF', w: 'half' },
        { k: 'code', label: 'Code to reveal', type: 'text', w: 'half' },
        { k: 'cover', label: 'Image', type: 'upload', accept: 'image/*', w: 'half' },
        { k: 'text', label: 'Description', type: 'textarea', rows: 3, w: 'full' },
        { k: 'validUntil', label: 'Valid until', type: 'text', w: 'half' },
        { k: 'terms', label: 'Conditions', type: 'textarea', rows: 2, w: 'full' },
        { k: 'url', label: 'Button link', type: 'url', w: 'half', group: 'More' },
        { k: 'urlLabel', label: 'Button label', type: 'text', w: 'half', group: 'More' },
        ...THEME_FIELDS
      ],
      build(v) {
        if (!has(v.title)) fail('Give the coupon a headline.');
        const blocks = [
          { t: 'hero', title: trim(v.title), cover: fileURL(v.cover) },
          { t: 'coupon', headline: trim(v.subtitle), discount: trim(v.discount), description: trim(v.text), code: trim(v.code), validUntil: trim(v.validUntil), terms: trim(v.terms), url: has(v.url) ? QS.formats.helpers.withScheme(v.url) : '', urlLabel: trim(v.urlLabel) }
        ];
        return { kind: 'page', page: { type: 'coupon', theme: theme(v), blocks }, title: trim(v.title) };
      }
    },
    {
      id: 'eventpage', name: 'Event page', group: 'Hosted', icon: 'calendar', hosted: true, kind: 'page',
      desc: 'Details, map and "add to calendar". Make a batch of single-use codes for tickets.',
      fields: [
        { k: 'title', label: 'Event', type: 'text', w: 'full', required: true },
        { k: 'cover', label: 'Cover image', type: 'upload', accept: 'image/*', w: 'half' },
        { k: 'start', label: 'Starts', type: 'datetime', w: 'half', required: true },
        { k: 'end', label: 'Ends', type: 'datetime', w: 'half' },
        { k: 'location', label: 'Location', type: 'text', w: 'full' },
        { k: 'text', label: 'Description', type: 'textarea', rows: 4, w: 'full' },
        { k: 'lat', label: 'Latitude', type: 'text', w: 'third', group: 'Map' },
        { k: 'lng', label: 'Longitude', type: 'text', w: 'third', group: 'Map' },
        { k: 'geo', label: 'Find the address', type: 'geosearch', w: 'full', group: 'Map' },
        { k: 'url', label: 'Ticket / info link', type: 'url', w: 'half', group: 'More' },
        { k: 'urlLabel', label: 'Button label', type: 'text', w: 'half', group: 'More' },
        ...THEME_FIELDS
      ],
      build(v) {
        if (!has(v.title)) fail('Give the event a name.');
        if (!has(v.start)) fail('Pick when it starts.');
        const ics = QS.formats.helpers.buildEvent({ title: v.title, start: v.start, end: v.end, location: v.location, description: v.text, url: v.url });
        const fmt = d => (d ? new Date(d).toLocaleString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
        const g = (d, e) => {
          const st = new Date(d), en = e ? new Date(e) : new Date(st.getTime() + 3600000);
          const z = x => x.toISOString().replace(/[-:]|\.\d{3}/g, '');
          return QS.formats.helpers.addParams('https://calendar.google.com/calendar/render', {
            action: 'TEMPLATE', text: trim(v.title), dates: z(st) + '/' + z(en),
            details: trim(v.text), location: trim(v.location)
          });
        };
        const blocks = [
          { t: 'hero', title: trim(v.title), cover: fileURL(v.cover) },
          {
            t: 'event', startText: fmt(v.start), endText: has(v.end) ? '→ ' + fmt(v.end) : '',
            location: trim(v.location), description: trim(v.text), ics, filename: U.slugify(v.title, 'event'),
            gcal: g(v.start, v.end), url: has(v.url) ? QS.formats.helpers.withScheme(v.url) : '', urlLabel: trim(v.urlLabel)
          }
        ];
        if (has(v.lat) && has(v.lng)) blocks.push({ t: 'map', address: trim(v.location), lat: Number(v.lat), lng: Number(v.lng) });
        return { kind: 'page', page: { type: 'event', theme: theme(v), blocks }, title: trim(v.title) };
      }
    },
    {
      id: 'feedback', name: 'Feedback form', group: 'Hosted', icon: 'star', hosted: true, kind: 'page',
      desc: 'Stars and a comment box. Answers land in your statistics.',
      fields: [
        { k: 'title', label: 'Title', type: 'text', w: 'full', required: true },
        { k: 'question', label: 'Question', type: 'text', ph: 'How did we do?', w: 'full' },
        { k: 'text', label: 'Intro text', type: 'textarea', rows: 2, w: 'full' },
        { k: 'askContact', label: 'Ask for an e-mail', type: 'checkbox', w: 'half' },
        { k: 'thanks', label: 'Thank-you text', type: 'text', w: 'half' },
        ...THEME_FIELDS
      ],
      build(v) {
        if (!has(v.title)) fail('Give the form a title.');
        const blocks = [hero(v)];
        if (has(v.text)) blocks.push({ t: 'text', text: v.text });
        blocks.push({ t: 'feedback', question: trim(v.question), askContact: !!v.askContact, thanks: trim(v.thanks) });
        return { kind: 'page', page: { type: 'feedback', theme: theme(v), blocks }, title: trim(v.title) };
      }
    },
    {
      id: 'app', name: 'Smart app link', group: 'Hosted', icon: 'app', hosted: true, kind: 'page',
      desc: 'iPhones go to the App Store, Android to Google Play, everyone else sees both.',
      fields: [
        { k: 'title', label: 'App name', type: 'text', w: 'full', required: true },
        { k: 'logo', label: 'App icon', type: 'upload', accept: 'image/*', w: 'half' },
        { k: 'ios', label: 'App Store link', type: 'url', w: 'full' },
        { k: 'android', label: 'Google Play link', type: 'url', w: 'full' },
        { k: 'other', label: 'Fallback link (web)', type: 'url', w: 'full' },
        { k: 'text', label: 'Description', type: 'textarea', rows: 3, w: 'full' },
        ...THEME_FIELDS
      ],
      build(v) {
        const ios = has(v.ios) ? QS.formats.helpers.withScheme(v.ios) : '';
        const android = has(v.android) ? QS.formats.helpers.withScheme(v.android) : '';
        const other = has(v.other) ? QS.formats.helpers.withScheme(v.other) : '';
        if (!ios && !android && !other) fail('Add at least one store link.');
        const blocks = [hero(v)];
        if (has(v.text)) blocks.push({ t: 'text', text: v.text });
        blocks.push({ t: 'app', ios, android, other });
        return {
          kind: 'page',
          page: { type: 'app', ios, android, other, theme: theme(v), blocks },
          title: trim(v.title)
        };
      }
    },
    {
      id: 'message', name: 'Secret message', group: 'Hosted', icon: 'key', hosted: true, kind: 'page',
      desc: 'A note behind a code. With a scan limit of 1 it can only ever be opened once.',
      fields: [
        { k: 'title', label: 'Title', type: 'text', w: 'full' },
        { k: 'text', label: 'Message', type: 'textarea', rows: 6, w: 'full', required: true },
        { k: 'hide', label: 'Hide behind a tap', type: 'checkbox', w: 'half' },
        ...THEME_FIELDS
      ],
      build(v) {
        if (!has(v.text)) fail('Write the message.');
        const blocks = [hero(v), { t: 'message', text: v.text, hide: !!v.hide, burn: !!v.burn }];
        return { kind: 'page', page: { type: 'message', theme: theme(v), blocks }, title: trim(v.title) || 'Message' };
      }
    },
    {
      id: 'pet', name: 'Pet / property tag', group: 'Hosted', icon: 'heart', hosted: true, kind: 'page',
      desc: 'For a collar or a laptop: whoever finds it scans and can reach you at once.',
      fields: [
        { k: 'photo', label: 'Photo', type: 'upload', accept: 'image/*', w: 'half' },
        { k: 'title', label: 'Name', type: 'text', w: 'half', required: true },
        { k: 'subtitle', label: 'What it is', type: 'text', ph: 'Border collie, 4 years', w: 'full' },
        { k: 'text', label: 'Message to the finder', type: 'textarea', rows: 3, w: 'full' },
        { k: 'phone', label: 'Phone', type: 'tel', w: 'third' },
        { k: 'phone2', label: 'Second phone', type: 'tel', w: 'third' },
        { k: 'email', label: 'E-mail', type: 'email', w: 'third' },
        { k: 'address', label: 'Address (optional)', type: 'text', w: 'full' },
        { k: 'reward', label: 'Reward note', type: 'text', w: 'full', group: 'More' },
        ...THEME_FIELDS
      ],
      build(v) {
        if (!has(v.title)) fail('Enter a name.');
        const rows = [];
        if (has(v.phone)) rows.push({ icon: 'phone', label: 'Call', value: trim(v.phone), href: 'tel:' + QS.formats.helpers.phone(v.phone) });
        if (has(v.phone2)) rows.push({ icon: 'phone', label: 'Call', value: trim(v.phone2), href: 'tel:' + QS.formats.helpers.phone(v.phone2) });
        if (has(v.email)) rows.push({ icon: 'mail', label: 'E-mail', value: trim(v.email), href: 'mailto:' + trim(v.email) });
        if (has(v.address)) rows.push({ icon: 'pin', label: 'Address', value: trim(v.address), href: 'https://maps.google.com/?q=' + encodeURIComponent(trim(v.address)) });
        if (!rows.length) fail('Add at least one way to reach you.');
        const blocks = [hero(v)];
        if (has(v.text)) blocks.push({ t: 'text', text: v.text });
        blocks.push({ t: 'contact', rows });
        if (has(v.reward)) blocks.push({ t: 'text', text: v.reward });
        return { kind: 'page', page: { type: 'pet', theme: theme(v), blocks }, title: trim(v.title) };
      }
    },
    {
      id: 'custom', name: 'Free page', group: 'Hosted', icon: 'file', hosted: true, kind: 'page',
      desc: 'Build a page block by block: text, images, buttons, dividers.',
      fields: [
        { k: 'title', label: 'Title', type: 'text', w: 'full' },
        { k: 'subtitle', label: 'Subtitle', type: 'text', w: 'full' },
        { k: 'cover', label: 'Cover image', type: 'upload', accept: 'image/*', w: 'half' },
        {
          k: 'blocks', label: 'Blocks', type: 'repeat', w: 'full', add: 'Add block', max: 40, required: true,
          fields: [
            { k: 'kind', label: 'Block', type: 'select', w: 'half', options: [
              { v: 'text', l: 'Text' }, { v: 'heading', l: 'Heading' }, { v: 'image', l: 'Image' },
              { v: 'button', l: 'Button' }, { v: 'divider', l: 'Divider' }] },
            { k: 'text', label: 'Text', type: 'textarea', rows: 3, w: 'full', show: b => b.kind === 'text' || !b.kind },
            { k: 'heading', label: 'Heading', type: 'text', w: 'full', show: b => b.kind === 'heading' },
            { k: 'image', label: 'Image', type: 'upload', accept: 'image/*', w: 'full', show: b => b.kind === 'image' },
            { k: 'caption', label: 'Caption', type: 'text', w: 'full', show: b => b.kind === 'image' },
            { k: 'label', label: 'Button label', type: 'text', w: 'half', show: b => b.kind === 'button' },
            { k: 'url', label: 'Button link', type: 'url', w: 'half', show: b => b.kind === 'button' }
          ]
        },
        ...THEME_FIELDS
      ],
      build(v) {
        const blocks = [hero(v)];
        (v.blocks || []).forEach(b => {
          if (!b) return;
          const kind = b.kind || 'text';
          if (kind === 'text' && has(b.text)) blocks.push({ t: 'text', text: b.text });
          else if (kind === 'heading' && has(b.heading)) blocks.push({ t: 'heading', text: b.heading });
          else if (kind === 'image' && fileURL(b.image)) blocks.push({ t: 'image', src: fileURL(b.image), caption: trim(b.caption) });
          else if (kind === 'button' && has(b.url)) blocks.push(buttonRows([{ url: b.url, label: b.label }]));
          else if (kind === 'divider') blocks.push({ t: 'divider' });
        });
        if (blocks.length < 2) fail('Add at least one block.');
        return { kind: 'page', page: { type: 'custom', theme: theme(v), blocks }, title: trim(v.title) || 'Page' };
      }
    }
  ];

  const byId = id => TYPES.find(t => t.id === id);
  function build(typeId, values) {
    const type = byId(typeId);
    if (!type) throw new Error('Unknown page type.');
    return type.build(values || {});
  }

  QS.pages = { TYPES, byId, build, THEME_FIELDS, normaliseSocials };
})();
