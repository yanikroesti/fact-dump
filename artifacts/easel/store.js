/* Easel — local storage: IndexedDB for designs and image assets.
   Images live as blobs in the "assets" store and are referenced from designs as "asset:<id>",
   so design JSON and undo snapshots stay small. Falls back to memory if IndexedDB is blocked. */
(() => {
const EZ = window.EZ;

let dbp = null;
const mem = { designs: new Map(), assets: new Map() };
function open() {
  if (dbp) return dbp;
  dbp = new Promise(resolve => {
    try {
      const req = indexedDB.open('easel', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('designs')) db.createObjectStore('designs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { console.warn('IndexedDB unavailable', req.error); resolve(null); };
      req.onblocked = () => resolve(null);
    } catch (e) { console.warn('IndexedDB unavailable', e); resolve(null); }
  });
  return dbp;
}
const tx = async (store, mode, fn) => {
  const db = await open();
  if (!db) return fn(null, mem[store]);
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const r = fn(s);
    if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
};
EZ.db = {
  get: (store, id) => tx(store, 'readonly', (s, m) => m ? m.get(id) : s.get(id)),
  put: (store, v) => tx(store, 'readwrite', (s, m) => m ? m.set(v.id, v) : s.put(v)),
  del: (store, id) => tx(store, 'readwrite', (s, m) => m ? m.delete(id) : s.delete(id)),
  all: (store) => tx(store, 'readonly', (s, m) => m ? [...m.values()] : s.getAll()),
  persistent: async () => !!(await open()),
};

/* ── assets ── */
EZ.assets = new Map();       // id -> object URL
EZ.assetIdByUrl = new Map(); // object URL -> id
EZ.assetMeta = new Map();    // id -> {w,h,type}

function register(id, blob, meta) {
  if (EZ.assets.has(id)) return EZ.assets.get(id);
  const url = URL.createObjectURL(blob);
  EZ.assets.set(id, url);
  EZ.assetIdByUrl.set(url, id);
  EZ.assetMeta.set(id, meta || {});
  return url;
}

// Store a blob; returns {id, url}. meta: {w, h, upload:boolean, name}
EZ.addAsset = async (blob, meta = {}) => {
  const id = 'a' + EZ.uid();
  const rec = { id, blob, type: blob.type, w: meta.w || 0, h: meta.h || 0, upload: !!meta.upload, name: meta.name || '', created: Date.now() };
  try { await EZ.db.put('assets', rec); } catch (e) { console.warn('asset not persisted', e); }
  const url = register(id, blob, rec);
  return { id, url };
};
EZ.assetIdsIn = str => [...new Set([...String(str).matchAll(/asset:(a[a-z0-9]+)/g)].map(m => m[1]))];
EZ.ensureAssets = async ids => {
  await Promise.all(ids.filter(id => !EZ.assets.has(id)).map(async id => {
    const rec = await EZ.db.get('assets', id).catch(() => null);
    if (rec?.blob) register(id, rec.blob, rec);
  }));
};
EZ.assetBlob = async id => (await EZ.db.get('assets', id).catch(() => null))?.blob || null;
EZ.listUploads = async () => (await EZ.db.all('assets').catch(() => [])).filter(a => a.upload).sort((a, b) => b.created - a.created);
EZ.deleteAsset = id => EZ.db.del('assets', id);

// Fabric integration: resolve "asset:<id>" when loading, write it back when serializing.
const MISSING = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#eeedf3"/><text x="200" y="158" font-family="sans-serif" font-size="18" fill="#9896a8" text-anchor="middle">image missing</text></svg>');
const origLoad = fabric.util.loadImage;
fabric.util.loadImage = function (url, callback, context, crossOrigin) {
  if (typeof url === 'string' && url.startsWith('asset:')) url = EZ.assets.get(url.slice(6)) || MISSING;
  return origLoad.call(this, url, callback, context, crossOrigin);
};
const origGetSrc = fabric.Image.prototype.getSrc;
fabric.Image.prototype.getSrc = function (filtered) {
  const s = origGetSrc.call(this, filtered);
  if (typeof s === 'string' && s.startsWith('blob:')) {
    const id = EZ.assetIdByUrl.get(s);
    if (id) return 'asset:' + id;
  }
  return s;
};

// Downscale huge images and turn any image source into a stored asset.
EZ.importImageBlob = async (blob, { upload = true, name = '', maxSide = 2560 } = {}) => {
  const bmp = await createImageBitmap(blob).catch(() => null);
  if (!bmp) throw new Error('Could not read that image.');
  let { width: w, height: h } = bmp;
  let out = blob;
  const isSvg = blob.type === 'image/svg+xml';
  if (!isSvg && (Math.max(w, h) > maxSide || blob.size > 6e6)) {
    const s = Math.min(1, maxSide / Math.max(w, h));
    w = Math.round(w * s); h = Math.round(h * s);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    const keepAlpha = /png|webp|gif/.test(blob.type);
    out = await new Promise(r => c.toBlob(r, keepAlpha ? 'image/png' : 'image/jpeg', 0.9));
  }
  bmp.close?.();
  return { ...(await EZ.addAsset(out, { w, h, upload, name })), w, h };
};

/* ── designs ── */
EZ.listDesigns = async () => (await EZ.db.all('designs').catch(() => [])).sort((a, b) => b.updated - a.updated);
EZ.getDesign = id => EZ.db.get('designs', id);
EZ.putDesign = d => EZ.db.put('designs', d);
EZ.deleteDesign = id => EZ.db.del('designs', id);
})();
