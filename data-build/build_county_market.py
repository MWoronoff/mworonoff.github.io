"""Counties inside each DMA and each metro, for the analyzers' "inside a market" rankings.

Reads data-build/geo/zip_geo.csv (every ZIP's county, metro and DMA, with Adtaxi's DMA overrides already applied) and
writes shared/geo/county_market.json: {"dma": {dma_code: [county FIPS, ...]}, "metro": {cbsa_code: [...]}}.
DMAs are whole counties in Nielsen's definition, but a few counties are split here (Adtaxi's Palm Springs DMA takes the
Coachella Valley out of Riverside County, CA), and ZIPs that cross county lines add small slivers. So a county is listed
in the DMA holding most of its ZIP population, and also in any other DMA holding 15% or more (Riverside County is in both
Los Angeles and Palm Springs; its figures stay whole-county). Metros are defined by whole counties, so each county is
listed only in the metro holding most of its ZIP population.

  python3 data-build/build_county_market.py
"""
import json, os
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def main():
    z = pd.read_csv(os.path.join(HERE, "geo", "zip_geo.csv"), dtype=str)
    z["population"] = pd.to_numeric(z.population, errors="coerce").fillna(0)
    out = {}
    for lv, col, extra in (("dma", "dma_code", 0.15), ("metro", "cbsa_code", None)):
        g = z.dropna(subset=["county_fips", col])
        g = g[(g[col] != "") & (g[col] != "0")]
        g = g.groupby(["county_fips", col]).population.sum().reset_index()
        g["share"] = g.population / g.groupby("county_fips").population.transform("sum").replace(0, 1)
        top = g.sort_values(["county_fips", "population"], ascending=[True, False]).groupby("county_fips").head(1)
        keep = pd.concat([top, g[g.share >= extra]] if extra else [top]).drop_duplicates(["county_fips", col])
        out[lv] = {k: sorted(set(v)) for k, v in keep.groupby(col).county_fips}
    path = os.path.join(ROOT, "shared", "geo", "county_market.json")
    json.dump(out, open(path, "w"), separators=(",", ":"), sort_keys=True)
    print("Wrote", path, "-", len(out["dma"]), "DMAs,", len(out["metro"]), "metros")


if __name__ == "__main__":
    main()
