/* QR Studio · icons.js
   Two logo sources: a small set of hand-drawn glyphs that ship with the page,
   and brand marks pulled from Simple Icons (CC0) on demand. Everything ends up
   as a plain SVG path string the engine can drop into the middle of a code. */
(function () {
  'use strict';
  const QS = (window.QS = window.QS || {});
  const U = QS.util;

  /* 24×24 glyphs. Holes are separate sub-paths — the engine fills them evenodd. */
  const GLYPHS = {
    link: { name: 'Link', d: 'M9.9 14.1a3.5 3.5 0 0 1 0-4.95l2.12-2.12a3.5 3.5 0 0 1 4.95 4.95l-1.06 1.06-1.41-1.41 1.06-1.06a1.5 1.5 0 0 0-2.12-2.12l-2.12 2.12a1.5 1.5 0 0 0 0 2.12zM14.1 9.9a3.5 3.5 0 0 1 0 4.95l-2.12 2.12a3.5 3.5 0 1 1-4.95-4.95l1.06-1.06 1.41 1.41-1.06 1.06a1.5 1.5 0 1 0 2.12 2.12l2.12-2.12a1.5 1.5 0 0 0 0-2.12z' },
    phone: { name: 'Phone', d: 'M6.6 2.5h3.1l1.6 4.1-2.1 1.4a12.4 12.4 0 0 0 5.6 5.6l1.4-2.1 4.1 1.6v3.1a2.1 2.1 0 0 1-2.3 2.1A17 17 0 0 1 4.5 4.8 2.1 2.1 0 0 1 6.6 2.5z' },
    mail: { name: 'Mail', d: 'M2.5 5h19v14h-19zM4.6 6.6 12 12.2l7.4-5.6z' },
    wifi: { name: 'Wi-Fi', d: 'M12 18.4a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4zM5.4 13.3l1.7 1.8a6.9 6.9 0 0 1 9.8 0l1.7-1.8a9.4 9.4 0 0 0-13.2 0zM1.2 9.1l1.7 1.8a12.8 12.8 0 0 1 18.2 0l1.7-1.8a15.2 15.2 0 0 0-21.6 0z' },
    pin: { name: 'Map pin', d: 'M12 2a7.2 7.2 0 0 0-7.2 7.2C4.8 14.6 12 22 12 22s7.2-7.4 7.2-12.8A7.2 7.2 0 0 0 12 2zm0 9.8a2.6 2.6 0 1 1 0-5.2 2.6 2.6 0 0 1 0 5.2z' },
    calendar: { name: 'Calendar', d: 'M6.5 2.5h2v2h7v-2h2v3.5h-11zM2.5 8h19v13.5h-19zM4.6 10.1h14.8v9.3H4.6z' },
    play: { name: 'Play', d: 'M7.5 4.6 19.5 12 7.5 19.4z' },
    image: { name: 'Image', d: 'M2.5 4.5h19v15h-19zM8.6 9.4a1.7 1.7 0 1 1-3.4 0 1.7 1.7 0 0 1 3.4 0zM4.8 17.4l4.7-5.4 3.1 3.4 3.4-4.2 3.2 6.2z' },
    file: { name: 'Document', d: 'M6 2.2h8.2L19 7v14.8H6zM13.6 3.6v4.1h4.1z' },
    music: { name: 'Music', d: 'M9.2 17.6a2.6 2.6 0 1 1-1.8-2.47V3.9l10.4-2.1v12.4a2.6 2.6 0 1 1-1.8-2.47V6.3L9.2 7.9z' },
    user: { name: 'Person', d: 'M12 3.2a4.3 4.3 0 1 1 0 8.6 4.3 4.3 0 0 1 0-8.6zM3.6 21.2c0-4.3 3.8-7.2 8.4-7.2s8.4 2.9 8.4 7.2z' },
    cart: { name: 'Cart', d: 'M2.4 3.2h3.2l3 11.2h10l2.6-8.4H7.2M9.4 19.6a1.7 1.7 0 1 1 3.4 0 1.7 1.7 0 0 1-3.4 0zM16.2 19.6a1.7 1.7 0 1 1 3.4 0 1.7 1.7 0 0 1-3.4 0z' },
    ticket: { name: 'Ticket', d: 'M2.5 6.5h19v3.2a2.3 2.3 0 0 0 0 4.6v3.2h-19v-3.2a2.3 2.3 0 0 0 0-4.6zM11 9h2v6h-2z' },
    star: { name: 'Star', d: 'M12 2.4l2.9 6 6.6.9-4.8 4.6 1.2 6.5-5.9-3.1-5.9 3.1 1.2-6.5L2.5 9.3l6.6-.9z' },
    heart: { name: 'Heart', d: 'M12 21.2 3.8 13a5 5 0 0 1 7.1-7.1l1.1 1.1 1.1-1.1A5 5 0 0 1 20.2 13z' },
    bolt: { name: 'Bolt', d: 'M13.6 2.2 5.4 13.4h5.2l-1.2 8.4 8.6-11.6h-5.4z' },
    scan: { name: 'Scan', d: 'M2.6 2.6h7v2.6H5.2v4.4H2.6zM14.4 2.6h7v7h-2.6V5.2h-4.4zM2.6 14.4h2.6v4.4h4.4v2.6h-7zM18.8 14.4h2.6v7h-7v-2.6h4.4zM4.2 11h15.6v2H4.2z' },
    home: { name: 'Home', d: 'M12 2.6 22 11h-3v10.4H5V11H2z' },
    gift: { name: 'Gift', d: 'M2.6 8.4h18.8v4H2.6zM4.6 13.4h14.8v8H4.6zM11 8.4h2v13h-2zM8.2 2.6a2.6 2.6 0 0 1 2.2 1.2L12 6.4l1.6-2.6a2.6 2.6 0 1 1 2.2 4H8.2a2.6 2.6 0 0 1 0-5.2z' },
    clock: { name: 'Clock', d: 'M12 2.4a9.6 9.6 0 1 1 0 19.2 9.6 9.6 0 0 1 0-19.2zm0 2.4a7.2 7.2 0 1 0 0 14.4 7.2 7.2 0 0 0 0-14.4zm1 2.6v4.9l3.4 2-1 1.7-4.4-2.6V7.4z' },
    camera: { name: 'Camera', d: 'M9 3.6h6l1.4 2.4h5.1v14.4H2.5V6h5.1zM12 8.6a4.3 4.3 0 1 0 0 8.6 4.3 4.3 0 0 0 0-8.6zm0 2.2a2.1 2.1 0 1 1 0 4.2 2.1 2.1 0 0 1 0-4.2z' },
    key: { name: 'Key', d: 'M14.6 2.4a6.8 6.8 0 1 0-5.3 11.1L2.4 20.4V22h4.2v-2.2h2.2v-2.2h2.2l1.3-1.3a6.8 6.8 0 0 0 2.3-13.9zm1.6 5.6a1.9 1.9 0 1 1-3.8 0 1.9 1.9 0 0 1 3.8 0z' },
    download: { name: 'Download', d: 'M11 2.6h2v9.2h3.6L12 17.2 7.4 11.8H11zM3.6 18.6h16.8v2.8H3.6z' },
    shop: { name: 'Shop', d: 'M3.4 3.4h17.2l1.4 4.6a3 3 0 0 1-5.7 1.4 3 3 0 0 1-5.7 0 3 3 0 0 1-5.7 0 3 3 0 0 1-2.9-1.4zM4.6 11.6h14.8v9.8H4.6zm4 2.6v7.2h6.8v-7.2z' },
    text: { name: 'Text', d: 'M3.5 4.8h17v2.6h-17zM3.5 10.2h17v2.6h-17zM3.5 15.6h11v2.6h-11z' },
    sms: { name: 'Message', d: 'M4 3.5h16A1.5 1.5 0 0 1 21.5 5v10.5A1.5 1.5 0 0 1 20 17H9.2l-4.7 4v-4H4a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 4 3.5zM7.6 8.9a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zm4.4 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zm4.4 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z' },
    contact: { name: 'Contact card', d: 'M2.5 5h19v14h-19zM8 8.1a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6zM4.7 16.7c.4-1.9 1.8-2.9 3.3-2.9s2.9 1 3.3 2.9zM13.5 9h5.5v1.8h-5.5zM13.5 12.4h5.5v1.8h-5.5z' },
    social: { name: 'Share', d: 'M18 2.6a3 3 0 1 1-2.9 3.8L8.9 9.9a3 3 0 0 1 0 4.2l6.2 3.5a3 3 0 1 1-.9 1.7l-6.3-3.6a3 3 0 1 1 0-7.4l6.3-3.6A3 3 0 0 1 18 2.6z' },
    video: { name: 'Video', d: 'M2.5 6h13v12h-13zM16.8 10.3l4.7-3.1v9.6l-4.7-3.1z' },
    app: { name: 'App', d: 'M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z' },
    swiss: { name: 'Swiss cross', d: 'M2.5 2.5h19v19h-19zM10.4 6h3.2v4.4H18v3.2h-4.4V18h-3.2v-4.4H6v-3.2h4.4z' },
    bank: { name: 'Bank', d: 'M12 2.5l9.5 5v2h-19v-2zM4.5 10.8h3v6.7h-3zM10.5 10.8h3v6.7h-3zM16.5 10.8h3v6.7h-3zM2.5 18.5h19v3h-19z' },
    coin: { name: 'Coin', d: 'M12 2.4a9.6 9.6 0 1 1 0 19.2 9.6 9.6 0 0 1 0-19.2zm0 3a6.6 6.6 0 1 0 0 13.2 6.6 6.6 0 0 0 0-13.2zm-1.2 2.8h2.4v7.6h-2.4z' },
    card: { name: 'Card', d: 'M2.5 5h19v14h-19zM2.5 8.2h19v2.6h-19zM5 14.4h5.2v1.8H5z' },
    shield: { name: 'Shield', d: 'M12 2.2l8.5 3.4v6c0 5-3.6 9-8.5 10.4-4.9-1.4-8.5-5.4-8.5-10.4v-6zM10.7 15.6l-3.8-3.8 1.6-1.6 2.2 2.2 4.8-4.8 1.6 1.6z' }
  };

  /* Brand marks people actually ask for; fetched from the CDN when picked. */
  const BRANDS = [
    { slug: 'whatsapp', name: 'WhatsApp', color: '#25D366' },
    { slug: 'instagram', name: 'Instagram', color: '#E4405F' },
    { slug: 'tiktok', name: 'TikTok', color: '#000000' },
    { slug: 'youtube', name: 'YouTube', color: '#FF0000' },
    { slug: 'facebook', name: 'Facebook', color: '#0866FF' },
    { slug: 'x', name: 'X', color: '#000000' },
    { slug: 'linkedin', name: 'LinkedIn', color: '#0A66C2' },
    { slug: 'snapchat', name: 'Snapchat', color: '#FFFC00' },
    { slug: 'telegram', name: 'Telegram', color: '#26A5E4' },
    { slug: 'signal', name: 'Signal', color: '#3A76F0' },
    { slug: 'threema', name: 'Threema', color: '#3FE669' },
    { slug: 'discord', name: 'Discord', color: '#5865F2' },
    { slug: 'twitch', name: 'Twitch', color: '#9146FF' },
    { slug: 'spotify', name: 'Spotify', color: '#1DB954' },
    { slug: 'applemusic', name: 'Apple Music', color: '#FA243C' },
    { slug: 'soundcloud', name: 'SoundCloud', color: '#FF5500' },
    { slug: 'github', name: 'GitHub', color: '#181717' },
    { slug: 'reddit', name: 'Reddit', color: '#FF4500' },
    { slug: 'pinterest', name: 'Pinterest', color: '#BD081C' },
    { slug: 'bluesky', name: 'Bluesky', color: '#0285FF' },
    { slug: 'mastodon', name: 'Mastodon', color: '#6364FF' },
    { slug: 'threads', name: 'Threads', color: '#000000' },
    { slug: 'paypal', name: 'PayPal', color: '#003087' },
    { slug: 'revolut', name: 'Revolut', color: '#000000' },
    { slug: 'bitcoin', name: 'Bitcoin', color: '#F7931A' },
    { slug: 'ethereum', name: 'Ethereum', color: '#3C3C3D' },
    { slug: 'appstore', name: 'App Store', color: '#0D96F6' },
    { slug: 'googleplay', name: 'Google Play', color: '#48FF48' },
    { slug: 'googlemaps', name: 'Google Maps', color: '#4285F4' },
    { slug: 'wifi', name: 'Wi-Fi mark', color: '#000000' },
    { slug: 'strava', name: 'Strava', color: '#FC4C02' },
    { slug: 'vimeo', name: 'Vimeo', color: '#1AB7EA' }
  ];

  const cache = new Map();
  /* Returns {d, viewBox, color} — from the local set or Simple Icons. */
  async function get(slug) {
    if (GLYPHS[slug]) return { d: GLYPHS[slug].d, viewBox: 24, color: null };
    if (cache.has(slug)) return cache.get(slug);
    const p = fetch(QS.CDN.icon(slug))
      .then(r => { if (!r.ok) throw new Error('icon ' + r.status); return r.text(); })
      .then(svg => {
        const d = (/\sd="([^"]+)"/.exec(svg) || [])[1];
        if (!d) throw new Error('icon has no path');
        const vb = (/viewBox="0 0 (\d+) (\d+)"/.exec(svg) || [])[1];
        const brand = BRANDS.find(b => b.slug === slug);
        return { d, viewBox: Number(vb || 24), color: brand ? brand.color : null };
      })
      .catch(err => { cache.delete(slug); throw err; });
    cache.set(slug, p);
    return p;
  }

  /* Small inline preview for the picker buttons. */
  function preview(slug, size = 22, color = 'currentColor') {
    const g = GLYPHS[slug];
    if (g) return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="${g.d}" fill="${color}" fill-rule="evenodd"/></svg>`;
    return `<span class="ico-async" data-icon="${U.esc(slug)}" style="width:${size}px;height:${size}px"></span>`;
  }

  /* Fills in every <span class="ico-async"> inside a container once loaded. */
  async function hydrate(root) {
    const nodes = [...(root || document).querySelectorAll('.ico-async[data-icon]')];
    await Promise.all(nodes.map(async node => {
      if (node.dataset.done) return;
      try {
        const icon = await get(node.dataset.icon);
        node.dataset.done = '1';
        node.innerHTML = `<svg viewBox="0 0 ${icon.viewBox} ${icon.viewBox}" width="100%" height="100%" aria-hidden="true">` +
          `<path d="${U.esc(icon.d)}" fill="${U.esc(node.dataset.color || icon.color || 'currentColor')}" fill-rule="evenodd"/></svg>`;
      } catch (e) {
        node.dataset.done = '1';
        node.textContent = '?';
      }
    }));
  }

  QS.icons = { GLYPHS, BRANDS, get, preview, hydrate, list: () => Object.keys(GLYPHS) };
})();
