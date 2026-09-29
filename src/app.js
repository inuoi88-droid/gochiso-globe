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
    fBody: g('f-body'), fDisp: g('f-display')
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
const projection = d3.geoOrthographic().clipAngle(90).precision(0.7);
const path = d3.geoPath(projection, ctx);
let rot = [-136, -28], zoom = 1;
const ZMIN = 0.75, ZMAX = 14;
function resize() {
  const r = stage.getBoundingClientRect();
  W = Math.max(200, r.width); H = Math.max(200, r.height);
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  R0 = Math.min(W, H) * 0.42;
  dirty = true;
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
const visible = (lp, c, m = 0.06) => d3.geoDistance(lp, c) < Math.PI / 2 - m;
function applyView() { projection.rotate([rot[0], rot[1], 0]).scale(R0 * zoom).translate([W / 2, H / 2]); }

/* ---------------- state ---------------- */
let mode = 'explore';          // explore | quiz | battle
let sel = null;                // selected place or city (explore)
let hoverId = null;
let showLabels = true, showCities = true, autoSpin = !REDUCED;
let spinning = false;          // spin animation running
let needleName = '';
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
  const R = R0 * zoom, cx = W / 2, cy = H / 2, c = center();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  placed.length = 0;
  if (R < Math.hypot(W, H)) {
    const g = ctx.createRadialGradient(cx, cy, R * 0.96, cx, cy, R * 1.13);
    g.addColorStop(0, C.glow); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.13, 0, TAU); ctx.fill();
  }
  const og = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R);
  og.addColorStop(0, C.sea1); og.addColorStop(1, C.sea2);
  ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = og; ctx.fill();
  ctx.beginPath(); path(graticule); ctx.strokeStyle = C.grat; ctx.lineWidth = 0.6; ctx.stroke();
  for (let k = 0; k < 5; k++) { ctx.beginPath(); path(classFC[k]); ctx.fillStyle = C.land[k]; ctx.fill(); }
  for (const f of disputed) fillFeature(f, hatch);

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
  ctx.save(); ctx.strokeStyle = C.brass; ctx.globalAlpha = 0.75;
  ctx.setLineDash([6, 4]); ctx.lineWidth = 1; ctx.beginPath(); path(equator); ctx.stroke();
  ctx.setLineDash([1.5, 4]); ctx.lineWidth = 1; ctx.beginPath(); path(tropics); ctx.stroke();
  ctx.restore();
  const sg = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.35, cx, cy, R);
  sg.addColorStop(0, 'rgba(255,255,255,0.06)'); sg.addColorStop(0.7, 'rgba(0,0,0,0)'); sg.addColorStop(1, C.shade);
  ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = sg; ctx.fill();
  ctx.beginPath(); path({ type: 'Sphere' }); ctx.strokeStyle = C.coast; ctx.globalAlpha = 0.35; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;

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
  if (spinning) drawNeedle(cx, cy);

  if (showLabels) {
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
  if (citiesOn && zoom >= 1.7) {
    for (const ci of D.cities) {
      if (mode === 'explore' && sel === ci) continue;
      if (nameShown && v.loc.city === ci) continue;
      if (!visible(ci.lp, c, 0.15)) continue;
      const [x, y] = projection(ci.lp);
      label(ci.n, x + 6, y, 11, { align: 'left', weight: 500, color: C.ink, haloW: 2.8 });
    }
  }
  if (showLabels && zoom >= 3) {
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
  if (R * 1.1 < Math.min(W, H) / 2 + 30) drawBezel(cx, cy, R);
  updateCoords();
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
function pickAt(x, y) {
  applyView();
  const R = R0 * zoom, c = center();
  if (Math.hypot(x - W / 2, y - H / 2) > R) return null;
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
  const ll = projection.invert([x, y]);
  if (!ll || !isFinite(ll[0])) return null;
  const f = countryAt(ll);
  return f ? placeById.get(f.id) : null;
}

/* ---------------- animation ---------------- */
let anim = null, vel = null, lastInteract = 0;
const SPIN_MS = REDUCED ? 500 : 3400;
const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeOutQuart = t => 1 - Math.pow(1 - t, 4);
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
  const start = performance.now();
  anim = {
    step(t) {
      const k = Math.min(1, (t - start) / dur);
      if (spins) {
        rot[0] = l0 + dl * easeOutQuart(k);
        rot[1] = p0 + (p1 - p0) * easeInOut(k);
        const zOut = Math.min(z0, 1);
        if (k < 0.25) zoom = Math.exp(Math.log(z0) + (Math.log(zOut) - Math.log(z0)) * easeInOut(k / 0.25));
        else if (k < 0.7) zoom = zOut;
        else zoom = Math.exp(Math.log(zOut) + (lz1 - Math.log(zOut)) * easeInOut((k - 0.7) / 0.3));
      } else {
        const e = easeInOut(k);
        rot[0] = l0 + dl * e; rot[1] = p0 + (p1 - p0) * e;
        zoom = Math.max(ZMIN, Math.exp(lz0 + (lz1 - lz0) * e) * (1 - dip * Math.sin(Math.PI * k)));
      }
      return k >= 1;
    },
    done: opt.done
  };
  vel = null;
}
function flyTo(o, opt = {}) { animateTo(o.lp[0], o.lp[1], opt.zoom || zoomFor(o), opt); }

let frameN = 0, lastT = performance.now();
function frame(t) {
  const dt = Math.min(64, t - lastT); lastT = t; frameN++;
  if (anim) {
    const done = anim.step(t);
    dirty = true;
    if (done) { const cb = anim.done; anim = null; normRot(); if (cb) cb(); }
  } else if (vel && !drag) {
    rot[0] += vel[0] * dt; rot[1] = clamp(rot[1] + vel[1] * dt, -89, 89);
    const f = Math.pow(0.93, dt / 16); vel[0] *= f; vel[1] *= f;
    if (Math.abs(vel[0]) + Math.abs(vel[1]) < 0.0015) vel = null;
    dirty = true;
  } else if (autoSpin && !drag && !pinch && t - lastInteract > 6000 && !curView() && document.visibilityState === 'visible') {
    rot[0] += dt * 0.0045 / Math.max(1, zoom * 0.8);
    dirty = true;
  }
  if (spinning && frameN % 3 === 0) {
    const f = countryAt(center());
    const n = f ? (placeById.get(f.id) || {}).n || '' : '海の上';
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
  if (spinning) return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  stopMotion(); hideTip();
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
  if (drag) {
    const k = 57.2958 / (R0 * zoom);
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
  if (e.pointerType === 'mouse' && !spinning) queueHover(e.offsetX, e.offsetY);
});
function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pinch) { if (pointers.size < 2) { pinch = null; drag = null; vel = null; } return; }
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
  const k = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (k) { e.preventDefault(); stopMotion(); rot[0] += k[0]; rot[1] = clamp(rot[1] + k[1], -89, 89); dirty = true; }
  else if (e.key === '+' || e.key === '=') { setZoom(zoom * 1.4); }
  else if (e.key === '-') { setZoom(zoom / 1.4); }
  else if (e.key === 'Enter') { const f = countryAt(center()); if (f) handlePick(placeById.get(f.id)); }
});
let hoverQ = null;
function queueHover(x, y) {
  if (hoverQ) { hoverQ.x = x; hoverQ.y = y; return; }
  hoverQ = { x, y };
  requestAnimationFrame(() => {
    const { x: hx, y: hy } = hoverQ; hoverQ = null;
    if (nowAsking()) { setHover(null); hideTip(); return; }
    const o = pickAt(hx, hy);
    setHover(o && o.type === 'place' ? o.id : null);
    if (o) showTip(o, hx, hy); else hideTip();
  });
}
function setHover(id) { if (id !== hoverId) { hoverId = id; dirty = true; } canvas.style.cursor = id ? 'pointer' : ''; }
const tip = $('#tip');
function showTip(o, x, y) {
  const sub = o.type === 'city' ? o.country.n : (o.cap ? '首都 ' + o.cap : o.reg);
  tip.textContent = `${o.n}${sub ? ' · ' + sub : ''}`;
  tip.style.left = x + 'px'; tip.style.top = y + 'px'; tip.hidden = false;
}
function hideTip() { tip.hidden = true; }
const battleBusy = () => ['spinning', 'asking', 'reveal'].includes(B.phase);
function handleClick(x, y) {
  const o = pickAt(x, y);
  if (nowAsking()) { toast('回答すると地図で調べられます'); return; }
  if (o) handlePick(o);
}
function handlePick(o) {
  if (!o) return;
  if (mode === 'battle' && battleBusy()) { toast('対戦中は地図の選択はできません'); return; }
  if (mode !== 'explore') setMode('explore');
  select(o);
}
function setZoom(z) { stopMotion(); const z0 = zoom, z1 = clamp(z, ZMIN, ZMAX); const st = now();
  anim = { step(t) { const k = Math.min(1, (t - st) / 260); zoom = Math.exp(Math.log(z0) + (Math.log(z1) - Math.log(z0)) * easeInOut(k)); return k >= 1; } };
}
$('#z-in').onclick = () => setZoom(zoom * 1.6);
$('#z-out').onclick = () => setZoom(zoom / 1.6);
$('#z-home').onclick = () => { if (spinning) return; stopMotion(); animateTo(-rot[0], -rot[1], 1, { dur: 600 }); };
function bindToggle(id, get, set) {
  const b = $(id);
  b.setAttribute('aria-pressed', String(get()));
  b.onclick = () => { set(!get()); b.setAttribute('aria-pressed', String(get())); dirty = true; };
}
bindToggle('#t-labels', () => showLabels, v => showLabels = v);
bindToggle('#t-cities', () => showCities, v => showCities = v);
bindToggle('#t-auto', () => autoSpin, v => { autoSpin = v; lastInteract = 0; });

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
  for (const it of searchIndex) {
    let best = 99;
    for (const k of it.keys) { const i = k.indexOf(q); if (i === 0) best = Math.min(best, 0); else if (i > 0) best = Math.min(best, 1); }
    if (best < 99) scored.push([best, it.o.un ? 0 : it.kind === '都市' ? 1 : 2, it]);
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
  if (nowAsking()) { toast('回答後に探せます'); return; }
  if (mode === 'battle' && battleBusy()) { toast('対戦中は探せません'); return; }
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
  if (!o) { v.innerHTML = `<div class="pane"><p class="empty">地球儀の国や都市をクリックするか、シャッフルを押してください。</p></div>`; return; }
  const isCity = o.type === 'city';
  const place = isCity ? o.country : o;
  const eyebrow = isCity ? `都市 · ${place.n}` : `${o.reg || ''} · ${o.un ? '国連加盟国' : '地域'}`;
  const dishes = o.d || [];
  const facts = o.f || [];
  const cityList = !isCity ? citiesOf(o.id) : [];
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
    <section class="sec">
      <h3>郷土料理</h3>
      ${dishes.length ? `<ul class="dishes">${dishes.map(([name, desc]) => {
        const q = `${o.n} ${name} 作り方`;
        return `<li class="dish"><b>${esc(name)}</b><p>${esc(desc)}</p>
          <a class="go" href="${gsearch(q)}" target="_blank" rel="noopener" title="${esc(q)} を検索">作り方 ↗<span>${esc(q)}</span></a></li>`;
      }).join('')}</ul>` : `<p class="empty">この地域の料理データはまだありません。</p>`}
      <a class="go go-wide" href="${gsearch(`${o.n} 郷土料理 作り方`)}" target="_blank" rel="noopener">ほかの郷土料理も探す ↗<span>${esc(o.n)} 郷土料理 作り方</span></a>
    </section>
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
function spinTo(o, zoomTarget, done) {
  spinning = true; needleName = ''; hideTip(); setHover(null);
  $('#readout').hidden = false; $('#readout').textContent = '▼';
  $('#spin-btn').disabled = true;
  vel = null;
  animateTo(o.lp[0], o.lp[1], zoomTarget, {
    spins: REDUCED ? 0 : 2, dur: SPIN_MS,
    done: () => {
      spinning = false; $('#readout').hidden = true; $('#spin-btn').disabled = false;
      lastInteract = now(); dirty = true; done && done();
    }
  });
}
function shuffle() {
  if (spinning) return;
  const pickCity = target === 'city' || (target === 'both' && Math.random() < 0.35);
  let o;
  do {
    o = pickCity ? D.cities[Math.floor(Math.random() * D.cities.length)] : shufflePlaces[Math.floor(Math.random() * shufflePlaces.length)];
  } while (o === sel);
  sel = null; dirty = true;
  $('#view-explore').innerHTML = `<div class="pane"><p class="eyebrow">シャッフル中</p><h2 class="pname">…</h2><p class="lead">地球儀が止まった場所の郷土料理と豆知識を表示します。</p></div>`;
  spinTo(o, zoomFor(o), () => { select(o); if (innerWidth < 960) revealPanel(); });
}
function revealPanel() { $('#panel').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' }); }
$('#spin-btn').onclick = () => { if (mode === 'explore') shuffle(); else if (mode === 'quiz') nextQuestion(); };

/* ---------------- modes ---------------- */
function setMode(m) {
  if (m === mode) return;
  mode = m;
  ['explore', 'quiz', 'battle'].forEach(k => {
    $('#tab-' + k).setAttribute('aria-selected', String(m === k));
    $('#view-' + k).hidden = m !== k;
  });
  $('#target-seg').hidden = m !== 'explore';
  $('#spin-wrap').hidden = m === 'battle';
  if (m !== 'battle' || B.phase !== 'asking') { if (!spinning) $('#readout').hidden = true; }
  updateSpinLabel();
  if (m === 'quiz') renderQuiz(); else if (m === 'battle') renderBattle(); else renderExplore();
  dirty = true;
}
function updateSpinLabel() {
  $('#spin-label').textContent = mode === 'explore' ? 'シャッフル' : (SQ.state === 'answered' ? '次の問題' : SQ.state === 'asking' ? 'この問題をとばす' : '回して出題');
}
['explore', 'quiz', 'battle'].forEach(k => { $('#tab-' + k).onclick = () => { if (!spinning) setMode(k); }; });

/* ================= quiz data ================= */
// Columns are matched by header name, so their order does not matter.
const QCOLS = ['問題', '答え', 'ジャンル', '難易度', '解説', '答えの種類', '場所', '選択肢'];
const shuffleArr = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const splitAlts = s => String(s || '').split(/[\/／]/).map(x => x.trim()).filter(Boolean);
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
    const o = nameIndex.get(norm(a));
    if (!o) continue;
    if (o.type === 'city') return { lp: o.lp, place: null, city: o, name: o.n, reg: o.country.reg };
    return { lp: o.lp, place: o, city: null, name: o.n, reg: o.reg };
  }
  return null;
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
  let header = rows[0].map(h => String(h).trim());
  let start = 1;
  if (!header.includes('問題')) { header = QCOLS; start = 0; }   // pasted rows without a header
  const ix = {}; QCOLS.forEach(k => { ix[k] = header.indexOf(k); });
  if (ix['答え'] < 0) { errors.push('見出しに「答え」の列がありません'); return { qs, errors }; }
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    const get = k => ix[k] >= 0 ? String(r[ix[k]] == null ? '' : r[ix[k]]).trim() : '';
    const line = i + 1;
    const text = get('問題'), alts = splitAlts(get('答え'));
    if (!text || !alts.length) { errors.push(`${line}行目: 問題か答えが空です`); continue; }
    const type = get('答えの種類') || '国名';
    const locStr = get('場所');
    const loc = resolveLoc(locStr || (type === '国名' ? get('答え') : ''));
    if (!loc) { errors.push(locStr ? `${line}行目: 場所「${locStr}」が地図上で見つかりません` : `${line}行目: 場所の列を入れてください(国名・都市名・「緯度,経度」)`); continue; }
    const genre = get('ジャンル').split(/\s+/).filter(g => g && g !== '国連加盟国' && !REGIONS.includes(g)).join(' ');
    const diff = clamp(parseInt(get('難易度'), 10) || 3, 1, 5);
    const lnames = locNames(loc);
    const hideName = type === '国名' || alts.some(a => lnames.includes(norm(a)));
    qs.push({ id: `${src}${i}`, text, alts, type, genre, diff, expl: get('解説'), choices: splitAlts(get('選択肢')), loc, reg: loc.reg, hideName });
  }
  return { qs, errors };
}
const QUIZ = { base: [], baseErr: [], baseSrc: '内蔵', extra: [], extraErr: [], extraText: store.get('extra-quiz', '') };
function loadBase(text, srcLabel) { const r = buildQuestions(text, 'b'); QUIZ.base = r.qs; QUIZ.baseErr = r.errors; QUIZ.baseSrc = srcLabel; }
loadBase(window.GLOBE_QUIZ || '', '内蔵');
const allQs = () => QUIZ.base.concat(QUIZ.extra);
if (location.protocol.startsWith('http')) {
  fetch('quiz.tsv', { cache: 'no-store' }).then(r => r.ok ? r.text() : null).then(t => {
    if (t && t.includes('問題') && t.includes('答え')) { loadBase(t, 'quiz.tsv'); if (mode === 'quiz') renderQuiz(); if (mode === 'battle') renderBattle(); }
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
  if (pool.length < 3) pool = pool.concat(shuffleArr(allQs().filter(x => x.type === q.type).map(x => x.alts[0])));
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

/* ================= solo quiz ================= */
const SQ = {
  diffs: new Set([1, 2, 3, 4, 5]), regs: new Set(REGIONS), mode: 'input', hideLoc: false,
  used: new Set(), state: 'idle', cur: null, n: 0, correct: 0, streak: 0, best: store.get('best', 0),
  view: idleView(), addOpen: false, addMsg: ''
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
  SQ.cur = { q, hint: 0, ok: null, given: '', choices: SQ.mode === 'choice' ? makeChoices(q) : null };
  SQ.state = 'spinning';
  SQ.view = { state: 'spinning', loc: q.loc, hideName: q.hideName, hideLoc: SQ.hideLoc, ok: null };
  updateSpinLabel(); renderQuiz();
  const z = SQ.hideLoc ? 1 : Math.min(zoomFor(q.loc), 4.2);
  const dest = SQ.hideLoc ? { lp: [q.loc.lp[0] + (Math.random() - 0.5) * 60, clamp(q.loc.lp[1] + (Math.random() - 0.5) * 36, -70, 75)] } : q.loc;
  spinTo(dest, z, () => {
    SQ.state = 'asking'; SQ.view.state = 'asking'; updateSpinLabel(); renderQuiz();
    if (innerWidth < 960) revealPanel();
    const inp = $('#ans'); if (inp && innerWidth >= 960) inp.focus({ preventScroll: true });
  });
}
function soloAnswer(text, picked) {
  if (SQ.state !== 'asking') return;
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
  return `<form class="ansrow" data-form="${prefix}"><input id="${prefix}ans" placeholder="${esc(q.type)}を入力(ひらがな可)" autocomplete="off" aria-label="答え"><button class="btn primary">答える</button></form>`;
}
function dishesTeaser(q) {
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
    <div class="set"><label class="switch"><input type="checkbox" id="set-hide" ${SQ.hideLoc ? 'checked' : ''}> 止まった場所を隠す(上級)</label></div>
  </details>`;
  const addBox = `<details class="settings" id="sq-add"${SQ.addOpen ? ' open' : ''}>
    <summary>問題を追加 <small>${QUIZ.base.length}問(${esc(QUIZ.baseSrc)})${QUIZ.extra.length ? ` + 追加${QUIZ.extra.length}問` : ''}</small></summary>
    <div class="set">
      <p class="note">スプレッドシートから行をコピーして貼り付けるか、TSV/CSVファイルを選んでください。列は ${QCOLS.join('・')}。国名以外が答えの問題は、答えの種類と場所(国名・都市名・「緯度,経度」)を入れます。追加した問題はこの端末に保存され、対戦でも出題されます。</p>
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
      <p class="lead">地球儀を回して、止まった場所についての問題に答えます。青いピンの場所と問題文をヒントに当ててください。</p>
      <div class="btnrow"><button class="btn brass" id="q-start">回して出題</button><button class="btn" id="q-battle">友達と対戦する</button></div>
      <p class="note">全${allQs().length}問</p></div>`;
  } else if (SQ.state === 'spinning') {
    card = `<div class="qcard"><p class="qmeta"><span>第${SQ.n}問</span></p><p class="qtext">地球儀が回っています…</p></div>`;
  } else {
    const q = cur.q;
    const meta = `<div class="qmeta"><span>第${SQ.n}問</span><span class="stars" aria-label="難易度${q.diff}">${stars(q.diff)}</span>${q.genre ? `<span class="tag">${esc(q.genre)}</span>` : ''}${q.type !== '国名' ? `<span class="tag">答え: ${esc(q.type)}</span>` : ''}${SQ.hideLoc ? '<span class="tag">位置なし</span>' : ''}</div>`;
    if (SQ.state === 'asking') {
      card = `<div class="qcard">${meta}<p class="qtext">${esc(q.text)}</p>${answerUI(q, cur.choices, 's')}
        ${cur.hint ? `<p class="hint">ヒント: ${esc(hintText(q, cur.hint))}</p>` : ''}
        <div class="btnrow"><button class="btn" id="q-hint" ${cur.hint >= maxHint(q) ? 'disabled' : ''}>ヒント${cur.hint ? 'をもう1つ' : ''}</button><button class="btn" id="q-giveup">わからない</button></div></div>`;
    } else {
      const o = locObj(q.loc);
      card = `<div class="qcard">${meta}<p class="qtext">${esc(q.text)}</p>
        <div class="result ${cur.ok ? 'ok' : 'ng'}">
          <p class="verdict ${cur.ok ? 'ok' : 'ng'}">${cur.ok ? '正解' : '残念'}</p>
          <p class="answer">答え <b>${esc(q.alts[0])}</b> ${q.type === '国名' && q.loc.place && q.loc.place.en ? `<span class="pen" style="display:inline">${esc(q.loc.place.en)}</span>` : ''}</p>
          ${!cur.ok && cur.given ? `<p class="expl">あなたの答え: ${esc(cur.given)}</p>` : ''}
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
  renderQuiz();
  if ($('#sq-settings')) $('#sq-settings').open = open;
  if ($('#sans')) $('#sans').value = val;
  if ($('#add-text')) $('#add-text').value = ta;
}
function addQuestions(text, label) {
  const r = buildQuestions(text, 't');
  if (!r.qs.length) { SQ.addMsg = `${label}: 追加できる問題がありませんでした${r.errors.length ? '(' + r.errors[0] + ')' : ''}`; rerenderQuiz(); return; }
  // keep a header so stored text always parses the same way
  let body = String(text).replace(/\r\n?/g, '\n').trim();
  const first = parseTable(body)[0].map(h => String(h).trim());
  if (!first.includes('問題')) body = QCOLS.join('\t') + '\n' + body;
  QUIZ.extraText = QUIZ.extraText ? QUIZ.extraText + '\n\n' + body : body;
  store.set('extra-quiz', QUIZ.extraText);
  // stored blocks may each carry a header; parse block by block
  QUIZ.extra = []; QUIZ.extraErr = [];
  QUIZ.extraText.split(/\n\s*\n/).forEach((blk, bi) => { const rr = buildQuestions(blk, 'x' + bi + '_'); QUIZ.extra.push(...rr.qs); QUIZ.extraErr.push(...rr.errors); });
  SQ.addMsg = `${label}: ${r.qs.length}問を追加しました${r.errors.length ? `(読み込めなかった行 ${r.errors.length}件)` : ''}`;
  SQ.addOpen = true;
  rerenderQuiz();
}
// re-parse stored extra text block by block (a block = one paste or file)
if (QUIZ.extraText) {
  QUIZ.extra = []; QUIZ.extraErr = [];
  QUIZ.extraText.split(/\n\s*\n/).forEach((blk, bi) => { const rr = buildQuestions(blk, 'x' + bi + '_'); QUIZ.extra.push(...rr.qs); QUIZ.extraErr.push(...rr.errors); });
}
$('#view-quiz').addEventListener('click', e => {
  const t = e.target;
  if (t.closest('#q-start') || t.closest('#q-next')) { nextQuestion(); return; }
  if (t.closest('#q-battle')) { setMode('battle'); return; }
  if (t.closest('#q-giveup')) { if (SQ.state === 'asking') finishSolo(false, ''); return; }
  if (t.closest('#q-hint')) { if (SQ.state === 'asking' && SQ.cur.hint < maxHint(SQ.cur.q)) { SQ.cur.hint++; rerenderQuiz(); } return; }
  if (t.closest('#q-explore')) { const o = locObj(SQ.cur.q.loc); setMode('explore'); select(o); return; }
  if (t.closest('#add-paste')) { const txt = ($('#add-text') || {}).value || ''; if (!txt.trim()) { toast('行を貼り付けてください'); return; } $('#add-text').value = ''; addQuestions(txt, '貼り付け'); return; }
  if (t.closest('#add-clear')) { QUIZ.extraText = ''; QUIZ.extra = []; QUIZ.extraErr = []; store.set('extra-quiz', ''); SQ.addMsg = '追加した問題を消しました'; rerenderQuiz(); return; }
  const cb = t.closest('[data-sc]'); if (cb && SQ.state === 'asking') { soloAnswer('', SQ.cur.choices[+cb.dataset.sc]); return; }
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
  settings: { count: 10, time: 20, mode: 'choice', diffs: new Set([1, 2, 3, 4, 5]), regs: new Set(REGIONS) },
  round: 0, total: 0, q: null, qp: null, answers: new Map(), results: null, myAns: null,
  tStart: 0, timeLimit: 20, tick: 0, hostTimer: 0, hb: 0, used: new Set(), revealed: 0, view: idleView(), joinCode: ''
};
const HB_MS = 4000, GONE_MS = 13000;
function send(m) { if (B.net) B.net.send(Object.assign({ room: B.code, from: B.me.id }, m)); }
const activeIds = () => [...B.peers.entries()].filter(([id, p]) => id === B.me.id || now() - p.last < GONE_MS).map(([id]) => id);
const pname = id => (B.peers.get(id) || {}).name || B.names.get(id) || '退出したプレイヤー';
function settingsWire() { const s = B.settings; return { count: s.count, time: s.time, mode: s.mode, diffs: [...s.diffs], regs: [...s.regs] }; }
async function connect(code, asHost) {
  leaveRoom(true);
  B.code = code; B.isHost = asHost; B.hostId = asHost ? B.me.id : null;
  B.peers = new Map(); B.names = new Map(); B.scores = new Map();
  B.phase = 'connecting'; B.err = ''; B.view = idleView();
  renderBattle();
  try {
    B.net = await openNet(code, onMsg, st => {
      if (st === 'SUBSCRIBED') {
        B.phase = 'room'; sayHello(true);
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
  sayHello(false);
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
    case 'sync': if (!B.isHost && m.to === B.me.id) applySync(m); break;
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
      B.hostId = from; if (from !== B.me.id) B.isHost = false; B.err = ''; renderBattle(); break;
  }
}
function sendSync(to) {
  const elapsed = B.phase === 'asking' ? now() - B.tStart : 0;
  send({ k: 'sync', to, phase: B.phase, round: B.round, total: B.total, qp: B.qp, timeLimit: B.timeLimit, elapsed,
    scores: [...B.scores], names: [...B.names], results: B.results, settings: settingsWire() });
}
function applySync(m) {
  B.scores = new Map(m.scores || []); (m.names || []).forEach(([id, n]) => B.names.set(id, n));
  B.settingsView = m.settings;
  if ((m.phase === 'asking' || m.phase === 'spinning') && m.qp) { onQuestion({ round: m.round, total: m.total, q: m.qp, timeLimit: m.timeLimit }, m.elapsed || 0); return; }
  if (m.phase === 'reveal' && m.qp) { B.round = m.round; B.total = m.total; B.qp = m.qp; B.q = fromWire(m.qp); onReveal({ round: m.round, results: m.results || [], scores: m.scores, names: m.names }); return; }
  if (m.phase === 'end') { onEnd({ scores: m.scores, names: m.names }); return; }
  renderBattle();
}
function toWire(q, choices) {
  return { text: q.text, alts: q.alts, type: q.type, genre: q.genre, diff: q.diff, expl: q.expl, choices, hideName: q.hideName,
    loc: { lp: q.loc.lp, pid: q.loc.place ? q.loc.place.id : null, ck: q.loc.city ? q.loc.city.key : null, name: q.loc.name } };
}
function fromWire(w) {
  const place = w.loc.pid ? placeById.get(w.loc.pid) : null, city = w.loc.ck ? cityByKey.get(w.loc.ck) : null;
  return { text: w.text, alts: w.alts, type: w.type, genre: w.genre, diff: w.diff, expl: w.expl, wireChoices: w.choices, hideName: w.hideName, choices: [],
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
  send({ k: 'q', round: r, total: B.total, q: toWire(q, B.settings.mode === 'choice' ? makeChoices(q) : null), timeLimit: B.settings.time });
  clearTimeout(B.hostTimer);
  B.hostTimer = setTimeout(() => hostReveal(r), SPIN_MS + B.settings.time * 1000 + 2500);
}
function onQuestion(m, elapsed) {
  B.round = m.round; B.total = m.total; B.qp = m.q; B.q = fromWire(m.q); B.timeLimit = m.timeLimit;
  B.answers = new Map(); B.myAns = null; B.results = null; B.err = '';
  B.phase = 'spinning';
  B.view = { state: 'spinning', loc: B.q.loc, hideName: B.q.hideName, hideLoc: false, ok: null };
  if (mode !== 'battle') setMode('battle');
  renderBattle();
  const r = m.round;
  const begin = () => {
    if (B.round !== r || B.phase !== 'spinning') return;
    B.phase = 'asking'; B.view.state = 'asking'; B.tStart = now() - elapsed;
    renderBattle(); dirty = true;
    clearInterval(B.tick); B.tick = setInterval(tickTimer, 200); tickTimer();
    const inp = $('#bans'); if (inp && innerWidth >= 960) inp.focus({ preventScroll: true });
    if (innerWidth < 960) revealPanel();
  };
  if (elapsed > 0) { flyTo(B.q.loc, { zoom: Math.min(zoomFor(B.q.loc), 4.2), dur: 500, done: begin }); }
  else spinTo(B.q.loc, Math.min(zoomFor(B.q.loc), 4.2), begin);
}
function tickTimer() {
  if (B.phase !== 'asking') { clearInterval(B.tick); return; }
  const left = Math.max(0, B.timeLimit * 1000 - (now() - B.tStart));
  const s = Math.ceil(left / 1000);
  const el = $('#b-time'); if (el) el.textContent = s;
  const bar = $('#b-bar'); if (bar) bar.style.width = (100 * left / (B.timeLimit * 1000)).toFixed(1) + '%';
  const ro = $('#readout');
  if (mode === 'battle' && !spinning) { ro.hidden = false; ro.textContent = B.myAns ? '回答済み · 残り ' + s + '秒' : '残り ' + s + '秒'; }
  if (left <= 0 && !B.myAns) submitBattle('', null, true);
}
function submitBattle(text, picked, timeout) {
  if (B.phase !== 'asking' || B.myAns) return;
  const q = B.q;
  let ok = false, given = '';
  if (picked != null) { ok = norm(picked) === norm(q.alts[0]); given = picked; }
  else if (!timeout) { if (!norm(text)) { toast('答えを入力してください'); return; } ok = isCorrect(q, text); given = text; }
  const t = Math.round(now() - B.tStart);
  B.myAns = { ok, t, text: given, timeout: !!timeout };
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
    const pts = a && a.ok ? 10 + Math.round(10 * clamp(1 - a.t / (B.timeLimit * 1000), 0, 1)) : 0;
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
  return `${s.count}問 · 1問${s.time}秒 · ${s.mode === 'choice' ? '4択' : '入力'} · ${diffs} · ${regs}`;
}
function renderBattle() {
  const v = $('#view-battle');
  if (!v) return;
  const P = B.phase;
  let html = '';
  const errHTML = B.err ? `<p class="hint">${esc(B.err)}</p>` : '';
  if (P === 'lobby' || P === 'connecting') {
    html = `<div><p class="eyebrow">オンライン対戦</p><h2 class="pname">みんなで対戦</h2></div>
      <p class="lead">部屋を作って部屋コードを友達に伝えると、全員の画面で同じ地球儀が回り、同じ問題に同時に答えます。正解で10点、早く答えるほど最大10点のボーナスが付きます。</p>
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
        <div class="set"><label class="lbl">制限時間</label><div class="seg" style="align-self:flex-start">${[10, 15, 20, 30].map(n => `<button data-bt="${n}" aria-pressed="${B.settings.time === n}">${n}秒</button>`).join('')}</div></div>
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
    const meta = `<div class="qmeta"><span>第${B.round}問 / ${B.total}</span><span class="stars">${stars(q.diff)}</span>${q.genre ? `<span class="tag">${esc(q.genre)}</span>` : ''}${q.type !== '国名' ? `<span class="tag">答え: ${esc(q.type)}</span>` : ''}</div>`;
    if (P === 'spinning') html = `<div class="qcard">${meta}<p class="qtext">地球儀が回っています…</p></div>`;
    else {
      const timer = `<div class="timer"><span class="mono" id="b-time">${B.timeLimit}</span><small>秒</small><div class="bar"><div id="b-bar"></div></div></div>`;
      const body = B.myAns
        ? `<p class="lead">${B.myAns.timeout ? '時間切れです。' : '回答を送りました。'}ほかのプレイヤーを待っています。</p>`
        : answerUI(q, q.wireChoices, 'b');
      html = `<div class="qcard">${meta}${timer}<p class="qtext">${esc(q.text)}</p>${body}</div>
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
  v.innerHTML = `<div class="pane">${html}</div>`;
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

/* ---------------- start ---------------- */
select(placeById.get('JPN'));
recent.length = 0; recent.push(placeById.get('JPN'));
renderQuiz();
renderBattle();
updateSpinLabel();
const hm = location.hash.match(/^#room-([A-Za-z0-9]{4})$/);
if (hm) { B.joinCode = hm[1].toUpperCase(); setMode('battle'); }
window.__globe = { B, SQ, QUIZ, allQs };
})();
