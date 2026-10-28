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
from county_level import county_frame, county_mask, county_checks, county_flag, county_names, mark_unranked, COUNTY_PARTS
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
EASI_SPEND = {"med": ("medical_services", "Medical services"), "rx": ("prescription_drugs", "Prescription drugs"),
              "phys": ("physician_services", "Physician's services"), "hosp": ("hospital_services", "Hospital room and services"),
              "dent": ("dental_services", "Dental services"), "eye": ("eye_care", "Eye care (eyecare services, eyeglasses and contact lenses)"),
              "hear": ("hearing_aids", "Hearing aids"), "pcs": ("personal_care_services", "Personal care services")}
PALM_SPRINGS, LA_DMA, RIVERSIDE_METRO = "804", "803", "40140"

# ---------------- Subcategories ----------------
# naics: industries counted as prospect businesses. demand: (input key, weight) pairs, defined in DEMAND_INPUTS below.
SUBCATS = [
    {"id": "primary", "label": "Primary care", "naics": ["621111"], "easi": "phys",
     "demand": ["population", "a65s", "ins1864", "fairpoor"],
     "note": "Competition counts all physician offices (Census doesn't separate primary care from specialists)."},
    {"id": "hospital", "label": "Hospitals and health systems", "naics": ["622110"], "easi": "hosp",
     "demand": ["adults", "a65s", "arthritis", "bphigh"]},
    {"id": "urgent",  "label": "Urgent and emergency care", "naics": ["621493"], "counts": False,
     "demand": ["population", "kids_share", "ins1864"],
     "note": "No Competition part: Census's urgent care industry is mostly outpatient surgery centers, and many urgent care clinics are counted as physician offices."},
    {"id": "pharmacy", "label": "Pharmacy", "naics": ["456110"], "easi": "rx", "spend": False,
     "demand": ["a65p", "a65s", "diabetes", "bphigh"],
     "note": "No Spending Power part: prescriptions follow age and health and are mostly paid by insurance, not household income."},
    {"id": "dental", "label": "Dental", "naics": ["621210"], "easi": "dent",
     "demand": ["adults", "nodental"]},          # income counts once, under Spending Power
    {"id": "hearing", "label": "Hearing and audiology", "naics": ["621340", "456199"], "counts": False, "easi": "hear",
     "demand": ["a65p", "hearing"],
     "note": "No Competition part: Census counts audiologists with physical, occupational and speech therapists (mostly physical therapy), so no clean hearing business count exists."},
    {"id": "eye", "label": "Eye care", "naics": ["621320", "456130"], "easi": "eye",
     "demand": ["a45p", "a45s", "diabetes"]},
    {"id": "chiro", "label": "Chiropractic and physical therapy", "naics": ["621310", "621340"],
     "demand": ["a25_64", "arthritis", "obesity"]},
    {"id": "behavioral", "label": "Behavioral health", "naics": ["621330", "621420"],
     "demand": ["adults", "depression", "mhlth"]},
    {"id": "medspa", "label": "Med spa and aesthetics", "naics": ["621111"], "counts": False, "easi": "pcs", "catw": 0.10,
     "demand": ["a30_64", "a30_64s", "inc150_share"],
     "note": "No Competition part: Census has no med spa industry and counts aesthetics practices with all physician offices."},
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
                 "a25_64": "Adults 25–64", "a30_64": "Adults 30–64",
                 "a45s": "Share of residents 45+", "a65s": "Share of residents 65+", "a30_64s": "Share of residents 30–64",
                 "ins1864": "Adults 18–64 with health insurance", "kids_share": "Households with children",
                 "inc75_share": "Households $75K+", "inc150_share": "Households $150K+",
                 "fairpoor": "Fair or poor health", "diabetes": "Diabetes", "bphigh": "High blood pressure",
                 "nodental": "No dental visit in past year", "hearing": "Hearing disability", "vision": "Vision disability",
                 "arthritis": "Arthritis", "obesity": "Obesity", "depression": "Depression",
                 "mhlth": "Frequent mental distress", "indeplive": "Independent-living disability"}
SHARES = ["a45s", "a65s", "a30_64s", "ins1864"]          # age shares of ACS population; insured share of adults 18-64
RATES = ["kids_share", "inc75_share", "inc150_share"] + SHARES + list(PLACES)
COUNTED = lambda s: s.get("counts", True)                # False: no Census industry matches the category, so no Competition
# Measures offered as health conditions in the Healthcare radius tool
RADIUS_CONDITIONS = ["diabetes", "bphigh", "arthritis", "obesity", "depression", "mhlth", "fairpoor", "nodental"]


# How a filled-in health value was produced (the "_fill" code on each ZIP; 0 = current CDC release)
FILL_PREV_REGION, FILL_MODEL, FILL_PREV_LOCAL, FILL_NEIGHBORS = 1, 2, 4, 5
FILL_TEXT = {
    FILL_PREV_REGION: "CDC's {prev} release, adjusted for the change since then across neighboring states",
    FILL_PREV_LOCAL: "CDC's {prev} release, adjusted for the change since then in the nearest counties CDC still covers",
    FILL_NEIGHBORS: "a distance-weighted average of the nearest counties CDC still covers",
    FILL_MODEL: "an estimate from local age, income and education",
}


def est_notes(methods, low, cur_year, prev_year):
    """Data-note text for an area whose health measures are partly filled in (values are marked * on the page)."""
    if not methods: return []
    srcs = []
    if methods & {FILL_PREV_LOCAL, FILL_PREV_REGION}: srcs.append(f"CDC's {prev_year} release, adjusted for the change since then in nearby areas")
    if FILL_NEIGHBORS in methods: srcs.append("an average of nearby counties")
    if FILL_MODEL in methods: srcs.append("an estimate from local age, income and education")
    lead = ", ".join(srcs[:-1]) + (" or " if len(srcs) > 1 else "") + srcs[-1]
    out = [f"CDC's {cur_year} release leaves some health measures out here. Values marked * come from {lead}."]
    if low: out.append("Lower confidence (tested error 1.5 to 3 points): " + ", ".join(low) + ".")
    out.append("Scores marked * use these values. Health measures that couldn't be filled reliably show No data. See How scores work.")
    return [" ".join(out)]


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


# NAICS codes the analyzers count (6-digit). Census leaves a county out of the county file for an industry when it has
# only 1 or 2 establishments there, so those counties read as 0 (Kenton County, KY: 0 furniture stores). The state file
# still counts them, so each state's hidden total (state count minus its published counties) is spread over the
# state's counties that have no row, at most 2 each. These are estimates; "est_imputed" marks them.
IMPUTE_MAX = 2.0
CBP_LOG = []


def cbp_state(year, cache):
    f = f"cbp{year % 100:02d}st.zip"
    df = read_zip_table(fetch(f, CBP.format(y=year, f=f), cache), ["fipstate", "naics", "est"])
    df["naics"] = naics_clean(df.naics); df["est"] = pd.to_numeric(df.est, errors="coerce")
    df["st"] = df.fipstate.str.zfill(2)
    return df.groupby(["st", "naics"]).est.max()


def cbp_county(year, cache):
    f = f"cbp{year % 100:02d}co.zip"
    blob = fetch(f, CBP.format(y=year, f=f), cache)
    try: df = read_zip_table(blob, ["fipstate", "fipscty", "naics", "est", "ap", "emp"])
    except RuntimeError: df = read_zip_table(blob, ["fipstate", "fipscty", "naics", "est", "ap"]); df["emp"] = None
    df["naics"] = naics_clean(df.naics)
    df["county_fips"] = df.fipstate.str.zfill(2) + df.fipscty.str.zfill(3)
    for c in ("est", "ap", "emp"): df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df[["county_fips", "naics", "est", "ap", "emp"]].copy()
    df["est_imputed"] = 0.0
    try:
        st = cbp_state(year, cache)
    except Exception as e:
        CBP_LOG.append(f"{year}: state file unavailable ({type(e).__name__}); hidden county counts stay 0")
        return df
    six = df.naics.str.fullmatch(r"\d{6}")
    d6 = df[six].assign(st=df.county_fips.str[:2])
    pub = d6.groupby(["st", "naics"]).est.sum()
    hidden = (st.reindex(pub.index) - pub).clip(lower=0)
    hidden = hidden[hidden > 0]
    real = df[df.county_fips.str[2:] != "999"]        # "999" rows are statewide, not a county: counted in pub, never filled
    counties = real.groupby(real.county_fips.str[:2]).county_fips.unique()   # every county that appears in the file
    pub_rows = d6[d6.est.notna()]                     # a row with a blank count is as hidden as a missing row
    have = set(zip(pub_rows.county_fips, pub_rows.naics))
    add = []
    for (s_, n_), h in hidden.items():
        miss = [c for c in counties.get(s_, []) if (c, n_) not in have]
        if not miss: continue
        each = min(IMPUTE_MAX, h / len(miss))
        add.extend((c, n_, each) for c in miss)
    if add:
        a = pd.DataFrame(add, columns=["county_fips", "naics", "est"]); a["ap"] = np.nan; a["emp"] = np.nan; a["est_imputed"] = a.est
        df = pd.concat([df, a], ignore_index=True)
        CBP_LOG.append(f"{year}: {len(a):,} hidden county-industry counts filled from the state totals ({a.est.sum():,.0f} establishments)")
        print("County Business Patterns " + CBP_LOG[-1], flush=True)
    return df


_NAT = {}


def nat_or(year, codes, county_df):
    """U.S. establishments for these NAICS codes from Census's national CBP file, which matches Census's published
    U.S. totals. The county file (used for every market) adds up to 1-6% less, because Census withholds some county
    detail. Falls back to the county total if the national file can't be read (noted in the log)."""
    if year not in _NAT:
        try:
            f = f"cbp{year % 100:02d}us.zip"
            df = read_zip_table(fetch(f, CBP.format(y=year, f=f), None), ["naics", "lfo", "est"])
            df = df[df.lfo.fillna("").str.strip().isin(["-", ""])].copy()
            df["naics"] = naics_clean(df.naics); df["est"] = pd.to_numeric(df.est, errors="coerce")
            _NAT[year] = df.groupby("naics").est.max()
        except Exception as e:
            print(f"National CBP file for {year} unavailable ({e}); U.S. counts use the county file", flush=True)
            _NAT[year] = None
    s = _NAT[year]; codes = list(codes)
    if s is None or not any(c in s.index for c in codes):
        return float(county_df[county_df.naics.isin(codes)].est.sum())
    return float(s.reindex(codes).fillna(0).sum())


def places_ids(cache):
    """Finds the PLACES ZCTA and county GIS-friendly datasets on data.cdc.gov: the newest release, plus the one before
    it (used where the newest release leaves a state out). Returns ({kind: [(year, id), ...] newest first}, year)."""
    if cache:
        prev = [(0, "cache_prev")] if os.path.exists(os.path.join(cache, "places_zcta_prev.csv")) else []
        return {"zcta": [(1, "cache")] + prev, "county": [(1, "cache")] + prev}, "test"
    found = {}
    for kind, pat in (("zcta", r"PLACES: ZCTA Data \(GIS Friendly Format\), (\d{4}) release"),
                      ("county", r"PLACES: County Data \(GIS Friendly Format\), (\d{4}) release")):
        best, seen = None, {}
        for base in ("https://api.us.socrata.com/api/catalog/v1?domains=data.cdc.gov&only=dataset&limit=100&q=",
                     "https://data.cdc.gov/api/catalog/v1?only=dataset&limit=100&q="):
            try:
                res = json.loads(get(base + urllib.parse.quote(f"PLACES {kind} GIS Friendly"), tries=2, timeout=120))
            except Exception as e:
                log(f"PLACES catalog search failed at {base[:40]}...: {e}"); continue
            for r in res.get("results", []):
                m = re.match(pat, r["resource"]["name"], re.I)
                if m: seen.setdefault(int(m.group(1)), r["resource"]["id"])
            if seen: break
        if not seen: raise RuntimeError(f"couldn't find the PLACES {kind} dataset on data.cdc.gov")
        found[kind] = sorted(seen.items(), reverse=True)[:2]
        log(f"PLACES {kind}: releases " + ", ".join(f"{y} ({i})" for y, i in found[kind]))
        release = found[kind][0][0]
    return found, release


def norm_cols(df):
    df.columns = [re.sub(r"[^a-z0-9]", "", c.lower()) for c in df.columns]
    return df


def places_table(kind, did, cache):
    if cache:
        df = pd.read_csv(os.path.join(cache, f"places_{kind}{'_prev' if did == 'cache_prev' else ''}.csv"), dtype=str)
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
EST_MAX_ERR_LOW = 0.03       # previous-release values up to 3 points are still used, flagged as lower confidence


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


def model_test(z, k, X, okx, state):
    """Tests the age/income/education model for measure k by hiding each test state. Returns ({state: error}, known mask)."""
    known = z[k].notna() & okx & (z[f"{k}_fill"] == 0)
    errs = {}
    for st, name in EST_TEST_STATES.items():
        tr, te = known & (state != st), known & (state == st)
        if te.sum() < 50: continue
        beta = wls_fit(X[tr], z.loc[tr, k], z.loc[tr, "adults18"])
        pred = (X[te].values @ beta).clip(0, 1)
        d = pd.DataFrame({"c": z.loc[te, "county_fips"], "w": z.loc[te, "adults18"], "p": pred * z.loc[te, "adults18"],
                          "y": z.loc[te, k] * z.loc[te, "adults18"]}).groupby("c").sum()
        errs[name] = float(np.average((d.p - d.y).abs() / d.w, weights=d.w))
    return errs, known


def county_centroids(aud_cols, z):
    """Population-weighted county centers from ZIP coordinates (radians)."""
    a = pd.DataFrame({"zip": aud_cols["zip"], "lat": aud_cols["lat"], "lon": aud_cols["lon"]})
    g = z[["zip", "county_fips", "population"]].merge(a, on="zip", how="inner").dropna()
    g = g[g.population > 0]
    w = g.population
    c = pd.DataFrame({"lat": (g.lat * w).groupby(g.county_fips).sum() / w.groupby(g.county_fips).sum(),
                      "lon": (g.lon * w).groupby(g.county_fips).sum() / w.groupby(g.county_fips).sum()})
    return np.radians(c)


def nearest_weights(cent, targets, donors, k=8):
    """For each target county, its k nearest donor counties and inverse-distance-squared weights.
    Returns {target: (donor array, weight array)}."""
    out = {}
    donors = [d for d in donors if d in cent.index]
    if not donors: return out
    D = cent.loc[donors]
    dlat, dlon = D.lat.values, D.lon.values
    for t in targets:
        if t not in cent.index: continue
        lat, lon = cent.at[t, "lat"], cent.at[t, "lon"]
        h = np.sin((dlat - lat) / 2) ** 2 + np.cos(lat) * np.cos(dlat) * np.sin((dlon - lon) / 2) ** 2
        km = 6371 * 2 * np.arcsin(np.sqrt(h))
        idx = np.argsort(km)[:k]
        out[t] = (np.array(donors)[idx], 1 / np.maximum(km[idx], 10) ** 2)
    return out


def fill_from_previous(z, have, pzp, pcp, prev_year, cur_year, rep, cent):
    """Fills ZIPs the newest PLACES release leaves blank. Four methods are tested on each measure by hiding a whole
    neighbouring state and predicting it; the one with the lowest average county error is used:
      prev_region - CDC's previous release, scaled by the change between releases across the other test states
      prev_local  - CDC's previous release, scaled by the change in the nearest counties that have both releases
      neighbors   - distance-weighted average of the nearest counties' current values
      model       - estimate from local age, income and education (est_features)
    Returns {measure: method code} for measures filled."""
    prev = z[["zip", "county_fips"]].merge(pzp.rename(columns={"id": "zip"}), on="zip", how="left").set_index(z.index)
    pcm = pcp.set_index("id") if pcp is not None else pd.DataFrame()
    state = z.county_fips.fillna("").str[:2]
    w = z.adults18.fillna(0)
    used = {}
    X = est_features(z)
    okx = X.notna().all(axis=1) & (z.adults18 >= 100)
    for k in have:
        pv = prev[k] if k in prev.columns else pd.Series(np.nan, index=z.index)
        if k in pcm.columns: pv = pv.fillna(z.county_fips.map(pcm[k]))
        cur_ok = (z[f"{k}_fill"] == 0) & (w > 0)
        gap = z[k].isna() & (w >= 0)
        if gap.sum() == 0: continue
        # county tables: current value, previous value and adults (current-release counties only)
        cw = w[cur_ok].groupby(z.county_fips[cur_ok]).sum()
        cc = (z.loc[cur_ok, k] * w[cur_ok]).groupby(z.county_fips[cur_ok]).sum() / cw
        bo = cur_ok & pv.notna()
        bw = w[bo].groupby(z.county_fips[bo]).sum()
        bc = (z.loc[bo, k] * w[bo]).groupby(z.county_fips[bo]).sum()          # current x adults
        bp = (pv[bo] * w[bo]).groupby(z.county_fips[bo]).sum()                # previous x adults
        pw_all = pv.notna() & (w > 0)
        cp = (pv[pw_all] * w[pw_all]).groupby(z.county_fips[pw_all]).sum() / w[pw_all].groupby(z.county_fips[pw_all]).sum()
        cst = pd.Series(cc.index.str[:2], index=cc.index)

        def predict(method, targets, excl_state):
            """County predictions for target counties, never using donors from excl_state."""
            if method == "prev_region":
                ok = [c for c in bc.index if c[:2] in EST_TEST_STATES and c[:2] != excl_state]
                f_ = bc[ok].sum() / bp[ok].sum() if bp[ok].sum() > 0 else np.nan
                return pd.Series({t: cp.get(t, np.nan) * f_ for t in targets}), f_
            donors = [c for c in (bc.index if method == "prev_local" else cc.index) if c[:2] != excl_state]
            nw = nearest_weights(cent, targets, donors)
            res = {}
            for t, (ds, ww) in nw.items():
                if method == "prev_local":
                    aw = ww * bw[ds].values
                    num, den = (aw * (bc[ds] / bw[ds]).values).sum(), (aw * (bp[ds] / bw[ds]).values).sum()
                    res[t] = cp.get(t, np.nan) * num / den if den > 0 else np.nan
                else:
                    aw = ww * cw[ds].values
                    res[t] = (aw * cc[ds].values).sum() / aw.sum()
            return pd.Series(res, dtype=float), None

        errs = {}
        for method in ("prev_region", "prev_local", "neighbors"):
            if method != "neighbors" and bp.sum() == 0: continue
            e = {}
            for st, name in EST_TEST_STATES.items():
                tc = [c for c in cc.index if c[:2] == st]
                if len(tc) < 5: continue
                pr, _ = predict(method, tc, st)
                d = pd.DataFrame({"p": pr, "y": cc[tc], "w": cw[tc]}).dropna()
                if len(d): e[name] = float(np.average((d.p - d.y).abs(), weights=d.w))
            if e: errs[method] = e
        me, known = model_test(z, k, X, okx, state)
        if me: errs["model"] = me
        if not errs: continue
        avg = {m: float(np.mean(list(e.values()))) for m, e in errs.items()}
        best = min(avg, key=avg.get)
        title = f"Filling CDC {cur_year} gaps: {DEMAND_LABELS[k]}"
        tested = "; ".join(f"{m.replace('_', ' ')} {avg[m] * 100:.2f}" for m in ("prev_region", "prev_local", "neighbors", "model") if m in avg)
        detail = (f"tested average county error (pts): {tested}. Best: {best.replace('_', ' ')} (" +
                  ", ".join(f"{n} {v * 100:.2f}" for n, v in errs[best].items()) + ")")
        if avg[best] > EST_MAX_ERR_LOW:
            rep.append((title, "WARN", "not used (error above 3 pts); " + detail)); continue
        gap_c = sorted(set(z.loc[gap & z.county_fips.notna(), "county_fips"]))
        if best == "model":
            beta = wls_fit(X[known], z.loc[known, k], z.loc[known, "adults18"])
            val = pd.Series(np.nan, index=z.index); m_ = gap & okx
            val[m_] = (X[m_].values @ beta)
        elif best == "neighbors":
            pr, f_ = predict(best, gap_c, None)
            val = z.county_fips.map(pr)
        else:
            pr, f_ = predict(best, gap_c, None)
            fac = (pr / cp.reindex(pr.index)) if best == "prev_local" else None
            val = pv * (f_ if best == "prev_region" else z.county_fips.map(fac))
        fillm = gap & val.notna()
        code = {"prev_region": FILL_PREV_REGION, "prev_local": FILL_PREV_LOCAL, "neighbors": FILL_NEIGHBORS, "model": FILL_MODEL}[best]
        z.loc[fillm, k] = val[fillm].clip(0, 1)
        z.loc[fillm, f"{k}_fill"] = code
        if avg[best] > EST_MAX_ERR: z.loc[fillm, f"{k}_low"] = True
        used[k] = code
        rep.append((title, "PASS", ("used; " if avg[best] <= EST_MAX_ERR else "used, lower confidence (error 1.5–3 pts); ")
                    + detail + f"; {int(fillm.sum()):,} ZIPs"))
    return used


GAZ = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/{y}_Gazetteer/{y}_Gaz_zcta_national.zip"


def zcta_land(cache, rep):
    """Land area of each ZIP (ZCTA) in square miles, from the Census Gazetteer."""
    this = datetime.date.today().year
    for y in range(this, this - 5, -1):
        name = f"{y}_Gaz_zcta_national.zip"
        if cache:
            if not os.path.exists(os.path.join(cache, name)): continue
            blob = open(os.path.join(cache, name), "rb").read()
        else:
            try: blob = get(GAZ.format(y=y), tries=2)
            except Exception as e:
                log(f"Gazetteer {y}: not available -> {e}"); continue
        zf = zipfile.ZipFile(io.BytesIO(blob))
        raw = zf.open(zf.namelist()[0]).read().decode("utf-8-sig", "replace")
        sep = "|" if "|" in raw.split("\n", 1)[0] else "\t"          # newer Gazetteer files use pipes
        df = pd.read_csv(io.StringIO(raw), sep=sep, dtype=str)
        df.columns = [c.strip().upper() for c in df.columns]
        if "GEOID" not in df.columns or "ALAND_SQMI" not in df.columns:
            raise RuntimeError(f"Gazetteer {y} has unexpected columns {list(df.columns)[:8]}")
        rep.append(("Land area source", "INFO", f"Census {y} Gazetteer ZCTA file ({len(df):,} ZIPs)"))
        return df.set_index(df.GEOID.str.strip().str.zfill(5)).ALAND_SQMI.astype(float)
    raise RuntimeError("No Census Gazetteer ZCTA file could be found")


# Categories reviewed (Oct 2026) where business employment isn't a fair benchmark: the score is kept as is and the check
# lists them as reviewed, with the reason, instead of weak. Keyed by category label, or by the benchmark's business type.
REVIEWED = {
    "New cars": "dealers cluster in regional hubs and small towns and buyers travel to them; every score part, including EASI new-vehicle spending, runs against dealer density",
    "New trucks and SUVs": "same as new cars", "Used cars": "same as new cars", "Used trucks and SUVs": "same as new cars",
    "furniture retailers": "stores cluster in regional hubs and showroom centers and buyers travel to them",
    "Tax preparation": "offices follow market size; the score uses IRS counts of returns filed through paid preparers, the direct measure of customers",
    "Eye care": "need (age 45+, diabetes, vision difficulty) runs highest where providers are scarcer; the DMA check passes",
}


def validate_scores(rep, z, co, subs, levels, what="businesses"):
    """Reality check: rank correlation between each category's Market Potential Score and an independent benchmark,
    Census employees in the category's industries per 1,000 households. Businesses hire where customers buy, and head
    counts aren't inflated by local wages the way dollar figures are. Shown with and without the Competition part,
    which is business density reversed and so works against this benchmark by design. Reported, not enforced.
    subs: list of (id, label, naics list); levels: list of (label, scored frame, ZIP column grouping into its index)."""
    if co.emp.notna().sum() == 0:
        rep.append(("Score reality check", "INFO", "Census employment counts not available; skipped")); return
    cpop = z.groupby("county_fips").population.transform("sum")
    share = (z.population / cpop).where(cpop > 0, 0)
    for lab, df, col in levels:
        lines, weak = [], []
        for sid, slab, naics in subs:
            ce = co[co.naics.isin(naics)].groupby("county_fips").emp.sum(min_count=1)
            emp = (z.county_fips.map(ce).fillna(0) * share).groupby(z[col]).sum()
            bench = (emp.reindex(df.index) / df.households * 1000).where(df.households > 0)
            sc = df.get(f"score@{sid}")
            if sc is None: continue
            nc = combine([df[f"demand@{sid}"], df[f"category@{sid}"], df[f"spend@{sid}"]], [0.40, 0.25, 0.15])   # missing parts drop out
            ok = sc.notna() & bench.notna() & (bench > 0)
            if ok.sum() < 30: continue
            r1 = sc[ok].rank().corr(bench[ok].rank()); r2 = nc[ok].rank().corr(bench[ok].rank())
            lines.append(f"{slab} {r1:.2f} ({r2:.2f})")
            if r2 < 0.2: weak.append(slab)
        if lines:
            rev = [w for w in weak if w in REVIEWED or what in REVIEWED]
            weak = [w for w in weak if w not in rev]
            why = sorted({REVIEWED.get(w) or REVIEWED.get(what) for w in rev})
            rep.append((f"Score reality check, {lab}: rank correlation with {what}' employees per 1,000 households, score (without Competition)",
                        "INFO", "; ".join(lines) + (f". Weak (under 0.20 without Competition): {', '.join(weak)}" if weak else ". None weak.")
                        + (f" Reviewed and kept (benchmark doesn't fit): {', '.join(rev)} ({'; '.join(why)})." if rev else "")))


# ---------------- Scoring helpers ----------------
def pct(s):
    """Percentile 0-100 within the group; missing stays missing."""
    return (s.rank(pct=True, method="average") * 100).round(2)


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


# ---------------- CDC BRFSS: national condition rates by age (for the radius tool) ----------------
# CDC PLACES gives one rate for all adults in a ZIP. The radius tool splits that rate across its age groups using CDC's
# national BRFSS rates by age (the same survey PLACES is modeled from), so diabetes, high blood pressure and arthritis
# rise with age instead of being applied evenly. Source: BRFSS Prevalence Data (2011 to present), data.cdc.gov dttw-5yxu,
# the all-states median by age group. BRFSS's oldest group is 65+, so 65-74 and 75+ share its rate.
BRFSS_WHERE = ("break_out_category='Age Group' AND (upper(question) like '%DIABETES%' OR upper(question) like '%HIGH BLOOD PRESSURE%' "
               "OR upper(question) like '%ARTHRITIS%' OR upper(question) like '%DEPRESS%' OR upper(question) like '%GENERAL HEALTH%' "
               "OR upper(question) like '%MENTAL HEALTH%' OR upper(topic) like '%BMI%' OR upper(question) like '%BMI%' OR upper(question) like '%BODY MASS%')")
BRFSS_URL = ("https://data.cdc.gov/resource/dttw-5yxu.json?$limit=300000&$select=year,locationabbr,topic,question,response,"
             "break_out,data_value&$where=" + urllib.parse.quote(BRFSS_WHERE))
BRFSS_AGES = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"]


def brfss_pick(rows, cond):
    """Rows of one BRFSS measure for a condition."""
    def q(r): return (r.get("question") or "").lower()
    def resp(r): return (r.get("response") or "").strip().lower()
    if cond == "obesity":
        return [r for r in rows if "bmi" in (q(r) + (r.get("topic") or "").lower()) and resp(r).startswith("obese")]
    if cond == "fairpoor":
        return [r for r in rows if "general health" in q(r) and resp(r) in ("fair", "poor")]
    if cond == "mhlth":
        return [r for r in rows if "mental health" in q(r) and ("14" in resp(r) or "frequent" in resp(r))]
    words = {"diabetes": ["diabetes"], "bphigh": ["high blood pressure"], "arthritis": ["arthritis"], "depression": ["depress"]}[cond]
    return [r for r in rows if all(w in q(r) for w in words) and resp(r) == "yes" and "medic" not in q(r)
            and "pre-diabetes" not in q(r) and "borderline" not in q(r)]


def condition_age_rates(cache, rep):
    """{condition: {radius age group: national % of adults}}, or {} if unavailable."""
    try:
        if cache:
            p = os.path.join(cache, "brfss_age.json")
            if not os.path.exists(p): raise RuntimeError("test cache has no brfss_age.json")
            rows = json.load(open(p))
        else:
            log("Downloading CDC BRFSS rates by age"); rows = json.loads(get(BRFSS_URL, tries=3, timeout=300))
        log(f"BRFSS rows: {len(rows):,}")
    except Exception as e:
        rep.append(("CDC BRFSS rates by age", "WARN", f"not available this run ({e}); radius tool applies each ZIP's all-adult condition rate at every age"))
        return {}
    # National adults by BRFSS age group (ACS), to combine BRFSS groups into the radius tool's groups
    acs = json.load(open(os.path.join(ROOT, "shared", "audience", "zip_audience.json")))["cols"]
    hl = json.load(open(os.path.join(ROOT, "shared", "audience", "zip_audience_health.json")))["cols"]
    tot = lambda cols, k: float(sum(x or 0 for x in cols[k]))
    n = {g: tot(acs, "m" + k) + tot(acs, "f" + k) for g, k in (("18-24", "18_24"), ("25-34", "25_34"), ("35-44", "35_44"), ("45-54", "45_54"))}
    n["55-64"] = tot(hl, "mh35_64") + tot(hl, "fh35_64") - n["35-44"] - n["45-54"]
    n["65+"] = sum(tot(hl, s + "h" + b) for s in "mf" for b in ("65_74", "75p"))
    # Adults by single year of age (each ACS group spread evenly; 65+ spread over 65-89), to weight CDC's age bands
    spans = {"18-24": (18, 24), "25-34": (25, 34), "35-44": (35, 44), "45-54": (45, 54), "55-64": (55, 64), "65+": (65, 89)}
    popy = {a: 0.0 for a in range(18, 121)}
    for g, (lo, hi) in spans.items():
        for a in range(lo, hi + 1): popy[a] = n[g] / (hi - lo + 1)
    RGROUPS = {"18_34": (18, 34), "35_64": (35, 64), "65_74": (65, 120), "75p": (65, 120)}   # CDC's oldest band is 65+

    def tile(bands):
        """Non-overlapping age bands covering 18 and up, finest first: [(low, high, rate)] or None."""
        parsed = sorted((int(k.split("-")[0]), int(k.split("-")[1]), v) for k, v in bands.items() if k and v > 0)
        cur, out_ = 18, []
        while cur <= 120:
            nxt = [b for b in parsed if b[0] == cur]
            if not nxt: return None
            b = min(nxt, key=lambda b: b[1]); out_.append(b); cur = b[1] + 1
            if b[1] >= 120: break
        return out_ if out_ and out_[-1][1] >= 120 else None
    def band(x):
        """Age label -> (low, high): "18-24" -> (18, 24); "65+" or "65 or older" -> (65, 120). None if not an age band."""
        m = re.findall(r"\d+", x or "")
        if not m: return None
        lo = int(m[0]); hi = int(m[1]) if len(m) > 1 else 120
        return f"{lo}-{hi}" if 18 <= lo < hi else None
    for r in rows: r["break_out"] = band(r.get("break_out"))
    locs = sorted({r.get("locationabbr") for r in rows if r.get("locationabbr")})
    rep.append(("CDC BRFSS download", "INFO", f"{len(rows):,} rows by age; {len(locs)} locations; national median rows: {'yes' if 'US' in locs else 'no'}"))
    # Without CDC's national median rows, take the median across states that publish the cell (at least 10; states suppress
        # small cells, such as diabetes at 18-24)
    if "US" not in locs and rows:
        states = {x for x in locs if x and len(x) == 2 and x not in ("GU", "PR", "VI", "UW")}
        cells = {}
        for r in rows:
            if r.get("locationabbr") in states and r.get("data_value") not in (None, "") and r["break_out"]:
                cells.setdefault((r["year"], r.get("topic"), r["question"], r["response"], r["break_out"]), []).append(float(r["data_value"]))
        rows = rows + [{"year": y, "locationabbr": "US", "topic": t, "question": q, "response": rs, "break_out": ag, "data_value": float(np.median(v))}
                       for (y, t, q, rs, ag), v in cells.items() if len(v) >= 10]
    # Diagnostic copy of the diabetes and arthritis rows (national), so a mismatch can be inspected after the build
    try:
        chk = [r for r in rows if r.get("locationabbr") == "US" and any(w in (r.get("question") or "").lower() for w in ("diabetes", "arthritis"))]
        json.dump(chk[:3000], open(os.path.join(OUT, "brfss_rows_check.json"), "w"))
    except Exception as e:
        log(f"BRFSS check file not written: {e}")
    out, used = {}, []
    for cond in RADIUS_CONDITIONS:
        if cond == "nodental": continue
        best = None
        for loc in ("US", "UW"):
            sel = [r for r in brfss_pick(rows, cond) if r.get("locationabbr") == loc and r.get("data_value") not in (None, "")]
            for y in sorted({int(r["year"]) for r in sel}, reverse=True):
                ry = [r for r in sel if int(r["year"]) == y]
                for qtext in sorted({r["question"] for r in ry}):          # CDC may list several versions; take the first complete one
                    rq = [r for r in ry if r["question"] == qtext]
                    bands = {}
                    for r in rq: bands[r["break_out"]] = bands.get(r["break_out"], 0) + float(r["data_value"])
                    tiles = tile(bands)
                    if tiles: best = (y, loc, qtext, tiles); break
                if best: break
            if best: break
        if not best:
            near = sorted({f"{r.get('question')} = {r.get('response')}" for r in rows if r.get("locationabbr") == "US"
                           and any(w in (r.get("question") or "").lower() for w in (cond[:5], "bmi", "health"))})[:6]
            rep.append((f"CDC BRFSS rates by age: {DEMAND_LABELS[cond]}", "WARN", "not found; radius tool uses the all-adult rate at every age. Nearby: " + " | ".join(near)))
            continue
        y, loc, qtext, tiles = best
        rate_at = lambda age: next(v for lo, hi, v in tiles if lo <= age <= hi)
        out[cond] = {g: round(sum(rate_at(a) * popy[a] for a in range(glo, ghi + 1)) / sum(popy[a] for a in range(glo, ghi + 1)), 2)
                     for g, (glo, ghi) in RGROUPS.items()}
        used.append(f"{DEMAND_LABELS[cond]} ({y}, \u201c{qtext[:60]}\u201d): " + ", ".join(f"{g.replace('_', '–').replace('p', '+')} {r:.1f}%" for g, r in out[cond].items()))
        log(f"BRFSS {cond}: {y} {loc} '{qtext}' -> {out[cond]}")
    if out:
        rep.append(("CDC BRFSS rates by age (all-states median)", "INFO", "; ".join(used)))
        # Checks: rates are percentages, and conditions that rise with age do (catches a wrong question or response)
        bad = [c for c, r in out.items() if not all(0 < x < 100 for x in r.values())]
        rising = [c for c in ("diabetes", "bphigh", "arthritis") if c in out and not out[c]["65_74"] > 2 * out[c]["18_34"]]
        ok = not bad and not rising
        rep.append(("CDC BRFSS rates by age: plausible", "PASS" if ok else "FAIL",
                    "diabetes, high blood pressure and arthritis at least twice as common at 65+ as at 18–34" if ok
                    else f"out of range: {bad}; not rising with age: {rising}; radius tool uses all-adult rates"))
        if not ok: return {}
    return out


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
    hl = pd.DataFrame(json.load(open(os.path.join(ROOT, "shared", "audience", "zip_audience_health.json")))["cols"])
    ins_cols = ["inst_18_34", "inst_35_64", "unins_18_34", "unins_35_64"]
    if any(c not in hl.columns for c in ins_cols):
        sys.exit("shared/audience/zip_audience_health.json has no insurance counts; the audience step must run first.")
    hl["ins_base"] = hl.inst_18_34 + hl.inst_35_64; hl["ins_yes"] = hl.ins_base - hl.unins_18_34 - hl.unins_35_64
    z = z.merge(hl[["zip", "ins_base", "ins_yes"]], on="zip", how="left")
    z["land"] = z.zip.map(zcta_land(a.cache, rep))          # square miles, for households per square mile

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
        pz, have_z = places_table("zcta", ids["zcta"][0][1], a.cache)
        pc, have_c = places_table("county", ids["county"][0][1], a.cache)
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
        for k in have: z[f"{k}_fill"] = np.where(z[k].notna(), 0, -1); z[f"{k}_low"] = False   # 0 = current CDC release
        cent = county_centroids(aud["cols"], z)
        prev_year = None
        if len(ids["zcta"]) > 1 and len(ids["county"]) > 1:
            try:
                prev_year = ids["zcta"][1][0]
                pzp, _ = places_table("zcta", ids["zcta"][1][1], a.cache)
                pcp, _ = places_table("county", ids["county"][1][1], a.cache)
            except Exception as e:
                pzp = pcp = None
                rep.append(("CDC PLACES previous release", "WARN", f"not available this run ({e}); tested without it"))
        else:
            pzp = pcp = None
            rep.append(("CDC PLACES previous release", "WARN", "not found on data.cdc.gov; tested without it"))
        if pzp is None: pzp = pd.DataFrame({"id": []})
        fill_from_previous(z, have, pzp, pcp, prev_year, release, rep, cent)
        for k in have: z[f"{k}_n"] = z[k] * z.adults18
        if True:
            cov2 = z.loc[z[have[0]].notna(), "adults18"].sum() / z.adults18.sum()
            rep.append(("Adults covered by CDC PLACES plus estimates", "INFO", f"{cov2:.1%}"))
    except Exception as e:
        prev_year = None
        for k in have:
            if f"{k}_fill" not in z.columns: z[f"{k}_fill"] = 0; z[f"{k}_low"] = False
        rep.append(("CDC PLACES download", "WARN", f"not available this run ({e}); Consumer Demand uses Census inputs only"))
        release = None

    cond_age = condition_age_rates(a.cache, rep)

    # ---------------- Aggregate to a level ----------------
    def agg(g):
        """g: DataFrame of ZIP rows -> dict of raw values for one area."""
        r = {"population": g.population.sum(), "households": g.households.sum(),
             "acs_pop": g.acs_pop.sum(min_count=1), "adults": g.adults18.sum(min_count=1)}
        land = g.land.where(g.land > 0).sum()
        r["density"] = g.households.where(g.land > 0, 0).sum() / land if land > 0 else np.nan
        for c in ("a65p", "a75p", "a45p", "a25_64", "a30_64"): r[c] = g[c].sum(min_count=1)
        ap = g.acs_pop.sum()
        for c, k in (("a45p", "a45s"), ("a65p", "a65s"), ("a30_64", "a30_64s")): r[k] = g[c].sum() / ap if ap > 0 else np.nan
        ib = g.ins_base.sum(); r["ins1864"] = g.ins_yes.sum() / ib if ib > 0 else np.nan
        r["kids_share"] = g.hh_kids.sum() / g.hh_tot.sum() if g.hh_tot.sum() > 0 else np.nan
        r["inc75_share"] = g.inc75.sum() / g.inc_tot.sum() if g.inc_tot.sum() > 0 else np.nan
        r["inc150_share"] = g.inc150.sum() / g.inc_tot.sum() if g.inc_tot.sum() > 0 else np.nan
        for k in have:
            ok = g[k].notna() & g.adults18.notna(); tot = g.loc[ok, "adults18"].sum()
            r[f"{k}_fillsh"] = g.loc[ok & (g[f"{k}_fill"] > 0), "adults18"].sum() / tot if tot > 0 else 0
            r[f"{k}_lowsh"] = g.loc[ok & g[f"{k}_low"].astype(bool), "adults18"].sum() / tot if tot > 0 else 0
            for c in FILL_TEXT: r[f"{k}_c{c}"] = g.loc[ok & (g[f"{k}_fill"] == c), "adults18"].sum() / tot if tot > 0 else 0
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
            use = [c for c in parts if not (c == "comp" and not COUNTED(s)) and not (c == "spend" and not s.get("spend", True))]
            df[f"spend@{i}"] = spend if "spend" in use else np.nan
            df[f"comp@{i}"] = P(-df[f"per10k@{i}"]) if "comp" in use else np.nan
            cols = [df[f"{c}@{i}"] for c in use]
            full = pd.concat(cols, axis=1).notna().all(axis=1)
            wts = [s.get("catw", WEIGHTS[c]) if c == "category" else WEIGHTS[c] for c in use]   # med spa: broad personal care spending counts less
            df[f"score@{i}"] = combine(cols, wts).where(full & mask).round(3)
            for c in WEIGHTS: df[f"{c}@{i}"] = df[f"{c}@{i}"].round(2)
            under = (df[f"demand@{i}"] >= 70) & (P(df[f"per10k@{i}"]) <= 30)
            known = df[f"demand@{i}"].notna() & df[f"per10k@{i}"].notna() & mask
            if "comp" not in parts: known &= df[f"per10k@{i}"] > 0   # ZIPs: a 0 count may be 1-2 hidden by Census
            df[f"under@{i}"] = np.where(under & known, "Yes", np.where(known, "No", None)) if COUNTED(s) else None
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
    cty = county_frame(z, frame); cty = score(cty, parts=COUNTY_PARTS, mask=county_mask(cty))
    rep.append(("Score reality check: categories not checked", "INFO", "; ".join(x["label"] for x in SUBCATS if not COUNTED(x)) +
                " (no Census industry matches these categories, so business employment isn't a meaningful benchmark)"))
    validate_scores(rep, z, co, [(x["id"], x["label"], x["naics"]) for x in SUBCATS if COUNTED(x)],
                    [("DMAs", dma, "dma_code"), ("metros", met, "cbsa_code")], "category businesses")
    us = frame([("us", z)])
    for s in SUBCATS:
        i = s["id"]
        us[f"est@{i}"] = nat_or(y, s["naics"], co)           # Census's national file (matches published U.S. totals)
        us[f"prev@{i}"] = nat_or(y - 1, s["naics"], co0)
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
            fsh = met[f"{k}_fillsh"]
            e_ = met[fsh >= 0.5]; o_ = met[fsh < 0.5]
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

    county_checks(rep, cty, [x["id"] for x in SUBCATS])
    failed = [r for r in rep if r[1] == "FAIL"]
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "healthcare_report.md"), "w") as f:
        f.write(f"# Healthcare data check report\n\nBuilt {built}. Result: **{'FAILED' if failed else 'PASSED'}**\n\n| Check | Result | Detail |\n| --- | --- | --- |\n")
        for r in rep: f.write(f"| {r[0]} | {r[1]} | {r[2]} |\n")
    for r in rep: log(f"[{r[1]}] {r[0]}: {r[2]}")
    if failed: sys.exit("A check failed; the Healthcare data was not updated. See healthcare/data/healthcare_report.md.")

    # ---------------- Write ----------------
    easi_spend_cols = [f"easi_{e}_{x}" for e in EASI_SPEND for x in ("hh", "total", "idx")]
    keep_common = ["population", "households", "adults", "a45p", "a65p", "a75p", "a30_64", "density"] + RATES + easi_spend_cols
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
                    if not COUNTED(s) and p in ("est", "per10k", "growth", "under", "comp"): continue
                    k = f"{p}@{s['id']}"
                    if k in df.columns:
                        x = clean(r[k])
                        v[k] = round(x, 3 if p == "score" else 2) if p in SCORE_KEYS and x is not None else x   # two decimals: ranks use the real value, so near-equal markets don't show as ties
            for k in ("population", "households", "adults", "a45p", "a65p", "a75p", "a30_64") + tuple(c for c in easi_spend_cols if c.endswith("_total")) + tuple(e for e in extra if not e.endswith(("_rate", "_g"))):
                if v.get(k) is not None: v[k] = int(round(v[k]))
            for s in SUBCATS:
                if v.get(f"est@{s['id']}") is not None: v[f"est@{s['id']}"] = int(round(v[f"est@{s['id']}"]))
            for s in SUBCATS:                       # the spending each category is scored on, under one name for every category
                e = s.get("easi", "med")
                for t in ("hh", "idx", "total"):
                    if v.get(f"easi_{e}_{t}") is not None: v[f"easi_{t}@{s['id']}"] = v[f"easi_{e}_{t}"]
            v = {k: x for k, x in v.items() if x is not None}          # missing keys read as "No data"
            f = flags_fn(idx, r) if flags_fn else []
            ek, methods, low = est_keys(r)
            f += est_notes(methods, low, release, prev_year)
            none = [s["label"] for s in SUBCATS if COUNTED(s) and f"score@{s['id']}" in df.columns and r.get(f"est@{s['id']}", 0) == 0
                    and r.get(f"score@{s['id']}") != r.get(f"score@{s['id']}")]          # zero businesses and no score
            if none and r.get("population", 0) >= MIN_POP:
                f.append("No Census-counted businesses here for: " + ", ".join(none) + ". Those categories aren't scored for this area.")
            row = {"id": str(idx), "name": names(idx), "v": v, "f": f}
            if ek:
                row["e"] = ek
                es = [s["id"] for s in SUBCATS if any(k in ek for k in s["demand"])]
                if es: row["es"] = es
            out.append(row)
        return out

    dname = dma_list.set_index("dma_code").dma_name
    tidy = lambda n: re.sub(r"(, )([A-Za-z]{2})\b", lambda m: m.group(1) + m.group(2).upper(), str(n).title())
    mname = met_list.set_index("cbsa_code").cbsa_name

    def flags(idx, r):
        f = []
        if str(idx) == "804": f.append("Palm Springs boundary is provisional: 28 Coachella Valley ZIPs assigned by Adtaxi, pending a Nielsen check.")
        if have and all(r.get(k) != r.get(k) for k in have): f.append("CDC health measures aren't published for this area, so Consumer Demand uses Census inputs only.")
        return f

    def est_keys(r):
        """Health measures for this area that are mostly filled in rather than current CDC values."""
        keys, methods, low = [], set(), []
        for k in have:
            if (r.get(f"{k}_fillsh", 0) or 0) >= 0.5 and r.get(k) == r.get(k):
                keys.append(k)
                methods |= {c for c in FILL_TEXT if (r.get(f"{k}_c{c}", 0) or 0) > 0}
                if (r.get(f"{k}_lowsh", 0) or 0) >= 0.5: low.append(DEMAND_LABELS[k].lower())
        return keys, methods, low

    meta = {"built": built, "cbpYear": y, "placesRelease": release, "acsYears": aud["meta"]["acsYears"]}
    json.dump({"level": "dma", "meta": meta, "rows": rows(dma, lambda i: tidy(dname.get(i, i)), flags)}, open(os.path.join(OUT, "dma.json"), "w"), separators=(",", ":"))
    json.dump({"level": "metro", "meta": meta, "rows": rows(met, lambda i: mname.get(i, i), flags, easi_cols)}, open(os.path.join(OUT, "metro.json"), "w"), separators=(",", ":"))
    cname = county_names()
    json.dump({"level": "county", "meta": meta, "rows": mark_unranked(rows(cty, lambda i: cname.get(str(i), str(i)), lambda i, r: county_flag(r)), cty)},
              open(os.path.join(OUT, "county.json"), "w"), separators=(",", ":"))
    json.dump({"level": "us", "meta": meta, "rows": rows(us, lambda i: "United States")}, open(os.path.join(OUT, "us.json"), "w"), separators=(",", ":"))

    # ZIPs inside each market, ranked within the market (no ZIP-level payroll, so Spending Power is left out there)
    nfiles = 0
    for level, col, src in (("dma", "dma_code", zd), ("metro", "cbsa_code", zm),
                                ("county", "county_fips", z[z.county_fips.astype(str).str.len() == 5])):
        folder = os.path.join(OUT, "zip", level); os.makedirs(folder, exist_ok=True)
        for code, g in src.groupby(col):
            df = g.set_index("zip")
            f = pd.DataFrame(index=df.index)
            f["population"], f["households"], f["adults"] = df.population, df.households, df.adults18
            f["density"] = (df.households / df.land).where(df.land > 0)
            for c in ("a65p", "a75p", "a45p", "a25_64", "a30_64"): f[c] = df[c]
            for c, k in (("a45p", "a45s"), ("a65p", "a65s"), ("a30_64", "a30_64s")): f[k] = (df[c] / df.acs_pop).where(df.acs_pop > 0)
            f["ins1864"] = (df.ins_yes / df.ins_base).where(df.ins_base > 0)
            f["kids_share"] = (df.hh_kids / df.hh_tot).where(df.hh_tot > 0)
            f["inc75_share"] = (df.inc75 / df.inc_tot).where(df.inc_tot > 0)
            f["inc150_share"] = (df.inc150 / df.inc_tot).where(df.inc_tot > 0)
            for k in have: f[k] = df[k]
            for k in have:
                f[f"{k}_fillsh"] = (df[f"{k}_fill"] > 0).astype(float); f[f"{k}_lowsh"] = df[f"{k}_low"].astype(float)
                for c in FILL_TEXT: f[f"{k}_c{c}"] = (df[f"{k}_fill"] == c).astype(float)
            for s in SUBCATS:
                f[f"est@{s['id']}"] = df[f"est_{s['id']}"]; f[f"prev@{s['id']}"] = df[f"est_prev_{s['id']}"]
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
            # no build date in ZIP files, so a rebuild with unchanged data doesn't rewrite all of them
            json.dump({"level": "zip", "parent": {"level": level, "id": code}, "rows": out},
                      open(os.path.join(folder, f"{code}.json"), "w"), separators=(",", ":"))
            nfiles += 1
    log(f"Wrote {len(dma)} DMAs, {len(met)} metros and {nfiles} ZIP files to {OUT}")

    # ZIP condition rates for the Healthcare radius tool (CDC PLACES share of adults, in tenths of a percent, with the
    # same county and estimated fills the scores use). The radius tool joins these to the ZIP audience data by ZIP.
    radius_keys = [k for k in RADIUS_CONDITIONS if k in have]
    zc_out = z[z[radius_keys[0]].notna()] if radius_keys else z.iloc[0:0]
    cols = {"zip": zc_out.zip.tolist()}
    for k in radius_keys:
        cols[k] = [None if pd.isna(x) else int(round(x * 1000)) for x in zc_out[k]]
        cols[k + "_est"] = [int(x > 0) for x in zc_out[f"{k}_fill"]]
    json.dump({"meta": {"built": built, "release": release, "units": "tenths of a percent of adults 18+",
                        "labels": {k: DEMAND_LABELS[k] for k in radius_keys},
                        "ageRates": {k: v for k, v in cond_age.items() if k in radius_keys}}, "cols": cols},
              open(os.path.join(OUT, "zip_conditions.json"), "w"), separators=(",", ":"))
    log(f"Wrote {len(zc_out):,} ZIPs of condition rates ({', '.join(radius_keys) or 'none'}) for the radius tool")


if __name__ == "__main__":
    main()
