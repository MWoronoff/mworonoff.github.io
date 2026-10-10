"""Builds the Healthcare Market Analyzer data (piece 1: Market Potential Scores) into healthcare/data/.

The analyzer shows healthcare advertisers where their customers are and how to focus ad dollars geographically.

Sources, all public downloads with no key:
  - Census ZIP Business Patterns (detail by industry): healthcare business counts per ZIP, latest year and the year before
  - Census County Business Patterns: payroll per business by county (Spending Power)
  - CDC PLACES (ZCTA and county, GIS-friendly files on data.cdc.gov): adult health measures (Consumer Demand)
  - shared/audience/zip_audience.json: Census ACS ages and income by ZIP (built earlier in the same workflow)
  - data-build/sources/easi_metro_2025.csv: Adtaxi's EASI 2025 metro health-condition layer (Metro view only)
  - data-build/sources/easi_healthcare_spend_dma.csv / _metro.csv: Adtaxi's EASI 2025 household healthcare spending
    (Category Spending); easi_dma_crosswalk.csv ties EASI's DMA names to DMA codes
Geography comes from data-build/geo (ZIP -> county, metro, DMA).

  python3 data-build/build_healthcare.py              # live (GitHub Actions)
  python3 data-build/build_healthcare.py --cache DIR  # read saved downloads from DIR (tests)
"""
import argparse, datetime, io, json, os, re, sys, time, urllib.parse, urllib.request, zipfile
import warnings
import numpy as np
import pandas as pd
warnings.simplefilter("ignore", pd.errors.PerformanceWarning)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GEO = os.path.join(HERE, "geo")
OUT = os.path.join(ROOT, "healthcare", "data")
UA = {"User-Agent": "Mozilla/5.0 (Adtaxi analyzer data build; github.com/MWoronoff)"}
CBP = "https://www2.census.gov/programs-surveys/cbp/datasets/{y}/{f}"
MIN_POP = 500
# Market Potential Score: where a healthcare advertiser's customers are. Each part is a percentile (0-100).
WEIGHTS = {"demand": 0.40, "category": 0.25, "spend": 0.15, "comp": 0.20}
ZIP_PARTS = ("demand", "spend")      # ZIPs: no EASI spending by ZIP, and ZIP business counts are suppressed under 3
EASI_SPEND = {"med": ("medical_services", "Medical services"), "rx": ("prescription_drugs", "Prescription drugs")}
PALM_SPRINGS, LA_DMA, RIVERSIDE_METRO = "804", "803", "40140"

# ---------------- Subcategories ----------------
# naics: industries counted as prospect businesses. demand: (input key, weight) pairs, defined in DEMAND_INPUTS below.
SUBCATS = [
    {"id": "urgent",  "label": "Urgent and emergency care", "naics": ["621493"],
     "demand": ["population", "kids_share", "fairpoor"]},
    {"id": "pharmacy", "label": "Pharmacy", "naics": ["456110"], "easi": "rx",
     "demand": ["a65p", "diabetes", "bphigh"]},
    {"id": "dental", "label": "Dental", "naics": ["621210"],
     "demand": ["adults", "inc75_share", "nodental"]},
    {"id": "hearing", "label": "Hearing and audiology", "naics": ["621340", "456199"],
     "demand": ["a65p", "hearing"],
     "note": "Business counts include offices of physical, occupational and speech therapists and audiologists (one Census industry) plus health and personal care stores; the provider-level Prospect List narrows this to audiologists and hearing aid specialists."},
    {"id": "eye", "label": "Eye care", "naics": ["621320", "456130"],
     "demand": ["a45p", "vision", "diabetes"]},
    {"id": "chiro", "label": "Chiropractic and physical therapy", "naics": ["621310", "621340"],
     "demand": ["a25_64", "arthritis", "obesity"]},
    {"id": "behavioral", "label": "Behavioral health", "naics": ["621330", "621420"],
     "demand": ["adults", "depression", "mhlth"]},
    {"id": "medspa", "label": "Med spa and aesthetics", "naics": ["621111"],
     "demand": ["a30_64", "inc150_share"],
     "note": "Census counts dermatology and plastic surgery practices together with all other physician offices; the provider-level Prospect List separates them."},
    {"id": "senior", "label": "Senior and home care", "naics": ["621610", "623312"],
     "demand": ["a65p", "a75p", "indeplive"]},
]
OLD_NAICS = {"446110": "456110", "446130": "456130", "446199": "456199"}   # 2017 codes used before the 2022 NAICS

# PLACES measures (crude prevalence among adults). "invert" turns a positive measure into a need (no dental visit).
PLACES = {"fairpoor": ("GHLTH", False), "diabetes": ("DIABETES", False), "bphigh": ("BPHIGH", False),
          "nodental": ("DENTAL", True), "hearing": ("HEARING", False), "vision": ("VISION", False),
          "arthritis": ("ARTHRITIS", False), "obesity": ("OBESITY", False), "depression": ("DEPRESSION", False),
          "mhlth": ("MHLTH", False), "indeplive": ("INDEPLIVE", False)}
DEMAND_LABELS = {"population": "Population", "adults": "Adults 18+", "a65p": "Age 65+", "a75p": "Age 75+", "a45p": "Age 45+",
                 "a25_64": "Adults 25–64", "a30_64": "Adults 30–64", "kids_share": "Households with children",
                 "inc75_share": "Households $75K+", "inc150_share": "Households $150K+",
                 "fairpoor": "Fair or poor health", "diabetes": "Diabetes", "bphigh": "High blood pressure",
                 "nodental": "No dental visit in past year", "hearing": "Hearing disability", "vision": "Vision disability",
                 "arthritis": "Arthritis", "obesity": "Obesity", "depression": "Depression",
                 "mhlth": "Frequent mental distress", "indeplive": "Independent-living disability"}
RATES = ["kids_share", "inc75_share", "inc150_share"] + list(PLACES)
EST_NOTE = ("CDC doesn't publish health measures here, so they're estimated from local age, income and education, "
            "based on how those measures vary in the states CDC does cover. A measure that can't be estimated reliably "
            "shows No data. See How scores work.")


def log(*a): print(*a, flush=True)


# ---------------- Downloads ----------------
def get(url, tries=4, timeout=600):
    req = urllib.request.Request(url, headers=UA)
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404 or i == tries - 1: raise RuntimeError(f"HTTP {e.code} for {url}")
        except Exception as e:
            if i == tries - 1: raise RuntimeError(f"{type(e).__name__} for {url}: {e}")
        time.sleep(10 * (i + 1))


def fetch(name, url, cache):
    if cache:
        p = os.path.join(cache, name)
        if not os.path.exists(p): raise RuntimeError(f"test cache has no {name}")
        return open(p, "rb").read()
    log(f"Downloading {url}")
    return get(url)


def read_zip_table(blob, usecols):
    z = zipfile.ZipFile(io.BytesIO(blob))
    member = [n for n in z.namelist() if n.lower().endswith((".txt", ".csv"))][0]
    df = pd.read_csv(z.open(member), dtype=str, encoding="latin-1")
    df.columns = [c.strip().lower() for c in df.columns]
    missing = [c for c in usecols if c not in df.columns]
    if missing: raise RuntimeError(f"{member} is missing columns {missing}; it has {list(df.columns)[:15]}")
    return df[usecols]


def cbp_years(cache):
    """Latest two consecutive years with a ZIP detail file."""
    this = datetime.date.today().year
    for y in range(this - 1, this - 6, -1):
        names = [f"zbp{y % 100:02d}detail.zip", f"zbp{(y - 1) % 100:02d}detail.zip"]
        if cache:
            if all(os.path.exists(os.path.join(cache, n)) for n in names): return y
            continue
        try:
            urllib.request.urlopen(urllib.request.Request(CBP.format(y=y, f=names[0]), method="HEAD", headers=UA), timeout=60)
            log(f"Business Patterns {y}: available")
            return y
        except Exception as e:
            log(f"Business Patterns {y}: not available -> {e}")
    sys.exit("No County/ZIP Business Patterns release could be found on the Census file server.")


def naics_clean(s):
    s = s.astype(str).str.strip()
    return s.map(lambda x: OLD_NAICS.get(x, x))


def zbp(year, cache):
    df = read_zip_table(fetch(f"zbp{year % 100:02d}detail.zip", CBP.format(y=year, f=f"zbp{year % 100:02d}detail.zip"), cache),
                        ["zip", "naics", "est"])
    df["naics"] = naics_clean(df.naics)
    df["est"] = pd.to_numeric(df.est, errors="coerce").fillna(0)
    df["zip"] = df.zip.str.zfill(5)
    return df


def cbp_county(year, cache):
    f = f"cbp{year % 100:02d}co.zip"
    df = read_zip_table(fetch(f, CBP.format(y=year, f=f), cache), ["fipstate", "fipscty", "naics", "est", "ap"])
    df["naics"] = naics_clean(df.naics)
    df["county_fips"] = df.fipstate.str.zfill(2) + df.fipscty.str.zfill(3)
    for c in ("est", "ap"): df[c] = pd.to_numeric(df[c], errors="coerce")
    return df[["county_fips", "naics", "est", "ap"]]


def places_ids(cache):
    """Finds the newest PLACES ZCTA and county GIS-friendly datasets on data.cdc.gov."""
    if cache:
        return {"zcta": "cache", "county": "cache"}, "test"
    found = {}
    for kind, pat in (("zcta", r"PLACES: ZCTA Data \(GIS Friendly Format\), (\d{4}) release"),
                      ("county", r"PLACES: County Data \(GIS Friendly Format\), (\d{4}) release")):
        best = None
        for base in ("https://api.us.socrata.com/api/catalog/v1?domains=data.cdc.gov&only=dataset&limit=100&q=",
                     "https://data.cdc.gov/api/catalog/v1?only=dataset&limit=100&q="):
            try:
                res = json.loads(get(base + urllib.parse.quote(f"PLACES {kind} GIS Friendly"), tries=2, timeout=120))
            except Exception as e:
                log(f"PLACES catalog search failed at {base[:40]}...: {e}"); continue
            for r in res.get("results", []):
                m = re.match(pat, r["resource"]["name"], re.I)
                if m and (best is None or int(m.group(1)) > best[0]): best = (int(m.group(1)), r["resource"]["id"], r["resource"]["name"])
            if best: break
        if not best: raise RuntimeError(f"couldn't find the PLACES {kind} dataset on data.cdc.gov")
        log(f"PLACES {kind}: {best[2]} ({best[1]})")
        found[kind] = best[1]
        release = best[0]
    return found, release


def norm_cols(df):
    df.columns = [re.sub(r"[^a-z0-9]", "", c.lower()) for c in df.columns]
    return df


def places_table(kind, did, cache):
    if cache:
        df = pd.read_csv(os.path.join(cache, f"places_{kind}.csv"), dtype=str)
    else:
        url = f"https://data.cdc.gov/resource/{did}.csv?$limit=200000"
        df = pd.read_csv(io.BytesIO(get(url, timeout=900)), dtype=str)
    df = norm_cols(df)
    idcol = next((c for c in (["zcta5", "zcta", "locationname", "locationid"] if kind == "zcta" else ["countyfips", "locationid", "locationname"]) if c in df.columns), None)
    if not idcol: raise RuntimeError(f"PLACES {kind} file has no ID column; columns: {list(df.columns)[:20]}")
    adults = next((c for c in ("totalpop18plus", "totalpopulation18plus") if c in df.columns), None)
    out = pd.DataFrame({"id": df[idcol].str.zfill(5)})
    out["p_adults"] = pd.to_numeric(df[adults], errors="coerce") if adults else np.nan
    have = []
    for key, (code, inv) in PLACES.items():
        col = code.lower() + "crudeprev"
        if col in df.columns:
            v = pd.to_numeric(df[col], errors="coerce") / 100
            out[key] = (1 - v) if inv else v
            have.append(key)
    return out, have


# ---------------- Estimating missing health measures ----------------
# CDC doesn't publish most PLACES measures for some states (Pennsylvania and Kentucky). For those ZIPs the build
# estimates each measure from local age, income and education, using how the measure moves with those factors in the
# states CDC does publish. Each measure is first tested on neighbouring states with known values; it's only estimated
# if the average county-level error stays within EST_MAX_ERR.
EST_TEST_STATES = {"39": "Ohio", "54": "West Virginia", "36": "New York", "24": "Maryland", "47": "Tennessee", "18": "Indiana"}
EST_MAX_ERR = 0.015          # 1.5 percentage points, average county error


def est_features(z):
    pop = z.acs_pop.where(z.acs_pop > 0); inc = z.inc_tot.where(z.inc_tot > 0); hh = z.hh_tot.where(z.hh_tot > 0)
    X = pd.DataFrame({"a45": z.a45p / pop, "a65": z.a65p / pop, "a75": z.a75p / pop,
                      "inc_lt35": z.inc_lt35 / inc, "inc75": z.inc75 / inc, "inc150": z.inc150 / inc,
                      "kids": z.hh_kids / hh}, index=z.index)
    if "hhed_tot" in z.columns:
        et = z.hhed_tot.where(z.hhed_tot > 0)
        X["ed_nocol"], X["ed_ba"] = z.hhed_nocol / et, z.hhed_ba / et
    X.insert(0, "const", 1.0)
    return X


def wls_fit(X, y, w):
    sw = np.sqrt(w.values)[:, None]
    beta, *_ = np.linalg.lstsq(X.values * sw, y.values * sw[:, 0], rcond=None)
    return beta


def estimate_gaps(z, have, rep):
    """Fills missing PLACES values in z with model estimates; returns the list of measures estimated."""
    X = est_features(z)
    okx = X.notna().all(axis=1) & (z.adults18 >= 100)
    state = z.county_fips.fillna("").str[:2]
    estimated, cols = [], []
    for k in have:
        known = z[k].notna() & okx
        gap = z[k].isna() & okx
        if gap.sum() == 0: continue
        errs = {}
        for st, name in EST_TEST_STATES.items():
            tr, te = known & (state != st), known & (state == st)
            if te.sum() < 50: continue
            beta = wls_fit(X[tr], z.loc[tr, k], z.loc[tr, "adults18"])
            pred = (X[te].values @ beta).clip(0, 1)
            d = pd.DataFrame({"c": z.loc[te, "county_fips"], "w": z.loc[te, "adults18"], "p": pred * z.loc[te, "adults18"],
                              "y": z.loc[te, k] * z.loc[te, "adults18"]}).groupby("c").sum()
            cerr = ((d.p - d.y).abs() / d.w)
            errs[name] = float(np.average(cerr, weights=d.w))
        if not errs: continue
        avg = float(np.mean(list(errs.values())))
        detail = f"average county error {avg * 100:.2f} pts (" + ", ".join(f"{n} {e * 100:.2f}" for n, e in errs.items()) + f"); {int(gap.sum()):,} ZIPs"
        if avg <= EST_MAX_ERR:
            beta = wls_fit(X[known], z.loc[known, k], z.loc[known, "adults18"])
            z.loc[gap, k] = (X[gap].values @ beta).clip(0, 1)
            z[f"{k}_n"] = z[k] * z.adults18
            z.loc[gap, "hm_est"] = True
            estimated.append(k)
            rep.append((f"Estimated where CDC doesn't publish: {DEMAND_LABELS[k]}", "PASS", "used; " + detail))
        else:
            rep.append((f"Estimated where CDC doesn't publish: {DEMAND_LABELS[k]}", "WARN", "not used (error above 1.5 pts); " + detail))
    return estimated


# ---------------- Scoring helpers ----------------
def pct(s):
    """Percentile 0-100 within the group; missing stays missing."""
    return (s.rank(pct=True, method="average") * 100).round(1)


def combine(parts, weights):
    """Weighted average of available parts (row-wise). Returns NaN where every part is missing."""
    num = sum(p.fillna(0) * w for p, w in zip(parts, weights))
    den = sum(p.notna() * w for p, w in zip(parts, weights))
    return (num / den).where(den > 0)


def self_test():
    s = pct(pd.Series([10, 20, 30, 40, np.nan]))
    assert list(s[:4]) == [25.0, 50.0, 75.0, 100.0] and np.isnan(s[4]), s
    c = combine([pd.Series([100.0, np.nan]), pd.Series([0.0, 50.0])], [0.40, 0.25])
    assert abs(c[0] - 40 / 0.65) < 1e-9 and c[1] == 50.0, c
    assert abs(sum(WEIGHTS.values()) - 1) < 1e-9, WEIGHTS
    return "percentile and weighted-average hand checks reproduce exactly"


# ---------------- Main ----------------
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
    need = ["a65p", "a75p", "a45p", "a25_64", "a30_64"]
    if any(c not in acs.columns for c in need):
        sys.exit("shared/audience/zip_audience.json has no Healthcare age groups; the audience step must run first with the new build_audience.py.")
    edu = [c for c in ("hhed_nocol", "hhed_ba", "hhed_tot") if c in acs.columns]
    acs = acs[["zip", "acs_pop", "adults18", "hh_kids", "hh_tot", "inc_tot", "inc_lt35", "inc_75_100", "inc_100_150", "inc_150_200", "inc_200p"] + need + edu]
    acs["inc75"] = acs[["inc_75_100", "inc_100_150", "inc_150_200", "inc_200p"]].sum(axis=1, min_count=4)
    acs["inc150"] = acs[["inc_150_200", "inc_200p"]].sum(axis=1, min_count=2)
    z = z.merge(acs.drop(columns=["inc_75_100", "inc_100_150", "inc_150_200", "inc_200p"]), on="zip", how="left")

    # Business Patterns
    y = cbp_years(a.cache)
    rep.append(("Business Patterns years", "INFO", f"{y} (growth measured from {y - 1})"))
    all_naics = sorted({n for s in SUBCATS for n in s["naics"]})
    zb, zb0 = zbp(y, a.cache), zbp(y - 1, a.cache)
    co, co0 = cbp_county(y, a.cache), cbp_county(y - 1, a.cache)
    zips_known = set(z.zip)
    unmatched = zb[(zb.naics.isin(all_naics)) & (~zb.zip.isin(zips_known))]
    rep.append(("Business ZIPs matched to the ZIP geography", "PASS" if unmatched.est.sum() <= 0.01 * zb[zb.naics.isin(all_naics)].est.sum() else "FAIL",
                f"{int(unmatched.est.sum()):,} of {int(zb[zb.naics.isin(all_naics)].est.sum()):,} healthcare businesses sit in ZIPs not in the geography table"))
    # ZIP-level counts per subcategory
    for s in SUBCATS:
        for tag, src in (("", zb), ("_prev", zb0)):
            cnt = src[src.naics.isin(s["naics"])].groupby("zip").est.sum()
            z[f"est{tag}_{s['id']}"] = z.zip.map(cnt).fillna(0)
    # Census leaves out ZIP-industry cells with fewer than 3 businesses, so ZIP detail undercounts. Markets and the U.S.
    # therefore use the complete county counts; ZIP detail is used only to rank ZIPs within a market.
    cov = []
    for s in SUBCATS:
        zt = z[f"est_{s['id']}"].sum(); ct = co[co.naics.isin(s["naics"])].est.sum()
        cov.append(f"{s['label']} {zt / ct:.0%}" if ct else f"{s['label']} n/a")
    rep.append(("ZIP detail coverage of county counts (cells under 3 businesses aren't published)", "INFO", "; ".join(cov)))
    # Published benchmarks (CBP national establishment counts, recent years)
    for nid, lo, hi, lab in (("621210", 110000, 150000, "dentist offices"), ("456110", 35000, 50000, "pharmacies")):
        n = co[co.naics == nid].est.sum()
        rep.append((f"Published benchmark: {lab}", "PASS" if lo <= n <= hi else "FAIL", f"{int(n):,} (expected {lo:,}–{hi:,})"))

    # County payroll and businesses -> spread to ZIPs by population share so DMAs (which split some counties) sum correctly
    cpop = z.groupby("county_fips").population.transform("sum")
    z["cshare"] = (z.population / cpop).where(cpop > 0, 0)
    zc = set(z.county_fips)
    for s in SUBCATS:
        cs = co[co.naics.isin(s["naics"])].groupby("county_fips")[["est", "ap"]].sum(min_count=1)
        cs.loc[cs.ap <= 0, "ap"] = np.nan                       # zero payroll with businesses present = not usable
        c0 = co0[co0.naics.isin(s["naics"])].groupby("county_fips").est.sum()
        z[f"cest_{s['id']}"] = z.county_fips.map(cs.est).fillna(0) * z.cshare
        z[f"cprev_{s['id']}"] = z.county_fips.map(c0).fillna(0) * z.cshare
        z[f"cap_{s['id']}"] = z.county_fips.map(cs.ap) * z.cshare  # $1,000s
    outside = co[co.naics.isin(all_naics) & ~co.county_fips.isin(zc)]
    rep.append(("County businesses outside the ZIP geography", "INFO",
                f"{int(outside.est.sum()):,} of {int(co[co.naics.isin(all_naics)].est.sum()):,} (mostly Census 'statewide' records with no county); counted in U.S. totals only"))
    co_in = co[co.county_fips.isin(zc)]

    # CDC PLACES
    have = []
    try:
        ids, release = places_ids(a.cache)
        pz, have_z = places_table("zcta", ids["zcta"], a.cache)
        pc, have_c = places_table("county", ids["county"], a.cache)
        have = [k for k in PLACES if k in have_z or k in have_c]
        rep.append(("CDC PLACES release", "INFO", f"{release}; measures found: {', '.join(have)}"))
        missing = [k for k in PLACES if k not in have]
        if missing: rep.append(("CDC PLACES measures not in this release", "WARN", ", ".join(DEMAND_LABELS[k] for k in missing)))
        z = z.merge(pz.rename(columns={"id": "zip"}), on="zip", how="left")
        pcm = pc.set_index("id")
        filled = {}
        for k in have:
            if k not in z.columns: z[k] = np.nan
            fill = z[k].isna() & z.county_fips.isin(pcm.index)
            z.loc[fill, k] = z.loc[fill, "county_fips"].map(pcm[k]) if k in pcm.columns else np.nan
            filled[k] = int(fill.sum())
            z[f"{k}_n"] = z[k] * z.adults18                       # adults with the measure (ACS adults as weight)
        rep.append(("CDC PLACES ZCTA gaps filled with county values", "INFO", "; ".join(f"{DEMAND_LABELS[k]} {v:,} ZIPs" for k, v in filled.items() if v)))
        cov = z.loc[z[have[0]].notna(), "adults18"].sum() / z.adults18.sum() if have else 0
        rep.append(("Adults covered by CDC PLACES", "PASS" if cov > 0.9 else "WARN", f"{cov:.1%}"))
        z["hm_est"] = False
        est_measures = estimate_gaps(z, have, rep)
        if est_measures:
            cov2 = z.loc[z[have[0]].notna(), "adults18"].sum() / z.adults18.sum()
            rep.append(("Adults covered by CDC PLACES plus estimates", "INFO", f"{cov2:.1%}"))
    except Exception as e:
        z["hm_est"] = False
        rep.append(("CDC PLACES download", "WARN", f"not available this run ({e}); Consumer Demand uses Census inputs only"))
        release = None

    # ---------------- Aggregate to a level ----------------
    def agg(g):
        """g: DataFrame of ZIP rows -> dict of raw values for one area."""
        r = {"population": g.population.sum(), "households": g.households.sum(),
             "acs_pop": g.acs_pop.sum(min_count=1), "adults": g.adults18.sum(min_count=1)}
        for c in ("a65p", "a75p", "a45p", "a25_64", "a30_64"): r[c] = g[c].sum(min_count=1)
        r["kids_share"] = g.hh_kids.sum() / g.hh_tot.sum() if g.hh_tot.sum() > 0 else np.nan
        r["inc75_share"] = g.inc75.sum() / g.inc_tot.sum() if g.inc_tot.sum() > 0 else np.nan
        r["inc150_share"] = g.inc150.sum() / g.inc_tot.sum() if g.inc_tot.sum() > 0 else np.nan
        r["hm_est_share"] = g.loc[g.hm_est.fillna(False).astype(bool), "adults18"].sum() / g.adults18.sum() if g.adults18.sum() > 0 else 0
        for k in have:
            ok = g[k].notna() & g.adults18.notna()
            covered = g.loc[ok, "adults18"].sum()
            r[k] = g.loc[ok, f"{k}_n"].sum() / covered if covered > 0 and covered >= 0.5 * g.adults18.sum() else np.nan
        for s in SUBCATS:
            i = s["id"]
            ce, cap = g[f"cest_{i}"].sum(), g[f"cap_{i}"].sum(min_count=1)
            r[f"est@{i}"] = ce; r[f"prev@{i}"] = g[f"cprev_{i}"].sum()      # complete county counts
            r[f"pay@{i}"] = cap * 1000 / ce if ce >= 1 and cap == cap else np.nan
        return r

    def frame(groups):
        rows = {k: agg(g) for k, g in groups}
        return pd.DataFrame.from_dict(rows, orient="index")

    def score(df, parts=tuple(WEIGHTS), mask=None):
        """Adds component percentiles and the Market Potential Score per subcategory. mask: rows eligible for ranking.
        demand: target-audience inputs; category: EASI spending for the category (per household and total);
        spend: share of households earning $75K+; comp: fewer competing businesses per 10,000 residents scores higher."""
        if mask is None: mask = pd.Series(True, index=df.index)
        P = lambda s: pct(s.where(mask))
        dem_pct = {k: P(df[k]) for k in DEMAND_LABELS if k in df.columns}
        spend = P(df["inc75_share"])
        for s in SUBCATS:
            i, e = s["id"], s.get("easi", "med")
            est, prev = df[f"est@{i}"], df[f"prev@{i}"]
            df[f"per10k@{i}"] = (est / df.population * 1e4).where(df.population > 0)
            df[f"growth@{i}"] = ((est - prev) / prev).where(prev >= 3)
            ins = [dem_pct[k] for k in s["demand"] if k in dem_pct and df[k].notna().any()]
            df[f"demand@{i}"] = combine(ins, [1] * len(ins)) if ins else np.nan
            if "category" in parts and f"easi_{e}_hh" in df.columns:
                df[f"category@{i}"] = combine([P(df[f"easi_{e}_hh"]), P(df[f"easi_{e}_total"])], [0.5, 0.5])
            else:
                df[f"category@{i}"] = np.nan
            df[f"spend@{i}"] = spend
            df[f"comp@{i}"] = P(-df[f"per10k@{i}"]) if "comp" in parts else np.nan
            cols = [df[f"{c}@{i}"] for c in parts]
            full = pd.concat(cols, axis=1).notna().all(axis=1)
            df[f"score@{i}"] = combine(cols, [WEIGHTS[c] for c in parts]).where(full & mask).round(1)
            for c in WEIGHTS: df[f"{c}@{i}"] = df[f"{c}@{i}"].round(1)
            under = (df[f"demand@{i}"] >= 70) & (P(df[f"per10k@{i}"]) <= 30)
            known = df[f"demand@{i}"].notna() & df[f"per10k@{i}"].notna() & mask
            df[f"under@{i}"] = np.where(under & known, "Yes", np.where(known, "No", None))
        return df

    # EASI household healthcare spending. Market totals = EASI spending per household x this site's households, so they
    # follow the same ZIP-based boundaries as every other number (EASI's own market definitions differ a little).
    def add_easi_spend(df, per_hh, label):
        for e, (col, _) in EASI_SPEND.items():
            hh = df.index.map(per_hh[col]).astype(float)
            df[f"easi_{e}_hh"] = hh
            df[f"easi_{e}_total"] = hh * df.households
            df[f"easi_{e}_idx"] = (hh / us_hh[col] * 100).round(0)
        miss = [str(i) for i in df.index if per_hh[EASI_SPEND["med"][0]].get(i) != per_hh[EASI_SPEND["med"][0]].get(i)]
        rep.append((f"EASI healthcare spending matched to {label}", "PASS" if not miss else "FAIL",
                    f"{len(df) - len(miss)} of {len(df)}" + (f"; missing {miss[:8]}" if miss else "")))

    src = os.path.join(HERE, "sources")
    sd = pd.read_csv(os.path.join(src, "easi_healthcare_spend_dma.csv"))
    xw = pd.read_csv(os.path.join(src, "easi_dma_crosswalk.csv"), dtype={"dma_code": str})
    sd = sd.merge(xw[["easi_market", "dma_code"]], left_on="market", right_on="easi_market", how="left")
    if sd.dma_code.isna().any(): sys.exit("easi_dma_crosswalk.csv is missing EASI DMAs: " + ", ".join(sd[sd.dma_code.isna()].market))
    us_hh = {c: sd[f"{c}_total"].sum() / sd.households.sum() for c, _ in EASI_SPEND.values()}
    sm = pd.read_csv(os.path.join(src, "easi_healthcare_spend_metro.csv"))
    em = pd.read_csv(os.path.join(src, "easi_metro_2025.csv"), dtype={"cbsa_code": str})
    key = lambda t: re.sub(r"[^a-z0-9]", "", str(t).lower())
    sm["cbsa_code"] = sm.market.map(key).map(dict(zip(em.metro.map(key), em.cbsa_code)))
    hh_dma = sd.set_index("dma_code")[[f"{c}_per_hh" for c, _ in EASI_SPEND.values()]]
    hh_dma.columns = [c for c, _ in EASI_SPEND.values()]
    hh_met = sm.dropna(subset=["cbsa_code"]).set_index("cbsa_code")[[f"{c}_per_hh" for c, _ in EASI_SPEND.values()]]
    hh_met.columns = hh_dma.columns
    # EASI counts Palm Springs inside Los Angeles; the provisional Palm Springs DMA uses the Riverside metro rate.
    if PALM_SPRINGS not in hh_dma.index and RIVERSIDE_METRO in hh_met.index:
        hh_dma.loc[PALM_SPRINGS] = hh_met.loc[RIVERSIDE_METRO]
        rep.append(("EASI healthcare spending: Palm Springs", "INFO", "EASI includes Palm Springs in Los Angeles; the provisional Palm Springs DMA uses the Riverside–San Bernardino metro's per-household spending"))
    rep.append(("EASI U.S. healthcare spending per household", "INFO", "; ".join(f"{lab} ${us_hh[c]:,.2f}" for c, lab in EASI_SPEND.values())))

    # DMA and metro
    zd = z[z.dma_code != "0"]
    dma = frame(zd.groupby("dma_code")); add_easi_spend(dma, hh_dma, "DMAs"); dma = score(dma)
    zm = z[z.cbsa_code.isin(metros)]
    met = frame(zm.groupby("cbsa_code")); add_easi_spend(met, hh_met, "metros"); met = score(met)
    us = frame([("us", z)])
    for s in SUBCATS:
        i = s["id"]
        us[f"est@{i}"] = co[co.naics.isin(s["naics"])].est.sum()            # includes statewide records
        us[f"prev@{i}"] = co0[co0.naics.isin(s["naics"])].est.sum()
        us[f"per10k@{i}"] = us[f"est@{i}"] / us.population * 1e4
        us[f"growth@{i}"] = (us[f"est@{i}"] - us[f"prev@{i}"]) / us[f"prev@{i}"]
    for e, (col, _) in EASI_SPEND.items():
        us[f"easi_{e}_hh"] = us_hh[col]; us[f"easi_{e}_total"] = us_hh[col] * us.households; us[f"easi_{e}_idx"] = 100.0
    # Sense check: market totals built from per-household x households should land near EASI's own U.S. totals
    for e, (col, lab) in EASI_SPEND.items():
        r = dma[f"easi_{e}_total"].sum() / sd[f"{col}_total"].sum()
        rep.append((f"EASI {lab.lower()} total, DMAs vs. EASI's own total", "PASS" if 0.95 <= r <= 1.05 else "FAIL", f"{r:.1%} of EASI's ${sd[f'{col}_total'].sum() / 1e9:,.1f}B"))

    # EASI metro layer
    easi = pd.read_csv(os.path.join(HERE, "sources", "easi_metro_2025.csv"), dtype={"cbsa_code": str}).set_index("cbsa_code")
    T = easi.sum(numeric_only=True)
    conds = ("heart", "cancer", "hearing", "vision")
    for c in conds:
        rate, grow = easi[f"{c}25"] / easi.adults25, easi[f"{c}30"] / easi[f"{c}25"] - 1
        urate, ugrow = T[f"{c}25"] / T.adults25, T[f"{c}30"] / T[f"{c}25"] - 1
        met[f"easi_{c}"] = met.index.map(easi[f"{c}25"])
        met[f"easi_{c}_rate"] = met.index.map(rate)
        met[f"easi_{c}_idx"] = met.index.map(rate / urate * 100).round(0)
        met[f"easi_{c}_30"] = met.index.map(easi[f"{c}30"])
        met[f"easi_{c}_g"] = met.index.map(grow)
        met[f"easi_{c}_gidx"] = met.index.map(((1 + grow) / (1 + ugrow) * 100).round(0))
    miss = sorted(set(met.index) - set(easi.index))
    # Cross-check: do estimated health measures line up with EASI's independent metro estimates?
    for k, c in (("hearing", "hearing"), ("vision", "vision")):
        if k in met.columns and f"easi_{c}_rate" in met.columns:
            e_ = met[met.hm_est_share >= 0.5]; o_ = met[met.hm_est_share < 0.5]
            if len(e_) >= 5:
                ce, co_ = e_[k].corr(e_[f"easi_{c}_rate"]), o_[k].corr(o_[f"easi_{c}_rate"])
                rep.append((f"Cross-check vs. EASI: {DEMAND_LABELS[k]}", "INFO",
                            f"correlation with EASI {c} trouble: {ce:.2f} across {len(e_)} metros with estimated values; {co_:.2f} across {len(o_)} metros with CDC values"))
    rep.append(("EASI layer matched to metros", "PASS" if not miss else "WARN", f"{len(met) - len(miss)} of {len(met)} metros" + (f"; missing {miss[:5]}" if miss else "")))

    # ---------------- Checks ----------------
    for name, df in (("DMA", dma), ("Metro", met)):
        sc = df[[f"score@{s['id']}" for s in SUBCATS]]
        bad = int(((sc < 0) | (sc > 100)).sum().sum())
        rep.append((f"{name} scores within 0–100", "PASS" if bad == 0 else "FAIL", f"{bad} out of range; {int(sc.notna().sum().sum()):,} scores computed, {int(sc.isna().sum().sum()):,} not computed (missing input)"))
        neg = int((df[[f"est@{s['id']}" for s in SUBCATS]] < 0).sum().sum())
        rep.append((f"{name} business counts never negative", "PASS" if neg == 0 else "FAIL", f"{neg}"))
    for s in SUBCATS:
        tot_d = dma[f"est@{s['id']}"].sum()
        tot_c = co_in[co_in.naics.isin(s["naics"])].est.sum() - z[z.dma_code == "0"][f"cest_{s['id']}"].sum()
        ok = tot_c > 0 and abs(tot_d - tot_c) / tot_c <= 0.005
        rep.append((f"DMA roll-up matches county totals: {s['label']}", "PASS" if ok else "FAIL", f"DMAs {int(round(tot_d)):,} vs counties {int(round(tot_c)):,}"))
    rep.append(("U.S. population (Deluxe)", "INFO", f"{int(us.population.iloc[0]):,}"))

    failed = [r for r in rep if r[1] == "FAIL"]
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "healthcare_report.md"), "w") as f:
        f.write(f"# Healthcare data check report\n\nBuilt {built}. Result: **{'FAILED' if failed else 'PASSED'}**\n\n| Check | Result | Detail |\n| --- | --- | --- |\n")
        for r in rep: f.write(f"| {r[0]} | {r[1]} | {r[2]} |\n")
    for r in rep: log(f"[{r[1]}] {r[0]}: {r[2]}")
    if failed: sys.exit("A check failed; the Healthcare data was not updated. See healthcare/data/healthcare_report.md.")

    # ---------------- Write ----------------
    easi_spend_cols = [f"easi_{e}_{x}" for e in EASI_SPEND for x in ("hh", "total", "idx")]
    keep_common = ["population", "households", "adults", "a65p", "a75p"] + RATES + easi_spend_cols
    per_sub = ["score", "demand", "category", "spend", "comp", "est", "per10k", "growth", "under"]
    easi_cols = [f"easi_{c}{x}" for c in conds for x in ("", "_rate", "_idx", "_30", "_g", "_gidx")]

    def clean(v):
        if v is None: return None
        if isinstance(v, str): return v
        if isinstance(v, (float, np.floating)):
            if not np.isfinite(v): return None
            v = float(v)
            return round(v, 3) if abs(v) < 1 else round(v, 2) if abs(v) < 100 else round(v)
        if isinstance(v, (np.integer,)): return int(v)
        return v
    SCORE_KEYS = ("score", "demand", "category", "spend", "comp")

    def rows(df, names, flags_fn=None, extra=()):
        out = []
        for idx, r in df.iterrows():
            v = {}
            for c in keep_common + list(extra):
                if c in df.columns: v[c] = clean(r[c])
            for s in SUBCATS:
                for p in per_sub:
                    k = f"{p}@{s['id']}"
                    if k in df.columns:
                        x = clean(r[k])
                        v[k] = int(round(x)) if p in SCORE_KEYS and x is not None else x
            for k in ("population", "households", "adults", "a65p", "a75p") + tuple(c for c in easi_spend_cols if c.endswith("_total")) + tuple(e for e in extra if not e.endswith(("_rate", "_g"))):
                if v.get(k) is not None: v[k] = int(round(v[k]))
            for s in SUBCATS:
                if v.get(f"est@{s['id']}") is not None: v[f"est@{s['id']}"] = int(round(v[f"est@{s['id']}"]))
            v = {k: x for k, x in v.items() if x is not None}          # missing keys read as "No data"
            f = flags_fn(idx, r) if flags_fn else []
            none = [s["label"] for s in SUBCATS if f"score@{s['id']}" in df.columns and r.get(f"est@{s['id']}", 0) == 0
                    and r.get(f"score@{s['id']}") != r.get(f"score@{s['id']}")]          # zero businesses and no score
            if none and r.get("population", 0) >= MIN_POP:
                f.append("No Census-counted businesses here for: " + ", ".join(none) + ". Those categories aren't scored for this area.")
            out.append({"id": str(idx), "name": names(idx), "v": v, "f": f})
        return out

    dname = dma_list.set_index("dma_code").dma_name
    tidy = lambda n: re.sub(r"(, )([A-Za-z]{2})\b", lambda m: m.group(1) + m.group(2).upper(), str(n).title())
    mname = met_list.set_index("cbsa_code").cbsa_name

    def flags(idx, r):
        f = []
        if str(idx) == "804": f.append("Palm Springs boundary is provisional: 28 Coachella Valley ZIPs assigned by Adtaxi, pending a Nielsen check.")
        if have and all(r.get(k) != r.get(k) for k in have): f.append("CDC health measures aren't published for this area, so Consumer Demand uses Census inputs only.")
        elif r.get("hm_est_share", 0) >= 0.5: f.append(EST_NOTE)
        return f

    meta = {"built": built, "cbpYear": y, "placesRelease": release, "acsYears": aud["meta"]["acsYears"]}
    json.dump({"level": "dma", "meta": meta, "rows": rows(dma, lambda i: tidy(dname.get(i, i)), flags)}, open(os.path.join(OUT, "dma.json"), "w"), separators=(",", ":"))
    json.dump({"level": "metro", "meta": meta, "rows": rows(met, lambda i: mname.get(i, i), flags, easi_cols)}, open(os.path.join(OUT, "metro.json"), "w"), separators=(",", ":"))
    json.dump({"level": "us", "meta": meta, "rows": rows(us, lambda i: "United States")}, open(os.path.join(OUT, "us.json"), "w"), separators=(",", ":"))

    # ZIPs inside each market, ranked within the market (no ZIP-level payroll, so Spending Power is left out there)
    nfiles = 0
    for level, col, src in (("dma", "dma_code", zd), ("metro", "cbsa_code", zm)):
        folder = os.path.join(OUT, "zip", level); os.makedirs(folder, exist_ok=True)
        for code, g in src.groupby(col):
            df = g.set_index("zip")
            f = pd.DataFrame(index=df.index)
            f["population"], f["households"], f["adults"] = df.population, df.households, df.adults18
            for c in ("a65p", "a75p", "a45p", "a25_64", "a30_64"): f[c] = df[c]
            f["kids_share"] = (df.hh_kids / df.hh_tot).where(df.hh_tot > 0)
            f["inc75_share"] = (df.inc75 / df.inc_tot).where(df.inc_tot > 0)
            f["inc150_share"] = (df.inc150 / df.inc_tot).where(df.inc_tot > 0)
            for k in have: f[k] = df[k]
            f["hm_est_share"] = df.hm_est.fillna(False).astype(float)
            for s in SUBCATS:
                f[f"est@{s['id']}"] = df[f"est_{s['id']}"]; f[f"prev@{s['id']}"] = df[f"est_prev_{s['id']}"]
            ok = f.population >= MIN_POP
            f = score(f, parts=ZIP_PARTS, mask=ok)
            city = df.city.fillna("")
            out = rows(f, lambda i: f"{i} {city.get(i, '')}".strip())
            for row in out:
                if f.loc[row["id"], "hm_est_share"] >= 0.5: row["f"].append(EST_NOTE)
                if f.loc[row["id"], "population"] < MIN_POP:
                    row["u"] = 1; row["f"].append(f"Fewer than {MIN_POP} residents, so this ZIP isn't ranked.")
                for s in SUBCATS: row["v"].pop(f"category@{s['id']}", None); row["v"].pop(f"comp@{s['id']}", None)
            # no build date in ZIP files, so a rebuild with unchanged data doesn't rewrite all of them
            json.dump({"level": "zip", "parent": {"level": level, "id": code}, "rows": out},
                      open(os.path.join(folder, f"{code}.json"), "w"), separators=(",", ":"))
            nfiles += 1
    log(f"Wrote {len(dma)} DMAs, {len(met)} metros and {nfiles} ZIP files to {OUT}")


if __name__ == "__main__":
    main()
