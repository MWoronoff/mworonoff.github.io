// Builds each franchise client's map shapes from the shared county and ZIP shapes (no downloads):
//   franchise/<client>/geo/territory.topo.json        one shape per territory (its counties merged)
//   franchise/<client>/geo/zip/territory/<id>.json     the ZIP shapes inside each territory
// Reads franchise/<client>/data/territory_counties.json, written by build_franchise.py.
// Needs topojson-client and topojson-server:  npm i topojson-client@3 topojson-server@3
//   node data-build/build_franchise_geo.js [client]
const fs = require("fs"), path = require("path");
const tc = require("topojson-client"), ts = require("topojson-server");
const ROOT = path.join(__dirname, "..");
const county = JSON.parse(fs.readFileSync(path.join(ROOT, "shared/geo/county.topo.json")));
const cobj = county.objects[Object.keys(county.objects)[0]];
const byFips = {};
cobj.geometries.forEach(g => { byFips[g.properties.fips] = g; });

const only = process.argv[2];
const clients = fs.readdirSync(path.join(ROOT, "franchise")).filter(d =>
  fs.existsSync(path.join(ROOT, "franchise", d, "data", "territory_counties.json")) && (!only || d === only));
for (const client of clients) {
  const tdir = path.join(ROOT, "franchise", client);
  const tc_ = JSON.parse(fs.readFileSync(path.join(tdir, "data", "territory_counties.json")));
  const feats = [], missing = [];
  let zipFiles = 0;
  for (const [id, fipsList] of Object.entries(tc_.counties)) {
    const geoms = fipsList.map(f => byFips[f]).filter(Boolean);
    fipsList.filter(f => !byFips[f]).forEach(f => missing.push(id + ":" + f));
    if (!geoms.length) continue;
    feats.push({ type: "Feature", properties: { territory_id: id, name: tc_.names[id] }, geometry: tc.merge(county, geoms) });
    // ZIPs in the territory: the shared per-county ZIP shapes, each ZIP once
    const zips = {};
    for (const f of fipsList) {
      const p = path.join(ROOT, "shared/geo/zip/county", f + ".json");
      if (!fs.existsSync(p)) continue;
      const t = JSON.parse(fs.readFileSync(p));
      tc.feature(t, t.objects[Object.keys(t.objects)[0]]).features.forEach(z => { if (!zips[z.properties.zip]) zips[z.properties.zip] = z; });
    }
    const zt = ts.topology({ [id]: { type: "FeatureCollection", features: Object.values(zips) } }, 1e5);
    fs.mkdirSync(path.join(tdir, "geo", "zip", "territory"), { recursive: true });
    fs.writeFileSync(path.join(tdir, "geo", "zip", "territory", id + ".json"), JSON.stringify(zt));
    zipFiles++;
  }
  const topo = ts.topology({ territory: { type: "FeatureCollection", features: feats } }, 1e5);
  fs.mkdirSync(path.join(tdir, "geo"), { recursive: true });
  fs.writeFileSync(path.join(tdir, "geo", "territory.topo.json"), JSON.stringify(topo));
  console.log(`${client}: ${feats.length} territory shapes, ${zipFiles} ZIP shape files` + (missing.length ? `; counties without a shape: ${missing.join(", ")}` : ""));
}
