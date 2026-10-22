"""Builds the Apartment Market Analyzer data (Market Potential Scores) into apartment-analyzer/data/.

The analyzer shows apartment communities and property managers where their prospective residents are, and how to focus
ad dollars geographically.

Sources, all public downloads with no key (plus Adtaxi's EASI and Deluxe files in data-build/sources):
  - shared/audience/zip_audience*.json: Census ACS renter households by age, income, building type, year moved in,
    rent burden, children at home, rental vacancy and college enrollment, by ZIP (built earlier in the same workflow)
  - data-build/sources/deluxe_housing_zip.csv: median gross rent by ZIP (Census ACS, via the Deluxe ZIP file)
  - data-build/sources/easi_rent_spend_dma.csv / _metro.csv: EASI 2025 household rent spending (market size)
  - Census County and ZIP Business Patterns: lessors of residential buildings (531110) and residential property
    managers (531311), the competitors
  - Census Building Permits Survey, county annual files: new units in buildings with 5+ units (shown, not scored)
  - Zillow Observed Rent Index (ZORI), metro: one-year rent change (shown, not scored; metros only)
Geography comes from data-build/geo (ZIP -> county, metro, DMA). Download helpers are shared with build_healthcare.py.

  python3 data-build/build_apartment.py              # live (GitHub Actions)
  python3 data-build/build_apartment.py --cache DIR  # read saved downloads from DIR (tests)
"""
import argparse, datetime, io, json, os, re, sys
import numpy as np
import pandas as pd
from build_healthcare import cbp_years, zbp, cbp_county, pct, combine, zcta_land, validate_scores, get, fetch, nat_or
from county_level import county_frame, county_mask, county_checks, county_flag, county_names, mark_unranked, COUNTY_PARTS

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GEO = os.path.join(HERE, "geo")
OUT = os.path.join(ROOT, "apartment-analyzer", "data")
MIN_POP = 500
NAICS = ["531110", "531311"]          # lessors of residential buildings and dwellings; residential property managers
PALM_SPRINGS, RIVERSIDE_METRO = "804", "40140"

# Market Potential Score: where an apartment advertiser's prospective residents are. Each part is a percentile (0-100).
WEIGHTS = {"demand": 0.40, "category": 0.25, "spend": 0.15, "comp": 0.20}
ZIP_PARTS = ("demand", "spend")       # ZIPs: no EASI spending by ZIP, and ZIP business counts are suppressed under 3

# demand: inputs averaged as percentiles. spend: the renter-income share used as Spending Power (None = not used,
# because the category's renters aren't defined by what they can pay).
SUBCATS = [
    {"id": "all", "label": "All apartments", "demand": ["renters", "renter_share", "moved_share", "apt_share"], "spend": "rinc50_share"},
    {"id": "luxury", "label": "Luxury / Class A", "demand": ["rinc100", "r25_44_share", "apt_share"], "spend": "rinc100_share"},
    {"id": "mid", "label": "Mid-market / workforce", "demand": ["rinc_mid", "rinc_mid_share", "apt_share"], "spend": "rinc50_share"},
    {"id": "affordable", "label": "Affordable housing", "demand": ["rinc_lt35", "rinc_lt35_share", "burden_share"], "spend": None},
    {"id": "student", "label": "Student housing", "demand": ["college", "college_share", "r_u25"], "spend": None},
    {"id": "senior", "label": "Active adult / 55+", "demand": ["r55p", "r55_share"], "spend": "rinc50_share"},
]
DEMAND_LABELS = {"renters": "Renter households", "renter_share": "Share of households renting", "moved_share": "Renters who moved in 2020 or later",
                 "apt_share": "Renters in buildings with 5+ units", "rinc100": "Renters earning $100K+", "r25_44_share": "Renter householders 25–44",
                 "rinc_mid": "Renters earning $35K–$99K", "rinc_mid_share": "Share of renters earning $35K–$99K",
                 "rinc_lt35": "Renters earning under $35K", "rinc_lt35_share": "Share of renters earning under $35K",
                 "burden_share": "Renters paying 30%+ of income in rent", "college": "College and graduate students",
                 "college_share": "College students, share of residents", "r_u25": "Renter householders under 25",
                 "r55p": "Renter householders 55+", "r55_share": "Share of renters 55+", "r_kids": "Renter households with children",
                 "rkids_share": "Share of renters with children", "sfd_share": "Renters in single-family houses"}
SPEND_LABELS = {"rinc50_share": "Renters earning $50K+", "rinc75_share": "Renters earning $75K+", "rinc100_share": "Renters earning $100K+"}
COUNTS = ["population", "households", "renters", "rinc100", "rinc_mid", "rinc_lt35", "college", "r_u25", "r55p", "r_kids", "r_5p"]
# numerator, denominator for each rate (summed over ZIPs, so markets get true rates)
RATE_PARTS = {"renter_share": ("r_tot", "hh_tot"), "moved_share": ("r_moved20", "r_mtot"), "apt_share": ("r_5p", "r_tot"),
              "sfd_share": ("r_sfd", "r_tot"), "r25_44_share": ("r25_44", "r_age"), "r55_share": ("r55p", "r_age"),
              "rinc100_share": ("rinc100", "rinc_tot"), "rinc_mid_share": ("rinc_mid", "rinc_tot"), "rinc_lt35_share": ("rinc_lt35", "rinc_tot"),
              "rinc50_share": ("rinc50", "rinc_tot"), "rinc75_share": ("rinc75", "rinc_tot"), "burden_share": ("rb_30p", "rb_base"),
              "rkids_share": ("r_kids", "rk_tot"), "college_share": ("college", "acs_pop"), "vacancy": ("vac_rent", "vac_base")}
RATES = list(RATE_PARTS)
APT_COLS = ["r_tot", "r_sfd", "r_5p", "r_20p", "r_mtot", "r_moved20", "rinc_tot", "rinc_lt35", "rinc_35_50", "rinc_50_75", "rinc_75_100",
            "rinc_100_150", "rinc_150p", "rb_base", "rb_30p", "vac_rent", "vac_rented", "rk_tot", "r_kids"]
AGE_COLS = ["r18_24", "r25_34", "r35_44", "r45_54", "r55p"]
PERMITS = "https://www2.census.gov/econ/bps/County/co{y}a.txt"
ZORI = "https://files.zillowstatic.com/research/public_csvs/zori/Metro_zori_uc_sfrcondomfr_sm_month.csv"


def log(*a): print(*a, flush=True)


def self_test():
    s = pct(pd.Series([10, 20, 30, 40, np.nan]))
    assert list(s[:4]) == [25.0, 50.0, 75.0, 100.0] and np.isnan(s[4]), s
    c = combine([pd.Series([100.0, np.nan]), pd.Series([0.0, 50.0])], [0.40, 0.25])
    assert abs(c[0] - 40 / 0.65) < 1e-9 and c[1] == 50.0, c
    assert abs(sum(WEIGHTS.values()) - 1) < 1e-9, WEIGHTS
    assert all(k in DEMAND_LABELS for s in SUBCATS for k in s["demand"])
    assert all(s["spend"] is None or s["spend"] in RATE_PARTS for s in SUBCATS)
    return "percentile and weighted-average hand checks reproduce exactly"


def permits(cache, rep):
    """County new housing units in 5+ unit buildings, newest annual file. Returns (Series by county_fips, year) or (None, None)."""
    this = datetime.date.today().year
    for y in (this - 1, this - 2, this - 3):
        try:
            blob = fetch(f"co{y}a.txt", PERMITS.format(y=y), cache).decode("latin-1")
        except Exception as e:
            log(f"Building permits {y}: not available -> {e}"); continue
        lines = [l for l in blob.splitlines() if l.strip()]
        h1, h2 = [t.strip() for t in lines[0].split(",")], [t.strip() for t in lines[1].split(",")]
        top, cur = [], ""
        for t in h1:
            cur = t or cur; top.append(cur)
        col = next((i for i, (a, b) in enumerate(zip(top, h2)) if a.lower().startswith("5+ units") and b.lower() == "units"), None)
        st = next((i for i, (a, b) in enumerate(zip(top, h2)) if "fips" in a.lower() and b.lower() == "state"), None)
        ct = next((i for i, (a, b) in enumerate(zip(top, h2)) if "fips" in a.lower() and b.lower() == "county"), None)
        if None in (col, st, ct):
            rep.append(("Building permits", "WARN", f"{y} file layout not recognized; permits not shown")); return None, None
        rows = [l.split(",") for l in lines[2:]]
        df = pd.DataFrame({"fips": [r[st].strip().zfill(2) + r[ct].strip().zfill(3) for r in rows if len(r) > col],
                           "units": [pd.to_numeric(r[col], errors="coerce") for r in rows if len(r) > col]})
        s = df.groupby("fips").units.sum()
        rep.append(("Building permits: new units in 5+ unit buildings", "PASS" if 150000 <= s.sum() <= 800000 else "WARN",
                    f"{y}: {int(s.sum()):,} units in {len(s):,} counties (expected 150,000–800,000 nationally)"))
        return s, y
    rep.append(("Building permits", "WARN", "no county annual file found; permits not shown")); return None, None


def zori(cache, met_list, rep):
    """One-year change in Zillow's metro rent index, matched to metro codes by lead city and state. Returns Series or None."""
    try:
        df = pd.read_csv(io.BytesIO(fetch("zori_metro.csv", ZORI, cache)))
    except Exception as e:
        rep.append(("Zillow rent index", "WARN", f"not available this run ({e}); rent change not shown")); return None, None
    dates = [c for c in df.columns if re.match(r"\d{4}-\d{2}-\d{2}$", c)]
    last, prev = dates[-1], dates[-13]
    df = df[df.RegionType.str.lower() == "msa"].copy()
    df["chg"] = df[last] / df[prev] - 1
    key = lambda city, st: re.sub(r"[^a-z]", "", str(city).lower()) + "|" + str(st).upper()
    df["k"] = [key(re.split(r"[-/]", n.split(",")[0])[0], n.split(",")[-1].strip()[:2]) for n in df.RegionName]
    m = met_list[met_list.cbsa_type == "Metro"].copy()
    # CBSA names look like "New York-Newark-Jersey City NY-NJ": strip the state codes, then try each city in order
    # (Zillow names a metro by one of its cities, usually the first)
    zk = df.drop_duplicates("k").set_index("k").chg
    def mkey(n):
        st = (re.findall(r"([A-Z]{2})(?:-[A-Z]{2})*$", n) or [""])[0]
        cities = re.split(r"[-/]", re.sub(r"\s+[A-Z]{2}(-[A-Z]{2})*$", "", n))
        ks = [key(c, st) for c in cities]
        return next((k for k in ks if k in zk.index), ks[0])
    m["k"] = [mkey(n) for n in m.cbsa_name]
    s = m.set_index("cbsa_code").k.map(zk).dropna()
    log(f"Zillow metros: {len(df)}; with a {last[:7]} value and one 12 months earlier: {int(df.chg.notna().sum())}")
    log("Zillow names not matched (largest first): " + "; ".join(df[~df.k.isin(set(m.k)) & df.chg.notna()].sort_values("SizeRank").RegionName.head(40)))
    log("Metro names not matched (sample): " + "; ".join(m[~m.k.isin(set(df.k))].cbsa_name.head(40)))
    med = s.median()
    rep.append(("Zillow rent index matched to metros", "PASS" if len(s) >= 300 and -0.05 < med < 0.10 else "WARN",
                f"{len(s)} of {len(m)} metros; {prev[:7]} to {last[:7]}; median change {med:+.1%}"))
    return s, last[:7]


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
    A = os.path.join(ROOT, "shared", "audience")
    aud = json.load(open(os.path.join(A, "zip_audience.json")))
    acs = pd.DataFrame(aud["cols"])[["zip", "acs_pop", "adults18", "hh_tot", "enr_college"]]
    for name, cols in (("zip_audience_apt.json", APT_COLS), ("zip_audience_legal.json", AGE_COLS)):
        p = os.path.join(A, name)
        if not os.path.exists(p): sys.exit(f"shared/audience/{name} is missing; the audience step must run first with the new build_audience.py.")
        x = pd.DataFrame(json.load(open(p))["cols"])
        miss = [c for c in cols if c not in x.columns]
        if miss: sys.exit(f"shared/audience/{name} has no {miss[:4]}; the audience step must run first with the new build_audience.py.")
        acs = acs.merge(x[["zip"] + cols], on="zip", how="left")
    acs["college"] = acs.enr_college
    acs["rinc100"] = acs.rinc_100_150 + acs.rinc_150p
    acs["rinc_mid"] = acs.rinc_35_50 + acs.rinc_50_75 + acs.rinc_75_100
    acs["rinc50"] = acs.rinc_50_75 + acs.rinc_75_100 + acs.rinc100
    acs["rinc75"] = acs.rinc_75_100 + acs.rinc100
    acs["r_age"] = acs[AGE_COLS].sum(axis=1, min_count=5)
    acs["r25_44"] = acs.r25_34 + acs.r35_44
    acs["r_u25"] = acs.r18_24
    acs["vac_base"] = acs.vac_rent + acs.vac_rented + acs.r_tot
    acs["renters"] = acs.r_tot
    z = z.merge(acs, on="zip", how="left")
    z["land"] = z.zip.map(zcta_land(a.cache, rep))

    # Median gross rent by ZIP (Deluxe file, Census ACS). Census tops ZIP rents out at $3,500.
    dh = pd.read_csv(os.path.join(HERE, "sources", "deluxe_housing_zip.csv"), dtype={"zip": str})
    z["rent"] = z.zip.map(dh.set_index("zip").median_gross_rent).astype(float)
    z["rent_n"] = z.renters.where(z.rent.notna(), 0)                      # renters in ZIPs with a published rent
    z["rent_w"] = (z.rent * z.renters).fillna(0)
    cov = z.rent_n.sum() / z.renters.sum()
    rep.append(("Renters in ZIPs with a published median rent", "PASS" if cov > 0.97 else "FAIL", f"{cov:.1%}"))

    # Business Patterns: residential landlords and property managers
    y = cbp_years(a.cache)
    rep.append(("Business Patterns years", "INFO", f"{y} (growth measured from {y - 1})"))
    zb, zb0 = zbp(y, a.cache), zbp(y - 1, a.cache)
    co, co0 = cbp_county(y, a.cache), cbp_county(y - 1, a.cache)
    for tag, src in (("", zb), ("_prev", zb0)):
        z[f"zest{tag}"] = z.zip.map(src[src.naics.isin(NAICS)].groupby("zip").est.sum()).fillna(0)
    nat = co[co.naics.isin(NAICS)].est.sum()
    rep.append(("Published benchmark: residential landlords and property managers", "PASS" if 60000 <= nat <= 250000 else "FAIL",
                f"{int(nat):,} (expected 60,000–250,000)"))
    rep.append(("ZIP detail coverage of county counts (cells under 3 businesses aren't published)", "INFO", f"{z.zest.sum() / nat:.0%}" if nat else "n/a"))
    cpop = z.groupby("county_fips").population.transform("sum")
    z["cshare"] = (z.population / cpop).where(cpop > 0, 0)
    z["cest"] = z.county_fips.map(co[co.naics.isin(NAICS)].groupby("county_fips").est.sum()).fillna(0) * z.cshare
    z["cprev"] = z.county_fips.map(co0[co0.naics.isin(NAICS)].groupby("county_fips").est.sum()).fillna(0) * z.cshare
    co_in = co[co.county_fips.isin(set(z.county_fips))]

    # Leasing pressure (shown, not scored): new apartment permits by county, spread to ZIPs by renter share; Zillow rents
    pm, pyear = permits(a.cache, rep)
    if pm is not None:
        crent = z.groupby("county_fips").renters.transform("sum")
        z["permits"] = z.county_fips.map(pm).fillna(0) * (z.renters / crent).where(crent > 0, 0)
    zr, zdate = zori(a.cache, met_list, rep)

    # ---------------- Aggregate ----------------
    SUMS = ["population", "households", "acs_pop", "hh_tot", "renters", "r_tot", "r_sfd", "r_5p", "r_mtot", "r_moved20", "rinc_tot", "rinc100",
            "rinc_mid", "rinc_lt35", "rinc50", "rinc75", "rb_base", "rb_30p", "vac_rent", "vac_base", "rk_tot", "r_kids", "college",
            "r_age", "r25_44", "r55p", "r_u25"]

    def agg(g):
        r = {c: g[c].sum(min_count=1) for c in SUMS}
        land = g.land.where(g.land > 0).sum()
        r["density"] = g.households.where(g.land > 0, 0).sum() / land if land > 0 else np.nan
        for k, (n, d) in RATE_PARTS.items():
            den = g[d].sum(); r[k] = g[n].sum() / den if den > 0 else np.nan
        rn = g.rent_n.sum()
        r["rent"] = g.rent_w.sum() / rn if rn > 0 else np.nan               # renter-weighted typical rent
        r["rent_hh"] = r["rent"] * 12 * r["renter_share"] if r["rent"] == r["rent"] else np.nan   # annual rent per household
        r["est"], r["prev"] = g.cest.sum(), g.cprev.sum()
        if "permits" in g.columns: r["permits"] = g.permits.sum()
        return r

    def frame(groups):
        return pd.DataFrame.from_dict({k: agg(g) for k, g in groups}, orient="index")

    def score(df, parts=tuple(WEIGHTS), mask=None):
        if mask is None: mask = pd.Series(True, index=df.index)
        P = lambda s: pct(s.where(mask))
        df["per10k"] = (df.est / df.renters * 1e4).where(df.renters > 0)       # per 10,000 renter households
        df["growth"] = ((df.est - df.prev) / df.prev).where(df.prev >= 3)
        if "permits" in df.columns: df["permits_1k"] = (df.permits / df.renters * 1000).where(df.renters > 0)
        comp = P(-df.per10k) if "comp" in parts else pd.Series(np.nan, index=df.index)
        cat = combine([P(df.easi_total), P(df.rent_hh)], [0.5, 0.5]) if "category" in parts and "easi_total" in df.columns else pd.Series(np.nan, index=df.index)
        dem_pct = {k: P(df[k]) for k in DEMAND_LABELS if k in df.columns}
        for s in SUBCATS:
            i = s["id"]
            ins = [dem_pct[k] for k in s["demand"] if k in dem_pct and df[k].notna().any()]
            df[f"demand@{i}"] = combine(ins, [1] * len(ins)) if ins else np.nan
            df[f"category@{i}"], df[f"comp@{i}"] = cat, comp
            df[f"spend@{i}"] = P(df[s["spend"]]) if s["spend"] and "spend" in parts else np.nan
            use = [c for c in parts if not (c == "spend" and not s["spend"])]
            cols = [df[f"{c}@{i}"] for c in use]
            full = pd.concat(cols, axis=1).notna().all(axis=1)
            df[f"score@{i}"] = combine(cols, [WEIGHTS[c] for c in use]).where(full & mask).round(2)
            for c in WEIGHTS: df[f"{c}@{i}"] = df[f"{c}@{i}"].round(2)
            under = (df[f"demand@{i}"] >= 70) & (P(df.per10k) <= 30)
            known = df[f"demand@{i}"].notna() & df.per10k.notna() & mask
            df[f"under@{i}"] = np.where(under & known, "Yes", np.where(known, "No", None))
        return df

    # EASI rent. Totals = per-household spending x this site's households (same boundaries as everything else).
    src = os.path.join(HERE, "sources")
    sd = pd.read_csv(os.path.join(src, "easi_rent_spend_dma.csv"))
    xw = pd.read_csv(os.path.join(src, "easi_dma_crosswalk.csv"), dtype={"dma_code": str})
    sd = sd.merge(xw[["easi_market", "dma_code"]], left_on="market", right_on="easi_market", how="left")
    if sd.dma_code.isna().any(): sys.exit("easi_dma_crosswalk.csv is missing EASI DMAs: " + ", ".join(sd[sd.dma_code.isna()].market))
    us_hh = sd.rent_total.sum() / sd.households.sum()
    sm = pd.read_csv(os.path.join(src, "easi_rent_spend_metro.csv"))
    em = pd.read_csv(os.path.join(src, "easi_metro_2025.csv"), dtype={"cbsa_code": str})
    key = lambda t: re.sub(r"[^a-z0-9]", "", str(t).lower())
    sm["cbsa_code"] = sm.market.map(key).map(dict(zip(em.metro.map(key), em.cbsa_code)))
    hh_dma = sd.set_index("dma_code").rent_per_hh
    hh_met = sm.dropna(subset=["cbsa_code"]).set_index("cbsa_code").rent_per_hh
    if PALM_SPRINGS not in hh_dma.index and RIVERSIDE_METRO in hh_met.index:
        hh_dma.loc[PALM_SPRINGS] = hh_met.loc[RIVERSIDE_METRO]
        rep.append(("EASI rent: Palm Springs", "INFO", "EASI includes Palm Springs in Los Angeles; the provisional Palm Springs DMA uses the Riverside–San Bernardino metro's per-household spending"))
    rep.append(("EASI U.S. rent per household", "INFO", f"${us_hh:,.0f} a year"))

    def add_easi(df, per_hh, label):
        df["easi_hh"] = df.index.map(per_hh).astype(float)
        df["easi_total"] = df.easi_hh * df.households
        df["easi_idx"] = (df.easi_hh / us_hh * 100).round(0)
        miss = [str(i) for i in df.index if df.at[i, "easi_hh"] != df.at[i, "easi_hh"]]
        rep.append((f"EASI rent matched to {label}", "PASS" if not miss else "FAIL", f"{len(df) - len(miss)} of {len(df)}" + (f"; missing {miss[:8]}" if miss else "")))

    zd = z[z.dma_code != "0"]
    dma = frame(zd.groupby("dma_code")); add_easi(dma, hh_dma, "DMAs")
    zm = z[z.cbsa_code.isin(metros)]
    met = frame(zm.groupby("cbsa_code")); add_easi(met, hh_met, "metros")
    us = frame([("us", z)])
    us_rent_hh = us.rent_hh.iloc[0]
    for df in (dma, met, us): df["rent_idx"] = (df.rent_hh / us_rent_hh * 100).round(0)
    dma = score(dma); met = score(met)
    cty = county_frame(z, frame); cty["rent_idx"] = (cty.rent_hh / us_rent_hh * 100).round(0)
    cty = score(cty, parts=COUNTY_PARTS, mask=county_mask(cty))
    if zr is not None: met["rent_chg"] = met.index.map(zr)
    validate_scores(rep, z, co, [(x["id"], x["label"], NAICS) for x in SUBCATS],
                    [("DMAs", dma, "dma_code"), ("metros", met, "cbsa_code")], "residential landlords and property managers")
    us["est"], us["prev"] = nat_or(y, NAICS, co), nat_or(y - 1, NAICS, co0)   # national file (matches published U.S. totals)
    us["per10k"] = us.est / us.renters * 1e4
    us["growth"] = (us.est - us.prev) / us.prev
    if pm is not None: us["permits"] = pm.sum(); us["permits_1k"] = us.permits / us.renters * 1000
    us["easi_hh"], us["easi_total"], us["easi_idx"] = us_hh, us_hh * us.households, 100.0
    r_ = dma.easi_total.sum() / sd.rent_total.sum()
    rep.append(("EASI rent total, DMAs vs. EASI's own total", "PASS" if 0.95 <= r_ <= 1.05 else "FAIL", f"{r_:.1%} of EASI's ${sd.rent_total.sum() / 1e9:,.1f}B"))

    # ---------------- Checks ----------------
    for name, df in (("DMA", dma), ("Metro", met)):
        sc = df[[f"score@{s['id']}" for s in SUBCATS]]
        bad = int(((sc < 0) | (sc > 100)).sum().sum())
        rep.append((f"{name} scores within 0–100", "PASS" if bad == 0 else "FAIL", f"{bad} out of range; {int(sc.notna().sum().sum()):,} scores computed, {int(sc.isna().sum().sum()):,} not computed (missing input)"))
    tot_d = dma.est.sum()
    tot_c = co_in[co_in.naics.isin(NAICS)].est.sum() - z[z.dma_code == "0"].cest.sum()
    rep.append(("DMA roll-up matches county totals: landlords and property managers", "PASS" if tot_c > 0 and abs(tot_d - tot_c) / tot_c <= 0.005 else "FAIL",
                f"DMAs {int(round(tot_d)):,} vs counties {int(round(tot_c)):,}"))
    u = us.iloc[0]
    for k, lo, hi, f_ in (("renter_share", .30, .40, "{:.1%}"), ("rent", 1150, 1750, "${:,.0f}"), ("vacancy", .035, .09, "{:.1%}"),
                          ("burden_share", .42, .58, "{:.1%}"), ("apt_share", .35, .52, "{:.1%}")):
        rep.append((f"U.S. {DEMAND_LABELS.get(k, k).lower() if k in DEMAND_LABELS else k.replace('_', ' ')}", "PASS" if lo <= u[k] <= hi else "FAIL",
                    f_.format(u[k]) + f" (expected {f_.format(lo)}–{f_.format(hi)})"))
    for name, df in (("DMAs", dma), ("metros", met)):
        rep.append((f"Census rent per household vs. EASI rent per household, {name}", "INFO",
                    f"rank correlation {df.rent_hh.rank().corr(df.easi_hh.rank()):.2f} (EASI's per-household rent varies little between markets, so it isn't scored)"))

    county_checks(rep, cty, [x["id"] for x in SUBCATS])
    failed = [r for r in rep if r[1] == "FAIL"]
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "apartment_report.md"), "w") as f:
        f.write(f"# Apartment data check report\n\nBuilt {built}. Result: **{'FAILED' if failed else 'PASSED'}**\n\n| Check | Result | Detail |\n| --- | --- | --- |\n")
        for r in rep: f.write(f"| {r[0]} | {r[1]} | {r[2]} |\n")
    for r in rep: log(f"[{r[1]}] {r[0]}: {r[2]}")
    if failed: sys.exit("A check failed; the Apartment data was not updated. See apartment-analyzer/data/apartment_report.md.")

    # ---------------- Write ----------------
    keep = COUNTS + RATES + ["density", "rent", "rent_hh", "rent_idx", "est", "per10k", "growth", "permits", "permits_1k", "rent_chg",
                             "easi_hh", "easi_total", "easi_idx"]
    per_sub = ["score", "demand", "category", "spend", "comp", "under"]
    SCORE_KEYS = ("score", "demand", "category", "spend", "comp")
    INTS = COUNTS + ["est", "easi_total", "permits", "rent", "rent_hh"]

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
                        x = clean(r[k]); v[k] = round(x, 2) if p in SCORE_KEYS and x is not None else x   # two decimals: ranks use the real value, so near-equal markets don't show as ties
            v = {k: x for k, x in v.items() if x is not None}
            f = flags_fn(idx, r) if flags_fn else []
            if v.get("rent", 0) >= 3500: f.append("Median rent is at Census's $3,500 cap for ZIPs, so the actual figure is higher.")
            out.append({"id": str(idx), "name": names(idx), "v": v, "f": f})
        return out

    dname = dma_list.set_index("dma_code").dma_name
    tidy = lambda n: re.sub(r"(, )([A-Za-z]{2})\b", lambda m: m.group(1) + m.group(2).upper(), str(n).title())
    mname = met_list.set_index("cbsa_code").cbsa_name

    def flags(idx, r):
        f = []
        if str(idx) == "804": f.append("Palm Springs boundary is provisional: 28 Coachella Valley ZIPs assigned by Adtaxi, pending a Nielsen check. EASI rent uses the Riverside–San Bernardino metro rate.")
        return f

    meta = {"built": built, "cbpYear": y, "acsYears": aud["meta"]["acsYears"], "permitsYear": pyear, "zoriMonth": zdate}
    json.dump({"level": "dma", "meta": meta, "rows": rows(dma, lambda i: tidy(dname.get(i, i)), flags)}, open(os.path.join(OUT, "dma.json"), "w"), separators=(",", ":"))
    json.dump({"level": "metro", "meta": meta, "rows": rows(met, lambda i: mname.get(i, i))}, open(os.path.join(OUT, "metro.json"), "w"), separators=(",", ":"))
    cname = county_names()
    json.dump({"level": "county", "meta": meta, "rows": mark_unranked(rows(cty, lambda i: cname.get(str(i), str(i)), lambda i, r: county_flag(r)), cty)},
              open(os.path.join(OUT, "county.json"), "w"), separators=(",", ":"))
    json.dump({"level": "us", "meta": meta, "rows": rows(us, lambda i: "United States")}, open(os.path.join(OUT, "us.json"), "w"), separators=(",", ":"))

    # ZIPs inside each market, ranked within the market
    nfiles = 0
    for level, col, src_ in (("dma", "dma_code", zd), ("metro", "cbsa_code", zm),
                                ("county", "county_fips", z[z.county_fips.astype(str).str.len() == 5])):
        folder = os.path.join(OUT, "zip", level); os.makedirs(folder, exist_ok=True)
        for code, g in src_.groupby(col):
            df = g.set_index("zip")
            f = pd.DataFrame(index=df.index)
            for c in SUMS: f[c] = df[c]
            f["density"] = (df.households / df.land).where(df.land > 0)
            for k, (n, d) in RATE_PARTS.items(): f[k] = (df[n] / df[d]).where(df[d] > 0)
            f["rent"] = df.rent
            f["est"], f["prev"] = df.zest, df.zest_prev
            # Mostly group quarters (dorms, bases, prisons): households under 15% of residents. Per-household rates
            # there rest on a handful of homes, so these ZIPs are shown but not ranked.
            gq = f.households.fillna(0) < 0.15 * f.population
            ok = (f.population >= MIN_POP) & ~gq
            f = score(f, parts=ZIP_PARTS, mask=ok)
            city = df.city.fillna("")
            out = rows(f, lambda i: f"{i} {city.get(i, '')}".strip())
            for row in out:
                if f.loc[row["id"], "population"] < MIN_POP:
                    row["u"] = 1; row["f"].append(f"Fewer than {MIN_POP} residents, so this ZIP isn't ranked.")
                elif gq.get(row["id"], False):
                    row["u"] = 1; row["f"].append("Mostly group quarters (a campus, base or institution, with few households), so this ZIP isn't ranked.")
                for s in SUBCATS: row["v"].pop(f"category@{s['id']}", None); row["v"].pop(f"comp@{s['id']}", None)
                row["v"].pop("permits_1k", None); row["v"].pop("permits", None)
            json.dump({"level": "zip", "parent": {"level": level, "id": code}, "rows": out},
                      open(os.path.join(folder, f"{code}.json"), "w"), separators=(",", ":"))
            nfiles += 1
    log(f"Wrote {len(dma)} DMAs, {len(met)} metros and {nfiles} ZIP files to {OUT}")


if __name__ == "__main__":
    main()
