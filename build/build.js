// Build data bundle for the globe app
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const d3 = require('d3');
const tj = require('topojson-client');
const polylabel = require('polylabel');
const wc = require('world-countries');

const topo = JSON.parse(fs.readFileSync('data/world.json'));
const geoms = topo.objects.countries.geometries;
const byNum = {}; wc.forEach(c => { if (c.ccn3) byNum[c.ccn3] = c; });
const byA3 = {}; wc.forEach(c => { byA3[c.cca3] = c; });
const nameFix = { 'Kosovo': 'XKX', 'N. Cyprus': 'XNC', 'Somaliland': 'XSL', 'Indian Ocean Ter.': 'XIO', 'Siachen Glacier': 'XSG' };

// ---- assign iso3 ids
for (const g of geoms) {
  const c = byNum[g.id];
  g.id = c ? c.cca3 : nameFix[g.properties.name];
  if (!g.id) throw new Error('no id ' + g.properties.name);
  g.properties = {};
}

// ---- merge geometries sharing an id (Australia + Ashmore and Cartier Is.)
{
  const seen = {};
  for (let i = 0; i < geoms.length; i++) {
    const g = geoms[i];
    const toMulti = x => x.type === 'Polygon' ? [x.arcs] : x.arcs;
    if (seen[g.id]) {
      const m = seen[g.id];
      m.arcs = toMulti(m).concat(toMulti(g)); m.type = 'MultiPolygon';
      geoms.splice(i--, 1);
    } else seen[g.id] = g;
  }
}

// ---- split disputed areas out of Russia (Crimea, Northern Territories)
function polyCentroid(arcs) {
  const f = tj.feature(topo, { type: 'Polygon', arcs });
  return d3.geoCentroid(f);
}
const rus = geoms.find(g => g.id === 'RUS');
const inBox = (p, b) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
const splits = [
  { id: 'XCR', box: [32.2, 44.2, 36.8, 46.3] },
  { id: 'XNT', box: [145.0, 43.2, 149.3, 45.65] },
];
for (const s of splits) {
  const keep = [], take = [];
  for (const poly of rus.arcs) (inBox(polyCentroid(poly), s.box) ? take : keep).push(poly);
  rus.arcs = keep;
  console.log(s.id, 'polygons moved:', take.length);
  geoms.push({ type: 'MultiPolygon', arcs: take, id: s.id, properties: {} });
}

// ---- fix inverted polygons (area > 2pi)
let fixed=0;
for (const g of geoms) {
  const polys = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [];
  for (const poly of polys) {
    const a = d3.geoArea(tj.feature(topo, { type: 'Polygon', arcs: poly }));
    if (a > 2 * Math.PI) { for (let i = 0; i < poly.length; i++) poly[i] = poly[i].slice().reverse().map(x => ~x); fixed++; }
  }
}
console.log('inverted polygons fixed', fixed);

// ---- parse text data
function parseBlocks(file, headRe) {
  const out = [];
  let cur = null;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (headRe.test(line)) { cur = { head: line.slice(1).trim(), dishes: [], facts: [] }; out.push(cur); continue; }
    if (line.startsWith('- ')) {
      const i = line.indexOf(' = ');
      if (i < 0) throw new Error('bad dish ' + line);
      cur.dishes.push([line.slice(2, i).trim(), line.slice(i + 3).trim()]);
    } else if (line.startsWith('* ')) cur.facts.push(line.slice(2).trim());
    else throw new Error('bad line ' + file + ': ' + line);
  }
  return out;
}
const cData = {};
for (const f of ['c1_asia', 'c2_mideast', 'c3_europe', 'c4_africa', 'c5_americas', 'c6_oceania']) {
  for (const b of parseBlocks(`data/${f}.txt`, /^@/)) {
    const [iso, ...cap] = b.head.split(' ');
    if (cData[iso]) throw new Error('dup ' + iso);
    cData[iso] = { cap: cap.join(' '), dishes: b.dishes, facts: b.facts };
  }
}
const extras = {};
for (const b of parseBlocks('data/extras.txt', /^@/)) {
  const [iso, rest] = [b.head.slice(0, 3), b.head.slice(4)];
  const [cap, name, reg] = rest.split('|');
  extras[iso] = { cap: cap === '—' ? '' : cap, name, reg, dishes: b.dishes, facts: b.facts };
}
const cities = parseBlocks('data/cities.txt', /^#/).map(b => {
  const [n, c, lat, lon] = b.head.split('|');
  return { n, c, lat: +lat, lon: +lon, d: b.dishes, f: b.facts };
});

// ---- country names and regions (UN members), frozen from the original quiz answers
const quizInfo = {};
fs.readFileSync('data/country_names.tsv', 'utf8').trim().split('\n').slice(1).forEach(l => {
  const [iso, names, reg] = l.split('\t');
  quizInfo[iso] = { alts: names.split('/'), reg };
});

// ---- region names for other territories
const subReg = {
  'Caribbean': 'カリブ', 'Polynesia': 'オセアニア', 'Micronesia': 'オセアニア', 'Melanesia': 'オセアニア',
  'Australia and New Zealand': 'オセアニア', 'Northern Europe': 'ヨーロッパ', 'Western Europe': 'ヨーロッパ',
  'Southern Europe': 'ヨーロッパ', 'Eastern Europe': 'ヨーロッパ', 'North America': '北中米', 'Northern America': '北中米',
  'South America': '南米', 'Eastern Africa': 'アフリカ', 'Western Africa': 'アフリカ', 'Middle Africa': 'アフリカ',
  'Northern Africa': 'アフリカ', 'Southern Africa': 'アフリカ', 'Southern Asia': '南アジア', 'Western Asia': '中東',
  'Eastern Asia': '東アジア', 'South-Eastern Asia': '東南アジア', 'Central Asia': '中央アジア', 'Antarctic': '南極', '': '南極',
};
const special = {
  XIO: { name: 'オーストラリア領インド洋地域', reg: 'オセアニア' },
  XSG: { name: 'シアチェン氷河', reg: '南アジア', facts: ['インドとパキスタンが領有を争う、標高の高い氷河地帯'] },
  XCR: { name: 'クリミア半島', reg: 'ヨーロッパ', facts: ['2014年にロシアが併合を宣言し、実効支配している', '国連総会は2014年、ウクライナの領土保全を支持する決議を採択した'] },
  XNT: { name: '北方領土', reg: '東アジア', facts: ['択捉島、国後島、色丹島、歯舞群島からなる', '日本が領有を主張し、ロシアが実効支配している'] },
};
const disputed = new Set(['XCR', 'XNT', 'ESH', 'XNC', 'XSL', 'XSG']);

// ---- per-feature geometry stats
const fc = tj.feature(topo, topo.objects.countries);
const overrides = { USA: [-98.5, 39.5], RUS: [95, 62], CAN: [-102, 58], FRA: [2.4, 46.6], NOR: [9.5, 61.5], CHL: [-71, -34], IDN: [113.5, -1.5], FJI: [178.1, -17.8], KIR: [173.0, 1.4], MYS: [102.2, 3.9], NZL: [175.5, -40.5], GBR: [-1.8, 52.8], JPN: [138.3, 36.3], ITA: [12.5, 42.8], GRC: [22.3, 39.3], DNK: [9.2, 56.1], HRV: [15.9, 45.5], MHL: [171.2, 7.1], FSM: [158.2, 6.9], PLW: [134.5, 7.4], KNA: [-62.75, 17.3], ESP: [-3.7, 40.2], PRT: [-8.2, 39.6], ECU: [-78.4, -1.5], SLB: [160.1, -9.6], VUT: [167.8, -16.0], TON: [-175.2, -21.2], BHS: [-77.4, 24.6], PHL: [121.8, 13.0], CHN: [103.5, 34.5], IND: [79, 22], BRA: [-52, -10], AUS: [134, -25], ATA: [0, -82], GRL: [-41, 72], ZAF: [24.5, -29.5], NLD: [5.5, 52.2], ARE: [54.3, 24.0], OMN: [57, 21], AZE: [48.2, 40.3], YEM: [47.5, 15.6], SWE: [16, 62.5], FIN: [26, 63], CUB: [-79, 21.8] };
const feats = {};
for (const f of fc.features) {
  let biggest = null, bigA = -1, total = 0;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const p of polys) {
    const a = d3.geoArea({ type: 'Polygon', coordinates: p });
    total += a;
    if (a > bigA) { bigA = a; biggest = p; }
  }
  let lp;
  if (overrides[f.id]) lp = overrides[f.id];
  else {
    // polylabel on the biggest polygon (unwrap longitudes around its first vertex)
    const ref = biggest[0][0][0];
    const ring = biggest.map(r => r.map(([x, y]) => { let dx = x - ref; if (dx > 180) x -= 360; if (dx < -180) x += 360; return [x, y]; }));
    const p = polylabel(ring, 0.05);
    let x = p[0]; if (x > 180) x -= 360; if (x < -180) x += 360;
    lp = [x, p[1]];
  }
  // angular extent around the label point (main landmasses only)
  let r = 0.002;
  for (const p of polys) {
    const a = d3.geoArea({ type: 'Polygon', coordinates: p });
    if (a < bigA * 0.05) continue;
    const c = d3.geoCentroid({ type: 'Polygon', coordinates: p });
    if (d3.geoDistance(c, lp) > 25 * Math.PI / 180 && p !== biggest) continue;
    for (const v of p[0]) r = Math.max(r, d3.geoDistance(lp, v));
  }
  feats[f.id] = { lp: [+lp[0].toFixed(3), +lp[1].toFixed(3)], a: total, big: bigA, r: Math.min(r, 1.2) };
}

// ---- assemble places
const places = [];
const allIds = new Set([...fc.features.map(f => f.id), 'TUV']);
for (const id of allIds) {
  const w = byA3[id];
  const q = quizInfo[id];
  const c = cData[id];
  const ex = extras[id];
  const sp = special[id];
  const p = { id };
  if (q) {
    p.n = q.alts[0]; p.alts = q.alts; p.reg = q.reg; p.un = 1;
    if (!c) throw new Error('missing data for ' + id);
    p.cap = c.cap; p.d = c.dishes; p.f = c.facts;
  } else if (ex) {
    p.n = ex.name; p.reg = ex.reg; p.cap = ex.cap; p.d = ex.dishes; p.f = ex.facts;
  } else if (sp) {
    p.n = sp.name; p.reg = sp.reg; p.f = sp.facts || [];
  } else {
    p.n = w.translations.jpn.common; p.reg = subReg[w.subregion] || subReg[w.region] || 'その他';
  }
  if (!p.n) throw new Error('no name ' + id);
  if (w) p.en = w.name.common;
  if (disputed.has(id)) p.disp = 1;
  if (id === 'TUV') { p.lp = [179.19, -8.52]; p.a = 0; p.pt = 1; p.r = 0.002; }
  else { p.lp = feats[id].lp; p.a = +feats[id].a.toExponential(3); p.r = +feats[id].r.toFixed(4); }
  places.push(p);
}
const unCount = places.filter(p => p.un).length;
console.log('places', places.length, 'UN', unCount, 'cities', cities.length);
for (const ci of cities) if (!places.find(p => p.id === ci.c)) throw new Error('city country missing ' + ci.n);
const missingData = Object.keys(cData).filter(k => !quizInfo[k]);
if (missingData.length) console.log('data without quiz country:', missingData);

// ---- slim topology & write
topo.objects = { countries: topo.objects.countries };
const bundle = { topo, places, cities };
fs.writeFileSync('build/bundle.json', JSON.stringify(bundle));
console.log('bundle bytes', fs.statSync('build/bundle.json').size);
// dish/fact counts
const noDish = places.filter(p => p.un && (!p.d || !p.d.length)).map(p => p.n);
console.log('UN without dishes:', noDish);
