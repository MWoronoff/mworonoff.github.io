"""Builds the Home Services Market Analyzer data (Market Potential Scores) into home-services/data/.

The analyzer shows home service companies where their potential customers are and how to focus ad dollars
geographically. It covers only the categories with EASI household spending: HVAC, Roofing and gutters, Plumbing,
Electrical, Painting and wallpaper, Flooring, and Any home service (all of them together).

Sources, all public downloads with no key (plus Adtaxi's EASI file in data-build/sources):
  - Census County and ZIP Business Patterns: roofing (238160), electrical (238210), plumbing, heating and
    air-conditioning (238220), painting and wall covering (238320) and flooring (238330) contractors. Census counts HVAC
    and plumbing contractors as one industry.
  - shared/audience/zip_audience.json and zip_audience_home.json: Census ACS homeowners, year built, single-family
    homes, year moved in, home values and income by ZIP (built earlier in the same workflow)
  - NOAA nClimDiv county heating and cooling degree days (HVAC) and NOAA Storm Events hail reports (Roofing)
  - data-build/sources/easi_home_spend_metro.csv: EASI 2025 household spending by metro and micro area on heat, a/c
    and electrical work; roofing and gutters; and plumbing and water heating (Category Spending). EASI has no DMA
    version, so DMA spending is the household-weighted average of the metro and micro areas inside the DMA.
  - data-build/sources/easi_paint_floor_spend_dma.csv: EASI 2025 household spending by DMA on painting and papering,
    paints, wallpaper and supplies, and flooring installation, repair and replacement. A metro's spending is the
    household-weighted average of the DMAs its ZIPs fall in. easi_dma_crosswalk.csv ties EASI's DMA names to DMA codes.
Geography comes from data-build/geo (ZIP -> county, metro, DMA). Download helpers are shared with build_healthcare.py.

  python3 data-build/build_home_services.py              # live (GitHub Actions)
  python3 data-build/build_home_services.py --cache DIR  # read saved downloads from DIR (tests)
"""
import argparse, datetime, gzip, io, json, os, re, sys
import numpy as np
import pandas as pd
from build_healthcare import cbp_years, zbp, cbp_county, pct, combine, fetch, get
import urllib.request, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GEO = os.path.join(HERE, "geo")
OUT = os.path.join(ROOT, "home-services", "data")
MIN_POP = 500
CLIMDIV = "https://www.ncei.noaa.gov/pub/data/cirs/climdiv/"
STORMS = "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/"
YEARS = 10                              # climate and hail: average of the last 10 complete years
HAIL_MIN = 1.0                          # inches: hail this size or larger damages roofs
GAZ = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/{y}_Gazetteer/{y}_Gaz_zcta_national.zip"

# Market Potential Score: where a home service company's potential customers are. Each part is a percentile (0-100).
WEIGHTS = {"demand": 0.40, "category": 0.25, "spend": 0.15, "comp": 0.20}
ZIP_PARTS = ("demand", "spend")      # ZIPs: no EASI spending by ZIP, and ZIP business counts are suppressed under 3
PALM_SPRINGS = "804"

# EASI items: column stem in easi_home_spend_metro.csv
EASI = {"hvac": "hvac_elec", "roof": "roofing", "plumb": "plumbing"}            # by metro and micro area
DMA_EASI = {"paint": "painting", "floor": "flooring", "paintsup": "paint_supplies"}  # by DMA (supplies shown, not scored)
ANY_EASI = ["hvac", "roof", "plumb", "paint", "floor"]                           # Any home service: all five services
ALL_EASI = list(EASI) + list(DMA_EASI)
LA_DMA = "803"
SUBCATS = [
    {"id": "any", "label": "Any home service", "naics": ["238160", "238210", "238220", "238320", "238330"], "easi": ANY_EASI,
     "demand": ["owners", "pre2000_share", "sfd_share", "lt_share"]},
    {"id": "hvac", "label": "HVAC", "naics": ["238220"], "easi": ["hvac"], "demand": ["owners", "degdays", "pre2000_share"]},
    {"id": "roof", "label": "Roofing and gutters", "naics": ["238160"], "easi": ["roof"], "demand": ["sfd_own", "hail_days", "pre2000_share"]},
    {"id": "plumb", "label": "Plumbing", "naics": ["238220"], "easi": ["plumb"], "demand": ["owners", "pre1980_share"]},
    {"id": "elec", "label": "Electrical", "naics": ["238210"], "easi": ["hvac"], "demand": ["owners", "pre1980_share", "val300_share"]},
    {"id": "paint", "label": "Painting and wallpaper", "naics": ["238320"], "easi": ["paint"], "demand": ["owners", "val300_share", "lt_share"]},
    {"id": "floor", "label": "Flooring", "naics": ["238330"], "easi": ["floor"], "demand": ["owners", "pre2000_share", "lt_share"]},
]
DEMAND_LABELS = {"owners": "Homeowners", "sfd_own": "Owners of single-family detached homes", "pre1980_share": "Owner homes built before 1980",
                 "pre2000_share": "Owner homes built before 2000", "sfd_share": "Owner homes that are single-family detached",
                 "lt_share": "Owners in their home since before 2010", "val300_share": "Owner homes worth $300K+",
                 "degdays": "Heating + cooling degree days", "hail_days": "Days a year with 1-inch+ hail"}
COUNTS = ["population", "households", "owners", "sfd_own"]
DENSITY = ["density"]                                    # households per square mile of land
RATES = ["own_share", "pre1980_share", "pre2000_share", "sfd_share", "lt_share", "val300_share", "inc75_share"]
CLIMATE = ["hdd", "cdd", "degdays", "hail_days"]           # household-weighted averages of county values
RATE_PARTS = {"own_share": ("owners", "hh_tot"), "pre1980_share": ("hb_pre1980", "hb_tot"), "pre2000_share": ("hb_pre2000", "hb_tot"),
              "sfd_share": ("sfd_own", "hu_tot"), "lt_share": ("lt_own", "hm_tot"), "val300_share": ("val300", "val_tot"),
              "inc75_share": ("inc75", "inc_tot")}
ACS_COLS = ["own_tot", "hh_tot", "inc_tot", "inc_75_100", "inc_100_150", "inc_150_200", "inc_200p", "val_tot", "val300"]
HOME_COLS = ["hb_tot", "hb_pre1980", "hb_80_99", "hb_2000p", "hu_tot", "sfd_own", "hm_tot", "lt_own"]
# NOAA climate division state codes (alphabetical, no DC or Hawaii; Alaska is 50) -> Census state FIPS
NOAA_STATE = dict(zip([f"{i:02d}" for i in range(1, 49)] + ["50"],
                      ["01", "04", "05", "06", "08", "09", "10", "12", "13", "16", "17", "18", "19", "20", "21", "22", "23", "24",
                       "25", "26", "27", "28", "29", "30", "31", "32", "33", "34", "35", "36", "37", "38", "39", "40", "41", "42",
                       "44", "45", "46", "47", "48", "49", "50", "51", "53", "54", "55", "56", "02"]))
CT_OLD = [f"09{n:03d}" for n in range(1, 16, 2)]          # Connecticut's eight former counties (NOAA's codes)


def log(*a): print(*a, flush=True)


def self_test():
    s = pct(pd.Series([10, 20, 30, 40, np.nan]))
    assert list(s[:4]) == [25.0, 50.0, 75.0, 100.0] and np.isnan(s[4]), s
    c = combine([pd.Series([100.0, np.nan]), pd.Series([0.0, 50.0])], [0.40, 0.25])
    assert abs(c[0] - 40 / 0.65) < 1e-9 and c[1] == 50.0, c
    assert abs(sum(WEIGHTS.values()) - 1) < 1e-9, WEIGHTS
    d = degree_days_from_temp(pd.Series([65.0, 45.0, 85.0]), pd.Series([31, 31, 31]))
    assert list(d[0]) == [0.0, 620.0, 0.0] and list(d[1]) == [0.0, 0.0, 620.0], d
    assert NOAA_STATE["48"] == "56" and NOAA_STATE["50"] == "02" and NOAA_STATE["36"] == "42", NOAA_STATE
    return "percentile, weighted-average, degree-day and NOAA state-code hand checks reproduce exactly"


# ---------------- NOAA ----------------
def listing(name, url, cache):
    return fetch(name, url, cache).decode("utf-8", "replace")


def degree_days_from_temp(t, days):
    """Monthly heating and cooling degree days from a monthly mean temperature (base 65F)."""
    return ((65 - t).clip(lower=0) * days, (t - 65).clip(lower=0) * days)


def climdiv(cache, rep):
    """County heating and cooling degree days per year, average of the last YEARS complete years.
    Uses NOAA's county degree-day files when published, otherwise monthly mean temperatures."""
    idx = listing("climdiv_index.html", CLIMDIV, cache)
    latest = lambda el: max(re.findall(rf"climdiv-{el}-v[\d.]+-\d{{8}}", idx) or [None])
    files = {el: latest(el) for el in ("hddccy", "cddccy", "tmpccy")}
    use_dd = files["hddccy"] and files["cddccy"]
    if not use_dd and not files["tmpccy"]: raise RuntimeError("NOAA climdiv has no county degree-day or temperature files")

    def read(el):
        txt = fetch(files[el], CLIMDIV + files[el], cache).decode("utf-8", "replace")
        recs = []
        for line in txt.splitlines():
            if len(line) < 20: continue
            vals = [float(x) for x in line[11:].split()]
            if len(vals) != 12: continue
            recs.append([line[0:2], line[2:5], int(line[7:11])] + vals)
        df = pd.DataFrame(recs, columns=["st", "cty", "year"] + list(range(1, 13)))
        df = df[df.st.isin(NOAA_STATE)]
        df["county_fips"] = df.st.map(NOAA_STATE) + df.cty
        return df

    if use_dd:
        out = {}
        for el, key in (("hddccy", "hdd"), ("cddccy", "cdd")):
            df = read(el)
            m = df[list(range(1, 13))]
            df["annual"] = m.sum(axis=1).where((m > -99).all(axis=1))
            out[key] = df[["county_fips", "year", "annual"]]
        method = f"NOAA county degree-day files ({files['hddccy']}, {files['cddccy']})"
    else:
        df = read("tmpccy")
        days = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        h = c = 0; ok = pd.Series(True, index=df.index)
        for k in range(1, 13):
            t = df[k]; ok &= t > -99
            hd, cd = degree_days_from_temp(t, days[k - 1]); h = h + hd; c = c + cd
        out = {"hdd": df.assign(annual=h.where(ok))[["county_fips", "year", "annual"]],
               "cdd": df.assign(annual=c.where(ok))[["county_fips", "year", "annual"]]}
        method = f"NOAA county monthly mean temperatures ({files['tmpccy']}); degree days estimated from monthly means, base 65F"
    res = {}
    for key, df in out.items():
        df = df.dropna(subset=["annual"])
        full = df.groupby("year").county_fips.count()
        yrs = sorted(full[full >= 0.9 * full.max()].index)[-YEARS:]
        res[key] = df[df.year.isin(yrs)].groupby("county_fips").annual.mean()
    rep.append(("Climate source", "INFO", f"{method}; years {yrs[0]}–{yrs[-1]}"))
    return res["hdd"], res["cdd"]


def hail(cache, rep):
    """Average days a year with 1-inch+ hail reported in each county, last YEARS complete years (NOAA Storm Events)."""
    idx = listing("storms_index.html", STORMS, cache)
    found = {}
    for y, c in re.findall(r"StormEvents_details-ftp_v1\.0_d(\d{4})_c(\d{8})\.csv\.gz", idx):
        found[int(y)] = max(found.get(int(y), ""), c)
    this = datetime.date.today().year
    yrs = sorted(y for y in found if y < this)[-YEARS:]
    if len(yrs) < YEARS: raise RuntimeError(f"NOAA Storm Events has only {len(yrs)} complete years")
    parts = []
    for y in yrs:
        name = f"StormEvents_details-ftp_v1.0_d{y}_c{found[y]}.csv.gz"
        df = pd.read_csv(io.BytesIO(gzip.decompress(fetch(name, STORMS + name, cache))), dtype=str,
                         usecols=["STATE_FIPS", "CZ_TYPE", "CZ_FIPS", "EVENT_TYPE", "MAGNITUDE", "BEGIN_YEARMONTH", "BEGIN_DAY"])
        df = df[(df.EVENT_TYPE == "Hail") & (df.CZ_TYPE == "C") & (pd.to_numeric(df.MAGNITUDE, errors="coerce") >= HAIL_MIN)]
        df["county_fips"] = df.STATE_FIPS.str.zfill(2) + df.CZ_FIPS.str.zfill(3)
        df["day"] = df.BEGIN_YEARMONTH + df.BEGIN_DAY.str.zfill(2)
        parts.append(df[["county_fips", "day"]].drop_duplicates())
    allr = pd.concat(parts)
    days = allr.groupby("county_fips").day.nunique() / len(yrs)
    ct = allr[allr.county_fips.str.startswith("09")]
    rep.append(("Hail source", "INFO", f"NOAA Storm Events, hail {HAIL_MIN:.0f}-inch+ by county, {yrs[0]}–{yrs[-1]}; "
                f"{len(allr):,} county-days with hail"))
    return days, len(ct) / len(yrs) / len(CT_OLD)   # Connecticut: average per former county


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
    hp = os.path.join(ROOT, "shared", "audience", "zip_audience_home.json")
    if not os.path.exists(hp): sys.exit("shared/audience/zip_audience_home.json is missing; the audience step must run first with the new build_audience.py.")
    home = pd.DataFrame(json.load(open(hp))["cols"])
    acs = pd.DataFrame(aud["cols"])
    miss = [c for c in ACS_COLS if c not in acs.columns] + [c for c in HOME_COLS if c not in home.columns]
    if miss: sys.exit(f"The audience files have no Home Services columns ({miss[:4]}...); the audience step must run first.")
    acs = acs[["zip"] + ACS_COLS].merge(home[["zip"] + HOME_COLS], on="zip", how="left")
    acs["inc75"] = acs[["inc_75_100", "inc_100_150", "inc_150_200", "inc_200p"]].sum(axis=1, min_count=4)
    acs["hb_pre2000"] = acs.hb_pre1980 + acs.hb_80_99
    acs = acs.rename(columns={"own_tot": "owners"})
    z = z.merge(acs.drop(columns=["inc_75_100", "inc_100_150", "inc_150_200", "inc_200p"]), on="zip", how="left")

    # Land area for household density
    z["land"] = z.zip.map(zcta_land(a.cache, rep))

    # NOAA climate and hail by county, then to ZIPs. Counties NOAA doesn't list use their state's average.
    hdd, cdd = climdiv(a.cache, rep)
    hail_days, ct_hail = hail(a.cache, rep)
    st = z.county_fips.str[:2]
    for key, ser in (("hdd", hdd), ("cdd", cdd)):
        z[key] = z.county_fips.map(ser)
        stm = ser.groupby(ser.index.str[:2]).mean()
        z[key] = z[key].fillna(st.map(stm))
    dc = z.county_fips == "11001"                # NOAA files Washington DC under Maryland: use its neighbors
    for key, ser in (("hdd", hdd), ("cdd", cdd)):
        nb = ser.reindex(["24031", "24033"]).mean()
        z.loc[dc & z[key].isna(), key] = nb
    z["degdays"] = z.hdd + z.cdd
    z["hail_days"] = z.county_fips.map(hail_days).fillna(0.0)
    ct = z.state == "CT"
    z.loc[ct, "hail_days"] = ct_hail          # NOAA reports by Connecticut's former counties; ZIPs use planning regions
    noclim = z[z.hdd.isna() & (z.population > 0)]
    rep.append(("ZIPs with NOAA climate data", "INFO", f"{1 - noclim.population.sum() / z.population.sum():.1%} of population; "
                f"none for {', '.join(sorted(noclim.state.dropna().unique())) or 'nobody'} (NOAA's county climate files skip Alaska and Hawaii)"))
    hot, cold = cdd.get("12086", np.nan), cdd.get("27053", np.nan)
    rep.append(("Climate sense check: Miami-Dade has more cooling and less heating than Minneapolis (Hennepin)",
                "PASS" if hot > cold and hdd.get("12086", 1e9) < hdd.get("27053", -1) else "FAIL",
                f"cooling {hot:,.0f} vs {cold:,.0f}; heating {hdd.get('12086', np.nan):,.0f} vs {hdd.get('27053', np.nan):,.0f}"))
    dal, la = hail_days.get("48113", 0), hail_days.get("06037", 0)
    rep.append(("Hail sense check: Dallas County has more 1-inch hail days than Los Angeles County", "PASS" if dal > la else "FAIL",
                f"{dal:.1f} vs {la:.1f} a year"))

    # Business Patterns
    all_naics = sorted({n for s in SUBCATS for n in s["naics"]})
    y = cbp_years(a.cache)
    rep.append(("Business Patterns years", "INFO", f"{y} (growth measured from {y - 1})"))
    zb, zb0 = zbp(y, a.cache), zbp(y - 1, a.cache)
    co, co0 = cbp_county(y, a.cache), cbp_county(y - 1, a.cache)
    cpop = z.groupby("county_fips").population.transform("sum")
    z["cshare"] = (z.population / cpop).where(cpop > 0, 0)
    for nid, lo, hi, name in (("238160", 15000, 45000, "roofing contractors"), ("238210", 50000, 110000, "electrical contractors"),
                              ("238220", 70000, 140000, "plumbing, heating and air-conditioning contractors"),
                              ("238320", 25000, 70000, "painting and wall covering contractors"), ("238330", 9000, 35000, "flooring contractors")):
        n = co[co.naics == nid].est.sum()
        rep.append((f"Published benchmark: {name}", "PASS" if lo <= n <= hi else "FAIL", f"{int(n):,} (expected {lo:,}–{hi:,})"))
    for s in SUBCATS:
        i = s["id"]
        for tag, src in (("", zb), ("_prev", zb0)):
            z[f"zest{tag}_{i}"] = z.zip.map(src[src.naics.isin(s["naics"])].groupby("zip").est.sum()).fillna(0)
        cs = co[co.naics.isin(s["naics"])].groupby("county_fips").est.sum()
        c0 = co0[co0.naics.isin(s["naics"])].groupby("county_fips").est.sum()
        z[f"cest_{i}"] = z.county_fips.map(cs).fillna(0) * z.cshare
        z[f"cprev_{i}"] = z.county_fips.map(c0).fillna(0) * z.cshare
    co_in = co[co.county_fips.isin(set(z.county_fips))]

    # EASI home spending by metro and micro area
    src = os.path.join(HERE, "sources")
    sp = os.path.join(src, "easi_home_spend_metro.csv")
    if not os.path.exists(sp): sys.exit("data-build/sources/easi_home_spend_metro.csv is missing (EASI home spending by metro).")
    sm = pd.read_csv(sp)
    em = pd.read_csv(os.path.join(src, "easi_metro_2025.csv"), dtype={"cbsa_code": str})
    key = lambda t: re.sub(r"[^a-z0-9]", "", str(t).lower())
    sm["cbsa_code"] = sm.market.map(key).map(dict(zip(em.metro.map(key), em.cbsa_code)))
    if sm.cbsa_code.isna().any(): sys.exit("EASI home spending markets not matched to a metro: " + ", ".join(sm[sm.cbsa_code.isna()].market[:10]))
    sm = sm.set_index("cbsa_code")
    us_hh = {k: sm[f"{c}_total"].sum() / sm.households.sum() for k, c in EASI.items()}
    rep.append(("EASI home spending markets matched", "PASS" if len(sm) >= 900 else "FAIL", f"{len(sm)} metro and micro areas (expected 925)"))
    rep.append(("EASI U.S. spending per household (metro and micro areas)", "INFO",
                "; ".join(f"{k} ${v:,.2f}" for k, v in us_hh.items())))
    for k, c in EASI.items():
        z[f"zeasi_{k}"] = z.cbsa_code.map(sm[f"{c}_per_hh"])
    covered = z["zeasi_hvac"].notna()
    for k in EASI:      # state average of covered households, used only for DMAs with no metro or micro area at all
        w_ = z.households.where(covered, 0)
        stavg = (z[f"zeasi_{k}"].fillna(0) * w_).groupby(z.state).sum() / w_.groupby(z.state).sum()
        z[f"zstate_{k}"] = z.state.map(stavg)
    rep.append(("Households in an EASI metro or micro area", "INFO", f"{z.loc[covered, 'households'].sum() / z.households.sum():.1%} "
                "(the rest are rural ZIPs outside any metro or micro area; DMA spending averages the covered households)"))

    # EASI painting and flooring spending by DMA; ZIPs carry their DMA's rate so metros get a household-weighted average
    sd = pd.read_csv(os.path.join(src, "easi_paint_floor_spend_dma.csv"))
    xw = pd.read_csv(os.path.join(src, "easi_dma_crosswalk.csv"), dtype={"dma_code": str})
    sd = sd.merge(xw[["easi_market", "dma_code"]], left_on="market", right_on="easi_market", how="left")
    if sd.dma_code.isna().any(): sys.exit("easi_dma_crosswalk.csv is missing EASI DMAs: " + ", ".join(sd[sd.dma_code.isna()].market))
    sd = sd.set_index("dma_code")
    rep.append(("EASI painting and flooring DMAs matched", "PASS" if len(sd) == 209 else "FAIL", f"{len(sd)} of 209"))
    for k, c in DMA_EASI.items():
        us_hh[k] = sd[f"{c}_total"].sum() / sd.households.sum()
        per = sd[f"{c}_per_hh"].copy()
        if PALM_SPRINGS not in per.index: per.loc[PALM_SPRINGS] = per.loc[LA_DMA]
        z[f"zeasi_{k}"] = z.dma_code.map(per)
    rep.append(("EASI Palm Springs (painting and flooring)", "INFO", "EASI includes Palm Springs in Los Angeles, so the provisional Palm Springs DMA uses the Los Angeles rate"))
    rep.append(("EASI U.S. painting and flooring spending per household", "INFO", "; ".join(f"{k} ${us_hh[k]:,.2f}" for k in DMA_EASI)))

    # ---------------- Aggregate ----------------
    def agg(g):
        r = {"population": g.population.sum(), "households": g.households.sum(), "owners": g.owners.sum(min_count=1),
             "sfd_own": g.sfd_own.sum(min_count=1)}
        for k, (n, d) in RATE_PARTS.items():
            den = g[d].sum(); r[k] = g[n].sum() / den if den > 0 else np.nan
        land = g.land.where(g.land > 0).sum()
        r["density"] = g.households.where(g.land > 0, 0).sum() / land if land > 0 else np.nan
        w = g.households.where(g.households > 0, 0)
        for k in CLIMATE:
            ok = g[k].notna() & (w > 0)
            r[k] = (g.loc[ok, k] * w[ok]).sum() / w[ok].sum() if w[ok].sum() > 0 else np.nan
        for s in SUBCATS:
            i = s["id"]; r[f"est@{i}"], r[f"prev@{i}"] = g[f"cest_{i}"].sum(), g[f"cprev_{i}"].sum()
        for k in DMA_EASI:  # household-weighted DMA rates (exact for a DMA: one value)
            ok = g[f"zeasi_{k}"].notna() & (w > 0)
            r[f"easi_{k}_hh"] = (g.loc[ok, f"zeasi_{k}"] * w[ok]).sum() / w[ok].sum() if w[ok].sum() > 0 else np.nan
        for k in EASI:     # household-weighted EASI spending of the covered households (exact for a metro: one value)
            ok = g[f"zeasi_{k}"].notna() & (w > 0)
            if w[ok].sum() > 0: r[f"easi_{k}_hh"] = (g.loc[ok, f"zeasi_{k}"] * w[ok]).sum() / w[ok].sum()
            else:
                ok = g[f"zstate_{k}"].notna() & (w > 0)
                r[f"easi_{k}_hh"] = (g.loc[ok, f"zstate_{k}"] * w[ok]).sum() / w[ok].sum() if w[ok].sum() > 0 else np.nan
        r["easi_cov"] = w[g.zeasi_hvac.notna()].sum() / w.sum() if w.sum() > 0 else np.nan
        return r

    def frame(groups):
        return pd.DataFrame.from_dict({k: agg(g) for k, g in groups}, orient="index")

    def add_easi(df):
        df["easi_any_hh"] = sum(df[f"easi_{k}_hh"] for k in ANY_EASI)
        us_any = sum(us_hh[k] for k in ANY_EASI)
        for k in ALL_EASI + ["any"]:
            base = us_any if k == "any" else us_hh[k]
            df[f"easi_{k}_total"] = df[f"easi_{k}_hh"] * df.households
            df[f"easi_{k}_idx"] = (df[f"easi_{k}_hh"] / base * 100).round(0)

    def score(df, parts=tuple(WEIGHTS), mask=None):
        if mask is None: mask = pd.Series(True, index=df.index)
        P = lambda s: pct(s.where(mask))
        spend = P(df.inc75_share)
        dem_pct = {k: P(df[k]) for k in DEMAND_LABELS if k in df.columns}
        for s in SUBCATS:
            i = s["id"]
            df[f"per10k@{i}"] = (df[f"est@{i}"] / df.population * 1e4).where(df.population > 0)
            df[f"growth@{i}"] = ((df[f"est@{i}"] - df[f"prev@{i}"]) / df[f"prev@{i}"]).where(df[f"prev@{i}"] >= 3)
            ins = [dem_pct[k] for k in s["demand"] if k in dem_pct and df[k].notna().any()]
            df[f"demand@{i}"] = combine(ins, [1] * len(ins)) if ins else np.nan
            ek = "any" if i == "any" else s["easi"][0]
            if "category" in parts and f"easi_{ek}_hh" in df.columns:
                df[f"category@{i}"] = combine([P(df[f"easi_{ek}_hh"]), P(df[f"easi_{ek}_total"])], [0.5, 0.5])
            else: df[f"category@{i}"] = np.nan
            for t in ("hh", "idx", "total"):      # the spending this service is scored on, under one name for every service
                if f"easi_{ek}_{t}" in df.columns: df[f"easi_{t}@{i}"] = df[f"easi_{ek}_{t}"]
            df[f"spend@{i}"] = spend
            df[f"comp@{i}"] = P(-df[f"per10k@{i}"]) if "comp" in parts else np.nan
            cols = [df[f"{c}@{i}"] for c in parts]
            full = pd.concat(cols, axis=1).notna().all(axis=1)
            df[f"score@{i}"] = combine(cols, [WEIGHTS[c] for c in parts]).where(full & mask).round(1)
            for c in WEIGHTS: df[f"{c}@{i}"] = pd.to_numeric(df[f"{c}@{i}"], errors="coerce").round(1)
            under = (df[f"demand@{i}"] >= 70) & (P(df[f"per10k@{i}"]) <= 30)
            known = df[f"demand@{i}"].notna() & df[f"per10k@{i}"].notna() & mask
            df[f"under@{i}"] = np.where(under & known, "Yes", np.where(known, "No", None))
        return df

    zd = z[z.dma_code != "0"]
    dma = frame(zd.groupby("dma_code")); add_easi(dma); dma = score(dma)
    zm = z[z.cbsa_code.isin(metros)]
    met = frame(zm.groupby("cbsa_code")); add_easi(met); met = score(met)
    us = frame([("us", z)])
    for s in SUBCATS:
        i = s["id"]
        us[f"est@{i}"] = co[co.naics.isin(s["naics"])].est.sum()            # includes statewide records
        us[f"prev@{i}"] = co0[co0.naics.isin(s["naics"])].est.sum()
        us[f"per10k@{i}"] = us[f"est@{i}"] / us.population * 1e4
        us[f"growth@{i}"] = (us[f"est@{i}"] - us[f"prev@{i}"]) / us[f"prev@{i}"]
    for k in ALL_EASI: us[f"easi_{k}_hh"] = us_hh[k]
    add_easi(us)
    for s in SUBCATS:
        ek = "any" if s["id"] == "any" else s["easi"][0]
        for t in ("hh", "idx", "total"): us[f"easi_{t}@{s['id']}"] = us[f"easi_{ek}_{t}"]

    # ---------------- Checks ----------------
    for name, df in (("DMA", dma), ("Metro", met)):
        sc = df[[f"score@{s['id']}" for s in SUBCATS]]
        bad = int(((sc < 0) | (sc > 100)).sum().sum())
        rep.append((f"{name} scores within 0–100", "PASS" if bad == 0 else "FAIL", f"{bad} out of range; {int(sc.notna().sum().sum()):,} scores computed, {int(sc.isna().sum().sum()):,} not computed (missing input)"))
    m_ok = met.easi_hvac_hh.notna().sum()
    rep.append(("EASI spending matched to metros", "PASS" if m_ok >= len(met) - 2 else "FAIL", f"{m_ok} of {len(met)}"))
    lowcov = dma[dma.easi_cov < 0.5]
    rep.append(("DMAs where under half the households are in an EASI area", "INFO", f"{len(lowcov)}: " + ", ".join(lowcov.index[:12])))
    r_ = met.easi_hvac_total.sum() / sm.loc[sm.index.isin(metros), "hvac_elec_total"].sum()
    r2 = dma.easi_paint_total.drop(PALM_SPRINGS, errors="ignore").sum() / sd.painting_total.sum()
    rep.append(("EASI painting total, DMAs vs. EASI's own total", "PASS" if 0.93 <= r2 <= 1.07 else "FAIL", f"{r2:.1%}"))
    rep.append(("EASI heat, a/c and electrical total, metros vs. EASI's own metro totals", "PASS" if 0.93 <= r_ <= 1.07 else "FAIL",
                f"{r_:.1%}"))
    for s in SUBCATS:
        i = s["id"]
        tot_d = dma[f"est@{i}"].sum()
        tot_c = co_in[co_in.naics.isin(s["naics"])].est.sum() - z[z.dma_code == "0"][f"cest_{i}"].sum()
        rep.append((f"DMA roll-up matches county totals: {s['label']}", "PASS" if tot_c > 0 and abs(tot_d - tot_c) / tot_c <= 0.005 else "FAIL",
                    f"DMAs {int(round(tot_d)):,} vs counties {int(round(tot_c)):,}"))
    for k, lo, hi in (("own_share", .58, .70), ("pre1980_share", .35, .56), ("sfd_share", .74, .90), ("lt_share", .30, .60), ("val300_share", .30, .65)):
        v_ = us[k].iloc[0]
        rep.append((f"U.S. {k.replace('_', ' ')}", "PASS" if lo <= v_ <= hi else "FAIL", f"{v_:.1%} (expected {lo:.0%}–{hi:.0%})"))
    for k, lo, hi in (("hdd", 3000, 6000), ("cdd", 900, 2600)):
        v_ = us[k].iloc[0]
        rep.append((f"U.S. household-weighted {k.upper()}", "PASS" if lo <= v_ <= hi else "FAIL", f"{v_:,.0f} (expected {lo:,}–{hi:,})"))
    rep.append(("U.S. household-weighted 1-inch hail days", "INFO", f"{us.hail_days.iloc[0]:.1f} a year"))
    v_ = us.density.iloc[0]
    rep.append(("U.S. households per square mile", "PASS" if 25 <= v_ <= 50 else "FAIL", f"{v_:.1f} (expected 25–50)"))
    nyc = dma.density.get("501", np.nan)
    rep.append(("Density sense check: New York DMA is far denser than the U.S.", "PASS" if nyc > 10 * v_ else "FAIL", f"{nyc:,.0f} vs {v_:.0f} households per square mile"))

    failed = [r for r in rep if r[1] == "FAIL"]
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "home_services_report.md"), "w") as f:
        f.write(f"# Home Services data check report\n\nBuilt {built}. Result: **{'FAILED' if failed else 'PASSED'}**\n\n| Check | Result | Detail |\n| --- | --- | --- |\n")
        for r in rep: f.write(f"| {r[0]} | {r[1]} | {r[2]} |\n")
    for r in rep: log(f"[{r[1]}] {r[0]}: {r[2]}")
    if failed: sys.exit("A check failed; the Home Services data was not updated. See home-services/data/home_services_report.md.")

    # ---------------- Write ----------------
    easi_keys = [f"easi_{k}_{t}" for k in ALL_EASI + ["any"] for t in ("hh", "total", "idx")]
    keep = COUNTS + DENSITY + RATES + CLIMATE + easi_keys
    per_sub = ["score", "demand", "category", "spend", "comp", "under", "est", "per10k", "growth", "easi_hh", "easi_idx", "easi_total"]
    SCORE_KEYS = ("score", "demand", "category", "spend", "comp")
    INTS = COUNTS + ["hdd", "cdd", "degdays"] + [k for k in easi_keys if k.endswith("_total")]
    SUB_INTS = ("est", "easi_total", "easi_idx")

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

    def mflags(idx, r):
        f = []
        if r.hdd != r.hdd: f.append("NOAA's county climate files don't cover Alaska or Hawaii, so the HVAC score here leaves out heating and cooling degree days.")
        return f

    def dflags(idx, r):
        f = mflags(idx, r)
        if str(idx) == PALM_SPRINGS: f.append("Palm Springs boundary is provisional: 28 Coachella Valley ZIPs assigned by Adtaxi, pending a Nielsen check. EASI counts Palm Springs inside Los Angeles, so painting and flooring spending use the Los Angeles rate.")
        if r.easi_cov == 0:
            f.append("None of this DMA's households live in a metro or micro area, so its EASI HVAC, roofing and plumbing spending is the average for its state's metro and micro areas.")
        elif r.easi_cov == r.easi_cov and r.easi_cov < 0.5:
            f.append(f"Only {r.easi_cov:.0%} of this DMA's households live in a metro or micro area, so its EASI HVAC, roofing and plumbing spending reflects those areas.")
        return f

    meta = {"built": built, "cbpYear": y, "acsYears": aud["meta"]["acsYears"]}
    json.dump({"level": "dma", "meta": meta, "rows": rows(dma, lambda i: tidy(dname.get(i, i)), dflags)}, open(os.path.join(OUT, "dma.json"), "w"), separators=(",", ":"))
    json.dump({"level": "metro", "meta": meta, "rows": rows(met, lambda i: mname.get(i, i), mflags)}, open(os.path.join(OUT, "metro.json"), "w"), separators=(",", ":"))
    json.dump({"level": "us", "meta": meta, "rows": rows(us, lambda i: "United States")}, open(os.path.join(OUT, "us.json"), "w"), separators=(",", ":"))

    # ZIPs inside each market, ranked within the market
    nfiles = 0
    for level, col, src_ in (("dma", "dma_code", zd), ("metro", "cbsa_code", zm)):
        folder = os.path.join(OUT, "zip", level); os.makedirs(folder, exist_ok=True)
        for code, g in src_.groupby(col):
            df = g.set_index("zip")
            f = pd.DataFrame(index=df.index)
            for c in ("population", "households", "owners", "sfd_own") + tuple(CLIMATE): f[c] = df[c]
            f["density"] = (df.households / df.land).where(df.land > 0)
            for k, (n, d) in RATE_PARTS.items(): f[k] = (df[n] / df[d]).where(df[d] > 0)
            for s in SUBCATS: f[f"est@{s['id']}"], f[f"prev@{s['id']}"] = df[f"zest_{s['id']}"], df[f"zest_prev_{s['id']}"]
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
