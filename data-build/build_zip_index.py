"""Builds shared/geo/zip_market.json: each ZIP's county, metro and DMA, so an analyzer's search can jump to a ZIP
inside its own market. Source: data-build/geo/zip_geo.csv (the site's ZIP geography table).
Format: {"zip": [county_fips, metro_cbsa or "", dma_code or ""]}. Metro is filled only for metropolitan areas."""
import json, os
import pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__))
z = pd.read_csv(os.path.join(HERE, "geo", "zip_geo.csv"), dtype=str).fillna("")
out = {}
for r in z.itertuples():
    if len(r.zip) != 5: continue
    out[r.zip] = [r.county_fips if len(r.county_fips) == 5 else "", r.cbsa_code if r.cbsa_type == "Metro" else "", "" if r.dma_code in ("", "0") else r.dma_code]
p = os.path.join(os.path.dirname(HERE), "shared", "geo", "zip_market.json")
json.dump(out, open(p, "w"), separators=(",", ":"))
print(f"Wrote {len(out):,} ZIPs to {p} ({os.path.getsize(p) / 1e6:.1f} MB)")
