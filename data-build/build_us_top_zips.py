"""Builds the national Top U.S. ZIPs lists: for every analyzer and line, the 50 highest-scoring ZIPs in the country,
written to <analyzer>/data/us_top_zips.json and shown on analyzers/top-zips.html.

In the analyzers a ZIP's score ranks it within its own market (DMA, metro or county). Here every ranked ZIP is scored
against every other ranked ZIP in the U.S., with the same steps and inputs the engine uses inside a market
(cfg.zipScore in each analyzer's page): each input a percentile among ranked ZIPs, Consumer Demand the average of the
line's demand percentiles, then the Demand and Spending Power weights. The total is scaled so the best U.S. ZIP is 100
and the weakest 0. ZIPs the analyzers don't rank (under 500 residents, mostly group quarters) are left out.

Reads only the published site files (each analyzer's index.html and data/zip/dma/*.json, plus data-build/geo for
states), so it needs no downloads. Run after the analyzer builds and before compact_zip_files.py:

  python3 data-build/build_us_top_zips.py [analyzer folder ...]   # default: every analyzer
"""
import datetime, glob, json, os, sys
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ANALYZERS = ["apartment-analyzer", "auto", "financial", "franchise", "furniture-analyzer", "healthcare", "higher-ed",
             "home-services", "legal", "travel"]
TOP = 50


def log(*a): print(*a, flush=True)


def page_config(folder):
    h = open(os.path.join(ROOT, folder, "index.html"), encoding="utf-8").read()
    i = h.index("AdtaxiAnalyzer.start(") + len("AdtaxiAnalyzer.start(")
    return json.JSONDecoder().raw_decode(h[i:])[0]


def pct(s):
    """Engine pctMap: average rank of ties / n * 100, rounded to 2 decimals, among non-missing values."""
    return (s.rank(method="average", pct=True) * 100).round(2)


def score_lines(df, zs):
    """df: ranked ZIPs (index zip, columns = inputs). Returns {line: (score, demand, spend)} like engine rescoreZips."""
    subs = zs.get("subs") or {k: v for k, v in zs.items() if k not in ("weights", "derived")}
    W = zs.get("weights") or {"demand": 0.4, "spend": 0.15}
    derived = zs.get("derived") or {}
    memo = {}

    def P(k):
        if k in memo: return memo[k]
        d = derived.get(k)
        if d and d[0] == "max":
            a, b = P(d[1]), P(d[2])
            m = pd.concat([a, b], axis=1).max(axis=1)
            memo[k] = pct(m); return memo[k]
        memo[k] = pct(pd.to_numeric(df[k], errors="coerce")) if k in df.columns else pd.Series(np.nan, index=df.index)
        return memo[k]

    out = {}
    for sub, d in subs.items():
        d = {"demand": d, "spend": None} if isinstance(d, list) else d
        ins = [k for k in d["demand"] if k in derived or (k in df.columns and pd.to_numeric(df[k], errors="coerce").notna().any())]
        dem = pd.concat([P(k) for k in ins], axis=1).mean(axis=1) if ins else pd.Series(np.nan, index=df.index)
        sp = P(d["spend"]) if d.get("spend") else None
        if sp is not None:
            sc = (W["demand"] * dem + W["spend"] * sp) / (W["demand"] + W["spend"])
            sc = sc.where(dem.notna() & sp.notna())
        else:
            sc = dem
        out[sub] = (sc, dem, sp)
    return out


def build(folder, geo, built):
    cfg = page_config(folder)
    zs = cfg.get("zipScore")
    if not zs: log(f"{folder}: no zipScore in the page config; skipped"); return None
    dma_names = {r["id"]: r["name"] for r in json.load(open(os.path.join(ROOT, folder, "data", "dma.json")))["rows"]}
    rows = []
    for f in sorted(glob.glob(os.path.join(ROOT, folder, "data", "zip", "dma", "*.json"))):
        code = os.path.basename(f)[:-5]
        for r in json.load(open(f))["rows"]:
            v = dict(r["v"]); v["zip"] = r["id"]; v["name"] = r.get("name", r["id"]); v["dma"] = code; v["u"] = bool(r.get("u"))
            rows.append(v)
    df = pd.DataFrame(rows).drop_duplicates("zip").set_index("zip")
    ok = df[~df.u]
    lines = score_lines(ok, zs)
    labels = {s["id"]: s["label"] for s in cfg["subcategories"]}
    mlabel = {m["key"]: m.get("label", m["key"]) for m in cfg.get("measures", [])}
    subs_cfg = zs.get("subs") or {k: v for k, v in zs.items() if k not in ("weights", "derived")}
    out_lines = []
    for sub in [s["id"] for s in cfg["subcategories"] if s["id"] in lines]:
        sc, dem, sp = lines[sub]
        valid = sc.dropna()
        lo, hi = valid.min(), valid.max()
        nat = ((valid - lo) / (hi - lo) * 100) if hi > lo else valid * 0 + 100
        order = nat.sort_values(ascending=False, kind="mergesort")
        top = order.index[:TOP]
        d = subs_cfg[sub]; d = {"demand": d, "spend": None} if isinstance(d, list) else d
        inputs = [k for k in d["demand"] if k in ok.columns]
        items = []
        for rank, z in enumerate(top, 1):
            r = ok.loc[z]
            g = geo.get(z, {})
            city = str(r["name"])[6:].strip() if str(r["name"]).startswith(z) else str(r["name"])
            items.append({
                "rank": rank, "zip": z, "city": city or g.get("city", ""), "state": g.get("state", ""),
                "dma": r["dma"], "dmaName": dma_names.get(r["dma"], r["dma"]),
                "score": round(float(nat[z]), 1), "demand": None if pd.isna(dem[z]) else round(float(dem[z]), 1),
                "spend": None if sp is None or pd.isna(sp[z]) else round(float(sp[z]), 1),
                "population": None if pd.isna(r.get("population")) else int(r["population"]),
                "households": None if pd.isna(r.get("households")) else int(r["households"]),
                "inputs": {k: (None if pd.isna(r[k]) else (round(float(r[k]), 4) if abs(float(r[k])) < 10 else round(float(r[k]), 1))) for k in inputs}})
        out_lines.append({"id": sub, "label": labels.get(sub, sub), "ranked": int(valid.size),
                          "demandInputs": [{"key": k, "label": mlabel.get(k, k)} for k in d["demand"]],
                          "spendInput": ({"key": d["spend"], "label": mlabel.get(d["spend"], d["spend"])} if d.get("spend") else None),
                          "weights": (zs.get("weights") or {"demand": 0.4, "spend": 0.15}) if d.get("spend") else {"demand": 1.0},
                          "top": items})
    res = {"analyzer": folder, "title": cfg.get("title", folder), "built": built, "zips": int(len(df)), "rankedZips": int(len(ok)),
           "top": TOP, "lines": out_lines}
    p = os.path.join(ROOT, folder, "data", "us_top_zips.json")
    json.dump(res, open(p, "w"), separators=(",", ":"), ensure_ascii=False)
    log(f"{folder}: {len(ok):,} ranked ZIPs of {len(df):,}; {len(out_lines)} lines -> {os.path.relpath(p, ROOT)}")
    return res


def main():
    folders = sys.argv[1:] or ANALYZERS
    g = pd.read_csv(os.path.join(HERE, "geo", "zip_geo.csv"), dtype={"zip": str}, usecols=["zip", "city", "state"])
    geo = {z: {"city": c if isinstance(c, str) else "", "state": s if isinstance(s, str) else ""} for z, c, s in zip(g.zip, g.city, g.state)}
    built = datetime.date.today().isoformat()
    for f in folders:
        if not os.path.exists(os.path.join(ROOT, f, "index.html")): log(f"{f}: no analyzer page; skipped"); continue
        build(f, geo, built)


if __name__ == "__main__":
    main()
