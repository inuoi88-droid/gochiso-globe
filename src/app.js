(() => {
'use strict';
const D = window.GLOBE_DATA;
const $ = s => document.querySelector(s);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TAU = Math.PI * 2, RAD = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('gg-' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('gg-' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
};

/* ---------------- data ---------------- */
const placeById = new Map();
D.places.forEach(p => { p.type = 'place'; placeById.set(p.id, p); });
D.cities.forEach((c, i) => { c.type = 'city'; c.key = 'c' + i; c.lp = [c.lon, c.lat]; c.country = placeById.get(c.c); });
const citiesOf = id => D.cities.filter(c => c.c === id);
const topo = D.topo;
const fc = topojson.feature(topo, topo.objects.countries);
const geoms = topo.objects.countries.geometries;
const featById = new Map(fc.features.map(f => [f.id, f]));
// five-colour political palette via greedy colouring of neighbours
const neigh = topojson.neighbors(geoms);
const colorOf = new Array(geoms.length).fill(-1);
geoms.map((g, i) => i).sort((a, b) => neigh[b].length - neigh[a].length).forEach(i => {
  const used = new Set(neigh[i].map(j => colorOf[j]));
  let c = (i * 7) % 5, n = 0;
  while (used.has(c) && n < 5) { c = (c + 1) % 5; n++; }
  colorOf[i] = c;
});
const classFC = [0, 1, 2, 3, 4].map(k => ({ type: 'FeatureCollection', features: fc.features.filter((f, i) => colorOf[i] === k) }));
// clean meshes: drop artificial edges along the antimeridian and the south pole
function cleanMesh(m) {
  const out = [];
  const bad = (a, b) => (Math.abs(a[0]) > 179.99 && Math.abs(b[0]) > 179.99) || (a[1] < -89.9 && b[1] < -89.9);
  for (const line of m.coordinates) {
    let cur = [line[0]];
    for (let i = 1; i < line.length; i++) {
      if (bad(line[i - 1], line[i])) { if (cur.length > 1) out.push(cur); cur = [line[i]]; }
      else cur.push(line[i]);
    }
    if (cur.length > 1) out.push(cur);
  }
  return { type: 'MultiLineString', coordinates: out };
}
const borders = cleanMesh(topojson.mesh(topo, topo.objects.countries, (a, b) => a !== b));
const coast = cleanMesh(topojson.mesh(topo, topo.objects.countries, (a, b) => a === b));
const graticule = d3.geoGraticule().step([15, 15])();
const equator = { type: 'LineString', coordinates: d3.range(-180, 181, 3).map(l => [l, 0]) };
const tropics = { type: 'MultiLineString', coordinates: [23.44, -23.44].map(la => d3.range(-180, 181, 3).map(l => [l, la])) };
const fbounds = fc.features.map(f => ({ f, b: d3.geoBounds(f) }));
const disputed = fc.features.filter(f => placeById.get(f.id) && placeById.get(f.id).disp);
const labelPlaces = D.places.filter(p => !p.pt).sort((a, b) => b.a - a.a);
const markerPlaces = D.places.filter(p => p.a < 1.5e-5 && (p.un || (p.d && p.d.length)));
const shufflePlaces = D.places.filter(p => p.d && p.d.length);
const REGIONS = ['東アジア', '東南アジア', '南アジア', '中央アジア', '中東', 'コーカサス', 'ヨーロッパ', 'アフリカ', '北中米', 'カリブ', '南米', 'オセアニア'];
const OCEANS = [
  ['太平洋', -150, 2, 0, 20], ['太平洋', 165, 22, 1.6, 18], ['大西洋', -35, 12, 0, 19], ['大西洋', -18, -28, 1.6, 17],
  ['インド洋', 78, -22, 0, 18], ['北極海', 10, 83, 0, 15], ['南極海', 40, -62, 0, 15],
  ['日本海', 134.5, 40.5, 2.4, 13], ['東シナ海', 125.5, 29, 3, 12], ['南シナ海', 114, 13, 2.4, 13], ['オホーツク海', 150, 54.5, 2.4, 13],
  ['フィリピン海', 132, 20, 2.4, 13], ['ベンガル湾', 88, 15, 2.4, 13], ['アラビア海', 64, 15, 2.2, 13], ['地中海', 18, 34.5, 2.4, 13],
  ['カリブ海', -75, 15, 2.2, 13], ['メキシコ湾', -90, 25.5, 2.4, 13], ['黒海', 34.5, 43.3, 3.2, 12], ['カスピ海', 51, 42, 3.2, 12],
  ['紅海', 38.5, 20, 3.4, 12], ['北海', 3, 56, 3.2, 12], ['バルト海', 19.5, 57.5, 3.2, 12], ['タスマン海', 160, -38, 2.4, 13],
  ['ベーリング海', -178, 58, 2.4, 13], ['珊瑚海', 155, -16, 2.4, 13], ['ハドソン湾', -85, 60, 2.4, 13], ['ペルシア湾', 51.5, 27, 3.8, 11]
];

/* ---------------- theme tokens ---------------- */
let C = {}, hatch = null;
function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const g = n => cs.getPropertyValue('--' + n).trim();
  C = {
    sea1: g('sea-1'), sea2: g('sea-2'), seaInk: g('sea-ink'), grat: g('grat'), shade: g('shade'), glow: g('glow'),
    land: [g('land-1'), g('land-2'), g('land-3'), g('land-4'), g('land-5')],
    border: g('border'), coast: g('coast'), hover: g('hover'), hilite: g('hilite'), target: g('target'),
    halo: g('halo'), label: g('label'), ink: g('ink'), brass: g('brass-hi'), panel: g('panel'), ok: g('ok'), ng: g('ng'),
    fBody: g('f-body'), fDisp: g('f-display'),
    hist: [0, 1, 2, 3, 4, 5, 6, 7].map(k => g('h-' + k)), hNone: g('h-none'), hLine: g('h-line'), hGroup: g('h-group'), hModern: g('h-modern')
  };
  const pc = document.createElement('canvas'); pc.width = pc.height = 8;
  const px = pc.getContext('2d'); px.strokeStyle = C.coast; px.globalAlpha = .55; px.lineWidth = 1.2;
  px.beginPath(); px.moveTo(-2, 10); px.lineTo(10, -2); px.moveTo(6, 10); px.lineTo(10, 6); px.moveTo(-2, 2); px.lineTo(2, -2); px.stroke();
  hatch = ctx.createPattern(pc, 'repeat');
  dirty = true;
}

/* ---------------- canvas & projection ---------------- */
const stage = $('#stage'), canvas = $('#globe'), ctx = canvas.getContext('2d');
const DPR = Math.min(2, window.devicePixelRatio || 1);
let W = 300, H = 300, R0 = 120, dirty = true;
const projGlobe = d3.geoOrthographic().clipAngle(90).precision(0.7);
const projFlat = d3.geoNaturalEarth1().precision(0.7);
// size of the whole flat map at scale 1, used to fit it to the stage at zoom 1
const FLAT_BOX = d3.geoPath(d3.geoNaturalEarth1().scale(1).translate([0, 0])).bounds({ type: 'Sphere' });
const FLAT_W = FLAT_BOX[1][0] - FLAT_BOX[0][0], FLAT_H = FLAT_BOX[1][1] - FLAT_BOX[0][1];
let flat = store.get('flat', false);
let projection = flat ? projFlat : projGlobe;
const path = d3.geoPath(projection, ctx);
let rot = [-136, -28], zoom = 1;
const ZMIN = 0.75, ZMAX = 14;
// Large, high-density screens are capped to a pixel budget so a frame costs about the
// same on a PC as on a phone; while the globe spins fast the budget drops further.
const PX_REST = 2.2e6, PX_SPIN = 0.9e6;
let pxBudget = PX_REST, RDPR = DPR;
function applyRes() {
  RDPR = Math.min(DPR, Math.sqrt(pxBudget / (W * H)));
  const cw = Math.round(W * RDPR), ch = Math.round(H * RDPR);
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  dirty = true;
}
function setBudget(b) { if (b !== pxBudget) { pxBudget = b; applyRes(); } }
function resize() {
  const r = stage.getBoundingClientRect();
  W = Math.max(200, r.width); H = Math.max(200, r.height);
  R0 = Math.min(W, H) * 0.42;
  applyRes();
}
new ResizeObserver(resize).observe(stage);
resize();
readTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readTheme);
new MutationObserver(readTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
const mcache = new Map();
function mw(font, text) {
  const k = font + '|' + text; let v = mcache.get(k);
  if (v === undefined) { ctx.font = font; v = ctx.measureText(text).width; mcache.set(k, v); }
  return v;
}
if (document.fonts) document.fonts.ready.then(() => { mcache.clear(); dirty = true; });

const center = () => [-rot[0], -rot[1]];
// On the globe a point is visible when it is on the near side; on the flat map, when it is on the stage.
function visible(lp, c, m = 0.06) {
  if (!flat) return d3.geoDistance(lp, c) < Math.PI / 2 - m;
  const q = projection(lp);
  return !!q && q[0] > -40 && q[0] < W + 40 && q[1] > -40 && q[1] < H + 40;
}
function applyView() {
  if (!flat) { projection.rotate([rot[0], rot[1], 0]).scale(R0 * zoom).translate([W / 2, H / 2]); return; }
  // flat map: longitude scrolls freely; latitude pans until the map edge reaches the stage edge
  const s = Math.min(W * 0.96 / FLAT_W, H * 0.96 / FLAT_H) * zoom;
  projFlat.rotate([rot[0], 0, 0]).scale(s).translate([W / 2, H / 2]);
  const yc = projFlat([-rot[0], -rot[1]])[1];
  const half = FLAT_H / 2 * s;
  let ty = H / 2 + (H / 2 - yc);
  ty = 2 * half <= H ? H / 2 : clamp(ty, H - half, half);
  projFlat.translate([W / 2, ty]);
  if (Math.abs(ty - (H / 2 + (H / 2 - yc))) > 0.5) { const ll = projFlat.invert([W / 2, H / 2]); if (ll) rot[1] = -ll[1]; }
}
const scaleNow = () => projection.scale();
function setFlat(v) {
  if (v === flat) return;
  flat = v; store.set('flat', v);
  projection = v ? projFlat : projGlobe;
  path.projection(projection);
  if (v) { rot[1] = clamp(rot[1], -60, 60); }
  $('#t-auto').hidden = v;   // the flat map does not turn by itself
  document.querySelectorAll('[data-shape]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.shape === 'flat') === v)));
  canvas.setAttribute('aria-label', v ? '世界地図。ドラッグで移動、ホイールやピンチで拡大、クリックで国や都市を選択' : '回せる地球儀。ドラッグで回転、ホイールやピンチで拡大、クリックで国や都市を選択');
  $('#stage').setAttribute('aria-label', v ? '世界地図' : '地球儀');
  dirty = true;
}

/* ---------------- state ---------------- */
let mode = 'explore';          // explore | quiz | battle (modern, food) | hist | hquiz (history)
let world = 'modern';          // modern | history | food: chosen from the ⋯ menu
// time-slip state; the map data loads the first time the mode is opened
const TS = {
  idx: null, P: [], events: [], loading: null, err: '',
  year: 1, chunks: new Map(), cur: null, curYear: 0,
  sel: null, modern: false, play: null, speed: 'normal',
  cmp: false, cmpYear: 1000, cmpX: 0.5, cmpCur: null,
  cards: new Set(store.get('h-cards', [])), newCard: '', geoCache: new Map()
};
let sel = null;                // selected place or city (explore)
let hoverId = null;
let showLabels = true, showCities = true, autoSpin = !REDUCED;
let spinning = false;          // spin or landing zoom running (input blocked)
let spinPhase = '';            // 'spin' | 'zoom' | ''
let needleName = '', needleMask = false;
const idleView = () => ({ state: 'idle', loc: null, hideName: false, hideLoc: false, ok: null });
// What the globe shows for an active question. Solo quiz and battle each keep their own.
function curView() {
  if (mode === 'quiz' && SQ.view.state !== 'idle' && SQ.view.loc) return SQ.view;
  if (mode === 'battle' && B.view.state !== 'idle' && B.view.loc) return B.view;
  return null;
}
const viewAsking = v => !!v && (v.state === 'spinning' || v.state === 'asking');
const nowAsking = () => viewAsking(curView());

/* ---------------- drawing ---------------- */
const placed = [];
function hit(r) { for (const q of placed) if (r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y) return true; return false; }
function label(text, x, y, size, opt = {}) {
  const font = `${opt.weight || 500} ${size}px ${opt.family || C.fBody}`;
  const w = mw(font, text);
  const align = opt.align || 'center';
  const x0 = align === 'left' ? x : x - w / 2;
  const r = { x: x0 - 3, y: y - size / 2 - 2, w: w + 6, h: size + 4 };
  if (!opt.force) {
    if (r.x < 2 || r.x + r.w > W - 2 || r.y < 2 || r.y + r.h > H - 2) return false;
    if (hit(r)) return false;
  }
  placed.push(r);
  ctx.font = font; ctx.textAlign = align; ctx.textBaseline = 'middle';
  if (opt.halo !== false) { ctx.lineJoin = 'round'; ctx.strokeStyle = C.halo; ctx.lineWidth = opt.haloW || 3.2; ctx.strokeText(text, x, y); }
  ctx.fillStyle = opt.color || C.label; ctx.fillText(text, x, y);
  return true;
}
function drawPin(x, y, color, glyph) {
  ctx.save();
  ctx.strokeStyle = C.ink; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 22); ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, 3, 0, TAU); ctx.fillStyle = C.ink; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y - 27, 8, 0, TAU); ctx.fillStyle = color; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = C.halo; ctx.stroke();
  ctx.beginPath(); ctx.arc(x - 2.4, y - 29.5, 2.2, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fill();
  if (glyph) { ctx.font = `700 11px ${C.fBody}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText(glyph, x, y - 26.5); }
  ctx.restore();
  placed.push({ x: x - 9, y: y - 36, w: 18, h: 36 });
}
function fillFeature(f, style) { ctx.beginPath(); path(f); ctx.fillStyle = style; ctx.fill(); }

function draw() {
  applyView();
  const R = scaleNow(), cx = W / 2, cy = H / 2, c = center();
  ctx.setTransform(RDPR, 0, 0, RDPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  placed.length = 0;
  if (!flat && R < Math.hypot(W, H)) {
    const g = ctx.createRadialGradient(cx, cy, R * 0.96, cx, cy, R * 1.13);
    g.addColorStop(0, C.glow); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.13, 0, TAU); ctx.fill();
  }
  let og;
  if (flat) { og = ctx.createLinearGradient(0, 0, 0, H); og.addColorStop(0, C.sea1); og.addColorStop(1, C.sea2); }
  else { og = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R); og.addColorStop(0, C.sea1); og.addColorStop(1, C.sea2); }
  ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = og; ctx.fill();
  ctx.beginPath(); path(graticule); ctx.strokeStyle = C.grat; ctx.lineWidth = 0.6; ctx.stroke();
  if (world === 'history') {
    drawHistory(R, c);
    drawSphereEdge(cx, cy, R);
    if (spinPhase === 'spin') drawNeedle(cx, cy);
    drawHistoryLabels(R, c);
    if (!flat && R * 1.1 < Math.min(W, H) / 2 + 30) drawBezel(cx, cy, R);
    updateCoords();
    return;
  }
  for (let k = 0; k < 5; k++) { ctx.beginPath(); path(classFC[k]); ctx.fillStyle = C.land[k]; ctx.fill(); }
  if (!fastMotion) for (const f of disputed) fillFeature(f, hatch);

  const v = curView();
  const asking = viewAsking(v);
  const showT = !!v && v.state !== 'spinning' && !(v.hideLoc && v.state !== 'answered');
  const tCol = !v ? null : v.state === 'answered' ? (v.ok === true ? C.ok : v.ok === false ? C.ng : C.target) : C.target;
  const tPlace = v && v.loc ? v.loc.place : null;
  const hideName = asking && v.hideName;
  const hideId = hideName && tPlace ? tPlace.id : null;
  const nameShown = v && showT && (v.state === 'answered' || !v.hideName);

  if (hoverId && !asking) { const f = featById.get(hoverId); if (f) fillFeature(f, C.hover); }
  if (mode === 'explore' && sel && sel.type === 'place' && featById.get(sel.id)) fillFeature(featById.get(sel.id), C.hilite);
  if (showT && tPlace && featById.get(tPlace.id)) fillFeature(featById.get(tPlace.id), tCol);

  ctx.beginPath(); path(borders); ctx.strokeStyle = C.border; ctx.lineWidth = zoom > 3 ? 0.9 : 0.6; ctx.stroke();
  ctx.beginPath(); path(coast); ctx.strokeStyle = C.coast; ctx.lineWidth = 0.75; ctx.stroke();
  drawSphereEdge(cx, cy, R);

  for (const p of markerPlaces) {
    if (Math.sqrt(p.a) * R > 7 || !visible(p.lp, c)) continue;
    const [x, y] = projection(p.lp);
    let fill = C.panel;
    if (mode === 'explore' && sel === p) fill = C.hilite;
    if (showT && tPlace === p) fill = tCol;
    ctx.beginPath(); ctx.arc(x, y, 3.4, 0, TAU); ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = 1.2; ctx.strokeStyle = C.coast; ctx.stroke();
  }
  const citiesOn = showCities && !hideName;
  if (citiesOn) {
    for (const ci of D.cities) {
      if (!visible(ci.lp, c)) continue;
      const [x, y] = projection(ci.lp);
      const on = mode === 'explore' && sel === ci;
      ctx.beginPath(); ctx.arc(x, y, on ? 4.2 : 2.7, 0, TAU);
      ctx.fillStyle = on ? C.hilite : C.ink; ctx.fill();
      ctx.lineWidth = 1.3; ctx.strokeStyle = C.halo; ctx.stroke();
    }
  }
  if (mode === 'explore' && sel && visible(sel.lp, c, 0.02)) {
    const [x, y] = projection(sel.lp);
    drawPin(x, y, C.hilite);
    label(sel.n, x, y - 46, 14, { weight: 700, force: true, haloW: 4 });
  }
  if (showT && visible(v.loc.lp, c, 0.02)) {
    const [x, y] = projection(v.loc.lp);
    drawPin(x, y, tCol, v.state === 'answered' ? '' : '?');
    if (nameShown && v.loc.name) label(v.loc.name, x, y - 46, 14, { weight: 700, force: true, haloW: 4 });
  }
  if (spinPhase === 'spin') drawNeedle(cx, cy);

  if (showLabels && !fastMotion) {
    for (const p of labelPlaces) {
      if (p.id === hideId) continue;
      if (mode === 'explore' && sel === p) continue;
      if (nameShown && tPlace === p) continue;
      const px = Math.sqrt(p.a) * R;
      if (px < 12) continue;
      if (!visible(p.lp, c, 0.25)) continue;
      const size = clamp(7.8 + px * 0.04, 10, 15.5);
      const font = `500 ${size}px ${C.fBody}`;
      if (px < mw(font, p.n) * 0.42) continue;
      const [x, y] = projection(p.lp);
      label(p.n, x, y, size, { weight: size > 13 ? 700 : 500 });
    }
  }
  if (citiesOn && zoom >= 1.7 && !fastMotion) {
    for (const ci of D.cities) {
      if (mode === 'explore' && sel === ci) continue;
      if (nameShown && v.loc.city === ci) continue;
      if (!visible(ci.lp, c, 0.15)) continue;
      const [x, y] = projection(ci.lp);
      label(ci.n, x + 6, y, 11, { align: 'left', weight: 500, color: C.ink, haloW: 2.8 });
    }
  }
  if (showLabels && zoom >= 3 && !fastMotion) {
    for (const p of markerPlaces) {
      if (p.id === hideId || (mode === 'explore' && sel === p) || (nameShown && tPlace === p)) continue;
      if (Math.sqrt(p.a) * R > 7 || !visible(p.lp, c, 0.2)) continue;
      const [x, y] = projection(p.lp);
      label(p.n, x + 6, y, 10.5, { align: 'left' });
    }
  }
  if (showLabels) {
    for (const [n, lon, lat, mz, s] of OCEANS) {
      if (zoom < mz || !visible([lon, lat], c, 0.35)) continue;
      const [x, y] = projection([lon, lat]);
      const txt = s >= 15 ? n.split('').join(' ') : n;
      label(txt, x, y, s, { family: C.fDisp, weight: 600, color: C.seaInk, halo: false });
    }
  }
  if (!flat && R * 1.1 < Math.min(W, H) / 2 + 30) drawBezel(cx, cy, R);
  updateCoords();
}
// equator and tropics, the shading that makes the globe look round, and its rim
function drawSphereEdge(cx, cy, R) {
  ctx.save(); ctx.strokeStyle = C.brass; ctx.globalAlpha = 0.75;
  ctx.setLineDash([6, 4]); ctx.lineWidth = 1; ctx.beginPath(); path(equator); ctx.stroke();
  ctx.setLineDash([1.5, 4]); ctx.lineWidth = 1; ctx.beginPath(); path(tropics); ctx.stroke();
  ctx.restore();
  if (!flat) {
    const sg = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.35, cx, cy, R);
    sg.addColorStop(0, 'rgba(255,255,255,0.06)'); sg.addColorStop(0.7, 'rgba(0,0,0,0)'); sg.addColorStop(1, C.shade);
    ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = sg; ctx.fill();
  }
  ctx.beginPath(); path({ type: 'Sphere' }); ctx.strokeStyle = C.coast; ctx.globalAlpha = 0.35; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
}
function drawNeedle(cx, cy) {
  ctx.save();
  ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, 9, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - 15, cy); ctx.lineTo(cx - 5, cy); ctx.moveTo(cx + 5, cy); ctx.lineTo(cx + 15, cy);
  ctx.moveTo(cx, cy + 5); ctx.lineTo(cx, cy + 15); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy - 4); ctx.lineTo(cx - 8, cy - 26); ctx.lineTo(cx + 8, cy - 26); ctx.closePath();
  ctx.fillStyle = C.brass; ctx.fill(); ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.restore();
}
function drawBezel(cx, cy, R) {
  const r = R * 1.045 + 6;
  ctx.save();
  ctx.strokeStyle = C.brass; ctx.lineWidth = 3; ctx.globalAlpha = 0.9;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
  ctx.lineWidth = 1; ctx.globalAlpha = 0.8;
  for (let d = 0; d < 360; d += 5) {
    const a = d * RAD, len = d % 45 === 0 ? 8 : d % 15 === 0 ? 5 : 2.5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (r + 2), cy + Math.sin(a) * (r + 2));
    ctx.lineTo(cx + Math.cos(a) * (r + 2 + len), cy + Math.sin(a) * (r + 2 + len));
    ctx.stroke();
  }
  ctx.restore();
}
function dms(v, pos, neg) {
  const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60);
  return `${d}°${String(m).padStart(2, '0')}′${v >= 0 ? pos : neg}`;
}
const fmtLL = ll => `${dms(ll[1], 'N', 'S')} ${dms(((ll[0] + 540) % 360) - 180, 'E', 'W')}`;
let lastCoords = '';
function updateCoords() {
  const s = fmtLL(center()) + `  ×${zoom.toFixed(1)}`;
  if (s !== lastCoords) { $('#coords').textContent = s; lastCoords = s; }
}

/* ---------------- geometry lookups ---------------- */
function countryAt(ll) {
  const [lon, lat] = ll;
  for (const { f, b } of fbounds) {
    if (lat < b[0][1] - 0.01 || lat > b[1][1] + 0.01) continue;
    const inLon = b[0][0] <= b[1][0] ? (lon >= b[0][0] - 0.01 && lon <= b[1][0] + 0.01) : (lon >= b[0][0] || lon <= b[1][0]);
    if (!inLon) continue;
    if (d3.geoContains(f, ll)) return f;
  }
  return null;
}
// the longitude/latitude under a point on the stage, or null off the globe or map
function llAt(x, y) {
  applyView();
  if (!flat && Math.hypot(x - W / 2, y - H / 2) > scaleNow()) return null;
  const ll = projection.invert([x, y]);
  if (!ll || !isFinite(ll[0]) || !isFinite(ll[1])) return null;
  if (flat) { const q = projection(ll); if (!q || Math.hypot(q[0] - x, q[1] - y) > 1) return null; }
  return ll;
}
function pickAt(x, y) {
  const ll0 = llAt(x, y);
  if (!ll0) return null;
  if (world === 'history') return histAt(ll0, x);
  const R = scaleNow(), c = center();
  const v = curView();
  if (showCities && !(viewAsking(v) && v.hideName)) {
    let best = null, bd = 11;
    for (const ci of D.cities) {
      if (!visible(ci.lp, c)) continue;
      const q = projection(ci.lp), d = Math.hypot(q[0] - x, q[1] - y);
      if (d < bd) { bd = d; best = ci; }
    }
    if (best) return best;
  }
  for (const p of markerPlaces) {
    if (Math.sqrt(p.a) * R > 7 || !visible(p.lp, c)) continue;
    const q = projection(p.lp);
    if (Math.hypot(q[0] - x, q[1] - y) < 10) return p;
  }
  const f = countryAt(ll0);
  return f ? placeById.get(f.id) : null;
}
// name shown under the needle while the globe spins
function nameAt(ll) {
  if (world === 'history') { if (!countryAt(ll)) return '海の上'; const o = histAt(ll); return o ? o.n : (TS.idx ? '記録のない地域' : ''); }
  const f = countryAt(ll);
  return f ? (placeById.get(f.id) || {}).n || '' : '海の上';
}

/* ---------------- animation ---------------- */
let anim = null, vel = null, lastInteract = 0;
// Shuffle timing: a long roulette spin, a short zoom onto the spot, then a pause on the map.
const SPIN_MS = REDUCED ? 500 : 6200, ZOOM_MS = REDUCED ? 250 : 900, HOLD_MS = REDUCED ? 300 : 1400;
const SPIN_TOTAL = SPIN_MS + ZOOM_MS + HOLD_MS;
// Velocity ramps up for the first 8% of the spin, then decays slowly, so the last
// seconds creep across a few borders before stopping.
const ROUL = (() => {
  const n = 400, a = 0.08, p = 2.2, v = [], c = [0];
  for (let i = 0; i <= n; i++) { const t = i / n; v.push(t < a ? t / a : Math.pow((1 - t) / (1 - a), p)); }
  for (let i = 1; i <= n; i++) c.push(c[i - 1] + (v[i - 1] + v[i]) / 2);
  return c.map(x => x / c[n]);
})();
const rouletteEase = k => { const x = clamp(k, 0, 1) * 400, i = Math.min(399, Math.floor(x)); return ROUL[i] + (ROUL[i + 1] - ROUL[i]) * (x - i); };
const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
function normRot() { rot[0] = ((rot[0] + 540) % 360) - 180; }
function zoomFor(o) {
  if (!o) return 1;
  if (o.type === 'city' || o.city) return 3.6;
  const p = o.type === 'place' ? o : o.place;
  if (!p) return 3;
  return clamp(0.72 / Math.max(p.r || 0.01, 0.01), 1, 6.5);
}
function animateTo(lon, lat, z1, opt = {}) {
  normRot();
  const l0 = rot[0], p0 = rot[1], z0 = zoom;
  const l1 = -lon, p1 = clamp(-lat, -80, 80);
  let dl = ((l1 - l0) % 360 + 540) % 360 - 180;
  const spins = opt.spins || 0;
  if (spins) dl = (((l1 - l0) % 360) + 360) % 360 + 360 * spins;
  const dist = d3.geoDistance(center(), [lon, lat]) / RAD;
  let dur = opt.dur || clamp(700 + dist * 7, 700, 1900);
  if (REDUCED) dur = Math.min(dur, 500);
  const lz0 = Math.log(z0), lz1 = Math.log(z1);
  const dip = spins ? 0 : clamp(dist / 180, 0, 0.5) * (Math.min(z0, z1) > 1.4 ? 1 : 0.3);
  const start = opt.start != null ? opt.start : performance.now();
  const a = {
    step(t) {
      const k = clamp((t - start) / dur, 0, 1);
      if (spins) {
        rot[0] = l0 + dl * rouletteEase(k);
        rot[1] = p0 + (p1 - p0) * easeInOut(Math.min(1, k / 0.7));
        zoom = Math.exp(lz0 + (lz1 - lz0) * easeInOut(Math.min(1, k / 0.15)));
      } else {
        const e = easeInOut(k);
        rot[0] = l0 + dl * e; rot[1] = p0 + (p1 - p0) * e;
        zoom = Math.max(ZMIN, Math.exp(lz0 + (lz1 - lz0) * e) * (1 - dip * Math.sin(Math.PI * k)));
      }
      return k >= 1;
    },
    done: opt.done,
    finish() { rot[0] = l0 + dl; rot[1] = p1; zoom = z1; }
  };
  anim = a;
  // Finish on a timer too: requestAnimationFrame stops while the page is hidden,
  // and game steps (the answer timer in a battle) must not wait for it.
  if (opt.done) a.guard = setTimeout(() => { if (anim === a) { a.finish(); endAnim(); } }, dur + 400);
  vel = null;
  return a;
}
function endAnim() {
  const a = anim; if (!a) return;
  anim = null; clearTimeout(a.guard); normRot(); dirty = true;
  const cb = a.done; a.done = null;
  if (cb) cb();
}
function flyTo(o, opt = {}) { animateTo(o.lp[0], o.lp[1], opt.zoom || zoomFor(o), opt); }

let frameN = 0, lastT = performance.now(), lastLon = 0, fastMotion = false;
function frame(t) {
  const dt = Math.min(64, t - lastT); lastT = t; frameN++;
  const moved = Math.abs(((rot[0] - lastLon) % 360 + 540) % 360 - 180);
  fastMotion = spinPhase === 'spin' && moved / Math.max(1, t - (frame.prevT || t - 16)) > 0.06;  // > 60°/s
  frame.prevT = t; lastLon = rot[0];
  if (anim) {
    const done = anim.step(t);
    dirty = true;
    if (done) endAnim();
  } else if (vel && !drag) {
    rot[0] += vel[0] * dt; rot[1] = clamp(rot[1] + vel[1] * dt, -89, 89);
    const f = Math.pow(0.93, dt / 16); vel[0] *= f; vel[1] *= f;
    if (Math.abs(vel[0]) + Math.abs(vel[1]) < 0.0015) vel = null;
    dirty = true;
  } else if (autoSpin && !flat && !drag && !pinch && !TS.play && t - lastInteract > 6000 && !curView() && !histBusy() && document.visibilityState === 'visible') {
    rot[0] += dt * 0.0045 / Math.max(1, zoom * 0.8);
    dirty = true;
  }
  if (spinPhase === 'spin' && !needleMask && frameN % 3 === 0) {
    const n = nameAt(center());
    if (n !== needleName) { needleName = n; $('#readout').textContent = '▼ ' + n; }
  }
  if (dirty) { dirty = false; draw(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ---------------- pointer interaction ---------------- */
const pointers = new Map();
let drag = null, pinch = null;
const now = () => performance.now();
function stopMotion() { if (anim && !spinning) anim = null; vel = null; lastInteract = now(); }
canvas.addEventListener('pointerdown', e => {
  lastPointer = now();
  if (spinning) return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  stopMotion(); hideTip();
  if (pointers.size === 1 && cmpGrab(e.offsetX)) { drag = { divider: true, moved: true, x0: e.offsetX, y0: e.offsetY, t: now() }; return; }
  if (pointers.size === 1) drag = { x0: e.offsetX, y0: e.offsetY, x: e.offsetX, y: e.offsetY, r0: rot.slice(), t: now(), moved: false };
  else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: zoom }; drag = null;
  }
});
canvas.addEventListener('pointermove', e => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    zoom = clamp(pinch.z0 * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d0, ZMIN, ZMAX);
    dirty = true; lastInteract = now(); return;
  }
  if (drag && drag.divider) { TS.cmpX = clamp(e.offsetX / W, 0.06, 0.94); dirty = true; return; }
  if (drag) {
    const k = 57.2958 / scaleNow();
    const dx = e.offsetX - drag.x0, dy = e.offsetY - drag.y0;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    rot[0] = drag.r0[0] + dx * k;
    rot[1] = clamp(drag.r0[1] - dy * k, -89, 89);
    const t = now(), dtt = Math.max(1, t - drag.t);
    vel = [(e.offsetX - drag.x) * k / dtt, -(e.offsetY - drag.y) * k / dtt];
    drag.x = e.offsetX; drag.y = e.offsetY; drag.t = t;
    dirty = true; lastInteract = t;
    return;
  }
  if (e.pointerType === 'mouse' && !spinning) {
    if (cmpGrab(e.offsetX)) { canvas.style.cursor = 'ew-resize'; setHover(null); hideTip(); return; }
    queueHover(e.offsetX, e.offsetY);
  }
});
function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pinch) { if (pointers.size < 2) { pinch = null; drag = null; vel = null; } return; }
  if (drag && drag.divider) { drag = null; vel = null; return; }
  if (drag) {
    if (!drag.moved && e.type === 'pointerup') { vel = null; handleClick(e.offsetX, e.offsetY); }
    else if (now() - drag.t > 90) vel = null;
    drag = null; lastInteract = now();
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => { if (!drag) { setHover(null); hideTip(); } });
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (spinning) return;
  stopMotion();
  zoom = clamp(zoom * Math.exp(-e.deltaY * 0.0016), ZMIN, ZMAX);
  dirty = true;
}, { passive: false });
canvas.addEventListener('keydown', e => {
  const step = 10 / zoom;
  if (world === 'history' && (e.key === ',' || e.key === '.')) { e.preventDefault(); stepYear(e.key === ',' ? -1 : 1); return; }
  const k = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (k) { e.preventDefault(); stopMotion(); rot[0] += k[0]; rot[1] = clamp(rot[1] + k[1], -89, 89); dirty = true; }
  else if (e.key === '+' || e.key === '=') { setZoom(zoom * 1.4); }
  else if (e.key === '-') { setZoom(zoom / 1.4); }
  else if (e.key === 'Enter') {
    if (world === 'history') { const o = histAt(center()); if (o) handlePick(o); return; }
    const f = countryAt(center()); if (f) handlePick(placeById.get(f.id));
  }
});
let hoverQ = null;
function queueHover(x, y) {
  if (hoverQ) { hoverQ.x = x; hoverQ.y = y; return; }
  hoverQ = { x, y };
  requestAnimationFrame(() => {
    const { x: hx, y: hy } = hoverQ; hoverQ = null;
    if (nowAsking() || histAsking()) { setHover(null); hideTip(); return; }
    const o = pickAt(hx, hy);
    setHover(o && (o.type === 'place' || o.type === 'polity') ? o.id : null);
    if (o) showTip(o, hx, hy); else hideTip();
  });
}
function setHover(id) { if (id !== hoverId) { hoverId = id; dirty = true; } canvas.style.cursor = id ? 'pointer' : ''; }
const tip = $('#tip');
function showTip(o, x, y) {
  const sub = o.type === 'polity' ? periodText(o) : o.type === 'city' ? o.country.n : (o.cap ? '首都 ' + o.cap : o.reg);
  tip.textContent = `${o.n}${sub ? ' · ' + sub : ''}`;
  tip.style.left = x + 'px'; tip.style.top = y + 'px'; tip.hidden = false;
}
function hideTip() { tip.hidden = true; }
const battleBusy = () => ['spinning', 'asking', 'reveal'].includes(B.phase);
function handleClick(x, y) {
  const o = pickAt(x, y);
  if (nowAsking() || histAsking()) { toast('回答すると地図で調べられます'); return; }
  if (o) handlePick(o);
}
function handlePick(o) {
  if (!o) return;
  if (o.type === 'polity') { if (mode !== 'hist') setMode('hist'); histSelect(o); return; }
  if (mode === 'battle' && battleBusy()) { toast('対戦中は地図の選択はできません'); return; }
  if (mode !== 'explore') setMode('explore');
  select(o);
}
function setZoom(z) { stopMotion(); const z0 = zoom, z1 = clamp(z, ZMIN, ZMAX); const st = now();
  anim = { step(t) { const k = Math.min(1, (t - st) / 260); zoom = Math.exp(Math.log(z0) + (Math.log(z1) - Math.log(z0)) * easeInOut(k)); return k >= 1; } };
}
$('#z-in').onclick = () => setZoom(zoom * 1.6);
$('#z-out').onclick = () => setZoom(zoom / 1.6);
$('#z-home').onclick = () => { if (spinning) return; stopMotion(); animateTo(-rot[0], flat ? 0 : -rot[1], 1, { dur: 600 }); };
function bindToggle(id, get, set) {
  const b = $(id);
  b.setAttribute('aria-pressed', String(get()));
  b.onclick = () => { set(!get()); b.setAttribute('aria-pressed', String(get())); dirty = true; };
}
bindToggle('#t-labels', () => showLabels, v => showLabels = v);
bindToggle('#t-cities', () => showCities, v => showCities = v);
bindToggle('#t-auto', () => autoSpin, v => { autoSpin = v; lastInteract = 0; });
bindToggle('#t-modern', () => TS.modern, v => { TS.modern = v; });

let toastTimer = 0;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2000);
}

/* ---------------- names & search ---------------- */
const kata2hira = s => s.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
const norm = s => kata2hira(String(s).normalize('NFKC').toLowerCase()).replace(/[\s・･\-‐=＝.()（）「」]/g, '');
const nameIndex = new Map();
D.cities.forEach(c => nameIndex.set(norm(c.n), c));
D.places.forEach(p => [p.n, ...(p.alts || []), p.en || ''].forEach(k => { if (k) nameIndex.set(norm(k), p); }));
const cityByKey = new Map(D.cities.map(c => [c.key, c]));
const searchIndex = [
  ...D.places.map(p => ({ o: p, keys: [p.n, ...(p.alts || []), p.en || ''].map(norm), kind: p.un ? '国' : '地域', sub: p.reg })),
  ...D.cities.map(c => ({ o: c, keys: [norm(c.n)], kind: '都市', sub: c.country.n }))
];
const qInput = $('#q'), sugg = $('#suggest');
let suggItems = [], suggIdx = -1;
function renderSuggest() {
  const q = norm(qInput.value);
  if (!q) { sugg.hidden = true; suggItems = []; return; }
  const scored = [];
  for (const it of (world === 'history' ? histSearchIndex() : searchIndex)) {
    let best = 99;
    for (const k of it.keys) { const i = k.indexOf(q); if (i === 0) best = Math.min(best, 0); else if (i > 0) best = Math.min(best, 1); }
    if (best < 99) scored.push([best, it.rank != null ? it.rank : it.o.un ? 0 : it.kind === '都市' ? 1 : 2, it]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  suggItems = scored.slice(0, 8).map(s => s[2]);
  suggIdx = suggItems.length ? 0 : -1;
  sugg.innerHTML = suggItems.length
    ? suggItems.map((it, i) => `<li role="option" data-i="${i}" aria-selected="${i === suggIdx}"><span>${esc(it.o.n)}</span><small>${it.kind} · ${esc(it.sub || '')}</small></li>`).join('')
    : '<li aria-disabled="true"><span>見つかりません</span></li>';
  sugg.hidden = false;
}
function chooseSuggest(i) {
  const it = suggItems[i]; if (!it) return;
  sugg.hidden = true; qInput.value = ''; qInput.blur();
  if (nowAsking() || histAsking()) { toast('回答後に探せます'); return; }
  if (mode === 'battle' && battleBusy()) { toast('対戦中は探せません'); return; }
  if (it.o.type === 'polity') { setMode('hist'); histJumpTo(it.o); return; }
  setMode('explore');
  select(it.o, { fly: true });
}
qInput.addEventListener('input', renderSuggest);
qInput.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); if (!suggItems.length) return;
    suggIdx = (suggIdx + (e.key === 'ArrowDown' ? 1 : -1) + suggItems.length) % suggItems.length;
    [...sugg.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === suggIdx)));
  } else if (e.key === 'Enter') { e.preventDefault(); chooseSuggest(Math.max(0, suggIdx)); }
  else if (e.key === 'Escape') { sugg.hidden = true; }
});
sugg.addEventListener('pointerdown', e => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); chooseSuggest(+li.dataset.i); } });
qInput.addEventListener('blur', () => setTimeout(() => { sugg.hidden = true; }, 120));

/* ---------------- explore panel ---------------- */
const recent = [];
const gsearch = q => `https://www.google.com/search?q=${encodeURIComponent(q)}`;
function select(o, opt = {}) {
  sel = o;
  const hi = recent.indexOf(o); if (hi >= 0) recent.splice(hi, 1);
  recent.unshift(o); if (recent.length > 7) recent.pop();
  renderExplore();
  if (opt.fly) flyTo(o);
  dirty = true;
}
function renderExplore() {
  const v = $('#view-explore');
  const o = sel;
  if (!o) { v.innerHTML = `<div class="pane"><p class="empty">${flat ? '地図' : '地球儀'}の国や都市をクリックするか、シャッフルを押してください。</p></div>`; return; }
  const isCity = o.type === 'city';
  const place = isCity ? o.country : o;
  const eyebrow = isCity ? `都市 · ${place.n}` : `${o.reg || ''} · ${o.un ? '国連加盟国' : '地域'}`;
  const dishes = o.d || [];
  const facts = o.f || [];
  const cityList = !isCity ? citiesOf(o.id) : [];
  const food = world === 'food';
  const metaRows = [];
  if (isCity) metaRows.push(['国', `<button class="chip" data-go="${esc(place.id)}">${esc(place.n)}</button>`]);
  else if (o.cap) metaRows.push([o.un ? '首都' : '中心都市', esc(o.cap)]);
  else metaRows.push(['地域', esc(o.reg || '—')]);
  metaRows.push(['位置', `<span class="mono">${fmtLL(o.lp)}</span>`]);
  v.innerHTML = `<div class="pane">
    <div>
      <p class="eyebrow">${esc(eyebrow)}</p>
      <h2 class="pname">${esc(o.n)}</h2>
      ${!isCity && o.en ? `<p class="pen">${esc(o.en)}</p>` : ''}
    </div>
    <dl class="meta">${metaRows.map(([k, val]) => `<div><dt>${k}</dt><dd>${val}</dd></div>`).join('')}</dl>
    ${food ? `<section class="sec">
      <h3>郷土料理</h3>
      ${dishes.length ? `<ul class="dishes">${dishes.map(([name, desc]) => {
        const q = `${o.n} ${name} 作り方`;
        return `<li class="dish"><b>${esc(name)}</b><p>${esc(desc)}</p>
          <a class="go" href="${gsearch(q)}" target="_blank" rel="noopener" title="${esc(q)} を検索">作り方 ↗<span>${esc(q)}</span></a></li>`;
      }).join('')}</ul>` : `<p class="empty">この地域の料理データはまだありません。</p>`}
      <a class="go go-wide" href="${gsearch(`${o.n} 郷土料理 作り方`)}" target="_blank" rel="noopener">ほかの郷土料理も探す ↗<span>${esc(o.n)} 郷土料理 作り方</span></a>
    </section>` : ''}
    <section class="sec">
      <h3>豆知識</h3>
      ${facts.length ? `<ul class="trivia">${facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : `<p class="empty">豆知識はまだありません。</p>`}
    </section>
    ${cityList.length ? `<section class="sec"><h3>この国の都市</h3><div class="chips">${cityList.map(c => `<button class="chip" data-city="${c.key}">${esc(c.n)}</button>`).join('')}</div></section>` : ''}
    ${recent.length > 1 ? `<section class="sec"><h3>最近見た場所</h3><div class="chips">${recent.slice(1).map(h => h.type === 'city'
      ? `<button class="chip" data-city="${h.key}">${esc(h.n)}</button>` : `<button class="chip" data-go="${esc(h.id)}">${esc(h.n)}</button>`).join('')}</div></section>` : ''}
  </div>`;
}
$('#view-explore').addEventListener('click', e => {
  const b = e.target.closest('[data-go],[data-city]'); if (!b) return;
  if (spinning) return;
  const o = b.dataset.go ? placeById.get(b.dataset.go) : cityByKey.get(b.dataset.city);
  if (o) select(o, { fly: true });
});

/* ---------------- spin & shuffle ---------------- */
let target = 'both';
document.querySelectorAll('#target-seg button').forEach(b => b.onclick = () => {
  target = b.dataset.t;
  document.querySelectorAll('#target-seg button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
});
let spinToken = 0, lastPointer = 0;
// Spin to o: roulette spin (onLand fires when it stops), zoom onto the spot,
// then hold on the map for HOLD_MS before onDone.
// Every step (stop, zoom, done) is scheduled on the clock from the start time t0, so it
// happens at the same moment on every device, however fast that device can draw.
// opt.t0 lets a battle start everyone's spin at one shared moment.
function spinTo(o, zoomTarget, opt = {}) {
  const tok = ++spinToken;
  const t0 = opt.t0 != null ? opt.t0 : now();
  const at = (ms, fn) => setTimeout(() => { if (tok === spinToken) fn(); }, Math.max(0, t0 + ms - now()));
  spinning = true; spinPhase = 'spin'; needleName = ''; needleMask = !!opt.mask;
  hideTip(); setHover(null); setBudget(PX_SPIN);
  $('#readout').hidden = false; $('#readout').textContent = needleMask ? '▼ ？？？' : '▼';
  $('#spin-btn').disabled = true;
  vel = null;
  const spinAnim = animateTo(o.lp[0], o.lp[1], Math.min(zoom, 1), { spins: REDUCED ? 0 : 3, dur: SPIN_MS, start: t0 });
  let zoomAnim = null;
  at(SPIN_MS, () => {
    if (anim === spinAnim) { spinAnim.finish(); anim = null; }
    normRot(); spinPhase = 'zoom'; fastMotion = false; setBudget(PX_REST);
    if (!needleMask) {
      const f = world === 'history' ? null : countryAt(center());
      $('#readout').textContent = '▼ ' + (world === 'history' ? (o.n || nameAt(center())) : f ? (placeById.get(f.id) || {}).n || '' : (o.n || '海の上'));
    }
    if (opt.onLand) opt.onLand();
    zoomAnim = animateTo(o.lp[0], o.lp[1], zoomTarget, { dur: ZOOM_MS, start: t0 + SPIN_MS });
  });
  at(SPIN_MS + ZOOM_MS, () => {
    if (zoomAnim && anim === zoomAnim) { zoomAnim.finish(); anim = null; }
    normRot(); spinning = false; spinPhase = ''; $('#readout').hidden = true;
    lastInteract = now(); dirty = true;
  });
  at(SPIN_TOTAL, () => {
    $('#spin-btn').disabled = false;
    if (opt.onDone) opt.onDone();
  });
}
// the modern map can land anywhere with a name; the food mode only where there are dishes
const modernPlaces = D.places.filter(p => p.un || (p.f && p.f.length) || (p.d && p.d.length));
function shuffle() {
  if (spinning) return;
  const pickCity = target === 'city' || (target === 'both' && Math.random() < 0.35);
  const pool = world === 'food' ? shufflePlaces : modernPlaces;
  let o;
  do {
    o = pickCity ? D.cities[Math.floor(Math.random() * D.cities.length)] : pool[Math.floor(Math.random() * pool.length)];
  } while (o === sel);
  sel = null; dirty = true;
  $('#view-explore').innerHTML = `<div class="pane"><p class="eyebrow">シャッフル中</p><h2 class="pname">…</h2><p class="lead">${flat ? '地図' : '地球儀'}が止まった場所の${world === 'food' ? '郷土料理と豆知識' : '情報と豆知識'}を表示します。</p></div>`;
  const started = now();
  spinTo(o, zoomFor(o), {
    onLand: () => select(o),
    // phones: after the pause on the map, move down to the dishes unless the viewer started exploring the globe
    onDone: () => { if (isNarrow() && lastPointer < started && mode === 'explore' && sel === o) revealPanel(); }
  });
}
const isNarrow = () => innerWidth < 960;
function revealPanel() { $('#panel').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' }); }
// Quiz and battle on phones: once the question appears, bring its card up from below,
// aligned to the bottom edge so the pinned spot stays visible above it.
function revealCard(sel) {
  requestAnimationFrame(() => {
    const el = document.querySelector(sel); if (!el) return;
    const tall = el.getBoundingClientRect().height > innerHeight * 0.6;
    el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: tall ? 'start' : 'end' });
  });
}
$('#spin-btn').onclick = () => {
  if (mode === 'explore') shuffle(); else if (mode === 'quiz') nextQuestion();
  else if (mode === 'hist') histShuffle(); else if (mode === 'hquiz') histNextQuestion();
};

/* ---------------- modes ---------------- */
const MODES = ['explore', 'quiz', 'battle', 'hist', 'hquiz'];
function setMode(m, force) {
  if (m === mode && !force) return;
  if (mode === 'hquiz' && m !== 'hquiz') hqAbandon();
  mode = m;
  MODES.forEach(k => {
    $('#tab-' + k).setAttribute('aria-selected', String(m === k));
    $('#view-' + k).hidden = m !== k;
  });
  $('#target-seg').hidden = m !== 'explore';
  $('#spin-wrap').hidden = m === 'battle';
  if (m !== 'battle' || B.phase !== 'asking') { if (!spinning) $('#readout').hidden = true; }
  updateSpinLabel();
  if (m === 'quiz') renderQuiz(); else if (m === 'battle') renderBattle();
  else if (m === 'hist') renderHist(); else if (m === 'hquiz') renderHQuiz(); else renderExplore();
  dirty = true;
}
function updateSpinLabel() {
  const st = mode === 'hquiz' ? HQ.state : SQ.state;
  $('#spin-label').textContent = mode === 'explore' || mode === 'hist' ? 'シャッフル' : (st === 'answered' ? '次の問題' : st === 'asking' ? 'この問題をとばす' : '回して出題');
}
MODES.forEach(k => { $('#tab-' + k).onclick = () => { if (!spinning) setMode(k); }; });

/* ---------------- display modes (⋯ menu) ---------------- */
const WORLDS = {
  modern: { sub: '回して、止まった国を知る', chip: '', hash: '' },
  history: { sub: '時をさかのぼって、世界の国々を知る', chip: 'タイムスリップ', hash: '#timeslip' },
  food: { sub: '回して、止まった国の料理と豆知識を知る', chip: 'ごちそう', hash: '#food' }
};
const FOOT = {
  modern: '地図: Natural Earth 1:50m(world-atlas)。国境線は実効支配線にもとづき、帰属に争いのある地域は斜線で示しています。',
  food: '地図: Natural Earth 1:50m(world-atlas)。国境線は実効支配線にもとづき、帰属に争いのある地域は斜線で示しています。料理の作り方はGoogle検索が新しいタブで開きます。',
  history: '歴史地図: <a href="https://github.com/Seshat-Global-History-Databank/cliopatria" target="_blank" rel="noopener">Cliopatria</a>(Seshat Global History Databank、<a href="https://creativecommons.org/licenses/by/4.0/deed.ja" target="_blank" rel="noopener">CC BY 4.0</a>)の境界線を簡略化し、日本語名を付けて表示しています。倭など一部の勢力は独自に追加しました。古い時代の境界は現在の研究にもとづく推定で、はっきりしない部分を含みます。陸地と現代の国境は Natural Earth です。'
};
function setWorld(w) {
  if (w === world) return;
  if (spinning) { toast((flat ? '地図' : '地球儀') + 'が止まってから切り替えてください'); return; }
  if (w === 'history' && B.net) { toast('対戦中はタイムスリップに切り替えられません。部屋を出てからお試しください'); return; }
  const prev = world;
  world = w;
  if (prev === 'history') histLeave();
  const W0 = WORLDS[w];
  document.querySelectorAll('[data-world]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.world === w)));
  $('#brand-sub').textContent = W0.sub;
  $('#world-chip').textContent = W0.chip; $('#world-chip').hidden = !W0.chip;
  const hist = w === 'history';
  ['explore', 'quiz', 'battle'].forEach(k => { $('#tab-' + k).hidden = hist; });
  ['hist', 'hquiz'].forEach(k => { $('#tab-' + k).hidden = !hist; });
  $('#t-cities').hidden = hist; $('#t-modern').hidden = !hist;
  $('#timebar').hidden = !hist;
  qInput.placeholder = hist ? '勢力名で探す(例: ローマ帝国)' : '国名・都市名で探す';
  qInput.setAttribute('aria-label', qInput.placeholder);
  qInput.value = ''; sugg.hidden = true;
  $('#foot-note').innerHTML = FOOT[w];
  hoverId = null; hideTip();
  if (hist) { setMode('hist', true); histEnter(); }
  else if (mode === 'hist' || mode === 'hquiz') setMode('explore', true);
  else setMode(mode, true);
  if (!/^#room-/.test(location.hash)) { try { history.replaceState(null, '', location.pathname + location.search + W0.hash); } catch (e) { /* file:// */ } }
  dirty = true;
}
const menuBtn = $('#menu-btn'), menu = $('#menu');
function openMenu(v) { menu.hidden = !v; menuBtn.setAttribute('aria-expanded', String(v)); }
menuBtn.onclick = e => { e.stopPropagation(); openMenu(menu.hidden); };
menu.addEventListener('click', e => {
  const w = e.target.closest('[data-world]');
  if (w) { openMenu(false); setWorld(w.dataset.world); return; }
  const sh = e.target.closest('[data-shape]');
  if (sh) { setFlat(sh.dataset.shape === 'flat'); if (mode === 'explore') renderExplore(); }
});
document.addEventListener('click', e => { if (!menu.hidden && !e.target.closest('.menuwrap')) openMenu(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { openMenu(false); menuBtn.focus(); } });

/* ================= quiz data ================= */
// Columns are matched by header name, so their order does not matter.
const QCOLS = ['問題', '答え', 'ジャンル', '難易度', '解説', '答えの種類', '場所', '選択肢'];
const QALIAS = { '場所': ['国', '国名', '関連国', '対象国', '地名'], '答えの種類': ['種類'] };
// ジャンル tags that describe a question rather than the kind of answer
const TYPE_SKIP = ['世界一', '世界初', '日本初', '日本との関係'];
const shuffleArr = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const splitAlts = s => String(s || '').split(/[\/／]/).map(x => x.trim()).filter(Boolean);
// Answers may carry their reading in brackets, e.g. 赤道ギニア（せきどうぎにあ） or
// 日本（にほん/にっぽん）: the part outside is shown, and the readings are accepted too.
function answerAlts(s) {
  const readings = [];
  const base = String(s || '').replace(/[（(]([^）)]*)[）)]/g, (m, inner) => {
    if (/^[\sぁ-ゖァ-ヺー・\/／]+$/.test(inner)) { readings.push(...splitAlts(inner)); return ''; }
    return m;
  });
  const out = [], seen = new Set();
  for (const a of splitAlts(base).concat(readings)) { const k = norm(a); if (k && !seen.has(k)) { seen.add(k); out.push(a); } }
  return out;
}
function parseTable(text) {
  text = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const first = text.split('\n', 1)[0];
  if (first.includes('\t') || !first.includes(',')) return text.split('\n').map(l => l.split('\t'));
  // CSV with quoted fields
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  row.push(f); rows.push(row);
  return rows;
}
function resolveLoc(s) {
  s = String(s || '').trim();
  if (!s) return null;
  const m = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,，、]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) {
    const lat = +m[1], lon = +m[2];
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    const f = countryAt([lon, lat]);
    return { lp: [lon, lat], place: null, city: null, name: '', reg: f && placeById.get(f.id) ? placeById.get(f.id).reg : 'その他' };
  }
  for (const a of splitAlts(s)) {
    const o = nameIndex.get(norm(a)) || nameIndex.get(norm(a.replace(/(民主共和国|人民共和国|共和国|連邦|王国|公国|大公国)$/, '')));
    if (o) return locOf(o);
  }
  return null;
}
const locOf = o => o.type === 'city'
  ? { lp: o.lp, place: null, city: o, name: o.n, reg: o.country.reg }
  : { lp: o.lp, place: o, city: null, name: o.n, reg: o.reg };
// Country and city names written inside a sentence, in the order they appear.
// Matching is on the original script, and a katakana name must not run into more
// katakana (so タイ does not match タイトル and マリ does not match マリー).
let mentionKeys = null;
function mentionList() {
  if (mentionKeys) return mentionKeys;
  const m = new Map();
  const add = (k, o) => { k = String(k || '').normalize('NFKC').trim(); if (k.length >= 2 && !m.has(k)) m.set(k, o); };
  D.places.forEach(p => [p.n, ...(p.alts || [])].forEach(k => add(k, p)));
  D.cities.forEach(c => add(c.n, c));
  return (mentionKeys = [...m].sort((a, b) => b[0].length - a[0].length));
}
const scriptOf = ch => !ch ? '' : /[ァ-ヺー]/.test(ch) ? 'k' : /[A-Za-z0-9]/.test(ch) ? 'a' : 'x';
const glued = (nb, edge) => { const s = scriptOf(edge); return s !== 'x' && scriptOf(nb) === s; };
function findMentions(str) {
  const t = String(str || '').normalize('NFKC'), taken = new Uint8Array(t.length), out = [];
  for (const [k, o] of mentionList()) {
    for (let i = t.indexOf(k); i >= 0; i = t.indexOf(k, i + 1)) {
      const e = i + k.length;
      if (taken.subarray(i, e).some(Boolean) || glued(t[i - 1], k[0]) || glued(t[e], k[k.length - 1])) continue;
      taken.fill(1, i, e); out.push([i, o]);
    }
  }
  return out.sort((a, b) => a[0] - b[0]).map(x => x[1]);
}
// Where to stop the globe for a question whose answer is not a place and that has no
// 場所 column. Sheets are usually grouped by country (the country question first, then
// questions about it), so the latest country answer is the best guess, checked against
// the region tag in ジャンル; failing that, a country or city named in the question.
function guessLoc(text, expl, region, block) {
  const regOf = o => o.type === 'city' ? o.country.reg : o.reg;
  const inReg = o => !region || regOf(o) === region;
  const ms = findMentions(text);
  if (block) {
    if (ms.some(o => o === block.loc.place || (o.type === 'city' && o.country === block.loc.place))) return ['block', block.loc];
    if (!region || !block.region || region === block.region) return ['block', block.loc];
  }
  let o = ms.find(inReg);
  if (o) return ['text', locOf(o)];
  if (block) return ['block', block.loc];
  o = findMentions(expl).find(inReg);
  return o ? ['expl', locOf(o)] : [null, null];
}
const locNames = loc => {
  const out = [];
  if (loc.place) [loc.place.n, ...(loc.place.alts || []), loc.place.en || ''].forEach(k => k && out.push(norm(k)));
  if (loc.city) out.push(norm(loc.city.n));
  return out;
};
function buildQuestions(text, src) {
  const rows = parseTable(text).filter(r => r.some(c => String(c).trim()));
  const qs = [], errors = [];
  if (!rows.length) return { qs, errors };
  let header = rows[0].map(h => String(h).normalize('NFKC').trim());
  let start = 1;
  if (!header.includes('問題')) { header = QCOLS; start = 0; }   // pasted rows without a header
  const ix = {};
  QCOLS.forEach(k => { ix[k] = [k, ...(QALIAS[k] || [])].map(h => header.indexOf(h)).find(j => j >= 0) ?? -1; });
  if (ix['答え'] < 0) { errors.push('見出しに「答え」の列がありません'); return { qs, errors }; }
  let block = null;   // the latest row whose answer was a country
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    const get = k => ix[k] >= 0 ? String(r[ix[k]] == null ? '' : r[ix[k]]).trim() : '';
    const line = i + 1;
    const text = get('問題'), alts = answerAlts(get('答え'));
    if (!text || !alts.length) { errors.push(`${line}行目: 問題か答えが空です`); continue; }
    const tags = get('ジャンル').split(/\s+/).filter(g => g && g !== '国連加盟国');
    const region = tags.find(g => REGIONS.includes(g)) || '';
    const topics = tags.filter(g => !REGIONS.includes(g));
    let ansLoc = resolveLoc(alts.join('/'));
    // a person who shares a name with a city (ホー・チ・ミン, ワシントン) is not that city
    if (ansLoc && ansLoc.city && topics.includes('人物') && !get('答えの種類')) ansLoc = null;
    if (ansLoc && ansLoc.place) block = { loc: ansLoc, region: region || ansLoc.reg };
    let type = get('答えの種類'), typeGuess = false;
    if (!type) {
      if (ansLoc) type = ansLoc.city ? '都市' : '国名';
      else { type = topics.find(g => !TYPE_SKIP.includes(g)) || 'その他'; typeGuess = true; }
    }
    const locStr = get('場所');
    let loc = null, locBy = '';
    if (locStr) {
      loc = resolveLoc(locStr); locBy = 'col';
      if (!loc) { errors.push(`${line}行目: 場所「${locStr}」が地図上で見つかりません`); continue; }
    } else if (ansLoc) { loc = ansLoc; locBy = 'answer'; }
    else if (type === '国名') { errors.push(`${line}行目: 答え「${alts[0]}」が国名として見つかりません(別の書き方を「/」で足してください)`); continue; }
    else {
      [locBy, loc] = guessLoc(text, get('解説'), region, block);
      if (!loc) { errors.push(`${line}行目: どの国の問題か分かりません(場所の列に国名・都市名を入れてください)`); continue; }
    }
    const diff = clamp(parseInt(get('難易度'), 10) || 3, 1, 5);
    const lnames = locNames(loc);
    const hideName = type === '国名' || alts.some(a => lnames.includes(norm(a)));
    qs.push({ id: `${src}${i}`, text, alts, type, typeGuess, genre: topics.join(' '), diff, expl: get('解説'), choices: splitAlts(get('選択肢')), loc, reg: loc.reg, hideName, locBy });
  }
  return { qs, errors };
}
const QUIZ = { base: [], baseErr: [], baseSrc: '内蔵', extra: [], extraErr: [], extraText: store.get('extra-quiz', '') };
function loadBase(text, srcLabel) { const r = buildQuestions(text, 'b'); QUIZ.base = r.qs; QUIZ.baseErr = r.errors; QUIZ.baseSrc = srcLabel; }
loadBase(window.GLOBE_QUIZ || '', '内蔵');
const allQs = () => QUIZ.base.concat(QUIZ.extra);
if (location.protocol.startsWith('http')) {
  fetch('quiz.tsv', { cache: 'no-store' }).then(r => r.ok ? r.text() : null).then(t => {
    if (t && t.includes('問題') && t.includes('答え')) { loadBase(t, 'quiz.tsv'); if (QUIZ.extraText) rebuildExtra(); if (mode === 'quiz') renderQuiz(); if (mode === 'battle') renderBattle(); }
  }).catch(() => { /* keep the built-in questions */ });
}
function makeChoices(q) {
  const ans = q.alts[0], bad = new Set(q.alts.map(norm));
  let pool = q.choices.slice();
  if (pool.length < 3 && q.type === '国名' && q.loc.place) {
    const un = D.places.filter(x => x.un && x !== q.loc.place);
    const same = un.filter(x => x.reg === q.loc.place.reg);
    pool = pool.concat(shuffleArr((same.length >= 3 ? same : un).map(x => x.n)));
  }
  if (pool.length < 3 && q.type === '都市' && q.loc.city) {
    const cs = D.cities.filter(c => c !== q.loc.city), same = cs.filter(c => c.country.reg === q.loc.reg);
    pool = pool.concat(shuffleArr((same.length >= 3 ? same : cs).map(c => c.n)));
  }
  if (pool.length < 3) pool = pool.concat(shuffleArr(allQs().filter(x => x.type === q.type).map(x => x.alts[0])));
  // a type read from ジャンル can be rare (国際機関): borrow other non-country answers
  if (pool.length < 4 && q.typeGuess) pool = pool.concat(shuffleArr(allQs().filter(x => x.typeGuess).map(x => x.alts[0])));
  const seen = new Set(), picks = [];
  for (const p of (q.choices.length >= 3 ? shuffleArr(q.choices.slice()) : pool)) {
    const k = norm(p);
    if (bad.has(k) || seen.has(k)) continue;
    seen.add(k); picks.push(p);
    if (picks.length === 3) break;
  }
  if (picks.length < 3) return null;
  return shuffleArr([ans, ...picks]);
}
function isCorrect(q, text) {
  const a = norm(text);
  if (!a) return false;
  const keys = q.alts.slice();
  if (q.type === '国名' && q.loc.place) keys.push(q.loc.place.n, ...(q.loc.place.alts || []), q.loc.place.en || '');
  return keys.some(k => k && norm(k) === a);
}
const maxHint = q => (q.type === '国名' && q.loc.place) ? 2 : 1;
function hintText(q, lv) {
  const a = q.alts[0];
  const lead = `答えは「${[...a][0]}」から始まる${[...a].length}文字`;
  if (!(q.type === '国名' && q.loc.place)) return lead;
  const p = q.loc.place;
  const cap = (p.cap || '').replace(/\(.*?\)|（.*?）/g, '');
  const leaks = !cap || cap.includes(p.n) || p.n.includes(cap);
  const first = leaks ? `${p.reg}の国` : `首都は${cap}`;
  return lv >= 2 ? `${first} / ${lead}` : first;
}
const stars = d => '★'.repeat(d) + '☆'.repeat(5 - d);
const locObj = loc => loc.city || loc.place;

/* ================= 早応え: sound, intro, gradual reading ================= */
// Sounds are synthesized with Web Audio, so no files are needed. Browsers only allow
// audio after the viewer has tapped or typed, so the context is unlocked on the first gesture.
const SFX = {
  ctx: null, on: store.get('sfx', true),
  unlock() {
    if (!this.on) return;
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (e) { this.ctx = null; }
  },
  tone(f, t0, dur, type, gain) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.03);
  },
  play(name) {
    if (!this.on) return;
    this.unlock();
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + 0.03;
    if (name === 'question') {          // "てーん": one bell-like note
      this.tone(1046.5, t, 1.2, 'sine', 0.24);
      this.tone(2093.0, t, 0.5, 'sine', 0.06);
      this.tone(2889.0, t, 0.22, 'sine', 0.025);
    } else if (name === 'ok') {         // "ピンポン"
      this.tone(1318.5, t, 0.16, 'sine', 0.2); this.tone(1046.5, t + 0.17, 0.42, 'sine', 0.2);
    } else if (name === 'ng') {         // "ブッブー"
      this.tone(155, t, 0.16, 'sawtooth', 0.09); this.tone(155, t + 0.22, 0.42, 'sawtooth', 0.09);
    }
  }
};
['pointerdown', 'touchend', 'keydown'].forEach(ev => document.addEventListener(ev, () => SFX.unlock(), { capture: true, passive: true }));
bindToggle('#t-sfx', () => SFX.on, v => { SFX.on = v; store.set('sfx', v); if (v) { SFX.unlock(); SFX.play('ok'); } });

// The question text appears a character at a time, like it is being read aloud.
// Answers are accepted while it is still appearing (早応え).
const READ_SPEEDS = { slow: 170, normal: 115, fast: 70 };
const READ_LABEL = { slow: 'ゆっくり', normal: 'ふつう', fast: 'はやい' };
const INTRO_MS = 250;   // the bell rings, and the text starts right after it
function readPlan(text, msPerChar) {
  const chars = [...text], at = []; let t = 0;
  for (const ch of chars) {
    at.push(t);
    t += msPerChar + ('、，,'.includes(ch) ? msPerChar * 2 : '。．！？!?'.includes(ch) ? msPerChar * 3 : 0);
  }
  return { chars, at, total: t };
}
function shownCount(plan, elapsed) {
  let n = 0; while (n < plan.chars.length && plan.at[n] <= elapsed) n++;
  return n;
}
function readingHTML(R, id) {
  if (!R) return `<p class="qtext reading" id="${id}"><span class="caret"></span></p>`;
  const n = R.done ? R.plan.chars.length : shownCount(R.plan, now() - R.start);
  const end = R.done || n >= R.plan.chars.length;
  return `<p class="qtext reading" id="${id}" data-n="${n}">${esc(R.plan.chars.slice(0, n).join(''))}${end ? '' : '<span class="caret"></span>'}</p>`;
}
let readerTimer = 0;
function startReader() { if (!readerTimer) readerTimer = setInterval(readerTick, 40); }
function readerTick() {
  let active = false;
  for (const R of [SQ.read, B.read, HQ.read]) {
    if (!R || R.done) continue;
    const n = shownCount(R.plan, now() - R.start);
    if (n >= R.plan.chars.length) R.done = true; else active = true;
    const el = document.getElementById(R.elId);
    if (el && el.dataset.n !== String(n)) {
      el.dataset.n = n;
      el.innerHTML = esc(R.plan.chars.slice(0, n).join('')) + (R.done ? '' : '<span class="caret"></span>');
    }
  }
  if (!active) { clearInterval(readerTimer); readerTimer = 0; }
}
const typeTag = q => q.type !== '国名' && !q.typeGuess ? `<span class="tag">答え: ${esc(q.type)}</span>` : '';
const locTag = q => !q.hideName && q.loc.name ? `<span class="tag">場所: ${esc(q.loc.name)}</span>` : '';

/* ================= solo quiz ================= */
const SQ = {
  diffs: new Set([1, 2, 3, 4, 5]), regs: new Set(REGIONS), mode: 'input', hideLoc: false,
  used: new Set(), state: 'idle', cur: null, n: 0, correct: 0, streak: 0, best: store.get('best', 0),
  view: idleView(), addOpen: false, addMsg: '',
  phase: '', read: null, token: 0, speed: store.get('speed', 'normal')
};
function filterPool(diffs, regs) {
  const all = regs.size === REGIONS.length;
  return allQs().filter(q => diffs.has(q.diff) && (all || regs.has(q.reg)));
}
function nextQuestion() {
  if (spinning) return;
  if (SQ.state === 'asking') SQ.streak = 0;
  const pool0 = filterPool(SQ.diffs, SQ.regs);
  if (!pool0.length) { toast('条件に合う問題がありません。出題設定を見直してください'); return; }
  let pool = pool0.filter(q => !SQ.used.has(q.id));
  if (!pool.length) { pool0.forEach(q => SQ.used.delete(q.id)); pool = pool0; toast('全問出題したので、もう一周します'); }
  const q = pool[Math.floor(Math.random() * pool.length)];
  SQ.used.add(q.id);
  SQ.n++;
  SQ.cur = { q, hint: 0, ok: null, given: '', choices: SQ.mode === 'choice' ? makeChoices(q) : null, at: null, frac: null };
  SQ.state = 'spinning'; SQ.phase = ''; SQ.read = null;
  const tok = ++SQ.token;
  SQ.view = { state: 'spinning', loc: q.loc, hideName: q.hideName, hideLoc: SQ.hideLoc, ok: null };
  updateSpinLabel(); renderQuiz();
  const z = SQ.hideLoc ? 1 : Math.min(zoomFor(q.loc), 4.2);
  const dest = SQ.hideLoc ? { lp: [q.loc.lp[0] + (Math.random() - 0.5) * 60, clamp(q.loc.lp[1] + (Math.random() - 0.5) * 36, -70, 75)] } : q.loc;
  spinTo(dest, z, {
    mask: q.hideName,
    onLand: () => { SQ.view.state = 'asking'; dirty = true; },
    onDone: () => {
      if (SQ.state !== 'spinning' || tok !== SQ.token) return;
      // the bell rings and the text starts to appear right after it
      SQ.state = 'asking'; SQ.phase = 'intro'; updateSpinLabel(); renderQuiz();
      SFX.play('question');
      if (isNarrow()) revealCard('#view-quiz .qcard');
      setTimeout(() => {
        if (tok !== SQ.token || SQ.state !== 'asking') return;
        SQ.phase = 'reading';
        SQ.read = { plan: readPlan(q.text, READ_SPEEDS[SQ.speed] || READ_SPEEDS.normal), start: now(), elId: 's-qtext', done: false };
        rerenderQuiz(); startReader(); focusAnswer();
      }, INTRO_MS);
    }
  });
}
function soloAnswer(text, picked) {
  if (SQ.state !== 'asking' || SQ.phase !== 'reading') return;
  const q = SQ.cur.q;
  let ok;
  if (picked != null) ok = norm(picked) === norm(q.alts[0]);
  else {
    if (!norm(text)) { toast('答えを入力してください'); return; }
    ok = isCorrect(q, text);
  }
  finishSolo(ok, picked != null ? picked : text);
}
function finishSolo(ok, given) {
  const q = SQ.cur.q;
  SQ.cur.ok = ok; SQ.cur.given = given;
  if (SQ.read) {
    SQ.cur.at = now() - SQ.read.start;
    SQ.cur.frac = SQ.read.done ? 1 : shownCount(SQ.read.plan, SQ.cur.at) / SQ.read.plan.chars.length;
    SQ.cur.after = SQ.cur.at - SQ.read.plan.total;
    SQ.read.done = true;
  }
  SFX.play(ok ? 'ok' : 'ng');
  if (ok) { SQ.correct++; SQ.streak++; if (SQ.streak > SQ.best) { SQ.best = SQ.streak; store.set('best', SQ.best); } }
  else SQ.streak = 0;
  SQ.state = 'answered'; SQ.view.state = 'answered'; SQ.view.ok = ok;
  updateSpinLabel(); renderQuiz(); dirty = true;
  if (SQ.hideLoc) flyTo(q.loc, { zoom: Math.min(zoomFor(q.loc), 4.2) });
  const nb = $('#q-next'); if (nb) nb.focus({ preventScroll: true });
}
function chipsHTML(prefix, set, list, withAll) {
  const all = set.size === list.length;
  return (withAll ? `<button class="chip" data-${prefix}="*" aria-pressed="${all}">すべて</button>` : '') +
    list.map(x => `<button class="chip" data-${prefix}="${x}" aria-pressed="${withAll ? (set.has(x) && !all) : set.has(x)}">${typeof x === 'number' ? '★'.repeat(x) : esc(x)}</button>`).join('');
}
function toggleIn(set, list, key, withAll) {
  if (!withAll) { if (set.has(key)) { if (set.size > 1) set.delete(key); } else set.add(key); return; }
  if (key === '*') { list.forEach(x => set.add(x)); return; }
  if (set.size === list.length) { set.clear(); set.add(key); return; }
  if (set.has(key)) { set.delete(key); if (!set.size) list.forEach(x => set.add(x)); } else set.add(key);
}
function answerUI(q, choices, prefix) {
  if (choices) return `<div class="choices">${choices.map((c, i) => `<button data-${prefix}c="${i}">${esc(c)}</button>`).join('')}</div>`;
  return `<form class="ansrow" data-form="${prefix}"><input id="${prefix}ans" placeholder="${q.typeGuess ? '答え' : esc(q.type)}を入力(ひらがな可)" autocomplete="off" aria-label="答え"><button class="btn primary">答える</button></form>`;
}
function dishesTeaser(q) {
  if (world !== 'food') return '';
  const o = locObj(q.loc);
  if (!o || !(o.d && o.d.length)) return '';
  return `<div class="sec"><h3>${esc(o.n)}の郷土料理</h3><div class="chips">${o.d.slice(0, 3).map(([n]) => `<a class="chip" style="text-decoration:none;color:inherit" href="${gsearch(`${o.n} ${n} 作り方`)}" target="_blank" rel="noopener">${esc(n)} ↗</a>`).join('')}</div></div>`;
}
function renderQuiz() {
  const v = $('#view-quiz');
  const pool = filterPool(SQ.diffs, SQ.regs).length;
  const answeredN = SQ.n - (SQ.state === 'asking' || SQ.state === 'spinning' ? 1 : 0);
  const errs = QUIZ.baseErr.concat(QUIZ.extraErr);
  const settings = `<details class="settings" id="sq-settings"${SQ.n === 0 ? ' open' : ''}>
    <summary>出題設定 <small>対象 ${pool}問</small></summary>
    <div class="set"><label class="lbl">難易度</label><div class="chips">${chipsHTML('d', SQ.diffs, [1, 2, 3, 4, 5], false)}</div></div>
    <div class="set"><label class="lbl">地域</label><div class="chips">${chipsHTML('r', SQ.regs, REGIONS, true)}</div></div>
    <div class="set"><label class="lbl">答え方</label><div class="seg" style="align-self:flex-start"><button data-m="input" aria-pressed="${SQ.mode === 'input'}">入力</button><button data-m="choice" aria-pressed="${SQ.mode === 'choice'}">4択</button></div></div>
    <div class="set"><label class="lbl">問題文の表示速度</label><div class="seg" style="align-self:flex-start">${Object.keys(READ_SPEEDS).map(k => `<button data-sp="${k}" aria-pressed="${SQ.speed === k}">${READ_LABEL[k]}</button>`).join('')}</div></div>
    <div class="set"><label class="switch"><input type="checkbox" id="set-hide" ${SQ.hideLoc ? 'checked' : ''}> 止まった場所を隠す(上級)</label></div>
  </details>`;
  const addBox = `<details class="settings" id="sq-add"${SQ.addOpen ? ' open' : ''}>
    <summary>問題を追加 <small>${QUIZ.base.length}問(${esc(QUIZ.baseSrc)})${QUIZ.extra.length ? ` + 追加${QUIZ.extra.length}問` : ''}</small></summary>
    <div class="set">
      <p class="note">スプレッドシートから行をコピーして貼り付けるか、TSV/CSVファイルを選んでください。列は ${QCOLS.join('・')}(問題と答え以外は省略可)。国名以外が答えの問題で場所の列がないときは、すぐ上にある国名の問題や、問題文に出てくる国名から場所を判断します。追加した問題はこの端末に保存され、対戦でも出題されます。</p>
      <textarea id="add-text" rows="4" placeholder="問題&#9;答え&#9;ジャンル&#9;難易度&#9;解説&#9;答えの種類&#9;場所&#9;選択肢"></textarea>
      <div class="btnrow"><button class="btn" id="add-paste">貼り付けた行を追加</button><label class="btn file">ファイルを選ぶ<input type="file" id="add-file" accept=".tsv,.csv,.txt,text/tab-separated-values,text/csv" hidden></label>${QUIZ.extra.length ? '<button class="btn" id="add-clear">追加した問題を消す</button>' : ''}</div>
      ${SQ.addMsg ? `<p class="hint">${esc(SQ.addMsg)}</p>` : ''}
      ${errs.length ? `<details class="errs"><summary>読み込めなかった行 ${errs.length}件</summary><ul>${errs.slice(0, 30).map(e => `<li>${esc(e)}</li>`).join('')}</ul></details>` : ''}
    </div>
  </details>`;
  const score = `<div class="score">
    <div><span class="k">正解</span><span class="v mono">${SQ.correct}<small>/${answeredN}</small></span></div>
    <div><span class="k">連続正解</span><span class="v mono">${SQ.streak}</span></div>
    <div><span class="k">最高記録</span><span class="v mono">${SQ.best}</span></div></div>`;
  let card = '';
  const cur = SQ.cur;
  if (SQ.state === 'idle' || !cur) {
    card = `<div class="qcard">
      <p class="lead">地球儀を回して、止まった場所についての問題に答えます。問題文は読み上げるように少しずつ表示されるので、分かった時点で答えてください(早応え)。</p>
      <div class="btnrow"><button class="btn brass" id="q-start">回して出題</button><button class="btn" id="q-battle">友達と対戦する</button></div>
      <p class="note">全${allQs().length}問</p></div>`;
  } else if (SQ.state === 'spinning') {
    card = `<div class="qcard"><p class="qmeta"><span>第${SQ.n}問</span></p><p class="qtext">地球儀が回っています…</p></div>`;
  } else {
    const q = cur.q;
    const meta = `<div class="qmeta"><span>第${SQ.n}問</span><span class="stars" aria-label="難易度${q.diff}">${stars(q.diff)}</span>${q.genre ? `<span class="tag">${esc(q.genre)}</span>` : ''}${typeTag(q)}${locTag(q)}${SQ.hideLoc ? '<span class="tag">位置なし</span>' : ''}</div>`;
    if (SQ.state === 'asking' && SQ.phase !== 'reading') {
      card = `<div class="qcard">${meta}${readingHTML(null, 's-qtext')}</div>`;
    } else if (SQ.state === 'asking') {
      card = `<div class="qcard">${meta}${readingHTML(SQ.read, 's-qtext')}${answerUI(q, cur.choices, 's')}
        ${cur.hint ? `<p class="hint">ヒント: ${esc(hintText(q, cur.hint))}</p>` : ''}
        <div class="btnrow"><button class="btn" id="q-hint" ${cur.hint >= maxHint(q) ? 'disabled' : ''}>ヒント${cur.hint ? 'をもう1つ' : ''}</button><button class="btn" id="q-giveup">わからない</button></div></div>`;
    } else {
      const o = locObj(q.loc);
      card = `<div class="qcard">${meta}<p class="qtext">${esc(q.text)}</p>
        <div class="result ${cur.ok ? 'ok' : 'ng'}">
          <p class="verdict ${cur.ok ? 'ok' : 'ng'}">${cur.ok ? '正解' : '残念'}</p>
          <p class="answer">答え <b>${esc(q.alts[0])}</b> ${q.type === '国名' && q.loc.place && q.loc.place.en ? `<span class="pen" style="display:inline">${esc(q.loc.place.en)}</span>` : ''}</p>
          ${!cur.ok && cur.given ? `<p class="expl">あなたの答え: ${esc(cur.given)}</p>` : ''}
          ${cur.frac != null && cur.given ? `<p class="expl">${cur.frac < 1 ? `問題文の${Math.max(1, Math.round(cur.frac * 100))}%で回答` : `読み終わってから${(Math.max(0, cur.after) / 1000).toFixed(1)}秒で回答`}</p>` : ''}
          ${cur.hint ? `<p class="expl">ヒント${cur.hint}回使用</p>` : ''}
        </div>
        ${q.expl ? `<p class="expl">${esc(q.expl)}</p>` : ''}
        ${dishesTeaser(q)}
        <div class="btnrow"><button class="btn brass" id="q-next">次の問題</button>${o ? `<button class="btn" id="q-explore">${esc(o.n)}を詳しく見る</button>` : ''}</div></div>`;
    }
  }
  v.innerHTML = `<div class="pane">${score}${card}${settings}${addBox}</div>`;
}
function rerenderQuiz() {
  const s = $('#sq-settings'), a = $('#sq-add');
  const open = s ? s.open : true; SQ.addOpen = a ? a.open : SQ.addOpen;
  const val = ($('#sans') || {}).value || '', ta = ($('#add-text') || {}).value || '';
  const inTextarea = document.activeElement && document.activeElement.id === 'add-text';
  renderQuiz();
  if ($('#sq-settings')) $('#sq-settings').open = open;
  if ($('#sans')) $('#sans').value = val;
  if ($('#add-text')) $('#add-text').value = ta;
  if (!inTextarea) focusAnswer();
}
// Typed answers on a computer: put the cursor in the answer box as soon as a question
// is shown, and send stray keystrokes there. Phones are left alone so the keyboard
// does not cover the globe.
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
function answerInput() {
  if (mode === 'hquiz' && HQ.state === 'asking' && HQ.phase === 'reading') return $('#hans');
  if (mode === 'quiz' && SQ.state === 'asking' && SQ.phase === 'reading') return $('#sans');
  if (mode === 'battle' && B.phase === 'asking' && B.stage === 'reading' && !B.myAns) return $('#bans');
  return null;
}
function focusAnswer() {
  if (!finePointer.matches) return;
  const inp = answerInput();
  if (inp && document.activeElement !== inp) inp.focus({ preventScroll: true });
}
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  const t = e.target;
  if (t && t.closest && t.closest('input,textarea,select,[contenteditable="true"]')) return;
  if (!(e.key.length === 1 || e.key === 'Process' || e.key === 'Backspace')) return;
  const inp = answerInput();
  if (inp) inp.focus({ preventScroll: true });
}, true);
function addQuestions(text, label) {
  const r = buildQuestions(text, 't');
  if (!r.qs.length) { SQ.addMsg = `${label}: 追加できる問題がありませんでした${r.errors.length ? '(' + r.errors[0] + ')' : ''}`; rerenderQuiz(); return; }
  const have = new Set(allQs().map(q => norm(q.text)));
  const fresh = r.qs.filter(q => !have.has(norm(q.text))).length;
  if (!fresh) { SQ.addMsg = `${label}: ${r.qs.length}問とも追加済みです`; SQ.addOpen = true; rerenderQuiz(); return; }
  // keep a header so stored text always parses the same way
  let body = String(text).replace(/\r\n?/g, '\n').trim();
  const first = parseTable(body)[0].map(h => String(h).trim());
  if (!first.includes('問題')) body = QCOLS.join('\t') + '\n' + body;
  QUIZ.extraText = QUIZ.extraText ? QUIZ.extraText + '\n\n' + body : body;
  store.set('extra-quiz', QUIZ.extraText);
  rebuildExtra();
  const dup = r.qs.length - fresh;
  SQ.addMsg = `${label}: ${fresh}問を追加しました${dup ? `(${dup}問は追加済み)` : ''}${r.errors.length ? `(読み込めなかった行 ${r.errors.length}件)` : ''}`;
  SQ.addOpen = true;
  rerenderQuiz();
}
// Stored extra text is re-parsed block by block (a block = one paste or file), so rows
// saved before the parser learned something new load now. Repeated questions count once.
function rebuildExtra() {
  QUIZ.extra = []; QUIZ.extraErr = [];
  const seen = new Set(QUIZ.base.map(q => norm(q.text)));
  QUIZ.extraText.split(/\n\s*\n/).forEach((blk, bi) => {
    const rr = buildQuestions(blk, 'x' + bi + '_');
    rr.qs.forEach(q => { const k = norm(q.text); if (!seen.has(k)) { seen.add(k); QUIZ.extra.push(q); } });
    QUIZ.extraErr.push(...rr.errors);
  });
}
if (QUIZ.extraText) rebuildExtra();
$('#view-quiz').addEventListener('click', e => {
  const t = e.target;
  if (t.closest('#q-start') || t.closest('#q-next')) { nextQuestion(); return; }
  if (t.closest('#q-battle')) { setMode('battle'); return; }
  if (t.closest('#q-giveup')) { if (SQ.state === 'asking') { SQ.token++; finishSolo(false, ''); } return; }
  if (t.closest('#q-hint')) { if (SQ.state === 'asking' && SQ.cur.hint < maxHint(SQ.cur.q)) { SQ.cur.hint++; rerenderQuiz(); } return; }
  if (t.closest('#q-explore')) { const o = locObj(SQ.cur.q.loc); setMode('explore'); select(o); return; }
  if (t.closest('#add-paste')) { const txt = ($('#add-text') || {}).value || ''; if (!txt.trim()) { toast('行を貼り付けてください'); return; } $('#add-text').value = ''; addQuestions(txt, '貼り付け'); return; }
  if (t.closest('#add-clear')) { QUIZ.extraText = ''; QUIZ.extra = []; QUIZ.extraErr = []; store.set('extra-quiz', ''); SQ.addMsg = '追加した問題を消しました'; rerenderQuiz(); return; }
  const cb = t.closest('[data-sc]'); if (cb && SQ.state === 'asking') { soloAnswer('', SQ.cur.choices[+cb.dataset.sc]); return; }
  const sp = t.closest('[data-sp]'); if (sp) { SQ.speed = sp.dataset.sp; store.set('speed', SQ.speed); rerenderQuiz(); return; }
  const d = t.closest('[data-d]'); if (d) { toggleIn(SQ.diffs, [1, 2, 3, 4, 5], +d.dataset.d, false); rerenderQuiz(); return; }
  const r = t.closest('[data-r]'); if (r) { toggleIn(SQ.regs, REGIONS, r.dataset.r, true); rerenderQuiz(); return; }
  const m = t.closest('[data-m]');
  if (m) { SQ.mode = m.dataset.m; if (SQ.state === 'asking') SQ.cur.choices = SQ.mode === 'choice' ? makeChoices(SQ.cur.q) : null; rerenderQuiz(); return; }
});
$('#view-quiz').addEventListener('change', e => {
  if (e.target.id === 'set-hide') { SQ.hideLoc = e.target.checked; rerenderQuiz(); dirty = true; }
  if (e.target.id === 'add-file' && e.target.files[0]) {
    const f = e.target.files[0], rd = new FileReader();
    rd.onload = () => addQuestions(String(rd.result), f.name);
    rd.readAsText(f, 'utf-8');
  }
});
$('#view-quiz').addEventListener('submit', e => { e.preventDefault(); soloAnswer(($('#sans') || {}).value || ''); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || (e.target.closest && e.target.closest('input,button,a,summary,textarea'))) return;
  if (mode === 'quiz' && SQ.state === 'answered') nextQuestion();
  if (mode === 'hquiz' && HQ.state === 'answered') histNextQuestion();
});

/* ================= online battle ================= */
const SB_URL = 'https://hefydmrqrdumpifbqlfp.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhlZnlkbXJxcmR1bXBpZmJxbGZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwOTQ3NTMsImV4cCI6MjEwNTY3MDc1M30.fkcVaREHGjZ6xG1kc5Zn8B3BBXHjHW-oHs78kQ9QzXw';
const SB_LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js';
const CODE_CH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const rid = () => Math.random().toString(36).slice(2, 10);
function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.supabase && window.supabase.createClient) return res();
    const s = document.createElement('script'); s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error('load'));
    document.head.appendChild(s);
  });
}
// Transport: Supabase Realtime broadcast. A local BroadcastChannel stands in when window.GLOBE_NET === 'local' (testing).
async function openNet(code, onMsg, onStatus) {
  if (window.GLOBE_NET === 'local') {
    const bc = new BroadcastChannel('globe-' + code);
    bc.onmessage = e => onMsg(e.data);
    setTimeout(() => onStatus('SUBSCRIBED'), 30);
    return { send(m) { bc.postMessage(m); setTimeout(() => onMsg(m), 0); }, close() { bc.close(); } };
  }
  await loadScript(SB_LIB);
  const client = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const ch = client.channel('globe-room-' + code, { config: { broadcast: { self: true, ack: false } } });
  ch.on('broadcast', { event: 'm' }, ({ payload }) => onMsg(payload));
  ch.subscribe(status => onStatus(status));
  return { send(m) { ch.send({ type: 'broadcast', event: 'm', payload: m }); }, close() { try { client.removeChannel(ch); } catch (e) { /* already closed */ } } };
}
const B = {
  net: null, code: '', me: { id: rid(), name: store.get('name', '') || `プレイヤー${10 + Math.floor(Math.random() * 90)}` },
  isHost: false, hostId: null, peers: new Map(), names: new Map(), scores: new Map(),
  phase: 'lobby', err: '', status: '',
  settings: { count: 10, time: 15, mode: 'choice', speed: 'normal', diffs: new Set([1, 2, 3, 4, 5]), regs: new Set(REGIONS) },
  stage: '', read: null, allowed: 0, msPerChar: 115,
  round: 0, total: 0, q: null, qp: null, answers: new Map(), results: null, myAns: null,
  tStart: 0, timeLimit: 20, tick: 0, hostTimer: 0, hb: 0, used: new Set(), revealed: 0, view: idleView(), joinCode: '',
  offset: 0, bestRtt: Infinity, startAt: 0
};
const HB_MS = 4000, GONE_MS = 13000;
// Shared clock: guests estimate (host clock - own clock) from ping/pong round trips and keep
// the sample with the shortest round trip. Questions carry a start time on the host clock,
// so every device spins, stops and starts reading at the same moment.
const LEAD_MS = 1500;
function resetClock() { B.offset = 0; B.bestRtt = B.isHost ? 0 : Infinity; }
function ping() { if (!B.isHost && B.net) send({ k: 'ping', t: Date.now() }); }
function pingBurst() { for (let i = 0; i < 5; i++) setTimeout(ping, i * 250); }
const hostToLocal = hostMs => now() + (hostMs - B.offset - Date.now());
function send(m) { if (B.net) B.net.send(Object.assign({ room: B.code, from: B.me.id }, m)); }
const activeIds = () => [...B.peers.entries()].filter(([id, p]) => id === B.me.id || now() - p.last < GONE_MS).map(([id]) => id);
const pname = id => (B.peers.get(id) || {}).name || B.names.get(id) || '退出したプレイヤー';
function settingsWire() { const s = B.settings; return { count: s.count, time: s.time, mode: s.mode, speed: s.speed, diffs: [...s.diffs], regs: [...s.regs] }; }
async function connect(code, asHost) {
  leaveRoom(true);
  B.code = code; B.isHost = asHost; B.hostId = asHost ? B.me.id : null;
  B.peers = new Map(); B.names = new Map(); B.scores = new Map();
  B.phase = 'connecting'; B.err = ''; B.view = idleView();
  renderBattle();
  try {
    B.net = await openNet(code, onMsg, st => {
      if (st === 'SUBSCRIBED') {
        B.phase = 'room'; sayHello(true); resetClock(); pingBurst();
        clearInterval(B.hb); B.hb = setInterval(heartbeat, HB_MS);
        renderBattle();
        if (!asHost) setTimeout(() => { if (B.code === code && !B.hostId && B.phase === 'room') { B.err = 'この部屋のホストが見つかりません。部屋コードを確認するか、しばらく待ってください。'; renderBattle(); } }, 6000);
      } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') {
        B.err = '通信サーバーにつながりませんでした。ネットワークを確認して、もう一度お試しください。';
        if (B.phase === 'connecting') B.phase = 'lobby';
        renderBattle();
      }
    });
  } catch (e) {
    B.phase = 'lobby'; B.err = 'オンライン対戦の部品を読み込めませんでした。公開ページ(Vercel)から開いてください。'; renderBattle();
  }
}
function sayHello(first) { send({ k: 'hello', name: B.me.name, host: B.isHost, first: !!first }); }
function heartbeat() {
  sayHello(false); ping();
  let changed = false;
  for (const [id, p] of B.peers) if (id !== B.me.id && now() - p.last > GONE_MS) { B.peers.delete(id); changed = true; if (id === B.hostId && !B.isHost) { B.err = 'ホストとの接続が切れました。'; } }
  if (changed) { renderPlayersLive(); if (B.isHost && B.phase === 'asking') maybeReveal(); if (B.err) renderBattle(); }
}
function leaveRoom(silent) {
  if (B.net) { send({ k: 'bye' }); const n = B.net; setTimeout(() => n.close(), 150); }
  B.net = null; clearInterval(B.hb); clearInterval(B.tick); clearTimeout(B.hostTimer);
  B.phase = 'lobby'; B.code = ''; B.isHost = false; B.hostId = null; B.view = idleView();
  if (!silent) { $('#readout').hidden = true; renderBattle(); dirty = true; }
}
function onMsg(m) {
  if (!m || m.room !== B.code) return;
  const from = m.from;
  switch (m.k) {
    case 'hello': {
      const isNew = !B.peers.has(from);
      B.peers.set(from, { name: m.name, host: !!m.host, last: now() });
      B.names.set(from, m.name);
      if (m.host) { B.hostId = from; if (B.err.startsWith('この部屋のホスト')) { B.err = ''; renderBattle(); } }
      if (B.isHost && from !== B.me.id && (m.first || isNew)) sendSync(from);
      if (isNew || m.first) renderPlayersLive();
      break;
    }
    case 'bye':
      B.peers.delete(from);
      if (from === B.hostId && !B.isHost) { B.err = 'ホストが部屋を出ました。'; renderBattle(); }
      else renderPlayersLive();
      if (B.isHost && B.phase === 'asking') maybeReveal();
      break;
    case 'sync':
      if (B.isHost || m.to !== B.me.id) break;
      // a question in progress needs the clock estimate first; everything else applies at once
      if ((m.phase === 'asking' || m.phase === 'spinning') && B.bestRtt === Infinity) setTimeout(() => applySync(m), 900);
      else applySync(m);
      break;
    case 'ping': if (B.isHost && from !== B.me.id) send({ k: 'pong', to: from, t: m.t, th: Date.now() }); break;
    case 'pong':
      if (m.to === B.me.id && !B.isHost) {
        const rtt = Date.now() - m.t;
        if (rtt >= 0 && rtt < B.bestRtt) { B.bestRtt = rtt; B.offset = m.th + rtt / 2 - Date.now(); }
      }
      break;
    case 'cfg': if (!B.isHost) { B.settingsView = m.settings; if (B.phase === 'room') renderBattle(); } break;
    case 'q': onQuestion(m, 0); break;
    case 'ans':
      if (m.round !== B.round) break;
      B.answers.set(from, { ok: m.ok, t: m.t, text: m.text });
      renderStatusLive();
      if (B.isHost) maybeReveal();
      break;
    case 'reveal': onReveal(m); break;
    case 'end': onEnd(m); break;
    case 'room':
      B.phase = 'room'; B.view = idleView(); B.results = null; clearInterval(B.tick); $('#readout').hidden = true;
      if (m.scores) B.scores = new Map(m.scores);
      renderBattle(); dirty = true; break;
    case 'host':  // someone took over as host
      B.hostId = from; if (from !== B.me.id) B.isHost = false; B.err = ''; resetClock(); pingBurst(); renderBattle(); break;
  }
}
function sendSync(to) {
  send({ k: 'sync', to, phase: B.phase, round: B.round, total: B.total, qp: B.qp, timeLimit: B.timeLimit, msPerChar: B.msPerChar, startAt: B.startAt,
    scores: [...B.scores], names: [...B.names], results: B.results, settings: settingsWire() });
}
function applySync(m) {
  B.scores = new Map(m.scores || []); (m.names || []).forEach(([id, n]) => B.names.set(id, n));
  B.settingsView = m.settings;
  if ((m.phase === 'asking' || m.phase === 'spinning') && m.qp) { onQuestion({ round: m.round, total: m.total, q: m.qp, timeLimit: m.timeLimit, msPerChar: m.msPerChar, startAt: m.startAt }); return; }
  if (m.phase === 'reveal' && m.qp) { B.round = m.round; B.total = m.total; B.qp = m.qp; B.q = fromWire(m.qp); onReveal({ round: m.round, results: m.results || [], scores: m.scores, names: m.names }); return; }
  if (m.phase === 'end') { onEnd({ scores: m.scores, names: m.names }); return; }
  renderBattle();
}
function toWire(q, choices) {
  return { text: q.text, alts: q.alts, type: q.type, typeGuess: q.typeGuess, genre: q.genre, diff: q.diff, expl: q.expl, choices, hideName: q.hideName,
    loc: { lp: q.loc.lp, pid: q.loc.place ? q.loc.place.id : null, ck: q.loc.city ? q.loc.city.key : null, name: q.loc.name } };
}
function fromWire(w) {
  const place = w.loc.pid ? placeById.get(w.loc.pid) : null, city = w.loc.ck ? cityByKey.get(w.loc.ck) : null;
  return { text: w.text, alts: w.alts, type: w.type, typeGuess: w.typeGuess, genre: w.genre, diff: w.diff, expl: w.expl, wireChoices: w.choices, hideName: w.hideName, choices: [],
    loc: { lp: w.loc.lp, place, city, name: w.loc.name || (city ? city.n : place ? place.n : '') } };
}
function battlePool() { return filterPool(B.settings.diffs, B.settings.regs); }
function hostStart() {
  const pool = battlePool();
  if (!pool.length) { toast('条件に合う問題がありません'); return; }
  B.scores = new Map(); activeIds().forEach(id => B.scores.set(id, 0));
  B.used = new Set(); B.round = 0; B.revealed = 0; B.total = Math.min(B.settings.count, pool.length);
  hostNext();
}
function hostNext() {
  if (!B.isHost) return;
  if (B.round >= B.total) { send({ k: 'end', scores: [...B.scores], names: [...B.names] }); return; }
  let pool = battlePool().filter(q => !B.used.has(q.id));
  if (!pool.length) { B.used.clear(); pool = battlePool(); }
  const q = pool[Math.floor(Math.random() * pool.length)];
  B.used.add(q.id);
  const r = B.round + 1;
  const msPerChar = READ_SPEEDS[B.settings.speed] || READ_SPEEDS.normal;
  send({ k: 'q', round: r, total: B.total, q: toWire(q, B.settings.mode === 'choice' ? makeChoices(q) : null), timeLimit: B.settings.time, msPerChar, startAt: Date.now() + LEAD_MS });
  clearTimeout(B.hostTimer);
  B.hostTimer = setTimeout(() => hostReveal(r), LEAD_MS + SPIN_TOTAL + INTRO_MS + readPlan(q.text, msPerChar).total + B.settings.time * 1000 + 2500);
}
function onQuestion(m) {
  B.round = m.round; B.total = m.total; B.qp = m.q; B.q = fromWire(m.q); B.timeLimit = m.timeLimit;
  B.msPerChar = m.msPerChar || READ_SPEEDS.normal;
  B.answers = new Map(); B.myAns = null; B.results = null; B.err = ''; B.stage = ''; B.read = null;
  B.startAt = m.startAt || (Date.now() + B.offset);
  B.phase = 'spinning';
  B.view = { state: 'spinning', loc: B.q.loc, hideName: B.q.hideName, hideLoc: false, ok: null };
  if (mode !== 'battle') setMode('battle');
  renderBattle();
  const r = m.round;
  // local times of the shared schedule: spin start, intro ("問題"), reading start
  const t0 = hostToLocal(B.startAt);
  const introAt = t0 + SPIN_TOTAL, readAt = introAt + INTRO_MS;
  const plan = readPlan(B.q.text, B.msPerChar);
  const startReading = () => {
    if (B.round !== r || B.phase !== 'asking' || B.stage === 'reading') return;
    B.stage = 'reading';
    B.tStart = readAt;
    B.allowed = plan.total + B.timeLimit * 1000;
    B.read = { plan, start: readAt, elId: 'b-qtext', done: false };
    renderBattle(); startReader();
    clearInterval(B.tick); B.tick = setInterval(tickTimer, 200); tickTimer();
    focusAnswer();
  };
  const begin = () => {
    if (B.round !== r || B.phase !== 'spinning') return;
    B.phase = 'asking'; B.view.state = 'asking'; dirty = true;
    if (isNarrow()) revealCard('#view-battle .qcard');
    if (now() >= readAt - 50) { startReading(); return; }
    B.stage = 'intro'; renderBattle(); SFX.play('question');
    setTimeout(startReading, readAt - now());
  };
  const land = () => { if (B.round === r) { B.view.state = 'asking'; dirty = true; } };
  const z = Math.min(zoomFor(B.q.loc), 4.2);
  if (now() > t0 + SPIN_MS) {
    // joined after the stop: go straight there and follow the remaining schedule
    land(); flyTo(B.q.loc, { zoom: z, dur: 500 });
    setTimeout(begin, Math.max(0, introAt - now()));
  } else {
    setTimeout(() => {
      if (B.round !== r) return;
      spinTo(B.q.loc, z, { t0, mask: B.q.hideName, onLand: land, onDone: begin });
      if (B.phase === 'spinning') renderBattle();
    }, Math.max(0, t0 - now()));
  }
}
function tickTimer() {
  if (B.phase !== 'asking' || B.stage !== 'reading') { clearInterval(B.tick); return; }
  const left = Math.max(0, B.allowed - (now() - B.tStart));
  const s = Math.ceil(left / 1000);
  const el = $('#b-time'); if (el) el.textContent = s;
  const bar = $('#b-bar'); if (bar) bar.style.width = (100 * left / B.allowed).toFixed(1) + '%';
  const ro = $('#readout');
  if (mode === 'battle' && !spinning) { ro.hidden = false; ro.textContent = B.myAns ? '回答済み · 残り ' + s + '秒' : '残り ' + s + '秒'; }
  if (left <= 0 && !B.myAns) submitBattle('', null, true);
}
function submitBattle(text, picked, timeout) {
  if (B.phase !== 'asking' || B.stage !== 'reading' || B.myAns) return;
  const q = B.q;
  let ok = false, given = '';
  if (picked != null) { ok = norm(picked) === norm(q.alts[0]); given = picked; }
  else if (!timeout) { if (!norm(text)) { toast('答えを入力してください'); return; } ok = isCorrect(q, text); given = text; }
  const t = Math.round(now() - B.tStart);
  B.myAns = { ok, t, text: given, timeout: !!timeout };
  if (B.read) B.read.done = true;
  send({ k: 'ans', round: B.round, ok, t, text: given });
  renderBattle();
}
function maybeReveal() {
  if (!B.isHost || B.phase !== 'asking') return;
  const ids = activeIds();
  if (ids.length && ids.every(id => B.answers.has(id))) setTimeout(() => hostReveal(B.round), 700);
}
function hostReveal(r) {
  if (!B.isHost || B.round !== r || B.revealed === r) return;
  B.revealed = r;
  clearTimeout(B.hostTimer);
  const ids = new Set([...activeIds(), ...B.answers.keys()]);
  const results = [];
  ids.forEach(id => {
    const a = B.answers.get(id);
    const pts = a && a.ok ? 10 + Math.round(10 * clamp(1 - a.t / (B.allowed || B.timeLimit * 1000), 0, 1)) : 0;
    B.scores.set(id, (B.scores.get(id) || 0) + pts);
    results.push({ id, name: pname(id), ok: !!(a && a.ok), pts, text: a ? a.text : '', t: a ? a.t : null });
  });
  results.sort((x, y) => (y.ok - x.ok) || ((x.t == null ? 1e9 : x.t) - (y.t == null ? 1e9 : y.t)));
  send({ k: 'reveal', round: r, results, scores: [...B.scores], names: [...B.names] });
}
function onReveal(m) {
  clearInterval(B.tick);
  B.phase = 'reveal'; B.results = m.results || [];
  B.scores = new Map(m.scores || []); (m.names || []).forEach(([id, n]) => B.names.set(id, n));
  const mine = B.results.find(x => x.id === B.me.id);
  if (B.read) B.read.done = true;
  if (mine && B.phase === 'reveal') SFX.play(mine.ok ? 'ok' : 'ng');
  B.view = { state: 'answered', loc: B.q ? B.q.loc : null, hideName: B.q ? B.q.hideName : false, hideLoc: false, ok: mine ? mine.ok : null };
  $('#readout').hidden = true;
  renderBattle(); dirty = true;
}
function onEnd(m) {
  clearInterval(B.tick); clearTimeout(B.hostTimer);
  B.phase = 'end'; B.scores = new Map(m.scores || []); (m.names || []).forEach(([id, n]) => B.names.set(id, n));
  B.view = idleView(); $('#readout').hidden = true;
  renderBattle(); dirty = true;
}
function ranking() {
  const ids = new Set([...B.scores.keys(), ...activeIds()]);
  return [...ids].map(id => ({ id, name: pname(id), pts: B.scores.get(id) || 0 })).sort((a, b) => b.pts - a.pts);
}
function playersHTML(withScore) {
  const rows = withScore ? ranking() : activeIds().map(id => ({ id, name: pname(id), pts: B.scores.get(id) || 0 }));
  let rank = 0, prev = null;
  return `<ol class="players">${rows.map((p, i) => {
    if (p.pts !== prev) { rank = i + 1; prev = p.pts; }
    const host = p.id === B.hostId, me = p.id === B.me.id;
    return `<li class="${me ? 'me' : ''}">${withScore ? `<span class="rk mono">${rank}</span>` : ''}<span class="pn">${esc(p.name)}${me ? '<small>あなた</small>' : ''}${host ? '<small class="host">ホスト</small>' : ''}</span>${withScore ? `<span class="pt mono">${p.pts}<small>点</small></span>` : ''}</li>`;
  }).join('')}</ol>`;
}
function renderPlayersLive() {
  const el = $('#b-players');
  if (el) el.innerHTML = playersHTML(B.phase !== 'room');
  else if (mode === 'battle' && B.phase === 'room') renderBattle();
}
function renderStatusLive() {
  const el = $('#b-status'); if (!el) return;
  el.innerHTML = statusHTML();
}
function statusHTML() {
  const ids = activeIds();
  return `<div class="chips">${ids.map(id => `<span class="chip ${B.answers.has(id) ? 'done' : ''}">${B.answers.has(id) ? '✓ ' : ''}${esc(pname(id))}</span>`).join('')}</div>`;
}
const shareLink = () => location.href.split('#')[0] + '#room-' + B.code;
function settingsSummary(s) {
  if (!s) return '';
  const diffs = s.diffs.length === 5 ? 'すべての難易度' : '難易度 ' + s.diffs.map(d => '★'.repeat(d)).join(' ');
  const regs = s.regs.length === REGIONS.length ? 'すべての地域' : s.regs.join('・');
  return `${s.count}問 · 読み終わってから${s.time}秒 · 表示${READ_LABEL[s.speed] || 'ふつう'} · ${s.mode === 'choice' ? '4択' : '入力'} · ${diffs} · ${regs}`;
}
function renderBattle() {
  const v = $('#view-battle');
  if (!v) return;
  const P = B.phase;
  let html = '';
  const errHTML = B.err ? `<p class="hint">${esc(B.err)}</p>` : '';
  if (P === 'lobby' || P === 'connecting') {
    html = `<div><p class="eyebrow">オンライン対戦</p><h2 class="pname">みんなで対戦</h2></div>
      <p class="lead">部屋を作って部屋コードを友達に伝えると、全員の画面で同じ地球儀が回り、同じ問題に同時に答えます。問題文は少しずつ表示され、読み終わる前でも答えられます。正解で10点、早く答えるほど最大10点のボーナスが付きます。</p>
      <div class="field"><label for="b-name">あなたの名前</label><input id="b-name" maxlength="12" value="${esc(B.me.name)}" autocomplete="nickname"></div>
      <div class="btnrow"><button class="btn brass" id="b-create" ${P === 'connecting' ? 'disabled' : ''}>部屋を作る</button></div>
      <div class="field"><label for="b-code">部屋コードで参加</label>
        <form class="ansrow" data-form="join"><input id="b-code" class="mono codein" maxlength="4" placeholder="ABCD" autocomplete="off" autocapitalize="characters" value="${esc(B.joinCode)}"><button class="btn primary" ${P === 'connecting' ? 'disabled' : ''}>参加する</button></form></div>
      ${P === 'connecting' ? '<p class="note">接続しています…</p>' : ''}${errHTML}`;
  } else if (P === 'room') {
    const s = B.isHost ? settingsWire() : B.settingsView;
    html = `<div class="roomhead"><div><p class="eyebrow">部屋コード</p><p class="code mono">${esc(B.code)}</p></div>
        <div class="btnrow"><button class="btn" id="b-copy">招待リンクをコピー</button></div></div>
      <p class="note">友達はこのページの対戦タブで部屋コードを入れるか、招待リンクを開くと参加できます。</p>
      <section class="sec"><h3>参加者 ${activeIds().length}人</h3><div id="b-players">${playersHTML(false)}</div></section>
      ${B.isHost ? `<section class="sec"><h3>ルール</h3>
        <div class="set"><label class="lbl">問題数</label><div class="seg" style="align-self:flex-start">${[5, 10, 15, 20].map(n => `<button data-bn="${n}" aria-pressed="${B.settings.count === n}">${n}問</button>`).join('')}</div></div>
        <div class="set"><label class="lbl">読み終わってからの制限時間</label><div class="seg" style="align-self:flex-start">${[5, 10, 15, 20].map(n => `<button data-bt="${n}" aria-pressed="${B.settings.time === n}">${n}秒</button>`).join('')}</div></div>
        <div class="set"><label class="lbl">問題文の表示速度</label><div class="seg" style="align-self:flex-start">${Object.keys(READ_SPEEDS).map(k => `<button data-bsp="${k}" aria-pressed="${B.settings.speed === k}">${READ_LABEL[k]}</button>`).join('')}</div></div>
        <div class="set"><label class="lbl">答え方</label><div class="seg" style="align-self:flex-start"><button data-bm="choice" aria-pressed="${B.settings.mode === 'choice'}">4択</button><button data-bm="input" aria-pressed="${B.settings.mode === 'input'}">入力</button></div></div>
        <div class="set"><label class="lbl">難易度</label><div class="chips">${chipsHTML('bd', B.settings.diffs, [1, 2, 3, 4, 5], false)}</div></div>
        <div class="set"><label class="lbl">地域</label><div class="chips">${chipsHTML('br', B.settings.regs, REGIONS, true)}</div></div>
        <p class="note">対象 ${battlePool().length}問</p></section>
        <div class="btnrow"><button class="btn brass" id="b-start">対戦開始</button><button class="btn" id="b-leave">部屋を出る</button></div>`
      : `<section class="sec"><h3>ルール</h3><p class="lead">${esc(settingsSummary(s)) || 'ホストがルールを決めています'}</p></section>
        <p class="lead">ホストが対戦を始めるのを待っています。</p>
        <div class="btnrow"><button class="btn" id="b-leave">部屋を出る</button>${B.err && B.err.includes('ホスト') ? '<button class="btn primary" id="b-takeover">自分がホストになる</button>' : ''}</div>`}
      ${errHTML}`;
  } else if (P === 'spinning' || P === 'asking') {
    const q = B.q;
    const meta = `<div class="qmeta"><span>第${B.round}問 / ${B.total}</span><span class="stars">${stars(q.diff)}</span>${q.genre ? `<span class="tag">${esc(q.genre)}</span>` : ''}${typeTag(q)}${locTag(q)}</div>`;
    if (P === 'spinning') html = `<div class="qcard">${meta}<p class="qtext">${spinning ? '地球儀が回っています…' : 'まもなく地球儀が回ります…'}</p></div>`;
    else if (B.stage !== 'reading') html = `<div class="qcard">${meta}${readingHTML(null, 'b-qtext')}</div>`;
    else {
      const left = Math.max(0, B.allowed - (now() - B.tStart));
      const timer = `<div class="timer"><span class="mono" id="b-time">${Math.ceil(left / 1000)}</span><small>秒</small><div class="bar"><div id="b-bar" style="width:${(100 * left / B.allowed).toFixed(1)}%"></div></div></div>`;
      const body = B.myAns
        ? `<p class="lead">${B.myAns.timeout ? '時間切れです。' : '回答を送りました。'}ほかのプレイヤーを待っています。</p>`
        : answerUI(q, q.wireChoices, 'b');
      html = `<div class="qcard">${meta}${timer}${readingHTML(B.read, 'b-qtext')}${body}</div>
        <section class="sec"><h3>回答状況</h3><div id="b-status">${statusHTML()}</div></section>`;
    }
    html += errHTML + (B.err && B.err.includes('ホスト') && !B.isHost ? '<div class="btnrow"><button class="btn primary" id="b-takeover">自分がホストになる</button><button class="btn" id="b-leave">部屋を出る</button></div>' : '');
  } else if (P === 'reveal') {
    const q = B.q, mine = (B.results || []).find(x => x.id === B.me.id);
    const last = B.round >= B.total;
    html = `<div class="qcard"><div class="qmeta"><span>第${B.round}問 / ${B.total}</span></div><p class="qtext">${esc(q.text)}</p>
      <div class="result ${mine && mine.ok ? 'ok' : 'ng'}"><p class="verdict ${mine && mine.ok ? 'ok' : 'ng'}">${mine ? (mine.ok ? '正解 +' + mine.pts : '残念') : '結果'}</p>
      <p class="answer">答え <b>${esc(q.alts[0])}</b></p></div>
      ${q.expl ? `<p class="expl">${esc(q.expl)}</p>` : ''}</div>
      <section class="sec"><h3>この問題の結果</h3><ul class="rres">${(B.results || []).map(r => `<li class="${r.ok ? 'ok' : 'ng'}"><span>${r.ok ? '○' : '×'} ${esc(r.name)}</span><span class="mono">${r.ok ? '+' + r.pts : '0'}</span><small>${r.text ? esc(r.text) : '無回答'}${r.t != null && r.ok ? ` · ${(r.t / 1000).toFixed(1)}秒` : ''}</small></li>`).join('')}</ul></section>
      <section class="sec"><h3>順位</h3><div id="b-players">${playersHTML(true)}</div></section>
      ${B.isHost ? `<div class="btnrow"><button class="btn brass" id="b-next">${last ? '結果発表' : '次の問題'}</button></div>` : `<p class="note">ホストが次へ進むのを待っています。</p>`}${errHTML}`;
  } else if (P === 'end') {
    const r = ranking();
    const top = r[0];
    html = `<div><p class="eyebrow">結果発表</p><h2 class="pname">${top ? esc(top.name) + ' の優勝' : '対戦終了'}</h2></div>
      <div id="b-players" class="final">${playersHTML(true)}</div>
      <div class="btnrow">${B.isHost ? '<button class="btn brass" id="b-again">もう一度遊ぶ</button>' : ''}<button class="btn" id="b-leave">部屋を出る</button></div>
      ${B.isHost ? '' : '<p class="note">ホストがもう一度遊ぶを押すと、部屋に戻ります。</p>'}${errHTML}`;
  }
  const prevAns = ($('#bans') || {}).value || '';
  v.innerHTML = `<div class="pane">${html}</div>`;
  if ($('#bans')) { $('#bans').value = prevAns; focusAnswer(); }
}
function setName(n) { n = String(n || '').trim().slice(0, 12); if (!n) return; B.me.name = n; store.set('name', n); if (B.net) sayHello(false); }
$('#view-battle').addEventListener('click', e => {
  const t = e.target;
  if (t.closest('#b-create')) {
    setName(($('#b-name') || {}).value);
    let code = ''; for (let i = 0; i < 4; i++) code += CODE_CH[Math.floor(Math.random() * CODE_CH.length)];
    connect(code, true); return;
  }
  if (t.closest('#b-leave')) { leaveRoom(false); return; }
  if (t.closest('#b-copy')) {
    const link = shareLink();
    const done = () => toast('招待リンクをコピーしました');
    try { navigator.clipboard.writeText(link).then(done, () => toast(link)); } catch (err) { toast(link); }
    return;
  }
  if (t.closest('#b-start')) { hostStart(); return; }
  if (t.closest('#b-next')) { hostNext(); return; }
  if (t.closest('#b-again')) { B.scores = new Map(); send({ k: 'room', scores: [] }); return; }
  if (t.closest('#b-takeover')) { B.isHost = true; B.hostId = B.me.id; B.err = ''; send({ k: 'host' }); sayHello(false); B.phase = 'room'; B.view = idleView(); send({ k: 'room', scores: [...B.scores] }); return; }
  const c = t.closest('[data-bc]'); if (c && B.phase === 'asking') { submitBattle('', B.q.wireChoices[+c.dataset.bc]); return; }
  const n = t.closest('[data-bn]'); if (n) { B.settings.count = +n.dataset.bn; cfgChanged(); return; }
  const tt = t.closest('[data-bt]'); if (tt) { B.settings.time = +tt.dataset.bt; cfgChanged(); return; }
  const bsp = t.closest('[data-bsp]'); if (bsp) { B.settings.speed = bsp.dataset.bsp; cfgChanged(); return; }
  const bm = t.closest('[data-bm]'); if (bm) { B.settings.mode = bm.dataset.bm; cfgChanged(); return; }
  const bd = t.closest('[data-bd]'); if (bd) { toggleIn(B.settings.diffs, [1, 2, 3, 4, 5], +bd.dataset.bd, false); cfgChanged(); return; }
  const br = t.closest('[data-br]'); if (br) { toggleIn(B.settings.regs, REGIONS, br.dataset.br, true); cfgChanged(); return; }
});
function cfgChanged() { if (B.isHost) send({ k: 'cfg', settings: settingsWire() }); renderBattle(); }
$('#view-battle').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target.dataset.form;
  if (f === 'join') {
    setName(($('#b-name') || {}).value);
    const code = (($('#b-code') || {}).value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 4) { B.err = '部屋コードは4文字です'; renderBattle(); return; }
    B.joinCode = code; connect(code, false);
  } else if (f === 'b') submitBattle(($('#bans') || {}).value || '');
});
$('#view-battle').addEventListener('change', e => { if (e.target.id === 'b-name') setName(e.target.value); });
window.addEventListener('pagehide', () => { if (B.net) send({ k: 'bye' }); });

/* ================= time slip: world history map ================= */
// Borders come from Cliopatria, one TopoJSON file per century under history/. A file is
// fetched the first time its century is shown, so the modern map stays as light as before.
const KM2 = 6371.0088 * 6371.0088;
const YMIN = 1, YMAX = 2024;
const fmtYear = y => y <= 0 ? `前${-y}年` : `${y}年`;
const startOf = p => p.s != null ? p.s : p.f;
function periodText(p) {
  const a = startOf(p), b = p.t;
  return b >= YMAX ? `${fmtYear(a)}〜` : `${fmtYear(a)}〜${fmtYear(b)}`;
}
function fmtArea(a) {
  const sig2 = x => { const e = Math.pow(10, Math.max(0, Math.floor(Math.log10(x)) - 1)); return Math.round(x / e) * e; };
  if (a >= 1e5) return `約${sig2(a / 1e4).toLocaleString()}万km²`;
  if (a >= 1e4) return `約${(Math.round(a / 1e3) / 10).toFixed(1)}万km²`;
  return `約${sig2(Math.max(1, a)).toLocaleString()}km²`;
}
// Japan's period for a year; from Meiji on, the era name and its year
const JP_PERIODS = [[1, '弥生時代'], [250, '古墳時代'], [592, '飛鳥時代'], [710, '奈良時代'], [794, '平安時代'], [1185, '鎌倉時代'],
  [1333, '建武の新政'], [1336, '南北朝時代'], [1392, '室町時代'], [1467, '戦国時代'], [1573, '安土桃山時代'], [1603, '江戸時代'],
  [1868, '明治時代'], [1912, '大正時代'], [1926, '昭和時代'], [1989, '平成'], [2019, '令和']];
const GENGO = [['明治', 1868], ['大正', 1912], ['昭和', 1926], ['平成', 1989], ['令和', 2019]];
function jpEraHTML(y) {
  let per = JP_PERIODS[0][1];
  for (const [s, n] of JP_PERIODS) if (y >= s) per = n;
  if (y < 1868) return `日本は <b>${per}</b>`;
  const gs = [];
  GENGO.forEach(([n, s], i) => { const next = GENGO[i + 1]; if (y >= s && (!next || y <= next[1])) gs.push(`${n}${y - s + 1 === 1 ? '元' : y - s + 1}年`); });
  return `日本は <b>${gs.join('・')}</b>`;
}
// "李淵/高祖" (a name and its other spellings) is shown as 李淵(高祖); several capitals as 平城・洛陽
const dispName = v => { const a = splitAlts(v); return a.length > 1 ? `${a[0]}(${a.slice(1).join('、')})` : a[0] || ''; };
const dispList = v => splitAlts(v).join('・');
// names written with a qualifier in brackets also accept the bare name and the bracketed one
function altNames(n, extra) {
  const out = [n];
  const bare = n.replace(/[（(][^）)]*[）)]/g, '').trim();
  if (bare && bare !== n) out.push(bare);
  const inner = n.match(/[（(]([^）)]*)[）)]/);
  if (inner) inner[1].split(/[・、]/).forEach(x => { x = x.trim(); if (x.length >= 2 && !/時代|など|以後|以前/.test(x)) out.push(x); });
  if (extra) splitAlts(extra).forEach(x => out.push(x));
  return [...new Set(out)];
}

/* ---------- loading ---------- */
const histUrl = f => 'history/' + f;
function histEnter() {
  $('#cmp-labels').hidden = !TS.cmp;
  syncTimebar();
  if (TS.idx) { setYear(TS.year, { force: true }); renderHist(); return; }
  if (!TS.loading) {
    TS.err = '';
    TS.loading = fetch(histUrl('index.json')).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(idx => {
      TS.idx = idx;
      TS.P = idx.polities.map((o, i) => Object.assign({ type: 'polity', id: 'h' + i, i, z: idx.zukan[o.n] || null }, o));
      TS.events = idx.events.map(([y, lon, lat, title, desc, pol]) => ({ y, lp: [lon, lat], title, desc, pol }));
      TS.loading = null;
      buildTicks(); buildHQPool();
      if (world === 'history') { setYear(TS.year, { force: true }); renderHist(); if (mode === 'hquiz') renderHQuiz(); }
    }).catch(() => {
      TS.loading = null;
      TS.err = location.protocol.startsWith('http') ? '歴史地図のデータを読み込めませんでした。通信状況を確かめて、もう一度開いてください。' : '歴史地図はファイルを直接開くと読み込めません。公開ページ(Vercel)か、ローカルのWebサーバーから開いてください。';
      if (world === 'history') renderHist();
    });
  }
  renderHist();
}
function histLeave() {
  stopPlay();
  $('#h-loading').hidden = true; $('#cmp-labels').hidden = true;
  if (HQ.state === 'spinning' || HQ.state === 'asking') { HQ.token++; HQ.state = 'idle'; HQ.view = null; }
}
const chunkOf = y => TS.idx.chunks.find(c => y >= c[0] && y <= c[1]);
function loadChunk(c) {
  const file = c[2];
  let ch = TS.chunks.get(file);
  if (ch) return ch.promise;
  ch = { ready: false, rows: null };
  ch.promise = fetch(histUrl(file)).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(topo => {
    const feats = topojson.feature(topo, topo.objects.p).features;
    ch.rows = feats.filter(f => f.geometry).map(f => {
      const q = f.properties;
      // a: area of the shape; o: its area before overlaps were cut out (orders drawing and clicks)
      return { p: TS.P[q.i], f: q.f, t: q.t, lp: q.l, a: q.a, o: q.o != null ? q.o : q.a, r: q.r, feat: f, b: null };
    });
    ch.ready = true;
    return ch;
  });
  ch.promise.catch(() => { TS.chunks.delete(file); toast('地図データを読み込めませんでした'); });
  TS.chunks.set(file, ch);
  return ch.promise;
}
// rows (polity shapes) that exist in year y, biggest first so small ones are drawn on top
// (by the area before the build cut overlaps out, so a cut shape keeps its place in the order)
function rowsAt(y) {
  const ch = TS.chunks.get(chunkOf(y)[2]);
  if (!ch || !ch.ready) return null;
  const leaf = [], grp = [];
  for (const r of ch.rows) if (r.f <= y && y <= r.t) (r.p.g ? grp : leaf).push(r);
  leaf.sort((a, b) => b.o - a.o);
  return { y, leaf, grp };
}
function ensureYear(y) {
  const c = chunkOf(y);
  const ch = TS.chunks.get(c[2]);
  return ch && ch.ready ? Promise.resolve(ch) : loadChunk(c);
}
function refreshRows() {
  if (!TS.idx) return;
  const r = rowsAt(TS.year);
  if (r) { TS.cur = r; $('#h-loading').hidden = true; }
  else {
    $('#h-loading').hidden = false;
    const want = TS.year;
    ensureYear(want).then(() => { if (TS.year === want) { refreshRows(); dirty = true; if (mode === 'hist') renderHistSoon(); } });
  }
  if (TS.cmp) {
    const rc = rowsAt(TS.cmpYear);
    if (rc) TS.cmpCur = rc;
    else { const want = TS.cmpYear; ensureYear(want).then(() => { if (TS.cmpYear === want) { TS.cmpCur = rowsAt(want); dirty = true; } }); }
  }
  // fetch the neighbouring century early when the year is near its edge
  const c = chunkOf(TS.year);
  if (TS.year - c[0] < 15 && c[0] > YMIN) loadChunk(chunkOf(c[0] - 1));
  if (c[1] - TS.year < 15 && c[1] < YMAX) loadChunk(chunkOf(c[1] + 1));
}
function setYear(y, opt = {}) {
  y = clamp(Math.round(y), YMIN, YMAX);
  if (y === TS.year && !opt.force) return;
  TS.year = y;
  if (TS.idx) refreshRows();
  syncTimebar();
  if (mode === 'hist' && !opt.quiet) renderHistSoon();
  dirty = true;
}
function stepYear(d) { if (histBusy()) { toast('回答してから年を動かせます'); return; } stopPlay(); setYear(TS.year + d); }

/* ---------- hit testing ---------- */
function inBox(b, ll) {
  const [lon, lat] = ll;
  if (lat < b[0][1] - 0.01 || lat > b[1][1] + 0.01) return false;
  return b[0][0] <= b[1][0] ? (lon >= b[0][0] - 0.01 && lon <= b[1][0] + 0.01) : (lon >= b[0][0] || lon <= b[1][0]);
}
function rowAt(set, ll) {
  if (!set || !countryAt(ll)) return null;   // shapes reach into the sea a little; only land counts
  let best = null;
  for (const r of set.leaf) {
    if (!r.b) r.b = d3.geoBounds(r.feat);
    if (!inBox(r.b, ll)) continue;
    if ((!best || r.o < best.o) && d3.geoContains(r.feat, ll)) best = r;
  }
  return best;
}
function histAt(ll, x = W / 2) {
  const set = TS.cmp && TS.cmpCur && x < W * TS.cmpX ? TS.cmpCur : TS.cur;
  const r = rowAt(set, ll);
  return r ? r.p : null;
}
const rowOf = (p, set = TS.cur) => set ? set.leaf.find(r => r.p === p) || set.grp.find(r => r.p === p) : null;
const cmpGrab = x => world === 'history' && TS.cmp && Math.abs(x - W * TS.cmpX) < 16;

/* ---------- drawing ---------- */
function histView() { return mode === 'hquiz' && HQ.view ? HQ.view : null; }
function drawLayer(set, isLeft) {
  const v = histView();
  const asking = v && v.state !== 'answered';
  const tCol = v ? (v.state === 'answered' ? (v.ok === true ? C.ok : v.ok === false ? C.ng : C.target) : C.target) : null;
  for (const r of set.leaf) {
    ctx.beginPath(); path(r.feat);
    let fill = C.hist[r.p.c] || C.hist[0];
    if (!isLeft && v && v.p === r.p && v.state !== 'spinning') fill = tCol;
    else if (!isLeft && !v && TS.sel === r.p) fill = C.hilite;
    ctx.fillStyle = fill; ctx.fill();
    if (!asking && hoverId === r.p.id) { ctx.fillStyle = C.hover; ctx.fill(); }
    if (!fastMotion) { ctx.strokeStyle = C.hLine; ctx.lineWidth = 0.6; ctx.stroke(); }
  }
  if (fastMotion) return;
  ctx.save(); ctx.setLineDash([5, 3]); ctx.strokeStyle = C.hGroup; ctx.lineWidth = 1.5;
  for (const r of set.grp) { ctx.beginPath(); path(r.feat); ctx.stroke(); }
  ctx.restore();
  const sr = !isLeft && !v && TS.sel ? rowOf(TS.sel, set) : null;
  if (sr) { ctx.beginPath(); path(sr.feat); ctx.strokeStyle = C.ink; ctx.lineWidth = 1.6; ctx.stroke(); }
}
function drawHistory(R, c) {
  // land nobody is recorded as ruling stays a pale grey
  // (the shapes were already cut to this coastline when the data was built)
  ctx.beginPath(); path(fc); ctx.fillStyle = C.hNone; ctx.fill();
  if (TS.cur) {
    if (TS.cmp && TS.cmpCur) {
      const xd = W * TS.cmpX;
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, xd, H); ctx.clip(); drawLayer(TS.cmpCur, true); ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.rect(xd, 0, W - xd, H); ctx.clip(); drawLayer(TS.cur, false); ctx.restore();
    } else drawLayer(TS.cur, false);
  }
  ctx.beginPath(); path(coast); ctx.strokeStyle = C.coast; ctx.lineWidth = 0.75; ctx.stroke();
  if (TS.modern && !fastMotion) {
    ctx.save(); ctx.setLineDash([4, 3]); ctx.beginPath(); path(borders); ctx.strokeStyle = C.hModern; ctx.lineWidth = zoom > 3 ? 1.1 : 0.85; ctx.stroke(); ctx.restore();
  }
}
function drawHistoryLabels(R, c) {
  const v = histView();
  const hideP = v && v.state !== 'answered' ? v.p : null;
  if (TS.cmp && TS.cmpCur) {
    const xd = W * TS.cmpX;
    ctx.save(); ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(xd, 0); ctx.lineTo(xd, H); ctx.stroke();
    ctx.beginPath(); ctx.arc(xd, H / 2, 13, 0, TAU); ctx.fillStyle = C.panel; ctx.fill(); ctx.stroke();
    ctx.fillStyle = C.ink; ctx.font = `700 12px ${C.fBody}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('⇔', xd, H / 2 + 1);
    ctx.restore();
    placed.push({ x: xd - 15, y: H / 2 - 15, w: 30, h: 30 });
  }
  // the selected polity, then this year's events, then names by size
  if (!v && TS.sel && TS.cur) {
    const r = rowOf(TS.sel);
    if (r && visible(r.lp, c, 0.02)) { const [x, y] = projection(r.lp); drawPin(x, y, C.hilite); label(r.p.n, x, y - 46, 14, { weight: 700, force: true, haloW: 4 }); }
  }
  if (v && v.state !== 'spinning' && v.row && visible(v.row.lp, c, 0.02)) {
    const [x, y] = projection(v.row.lp);
    const tCol = v.state === 'answered' ? (v.ok ? C.ok : C.ng) : C.target;
    drawPin(x, y, tCol, v.state === 'answered' ? '' : '?');
    if (v.state === 'answered') label(v.p.n, x, y - 46, 14, { weight: 700, force: true, haloW: 4 });
  }
  if (spinPhase === 'spin' || fastMotion) return;
  if (!v) {
    let n = 0;
    for (const e of TS.events) {
      if (e.y !== TS.year || !visible(e.lp, c, 0.05)) continue;
      const [x, y] = projection(e.lp);
      drawPin(x, y, C.ng, '!');
      label(e.title, x, y - 46, 12, { weight: 700, haloW: 3.6 });
      if (++n >= 6) break;
    }
  }
  if (!showLabels) return;
  const sides = TS.cmp && TS.cmpCur ? [[TS.cmpCur, 0, W * TS.cmpX], [TS.cur, W * TS.cmpX, W]] : TS.cur ? [[TS.cur, 0, W]] : [];
  for (const [set, x0, x1] of sides) {
    if (zoom < 2.6) {
      for (const r of set.grp) {
        const px = Math.sqrt(r.a / KM2) * R;
        if (px < 40 || !visible(r.lp, c, 0.25)) continue;
        const [x, y] = projection(r.lp);
        if (x < x0 || x > x1) continue;
        label(r.p.n, x, y - 14, 12.5, { family: C.fDisp, weight: 600, color: C.hGroup });
      }
    }
    for (const r of set.leaf) {
      if (r.p === hideP || (!v && r.p === TS.sel)) continue;
      const px = Math.sqrt(r.a / KM2) * R;
      if (px < 11) continue;
      if (!visible(r.lp, c, 0.2)) continue;
      const size = clamp(7.6 + px * 0.035, 9.5, 15);
      const font = `500 ${size}px ${C.fBody}`;
      if (px < mw(font, r.p.n) * 0.38) continue;
      const [x, y] = projection(r.lp);
      if (x < x0 || x > x1) continue;
      label(r.p.n, x, y, size, { weight: size > 12.5 ? 700 : 500 });
    }
  }
  if (TS.modern && zoom >= 1.4) {
    for (const p of labelPlaces) {
      const px = Math.sqrt(p.a) * R;
      if (px < 16 || !visible(p.lp, c, 0.25)) continue;
      const [x, y] = projection(p.lp);
      label(p.n, x, y + 14, 10, { color: C.hModern, weight: 500 });
    }
  }
}

/* ---------- year bar ---------- */
const tbRange = $('#tb-range'), tbYear = $('#tb-year');
const SPEEDS = { slow: 500, normal: 160, fast: 55 };
function syncTimebar() {
  tbYear.textContent = TS.year;
  if (+tbRange.value !== TS.year) tbRange.value = TS.year;
  $('#tb-jp').innerHTML = jpEraHTML(TS.year);
  $('#tb-play').textContent = TS.play ? '❚❚' : '▶';
  $('#tb-play').setAttribute('aria-label', TS.play ? '停止' : '再生');
  const fl = TS.play && TS.play.follow;
  $('#tb-follow').hidden = !fl;
  if (fl) $('#tb-follow').textContent = `${fl.n}を追跡中`;
  $('#tb-cmp').setAttribute('aria-pressed', String(TS.cmp));
  $('#tb-cmprow').hidden = !TS.cmp;
  $('#tb-cyear').value = TS.cmpYear;
  $('#cmp-labels').hidden = !(TS.cmp && world === 'history');
  $('#cmp-l').textContent = fmtYear(TS.cmpYear); $('#cmp-r').textContent = fmtYear(TS.year);
  document.querySelectorAll('#tb-speed button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sp === TS.speed)));
  const busy = histBusy();
  document.querySelectorAll('#timebar button, #timebar input').forEach(el => { el.disabled = busy; });
}
function buildTicks() {
  const span = YMAX - YMIN;
  const years = [...new Set(TS.events.map(e => e.y))];
  $('#tb-ticks').innerHTML = years.map(y => `<span style="left:${((y - YMIN) / span * 100).toFixed(2)}%"></span>`).join('');
}
tbRange.addEventListener('input', () => { if (histBusy()) return; stopPlay(); setYear(+tbRange.value); });
tbYear.onclick = () => {
  if (histBusy()) return;
  $('#tb-yform').hidden = false; tbYear.hidden = true;
  const inp = $('#tb-yinput'); inp.value = TS.year; inp.focus(); inp.select();
};
function closeYearForm(apply) {
  if ($('#tb-yform').hidden) return;
  const v = parseInt($('#tb-yinput').value, 10);
  $('#tb-yform').hidden = true; tbYear.hidden = false;
  if (apply && isFinite(v)) { stopPlay(); setYear(v); }
}
$('#tb-yform').addEventListener('submit', e => { e.preventDefault(); closeYearForm(true); });
$('#tb-yinput').addEventListener('blur', () => closeYearForm(true));
$('#tb-yinput').addEventListener('keydown', e => { if (e.key === 'Escape') closeYearForm(false); });
$('#timebar').addEventListener('click', e => {
  const st = e.target.closest('[data-step]'); if (st) { stepYear(+st.dataset.step); return; }
  const cs = e.target.closest('[data-cstep]'); if (cs) { TS.cmpYear = clamp(TS.cmpYear + +cs.dataset.cstep, YMIN, YMAX); refreshRows(); syncTimebar(); dirty = true; return; }
  const sp = e.target.closest('[data-sp]'); if (sp) { TS.speed = sp.dataset.sp; if (TS.play) restartPlay(); syncTimebar(); return; }
  if (e.target.closest('#tb-play')) { if (TS.play) stopPlay(); else startPlay(null); return; }
  if (e.target.closest('#tb-cmp')) { toggleCompare(!TS.cmp); return; }
});
$('#tb-cyear').addEventListener('change', e => { const v = parseInt(e.target.value, 10); if (isFinite(v)) { TS.cmpYear = clamp(v, YMIN, YMAX); refreshRows(); syncTimebar(); dirty = true; } });
function toggleCompare(on) {
  TS.cmp = on;
  if (on) {
    if (TS.cmpYear === TS.year) TS.cmpYear = clamp(TS.year >= 1000 ? TS.year - 500 : TS.year + 500, YMIN, YMAX);
    TS.cmpX = 0.5; TS.cmpCur = null; refreshRows();
  }
  syncTimebar(); dirty = true;
}

/* ---------- playback (and following one polity) ---------- */
function startPlay(follow) {
  if (!TS.idx) return;
  if (histBusy()) { toast('回答してから再生できます'); return; }
  stopPlay();
  if (!follow && TS.year >= YMAX) setYear(YMIN);
  TS.play = { follow, timer: 0, last: 0 };
  restartPlay();
  syncTimebar();
}
function restartPlay() {
  clearInterval(TS.play.timer);
  TS.play.timer = setInterval(playTick, SPEEDS[TS.speed] || SPEEDS.normal);
}
function stopPlay() {
  if (!TS.play) return;
  clearInterval(TS.play.timer); TS.play = null;
  syncTimebar();
  if (mode === 'hist') renderHistSoon();
}
function playTick() {
  const pl = TS.play; if (!pl) return;
  const next = TS.year + 1;
  const end = pl.follow ? Math.min(pl.follow.t + 1, YMAX) : YMAX;
  if (TS.year >= end) {
    const f = pl.follow;
    stopPlay();
    if (f) toast(f.t >= YMAX ? `${f.n}は今も続いています` : `${f.n}は${fmtYear(f.t)}までの勢力です`);
    return;
  }
  // wait for the next century's data instead of skipping years
  const ch = TS.chunks.get(chunkOf(next)[2]);
  if (!ch || !ch.ready) { ensureYear(next); return; }
  setYear(next, { quiet: true });
  if (pl.follow) followCamera(pl.follow);
  if (mode === 'hist' && now() - pl.last > 450) { pl.last = now(); renderHist(); }
}
function followCamera(p) {
  const r = rowOf(p);
  if (!r) return;
  const z = clamp(0.72 / Math.max(r.r || 0.01, 0.01), 1, 6.5);
  const c = center();
  if (d3.geoDistance(c, r.lp) * 180 / Math.PI < 2 && Math.abs(Math.log(z / zoom)) < 0.15) return;
  if (anim && anim.follow) return;
  const a = animateTo(r.lp[0], r.lp[1], z, { dur: 700 });
  a.follow = true;
}

/* ---------- selecting and jumping ---------- */
const zoomForRow = r => clamp(0.72 / Math.max(r.r || 0.01, 0.01), 1, 6.5);
function histSelect(p, opt = {}) {
  TS.sel = p;
  renderHist();
  if (opt.fly) { const r = rowOf(p); if (r) animateTo(r.lp[0], r.lp[1], zoomForRow(r)); }
  dirty = true;
}
function histJumpTo(p, year) {
  if (histBusy()) { toast('回答してから探せます'); return; }
  stopPlay();
  const y = year != null ? year : (TS.year >= p.f && TS.year <= p.t ? TS.year : (TS.year < p.f ? p.f : p.t));
  setYear(y);
  TS.sel = p; renderHist();
  ensureYear(y).then(() => { if (TS.sel !== p) return; refreshRows(); const r = rowOf(p); if (r) animateTo(r.lp[0], r.lp[1], zoomForRow(r)); renderHist(); dirty = true; });
}
let histIdxCache = null;
function histSearchIndex() {
  if (!TS.idx) return [];
  if (histIdxCache) return histIdxCache;
  histIdxCache = TS.P.map(p => ({ o: p, keys: [...altNames(p.n, p.z && p.z['別名']), ...(p.z && p.z['よみ'] ? [p.z['よみ']] : []), ...p.en.split(' / ')].map(norm).filter(Boolean),
    kind: p.g ? 'まとまり' : '勢力', sub: periodText(p), rank: p.z ? 0 : p.a >= 3e5 ? 1 : 2 }));
  return histIdxCache;
}
function histShuffle() {
  if (spinning || !TS.cur) return;
  stopPlay();
  const pool = TS.cur.leaf.filter(r => r.p !== TS.sel);
  if (!pool.length) return;
  const w = pool.map(r => Math.sqrt(r.a) * (r.p.z ? 3 : 1));
  let x = Math.random() * w.reduce((s, v) => s + v, 0), r = pool[0];
  for (let i = 0; i < pool.length; i++) { x -= w[i]; if (x <= 0) { r = pool[i]; break; } }
  TS.sel = null; dirty = true;
  $('#view-hist').innerHTML = `<div class="pane"><p class="eyebrow">シャッフル中 · ${fmtYear(TS.year)}</p><h2 class="pname">…</h2><p class="lead">${flat ? '地図' : '地球儀'}が止まった場所の勢力を図鑑で表示します。</p></div>`;
  const started = now();
  spinTo({ lp: r.lp, n: r.p.n }, Math.min(zoomForRow(r), 4.5), {
    onLand: () => histSelect(r.p),
    onDone: () => { if (isNarrow() && lastPointer < started && mode === 'hist' && TS.sel === r.p) revealPanel(); }
  });
}

/* ---------- which modern countries a shape covers ---------- */
function modernShare(r) {
  if (TS.geoCache.has(r)) return TS.geoCache.get(r);
  if (!r.b) r.b = d3.geoBounds(r.feat);
  const [[x0, y0], [x1, y1]] = r.b;
  const w = x1 >= x0 ? x1 - x0 : x1 + 360 - x0, h = y1 - y0;
  const step = Math.max(0.12, Math.sqrt(w * h / 700));
  const count = new Map(); let n = 0;
  for (let y = y0 + step / 2; y < y1; y += step) {
    for (let dx = step / 2; dx < w; dx += step) {
      let x = x0 + dx; if (x > 180) x -= 360;
      const ll = [x, y];
      if (!d3.geoContains(r.feat, ll)) continue;
      const f = countryAt(ll);
      if (!f) continue;
      n++; count.set(f.id, (count.get(f.id) || 0) + 1);
    }
  }
  if (!n) { const f = countryAt(r.lp); if (f) { n = 1; count.set(f.id, 1); } }
  const out = [...count].map(([id, k]) => [placeById.get(id), k / n]).filter(([p, s]) => p && (s >= 0.04 || count.size <= 3)).sort((a, b) => b[1] - a[1]).slice(0, 8);
  TS.geoCache.set(r, out);
  return out;
}

/* ---------- encyclopedia panel ---------- */
let histRenderT = 0;
function renderHistSoon() { if (histRenderT) return; histRenderT = setTimeout(() => { histRenderT = 0; if (mode === 'hist') renderHist(); }, 120); }
function sparkSVG(p) {
  const h = p.h || [];
  if (h.length < 2) return '';
  const pts = [];
  for (let i = 0; i < h.length; i += 2) { const end = i + 2 < h.length ? h[i + 2] - 1 : p.t; pts.push([h[i], h[i + 1]]); pts.push([Math.max(h[i], end), h[i + 1]]); }
  const x0 = pts[0][0], x1 = Math.max(pts[pts.length - 1][0], x0 + 1), amax = Math.max(1, ...pts.map(q => q[1]));
  const Wd = 360, Hd = 56;
  const X = x => 4 + (x - x0) / (x1 - x0) * (Wd - 8), Y = a => Hd - 12 - a / amax * (Hd - 18);
  const d = pts.map((q, i) => `${i ? 'L' : 'M'}${X(q[0]).toFixed(1)},${Y(q[1]).toFixed(1)}`).join('');
  const area = `${d}L${X(x1).toFixed(1)},${Hd - 12}L${X(x0).toFixed(1)},${Hd - 12}Z`;
  const nowX = TS.year >= x0 && TS.year <= x1 ? X(TS.year) : null;
  return `<svg class="spark" viewBox="0 0 ${Wd} ${Hd + 8}" preserveAspectRatio="none" role="img" aria-label="${esc(p.n)}の面積の移り変わり(最大${fmtArea(amax * 1000)})">
    <path class="ar" d="${area}"/><path class="ln" d="${d}"/>
    ${nowX != null ? `<line class="now" x1="${nowX.toFixed(1)}" x2="${nowX.toFixed(1)}" y1="2" y2="${Hd - 12}"/>` : ''}
    <text x="4" y="${Hd + 4}">${x0}</text><text x="${Wd - 4}" y="${Hd + 4}" text-anchor="end">${x1}</text>
    <text x="${Wd - 4}" y="10" text-anchor="end">最大${fmtArea(amax * 1000)}</text></svg>`;
}
const peopleOf = p => (p.z ? p.z.people : []);
const cardKey = (p, name) => `${p.n}|${name}`;
function allCards() {
  const out = [];
  for (const p of TS.P) for (const [name, desc] of peopleOf(p)) out.push({ p, name, desc, key: cardKey(p, name) });
  return out;
}
function cardsHTML(list) {
  return `<div class="pcards">${list.map(c => {
    const got = TS.cards.has(c.key);
    if (!got) return `<div class="pcard locked"><b>？？？</b><small>${esc(c.p.n)}</small></div>`;
    return `<button class="pcard${TS.newCard === c.key ? ' new' : ''}" data-card="${esc(c.key)}"><b>${esc(splitAlts(c.name)[0])}</b><small>${esc(c.p.n)}</small></button>`;
  }).join('')}</div>`;
}
function eventsHTML(list) {
  return `<ul class="evlist">${list.map(e => `<li data-ev="${e.y}"><span class="ey">${fmtYear(e.y)}</span><b>${esc(e.title)}</b>${e.desc ? `<small>${esc(e.desc)}</small>` : ''}</li>`).join('')}</ul>`;
}
function renderHist() {
  const v = $('#view-hist');
  if (!v) return;
  if (!TS.idx) {
    v.innerHTML = `<div class="pane"><div><p class="eyebrow">タイムスリップ</p><h2 class="pname">世界史の地図</h2></div>
      ${TS.err ? `<p class="hint">${esc(TS.err)}</p>` : '<p class="lead">歴史地図のデータを読み込んでいます…</p>'}</div>`;
    return;
  }
  const p = TS.sel, Y = TS.year;
  if (!p) { v.innerHTML = `<div class="pane">${histHomeHTML(Y)}</div>`; return; }
  const z = p.z || {};
  const r = rowOf(p);
  const alive = Y >= p.f && Y <= p.t;
  const meta = [];
  meta.push(['存続', esc(periodText(p))]);
  if (r) meta.push([`${Y}年の面積`, esc(fmtArea(r.a))]);
  else meta.push(['最大の面積', esc(fmtArea(p.a))]);
  ['首都', '建国者', '政治', '宗教'].forEach(k => { if (z[k]) meta.push([k === '政治' ? '政治体制' : k, esc(k === '首都' ? dispList(z[k]) : k === '建国者' ? dispName(z[k]) : z[k])]); });
  const share = r && !p.g ? modernShare(r) : [];
  if (meta.length % 2) meta[meta.length - 1][2] = 'wide';
  if (share.length) meta.push(['現在の国でいうと', share.map(([q, s2]) => `${esc(q.n)}${s2 >= 0.995 ? '' : `<small style="color:var(--ink-3)"> ${Math.round(s2 * 100) || '<1'}%</small>`}`).join('、'), 'wide']);
  const evs = TS.events.filter(e => e.pol === p.n);
  const people = peopleOf(p);
  const things = z.things || [];
  const status = alive ? '' : `<p class="hint">${fmtYear(Y)}にはまだ${Y < p.f ? '現れていません' : 'ありません(すでに滅亡・分裂などしています)'}。</p>`;
  v.innerHTML = `<div class="pane">
    <div>
      <p class="eyebrow">${p.g ? '国々のまとまり' : '勢力'} · ${fmtYear(Y)}の地図</p>
      <h2 class="pname">${esc(p.n)}</h2>
      ${z['よみ'] ? `<p class="pen">${esc(z['よみ'])}</p>` : ''}
      <p class="pen">${esc(p.en)}</p>
    </div>
    ${status}
    <dl class="meta hmeta">${meta.map(([k, val, cls]) => `<div class="${cls || ''}"><dt>${k}</dt><dd>${val}</dd></div>`).join('')}</dl>
    <div class="btnrow">
      ${p.g ? '' : `<button class="btn brass" id="h-follow">${esc(p.n)}の興亡を再生</button>`}
      <button class="btn" id="h-start">${p.s != null ? '地図の最初の年' : '始まりの年'}(${p.f}年)</button>
      <button class="btn" id="h-end">${p.t >= YMAX ? '最新の年' : '最後の年'}(${p.t}年)</button>
    </div>
    ${p.g ? '' : `<section class="sec"><h3>面積の移り変わり</h3>${sparkSVG(p)}</section>`}
    ${z['まとめ'] ? `<section class="sec"><h3>どんな国?</h3><p class="pdesc">${esc(z['まとめ'])}</p></section>` : ''}
    ${z['建国'] ? `<section class="sec"><h3>建国</h3><p class="pdesc">${esc(z['建国'])}</p></section>` : ''}
    ${people.length ? `<section class="sec"><h3>人物</h3>${cardsHTML(people.map(([name, desc]) => ({ p, name, desc, key: cardKey(p, name) })))}<p class="note">人物カードはクイズで正解すると手に入ります。</p></section>` : ''}
    ${things.length ? `<section class="sec"><h3>発明・文化</h3><ul class="things">${things.map(([n, d]) => `<li><b>${esc(dispName(n))}</b>${esc(d)}</li>`).join('')}</ul></section>` : ''}
    ${z.notes && z.notes.length ? `<section class="sec"><h3>特筆すべきこと</h3><ul class="trivia">${z.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></section>` : ''}
    ${z['滅亡'] ? `<section class="sec"><h3>滅亡・その後</h3><p class="pdesc">${esc(z['滅亡'])}</p></section>` : ''}
    ${!p.z ? `<p class="empty">この勢力の図鑑の解説はまだありません。少しずつ追加していきます。</p>` : ''}
    ${evs.length ? `<section class="sec"><h3>関係する出来事</h3>${eventsHTML(evs)}</section>` : ''}
    <section class="sec"><h3>もっと調べる</h3><div class="chips">
      <a class="chip" style="text-decoration:none;color:inherit" href="https://ja.wikipedia.org/w/index.php?search=${encodeURIComponent(p.n.replace(/[（(].*?[）)]/g, '') || p.n)}" target="_blank" rel="noopener">ウィキペディアで探す ↗</a>
      ${p.w ? `<a class="chip" style="text-decoration:none;color:inherit" href="https://en.wikipedia.org/wiki/${encodeURIComponent(p.w.replace(/ /g, '_'))}" target="_blank" rel="noopener">英語版の記事 ↗</a>` : ''}
    </div>${p.x ? '<p class="note">この勢力は Cliopatria にないため、このサイトで範囲をおおまかに描き足しています。</p>' : ''}</section>
    <div class="btnrow"><button class="btn" id="h-home">${fmtYear(Y)}の世界に戻る</button></div>
  </div>`;
}
function histHomeHTML(Y) {
  const evs = TS.events.filter(e => e.y === Y);
  const prev = [...TS.events].reverse().find(e => e.y < Y), next = TS.events.find(e => e.y > Y);
  const seen = new Set(), big = [];
  if (TS.cur) for (const r of TS.cur.leaf.slice().sort((x, y) => y.a - x.a)) { if (!seen.has(r.p)) { seen.add(r.p); big.push(r); } if (big.length >= 18) break; }
  const cards = allCards(), got = cards.filter(c => TS.cards.has(c.key)).length;
  return `<div><p class="eyebrow">タイムスリップ · ${esc(jpEraHTML(Y).replace(/<\/?b>/g, ''))}</p><h2 class="pname">${fmtYear(Y)}の世界</h2></div>
    <p class="lead">下の年表で1年ずつ時代を動かせます。地図の国をクリックすると図鑑が開きます。</p>
    <section class="sec"><h3>この年の出来事</h3>${evs.length ? eventsHTML(evs) : '<p class="empty">この年の出来事はまだ登録されていません。</p>'}
      <div class="btnrow" style="margin-top:8px">${prev ? `<button class="btn" data-ev="${prev.y}">‹ 前の出来事(${fmtYear(prev.y)})</button>` : ''}${next ? `<button class="btn" data-ev="${next.y}">次の出来事(${fmtYear(next.y)}) ›</button>` : ''}</div></section>
    <section class="sec"><h3>この年の大きな勢力</h3>${big.length ? `<div class="chips">${big.map(r => `<button class="chip${r.p.z ? ' on' : ''}" data-hp="${r.p.i}"><span class="swatch" style="background:${C.hist[r.p.c] || C.hist[0]}"></span>${esc(r.p.n)}</button>`).join('')}</div><p class="note">枠が金色の勢力には図鑑の解説があります。</p>` : '<p class="empty">読み込んでいます…</p>'}</section>
    <section class="sec"><h3>人物カード ${got}/${cards.length}</h3>${got ? cardsHTML(cards.filter(c => TS.cards.has(c.key))) : '<p class="empty">まだ1枚も持っていません。</p>'}
      <p class="note">クイズの「図鑑から」の問題で人物を答えると、人物カードが手に入ります。</p>
      ${got < cards.length ? `<details class="settings" style="margin-top:8px"><summary>まだ持っていないカード <small>${cards.length - got}枚</small></summary><div class="set">${cardsHTML(cards.filter(c => !TS.cards.has(c.key)))}</div></details>` : ''}</section>`;
}
$('#view-hist').addEventListener('click', e => {
  const t = e.target;
  if (spinning) return;
  const ev = t.closest('[data-ev]'); if (ev) { if (histBusy()) return; stopPlay(); setYear(+ev.dataset.ev); const e1 = TS.events.find(x => x.y === +ev.dataset.ev); if (e1) animateTo(e1.lp[0], e1.lp[1], Math.max(zoom, 2.2)); renderHist(); return; }
  const hp = t.closest('[data-hp]'); if (hp) { histSelect(TS.P[+hp.dataset.hp], { fly: true }); return; }
  const cd = t.closest('[data-card]');
  if (cd) {
    const c = allCards().find(x => x.key === cd.dataset.card);
    if (c) { TS.newCard = ''; toastLong(`${dispName(c.name)} — ${c.p.n}: ${c.desc}`); }
    return;
  }
  const p = TS.sel;
  if (t.closest('#h-home')) { TS.sel = null; renderHist(); dirty = true; return; }
  if (!p) return;
  if (t.closest('#h-follow')) { histJumpTo(p, p.f); setTimeout(() => startPlay(p), 400); return; }
  if (t.closest('#h-start')) { histJumpTo(p, p.f); return; }
  if (t.closest('#h-end')) { histJumpTo(p, p.t); return; }
});
function toastLong(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
}

/* ---------- history quiz ---------- */
// 地図: the globe stops on a highlighted area in some year and asks who ruled it.
// 図鑑: questions made from the encyclopedia (founder, capital, people, inventions).
const HQ_RANGES = [['all', '全期間', 1, 2024], ['a', '1〜500年', 1, 500], ['b', '501〜1000年', 501, 1000], ['c', '1001〜1500年', 1001, 1500], ['d', '1501〜1800年', 1501, 1800], ['e', '1801年〜', 1801, 2024]];
const HQ = {
  kind: 'both', mode: 'choice', range: 'all', state: 'idle', cur: null, n: 0, correct: 0, streak: 0, best: store.get('h-best', 0),
  view: null, read: null, phase: '', token: 0, pool: []
};
const histBusy = () => mode === 'hquiz' && (HQ.state === 'spinning' || HQ.state === 'asking');
// leaving the quiz tab drops an unanswered question, so the year bar is free again
function hqAbandon() {
  if (HQ.state !== 'spinning' && HQ.state !== 'asking') return;
  HQ.token++; HQ.state = 'idle'; HQ.view = null; HQ.read = null; HQ.cur = null;
  if (HQ.n > 0) HQ.n--;
}
const histAsking = () => world === 'history' && histBusy();
// a representative year: when the polity was largest
function peakYear(p) {
  const h = p.h || []; let best = p.f, ba = -1;
  for (let i = 0; i < h.length; i += 2) if (h[i + 1] > ba) { ba = h[i + 1]; best = Math.round((h[i] + (i + 2 < h.length ? h[i + 2] - 1 : p.t)) / 2); }
  return clamp(best, p.f, p.t);
}
function buildHQPool() {
  const pool = [];
  for (const p of TS.P) {
    const z = p.z; if (!z) continue;
    const year = z['代表年'] ? clamp(parseInt(z['代表年'], 10) || peakYear(p), YMIN, YMAX) : peakYear(p);
    const base = { p, year };
    if (z['建国者']) pool.push({ ...base, cat: '人物', text: `${p.n}を建国した人物はだれ?`, alts: splitAlts(z['建国者']), person: splitAlts(z['建国者'])[0] });
    if (z['首都']) pool.push({ ...base, cat: '首都', text: `${p.n}の首都(都)はどこ?`, alts: splitAlts(z['首都'].replace(/[（(].*?[）)]/g, '')) });
    for (const [name, desc] of z.people) {
      if (!desc) continue;
      pool.push({ ...base, cat: '人物', text: `【${p.n}】${desc.replace(/。$/, '')}。この人物はだれ?`, alts: splitAlts(name), person: name });
      pool.push({ ...base, cat: '勢力', text: `${splitAlts(name)[0]}が活躍した国(王朝)はどこ?`, alts: altNames(p.n, z['別名']), person: name, hideP: true });
    }
    for (const [name, desc, kind] of z.things) {
      if (!desc) continue;
      pool.push({ ...base, cat: kind, text: `【${p.n}】${desc.replace(/。$/, '')}。これは何?`, alts: splitAlts(name) });
    }
  }
  HQ.pool = pool;
}
function hqRange() { const r = HQ_RANGES.find(x => x[0] === HQ.range) || HQ_RANGES[0]; return [r[2], r[3]]; }
function zukanPool() { const [a, b] = hqRange(); return HQ.pool.filter(q => q.year >= a && q.year <= b); }
async function makeMapQuestion() {
  const [a, b] = hqRange();
  for (let tries = 0; tries < 8; tries++) {
    const y = a + Math.floor(Math.random() * (b - a + 1));
    await ensureYear(y);
    const set = rowsAt(y);
    if (!set) continue;
    const named = set.leaf.filter(r => r.p.z || r.a >= 120000);
    if (named.length < 4) continue;
    const w = named.map(r => Math.sqrt(r.a) * (r.p.z ? 2.5 : 1));
    let x = Math.random() * w.reduce((s, v) => s + v, 0), row = named[0];
    for (let i = 0; i < named.length; i++) { x -= w[i]; if (x <= 0) { row = named[i]; break; } }
    const others = set.leaf.filter(r => r.p !== row.p && r.p.n !== row.p.n && (r.p.z || r.a >= 20000))
      .sort((r1, r2) => d3.geoDistance(r1.lp, row.lp) - d3.geoDistance(r2.lp, row.lp));
    const names = [...new Set(others.map(r => r.p.n))];
    if (names.length < 3) continue;
    const near = names.slice(0, 6);
    return { type: 'map', p: row.p, year: y, row, cat: '勢力', text: `${fmtYear(y)}、地図で示した地域を支配していたのは?`, alts: altNames(row.p.n, row.p.z && row.p.z['別名']), choices: shuffleArr([row.p.n, ...shuffleArr(near).slice(0, 3)]) };
  }
  return null;
}
function makeZukanQuestion() {
  const pool = zukanPool();
  if (!pool.length) return null;
  const q = { ...pool[Math.floor(Math.random() * pool.length)], type: 'zukan' };
  // wrong choices: answers of the same kind from other questions
  const thing = c => c === '発明' || c === '文化';
  const same = [...new Set(HQ.pool.filter(x => (x.cat === q.cat || (thing(x.cat) && thing(q.cat))) && norm(x.alts[0]) !== norm(q.alts[0])).map(x => x.cat === '勢力' ? x.p.n : x.alts[0]))];
  if (q.cat === '勢力' && same.length < 3) TS.P.filter(p => p.z && p !== q.p).forEach(p => same.push(p.n));
  const ans = q.cat === '勢力' ? q.p.n : q.alts[0];
  const picks = shuffleArr(same.filter(x => !q.alts.map(norm).includes(norm(x)))).slice(0, 3);
  q.choices = picks.length === 3 ? shuffleArr([ans, ...picks]) : null;
  q.ans = ans;
  return q;
}
async function histNextQuestion() {
  if (spinning || !TS.idx) return;
  if (HQ.state === 'spinning') return;
  if (HQ.state === 'asking') HQ.streak = 0;
  stopPlay();
  const tok = ++HQ.token;
  HQ.state = 'spinning'; HQ.phase = ''; HQ.read = null; HQ.cur = null;
  HQ.view = null;
  updateSpinLabel(); renderHQuiz(); syncTimebar();
  const useMap = HQ.kind === 'map' || (HQ.kind === 'both' && (Math.random() < 0.5 || !zukanPool().length));
  let q = useMap ? await makeMapQuestion() : makeZukanQuestion();
  if (!q && !useMap) q = await makeMapQuestion();
  if (tok !== HQ.token) return;
  if (!q) { HQ.state = 'idle'; updateSpinLabel(); renderHQuiz(); syncTimebar(); toast('この条件で出せる問題がありません'); return; }
  if (!q.ans) q.ans = q.cat === '勢力' ? q.p.n : q.alts[0];
  if (HQ.mode === 'input') q.choices = null;
  await ensureYear(q.year);
  if (tok !== HQ.token) return;
  TS.sel = null;
  setYear(q.year, { force: true, quiet: true });
  if (!q.row) q.row = rowOf(q.p);
  if (!q.row) { HQ.state = 'idle'; updateSpinLabel(); renderHQuiz(); syncTimebar(); return; }
  HQ.n++;
  HQ.cur = { q, ok: null, given: '' };
  HQ.view = { state: 'spinning', p: q.p, row: q.row, ok: null };
  renderHQuiz(); syncTimebar();
  spinTo({ lp: q.row.lp, n: '' }, Math.min(zoomForRow(q.row), 4.2), {
    mask: true,
    onLand: () => { if (HQ.view) HQ.view.state = 'asking'; dirty = true; },
    onDone: () => {
      if (tok !== HQ.token || HQ.state !== 'spinning') return;
      HQ.state = 'asking'; HQ.phase = 'intro'; updateSpinLabel(); renderHQuiz(); syncTimebar();
      SFX.play('question');
      if (isNarrow()) revealCard('#view-hquiz .qcard');
      setTimeout(() => {
        if (tok !== HQ.token || HQ.state !== 'asking') return;
        HQ.phase = 'reading';
        HQ.read = { plan: readPlan(q.text, READ_SPEEDS[SQ.speed] || READ_SPEEDS.normal), start: now(), elId: 'h-qtext', done: false };
        renderHQuiz(); startReader(); focusAnswer();
      }, INTRO_MS);
    }
  });
}
function hqAnswer(text, picked) {
  if (HQ.state !== 'asking' || HQ.phase !== 'reading') return;
  const q = HQ.cur.q;
  let ok;
  if (picked != null) ok = norm(picked) === norm(q.ans);
  else {
    if (!norm(text)) { toast('答えを入力してください'); return; }
    ok = q.alts.some(a => norm(a) === norm(text));
  }
  hqFinish(ok, picked != null ? picked : text);
}
function hqFinish(ok, given) {
  const q = HQ.cur.q;
  HQ.cur.ok = ok; HQ.cur.given = given;
  if (HQ.read) HQ.read.done = true;
  SFX.play(ok ? 'ok' : 'ng');
  if (ok) { HQ.correct++; HQ.streak++; if (HQ.streak > HQ.best) { HQ.best = HQ.streak; store.set('h-best', HQ.best); } }
  else HQ.streak = 0;
  HQ.cur.card = '';
  if (ok && q.person) {
    const k = cardKey(q.p, q.person);
    if (peopleOf(q.p).some(([n]) => n === q.person) && !TS.cards.has(k)) { TS.cards.add(k); TS.newCard = k; HQ.cur.card = q.person; store.set('h-cards', [...TS.cards]); }
  }
  HQ.state = 'answered';
  if (HQ.view) { HQ.view.state = 'answered'; HQ.view.ok = ok; }
  updateSpinLabel(); renderHQuiz(); syncTimebar(); dirty = true;
  const nb = $('#hq-next'); if (nb) nb.focus({ preventScroll: true });
}
function renderHQuiz() {
  const v = $('#view-hquiz');
  if (!v) return;
  if (!TS.idx) { v.innerHTML = `<div class="pane">${TS.err ? `<p class="hint">${esc(TS.err)}</p>` : '<p class="lead">歴史地図のデータを読み込んでいます…</p>'}</div>`; return; }
  const answeredN = HQ.n - (HQ.state === 'asking' || HQ.state === 'spinning' ? 1 : 0);
  const score = `<div class="score">
    <div><span class="k">正解</span><span class="v mono">${HQ.correct}<small>/${answeredN}</small></span></div>
    <div><span class="k">連続正解</span><span class="v mono">${HQ.streak}</span></div>
    <div><span class="k">最高記録</span><span class="v mono">${HQ.best}</span></div></div>`;
  const settings = `<details class="settings" id="hq-settings"${HQ.n === 0 ? ' open' : ''}>
    <summary>出題設定 <small>図鑑の問題 ${zukanPool().length}問</small></summary>
    <div class="set"><label class="lbl">出題のしかた</label><div class="seg" style="align-self:flex-start">
      <button data-hk="both" aria-pressed="${HQ.kind === 'both'}">両方</button><button data-hk="map" aria-pressed="${HQ.kind === 'map'}">地図から</button><button data-hk="zukan" aria-pressed="${HQ.kind === 'zukan'}">図鑑から</button></div></div>
    <div class="set"><label class="lbl">時代</label><div class="chips">${HQ_RANGES.map(r => `<button class="chip" data-hr="${r[0]}" aria-pressed="${HQ.range === r[0]}">${r[1]}</button>`).join('')}</div></div>
    <div class="set"><label class="lbl">答え方</label><div class="seg" style="align-self:flex-start"><button data-hm="choice" aria-pressed="${HQ.mode === 'choice'}">4択</button><button data-hm="input" aria-pressed="${HQ.mode === 'input'}">入力</button></div></div>
    <div class="set"><label class="lbl">問題文の表示速度</label><div class="seg" style="align-self:flex-start">${Object.keys(READ_SPEEDS).map(k => `<button data-hsp="${k}" aria-pressed="${SQ.speed === k}">${READ_LABEL[k]}</button>`).join('')}</div></div>
  </details>`;
  let card = '';
  const cur = HQ.cur;
  if (HQ.state === 'idle' || (!cur && HQ.state !== 'spinning')) {
    card = `<div class="qcard"><p class="lead">「地図から」は、ある年に${flat ? '地図' : '地球儀'}が止まった地域を支配していた勢力を答えます。「図鑑から」は、建国者・首都・人物・発明など図鑑の内容から出題します。図鑑の問題で人物を答えると、人物カードが手に入ります。</p>
      <div class="btnrow"><button class="btn brass" id="hq-start">回して出題</button></div></div>`;
  } else if (HQ.state === 'spinning') {
    card = `<div class="qcard"><p class="qmeta"><span>第${Math.max(1, HQ.n)}問</span></p><p class="qtext">${cur ? (flat ? '地図' : '地球儀') + 'が回っています…' : '問題を選んでいます…'}</p></div>`;
  } else {
    const q = cur.q;
    const meta = `<div class="qmeta"><span>第${HQ.n}問</span><span class="tag">${q.type === 'map' ? '地図から' : '図鑑から'}</span><span class="tag">答え: ${esc(q.cat)}</span><span class="tag">${fmtYear(q.year)}の地図</span></div>`;
    if (HQ.state === 'asking' && HQ.phase !== 'reading') card = `<div class="qcard">${meta}${readingHTML(null, 'h-qtext')}</div>`;
    else if (HQ.state === 'asking') {
      const ui = q.choices ? `<div class="choices">${q.choices.map((c, i) => `<button data-hc="${i}">${esc(c)}</button>`).join('')}</div>`
        : `<form class="ansrow" data-form="h"><input id="hans" placeholder="${esc(q.cat)}を入力(ひらがな可)" autocomplete="off" aria-label="答え"><button class="btn primary">答える</button></form>`;
      card = `<div class="qcard">${meta}${readingHTML(HQ.read, 'h-qtext')}${ui}<div class="btnrow"><button class="btn" id="hq-giveup">わからない</button></div></div>`;
    } else {
      card = `<div class="qcard">${meta}<p class="qtext">${esc(q.text)}</p>
        <div class="result ${cur.ok ? 'ok' : 'ng'}"><p class="verdict ${cur.ok ? 'ok' : 'ng'}">${cur.ok ? '正解' : '残念'}</p>
        <p class="answer">答え <b>${esc(q.ans)}</b></p>
        ${!cur.ok && cur.given ? `<p class="expl">あなたの答え: ${esc(cur.given)}</p>` : ''}
        ${cur.card ? `<p class="expl">人物カード「${esc(splitAlts(cur.card)[0])}」を手に入れました。図鑑で見られます。</p>` : ''}</div>
        <p class="expl">${esc(q.p.n)}(${esc(periodText(q.p))})</p>
        <div class="btnrow"><button class="btn brass" id="hq-next">次の問題</button><button class="btn" id="hq-zukan">${esc(q.p.n)}を図鑑で見る</button></div></div>`;
    }
  }
  const prevAns = ($('#hans') || {}).value || '';
  const open = $('#hq-settings') ? $('#hq-settings').open : HQ.n === 0;
  v.innerHTML = `<div class="pane">${score}${card}${settings}</div>`;
  if ($('#hq-settings')) $('#hq-settings').open = open;
  if ($('#hans')) { $('#hans').value = prevAns; focusAnswer(); }
}
$('#view-hquiz').addEventListener('click', e => {
  const t = e.target;
  if (t.closest('#hq-start') || t.closest('#hq-next')) { histNextQuestion(); return; }
  if (t.closest('#hq-giveup')) { if (HQ.state === 'asking') { HQ.token++; hqFinish(false, ''); } return; }
  if (t.closest('#hq-zukan')) { const p = HQ.cur.q.p; HQ.view = null; HQ.state = 'idle'; setMode('hist'); histSelect(p); return; }
  const c = t.closest('[data-hc]'); if (c && HQ.state === 'asking') { hqAnswer('', HQ.cur.q.choices[+c.dataset.hc]); return; }
  const k = t.closest('[data-hk]'); if (k) { HQ.kind = k.dataset.hk; renderHQuiz(); return; }
  const r = t.closest('[data-hr]'); if (r) { HQ.range = r.dataset.hr; renderHQuiz(); return; }
  const m = t.closest('[data-hm]'); if (m) { HQ.mode = m.dataset.hm; if (HQ.state === 'asking' && HQ.mode === 'input') HQ.cur.q.choices = null; renderHQuiz(); return; }
  const sp = t.closest('[data-hsp]'); if (sp) { SQ.speed = sp.dataset.hsp; store.set('speed', SQ.speed); renderHQuiz(); return; }
});
$('#view-hquiz').addEventListener('submit', e => { e.preventDefault(); hqAnswer(($('#hans') || {}).value || ''); });

/* ---------------- start ---------------- */
select(placeById.get('JPN'));
recent.length = 0; recent.push(placeById.get('JPN'));
renderQuiz();
renderBattle();
updateSpinLabel();
document.querySelectorAll('[data-shape]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.shape === 'flat') === flat)));
if (flat) { flat = false; setFlat(true); }
const hm = location.hash.match(/^#room-([A-Za-z0-9]{4})$/);
if (hm) { B.joinCode = hm[1].toUpperCase(); setMode('battle'); }
else if (location.hash === '#timeslip') setWorld('history');
else if (location.hash === '#food') setWorld('food');
window.__globe = { B, SQ, QUIZ, TS, HQ, allQs, buildQuestions, findMentions, makeChoices, setWorld, setFlat, setYear, llAt, histAt };
})();
