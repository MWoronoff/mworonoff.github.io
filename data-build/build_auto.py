"""Builds the Auto Market Analyzer data (Market Potential Scores) into auto/data/, plus the radius tool's vehicle
columns in shared/audience/zip_audience_auto.json.

The analyzer shows auto dealers where their best prospects are and how to focus ad dollars geographically, for four
lines: new cars, new trucks and SUVs, used cars, and used trucks and SUVs.

Sources (public with no key, already in the repo, plus Adtaxi's EASI files in data-build/sources):
  - data-build/master/zip_acs.csv.gz: Census ACS 5-year vehicles available by tenure (B25044)
  - data-build/master/zip_ruca.csv.gz: USDA rural-urban commuting area codes (rural and small-town ZIPs)
  - shared/audience/zip_audience*.json: Census ACS ages, incomes, children, homeownership and car commuting
  - Census County and ZIP Business Patterns (downloaded): new car dealers (441110), used car dealers (441120)
  - data-build/sources/easi_auto_spend_dma.csv / _metro.csv: EASI 2025 household spending on new cars, new trucks,
    used cars and used trucks
Geography comes from data-build/geo (ZIP -> county, metro, DMA).

  python3 data-build/build_auto.py              # live (GitHub Actions)
  python3 data-build/build_auto.py --cache DIR  # read saved downloads from DIR (tests)
"""
import argparse, datetime, json, os, re, sys
import numpy as np
import pandas as pd
from build_healthcare import cbp_years, zbp, cbp_county, pct, combine, zcta_land, validate_scores, nat_or
from county_level import county_frame, county_mask, county_checks, county_flag, county_names, mark_unranked, COUNTY_PARTS

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GEO = os.path.join(HERE, "geo")
MASTER = os.path.join(HERE, "master")
OUT = os.path.join(ROOT, "auto", "data")
AUD = os.path.join(ROOT, "shared", "audience")
MIN_POP = 500

# Market Potential Score. Each part is a percentile (0-100).
WEIGHTS = {"demand": 0.40, "category": 0.25, "spend": 0.15, "comp": 0.20}
EASI = {"newcar": ("new_cars", "New cars"), "newtruck": ("new_trucks", "New trucks"),
        "usedcar": ("used_cars", "Used cars"), "usedtruck": ("used_trucks", "Used trucks")}
PALM_SPRINGS, RIVERSIDE_METRO = "804", "40140"
NAICS = {"new": ["441110"], "used": ["441120"]}
SUBCATS = [
    {"id": "newcar", "label": "New cars", "naics": "new", "demand": ["vehicles", "inc100_share", "car_share"]},
    {"id": "newtruck", "label": "New trucks and SUVs", "naics": "new", "demand": ["vehicles", "veh3p_share", "rural_share", "kids_share"]},
    {"id": "usedcar", "label": "Used cars", "naics": "used", "spend": False, "demand": ["vehicles", "inc35_100_share", "car_share"]},
    {"id": "usedtruck", "label": "Used trucks and SUVs", "naics": "used", "spend": False, "demand": ["vehicles", "veh3p_share", "rural_share", "inc35_100_share"]},
]
DEMAND_LABELS = {"vehicles": "Household vehicles", "inc100_share": "Households earning $100K+", "car_share": "Share of workers commuting by car",
                 "veh3p_share": "Households with 3+ vehicles", "rural_share": "Share of residents in small-town and rural ZIPs",
                 "kids_share": "Households with children", "inc35_100_share": "Households earning $35K–$99K"}
COUNTS = ["population", "households", "adults", "vehicles", "veh_hh", "veh3p", "car_commute"]
RATE_PARTS = {"inc100_share": ("inc100", "inc_tot"), "inc35_100_share": ("inc35_100", "inc_tot"), "inc75_share": ("inc75", "inc_tot"),
              "car_share": ("car_commute", "workers"), "veh3p_share": ("veh3p", "veh_tot"), "noveh_share": ("veh0", "veh_tot"),
              "rural_share": ("rural_pop", "acs_pop"), "kids_share": ("hh_kids", "hh_tot"), "own_share": ("veh_own", "veh_tot")}
PER = {"veh_per_hh": ("vehicles", "veh_tot")}
RATES = list(RATE_PARTS) + list(PER)
SUMS = ["population", "households", "adults18", "acs_pop", "vehicles", "veh_hh", "veh0", "veh3p", "veh_tot", "veh_own", "car_commute",
        "workers", "inc100", "inc35_100", "inc75", "inc_tot", "rural_pop", "hh_kids", "hh_tot"]


def log(*a): print(*a, flush=True)


def self_test():
    s = pct(pd.Series([10, 20, 30, 40, np.nan]))
    assert list(s[:4]) == [25.0, 50.0, 75.0, 100.0] and np.isnan(s[4]), s
    c = combine([pd.Series([100.0, np.nan]), pd.Series([0.0, 50.0])], [0.40, 0.20])
    assert abs(c[0] - 40 / 0.60) < 1e-9 and c[1] == 50.0, c
    assert abs(sum(WEIGHTS.values()) - 1) < 1e-9
    return "percentile and weighted-average hand checks reproduce exactly"


def load_inputs(rep):
    z = pd.read_csv(os.path.join(GEO, "zip_geo.csv"), dtype={"zip": str, "county_fips": str, "cbsa_code": str, "dma_code": str})
    z["cbsa_code"] = z.cbsa_code.fillna(""); z["dma_code"] = z.dma_code.fillna("0")
    aud = json.load(open(os.path.join(AUD, "zip_audience.json")))
    a = pd.DataFrame(aud["cols"])
    need = ["acs_pop", "adults18", "inc_tot", "inc_35_50", "inc_50_75", "inc_75_100", "inc_100_150", "inc_150_200", "inc_200p",
            "car_commute", "workers", "hh_kids", "hh_tot"]
    miss = [c for c in need if c not in a.columns]
    if miss: sys.exit(f"shared/audience/zip_audience.json lacks {miss}; the audience step must run first.")
    a["inc100"] = a[["inc_100_150", "inc_150_200", "inc_200p"]].sum(axis=1, min_count=3)
    a["inc75"] = a[["inc_75_100", "inc100"]].sum(axis=1, min_count=2)
    a["inc35_100"] = a[["inc_35_50", "inc_50_75", "inc_75_100"]].sum(axis=1, min_count=3)
    z = z.merge(a[["zip", "acs_pop", "adults18", "inc100", "inc75", "inc35_100", "inc_tot", "car_commute", "workers", "hh_kids", "hh_tot"]], on="zip", how="left")
    v = pd.read_csv(os.path.join(MASTER, "zip_acs.csv.gz"), dtype={"zip": str}, usecols=["zip"] + [f"B25044_E{n:03d}" for n in range(1, 16)])
    m = pd.DataFrame({"zip": v.zip})
    for k, (o, r) in {"0": (3, 10), "1": (4, 11), "2": (5, 12), "3": (6, 13), "4": (7, 14), "5": (8, 15)}.items():
        m[f"v{k}"] = v[f"B25044_E{o:03d}"] + v[f"B25044_E{r:03d}"]
    m["veh_tot"] = v.B25044_E001
    m["veh_own"] = v.B25044_E002
    m["veh0"] = m.v0
    m["veh_hh"] = m.veh_tot - m.v0
    m["veh3p"] = m.v3 + m.v4 + m.v5
    m["vehicles"] = m.v1 + 2 * m.v2 + 3 * m.v3 + 4 * m.v4 + 5.5 * m.v5      # 5 or more counted as 5.5
    z = z.merge(m.drop(columns=[f"v{k}" for k in "012345"]).assign(v1=m.v1, v2=m.v2), on="zip", how="left")
    ru = pd.read_csv(os.path.join(MASTER, "zip_ruca.csv.gz"), dtype={"zip": str}, usecols=["zip", "ruca_primary"])
    z = z.merge(ru, on="zip", how="left")
    # Small-town and rural: RUCA primary code 4-10 (micropolitan, small town and rural areas)
    z["rural_pop"] = np.where(pd.to_numeric(z.ruca_primary, errors="coerce") >= 4, z.acs_pop, np.where(z.ruca_primary.notna(), 0, np.nan))
    z.loc[z.acs_pop.isna(), "rural_pop"] = np.nan
    return z, aud


def main():
    ap_ = argparse.ArgumentParser(); ap_.add_argument("--cache"); a = ap_.parse_args()
    rep = [("Formula tests", "PASS", self_test())]
    built = datetime.date.today().isoformat()
    z, aud = load_inputs(rep)
    met_list = pd.read_csv(os.path.join(GEO, "metro_list.csv"), dtype={"cbsa_code": str})
    metros = set(met_list[met_list.cbsa_type == "Metro"].cbsa_code)
    dma_list = pd.read_csv(os.path.join(GEO, "dma_list.csv"), dtype={"dma_code": str})
    dma_list = dma_list[dma_list.dma_code != "0"]
    z["land"] = z.zip.map(zcta_land(a.cache, rep))

    # Business Patterns: competitors for each line
    y = cbp_years(a.cache)
    rep.append(("Business Patterns years", "INFO", f"{y} (growth measured from {y - 1})"))
    zb, zb0 = zbp(y, a.cache), zbp(y - 1, a.cache)
    co, co0 = cbp_county(y, a.cache), cbp_county(y - 1, a.cache)
    cpop = z.groupby("county_fips").population.transform("sum")
    z["cshare"] = (z.population / cpop).where(cpop > 0, 0)
    bench = {"new": (15000, 30000), "used": (15000, 60000)}
    for k, codes in NAICS.items():
        for tag, src in (("", zb), ("_prev", zb0)):
            z[f"zest{tag}_{k}"] = z.zip.map(src[src.naics.isin(codes)].groupby("zip").est.sum()).fillna(0)
        cs = co[co.naics.isin(codes)].groupby("county_fips").est.sum()
        c0 = co0[co0.naics.isin(codes)].groupby("county_fips").est.sum()
        z[f"cest_{k}"] = z.county_fips.map(cs).fillna(0) * z.cshare
        z[f"cprev_{k}"] = z.county_fips.map(c0).fillna(0) * z.cshare
        nat = co[co.naics.isin(codes)].est.sum(); lo, hi = bench[k]
        rep.append((f"Published benchmark: {k} establishments", "PASS" if lo <= nat <= hi else "FAIL", f"{int(nat):,} (expected {lo:,}–{hi:,})"))

    # ---------------- Aggregate ----------------
    def agg(g):
        r = {c: g[c].sum(min_count=1) for c in SUMS if c in g}
        r["adults"] = r.get("adults18")
        land = g.land.where(g.land > 0).sum()
        r["density"] = g.households.where(g.land > 0, 0).sum() / land if land > 0 else np.nan
        for k, (n, d) in RATE_PARTS.items():
            ok = g[n].notna() & g[d].notna(); den = g[d][ok].sum()
            r[k] = g[n][ok].sum() / den if den > 0 else np.nan
        for k, (n, d) in PER.items():
            ok = g[n].notna() & g[d].notna(); den = g[d][ok].sum()
            r[k] = g[n][ok].sum() / den if den > 0 else np.nan
        for s in SUBCATS:
            i, k = s["id"], s["naics"]
            r[f"est@{i}"], r[f"prev@{i}"] = g[f"cest_{k}"].sum(), g[f"cprev_{k}"].sum()
        return r

    def frame(groups):
        return pd.DataFrame.from_dict({k: agg(g) for k, g in groups}, orient="index")

    def score(df, parts=tuple(WEIGHTS), mask=None):
        if mask is None: mask = pd.Series(True, index=df.index)
        P = lambda s: pct(s.where(mask))
        dem = {k: P(df[k]) for k in DEMAND_LABELS if k in df.columns}
        spend = P(df.inc75_share)
        for s in SUBCATS:
            i = s["id"]
            est, prev = df[f"est@{i}"], df[f"prev@{i}"]
            df[f"per10k@{i}"] = (est / df.population * 1e4).where(df.population > 0)
            df[f"growth@{i}"] = ((est - prev) / prev).where(prev >= 3)
            ins = [dem[k] for k in s["demand"] if k in dem and df[k].notna().any()]
            df[f"demand@{i}"] = combine(ins, [1] * len(ins)) if ins else np.nan
            e = EASI.get(i, (None,))[0]
            has_cat = "category" in parts and e is not None and f"easi_{e}_hh" in df.columns
            df[f"category@{i}"] = combine([P(df[f"easi_{e}_hh"]), P(df[f"easi_{e}_total"])], [0.5, 0.5]) if has_cat else np.nan
            use = [c for c in parts if not (c == "category" and not has_cat) and not (c == "spend" and not s.get("spend", True))]
            df[f"spend@{i}"] = spend if "spend" in use else np.nan
            df[f"comp@{i}"] = P(-df[f"per10k@{i}"]) if "comp" in use else np.nan
            cols = [df[f"{c}@{i}"] for c in use]
            full = pd.concat(cols, axis=1).notna().all(axis=1)
            df[f"score@{i}"] = combine(cols, [WEIGHTS[c] for c in use]).where(full & mask).round(1)
            for c in WEIGHTS: df[f"{c}@{i}"] = df[f"{c}@{i}"].round(1)
            under = (df[f"demand@{i}"] >= 70) & (P(df[f"per10k@{i}"]) <= 30)
            known = df[f"demand@{i}"].notna() & df[f"per10k@{i}"].notna() & mask
            df[f"under@{i}"] = np.where(under & known, "Yes", np.where(known, "No", None))
        return df

    # EASI: per-household spending by DMA and metro; totals = per household x this site's households
    src = os.path.join(HERE, "sources")
    sd = pd.read_csv(os.path.join(src, "easi_auto_spend_dma.csv"))
    xw = pd.read_csv(os.path.join(src, "easi_dma_crosswalk.csv"), dtype={"dma_code": str})
    sd = sd.merge(xw[["easi_market", "dma_code"]], left_on="market", right_on="easi_market", how="left")
    if sd.dma_code.isna().any(): sys.exit("easi_dma_crosswalk.csv is missing EASI DMAs: " + ", ".join(sd[sd.dma_code.isna()].market))
    sm = pd.read_csv(os.path.join(src, "easi_auto_spend_metro.csv"))
    em = pd.read_csv(os.path.join(src, "easi_metro_2025.csv"), dtype={"cbsa_code": str})
    key = lambda t: re.sub(r"[^a-z0-9]", "", str(t).lower())
    sm["cbsa_code"] = sm.market.map(key).map(dict(zip(em.metro.map(key), em.cbsa_code)))
    us_hh = {}
    for e, lab in EASI.values():
        us_hh[e] = sd[f"{e}_total"].sum() / sd.households.sum()
        rep.append((f"EASI U.S. {lab.lower()} per household", "INFO", f"${us_hh[e]:,.2f}"))

    def add_easi(df, table, idcol, label):
        t = table.dropna(subset=[idcol]).set_index(idcol)
        for e, lab in EASI.values():
            per = t[f"{e}_per_hh"].copy()
            if idcol == "dma_code" and PALM_SPRINGS not in per.index:
                pm = sm.dropna(subset=["cbsa_code"]).set_index("cbsa_code")[f"{e}_per_hh"]
                if RIVERSIDE_METRO in pm.index: per.loc[PALM_SPRINGS] = pm.loc[RIVERSIDE_METRO]
            df[f"easi_{e}_hh"] = df.index.map(per).astype(float)
            df[f"easi_{e}_total"] = df[f"easi_{e}_hh"] * df.households
            df[f"easi_{e}_idx"] = (df[f"easi_{e}_hh"] / us_hh[e] * 100).round(0)
        miss = [str(i) for i in df.index if df.at[i, f"easi_{e}_hh"] != df.at[i, f"easi_{e}_hh"]]
        rep.append((f"EASI auto spending matched to {label}", "PASS" if len(miss) <= (2 if label == "metros" else 0) else "FAIL",
                    f"{len(df) - len(miss)} of {len(df)}" + (f"; missing {miss[:8]}" if miss else "")))

    zd = z[z.dma_code != "0"]
    dma = frame(zd.groupby("dma_code")); add_easi(dma, sd, "dma_code", "DMAs"); dma = score(dma)
    zm = z[z.cbsa_code.isin(metros)]
    met = frame(zm.groupby("cbsa_code")); add_easi(met, sm, "cbsa_code", "metros"); met = score(met)
    cty = county_frame(z, frame); cty = score(cty, parts=COUNTY_PARTS, mask=county_mask(cty))
    validate_scores(rep, z, co, [(s["id"], s["label"], NAICS[s["naics"]]) for s in SUBCATS],
                    [("DMAs", dma, "dma_code"), ("metros", met, "cbsa_code")], "category businesses")
    us = frame([("us", z)])
    for s in SUBCATS:
        codes = NAICS[s["naics"]]; i = s["id"]
        us[f"est@{i}"], us[f"prev@{i}"] = nat_or(y, codes, co), nat_or(y - 1, codes, co0)   # national file
        us[f"per10k@{i}"] = us[f"est@{i}"] / us.population * 1e4
        us[f"growth@{i}"] = (us[f"est@{i}"] - us[f"prev@{i}"]) / us[f"prev@{i}"]
    for e, lab in EASI.values():
        us[f"easi_{e}_hh"], us[f"easi_{e}_idx"] = us_hh[e], 100.0
        us[f"easi_{e}_total"] = us_hh[e] * us.households
        r_ = dma[f"easi_{e}_total"].sum() / sd[f"{e}_total"].sum()
        rep.append((f"EASI {lab.lower()}, DMAs vs. EASI's own total", "PASS" if 0.95 <= r_ <= 1.05 else "FAIL", f"{r_:.1%}"))

    # ---------------- Checks ----------------
    U = lambda k: float(us[k].iloc[0])
    for k, lo, hi in (("inc100_share", .30, .48), ("inc35_100_share", .30, .45), ("car_share", .70, .90), ("veh3p_share", .18, .26),
                      ("noveh_share", .06, .11), ("rural_share", .12, .25), ("kids_share", .25, .35)):
        rep.append((f"U.S. {DEMAND_LABELS.get(k, k).lower()}" if k in DEMAND_LABELS else f"U.S. {k}", "PASS" if lo <= U(k) <= hi else "FAIL", f"{U(k):.1%} (expected {lo:.0%}–{hi:.0%})"))
    vph = U("veh_per_hh")
    rep.append(("U.S. vehicles per household", "PASS" if 1.7 <= vph <= 2.1 else "FAIL", f"{vph:.2f} (expected 1.7–2.1)"))
    for name, df in (("DMA", dma), ("Metro", met)):
        sc = df[[f"score@{s['id']}" for s in SUBCATS]]
        bad = int(((sc < 0) | (sc > 100)).sum().sum())
        rep.append((f"{name} scores within 0–100", "PASS" if bad == 0 else "FAIL",
                    f"{bad} out of range; {int(sc.notna().sum().sum()):,} computed, {int(sc.isna().sum().sum()):,} not computed (missing input)"))
    for s in SUBCATS:
        i = s["id"]; d = dma.sort_values(f"score@{i}", ascending=False)
        top = ", ".join(dma_list.set_index("dma_code").dma_name.get(x, x).title() for x in d.index[:5])
        rep.append((f"Top DMAs: {s['label']}", "INFO", top))
    county_checks(rep, cty, [s["id"] for s in SUBCATS])
    failed = [r for r in rep if r[1] == "FAIL"]
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "auto_report.md"), "w") as f:
        f.write(f"# Auto data check report\n\nBuilt {built}. Result: **{'FAILED' if failed else 'PASSED'}**\n\n| Check | Result | Detail |\n| --- | --- | --- |\n")
        for r in rep: f.write(f"| {r[0]} | {r[1]} | {r[2]} |\n")
    for r in rep: log(f"[{r[1]}] {r[0]}: {r[2]}")
    if failed: sys.exit("A check failed; the Auto data was not updated. See auto/data/auto_report.md.")

    # ---------------- Write ----------------
    keep = COUNTS + RATES + ["density"] + [f"easi_{e}_{k}" for e, _ in EASI.values() for k in ("hh", "total", "idx")]
    per_sub = ["score", "demand", "category", "spend", "comp", "under", "est", "per10k", "growth"]
    SCORE_KEYS = ("score", "demand", "category", "spend", "comp")
    INTS = set(COUNTS) | {"est"} | {f"easi_{e}_total" for e, _ in EASI.values()}

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
                        x = clean(r[k]); v[k] = (round(x, 1) if p in SCORE_KEYS else int(round(x))) if (p in SCORE_KEYS or p == "est") and x is not None else x   # scores to one decimal so ranks don't tie
            v = {k: x for k, x in v.items() if x is not None}
            out.append({"id": str(idx), "name": names(idx), "v": v, "f": flags_fn(idx, r) if flags_fn else []})
        return out

    dname = dma_list.set_index("dma_code").dma_name
    tidy = lambda n: re.sub(r"(, )([A-Za-z]{2})\b", lambda m: m.group(1) + m.group(2).upper(), str(n).title())
    mname = met_list.set_index("cbsa_code").cbsa_name

    def flags(idx, r):
        return ["Palm Springs boundary is provisional: 28 Coachella Valley ZIPs assigned by Adtaxi, pending a Nielsen check."] if str(idx) == "804" else []

    meta = {"built": built, "cbpYear": y, "acsYears": aud["meta"]["acsYears"]}
    json.dump({"level": "dma", "meta": meta, "rows": rows(dma, lambda i: tidy(dname.get(i, i)), flags)}, open(os.path.join(OUT, "dma.json"), "w"), separators=(",", ":"))
    json.dump({"level": "metro", "meta": meta, "rows": rows(met, lambda i: mname.get(i, i))}, open(os.path.join(OUT, "metro.json"), "w"), separators=(",", ":"))
    cname = county_names()
    json.dump({"level": "county", "meta": meta, "rows": mark_unranked(rows(cty, lambda i: cname.get(str(i), str(i)), lambda i, r: county_flag(r)), cty)},
              open(os.path.join(OUT, "county.json"), "w"), separators=(",", ":"))
    json.dump({"level": "us", "meta": meta, "rows": rows(us, lambda i: "United States")}, open(os.path.join(OUT, "us.json"), "w"), separators=(",", ":"))

    # ZIPs inside each market, ranked within the market (Consumer Demand and Spending Power). Each ZIP's own values are
    # computed once for all ZIPs, then ranked within each market.
    zz = z.set_index("zip")
    zf = pd.DataFrame(index=zz.index)
    for c in SUMS: zf[c] = zz[c]
    zf["adults"] = zz.adults18
    zf["density"] = (zz.households / zz.land).where(zz.land > 0)
    for k, (n, d) in RATE_PARTS.items(): zf[k] = (zz[n] / zz[d]).where(zz[d] > 0)
    for k, (n, d) in PER.items(): zf[k] = (zz[n] / zz[d]).where(zz[d] > 0)
    for s in SUBCATS:
        zf[f"est@{s['id']}"], zf[f"prev@{s['id']}"] = zz[f"zest_{s['naics']}"], zz[f"zest_prev_{s['naics']}"]
    nfiles = 0
    zip_parts = ("demand", "spend")
    for level, col, src_ in (("dma", "dma_code", zd), ("metro", "cbsa_code", zm),
                             ("county", "county_fips", z[z.county_fips.astype(str).str.len() == 5])):
        folder = os.path.join(OUT, "zip", level); os.makedirs(folder, exist_ok=True)
        for code, g in src_.groupby(col):
            f = zf.loc[g.zip].copy()
            f = f[~f.index.duplicated()]
            # Mostly group quarters (dorms, bases, prisons): households under 15% of residents. Per-household rates
            # there rest on a handful of homes, so these ZIPs are shown but not ranked.
            gq = f.households.fillna(0) < 0.15 * f.population
            ok = (f.population >= MIN_POP) & ~gq
            f = score(f, parts=zip_parts, mask=ok)
            city = g.set_index("zip").city.fillna("")
            out = rows(f, lambda i: f"{i} {city.get(i, '')}".strip())
            for row in out:
                if f.loc[row["id"], "population"] < MIN_POP:
                    row["u"] = 1; row["f"].append(f"Fewer than {MIN_POP} residents, so this ZIP isn't ranked.")
                elif gq.get(row["id"], False):
                    row["u"] = 1; row["f"].append("Mostly group quarters (a campus, base or institution, with few households), so this ZIP isn't ranked.")
                for s in SUBCATS:
                    for p in ("category", "comp", "under"): row["v"].pop(f"{p}@{s['id']}", None)
            json.dump({"level": "zip", "parent": {"level": level, "id": code}, "rows": out},
                      open(os.path.join(folder, f"{code}.json"), "w"), separators=(",", ":"))
            nfiles += 1
    log(f"Wrote {len(dma)} DMAs, {len(met)} metros, {len(cty)} counties and {nfiles} ZIP files to {OUT}")

    # Radius tool columns: households by vehicles available
    rz = z[z.veh_tot.notna()]
    cols = {"zip": rz.zip.tolist()}
    for c in ("veh_tot", "veh0", "v1", "v2", "veh3p"):
        cols[c] = [None if pd.isna(x) else int(round(x)) for x in rz[c]]
    json.dump({"meta": {"built": built, "acsYears": aud["meta"]["acsYears"]}, "cols": cols},
              open(os.path.join(AUD, "zip_audience_auto.json"), "w"), separators=(",", ":"))
    log(f"Wrote radius columns for {len(rz):,} ZIPs")

if __name__ == "__main__":
    main()
