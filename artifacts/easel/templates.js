/* Easel — templates. Each template is a list of pages; each page a list of compact descriptors
   that are resolved into fabric JSON (icons/charts are built with the same code as the editor). */
(() => {
const EZ = window.EZ;
const mm = EZ.mm;

/* ── descriptor helpers ── */
const G = (a, b, dir = 'diag') => ({
  type: 'linear', gradientUnits: 'percentage',
  coords: dir === 'v' ? { x1: 0, y1: 0, x2: 0, y2: 1 } : dir === 'h' ? { x1: 0, y1: 0, x2: 1, y2: 0 } : { x1: 0, y1: 0, x2: 1, y2: 1 },
  colorStops: [{ offset: 0, color: a }, { offset: 1, color: b }],
});
const BG = fill => ({ type: 'rect', name: '__bg', left: 0, top: 0, width: 1, height: 1, fill, strokeWidth: 0 });
const R = (x, y, w, h, fill, o = {}) => {
  const { r = 0, ...rest } = o;
  return { type: 'rect', left: x, top: y, width: w, height: h, fill, rx: r, ry: r, strokeWidth: 0, ezType: 'shape', ...rest };
};
const C = (cx, cy, r, fill, o = {}) => ({ type: 'circle', left: cx, top: cy, radius: r, originX: 'center', originY: 'center', fill, strokeWidth: 0, ezType: 'shape', ...o });
const T = (text, x, y, w, size, o = {}) => {
  const { font = 'Inter', weight = 400, color = '#1b1a24', align = 'left', lh = 1.15, cs = 0, italic = false, ...rest } = o;
  return { type: 'textbox', text, left: x, top: y, width: w, fontSize: size, fontFamily: font, fontWeight: weight, fill: color,
    textAlign: align, lineHeight: lh, charSpacing: cs, fontStyle: italic ? 'italic' : 'normal', ezType: 'text', styles: [], ...rest };
};
const SH = (shape, x, y, w, h, fill, o = {}) => ({ shape, x, y, w, h, fill, o });
const IMG = (id, x, y, w, h, o = {}) => ({ photo: id, x, y, w, h, o });
const ICON = (id, cx, cy, size, o = {}) => ({ icon: id, cx, cy, size, o });
const LINE = (x, y, w, o = {}) => ({ type: 'ezLine', left: x, top: y, width: w, stroke: '#1b1a24', strokeWidth: 4, ezType: 'line', ...o });
const CHART = (data, x, y, w) => ({ chart: data, x, y, w });

/* ── the templates ── */
const CARD = { w: mm(85), h: mm(55) };
EZ.TEMPLATES = [
  { id: 'quote', name: 'Bold quote', cat: 'social', w: 1080, h: 1080, pages: [[
    BG(G('#5e17eb', '#ff66c4')),
    C(900, 170, 260, 'rgba(255,255,255,0.08)'), C(140, 960, 210, 'rgba(255,255,255,0.08)'),
    T('“', 96, 40, 300, 320, { font: 'Playfair Display', weight: 900, color: 'rgba(255,255,255,0.35)', lh: 1 }),
    T('Design is not just what it looks like. Design is how it works.', 110, 330, 860, 72, { font: 'Playfair Display', weight: 700, italic: true, color: '#ffffff', lh: 1.12 }),
    R(112, 790, 80, 6, '#ffde59'),
    T('STEVE JOBS', 110, 820, 600, 30, { font: 'Montserrat', weight: 700, color: '#ffffff', cs: 300 }),
    T('@yourhandle', 110, 975, 860, 24, { color: 'rgba(255,255,255,0.7)' }),
  ]] },
  { id: 'coffee', name: 'Coffee promo', cat: 'social', w: 1080, h: 1080, pages: [[
    BG('#1b1a24'),
    IMG(431, 560, 80, 450, 640, { mask: 'arch' }),
    T('FLAT WHITE\nFRIDAY', 70, 110, 520, 112, { font: 'Anton', color: '#f6efe6', lh: 1.02 }),
    T('-30%', 64, 360, 520, 210, { font: 'Anton', color: '#ff5c35', lh: 1 }),
    T('on every coffee, all day long at the corner café.', 74, 620, 420, 30, { font: 'Poppins', color: '#c9c7d6', lh: 1.4 }),
    SH('burst', 900, 790, 220, 220, '#ffde59', { originX: 'center', originY: 'center', angle: 12 }),
    T('TODAY\nONLY', 900, 790, 200, 42, { font: 'Anton', align: 'center', lh: 1, originX: 'center', originY: 'center', angle: 12 }),
    R(70, 870, 300, 66, '#f6efe6', { r: 33 }),
    T('ORDER NOW', 70, 888, 300, 26, { font: 'Poppins', weight: 700, align: 'center', cs: 150 }),
    T('cornercafe.ch', 690, 990, 320, 22, { color: '#9896a8', align: 'right' }),
  ]] },
  { id: 'party', name: 'Summer party', cat: 'social', w: 1080, h: 1350, pages: [[
    BG('#ff5c35'),
    C(1000, 140, 300, '#ffbd59'), C(70, 1260, 260, '#ff914d'),
    T('SUMMER', 60, 150, 960, 260, { font: 'Bebas Neue', color: '#1b1a24', align: 'center', lh: 0.9 }),
    T('PARTY', 60, 380, 960, 260, { font: 'Bebas Neue', color: '#ffffff', align: 'center', lh: 0.9 }),
    ICON('fluent-emoji-flat:party-popper', 540, 780, 230, { mono: false }),
    T('SATURDAY 18 JULY · 20:00', 60, 950, 960, 40, { font: 'Montserrat', weight: 700, align: 'center', cs: 150 }),
    T('Rooftop · Langstrasse 12 · Zürich', 60, 1015, 960, 32, { font: 'Montserrat', color: '#ffffff', align: 'center' }),
    T('Bring your friends. Free entry before 21:00.', 60, 1075, 960, 28, { font: 'Montserrat', align: 'center' }),
  ]] },
  { id: 'travel', name: 'Travel story', cat: 'social', w: 1080, h: 1920, pages: [[
    BG('#1b1a24'),
    IMG(1018, 0, 0, 1080, 1920),
    R(0, 960, 1080, 960, G('rgba(0,0,0,0)', 'rgba(0,0,0,0.78)', 'v')),
    R(70, 130, 230, 64, 'rgba(255,255,255,0.22)', { r: 32 }),
    T('DAY 03', 70, 146, 230, 28, { font: 'Montserrat', weight: 700, color: '#ffffff', align: 'center', cs: 200 }),
    ICON('fluent-emoji-flat:airplane', 900, 200, 180, { mono: false }),
    T('SWISS', 70, 1250, 940, 210, { font: 'Bebas Neue', color: '#ffffff', lh: 0.9 }),
    T('ALPS', 70, 1430, 940, 210, { font: 'Bebas Neue', color: '#ffde59', lh: 0.9 }),
    T('5 days · 4 lakes · 1 very tired me', 74, 1650, 900, 42, { font: 'Poppins', color: '#ffffff' }),
  ]] },
  { id: 'thisorthat', name: 'This or that', cat: 'social', w: 1080, h: 1920, pages: [[
    BG('#f6efe6'),
    R(0, 960, 1080, 960, '#1b1a24'),
    T('THIS', 0, 70, 1080, 150, { font: 'Anton', align: 'center' }),
    IMG(431, 300, 250, 480, 480, { mask: 'circle' }),
    T('Coffee', 0, 752, 1080, 64, { font: 'Pacifico', align: 'center', color: '#ff5c35' }),
    C(540, 960, 80, '#ff5c35'),
    T('OR', 460, 928, 160, 58, { font: 'Anton', align: 'center', color: '#ffffff' }),
    IMG(225, 300, 1070, 480, 480, { mask: 'circle' }),
    T('Tea', 0, 1566, 1080, 64, { font: 'Pacifico', align: 'center', color: '#ffbd59' }),
    T('THAT', 0, 1690, 1080, 150, { font: 'Anton', align: 'center', color: '#ffffff' }),
  ]] },
  { id: 'yt', name: 'YouTube thumbnail', cat: 'social', w: 1280, h: 720, pages: [[
    BG('#ffde59'),
    IMG(1027, 720, 0, 560, 720),
    T('I TRIED IT FOR', 50, 80, 700, 96, { font: 'Anton', lh: 1 }),
    T('30 DAYS', 44, 175, 720, 230, { font: 'Anton', color: '#ff3131', lh: 1, stroke: '#1b1a24', strokeWidth: 18, paintFirst: 'stroke', strokeLineJoin: 'round', effect: { type: 'outline', color: '#1b1a24', amount: 40 } }),
    R(50, 460, 340, 70, '#1b1a24', { r: 12 }),
    T('NO SUGAR', 50, 472, 340, 44, { font: 'Anton', color: '#ffffff', align: 'center' }),
    LINE(430, 520, 250, { strokeWidth: 14, endHead: 'triangle', angle: -18 }),
    ICON('fluent-emoji-flat:fire', 160, 630, 120, { mono: false }),
  ]] },
  { id: 'deck', name: 'Pitch deck', cat: 'slides', w: 1920, h: 1080, pages: [
    [
      BG('#15141c'),
      C(1560, 420, 470, '#ff5c35'), C(1790, 960, 230, '#ffbd59'),
      IMG(1060, 1290, 150, 540, 540, { mask: 'circle' }),
      T('Q3 2026', 140, 200, 800, 36, { font: 'Space Grotesk', weight: 700, color: '#ff8a3d', cs: 300 }),
      T('Growing the\ncorner café', 140, 270, 1100, 150, { font: 'Bricolage Grotesque', weight: 800, color: '#ffffff', lh: 1 }),
      T('Strategy review · Team meeting', 140, 640, 900, 40, { color: '#9896a8' }),
    ],
    [
      BG('#f6efe6'),
      T('Agenda', 140, 110, 1000, 96, { font: 'Bricolage Grotesque', weight: 800 }),
      ...[['Where we are', 'Numbers, guests and what the first quarter taught us.', 'lucide:map-pin'],
        ['What we learned', 'Three experiments, two surprises and one clear winner.', 'lucide:lightbulb'],
        ['What comes next', 'The plan for autumn, who owns what, and the budget.', 'lucide:rocket']].flatMap(([t, d, ic], i) => {
        const x = 140 + i * 560;
        return [
          R(x, 320, 500, 580, '#ffffff', { r: 28 }),
          ICON(ic, x + 105, 425, 90, { color: '#ff5c35' }),
          T('0' + (i + 1), x + 300, 380, 150, 34, { font: 'Space Mono', color: '#b9b5c9', align: 'right' }),
          T(t, x + 60, 540, 380, 46, { font: 'Bricolage Grotesque', weight: 800, lh: 1.05 }),
          T(d, x + 60, 610, 380, 28, { color: '#6c6a7d', lh: 1.45 }),
        ];
      }),
    ],
    [
      BG('#ff5c35'),
      T('+48%', 140, 230, 900, 300, { font: 'Bricolage Grotesque', weight: 800, color: '#ffffff', lh: 1 }),
      T('more regulars since we launched the loyalty card in March.', 150, 570, 760, 48, { color: '#ffffff', lh: 1.3 }),
      CHART({ type: 'column', rows: [['Mar', 120], ['Apr', 138], ['May', 150], ['Jun', 161], ['Jul', 170], ['Aug', 178]], text: '#ffffff', colors: ['#ffffff'], mono: true, font: 'Inter', values: true }, 1040, 260, 740),
    ],
  ] },
  { id: 'jazz', name: 'Event poster', cat: 'print', w: mm(210), h: mm(297), mm: [210, 297], pages: [[
    BG('#15141c'),
    C(560, 300, 300, '#ff5c35'), C(230, 520, 170, '#ffbd59'),
    ICON('fluent-emoji-flat:musical-notes', 560, 300, 230, { mono: false }),
    T('JAZZ', 40, 600, 714, 250, { font: 'Anton', color: '#ffffff', lh: 0.9 }),
    T('NIGHT', 44, 820, 714, 110, { font: 'Anton', color: '#ff5c35', lh: 0.9, cs: 120 }),
    T('LIVE AT THE KELLER · FRIDAY 03.10 · DOORS 19:30', 44, 965, 714, 20, { font: 'Montserrat', weight: 700, color: '#c9c7d6', cs: 150 }),
    R(44, 1012, 706, 2, '#34333f'),
    T('Tickets CHF 15 at the door · keller-bar.ch', 44, 1030, 714, 17, { color: '#9896a8' }),
  ]] },
  { id: 'yoga', name: 'Minimal flyer', cat: 'print', w: mm(148), h: mm(210), mm: [148, 210], pages: [[
    BG('#f6efe6'),
    IMG(1015, 60, 56, 439, 420, { mask: 'arch' }),
    T('Yoga in the park', 60, 505, 439, 54, { font: 'Fraunces', weight: 700, lh: 1.02 }),
    T('EVERY SUNDAY · 09:00 – 10:30', 60, 630, 439, 16, { font: 'Montserrat', weight: 700, color: '#ff5c35', cs: 120 }),
    T('Bring a mat and a friend. All levels welcome, free of charge.', 60, 662, 360, 15, { color: '#6c6a7d', lh: 1.5 }),
    C(470, 720, 44, '#ffbd59'),
    T('FREE', 426, 708, 88, 20, { font: 'Anton', align: 'center' }),
  ]] },
  { id: 'card', name: 'Business card', cat: 'print', w: CARD.w, h: CARD.h, mm: [85, 55], pages: [[
    BG('#15141c'),
    R(0, 0, 9, CARD.h, '#ff5c35'),
    T('Alex Muster', 28, 34, 270, 25, { font: 'Bricolage Grotesque', weight: 800, color: '#ffffff' }),
    T('DESIGNER & DEVELOPER', 28, 68, 270, 9.5, { weight: 700, color: '#ff8a3d', cs: 150 }),
    ICON('lucide:mail', 35, 132, 11, { color: '#9896a8' }), T('alex@example.ch', 48, 125, 240, 10.5, { color: '#c9c7d6' }),
    ICON('lucide:phone', 35, 153, 11, { color: '#9896a8' }), T('+41 79 000 00 00', 48, 146, 240, 10.5, { color: '#c9c7d6' }),
    ICON('lucide:globe', 35, 174, 11, { color: '#9896a8' }), T('example.ch', 48, 167, 240, 10.5, { color: '#c9c7d6' }),
  ]] },
  { id: 'invite', name: 'Birthday invite', cat: 'print', w: mm(148), h: mm(210), mm: [148, 210], pages: [[
    BG(G('#ffe1ec', '#fff4d6')),
    ICON('fluent-emoji-flat:balloon', 100, 120, 130, { mono: false, angle: -12 }),
    ICON('fluent-emoji-flat:balloon', 465, 110, 110, { mono: false, angle: 10 }),
    ICON('fluent-emoji-flat:birthday-cake', 280, 245, 160, { mono: false }),
    T('You’re invited', 40, 360, 479, 62, { font: 'Great Vibes', color: '#cb6ce6', align: 'center' }),
    T('MIA TURNS 10', 40, 445, 479, 46, { font: 'Luckiest Guy', align: 'center', cs: 50 }),
    R(150, 515, 259, 4, '#ff66c4', { r: 2 }),
    T('Saturday, 14 November · 14:00\nMusterweg 5, 8000 Zürich', 40, 545, 479, 18, { font: 'Quicksand', weight: 700, align: 'center', lh: 1.6 }),
    T('Please let us know by 7 November', 40, 700, 479, 14, { font: 'Quicksand', color: '#6c6a7d', align: 'center' }),
  ]] },
  { id: 'worksheet', name: 'Worksheet', cat: 'school', w: mm(210), h: mm(297), mm: [210, 297], pages: [[
    BG('#ffffff'),
    R(0, 0, mm(210), 124, '#5271ff'),
    T('Arbeitsblatt', 50, 28, 520, 42, { font: 'Bricolage Grotesque', weight: 800, color: '#ffffff' }),
    T('MATHEMATIK · KAPITEL 3', 52, 80, 520, 14, { weight: 700, color: 'rgba(255,255,255,0.85)', cs: 150 }),
    ICON('fluent-emoji-flat:pencil', 712, 62, 78, { mono: false }),
    T('Name:', 50, 152, 80, 15, { weight: 700 }), LINE(108, 168, 330, { stroke: '#b9b5c9', strokeWidth: 1.5 }),
    T('Datum:', 470, 152, 80, 15, { weight: 700 }), LINE(530, 168, 214, { stroke: '#b9b5c9', strokeWidth: 1.5 }),
    ...['Berechne: 3/4 + 5/6 = ?',
      'Ein Velo kostet CHF 480. Es wird um 15 % reduziert. Wie viel kostet es jetzt?',
      'Löse die Gleichung: 4x − 7 = 21',
      'Erkläre in eigenen Worten, was ein Bruch ist.'].flatMap((q, i) => {
      const y = 225 + i * 210;
      return [
        C(68, y + 11, 17, '#5271ff'),
        T(String(i + 1), 51, y + 1, 34, 17, { weight: 800, color: '#ffffff', align: 'center' }),
        T(q, 100, y, 640, 16, { lh: 1.4 }),
        LINE(100, y + 70, 644, { stroke: '#dedbe7', strokeWidth: 1.5 }),
        LINE(100, y + 115, 644, { stroke: '#dedbe7', strokeWidth: 1.5 }),
        LINE(100, y + 160, 644, { stroke: '#dedbe7', strokeWidth: 1.5 }),
      ];
    }),
    T('Punkte: _____ / 20', 50, 1068, 694, 13, { color: '#6c6a7d', align: 'right' }),
  ]] },
  { id: 'lerndoku', name: 'Report cover', cat: 'school', w: mm(210), h: mm(297), mm: [210, 297], pages: [[
    BG('#f6efe6'),
    C(794, 0, 380, '#ff5c35'), C(0, 1123, 300, '#1b1a24'),
    R(640, 820, 150, 150, '#ffbd59', { angle: 15, originX: 'center', originY: 'center' }),
    T('LERNDOKUMENTATION', 60, 380, 674, 18, { font: 'Montserrat', weight: 700, color: '#ff5c35', cs: 400 }),
    T('Stromstoss-\nschaltung', 60, 418, 674, 80, { font: 'Fraunces', weight: 900, lh: 1 }),
    T('Elektroinstallateur/in EFZ · 1. Lehrjahr', 62, 600, 600, 18, { color: '#6c6a7d' }),
    T('Vorname Nachname', 62, 812, 400, 20, { weight: 700 }),
    R(62, 846, 400, 1.5, '#1b1a24'),
    T('NAME', 62, 856, 400, 11, { color: '#6c6a7d', weight: 700, cs: 200 }),
    T('3a', 62, 902, 180, 20, { weight: 700 }), R(62, 936, 180, 1.5, '#1b1a24'), T('KLASSE', 62, 946, 180, 11, { color: '#6c6a7d', weight: 700, cs: 200 }),
    T('27.09.2026', 282, 902, 180, 20, { weight: 700 }), R(282, 936, 180, 1.5, '#1b1a24'), T('DATUM', 282, 946, 180, 11, { color: '#6c6a7d', weight: 700, cs: 200 }),
  ]] },
  { id: 'infographic', name: 'Infographic', cat: 'school', w: 800, h: 2000, pages: [[
    BG('#15141c'),
    T('OUR CLASS', 60, 80, 680, 118, { font: 'Anton', color: '#0cc0df', lh: 1 }),
    T('in numbers', 64, 200, 680, 58, { font: 'Fraunces', italic: true, color: '#ffffff' }),
    T('A quick look at class 3a — who we are and what we like.', 64, 290, 600, 24, { color: '#9896a8', lh: 1.4 }),
    ...[['24', 'students, 13 girls and 11 boys', 'fluent-emoji-flat:graduation-cap'],
      ['7', 'languages spoken at home', 'fluent-emoji-flat:globe-showing-europe-africa'],
      ['12', 'projects finished this year', 'fluent-emoji-flat:light-bulb']].flatMap(([n, d, ic], i) => {
      const y = 400 + i * 290;
      return [
        R(60, y, 680, 250, '#1f1e29', { r: 24 }),
        ICON(ic, 160, y + 125, 110, { mono: false }),
        T(n, 250, y + 40, 460, 96, { font: 'Anton', color: '#ffffff', lh: 1 }),
        T(d, 252, y + 150, 440, 24, { color: '#c9c7d6', lh: 1.35 }),
      ];
    }),
    T('Favourite subjects', 60, 1300, 680, 36, { font: 'Bricolage Grotesque', weight: 800, color: '#ffffff' }),
    CHART({ type: 'bar', rows: [['Sport', 9], ['Math', 6], ['ICT', 5], ['German', 3], ['Art', 1]], text: '#ffffff', font: 'Inter', values: true }, 60, 1370, 680),
    T('Survey of class 3a, September 2026', 60, 1900, 680, 18, { color: '#6c6a7d' }),
  ]] },
];

/* ── resolve descriptors into fabric JSON ── */
const pathCache = new Map();
const pathBox = d => { if (!pathCache.has(d)) { const p = new fabric.Path(d); pathCache.set(d, { w: p.width, h: p.height }); } return pathCache.get(d); };
function clipJSON(mask, w, h, r) {
  if (mask === 'circle') return { type: 'ellipse', rx: w / 2, ry: h / 2, originX: 'center', originY: 'center', left: 0, top: 0 };
  const d = EZ.MASK_PATHS[mask];
  if (d) { const b = pathBox(d); return { type: 'path', path: d, originX: 'center', originY: 'center', left: 0, top: 0, strokeWidth: 0, scaleX: w / b.w, scaleY: h / b.h }; }
  if (r) return { type: 'rect', width: w, height: h, rx: r, ry: r, originX: 'center', originY: 'center', left: 0, top: 0 };
  return null;
}
async function resolve(d) {
  if (d.photo) {
    const { mask = 'none', radius = 0, ...rest } = d.o;
    const nw = Math.round(d.w), nh = Math.round(d.h);
    const o = { type: 'image', src: `https://picsum.photos/id/${d.photo}/${nw}/${nh}`, crossOrigin: 'anonymous',
      left: d.x, top: d.y, width: nw, height: nh, scaleX: d.w / nw, scaleY: d.h / nh,
      ezType: 'frame', ezData: { filled: true, frame: mask }, ezMask: mask, ezRadius: radius, ...rest };
    const clip = clipJSON(mask, nw, nh, radius);
    if (clip) o.clipPath = clip;
    return o;
  }
  if (d.shape) {
    const s = EZ.SHAPES.find(x => x.id === d.shape);
    const b = pathBox(s.d);
    return { type: 'path', path: s.d, left: d.x, top: d.y, scaleX: d.w / b.w, scaleY: d.h / b.h, fill: d.fill, strokeWidth: 0, ezType: 'shape', ezData: { shape: d.shape }, ...d.o };
  }
  if (d.icon) {
    const mono = d.o.mono !== false;
    try {
      let svg = await EZ.fetchIconSvg(d.icon);
      if (mono) svg = svg.replace(/currentColor/g, d.o.color || '#1b1a24');
      const o = await new Promise(r => fabric.loadSVGFromString(svg, (objs, opts) => r(objs?.length ? fabric.util.groupSVGElements(objs, opts) : null)));
      if (!o) return null;
      o.set({ ezType: mono ? 'icon' : 'sticker', ezData: { icon: d.icon, mono }, angle: d.o.angle || 0 });
      o.scale(d.size / Math.max(o.width, o.height));
      o.setPositionByOrigin(new fabric.Point(d.cx, d.cy), 'center', 'center');
      return o.toObject(EZ.PROPS);
    } catch (e) { console.warn('template icon', d.icon, e); return null; }
  }
  if (d.chart) {
    await EZ.loadFont(d.chart.font || 'Inter', 700);
    const g = EZ.makeChart(d.chart);
    g.scale(d.w / g.width);
    g.set({ left: d.x, top: d.y });
    return g.toObject(EZ.PROPS);
  }
  return d;
}
const built = new Map();
let iconsReady = null; // every icon used by any template, fetched in one batch per icon set
const preloadIcons = () => iconsReady ||= EZ.loadIcons(EZ.TEMPLATES.flatMap(t => t.pages.flat().filter(d => d.icon).map(d => d.icon)));
EZ.buildTemplate = tpl => {
  if (!built.has(tpl.id)) {
    built.set(tpl.id, (async () => {
      await preloadIcons();
      const pages = [];
      for (const page of tpl.pages) {
        const objects = (await Promise.all(page.map(resolve))).filter(Boolean);
        const bg = objects.find(o => o.name === '__bg');
        if (bg) Object.assign(bg, { width: tpl.w, height: tpl.h });
        pages.push({ version: fabric.version, objects });
      }
      return pages;
    })());
    built.get(tpl.id).catch(() => built.delete(tpl.id));
  }
  return built.get(tpl.id).then(p => JSON.parse(JSON.stringify(p)));
};
const thumbs = new Map();
EZ.templateThumb = tpl => {
  if (!thumbs.has(tpl.id)) thumbs.set(tpl.id, EZ.buildTemplate(tpl).then(pages => EZ.pageThumb(pages[0], 360, tpl.w, tpl.h)));
  return thumbs.get(tpl.id);
};
})();
