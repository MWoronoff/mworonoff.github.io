"""Build shared/geo/county_zips.json for the Custom area option in the radius tools.

For every county: its name (as the Census writes it, e.g. "Cook County", "Orleans Parish", "Richmond city"),
its state, and the ZIPs assigned to it. Each ZIP belongs to one county: the primary county in the
Deluxe ZIP database (data-build/geo/zip_geo.csv, made by build_geography.py).
No API keys needed: inputs are files already in the repo.
"""
import json, os
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
z = pd.read_csv(os.path.join(ROOT, "data-build", "geo", "zip_geo.csv"), dtype={"zip": str, "county_fips": str})
topo = json.load(open(os.path.join(ROOT, "shared", "geo", "county.topo.json")))
geoms = list(topo["objects"].values())[0]["geometries"]
names = {g["properties"]["fips"]: (g["properties"]["NAMELSAD"], g["properties"]["STUSPS"]) for g in geoms}

out = {}
for fips, grp in z.groupby("county_fips"):
    nm = names.get(fips)
    if not nm:
        # A county with no boundary record: fall back to the Deluxe name
        r = grp.iloc[0]
        nm = (str(r.get("county", "")).title() + " County", r.get("state", ""))
    out[fips] = {"n": nm[0], "s": nm[1], "z": sorted(grp.zip.tolist())}

path = os.path.join(ROOT, "shared", "geo", "county_zips.json")
with open(path, "w") as f:
    json.dump({"meta": {"source": "Deluxe ZIP database (primary county per ZIP); county names: U.S. Census Bureau"}, "counties": out}, f, separators=(",", ":"))
print(f"{len(out):,} counties, {sum(len(v['z']) for v in out.values()):,} ZIPs -> {path} ({os.path.getsize(path)/1024:.0f} KB)")
missing = [f for f in out if f not in names]
print("counties without a Census name:", missing[:10], len(missing))
