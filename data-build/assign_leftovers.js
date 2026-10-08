// Gives each uncovered fragment of a split county the DMA of the nearest ZIP in that county.
// Usage: node assign_leftovers.js fragments.geojson zip_geo.csv out.geojson
const fs = require("fs");
const [, , fragFile, zipFile, outFile] = process.argv;
const frag = JSON.parse(fs.readFileSync(fragFile, "utf8"));
const lines = fs.readFileSync(zipFile, "utf8").trim().split("\n");
const hdr = lines[0].split(",");
const col = n => hdr.indexOf(n);
const byCounty = {};
for (const l of lines.slice(1)) {
  // simple CSV split that respects quoted commas
  const f = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map(s => s.replace(/,$/, "").replace(/^"|"$/g, ""));
  const c = f[col("county_fips")], lat = +f[col("lat")], lon = +f[col("lon")];
  if (!isFinite(lat) || !isFinite(lon)) continue;
  (byCounty[c] = byCounty[c] || []).push({ lat, lon, dma: f[col("dma_code")], name: f[col("dma_name")] });
}
let moved = 0;
for (const ft of frag.features) {
  const p = ft.properties, zs = byCounty[p.fips] || [];
  let best = null, bd = Infinity;
  for (const z of zs) {
    const dx = (z.lon - p.cx) * Math.cos((p.cy * Math.PI) / 180), dy = z.lat - p.cy, d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = z; }
  }
  if (best) { if (best.dma !== String(p.dma_code)) moved++; p.dma_code = best.dma; p.dma_name = best.name; }
}
fs.writeFileSync(outFile, JSON.stringify(frag));
console.log(`Leftover fragments: ${frag.features.length}; reassigned to a nearer DMA: ${moved}`);
