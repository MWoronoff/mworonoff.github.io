"""Builds the Furniture Market Analyzer data (Market Potential Scores) into furniture-analyzer/data/.

The analyzer shows furniture retailers where their likely buyers are and how to focus ad dollars geographically.

Sources, all public downloads with no key (plus Adtaxi's EASI files in data-build/sources):
  - Census County and ZIP Business Patterns: furniture retailers (NAICS 449110; 442110 before the 2022 NAICS), the
    competitors for every furniture line (Census doesn't split stores by product line)
  - shared/audience/zip_audience*.json: Census ACS households, homeownership, recent movers (owners and renters who moved
    in 2021 or later), households with children, women 25-34, adults 18-34, single-family homes and income by ZIP
  - data-build/sources/easi_furniture_spend_dma.csv / _metro.csv: EASI 2025 household spending on furniture and six
    furniture lines (Category Spending); easi_dma_crosswalk.csv ties EASI's DMA names to DMA codes
Geography comes from data-build/geo (ZIP -> county, metro, DMA). Download helpers are shared with build_healthcare.py.

  python3 data-build/build_furniture.py              # live (GitHub Actions)
  python3 data-build/build_furniture.py --cache DIR  # read saved downloads from DIR (tests)
"""
import argparse, datetime, json, os, re, sys
import numpy as np
import pandas as pd
from build_healthcare import cbp_years, zbp, cbp_county, pct, combine, zcta_land, validate_scores
from county_level import county_frame, county_mask, county_checks, county_flag, county_names, mark_unranked, COUNTY_PARTS

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GEO = os.path.join(HERE, "geo")
OUT = os.path.join(ROOT, "furniture-analyzer", "data")
MIN_POP = 500
NAICS = ["449110", "442110"]                          # furniture retailers (2022 NAICS code, and the code before it)

# Market Potential Score: where a furniture retailer's likely buyers are. Each part is a percentile (0-100).
WEIGHTS = {"demand": 0.40, "category": 0.25, "spend": 0.15, "comp": 0.20}
ZIP_PARTS = ("demand", "spend")      # ZIPs: no EASI spending by ZIP, and ZIP business counts are suppressed under 3
PALM_SPRINGS, RIVERSIDE_METRO = "804", "40140"

# easi: EASI line(s) added together for Category Spending
SUBCATS = [
    {"id": "any", "label": "Any furniture", "easi": ["furniture"],
     "demand": ["movers", "movers_share", "owners", "households"]},
    {"id": "living", "label": "Sofas and living room", "easi": ["sofas", "living_room_chairs", "living_room_tables"],
     "demand": ["movers", "movers_share", "households"]},
    {"id": "bedroom", "label": "Bedroom furniture", "easi": ["bedroom_furniture"],
     "demand": ["movers", "movers_share", "kids_share"]},
    {"id": "mattress", "label": "Mattresses", "easi": ["mattresses_and_springs"],
     "demand": ["households", "movers", "pop18_34"]},
    {"id": "dining", "label": "Kitchen and dining", "easi": ["kitchen_and_dining_room_furniture"],
     "demand": ["owners", "movers", "kids_share"]},
    {"id": "outdoor", "label": "Outdoor and patio", "easi": ["outdoor_furniture"],
     "demand": ["owners", "sfd_own", "sfd_share"]},
    {"id": "baby", "label": "Baby and nursery", "easi": ["infants_furniture"],
     "demand": ["f25_34", "hh_kids", "movers_share"]},
]
EASI_LINES = sorted({e for s in SUBCATS for e in s["easi"]})
DEMAND_LABELS = {"movers": "Households that moved in 2021 or later", "movers_share": "Share of households that moved in 2021 or later",
                 "owners": "Homeowner households", "households": "Households", "kids_share": "Households with children",
                 "pop18_34": "Adults 18-34", "sfd_own": "Owners in single-family detached homes",
                 "sfd_share": "Share of owner homes that are single-family detached", "f25_34": "Women 25-34",
                 "hh_kids": "Households with children (count)"}
COUNTS = ["population", "households", "adults", "owners", "movers", "pop18_34", "f25_34", "hh_kids", "sfd_own"]
# numerator, denominator for each rate (summed over ZIPs, so markets get true rates)
RATE_PARTS = {"movers_share": ("movers", "occ_moved"), "own_share": ("owners", "hh_tot"), "kids_share": ("hh_kids", "hh_tot"),
              "sfd_share": ("sfd_own", "hu_tot"), "inc75_share": ("inc75", "inc_tot"), "inc100_share": ("inc100", "inc_tot")}
RATES = list(RATE_PARTS)
ACS_MAIN = ["adults18", "hh_kids", "hh_tot", "inc_tot", "inc_75_100", "inc_100_150", "inc_150_200", "inc_200p", "own_tot",
            "pop18_34", "f25_34"]
ACS_HOME = ["hm_tot", "o_moved21", "sfd_own", "hu_tot"]
ACS_APT = ["r_mtot", "r_moved21"]


def log(*a): print(*a, flush=True)


def self_test():
    s = pct(pd.Series([10, 20, 30, 40, np.nan]))
    assert list(s[:4]) == [25.0, 50.0, 75.0, 100.0] and np.isnan(s[4]), s
    c = combine([pd.Series([100.0, np.nan]), pd.Series([0.0, 50.0])], [0.40, 0.25])
    assert abs(c[0] - 40 / 0.65) < 1e-9 and c[1] == 50.0, c
    assert abs(sum(WEIGHTS.values()) - 1) < 1e-9, WEIGHTS
    return "percentile and weighted-average hand checks reproduce exactly"


def load_audience(name, cols):
    p = os.path.join(ROOT, "shared", "audience", name)
    d = pd.DataFrame(json.load(open(p))["cols"])
    miss = [c for c in cols if c not in d.columns]
    if miss: sys.exit(f"shared/audience/{name} has no Furniture columns ({miss}); the audience step must run first with the new build_audience.py.")
    return d[["zip"] + cols]


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
    acs = load_audience("zip_audience.json", ACS_MAIN).merge(load_audience("zip_audience_home.json", ACS_HOME), on="zip", how="left") \
        .merge(load_audience("zip_audience_apt.json", ACS_APT), on="zip", how="left")
    acs["inc75"] = acs[["inc_75_100", "inc_100_150", "inc_150_200", "inc_200p"]].sum(axis=1, min_count=4)
    acs["inc100"] = acs[["inc_100_150", "inc_150_200", "inc_200p"]].sum(axis=1, min_count=3)
    acs["movers"] = acs.o_moved21 + acs.r_moved21                      # households that moved in 2021 or later
    acs["occ_moved"] = acs.hm_tot + acs.r_mtot                         # occupied homes in the year-moved-in table
    acs = acs.rename(columns={"own_tot": "owners"})
    z = z.merge(acs.drop(columns=["inc_75_100", "inc_100_150", "inc_150_200", "inc_200p", "o_moved21", "r_moved21", "r_mtot", "hm_tot"]),
                on="zip", how="left")
    z["land"] = z.zip.map(zcta_land(a.cache, rep))          # square miles, for households per square mile

    # Business Patterns: furniture retailers
    y = cbp_years(a.cache)
    rep.append(("Business Patterns years", "INFO", f"{y} (growth measured from {y - 1})"))
    zb, zb0 = zbp(y, a.cache), zbp(y - 1, a.cache)
    co, co0 = cbp_county(y, a.cache), cbp_county(y - 1, a.cache)
    for tag, src in (("", zb), ("_prev", zb0)):
        z[f"zest{tag}"] = z.zip.map(src[src.naics.isin(NAICS)].groupby("zip").est.sum()).fillna(0)
    nat = co[co.naics.isin(NAICS)].est.sum()
    rep.append(("Furniture retailers counted (County Business Patterns)", "PASS" if 15000 <= nat <= 40000 else "FAIL",
                f"{int(nat):,} establishments in {y}; codes found: {sorted(set(co[co.naics.isin(NAICS)].naics))}"))
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
    SUM_COLS = ["population", "households", "adults18", "owners", "movers", "occ_moved", "pop18_34", "f25_34", "hh_kids", "hh_tot",
                "sfd_own", "hu_tot", "inc75", "inc100", "inc_tot"]

    def agg(g):
        r = {c: g[c].sum(min_count=1) for c in SUM_COLS}
        r["adults"] = r.pop("adults18")
        land = g.land.where(g.land > 0).sum()
        r["density"] = g.households.where(g.land > 0, 0).sum() / land if land > 0 else np.nan
        for k, (n, d) in RATE_PARTS.items():
            den = r[d]; r[k] = r[n] / den if den and den > 0 else np.nan
        r["est"], r["prev"] = g.cest.sum(), g.cprev.sum()
        return r

    def frame(groups):
        return pd.DataFrame.from_dict({k: agg(g) for k, g in groups}, orient="index")

    def score(df, parts=tuple(WEIGHTS), mask=None):
        if mask is None: mask = pd.Series(True, index=df.index)
        P = lambda s: pct(s.where(mask))
        df["per10k"] = (df.est / df.households * 1e4).where(df.households > 0)     # stores per 10,000 households
        df["growth"] = ((df.est - df.prev) / df.prev).where(df.prev >= 3)
        spend = P(df.inc75_share)
        comp = P(-df.per10k) if "comp" in parts else pd.Series(np.nan, index=df.index)
        dem_pct = {k: P(df[k]) for k in DEMAND_LABELS if k in df.columns}
        for s in SUBCATS:
            i = s["id"]
            ins = [dem_pct[k] for k in s["demand"] if k in dem_pct and df[k].notna().any()]
            df[f"demand@{i}"] = combine(ins, [1] * len(ins)) if ins else np.nan
            if "category" in parts and f"easi_hh@{i}" in df.columns:
                df[f"category@{i}"] = combine([P(df[f"easi_hh@{i}"]), P(df[f"easi_total@{i}"])], [0.5, 0.5])
            else:
                df[f"category@{i}"] = np.nan
            df[f"spend@{i}"], df[f"comp@{i}"] = spend, comp
            cols = [df[f"{c}@{i}"] for c in parts]
            full = pd.concat(cols, axis=1).notna().all(axis=1)
            df[f"score@{i}"] = combine(cols, [WEIGHTS[c] for c in parts]).where(full & mask).round(1)
            for c in WEIGHTS: df[f"{c}@{i}"] = pd.to_numeric(df[f"{c}@{i}"], errors="coerce").round(1)
            under = (df[f"demand@{i}"] >= 70) & (P(df.per10k) <= 30)
            known = df[f"demand@{i}"].notna() & df.per10k.notna() & mask
            df[f"under@{i}"] = np.where(under & known, "Yes", np.where(known, "No", None))
        return df

    # EASI furniture spending. Totals = per-household spending x this site's households (same boundaries as everything else).
    src = os.path.join(HERE, "sources")
    sd = pd.read_csv(os.path.join(src, "easi_furniture_spend_dma.csv"))
    xw = pd.read_csv(os.path.join(src, "easi_dma_crosswalk.csv"), dtype={"dma_code": str})
    sd = sd.merge(xw[["easi_market", "dma_code"]], left_on="market", right_on="easi_market", how="left")
    if sd.dma_code.isna().any(): sys.exit("easi_dma_crosswalk.csv is missing EASI DMAs: " + ", ".join(sd[sd.dma_code.isna()].market))
    sm = pd.read_csv(os.path.join(src, "easi_furniture_spend_metro.csv"))
    em = pd.read_csv(os.path.join(src, "easi_metro_2025.csv"), dtype={"cbsa_code": str})
    key = lambda t: re.sub(r"[^a-z0-9]", "", str(t).lower())
    sm["cbsa_code"] = sm.market.map(key).map(dict(zip(em.metro.map(key), em.cbsa_code)))
    per = {}                                   # per-household spending by sub-category, at each level
    for lvl, d_, idx in (("dma", sd, "dma_code"), ("metro", sm.dropna(subset=["cbsa_code"]), "cbsa_code")):
        d_ = d_.set_index(idx)
        per[lvl] = pd.DataFrame({s["id"]: sum(d_[f"{e}_per_hh"] for e in s["easi"]) for s in SUBCATS})
    us_hh = {s["id"]: sum(sd[f"{e}_total"].sum() for e in s["easi"]) / sd.households.sum() for s in SUBCATS}
    if PALM_SPRINGS not in per["dma"].index and RIVERSIDE_METRO in per["metro"].index:
        per["dma"].loc[PALM_SPRINGS] = per["metro"].loc[RIVERSIDE_METRO]
        rep.append(("EASI furniture spending: Palm Springs", "INFO", "EASI includes Palm Springs in Los Angeles; the provisional Palm Springs DMA uses the Riverside–San Bernardino metro's per-household spending"))
    rep.append(("EASI U.S. spending per household", "INFO", "; ".join(f"{s['label']} ${us_hh[s['id']]:,.2f}" for s in SUBCATS)))

    def add_easi(df, lvl, label):
        p = per[lvl]
        for s in SUBCATS:
            i = s["id"]
            df[f"easi_hh@{i}"] = df.index.map(p[i]).astype(float)
            df[f"easi_total@{i}"] = df[f"easi_hh@{i}"] * df.households
            df[f"easi_idx@{i}"] = (df[f"easi_hh@{i}"] / us_hh[i] * 100).round(0)
        miss = [str(i) for i in df.index if df.at[i, "easi_hh@any"] != df.at[i, "easi_hh@any"]]
        rep.append((f"EASI furniture spending matched to {label}", "PASS" if not miss else "FAIL",
                    f"{len(df) - len(miss)} of {len(df)}" + (f"; missing {miss[:8]}" if miss else "")))

    zd = z[z.dma_code != "0"]
    dma = frame(zd.groupby("dma_code")); add_easi(dma, "dma", "DMAs"); dma = score(dma)
    zm = z[z.cbsa_code.isin(metros)]
    met = frame(zm.groupby("cbsa_code")); add_easi(met, "metro", "metros"); met = score(met)
    cty = county_frame(z, frame); cty = score(cty, parts=COUNTY_PARTS, mask=county_mask(cty))
    validate_scores(rep, z, co, [(x["id"], x["label"], NAICS) for x in SUBCATS],
                    [("DMAs", dma, "dma_code"), ("metros", met, "cbsa_code")], "furniture retailers")
    us = frame([("us", z)])
    us["est"], us["prev"] = nat, co0[co0.naics.isin(NAICS)].est.sum()
    us["per10k"] = us.est / us.households * 1e4
    us["growth"] = (us.est - us.prev) / us.prev
    for s in SUBCATS:
        i = s["id"]; us[f"easi_hh@{i}"] = us_hh[i]; us[f"easi_total@{i}"] = us_hh[i] * us.households; us[f"easi_idx@{i}"] = 100.0
    r_ = dma["easi_total@any"].sum() / sd.furniture_total.sum()
    rep.append(("EASI furniture total, DMAs vs. EASI's own total", "PASS" if 0.95 <= r_ <= 1.05 else "FAIL", f"{r_:.1%} of EASI's ${sd.furniture_total.sum() / 1e9:,.2f}B"))

    # ---------------- Checks ----------------
    for name, df in (("DMA", dma), ("Metro", met)):
        sc = df[[f"score@{s['id']}" for s in SUBCATS]]
        bad = int(((sc < 0) | (sc > 100)).sum().sum())
        rep.append((f"{name} scores within 0–100", "PASS" if bad == 0 else "FAIL", f"{bad} out of range; {int(sc.notna().sum().sum()):,} scores computed, {int(sc.isna().sum().sum()):,} not computed (missing input)"))
    tot_d = dma.est.sum()
    tot_c = co_in[co_in.naics.isin(NAICS)].est.sum() - z[z.dma_code == "0"].cest.sum()
    rep.append(("DMA roll-up matches county totals: furniture retailers", "PASS" if tot_c > 0 and abs(tot_d - tot_c) / tot_c <= 0.005 else "FAIL",
                f"DMAs {int(round(tot_d)):,} vs counties {int(round(tot_c)):,}"))
    for k, lo, hi in (("movers_share", .15, .40), ("own_share", .58, .72), ("kids_share", .22, .36), ("sfd_share", .74, .90), ("inc75_share", .35, .60)):
        v_ = us[k].iloc[0]
        rep.append((f"U.S. {DEMAND_LABELS.get(k, k).lower()}", "PASS" if lo <= v_ <= hi else "FAIL", f"{v_:.1%} (expected {lo:.0%}–{hi:.0%})"))
    county_checks(rep, cty, [x["id"] for x in SUBCATS])

    failed = [r for r in rep if r[1] == "FAIL"]
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "furniture_report.md"), "w") as f:
        f.write(f"# Furniture data check report\n\nBuilt {built}. Result: **{'FAILED' if failed else 'PASSED'}**\n\n| Check | Result | Detail |\n| --- | --- | --- |\n")
        for r in rep: f.write(f"| {r[0]} | {r[1]} | {r[2]} |\n")
    for r in rep: log(f"[{r[1]}] {r[0]}: {r[2]}")
    if failed: sys.exit("A check failed; the Furniture data was not updated. See furniture-analyzer/data/furniture_report.md.")

    # ---------------- Write ----------------
    keep = COUNTS + RATES + ["density", "est", "per10k", "growth"]
    per_sub = ["score", "demand", "category", "spend", "comp", "under", "easi_hh", "easi_total", "easi_idx"]
    SCORE_KEYS = ("score", "demand", "category", "spend", "comp")
    INTS = COUNTS + ["est"]
    SUB_INTS = ("easi_total", "easi_idx")

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
                        x = clean(r[k]); v[k] = int(round(x)) if (p in SCORE_KEYS or p in SUB_INTS) and x is not None else x
            v = {k: x for k, x in v.items() if x is not None}
            out.append({"id": str(idx), "name": names(idx), "v": v, "f": flags_fn(idx, r) if flags_fn else []})
        return out

    dname = dma_list.set_index("dma_code").dma_name
    tidy = lambda n: re.sub(r"(, )([A-Za-z]{2})\b", lambda m: m.group(1) + m.group(2).upper(), str(n).title())
    mname = met_list.set_index("cbsa_code").cbsa_name

    def flags(idx, r):
        f = []
        if str(idx) == "804": f.append("Palm Springs boundary is provisional: 28 Coachella Valley ZIPs assigned by Adtaxi, pending a Nielsen check. EASI furniture spending uses the Riverside–San Bernardino metro rate.")
        return f

    meta = {"built": built, "cbpYear": y, "acsYears": aud["meta"]["acsYears"]}
    json.dump({"level": "dma", "meta": meta, "rows": rows(dma, lambda i: tidy(dname.get(i, i)), flags)}, open(os.path.join(OUT, "dma.json"), "w"), separators=(",", ":"))
    json.dump({"level": "metro", "meta": meta, "rows": rows(met, lambda i: mname.get(i, i))}, open(os.path.join(OUT, "metro.json"), "w"), separators=(",", ":"))
    cname = county_names()
    json.dump({"level": "county", "meta": meta, "rows": mark_unranked(rows(cty, lambda i: cname.get(str(i), str(i)), lambda i, r: county_flag(r)), cty)},
              open(os.path.join(OUT, "county.json"), "w"), separators=(",", ":"))
    json.dump({"level": "us", "meta": meta, "rows": rows(us, lambda i: "United States")}, open(os.path.join(OUT, "us.json"), "w"), separators=(",", ":"))

    # ZIPs inside each market, ranked within the market
    nfiles = 0
    for level, col, src_ in (("dma", "dma_code", zd), ("metro", "cbsa_code", zm)):
        folder = os.path.join(OUT, "zip", level); os.makedirs(folder, exist_ok=True)
        for code, g in src_.groupby(col):
            df = g.set_index("zip")
            f = pd.DataFrame(index=df.index)
            for c in SUM_COLS: f[c] = df[c]
            f["adults"] = df.adults18
            f["density"] = (df.households / df.land).where(df.land > 0)
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
    log(f"Wrote {len(dma)} DMAs, {len(met)} metros, {len(cty)} counties and {nfiles} ZIP files to {OUT}")


if __name__ == "__main__":
    main()
