const fs=require('fs');const path=require('path');process.chdir(path.join(__dirname,'..'));const d3=require('d3');const tj=require('topojson-client');const ts=require('topojson-simplify');
const topo=JSON.parse(fs.readFileSync('node_modules/world-atlas/countries-50m.json'));
delete topo.objects.land;
const q=parseFloat(process.argv[2]||'0.6');
const pre=ts.presimplify(topo, ts.sphericalTriangleArea);
// protect small rings: keep all their points
let prot=0;
for(const g of pre.objects.countries.geometries){
  const polys=g.type==='Polygon'?[g.arcs]:g.type==='MultiPolygon'?g.arcs:[];
  for(const poly of polys){
    const f=tj.feature(pre,{type:'Polygon',arcs:poly});
    let a=d3.geoArea(f); if(a>2*Math.PI)a=4*Math.PI-a;
    if(a<1e-5){ for(const ring of poly) for(const ai of ring){ const arc=pre.arcs[ai<0?~ai:ai]; for(const p of arc) p[2]=Infinity; } prot++; }
  }
}
const w=ts.quantile(pre,q);
const s=ts.simplify(pre,w);
// strip z
let out=JSON.parse(JSON.stringify(s));
let pts=0;for(const arc of out.arcs){for(const p of arc){p.length=2}pts+=arc.length}
for(const arc of out.arcs)for(const p of arc)p.length=2; out=tj.quantize(out,1e5); fs.writeFileSync("data/world.json",JSON.stringify(out));
const fc=tj.feature(out,out.objects.countries);
const chk=['AUS','ATA','RUS','FJI','JPN','USA','CAN','NOR','IDN'].map(n=>{const f=fc.features.find(f=>f.properties.name&&0)||fc.features.find(f=>f.id===({AUS:'036',ATA:'010',RUS:'643',FJI:'242',JPN:'392',USA:'840',CAN:'124',NOR:'578',IDN:'360'})[n]);return n+':'+d3.geoArea(f).toFixed(4)});
console.log('protected rings',prot,'points',pts,'bytes',fs.statSync('data/world.json').size, chk.join(' '));
