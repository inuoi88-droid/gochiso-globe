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

/* ---------- helpers for planar polygon operations ---------- */
const boxOf = rings => { const a = [180, 90, -180, -90]; for (const rg of rings) for (const [x, y] of rg) { if (x < a[0]) a[0] = x; if (y < a[1]) a[1] = y; if (x > a[2]) a[2] = x; if (y > a[3]) a[3] = y; } return a; };
const sphArea = g => polysOf(g).reduce((s, poly) => s + d3.geoArea({ type: 'Polygon', coordinates: poly }), 0);
const KM2 = 6371.0088 * 6371.0088;
const rewind = polys => { for (const poly of polys) if (d3.geoArea({ type: 'Polygon', coordinates: poly }) > 2 * Math.PI) poly.forEach(ring => ring.reverse()); return polys; };
// a point well inside a polygon (polylabel, with longitudes unwrapped around the first vertex)
function innerOf(poly) {
  const ref = poly[0][0][0];
  const p = polylabel(poly.map(rg => rg.map(([x, y]) => { const dx = x - ref; return [dx > 180 ? x - 360 : dx < -180 ? x + 360 : x, y]; })), 0.05);
  return [p[0] > 180 ? p[0] - 360 : p[0] < -180 ? p[0] + 360 : p[0], p[1]];
}
function biggestPoly(g) {
  let big = null, bigA = -1;
  for (const poly of polysOf(g)) { const a = d3.geoArea({ type: 'Polygon', coordinates: poly }); if (a > bigA) { bigA = a; big = poly; } }
  return big;
}
// polygon-clipping works on a flat map, so a ring that jumps across the 180° meridian (Natural
// Earth's Chukotka, Fiji and Antarctica) must be cut there first: make its longitudes
// continuous, then intersect copies shifted by -360/0/+360 with the [-180,180] box.
function splitAtAntimeridian(poly) {
  const outer = poly[0];
  let jump = false;
  for (let i = 1; i < outer.length; i++) if (Math.abs(outer[i][0] - outer[i - 1][0]) > 180) { jump = true; break; }
  if (!jump) return [poly];
  const un = [outer[0].slice()];
  for (let i = 1; i < outer.length; i++) {
    let x = outer[i][0];
    const prev = un[i - 1][0];
    while (x - prev > 180) x -= 360;
    while (x - prev < -180) x += 360;
    un.push([x, outer[i][1]]);
  }
  const drift = un[un.length - 1][0] - un[0][0];
  if (Math.abs(drift) > 180) {   // a ring around a pole: close it along the pole
    const py = un.reduce((s, q) => s + q[1], 0) < 0 ? -90 : 90;
    const last = un[un.length - 1];
    un.push([last[0], py], [un[0][0], py], un[0].slice());
  }
  const box = [[[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]]];
  const out = [];
  for (const k of [-360, 0, 360]) {
    const shifted = [un.map(([x, y]) => [x + k, y])];
    try { out.push(...pc.intersection([shifted], [box])); } catch (e) { /* skip this copy */ }
  }
  return out;
}
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

/* ---------- cut the shapes to the land ---------- */
// Cliopatria shapes reach a little into the sea. Cutting them to the same coastline the app
// draws (data/world.json) here means the browser does not have to clip every frame.
// Results are cached in build/cache (not committed) because this step takes a few minutes.
{
  const world = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'world.json'), 'utf8'));
  const countries = tj.feature(world, world.objects.countries).features;
  const landPolys = countries.flatMap(f => polysOf(f.geometry)).flatMap(splitAtAntimeridian).map(p => ({ p, b: boxOf(p) }));
  const cacheDir = path.join(ROOT, 'build', 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const cacheFile = path.join(cacheDir, 'landclip.json');
  const landHash = crypto.createHash('sha1').update('v2|' + JSON.stringify(landPolys.map(q => q.p))).digest('hex').slice(0, 12);
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
    if (out && out.length) r.geom = { type: 'MultiPolygon', coordinates: rewind(JSON.parse(JSON.stringify(out))) };
    if (++done % 1000 === 0) console.log(`  land clip ${done}/${merged.length} (${Math.round((Date.now() - t0) / 1000)}s)`);
  }
  fs.writeFileSync(cacheFile, JSON.stringify({ land: landHash, geoms: fresh }));
  console.log('land clip done', merged.length, 'cached', hit, 'failed (kept as is)', failed);
}

/* ---------- overlaps: in any year, land claimed by two polities belongs to the smaller one ---------- */
// Cliopatria sometimes keeps a former colony inside the old power for decades (the French
// Fifth Republic row of 1961-2023 still holds Algeria after it became independent in 1963).
// The app draws smaller shapes on top (by the area before this step), so here the larger
// shape loses that land too, year by year; otherwise its name, area and quiz pin would sit
// on the other country. data/history/overrides.txt names pairs where the size rule is wrong.
{
  // overrides: "winner|loser|from~to" gives the shared land to the winner whatever the sizes;
  // "a=b|from~to" leaves the overlap as it is (b is a part of a in those years)
  const rules = [];
  for (const raw of rd('overrides.txt').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('|').map(x => x.trim());
    const keep = parts[0].includes('=');
    const m = (parts[keep ? 1 : 2] || '~').match(/^(-?\d*)~(-?\d*)$/);
    if (!m || (!keep && parts.length < 2)) throw new Error('bad overrides line ' + line);
    const from = m[1] ? +m[1] : -Infinity, to = m[2] ? +m[2] : Infinity;
    if (keep) { const [a, b] = parts[0].split('='); rules.push({ keep: true, a, b, from, to }); }
    else rules.push({ keep: false, win: parts[0], lose: parts[1], from, to });
  }
  const named = new Set(merged.map(r => r.ja));
  for (const q of rules) for (const n of q.keep ? [q.a, q.b] : [q.win, q.lose]) if (!named.has(n)) throw new Error('overrides: unknown polity ' + n);
  // years [f,t] minus a list of [from,to] ranges
  const minus = (f, t, cut) => { let parts = [[f, t]]; for (const [a, b] of cut) parts = parts.flatMap(([x, y]) => b < x || a > y ? [[x, y]] : [...(a > x ? [[x, a - 1]] : []), ...(b < y ? [[b + 1, y]] : [])]); return parts; };
  const KEEP_KM2 = 300;   // ignore cuts smaller than this (and than 0.3% of the shape): border slivers
  const leafRows = merged.filter(r => !r.group);
  for (const r of leafRows) {
    r.sa = sphArea(r.geom);
    r.box = boxOf(polysOf(r.geom).flat());
    const polys = polysOf(r.geom);
    // where to look for overlaps: an inner point of every sizeable part, plus a grid of points
    r.probes = polys.filter(p => d3.geoArea({ type: 'Polygon', coordinates: p }) >= r.sa * 0.02 || polys.length === 1).map(innerOf);
    const [x0, y0, x1, y1] = r.box, n = 9, grid = [];
    if (x1 - x0 < 300) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const q = [x0 + (x1 - x0) * (i + 0.5) / n, y0 + (y1 - y0) * (j + 0.5) / n];
      if (d3.geoContains(r.geom, q)) grid.push(q);
    }
    r.grid = grid;
  }
  // cut results are cached by the (already land-clipped) shapes involved, so a change to the
  // coastline, the names or this code's version gives new keys
  const OV = 'ov2';
  for (const r of leafRows) r.ckey = crypto.createHash('sha1').update(JSON.stringify(r.geom.coordinates)).digest('hex');
  const ovFile = path.join(ROOT, 'build', 'cache', 'overlap.json');
  let ovCache = {};
  try { const c = JSON.parse(fs.readFileSync(ovFile, 'utf8')); if (c.v === OV) ovCache = c.geoms; } catch (e) { /* no cache yet */ }
  const ovFresh = {};
  const W = 25, buckets = new Map();
  for (const r of leafRows) for (let b = Math.floor(r.from / W); b <= Math.floor(r.to / W); b++) { if (!buckets.has(b)) buckets.set(b, []); buckets.get(b).push(r); }
  const smaller = (s, r) => s.sa < r.sa || (s.sa === r.sa && (s.from > r.from || (s.from === r.from && s.ja > r.ja)));
  const inBox = (q, b) => q[0] >= b[0] && q[0] <= b[2] && q[1] >= b[1] && q[1] <= b[3];
  const out = [];
  let pairs = 0, split = 0, failed = 0;
  const report = ['larger\tyears\tsmaller (kept)\tyears\tlarger km2\tsmaller km2'];
  const t0 = Date.now();
  for (const r of merged) {
    if (r.group) { out.push(r); continue; }
    const seen = new Set(), over = [];
    for (let b = Math.floor(r.from / W); b <= Math.floor(r.to / W); b++) {
      for (const s of buckets.get(b) || []) {
        if (s === r || seen.has(s)) continue;
        seen.add(s);
        if (s.ja === r.ja || s.to < r.from || s.from > r.to) continue;
        if (s.box[0] > r.box[2] || s.box[2] < r.box[0] || s.box[1] > r.box[3] || s.box[3] < r.box[1]) continue;
        // years in which s takes land from r: by size, unless an override says otherwise
        let win = smaller(s, r) ? [[Math.max(s.from, r.from), Math.min(s.to, r.to)]] : [];
        const forced = [];
        for (const q of rules) {
          if (q.keep && ((q.a === r.ja && q.b === s.ja) || (q.a === s.ja && q.b === r.ja))) win = win.flatMap(([f, t]) => minus(f, t, [[q.from, q.to]]));
          if (!q.keep && q.lose === s.ja && q.win === r.ja) win = win.flatMap(([f, t]) => minus(f, t, [[q.from, q.to]]));
          if (!q.keep && q.win === s.ja && q.lose === r.ja) forced.push([Math.max(s.from, r.from, q.from), Math.min(s.to, r.to, q.to)]);
        }
        const all = [...win, ...forced.filter(([f, t]) => f <= t)];
        if (!all.length) continue;
        // only shapes that really overlap this one, not neighbours touching along a border
        if (!forced.length) {
          const hitProbe = s.probes.some(q => inBox(q, r.box) && d3.geoContains(r.geom, q));
          const hitGrid = !hitProbe && s.grid.filter(q => inBox(q, r.box) && d3.geoContains(r.geom, q)).length >= 2;
          if (!hitProbe && !hitGrid) continue;
        }
        for (const [f, t] of all) over.push({ s, f, t });
      }
    }
    if (!over.length) { out.push(r); continue; }
    pairs += new Set(over.map(o => o.s)).size;
    for (const s of new Set(over.map(o => o.s))) report.push([r.ja, `${r.from}-${r.to}`, s.ja, `${s.from}-${s.to}`, Math.round(r.sa * KM2), Math.round(s.sa * KM2)].join('\t'));
    // split the years wherever the set of overlapping shapes changes
    const cuts = new Set([r.from, r.to + 1]);
    for (const o of over) { if (o.f > r.from) cuts.add(o.f); if (o.t < r.to) cuts.add(o.t + 1); }
    const ys = [...cuts].sort((a, b) => a - b);
    let last = null, changed = false;
    for (let i = 0; i < ys.length - 1; i++) {
      const a = ys[i], b = ys[i + 1] - 1;
      const act = [...new Set(over.filter(o => o.f <= a && o.t >= b).map(o => o.s))];
      let geom = r.geom;
      if (act.length) {
        const ck = crypto.createHash('sha1').update(OV + '|' + r.ckey + '|' + act.map(s => s.ckey).sort().join('|')).digest('hex');
        let polys = ovCache[ck];
        if (!polys) {
          const left = subtract(polysOf(r.geom), act.map(s => polysOf(s.geom)));
          if (left.skipped.length) { failed++; report.push(`FAILED\t${r.ja}\t${r.from}-${r.to}\t${left.skipped.map(k => act[k].ja).join(',')}`); }
          polys = rewind(left.polys);
        }
        ovFresh[ck] = polys;
        const g2 = { type: 'MultiPolygon', coordinates: JSON.parse(JSON.stringify(polys)) };
        const lost = (r.sa - sphArea(g2)) * KM2;
        if (lost > KEEP_KM2 && lost > r.sa * KM2 * 0.003) { geom = g2; changed = true; }
      }
      const key = geom === r.geom ? r.key : JSON.stringify(geom.coordinates);
      // nothing left (the whole shape was another polity's that year): drop those years
      if (!polysOf(geom).length) { last = null; continue; }
      if (last && last.key === key && last.to === a - 1) { last.to = b; continue; }
      last = Object.assign({}, r, { from: a, to: b, geom, key, cut: geom !== r.geom });
      out.push(last);
    }
    if (changed) split++;
  }
  merged.length = 0; merged.push(...out);
  fs.mkdirSync(path.join(ROOT, 'build', 'cache'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'build', 'cache', 'overlap-report.tsv'), report.join('\n') + '\n');
  fs.writeFileSync(ovFile, JSON.stringify({ v: OV, geoms: ovFresh }));
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
// The label (also the quiz pin and where the map flies to) goes on the polity's home polygon when
// data/history/labels.tsv names a home point for it (so the name of a colonial power sits on its
// own country, not on its largest colony); otherwise on the largest polygon.
const homes = new Map();
for (const raw of rd('labels.tsv').split('\n')) {
  if (!raw.trim() || raw.startsWith('#')) continue;
  const [ja, ll] = raw.split('\t');
  const [lon, lat] = ll.split(',').map(Number);
  if (!pIndex.has(ja)) throw new Error('labels.tsv: unknown polity ' + ja);
  homes.set(ja, [lon, lat]);
}
const area = sphArea;
for (const r of merged) {
  const polys = polysOf(r.geom);
  r.area = area(r.geom) * KM2;
  const big = biggestPoly(r.geom);
  if (!big) { r.lp = [0, 0]; r.rad = 0; continue; }
  const home = !r.group && homes.get(r.ja);
  const homePoly = home ? polys.find(p => d3.geoContains({ type: 'Polygon', coordinates: p }, home)) : null;
  const lp = innerOf(homePoly || big);
  r.lp = [+lp[0].toFixed(2), +lp[1].toFixed(2)];
  const bigA = d3.geoArea({ type: 'Polygon', coordinates: big });
  let rad = 0.002;
  for (const poly of polys) {
    const a = d3.geoArea({ type: 'Polygon', coordinates: poly });
    if (a < bigA * 0.05 && poly !== homePoly) continue;
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
    // o: the area before overlaps were cut, which the app uses to order drawing and clicks, so a
    // cut shape never jumps above a neighbour it was not cut against
    properties: { i: pid.get(r.p), f: r.from, t: r.to, l: r.lp, a: Math.round(r.area), o: Math.round((r.sa != null ? r.sa * KM2 : r.area)), r: r.rad },
    geometry: r.geom
  }));
  let topo = tsv.topology({ p: { type: 'FeatureCollection', features: feats } });
  topo = ts.presimplify(topo, ts.sphericalTriangleArea);
  topo = ts.simplify(topo, THRESH);
  topo = ts.filter(topo, ts.filterWeight(topo, THRESH * 4, ts.sphericalRingArea));
  topo = tj.quantize(topo, QUANT);
  for (const arc of topo.arcs) for (const pt of arc) pt.length = 2;
  // simplification can flip a tiny sliver inside out, and d3 then fills the whole globe with it:
  // drop any polygon that now covers more than half the sphere
  let flipped = 0;
  for (const g of topo.objects.p.geometries) {
    if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') continue;
    const polys = g.type === 'Polygon' ? [g.arcs] : g.arcs;
    const keep = polys.filter(poly => {
      const f = tj.feature(topo, { type: 'Polygon', arcs: poly });
      const ok = f.geometry && d3.geoArea(f) <= 2 * Math.PI;
      if (!ok) flipped++;
      return ok;
    });
    if (keep.length === polys.length) continue;
    if (!keep.length) { g.type = null; delete g.arcs; }
    else if (g.type === 'Polygon') g.arcs = keep[0];
    else g.arcs = keep;
  }
  if (flipped) console.log(`  ${y0}-${y1}: dropped ${flipped} inside-out sliver polygon(s)`);
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
