"""Builds the engine test page data from the step 2 geography tables.
The 'test score' is the percentile rank of households (or ZIP count), so the page can be checked with real
geography before any Healthcare or Legal data exists. It is not a Prospect Score."""
import json, os, datetime, re
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
GEO = os.path.join(HERE, "geo")
OUT = os.path.join(HERE, "..", "engine-test", "data")
os.makedirs(OUT, exist_ok=True)
built = datetime.date.today().isoformat()

def pct(s):  # percentile 0-100 within level, higher value = higher percentile
    return (s.rank(pct=True, method="average") * 100).round(1)

def rows_for(df, idcol, namecol, extra=None, title=True):
    df = df.copy()
    df["hh_size"] = (df.population / df.households).where(df.households > 0)
    df["p_hh"], df["p_pop"], df["p_zips"] = pct(df.households), pct(df.population), pct(df.zips)
    out = []
    for r in df.itertuples():
        v = {"score@size": r.p_hh, "score@zips": r.p_zips, "p_hh": r.p_hh, "p_pop": r.p_pop, "p_zips": r.p_zips,
             "population": int(r.population), "households": int(r.households), "hh_size": round(r.hh_size, 2) if r.hh_size == r.hh_size else None,
             "zips": int(r.zips)}
        if extra: v.update(extra(r))
        f = []
        if str(getattr(r, idcol)) == "804":
            f.append("Palm Springs boundary is provisional: 28 Coachella Valley ZIPs assigned by Adtaxi, pending a Nielsen check.")
        out.append({"id": str(getattr(r, idcol)), "name": re.sub(r"(, )([A-Za-z]{2})\b", lambda m: m.group(1) + m.group(2).upper(), str(getattr(r, namecol)).title()) if title else str(getattr(r, namecol)), "v": v, "f": f})
    return out

dma = pd.read_csv(os.path.join(GEO, "dma_list.csv"), dtype={"dma_code": str})
dma = dma[dma.dma_code != "0"]
json.dump({"level": "dma", "built": built, "rows": rows_for(dma, "dma_code", "dma_name", lambda r: {"counties": int(r.counties)})},
          open(os.path.join(OUT, "dma.json"), "w"), separators=(",", ":"))

met = pd.read_csv(os.path.join(GEO, "metro_list.csv"), dtype={"cbsa_code": str})
met = met[met.cbsa_type == "Metro"]
json.dump({"level": "metro", "built": built, "rows": rows_for(met, "cbsa_code", "cbsa_name", title=False)},
          open(os.path.join(OUT, "metro.json"), "w"), separators=(",", ":"))

z = pd.read_csv(os.path.join(GEO, "zip_geo.csv"), dtype={"zip": str, "dma_code": str, "cbsa_code": str})
us = {"id": "us", "name": "United States", "f": [], "v": {
    "population": int(z.population.sum()), "households": int(z.households.sum()),
    "hh_size": round(z.population.sum() / z.households.sum(), 2), "zips": int(len(z)), "counties": int(z.county_fips.nunique())}}
json.dump({"level": "us", "built": built, "rows": [us]}, open(os.path.join(OUT, "us.json"), "w"), separators=(",", ":"))
print("dma", len(dma), "metro", len(met))

# ---- ZIP drill-down test data: one file per DMA and per metro, ZIPs ranked within their market ----
MIN_POP = 500
for level, col, keep in (("dma", "dma_code", lambda d: d.dma_code != "0"), ("metro", "cbsa_code", lambda d: d.cbsa_type == "Metro")):
    zz = z[keep(z)].copy()
    zz[col] = zz[col].astype(str)
    folder = os.path.join(OUT, "zip", level)
    os.makedirs(folder, exist_ok=True)
    for code, g in zz.groupby(col):
        g = g.copy()
        g["hh_size"] = (g.population / g.households).where(g.households > 0)
        ok = g.population >= MIN_POP
        g["p_hh"] = None; g["p_pop"] = None
        g.loc[ok, "p_hh"] = pct(g.loc[ok, "households"]); g.loc[ok, "p_pop"] = pct(g.loc[ok, "population"])
        rows = []
        for r in g.itertuples():
            v = {"population": int(r.population), "households": int(r.households),
                 "hh_size": round(r.hh_size, 2) if r.hh_size == r.hh_size else None,
                 "p_hh": r.p_hh, "p_pop": r.p_pop, "score@size": r.p_hh, "score@zips": r.p_hh}
            row = {"id": r.zip, "name": f"{r.zip} {r.city}".strip(), "v": v, "f": []}
            if r.population < MIN_POP:
                row["u"] = 1
                row["f"].append(f"Fewer than {MIN_POP} residents, so this ZIP isn't ranked.")
            rows.append(row)
        json.dump({"level": "zip", "parent": {"level": level, "id": code}, "built": built, "rows": rows},
                  open(os.path.join(folder, f"{code}.json"), "w"), separators=(",", ":"))
print("zip files", len(os.listdir(os.path.join(OUT, "zip", "dma"))), len(os.listdir(os.path.join(OUT, "zip", "metro"))))
