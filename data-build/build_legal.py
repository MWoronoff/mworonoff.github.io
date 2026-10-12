"""Builds the Legal Market Analyzer data (Market Potential Scores) into legal/data/.

The analyzer shows law firms where their potential clients are and how to focus ad dollars geographically.

Sources, all public downloads with no key (plus Adtaxi's EASI files in data-build/sources):
  - Census County and ZIP Business Patterns: offices of lawyers (NAICS 541110), the competitors in every practice area
  - shared/audience/zip_audience.json: Census ACS ages, income, marital status, homeownership, home values, poverty,
    employment, commuting and limited-English households by ZIP (built earlier in the same workflow)
  - data-build/sources/easi_legal_spend_dma.csv / _metro.csv: EASI 2025 household spending on legal fees
    (Category Spending); easi_dma_crosswalk.csv ties EASI's DMA names to DMA codes
Geography comes from data-build/geo (ZIP -> county, metro, DMA). Download helpers are shared with build_healthcare.py.

  python3 data-build/build_legal.py              # live (GitHub Actions)
  python3 data-build/build_legal.py --cache DIR  # read saved downloads from DIR (tests)
"""
import argparse, datetime, json, os, re, sys
import numpy as np
import pandas as pd
from build_healthcare import cbp_years, zbp, cbp_county, pct, combine, zcta_land

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GEO = os.path.join(HERE, "geo")
OUT = os.path.join(ROOT, "legal", "data")
MIN_POP = 500
NAICS = ["541110"]                                   # offices of lawyers (Census doesn't split by practice area)

# Market Potential Score: where a law firm's potential clients are. Each part is a percentile (0-100).
WEIGHTS = {"demand": 0.40, "category": 0.25, "spend": 0.15, "comp": 0.20}
ZIP_PARTS = ("demand", "spend")      # ZIPs: no EASI spending by ZIP, and ZIP business counts are suppressed under 3
PALM_SPRINGS, RIVERSIDE_METRO = "804", "40140"

SUBCATS = [
    {"id": "pi", "label": "Personal injury", "demand": ["adults", "car_commute", "car_share"]},
    {"id": "family", "label": "Family law and divorce", "demand": ["divsep", "divsep_share", "kids_share"]},
    {"id": "estate", "label": "Estate planning and elder law", "demand": ["own55", "a65p", "val300_share"]},
    {"id": "bankruptcy", "label": "Bankruptcy and debt relief", "demand": ["households", "pov_share", "inc_lt35_share", "unemp_rate"]},
    {"id": "employment", "label": "Employment law", "demand": ["employed", "unemp_rate"]},
]
DEMAND_LABELS = {"adults": "Adults 18+", "car_commute": "Workers commuting by car", "car_share": "Share of workers commuting by car",
                 "divsep": "Divorced or separated adults", "divsep_share": "Share divorced or separated", "kids_share": "Households with children",
                 "own55": "Homeowners 55+", "a65p": "Age 65+", "val300_share": "Homes worth $300K+",
                 "households": "Households", "pov_share": "Households below poverty", "inc_lt35_share": "Households under $35K",
                 "unemp_rate": "Unemployment rate", "employed": "Employed workers"}
COUNTS = ["population", "households", "adults", "a65p", "divsep", "own55", "employed", "car_commute"]
RATES = ["kids_share", "inc75_share", "inc_lt35_share", "divsep_share", "val300_share", "pov_share", "unemp_rate", "car_share", "lep_share"]
# numerator, denominator for each rate (summed over ZIPs, so markets get true rates)
RATE_PARTS = {"kids_share": ("hh_kids", "hh_tot"), "inc75_share": ("inc75", "inc_tot"), "inc_lt35_share": ("inc_lt35", "inc_tot"),
              "divsep_share": ("divsep", "marital_tot"), "val300_share": ("val300", "val_tot"), "pov_share": ("pov_hh", "pov_tot"),
              "unemp_rate": ("unemployed", "labor_civ"), "car_share": ("car_commute", "workers"), "lep_share": ("lep_hh", "lang_hh")}
ACS_COLS = ["acs_pop", "adults18", "a65p", "hh_kids", "hh_tot", "inc_tot", "inc_lt35", "inc_75_100", "inc_100_150", "inc_150_200",
            "inc_200p", "marital_tot", "divsep", "own_tot", "own55", "pov_hh", "pov_tot", "labor_civ", "employed", "unemployed",
            "workers", "car_commute", "val_tot", "val300", "lang_hh", "lep_hh"]


def log(*a): print(*a, flush=True)


def self_test():
    s = pct(pd.Series([10, 20, 30, 40, np.nan]))
    assert list(s[:4]) == [25.0, 50.0, 75.0, 100.0] and np.isnan(s[4]), s
    c = combine([pd.Series([100.0, np.nan]), pd.Series([0.0, 50.0])], [0.40, 0.25])
    assert abs(c[0] - 40 / 0.65) < 1e-9 and c[1] == 50.0, c
    assert abs(sum(WEIGHTS.values()) - 1) < 1e-9, WEIGHTS
    return "percentile and weighted-average hand checks reproduce exactly"


def main():
    ap_ = argparse.ArgumentParser(); ap_.add_argument("--cache"); a = ap_.parse_args()
    rep = [("Formula tests", "PASS", self_test())]
    built = datetime.date.today().isoformat()

    # Geography
    z = pd.read_csv(os.path.join(GEO, "zip_geo.csv"), dtype={"zip": str, "county_fips": str, "cbsa_code": str, "dma_code": str})
    z["cbsa_code"] = z.cbsa_code.fillna(""); z["dma_code"] = z.dma_code.fillna("0")
    met_list = pd.read_csv(os.path.join(GEO, "metro_list.csv"), dtype={"cbsa_code": str})
    metros = set(met_list[met_list.cbsa_type == "Metro"].cbsa_code)
    dma_list = pd.read_csv(os.path.join(GEO, "dma_list.csv"), dtype={"dma_code": str})
    dma_list = dma_list[dma_list.dma_code != "0"]

    # ACS by ZIP
    aud = json.load(open(os.path.join(ROOT, "shared", "audience", "zip_audience.json")))
    acs = pd.DataFrame(aud["cols"])
    miss = [c for c in ACS_COLS if c not in acs.columns]
    if miss: sys.exit(f"shared/audience/zip_audience.json has no Legal columns ({miss[:4]}...); the audience step must run first with the new build_audience.py.")
    acs = acs[["zip"] + ACS_COLS]
    acs["inc75"] = acs[["inc_75_100", "inc_100_150", "inc_150_200", "inc_200p"]].sum(axis=1, min_count=4)
    z = z.merge(acs.drop(columns=["inc_75_100", "inc_100_150", "inc_150_200", "inc_200p"]), on="zip", how="left")
    z["land"] = z.zip.map(zcta_land(a.cache, rep))          # square miles, for households per square mile

    # Business Patterns: offices of lawyers
    y = cbp_years(a.cache)
    rep.append(("Business Patterns years", "INFO", f"{y} (growth measured from {y - 1})"))
    zb, zb0 = zbp(y, a.cache), zbp(y - 1, a.cache)
    co, co0 = cbp_county(y, a.cache), cbp_county(y - 1, a.cache)
    for tag, src in (("", zb), ("_prev", zb0)):
        z[f"zest{tag}"] = z.zip.map(src[src.naics.isin(NAICS)].groupby("zip").est.sum()).fillna(0)
    nat = co[co.naics.isin(NAICS)].est.sum()
    rep.append(("Published benchmark: offices of lawyers", "PASS" if 140000 <= nat <= 230000 else "FAIL", f"{int(nat):,} (expected 140,000–230,000)"))
    zt = z.zest.sum()
    rep.append(("ZIP detail coverage of county counts (cells under 3 businesses aren't published)", "INFO", f"{zt / nat:.0%}" if nat else "n/a"))
    # County counts spread to ZIPs by population share, so DMAs (which split some counties) sum correctly
    cpop = z.groupby("county_fips").population.transform("sum")
    z["cshare"] = (z.population / cpop).where(cpop > 0, 0)
    cs = co[co.naics.isin(NAICS)].groupby("county_fips").est.sum()
    c0 = co0[co0.naics.isin(NAICS)].groupby("county_fips").est.sum()
    z["cest"] = z.county_fips.map(cs).fillna(0) * z.cshare
    z["cprev"] = z.county_fips.map(c0).fillna(0) * z.cshare
    co_in = co[co.county_fips.isin(set(z.county_fips))]

    # ---------------- Aggregate ----------------
    def agg(g):
        r = {"population": g.population.sum(), "households": g.households.sum(), "adults": g.adults18.sum(min_count=1)}
        land = g.land.where(g.land > 0).sum()
        r["density"] = g.households.where(g.land > 0, 0).sum() / land if land > 0 else np.nan
        for c in ("a65p", "divsep", "own55", "employed", "car_commute"): r[c] = g[c].sum(min_count=1)
        for k, (n, d) in RATE_PARTS.items():
            den = g[d].sum(); r[k] = g[n].sum() / den if den > 0 else np.nan
        r["est"], r["prev"] = g.cest.sum(), g.cprev.sum()
        return r

    def frame(groups):
        return pd.DataFrame.from_dict({k: agg(g) for k, g in groups}, orient="index")

    def score(df, parts=tuple(WEIGHTS), mask=None):
        if mask is None: mask = pd.Series(True, index=df.index)
        P = lambda s: pct(s.where(mask))
        df["per10k"] = (df.est / df.population * 1e4).where(df.population > 0)
        df["growth"] = ((df.est - df.prev) / df.prev).where(df.prev >= 3)
        spend = P(df.inc75_share)
        comp = P(-df.per10k) if "comp" in parts else pd.Series(np.nan, index=df.index)
        cat = combine([P(df.easi_hh), P(df.easi_total)], [0.5, 0.5]) if "category" in parts and "easi_hh" in df.columns else pd.Series(np.nan, index=df.index)
        dem_pct = {k: P(df[k]) for k in DEMAND_LABELS if k in df.columns}
        for s in SUBCATS:
            i = s["id"]
            ins = [dem_pct[k] for k in s["demand"] if k in dem_pct and df[k].notna().any()]
            df[f"demand@{i}"] = combine(ins, [1] * len(ins)) if ins else np.nan
            df[f"category@{i}"], df[f"spend@{i}"], df[f"comp@{i}"] = cat, spend, comp
            cols = [df[f"{c}@{i}"] for c in parts]
            full = pd.concat(cols, axis=1).notna().all(axis=1)
            df[f"score@{i}"] = combine(cols, [WEIGHTS[c] for c in parts]).where(full & mask).round(1)
            for c in WEIGHTS: df[f"{c}@{i}"] = df[f"{c}@{i}"].round(1)
            under = (df[f"demand@{i}"] >= 70) & (P(df.per10k) <= 30)
            known = df[f"demand@{i}"].notna() & df.per10k.notna() & mask
            df[f"under@{i}"] = np.where(under & known, "Yes", np.where(known, "No", None))
        return df

    # EASI legal fees. Totals = per-household spending x this site's households (same boundaries as everything else).
    src = os.path.join(HERE, "sources")
    sd = pd.read_csv(os.path.join(src, "easi_legal_spend_dma.csv"))
    xw = pd.read_csv(os.path.join(src, "easi_dma_crosswalk.csv"), dtype={"dma_code": str})
    sd = sd.merge(xw[["easi_market", "dma_code"]], left_on="market", right_on="easi_market", how="left")
    if sd.dma_code.isna().any(): sys.exit("easi_dma_crosswalk.csv is missing EASI DMAs: " + ", ".join(sd[sd.dma_code.isna()].market))
    us_hh = sd.legal_fees_total.sum() / sd.households.sum()
    sm = pd.read_csv(os.path.join(src, "easi_legal_spend_metro.csv"))
    em = pd.read_csv(os.path.join(src, "easi_metro_2025.csv"), dtype={"cbsa_code": str})
    key = lambda t: re.sub(r"[^a-z0-9]", "", str(t).lower())
    sm["cbsa_code"] = sm.market.map(key).map(dict(zip(em.metro.map(key), em.cbsa_code)))
    hh_dma = sd.set_index("dma_code").legal_fees_per_hh
    hh_met = sm.dropna(subset=["cbsa_code"]).set_index("cbsa_code").legal_fees_per_hh
    if PALM_SPRINGS not in hh_dma.index and RIVERSIDE_METRO in hh_met.index:
        hh_dma.loc[PALM_SPRINGS] = hh_met.loc[RIVERSIDE_METRO]
        rep.append(("EASI legal fees: Palm Springs", "INFO", "EASI includes Palm Springs in Los Angeles; the provisional Palm Springs DMA uses the Riverside–San Bernardino metro's per-household spending"))
    rep.append(("EASI U.S. legal fees per household", "INFO", f"${us_hh:,.2f}"))

    def add_easi(df, per_hh, label):
        df["easi_hh"] = df.index.map(per_hh).astype(float)
        df["easi_total"] = df.easi_hh * df.households
        df["easi_idx"] = (df.easi_hh / us_hh * 100).round(0)
        miss = [str(i) for i in df.index if df.at[i, "easi_hh"] != df.at[i, "easi_hh"]]
        rep.append((f"EASI legal fees matched to {label}", "PASS" if not miss else "FAIL", f"{len(df) - len(miss)} of {len(df)}" + (f"; missing {miss[:8]}" if miss else "")))

    zd = z[z.dma_code != "0"]
    dma = frame(zd.groupby("dma_code")); add_easi(dma, hh_dma, "DMAs"); dma = score(dma)
    zm = z[z.cbsa_code.isin(metros)]
    met = frame(zm.groupby("cbsa_code")); add_easi(met, hh_met, "metros"); met = score(met)
    us = frame([("us", z)])
    us["est"], us["prev"] = nat, co0[co0.naics.isin(NAICS)].est.sum()
    us["per10k"] = us.est / us.population * 1e4
    us["growth"] = (us.est - us.prev) / us.prev
    us["easi_hh"], us["easi_total"], us["easi_idx"] = us_hh, us_hh * us.households, 100.0
    r_ = dma.easi_total.sum() / sd.legal_fees_total.sum()
    rep.append(("EASI legal fees total, DMAs vs. EASI's own total", "PASS" if 0.95 <= r_ <= 1.05 else "FAIL", f"{r_:.1%} of EASI's ${sd.legal_fees_total.sum() / 1e9:,.2f}B"))

    # ---------------- Checks ----------------
    for name, df in (("DMA", dma), ("Metro", met)):
        sc = df[[f"score@{s['id']}" for s in SUBCATS]]
        bad = int(((sc < 0) | (sc > 100)).sum().sum())
        rep.append((f"{name} scores within 0–100", "PASS" if bad == 0 else "FAIL", f"{bad} out of range; {int(sc.notna().sum().sum()):,} scores computed, {int(sc.isna().sum().sum()):,} not computed (missing input)"))
    tot_d = dma.est.sum()
    tot_c = co_in[co_in.naics.isin(NAICS)].est.sum() - z[z.dma_code == "0"].cest.sum()
    rep.append(("DMA roll-up matches county totals: offices of lawyers", "PASS" if tot_c > 0 and abs(tot_d - tot_c) / tot_c <= 0.005 else "FAIL",
                f"DMAs {int(round(tot_d)):,} vs counties {int(round(tot_c)):,}"))
    for k, lo, hi in (("divsep_share", .09, .16), ("unemp_rate", .03, .08), ("car_share", .65, .90), ("pov_share", .09, .16)):
        v_ = us[k].iloc[0]
        rep.append((f"U.S. {DEMAND_LABELS.get(k, k).lower()}", "PASS" if lo <= v_ <= hi else "FAIL", f"{v_:.1%} (expected {lo:.0%}–{hi:.0%})"))

    failed = [r for r in rep if r[1] == "FAIL"]
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "legal_report.md"), "w") as f:
        f.write(f"# Legal data check report\n\nBuilt {built}. Result: **{'FAILED' if failed else 'PASSED'}**\n\n| Check | Result | Detail |\n| --- | --- | --- |\n")
        for r in rep: f.write(f"| {r[0]} | {r[1]} | {r[2]} |\n")
    for r in rep: log(f"[{r[1]}] {r[0]}: {r[2]}")
    if failed: sys.exit("A check failed; the Legal data was not updated. See legal/data/legal_report.md.")

    # ---------------- Write ----------------
    keep = COUNTS + RATES + ["density", "est", "per10k", "growth", "easi_hh", "easi_total", "easi_idx"]
    per_sub = ["score", "demand", "category", "spend", "comp", "under"]
    SCORE_KEYS = ("score", "demand", "category", "spend", "comp")
    INTS = COUNTS + ["est", "easi_total"]

    def clean(v):
        if v is None: return None
        if isinstance(v, str): return v
        if isinstance(v, (float, np.floating)):
            if not np.isfinite(v): return None
            v = float(v)
            return round(v, 3) if abs(v) < 1 else round(v, 2) if abs(v) < 100 else round(v)
        if isinstance(v, np.integer): return int(v)
        return v

    def rows(df, names, flags_fn=None):
        out = []
        for idx, r in df.iterrows():
            v = {}
            for c in keep:
                if c in df.columns:
                    x = clean(r[c]); v[c] = int(round(x)) if c in INTS and x is not None else x
            for s in SUBCATS:
                for p in per_sub:
                    k = f"{p}@{s['id']}"
                    if k in df.columns:
                        x = clean(r[k]); v[k] = int(round(x)) if p in SCORE_KEYS and x is not None else x
            v = {k: x for k, x in v.items() if x is not None}
            out.append({"id": str(idx), "name": names(idx), "v": v, "f": flags_fn(idx, r) if flags_fn else []})
        return out

    dname = dma_list.set_index("dma_code").dma_name
    tidy = lambda n: re.sub(r"(, )([A-Za-z]{2})\b", lambda m: m.group(1) + m.group(2).upper(), str(n).title())
    mname = met_list.set_index("cbsa_code").cbsa_name

    def flags(idx, r):
        f = []
        if str(idx) == "804": f.append("Palm Springs boundary is provisional: 28 Coachella Valley ZIPs assigned by Adtaxi, pending a Nielsen check. EASI legal fees use the Riverside–San Bernardino metro rate.")
        return f

    meta = {"built": built, "cbpYear": y, "acsYears": aud["meta"]["acsYears"]}
    json.dump({"level": "dma", "meta": meta, "rows": rows(dma, lambda i: tidy(dname.get(i, i)), flags)}, open(os.path.join(OUT, "dma.json"), "w"), separators=(",", ":"))
    json.dump({"level": "metro", "meta": meta, "rows": rows(met, lambda i: mname.get(i, i))}, open(os.path.join(OUT, "metro.json"), "w"), separators=(",", ":"))
    json.dump({"level": "us", "meta": meta, "rows": rows(us, lambda i: "United States")}, open(os.path.join(OUT, "us.json"), "w"), separators=(",", ":"))

    # ZIPs inside each market, ranked within the market
    nfiles = 0
    for level, col, src_ in (("dma", "dma_code", zd), ("metro", "cbsa_code", zm)):
        folder = os.path.join(OUT, "zip", level); os.makedirs(folder, exist_ok=True)
        for code, g in src_.groupby(col):
            df = g.set_index("zip")
            f = pd.DataFrame(index=df.index)
            f["population"], f["households"], f["adults"] = df.population, df.households, df.adults18
            f["density"] = (df.households / df.land).where(df.land > 0)
            for c in ("a65p", "divsep", "own55", "employed", "car_commute"): f[c] = df[c]
            for k, (n, d) in RATE_PARTS.items(): f[k] = (df[n] / df[d]).where(df[d] > 0)
            f["est"], f["prev"] = df.zest, df.zest_prev
            ok = f.population >= MIN_POP
            f = score(f, parts=ZIP_PARTS, mask=ok)
            city = df.city.fillna("")
            out = rows(f, lambda i: f"{i} {city.get(i, '')}".strip())
            for row in out:
                if f.loc[row["id"], "population"] < MIN_POP:
                    row["u"] = 1; row["f"].append(f"Fewer than {MIN_POP} residents, so this ZIP isn't ranked.")
                for s in SUBCATS: row["v"].pop(f"category@{s['id']}", None); row["v"].pop(f"comp@{s['id']}", None)
            json.dump({"level": "zip", "parent": {"level": level, "id": code}, "rows": out},
                      open(os.path.join(folder, f"{code}.json"), "w"), separators=(",", ":"))
            nfiles += 1
    log(f"Wrote {len(dma)} DMAs, {len(met)} metros and {nfiles} ZIP files to {OUT}")


if __name__ == "__main__":
    main()
