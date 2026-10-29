"""Builds the Financial Market Analyzer data (Market Potential Scores) into financial/data/, plus the radius tool's
financial columns in shared/audience/zip_audience_fin.json.

The analyzer shows financial advertisers where their likely customers are and how to focus ad dollars geographically,
for five lines: tax preparation, wealth management, retirement planning, home purchase mortgages, and refinance and
home equity.

Sources, all public with no key, already built into the repo:
  - data-build/master/zip_irs.csv.gz: IRS Statistics of Income by ZIP (paid-preparer returns, Earned Income Credit,
    dividends, capital gains, IRA and pension distributions, self-employment, returns with AGI of $200K+)
  - data-build/master/zip_hmda.csv.gz: HMDA owner-occupied mortgage originations by ZIP (build_hmda.py)
  - data-build/master/zip_acs.csv.gz: Census ACS 5-year (ages 50-64, mortgage status, movers)
  - shared/audience/zip_audience*.json: Census ACS income, ages, home values, renter income (built earlier in the workflow)
  - Census County and ZIP Business Patterns (downloaded): tax preparers, investment advisers and portfolio managers,
    mortgage lenders and brokers
Geography comes from data-build/geo (ZIP -> county, metro, DMA). Race, ethnicity, sex and age-of-borrower fields are
not used to score any area: these are credit and financial products, covered by fair-lending rules.

  python3 data-build/build_financial.py              # live (GitHub Actions)
  python3 data-build/build_financial.py --cache DIR  # read saved downloads from DIR (tests)
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
OUT = os.path.join(ROOT, "financial", "data")
AUD = os.path.join(ROOT, "shared", "audience")
MIN_POP = 500

# Market Potential Score. Each part is a percentile (0-100). Category Spending (EASI) is added once Adtaxi's files are in
# data-build/sources; until then scores blend the other parts, re-weighted to 100%.
WEIGHTS = {"demand": 0.40, "category": 0.25, "spend": 0.15, "comp": 0.20}
# EASI 2025 measures used as Category Spending, by line (Adtaxi's files in data-build/sources/easi_finance_spend_*.csv)
EASI = {"tax": ("acct_fees", "Accounting fees"),
        "wealth": ("stocks", "Value of stocks, bonds and mutual funds"),
        "retire": ("ret_contrib", "Contributions to retirement plans"),
        "purchase": ("home_purchase", "Purchase price of property (owned home)"),
        "refi": ("home_value", "Estimated market value of owned home"),
        "bank": ("deposits", "Value of savings, checking, money market and CDs"),
        "cu": ("deposits", "Value of savings, checking, money market and CDs")}
# Every EASI measure loaded (each once), including ones shown but not scored
EASI_MEASURES = list(dict.fromkeys(list(EASI.values()) + [
    ("bank_fees", "Checking accounts and other bank service charges"), ("ret_value", "Value of retirement plans"),
    ("net_property", "Change in net property holdings (owned home)"),
    ("mortg_principal", "Change in mortgage principal (owned home)")]))
PALM_SPRINGS, RIVERSIDE_METRO = "804", "40140"
NAICS = {"tax": ["541213"], "advice": ["523920", "523930"], "mortgage": ["522292", "522310"], "bank": ["522110"], "cu": ["522130"]}
SUBCATS = [
    {"id": "tax", "label": "Tax preparation", "naics": "tax", "spend": False,
     "demand": ["prep", "prep_share", "eitc_share"]},
    {"id": "wealth", "label": "Wealth management", "naics": "advice",
     "demand": ["div", "div_share", "cg_share", "hi200_share"]},
    {"id": "retire", "label": "Retirement planning", "naics": "advice",
     "demand": ["a50_64", "a50_64_share", "ira_share", "pens_share"]},
    {"id": "purchase", "label": "Home purchase mortgage", "naics": "mortgage",
     "demand": ["purch", "purch_rate", "rent75", "mover_share"]},
    {"id": "refi", "label": "Refinance and home equity", "naics": "mortgage",
     "demand": ["refieq", "refieq_rate", "mortg", "mortg_share"]},
    {"id": "bank", "label": "Banks", "naics": "bank",
     "demand": ["adults", "mover_share", "selfemp_share"]},
    {"id": "cu", "label": "Credit unions", "naics": "cu",
     "demand": ["adults", "mover_share"]},
]
DEMAND_LABELS = {
    "prep": "Returns with a paid preparer", "prep_share": "Share of returns with a paid preparer",
    "eitc_share": "Share of returns claiming the Earned Income Credit",
    "div": "Returns with dividend income", "div_share": "Share of returns with dividends",
    "cg_share": "Share of returns with capital gains", "hi200_share": "Share of returns with income of $200K+",
    "a50_64": "Adults 50–64", "a50_64_share": "Share of adults who are 50–64",
    "ira_share": "Share of returns with IRA distributions", "pens_share": "Share of returns with pension or annuity income",
    "purch": "Home purchase loans", "purch_rate": "Home purchase loans per 1,000 households",
    "rent75": "Renter households earning $75K+", "mover_share": "Share who moved in the past year",
    "refieq": "Refinance and home equity loans", "refieq_rate": "Refinance and home equity loans per 1,000 owner homes",
    "mortg": "Owner homes with a mortgage", "mortg_share": "Share of owner homes with a mortgage",
    "adults": "Adults 18+", "selfemp_share": "Share of returns with business income"}
COUNTS = ["population", "households", "adults", "a50_64", "a65p", "prep", "eitc", "div", "cg", "ira", "pens", "selfemp",
          "returns", "purch", "refi", "equity", "refieq", "mortg", "rent75"]
# rate: numerator, denominator (summed over ZIPs, so markets get true rates; IRS rates use only ZIPs with IRS data)
RATE_PARTS = {"prep_share": ("prep", "returns"), "eitc_share": ("eitc", "returns"), "div_share": ("div", "returns"),
              "cg_share": ("cg", "returns"), "hi200_share": ("hi200", "returns"), "ira_share": ("ira", "returns"),
              "pens_share": ("pens", "returns"), "selfemp_share": ("selfemp", "returns"),
              "a50_64_share": ("a50_64", "adults18"), "a65p_share": ("a65p", "acs_pop"),
              "mover_share": ("movers", "mob_tot"), "mortg_share": ("mortg", "own_units"),
              "inc75_share": ("inc75", "inc_tot"), "val300_share": ("val300", "val_tot"), "rent75_share": ("rent75", "rinc_tot")}
PER_K = {"purch_rate": ("purch", "households", 1000), "refieq_rate": ("refieq", "own_units", 1000)}
RATES = list(RATE_PARTS) + list(PER_K)
SUMS = ["population", "households", "adults18", "acs_pop", "a50_64", "a65p", "returns", "prep", "eitc", "div", "cg", "hi200", "ira",
        "pens", "selfemp", "purch", "refi", "equity", "refieq", "mortg", "own_units", "movers", "mob_tot", "inc75", "inc_tot",
        "val300", "val_tot", "rent75", "rinc_tot"]
IRS_COLS = {"irs_n1": "returns", "irs_prep": "prep", "irs_n59660": "eitc", "irs_n00600": "div", "irs_n01000": "cg",
            "irs_n01400": "ira", "irs_n01700": "pens", "irs_n00900": "selfemp", "irs_n1_stub6": "hi200"}
IRS_SHARES = ["prep", "eitc", "div", "cg", "hi200", "ira", "pens", "selfemp"]


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
    need = ["acs_pop", "adults18", "a65p", "inc_tot", "inc_75_100", "inc_100_150", "inc_150_200", "inc_200p", "val300", "val_tot"]
    miss = [c for c in need if c not in a.columns]
    if miss: sys.exit(f"shared/audience/zip_audience.json lacks {miss}; the audience step must run first.")
    a["inc75"] = a[["inc_75_100", "inc_100_150", "inc_150_200", "inc_200p"]].sum(axis=1, min_count=4)
    z = z.merge(a[["zip", "acs_pop", "adults18", "a65p", "inc75", "inc_tot", "val300", "val_tot"]], on="zip", how="left")

    apt = pd.DataFrame(json.load(open(os.path.join(AUD, "zip_audience_apt.json")))["cols"])
    apt["rent75"] = apt[["rinc_75_100", "rinc_100_150", "rinc_150p"]].sum(axis=1, min_count=3)
    z = z.merge(apt[["zip", "rent75", "rinc_tot"]], on="zip", how="left")

    acs_cols = [f"B01001_E{n:03d}" for n in list(range(16, 20)) + list(range(40, 44))] + \
               ["B25081_E001", "B25081_E002", "B25081_E008", "B25081_E009", "B07003_E001", "B07003_E004"]
    acs = pd.read_csv(os.path.join(MASTER, "zip_acs.csv.gz"), dtype={"zip": str}, usecols=["zip"] + acs_cols)
    m = pd.DataFrame({"zip": acs.zip})
    m["a50_64"] = acs[[f"B01001_E{n:03d}" for n in list(range(16, 20)) + list(range(40, 44))]].sum(axis=1, min_count=8)
    m["own_units"] = acs.B25081_E001
    m["mortg"] = acs.B25081_E002            # with a mortgage (E002 + E009 = all owner homes; E008, a home equity loan
                                            # with no first mortgage, sits inside E009 "without a mortgage", so it isn't added)
    m["mortg_free"] = acs.B25081_E009
    m["mob_tot"] = acs.B07003_E001
    m["movers"] = acs.B07003_E001 - acs.B07003_E004
    z = z.merge(m, on="zip", how="left")

    irs = pd.read_csv(os.path.join(MASTER, "zip_irs.csv.gz"), dtype={"zip": str}, usecols=["zip"] + list(IRS_COLS))
    irs = irs.rename(columns=IRS_COLS)
    z = z.merge(irs, on="zip", how="left")

    hp = os.path.join(MASTER, "zip_hmda.csv.gz")
    if not os.path.exists(hp): sys.exit("data-build/master/zip_hmda.csv.gz is missing: run the \"Build HMDA mortgage data\" action first.")
    h = pd.read_csv(hp, dtype={"zip": str}).rename(columns={"hmda_purch": "purch", "hmda_refi": "refi", "hmda_equity": "equity"})
    z = z.merge(h[["zip", "purch", "refi", "equity"]], on="zip", how="left")
    hf = json.load(open(os.path.join(MASTER, "hmda_facts.json")))
    # HMDA covers ZCTAs; ZIPs with ACS housing but no loans had no reported originations
    has_acs = z.own_units.notna()
    for c in ("purch", "refi", "equity"): z.loc[has_acs, c] = z.loc[has_acs, c].fillna(0)
    z["refieq"] = z.refi + z.equity
    # Bank and credit union branches (build_branches.py); shown on the map, not scored. Optional: skipped if not built yet.
    bp = os.path.join(MASTER, "zip_branches.csv.gz")
    if os.path.exists(bp):
        br = pd.read_csv(bp, dtype={"zip": str})
        z = z.merge(br[["zip", "bank_br", "bank_dep", "cu_br"]], on="zip", how="left")
        for c in ("bank_br", "bank_dep", "cu_br"): z[c] = z[c].fillna(0)
        bf = json.load(open(os.path.join(MASTER, "branches_facts.json")))
        rep.append(("Bank and credit union branches", "INFO", f"FDIC {bf['fdicYear']}: {bf['bankBranches']:,} bank branches; NCUA {bf['ncuaQuarter']}: {bf['cuBranches']:,} credit union branches"))
    else:
        rep.append(("Bank and credit union branches", "INFO", "not built yet (run the \"Build bank and credit union branches\" action)"))
    irs_facts = open(os.path.join(MASTER, "master_report.md")).read()
    ty = re.search(r"IRS income tax statistics \| built \| tax year (\d{4})", irs_facts)
    return z, aud, hf, (ty.group(1) if ty else "")


def main():
    ap_ = argparse.ArgumentParser(); ap_.add_argument("--cache"); a = ap_.parse_args()
    rep = [("Formula tests", "PASS", self_test())]
    built = datetime.date.today().isoformat()
    z, aud, hf, irs_year = load_inputs(rep)
    BR = [c for c in ("bank_br", "bank_dep", "cu_br") if c in z.columns]
    rep.append(("HMDA mortgage data", "INFO", f"{hf['year']}: {hf['purchase']:,} purchase, {hf['refinance']:,} refinance and {hf['equity']:,} home equity loans on owner-occupied homes; "
                f"{hf['no_tract_share']:.1%} had no census tract and aren't placed"))
    rep.append(("IRS tax year", "INFO", irs_year or "unknown"))
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
    bench = {"tax": (18000, 60000), "advice": (25000, 90000), "mortgage": (10000, 40000), "bank": (50000, 100000), "cu": (10000, 30000)}
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
        for c in BR: r[c] = g[c].sum()
        land = g.land.where(g.land > 0).sum()
        r["density"] = g.households.where(g.land > 0, 0).sum() / land if land > 0 else np.nan
        irs_ok = g.returns.notna()
        for k, (n, d) in RATE_PARTS.items():
            if n in IRS_SHARES:
                den = g.returns[irs_ok].sum(); r[k] = g[n][irs_ok].sum() / den if den > 0 else np.nan
            else:
                ok = g[n].notna() & g[d].notna(); den = g[d][ok].sum()
                r[k] = g[n][ok].sum() / den if den > 0 else np.nan
        for k, (n, d, mult) in PER_K.items():
            ok = g[n].notna() & g[d].notna(); den = g[d][ok].sum()
            r[k] = g[n][ok].sum() / den * mult if den > 0 else np.nan
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
            df[f"score@{i}"] = combine(cols, [WEIGHTS[c] for c in use]).where(full & mask).round(3)
            for c in WEIGHTS: df[f"{c}@{i}"] = df[f"{c}@{i}"].round(2)
            under = (df[f"demand@{i}"] >= 70) & (P(df[f"per10k@{i}"]) <= 30)
            known = df[f"demand@{i}"].notna() & df[f"per10k@{i}"].notna() & mask
            if "comp" not in parts: known &= df[f"per10k@{i}"] > 0   # ZIPs: a 0 count may be 1-2 hidden by Census
            df[f"under@{i}"] = np.where(under & known, "Yes", np.where(known, "No", None))
        return df

    # EASI: per-household spending by DMA and metro; totals = per household x this site's households
    src = os.path.join(HERE, "sources")
    sd = pd.read_csv(os.path.join(src, "easi_finance_spend_dma.csv"))
    xw = pd.read_csv(os.path.join(src, "easi_dma_crosswalk.csv"), dtype={"dma_code": str})
    sd = sd.merge(xw[["easi_market", "dma_code"]], left_on="market", right_on="easi_market", how="left")
    if sd.dma_code.isna().any(): sys.exit("easi_dma_crosswalk.csv is missing EASI DMAs: " + ", ".join(sd[sd.dma_code.isna()].market))
    sm = pd.read_csv(os.path.join(src, "easi_finance_spend_metro.csv"))
    em = pd.read_csv(os.path.join(src, "easi_metro_2025.csv"), dtype={"cbsa_code": str})
    key = lambda t: re.sub(r"[^a-z0-9]", "", str(t).lower())
    sm["cbsa_code"] = sm.market.map(key).map(dict(zip(em.metro.map(key), em.cbsa_code)))
    us_hh = {}
    for e, lab in EASI_MEASURES:
        us_hh[e] = sd[f"{e}_total"].sum() / sd.households.sum()
        rep.append((f"EASI U.S. {lab.lower()} per household", "INFO", f"${us_hh[e]:,.2f}"))

    def add_easi(df, table, idcol, label):
        t = table.dropna(subset=[idcol]).set_index(idcol)
        for e, lab in EASI_MEASURES:
            per = t[f"{e}_per_hh"].copy()
            if idcol == "dma_code" and PALM_SPRINGS not in per.index:
                pm = sm.dropna(subset=["cbsa_code"]).set_index("cbsa_code")[f"{e}_per_hh"]
                if RIVERSIDE_METRO in pm.index: per.loc[PALM_SPRINGS] = pm.loc[RIVERSIDE_METRO]
            df[f"easi_{e}_hh"] = df.index.map(per).astype(float)
            df[f"easi_{e}_total"] = df[f"easi_{e}_hh"] * df.households
            df[f"easi_{e}_idx"] = (df[f"easi_{e}_hh"] / us_hh[e] * 100).round(0)
        miss = [str(i) for i in df.index if df.at[i, f"easi_{e}_hh"] != df.at[i, f"easi_{e}_hh"]]
        rep.append((f"EASI finance matched to {label}", "PASS" if len(miss) <= (2 if label == "metros" else 0) else "FAIL",
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
    for e, lab in EASI_MEASURES:
        us[f"easi_{e}_hh"], us[f"easi_{e}_idx"] = us_hh[e], 100.0
        us[f"easi_{e}_total"] = us_hh[e] * us.households
        r_ = dma[f"easi_{e}_total"].sum() / sd[f"{e}_total"].sum()
        rep.append((f"EASI {lab.lower()}, DMAs vs. EASI's own total", "PASS" if 0.95 <= r_ <= 1.05 else "FAIL", f"{r_:.1%}"))

    # ---------------- Checks ----------------
    U = lambda k: float(us[k].iloc[0])
    for k, lo, hi in (("prep_share", .40, .65), ("eitc_share", .10, .22), ("div_share", .12, .30), ("cg_share", .10, .28),
                      ("hi200_share", .04, .12), ("ira_share", .08, .20), ("pens_share", .12, .25), ("mover_share", .08, .16),
                      ("mortg_share", .55, .70), ("inc75_share", .40, .60), ("a50_64_share", .20, .30)):
        rep.append((f"U.S. {DEMAND_LABELS.get(k, k).lower()}", "PASS" if lo <= U(k) <= hi else "FAIL", f"{U(k):.1%} (expected {lo:.0%}–{hi:.0%})"))
    r_ = U("returns") / U("households")
    rep.append(("IRS returns vs. households", "PASS" if 1.0 <= r_ <= 1.4 else "FAIL", f"{r_:.2f} returns per household (expected 1.0–1.4)"))
    pl = U("purch") / max(1, hf["purchase"])
    rep.append(("HMDA purchase loans placed in ZIPs vs. national total", "PASS" if .95 <= pl <= 1.0001 else "FAIL", f"{pl:.1%}"))
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
    with open(os.path.join(OUT, "financial_report.md"), "w") as f:
        f.write(f"# Financial data check report\n\nBuilt {built}. Result: **{'FAILED' if failed else 'PASSED'}**\n\n| Check | Result | Detail |\n| --- | --- | --- |\n")
        for r in rep: f.write(f"| {r[0]} | {r[1]} | {r[2]} |\n")
    for r in rep: log(f"[{r[1]}] {r[0]}: {r[2]}")
    if failed: sys.exit("A check failed; the Financial data was not updated. See financial/data/financial_report.md.")

    # ---------------- Write ----------------
    keep = COUNTS + BR + RATES + ["density"] + [f"easi_{e}_{k}" for e, _ in EASI_MEASURES for k in ("hh", "total", "idx")]
    per_sub = ["score", "demand", "category", "spend", "comp", "under", "est", "per10k", "growth"]
    SCORE_KEYS = ("score", "demand", "category", "spend", "comp")
    INTS = set(COUNTS) | set(BR) | {"est"} | {f"easi_{e}_total" for e, _ in EASI_MEASURES}

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
                        x = clean(r[k]); v[k] = (round(x, 3 if p == "score" else 2) if p in SCORE_KEYS else int(round(x))) if (p in SCORE_KEYS or p == "est") and x is not None else x   # scores to two decimals so ranks don't tie
            v = {k: x for k, x in v.items() if x is not None}
            out.append({"id": str(idx), "name": names(idx), "v": v, "f": flags_fn(idx, r) if flags_fn else []})
        return out

    dname = dma_list.set_index("dma_code").dma_name
    tidy = lambda n: re.sub(r"(, )([A-Za-z]{2})\b", lambda m: m.group(1) + m.group(2).upper(), str(n).title())
    mname = met_list.set_index("cbsa_code").cbsa_name

    def flags(idx, r):
        return ["Palm Springs boundary is provisional: 28 Coachella Valley ZIPs assigned by Adtaxi, pending a Nielsen check."] if str(idx) == "804" else []

    meta = {"built": built, "cbpYear": y, "acsYears": aud["meta"]["acsYears"], "irsYear": irs_year, "hmdaYear": hf["year"]}
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
    for c in BR: zf[c] = zz[c]
    zf["density"] = (zz.households / zz.land).where(zz.land > 0)
    for k, (n, d) in RATE_PARTS.items(): zf[k] = (zz[n] / zz[d]).where(zz[d] > 0)
    for k, (n, d, mult) in PER_K.items(): zf[k] = (zz[n] / zz[d] * mult).where(zz[d] > 0)
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

    # Radius tool columns (counts by ZIP; the tool turns them into shares)
    rz = z[z.acs_pop.notna() | z.returns.notna()].copy()
    cols = {"zip": rz.zip.tolist()}
    for c in ["returns"] + IRS_SHARES + ["own_units", "mortg", "mortg_free", "movers", "mob_tot"]:
        cols[c] = [None if pd.isna(x) else int(round(x)) for x in rz[c]]
    json.dump({"meta": {"built": built, "acsYears": aud["meta"]["acsYears"], "irsYear": irs_year}, "cols": cols},
              open(os.path.join(AUD, "zip_audience_fin.json"), "w"), separators=(",", ":"))
    log(f"Wrote radius columns for {len(rz):,} ZIPs")


if __name__ == "__main__":
    main()
