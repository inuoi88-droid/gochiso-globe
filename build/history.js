// Builds the time-slip data from Cliopatria (Seshat Global History Databank, CC BY 4.0).
//   node build/history.js path/to/cliopatria_polities_only.geojson
// Writes site/history/index.json (polities, encyclopedia, events) and
// site/history/cNN.json (one TopoJSON per century, loaded only when needed).
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const d3 = require('d3');
const tsv = require('topojson-server');
const ts = require('topojson-simplify');
const tj = require('topojson-client');
const polylabel = require('polylabel');
const pc = require('polygon-clipping');
const crypto = require('crypto');

const SRC = process.argv[2];
if (!SRC) { console.error('usage: node build/history.js cliopatria.geojson'); process.exit(1); }
const Y0 = 1, Y1 = 2024, CHUNK = 100;
const THRESH = 8e-8;          // spherical triangle area kept by simplification (steradians)
const QUANT = 3e4;
const OUT = path.join(ROOT, 'site', 'history');
const rd = f => fs.readFileSync(path.join(ROOT, 'data', 'history', f), 'utf8');

/* ---------- names ---------- */
// English name -> [{ja, from, to}]  (from/to limit the rule to some years)
const nameRules = new Map();
for (const raw of rd('polities.tsv').split('\n')) {
  if (!raw.trim() || raw.startsWith('#')) continue;
  const [en, ja, range] = raw.split('\t');
  let from = -Infinity, to = Infinity;
  if (range) {
    const m = range.match(/^(-?\d*)~(-?\d*)$/);
    if (!m) throw new Error('bad range ' + raw);
    if (m[1]) from = +m[1];
    if (m[2]) to = +m[2];
  }
  if (!nameRules.has(en)) nameRules.set(en, []);
  nameRules.get(en).push({ ja: ja.trim(), from, to });
}

/* ---------- rows ---------- */
const src = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const rows = [];
const missing = new Set();
for (const f of src.features) {
  const p = f.properties;
  if (p.Type !== 'POLITY' || p.ToYear < Y0 || p.FromYear > Y1 || !f.geometry) continue;
  const rules = nameRules.get(p.Name);
  if (!rules) { missing.add(p.Name); continue; }
  for (const r of rules) {
    const from = Math.max(p.FromYear, r.from, Y0), to = Math.min(p.ToYear, r.to, Y1);
    if (from > to || r.ja === '-') continue;
    rows.push({ en: p.Name, ja: r.ja, group: p.Name.startsWith('('), from, to, orig: Math.max(p.FromYear, r.from), wiki: p.Wikipedia || '', geom: f.geometry });
  }
}
if (missing.size) { console.error('no Japanese name for:\n' + [...missing].join('\n')); process.exit(1); }

/* ---------- extra polities (not in Cliopatria) ---------- */
{
  let cur = null;
  for (const raw of rd('extra.txt').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('@')) {
      const [ja, from, to, en, wiki] = line.slice(1).split('|');
      cur = { en: en || ja, ja, group: false, from: +from, to: +to, orig: +from, wiki: wiki || '', geom: { type: 'MultiPolygon', coordinates: [] }, extra: true };
      rows.push(cur);
    } else if (line.startsWith('=')) {
      const name = line.slice(1).trim();
      const f = src.features.filter(x => x.properties.Name === name).sort((a, b) => a.properties.FromYear - b.properties.FromYear)[0];
      if (!f) throw new Error('extra: no polity ' + name);
      cur.geom = f.geometry;
    } else {
      const ring = line.split(/\s+/).map(s => s.split(',').map(Number));
      ring.push(ring[0]);
      cur.geom.coordinates.push([ring]);
    }
  }
}

// d3 expects clockwise exterior rings; a polygon covering more than half the sphere is
// wound the other way, so reverse all its rings
let rewound = 0;
const polysOf = g => g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
for (const r of rows) {
  for (const poly of polysOf(r.geom)) {
    if (d3.geoArea({ type: 'Polygon', coordinates: poly }) > 2 * Math.PI) { poly.forEach(ring => ring.reverse()); rewound++; }
  }
}

// merge consecutive rows of one polity that share the same shape
rows.sort((a, b) => a.ja.localeCompare(b.ja) || (a.group - b.group) || a.from - b.from);
const merged = [];
for (const r of rows) {
  r.key = JSON.stringify(r.geom.coordinates);
  const last = merged[merged.length - 1];
  if (last && last.ja === r.ja && last.group === r.group && last.key === r.key && r.from <= last.to + 1) { last.to = Math.max(last.to, r.to); continue; }
  merged.push(r);
}
console.log('rows', rows.length, '-> merged', merged.length, 'rewound polygons', rewound);

/* ---------- cut the shapes to the land ---------- */
// Cliopatria shapes reach a little into the sea. Cutting them to the same coastline the app
// draws (data/world.json) here means the browser does not have to clip every frame.
// Results are cached in build/cache (not committed) because this step takes a few minutes.
{
  const world = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'world.json'), 'utf8'));
  const land = tj.merge(world, world.objects.countries.geometries);
  const boxOf = rings => { const a = [180, 90, -180, -90]; for (const rg of rings) for (const [x, y] of rg) { if (x < a[0]) a[0] = x; if (y < a[1]) a[1] = y; if (x > a[2]) a[2] = x; if (y > a[3]) a[3] = y; } return a; };
  const landPolys = land.coordinates.map(p => ({ p, b: boxOf(p) }));
  const cacheDir = path.join(ROOT, 'build', 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const cacheFile = path.join(cacheDir, 'landclip.json');
  const landHash = crypto.createHash('sha1').update(JSON.stringify(land.coordinates)).digest('hex').slice(0, 12);
  let cache = {};
  try { const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); if (c.land === landHash) cache = c.geoms; } catch (e) { /* no cache yet */ }
  const fresh = {};
  let done = 0, failed = 0, hit = 0;
  const t0 = Date.now();
  for (const r of merged) {
    const h = crypto.createHash('sha1').update(r.key).digest('hex');
    let out = cache[h];
    if (out) hit++;
    else {
      const polys = polysOf(r.geom);
      const b = boxOf(polys.flat());
      const cand = landPolys.filter(q => !(q.b[0] > b[2] || q.b[2] < b[0] || q.b[1] > b[3] || q.b[3] < b[1])).map(q => q.p);
      try { out = cand.length ? pc.intersection(polys, cand) : []; }
      catch (e) { out = null; failed++; }
    }
    fresh[h] = out;
    if (out && out.length) {
      r.geom = { type: 'MultiPolygon', coordinates: out };
      for (const poly of out) if (d3.geoArea({ type: 'Polygon', coordinates: poly }) > 2 * Math.PI) poly.forEach(ring => ring.reverse());
    }
    if (++done % 1000 === 0) console.log(`  land clip ${done}/${merged.length} (${Math.round((Date.now() - t0) / 1000)}s)`);
  }
  fs.writeFileSync(cacheFile, JSON.stringify({ land: landHash, geoms: fresh }));
  console.log('land clip done', merged.length, 'cached', hit, 'failed (kept as is)', failed);
}

/* ---------- overlaps: in any year, land claimed by two polities belongs to the smaller one ---------- */
// Cliopatria sometimes keeps a former colony inside the old power for decades (the French
// Fifth Republic row of 1961-2023 still holds Algeria after it became independent in 1963).
// The app already draws smaller shapes on top, so here the larger shape loses that land too,
// year by year; otherwise its name, area and quiz pin would sit on the other country.
{
  const boxOf = rings => { const a = [180, 90, -180, -90]; for (const rg of rings) for (const [x, y] of rg) { if (x < a[0]) a[0] = x; if (y < a[1]) a[1] = y; if (x > a[2]) a[2] = x; if (y > a[3]) a[3] = y; } return a; };
  const KM2_ = 6371.0088 * 6371.0088;
  const geoArea = g => polysOf(g).reduce((s, poly) => s + d3.geoArea({ type: 'Polygon', coordinates: poly }), 0);
  const inner = g => {   // a point well inside the biggest polygon
    let big = null, bigA = -1;
    for (const poly of polysOf(g)) { const a = d3.geoArea({ type: 'Polygon', coordinates: poly }); if (a > bigA) { bigA = a; big = poly; } }
    if (!big) return null;
    const ref = big[0][0][0];
    const p = polylabel(big.map(rg => rg.map(([x, y]) => { const dx = x - ref; return [dx > 180 ? x - 360 : dx < -180 ? x + 360 : x, y]; })), 0.05);
    return [p[0] > 180 ? p[0] - 360 : p[0] < -180 ? p[0] + 360 : p[0], p[1]];
  };
  // polygon-clipping occasionally fails on nearly coincident edges: then cut one shape at a
  // time, rounding the coordinates on a second try, and skip only a shape that still fails
  const round = polys => polys.map(p => p.map(rg => rg.map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5])));
  function subtract(base, subs) {
    try { return { polys: pc.difference(base, ...subs), skipped: [] }; } catch (e) { /* try one by one */ }
    let cur = base; const skipped = [];
    subs.forEach((sub, i) => {
      try { cur = pc.difference(cur, sub); return; } catch (e) { /* retry rounded */ }
      try { cur = pc.difference(round(cur), round(sub)); return; } catch (e) { skipped.push(i); }
    });
    return { polys: cur, skipped };
  }
  const leafRows = merged.filter(r => !r.group);
  for (const r of leafRows) { r.sa = geoArea(r.geom); r.box = boxOf(polysOf(r.geom).flat()); r.ip = inner(r.geom); }
  // rows active in each 25-year window, to find candidates quickly
  const W = 25, buckets = new Map();
  for (const r of leafRows) for (let b = Math.floor(r.from / W); b <= Math.floor(r.to / W); b++) { if (!buckets.has(b)) buckets.set(b, []); buckets.get(b).push(r); }
  const wins = (s, r) => s.sa < r.sa || (s.sa === r.sa && (s.from > r.from || (s.from === r.from && s.ja > r.ja)));
  const cacheFile = path.join(ROOT, 'build', 'cache', 'overlap.json');
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (e) { /* no cache yet */ }
  const fresh = {};
  const out = [];
  let pairs = 0, split = 0, failed = 0;
  const report = ['larger\tyears\tsmaller (kept)\tyears\tlarger km2\tsmaller km2'];
  const t0 = Date.now();
  for (const r of merged) {
    if (r.group || !r.ip) { out.push(r); continue; }
    const seen = new Set(), over = [];
    for (let b = Math.floor(r.from / W); b <= Math.floor(r.to / W); b++) {
      for (const s of buckets.get(b) || []) {
        if (s === r || seen.has(s)) continue;
        seen.add(s);
        if (s.ja === r.ja || !s.ip || s.to < r.from || s.from > r.to || !wins(s, r)) continue;
        if (s.box[0] > r.box[2] || s.box[2] < r.box[0] || s.box[1] > r.box[3] || s.box[3] < r.box[1]) continue;
        // only shapes that really sit inside this one, not neighbours touching along a border
        if (!d3.geoContains(r.geom, s.ip)) continue;
        over.push(s);
      }
    }
    if (!over.length) { out.push(r); continue; }
    pairs += over.length;
    for (const s of over) report.push([r.ja, `${r.from}-${r.to}`, s.ja, `${s.from}-${s.to}`, Math.round(r.sa * KM2_), Math.round(s.sa * KM2_)].join('\t'));
    // split the years wherever the set of overlapping shapes changes
    const cuts = new Set([r.from, r.to + 1]);
    for (const s of over) { if (s.from > r.from) cuts.add(s.from); if (s.to < r.to) cuts.add(s.to + 1); }
    const ys = [...cuts].sort((a, b) => a - b);
    let last = null;
    for (let i = 0; i < ys.length - 1; i++) {
      const a = ys[i], b = ys[i + 1] - 1;
      const act = over.filter(s => s.from <= a && s.to >= b);
      let geom = r.geom;
      if (act.length) {
        const h = crypto.createHash('sha1').update(r.key + '|' + act.map(s => s.key).sort().join('|')).digest('hex');
        let res = cache[h];
        if (res === undefined) {
          const left = subtract(polysOf(r.geom), act.map(s => polysOf(s.geom)));
          res = left.polys;
          if (left.skipped.length) { failed++; report.push(`FAILED\t${r.ja}\t${r.from}-${r.to}\t${left.skipped.map(i => act[i].ja).join(',')}`); }
        }
        fresh[h] = res;
        if (res) {
          for (const poly of res) if (d3.geoArea({ type: 'Polygon', coordinates: poly }) > 2 * Math.PI) poly.forEach(ring => ring.reverse());
          geom = { type: 'MultiPolygon', coordinates: res };
        }
      }
      const key = geom === r.geom ? r.key : JSON.stringify(geom.coordinates);
      // nothing left (the whole shape was another polity's that year): drop those years
      if (!polysOf(geom).length) { last = null; continue; }
      if (last && last.key === key && last.to === a - 1) { last.to = b; continue; }
      last = Object.assign({}, r, { from: a, to: b, geom, key });
      out.push(last);
    }
    split++;
  }
  merged.length = 0; merged.push(...out);
  fs.writeFileSync(cacheFile, JSON.stringify(fresh));
  fs.writeFileSync(path.join(ROOT, 'build', 'cache', 'overlap-report.tsv'), report.join('\n') + '\n');
  console.log('overlaps: rows cut', split, 'overlapping pairs', pairs, 'failed (kept as is)', failed, 'rows now', merged.length, `(${Math.round((Date.now() - t0) / 1000)}s)`);
}

/* ---------- polities ---------- */
const polities = [], pIndex = new Map();
for (const r of merged) {
  const k = (r.group ? 'g|' : '') + r.ja;
  let p = pIndex.get(k);
  if (!p) {
    p = { k, n: r.ja, en: new Set(), w: r.wiki, g: r.group ? 1 : 0, f: r.from, t: r.to, s: r.orig, a: 0, rows: [] };
    pIndex.set(k, p); polities.push(p);
  }
  if (!r.en.startsWith('(')) p.en.add(r.en); else p.en.add(r.en.slice(1, -1));
  if (!p.w && r.wiki) p.w = r.wiki;
  p.f = Math.min(p.f, r.from); p.t = Math.max(p.t, r.to); p.s = Math.min(p.s, r.orig);
  p.rows.push(r);
  r.p = p;
}

/* ---------- per-row geometry stats: label point, area, extent ---------- */
const area = g => polysOf(g).reduce((s, poly) => s + d3.geoArea({ type: 'Polygon', coordinates: poly }), 0);
const KM2 = 6371.0088 * 6371.0088;
for (const r of merged) {
  const polys = polysOf(r.geom);
  let big = null, bigA = -1;
  for (const poly of polys) { const a = d3.geoArea({ type: 'Polygon', coordinates: poly }); if (a > bigA) { bigA = a; big = poly; } }
  r.area = area(r.geom) * KM2;
  if (!big) { r.lp = [0, 0]; r.rad = 0; continue; }
  const ref = big[0][0][0];
  const ring = big.map(rg => rg.map(([x, y]) => { const dx = x - ref; if (dx > 180) x -= 360; if (dx < -180) x += 360; return [x, y]; }));
  const lp = polylabel(ring, 0.05);
  let x = lp[0]; if (x > 180) x -= 360; if (x < -180) x += 360;
  r.lp = [+x.toFixed(2), +lp[1].toFixed(2)];
  let rad = 0.002;
  for (const poly of polys) {
    const a = d3.geoArea({ type: 'Polygon', coordinates: poly });
    if (a < bigA * 0.05) continue;
    for (const v of poly[0]) rad = Math.max(rad, d3.geoDistance(r.lp, v));
  }
  r.rad = +Math.min(rad, 1.4).toFixed(3);
}
for (const p of polities) p.a = Math.round(Math.max(...p.rows.map(r => r.area)));

/* ---------- colours: neighbours that exist at the same time get different colours ---------- */
const K = 8;
const leaf = polities.filter(p => !p.g);
const adj = new Map(leaf.map(p => [p, new Set()]));
for (let c0 = Y0; c0 <= Y1; c0 += 50) {
  const c1 = c0 + 49;
  const act = [];
  for (const p of leaf) {
    let box = null;
    for (const r of p.rows) {
      if (r.to < c0 || r.from > c1) continue;
      const b = d3.geoBounds(r.geom);
      if (!box) box = [[b[0][0], b[0][1]], [b[1][0], b[1][1]]];
      else { box[0][0] = Math.min(box[0][0], b[0][0]); box[0][1] = Math.min(box[0][1], b[0][1]); box[1][0] = Math.max(box[1][0], b[1][0]); box[1][1] = Math.max(box[1][1], b[1][1]); }
    }
    if (box) act.push([p, box]);
  }
  const m = 0.6;
  for (let i = 0; i < act.length; i++) for (let j = i + 1; j < act.length; j++) {
    const [a, A] = act[i], [b, B] = act[j];
    if (A[0][1] - m > B[1][1] || B[0][1] - m > A[1][1]) continue;
    const wrapA = A[0][0] > A[1][0], wrapB = B[0][0] > B[1][0];
    if (!wrapA && !wrapB && (A[0][0] - m > B[1][0] || B[0][0] - m > A[1][0])) continue;
    adj.get(a).add(b); adj.get(b).add(a);
  }
}
const colorOf = new Map();
[...leaf].sort((a, b) => adj.get(b).size - adj.get(a).size || b.a - a.a).forEach((p, i) => {
  const used = new Map();
  for (const q of adj.get(p)) if (colorOf.has(q)) used.set(colorOf.get(q), (used.get(colorOf.get(q)) || 0) + 1);
  let best = 0, bestN = Infinity;
  for (let k = 0; k < K; k++) { const c = (k + i) % K, n = used.get(c) || 0; if (n < bestN) { bestN = n; best = c; } }
  colorOf.set(p, best);
});

/* ---------- encyclopedia, events ---------- */
function parseZukan(text) {
  const out = {};
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('@')) { cur = { n: line.slice(1).trim(), people: [], things: [], notes: [] }; if (out[cur.n]) throw new Error('zukan dup ' + cur.n); out[cur.n] = cur; continue; }
    if (!cur) throw new Error('zukan: line before @ ' + line);
    if (line.startsWith('* ')) { cur.notes.push(line.slice(2).trim()); continue; }
    const i = line.indexOf('=');
    if (i < 0) throw new Error('zukan bad line ' + line);
    const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
    const pair = () => { const j = v.indexOf('|'); return j < 0 ? [v, ''] : [v.slice(0, j).trim(), v.slice(j + 1).trim()]; };
    if (k === '人物') cur.people.push(pair());
    else if (k === '発明' || k === '文化') cur.things.push([...pair(), k]);
    else cur[k] = v;
  }
  return out;
}
const zukan = parseZukan(rd('zukan.txt'));
for (const n of Object.keys(zukan)) if (!polities.some(p => p.n === n)) console.warn('zukan entry without polity:', n);
const events = rd('events.txt').split('\n').filter(l => l.trim() && !l.startsWith('#')).map(l => {
  const [y, ll, title, desc, pol] = l.split('|').map(s => s.trim());
  const [lat, lon] = ll.split(',').map(Number);
  if (!isFinite(+y) || !isFinite(lat) || !isFinite(lon)) throw new Error('bad event ' + l);
  if (pol && !polities.some(p => p.n === pol)) console.warn('event polity not found:', pol);
  return [+y, +lon.toFixed(2), +lat.toFixed(2), title, desc || '', pol || ''];
}).sort((a, b) => a[0] - b[0]);

/* ---------- write chunks ---------- */
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/^c\d+\.json$/.test(f)) fs.unlinkSync(path.join(OUT, f));
const pid = new Map(polities.map((p, i) => [p, i]));
const chunks = [];
let total = 0;
for (let c = 0, y0 = Y0; y0 <= Y1; c++, y0 += CHUNK) {
  const y1 = Math.min(Y1, y0 + CHUNK - 1);
  const feats = merged.filter(r => r.from <= y1 && r.to >= y0).map(r => ({
    type: 'Feature',
    properties: { i: pid.get(r.p), f: r.from, t: r.to, l: r.lp, a: Math.round(r.area), r: r.rad },
    geometry: r.geom
  }));
  let topo = tsv.topology({ p: { type: 'FeatureCollection', features: feats } });
  topo = ts.presimplify(topo, ts.sphericalTriangleArea);
  topo = ts.simplify(topo, THRESH);
  topo = ts.filter(topo, ts.filterWeight(topo, THRESH * 4, ts.sphericalRingArea));
  topo = tj.quantize(topo, QUANT);
  for (const arc of topo.arcs) for (const pt of arc) pt.length = 2;
  // geometries emptied by the filter are kept as nulls so every row still exists
  const file = `c${String(c).padStart(2, '0')}.json`;
  const s = JSON.stringify(topo);
  fs.writeFileSync(path.join(OUT, file), s);
  total += s.length;
  chunks.push([y0, y1, file]);
}
const index = {
  src: 'Cliopatria v0.2.1 (Seshat Global History Databank, CC BY 4.0)',
  years: [Y0, Y1],
  chunks,
  polities: polities.map(p => {
    const o = { n: p.n, en: [...p.en].join(' / '), f: p.f, t: p.t, a: p.a };
    if (p.w) o.w = p.w;
    if (p.g) o.g = 1; else o.c = colorOf.get(p);
    if (p.rows.some(r => r.extra)) o.x = 1;
    if (p.s < Y0) o.s = p.s;
    // area over time for the chart in the encyclopedia: [from, area in 1000 km2, ...]; each step
    // lasts until the next one (or the polity's last year). Small changes are folded together,
    // and a gap in the record is a step with area 0.
    o.h = [];
    let lastA = -1, lastTo = -Infinity;
    for (const r of p.rows.slice().sort((x, y) => x.from - y.from)) {
      const a = Math.round(r.area / 1000);
      if (r.from > lastTo + 1 && lastA >= 0) { o.h.push(lastTo + 1, 0); lastA = 0; }
      if (lastA >= 0 && Math.abs(a - lastA) <= Math.max(1, lastA * 0.03)) { lastTo = Math.max(lastTo, r.to); continue; }
      o.h.push(r.from, a); lastA = a; lastTo = Math.max(lastTo, r.to);
    }
    return o;
  }),
  zukan,
  events
};
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
console.log('polities', polities.length, 'groups', polities.filter(p => p.g).length, 'zukan', Object.keys(zukan).length, 'events', events.length);
console.log('chunks', chunks.length, 'total', Math.round(total / 1024), 'KB', 'index', Math.round(fs.statSync(path.join(OUT, 'index.json')).size / 1024), 'KB');
