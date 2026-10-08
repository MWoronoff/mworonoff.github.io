#!/usr/bin/env bash
# Builds the map boundary files for all analyzers from Census cartographic boundary files.
# Needs: data-build/geo/county_geo.csv and zip_geo.csv (from build_geography.py), Node with mapshaper.
# Writes: shared/geo/dma.topo.json, shared/geo/metro.topo.json, shared/geo/states.topo.json
set -euo pipefail
cd "$(dirname "$0")/.."
WORK=data-build/tmp; OUT=shared/geo; mkdir -p "$WORK" "$OUT"
MS="npx --yes mapshaper@0.6"

# Inputs (overridable for local tests)
COUNTY_SHP=${COUNTY_SHP:-}
CBSA_SHP=${CBSA_SHP:-}
ZCTA_SHP=${ZCTA_SHP:-}
ZCTA_FIELD=${ZCTA_FIELD:-ZCTA5CE20}
GEOID_FIELD=${GEOID_FIELD:-GEOID}

fetch () { # url -> unzipped dir
  local url=$1 name; name=$(basename "$url" .zip)
  if [ ! -d "$WORK/$name" ]; then curl -sSfL "$url" -o "$WORK/$name.zip"; unzip -qo "$WORK/$name.zip" -d "$WORK/$name"; fi
  echo "$WORK/$name/$name.shp"
}
[ -z "$COUNTY_SHP" ] && COUNTY_SHP=$(fetch https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_county_5m.zip)
[ -z "$CBSA_SHP" ]   && CBSA_SHP=$(fetch https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_cbsa_5m.zip)
[ -z "$ZCTA_SHP" ]   && ZCTA_SHP=$(fetch https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_zcta520_500k.zip)

# 1. Counties in 50 states + DC, joined to their DMA
$MS "$COUNTY_SHP" -each "fips=String($GEOID_FIELD)" -filter "fips.slice(0,2) < '57' && fips.slice(0,2) != '00'" \
  -join data-build/geo/county_geo.csv keys=fips,county_fips string-fields=county_fips,dma_code,cbsa_code,split_county \
  -o "$WORK/counties_all.json" format=geojson
UNJOINED=$($MS "$WORK/counties_all.json" -filter "dma_code == null" -info 2>&1 | grep -oE "Records: *[0-9]+" | grep -oE "[0-9]+" || echo 0)
echo "County shapes without a DMA: ${UNJOINED:-0} (should be 0 with current Census files)"
$MS "$WORK/counties_all.json" -filter "dma_code != null" -o "$WORK/counties.json" format=geojson

# 2. DMA shapes: whole counties, plus ZCTA-based pieces for counties Nielsen splits
$MS "$WORK/counties.json" -filter "split_county != 'True'" -dissolve dma_code copy-fields=dma_name -o "$WORK/dma_whole.json" format=geojson
$MS "$WORK/counties.json" -filter "split_county == 'True'" -o "$WORK/split_counties.json" format=geojson
$MS "$ZCTA_SHP" -each "zip=String($ZCTA_FIELD)" \
  -join data-build/geo/zip_geo.csv keys=zip,zip string-fields=zip,county_fips,dma_code \
  -filter "dma_code != null" \
  -clip "$WORK/split_counties.json" \
  -dissolve dma_code copy-fields=dma_name -o "$WORK/dma_split_parts.json" format=geojson
# Any part of a split county not covered by a ZCTA (empty desert, water, parks) goes to the DMA of its nearest ZIP
$MS "$WORK/split_counties.json" -erase "$WORK/dma_split_parts.json" -explode -each "cx=this.centroidX, cy=this.centroidY" \
  -o "$WORK/split_frag.json" format=geojson
node data-build/assign_leftovers.js "$WORK/split_frag.json" data-build/geo/zip_geo.csv "$WORK/split_rest.json"
$MS -i "$WORK/dma_whole.json" "$WORK/dma_split_parts.json" "$WORK/split_rest.json" combine-files \
  -merge-layers force -snap -clean -dissolve2 dma_code copy-fields=dma_name \
  -simplify 6% keep-shapes -clean \
  -rename-layers dma -o "$OUT/dma.topo.json" format=topojson quantization=1e5

# 3. Metro shapes (OMB 2023 metropolitan areas in 50 states + DC)
$MS "$CBSA_SHP" -filter "LSAD == 'M1' && !/, PR$/.test(NAME)" -each "cbsa_code=String(CBSAFP)" \
  -simplify 6% keep-shapes -rename-layers metro -o "$OUT/metro.topo.json" format=topojson quantization=1e5

# 4. ZIP (ZCTA) boundaries, one file per DMA and per metro, loaded only when a market is opened
rm -rf "$OUT/zip"; mkdir -p "$OUT/zip/dma" "$OUT/zip/metro"
$MS "$ZCTA_SHP" -each "zip=String($ZCTA_FIELD)" \
  -join data-build/geo/zip_geo.csv keys=zip,zip string-fields=zip,dma_code,cbsa_code \
  -filter "dma_code != null" -filter-fields zip,dma_code,cbsa_code,cbsa_type \
  -simplify 8% keep-shapes -o "$WORK/zcta_joined.json" format=geojson
$MS "$WORK/zcta_joined.json" -filter "dma_code != '0'" -split dma_code \
  -o "$OUT/zip/dma/" format=topojson singles quantization=1e5
$MS "$WORK/zcta_joined.json" -filter "cbsa_type == 'Metro'" -split cbsa_code \
  -o "$OUT/zip/metro/" format=topojson singles quantization=1e5
echo "ZIP boundary files: $(ls "$OUT/zip/dma" | wc -l) DMAs, $(ls "$OUT/zip/metro" | wc -l) metros"

# 5. State outlines for context
$MS "$WORK/counties.json" -each "st=fips.slice(0,2)" -dissolve st -simplify 6% keep-shapes \
  -rename-layers states -o "$OUT/states.topo.json" format=topojson quantization=1e5

# 6. Map join check: every DMA and metro in the tables has a shape
node -e '
const fs=require("fs");
const csv=f=>{const [h,...r]=fs.readFileSync(f,"utf8").trim().split("\n");return r};
const topo=f=>JSON.parse(fs.readFileSync(f)).objects;
const dmaIds=new Set(Object.values(topo("shared/geo/dma.topo.json"))[0].geometries.map(g=>String(g.properties.dma_code)));
const want=csv("data-build/geo/dma_list.csv").map(l=>l.split(",")[0]).filter(c=>c!=="0");
const missing=want.filter(c=>!dmaIds.has(c));
console.log(`DMA shapes: ${dmaIds.size}; DMAs without a shape: ${missing.length ? missing.join(" ") : "none"}`);
if (missing.length) process.exit(1);
'
ls -la "$OUT"
