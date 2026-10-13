"""Builds the Higher Education Market Analyzer data (Market Potential Scores) into higher-ed/data/.

The analyzer shows colleges and schools where their potential students are and how to focus ad dollars geographically.

Sources, all public downloads with no key (plus Adtaxi's EASI files in data-build/sources):
  - Department of Education IPEDS institution directory (HD file): every college, university, community college and
    career school that takes federal student aid, with its type, level and address. These are the competitors.
  - shared/audience/zip_audience.json: Census ACS ages, education, income, employment and Hispanic origin by ZIP
    (built earlier in the same workflow)
  - data-build/sources/easi_education_spend_dma.csv / _metro.csv: EASI 2025 household spending on college tuition
    (Category Spending); easi_dma_crosswalk.csv ties EASI's DMA names to DMA codes
Geography comes from data-build/geo (ZIP -> metro, DMA).

  python3 data-build/build_higher_ed.py              # live (GitHub Actions)
  python3 data-build/build_higher_ed.py --cache DIR  # read a saved IPEDS file (HD<year>.zip) from DIR (tests)
"""
import argparse, datetime, io, json, os, re, sys, zipfile
import numpy as np
import pandas as pd
from build_healthcare import get, pct, combine, zcta_land
from county_level import county_frame, county_mask, county_checks, county_flag, county_names, mark_unranked, COUNTY_PARTS

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GEO = os.path.join(HERE, "geo")
OUT = os.path.join(ROOT, "higher-ed", "data")
MIN_POP = 500
IPEDS = "https://nces.ed.gov/ipeds/datacenter/data/HD{y}.zip"

# Market Potential Score: where a school's potential students are. Each part is a percentile (0-100).
WEIGHTS = {"demand": 0.40, "category": 0.25, "spend": 0.15, "comp": 0.20}
ZIP_PARTS = ("demand", "spend")      # ZIPs: no EASI spending by ZIP, and most ZIPs have no school at all
PALM_SPRINGS, RIVERSIDE_METRO = "804", "40140"

SUBCATS = [
    {"id": "fouryear", "label": "Four-year colleges and universities", "demand": ["age15_24", "age15_24_share", "inc100_share"]},
    {"id": "community", "label": "Community colleges", "demand": ["age18_24", "hs_only", "hs_share"]},
    {"id": "trade", "label": "Trade and career schools", "demand": ["nodeg18_34", "nodeg_share", "unemp_rate"]},
    {"id": "graduate", "label": "Graduate and professional programs", "demand": ["ba_only", "ba_share", "inc100_share"]},
    {"id": "adult", "label": "Adult and online degree completion", "demand": ["somecol25_64", "somecol_share"]},
]
DEMAND_LABELS = {"age15_24": "Ages 15-24", "age15_24_share": "Share ages 15-24", "inc100_share": "Households earning $100K+",
                 "age18_24": "Ages 18-24", "hs_only": "Adults whose highest education is high school", "hs_share": "Share whose highest is high school",
                 "nodeg18_34": "Adults 18-34 without a college degree", "nodeg_share": "Share of 18-34s without a degree",
                 "unemp_rate": "Unemployment rate", "ba_only": "Adults whose highest degree is a bachelor's",
                 "ba_share": "Share whose highest is a bachelor's", "somecol25_64": "Adults 25-64 with some college, no degree",
                 "somecol_share": "Share of 25-64s with some college, no degree"}
COUNTS = ["population", "households", "age15_24", "age18_24", "hs_only", "nodeg18_34", "ba_only", "somecol25_64", "enr_college"]
# numerator, denominator for each rate (summed over ZIPs, so markets get true rates)
RATE_PARTS = {"age15_24_share": ("age15_24", "acs_pop"), "hs_share": ("hs_only", "adults25"), "nodeg_share": ("nodeg18_34", "pop18_34"),
              "ba_share": ("ba_only", "adults25"), "somecol_share": ("somecol25_64", "pop25_64"), "unemp_rate": ("unemployed", "labor_civ"),
              "inc75_share": ("inc75", "inc_tot"), "inc100_share": ("inc100", "inc_tot"), "hisp_share": ("hispanic", "hisp_tot")}
RATES = list(RATE_PARTS)
ACS_COLS = ["acs_pop", "m15_17", "m18_24", "f15_17", "f18_24", "inc_tot", "inc_75_100", "inc_100_150", "inc_150_200", "inc_200p",
            "adults25", "hs_only", "ba_only", "pop18_34", "nodeg18_34", "pop25_64", "somecol25_64", "labor_civ", "unemployed",
            "hispanic", "hisp_tot", "enr_college"]
# Expected counts of active schools of each type nationwide (IPEDS has about 5,800-6,300 Title IV schools in all)
BENCH = {"all": (5000, 7500), "fouryear": (1800, 3100), "community": (750, 1350), "trade": (1700, 3900), "graduate": (1400, 2600), "adult": (3000, 4600)}
SUB_DEF = {"fouryear": "public and private schools whose highest award is a bachelor's or higher, excluding mainly two-year colleges",
           "community": "public two-year colleges, plus public colleges that are mainly two-year but offer a few bachelor's degrees",
           "trade": "private two-year schools and all schools whose programs run under two years (technical, nursing, cosmetology, CDL and others)",
           "graduate": "schools that award master's, professional or doctoral degrees",
           "adult": "all degree-granting colleges and universities"}


def log(*a): print(*a, flush=True)


def self_test():
    s = pct(pd.Series([10, 20, 30, 40, np.nan]))
    assert list(s[:4]) == [25.0, 50.0, 75.0, 100.0] and np.isnan(s[4]), s
    c = combine([pd.Series([100.0, np.nan]), pd.Series([0.0, 50.0])], [0.40, 0.25])
    assert abs(c[0] - 40 / 0.65) < 1e-9 and c[1] == 50.0, c
    assert abs(sum(WEIGHTS.values()) - 1) < 1e-9, WEIGHTS
    t = pd.DataFrame({"SECTOR": [1, 1, 4, 6, 9, 2], "HLOFFER": [9, 5, 3, 3, 1, 7], "DEGGRANT": [1, 1, 1, 1, 2, 1], "CB": [15, 2, 3, -2, -2, 20]})
    f = classify(t, "CB")
    assert list(f.fouryear) == [True, False, False, False, False, True], f.fouryear.tolist()
    assert list(f.community) == [False, True, True, False, False, False], f.community.tolist()
    assert list(f.trade) == [False, False, False, True, True, False], f.trade.tolist()
    assert list(f.graduate) == [True, False, False, False, False, True], f.graduate.tolist()
    assert list(f.adult) == [True, True, True, True, False, True], f.adult.tolist()
    return "percentile, weighted-average and school-type hand checks reproduce exactly"


def classify(d, cb):
    """Which subcategories each school competes in. cb = the Carnegie basic classification column (or None)."""
    sec, hl = d.SECTOR, d.HLOFFER
    twoyear_carnegie = d[cb].between(1, 14) if cb else pd.Series(False, index=d.index)   # associate's colleges, 2-year special focus,
    out = pd.DataFrame(index=d.index)                                                        # associate's-dominant baccalaureate
    out["fouryear"] = sec.isin([1, 2, 3]) & (hl >= 5) & ~twoyear_carnegie
    out["community"] = (sec == 4) | ((sec == 1) & twoyear_carnegie)
    out["trade"] = sec.isin([5, 6, 7, 8, 9])
    out["graduate"] = sec.isin([1, 2, 3]) & (hl >= 7)
    out["adult"] = sec.isin([1, 2, 3, 4, 5, 6]) & (d.DEGGRANT == 1)
    return out


def load_ipeds(cache, rep):
    this = datetime.date.today().year
    for y in range(this, this - 6, -1):
        name = f"HD{y}.zip"
        if cache:
            p = os.path.join(cache, name)
            if not os.path.exists(p): continue
            blob = open(p, "rb").read()
        else:
            try:
                blob = get(IPEDS.format(y=y), tries=2, timeout=300)
            except Exception as e:
                log(f"IPEDS {y}: not available -> {e}"); continue
        try:
            zf = zipfile.ZipFile(io.BytesIO(blob))
        except zipfile.BadZipFile:
            log(f"IPEDS {y}: the download wasn't a zip file (the site may have sent a web page instead)"); continue
        csvs = sorted([n for n in zf.namelist() if n.lower().endswith(".csv")], key=lambda n: ("_rv" not in n.lower(), n))
        if not csvs: continue
        d = pd.read_csv(zf.open(csvs[0]), dtype=str, encoding="latin-1")
        d.columns = [re.sub(r"^[^A-Z0-9]+", "", c.strip().upper()) for c in d.columns]   # drops a byte-order mark read as text
        rep.append(("IPEDS institution directory", "INFO", f"{y} ({csvs[0]}, {len(d):,} records)"))
        return y, d
    sys.exit("No IPEDS institution directory (HD file) could be downloaded from nces.ed.gov.")


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
    if miss: sys.exit(f"shared/audience/zip_audience.json has no Higher Education columns ({miss[:4]}...); the audience step must run first with the new build_audience.py.")
    acs = acs[["zip"] + ACS_COLS].copy()
    acs["age15_24"] = acs[["m15_17", "m18_24", "f15_17", "f18_24"]].sum(axis=1, min_count=4)
    acs["age18_24"] = acs[["m18_24", "f18_24"]].sum(axis=1, min_count=2)
    acs["inc100"] = acs[["inc_100_150", "inc_150_200", "inc_200p"]].sum(axis=1, min_count=3)
    acs["inc75"] = acs.inc100 + acs.inc_75_100
    z = z.merge(acs, on="zip", how="left")
    z["land"] = z.zip.map(zcta_land(a.cache, rep))          # square miles, for households per square mile

    # IPEDS schools -> ZIP
    y, d = load_ipeds(a.cache, rep)
    need = ["UNITID", "INSTNM", "ZIP", "SECTOR", "HLOFFER", "DEGGRANT", "LATITUDE", "LONGITUD"]
    miss = [c for c in need if c not in d.columns]
    if miss: sys.exit(f"The IPEDS file is missing columns {miss}; it has {list(d.columns)[:20]}")
    for c in ("SECTOR", "HLOFFER", "DEGGRANT", "CYACTIVE", "PSEFLAG", "LATITUDE", "LONGITUD"):
        if c in d.columns: d[c] = pd.to_numeric(d[c], errors="coerce")
    n0 = len(d)
    if "CYACTIVE" in d.columns: d = d[d.CYACTIVE == 1]
    if "PSEFLAG" in d.columns: d = d[d.PSEFLAG == 1]
    d = d[d.SECTOR.between(1, 9)].copy()
    rep.append(("IPEDS schools kept (active, postsecondary, sectors 1-9)", "INFO", f"{len(d):,} of {n0:,} records"))
    cbs = sorted([c for c in d.columns if re.fullmatch(r"C\d\dBASIC", c)])
    cb = cbs[-1] if cbs else None
    if cb: d[cb] = pd.to_numeric(d[cb], errors="coerce")
    rep.append(("Carnegie classification used to separate two-year from four-year public colleges", "INFO", cb or "none in this file; community colleges are public two-year schools only"))
    d["zip"] = d.ZIP.astype(str).str.extract(r"(\d{5})")[0]
    known = set(z.zip)
    hit = d.zip.isin(known)
    # Schools whose ZIP isn't in the ZIP table go to the nearest ZIP center
    zc = z.dropna(subset=["lat", "lon"])
    far = d[~hit & d.LATITUDE.notna() & d.LONGITUD.notna()]
    if len(far):
        la, lo = np.radians(zc.lat.values), np.radians(zc.lon.values)
        for i, r in far.iterrows():
            p1, l1 = np.radians(r.LATITUDE), np.radians(r.LONGITUD)
            h = np.sin((la - p1) / 2) ** 2 + np.cos(p1) * np.cos(la) * np.sin((lo - l1) / 2) ** 2
            d.at[i, "zip"] = zc.zip.values[int(np.argmin(h))]
    placed = d.zip.isin(known)
    rep.append(("IPEDS schools placed in a ZIP", "PASS" if placed.mean() >= 0.98 else "FAIL",
                f"{int(hit.sum()):,} by their own ZIP, {int((placed & ~hit).sum()):,} by nearest ZIP center, {int((~placed).sum()):,} not placed"))
    d = d[placed]
    flags = classify(d, cb)
    d = pd.concat([d, flags], axis=1)
    lo, hi = BENCH["all"]
    rep.append(("Published benchmark: active Title IV schools", "PASS" if lo <= len(d) <= hi else "FAIL", f"{len(d):,} (expected {lo:,}–{hi:,})"))
    for s in SUBCATS:
        n = int(d[s["id"]].sum()); lo, hi = BENCH[s["id"]]
        rep.append((f"Schools: {s['label'].lower()}", "PASS" if lo <= n <= hi else "FAIL", f"{n:,} (expected {lo:,}–{hi:,})"))
        z[f"est@{s['id']}"] = z.zip.map(d[d[s["id"]]].groupby("zip").size()).fillna(0)

    # ---------------- Aggregate ----------------
    EST = [f"est@{s['id']}" for s in SUBCATS]

    def agg(g):
        r = {"population": g.population.sum(), "households": g.households.sum()}
        land = g.land.where(g.land > 0).sum()
        r["density"] = g.households.where(g.land > 0, 0).sum() / land if land > 0 else np.nan
        for c in COUNTS[2:]: r[c] = g[c].sum(min_count=1)
        for k, (n, dn) in RATE_PARTS.items():
            den = g[dn].sum(); r[k] = g[n].sum() / den if den > 0 else np.nan
        for c in EST: r[c] = g[c].sum()
        return r

    def frame(groups):
        return pd.DataFrame.from_dict({k: agg(g) for k, g in groups}, orient="index")

    def score(df, parts=tuple(WEIGHTS), mask=None):
        if mask is None: mask = pd.Series(True, index=df.index)
        P = lambda s: pct(s.where(mask))
        spend = P(df.inc75_share)
        cat = combine([P(df.easi_hh), P(df.easi_total)], [0.5, 0.5]) if "category" in parts and "easi_hh" in df.columns else pd.Series(np.nan, index=df.index)
        dem_pct = {k: P(df[k]) for k in DEMAND_LABELS if k in df.columns}
        for s in SUBCATS:
            i = s["id"]
            df[f"per100k@{i}"] = (df[f"est@{i}"] / df.population * 1e5).where(df.population > 0)
            ins = [dem_pct[k] for k in s["demand"] if k in dem_pct and df[k].notna().any()]
            df[f"demand@{i}"] = combine(ins, [1] * len(ins)) if ins else np.nan
            df[f"category@{i}"], df[f"spend@{i}"] = cat, spend
            df[f"comp@{i}"] = P(-df[f"per100k@{i}"]) if "comp" in parts else np.nan
            cols = [df[f"{c}@{i}"] for c in parts]
            full = pd.concat(cols, axis=1).notna().all(axis=1)
            df[f"score@{i}"] = combine(cols, [WEIGHTS[c] for c in parts]).where(full & mask).round(1)
            for c in WEIGHTS: df[f"{c}@{i}"] = df[f"{c}@{i}"].round(1)
            if "comp" in parts:
                under = (df[f"demand@{i}"] >= 70) & (P(df[f"per100k@{i}"]) <= 30)
                known_ = df[f"demand@{i}"].notna() & df[f"per100k@{i}"].notna() & mask
                df[f"under@{i}"] = np.where(under & known_, "Yes", np.where(known_, "No", None))
        return df

    # EASI college tuition. Totals = per-household spending x this site's households (same boundaries as everything else).
    src = os.path.join(HERE, "sources")
    sd = pd.read_csv(os.path.join(src, "easi_education_spend_dma.csv"))
    xw = pd.read_csv(os.path.join(src, "easi_dma_crosswalk.csv"), dtype={"dma_code": str})
    sd = sd.merge(xw[["easi_market", "dma_code"]], left_on="market", right_on="easi_market", how="left")
    if sd.dma_code.isna().any(): sys.exit("easi_dma_crosswalk.csv is missing EASI DMAs: " + ", ".join(sd[sd.dma_code.isna()].market))
    us_hh = sd.college_tuition_total.sum() / sd.households.sum()
    sm = pd.read_csv(os.path.join(src, "easi_education_spend_metro.csv"))
    em = pd.read_csv(os.path.join(src, "easi_metro_2025.csv"), dtype={"cbsa_code": str})
    key = lambda t: re.sub(r"[^a-z0-9]", "", str(t).lower())
    sm["cbsa_code"] = sm.market.map(key).map(dict(zip(em.metro.map(key), em.cbsa_code)))
    hh_dma = sd.set_index("dma_code").college_tuition_per_hh
    hh_met = sm.dropna(subset=["cbsa_code"]).set_index("cbsa_code").college_tuition_per_hh
    if PALM_SPRINGS not in hh_dma.index and RIVERSIDE_METRO in hh_met.index:
        hh_dma.loc[PALM_SPRINGS] = hh_met.loc[RIVERSIDE_METRO]
        rep.append(("EASI college tuition: Palm Springs", "INFO", "EASI includes Palm Springs in Los Angeles; the provisional Palm Springs DMA uses the Riverside–San Bernardino metro's per-household spending"))
    rep.append(("EASI U.S. college tuition per household", "INFO", f"${us_hh:,.2f}"))

    def add_easi(df, per_hh, label):
        df["easi_hh"] = df.index.map(per_hh).astype(float)
        df["easi_total"] = df.easi_hh * df.households
        df["easi_idx"] = (df.easi_hh / us_hh * 100).round(0)
        miss = [str(i) for i in df.index if df.at[i, "easi_hh"] != df.at[i, "easi_hh"]]
        rep.append((f"EASI college tuition matched to {label}", "PASS" if not miss else "FAIL", f"{len(df) - len(miss)} of {len(df)}" + (f"; missing {miss[:8]}" if miss else "")))

    zd = z[z.dma_code != "0"]
    dma = frame(zd.groupby("dma_code")); add_easi(dma, hh_dma, "DMAs"); dma = score(dma)
    zm = z[z.cbsa_code.isin(metros)]
    met = frame(zm.groupby("cbsa_code")); add_easi(met, hh_met, "metros"); met = score(met)
    cty = county_frame(z, frame); cty = score(cty, parts=COUNTY_PARTS, mask=county_mask(cty))
    us = frame([("us", z)])
    for s in SUBCATS: us[f"per100k@{s['id']}"] = us[f"est@{s['id']}"] / us.population * 1e5
    us["easi_hh"], us["easi_total"], us["easi_idx"] = us_hh, us_hh * us.households, 100.0
    r_ = dma.easi_total.sum() / sd.college_tuition_total.sum()
    rep.append(("EASI college tuition total, DMAs vs. EASI's own total", "PASS" if 0.95 <= r_ <= 1.05 else "FAIL", f"{r_:.1%} of EASI's ${sd.college_tuition_total.sum() / 1e9:,.1f}B"))

    # ---------------- Checks ----------------
    for name, df in (("DMA", dma), ("Metro", met)):
        sc = df[[f"score@{s['id']}" for s in SUBCATS]]
        bad = int(((sc < 0) | (sc > 100)).sum().sum())
        rep.append((f"{name} scores within 0–100", "PASS" if bad == 0 else "FAIL", f"{bad} out of range; {int(sc.notna().sum().sum()):,} scores computed, {int(sc.isna().sum().sum()):,} not computed (missing input)"))
    for s in SUBCATS:
        k = f"est@{s['id']}"
        tot_d, tot_z = dma[k].sum(), z.loc[z.dma_code != "0", k].sum()
        if s["id"] == "fouryear":
            rep.append(("DMA roll-up matches school list", "PASS" if tot_d == tot_z else "FAIL", f"DMAs {int(tot_d):,} vs schools {int(tot_z):,} (schools outside any DMA: {int(z.loc[z.dma_code == '0', k].sum())})"))
    for k, lo, hi in (("age15_24_share", .11, .16), ("hs_share", .20, .32), ("ba_share", .17, .26), ("somecol_share", .14, .25), ("unemp_rate", .03, .08)):
        v_ = us[k].iloc[0]
        rep.append((f"U.S. {DEMAND_LABELS.get(k, k).lower()}", "PASS" if lo <= v_ <= hi else "FAIL", f"{v_:.1%} (expected {lo:.0%}–{hi:.0%})"))

    county_checks(rep, cty, [x["id"] for x in SUBCATS])
    failed = [r for r in rep if r[1] == "FAIL"]
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "higher_ed_report.md"), "w") as f:
        f.write(f"# Higher Education data check report\n\nBuilt {built}. Result: **{'FAILED' if failed else 'PASSED'}**\n\n| Check | Result | Detail |\n| --- | --- | --- |\n")
        for r in rep: f.write(f"| {r[0]} | {r[1]} | {r[2]} |\n")
    for r in rep: log(f"[{r[1]}] {r[0]}: {r[2]}")
    if failed: sys.exit("A check failed; the Higher Education data was not updated. See higher-ed/data/higher_ed_report.md.")

    # ---------------- Write ----------------
    keep = COUNTS + RATES + ["density", "easi_hh", "easi_total", "easi_idx"]
    per_sub = ["score", "demand", "category", "spend", "comp", "under", "est", "per100k"]
    SCORE_KEYS = ("score", "demand", "category", "spend", "comp", "est")
    INTS = COUNTS + ["easi_total"]

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
        if str(idx) == "804": f.append("Palm Springs boundary is provisional: 28 Coachella Valley ZIPs assigned by Adtaxi, pending a Nielsen check. EASI college tuition uses the Riverside–San Bernardino metro rate.")
        return f

    meta = {"built": built, "ipedsYear": y, "acsYears": aud["meta"]["acsYears"]}
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
            for c in COUNTS: f[c] = df[c]
            f["density"] = (df.households / df.land).where(df.land > 0)
            for k, (n, dn) in RATE_PARTS.items(): f[k] = (df[n] / df[dn]).where(df[dn] > 0)
            for c in EST: f[c] = df[c]
            ok = f.population >= MIN_POP
            f = score(f, parts=ZIP_PARTS, mask=ok)
            city = df.city.fillna("")
            out = rows(f, lambda i: f"{i} {city.get(i, '')}".strip())
            for row in out:
                if f.loc[row["id"], "population"] < MIN_POP:
                    row["u"] = 1; row["f"].append(f"Fewer than {MIN_POP} residents, so this ZIP isn't ranked.")
                for s in SUBCATS:
                    for p in ("category", "comp", "per100k"): row["v"].pop(f"{p}@{s['id']}", None)
            json.dump({"level": "zip", "parent": {"level": level, "id": code}, "rows": out},
                      open(os.path.join(folder, f"{code}.json"), "w"), separators=(",", ":"))
            nfiles += 1
    log(f"Wrote {len(dma)} DMAs, {len(met)} metros and {nfiles} ZIP files to {OUT}")


if __name__ == "__main__":
    main()
